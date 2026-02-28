/**
 * pixel-office.ts
 * Global OpenCode plugin — drop into ~/.config/opencode/plugins/
 *
 * Starts a WebSocket server on ws://localhost:2727 and broadcasts
 * live session state to the pixel-office viewer (pixel-office.html).
 *
 * Install:
 *   cp pixel-office.ts ~/.config/opencode/plugins/
 *   cp package.json   ~/.config/opencode/plugins/
 *   # OpenCode runs `bun install` automatically at next startup
 */

import type { Plugin } from "@opencode-ai/plugin";

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentStatus =
	| "idle"
	| "thinking"
	| "editing"
	| "reading"
	| "running"
	| "waiting"
	| "error";

interface AgentState {
	id: string;
	parentID: string | null; // ID of parent agent if this is a subagent
	folder: string; // basename of project directory
	folderFull: string; // full path
	title: string | null; // session title
	status: AgentStatus;
	tool: string | null; // current tool being executed
	message: string | null; // last speech bubble text
	since: number; // timestamp of last status change (ms)
	color: number; // hue 0–360, derived from session id
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hueFromId(id: string): number {
	let h = 0;
	for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
	return h % 360;
}

function folderName(path: string): string {
	return path.split("/").filter(Boolean).pop() ?? path;
}

const TOOL_STATUS: Record<string, AgentStatus> = {
	write: "editing",
	edit: "editing",
	multiedit: "editing",
	read: "reading",
	glob: "reading",
	grep: "reading",
	ls: "reading",
	bash: "running",
	webfetch: "reading",
	websearch: "reading",
	task: "thinking",
	todoread: "reading",
	todowrite: "editing",
};

function toolStatus(tool: string): AgentStatus {
	return TOOL_STATUS[tool.toLowerCase()] ?? "thinking";
}

function toolLabel(tool: string): string {
	const labels: Record<string, string> = {
		write: "✏️ writing",
		edit: "✏️ editing",
		multiedit: "✏️ editing",
		read: "📖 reading",
		glob: "🔍 searching",
		grep: "🔍 searching",
		ls: "📂 listing",
		bash: "💻 running",
		webfetch: "🌐 fetching",
		websearch: "🌐 searching",
		task: "🤖 spawning",
		todoread: "📋 todos",
		todowrite: "📋 updating",
	};
	return labels[tool.toLowerCase()] ?? `🔧 ${tool}`;
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export const PixelOfficePlugin: Plugin = async ({ directory, client, $ }) => {
	const PORT = 2727;
	const agents = new Map<string, AgentState>();
	const clients = new Set<globalThis.WebSocket>();

	// Helper for structured logging (goes to OpenCode log, not terminal)
	const log = async (
		level: "debug" | "info" | "warn" | "error",
		msg: string,
	) => {
		try {
			await client?.app?.log?.({
				body: {
					service: "pixel-office",
					level,
					message: msg,
				},
			});
		} catch {
			// Fallback to console if logging fails
		}
	};

	// Helper to show system notification on macOS
	const notify = async (title: string, message: string) => {
		try {
			await $`osascript -e 'display notification "${message}" with title "${title}"'`;
		} catch {
			// Silently fail if notifications aren't available
		}
	};

	// ── Broadcast to all connected clients ──────────────────────────────────

	// WebSocket connection to central server (for non-server instances)
	let syncWs: WebSocket | null = null;

	function broadcast() {
		const msg = JSON.stringify({
			type: "snapshot",
			agents: [...agents.values()],
		});

		// Send to all connected viewer clients
		for (const ws of clients) {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(msg);
			}
		}

		// If we're a client instance, also sync to central server
		if (syncWs && syncWs.readyState === WebSocket.OPEN) {
			syncWs.send(msg);
		}
	}

	function updateAgent(id: string, patch: Partial<AgentState>) {
		const a = agents.get(id);
		if (!a) return;
		Object.assign(a, patch, { since: Date.now() });
		broadcast();
	}

	// ── Auto-open browser ─────────────────────────────────────────────────────

	let browserOpened = false;
	let serverWasAlreadyRunning = false;

	async function openViewer() {
		// Don't open browser if server was already running (from previous OpenCode session)
		if (browserOpened || serverWasAlreadyRunning) return;
		browserOpened = true;
		// Find the viewer — look next to the plugin file, then home
		const candidates = [
			`${process.env.HOME}/.config/opencode/plugins/pixel-office.html`,
			`${process.env.HOME}/pixel-office/index.html`,
		];
		const viewer = candidates[0]; // default install location

		const platform = process.platform;
		const cmd =
			platform === "darwin"
				? ["open", viewer]
				: platform === "win32"
					? ["cmd", "/c", "start", "", viewer]
					: ["xdg-open", viewer];

		try {
			const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
			await proc.exited;
		} catch {
			log("info", `Open viewer manually: ${viewer}`);
		}
	}

	// ── Bun WebSocket Server ─────────────────────────────────────────────────

	// Track WebSocket connections using Bun's native WebSocket
	let wss: Awaited<ReturnType<typeof Bun.serve>> | null = null;
	let isServerInstance = false; // true if this instance started the server

	try {
		wss = Bun.serve({
			port: PORT,
			fetch(req, server) {
				// Handle WebSocket upgrade
				const url = new URL(req.url);
				if (url.pathname === "/ws" || url.pathname === "/") {
					const success = server.upgrade(req);
					if (success) return undefined;
					return new Response("WebSocket upgrade failed", { status: 400 });
				}
				return new Response("Not Found", { status: 404 });
			},
			websocket: {
				open(ws) {
					log("info", "Client connected");
					notify("Pixel Office", "Viewer connected");
					clients.add(ws as unknown as globalThis.WebSocket);
					// Send current state immediately on connect
					ws.send(
						JSON.stringify({ type: "snapshot", agents: [...agents.values()] }),
					);
				},
				close(ws) {
					log("info", "Client disconnected");
					clients.delete(ws as unknown as globalThis.WebSocket);
				},
				message(ws, message) {
					// Handle incoming sync messages from other plugin instances
					try {
						const msg = JSON.parse(message.toString());
						if (msg.type === "snapshot") {
							// Merge incoming agents from client instances
							for (const agent of msg.agents) {
								if (!agents.has(agent.id)) {
									agents.set(agent.id, agent);
								} else {
									// Update existing agent
									const existing = agents.get(agent.id)!;
									Object.assign(existing, agent);
								}
							}
							// Re-broadcast to all connected viewers
							broadcast();
						}
					} catch {
						// Ignore parse errors
					}
				},
			},
		});
		isServerInstance = true;
		log("info", `WebSocket server running on ws://localhost:${PORT}`);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
			log(
				"warn",
				"Port 2727 already in use — connecting to existing server as client",
			);
			serverWasAlreadyRunning = true;
			// Connect to existing server as a client to receive broadcasts
			// and sync agent state
			const wsUrl = `ws://localhost:${PORT}`;
			syncWs = new WebSocket(wsUrl);

			syncWs.onopen = () => {
				log("info", "Connected to existing Pixel Office server as client");
			};

			syncWs.onmessage = (ev) => {
				try {
					const msg = JSON.parse(ev.data);
					// When we receive a snapshot from the server, merge agents
					if (msg.type === "snapshot") {
						// Merge server's agents with our local agents
						// This keeps our local state in sync
						for (const agent of msg.agents) {
							if (!agents.has(agent.id)) {
								// New agent from another instance - add it
								agents.set(agent.id, agent);
							} else {
								// Update existing agent with server data
								const existing = agents.get(agent.id)!;
								Object.assign(existing, agent);
							}
						}
					}
				} catch {
					/* ignore parse errors */
				}
			};

			syncWs.onerror = () => {
				log("warn", "Error connecting to existing server");
			};
		} else {
			log("error", `Failed to start WebSocket server: ${err}`);
		}
	}

	// ── Cleanup on process exit ───────────────────────────────────────────────

	async function cleanup(signal: string) {
		log("info", `Received ${signal}, shutting down...`);

		// Close sync connection to central server
		if (syncWs) {
			if (syncWs.readyState === WebSocket.OPEN) {
				syncWs.close(1001, "Client shutting down");
			}
			syncWs = null;
		}

		// Notify all clients that server is closing
		const closeMsg = JSON.stringify({ type: "serverclosing", reason: signal });
		for (const ws of clients) {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(closeMsg);
				ws.close(1001, "Server shutting down");
			}
		}
		clients.clear();

		// Stop the WebSocket server
		if (wss) {
			wss.stop();
			wss = null;
		}

		log("info", "Cleanup complete");
	}

	// Handle process exit signals
	process.on("SIGINT", () => cleanup("SIGINT"));
	process.on("SIGTERM", () => cleanup("SIGTERM"));

	// ── Hooks ─────────────────────────────────────────────────────────────────

	return {
		// Tool about to execute — most interesting hook
		// Note: receives (input, output) as two parameters
		"tool.execute.before": async (input, output) => {
			const { sessionID, tool } = input as {
				sessionID: string;
				tool: string;
				callID: string;
			};
			if (!sessionID || !agents.has(sessionID)) return;
			updateAgent(sessionID, {
				status: toolStatus(tool),
				tool: tool,
				message: toolLabel(tool),
			});
		},

		// Tool finished
		"tool.execute.after": async (input) => {
			const { sessionID } = input as { sessionID: string; tool: string };
			if (!sessionID || !agents.has(sessionID)) return;
			updateAgent(sessionID, {
				status: "thinking",
				tool: null,
				message: "🧠 thinking…",
			});
		},

		// Unified event hook - handles all session events
		event: async ({ event }) => {
			const props = event.properties as Record<string, unknown>;

			switch (event.type) {
				// New session created
				case "session.created": {
					const sessionInfo = props.info as {
						id: string;
						parentID?: string;
						title: string;
					};
					const id = sessionInfo.id;
					const parentID = sessionInfo.parentID;
					const title = sessionInfo.title;
					const isSubAgent = !!parentID;

					// Log for debugging - shows session info and agent count
					log(
						"info",
						`Session created: ${id.substring(0, 8)}..., parentID: ${parentID ? parentID.substring(0, 8) + "..." : "none"}, agents count: ${agents.size}`,
					);

					agents.set(id, {
						id,
						parentID: parentID ?? null,
						folder: folderName(directory),
						folderFull: directory,
						title: title ?? null,
						status: "idle",
						tool: null,
						message: "✨ created",
						since: Date.now(),
						color: hueFromId(id),
					});

					log("info", `Agent added, total agents: ${agents.size}`);
					broadcast();
					openViewer();
					break;
				}

				// Session updated (includes when session is resumed/focused)
				case "session.updated": {
					const sessionInfo = props.info as {
						id: string;
						title?: string;
					};
					const id = sessionInfo.id;
					const title = sessionInfo.title;

					log(
						"info",
						`Session updated: ${id.substring(0, 8)}..., agents count: ${agents.size}`,
					);

					// If agent doesn't exist yet, create it (edge case - session resumed but not created in this instance)
					if (!agents.has(id)) {
						agents.set(id, {
							id,
							parentID: null,
							folder: folderName(directory),
							folderFull: directory,
							title: title ?? null,
							status: "idle",
							tool: null,
							message: null,
							since: Date.now(),
							color: hueFromId(id),
						});
						log(
							"info",
							`Agent added via session.updated, total agents: ${agents.size}`,
						);
					} else {
						// Update existing agent - it was resumed
						// Also update title if provided
						const updatePatch: Partial<AgentState> = {
							status: "idle",
							tool: null,
							message: "↩️ resumed",
						};
						if (title) {
							updatePatch.title = title;
						}
						updateAgent(id, updatePatch);
					}
					broadcast();
					openViewer();
					break;
				}

				// Session deleted / closed
				case "session.deleted": {
					const deletedSessionInfo = props.info as { id: string };
					agents.delete(deletedSessionInfo.id);
					broadcast();
					break;
				}

				// Session went idle (agent finished its turn)
				case "session.idle": {
					const sessionID = props.sessionID as string;
					if (!sessionID || !agents.has(sessionID)) return;
					updateAgent(sessionID, {
						status: "idle",
						tool: null,
						message: "💤 waiting",
					});
					break;
				}

				// Status updates (thinking, etc)
				case "session.status": {
					const sessionID = props.sessionID as string;
					const status = (props.status as string).toLowerCase();
					if (!sessionID || !agents.has(sessionID)) return;
					if (status === "thinking" || status === "generating") {
						updateAgent(sessionID, {
							status: "thinking",
							message: "🧠 thinking…",
						});
					}
					break;
				}

				// Session error
				case "session.error": {
					const sessionID = props.sessionID as string;
					if (!sessionID || !agents.has(sessionID)) return;
					updateAgent(sessionID, { status: "error", message: "❌ error" });
					break;
				}

				// Message updated — grab last user-visible content for speech bubble
				case "message.updated": {
					const messageInfo = props.info as {
						id: string;
						sessionID: string;
						role: string;
					};
					const sessionID = messageInfo?.sessionID;
					if (!sessionID || !agents.has(sessionID)) return;
					// Only care about assistant messages
					if (messageInfo?.role !== "assistant") return;
					updateAgent(sessionID, {
						status: "thinking",
						message: "🧠 thinking…",
					});
					break;
				}

				// Permission needed — agent is blocked waiting for human
				case "permission.updated": {
					const sessionID = (props as { sessionID: string }).sessionID;
					if (!sessionID || !agents.has(sessionID)) return;
					updateAgent(sessionID, {
						status: "waiting",
						message: "⚠️ needs permission",
					});
					break;
				}

				case "permission.replied": {
					const sessionID = (props as { sessionID: string }).sessionID;
					if (!sessionID || !agents.has(sessionID)) return;
					updateAgent(sessionID, {
						status: "thinking",
						message: "🧠 thinking…",
					});
					break;
				}
			}
		},
	};
};
