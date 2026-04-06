# 40mcp Integration with OpenClaude

## Overview

[40mcp](https://github.com/40verse/40mcp) is a tool factory that generates MCP servers from API specs (OpenAPI, GraphQL, HAR recordings) without writing server code. OpenClaude is a full MCP client — it knows how to connect to and use any MCP server. The two compose cleanly.

```
Your HTTP API → 40mcp → MCP server → OpenClaude client → AI assistant
```

## Why they fit together

OpenClaude's MCP layer is infrastructure: it speaks the protocol, manages connections, and exposes tools to the model. 40mcp is a factory: it turns any API into a conforming MCP server in one command.

| Capability | OpenClaude | 40mcp |
|---|---|---|
| MCP client (consume servers) | Yes | — |
| MCP server (expose tools) | Yes (built-in tools only) | Yes (any HTTP API) |
| OpenAPI → tools | No | `from-openapi` |
| GraphQL → tools | No | `from-graphql` |
| HAR recording → tools | No | `from-har` |
| Token-aware response shaping | No | `pick`, `omit`, `tokenBudget` |
| Multi-API mixing (N APIs → 1 server) | No | `mix` |
| Compound tool chains | No | `executeChain()` |
| MCP → REST reverse bridge | No | `reverse` |

## Zero-code integration

Since 40mcp speaks stdio/SSE/HTTP — all transports OpenClaude already supports — no plugin or patch code is needed. Add entries to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["40mcp", "serve", "node_modules/40mcp/configs/github.json"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    },
    "my-api": {
      "type": "stdio",
      "command": "npx",
      "args": ["40mcp", "from-openapi", "./openapi.json"]
    }
  }
}
```

OpenClaude discovers this file at startup and connects automatically. No restart required after editing when running in watch mode.

## Integration patterns

### 1. Single API from spec

The simplest case: one OpenAPI spec becomes one MCP server.

```json
{
  "mcpServers": {
    "stripe": {
      "type": "stdio",
      "command": "npx",
      "args": ["40mcp", "from-openapi", "./specs/stripe.json"],
      "env": {
        "STRIPE_API_KEY": "${STRIPE_API_KEY}"
      }
    }
  }
}
```

### 2. Mixed multi-API server

40mcp's `mix` command merges N APIs into one server with a unified tool surface. This is the key feature for OpenClaude workflows that span multiple services (read Notion → write Linear → post Slack).

```json
{
  "mcpServers": {
    "workspace": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "40mcp", "mix",
        "--notion", "./specs/notion.json",
        "--linear", "./specs/linear.json",
        "--slack", "./specs/slack.json"
      ],
      "env": {
        "NOTION_TOKEN": "${NOTION_TOKEN}",
        "LINEAR_API_KEY": "${LINEAR_API_KEY}",
        "SLACK_BOT_TOKEN": "${SLACK_BOT_TOKEN}"
      }
    }
  }
}
```

The model sees `notion_get_page`, `linear_create_issue`, `slack_post_message` as tools on a single connection. One `.mcp.json` entry, three APIs.

### 3. API with no spec (HAR recording)

For internal APIs or third-party services without an OpenAPI spec, record network traffic and derive the server from it.

```bash
# Record traffic in browser DevTools or via proxy, export as .har
npx 40mcp from-har ./recordings/my-api.har --output ./my-api-mcp.json
```

Then reference in `.mcp.json`:

```json
{
  "mcpServers": {
    "my-internal-api": {
      "type": "stdio",
      "command": "npx",
      "args": ["40mcp", "serve", "./my-api-mcp.json"]
    }
  }
}
```

### 4. Token-aware shaping

Large API responses can exhaust context. 40mcp's `pick`/`omit`/`tokenBudget` options trim responses before they reach the model.

```json
{
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "40mcp", "serve", "node_modules/40mcp/configs/github.json",
        "--tokenBudget", "2000",
        "--omit", "*.body,*.diff"
      ]
    }
  }
}
```

### 5. SSE/HTTP transport (long-running server)

For persistent or shared server deployments, run 40mcp in HTTP mode and connect via SSE:

```bash
# Start the 40mcp server
npx 40mcp serve ./my-api-mcp.json --transport sse --port 8742
```

```json
{
  "mcpServers": {
    "my-api": {
      "type": "sse",
      "url": "http://localhost:8742/sse"
    }
  }
}
```

## Community configs

40mcp ships configs for common services in its `configs/` directory. These work with OpenClaude's `stdio` transport directly:

```json
{
  "mcpServers": {
    "github":   { "type": "stdio", "command": "npx", "args": ["40mcp", "serve", "node_modules/40mcp/configs/github.json"] },
    "notion":   { "type": "stdio", "command": "npx", "args": ["40mcp", "serve", "node_modules/40mcp/configs/notion.json"] },
    "linear":   { "type": "stdio", "command": "npx", "args": ["40mcp", "serve", "node_modules/40mcp/configs/linear.json"] },
    "jira":     { "type": "stdio", "command": "npx", "args": ["40mcp", "serve", "node_modules/40mcp/configs/jira.json"] },
    "slack":    { "type": "stdio", "command": "npx", "args": ["40mcp", "serve", "node_modules/40mcp/configs/slack.json"] }
  }
}
```

## Gaps in OpenClaude that 40mcp surfaces

Two TODOs in `src/entrypoints/mcp.ts` are directly relevant:

### 1. `// TODO: Also re-expose any MCP tools` (line 69, 111)

When OpenClaude itself runs as an MCP server (via `openclaude mcp`), it currently only exposes its built-in tools — not tools from connected MCP servers. 40mcp's `link` command addresses this conceptually: a chain where upstream MCP tools are re-exposed downstream.

**Potential fix:** Enumerate `mcpClients` tools in `ListToolsRequestSchema` handler and proxy `CallToolRequestSchema` calls through to the appropriate client.

### 2. `// TODO: validate input types with zod` (line 143)

Tool call arguments aren't Zod-validated in the MCP server path before being passed to `tool.call()`. 40mcp's `validate` CLI does schema validation on outbound calls. OpenClaude could do the same using the `tool.inputSchema` it already has:

```typescript
// In CallToolRequestSchema handler, after finding the tool:
const parsed = tool.inputSchema.safeParse(args ?? {})
if (!parsed.success) {
  return { isError: true, content: [{ type: 'text', text: parsed.error.message }] }
}
const finalResult = await tool.call(parsed.data as never, toolUseContext, ...)
```

## Configuration scopes

`.mcp.json` is the simplest integration point (project-local, checked into git). For user-wide 40mcp servers that apply to all projects, add entries to `~/.claude/settings.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["40mcp", "serve", "/home/user/.40mcp/configs/github.json"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
    }
  }
}
```

OpenClaude merges configs across scopes: `enterprise` > `user` > `project` > `local` > `dynamic`.

## Diagnosis

Use OpenClaude's built-in doctor to verify 40mcp servers connected correctly:

```bash
openclaude mcp doctor
```

This checks server health, lists connected tools, and surfaces connection errors — useful for debugging 40mcp config issues.
