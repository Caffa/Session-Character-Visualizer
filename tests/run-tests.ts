/**
 * tests/run-tests.ts
 * Test runner with report generation
 */

import { spawn } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

interface TestResult {
	suite: string;
	test: string;
	status: "passed" | "failed" | "skipped";
	duration: number;
	error?: string;
}

interface TestReport {
	timestamp: string;
	totalTests: number;
	passed: number;
	failed: number;
	skipped: number;
	duration: number;
	suites: {
		name: string;
		tests: number;
		passed: number;
		failed: number;
	}[];
	results: TestResult[];
}

const TEST_DIRS = {
	unit: "tests/unit",
	integration: "tests/integration",
	e2e: "tests/e2e",
};

const REPORTS_DIR = "tests/reports";

async function runTests(): Promise<void> {
	console.log("🧪 Pixel Office Plugin Test Suite\n");
	console.log("=".repeat(50));

	const startTime = Date.now();
	const args = process.argv.slice(2);
	const filter = args.find((arg) => arg.startsWith("--"))?.replace("--", "");

	const results: TestResult[] = [];
	const suites: TestReport["suites"] = [];
	let totalTests = 0;
	let passedTests = 0;
	let failedTests = 0;

	// Create reports directory
	if (!existsSync(REPORTS_DIR)) {
		mkdirSync(REPORTS_DIR, { recursive: true });
	}

	// Determine which tests to run
	const testTypes = filter
		? [filter as keyof typeof TEST_DIRS]
		: (Object.keys(TEST_DIRS) as Array<keyof typeof TEST_DIRS>);

	for (const testType of testTypes) {
		const testDir = TEST_DIRS[testType];

		if (!existsSync(testDir)) {
			console.log(`\n⚠️  ${testType} tests directory not found: ${testDir}`);
			continue;
		}

		console.log(`\n📁 Running ${testType.toUpperCase()} Tests...`);
		console.log("-".repeat(50));

		const suiteStartTime = Date.now();
		const suiteResults = await runTestFile(testDir, testType);
		const suiteDuration = Date.now() - suiteStartTime;

		const suitePassed = suiteResults.filter(
			(r) => r.status === "passed",
		).length;
		const suiteFailed = suiteResults.filter(
			(r) => r.status === "failed",
		).length;

		suites.push({
			name: testType,
			tests: suiteResults.length,
			passed: suitePassed,
			failed: suiteFailed,
		});

		results.push(...suiteResults);
		totalTests += suiteResults.length;
		passedTests += suitePassed;
		failedTests += suiteFailed;

		console.log(
			`\n✓ ${suitePassed} passed, ✗ ${suiteFailed} failed (${suiteDuration}ms)`,
		);
	}

	const totalDuration = Date.now() - startTime;

	// Generate report
	const report: TestReport = {
		timestamp: new Date().toISOString(),
		totalTests,
		passed: passedTests,
		failed: failedTests,
		skipped: 0,
		duration: totalDuration,
		suites,
		results,
	};

	// Save report
	await saveReport(report);

	// Print summary
	printSummary(report);

	// Exit with appropriate code
	process.exit(failedTests > 0 ? 1 : 0);
}

async function runTestFile(
	testDir: string,
	type: string,
): Promise<TestResult[]> {
	const results: TestResult[] = [];

	try {
		// Run bun test on the directory
		const result = await new Promise<{
			stdout: string;
			stderr: string;
			code: number;
		}>((resolve) => {
			const proc = spawn("bun", ["test", testDir], {
				stdio: ["pipe", "pipe", "pipe"],
			});

			let stdout = "";
			let stderr = "";

			proc.stdout?.on("data", (data) => {
				stdout += data.toString();
				process.stdout.write(data);
			});

			proc.stderr?.on("data", (data) => {
				stderr += data.toString();
				process.stderr.write(data);
			});

			proc.on("close", (code) => {
				resolve({ stdout, stderr, code: code ?? 0 });
			});
		});

		// Parse results from output
		const lines = result.stdout.split("\n");
		let currentSuite = "";

		for (const line of lines) {
			// Look for test results
			const testMatch = line.match(/^(✓|✗)\s+(.+?)(?:\s+\[(\d+)ms\])?$/);
			if (testMatch) {
				const [, status, testName] = testMatch;
				results.push({
					suite: currentSuite || type,
					test: testName.trim(),
					status: status === "✓" ? "passed" : "failed",
					duration: 0,
				});
			}

			// Look for suite name
			const suiteMatch = line.match(/^\s+(.+)\s+\(\d+ tests?\)/);
			if (suiteMatch) {
				currentSuite = suiteMatch[1].trim();
			}
		}

		// If no results parsed, create a placeholder
		if (results.length === 0) {
			results.push({
				suite: type,
				test: `${type} tests`,
				status: result.code === 0 ? "passed" : "failed",
				duration: 0,
			});
		}
	} catch (error) {
		console.error(`\n❌ Error running ${type} tests:`, error);
		results.push({
			suite: type,
			test: `${type} suite`,
			status: "failed",
			duration: 0,
			error: String(error),
		});
	}

	return results;
}

async function saveReport(report: TestReport): Promise<void> {
	// Save JSON report
	const jsonPath = join(REPORTS_DIR, "test-report.json");
	writeFileSync(jsonPath, JSON.stringify(report, null, 2));

	// Generate HTML report
	const htmlReport = generateHTMLReport(report);
	const htmlPath = join(REPORTS_DIR, "test-report.html");
	writeFileSync(htmlPath, htmlReport);

	// Generate markdown summary
	const mdReport = generateMarkdownReport(report);
	const mdPath = join(REPORTS_DIR, "test-report.md");
	writeFileSync(mdPath, mdReport);

	console.log(`\n📊 Reports saved to:`);
	console.log(`   - ${jsonPath}`);
	console.log(`   - ${htmlPath}`);
	console.log(`   - ${mdPath}`);
}

function generateHTMLReport(report: TestReport): string {
	const passRate = ((report.passed / report.totalTests) * 100).toFixed(1);
	const statusColor = report.failed === 0 ? "#4caf50" : "#f44336";

	return `<!DOCTYPE html>
<html>
<head>
  <title>Pixel Office Plugin - Test Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0d0d14;
      color: #e0e0e0;
      padding: 40px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { color: #fff; margin-bottom: 30px; }
    .summary {
      background: #1a1a2e;
      border-radius: 12px;
      padding: 30px;
      margin-bottom: 30px;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-top: 20px;
    }
    .stat-card {
      background: #252540;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
    }
    .stat-value {
      font-size: 36px;
      font-weight: bold;
      color: ${statusColor};
    }
    .stat-label {
      color: #888;
      margin-top: 5px;
    }
    .suite {
      background: #1a1a2e;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 15px;
    }
    .suite-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
    }
    .suite-name { font-size: 18px; font-weight: bold; }
    .suite-stats { color: #888; }
    .test {
      display: flex;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid #333;
    }
    .test:last-child { border-bottom: none; }
    .status {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      margin-right: 10px;
    }
    .status.passed { background: #4caf50; }
    .status.failed { background: #f44336; }
    .timestamp {
      color: #666;
      margin-top: 20px;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🧪 Pixel Office Plugin - Test Report</h1>
    
    <div class="summary">
      <div class="suite-header">
        <span>Overall Summary</span>
        <span style="color: ${statusColor}; font-weight: bold;">${passRate}% Pass Rate</span>
      </div>
      <div class="stats">
        <div class="stat-card">
          <div class="stat-value">${report.totalTests}</div>
          <div class="stat-label">Total Tests</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color: #4caf50;">${report.passed}</div>
          <div class="stat-label">Passed</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color: #f44336;">${report.failed}</div>
          <div class="stat-label">Failed</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${(report.duration / 1000).toFixed(2)}s</div>
          <div class="stat-label">Duration</div>
        </div>
      </div>
    </div>

    <h2>Test Suites</h2>
    ${report.suites
			.map(
				(suite) => `
    <div class="suite">
      <div class="suite-header">
        <span class="suite-name">${suite.name.toUpperCase()}</span>
        <span class="suite-stats">${suite.passed} passed, ${suite.failed} failed</span>
      </div>
    </div>
    `,
			)
			.join("")}

    <div class="timestamp">
      Generated: ${new Date(report.timestamp).toLocaleString()}
    </div>
  </div>
</body>
</html>
`;
}

function generateMarkdownReport(report: TestReport): string {
	const passRate = ((report.passed / report.totalTests) * 100).toFixed(1);
	const statusEmoji = report.failed === 0 ? "✅" : "❌";

	return `# Pixel Office Plugin - Test Report

${statusEmoji} **${passRate}% Pass Rate**

## Summary

| Metric | Value |
|--------|-------|
| Total Tests | ${report.totalTests} |
| Passed | ${report.passed} |
| Failed | ${report.failed} |
| Duration | ${(report.duration / 1000).toFixed(2)}s |
| Generated | ${new Date(report.timestamp).toLocaleString()} |

## Test Suites

| Suite | Tests | Passed | Failed |
|-------|-------|--------|--------|
${report.suites.map((s) => `| ${s.name} | ${s.tests} | ${s.passed} | ${s.failed} |`).join("\n")}

## Detailed Results

${report.results
	.map(
		(r) =>
			`- ${r.status === "passed" ? "✓" : "✗"} **${r.suite}**: ${r.test}${r.error ? `\n  - Error: ${r.error}` : ""}`,
	)
	.join("\n")}

---

*Report generated by Pixel Office Test Runner*
`;
}

function printSummary(report: TestReport): void {
	console.log("\n" + "=".repeat(50));
	console.log("📊 TEST SUMMARY");
	console.log("=".repeat(50));
	console.log(`Total Tests: ${report.totalTests}`);
	console.log(`✓ Passed:    ${report.passed}`);
	console.log(`✗ Failed:    ${report.failed}`);
	console.log(`⏱ Duration:  ${(report.duration / 1000).toFixed(2)}s`);
	console.log("=".repeat(50));

	if (report.failed === 0) {
		console.log("\n🎉 All tests passed!");
	} else {
		console.log(`\n⚠️  ${report.failed} test(s) failed`);
	}
}

// Run tests
runTests().catch((error) => {
	console.error("Test runner failed:", error);
	process.exit(1);
});
