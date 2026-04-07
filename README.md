# @withakay/opencode-autopilot

Autopilot mode plugin for OpenCode — autonomous multi-step task execution with safety guarantees.

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

The plugin registers a primary control tool plus compatibility helpers:

- **`autopilot`** — Start, inspect, stop, or get help for autopilot from one tool
- **`autopilot_start`** — Compatibility helper to arm autopilot mode
- **`autopilot_status`** — Compatibility helper to show autopilot status
- **`autopilot_stop`** — Compatibility helper to stop autopilot mode
- **`autopilot_help`** — Compatibility helper to show usage instructions
- **`autopilot_prompt`** — Optional prompt for a dedicated control agent

### Direct Tool Usage

Call the `autopilot` tool directly:

- Start: `autopilot(task="Fix the failing tests")`
- Status: `autopilot(action="status")`
- Stop: `autopilot(action="stop", reason="inspect manually")`

Optional start settings:

- `permissionMode`: `limited` or `allow-all`
- `maxContinues`: positive integer continuation cap
- `workerAgent`: worker agent name

### Optional Control Agent

Create an agent in `opencode.jsonc` to control the plugin:

```jsonc
{
  "agent": {
    "autopilot": {
      "description": "Control agent for autopilot plugin",
      "mode": "primary",
      "temperature": 0,
      "tools": {
        "autopilot_start": true,
        "autopilot_status": true,
        "autopilot_stop": true,
        "autopilot_help": true,
        "autopilot_prompt": true,
        "autopilot": true
      }
    }
  }
}
```

The agent should call `autopilot_prompt` at the start of each session to get its operating instructions. The prompt now routes all control requests through the single `autopilot` tool.

Then switch to the Autopilot agent and send your task.

### Permission Modes

- **`limited`** (default) — Auto-denies all permission requests; blocks on first denial
- **`allow-all`** — Auto-allows all permission requests

## Architecture

The plugin implements an OODA (Observe-Orient-Decide-Act) control loop with a formal state machine.

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
    index.ts, help.ts, start.ts, status.ts, stop.ts
  __tests__/                    # All test files
    helpers.ts, reducer.test.ts, events.test.ts,
    effects.test.ts, prompts.test.ts, plugin.test.ts,
    safety.test.ts
```

## License

MIT
