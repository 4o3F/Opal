// @opal/example-plugin - JSON-RPC worker entry point
// Fetches posts from JSONPlaceholder API and returns as FeedDocument

import type {
  JsonRpcRequest,
  JsonRpcResponse,
  FeedDocument,
  FeedItem,
  GetFeedParams,
  GetStatusResult,
  ShutdownResult,
  RouteState,
} from "@opal/types";
import {
  createSuccessResponse,
  createErrorResponse,
  JsonRpcErrorCode,
  isJsonRpcRequest,
} from "@opal/types";

const STARTED_AT = new Date().toISOString();

interface JsonPlaceholderPost {
  id: number;
  userId: number;
  title: string;
  body: string;
}

interface JsonPlaceholderUser {
  id: number;
  name: string;
  email: string;
  website: string;
}

const routeStates: Map<string, RouteState> = new Map([
  ["latest", { routeId: "latest", status: "ready" }],
  ["by-user", { routeId: "by-user", status: "ready" }],
]);

function getStatus(): GetStatusResult {
  return {
    state: "ready",
    startedAt: STARTED_AT,
    routeStates: Array.from(routeStates.values()),
  };
}

async function getFeed(params: GetFeedParams): Promise<FeedDocument> {
  const { routeId, params: routeParams } = params;

  switch (routeId) {
    case "latest":
      return await fetchLatestPosts();
    case "by-user": {
      const userId = routeParams.userId;
      if (!userId) {
        throw new Error("Missing required parameter: userId");
      }
      return await fetchPostsByUser(userId);
    }
    default:
      throw new Error(`Unknown route: ${routeId}`);
  }
}

async function fetchLatestPosts(): Promise<FeedDocument> {
  const [postsRes, usersRes] = await Promise.all([
    fetch("https://jsonplaceholder.typicode.com/posts?_limit=10"),
    fetch("https://jsonplaceholder.typicode.com/users"),
  ]);

  if (!postsRes.ok) {
    throw new Error(`Failed to fetch posts: ${postsRes.status}`);
  }
  if (!usersRes.ok) {
    throw new Error(`Failed to fetch users: ${usersRes.status}`);
  }

  const posts: JsonPlaceholderPost[] = await postsRes.json();
  const users: JsonPlaceholderUser[] = await usersRes.json();
  const userMap = new Map(users.map((u) => [u.id, u]));

  const items: FeedItem[] = posts.map((post) => {
    const user = userMap.get(post.userId);
    return {
      id: String(post.id),
      url: `https://jsonplaceholder.typicode.com/posts/${post.id}`,
      title: post.title,
      contentText: post.body,
      authors: user
        ? [{ name: user.name, email: user.email, url: `https://${user.website}` }]
        : undefined,
    };
  });

  return {
    title: "JSONPlaceholder Latest Posts",
    description: "Latest posts from JSONPlaceholder API",
    homePageUrl: "https://jsonplaceholder.typicode.com",
    items,
  };
}

async function fetchPostsByUser(userId: string): Promise<FeedDocument> {
  const [postsRes, userRes] = await Promise.all([
    fetch(`https://jsonplaceholder.typicode.com/posts?userId=${userId}`),
    fetch(`https://jsonplaceholder.typicode.com/users/${userId}`),
  ]);

  if (!postsRes.ok) {
    throw new Error(`Failed to fetch posts: ${postsRes.status}`);
  }
  if (!userRes.ok) {
    throw new Error(`Failed to fetch user: ${userRes.status}`);
  }

  const posts: JsonPlaceholderPost[] = await postsRes.json();
  const user: JsonPlaceholderUser = await userRes.json();

  const items: FeedItem[] = posts.map((post) => ({
    id: String(post.id),
    url: `https://jsonplaceholder.typicode.com/posts/${post.id}`,
    title: post.title,
    contentText: post.body,
    authors: [{ name: user.name, email: user.email, url: `https://${user.website}` }],
  }));

  return {
    title: `Posts by ${user.name}`,
    description: `All posts from ${user.name}`,
    homePageUrl: `https://${user.website}`,
    items,
  };
}

function shutdown(): ShutdownResult {
  setTimeout(() => Deno.exit(0), 100);
  return { stoppedAt: new Date().toISOString() };
}

async function handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
  try {
    switch (request.method) {
      case "get_status":
        return createSuccessResponse(request.id, getStatus());

      case "get_feed": {
        const feed = await getFeed(request.params as GetFeedParams);
        return createSuccessResponse(request.id, feed);
      }

      case "shutdown":
        return createSuccessResponse(request.id, shutdown());

      default:
        return createErrorResponse(
          request.id,
          JsonRpcErrorCode.METHOD_NOT_FOUND,
          `Unknown method: ${(request as { method: string }).method}`
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return createErrorResponse(request.id, JsonRpcErrorCode.INTERNAL_ERROR, message);
  }
}

async function main() {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  for await (const chunk of Deno.stdin.readable) {
    buffer += decoder.decode(chunk, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (!line) continue;

      let response: JsonRpcResponse;

      try {
        const parsed = JSON.parse(line);

        if (!isJsonRpcRequest(parsed)) {
          response = createErrorResponse(
            null,
            JsonRpcErrorCode.INVALID_REQUEST,
            "Invalid JSON-RPC request"
          );
        } else {
          response = await handleRequest(parsed);
        }
      } catch {
        response = createErrorResponse(
          null,
          JsonRpcErrorCode.PARSE_ERROR,
          "Failed to parse JSON"
        );
      }

      await Deno.stdout.write(encoder.encode(JSON.stringify(response) + "\n"));
    }
  }
}

main();
