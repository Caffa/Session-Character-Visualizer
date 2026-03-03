/**
 * tests/unit/helpers.test.ts
 * Unit tests for helper functions
 */

import { beforeEach, describe, expect, it } from "bun:test";
import {
	agentFileActivity,
	folderName,
	getActivityScale,
	hueFromId,
	isIgnored,
	recordFileActivity,
	TOOL_STATUS,
	toolLabel,
	toolStatus,
} from "../../blob-office.ts";

// Clear activity tracking before each test
beforeEach(() => {
	agentFileActivity.clear();
});

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

describe("isIgnored", () => {
	it("should ignore common patterns", () => {
		expect(isIgnored("node_modules/file.ts")).toBe(true);
		expect(isIgnored(".git/config")).toBe(true);
		expect(isIgnored("dist/bundle.js")).toBe(true);
		expect(isIgnored("build/index.html")).toBe(true);
		expect(isIgnored("__pycache__/module.pyc")).toBe(true);
		expect(isIgnored(".venv/lib/python")).toBe(true);
		expect(isIgnored("vendor/package.js")).toBe(true);
		expect(isIgnored(".next/pages/index.js")).toBe(true);
		expect(isIgnored(".cache/data.json")).toBe(true);
		expect(isIgnored(".DS_Store")).toBe(true);
	});

	it("should not ignore normal files", () => {
		expect(isIgnored("src/app.ts")).toBe(false);
		expect(isIgnored("index.html")).toBe(false);
		expect(isIgnored("components/Button.tsx")).toBe(false);
		expect(isIgnored("tests/unit/helpers.test.ts")).toBe(false);
	});

	it("should handle paths with multiple segments", () => {
		expect(isIgnored("project/node_modules/pkg/file.ts")).toBe(true);
		expect(isIgnored("src/.git/config")).toBe(true);
		expect(isIgnored("normal/src/file.ts")).toBe(false);
	});

	it("should handle Windows-style paths", () => {
		expect(isIgnored("node_modules\\file.ts")).toBe(true);
		expect(isIgnored("src\\app.ts")).toBe(false);
	});
});

describe("getActivityScale", () => {
	it("should return 1.0 for 0 files", () => {
		agentFileActivity.set("test", new Set());
		expect(getActivityScale("test")).toBe(1.0);
	});

	it("should return 1.0 for 1 file", () => {
		const files = new Set(["file1.ts"]);
		agentFileActivity.set("test", files);
		expect(getActivityScale("test")).toBeCloseTo(1.0, 1);
	});

	it("should return ~1.15 for 10 files", () => {
		const files = new Set(Array.from({ length: 10 }, (_, i) => `file${i}.ts`));
		agentFileActivity.set("test", files);
		expect(getActivityScale("test")).toBeCloseTo(1.15, 1);
	});

	it("should return ~1.3 for 100 files", () => {
		const files = new Set(Array.from({ length: 100 }, (_, i) => `file${i}.ts`));
		agentFileActivity.set("test", files);
		expect(getActivityScale("test")).toBeCloseTo(1.3, 1);
	});

	it("should return ~1.45 for 1000 files", () => {
		const files = new Set(
			Array.from({ length: 1000 }, (_, i) => `file${i}.ts`),
		);
		agentFileActivity.set("test", files);
		expect(getActivityScale("test")).toBeCloseTo(1.45, 1);
	});

	it("should clamp at 2.5 max", () => {
		const files = new Set(
			Array.from({ length: 10000 }, (_, i) => `file${i}.ts`),
		);
		agentFileActivity.set("test", files);
		expect(getActivityScale("test")).toBeLessThanOrEqual(2.5);
	});

	it("should handle unknown agent id", () => {
		expect(getActivityScale("unknown-agent")).toBe(1.0);
	});
});

describe("recordFileActivity", () => {
	it("should track unique files", () => {
		const id = "test-agent";
		recordFileActivity(id, "file1.ts");
		recordFileActivity(id, "file2.ts");
		recordFileActivity(id, "file1.ts"); // duplicate

		expect(agentFileActivity.get(id)?.size).toBe(2);
	});

	it("should handle multiple agents", () => {
		recordFileActivity("agent1", "file1.ts");
		recordFileActivity("agent1", "file2.ts");
		recordFileActivity("agent2", "file3.ts");

		expect(agentFileActivity.get("agent1")?.size).toBe(2);
		expect(agentFileActivity.get("agent2")?.size).toBe(1);
	});

	it("should handle empty file paths", () => {
		const id = "test-agent";
		recordFileActivity(id, "");
		recordFileActivity(id, "file1.ts");

		expect(agentFileActivity.get(id)?.size).toBe(2);
	});

	it("should handle special characters in file paths", () => {
		const id = "test-agent";
		recordFileActivity(id, "file with spaces.ts");
		recordFileActivity(id, "file-with-dashes.ts");
		recordFileActivity(id, "file_with_underscores.ts");

		expect(agentFileActivity.get(id)?.size).toBe(3);
	});
});
