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

### Optional repo config

Autopilot can read optional repo-local configuration from:

- `.autopilot/config.jsonc`
- `.autopilot/config.json`

If both exist, `config.jsonc` wins. If neither exists, autopilot uses its built-in behavior.

This config is intentionally lightweight and prompt-oriented. It lets you add workflow/spec hints without creating a hard dependency on any specific spec framework.

Example:

```jsonc
{
  "promptInjection": {
    "system": [
      "Follow the active spec workflow if present.",
      "Do the next checklist item instead of asking for routine confirmation."
    ],
    "continuation": [
      "Keep working through the current spec checklist."
    ],
    "validation": [
      "Before marking complete, validate against the acceptance criteria."
    ],
    "compaction": [
      "Preserve current workflow phase, acceptance criteria, and next actions."
    ]
  },
  "directiveRules": {
    "blockedPatterns": [
      "missing acceptance criteria",
      "waiting for spec clarification"
    ],
    "highImpactPatterns": [
      "schema migration",
      "breaking API change"
    ]
  },
  "workflow": {
    "name": "SpecFlow",
    "phase": "implement",
    "goal": "Finish the current spec increment",
    "doneCriteria": [
      "implementation complete",
      "tests pass"
    ],
    "nextActions": [
      "implement code",
      "run tests",
      "validate against acceptance criteria"
    ]
  }
}
```

What it does:

- `promptInjection.system` appends repo-specific workflow hints to the autopilot system prompt
- `promptInjection.continuation` appends hints to each continuation prompt
- `promptInjection.validation` appends hints to validation checkpoints
- `promptInjection.compaction` appends hints to the compaction context
- `directiveRules.blockedPatterns` extends blocker detection for responses without explicit autopilot markers
- `directiveRules.highImpactPatterns` extends high-impact detection so autopilot stops instead of auto-continuing
- `workflow` adds structured workflow/spec reminders to compaction context

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

The plugin is intentionally small: it uses OpenCode hooks to add session-scoped autonomy guidance, intercept permissions, preserve autopilot state during compaction, and drive an optional delegated-task continuation loop.

### Runtime integration points

| Hook / surface | Purpose |
|----------------|---------|
| `tool.autopilot` | Enables/disables autopilot, reports status, or starts a delegated task |
| `permission.ask` | Applies `limited` or `allow-all` permission policy while autopilot is enabled |
| `experimental.chat.system.transform` | Injects autonomy guidance; delegated worker turns also receive status-marker instructions |
| `chat.message` | Tracks the pending agent so delegated status markers are scoped to the configured worker |
| `experimental.session.compacting` | Preserves autopilot goal, worker, continuation count, and recent events across compaction |
| `event` | Watches message/session events and continues delegated tasks on `session.idle` |
| `tool.execute.after` | Removes internal autopilot markers from autopilot tool output |

The continuation loop relies on explicit assistant status markers for delegated work:

```xml
<autopilot status="continue|validate|complete|blocked">short reason</autopilot>
```

If a worker asks a routine confirmation question like "Do you want me to run the tests?", the plugin treats that as `continue` and sends the next continuation prompt. High-impact or genuinely blocked questions still stop for user input.

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
    index.ts, mode.ts, phase.ts, stop-reason.ts, state.ts
  state/                        # State factory, session cache
    index.ts, factory.ts, session-cache.ts
  prompts/                      # System prompt, continuation, directives
    index.ts, system-prompt.ts, continuation.ts,
    directives.ts, normalize.ts, format.ts
  hooks/                        # OpenCode hook handlers
    index.ts, event-handler.ts, permission.ts,
    system-transform.ts, session-compacting.ts,
    chat-message.ts, tool-after.ts
  tools/                        # Tool definitions
    index.ts, autopilot.ts, usage.ts
  __tests__/                    # All test files
    prompts.test.ts, plugin.test.ts, autopilot-tool.test.ts
```

## License

MIT
