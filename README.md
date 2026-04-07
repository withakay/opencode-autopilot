# @withakay/opencode-autopilot

Autopilot plugin for OpenCode — session-scoped autonomy defaults plus optional delegated long-running work.

## Installation

```bash
npm install @withakay/opencode-autopilot
# or
bun add @withakay/opencode-autopilot
```

## Usage

Register the plugin in your `opencode.jsonc`:

```jsonc
{
  "plugin": [
    "@withakay/opencode-autopilot"
  ]
}
```

The plugin registers a single `autopilot` control tool:

- **`autopilot`** — Turn autopilot on or off, show status, or start a delegated task

### Slash command entry point

OpenCode custom slash commands live in `.opencode/commands/`. This repo includes `/autopilot` at `/home/runner/work/opencode-autopilot/opencode-autopilot/.opencode/commands/autopilot.md`.

After registering the plugin, the primary UX is:

- **`/autopilot on`** — enable autopilot for the rest of the session
- **`/autopilot off`** — disable autopilot
- **`/autopilot status`** — inspect current state
- **`/autopilot <task>`** — enable autopilot and delegate a long-running task immediately

If you prefer to call the tool directly, use:

```jsonc
{
  "tool": {
    "autopilot": true
  }
}
```

Examples:

- `autopilot(action="on")`
- `autopilot(action="status")`
- `autopilot(task="Fix the failing tests", workerAgent="build-high")`

### Optional orchestrator agent

Autopilot no longer requires a dedicated control agent, but delegated work still runs through a configured agent (`general` by default). You can think of that agent as the orchestrator or overwatch worker that keeps a long-running task moving after `/autopilot <task>`.

### Permission Modes

- **`limited`** (default) — Auto-denies all permission requests; blocks on first denial
- **`allow-all`** — Auto-allows all permission requests

### Question handling

OpenCode currently exposes direct permission interception but not a general question-timeout hook through the plugin API. This plugin therefore:

- auto-handles permission prompts according to the selected permission mode
- pushes the active agent to prefer recommended defaults and keep moving when autopilot is on
- still escalates to the user when no safe default exists

## Architecture

The plugin implements a session-scoped autonomy layer plus a delegated-task continuation loop with a formal state machine.

### State Machine Phases

| Phase | Description |
|-------|-------------|
| `OBSERVE` | Ingest new evidence (user input, tool output, approvals, etc.) |
| `ORIENT` | Reconcile observations against goal; detect completion or blockers |
| `DECIDE` | Select exactly one next foreground action |
| `EXECUTE` | Dispatch the selected action |
| `EVALUATE` | Classify result as progress, non-progress, or failure |
| `RECOVER` | Attempt bounded recovery (re-plan, alternate tool, etc.) |
| `BLOCKED` | Waiting for external input (approval, trust, user input) |
| `STOPPED` | Terminal state (completed, user stop, error, etc.) |

### Safety Invariants (S1-S9)

| ID | Property | Enforcement |
|----|----------|-------------|
| S1 | No unauthorized side effects | Admissibility guard on all effects |
| S2 | Approval cannot be bypassed | `approvalRequired()` check in DECIDE |
| S3 | Trust cannot be bypassed | `trustRequired()` check in DECIDE |
| S4 | BLOCKED/STOPPED are explicit | `block()` and `stop()` require a reason |
| S5 | No silent denial loss | Denials preserved as observations in state |
| S6 | No uncontrolled livelock | Non-progress counter with enforced limit |
| S7 | STOPPED is quiescent | No effects without resume |
| S8 | Interrupt preemption | INTERRUPT → STOPPED immediately |
| S9 | State preserved across risky effects | PERSIST_SNAPSHOT before risky dispatch |

## Development

```bash
# Install dependencies
bun install

# Type check
bun run typecheck

# Run tests
bun test

# Build
bun run build
```

## File Layout

```
src/
  index.ts                      # Entry point — exports AutopilotPlugin
  plugin.ts                     # Plugin function (OpenCode hook wiring)
  types/                        # Type definitions
    index.ts, mode.ts, phase.ts, stop-reason.ts,
    event.ts, effect.ts, state.ts, reducer.ts
  state/                        # State factory, session cache
    index.ts, factory.ts, session-cache.ts
  reducer/                      # Pure reducer functions
    index.ts, reduce.ts, integrate.ts, observe.ts,
    orient.ts, decide.ts, evaluate.ts, recover.ts,
    guards.ts, transitions.ts
  events/                       # Event validation, factory, Zod schemas
    index.ts, validate.ts, factory.ts, schemas.ts
  effects/                      # Effect dispatcher, snapshot persistence
    index.ts, dispatcher.ts, snapshot.ts
  loop/                         # Control loop driver
    index.ts, control-loop.ts
  prompts/                      # System prompt, continuation, directives
    index.ts, system-prompt.ts, continuation.ts,
    directives.ts, normalize.ts, format.ts
  hooks/                        # OpenCode hook handlers
    index.ts, event-handler.ts, permission.ts,
    system-transform.ts, chat-message.ts, tool-after.ts
  tools/                        # Tool definitions
    index.ts, autopilot.ts, usage.ts
  __tests__/                    # All test files
    helpers.ts, reducer.test.ts, events.test.ts,
    effects.test.ts, prompts.test.ts, plugin.test.ts,
    safety.test.ts
```

## License

MIT
