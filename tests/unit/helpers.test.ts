/**
 * tests/unit/helpers.test.ts
 * Unit tests for helper functions
 */

import { describe, expect, it } from "bun:test";
import {
	folderName,
	hueFromId,
	TOOL_STATUS,
	toolLabel,
	toolStatus,
} from "../../pixel-office.ts";

describe("hueFromId", () => {
	it("should return consistent hue for same id", () => {
		const id = "test-session-id-123";
		const hue1 = hueFromId(id);
		const hue2 = hueFromId(id);
		expect(hue1).toBe(hue2);
	});

	it("should return hue between 0 and 360", () => {
		const ids = [
			"a",
			"test",
			"session-123",
			"very-long-session-id-with-many-characters",
		];
		for (const id of ids) {
			const hue = hueFromId(id);
			expect(hue).toBeGreaterThanOrEqual(0);
			expect(hue).toBeLessThan(360);
		}
	});

	it("should return different hues for different ids", () => {
		const id1 = "session-a";
		const id2 = "session-b";
		const hue1 = hueFromId(id1);
		const hue2 = hueFromId(id2);
		expect(hue1).not.toBe(hue2);
	});

	it("should handle empty string", () => {
		const hue = hueFromId("");
		expect(hue).toBe(0);
	});

	it("should handle special characters", () => {
		const ids = ["!@#$%", "🎉emoji🎊", "with\nnewlines\tand\ttabs"];
		for (const id of ids) {
			const hue = hueFromId(id);
			expect(hue).toBeGreaterThanOrEqual(0);
			expect(hue).toBeLessThan(360);
		}
	});
});

describe("folderName", () => {
	it("should extract folder name from path", () => {
		expect(folderName("/home/user/project")).toBe("project");
		expect(folderName("/var/www/html")).toBe("html");
		expect(folderName("/test/project")).toBe("project");
	});

	it("should handle path without trailing slash", () => {
		expect(folderName("/home/user/project")).toBe("project");
	});

	it("should handle path with trailing slash", () => {
		expect(folderName("/home/user/project/")).toBe("project");
	});

	it("should handle single folder path", () => {
		expect(folderName("project")).toBe("project");
		expect(folderName("/project")).toBe("project");
	});

	it("should handle root path", () => {
		expect(folderName("/")).toBe("/");
	});

	it("should handle empty string", () => {
		expect(folderName("")).toBe("");
	});

	it("should handle relative paths", () => {
		expect(folderName("./project")).toBe("project");
		expect(folderName("../project")).toBe("project");
	});

	it("should handle paths with dots", () => {
		expect(folderName("/home/user/project.name")).toBe("project.name");
		expect(folderName("/home/user/.hidden")).toBe(".hidden");
	});
});

describe("toolStatus", () => {
	it("should return editing status for write operations", () => {
		expect(toolStatus("write")).toBe("editing");
		expect(toolStatus("edit")).toBe("editing");
		expect(toolStatus("multiedit")).toBe("editing");
		expect(toolStatus("todowrite")).toBe("editing");
	});

	it("should return reading status for read operations", () => {
		expect(toolStatus("read")).toBe("reading");
		expect(toolStatus("glob")).toBe("reading");
		expect(toolStatus("grep")).toBe("reading");
		expect(toolStatus("ls")).toBe("reading");
		expect(toolStatus("webfetch")).toBe("reading");
		expect(toolStatus("websearch")).toBe("reading");
		expect(toolStatus("todoread")).toBe("reading");
	});

	it("should return running status for bash", () => {
		expect(toolStatus("bash")).toBe("running");
	});

	it("should return thinking status for task", () => {
		expect(toolStatus("task")).toBe("thinking");
	});

	it("should handle unknown tools", () => {
		expect(toolStatus("unknown")).toBe("thinking");
		expect(toolStatus("customTool")).toBe("thinking");
	});

	it("should be case insensitive", () => {
		expect(toolStatus("WRITE")).toBe("editing");
		expect(toolStatus("Write")).toBe("editing");
		expect(toolStatus("BASH")).toBe("running");
		expect(toolStatus("Bash")).toBe("running");
	});
});

describe("toolLabel", () => {
	it("should return editing labels for write operations", () => {
		expect(toolLabel("write")).toBe("✏️ writing");
		expect(toolLabel("edit")).toBe("✏️ editing");
		expect(toolLabel("multiedit")).toBe("✏️ editing");
		expect(toolLabel("todowrite")).toBe("📋 updating");
	});

	it("should return reading labels for read operations", () => {
		expect(toolLabel("read")).toBe("📖 reading");
		expect(toolLabel("glob")).toBe("🔍 searching");
		expect(toolLabel("grep")).toBe("🔍 searching");
		expect(toolLabel("ls")).toBe("📂 listing");
		expect(toolLabel("webfetch")).toBe("🌐 fetching");
		expect(toolLabel("websearch")).toBe("🌐 searching");
		expect(toolLabel("todoread")).toBe("📋 todos");
	});

	it("should return running label for bash", () => {
		expect(toolLabel("bash")).toBe("💻 running");
	});

	it("should return thinking label for task", () => {
		expect(toolLabel("task")).toBe("🤖 spawning");
	});

	it("should return generic label for unknown tools", () => {
		expect(toolLabel("unknown")).toBe("🔧 unknown");
		expect(toolLabel("customTool")).toBe("🔧 customTool");
	});

	it("should be case insensitive", () => {
		expect(toolLabel("WRITE")).toBe("✏️ writing");
		expect(toolLabel("Write")).toBe("✏️ writing");
		expect(toolLabel("BASH")).toBe("💻 running");
	});

	it("should include emoji in all labels", () => {
		const tools = Object.keys(TOOL_STATUS);
		for (const tool of tools) {
			const label = toolLabel(tool);
			expect(label.length).toBeGreaterThan(2);
			expect(label).toContain(" ");
		}
	});
});
