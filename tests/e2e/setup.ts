/**
 * tests/e2e/setup.ts
 * Setup HTTP server for E2E tests
 */

import { readFileSync } from "fs";
import { join } from "path";

let httpServer: ReturnType<typeof Bun.serve> | null = null;

export function startHTTPServer(port: number = 3000): Promise<void> {
	return new Promise((resolve) => {
		const htmlPath = join(process.cwd(), "pixel-office.html");

		httpServer = Bun.serve({
			port,
			fetch(req) {
				const url = new URL(req.url);

				if (url.pathname === "/" || url.pathname === "/index.html") {
					const html = readFileSync(htmlPath, "utf-8");
					return new Response(html, {
						headers: { "Content-Type": "text/html" },
					});
				}

				return new Response("Not Found", { status: 404 });
			},
		});

		console.log(`HTTP server started on http://localhost:${port}`);
		resolve();
	});
}

export function stopHTTPServer(): void {
	if (httpServer) {
		httpServer.stop();
		httpServer = null;
		console.log("HTTP server stopped");
	}
}
