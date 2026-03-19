// JSON-RPC 2.0 over stdio protocol types

import { z } from "zod";
import type { FeedDocument } from "./feed.ts";

export const JSON_RPC_VERSION = "2.0" as const;

// Valid request methods
export const JSON_RPC_METHODS = ["get_status", "get_feed", "shutdown"] as const;
export const JsonRpcMethodSchema = z.enum(JSON_RPC_METHODS);
export type JsonRpcMethod = z.infer<typeof JsonRpcMethodSchema>;

// JSON-RPC Error Codes (standard + custom)
export const JsonRpcErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Custom error codes (-32000 to -32099)
  PLUGIN_NOT_READY: -32001,
  ROUTE_NOT_FOUND: -32002,
  FETCH_FAILED: -32003,
  TIMEOUT: -32004,
} as const;

export type JsonRpcErrorCode = (typeof JsonRpcErrorCode)[keyof typeof JsonRpcErrorCode];

// Params schemas
export const GetFeedParamsSchema = z.object({
  routeId: z.string(),
  params: z.record(z.string()),
});
export type GetFeedParams = z.infer<typeof GetFeedParamsSchema>;

// Result schemas
export const WorkerStateSchema = z.enum(["starting", "ready", "degraded", "error", "stopped"]);
export type WorkerState = z.infer<typeof WorkerStateSchema>;

export const RouteStateSchema = z.object({
  routeId: z.string(),
  status: z.enum(["ready", "stale", "warming", "error"]),
  lastUpdated: z.string().optional(),
  errorMessage: z.string().optional(),
});
export type RouteState = z.infer<typeof RouteStateSchema>;

export const GetStatusResultSchema = z.object({
  state: WorkerStateSchema,
  startedAt: z.string(),
  routeStates: z.array(RouteStateSchema),
});
export type GetStatusResult = z.infer<typeof GetStatusResultSchema>;

export const ShutdownResultSchema = z.object({
  stoppedAt: z.string(),
});
export type ShutdownResult = z.infer<typeof ShutdownResultSchema>;

// Method to params/result mapping
export type MethodParamsMap = {
  get_status: Record<string, never>;
  get_feed: GetFeedParams;
  shutdown: Record<string, never>;
};

export type MethodResultMap = {
  get_status: GetStatusResult;
  get_feed: FeedDocument;
  shutdown: ShutdownResult;
};

// Error object schema
export const JsonRpcErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().optional(),
});
export type JsonRpcError = z.infer<typeof JsonRpcErrorSchema>;

// Request schemas
const BaseRequestSchema = z.object({
  jsonrpc: z.literal(JSON_RPC_VERSION),
  id: z.string().min(1),
});

export const GetStatusRequestSchema = BaseRequestSchema.extend({
  method: z.literal("get_status"),
  params: z.object({}),
});
export type GetStatusRequest = z.infer<typeof GetStatusRequestSchema>;

export const GetFeedRequestSchema = BaseRequestSchema.extend({
  method: z.literal("get_feed"),
  params: GetFeedParamsSchema,
});
export type GetFeedRequest = z.infer<typeof GetFeedRequestSchema>;

export const ShutdownRequestSchema = BaseRequestSchema.extend({
  method: z.literal("shutdown"),
  params: z.object({}),
});
export type ShutdownRequest = z.infer<typeof ShutdownRequestSchema>;

// Combined request schema (discriminated union)
export const JsonRpcRequestSchema = z.discriminatedUnion("method", [
  GetStatusRequestSchema,
  GetFeedRequestSchema,
  ShutdownRequestSchema,
]);

// Generic request type (backward compatible)
export type JsonRpcRequest<M extends JsonRpcMethod = JsonRpcMethod> = {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: string;
  method: M;
  params: MethodParamsMap[M];
};

// Response schemas
export const JsonRpcSuccessResponseSchema = z.object({
  jsonrpc: z.literal(JSON_RPC_VERSION),
  id: z.string(),
  result: z.unknown(),
});

export const JsonRpcErrorResponseSchema = z.object({
  jsonrpc: z.literal(JSON_RPC_VERSION),
  id: z.string().nullable(),
  error: JsonRpcErrorSchema,
});

export const JsonRpcResponseSchema = z.union([
  JsonRpcSuccessResponseSchema,
  JsonRpcErrorResponseSchema,
]);

// Response types (backward compatible)
export type JsonRpcSuccessResponse<R = unknown> = {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: string;
  result: R;
  error?: never;
};

export type JsonRpcErrorResponse = {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: string | null;
  result?: never;
  error: JsonRpcError;
};

export type JsonRpcResponse<R = unknown> = JsonRpcSuccessResponse<R> | JsonRpcErrorResponse;

// Type guard functions (backward compatible API)
export function isJsonRpcRequest(obj: unknown): obj is JsonRpcRequest {
  return JsonRpcRequestSchema.safeParse(obj).success;
}

export function isGetStatusRequest(obj: unknown): obj is GetStatusRequest {
  return GetStatusRequestSchema.safeParse(obj).success;
}

export function isGetFeedRequest(obj: unknown): obj is GetFeedRequest {
  return GetFeedRequestSchema.safeParse(obj).success;
}

export function isShutdownRequest(obj: unknown): obj is ShutdownRequest {
  return ShutdownRequestSchema.safeParse(obj).success;
}

export function isJsonRpcSuccessResponse(obj: unknown): obj is JsonRpcSuccessResponse {
  if (!JsonRpcSuccessResponseSchema.safeParse(obj).success) return false;
  // Ensure mutual exclusion with error
  const o = obj as Record<string, unknown>;
  return !("error" in o);
}

export function isJsonRpcErrorResponse(obj: unknown): obj is JsonRpcErrorResponse {
  if (!JsonRpcErrorResponseSchema.safeParse(obj).success) return false;
  // Ensure mutual exclusion with result
  const o = obj as Record<string, unknown>;
  return !("result" in o);
}

export function isJsonRpcResponse(obj: unknown): obj is JsonRpcResponse {
  return isJsonRpcSuccessResponse(obj) || isJsonRpcErrorResponse(obj);
}

// Narrowing helper
export function isJsonRpcError(response: JsonRpcResponse): response is JsonRpcErrorResponse {
  return "error" in response && response.error !== undefined;
}

// Response constructors
export function createSuccessResponse<M extends JsonRpcMethod>(
  id: string,
  result: MethodResultMap[M]
): JsonRpcSuccessResponse<MethodResultMap[M]> {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    result,
  };
}

export function createErrorResponse(
  id: string | null,
  code: number,
  message: string,
  data?: unknown
): JsonRpcErrorResponse {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    error: { code, message, ...(data !== undefined && { data }) },
  };
}

// Request constructors
export function createGetStatusRequest(id: string): GetStatusRequest {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    method: "get_status",
    params: {},
  };
}

export function createGetFeedRequest(
  id: string,
  routeId: string,
  params: Record<string, string> = {}
): GetFeedRequest {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    method: "get_feed",
    params: { routeId, params },
  };
}

export function createShutdownRequest(id: string): ShutdownRequest {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    method: "shutdown",
    params: {},
  };
}

// Generic request constructor
export function createRequest<M extends JsonRpcMethod>(
  id: string,
  method: M,
  params: MethodParamsMap[M]
): JsonRpcRequest<M> {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    method,
    params,
  };
}

// Parse functions
export function parseJsonRpcRequest(value: unknown) {
  return JsonRpcRequestSchema.parse(value);
}

export function safeParseJsonRpcRequest(value: unknown) {
  return JsonRpcRequestSchema.safeParse(value);
}

// Parse JSON-RPC response with mutual exclusion enforcement
export function safeParseJsonRpcResponse(
  value: unknown
): { success: true; data: JsonRpcResponse } | { success: false; error: z.ZodError } {
  // Use type guards to enforce mutual exclusion (result XOR error)
  if (isJsonRpcSuccessResponse(value)) {
    return { success: true, data: value };
  }
  if (isJsonRpcErrorResponse(value)) {
    return { success: true, data: value };
  }
  return {
    success: false,
    error: new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        path: [],
        message: "Invalid JSON-RPC response: must have result XOR error",
      },
    ]),
  };
}

export function parseJsonRpcResponse(value: unknown): JsonRpcResponse {
  const result = safeParseJsonRpcResponse(value);
  if (result.success) {
    return result.data;
  }
  throw result.error;
}
