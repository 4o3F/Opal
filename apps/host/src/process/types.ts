// Process management types and error classes

import type { JsonRpcErrorResponse, JsonRpcRequest } from "@opal/types";

export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
export const DEFAULT_STARTUP_TIMEOUT_MS = 5_000;
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;
export const DEFAULT_FORCE_KILL_TIMEOUT_MS = 2_000;
export const DEFAULT_RESTART_DELAY_MS = 1_000;
export const DEFAULT_MAX_RESTARTS = 3;

export type PluginProcessState =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "crashed";

export type PluginProcessCommandStatus = Pick<Deno.CommandStatus, "code" | "signal" | "success">;

export type PluginProcessOptions = {
  denoBinary?: string;
  denoConfigPath?: string;
  requestTimeoutMs?: number;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  forceKillTimeoutMs?: number;
  autoRestart?: boolean;
  restartDelayMs?: number;
  maxRestarts?: number;
};

export type NormalizedPluginProcessOptions = {
  denoBinary: string;
  denoConfigPath?: string;
  requestTimeoutMs: number;
  startupTimeoutMs: number;
  shutdownTimeoutMs: number;
  forceKillTimeoutMs: number;
  autoRestart: boolean;
  restartDelayMs: number;
  maxRestarts: number;
};

export type SendRequestOptions = {
  timeoutMs?: number;
};

export type PendingRequest = {
  method: JsonRpcRequest["method"];
  resolve: (response: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

export type PluginProcessSnapshot = {
  name: string;
  pluginDir: string;
  workerPath: string;
  pid: number | null;
  state: PluginProcessState;
  restartCount: number;
  startedAt: string | null;
  lastExit?: PluginProcessCommandStatus;
  stderrTail: string[];
};

export function normalizePluginProcessOptions(
  options: PluginProcessOptions = {}
): NormalizedPluginProcessOptions {
  return {
    denoBinary: options.denoBinary ?? "deno",
    denoConfigPath: options.denoConfigPath,
    requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    startupTimeoutMs: options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
    shutdownTimeoutMs: options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
    forceKillTimeoutMs: options.forceKillTimeoutMs ?? DEFAULT_FORCE_KILL_TIMEOUT_MS,
    autoRestart: options.autoRestart ?? false,
    restartDelayMs: options.restartDelayMs ?? DEFAULT_RESTART_DELAY_MS,
    maxRestarts: options.maxRestarts ?? DEFAULT_MAX_RESTARTS,
  };
}

export class PluginProcessError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

export class PluginNotFoundError extends PluginProcessError {
  constructor(pluginName: string) {
    super(`Plugin "${pluginName}" is not registered`);
  }
}

export class PluginProcessNotRunningError extends PluginProcessError {
  constructor(pluginName: string, state: PluginProcessState) {
    super(`Plugin "${pluginName}" is not running (state: ${state})`);
  }
}

export class PluginProcessTimeoutError extends PluginProcessError {
  constructor(pluginName: string, requestId: string, timeoutMs: number) {
    super(`Plugin "${pluginName}" request "${requestId}" timed out after ${timeoutMs}ms`);
  }
}

export class PluginProcessProtocolError extends PluginProcessError {}

export class PluginProcessExitedError extends PluginProcessError {
  readonly status: Deno.CommandStatus;

  constructor(pluginName: string, status: Deno.CommandStatus, stderrTail: readonly string[] = []) {
    const detail = status.signal !== undefined ? `signal ${status.signal}` : `code ${status.code}`;
    const stderr = stderrTail.length > 0 ? ` stderr: ${stderrTail.join(" | ")}` : "";
    super(`Plugin "${pluginName}" exited unexpectedly with ${detail}.${stderr}`);
    this.status = status;
  }
}

export class PluginJsonRpcError extends PluginProcessError {
  readonly response: JsonRpcErrorResponse;

  constructor(pluginName: string, response: JsonRpcErrorResponse) {
    super(`Plugin "${pluginName}" returned JSON-RPC error ${response.error.code}: ${response.error.message}`);
    this.response = response;
  }
}
