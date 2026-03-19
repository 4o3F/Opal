// Hono API routes

import { Hono } from "hono";
import { JsonRpcErrorCode, type PluginManifest } from "@opal/types";
import {
  PluginJsonRpcError,
  PluginNotFoundError,
  PluginProcessError,
  PluginProcessManager,
} from "../process/mod.ts";
import { RouteResolver, RouteResolverError } from "../resolver/mod.ts";
import { getFeedContentType, renderFeed } from "../renderer/mod.ts";

export type LoadedPlugin = {
  manifest: PluginManifest;
  pluginDir: string;
};

export type CreateApiAppOptions = {
  processManager: PluginProcessManager;
  plugins: ReadonlyMap<string, LoadedPlugin>;
  startupErrors?: Map<string, string>;
  resolver?: RouteResolver;
};

class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown, options?: ErrorOptions) {
    super(message, options);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

function getPluginSummaries(
  plugins: ReadonlyMap<string, LoadedPlugin>,
  processManager: PluginProcessManager,
  startupErrors: ReadonlyMap<string, string>
) {
  const snapshots = new Map(processManager.list().map((snapshot) => [snapshot.name, snapshot]));

  return [...plugins.values()].map(({ manifest, pluginDir }) => ({
    name: manifest.name,
    version: manifest.version,
    description: manifest.description ?? null,
    pluginDir,
    routes: manifest.routes.map((route) => ({
      id: route.id,
      path: route.path,
      description: route.description ?? null,
      formats: route.output.types,
      defaultFormat: route.output.defaultType ?? route.output.types[0] ?? null,
    })),
    process: snapshots.get(manifest.name) ?? null,
    startupError: startupErrors.get(manifest.name) ?? null,
  }));
}

function parseFeedPath(pathname: string): { pluginName: string; routePath: string } {
  const prefix = "/feed/";
  if (!pathname.startsWith(prefix)) {
    throw new ApiError(404, "Feed route not found");
  }

  const rest = pathname.slice(prefix.length);
  if (rest.length === 0) {
    throw new ApiError(400, "Feed route must include a plugin name");
  }

  const slashIndex = rest.indexOf("/");
  let pluginName = "";
  let routePath = "";

  try {
    if (slashIndex === -1) {
      pluginName = decodeURIComponent(rest);
    } else {
      pluginName = decodeURIComponent(rest.slice(0, slashIndex));
      routePath =
        slashIndex === rest.length - 1 ? "" : decodeURIComponent(rest.slice(slashIndex + 1));
    }
  } catch (error) {
    throw new ApiError(400, "Feed path contains invalid URL encoding", undefined, { cause: error });
  }

  if (pluginName.length === 0) {
    throw new ApiError(400, "Feed route must include a plugin name");
  }

  return { pluginName, routePath };
}

function mapPluginJsonRpcError(error: PluginJsonRpcError): ApiError {
  switch (error.response.error.code) {
    case JsonRpcErrorCode.INVALID_REQUEST:
    case JsonRpcErrorCode.INVALID_PARAMS:
      return new ApiError(400, error.message, error.response.error);
    case JsonRpcErrorCode.METHOD_NOT_FOUND:
    case JsonRpcErrorCode.ROUTE_NOT_FOUND:
      return new ApiError(404, error.message, error.response.error);
    case JsonRpcErrorCode.PLUGIN_NOT_READY:
    case JsonRpcErrorCode.TIMEOUT:
      return new ApiError(503, error.message, error.response.error);
    case JsonRpcErrorCode.FETCH_FAILED:
      return new ApiError(502, error.message, error.response.error);
    default:
      return new ApiError(500, error.message, error.response.error);
  }
}

function mapError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  if (error instanceof RouteResolverError) {
    return new ApiError(error.status, error.message, error.details, { cause: error });
  }
  if (error instanceof PluginNotFoundError) {
    return new ApiError(404, error.message, undefined, { cause: error });
  }
  if (error instanceof PluginJsonRpcError) {
    return mapPluginJsonRpcError(error);
  }
  if (error instanceof PluginProcessError) {
    return new ApiError(502, error.message, undefined, { cause: error });
  }
  if (error instanceof Error) {
    return new ApiError(500, error.message, undefined, { cause: error });
  }
  return new ApiError(500, "Internal server error", { error });
}

export function createApiApp({
  processManager,
  plugins,
  startupErrors = new Map<string, string>(),
  resolver = new RouteResolver(
    new Map([...plugins].map(([name, plugin]) => [name, plugin.manifest]))
  ),
}: CreateApiAppOptions): Hono {
  const app = new Hono();

  const ensurePluginStarted = async (pluginName: string): Promise<LoadedPlugin> => {
    const plugin = plugins.get(pluginName);
    if (plugin === undefined) {
      throw new ApiError(404, `Plugin "${pluginName}" is not registered`);
    }

    if (!processManager.has(pluginName)) {
      try {
        await processManager.spawn(plugin.manifest, plugin.pluginDir);
        startupErrors.delete(pluginName);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        startupErrors.set(pluginName, message);
        throw new ApiError(502, `Failed to start plugin "${pluginName}"`, { message });
      }
    }

    return plugin;
  };

  app.get("/health", (c) => {
    const processes = processManager.list();
    const snapshots = new Map(processes.map((process) => [process.name, process]));
    const ok =
      startupErrors.size === 0 &&
      [...plugins.keys()].every((pluginName) => {
        const process = snapshots.get(pluginName);
        return (
          process !== undefined &&
          (process.state === "running" || process.state === "starting")
        );
      });

    return c.json({
      ok,
      registeredPlugins: plugins.size,
      managedProcesses: processes.length,
      startupErrors: Object.fromEntries(startupErrors),
      processes,
    });
  });

  app.get("/plugins", (c) => {
    return c.json({
      plugins: getPluginSummaries(plugins, processManager, startupErrors),
    });
  });

  app.post("/plugins/:name/reload", async (c) => {
    const pluginName = c.req.param("name");
    const plugin = plugins.get(pluginName);

    if (plugin === undefined) {
      throw new ApiError(404, `Plugin "${pluginName}" is not registered`);
    }

    if (processManager.has(pluginName)) {
      await processManager.shutdown(pluginName);
    }

    try {
      const snapshot = await processManager.spawn(plugin.manifest, plugin.pluginDir);
      startupErrors.delete(pluginName);
      return c.json({ ok: true, plugin: pluginName, process: snapshot });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      startupErrors.set(pluginName, message);
      throw error;
    }
  });

  app.get("/feed/*", async (c) => {
    const url = new URL(c.req.url);
    const { pluginName, routePath } = parseFeedPath(url.pathname);
    const resolved = resolver.resolveFeedRequest(pluginName, routePath, url.searchParams);

    await ensurePluginStarted(pluginName);

    const document = await processManager.getFeed(pluginName, resolved.routeId, resolved.params);
    const body = renderFeed(resolved.format, document);

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": getFeedContentType(resolved.format),
      },
    });
  });

  app.onError((error, c) => {
    const apiError = mapError(error);
    return c.json(
      {
        ok: false,
        error: apiError.message,
        details: apiError.details ?? null,
      },
      apiError.status as 400
    );
  });

  return app;
}
