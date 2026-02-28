#!/usr/bin/env bash
# install.sh — Pixel Office setup script
# Run once: bash install.sh

set -e
PLUGIN_DIR="$HOME/.config/opencode/plugins"

echo "📦 Creating plugin directory…"
mkdir -p "$PLUGIN_DIR"

echo "🔌 Copying plugin files…"
cp pixel-office.ts "$PLUGIN_DIR/pixel-office.ts"

# Merge package.json deps if one already exists, else just copy
if [ -f "$PLUGIN_DIR/package.json" ]; then
  echo "⚠️  package.json already exists in plugin dir."
  echo "    Manually add { \"ws\": \"^8.18.0\", \"@types/ws\": \"^8.5.13\" } to its dependencies."
else
  cp package.json "$PLUGIN_DIR/package.json"
fi

echo "🖥️  Copying viewer…"
cp pixel-office.html "$PLUGIN_DIR/pixel-office.html"

echo ""
echo "✅ Done! Next steps:"
echo "   1. Restart OpenCode — it will run 'bun install' automatically"
echo "   2. Start a new session in OpenCode"
echo "   3. The viewer opens automatically in your browser"
echo ""
echo "   Viewer is at: $PLUGIN_DIR/pixel-office.html"
echo "   You can also open it manually anytime."
