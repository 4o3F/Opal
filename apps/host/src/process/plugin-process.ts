// Single plugin process wrapper

import { resolve } from "jsr:@std/path@^1";
import { TextLineStream } from "jsr:@std/streams@^1/text-line-stream";
import {
  FeedDocumentSchema,
  GetStatusResultSchema,
  JsonRpcErrorCode,
  createGetFeedRequest,
  createGetStatusRequest,
  createShutdownRequest,
  isJsonRpcError,
  isWorkerPathSafe,
  safeParseJsonRpcResponse,
  toDenoNetPermissions,
  type FeedDocument,
  type GetStatusResult,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type PluginManifest,
} from "@opal/types";
import {
  normalizePluginProcessOptions,
  PluginJsonRpcError,
  PluginProcessError,
  PluginProcessExitedError,
  PluginProcessNotRunningError,
  PluginProcessProtocolError,
  PluginProcessTimeoutError,
  type NormalizedPluginProcessOptions,
  type PendingRequest,
  type PluginProcessOptions,
  type PluginProcessSnapshot,
  type PluginProcessState,
  type SendRequestOptions,
} from "./types.ts";

const ENCODER = new TextEncoder();
const STDERR_TAIL_LIMIT = 25;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  createError: () => Error
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(createError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

export class PluginProcess {
  readonly manifest: PluginManifest;
  readonly pluginDir: string;
  readonly workerPath: string;
  readonly options: NormalizedPluginProcessOptions;

  #child: Deno.ChildProcess | null = null;
  #stdinWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  #statusPromise: Promise<Deno.CommandStatus> | null = null;
  #stdoutTask: Promise<void> | null = null;
  #stderrTask: Promise<void> | null = null;
  #exitTask: Promise<void> | null = null;
  #startPromise: Promise<void> | null = null;
  #restartPromise: Promise<void> | null = null;
  #pending = new Map<string, PendingRequest>();
  #stderrTail: string[] = [];
  #state: PluginProcessState = "stopped";
  #startedAt: Date | null = null;
  #restartCount = 0;
  #lastExit: Deno.CommandStatus | null = null;
  #intentionalShutdown = false;

  constructor(manifest: PluginManifest, pluginDir: string, options: PluginProcessOptions = {}) {
    if (!isWorkerPathSafe(manifest.entrypoint.worker)) {
      throw new PluginProcessError(
        `Plugin "${manifest.name}" has an unsafe worker path "${manifest.entrypoint.worker}"`
      );
    }

    this.manifest = manifest;
    this.pluginDir = resolve(pluginDir);
    this.workerPath = resolve(this.pluginDir, manifest.entrypoint.worker);
    this.options = normalizePluginProcessOptions(options);
  }

  get name(): string {
    return this.manifest.name;
  }

  get state(): PluginProcessState {
    return this.#state;
  }

  snapshot(): PluginProcessSnapshot {
    return {
      name: this.name,
      pluginDir: this.pluginDir,
      workerPath: this.workerPath,
      pid: this.#child?.pid ?? null,
      state: this.#state,
      restartCount: this.#restartCount,
      startedAt: this.#startedAt?.toISOString() ?? null,
      lastExit: this.#lastExit
        ? {
            code: this.#lastExit.code,
            signal: this.#lastExit.signal,
            success: this.#lastExit.success,
          }
        : undefined,
      stderrTail: [...this.#stderrTail],
    };
  }

  async spawn(): Promise<void> {
    if (this.#state === "running") {
      return;
    }

    if (this.#startPromise !== null) {
      return await this.#startPromise;
    }

    this.#startPromise = this.#spawnInternal();

    try {
      await this.#startPromise;
      await this.#waitForStartup();
    } finally {
      this.#startPromise = null;
    }
  }

  async sendRequest<M extends JsonRpcRequest["method"]>(
    request: JsonRpcRequest<M>,
    options: SendRequestOptions = {}
  ): Promise<JsonRpcResponse> {
    await this.#awaitRunning();

    const writer = this.#stdinWriter;
    if (writer === null) {
      throw new PluginProcessNotRunningError(this.name, this.#state);
    }

    const timeoutMs = options.timeoutMs ?? this.options.requestTimeoutMs;
    const payload = `${JSON.stringify(request)}\n`;

    if (this.#pending.has(request.id)) {
      throw new PluginProcessProtocolError(
        `Plugin "${this.name}" already has an in-flight request "${request.id}"`
      );
    }

    const responsePromise = new Promise<JsonRpcResponse>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.#pending.delete(request.id);
        reject(new PluginProcessTimeoutError(this.name, request.id, timeoutMs));
      }, timeoutMs);

      this.#pending.set(request.id, {
        method: request.method,
        resolve: resolve as (response: unknown) => void,
        reject,
        timeoutId,
      });
    });

    try {
      await writer.write(ENCODER.encode(payload));
    } catch (error) {
      const pending = this.#pending.get(request.id);
      if (pending !== undefined) {
        clearTimeout(pending.timeoutId);
        this.#pending.delete(request.id);
      }
      throw new PluginProcessProtocolError(
        `Plugin "${this.name}" failed to write request "${request.id}"`,
        { cause: error }
      );
    }

    return await responsePromise;
  }

  async getFeed(
    routeId: string,
    params: Record<string, string> = {},
    timeoutMs?: number
  ): Promise<FeedDocument> {
    const response = await this.sendRequest(
      createGetFeedRequest(crypto.randomUUID(), routeId, params),
      { timeoutMs }
    );

    if (isJsonRpcError(response)) {
      throw new PluginJsonRpcError(this.name, response);
    }

    return FeedDocumentSchema.parse(response.result);
  }

  async getStatus(timeoutMs?: number): Promise<GetStatusResult> {
    const response = await this.sendRequest(createGetStatusRequest(crypto.randomUUID()), {
      timeoutMs,
    });

    if (isJsonRpcError(response)) {
      throw new PluginJsonRpcError(this.name, response);
    }

    return GetStatusResultSchema.parse(response.result);
  }

  async shutdown(timeoutMs = this.options.shutdownTimeoutMs): Promise<void> {
    if (this.#state === "stopped") {
      return;
    }

    this.#intentionalShutdown = true;

    if (this.#state === "running") {
      try {
        const response = await this.sendRequest(createShutdownRequest(crypto.randomUUID()), {
          timeoutMs,
        });
        if (isJsonRpcError(response)) {
          throw new PluginJsonRpcError(this.name, response);
        }
      } catch (error) {
        if (
          !(error instanceof PluginJsonRpcError) &&
          !(error instanceof PluginProcessTimeoutError) &&
          !(error instanceof PluginProcessNotRunningError) &&
          !(error instanceof PluginProcessProtocolError) &&
          !(error instanceof PluginProcessExitedError)
        ) {
          throw error;
        }
      }
    }

    this.#state = "stopping";
    await this.#closeStdin();

    if (this.#statusPromise === null) {
      this.#state = "stopped";
      return;
    }

    try {
      await withTimeout(
        this.#statusPromise,
        timeoutMs,
        () => new PluginProcessTimeoutError(this.name, "shutdown", timeoutMs)
      );
    } catch {
      this.#terminate("SIGTERM");
      try {
        await withTimeout(
          this.#statusPromise,
          this.options.forceKillTimeoutMs,
          () =>
            new PluginProcessTimeoutError(
              this.name,
              "shutdown",
              this.options.forceKillTimeoutMs
            )
        );
      } catch {
        this.#terminate("SIGKILL");
        await withTimeout(
          this.#statusPromise,
          this.options.forceKillTimeoutMs,
          () =>
            new PluginProcessTimeoutError(
              this.name,
              "shutdown",
              this.options.forceKillTimeoutMs
            )
        );
      }
    }

    await this.#exitTask?.catch(() => undefined);
  }

  #spawnInternal(): Promise<void> {
    this.#state = "starting";
    this.#intentionalShutdown = false;
    this.#stderrTail = [];

    try {
      const child = new Deno.Command(this.options.denoBinary, {
        args: this.#buildCommandArgs(),
        cwd: this.pluginDir,
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();

      this.#child = child;
      this.#stdinWriter = child.stdin.getWriter();
      this.#statusPromise = child.status;
      this.#startedAt = new Date();
      this.#state = "running";
      this.#stdoutTask = this.#consumeStdout(child.stdout);
      this.#stderrTask = this.#consumeStderr(child.stderr);
      this.#exitTask = this.#monitorExit(child.status);

      return Promise.resolve();
    } catch (error) {
      this.#state = "crashed";
      throw new PluginProcessError(`Failed to spawn plugin "${this.name}"`, { cause: error });
    }
  }

  #buildCommandArgs(): string[] {
    const args = [
      "run",
      "--quiet",
      "--no-prompt",
      "--deny-read",
      "--deny-write",
      "--deny-run",
      "--deny-env",
      "--deny-ffi",
      "--deny-import",
    ];

    if (this.options.denoConfigPath !== undefined) {
      args.push("--config", resolve(this.options.denoConfigPath));
    }

    const allowNetHosts = toDenoNetPermissions(this.manifest.network.allow);
    if (allowNetHosts.length > 0) {
      args.push(`--allow-net=${allowNetHosts.join(",")}`);
    }

    args.push(this.workerPath);

    return args;
  }

  async #waitForStartup(): Promise<void> {
    const timeoutMs = this.options.startupTimeoutMs;
    const deadline = Date.now() + timeoutMs;

    while (true) {
      if (this.#state !== "running") {
        throw new PluginProcessNotRunningError(this.name, this.#state);
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new PluginProcessTimeoutError(this.name, "startup", timeoutMs);
      }

      try {
        const status = await this.getStatus(Math.min(remainingMs, this.options.requestTimeoutMs));
        if (status.state === "ready" || status.state === "degraded") {
          return;
        }
        if (status.state === "error" || status.state === "stopped") {
          throw new PluginProcessProtocolError(
            `Plugin "${this.name}" reported unhealthy startup state "${status.state}"`
          );
        }
      } catch (error) {
        if (
          error instanceof PluginProcessExitedError ||
          error instanceof PluginProcessNotRunningError
        ) {
          throw error;
        }
        if (
          error instanceof PluginJsonRpcError &&
          error.response.error.code !== JsonRpcErrorCode.PLUGIN_NOT_READY
        ) {
          throw error;
        }
        if (
          !(error instanceof PluginJsonRpcError) &&
          !(error instanceof PluginProcessTimeoutError)
        ) {
          throw error;
        }
      }

      await sleep(Math.min(100, remainingMs));
    }
  }

  async #awaitRunning(): Promise<void> {
    if (this.#startPromise !== null) {
      await this.#startPromise;
    }

    if (this.#restartPromise !== null) {
      await this.#restartPromise;
    }

    if (this.#state !== "running") {
      throw new PluginProcessNotRunningError(this.name, this.#state);
    }
  }

  async #consumeStdout(stream: ReadableStream<Uint8Array>): Promise<void> {
    try {
      const lines = stream
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new TextLineStream());

      for await (const line of lines) {
        const text = line.trim();
        if (text.length === 0) {
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch (error) {
          this.#rejectAllPending(
            new PluginProcessProtocolError(
              `Plugin "${this.name}" emitted invalid JSON on stdout`,
              { cause: error }
            )
          );
          this.#terminate("SIGTERM");
          return;
        }

        const result = safeParseJsonRpcResponse(parsed);
        if (!result.success) {
          this.#rejectAllPending(
            new PluginProcessProtocolError(
              `Plugin "${this.name}" emitted invalid JSON-RPC on stdout`
            )
          );
          this.#terminate("SIGTERM");
          return;
        }

        this.#resolvePendingResponse(result.data);
      }
    } catch (error) {
      if (this.#state === "running" || this.#state === "starting") {
        this.#rejectAllPending(
          new PluginProcessProtocolError(
            `Plugin "${this.name}" stdout reader failed`,
            { cause: error }
          )
        );
      }
    }
  }

  async #consumeStderr(stream: ReadableStream<Uint8Array>): Promise<void> {
    try {
      const lines = stream
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new TextLineStream());

      for await (const line of lines) {
        const text = line.trim();
        if (text.length === 0) {
          continue;
        }

        this.#stderrTail.push(text);
        if (this.#stderrTail.length > STDERR_TAIL_LIMIT) {
          this.#stderrTail.shift();
        }
      }
    } catch {
      // Ignore stderr reader errors during teardown
    }
  }

  #resolvePendingResponse(response: JsonRpcResponse): void {
    if (response.id === null) {
      this.#rejectAllPending(
        new PluginProcessProtocolError(
          `Plugin "${this.name}" returned an uncorrelated JSON-RPC response`
        )
      );
      this.#terminate("SIGTERM");
      return;
    }

    const pending = this.#pending.get(response.id);
    if (pending === undefined) {
      return;
    }

    clearTimeout(pending.timeoutId);
    this.#pending.delete(response.id);
    pending.resolve(response);
  }

  async #monitorExit(statusPromise: Promise<Deno.CommandStatus>): Promise<void> {
    const status = await statusPromise;

    this.#lastExit = status;
    await this.#closeStdin();
    await Promise.allSettled(
      [this.#stdoutTask, this.#stderrTask].filter(
        (task): task is Promise<void> => task !== null
      )
    );

    this.#child = null;
    this.#statusPromise = null;
    this.#stdoutTask = null;
    this.#stderrTask = null;

    const exitError = new PluginProcessExitedError(this.name, status, this.#stderrTail);
    this.#rejectAllPending(exitError);

    const shouldRestart =
      !this.#intentionalShutdown &&
      this.options.autoRestart &&
      this.#restartCount < this.options.maxRestarts;

    this.#state = this.#intentionalShutdown ? "stopped" : "crashed";

    if (shouldRestart) {
      this.#restartPromise = this.#restartAfterCrash();
      try {
        await this.#restartPromise;
      } finally {
        this.#restartPromise = null;
      }
    }
  }

  async #restartAfterCrash(): Promise<void> {
    this.#restartCount += 1;
    await sleep(this.options.restartDelayMs);

    if (this.#intentionalShutdown) {
      return;
    }

    await this.spawn();
  }

  #rejectAllPending(error: Error): void {
    for (const [id, pending] of this.#pending.entries()) {
      clearTimeout(pending.timeoutId);
      this.#pending.delete(id);
      pending.reject(error);
    }
  }

  async #closeStdin(): Promise<void> {
    const writer = this.#stdinWriter;
    this.#stdinWriter = null;

    if (writer === null) {
      return;
    }

    try {
      await writer.close();
    } catch {
      // Ignore close failures during teardown
    } finally {
      writer.releaseLock();
    }
  }

  #terminate(signal: Deno.Signal): void {
    try {
      this.#child?.kill(signal);
    } catch {
      // Ignore kill errors if the process is already gone
    }
  }
}
