# AGENTS.md — Pixel Office Plugin

Guidelines for AI agents working on this OpenCode visualization plugin.

## Project Overview

Pixel Office is an OpenCode plugin that visualizes AI coding sessions as animated characters in a virtual office. It consists of:

- `pixel-office.ts` — Main plugin (TypeScript, runs in Bun)
- `pixel-office.html` — Visual viewer (HTML + p5.js)
- `package.json` — Minimal ES module declaration
- `install.sh` — Setup script for `~/.config/opencode/plugins/`

## Build & Development Commands

```bash
# No formal build step — TypeScript runs directly via Bun
# OpenCode auto-runs `bun install` when plugin loads

# Manual install for testing
bash install.sh

# Restart OpenCode to reload plugin
# pkill opencode && opencode  # or however you start OpenCode
```

## Code Style Guidelines

### TypeScript (pixel-office.ts)

- **Runtime**: Bun (not Node.js) — use Bun APIs like `Bun.serve()`
- **Types**: Explicit types for all function params and return values
- **Indentation**: Tabs (not spaces)
- **Quotes**: Single quotes for strings
- **Semicolons**: Required at end of statements
- **Naming**:
  - `PascalCase` for types/interfaces (e.g., `AgentState`, `Plugin`)
  - `camelCase` for functions and variables
  - `UPPER_SNAKE_CASE` for constants (e.g., `STATUS_CFG`, `TOOL_STATUS`)
  - `UPPER_SNAKE_CASE` for enum-like configs (e.g., `FLOOR_COLOR`)

### Section Comments

Use decorative section headers:

```typescript
// ─── Types ────────────────────────────────────────────────────────────────────
// ─── Helpers ──────────────────────────────────────────────────────────────────
// ─── Plugin ───────────────────────────────────────────────────────────────────
```

### Code Patterns

- **Guard clauses**: Prefer early returns over nested ifs
- **Null safety**: Always check optional values before use
- **Type assertions**: Use `as Type` sparingly, prefer type guards
- **Record types**: Use `Record<K, V>` for key-value mappings
- **Async/await**: Use for all async operations

### Error Handling

```typescript
// Silently fail for non-critical operations
try {
  await someOptionalOperation();
} catch {
  // Ignore — this is OK for notifications, logging, etc.
}
```

## Architecture

### Plugin Lifecycle

1. Plugin loads via OpenCode's plugin system
2. Attempts to start WebSocket server on port 2727
3. If port taken, connects as client to existing server
4. Listens to OpenCode events via hooks (`tool.execute.before`, `event`, etc.)
5. Broadcasts agent state updates to connected browser viewers

### Key Hooks

- `tool.execute.before` — Agent starts using a tool
- `tool.execute.after` — Tool execution complete
- `event` — Session lifecycle events (created, deleted, status, etc.)

### WebSocket Protocol

```typescript
// Server → Clients
{ type: "snapshot", agents: AgentState[] }
{ type: "heartbeat", timestamp: number }
{ type: "serverclosing", reason: string }

// Clients → Server (for sync instances)
{ type: "snapshot", agents: AgentState[] }
```

## HTML/Viewer (pixel-office.html)

- Uses p5.js from CDN for rendering
- WebSocket client reconnects automatically
- Canvas-based pixel-art rendering with HSL colors
- Status configurations in `STATUS_CFG` object

## Adding New Features

1. Add types to `AgentState` interface if needed
2. Update `TOOL_STATUS` mapping for new tools
3. Add `toolLabel()` entry for display text
4. Update viewer's `STATUS_CFG` for animations
5. Handle new event types in the `event` hook switch statement

## Testing

- No formal test suite — test manually by:
  1. Running `bash install.sh`
  2. Restarting OpenCode
  3. Opening browser to `pixel-office.html`
  4. Starting OpenCode sessions and watching for agents

## File Structure

```
├── pixel-office.ts      # Main plugin — TypeScript, Bun APIs
├── pixel-office.html    # Viewer — HTML, p5.js, vanilla JS
├── package.json         # ES module declaration
├── install.sh           # Setup script
└── media-previews/      # Demo GIFs for README
```

## Common Tasks

### Add support for a new OpenCode tool

1. In `pixel-office.ts`, add to `TOOL_STATUS` map:

   ```typescript
   newtool: "reading",  // or "editing", "running", etc.
   ```

2. Add label in `toolLabel()`:

   ```typescript
   newtool: "🔍 searching",
   ```

3. Test by triggering the tool in OpenCode

### Change the WebSocket port

1. Edit `PORT` constant in `pixel-office.ts`
2. Edit `WS_URL` in `pixel-office.html`
3. Re-run `bash install.sh`

## Dependencies

- `@opencode-ai/plugin` — Provided by OpenCode runtime
- `WebSocket` — Native (Bun and browser)
- `p5.js` — Loaded from CDN in HTML

No npm dependencies to manage — keep it that way.
