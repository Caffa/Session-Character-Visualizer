#!/bin/bash

# Quick capture script for agent state mockups
# Run this, then switch to each state and press Enter to capture

set -e

cd "$(dirname "$0")/.."
OUTPUT_DIR="media-previews/states"
mkdir -p "$OUTPUT_DIR"

# Check if server is running
if ! nc -z localhost 2728 2>/dev/null; then
	echo "Starting mockup server..."
	bun run media-previews/mockup-server.ts &
	SERVER_PID=$!
	echo "Server PID: $SERVER_PID"
	sleep 2
else
	echo "Server already running"
	SERVER_PID=""
fi

echo "==========================================="
echo "Agent State Mockup Capture Tool"
echo "==========================================="
echo ""
echo "1. Open media-previews/mockup-viewer.html in your browser"
echo "2. Position the agent in the center of the screen"
echo "3. Click each state button below"
echo "4. Press Enter after selecting each state to capture"
echo ""
echo "Captures will be saved to: $OUTPUT_DIR/"
echo ""

# List states
STATES=("idle" "thinking" "editing" "reading" "running" "waiting" "error")
COUNT=1
for state in "${STATES[@]}"; do
	echo "$COUNT) $state"
	((COUNT++))
done

echo ""
echo "Press q to quit"
echo "==========================================="

# Capture loop
for state in "${STATES[@]}"; do
	echo ""
	read -p "Select '$state' state and press Enter to capture (or q to quit): " response

	if [[ "$response" =~ ^[Qq]$ ]]; then
		echo "Quitting..."
		break
	fi

	# Capture using macOS screencapture
	# -C: capture cursor, -R: x,y,w,h region, -t: seconds to wait before capture
	# We'll use interactive mode since we don't know the window position

	echo "Click the '$state' button in the browser, then quickly click here and press Enter..."
	read -p "Ready? Press Enter: "

	# Capture a 400x400 region from the center of screen
	# Assumes 1920x1080 or similar - adjust as needed
	# For macOS Retina displays, we capture at 2x resolution
	OUTPUT="$OUTPUT_DIR/state-${state}.png"
	echo "Capturing to $OUTPUT..."

	# Get screen dimensions
	SCREEN_W=$(system_profiler SPDisplaysDataType | awk '/Resolution/ {print $2}' | head -1)
	SCREEN_H=$(system_profiler SPDisplaysDataType | awk '/Resolution/ {print $4}' | head -1)

	# Center 400x400 region
	if [ -n "$SCREEN_W" ] && [ -n "$SCREEN_H" ]; then
		X=$((SCREEN_W / 2 - 200))
		Y=$((SCREEN_H / 2 - 200))
		screencapture -R${X},${Y},400,400 "$OUTPUT"
	else
		# Fallback: capture whole screen
		screencapture "$OUTPUT"
	fi

	echo "✓ Captured: $OUTPUT"
done

# Cleanup
if [ -n "$SERVER_PID" ]; then
	echo ""
	echo "Stopping server..."
	kill $SERVER_PID 2>/dev/null || true
fi

echo ""
echo "==========================================="
echo "Done! Captures saved to $OUTPUT_DIR/"
echo ""
echo "To convert PNGs to GIFs, run:"
echo "  cd $OUTPUT_DIR && for f in state-*.png; do convert \"$f\" -delay 20 -loop 0 \"\${f%.png}.gif\"; done"
echo "==========================================="
