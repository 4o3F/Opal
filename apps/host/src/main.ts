// @opal/host - Entry point

import { dirname, fromFileUrl, join, resolve } from "jsr:@std/path@^1";
import { safeParsePluginManifest } from "@opal/types";
import { createApiApp, type LoadedPlugin } from "./api/mod.ts";
import { PluginProcessManager } from "./process/mod.ts";

const HOST_PORT = 8080;
const HOST_SOURCE_DIR = dirname(fromFileUrl(import.meta.url));
const REPO_ROOT = resolve(HOST_SOURCE_DIR, "../../..");
const PLUGINS_DIR = join(REPO_ROOT, "plugins");
const ROOT_DENO_CONFIG = join(REPO_ROOT, "deno.json");

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

export async function loadPlugins(pluginsDir = PLUGINS_DIR): Promise<Map<string, LoadedPlugin>> {
  const plugins = new Map<string, LoadedPlugin>();

  try {
    for await (const entry of Deno.readDir(pluginsDir)) {
      if (!entry.isDirectory) {
        continue;
      }

      const pluginDir = join(pluginsDir, entry.name);
      const manifestPath = join(pluginDir, "manifest.json");

      if (!(await fileExists(manifestPath))) {
        continue;
      }

      try {
        const rawManifest = JSON.parse(await Deno.readTextFile(manifestPath));
        const parsed = safeParsePluginManifest(rawManifest);

        if (!parsed.success) {
          console.warn(`Skipping plugin "${entry.name}": invalid manifest at ${manifestPath}`);
          continue;
        }

        if (plugins.has(parsed.data.name)) {
          console.warn(
            `Skipping duplicate plugin name "${parsed.data.name}" from ${manifestPath}`
          );
          continue;
        }

        plugins.set(parsed.data.name, {
          manifest: parsed.data,
          pluginDir,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `Skipping plugin "${entry.name}": failed to load ${manifestPath}: ${message}`
        );
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  return plugins;
}

export async function bootstrapHost(pluginsDir = PLUGINS_DIR) {
  const plugins = await loadPlugins(pluginsDir);
  const startupErrors = new Map<string, string>();
  const processManager = new PluginProcessManager({
    denoConfigPath: ROOT_DENO_CONFIG,
    autoRestart: true,
  });

  for (const [pluginName, plugin] of plugins) {
    try {
      await processManager.spawn(plugin.manifest, plugin.pluginDir);
      console.log(`Started plugin "${pluginName}"`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      startupErrors.set(pluginName, message);
      console.error(`Failed to start plugin "${pluginName}": ${message}`);
    }
  }

  const app = createApiApp({
    processManager,
    plugins,
    startupErrors,
  });

  return { app, plugins, processManager, startupErrors };
}

if (import.meta.main) {
  const { app, plugins, processManager } = await bootstrapHost();
  const server = Deno.serve({ port: HOST_PORT }, app.fetch);

  console.log(`Opal Host listening on http://localhost:${HOST_PORT}/`);
  console.log(`Loaded ${plugins.size} plugin manifest(s)`);

  const shutdown = async () => {
    server.shutdown();
    await processManager.shutdownAll().catch((error) => {
      console.error("Failed to shutdown all plugin processes:", error);
    });
  };

  Deno.addSignalListener("SIGINT", () => void shutdown());
  Deno.addSignalListener("SIGTERM", () => void shutdown());
}
