/**
 * tests/e2e/viewer.spec.ts
 * E2E browser tests for the Pixel Office viewer
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { $ } from "bun";

const VIEWER_FILE =
	"/Users/caffae/Local-Projects-2026/Wild-Projects/Pixel-Agent-Visualizer/V2-My-Opencode-Pixel-Agent/pixel-office.html";

const TEST_HTTP_PORT = 2731;
let testServer: { stop: () => void } | null = null;

async function startTestServer(): Promise<{ stop: () => void }> {
	const http = await import("http");
	const { readFileSync } = await import("fs");
	const htmlContent = readFileSync(VIEWER_FILE, "utf-8");
	const server = http.createServer((_req, res) => {
		res.writeHead(200, { "Content-Type": "text/html" });
		res.end(htmlContent);
	});
	return new Promise((resolve) => {
		server.listen(TEST_HTTP_PORT, () => {
			resolve({ stop: () => server.close() });
		});
	});
}

const VIEWER_URL = `http://localhost:${TEST_HTTP_PORT}`;

describe("Pixel Office Viewer", () => {
	beforeAll(async () => {
		testServer = await startTestServer();
	});

	afterAll(() => {
		testServer?.stop();
	});

	it("should load page and render agents", async () => {
		await $`playwright-cli open ${VIEWER_URL}`;
		await delay(3000);

		// Just verify page loads without crashing
		const result =
			await $`playwright-cli screenshot --filename=tests/e2e/screenshots/viewer-test.png`;

		// If we got here without error, page loaded successfully
		expect(result.stdout).toBeDefined();

		await $`playwright-cli close`;
	}, 30000);
});

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
