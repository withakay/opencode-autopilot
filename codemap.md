# codemap: opencode-autopilot

IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for this repository.

## Responsibility
|owns: OpenCode v2 plugin providing ambient autopilot autonomy and durable delegated objective runs with plan steps, continuation nudges, validation, permission policy, and storage-backed state
|not: OpenCode core agent runtime, TUI rendering beyond the `./tui` companion, public API beyond exported plugin/package assets

## Entry Points
|entry: `index.ts` -> default export `Plugin.define({ id: "autopilot", setup: createAutopilotPlugin })`
|entry: `plugin.ts#createAutopilotPlugin` -> controller wiring: command, tool, hooks, event loop, rpc, storage
|entry: `command/parse.ts#parseAutopilotCommand` -> deterministic `/autopilot` grammar
|entry: `controller/actions.ts#runAction` -> shared action execution for command + tool
|entry: `rpc.ts#AutopilotRpc` -> RPC contract (`./rpc` export); `tui.ts` companion (`./tui` export)
|entry: `package.json` scripts -> `build`, `typecheck`, `test`, `lint`, `check`

## Design
|runtime: per-session `ExtendedState` + transient `SessionTracking`; persisted per session as `state/<sessionID>` in `ctx.storage`
|modes: ambient `/autopilot on` injects autonomy guidance only; `/autopilot <objective>` dispatches the first worker prompt inside the command execute call
|continuation: `session.execution.succeeded` -> read worker reply via `ctx.session.context` since `dispatchedAt` -> marker directive -> continue/validate/complete/block/step-done
|verification: optional `verifyWith` runs controller-side only in `allow-all`; tokenized `execFile`, shell metacharacters blocked; cwd = `ctx.location.directory`
|budgets: continuation count, duration, tracked tokens, low-progress turns; stops or pauses with explicit stop reasons
|feedback: rpc events `notice`/`card` consumed by the TUI companion; emits never break the controller

## Flow
|objective: command/tool start > parse args/plan > `createSessionState` > persist > `session.synthetic` dispatch (same call) > terminal events drive the loop
|stop: pause/off/clear set `selfInterrupt` then `session.interrupt`, so the interrupted event is not read as a user stop
|recovery: startup `storage.scan` > active runs become paused `RECOVERED_AFTER_RESTART`
|build: `bun build ./index.ts ./tui.ts ./rpc.ts --outdir ./dist --target bun --external '@opencode-ai/*' ...`

## Directory Summary
| Directory | Responsibility | codemap |
|---|---|---|
| `command/` | `/autopilot` argument grammar parser. | — |
| `config/` | Optional repo-local config loading and workflow summaries. | `config/codemap.md` |
| `controller/` | Core state/dispatch, action execution, reply decisions, verification. | — |
| `hooks/` | v2 event routing, permission policy, context text builder. | `hooks/codemap.md` |
| `prompts/` | Prompt builders, directive parsing, status formatting. | `prompts/codemap.md` |
| `state/` | State factories and storage persistence. | `state/codemap.md` |
| `tools/` | `autopilot` tool schema, plan parsing, planning inference, usage text. | `tools/codemap.md` |
| `types/` | Shared runtime/state type vocabulary. | `types/codemap.md` |
| `__tests__/` | Unit/integration coverage through a fake `Plugin.Context`. | `__tests__/codemap.md` |

## Integration
|package: npm package `@withakay/opencode-autopilot`; dependency `@opencode-ai/plugin@beta`
|assets: package ships `dist`, `README.md`, wingman agents/config
|external surfaces: `/autopilot` command, `autopilot` tool, `session.hook("context")`, `permission.hook("evaluate")`, `ctx.event.subscribe`, `ctx.rpc` (`AutopilotRpc`)

## Gotchas
|!: ambient and objective modes intentionally differ; do not make `/autopilot on` dispatch delegated work
|!: double-dispatch guard is `SessionTracking.awaitingWorkerReply`; stale execution ends are dropped via `dispatchedAt`
|!: completion is two-phase; final `complete` is validated (and `verifyWith` executed) before stop
|!: recovered active objective runs pause after plugin restart; user must inspect status and resume explicitly

## Tests
|tests: `bun test ./__tests__/`
|checks: `bun run typecheck`; `bun run lint`; `bun run check` = lint + typecheck

## Update Triggers
|update-when: hook surfaces, `ExtendedState`, marker format, plan/verification semantics, config schema, package entry/assets, or test harness flows change
