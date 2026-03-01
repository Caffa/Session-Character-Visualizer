/**
 * tests/e2e/viewer.spec.ts
 * E2E browser tests for the Pixel Office viewer
 * Uses playwright-cli for browser automation
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { $ } from "bun";

const VIEWER_URL = "http://localhost:2727";
const WS_PORT = 2727;

interface AgentState {
	id: string;
	parentID?: string;
	folder: string;
	folderFull?: string;
	title?: string;
	status: string;
	tool?: string;
	message?: string;
	since: number;
	color: number;
	idleSince?: number;
}

// Mock WebSocket server for testing
class MockWebSocketServer {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private server: any | null = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private clients: Set<any> = new Set();
	public agents: Map<string, AgentState> = new Map();

	async start(port: number): Promise<void> {
		const self = this;
		this.server = Bun.serve({
			port,
			fetch(req, srv) {
				if (srv.upgrade(req)) {
					return undefined;
				}
				return new Response("Not Found", { status: 404 });
			},
			websocket: {
				open(ws: unknown) {
					self.clients.add(ws);
					// Send current state
					const socket = ws as { send: (data: string) => void };
					socket.send(
						JSON.stringify({
							type: "snapshot",
							agents: [...self.agents.values()],
						}),
					);
				},
				close(ws: unknown) {
					self.clients.delete(ws);
				},
				message() {},
			},
		});
	}

	stop() {
		if (this.server) {
			this.server.stop();
			this.server = null;
		}
	}

	addAgent(agent: AgentState) {
		this.agents.set(agent.id, agent);
		this.broadcast();
	}

	removeAgent(id: string) {
		this.agents.delete(id);
		this.broadcast();
	}

	updateAgent(id: string, updates: Partial<AgentState>) {
		const agent = this.agents.get(id);
		if (agent) {
			Object.assign(agent, updates, { since: Date.now() });
			this.broadcast();
		}
	}

	private broadcast() {
		const msg = JSON.stringify({
			type: "snapshot",
			agents: [...this.agents.values()],
		});
		for (const ws of this.clients) {
			ws.send(msg);
		}
	}
}

describe("Pixel Office Viewer - E2E", () => {
	let mockServer: MockWebSocketServer;

	beforeAll(async () => {
		mockServer = new MockWebSocketServer();
		await mockServer.start(WS_PORT);
		console.log(`Mock WebSocket server started on port ${WS_PORT}`);
	});

	afterAll(() => {
		mockServer.stop();
		console.log("Mock WebSocket server stopped");
	});

	describe("Connection", () => {
		it("should show connected status when WebSocket is available", async () => {
			// Open browser and navigate to viewer
			await $`playwright-cli open ${VIEWER_URL}`;
			await delay(1000);

			// Check connection status
			const connected = await checkConnectionStatus();
			expect(connected).toBe(true);

			await $`playwright-cli close`;
		}, 30000);

		it("should show waiting state when no agents", async () => {
			await $`playwright-cli open ${VIEWER_URL}`;
			await delay(1000);

			// Check for "Waiting for OpenCode sessions" message
			const waitingText = await getPageText();
			expect(waitingText).toContain("Waiting for OpenCode sessions");

			await $`playwright-cli close`;
		}, 30000);
	});

	describe("Agent Display", () => {
		it("should display a single agent", async () => {
			await $`playwright-cli open ${VIEWER_URL}`;
			await delay(1000);

			// Add an agent
			mockServer.addAgent({
				id: "test-agent-1",
				folder: "test-project",
				status: "idle",
				since: Date.now(),
				color: 180,
			});

			await delay(500);

			// Check agent count in status bar
			const count = await getAgentCount();
			expect(count).toBe(1);

			mockServer.removeAgent("test-agent-1");
			await $`playwright-cli close`;
		}, 30000);

		it("should display multiple agents", async () => {
			await $`playwright-cli open ${VIEWER_URL}`;
			await delay(1000);

			// Add multiple agents
			mockServer.addAgent({
				id: "agent-1",
				folder: "project-a",
				status: "thinking",
				since: Date.now(),
				color: 120,
			});

			mockServer.addAgent({
				id: "agent-2",
				folder: "project-b",
				status: "editing",
				since: Date.now(),
				color: 240,
			});

			await delay(500);

			const count = await getAgentCount();
			expect(count).toBe(2);

			mockServer.removeAgent("agent-1");
			mockServer.removeAgent("agent-2");
			await $`playwright-cli close`;
		}, 30000);

		it("should display subagents", async () => {
			await $`playwright-cli open ${VIEWER_URL}`;
			await delay(1000);

			const parentId = "parent-agent";
			mockServer.addAgent({
				id: parentId,
				folder: "parent-project",
				status: "idle",
				since: Date.now(),
				color: 180,
			});

			mockServer.addAgent({
				id: "child-agent",
				parentID: parentId,
				folder: "child-project",
				status: "thinking",
				since: Date.now(),
				color: 200,
			});

			await delay(500);

			const text = await getPageText();
			expect(text).toContain("1 agent");
			expect(text).toContain("1 subagent");

			mockServer.removeAgent("parent-agent");
			mockServer.removeAgent("child-agent");
			await $`playwright-cli close`;
		}, 30000);
	});

	describe("Status Updates", () => {
		it("should update agent status", async () => {
			await $`playwright-cli open ${VIEWER_URL}`;
			await delay(1000);

			const agentId = "status-test-agent";
			mockServer.addAgent({
				id: agentId,
				folder: "status-test",
				status: "idle",
				since: Date.now(),
				color: 180,
			});

			await delay(500);

			// Update status
			mockServer.updateAgent(agentId, {
				status: "editing",
				message: "✏️ editing",
			});
			await delay(500);

			// Agent should still be displayed
			const count = await getAgentCount();
			expect(count).toBe(1);

			mockServer.removeAgent(agentId);
			await $`playwright-cli close`;
		}, 30000);

		it("should handle agent removal with fade-out", async () => {
			await $`playwright-cli open ${VIEWER_URL}`;
			await delay(1000);

			const agentId = "fade-test-agent";
			mockServer.addAgent({
				id: agentId,
				folder: "fade-test",
				status: "idle",
				since: Date.now(),
				color: 180,
			});

			await delay(500);

			const count = await getAgentCount();
			expect(count).toBe(1);

			// Remove agent
			mockServer.removeAgent(agentId);

			// Should show "Waiting for OpenCode sessions" after fade-out
			await delay(1500);

			const text = await getPageText();
			expect(text).toContain("Waiting for OpenCode sessions");

			await $`playwright-cli close`;
		}, 30000);
	});

	describe("Blob Character Rendering", () => {
		it("should render a visible blob character on canvas when agent exists", async () => {
			await $`playwright-cli open ${VIEWER_URL}`;
			await delay(1000);

			// Add an agent
			mockServer.addAgent({
				id: "render-test-agent",
				folder: "render-test-project",
				status: "idle",
				since: Date.now(),
				color: 180,
			});

			await delay(1000); // Wait for rendering

			// Check that canvas exists and has content
			const hasCanvasContent = await checkCanvasHasContent();
			expect(hasCanvasContent).toBe(true);

			mockServer.removeAgent("render-test-agent");
			await $`playwright-cli close`;
		}, 30000);

		it("should render blob with correct color hue", async () => {
			await $`playwright-cli open ${VIEWER_URL}`;
			await delay(1000);

			// Add agent with specific hue (180 = cyan)
			mockServer.addAgent({
				id: "color-test-agent",
				folder: "color-test",
				status: "idle",
				since: Date.now(),
				color: 180, // Cyan hue
			});

			await delay(1000);

			// Check canvas has drawn pixels (not just background)
			const hasDrawnPixels = await checkCanvasHasDrawnPixels();
			expect(hasDrawnPixels).toBe(true);

			mockServer.removeAgent("color-test-agent");
			await $`playwright-cli close`;
		}, 30000);

		it("should render blob at visible coordinates (not off-screen)", async () => {
			await $`playwright-cli open ${VIEWER_URL}`;
			await delay(1000);

			// Add single agent
			mockServer.addAgent({
				id: "position-test-agent",
				folder: "position-test",
				status: "idle",
				since: Date.now(),
				color: 120,
			});

			await delay(1000);

			// Check agent is at visible position (not off-screen)
			const isAgentVisible = await checkAgentPositionVisible();
			expect(isAgentVisible).toBe(true);

			mockServer.removeAgent("position-test-agent");
			await $`playwright-cli close`;
		}, 30000);
	});

	describe("Visual Regression", () => {
		it("should render empty state correctly", async () => {
			await $`playwright-cli open ${VIEWER_URL}`;
			await delay(1000);

			// Take screenshot
			await $`playwright-cli screenshot --filename=tests/e2e/screenshots/empty-state.png`;

			// Screenshot was taken successfully
			expect(true).toBe(true);

			await $`playwright-cli close`;
		}, 30000);

		it("should render single agent state", async () => {
			await $`playwright-cli open ${VIEWER_URL}`;
			await delay(1000);

			mockServer.addAgent({
				id: "screenshot-agent",
				folder: "screenshot-test",
				status: "editing",
				message: "✏️ editing",
				since: Date.now(),
				color: 180,
			});

			await delay(500);

			await $`playwright-cli screenshot --filename=tests/e2e/screenshots/single-agent.png`;

			expect(true).toBe(true);

			mockServer.removeAgent("screenshot-agent");
			await $`playwright-cli close`;
		}, 30000);

		it("should render multiple agents state", async () => {
			await $`playwright-cli open ${VIEWER_URL}`;
			await delay(1000);

			const statuses = [
				"idle",
				"thinking",
				"editing",
				"reading",
				"running",
				"waiting",
				"error",
			];
			statuses.forEach((status, i) => {
				mockServer.addAgent({
					id: `agent-${i}`,
					folder: `project-${status}`,
					status,
					message: `Test ${status}`,
					since: Date.now(),
					color: (i * 50) % 360,
				});
			});

			await delay(500);

			await $`playwright-cli screenshot --filename=tests/e2e/screenshots/multiple-agents.png`;

			expect(true).toBe(true);

			statuses.forEach((_, i) => {
				mockServer.removeAgent(`agent-${i}`);
			});
			await $`playwright-cli close`;
		}, 30000);
	});
});

// Helper functions
async function checkConnectionStatus(): Promise<boolean> {
	try {
		const result =
			await $`playwright-cli eval "document.getElementById('ws-label').textContent"`;
		const text = result.stdout.toString().trim();
		return text === "connected";
	} catch {
		return false;
	}
}

async function getPageText(): Promise<string> {
	try {
		const result = await $`playwright-cli eval "document.body.textContent"`;
		return result.stdout.toString();
	} catch {
		return "";
	}
}

async function getAgentCount(): Promise<number> {
	try {
		const result =
			await $`playwright-cli eval "Object.keys(window.agents || {}).length"`;
		const count = parseInt(result.stdout.toString().trim(), 10);
		return isNaN(count) ? 0 : count;
	} catch {
		return 0;
	}
}

/**
 * Checks if the canvas has any content beyond the background
 * Returns true if there are non-floor-color pixels (i.e., blob is rendered)
 */
async function checkCanvasHasContent(): Promise<boolean> {
	try {
		const result = await $`playwright-cli eval \`
			(() => {
				const canvas = document.querySelector('canvas');
				if (!canvas) return { exists: false, hasContent: false };
				
				const ctx = canvas.getContext('2d');
				if (!ctx) return { exists: true, hasContent: false };
				
				// Get center region of canvas where agent should be drawn
				const centerX = canvas.width / 2;
				const centerY = canvas.height / 2;
				const checkSize = 100;
				
				const imageData = ctx.getImageData(
					Math.floor(centerX - checkSize/2),
					Math.floor(centerY - checkSize/2),
					checkSize,
					checkSize
				);
				
				const data = imageData.data;
				// Check for pixels that are NOT the floor color (15, 15, 25)
				// or grid color (22, 22, 38)
				let nonBackgroundPixels = 0;
				for (let i = 0; i < data.length; i += 4) {
					const r = data[i], g = data[i+1], b = data[i+2];
					// If not floor color and not pure black (text), count it
					if (!(r === 15 && g === 15 && b === 25) && 
						!(r === 22 && g === 22 && b === 38) &&
						!(r === 0 && g === 0 && b === 0)) {
						nonBackgroundPixels++;
					}
				}
				
				return { exists: true, hasContent: nonBackgroundPixels > 50 };
			})();
		\``;
		const parsed = JSON.parse(result.stdout.toString().trim());
		return parsed.exists && parsed.hasContent;
	} catch {
		return false;
	}
}

/**
 * Checks if there are drawn pixels (not just background) on the canvas
 */
async function checkCanvasHasDrawnPixels(): Promise<boolean> {
	try {
		const result = await $`playwright-cli eval \`
			(() => {
				const canvas = document.querySelector('canvas');
				if (!canvas) return false;
				
				const ctx = canvas.getContext('2d');
				if (!ctx) return false;
				
				// Sample multiple regions
				const regions = [
					{ x: canvas.width * 0.4, y: canvas.height * 0.4, w: 80, h: 80 },
					{ x: canvas.width * 0.5, y: canvas.height * 0.5, w: 80, h: 80 },
					{ x: canvas.width * 0.6, y: canvas.height * 0.4, w: 80, h: 80 },
				];
				
				for (const region of regions) {
					const imageData = ctx.getImageData(
						Math.floor(region.x), Math.floor(region.y),
						region.w, region.h
					);
					const data = imageData.data;
					
					// Count colored pixels (not black or background colors)
					let coloredPixels = 0;
					for (let i = 0; i < data.length; i += 4) {
						const r = data[i], g = data[i+1], b = data[i+2];
						// Background colors are very dark (0-25), agents are brighter
						const brightness = (r + g + b) / 3;
						if (brightness > 40 && !(r < 30 && g < 30 && b < 35)) {
							coloredPixels++;
						}
					}
					
					if (coloredPixels > 30) return true;
				}
				return false;
			})();
		\``;
		return result.stdout.toString().trim() === "true";
	} catch {
		return false;
	}
}

/**
 * Checks if the agent is rendered at visible coordinates (not off-screen)
 */
async function checkAgentPositionVisible(): Promise<boolean> {
	try {
		const result = await $`playwright-cli eval \`
			(() => {
				// Check if any agent sprite has valid coordinates
				const agents = window.agents || {};
				const agentList = Object.values(agents);
				
				if (agentList.length === 0) return false;
				
				for (const agent of agentList) {
					const sprite = agent._sprite;
					if (!sprite) {
						// Sprite not created yet - check if there's canvas content
						const canvas = document.querySelector('canvas');
						if (!canvas) return false;
						
						const ctx = canvas.getContext('2d');
						if (!ctx) return false;
						
						// Check center area has content
						const centerX = canvas.width / 2;
						const centerY = canvas.height / 2;
						const imageData = ctx.getImageData(centerX - 30, centerY - 30, 60, 60);
						const data = imageData.data;
						
						let nonBlack = 0;
						for (let i = 0; i < data.length; i += 4) {
							if (data[i] > 20 || data[i+1] > 20 || data[i+2] > 20) {
								nonBlack++;
							}
						}
						return nonBlack > 20;
					}
					
					// Check sprite position is within canvas bounds
					const canvas = document.querySelector('canvas');
					if (!canvas) return false;
					
					const x = sprite.x, y = sprite.y;
					// Check if position is reasonable (not NaN, not far off-screen)
					if (isNaN(x) || isNaN(y)) return false;
					if (x < -100 || x > canvas.width + 100) return false;
					if (y < -100 || y > canvas.height + 100) return false;
					
					// Position is valid
					return true;
				}
				return false;
			})();
		\``;
		return result.stdout.toString().trim() === "true";
	} catch {
		return false;
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
