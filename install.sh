#!/usr/bin/env bash
# install.sh — Blob Office setup script
# Run once: bash install.sh
# Re-run to update to latest version

set -e
PLUGIN_DIR="$HOME/.config/opencode/plugins"

# Check if already installed (update mode)
if [ -f "$PLUGIN_DIR/blob-office.ts" ]; then
	echo "🔄 Updating existing Blob Office installation…"
	MODE="update"
else
	echo "📦 Creating plugin directory…"
	MODE="install"
fi

mkdir -p "$PLUGIN_DIR"

echo "🔌 Copying plugin files…"
cp blob-office.ts "$PLUGIN_DIR/blob-office.ts"

# Merge package.json deps if one already exists, else just copy
if [ -f "$PLUGIN_DIR/package.json" ]; then
	echo "📦 Merging dependencies into existing package.json…"
	# Read existing deps and add missing ones
	TEMP_DIR=$(mktemp -d)
	cp "$PLUGIN_DIR/package.json" "$TEMP_DIR/old.json"
	cp package.json "$TEMP_DIR/new.json"

	# Use node to merge package.json (simple merge of deps)
	node -e "
    const old = require('$TEMP_DIR/old.json');
    const nu = require('$TEMP_DIR/new.json');
    const merged = { ...old, ...nu, dependencies: { ...old.dependencies, ...nu.dependencies } };
    console.log(JSON.stringify(merged, null, 2));
  " >"$PLUGIN_DIR/package.json"

	rm -rf "$TEMP_DIR"
else
	cp package.json "$PLUGIN_DIR/package.json"
fi

echo "🖥️  Copying viewer…"
cp blob-office.html "$PLUGIN_DIR/blob-office.html"

echo ""
if [ "$MODE" = "update" ]; then
	echo "✅ Update complete! Restart OpenCode to load the new version."
else
	echo "✅ Done! Next steps:"
	echo "   1. Restart OpenCode — it will run 'bun install' automatically"
	echo "   2. Start a new session in OpenCode"
	echo "   3. The viewer opens automatically in your browser"
fi
echo ""
echo "   Viewer is at: $PLUGIN_DIR/blob-office.html"
echo "   You can also open it manually anytime."
