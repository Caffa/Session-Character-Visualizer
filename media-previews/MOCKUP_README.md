# Agent State Mockup Generator

Quick tools to generate visual mockups of each agent state.

## Files

- `mockup-server.ts` - Simple WebSocket server that serves a test agent
- `mockup-viewer.html` - Viewer with state buttons (modified to use port 2728)
- `capture-states.sh` - Manual capture script using macOS screencapture

## Usage

### 1. Start the mockup server

```bash
bun run media-previews/mockup-server.ts
```

The server will show: `Test server running on ws://localhost:2728`

### 2. Open the viewer

```bash
open media-previews/mockup-viewer.html
```

Or double-click `media-previews/mockup-viewer.html` in Finder.

### 3. Use the capture script (recommended)

```bash
cd media-previews
./capture-states.sh
```

This will:

1. Start the server automatically if not running
2. Prompt you to select each state
3. Capture a 400x400 screenshot of the agent
4. Save to `media-previews/states/`

### 4. Alternative: Manual capture

1. Open `mockup-viewer.html` in your browser
2. Click each state button to see the animation
3. Use your preferred screen capture tool:
   - macOS: `⌘ + Shift + 4` for region capture
   - Save each as `state-{name}.png`

## Captures

Captures will be saved to `media-previews/states/`:

```
states/
  ├── state-idle.png
  ├── state-thinking.png
  ├── state-editing.png
  ├── state-reading.png
  ├── state-running.png
  ├── state-waiting.png
  └── state-error.png
```

## Converting to GIFs (optional)

If you have ImageMagick installed:

```bash
cd media-previews/states
for f in state-*.png; do
  convert "$f" "${f%.png}.gif"
done
```

## Notes

- The agent is blue (hue 200) by default
- Position the browser window so the agent is centered before capturing
- Subtle animations (pulsing, bobbing, eye movement) are rendered in real-time
- The mockup server creates a single agent with the selected state
