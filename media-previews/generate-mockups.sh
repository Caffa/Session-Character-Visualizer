#!/bin/bash

# Simple script to generate state mockup GIFs
# Usage: ./generate-mockups.sh

set -e

PORT=2728
VIEWER="media-previews/mockup-viewer.html"
OUTPUT_DIR="media-previews/states"

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Colors for different states (matching the agent hue)
HUE=200

# Start the mockup server in background
echo "Starting mockup server on port $PORT..."
bun run media-previews/mockup-server.ts &
SERVER_PID=$!
sleep 2

# Function to capture a state
capture_state() {
	local state=$1
	local duration=3
	local output="$OUTPUT_DIR/state-${state}.gif"

	echo "Capturing: $state"

	# Open the viewer and wait a bit
	open -a "Google Chrome" "file://$(pwd)/$VIEWER"
	sleep 2

	# Use macOS screencapture to record the area
	# This is the simplest method - capture a region of the screen
	# User will need to position the window manually

	# Alternative: Use ffmpeg with screen capture (if available)
	if command -v ffmpeg &>/dev/null; then
		ffmpeg -f avfoundation \
			-framerate 15 \
			-t $duration \
			-i "1:none" \
			-vf "crop=400:400:$(tput cols 2>/dev/null || echo 100):100" \
			-y "$output"
	else
		echo "ffmpeg not found. Manual capture required."
		echo "Position the mockup viewer window and press Enter to capture $state..."
		read
		screencapture -R100,100,400,400 -T3 -t png /tmp/capture-$state.png
		convert /tmp/capture-$state.png "$output" 2>/dev/null || echo "ImageMagick not found, PNG saved instead"
	fi

	# Wait between states
	sleep 1
}

# Capture all states
capture_state "idle"
capture_state "thinking"
capture_state "editing"
capture_state "reading"
capture_state "running"
capture_state "waiting"
capture_state "error"

# Cleanup
echo "Stopping server..."
kill $SERVER_PID 2>/dev/null || true

echo "Done! Mockups saved to $OUTPUT_DIR/"
