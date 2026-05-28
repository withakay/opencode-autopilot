# @withakay/opencode-autopilot

Autopilot plugin for OpenCode. It adds a `/autopilot` command for session-level autonomy and durable objective runs that keep nudging a worker agent until the work is complete, blocked, paused, cleared, or the continuation limit is reached.

## Install

```bash
npm install @withakay/opencode-autopilot
# or
bun add @withakay/opencode-autopilot
```

Register the plugin in `opencode.jsonc`:

```jsonc
{
  "plugin": [
    "@withakay/opencode-autopilot"
  ]
}
```

## What Gets Installed

The package postinstall script provisions OpenCode assets into the consuming project:

| Asset | Purpose |
|---|---|
| `.opencode/commands/autopilot.md` | `/autopilot` slash command |
| `.opencode/agents/Autopilot-Wingman-*.md` | Optional packaged worker agents |
| `.opencode/wingman-config.json` | Reference config for packaged worker agents |

The installer is non-destructive for customized Wingman assets:

- existing Wingman agent files are preserved
- existing `wingman-config.json` is preserved
- the `/autopilot` slash command is updated to the packaged version when it changes

OpenCode plugins do not dynamically register slash commands or agents, so this package installs the corresponding markdown assets into your project.

## Usage

Use the slash command in an OpenCode session:

| Command | Behavior |
|---|---|
| `/autopilot on` | Enables ambient autonomy defaults for the session. |
| `/autopilot off` or `/autopilot stop` | Disables autopilot. |
| `/autopilot status` | Shows the current autopilot state and recent events. |
| `/autopilot <objective>` | Starts an objective run for the given work. |
| `/autopilot pause` | Pauses the active objective run. |
| `/autopilot resume` | Resumes a paused or blocked objective run. |
| `/autopilot clear` | Clears the active objective run. |

Examples:

```text
/autopilot on
/autopilot Fix the failing tests without stopping until bun test passes
/autopilot Implement PLAN.md and validate with bun test
/autopilot status
```

## Modes

Autopilot has two main modes:

| Mode | How To Start | What It Does |
|---|---|---|
| Ambient autonomy | `/autopilot on` | Injects guidance that makes the active agent choose safe defaults and ask fewer routine questions. It does not start a continuation loop. |
| Objective run | `/autopilot <objective>` | Delegates work to a worker agent and continues prompting it until the objective reaches a terminal state. |

Objective runs are best when the prompt includes a verifiable stopping condition:

```text
/autopilot Complete the parser refactor without stopping until bun test and bun run typecheck pass
```

## Plans And Specs

Autopilot can work from plan/spec language in the objective. It infers likely planning context from the objective, inline plan text, and repository artifacts such as `PLAN.md`, `specs/`, `.ito`, `openspec`, or `.specify`.

Users do not need to specify a plan framework. Phrases like "follow the plan", "apply the spec", "implement the proposal", or "continue the accepted change" are enough for autopilot to look for relevant context before continuing.

## Goal Contracts And Run Cards

Objective runs now create a structured goal contract from the prompt, `doneWhen`, `verifyWith`, plan text, and detected plan/spec sources. The contract tracks:

- goal quality (`strong`, `inferred`, or `weak`)
- stop condition
- read-first sources such as `PLAN.md` or `specs/...`
- acceptance criteria derived from `doneWhen`, `verifyWith`, or plan steps
- checkpoint evidence and the latest verification result

Use `/autopilot status` to inspect a human-readable run card while the objective is running:

```text
Autopilot status: ...

## Autopilot Run Card
Objective: Fix the failing tests without stopping until bun test passes
Status: active (ENABLED)
Goal quality: strong
Stop condition: bun test passes
Current checkpoint: Repair verification failure (active)
Acceptance criteria:
• bun test passes
• Verification command passes: bun test
Last verification: failed — Verification command failed (bun test): ...
Budget: continuation 3/10; agent general
```

When a run completes, blocks, fails, or is cleared, the status includes a final digest with the stop reason, recent evidence, and a suggested next action when applicable.

## Permissions

Autopilot supports two permission modes:

| Mode | Behavior |
|---|---|
| `limited` | Default. Permission requests are denied and the objective blocks for the user. |
| `allow-all` | Permission requests are allowed automatically. |

`verifyWith` commands require `allow-all` because they run controller-side after the model claims the objective is complete.

## Packaged Wingman Agents

This package includes optional worker-agent presets:

- `Autopilot-Wingman-GLM51`
- `Autopilot-Wingman-Kimi25`
- `Autopilot-Wingman-MiniMax25`
- `Autopilot-Wingman-GH-GPT54`
- `Autopilot-Wingman-GH-Gemini31`
- `Autopilot-Wingman-GH-Sonnet46`

Most users can ignore these and use the default worker agent. They are available if you want to route objective runs to a specific model/profile.

## Optional Repo Config

Autopilot reads optional repo-local config from:

- `.autopilot/config.jsonc`
- `.autopilot/config.json`

If both exist, `config.jsonc` wins. If neither exists, autopilot uses built-in behavior.

Example:

```jsonc
{
  "promptInjection": {
    "system": [
      "Follow the active spec workflow if present."
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
      "missing acceptance criteria"
    ],
    "highImpactPatterns": [
      "schema migration"
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

Config fields:

| Field | Purpose |
|---|---|
| `promptInjection.system` | Adds repo-specific hints to the autopilot system prompt. |
| `promptInjection.continuation` | Adds hints to continuation prompts. |
| `promptInjection.validation` | Adds hints to validation checkpoints. |
| `promptInjection.compaction` | Adds hints to compaction context. |
| `directiveRules.blockedPatterns` | Adds literal phrases that should block continuation. |
| `directiveRules.highImpactPatterns` | Adds literal phrases that should stop for user input. |
| `workflow` | Adds structured workflow reminders to compaction context. |

## Agent-Facing Details

You are right that some instructions can look like they belong in an agent prompt rather than a README. The agent-facing behavior is intentionally kept in these files:

| File | Audience |
|---|---|
| `.opencode/commands/autopilot.md` | Slash-command argument interpretation for OpenCode agents. |
| `prompts/system-prompt.ts` | Runtime autonomy guidance injected into agent context. |
| `prompts/continuation.ts` | Continuation, validation, and plan-step prompts. |
| `prompts/directives.ts` | Internal status marker parsing and fallback directive inference. |

The README should stay human-facing: install, configure, use, and develop the plugin.

## Architecture

The plugin uses OpenCode hooks to add autonomy guidance, manage permissions, preserve state during compaction, and drive objective-run continuations.

| Hook / Surface | Purpose |
|---|---|
| `tool.autopilot` | Enables/disables autopilot, reports status, or starts an objective run. |
| `permission.ask` | Applies `limited` or `allow-all` permission policy while autopilot is enabled. |
| `experimental.chat.system.transform` | Injects autonomy guidance into the active agent context. |
| `chat.message` | Tracks the pending agent so delegated prompts are scoped to the worker. |
| `experimental.session.compacting` | Preserves autopilot state and recent events across compaction. |
| `event` | Watches session/message events and continues objective runs on `session.idle`. |
| `tool.execute.after` | Cleans internal autopilot markers from autopilot tool output. |

## Development

```bash
bun install
bun run typecheck
bun test ./__tests__/
bun run lint
bun run build
```

## Repository Layout

```text
index.ts                    # package entry point
plugin.ts                   # OpenCode plugin factory and continuation controller
config/                     # optional .autopilot/config loading
hooks/                      # OpenCode hook handlers
prompts/                    # prompt builders, directives, status formatting
state/                      # state factory, persistence, session cache
tools/                      # autopilot tool, plan parsing, planning inference
types/                      # shared runtime types
__tests__/                  # unit/integration tests
__tests__/e2e/              # opt-in behavioral PTY/simulation tests
```

## License

MIT
