import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import puppeteer from "puppeteer";

const WIDTH = 800;
const HEIGHT = 500;
const FRAMES = 30;
const FPS = 10;
const FRAME_DELAY = 1000 / FPS;

const PREVIEW_HTML = path.join(process.cwd(), "preview.html");
const FRAMES_DIR = path.join(process.cwd(), "frames");

const STATUSES = [
	{ name: "idle", message: "Waiting for input..." },
	{ name: "thinking", message: "Analyzing your request..." },
	{ name: "reading", message: "Reading files..." },
	{ name: "editing", message: "Writing code..." },
	{ name: "running", message: "npm install..." },
	{ name: "waiting", message: "Need permission" },
	{ name: "error", message: "Something went wrong" },
];

const TRANSITIONS = [
	{ from: "idle", to: "thinking", message: "Analyzing request..." },
	{ from: "thinking", to: "editing", message: "Writing code..." },
	{ from: "editing", to: "running", message: "Running tests..." },
	{ from: "running", to: "idle", message: "Done!" },
];

if (!fs.existsSync(FRAMES_DIR)) {
	fs.mkdirSync(FRAMES_DIR, { recursive: true });
}

async function captureFrame(browser, status, frameNum) {
	const page = await browser.newPage();
	await page.setViewport({
		width: WIDTH,
		height: HEIGHT,
		deviceScaleFactor: 1,
	});

	const url = `file://${PREVIEW_HTML}?status=${status}&t=${frameNum}`;
	await page.goto(url, { waitUntil: "networkidle0" });

	await page.evaluate(() => {
		return new Promise((resolve) => setTimeout(resolve, 100));
	});

	const screenshot = await page.screenshot({ type: "png" });
	await page.close();

	return screenshot;
}

async function generateStatusGif(statusInfo) {
	console.log(`Generating GIF for status: ${statusInfo.name}...`);

	const browser = await puppeteer.launch({
		headless: true,
		args: ["--no-sandbox", "--disable-setuid-sandbox"],
	});

	const frames = [];

	for (let i = 0; i < FRAMES; i++) {
		const screenshot = await captureFrame(browser, statusInfo.name, i);
		const framePath = path.join(
			FRAMES_DIR,
			`${statusInfo.name}_${String(i).padStart(3, "0")}.png`,
		);
		fs.writeFileSync(framePath, screenshot);
		frames.push(framePath);
	}

	await browser.close();

	const outputPath = path.join(process.cwd(), `${statusInfo.name}.gif`);
	const framePattern = path.join(FRAMES_DIR, `${statusInfo.name}_%03d.png`);

	execSync(
		`ffmpeg -y -framerate ${FPS} -i "${framePattern}" -vf "scale=800:500:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 "${outputPath}"`,
		{ stdio: "inherit" },
	);

	console.log(`  → Saved: ${outputPath}`);
}

async function generateTransitionGif(fromStatus, toStatus, message) {
	const name = `${fromStatus}-to-${toStatus}`;
	console.log(`Generating transition GIF: ${name}...`);

	const browser = await puppeteer.launch({
		headless: true,
		args: ["--no-sandbox", "--disable-setuid-sandbox"],
	});

	for (let i = 0; i < FRAMES; i++) {
		const t = i / (FRAMES - 1);
		const currentStatus = t < 0.5 ? fromStatus : toStatus;

		const screenshot = await captureFrame(browser, currentStatus, i);
		const framePath = path.join(
			FRAMES_DIR,
			`${name}_${String(i).padStart(3, "0")}.png`,
		);
		fs.writeFileSync(framePath, screenshot);
	}

	await browser.close();

	const outputPath = path.join(process.cwd(), `${name}.gif`);
	const framePattern = path.join(FRAMES_DIR, `${name}_%03d.png`);

	execSync(
		`ffmpeg -y -framerate ${FPS} -i "${framePattern}" -vf "scale=800:500:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 "${outputPath}"`,
		{ stdio: "inherit" },
	);

	console.log(`  → Saved: ${outputPath}`);
}

async function generateMultiAgentGif() {
	console.log("Generating multi-agent preview...");

	const multiHtmlPath = path.join(process.cwd(), "multi-agent.html");

	const browser = await puppeteer.launch({
		headless: true,
		args: ["--no-sandbox", "--disable-setuid-sandbox"],
	});

	for (let i = 0; i < FRAMES; i++) {
		const page = await browser.newPage();
		await page.setViewport({
			width: WIDTH,
			height: HEIGHT,
			deviceScaleFactor: 1,
		});

		const url = `file://${multiHtmlPath}?t=${i}`;
		await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
		await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));

		const screenshot = await page.screenshot({ type: "png" });
		await page.close();

		const framePath = path.join(
			FRAMES_DIR,
			`multi-agent_${String(i).padStart(3, "0")}.png`,
		);
		fs.writeFileSync(framePath, screenshot);
	}

	await browser.close();

	const outputPath = path.join(process.cwd(), "multi-agent.gif");
	const framePattern = path.join(FRAMES_DIR, `multi-agent_%03d.png`);

	execSync(
		`ffmpeg -y -framerate ${FPS} -i "${framePattern}" -vf "scale=800:500:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 "${outputPath}"`,
		{ stdio: "inherit" },
	);

	console.log(`  → Saved: ${outputPath}`);
}

function cleanupFrames() {
	const files = fs.readdirSync(FRAMES_DIR);
	for (const file of files) {
		fs.unlinkSync(path.join(FRAMES_DIR, file));
	}
}

async function main() {
	console.log("🎬 Generating Pixel Office GIF previews...\n");

	cleanupFrames();

	for (const status of STATUSES) {
		await generateStatusGif(status);
	}

	console.log("");

	for (const trans of TRANSITIONS) {
		await generateTransitionGif(trans.from, trans.to, trans.message);
	}

	console.log("");
	await generateMultiAgentGif();

	cleanupFrames();

	console.log("\n✅ All GIFs generated! Files saved in media-previews/");
}

main().catch(console.error);
