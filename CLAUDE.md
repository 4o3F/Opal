# Opal

## Project Vision

Opal is a feed aggregation platform built on a plugin-based architecture. It enables users to create custom RSS/Atom/JSON Feed sources by running isolated plugin subprocesses that fetch, parse, and normalize data from external websites.

## Architecture Overview

```
Client --> Host Web Server --> Plugin Process --> External Sources
              |                     |
              +-- Route Resolver    +-- Source fetcher
              +-- Process Manager   +-- Parsing / extraction
              +-- Feed Renderer     +-- Normalization
                                    +-- In-memory cache
```

**Key Design Principles:**

1. **Poll-only communication** - Host polls plugin processes via JSON-RPC over stdin/stdout
2. **Plugin owns source access** - Each plugin declares allowed URLs/domains and performs its own HTTP fetches
3. **Isolated subprocesses** - Plugins run as Deno subprocesses with restricted permissions

## Tech Stack

| Component | Choice |
|-----------|--------|
| Runtime | Deno |
| Monorepo | Nx + pnpm |
| Web Framework | Hono |
| IPC Protocol | JSON-RPC 2.0 over stdio |

## Module Structure

```
opal/
├── apps/
│   └── host/              # @opal/host - Web Server + Process Manager
├── packages/
│   └── types/             # @opal/types - Shared type definitions
└── plugins/
    └── example-plugin/    # @opal/example-plugin
```

## Module Index

| Module | Status | Description |
|--------|--------|-------------|
| `@opal/types` | **Implemented** | IPC protocol, manifest, feed types |
| `@opal/host` | Planned | HTTP API, routing, process management, rendering |
| `@opal/example-plugin` | Planned | Example plugin implementation |

## Development Status

**Current Phase:** Implementation (Phase 2 complete)

- [x] Architecture design (`DESIGN.md`)
- [x] Monorepo setup (Deno + Nx + pnpm)
- [x] `@opal/types` - IPC protocol types
- [x] `@opal/types` - Plugin manifest types + validation
- [x] `@opal/types` - Feed document types
- [x] Security tests for type guards
- [ ] `@opal/host` - Hono API routes
- [ ] `@opal/host` - Route resolver
- [ ] `@opal/host` - Plugin process manager
- [ ] `@opal/host` - Feed renderer
- [ ] `@opal/example-plugin` - Example implementation

## Key Specifications

### Plugin Manifest

Plugins declare their capabilities via `PluginManifest`:

- `apiVersion`: "feed-plugin/v1"
- `name`, `version` (strict semver X.Y.Z)
- `entrypoint.worker`: relative path starting with "./"
- `routes[]`: exposed feed endpoints with id, path, paramsSchema, output formats
- `network.allow[]`: permitted URL patterns (origin/hostSuffix/pathPrefix)
- `defaults`: refreshIntervalMs, timeoutMs, staleThresholdMs

### IPC Protocol

Communication uses JSON-RPC 2.0 over stdin/stdout (line-delimited JSON).

**Methods:**
- `get_status` - Poll worker health and route states
- `get_feed` - Request normalized feed for a route
- `shutdown` - Graceful termination

**Response Types:**
- Success: `{ jsonrpc: "2.0", id, result }`
- Error: `{ jsonrpc: "2.0", id, error: { code, message } }`

### Feed Output

Supported formats: RSS, Atom, JSON Feed

`FeedDocument` contains: title, description, items with id/url/title/content/dates/authors/attachments

## Running and Development

```bash
# Type check
deno check packages/types/src/mod.ts

# Run tests
deno test packages/types/src/ --allow-read

# Lint
deno lint packages/types/src/
```

## Testing Strategy

- Unit tests for type guards and validators
- Security boundary tests (path traversal, whitelist bypass)
- Integration tests for IPC protocol

## Coding Conventions

- TypeScript with strict mode
- Deno runtime and tooling
- Type guards validate all untrusted input
- Security-critical functions have dedicated tests

## AI Usage Guidelines

When working with this codebase:

1. Refer to `DESIGN.md` for architecture decisions and type definitions
2. Use `@opal/types` for all shared types - do not duplicate
3. Validate manifests using `validateManifest()` + `isValidManifest()`
4. Use type-safe request constructors (`createGetStatusRequest`, etc.)
5. Network allow rules are security-critical - use `isUrlAllowed()` for validation

## Related Files

| File | Description |
|------|-------------|
| `DESIGN.md` | Architecture design, type definitions, protocol spec |
| `packages/types/src/` | Implemented type definitions and validators |
| `LICENSE` | GPL-3.0 license |

## Changelog

| Date | Change |
|------|--------|
| 2026-03-19 | Phase 2 complete: @opal/types implemented with security tests |
| 2026-03-19 | Phase 1 complete: Monorepo setup |
| 2026-03-19 | Initial CLAUDE.md generated from project scan |
