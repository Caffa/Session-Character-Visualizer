# 🏢 Session Character Visualizer

![Demo](media-previews/main_show.gif)

OpenCode plugin for visualizing AI coding sessions in a virtual office workspace.

![License](https://img.shields.io/badge/license-MIT-blue.svg)

Session Character Visualizer creates a blob character visualization of your coding sessions. Each session appears as a colored agent with speech bubbles showing current status and activity. Subagents show as smaller blobs orbitting their parents.

![subagents](media-previews/subagents.gif)

---

## Installation (One-Liner)

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Caffa/Session-Character-Visualizer/main/install.sh)"
```

Or manually:

```bash
git clone https://github.com/Caffa/Session-Character-Visualizer.git
cd Session-Character-Visualizer
bash install.sh
```

Restart OpenCode. The viewer opens automatically in your browser.

---

## Quick Start

```bash
# Install with one-liner
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Caffa/Session-Character-Visualizer/main/install.sh)"

# Restart OpenCode
opencode --restart

# Open the viewer
open ~/.config/opencode/plugins/pixel-office.html
```

---

## Agent States

| State    | Visual Features                    | Description                                                        |
| -------- | ---------------------------------- | ------------------------------------------------------------------ |
| Idle     | 💤, slow pulse, no ring            | Finished work, waiting for next task. Subagents removed after 10s. |
| Thinking | 🧠, expanding ring, sparkles       | Processing/generating. Eyes move rhythmically tracking thoughts.   |
| Editing  | ✏️, code panel with typewriter     | Writing/editing files. Shows animated panel with file names.       |
| Reading  | 📖 with glasses, book opens/closes | Reading files, searching. Glasses wobble while scanning.           |
| Running  | 💻, fast pulse, motion streaks     | Executing bash commands, terminal operations.                      |
| Waiting  | ⚠️, nervous shake, bouncing ❓     | Blocked needing user permission. Gentle oscillation.               |
| Error    | ❌, X_X eyes, red pulse, ⚡        | Something went wrong - needs attention.                            |

**Agent Colors**: Each agent gets a unique hue (0-360°) derived from its session ID. Colors persist per session - same agent always has the same color. Subagents use their parent's hue with a +30° offset for visual distinction.

---

## Architecture

```
pixel-office.ts (OpenCode plugin)
  ├─ Session events: created, deleted, status changes
  ├─ Tool executions: read, edit, bash, webfetch
  └─ WebSocket server: ws://localhost:2727
       └─ pixel-office.html (p5.js renderer)
            ├─ Radial agent positioning
            └─ Status-based animations
```

### Technical

- WebSocket on port 2727
- Event-driven updates from OpenCode hooks
- p5.js canvas rendering
- No bundling required

---

## Configuration

Change WebSocket port in:

1. `pixel-office.ts`: `PORT = 2727`
2. `pixel-office.html`: `WS_URL`

---

## Development

### Run Tests

```bash
bun test
```

### Regenerate Preview GIFs

```bash
cd media-previews
./START.sh
```

**Requirements**: macOS, ffmpeg (`brew install ffmpeg`)

---

## Troubleshooting

**Viewer doesn't open**: Open `~/.config/opencode/plugins/pixel-office.html` manually

**Port 2727 in use**: Change port in `pixel-office.ts` and `pixel-office.html`

**No agents appearing**:

1. Check OpenCode logs for `[pixel-office]` prefix
2. Run `bun install` in plugin folder
3. Open browser console on viewer page

---

## Related Projects

**[Pixel Office](https://github.com/Caffa/Pixel-Office)** - A VSCode & Claude-based visualization plugin with a similar concept. While this plugin (Session Character Visualizer) is designed specifically for OpenCode, Pixel Office provides a similar character visualization experience for VSCode users working with Claude.

Both projects share the goal of making AI coding sessions more engaging and visual, but are built for different platforms and AI coding environments.

---

## License

MIT License - see LICENSE file.

---

## About

Session Character Visualizer is a community plugin for [OpenCode](https://github.com/anomalyco/opencode), not affiliated with the OpenCode team.
