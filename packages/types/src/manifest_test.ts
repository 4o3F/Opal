import { assertEquals } from "@std/assert";
import {
  isUrlAllowed,
  isWorkerPathSafe,
  validateManifest,
  API_VERSION,
} from "./manifest.ts";

// Test hostSuffix bypass fix
Deno.test("hostSuffix rejects subdomain spoofing", () => {
  const rules = [{ kind: "hostSuffix" as const, value: "example.com" }];

  // Should reject: evil-example.com is not a subdomain of example.com
  assertEquals(isUrlAllowed(new URL("https://evil-example.com/"), rules), false);

  // Should accept: exact match
  assertEquals(isUrlAllowed(new URL("https://example.com/"), rules), true);

  // Should accept: proper subdomain
  assertEquals(isUrlAllowed(new URL("https://api.example.com/"), rules), true);
  assertEquals(isUrlAllowed(new URL("https://sub.api.example.com/"), rules), true);
});

Deno.test("hostSuffix rejects empty value", () => {
  const rules = [{ kind: "hostSuffix" as const, value: "" }];

  // Empty suffix should not match anything
  assertEquals(isUrlAllowed(new URL("https://any-site.com/"), rules), false);
});

// Test pathPrefix bypass fix
Deno.test("pathPrefix uses segment boundary matching", () => {
  const rules = [{
    kind: "pathPrefix" as const,
    origin: "https://api.example.com",
    path: "/api",
  }];

  // Should reject: /apiv2 is not under /api/
  assertEquals(isUrlAllowed(new URL("https://api.example.com/apiv2"), rules), false);
  assertEquals(isUrlAllowed(new URL("https://api.example.com/api-private"), rules), false);

  // Should accept: exact match and proper subpaths
  assertEquals(isUrlAllowed(new URL("https://api.example.com/api"), rules), true);
  assertEquals(isUrlAllowed(new URL("https://api.example.com/api/"), rules), true);
  assertEquals(isUrlAllowed(new URL("https://api.example.com/api/users"), rules), true);
});

// Test entrypoint.worker path traversal fix
Deno.test("isWorkerPathSafe rejects path traversal", () => {
  // Should reject: path traversal attempts
  assertEquals(isWorkerPathSafe("../worker.ts"), false);
  assertEquals(isWorkerPathSafe("./../../worker.ts"), false);
  assertEquals(isWorkerPathSafe("./foo/../../../bar.ts"), false);

  // Should reject: absolute paths
  assertEquals(isWorkerPathSafe("/etc/passwd"), false);
  assertEquals(isWorkerPathSafe("worker.ts"), false);

  // Should accept: valid relative paths
  assertEquals(isWorkerPathSafe("./worker.ts"), true);
  assertEquals(isWorkerPathSafe("./src/main.ts"), true);
  assertEquals(isWorkerPathSafe("./foo/bar/baz.ts"), true);
});

// Test validateManifest completeness
Deno.test("validateManifest rejects invalid worker paths", () => {
  const manifest = {
    apiVersion: API_VERSION,
    name: "test",
    version: "1.0.0",
    entrypoint: { worker: "../../escape.ts" },
    routes: [{ id: "r1", path: "/", output: { types: ["rss"] } }],
    network: { allow: [] },
  };

  const errors = validateManifest(manifest);
  const workerError = errors.find((e) => e.path === "entrypoint.worker");
  assertEquals(workerError !== undefined, true);
});

Deno.test("validateManifest rejects invalid version format", () => {
  const manifest = {
    apiVersion: API_VERSION,
    name: "test",
    version: "1.0.0-beta",
    entrypoint: { worker: "./main.ts" },
    routes: [{ id: "r1", path: "/", output: { types: ["rss"] } }],
    network: { allow: [] },
  };

  const errors = validateManifest(manifest);
  const versionError = errors.find((e) => e.path === "version");
  assertEquals(versionError !== undefined, true);
});

Deno.test("validateManifest rejects invalid feed formats", () => {
  const manifest = {
    apiVersion: API_VERSION,
    name: "test",
    version: "1.0.0",
    entrypoint: { worker: "./main.ts" },
    routes: [{ id: "r1", path: "/", output: { types: ["bogus"] } }],
    network: { allow: [] },
  };

  const errors = validateManifest(manifest);
  const formatError = errors.find((e) => e.path.includes("output.types"));
  assertEquals(formatError !== undefined, true);
});

Deno.test("validateManifest rejects duplicate route ids", () => {
  const manifest = {
    apiVersion: API_VERSION,
    name: "test",
    version: "1.0.0",
    entrypoint: { worker: "./main.ts" },
    routes: [
      { id: "r1", path: "/a", output: { types: ["rss"] } },
      { id: "r1", path: "/b", output: { types: ["rss"] } },
    ],
    network: { allow: [] },
  };

  const errors = validateManifest(manifest);
  const dupError = errors.find((e) => e.message.includes("Duplicate route id"));
  assertEquals(dupError !== undefined, true);
});

Deno.test("validateManifest rejects empty hostSuffix", () => {
  const manifest = {
    apiVersion: API_VERSION,
    name: "test",
    version: "1.0.0",
    entrypoint: { worker: "./main.ts" },
    routes: [{ id: "r1", path: "/", output: { types: ["rss"] } }],
    network: { allow: [{ kind: "hostSuffix", value: "" }] },
  };

  const errors = validateManifest(manifest);
  const ruleError = errors.find((e) => e.path.includes("network.allow"));
  assertEquals(ruleError !== undefined, true);
});

Deno.test("validateManifest rejects origin rules with path or query", () => {
  const manifest = {
    apiVersion: API_VERSION,
    name: "test",
    version: "1.0.0",
    entrypoint: { worker: "./main.ts" },
    routes: [{ id: "r1", path: "/", output: { types: ["rss"] } }],
    network: { allow: [{ kind: "origin", value: "https://example.com/private?x=1" }] },
  };

  const errors = validateManifest(manifest);
  const originError = errors.find((e) => e.path === "network.allow[0].value");
  assertEquals(originError !== undefined, true);
});

Deno.test("hostSuffix normalizes leading dot notation", () => {
  const rules = [{ kind: "hostSuffix" as const, value: ".example.com" }];

  assertEquals(isUrlAllowed(new URL("https://api.example.com/"), rules), true);
  assertEquals(isUrlAllowed(new URL("https://sub.api.example.com/"), rules), true);
});
