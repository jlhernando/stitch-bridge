# stitch-bridge

MCP server that gives AI coding agents the ability to design UIs through [Google Stitch](https://stitch.google.com/).

Your agent describes what it wants. Stitch generates production-ready HTML. stitch-bridge handles everything in between.

## How it works

```
Your AI Agent  <-->  stitch-bridge (MCP)  <-->  Google Stitch SDK  -->  HTML / Screenshots
```

stitch-bridge runs as a local [Model Context Protocol](https://modelcontextprotocol.io/) server over stdio. Any MCP-compatible client (Claude Code, Cursor, Windsurf, etc.) can connect to it and use 9 tools to create, edit, and manage UI designs, all through natural language prompts.

The Stitch SDK handles the actual generation using Gemini models. stitch-bridge fetches the results (HTML source, base64 screenshots) and returns them directly to the agent, so it can inspect, iterate, or save the output without leaving its workflow.

## Quick start

### 1. Get a Stitch API key

Sign up at [stitch.google.com](https://stitch.google.com/) and grab your API key.

### 2. Add to your MCP client

Add to your MCP config (e.g. `.mcp.json`, `claude_desktop_config.json`, or your editor's MCP settings):

```json
{
  "mcpServers": {
    "stitch-bridge": {
      "command": "npx",
      "args": ["-y", "stitch-bridge"],
      "env": {
        "STITCH_API_KEY": "your-api-key"
      }
    }
  }
}
```

Or install globally:

```bash
npm install -g stitch-bridge
```

Then configure with `command: "stitch-bridge"` instead of using npx.

### 3. Use it

Ask your agent to design something:

> "Create a project and generate a mobile login screen with email and Google sign-in"

The agent will call `create_project`, then `generate_screen`, and return the full HTML.

## Tools

| Tool | Description | Required params |
|------|-------------|-----------------|
| `list_projects` | List all accessible projects | - |
| `create_project` | Create a new project | - |
| `generate_screen` | Generate UI from a text prompt | `projectId`, `prompt` |
| `edit_screen` | Edit an existing screen | `projectId`, `screenId`, `prompt` |
| `generate_variants` | Create 1-5 design alternatives | `projectId`, `screenId`, `prompt` |
| `list_screens` | List screens in a project | `projectId` |
| `get_screen_html` | Get full HTML of a screen | `projectId`, `screenId` |
| `get_screen_image` | Get base64 screenshot | `projectId`, `screenId` |
| `build_site` | Assemble multi-page site from screens | `projectId`, `routes` |

### Options

**Device types:** `MOBILE`, `DESKTOP`, `TABLET`, `AGNOSTIC`

**Models:** `GEMINI_3_PRO`, `GEMINI_3_FLASH` (default)

Both are optional parameters on `generate_screen`, `edit_screen`, and `generate_variants`.

## Output

Every tool returns JSON. The key outputs:

**Generated screens** return the full HTML source inline:
```json
{
  "projectId": "proj-abc",
  "screenId": "scr-123",
  "html": "<!DOCTYPE html><html>..."
}
```

**Screenshots** return base64-encoded images:
```json
{
  "screenId": "scr-123",
  "base64": "iVBORw0KGgo...",
  "mimeType": "image/png"
}
```

**Multi-page sites** return HTML per route:
```json
{
  "projectId": "proj-abc",
  "pages": [
    { "route": "/", "screenId": "scr-1", "html": "..." },
    { "route": "/about", "screenId": "scr-2", "html": "..." }
  ]
}
```

## Configuration

| Environment variable | Description |
|---------------------|-------------|
| `STITCH_API_KEY` | Stitch API key (recommended) |
| `STITCH_ACCESS_TOKEN` | Alternative: OAuth access token |

One of the two is required.

## Development

```bash
npm install
npm run build      # Compile TypeScript
npm run dev        # Watch mode
npm test           # Run tests
npm start          # Run the MCP server
```

Requires Node.js >= 18.

## License

MIT
