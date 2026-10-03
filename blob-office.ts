/**
 * blob-office.ts
 * Global OpenCode plugin - drop into ~/.config/opencode/plugins/
 *
 * OpenCode V2 plugin API: default-exports a definition with an `id` and
 * `setup(ctx)`. Registers a WebSocket server on ws://localhost:2727 and
 * broadcasts live session state to the blob-office viewer (blob-office.html).
 *
 * Install:
 *   cp blob-office.ts ~/.config/opencode/plugins/
 *   cp blob-office.html ~/.config/opencode/plugins/
 *   restart OpenCode
 *
 * Windows notes: Bun does not always define HOME (falls back to USERPROFILE)
 * and system notifications are macOS-only.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentStatus =
	| "idle"
	| "thinking"
	| "editing"
	| "reading"
	| "running"
	| "waiting"
	| "error";

// Viewer open frequency settings
type ViewerOpenFrequency = "once-per-day" | "every-session";

interface BlobOfficeSettings {
	viewerOpenFrequency: ViewerOpenFrequency;
}

interface AgentState {
	id: string;
	parentID: string | null; // ID of parent agent if this is a subagent
	folder: string;
	folderFull: string;
	title: string | null;
	status: AgentStatus;
	tool: string | null; // current tool being executed
	message: string | null; // speech bubble text
	since: number; // last update timestamp
	color: number; // hue 0-360
	idleSince: number | null; // timestamp when subagent went idle (for cleanup)
	activityScale: number; // visual scale based on file activity
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function hueFromId(id: string): number {
	let h = 0;
	for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
	return h % 360;
}

export function folderName(path: string): string {
	return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

// V2 tool names: `bash` -> `shell`, `task` -> `subagent`, plus code-mode
// `execute` and plugin/MCP tools (e.g. browser_*).
export const TOOL_STATUS: Record<string, AgentStatus> = {
	write: "editing",
	edit: "editing",
	patch: "editing",
	multiedit: "editing",
	todowrite: "editing",
	read: "reading",
	glob: "reading",
	grep: "reading",
	list: "reading",
	ls: "reading",
	webfetch: "reading",
	websearch: "reading",
	todoread: "reading",
	skill: "reading",
	shell: "running",
	bash: "running",
	execute: "running",
	task: "thinking",
	subagent: "thinking",
};

export function toolStatus(tool: string): AgentStatus {
	// Plugin and MCP tools are namespaced (browser_evaluate, mcp__*, ...)
	// so match on the prefix too.
	if (TOOL_STATUS[tool.toLowerCase()]) return TOOL_STATUS[tool.toLowerCase()];
	if (/^(browser|chrome)/i.test(tool)) return "running";
	if (/^(mcp__|mcp\.)/i.test(tool)) return "running";
	return "thinking";
}

export function toolLabel(tool: string): string {
	const labels: Record<string, string> = {
		write: "✏️ writing",
		edit: "✏️ editing",
		patch: "✏️ editing",
		multiedit: "✏️ editing",
		read: "📖 reading",
		glob: "🔍 searching",
		grep: "🔍 searching",
		list: "📂 listing",
		ls: "📂 listing",
		shell: "💻 running",
		bash: "💻 running",
		execute: "💻 running",
		webfetch: "🌐 fetching",
		websearch: "🌐 searching",
		task: "🤖 spawning",
		subagent: "🤖 spawning",
		todoread: "📋 todos",
		todowrite: "📋 updating",
		skill: "📚 loading skill",
	};
	return labels[tool.toLowerCase()] ?? `🔧 ${tool}`;
}

const IGNORE_PATTERNS = [
	"node_modules",
	".git",
	"dist",
	"build",
	"__pycache__",
	".venv",
	"vendor",
	".next",
	".cache",
	".DS_Store",
];

export const agentFileActivity = new Map<string, Set<string>>();

export function isIgnored(filePath: string): boolean {
	const parts = filePath.split(/[/\\]/);
	return parts.some((part) => IGNORE_PATTERNS.includes(part));
}

export function recordFileActivity(agentId: string, filePath: string): void {
	if (!agentFileActivity.has(agentId)) {
		agentFileActivity.set(agentId, new Set());
	}
	agentFileActivity.get(agentId)!.add(filePath);
}

export function getActivityScale(agentId: string): number {
	const files = agentFileActivity.get(agentId)?.size ?? 0;
	// Logarithmic scale: 1 file -> 1.0, 10 files -> 1.15, 100 files -> 1.3
	const scale = 1.0 + Math.log10(Math.max(files, 1)) * 0.15;
	return Math.min(Math.max(scale, 1.0), 2.5);
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default {
	id: "blob-office",

	async setup(ctx: any) {
		// Clear any stale activity data from previous sessions
		agentFileActivity.clear();

		const directory: string =
			ctx?.location?.directory ?? process.cwd();
		const PORT = 2727;
		const agents = new Map<string, AgentState>();
		const clients = new Set<globalThis.WebSocket>();
		const disposedAgents = new Set<string>();

		// Helper for logging. V2 exposes ctx.app, but app.log is not guaranteed
		// on every release, so always echo to the server console as a fallback.
		const log = async (
			level: "debug" | "info" | "warn" | "error",
			msg: string,
		) => {
			const line = `[blob-office] ${msg}`;
			try {
				// eslint-disable-next-line no-console
				console.log(line);
			} catch {
				/* ignore */
			}
			try {
				await ctx?.app?.log?.({
					body: { service: "blob-office", level, message: msg },
				});
			} catch {
				/* logging unavailable on this release */
			}
		};

		// Helper to show system notification (macOS only; no-op elsewhere)
		const notify = async (title: string, message: string) => {
			if (process.platform !== "darwin") return;
			try {
				const proc = Bun.spawn(
					["osascript", "-e", `display notification "${message}" with title "${title}"`],
					{ stdout: "ignore", stderr: "ignore" },
				);
				await proc.exited;
			} catch {
				// Silently fail if notifications aren't available
			}
		};

		// ── Broadcast ────────────────────────────────────────────────────────────

		let syncWs: WebSocket | null = null;
		let broadcastTimeout: ReturnType<typeof setTimeout> | null = null;
		const BROADCAST_DEBOUNCE_MS = 50;

		function broadcast() {
			if (broadcastTimeout) clearTimeout(broadcastTimeout);

			broadcastTimeout = setTimeout(() => {
				broadcastTimeout = null;
				const msg = JSON.stringify({
					type: "snapshot",
					agents: [...agents.values()],
				});

				for (const ws of clients) {
					if (ws.readyState === WebSocket.OPEN) ws.send(msg);
				}

				// Client instances send incremental updates so they do not
				// overwrite the server instance's agents
				if (syncWs && syncWs.readyState === WebSocket.OPEN) {
					syncWs.send(
						JSON.stringify({
							type: "agent_update",
							agents: [...agents.values()],
						}),
					);
				}
			}, BROADCAST_DEBOUNCE_MS);
		}

		function updateAgent(id: string, patch: Partial<AgentState>) {
			const a = agents.get(id);
			if (!a) return;
			Object.assign(a, patch, { since: Date.now() });
			disposedAgents.delete(id);
			broadcast();
		}

		function addAgent(input: {
			id: string;
			parentID?: string | null;
			title?: string | null;
			folder?: string;
			folderFull?: string;
			message?: string | null;
			status?: AgentStatus;
		}): boolean {
			const { id } = input;
			if (agents.has(id)) return false;
			agents.set(id, {
				id,
				parentID: input.parentID ?? null,
				folder: input.folder ?? folderName(directory),
				folderFull: input.folderFull ?? directory,
				title: input.title ?? null,
				status: input.status ?? "idle",
				tool: null,
				message: input.message ?? "✨ created",
				since: Date.now(),
				color: hueFromId(id),
				idleSince: null,
				activityScale: 1.0,
			});
			return true;
		}

		// ── Viewer auto-open ─────────────────────────────────────────────────────

		let browserOpened = false;

		// Windows: Bun does not always define HOME, fall back to USERPROFILE
		const HOME_DIR = process.env.HOME || process.env.USERPROFILE || ".";
		const PLUGIN_DIR = `${HOME_DIR}/.config/opencode/plugins`;
		const MARKER_FILE = `${PLUGIN_DIR}/.viewer-opened-today`;
		const SETTINGS_FILE = `${PLUGIN_DIR}/blob-office.settings.json`;

		const DEFAULT_SETTINGS: BlobOfficeSettings = {
			viewerOpenFrequency: "once-per-day",
		};

		async function loadSettings(): Promise<BlobOfficeSettings> {
			try {
				const file = Bun.file(SETTINGS_FILE);
				if (!(await file.exists())) return DEFAULT_SETTINGS;
				const content = (await file.json()) as Partial<BlobOfficeSettings>;
				return { ...DEFAULT_SETTINGS, ...content };
			} catch {
				return DEFAULT_SETTINGS;
			}
		}

		let serverWasAlreadyRunning = false;

		function getTodayDate(): string {
			return new Date().toISOString().split("T")[0];
		}

		async function wasOpenedToday(): Promise<boolean> {
			try {
				const file = Bun.file(MARKER_FILE);
				if (!(await file.exists())) return false;
				return (await file.text()).trim() === getTodayDate();
			} catch {
				return false;
			}
		}

		async function markOpenedToday(): Promise<void> {
			try {
				await Bun.write(MARKER_FILE, getTodayDate());
			} catch {
				// Ignore - non-critical
			}
		}

		async function openViewer(agentCount: number) {
			if (browserOpened) return;
			if (clients.size > 0) {
				await log("info", `Viewer already open (${clients.size} clients), skipping`);
				return;
			}

			const settings = await loadSettings();
			const isFirstAgent = agentCount === 0;

			if (!isFirstAgent && settings.viewerOpenFrequency === "once-per-day") {
				if (await wasOpenedToday()) return;
			}

			const viewer = `${PLUGIN_DIR}/blob-office.html`;
			if (!(await Bun.file(viewer).exists())) {
				await log("warn", `Viewer missing at ${viewer} - copy blob-office.html there`);
				return;
			}

			const cmd =
				process.platform === "darwin"
					? ["open", viewer]
					: process.platform === "win32"
						? ["cmd", "/c", "start", "", viewer]
						: ["xdg-open", viewer];

			try {
				const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
				await proc.exited;
				browserOpened = true;
				await markOpenedToday();
				await log("info", "Viewer opened successfully");
			} catch {
				await log("info", `Open viewer manually: ${viewer}`);
			}
		}

		// ── WebSocket server ─────────────────────────────────────────────────────

		let wss: { stop: (closeActiveConnections?: boolean) => void } | null = null;
		let isServerInstance = false;
		let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
		let idleCleanupInterval: ReturnType<typeof setInterval> | null = null;

		function startHeartbeat() {
			if (heartbeatInterval) return;
			heartbeatInterval = setInterval(() => {
				const heartbeatMsg = JSON.stringify({
					type: "heartbeat",
					timestamp: Date.now(),
				});
				const snapshotMsg = JSON.stringify({
					type: "snapshot",
					agents: [...agents.values()],
				});
				for (const ws of clients) {
					if (ws.readyState !== WebSocket.OPEN) continue;
					ws.send(heartbeatMsg);
					ws.send(snapshotMsg);
				}
			}, 25000);
		}

		function startIdleCleanup() {
			if (idleCleanupInterval) return;
			idleCleanupInterval = setInterval(() => {
				const now = Date.now();
				const toDelete: string[] = [];

				for (const [id, agent] of agents) {
					// Disposed main agents (user exited) after 10s of inactivity
					if (!agent.parentID && disposedAgents.has(id)) {
						if (now - agent.since > 10000) {
							toDelete.push(id);
							disposedAgents.delete(id);
						}
					}
					// Idle subagents after 3s
					if (agent.parentID && agent.status === "idle" && agent.idleSince) {
						if (now - agent.idleSince > 3000) toDelete.push(id);
					}
				}

				if (toDelete.length > 0) {
					for (const id of toDelete) {
						agents.delete(id);
						agentFileActivity.delete(id);
					}
					broadcast();
				}
			}, 1000);
		}

		try {
			wss = Bun.serve({
				port: PORT,
				fetch(req: Request, server: any) {
					const url = new URL(req.url);
					if (url.pathname === "/ws" || url.pathname === "/") {
						const success = server.upgrade(req, { data: {} });
						if (success) return undefined;
						return new Response("WebSocket upgrade failed", { status: 400 });
					}
					return new Response("Not Found", { status: 404 });
				},
				websocket: {
					open(ws: any) {
						void log("info", "Client connected");
						void notify("Blob Office", "Viewer connected");
						clients.add(ws as globalThis.WebSocket);
						ws.send(
							JSON.stringify({
								type: "snapshot",
								agents: [...agents.values()],
							}),
						);
					},
					close(ws: any) {
						void log("info", "Client disconnected");
						clients.delete(ws as globalThis.WebSocket);
					},
					message(ws: any, message: any) {
						// Merge state forwarded by other plugin instances
						try {
							const msg = JSON.parse(message.toString());
							if (
								msg.type === "agent_update" ||
								msg.type === "full_sync" ||
								msg.type === "snapshot"
							) {
								for (const agent of msg.agents) {
									const existing = agents.get(agent.id);
									if (!existing) {
										agents.set(agent.id, agent);
									} else if (agent.since >= existing.since) {
										Object.assign(existing, agent);
									}
								}
								void log(
									"info",
									`Merged ${msg.agents.length} agents from client, total: ${agents.size}`,
								);
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
			void log("info", `WebSocket server running on ws://localhost:${PORT}`);
		} catch (err) {
			if ((err as NodeJS.ErrnoException)?.code === "EADDRINUSE") {
				void log(
					"warn",
					`Port ${PORT} already in use - connecting to existing server as client`,
				);
				serverWasAlreadyRunning = true;
				syncWs = new WebSocket(`ws://localhost:${PORT}`);

				syncWs.onopen = () => {
					void log("info", "Connected to existing Blob Office server as client");
					if (agents.size > 0) {
						syncWs?.send(
							JSON.stringify({ type: "full_sync", agents: [...agents.values()] }),
						);
					}
				};

				syncWs.onmessage = (ev) => {
					try {
						const msg = JSON.parse(ev.data);
						if (msg.type === "snapshot") {
							for (const agent of msg.agents) {
								if (!agents.has(agent.id)) agents.set(agent.id, agent);
							}
						}
					} catch {
						/* ignore */
					}
				};

				syncWs.onerror = () => {
					void log("warn", "Error connecting to existing server");
				};
			} else {
				void log("error", `Failed to start WebSocket server: ${err}`);
			}
		}

		// ── Tool hooks ───────────────────────────────────────────────────────────

		// V1: "tool.execute.before": async (input, output) => {}
		// V2: ctx.tool.hook("execute.before", event => {}) - one mutable event
		await ctx.tool
			.hook("execute.before", (event: any) => {
				const sessionID = event.sessionID as string | undefined;
				const tool = (event.tool as string) ?? "";
				if (!sessionID || !tool) return;

				if (["write", "edit", "patch", "multiedit"].includes(tool.toLowerCase())) {
					try {
						const filePath = event.input?.filePath ?? event.input?.path;
						if (filePath && !isIgnored(filePath)) {
							recordFileActivity(sessionID, filePath);
							const agent = agents.get(sessionID);
							if (agent) {
								agent.activityScale = getActivityScale(sessionID);
								broadcast();
							}
						}
					} catch {
						// ignore malformed input
					}
				}

				ensureAgent(sessionID, {
					status: toolStatus(tool),
					tool,
					message: toolLabel(tool),
				});
			})
			.catch(() => {});

		await ctx.tool
			.hook("execute.after", (event: any) => {
				ensureAgent(event.sessionID, {
					status: "thinking",
					tool: null,
					message: "🧠 thinking…",
				});
			})
			.catch(() => {});

		// ── Events ───────────────────────────────────────────────────────────────

		// V1: returned "event" hook. V2: subscribe to the public event stream and
		// abort from the cleanup function returned by setup().
		const controller = new AbortController();

		void (async () => {
			try {
				for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
					handleEvent(event as any);
				}
			} catch (err) {
				if (!controller.signal.aborted) {
					void log("error", `Event subscription ended: ${err}`);
				}
			}
		})();

		function handleEvent(event: any) {
			// V2 events carry the payload on `data` (V1 used `properties`)
			const data = (event?.data ?? {}) as Record<string, any>;
			const type = event?.type as string;

			switch (type) {
				// data: { sessionID, projectID, location, subpath?, parentID?,
				//         slug, title?, agent?, ... }
				case "session.created": {
					const id = data.sessionID as string;
					if (!id || agents.has(id)) return;
					const isNew = addAgent({
						id,
						parentID: data.parentID ?? null,
						title: data.title ?? null,
						folder: folderName(data.location?.directory ?? directory),
						folderFull: data.location?.directory ?? directory,
					});
					if (isNew) {
						void log(
							"info",
							`Session created: ${id.substring(0, 8)}... parent: ${data.parentID ? data.parentID.substring(0, 8) : "none"}, agents: ${agents.size}`,
						);
						broadcast();
						void openViewer(agents.size - 1);
					}
					break;
				}

				// data: { sessionID }
				case "session.deleted": {
					const id = data.sessionID as string;
					if (!id) return;
					agents.delete(id);
					agentFileActivity.delete(id);
					broadcast();
					break;
				}

				// data: { sessionID }
				case "session.idle": {
					const sessionID = data.sessionID as string;
					if (!agents.has(sessionID)) return;
					const isSubagent = agents.get(sessionID)!.parentID !== null;
					updateAgent(sessionID, {
						status: "idle",
						tool: null,
						message: isSubagent ? "💤 done" : "💤 waiting",
						idleSince: isSubagent ? Date.now() : null,
					});
					break;
				}

				// data: { sessionID, status } - status includes "busy"
				case "session.status": {
					const sessionID = data.sessionID as string;
					const status = String(data.status ?? "").toLowerCase();
					if (!sessionID) return;
					if (status === "busy" || status === "thinking" || status === "generating") {
						ensureAgent(sessionID, { status: "thinking", message: "🧠 thinking…" });
					}
					break;
				}

				// data: { sessionID?, error }
				case "session.error": {
					ensureAgent(data.sessionID, { status: "error", message: "❌ error" });
					break;
				}

				// data: { sessionID, title }
				case "session.renamed": {
					const sessionID = data.sessionID as string;
					if (!sessionID) return;
					if (!agents.has(sessionID)) {
						addAgent({ id: sessionID, title: data.title ?? null });
						broadcast();
						void openViewer(agents.size - 1);
						break;
					}
					updateAgent(sessionID, { title: data.title ?? null });
					break;
				}

				// data: { sessionID, idle } - session was focused/resumed
				case "session.viewed": {
					const sessionID = data.sessionID as string;
					const agent = sessionID ? agents.get(sessionID) : undefined;
					if (!agent) return;
					const activeStates: AgentStatus[] = [
						"thinking",
						"editing",
						"reading",
						"running",
						"waiting",
					];
					if (activeStates.includes(agent.status)) break;
					updateAgent(sessionID, {
						status: "idle",
						tool: null,
						message: agent.parentID ? null : "↩️ resumed",
					});
					break;
				}

				// data: { sessionID, id, name } - tool name is known here
				case "session.tool.input.started": {
					const tool = (data.name as string) ?? "";
					if (!tool) return;
					ensureAgent(data.sessionID, {
						status: toolStatus(tool),
						tool,
						message: toolLabel(tool),
					});
					break;
				}

				case "session.tool.success":
				case "session.tool.failed": {
					ensureAgent(data.sessionID, {
						status: "thinking",
						tool: null,
						message: "🧠 thinking…",
					});
					break;
				}

				// data: { sessionID, ... } - model is producing output
				case "session.reasoning.started":
				case "session.text.started":
				case "session.step.started": {
					ensureAgent(data.sessionID, {
						status: "thinking",
						tool: null,
						message: "🧠 thinking…",
					});
					break;
				}

				// data: Permission.Request = { id, sessionID, action, resource, ... }
				case "permission.asked": {
					ensureAgent(data.sessionID, {
						status: "waiting",
						message: "⚠️ needs permission",
					});
					break;
				}

				// data: { sessionID, requestID, reply }
				case "permission.replied": {
					const sessionID = data.sessionID as string;
					if (!sessionID || !agents.has(sessionID)) return;
					updateAgent(sessionID, {
						status: "thinking",
						message: "🧠 thinking…",
					});
					break;
				}

				// data: { sessionID, agent, messageID, id, input }
				case "session.execution.started": {
					ensureAgent(data.sessionID, {
						status: "thinking",
						message: "🧠 thinking…",
					});
					break;
				}

				case "session.execution.failed": {
					ensureAgent(data.sessionID, { status: "error", message: "❌ error" });
					break;
				}

				case "session.execution.succeeded":
				case "session.execution.interrupted": {
					const sessionID = data.sessionID as string;
					const agent = sessionID ? agents.get(sessionID) : undefined;
					if (!agent) return;
					const isSubagent = agent.parentID !== null;
					updateAgent(sessionID, {
						status: "idle",
						tool: null,
						message: isSubagent ? "💤 done" : "💤 waiting",
						idleSince: isSubagent ? Date.now() : null,
					});
					break;
				}

				case "server.instance.disposed": {
					// Keep the marker handling for older servers that still emit it
					for (const [id, agent] of agents) {
						if (agent && !agent.parentID) disposedAgents.add(id);
					}
					break;
				}
			}
		}

		// ── Lazy agent creation ───────────────────────────────────────────────────
		// ctx.session has no list() in V2, so agents are created the first time
		// any event mentions a session. That also covers sessions that already
		// existed when the plugin loaded (the service is long-lived).
		const titleLookups = new Set<string>();

		async function hydrateTitle(sessionID: string) {
			if (titleLookups.has(sessionID)) return;
			titleLookups.add(sessionID);
			try {
				const res = await ctx.session?.get?.({ sessionID });
				const info: any = (res as any)?.data ?? res;
				const agent = agents.get(sessionID);
				if (!agent || !info) return;
				if (info.title && !agent.title) {
					updateAgent(sessionID, { title: info.title });
				}
				if (info.parentID !== undefined && agent.parentID === null) {
					updateAgent(sessionID, { parentID: info.parentID ?? null });
				}
			} catch {
				// Title is cosmetic - ignore failures
			}
		}

		function ensureAgent(
			sessionID: string | undefined,
			patch?: Partial<AgentState>,
		): AgentState | undefined {
			if (!sessionID) return undefined;
			let agent = agents.get(sessionID);
			if (!agent) {
				const created = addAgent({ id: sessionID, message: "✨ created" });
				if (created) {
					broadcast();
					void openViewer(agents.size - 1);
					void hydrateTitle(sessionID);
				}
				agent = agents.get(sessionID);
			}
			if (agent && patch) updateAgent(sessionID, patch);
			return agent;
		}

		// ── Cleanup ──────────────────────────────────────────────────────────────

		return async function cleanup() {
			await log("info", "Plugin unloading, shutting down...");

			controller.abort();

			if (broadcastTimeout) {
				clearTimeout(broadcastTimeout);
				broadcastTimeout = null;
			}

			if (syncWs) {
				if (syncWs.readyState === WebSocket.OPEN) {
					syncWs.close(1001, "Client shutting down");
				}
				syncWs = null;
			}

			const closeMsg = JSON.stringify({ type: "serverclosing", reason: "unload" });
			for (const ws of clients) {
				if (ws.readyState === WebSocket.OPEN) {
					ws.send(closeMsg);
					ws.close(1001, "Server shutting down");
				}
			}
			clients.clear();

			if (wss && isServerInstance) {
				wss.stop(true);
				wss = null;
			}

			if (heartbeatInterval) {
				clearInterval(heartbeatInterval);
				heartbeatInterval = null;
			}
			if (idleCleanupInterval) {
				clearInterval(idleCleanupInterval);
				idleCleanupInterval = null;
			}

			agents.clear();
			agentFileActivity.clear();
			await log("info", "Cleanup complete");
		};
	},
};