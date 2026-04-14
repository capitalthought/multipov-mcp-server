# multipov-mcp-server

MCP server for [multipov.ai](https://multipov.ai) — a multi-perspective AI review platform that runs any document, plan, or code diff past a panel of LLM-powered personas and synthesizes their findings. Exposes 14 tools for reviews, rewrites, and persona browsing from any MCP-aware client (Claude Code, Claude Desktop, Cursor, Codex, Zed, Raycast).

This package is a thin **stdio-to-HTTP proxy**. It speaks MCP over stdio to your local client and forwards every request to the hosted endpoint at `https://multipov.ai/mcp`. No business logic runs locally — the persona catalog, the review engine, and the rewrite engine all live server-side.

## Install

```bash
npx multipov-mcp-server
```

The server runs over stdio. Your MCP client spawns it as a child process and talks to it through pipes.

## Authenticate

1. Sign in at [multipov.ai](https://multipov.ai/login).
2. Open [`/settings/api-keys`](https://multipov.ai/settings/api-keys) → **Generate**.
3. Copy the `mpov_live_...` token. It is shown once — store it in your password manager.

## Register with Claude Code

```bash
claude mcp add multipov npx -y multipov-mcp-server --env MULTIPOV_API_KEY=mpov_live_YOUR_TOKEN_HERE
```

Or, by hand, in `~/.claude.json` (or your project-local `.mcp.json`):

```json
{
  "mcpServers": {
    "multipov": {
      "command": "npx",
      "args": ["-y", "multipov-mcp-server"],
      "env": {
        "MULTIPOV_API_KEY": "mpov_live_YOUR_TOKEN_HERE"
      }
    }
  }
}
```

Restart the client and run `/mcp` to verify the `multipov` server is connected.

## Register with Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on your OS and add the same snippet as above under `mcpServers`.

## Register with Cursor

Paste the same snippet into `~/.cursor/mcp.json` under `mcpServers`.

## What's inside

14 tools across four groups:

- **Personas** — `list_personas`, `get_persona`, `recommend_personas`
- **Reviews** — `submit_review`, `get_review_status`, `get_review_report`, `cancel_review`, `list_my_reviews`
- **Rewrites** — `submit_rewrite`, `get_rewrite_status`, `get_rewrite_result`
- **Specialized reviews** — `submit_plan_review`, `submit_pipeline_review`, `submit_codebase_review`

All tools share the same daily quota as the multipov.ai web UI. See the full reference at [capitalthought/multipov-docs](https://github.com/capitalthought/multipov-docs).

## Why a proxy instead of connecting to the HTTP endpoint directly?

You can connect directly to `https://multipov.ai/mcp` if your client supports streamable-HTTP transport:

```bash
claude mcp add --transport http multipov https://multipov.ai/mcp \
  --header "Authorization: Bearer mpov_live_YOUR_TOKEN_HERE"
```

This package exists because not every MCP client supports HTTP transport yet (many still default to stdio), and because the `claude mcp add npx -y ...` UX is consistent across most of the MCP ecosystem. Under the hood this package is a ~150-line proxy that uses the official `@modelcontextprotocol/sdk` streamable-HTTP client to forward tool calls to the hosted endpoint.

## Configuration

| Env var | Required | Default | Notes |
| --- | --- | --- | --- |
| `MULTIPOV_API_KEY` | yes | — | Get one at [`/settings/api-keys`](https://multipov.ai/settings/api-keys). |
| `MULTIPOV_BASE_URL` | no | `https://multipov.ai` | Override for local development. |

The API key is never logged, never written to disk, never bundled in the package. It is only ever read from the environment at startup and sent in the `Authorization` header to the hosted endpoint.

## Privacy

Submitted content is processed server-side by Anthropic, OpenAI, Google, and xAI per [multipov.ai/privacy](https://multipov.ai/privacy). This proxy does not add any telemetry, does not phone home, and does not cache your content locally.

## License

MIT © Capital Thought
