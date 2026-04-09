# @withakay/opencode-autopilot

Autopilot plugin for OpenCode — session-scoped autonomy defaults plus optional delegated long-running work.

## Installation

```bash
npm install @withakay/opencode-autopilot
# or
bun add @withakay/opencode-autopilot
```

### What gets installed for end users

On install, the package runs a postinstall script that provisions OpenCode assets into the consuming project:

- `.opencode/commands/autopilot.md` — the `/autopilot` slash command
- `.opencode/agents/Autopilot-Wingman-GLM51.md`
- `.opencode/agents/Autopilot-Wingman-Kimi25.md`
- `.opencode/agents/Autopilot-Wingman-MiniMax25.md`
- `.opencode/agents/Autopilot-Wingman-GH-GPT54.md`
- `.opencode/agents/Autopilot-Wingman-GH-Gemini31.md`
- `.opencode/agents/Autopilot-Wingman-GH-Sonnet46.md`
- `.opencode/wingman-config.json` — routing/reference config for the packaged Wingman presets

The installer is non-destructive for Wingman assets:

- existing Wingman agent files are preserved if you have customized them
- existing `wingman-config.json` is preserved if you have customized it
- the `/autopilot` slash command is updated to the packaged version when it changes

This package does **not** dynamically register slash commands or agents through the plugin API. Instead, it installs the corresponding OpenCode markdown assets into your project so they are available to end users immediately.

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

OpenCode custom slash commands live in `.opencode/commands/`. This repo includes `/autopilot` at `.opencode/commands/autopilot.md`.

After registering the plugin, the primary UX is:

- **`/autopilot on`** — enable autopilot for the rest of the session
- **`/autopilot off`** — disable autopilot
- **`/autopilot status`** — inspect current state
- **`/autopilot <task>`** — enable autopilot and delegate a long-running task immediately

### Packaged Wingman agents

The package also installs a set of reusable Wingman agents in `.opencode/agents/` for delegated work. These can be referenced by name when you want autopilot to use a specific worker agent.

Available packaged agents:

- `Autopilot-Wingman-GLM51`
- `Autopilot-Wingman-Kimi25`
- `Autopilot-Wingman-MiniMax25`
- `Autopilot-Wingman-GH-GPT54`
- `Autopilot-Wingman-GH-Gemini31`
- `Autopilot-Wingman-GH-Sonnet46`

Example direct tool usage with a packaged Wingman:

- `autopilot(task="Fix the failing tests", workerAgent="Autopilot-Wingman-GH-Sonnet46")`
- `autopilot(task="Refactor the reducer logic", workerAgent="Autopilot-Wingman-Kimi25")`
- `autopilot(task="Summarize the architecture", workerAgent="Autopilot-Wingman-GH-Gemini31")`

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
- `autopilot(action="on", autonomousStrength="aggressive")`

### Optional orchestrator agent

Autopilot no longer requires a dedicated control agent, but delegated work still runs through a configured agent (`general` by default). You can think of that agent as the orchestrator or overwatch worker that keeps a long-running task moving after `/autopilot <task>`.

### Autonomous Strength Modes

Control how strongly autopilot biases toward autonomous decision-making:

- **`conservative`** — Soft guidance to prefer defaults; asks when unsure (similar to previous behavior)
- **`balanced`** (default) — Stronger bias toward selecting recommended/safe defaults with minimal user interaction
- **`aggressive`** — Always pick recommended/safe defaults for routine choices; only escalate high-impact decisions (data deletion, major refactors) or security/safety risks

The autonomous strength affects the system prompt guidance injected into the agent's context. Aggressive mode includes explicit rules to select recommended defaults without asking, while conservative mode provides softer suggestions.

### Permission Modes

- **`limited`** (default) — Auto-denies all permission requests; blocks on first denial
- **`allow-all`** — Auto-allows all permission requests

### Question handling

OpenCode currently exposes direct permission interception but not a general question-timeout hook through the plugin API. This plugin therefore:

- auto-handles permission prompts according to the selected permission mode
- injects system prompt guidance based on the autonomous strength setting to bias the agent toward recommended defaults
- still escalates to the user when no safe default exists or for high-impact decisions

The autonomous strength parameter controls how strongly this guidance is worded. In aggressive mode, the system prompt explicitly instructs the agent to always select recommended/safe defaults for routine choices (file paths, variable names, configurations) without asking the user.

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
