// Route resolver - URL path to plugin route resolution

import {
  FeedFormatSchema,
  type FeedFormat,
  type ParamSchema,
  type PluginManifest,
  type PluginRouteManifest,
} from "@opal/types";

export type ResolvedFeedRoute = {
  pluginName: string;
  routeId: string;
  params: Record<string, string>;
  format: FeedFormat;
  manifest: PluginManifest;
  route: PluginRouteManifest;
};

export class RouteResolverError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status = 400, details?: unknown, options?: ErrorOptions) {
    super(message, options);
    this.name = "RouteResolverError";
    this.status = status;
    this.details = details;
  }
}

function normalizeRoutePath(value: string): string {
  const trimmed = value.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed === "/" ? "" : trimmed;
}

function serializeDefaultValue(value: string | number | boolean): string {
  return typeof value === "boolean" ? String(value) : `${value}`;
}

function validateStringParam(
  key: string,
  rawValue: string,
  schema: Extract<ParamSchema, { type: "string" }>
): string {
  if (schema.enum !== undefined && !schema.enum.includes(rawValue)) {
    throw new RouteResolverError(
      `Query parameter "${key}" must be one of: ${schema.enum.join(", ")}`
    );
  }

  if (schema.pattern !== undefined) {
    let pattern: RegExp;
    try {
      pattern = new RegExp(schema.pattern);
    } catch (error) {
      throw new RouteResolverError(
        `Route parameter schema for "${key}" contains an invalid regular expression`,
        500,
        undefined,
        { cause: error }
      );
    }

    if (!pattern.test(rawValue)) {
      throw new RouteResolverError(
        `Query parameter "${key}" does not match the required pattern`
      );
    }
  }

  return rawValue;
}

function validateNumberParam(
  key: string,
  rawValue: string,
  schema: Extract<ParamSchema, { type: "number" }>
): string {
  const value = Number(rawValue);

  if (!Number.isFinite(value)) {
    throw new RouteResolverError(`Query parameter "${key}" must be a number`);
  }

  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    throw new RouteResolverError(
      `Query parameter "${key}" must be one of: ${schema.enum.join(", ")}`
    );
  }

  return rawValue;
}

function validateBooleanParam(key: string, rawValue: string): string {
  const normalized = rawValue.toLowerCase();

  if (normalized !== "true" && normalized !== "false") {
    throw new RouteResolverError(`Query parameter "${key}" must be "true" or "false"`);
  }

  return normalized;
}

function resolveParams(route: PluginRouteManifest, query: URLSearchParams): Record<string, string> {
  const schema = route.paramsSchema ?? {};
  const allowedKeys = new Set(Object.keys(schema));
  const params: Record<string, string> = {};

  for (const key of new Set(query.keys())) {
    if (key === "format") {
      continue;
    }
    if (!allowedKeys.has(key)) {
      throw new RouteResolverError(`Unknown query parameter "${key}"`);
    }
    if (query.getAll(key).length > 1) {
      throw new RouteResolverError(`Query parameter "${key}" must not be repeated`);
    }
  }

  for (const [key, definition] of Object.entries(schema)) {
    const rawValue = query.get(key);

    if (rawValue === null) {
      if (definition.default !== undefined) {
        params[key] = serializeDefaultValue(definition.default);
      }
      continue;
    }

    switch (definition.type) {
      case "string":
        params[key] = validateStringParam(key, rawValue, definition);
        break;
      case "number":
        params[key] = validateNumberParam(key, rawValue, definition);
        break;
      case "boolean":
        params[key] = validateBooleanParam(key, rawValue);
        break;
    }
  }

  return params;
}

function resolveFormat(route: PluginRouteManifest, query: URLSearchParams): FeedFormat {
  const requestedFormats = query.getAll("format");
  if (requestedFormats.length > 1) {
    throw new RouteResolverError('Query parameter "format" must not be repeated');
  }

  const requestedFormat = requestedFormats[0];
  if (requestedFormat === undefined) {
    // Schema guarantees types.length >= 1
    return route.output.defaultType ?? route.output.types[0]!;
  }

  const parsedFormat = FeedFormatSchema.safeParse(requestedFormat);
  if (!parsedFormat.success) {
    throw new RouteResolverError(`Unsupported feed format "${requestedFormat}"`);
  }

  if (!route.output.types.includes(parsedFormat.data)) {
    throw new RouteResolverError(
      `Route "${route.id}" does not support format "${parsedFormat.data}"`,
      400,
      { supportedFormats: route.output.types }
    );
  }

  return parsedFormat.data;
}

export class RouteResolver {
  #plugins: ReadonlyMap<string, PluginManifest>;

  constructor(plugins: ReadonlyMap<string, PluginManifest>) {
    this.#plugins = plugins;
  }

  resolveFeedRequest(
    pluginName: string,
    routePath: string,
    query: URLSearchParams
  ): ResolvedFeedRoute {
    const manifest = this.#plugins.get(pluginName);
    if (manifest === undefined) {
      throw new RouteResolverError(`Plugin "${pluginName}" is not registered`, 404);
    }

    const normalizedPath = normalizeRoutePath(routePath);
    const route = manifest.routes.find(
      (candidate) => normalizeRoutePath(candidate.path) === normalizedPath
    );
    if (route === undefined) {
      throw new RouteResolverError(
        `Route "${routePath}" not found for plugin "${pluginName}"`,
        404
      );
    }

    return {
      pluginName,
      routeId: route.id,
      params: resolveParams(route, query),
      format: resolveFormat(route, query),
      manifest,
      route,
    };
  }
}
