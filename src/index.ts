#!/usr/bin/env node
/**
 * multipov-mcp-server — stdio-to-HTTP proxy for the hosted multipov.ai MCP server.
 *
 * This package is a thin client-side shim: it speaks MCP over stdio to your
 * local client (Claude Code, Claude Desktop, Cursor, etc.) and forwards every
 * request to the hosted streamable-HTTP endpoint at https://multipov.ai/mcp,
 * authenticated with your personal API key.
 *
 * All business logic — the persona catalog, the review engine, rewrites, etc.
 * — lives server-side. This process only proxies. No telemetry, no caching,
 * no local state.
 *
 * Configuration:
 *   MULTIPOV_API_KEY   required — get one at https://multipov.ai/settings/api-keys
 *   MULTIPOV_BASE_URL  optional — defaults to https://multipov.ai
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { describeUpstreamError as describeUpstreamErrorRaw } from "./upstream-error.js";

const PACKAGE_NAME = "multipov-mcp-server";
const PACKAGE_VERSION = "0.1.2";

// ---------------------------------------------------------------------------
// Config & startup validation
// ---------------------------------------------------------------------------

const API_KEY = process.env.MULTIPOV_API_KEY;
const BASE_URL = (process.env.MULTIPOV_BASE_URL ?? "https://multipov.ai").replace(/\/+$/, "");

function fatal(msg: string): never {
  process.stderr.write(`[${PACKAGE_NAME}] FATAL: ${msg}\n`);
  process.exit(1);
}

if (!API_KEY) {
  fatal(
    "MULTIPOV_API_KEY is required.\n" +
      "         Get one at https://multipov.ai/settings/api-keys\n" +
      "         Then pass it via the env:\n" +
      "           claude mcp add multipov npx -y multipov-mcp-server --env MULTIPOV_API_KEY=mpov_live_...",
  );
}
if (!/^mpov_(live|test)_[A-Za-z0-9]+$/.test(API_KEY)) {
  // Don't hard-fail — some future key format may not match — just warn.
  process.stderr.write(
    `[${PACKAGE_NAME}] warning: MULTIPOV_API_KEY doesn't look like an mpov_live_... token; continuing anyway.\n`,
  );
}

const REMOTE_URL = `${BASE_URL}/mcp`;

// ---------------------------------------------------------------------------
// Upstream client — talks to https://multipov.ai/mcp over streamable HTTP
// ---------------------------------------------------------------------------

const upstream = new Client(
  { name: PACKAGE_NAME, version: PACKAGE_VERSION },
  { capabilities: {} },
);

const upstreamTransport = new StreamableHTTPClientTransport(new URL(REMOTE_URL), {
  requestInit: {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
    },
  },
});

/**
 * Translate an upstream error into a user-visible message. Defined here as
 * a thin closure over REMOTE_URL so callers don't need to thread the URL
 * into every invocation; the heavy lifting lives in upstream-error.ts so
 * it has a unit-testable surface.
 */
function describeUpstreamError(err: unknown): string {
  return describeUpstreamErrorRaw(err, { remoteUrl: REMOTE_URL });
}

// ---------------------------------------------------------------------------
// Downstream server — speaks stdio to the local MCP client
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "multipov", version: PACKAGE_VERSION },
  { capabilities: { tools: {} } },
);

// Forward tools/list verbatim.
server.setRequestHandler(ListToolsRequestSchema, async () => {
  try {
    return await upstream.listTools();
  } catch (err) {
    throw new Error(describeUpstreamError(err));
  }
});

// Forward tools/call verbatim. The SDK wraps the result; we pass it through
// untouched so client-visible behavior is identical to talking to multipov.ai
// directly.
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    // callTool returns a CallToolResult; passing `{ name, arguments }` forwards
    // the entire invocation.
    const result = await upstream.callTool({
      name: req.params.name,
      arguments: req.params.arguments ?? {},
    });
    return result;
  } catch (err) {
    // Surface upstream failures as tools/call errors (isError=true) rather
    // than JSON-RPC protocol errors, so MCP clients render them inline in the
    // chat instead of dropping the whole connection.
    const message = describeUpstreamError(err);
    return {
      content: [{ type: "text" as const, text: message }],
      isError: true,
    };
  }
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Connect upstream first so we fail fast on bad auth / network / DNS.
  try {
    await upstream.connect(upstreamTransport);
  } catch (err) {
    fatal(`Could not connect to ${REMOTE_URL}: ${describeUpstreamError(err)}`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write(
    `[${PACKAGE_NAME}] ready — proxying stdio -> ${REMOTE_URL}\n`,
  );

  // Forward shutdown.
  const shutdown = async () => {
    try {
      await upstream.close();
    } catch {
      /* swallow */
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  fatal(describeUpstreamError(err));
});
