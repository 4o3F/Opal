// Plugin process manager

import { resolve } from "jsr:@std/path@^1";
import type {
  FeedDocument,
  GetStatusResult,
  JsonRpcRequest,
  JsonRpcResponse,
  MethodResultMap,
  PluginManifest,
} from "@opal/types";
import { PluginProcess } from "./plugin-process.ts";
import {
  PluginNotFoundError,
  PluginProcessError,
  type PluginProcessOptions,
  type PluginProcessSnapshot,
} from "./types.ts";

export class PluginProcessManager {
  #processes = new Map<string, PluginProcess>();
  #options: PluginProcessOptions;

  constructor(options: PluginProcessOptions = {}) {
    this.#options = options;
  }

  list(): PluginProcessSnapshot[] {
    return [...this.#processes.values()].map((process) => process.snapshot());
  }

  has(pluginName: string): boolean {
    return this.#processes.has(pluginName);
  }

  getSnapshot(pluginName: string): PluginProcessSnapshot {
    return this.#requireProcess(pluginName).snapshot();
  }

  async spawn(
    manifest: PluginManifest,
    pluginDir: string,
    options: PluginProcessOptions = {}
  ): Promise<PluginProcessSnapshot> {
    const existing = this.#processes.get(manifest.name);
    const resolvedPluginDir = resolve(pluginDir);

    if (existing !== undefined) {
      if (
        existing.pluginDir !== resolvedPluginDir ||
        existing.workerPath !== resolve(resolvedPluginDir, manifest.entrypoint.worker)
      ) {
        throw new PluginProcessError(
          `Plugin "${manifest.name}" is already registered with a different entrypoint`
        );
      }

      await existing.spawn();
      return existing.snapshot();
    }

    const process = new PluginProcess(manifest, resolvedPluginDir, {
      ...this.#options,
      ...options,
    });

    this.#processes.set(manifest.name, process);

    try {
      await process.spawn();
      return process.snapshot();
    } catch (error) {
      this.#processes.delete(manifest.name);
      throw error;
    }
  }

  async sendRequest<M extends keyof MethodResultMap & string>(
    pluginName: string,
    request: JsonRpcRequest<M>,
    timeoutMs?: number
  ): Promise<JsonRpcResponse<MethodResultMap[M]>> {
    const response = await this.#requireProcess(pluginName).sendRequest(request, { timeoutMs });
    return response as JsonRpcResponse<MethodResultMap[M]>;
  }

  async getFeed(
    pluginName: string,
    routeId: string,
    params: Record<string, string> = {},
    timeoutMs?: number
  ): Promise<FeedDocument> {
    return await this.#requireProcess(pluginName).getFeed(routeId, params, timeoutMs);
  }

  async getStatus(pluginName: string, timeoutMs?: number): Promise<GetStatusResult> {
    return await this.#requireProcess(pluginName).getStatus(timeoutMs);
  }

  async shutdown(pluginName: string): Promise<void> {
    const process = this.#requireProcess(pluginName);
    await process.shutdown();
    this.#processes.delete(pluginName);
  }

  async shutdownAll(): Promise<void> {
    const entries = [...this.#processes.entries()];
    const errors: unknown[] = [];

    await Promise.all(
      entries.map(async ([pluginName, process]) => {
        try {
          await process.shutdown();
          this.#processes.delete(pluginName);
        } catch (error) {
          errors.push(error);
        }
      })
    );

    if (errors.length > 0) {
      throw new AggregateError(errors, "One or more plugin shutdowns failed");
    }
  }

  #requireProcess(pluginName: string): PluginProcess {
    const process = this.#processes.get(pluginName);

    if (process === undefined) {
      throw new PluginNotFoundError(pluginName);
    }

    return process;
  }
}
