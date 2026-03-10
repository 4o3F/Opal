## High-Level Architecture

```
Client
  |
  v
+----------------------------------+
| Host Web Server                  |
| - HTTP API                       |
| - Route Resolver                 |
| - Plugin Instance Registry       |
| - Worker Manager                 |
| - Feed Response Renderer         |
+----------------------------------+
          |
          | poll over MessagePort
          v
+----------------------------------+
| Plugin Instance Worker           |
| - Plugin route handler           |
| - Source fetcher                 |
| - Parsing / extraction           |
| - Normalization                  |
| - In-memory cache / last result  |
| - Optional self-refresh loop     |
+----------------------------------+
          |
          | direct outbound HTTP
          v
     Declared source URLs only
```

## Principles

### Host-to-plugin communication is poll-only

The host should not assume it can push work into a plugin and get streaming callbacks or complex bidirectional orchestration.
When an HTTP request arrives, the host resolves the target plugin instance and polls that worker for the current feed result.

### Plugin owns source access

The host should not fetch source data on behalf of plugins.
Each plugin should:

- declares which URLs or domains it needs
- performs its own HTTP fetches
- parses and normalizes data itself
- stores its own latest materialized result in memory

## Plugin Manifest

```typescript
export type PluginManifest = {
  apiVersion: "feed-plugin/v1";

  name: string;
  version: string;
  description?: string;

  entrypoint: {
    worker: string; // relative path inside plugin bundle, e.g. "./worker.js"
  };

  routes: PluginRouteManifest[];

  network: {
    allow: NetworkAllowRule[];
  };

  defaults?: {
    refreshIntervalSec?: number; // default plugin refresh cadence
    requestTimeoutMs?: number; // default upstream request timeout inside plugin
    staleAfterSec?: number; // when cached result becomes stale
  };
};

export type PluginRouteManifest = {
  id: string; // stable internal route id, e.g. "latest"
  path: string; // public route segment, e.g. "latest" or "tag/:name"
  title?: string;
  description?: string;

  paramsSchema?: JsonSchemaLite; // route input contract
  refreshIntervalSec?: number; // override plugin default
  staleAfterSec?: number; // override plugin default

  output: {
    types: Array<"rss" | "atom" | "jsonfeed">;
  };
};

export type NetworkAllowRule = {
  kind: "suffix" | "prefix" | "exact";
  value: string;
};

export type JsonSchemaLite = {
  type: "object";
  properties?: Record<string, JsonSchemaLiteProperty>;
  required?: string[];
  additionalProperties?: boolean;
};

export type JsonSchemaLiteProperty = {
  type: "string" | "number" | "integer" | "boolean";
  enum?: Array<string | number | boolean>;
  pattern?: string;
  minimum?: number;
  maximum?: number;
};
```

An example.

```json
{
  "apiVersion": "feed-plugin/v1",
  "name": "example-news",
  "version": "0.1.0",
  "description": "Produces feeds from Example News.",
  "entrypoint": {
    "worker": "./worker.js"
  },
  "routes": [
    {
      "id": "latest",
      "path": "latest",
      "title": "Latest news",
      "output": {
        "types": ["rss", "atom", "jsonfeed"]
      },
      "refreshIntervalSec": 300,
      "staleAfterSec": 900
    },
    {
      "id": "topic",
      "path": "topic",
      "title": "Topic feed",
      "paramsSchema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "pattern": "^[a-z0-9-]+$"
          }
        },
        "required": ["name"],
        "additionalProperties": false
      },
      "output": {
        "types": ["rss", "atom", "jsonfeed"]
      },
      "refreshIntervalSec": 300,
      "staleAfterSec": 900
    }
  ],
  "network": {
    "allow": [
      { "kind": "suffix", "value": "https://example.com" },
      { "kind": "suffix", "value": "https://api.example.com" }
    ]
  },
  "defaults": {
    "refreshIntervalSec": 300,
    "requestTimeoutMs": 10000,
    "staleAfterSec": 900
  }
}
```

Required:

- apiVersion
- name
- version
- entrypoint.worker
- at least one route
- network.allow with at least one allow rule
- each route must have unique id
- each route must have unique path

## IPC Protocol Between Host and Plugin

### Transport

Transport using `MessagePort`, while messages must be structured-clone-safe and plain JSON-like objects.

### Principles

- The plugin must not push refresh results, events, or logs through the main control channel unless they are direct replies.
- Every request has an `id`. Every response echoes the same `id`.
- A request gets exactly one terminal response.
- Use a protocol version in every message.

### Envelope Definitions

```typescript
export type IpcEnvelope = HostRequest | PluginResponse;

type BaseEnvelope = {
  protocol: "feed-ipc/v1";
  id: string;
};

export type HostRequest = GetStatusRequest | GetFeedRequest | ShutdownRequest;

export type PluginResponse =
  | GetStatusResponse
  | GetFeedResponse
  | ShutdownResponse
  | ErrorResponse;
```

### Host2Plugin

#### `get_status` request

Polls current worker health and route state.

```typescript
export type GetStatusRequest = BaseEnvelope & {
  kind: "request";
  method: "get_status";
  params: {};
};
```

#### `get_feed` request

Requests the latest normalized feed document for a route.

```typescript
export type GetFeedRequest = BaseEnvelope & {
  kind: "request";
  method: "get_feed";
  params: {
    routeId: string;
    input: Record<string, string | number | boolean | null>;
  };
};
```

- routeId should match a route declared in the manifest already loaded by the host.
- input should already be parsed by the host.
- The host may also validate input against the manifest route schema before sending.

#### `shutdown` request

Requests graceful shutdown.

```typescript
export type ShutdownRequest = BaseEnvelope & {
  kind: "request";
  method: "shutdown";
  params: {
    reason?: string;
  };
};
```

### Plugin2Host

#### `get_status` response

```typescript
export type GetStatusResponse = BaseEnvelope & {
  kind: "response";
  method: "get_status";
  ok: true;
  result: {
    state: "starting" | "ready" | "degraded" | "error" | "stopped";
    startedAt: string;
    routeStates: Array<{
      routeId: string;
      status: "empty" | "ready" | "stale" | "refreshing" | "error";
      updatedAt?: string;
      itemCount?: number;
      lastError?: PluginError;
    }>;
    lastError?: PluginError;
  };
};
```

#### `get_feed` response

```typescript
export type GetFeedResponse = BaseEnvelope & {
  kind: "response";
  method: "get_feed";
  ok: true;
  result:
    | {
        status: "ready" | "stale";
        updatedAt: string;
        document: FeedDocument;
      }
    | {
        status: "warming";
      };
};
```

#### `shutdown` response

```typescript
export type ShutdownResponse = BaseEnvelope & {
  kind: "response";
  method: "shutdown";
  ok: true;
  result: {
    stoppedAt: string;
  };
};
```

### Generic Error Response

```typescript
export type ErrorResponse = BaseEnvelope & {
  kind: "response";
  ok: false;
  error: PluginError;
};

export type PluginError = {
  code:
    | "BAD_REQUEST"
    | "UNKNOWN_METHOD"
    | "ROUTE_NOT_FOUND"
    | "INVALID_INPUT"
    | "NOT_READY"
    | "UPSTREAM_ERROR"
    | "INTERNAL_ERROR";

  message: string;
  retriable?: boolean;
  details?: Record<string, unknown>;
};
```

### FeedDocument shared type

```typescript
export type FeedDocument = {
  title: string;
  homePageUrl?: string;
  feedUrl?: string;
  description?: string;
  language?: string;
  updatedAt?: string;
  items: FeedItem[];
};

export type FeedItem = {
  id: string;
  url?: string;
  title: string;
  contentHtml?: string;
  contentText?: string;
  summary?: string;
  publishedAt?: string;
  updatedAt?: string;
  authors?: Array<{
    name: string;
    url?: string;
  }>;
};
```

## Life Cycle
### Startup
1. Host loads plugin bundle
2. Host reads and validates manifest
3. Host applies permission/network policy
4. Host starts worker with startup data
5. Worker initializes its own internal state
6. Host may poll get_status until route state becomes usable

### Request serving
1. HTTP request hits host
2. Host resolves route from already-loaded manifest
3. Host validates input
4. Host sends get_feed
5. Plugin responds with ready, stale, or warming
6. Host renders response format

### Shutdown
1. Host sends shutdown
2. Plugin stops timers and internal work
3. Plugin replies
4. Host terminates worker if needed
