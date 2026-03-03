// Simple test server to cycle through agent states for mockup generation

const agents = [
	{
		id: "test-agent-123",
		parentID: null,
		folder: "test-project",
		folderFull: "/test/project",
		title: null,
		status: "idle",
		tool: null,
		message: "💤 waiting",
		since: Date.now(),
		color: 200, // blue hue
		idleSince: null,
		activityScale: 1.0,
	},
];

const PORT = 2728;
const clients = new Set<any>();

Bun.serve({
	port: PORT,
	fetch(req, server) {
		const url = new URL(req.url);
		if (url.pathname === "/ws") {
			const success = server.upgrade(req, { data: undefined });
			if (success) return undefined;
			return new Response("WebSocket upgrade failed", { status: 400 });
		}
		return new Response("Not Found", { status: 404 });
	},
	websocket: {
		open(ws) {
			clients.add(ws);
			console.log(`Client connected (${clients.size} total)`);
			broadcast();
		},
		close(ws) {
			clients.delete(ws);
			console.log(`Client disconnected (${clients.size} remaining)`);
		},
		message(ws, message) {
			const msg = JSON.parse(message.toString());
			if (msg.type === "set_status") {
				agents[0].status = msg.status;
				agents[0].since = Date.now();
				broadcast();
				console.log(`Status: ${msg.status}`);
			}
		},
	},
});

function broadcast() {
	const msg = JSON.stringify({
		type: "snapshot",
		agents,
	});
	for (const ws of clients) {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(msg);
		}
	}
}

console.log(`Test server running on ws://localhost:${PORT}`);
console.log(`Open pixel-office-test.html and use buttons to cycle states`);
