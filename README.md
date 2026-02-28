# 🏢 Pixel Office — OpenCode Visualization

A live pixel-art visualization for your OpenCode sessions.
Each session becomes an animated blob in a virtual office.

## What you see

- **Colored blobs** — one per OpenCode session, color derived from session ID
- **Name tag** — shows the project folder + a status dot
- **Speech bubbles** — current tool or message snippet
- **Desk** — each agent gets a desk; monitor glows when active
- **Animations** — slow bob when idle, fast pulse when editing/running

## Status colors (status dot on name tag)

| Status    | Meaning                         |
|-----------|----------------------------------|
| 💤 Idle   | Agent waiting for input (grey)   |
| 🧠 Thinking | Generating a response (purple) |
| ✏️ Editing | Writing/editing files (green)   |
| 📖 Reading | Reading files (blue)            |
| 💻 Running | Executing bash (orange)         |
| ⚠️ Waiting | Needs permission (yellow)       |
| ❌ Error  | Session errored (red)           |

## Install

```bash
git clone <this-repo>
cd pixel-office
bash install.sh
```

Then restart OpenCode. The viewer auto-opens on your first session.

## Manual install

```bash
mkdir -p ~/.config/opencode/plugins
cp pixel-office.ts  ~/.config/opencode/plugins/
cp pixel-office.html ~/.config/opencode/plugins/
cp package.json     ~/.config/opencode/plugins/
```

Add to `~/.config/opencode/opencode.json`:
```json
{
  "$schema": "https://opencode.ai/config.json"
}
```
(No extra config needed — global plugins load automatically from the plugins dir.)

## Architecture

```
OpenCode (any session)
  └── pixel-office.ts plugin
        ├── Hooks: session.created/deleted/idle/status
        │          tool.execute.before/after
        │          message.updated, permission.asked
        └── WebSocket server → ws://localhost:2727
              └── pixel-office.html (p5.js viewer)
                    opens automatically in browser
```

The plugin watches OpenCode's native event hooks — no file watching,
no polling, no modifications to OpenCode needed.

## Adding pixel art later

When you're ready to swap color blobs for real sprites:

1. Download a CC0/personal-use sprite sheet (e.g. from itch.io)
2. Load it in p5.js with `p.loadImage()`
3. Replace the blob-drawing section in `pixel-office.html` with `p.image()`
4. Use the agent's `status` to pick the animation frame

The entire rendering is isolated in the `draw()` function — easy to swap out.

## Troubleshooting

**Viewer doesn't open automatically?**
Open `~/.config/opencode/plugins/pixel-office.html` manually in your browser.

**Port 2727 in use?**
Change `PORT = 2727` in `pixel-office.ts` and update the WS_URL in `pixel-office.html`.

**No agents appearing?**
- Check OpenCode loaded the plugin: look for `[pixel-office]` in logs
- Make sure `bun install` ran (restart OpenCode)
- Open browser console on the viewer — check for WS connection errors
