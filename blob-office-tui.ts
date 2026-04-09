/**
 * blob-office-tui.ts
 * TUI Plugin for Blob Office - registers slash commands in the OpenCode UI
 *
 * This is a separate TUI-only plugin that communicates with the main blob-office
 * server plugin to trigger actions like opening the visualizer.
 *
 * Install alongside blob-office.ts in ~/.config/opencode/plugins/
 */

// Inline TUI types since they're not exported from the plugin package
type TuiPluginApi = {
	command: {
		register: (cb: () => TuiCommand[]) => () => void;
		trigger: (value: string) => void;
	};
};
type TuiCommand = {
	title: string;
	value: string;
	description?: string;
	category?: string;
	slash?: {
		name: string;
		aliases?: string[];
	};
	onSelect?: () => void;
};
type TuiPlugin = (api: TuiPluginApi, options?: Record<string, unknown>, meta?: {
	id?: string;
	source?: string;
	spec?: string;
	target?: string;
	version?: string;
}) => Promise<void>;

const PORT = 2727;

// Detect if running in headless/background mode
const isHeadless = process.stdout.isTTY === false || process.env.CI === 'true' || process.env.OPENCODE_HEADLESS === 'true';

// When command is triggered, connect to server and send open_viewer message
// The server will receive this and call openViewer()
async function sendOpenViewerCommand() {
	// Skip in headless mode - no GUI available
	if (isHeadless) {
		return;
	}

	try {
		const ws = new WebSocket(`ws://localhost:${PORT}`);
		ws.onopen = () => {
			ws.send(JSON.stringify({ type: "open_viewer" }));
			// Close immediately after sending
			ws.close();
		};
		ws.onerror = () => {
			// Silently fail if no server running
		};
	} catch {
		// Silently fail
	}
}

// TUI Plugin - registers slash commands that communicate with server via WebSocket
// This allows /visualizer command to trigger server to open the viewer
const blobOfficeTuiPlugin: TuiPlugin = async (api: TuiPluginApi) => {
	// Register slash commands with onSelect handler
	api.command.register(() => [
		{
			title: "Open Visualizer",
			value: "visualizer",
			description: "Open the Blob Office pixel agent visualizer",
			category: "Blob Office",
			slash: {
				name: "visualizer",
				aliases: ["blob-office", "bo"],
			},
			onSelect: sendOpenViewerCommand,
		},
	]);
};

export default {
	id: "blob-office-tui",
	tui: blobOfficeTuiPlugin,
};