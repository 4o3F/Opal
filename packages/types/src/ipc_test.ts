import { assertEquals } from "@std/assert";
import {
  isJsonRpcRequest,
  isJsonRpcResponse,
  isJsonRpcSuccessResponse,
  isJsonRpcErrorResponse,
  isGetFeedRequest,
  safeParseJsonRpcResponse,
} from "./ipc.ts";

// Test isJsonRpcRequest rejects unknown methods
Deno.test("isJsonRpcRequest rejects unknown methods", () => {
  const req = {
    jsonrpc: "2.0",
    id: "1",
    method: "unknown_method",
    params: {},
  };
  assertEquals(isJsonRpcRequest(req), false);
});

// Test isJsonRpcRequest rejects null params
Deno.test("isJsonRpcRequest rejects null params", () => {
  const req = {
    jsonrpc: "2.0",
    id: "1",
    method: "get_status",
    params: null,
  };
  assertEquals(isJsonRpcRequest(req), false);
});

// Test isJsonRpcRequest rejects array params
Deno.test("isJsonRpcRequest rejects array params", () => {
  const req = {
    jsonrpc: "2.0",
    id: "1",
    method: "get_status",
    params: [],
  };
  assertEquals(isJsonRpcRequest(req), false);
});

// Test isJsonRpcRequest accepts valid request
Deno.test("isJsonRpcRequest accepts valid request", () => {
  const req = {
    jsonrpc: "2.0",
    id: "1",
    method: "get_status",
    params: {},
  };
  assertEquals(isJsonRpcRequest(req), true);
});

// Test isJsonRpcRequest rejects empty id
Deno.test("isJsonRpcRequest rejects empty id", () => {
  const req = {
    jsonrpc: "2.0",
    id: "",
    method: "get_status",
    params: {},
  };
  assertEquals(isJsonRpcRequest(req), false);
});

// Test isJsonRpcResponse enforces mutual exclusion
Deno.test("isJsonRpcResponse rejects both result and error", () => {
  const res = {
    jsonrpc: "2.0",
    id: "1",
    result: { data: "ok" },
    error: { code: -1, message: "bad" },
  };
  // Neither success nor error guard should pass
  assertEquals(isJsonRpcSuccessResponse(res), false);
  assertEquals(isJsonRpcErrorResponse(res), false);
  assertEquals(isJsonRpcResponse(res), false);
});

// Test safeParseJsonRpcResponse enforces mutual exclusion
Deno.test("safeParseJsonRpcResponse rejects both result and error", () => {
  const res = {
    jsonrpc: "2.0",
    id: "1",
    result: { data: "ok" },
    error: { code: -1, message: "bad" },
  };
  assertEquals(safeParseJsonRpcResponse(res).success, false);
});

// Test isJsonRpcErrorResponse validates error structure
Deno.test("isJsonRpcErrorResponse validates error structure", () => {
  const badError = {
    jsonrpc: "2.0",
    id: "1",
    error: { bad: true },
  };
  assertEquals(isJsonRpcErrorResponse(badError), false);

  const goodError = {
    jsonrpc: "2.0",
    id: "1",
    error: { code: -32600, message: "Invalid request" },
  };
  assertEquals(isJsonRpcErrorResponse(goodError), true);
});

// Test isGetFeedRequest validates params structure
Deno.test("isGetFeedRequest validates params structure", () => {
  const invalid = {
    jsonrpc: "2.0",
    id: "1",
    method: "get_feed",
    params: { wrong: "shape" },
  };
  assertEquals(isGetFeedRequest(invalid), false);

  const valid = {
    jsonrpc: "2.0",
    id: "1",
    method: "get_feed",
    params: { routeId: "latest", params: {} },
  };
  assertEquals(isGetFeedRequest(valid), true);
});
