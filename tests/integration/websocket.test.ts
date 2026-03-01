/**
 * tests/integration/websocket.test.ts
 * Integration tests for WebSocket communication
 */

import { afterEach, describe, expect, it } from "bun:test";

describe("WebSocket Server", () => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let server: any | null = null;
	const TEST_PORT = 2728;

	afterEach(() => {
		if (server) {
			server.stop();
			server = null;
		}
	});

	it("should start WebSocket server on specified port", async () => {
		server = Bun.serve({
			port: TEST_PORT,
			fetch(req, srv) {
				if (srv.upgrade(req)) {
					return undefined;
				}
				return new Response("Not Found", { status: 404 });
			},
			websocket: {
				open() {},
				close() {},
				message() {},
			},
		});

		expect(server).toBeDefined();
		expect(server.port).toBe(TEST_PORT);
	});

	it("should accept WebSocket connections", async () => {
		let connected = false;

		server = Bun.serve({
			port: TEST_PORT,
			fetch(req, srv) {
				if (srv.upgrade(req)) {
					return undefined;
				}
				return new Response("Upgrade failed", { status: 400 });
			},
			websocket: {
				open() {
					connected = true;
				},
				close() {},
				message() {},
			},
		});

		const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
		await new Promise<void>((resolve, reject) => {
			ws.onopen = () => resolve();
			ws.onerror = () => reject(new Error("Connection failed"));
			setTimeout(() => reject(new Error("Connection timeout")), 1000);
		});

		expect(connected).toBe(true);
		ws.close();
	});

	it("should broadcast messages to all connected clients", async () => {
		server = Bun.serve({
			port: TEST_PORT,
			fetch(req, srv) {
				if (srv.upgrade(req)) {
					return undefined;
				}
				return new Response("Upgrade failed", { status: 400 });
			},
			websocket: {
				open(ws) {
					ws.send(JSON.stringify({ type: "snapshot", agents: [] }));
				},
				close() {},
				message() {},
			},
		});

		const ws1 = new WebSocket(`ws://localhost:${TEST_PORT}`);
		const ws2 = new WebSocket(`ws://localhost:${TEST_PORT}`);

		const waitForMessage = (ws: WebSocket) =>
			new Promise<string>((resolve) => {
				ws.onmessage = (ev) => resolve(ev.data);
			});

		const [msg1, msg2] = await Promise.all([
			waitForMessage(ws1),
			waitForMessage(ws2),
		]);

		expect(JSON.parse(msg1)).toEqual({ type: "snapshot", agents: [] });
		expect(JSON.parse(msg2)).toEqual({ type: "snapshot", agents: [] });

		ws1.close();
		ws2.close();
	});

	it("should handle client disconnection", async () => {
		let closed = false;

		server = Bun.serve({
			port: TEST_PORT,
			fetch(req, srv) {
				if (srv.upgrade(req)) {
					return undefined;
				}
				return new Response("Upgrade failed", { status: 400 });
			},
			websocket: {
				open() {},
				close() {
					closed = true;
				},
				message() {},
			},
		});

		const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
		await new Promise<void>((resolve) => {
			ws.onopen = () => resolve();
		});

		ws.close();
		await delay(100);

		expect(closed).toBe(true);
	});

	it("should handle multiple connections and disconnections", async () => {
		let connectionCount = 0;
		let disconnectionCount = 0;

		server = Bun.serve({
			port: TEST_PORT,
			fetch(req, srv) {
				if (srv.upgrade(req)) {
					return undefined;
				}
				return new Response("Upgrade failed", { status: 400 });
			},
			websocket: {
				open() {
					connectionCount++;
				},
				close() {
					disconnectionCount++;
				},
				message() {},
			},
		});

		const wss = [
			new WebSocket(`ws://localhost:${TEST_PORT}`),
			new WebSocket(`ws://localhost:${TEST_PORT}`),
			new WebSocket(`ws://localhost:${TEST_PORT}`),
		];

		await Promise.all(
			wss.map(
				(ws) =>
					new Promise<void>((resolve) => {
						ws.onopen = () => resolve();
					}),
			),
		);

		expect(connectionCount).toBe(3);

		wss.forEach((ws) => {
			ws.close();
		});
		await delay(100);

		expect(disconnectionCount).toBe(3);
	});

	it("should reject non-WebSocket requests", async () => {
		server = Bun.serve({
			port: TEST_PORT,
			fetch() {
				return new Response("Not Found", { status: 404 });
			},
			websocket: {
				open() {},
				close() {},
				message() {},
			},
		});

		const response = await fetch(`http://localhost:${TEST_PORT}/`);
		expect(response.status).toBe(404);
	});
});

describe("WebSocket Protocol", () => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let server: any | null = null;
	const TEST_PORT = 2729;

	afterEach(() => {
		if (server) {
			server.stop();
			server = null;
		}
	});

	it("should send snapshot message on connect", async () => {
		server = Bun.serve({
			port: TEST_PORT,
			fetch(req, srv) {
				if (srv.upgrade(req)) {
					return undefined;
				}
				return new Response("Upgrade failed", { status: 400 });
			},
			websocket: {
				open(ws) {
					ws.send(
						JSON.stringify({
							type: "snapshot",
							agents: [
								{
									id: "test-1",
									folder: "test-project",
									status: "idle",
									color: 180,
								},
							],
						}),
					);
				},
				close() {},
				message() {},
			},
		});

		const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
		const message = await new Promise<unknown>((resolve) => {
			ws.onmessage = (ev) => resolve(JSON.parse(ev.data));
		});

		expect(message).toEqual({
			type: "snapshot",
			agents: [
				{
					id: "test-1",
					folder: "test-project",
					status: "idle",
					color: 180,
				},
			],
		});

		ws.close();
	});

	it("should handle heartbeat messages", async () => {
		let heartbeatCount = 0;

		server = Bun.serve({
			port: TEST_PORT,
			fetch(req, srv) {
				if (srv.upgrade(req)) {
					return undefined;
				}
				return new Response("Upgrade failed", { status: 400 });
			},
			websocket: {
				open(ws) {
					const interval = setInterval(() => {
						ws.send(
							JSON.stringify({ type: "heartbeat", timestamp: Date.now() }),
						);
						heartbeatCount++;
						if (heartbeatCount >= 2) {
							clearInterval(interval);
						}
					}, 100);
				},
				close() {},
				message() {},
			},
		});

		const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);

		await new Promise<void>((resolve) => {
			let count = 0;
			ws.onmessage = () => {
				count++;
				if (count >= 2) resolve();
			};
		});

		expect(heartbeatCount).toBeGreaterThanOrEqual(2);
		ws.close();
	});

	it("should handle server closing message", async () => {
		server = Bun.serve({
			port: TEST_PORT,
			fetch(req, srv) {
				if (srv.upgrade(req)) {
					return undefined;
				}
				return new Response("Upgrade failed", { status: 400 });
			},
			websocket: {
				open(ws) {
					ws.send(JSON.stringify({ type: "serverclosing", reason: "test" }));
				},
				close() {},
				message() {},
			},
		});

		const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
		const message = await new Promise<unknown>((resolve) => {
			ws.onmessage = (ev) => resolve(JSON.parse(ev.data));
		});

		expect(message).toEqual({
			type: "serverclosing",
			reason: "test",
		});

		ws.close();
	});

	it("should handle agent update messages from client instances", async () => {
		const receivedMessages: unknown[] = [];

		server = Bun.serve({
			port: TEST_PORT,
			fetch(req, srv) {
				if (srv.upgrade(req)) {
					return undefined;
				}
				return new Response("Upgrade failed", { status: 400 });
			},
			websocket: {
				open() {},
				close() {},
				message(ws, message) {
					try {
						const data = JSON.parse(message.toString());
						receivedMessages.push(data);
						if (data.type === "agent_update" || data.type === "full_sync") {
							ws.send(
								JSON.stringify({ type: "snapshot", agents: data.agents }),
							);
						}
					} catch {
						// Ignore parse errors
					}
				},
			},
		});

		const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
		await new Promise<void>((resolve) => {
			ws.onopen = () => resolve();
		});

		ws.send(
			JSON.stringify({
				type: "full_sync",
				agents: [
					{ id: "test-agent", folder: "test", status: "idle", color: 200 },
				],
			}),
		);

		await delay(100);

		expect(receivedMessages.length).toBeGreaterThan(0);
		expect((receivedMessages[0] as { type: string }).type).toBe("full_sync");

		ws.close();
	});
});

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
