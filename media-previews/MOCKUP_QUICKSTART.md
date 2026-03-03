# Mockup Generator - Quick Start

Created files for generating agent state mockups:

## Files Created

1. **mockup-server.ts** - WebSocket test server (port 2728)
2. **mockup-viewer.html** - Interactive viewer with state buttons
3. **capture-states.sh** - Semi-automated capture script for macOS
4. **MOCKUP_README.md** - Full documentation

## Quick Usage

```bash
# Option 1: Automated capture (macOS)
cd media-previews
./capture-states.sh
# Follow prompts to capture each state

# Option 2: Manual capture
bun run media-previews/mockup-server.ts
open media-previews/mockup-viewer.html
# Use ⌘+Shift+4 to capture each state
```

## What It Does

- Creates a test agent (blue hue)
- Lets you switch between 7 states with buttons
- Captures screenshots to `media-previews/states/`
- Ready for README inclusion

## Next Steps

1. Run the capture script
2. Use the captured images/GIFs in the README
3. Update README to link to state images
