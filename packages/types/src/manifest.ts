// Plugin manifest schema types

import { z } from "zod";
import { FeedFormatSchema } from "./feed.ts";

export const API_VERSION = "feed-plugin/v1" as const;

// Regex patterns
const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;
const PATH_TRAVERSAL_REGEX = /(?:^|[/\\])\.\.[/\\]?/;

// Validate origin value (must be clean origin without path/query/fragment)
function isValidOriginValue(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

// Normalize host suffix (strip leading dots, lowercase)
function normalizeHostSuffix(value: string): string {
  return value.replace(/^\.+/, "").toLowerCase();
}

// Manifest validation error (backward compatible)
export type ManifestValidationError = {
  path: string;
  message: string;
  severity: "error" | "warning";
};

// Security function: Check if worker path is safe
export function isWorkerPathSafe(workerPath: string): boolean {
  if (!workerPath.startsWith("./")) {
    return false;
  }
  if (PATH_TRAVERSAL_REGEX.test(workerPath)) {
    return false;
  }
  return true;
}

// Security function: Check if URL is allowed by rules
export function isUrlAllowed(url: URL, rules: NetworkAllowRule[]): boolean {
  for (const rule of rules) {
    switch (rule.kind) {
      case "origin": {
        try {
          const allowed = new URL(rule.value);
          if (url.origin === allowed.origin) {
            return true;
          }
        } catch {
          // Invalid rule, skip
        }
        break;
      }
      case "hostSuffix": {
        const suffix = normalizeHostSuffix(rule.value);
        if (
          suffix.length > 0 &&
          (url.hostname.toLowerCase() === suffix ||
            url.hostname.toLowerCase().endsWith("." + suffix))
        ) {
          return true;
        }
        break;
      }
      case "pathPrefix": {
        try {
          const allowed = new URL(rule.origin);
          if (url.origin !== allowed.origin) {
            break;
          }
          // Path segment boundary matching
          const rulePath = rule.path.endsWith("/") ? rule.path.slice(0, -1) : rule.path;
          if (
            url.pathname === rulePath ||
            url.pathname === rulePath + "/" ||
            url.pathname.startsWith(rulePath + "/")
          ) {
            return true;
          }
        } catch {
          // Invalid rule, skip
        }
        break;
      }
    }
  }
  return false;
}

// Network allow rule schemas
const OriginRuleSchema = z.object({
  kind: z.literal("origin"),
  value: z.string().min(1).refine(isValidOriginValue, {
    message: "Must be a valid origin URL (no path, query, or fragment)",
  }),
});

const HostSuffixRuleSchema = z.object({
  kind: z.literal("hostSuffix"),
  value: z.string().min(1).refine(
    (val) => normalizeHostSuffix(val).length > 0 && !val.includes("/") && !val.includes(":"),
    { message: "Must be a hostname without scheme or path" }
  ),
});

const PathPrefixRuleSchema = z.object({
  kind: z.literal("pathPrefix"),
  origin: z.string().min(1).refine(isValidOriginValue, {
    message: "Must be a valid origin URL (no path, query, or fragment)",
  }),
  path: z.string().startsWith("/", { message: "Must be a string starting with /" }),
});

export const NetworkAllowRuleSchema = z.discriminatedUnion("kind", [
  OriginRuleSchema,
  HostSuffixRuleSchema,
  PathPrefixRuleSchema,
]);
export type NetworkAllowRule =
  | { kind: "origin"; value: string }
  | { kind: "hostSuffix"; value: string }
  | { kind: "pathPrefix"; origin: string; path: string };

// Route parameter schemas
const ParamSchemaStringSchema = z.object({
  type: z.literal("string"),
  description: z.string().optional(),
  default: z.string().optional(),
  enum: z.array(z.string()).optional(),
  pattern: z.string().optional(),
});

const ParamSchemaNumberSchema = z.object({
  type: z.literal("number"),
  description: z.string().optional(),
  default: z.number().optional(),
  enum: z.array(z.number()).optional(),
});

const ParamSchemaBooleanSchema = z.object({
  type: z.literal("boolean"),
  description: z.string().optional(),
  default: z.boolean().optional(),
});

export const ParamSchemaSchema = z.discriminatedUnion("type", [
  ParamSchemaStringSchema,
  ParamSchemaNumberSchema,
  ParamSchemaBooleanSchema,
]);

export type ParamSchemaString = {
  type: "string";
  description?: string;
  default?: string;
  enum?: string[];
  pattern?: string;
};

export type ParamSchemaNumber = {
  type: "number";
  description?: string;
  default?: number;
  enum?: number[];
};

export type ParamSchemaBoolean = {
  type: "boolean";
  description?: string;
  default?: boolean;
};

export type ParamSchema = ParamSchemaString | ParamSchemaNumber | ParamSchemaBoolean;

// Route output schema
const PluginRouteOutputSchema = z.object({
  types: z.array(FeedFormatSchema).min(1),
  defaultType: FeedFormatSchema.optional(),
}).refine(
  (output) => output.defaultType === undefined || output.types.includes(output.defaultType),
  { message: "defaultType must be one of the declared types", path: ["defaultType"] }
);

// Route manifest schema
export const PluginRouteManifestSchema = z.object({
  id: z.string().min(1),
  path: z.string(),
  description: z.string().optional(),
  paramsSchema: z.record(ParamSchemaSchema).optional(),
  output: PluginRouteOutputSchema,
});

export type PluginRouteManifest = z.infer<typeof PluginRouteManifestSchema>;

// Plugin defaults schema
export const PluginDefaultsSchema = z.object({
  refreshIntervalMs: z.number().optional(),
  timeoutMs: z.number().optional(),
  staleThresholdMs: z.number().optional(),
});

export type PluginDefaults = z.infer<typeof PluginDefaultsSchema>;

// Plugin manifest schema
export const PluginManifestSchema = z.object({
  apiVersion: z.literal(API_VERSION),
  name: z.string().min(1),
  version: z.string().regex(SEMVER_REGEX, { message: "Must be a semver string (X.Y.Z)" }),
  description: z.string().optional(),
  author: z.string().optional(),
  homepage: z.string().optional(),
  entrypoint: z.object({
    worker: z.string().min(1).refine(isWorkerPathSafe, {
      message: 'Must be a relative path starting with "./" without path traversal',
    }),
  }),
  routes: z.array(PluginRouteManifestSchema).min(1),
  network: z.object({
    allow: z.array(NetworkAllowRuleSchema),
  }),
  defaults: PluginDefaultsSchema.optional(),
}).superRefine((manifest, ctx) => {
  // Check for duplicate route ids
  const routeIds = new Set<string>();
  const routePaths = new Set<string>();

  manifest.routes.forEach((route, index) => {
    if (routeIds.has(route.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["routes", index, "id"],
        message: `Duplicate route id "${route.id}"`,
      });
    } else {
      routeIds.add(route.id);
    }

    if (routePaths.has(route.path)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["routes", index, "path"],
        message: `Duplicate route path "${route.path}"`,
      });
    } else {
      routePaths.add(route.path);
    }
  });
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

// Convert Zod issue path to string
function formatIssuePath(path: (string | number)[]): string {
  return path.reduce<string>((acc, part) => {
    if (typeof part === "number") {
      return `${acc}[${part}]`;
    }
    return acc.length === 0 ? part : `${acc}.${part}`;
  }, "");
}

// Validate manifest (backward compatible API)
export function validateManifest(manifest: unknown): ManifestValidationError[] {
  const result = PluginManifestSchema.safeParse(manifest);
  if (result.success) {
    return [];
  }

  return result.error.issues.map((issue) => ({
    path: formatIssuePath(issue.path),
    message: issue.message,
    severity: "error" as const,
  }));
}

// Type guard for validated manifest
export function isValidManifest(manifest: unknown): manifest is PluginManifest {
  return PluginManifestSchema.safeParse(manifest).success;
}

// Convert NetworkAllowRule[] to Deno --allow-net hosts
export function toDenoNetPermissions(rules: NetworkAllowRule[]): string[] {
  const hosts = new Set<string>();

  for (const rule of rules) {
    switch (rule.kind) {
      case "origin": {
        try {
          const url = new URL(rule.value);
          hosts.add(url.host);
        } catch {
          // Invalid URL, skip
        }
        break;
      }
      case "hostSuffix": {
        const suffix = normalizeHostSuffix(rule.value);
        if (suffix.length > 0) {
          hosts.add(suffix);
        }
        break;
      }
      case "pathPrefix": {
        try {
          const url = new URL(rule.origin);
          hosts.add(url.host);
        } catch {
          // Invalid URL, skip
        }
        break;
      }
    }
  }

  return Array.from(hosts);
}

// Parse functions
export function parsePluginManifest(value: unknown): PluginManifest {
  return PluginManifestSchema.parse(value) as PluginManifest;
}

export function safeParsePluginManifest(value: unknown) {
  return PluginManifestSchema.safeParse(value);
}

export function parseNetworkAllowRule(value: unknown): NetworkAllowRule {
  return NetworkAllowRuleSchema.parse(value);
}

export function safeParseNetworkAllowRule(value: unknown) {
  return NetworkAllowRuleSchema.safeParse(value);
}
