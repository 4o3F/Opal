# Opal Design Document

## High-Level Architecture

```
Client
  |
  v
+----------------------------------+
| Host Web Server (Deno)           |
| - HTTP API (Hono)                |
| - Route Resolver                 |
| - Plugin Process Manager         |
| - Feed Response Renderer         |
+----------------------------------+
          |
          | JSON-RPC 2.0 over stdin/stdout
          v
+----------------------------------+
| Plugin Process (Deno subprocess) |
| - Plugin route handler           |
| - Source fetcher                 |
| - Parsing / extraction           |
| - Normalization                  |
| - In-memory cache / last result  |
+----------------------------------+
          |
          | direct outbound HTTP
          v
     Declared source URLs only
```

## Principles

### Host-to-plugin communication is poll-only

The host should not assume it can push work into a plugin and get streaming callbacks or complex bidirectional orchestration.
When an HTTP request arrives, the host resolves the target plugin instance and polls that process for the current feed result.

### Plugin owns source access

The host should not fetch source data on behalf of plugins.
Each plugin should:

- declare which URLs or domains it needs
- perform its own HTTP fetches
- parse and normalize data itself
- store its own latest materialized result in memory

### Plugin isolation via subprocess

Plugins run as isolated Deno subprocesses with restricted permissions:

- Network access limited to declared hosts via `--allow-net`
- No filesystem access (`--deny-read`, `--deny-write`)
- No subprocess spawning (`--deny-run`)
- No environment access (`--deny-env`)
- No FFI access (`--deny-ffi`)

## Plugin Manifest

```typescript
export const API_VERSION = "feed-plugin/v1" as const;

export type PluginManifest = {
  apiVersion: typeof API_VERSION;
  name: string;
  version: string; // strict semver: X.Y.Z
  description?: string;
  author?: string;
  homepage?: string;

  entrypoint: {
    worker: string; // relative path starting with "./" (no path traversal)
  };

  routes: [PluginRouteManifest, ...PluginRouteManifest[]]; // at least one

  network: {
    allow: NetworkAllowRule[];
  };

  defaults?: {
    refreshIntervalMs?: number;
    timeoutMs?: number;
    staleThresholdMs?: number;
  };
};

export type PluginRouteManifest = {
  id: string; // stable internal route id, must be unique
  path: string; // public route segment, must be unique
  description?: string;
  paramsSchema?: Record<string, ParamSchema>;
  output: {
    types: [FeedFormat, ...FeedFormat[]]; // at least one
    defaultType?: FeedFormat; // must be in types array
  };
};

export type FeedFormat = "rss" | "atom" | "jsonfeed";

// Network allow rules with origin-based semantics
export type NetworkAllowRule =
  | { kind: "origin"; value: string }      // exact origin match
  | { kind: "hostSuffix"; value: string }  // domain suffix (e.g., "example.com" matches "api.example.com")
  | { kind: "pathPrefix"; origin: string; path: string }; // origin + path prefix

// Route parameter schema - discriminated union by type
export type ParamSchema =
  | { type: "string"; description?: string; default?: string; enum?: string[]; pattern?: string }
  | { type: "number"; description?: string; default?: number; enum?: number[] }
  | { type: "boolean"; description?: string; default?: boolean };
```

### Network Allow Rule Semantics

| Rule Kind | Example | Matches | Does NOT Match |
|-----------|---------|---------|----------------|
| `origin` | `https://api.example.com` | `https://api.example.com/users` | `https://example.com/api` |
| `hostSuffix` | `example.com` | `example.com`, `api.example.com` | `evil-example.com` |
| `pathPrefix` | `origin: https://api.example.com, path: /v1` | `/v1`, `/v1/`, `/v1/users` | `/v1beta`, `/v2` |

### Example Manifest

```json
{
  "apiVersion": "feed-plugin/v1",
  "name": "example-news",
  "version": "0.1.0",
  "description": "Produces feeds from Example News.",
  "entrypoint": {
    "worker": "./src/main.ts"
  },
  "routes": [
    {
      "id": "latest",
      "path": "latest",
      "description": "Latest news",
      "output": {
        "types": ["rss", "atom", "jsonfeed"],
        "defaultType": "rss"
      }
    },
    {
      "id": "topic",
      "path": "topic",
      "description": "Topic feed",
      "paramsSchema": {
        "name": {
          "type": "string",
          "pattern": "^[a-z0-9-]+$"
        }
      },
      "output": {
        "types": ["rss", "atom", "jsonfeed"]
      }
    }
  ],
  "network": {
    "allow": [
      { "kind": "origin", "value": "https://api.example.com" },
      { "kind": "hostSuffix", "value": "cdn.example.com" }
    ]
  },
  "defaults": {
    "refreshIntervalMs": 300000,
    "timeoutMs": 10000,
    "staleThresholdMs": 900000
  }
}
```

### Manifest Validation Rules

Required fields:
- `apiVersion` must be `"feed-plugin/v1"`
- `name` must be non-empty string
- `version` must be strict semver (`X.Y.Z`)
- `entrypoint.worker` must be relative path starting with `./` without path traversal
- At least one route
- Each route must have unique `id` and `path`
- Each route must have at least one output type
- `defaultType` must be one of the declared types

Security validations:
- `hostSuffix` value must be non-empty, no scheme or path
- `pathPrefix` path must start with `/`
- Worker path cannot contain `..` (path traversal)

## IPC Protocol Between Host and Plugin

### Transport

JSON-RPC 2.0 over stdin/stdout. Each message is a single JSON line terminated by `\n`.

### Message Types

```typescript
export const JSON_RPC_VERSION = "2.0" as const;

export type JsonRpcMethod = "get_status" | "get_feed" | "shutdown";

// Request
export type JsonRpcRequest<M extends JsonRpcMethod> = {
  jsonrpc: "2.0";
  id: string;
  method: M;
  params: MethodParamsMap[M];
};

// Success response
export type JsonRpcSuccessResponse<R> = {
  jsonrpc: "2.0";
  id: string;
  result: R;
};

// Error response
export type JsonRpcErrorResponse = {
  jsonrpc: "2.0";
  id: string | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};
```

### Error Codes

| Code | Name | Description |
|------|------|-------------|
| -32700 | PARSE_ERROR | Invalid JSON |
| -32600 | INVALID_REQUEST | Invalid request structure |
| -32601 | METHOD_NOT_FOUND | Unknown method |
| -32602 | INVALID_PARAMS | Invalid parameters |
| -32603 | INTERNAL_ERROR | Internal error |
| -32001 | PLUGIN_NOT_READY | Plugin not ready |
| -32002 | ROUTE_NOT_FOUND | Route not found |
| -32003 | FETCH_FAILED | Upstream fetch failed |
| -32004 | TIMEOUT | Operation timed out |

### Host → Plugin

#### `get_status`

Polls current worker health and route state.

```typescript
// Request
{ jsonrpc: "2.0", id: "1", method: "get_status", params: {} }

// Response
{
  jsonrpc: "2.0",
  id: "1",
  result: {
    state: "starting" | "ready" | "degraded" | "error" | "stopped",
    startedAt: "2024-01-01T00:00:00Z",
    routeStates: [
      {
        routeId: "latest",
        status: "ready" | "stale" | "warming" | "error",
        lastUpdated?: "2024-01-01T00:00:00Z",
        errorMessage?: "..."
      }
    ]
  }
}
```

#### `get_feed`

Requests the latest normalized feed document for a route.

```typescript
// Request
{
  jsonrpc: "2.0",
  id: "2",
  method: "get_feed",
  params: {
    routeId: "latest",
    params: { "name": "technology" }
  }
}

// Response
{
  jsonrpc: "2.0",
  id: "2",
  result: {
    title: "Example News - Technology",
    description: "Latest technology news",
    items: [
      {
        id: "123",
        title: "Article Title",
        url: "https://example.com/article/123",
        contentText: "...",
        datePublished: "2024-01-01T12:00:00Z"
      }
    ]
  }
}
```

#### `shutdown`

Requests graceful shutdown.

```typescript
// Request
{ jsonrpc: "2.0", id: "3", method: "shutdown", params: {} }

// Response
{ jsonrpc: "2.0", id: "3", result: { stoppedAt: "2024-01-01T00:00:00Z" } }
```

## FeedDocument Schema

```typescript
export type FeedDocument = {
  title: string;
  description?: string;
  homePageUrl?: string;
  feedUrl?: string;
  icon?: string;
  favicon?: string;
  authors?: FeedAuthor[];
  language?: string;
  items: FeedItem[];
};

export type FeedItem = {
  id: string;
  url?: string;
  title: string;
  contentHtml?: string;
  contentText?: string;
  summary?: string;
  image?: string;
  datePublished?: string; // ISO 8601
  dateModified?: string;  // ISO 8601
  authors?: FeedAuthor[];
  tags?: string[];
  attachments?: FeedAttachment[];
  language?: string;
};

export type FeedAuthor = {
  name: string;
  url?: string;
  email?: string;
};

export type FeedAttachment = {
  url: string;
  mimeType: string;
  sizeBytes?: number;
  title?: string;
  durationSeconds?: number;
};
```

## Life Cycle

### Startup

1. Host loads plugin manifest from `manifest.json`
2. Host validates manifest structure and security rules
3. Host spawns plugin as Deno subprocess with restricted permissions
4. Plugin initializes and listens on stdin
5. Host polls `get_status` until state becomes `ready`

### Request Serving

1. HTTP request arrives at host
2. Host resolves plugin and route from URL
3. Host validates input against route's paramsSchema
4. Host sends `get_feed` request via stdin
5. Plugin responds with FeedDocument
6. Host renders response in requested format (RSS/Atom/JSON Feed)

### Shutdown

1. Host sends `shutdown` request
2. Plugin stops internal work and responds
3. Host terminates subprocess if needed

## Security Model

### Trust Boundary

```
┌─────────────────────────────────────────────────────────────┐
│ Docker Container                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Host Process (Deno) - TRUSTED                       │   │
│  │  - Full permissions                                 │   │
│  │  - Controls plugin lifecycle                        │   │
│  │  - Enforces network policy                          │   │
│  └──────────────┬──────────────────────────────────────┘   │
│                 │ spawn subprocess                          │
│  ┌──────────────▼──────────────────────────────────────┐   │
│  │ Plugin Process (Deno) - UNTRUSTED                   │   │
│  │  --allow-net=<declared hosts only>                  │   │
│  │  --deny-read --deny-write --deny-run                │   │
│  │  --deny-env --deny-ffi                              │   │
│  │  stdin/stdout JSON-RPC only                         │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Security Invariants

1. Plugin cannot read/write filesystem
2. Plugin cannot spawn subprocesses
3. Plugin cannot access environment variables
4. Plugin network access limited to declared hosts
5. Plugin can only communicate via JSON-RPC over stdio
6. Host validates all manifest paths to prevent traversal
