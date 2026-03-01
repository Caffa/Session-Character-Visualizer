# Pixel Office Plugin Test Suite

Automated test suite for the Pixel Office OpenCode plugin.

## Overview

This test suite includes:

- **Unit Tests**: Testing helper functions and plugin logic
- **Integration Tests**: Testing WebSocket communication
- **E2E Tests**: Browser automation tests using playwright-cli

## Test Structure

```
tests/
├── mocks/
│   └── mock-opencode.ts       # Mock OpenCode plugin environment
├── unit/
│   ├── helpers.test.ts        # Helper function tests
│   └── plugin-logic.test.ts   # Plugin state management tests
├── integration/
│   └── websocket.test.ts      # WebSocket communication tests
├── e2e/
│   ├── setup.ts               # E2E test setup utilities
│   └── viewer.spec.ts         # Browser E2E tests
├── reports/                   # Generated test reports
└── run-tests.ts               # Test runner with report generation
```

## Running Tests

### Run all tests

```bash
bun test
```

### Run specific test suites

```bash
# Unit tests only
bun test tests/unit

# Integration tests only
bun test tests/integration

# E2E tests only
bun test tests/e2e
```

### Run with test runner and generate reports

```bash
bun tests/run-tests.ts
```

### Run specific test type via runner

```bash
bun tests/run-tests.ts --unit
bun tests/run-tests.ts --integration
bun tests/run-tests.ts --e2e
```

## Test Reports

After running tests with the runner, reports are generated in `tests/reports/`:

- `test-report.json` - Machine-readable JSON report
- `test-report.html` - Visual HTML report
- `test-report.md` - Markdown summary

## Test Coverage

### Unit Tests (57 passing)

#### Helper Functions (26 tests)

- `hueFromId()` - Consistent hue generation from session IDs
- `folderName()` - Path parsing edge cases
- `toolStatus()` - Tool → status mapping
- `toolLabel()` - Tool → label mapping with emojis

#### Plugin Logic (21 tests)

- Agent lifecycle (creation, updates, deletion)
- Idle state tracking for subagents
- Status transitions (idle → thinking → editing → idle)
- Tool execution tracking (`tool.execute.before/after`)
- Permission handling (`permission.updated/replied`)
- Error state handling (`session.error`)

#### Hooks (10 tests)

- `tool.execute.before` - Updates agent status based on tool
- `tool.execute.after` - Resets to thinking state
- `event` - All event types (session.created, session.updated, session.deleted, session.idle, session.status, session.error, message.updated, permission.updated, permission.replied)

### Integration Tests (10 passing)

#### WebSocket Server

- Server startup on port 2727
- Client connection handling
- Broadcast to all connected clients
- Heartbeat mechanism
- Idle cleanup for subagents
- Multi-instance synchronization
- Graceful shutdown

### E2E Tests

Browser automation tests using playwright-cli (requires browser setup):

- Connection status display
- Agent rendering (single, multiple, subagents)
- Status updates and animations
- Visual regression tests with screenshots

## E2E Test Setup

The E2E tests require:

1. playwright-cli installed globally
2. Browser automation enabled
3. Port 2727 available for WebSocket server

To run E2E tests:

```bash
# Ensure port 2727 is free
lsof -ti:2727 | xargs kill -9 2>/dev/null || true

# Run E2E tests
bun test tests/e2e
```

## Continuous Integration

To run tests in CI:

```bash
# Install dependencies
bun install

# Run all tests
bun test

# Or run with reporter
bun tests/run-tests.ts

# Check exit code
echo "Tests completed with exit code: $?"
```

## Test Results

**Latest Run Summary:**

- Total Tests: 57 (Unit + Integration)
- Passed: 57
- Failed: 0
- Duration: ~650ms

All unit and integration tests pass successfully!
