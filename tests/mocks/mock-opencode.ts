/**
 * tests/mocks/mock-opencode.ts
 * Mock OpenCode plugin environment for testing
 */

import type { Plugin } from "@opencode-ai/plugin";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MockLogEntry {
	level: "debug" | "info" | "warn" | "error";
	message: string;
	service: string;
	timestamp: number;
}

export interface MockSession {
	id: string;
	parentID?: string;
	title: string;
	folder: string;
}

export interface MockPluginContext {
	directory: string;
	client: {
		app: {
			log: (entry: {
				body: { service: string; level: string; message: string };
			}) => Promise<void>;
		};
	};
	$: (
		strings: TemplateStringsArray,
		...values: unknown[]
	) => Promise<{ exited: Promise<number> }>;
}

export interface MockHooks {
	"tool.execute.before": Array<
		(input: unknown, output?: unknown) => Promise<void>
	>;
	"tool.execute.after": Array<
		(input: unknown, output?: unknown) => Promise<void>
	>;
	event: Array<(input: unknown) => Promise<void>>;
}

// ─── Mock Context Factory ─────────────────────────────────────────────────────

export function createMockContext(
	directory = "/test/project",
): MockPluginContext {
	const logs: MockLogEntry[] = [];

	return {
		directory,
		client: {
			app: {
				log: async (entry) => {
					logs.push({
						level: entry.body.level as MockLogEntry["level"],
						message: entry.body.message,
						service: entry.body.service,
						timestamp: Date.now(),
					});
				},
			},
		},
		$: async (strings, ...values) => {
			const command = strings.reduce(
				(acc, str, i) => acc + str + (values[i] || ""),
				"",
			);
			console.log(`[Mock Shell] ${command}`);
			return { exited: Promise.resolve(0) };
		},
	};
}

// ─── Mock Plugin Instance ─────────────────────────────────────────────────────

export interface MockPluginInstance {
	hooks: MockHooks;
	logs: MockLogEntry[];
	triggerToolExecuteBefore: (
		input: { sessionID: string; tool: string; callID: string },
		output?: unknown,
	) => Promise<void>;
	triggerToolExecuteAfter: (input: {
		sessionID: string;
		tool: string;
	}) => Promise<void>;
	triggerEvent: (
		type: string,
		properties: Record<string, unknown>,
	) => Promise<void>;
	createSession: (
		id: string,
		title: string,
		parentID?: string,
	) => Promise<void>;
	updateSession: (id: string, title?: string) => Promise<void>;
	deleteSession: (id: string) => Promise<void>;
	setSessionIdle: (id: string) => Promise<void>;
	setSessionStatus: (id: string, status: string) => Promise<void>;
	setSessionError: (id: string) => Promise<void>;
	updateMessage: (
		sessionID: string,
		messageId: string,
		role: string,
	) => Promise<void>;
	updatePermission: (
		sessionID: string,
		type: "updated" | "replied",
	) => Promise<void>;
}

export async function createMockPlugin(
	pluginFactory: Plugin,
	directory = "/test/project",
): Promise<MockPluginInstance> {
	const context = createMockContext(directory);
	const hooks: MockHooks = {
		"tool.execute.before": [],
		"tool.execute.after": [],
		event: [],
	};

	// Create a proxy plugin that captures hooks
	const proxyPlugin: Plugin = async (ctx) => {
		const result = await pluginFactory(ctx);

		// Capture hook registrations
		if (result["tool.execute.before"]) {
			hooks["tool.execute.before"].push(
				result["tool.execute.before"] as (
					input: unknown,
					output?: unknown,
				) => Promise<void>,
			);
		}
		if (result["tool.execute.after"]) {
			hooks["tool.execute.after"].push(
				result["tool.execute.after"] as (
					input: unknown,
					output?: unknown,
				) => Promise<void>,
			);
		}
		if (result.event) {
			hooks.event.push(result.event as (input: unknown) => Promise<void>);
		}

		return result;
	};

	// Initialize the plugin
	await proxyPlugin(context as unknown as Parameters<Plugin>[0]);

	return {
		hooks,
		logs: [],

		async triggerToolExecuteBefore(input, output) {
			for (const hook of hooks["tool.execute.before"]) {
				await hook(input, output ?? {});
			}
		},

		async triggerToolExecuteAfter(input) {
			for (const hook of hooks["tool.execute.after"]) {
				await hook(input);
			}
		},

		async triggerEvent(type, properties) {
			for (const hook of hooks.event) {
				await hook({ event: { type, properties } });
			}
		},

		async createSession(id, title, parentID) {
			await this.triggerEvent("session.created", {
				info: { id, parentID, title },
			});
		},

		async updateSession(id, title) {
			await this.triggerEvent("session.updated", {
				info: { id, title },
			});
		},

		async deleteSession(id) {
			await this.triggerEvent("session.deleted", {
				info: { id },
			});
		},

		async setSessionIdle(id) {
			await this.triggerEvent("session.idle", { sessionID: id });
		},

		async setSessionStatus(id, status) {
			await this.triggerEvent("session.status", { sessionID: id, status });
		},

		async setSessionError(id) {
			await this.triggerEvent("session.error", { sessionID: id });
		},

		async updateMessage(sessionID, messageId, role) {
			await this.triggerEvent("message.updated", {
				info: { id: messageId, sessionID, role },
			});
		},

		async updatePermission(sessionID, type) {
			await this.triggerEvent(`permission.${type}`, { sessionID });
		},
	};
}

// ─── Test Utilities ───────────────────────────────────────────────────────────

export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function generateSessionId(): string {
	return `sess_${Math.random().toString(36).substring(2, 15)}_${Date.now().toString(36)}`;
}

export function generateCallId(): string {
	return `call_${Math.random().toString(36).substring(2, 11)}`;
}

// ─── WebSocket Mock ───────────────────────────────────────────────────────────

export class MockWebSocketClient {
	public messages: unknown[] = [];
	public connected = false;
	private messageHandlers: Array<(data: unknown) => void> = [];

	constructor(public url: string) {}

	onmessage(handler: (data: unknown) => void) {
		this.messageHandlers.push(handler);
	}

	connect() {
		this.connected = true;
	}

	disconnect() {
		this.connected = false;
	}

	receiveMessage(data: unknown) {
		this.messages.push(data);
		for (const handler of this.messageHandlers) {
			handler(data);
		}
	}

	send(data: string) {
		this.messages.push(JSON.parse(data));
	}
}
