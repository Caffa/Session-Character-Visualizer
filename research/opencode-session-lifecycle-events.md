# OpenCode Session Lifecycle Events Research

## Executive Summary

Based on analysis of the OpenCode GitHub repository (https://github.com/anomalyco/opencode), this document details the session lifecycle events emitted when users exit or terminate sessions, including Ctrl-C handling and the `/exit` command.

---

## 1. Session Lifecycle Events Overview

### Core Session Events (from `packages/opencode/src/session/index.ts`)

The session system emits the following events through the `Session.Event` object:

```typescript
export const Event = {
  Created: BusEvent.define(
    "session.created",
    z.object({
      info: Info,
    }),
  ),
  Updated: BusEvent.define(
    "session.updated",
    z.object({
      info: Info,
    }),
  ),
  Deleted: BusEvent.define(
    "session.deleted",
    z.object({
      info: Info,
    }),
  ),
  Diff: BusEvent.define(
    "session.diff",
    z.object({
      sessionID: z.string(),
      diff: Snapshot.FileDiff.array(),
    }),
  ),
  Error: BusEvent.define(
    "session.error",
    z.object({
      sessionID: z.string().optional(),
      error: MessageV2.Assistant.shape.error,
    }),
  ),
};
```

### Key Finding: NO `session.terminated`, `session.exited`, or `session.closed` Events

**Important**: There are NO specific events named:

- `session.terminated`
- `session.exited`
- `session.closed`
- `session.ended`

The only session removal event is **`session.deleted`**, which is emitted when a session is explicitly removed via `Session.remove()`.

---

## 2. Event Emission Locations

### Session Creation

**File**: `packages/opencode/src/session/index.ts` (lines ~217-230)

```typescript
export const createNext = async (input: {
  id?: string;
  title?: string;
  parentID?: string;
  directory: string;
  permission?: PermissionNext.Ruleset;
}) => {
  const result: Info = {
    // ... session initialization
  };
  log.info("created", result);
  Database.use((db) => {
    db.insert(SessionTable).values(toRow(result)).run();
    Database.effect(() =>
      Bus.publish(Event.Created, {
        info: result,
      }),
    );
  });
  // ...
};
```

### Session Deletion

**File**: `packages/opencode/src/session/index.ts` (lines ~395-410)

```typescript
export const remove = fn(Identifier.schema("session"), async (sessionID) => {
  const project = Instance.project;
  try {
    const session = await get(sessionID);
    for (const child of await children(sessionID)) {
      await remove(child.id);
    }
    await unshare(sessionID).catch(() => {});
    // CASCADE delete handles messages and parts automatically
    Database.use((db) => {
      db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run();
      Database.effect(() =>
        Bus.publish(Event.Deleted, {
          info: session,
        }),
      );
    });
  } catch (e) {
    log.error(e);
  }
});
```

---

## 3. Ctrl-C (SIGINT) Handling

### No Session-Specific Termination Event on Ctrl-C

When a user presses **Ctrl-C** to terminate a session:

1. **The TUI application handles the signal at the process level**
2. **No `session.terminated` or similar event is emitted**
3. **The session remains in the database** - it's NOT deleted
4. **The instance is disposed**, which emits `server.instance.disposed`

### Instance Disposal Event

**File**: `packages/opencode/src/bus/index.ts` (lines ~14-20)

```typescript
export const InstanceDisposed = BusEvent.define(
  "server.instance.disposed",
  z.object({
    directory: z.string(),
  }),
);
```

**File**: `packages/opencode/src/project/instance.ts` (lines ~85-95)

```typescript
async dispose() {
  Log.Default.info("disposing instance", { directory: Instance.directory })
  await State.dispose(Instance.directory)
  cache.delete(Instance.directory)
  GlobalBus.emit("event", {
    directory: Instance.directory,
    payload: {
      type: "server.instance.disposed",
      properties: {
        directory: Instance.directory,
      },
    },
  })
}
```

### TUI App Exit Handling

**File**: `packages/opencode/src/cli/cmd/tui/app.tsx`

The TUI is configured with `exitOnCtrlC: false`:

```typescript
render(
  () => {
    /* ... */
  },
  {
    targetFps: 60,
    gatherStats: false,
    exitOnCtrlC: false, // <-- Ctrl-C does NOT exit by default
    useKittyKeyboard: {},
    autoFocus: false,
    // ...
  },
);
```

### Exit Command Implementation

**File**: `packages/opencode/src/cli/cmd/tui/context/exit.tsx`

```typescript
export const { use: useExit, provider: ExitProvider } = createSimpleContext({
  name: "Exit",
  init: (input: { onExit?: () => Promise<void> }) => {
    const renderer = useRenderer();
    let message: string | undefined;
    const store = {
      set: (value?: string) => {
        const prev = message;
        message = value;
        return () => {
          message = prev;
        };
      },
      clear: () => {
        message = undefined;
      },
      get: () => message,
    };
    const exit: Exit = Object.assign(
      async (reason?: unknown) => {
        // Reset window title before destroying renderer
        renderer.setTerminalTitle("");
        renderer.destroy();
        win32FlushInputBuffer();
        if (reason) {
          const formatted = FormatError(reason) ?? FormatUnknownError(reason);
          if (formatted) {
            process.stderr.write(formatted + "\n");
          }
        }
        const text = store.get();
        if (text) process.stdout.write(text + "\n");
        await input.onExit?.();
      },
      {
        message: store,
      },
    );
    return exit;
  },
});
```

---

## 4. /exit Command Handling

### Command Registration

**File**: `packages/opencode/src/cli/cmd/tui/app.tsx` (lines ~375-385)

```typescript
{
  title: "Exit the app",
  value: "app.exit",
  slash: {
    name: "exit",
    aliases: ["quit", "q"],
  },
  onSelect: () => exit(),
  category: "System",
}
```

### What Happens on /exit:

1. The `exit()` function from `ExitProvider` is called
2. Renderer is destroyed (terminal UI cleanup)
3. `win32FlushInputBuffer()` clears any pending input
4. Optional exit message is displayed
5. `onExit` callback is invoked (from TUI initialization)

**Important**: The `/exit` command does NOT:

- Delete the current session
- Emit any session-specific event
- Mark the session as closed/terminated

The session remains in the database and can be resumed later.

---

## 5. Session Status vs Session Lifecycle

### Session Status (Real-time State)

**File**: `packages/opencode/src/session/status.ts`

```typescript
export namespace SessionStatus {
  export type Status =
    | { type: "idle" }
    | { type: "busy" }
    | { type: "retry"; attempt: number; message: string; next: number }
    | { type: "error"; message: string };
}
```

Status is set during message processing but does NOT persist session state across restarts.

### Session Metadata (from `Session.Info`)

**File**: `packages/opencode/src/session/index.ts` (lines ~96-130)

```typescript
export const Info = z.object({
  id: Identifier.schema("session"),
  slug: z.string(),
  projectID: z.string(),
  workspaceID: z.string().optional(),
  directory: z.string(),
  parentID: Identifier.schema("session").optional(),
  summary: z
    .object({
      additions: z.number(),
      deletions: z.number(),
      files: z.number(),
      diffs: Snapshot.FileDiff.array().optional(),
    })
    .optional(),
  share: z
    .object({
      url: z.string(),
    })
    .optional(),
  title: z.string(),
  version: z.string(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
    compacting: z.number().optional(),
    archived: z.number().optional(), // <-- Sessions can be archived
  }),
  permission: PermissionNext.Ruleset.optional(),
  revert: z
    .object({
      messageID: z.string(),
      partID: z.string().optional(),
      snapshot: z.string().optional(),
      diff: z.string().optional(),
    })
    .optional(),
});
```

---

## 6. Difference Between session.deleted and Termination

| Aspect               | `session.deleted`      | Ctrl-C /exit                                |
| -------------------- | ---------------------- | ------------------------------------------- |
| **Event Emitted**    | `session.deleted`      | `server.instance.disposed` (instance-level) |
| **Session in DB**    | Removed                | Remains                                     |
| **Can Resume**       | No                     | Yes                                         |
| **Children Deleted** | Yes (cascade)          | No                                          |
| **Triggered By**     | Explicit delete action | App exit/interrupt                          |

---

## 7. Event Hook Structure for Plugins

### Plugin Event Interface

**File**: `packages/opencode/src/plugin/index.ts`

Plugins can subscribe to events via the hook system:

```typescript
export interface Plugin {
  name: string;
  hooks?: {
    // Tool execution hooks
    "tool.execute.before"?: (event: ToolExecuteEvent) => Promise<void>;
    "tool.execute.after"?: (event: ToolExecuteEvent) => Promise<void>;

    // Event hook for all bus events
    event?: (event: { type: string; properties: any }) => Promise<void>;

    // Initialization
    init?: () => Promise<void>;
  };
}
```

### Events a Plugin Can Listen To:

```typescript
// Session lifecycle
"session.created"; // New session created
"session.updated"; // Session metadata updated
"session.deleted"; // Session permanently deleted
"session.diff"; // File diff generated
"session.error"; // Error during session processing

// Instance lifecycle
"server.instance.disposed"; // Instance cleaned up (Ctrl-C, exit)
"server.connected"; // Event stream connected
"server.heartbeat"; // Keepalive ping

// Message events
"message.part.updated";
"message.part.delta";
"message.part.removed";

// Tool events
"tool.execute.before";
"tool.execute.after";

// Command events
"command.executed";

// TUI events
"tui.command.execute";
"tui.prompt.append";
"tui.session.select";
```

---

## 8. User-Initiated Exit vs System Termination

### No Distinction in Events

OpenCode does NOT differentiate between:

- User pressing Ctrl-C
- User typing `/exit`
- System signal (SIGTERM)
- Connection loss

All result in:

1. TUI cleanup
2. Instance disposal (`server.instance.disposed`)
3. Session remains in database

### To Detect "Active" vs "Closed" Sessions:

Since there's no explicit "closed" state, you must infer from:

1. **Session has no pending messages** (all assistant messages have `time.completed`)
2. **Session status is "idle"** (from `SessionStatus`)
3. **Instance disposal event** (`server.instance.disposed`)
4. **Time since last update** (compare `time.updated` to current time)

---

## 9. Summary for Plugin Developers

### To detect when a user exits a session:

**Option 1: Listen for instance disposal**

```typescript
hooks: {
  "event": async (event) => {
    if (event.type === "server.instance.disposed") {
      // User exited (Ctrl-C or /exit)
      // All sessions in this directory are now "inactive"
    }
  }
}
```

**Option 2: Track session status**

```typescript
hooks: {
  "event": async (event) => {
    if (event.type === "session.updated") {
      // Check if session has pending work
      const hasPendingWork = /* check for incomplete assistant messages */
    }
  }
}
```

**Option 3: Poll session list**
Periodically fetch `/session` endpoint to see which sessions exist and their `time.updated`.

### Important Notes:

1. **Sessions are never automatically deleted** on exit
2. **No explicit "session ended" event exists**
3. **Child sessions (forks) remain when parent exits**
4. **Use `time.updated` to detect inactive sessions**
5. **Archived sessions** have `time.archived` set (via `setArchived` API)

---

## 10. Code References

| File                                                 | Purpose                            |
| ---------------------------------------------------- | ---------------------------------- |
| `packages/opencode/src/session/index.ts`             | Session CRUD, Event definitions    |
| `packages/opencode/src/bus/index.ts`                 | Event bus, InstanceDisposed event  |
| `packages/opencode/src/bus/bus-event.ts`             | Event definition framework         |
| `packages/opencode/src/project/instance.ts`          | Instance lifecycle, disposal       |
| `packages/opencode/src/cli/cmd/tui/app.tsx`          | TUI, exit command, Ctrl-C handling |
| `packages/opencode/src/cli/cmd/tui/context/exit.tsx` | Exit function implementation       |
| `packages/opencode/src/server/server.ts`             | HTTP API, event streaming endpoint |
| `packages/opencode/src/session/status.ts`            | Session status (busy/idle/retry)   |

---

## Conclusion

OpenCode's session lifecycle is **persistent by design** - sessions are NOT terminated or deleted when users exit. The only session removal event is `session.deleted`, which requires explicit action. To detect "inactive" sessions, plugins should:

1. Listen for `server.instance.disposed` to know when a user exits
2. Track `session.updated` events with `time.updated` timestamps
3. Check for incomplete assistant messages to determine if work is pending
4. Consider sessions "closed" after a period of inactivity (e.g., 5+ minutes since `time.updated`)

There is no built-in concept of a "terminated" or "exited" session state - sessions simply become inactive until the user resumes them.
