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
	idleSince: number | null; // timestamp when subagent went idle (for cleanup)
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

		// If we're a client instance, send incremental updates instead of full snapshot
		// to avoid overwriting other instances' agents
		if (syncWs && syncWs.readyState === WebSocket.OPEN) {
			const updateMsg = JSON.stringify({
				type: "agent_update",
				agents: [...agents.values()],
			});
			syncWs.send(updateMsg);
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
	let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
	let idleCleanupInterval: ReturnType<typeof setInterval> | null = null;

	// Start heartbeat to send periodic pings and prevent connection timeouts
	function startHeartbeat() {
		if (heartbeatInterval) return;
		heartbeatInterval = setInterval(() => {
			const heartbeatMsg = JSON.stringify({
				type: "heartbeat",
				timestamp: Date.now(),
			});
			// Also broadcast current state periodically to keep clients in sync
			const snapshotMsg = JSON.stringify({
				type: "snapshot",
				agents: [...agents.values()],
			});
			for (const ws of clients) {
				if (ws.readyState === WebSocket.OPEN) {
					// Send heartbeat
					ws.send(heartbeatMsg);
					// Also send current state to ensure clients stay synced
					ws.send(snapshotMsg);
				}
			}
		}, 25000); // Heartbeat every 25 seconds
	}

	// Start cleanup interval to remove idle subagents after 10 seconds
	function startIdleCleanup() {
		if (idleCleanupInterval) return;
		idleCleanupInterval = setInterval(() => {
			const now = Date.now();
			const toDelete: string[] = [];

			for (const [id, agent] of agents) {
				// Only cleanup subagents (have parentID) that have been idle for 10+ seconds
				if (agent.parentID && agent.status === "idle" && agent.idleSince) {
					const idleTime = now - agent.idleSince;
					if (idleTime > 10000) {
						// 10 seconds
						toDelete.push(id);
					}
				}
			}

			if (toDelete.length > 0) {
				for (const id of toDelete) {
					agents.delete(id);
				}
				broadcast();
			}
		}, 1000); // Check every second
	}

	try {
		wss = Bun.serve({
			port: PORT,
			fetch(req, server) {
				// Handle WebSocket upgrade
				const url = new URL(req.url);
				if (url.pathname === "/ws" || url.pathname === "/") {
					const success = server.upgrade(req, { data: {} });
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
						if (msg.type === "agent_update") {
							// Merge incoming agents from client instances - ADD only, don't remove
							for (const agent of msg.agents) {
								if (!agents.has(agent.id)) {
									agents.set(agent.id, agent);
								} else {
									// Update existing agent with newer data
									const existing = agents.get(agent.id)!;
									// Only update if the incoming agent has a newer 'since' timestamp
									if (agent.since >= existing.since) {
										Object.assign(existing, agent);
									}
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
		startHeartbeat();
		startIdleCleanup();
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

		// Stop intervals
		if (heartbeatInterval) {
			clearInterval(heartbeatInterval);
			heartbeatInterval = null;
		}
		if (idleCleanupInterval) {
			clearInterval(idleCleanupInterval);
			idleCleanupInterval = null;
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
						idleSince: null,
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
							idleSince: null,
						});
						log(
							"info",
							`Agent added via session.updated, total agents: ${agents.size}`,
						);
					} else {
						// Agent already exists - check if it was just created (session.created already ran)
						// If message is "✨ created", don't override with "resumed"
						const existing = agents.get(id)!;
						const isNewSession = existing.message === "✨ created";

						// Active states that should NOT be overwritten with "resumed"
						const activeStates: AgentStatus[] = [
							"thinking",
							"editing",
							"reading",
							"running",
						];
						const isActive = activeStates.includes(existing.status);

						// Sub-agents should never show "resumed" - they just show status indicators
						const isSubAgent = existing.parentID !== null;

						// Build update patch based on current state
						const updatePatch: Partial<AgentState> = {};

						if (isActive) {
							// Preserve active state and current message - don't show "resumed"
							// The agent is doing something (thinking, editing, etc.), keep showing that
						} else if (isNewSession || isSubAgent) {
							// New sessions and sub-agents don't show "resumed", just stay in their current idle/waiting state
							updatePatch.status = "idle";
							updatePatch.tool = null;
							updatePatch.message = null;
						} else {
							// Only show "resumed" for truly resumed idle/waiting main agents
							updatePatch.status = "idle";
							updatePatch.tool = null;
							updatePatch.message = "↩️ resumed";
						}

						if (title) {
							updatePatch.title = title;
						}

						// Only update if we have changes to make
						if (Object.keys(updatePatch).length > 0) {
							updateAgent(id, updatePatch);
						}
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
					const agent = agents.get(sessionID)!;
					const isSubagent = agent.parentID !== null;
					updateAgent(sessionID, {
						status: "idle",
						tool: null,
						message: isSubagent ? "💤 done" : "💤 waiting",
						idleSince: isSubagent ? Date.now() : null,
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
