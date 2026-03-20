# Opal

A feed aggregation platform with plugin-based architecture. Create custom RSS/Atom/JSON Feed sources by running isolated plugin subprocesses that fetch, parse, and normalize data from external websites.

## Features

- **Plugin Isolation** - Plugins run as sandboxed Deno subprocesses with restricted permissions
- **Multiple Output Formats** - RSS 2.0, Atom 1.0, JSON Feed 1.1
- **Declarative Network Permissions** - Plugins declare allowed URLs/domains in manifest
- **JSON-RPC IPC** - Clean host-to-plugin communication over stdin/stdout
- **Docker Ready** - Multi-stage build with security hardening

## Architecture

```
Client → Host Web Server → Plugin Process → External Sources
              │                   │
              ├── Route Resolver  ├── Source fetcher
              ├── Process Manager ├── Parsing / extraction
              └── Feed Renderer   └── Normalization
```

## Quick Start

### Prerequisites

- [Deno](https://deno.land/) 2.0+
- [Docker](https://www.docker.com/) (optional)

### Development

```bash
# Clone repository
git clone https://github.com/4o3F/opal.git
cd opal

# Start development server
deno task dev

# Or run directly
deno run --allow-net --allow-read --allow-run=deno apps/host/src/main.ts
```

Server starts at `http://localhost:8080`

### Docker

```bash
# Production
docker compose --profile prod up --build

# Development (with hot reload)
docker compose --profile dev up --build
```

## Project Structure

```
opal/
├── apps/
│   └── host/                 # @opal/host - Web Server
│       └── src/
│           ├── api/          # Hono routes
│           ├── process/      # Plugin process manager
│           ├── renderer/     # Feed output (RSS/Atom/JSON)
│           ├── resolver/     # Route resolver
│           └── main.ts       # Entry point
├── packages/
│   └── types/                # @opal/types - Shared types
│       └── src/
│           ├── ipc.ts        # JSON-RPC protocol
│           ├── manifest.ts   # Plugin manifest
│           └── feed.ts       # Feed document types
├── plugins/
│   └── example-plugin/       # Example plugin
│       ├── manifest.json
│       └── src/main.ts
├── Dockerfile
├── docker-compose.yml
└── deno.json
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `GET /plugins` | List loaded plugins |
| `GET /feed/:plugin/:route` | Get feed (query: `format=rss\|atom\|jsonfeed`) |
| `POST /plugins/:name/reload` | Reload plugin |

### Example

```bash
# Get RSS feed
curl http://localhost:8080/feed/example-news/latest

# Get Atom feed
curl http://localhost:8080/feed/example-news/latest?format=atom

# Get JSON Feed
curl http://localhost:8080/feed/example-news/latest?format=jsonfeed
```

## Plugin Development

### Manifest Structure

Create `manifest.json` in your plugin directory:

```json
{
  "apiVersion": "feed-plugin/v1",
  "name": "my-plugin",
  "version": "1.0.0",
  "entrypoint": {
    "worker": "./src/main.ts"
  },
  "routes": [
    {
      "id": "latest",
      "path": "latest",
      "output": {
        "types": ["rss", "atom", "jsonfeed"],
        "defaultType": "rss"
      }
    }
  ],
  "network": {
    "allow": [
      { "kind": "origin", "value": "https://api.example.com" }
    ]
  }
}
```

### Worker Implementation

```typescript
import type { JsonRpcRequest, FeedDocument, GetFeedParams } from "@opal/types";
import { createSuccessResponse, createErrorResponse, JsonRpcErrorCode } from "@opal/types";

async function handleRequest(req: JsonRpcRequest) {
  switch (req.method) {
    case "get_status":
      return createSuccessResponse(req.id, {
        state: "ready",
        startedAt: new Date().toISOString(),
        routeStates: [],
      });

    case "get_feed":
      const feed = await fetchFeed(req.params as GetFeedParams);
      return createSuccessResponse(req.id, feed);

    case "shutdown":
      setTimeout(() => Deno.exit(0), 100);
      return createSuccessResponse(req.id, {
        stoppedAt: new Date().toISOString(),
      });

    default:
      return createErrorResponse(req.id, JsonRpcErrorCode.METHOD_NOT_FOUND, "Unknown method");
  }
}

async function fetchFeed(params: GetFeedParams): Promise<FeedDocument> {
  // Fetch and transform your data source
  return {
    title: "My Feed",
    items: [
      { id: "1", title: "First Post", contentText: "Hello World" },
    ],
  };
}

// Main loop: read JSON-RPC from stdin, write to stdout
const decoder = new TextDecoder();
const encoder = new TextEncoder();

for await (const chunk of Deno.stdin.readable) {
  const line = decoder.decode(chunk).trim();
  if (!line) continue;

  const request = JSON.parse(line);
  const response = await handleRequest(request);
  await Deno.stdout.write(encoder.encode(JSON.stringify(response) + "\n"));
}
```

### Network Allow Rules

| Kind | Example | Matches |
|------|---------|---------|
| `origin` | `https://api.example.com` | Exact origin |
| `hostSuffix` | `example.com` | `*.example.com` |
| `pathPrefix` | `{ origin, path: "/api" }` | Origin + path prefix |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPAL_PORT` | `8080` | HTTP server port |
| `OPAL_PLUGINS_DIR` | `./plugins` | Plugins directory |

### Docker Compose Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPAL_PORT` | `8080` | Production port |
| `OPAL_DEV_PORT` | `8080` | Development port |
| `OPAL_PLUGINS_DIR` | `./plugins` | Plugins mount path |

## Development

```bash
# Type check
deno check apps/host/src/mod.ts

# Lint
deno lint

# Format
deno fmt

# Run tests
deno test --allow-read --allow-net
```

## Security

Plugins run with minimal permissions:

| Permission | Status |
|------------|--------|
| `--allow-net` | Restricted to declared hosts |
| `--deny-read` | Blocked |
| `--deny-write` | Blocked |
| `--deny-run` | Blocked |
| `--deny-env` | Blocked |
| `--deny-ffi` | Blocked |

Docker production image includes:
- Read-only root filesystem
- No new privileges
- Resource limits (1 CPU, 512MB RAM)
- Health checks

## License

[GPL-3.0](LICENSE)
