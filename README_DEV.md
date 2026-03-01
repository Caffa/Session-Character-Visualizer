# Pixel Office

OpenCode plugin for visualizing coding sessions in a virtual office workspace.

![License](https://img.shields.io/badge/license-MIT-blue.svg)

Pixel Office is an OpenCode plugin that creates a blob character visualization of your coding sessions. Each session appears as a colored agent character with speech bubbles showing current status and activity.

---

## Installation

Install via the provided script:

```bash
git clone <this-repo>
cd pixel-office
bash install.sh
```

Restart OpenCode. The viewer opens automatically in your browser on first use.

---

## Usage

The viewer connects to `ws://localhost:2728/ws` and receives real-time updates from OpenCode sessions. Multiple projects display as multiple agents at different desks.

### Quick Start

```bash
# Install the plugin
$ bash install.sh
# Restart OpenCode
$ opencode --restart
# Open the viewer in browser
$ open ~/.config/opencode/plugins/pixel-office/index.html
```

### Agent States

| State    | Indicator | Description         |
| -------- | --------- | ------------------- |
| Idle     | Grey dot  | Waiting for input   |
| Thinking | Purple    | Processing response |
| Editing  | Green     | Writing files       |
| Reading  | Blue      | Reading code        |
| Running  | Orange    | Executing commands  |
| Waiting  | Yellow    | Requires permission |
| Error    | Red       | Error occurred      |

---

## Architecture

The plugin hooks into OpenCode's event system and broadcasts updates via WebSocket:

```
pixel-office.ts (OpenCode plugin)
  ├─ Session events: created, deleted, status changes
  ├─ Tool executions: read, edit, bash, webfetch
  └─ WebSocket server: ws://localhost:2728
       └─ pixel-office/index.html (p5.js renderer)
            ├─ Agent rendering with status-based animations
            └─ Desk assignments for multi-session layouts
```

### Technical Constraints

- Single WebSocket connection on port 2728 (configurable in source)
- No file watching or polling required
- Uses event-driven updates from OpenCode hooks
- p5.js for canvas rendering with device pixel density support
- ES6 modules with direct imports (no bundling required)

---

## Other Similar Projects

| Feature       | Pixel Office | Pixel Agents (VS Code) |
| ------------- | ------------ | ---------------------- |
| Platform      | OpenCode     | VS Code                |
| Rendering     | p5.js        | Custom engine          |
| WebSocket     | Native       | Required setup         |
| Multi-session | Supported    | Supported              |
| Subagents     | Supported    | Not available          |

Pixel Office is designed specifically for OpenCode integration. For VS Code users, see [Pixel Agents](https://github.com/pablodelucca/pixel-agents) by pablodelucca.

---

## Configuration

Change the WebSocket port by modifying these files:

1. `pixel-office.ts`: `PORT = 2728`
2. `pixel-office/js/websocket.js`: `const WS_URL = "ws://localhost:2728/ws"`

### Custom Rendering

The rendering logic lives in `pixel-office/js/render/`. Modify agent appearance by editing:

- `agent.js`: Body drawing, eyes, animations
- `desk.js`: Desk styling
- `nametag.js`: Name tag appearance
- `tools/`: Tool-specific visualizations (pencil for editing, terminal for running)

---

## Development

### Regenerate Preview GIFs

Automated screenshot capture and GIF generation:

```bash
cd media-previews
./START.sh
```

Or run directly:

```bash
cd media-previews
./capture-and-gif.sh
```

**Required previews**:

- Basic scenarios: empty office, single agent, multiple agents, subagents
- Agent states: idle, thinking, editing, reading, running, waiting, error

See `media-previews/STATE-CAPTURE-GUIDE.md` for detailed instructions on triggering each agent state.

**Requirements**:

- macOS (for screencapture)
- ffmpeg (`brew install ffmpeg`)

---

## Contributing

Contributions welcome. Read the project code structure in `pixel-office/js/` for extension points.

---

## Support

If this plugin helps your workflow, consider supporting development:

- [Ko-fi](https://ko-fi.com/pamelawang_mwahacookie) - One-time support

---

## Troubleshooting

**Viewer does not open**: Open `~/.config/opencode/plugins/pixel-office/index.html` manually in browser

**Port 2728 in use**: Change port in `pixel-office.ts` and `pixel-office/js/websocket.js`

**No agents appearing**:

1. Check OpenCode logs for `[pixel-office]` prefix
2. Run `bun install` in the plugin folder
3. Open browser console on the viewer page for errors

---

## License

MIT License - see LICENSE file for details

---

## About OpenCode

Pixel Office is a community plugin for [OpenCode](https://github.com/anomalyco/opencode), not affiliated with the OpenCode team.
