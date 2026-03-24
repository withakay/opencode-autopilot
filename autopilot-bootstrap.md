# Autopilot Plugin — Bootstrap Prompt

> **Purpose**: Reentrant loop prompt for an agent building the autopilot mode plugin.
> The agent can be interrupted at any point and must resume without redoing work.

---

## Instructions

You are building a strict-TypeScript autopilot mode plugin for OpenCode.

**Before doing anything else**, read these files to orient yourself:

1. `.local/tasks.md` — the authoritative task checklist. This is your worklist.
2. `.local/autopilot-spec.md` — the full specification you are implementing.
3. `plugins/autopilot/` — scan whatever exists. This is where your code goes.

### Reentry Protocol

Every time you start (or resume), follow this exact sequence:

1. **Read `.local/tasks.md`** and find the first unchecked (`- [ ]`) task.
2. **Scan `plugins/autopilot/`** to see what files already exist and what state they are in.
3. **Skip any task whose deliverable already exists and is correct.** If a file is present, type-checks, and satisfies the task description, mark it `- [x]` in `tasks.md` and move on.
4. **Work on the first genuinely incomplete task.** Implement it, then verify with `bun build --no-bundle` or `bun test` as appropriate.
5. **Mark the task done** by editing `tasks.md` to change `- [ ]` to `- [x]`.
6. **Repeat** from step 1 until all tasks are complete or you are interrupted.

Do NOT batch multiple tasks before checking them off. Mark each task done immediately after completing it. This is what makes the loop reentrant.

### Completion Gate — CRITICAL

**You are NOT done until every single task in `tasks.md` is checked off (`- [x]`).** Period.

Before claiming completion or stopping the loop:

1. **Read `tasks.md` in full.** Count every `- [ ]` (unchecked) task.
2. **If ANY task is unchecked, you are NOT complete.** Continue the loop.
3. **Do not stop at the end of a phase.** Phases are organizational groupings, not stopping points. Completing Phase 7 does not mean you are done — it means you proceed to Phase 8.
4. **Do not confuse "current phase complete" with "all work complete".** The loop ends when the task list is 100% checked, not when a phase boundary is reached.
5. **Explicitly state the count** of remaining unchecked tasks before any status report or potential exit point: "X of Y tasks remaining."

If you find yourself about to say "all tasks are complete" or "implementation is finished", STOP and re-read `tasks.md` first. Verify against the actual file, not your memory.

### Parallel Execution — Use Subagents Aggressively

You have access to powerful parallel execution capabilities. **Use them.**

- **Task tool with specialized agents**: When multiple tasks are independent (no shared state, no ordering dependency), dispatch them to subagents in parallel using the Task tool. Send a single message with multiple Task tool calls.
- **Multi-agent orchestrator** (`multi-agent-orchestrator` subagent): For complex phases with many independent subtasks, use the orchestrator to fan out work across multiple worker agents and synthesize results.
- **Independent phases**: Many phases have tasks that are internally independent (e.g., Phase 1 type files, Phase 8 hook files, Phase 9 tool files). Implement independent files in parallel via subagents rather than sequentially.
- **Test and implement in parallel**: When implementing a module and its tests are independent of other modules, dispatch the implementation to one agent and tests to another.
- **Build/type-check tasks**: Verification steps (`bun build`, `bun test`) can run in parallel with reading/planning the next phase.

**Rule of thumb**: If two tasks don't read or write the same files and don't depend on each other's output, they should run in parallel.

Examples of good parallelization opportunities:
- Phase 1: All `types/*.ts` files can be written in parallel (they only import from each other at the barrel level)
- Phase 8: Each `hooks/*.ts` file is independent and can be implemented in parallel
- Phase 9: Each `tools/*.ts` file is independent
- Phase 11 test cases: Individual test cases within a test file can be designed in parallel
- Cross-phase: While running tests for Phase N, begin reading/planning Phase N+1

### What NOT to do

- **Do NOT create a monolith.** The target file layout is specified in `tasks.md`. Each concern gets its own file. Follow it.
- **Do NOT use `any` types.** This is strict TypeScript. Use discriminated unions, branded types, and exhaustive checks.
- **Do NOT skip tests.** Every phase that calls for tests must have passing tests before you move on.
- **Do NOT guess OpenCode SDK types.** The exact types are in `.opencode/node_modules/@opencode-ai/plugin/dist/index.d.ts` and `.opencode/node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts`. Read them when you need them.
- **Do NOT claim completion prematurely.** See the Completion Gate section above.

---

## Project Context

### Runtime

- **Language**: TypeScript (strict mode)
- **Runtime**: Bun
- **Test runner**: `bun test`
- **Type check**: `bun build --no-bundle <entry.ts>` (or `bunx tsc --noEmit` if tsconfig is set up)
- **Package deps**: `@opencode-ai/plugin` (v1.3.0), which re-exports `zod` as `tool.schema` and depends on `@opencode-ai/sdk` (v1.3.0)

### Plugin Location

```
plugins/
  autopilot.ts              # Re-export entrypoint: export { AutopilotPlugin } from "./autopilot/index.ts"
  autopilot/                # All implementation code lives here
    index.ts                # Barrel
    plugin.ts               # Plugin function
    types/                  # Type definitions (one file per concept)
    state/                  # State factory, session cache
    reducer/                # Pure reducer functions (one file per phase)
    events/                 # Event validation, factory, Zod schemas
    effects/                # Effect dispatcher, snapshot persistence
    loop/                   # Control loop driver
    prompts/                # System prompt, continuation prompt, directive parsing
    hooks/                  # OpenCode hook handlers (one file per hook)
    tools/                  # Tool definitions (start, status, stop)
    __tests__/              # All test files
    tsconfig.json           # Strict config
```

### Plugin Signature

The plugin must conform to this type from `@opencode-ai/plugin`:

```typescript
import type { Plugin } from "@opencode-ai/plugin";

export const AutopilotPlugin: Plugin = async ({ client, project, directory, worktree, serverUrl, $ }) => {
  // ... setup ...
  return {
    tool: { /* autopilot_start, autopilot_status, autopilot_stop */ },
    event: async ({ event }) => { /* handle OpenCode events */ },
    "permission.ask": async (input, output) => { /* enforce permission mode */ },
    "experimental.chat.system.transform": async (input, output) => { /* inject system prompt */ },
    "chat.message": async (input, output) => { /* track control-agent turns */ },
    "tool.execute.after": async (input, output) => { /* strip markers */ },
  };
};
```

### Tool Definition Pattern

```typescript
import { tool } from "@opencode-ai/plugin";

export const myTool = tool({
  description: "...",
  args: {
    name: tool.schema.string().describe("..."),
    count: tool.schema.number().int().positive().optional(),
  },
  async execute(args, context) {
    // context: { sessionID, messageID, agent, directory, worktree, abort, metadata(), ask() }
    return "result string";
  },
});
```

### Key OpenCode SDK Types

The `event` hook receives `Event` from `@opencode-ai/sdk`. Key event types the plugin must handle:

- `session.idle` — `{ type: "session.idle"; properties: { sessionID: string } }` — This is the trigger for continuation.
- `session.error` — `{ type: "session.error"; properties: { sessionID?: string; error?: ... } }`
- `session.deleted` — `{ type: "session.deleted"; properties: { info: Session } }`
- `message.updated` — `{ type: "message.updated"; properties: { info: Message } }` — Message has `role`, `agent` (on AssistantMessage: `modelID`, `providerID`, `tokens`, `cost`).
- `message.part.updated` — `{ type: "message.part.updated"; properties: { part: Part } }` — TextPart has `{ type: "text", text, sessionID, messageID, id }`.
- `permission.updated` — permission events for tracking denied actions.

The `permission.ask` hook receives:
```typescript
input: Permission  // { id, type, pattern?, sessionID, messageID, callID?, title, metadata, time }
output: { status: "ask" | "deny" | "allow" }
```

The `experimental.chat.system.transform` hook:
```typescript
input: { sessionID?: string; model: Model }
output: { system: string[] }
```

The `client.session.promptAsync` method is how the plugin dispatches continuation prompts:
```typescript
await client.session.promptAsync({
  directory,
  workspace: worktree,
  sessionID,
  agent: workerAgent,
  parts: [{ type: "text", text: promptText }],
});
```

The `client.tui.showToast` method for notifications:
```typescript
await client.tui.showToast({
  directory,
  workspace: worktree,
  title: "...",
  message: "...",
  variant: "info" | "success" | "warning" | "error",
  duration: 3000,
});
```

### What the Plugin Does (Behavioral Summary)

The autopilot plugin implements a continuation policy for an interactive coding agent. When enabled:

1. User arms autopilot with a task via `autopilot_start` tool (triggered by `/autopilot` command).
2. The plugin dispatches the task to a worker agent (default: `pi`) via `client.session.promptAsync`.
3. On `session.idle`, the plugin reads the worker's last response, parses an `<autopilot status="continue|complete|blocked">` marker.
4. If `continue`: dispatches a continuation prompt (up to `maxContinues` times).
5. If `complete`: stops with success.
6. If `blocked`: stops with blocker reason.
7. Permission handling: `allow-all` mode auto-allows everything; `limited` mode auto-denies and blocks on first denial.
8. System prompt injection: appends autopilot instructions to the worker agent's system prompt (but suppresses for control-agent turns).
9. Marker stripping: removes `<autopilot>` tags from `autopilot_status` output so users see clean text.

### The Spec's State Machine (High-Level)

The spec defines a more rigorous model than the existing JS implementation:

- **Phases**: OBSERVE -> ORIENT -> DECIDE -> EXECUTE -> EVALUATE -> RECOVER -> BLOCKED -> STOPPED
- **Reducer model**: `reduce(state, event) -> { nextState, effects[] }` — pure, deterministic
- **Effect dispatcher**: executes effects, converts results back to events
- **Admissibility guard**: every action must pass policy/tool/path/approval/trust/resource checks
- **Safety invariants**: 9 safety properties (S1-S9) and 7 liveness properties (L1-L7)
- **Event schema**: typed envelope with correlation/causation IDs, Zod-validated payloads
- **Bounded recovery**: retry counters, non-progress limits, explicit stop reasons

The implementation must bridge the spec's formal model with OpenCode's actual hook-based plugin system. The reducer and event system are internal to the plugin; the hooks are how it integrates with OpenCode.

---

## Verification Commands

After completing any implementation task:

```bash
# Type check
bun build --no-bundle plugins/autopilot/index.ts

# Run tests
bun test plugins/autopilot/__tests__/

# Run a specific test file
bun test plugins/autopilot/__tests__/prompts.test.ts
```

After Phase 13 (code review), use the `code-review` or `coderabbit-code-review` subagent to audit the implementation against the spec. Use parallel subagents for independent review areas (structural, state machine, safety properties, hooks, effects).

After Phase 14 (full test suite), smoke test with:
```
/autopilot status
/autopilot --max 1 echo hello world
/autopilot stop
```

---

## Resume Checklist

When resuming after interruption, confirm:

1. Which task in `tasks.md` is the first unchecked one?
2. Does the file for that task already exist? If so, does it type-check and pass tests?
3. If yes to both, mark it done and move to the next.
4. If no, implement it, verify, mark it done, move on.

This loop is designed to be safe to interrupt and resume at any granularity.
