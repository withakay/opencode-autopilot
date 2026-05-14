# codemap: opencode-autopilot

IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for this repository.

## Responsibility
|owns: OpenCode plugin providing ambient autopilot autonomy and durable delegated objective runs with plan steps, continuation nudges, validation, permission policy, compaction preservation, and persisted local state
|not: OpenCode core agent runtime, slash-command dynamic registration, public API beyond exported plugin/package assets

## Entry Points
|entry: `index.ts` -> exports `AutopilotPlugin`
|entry: `plugin.ts#AutopilotPlugin` -> OpenCode plugin factory; assembles tool + hooks
|entry: `tools/autopilot.ts#createAutopilotTool` -> control tool API used by `/autopilot` and direct tool calls
|entry: `.opencode/commands/autopilot.md` -> packaged slash command UX (installed by postinstall, included in npm files)
|entry: `package.json` scripts -> `build`, `typecheck`, `test`, `lint`, `check`, `postinstall`

## Design
|runtime: per-session `ExtendedState` + transient `SessionTracking` + `SessionCache` + persisted `.autopilot/state.json`
|modes: ambient `/autopilot on` injects autonomy defaults only; objective `/autopilot <task>|start|run` dispatches worker prompts until done/blocked/paused/limit
|continuation: `session.idle` + worker reply marker => continue/validate/complete/block/step-done state transitions
|plans: optional inline plan parsed to `PlanStep[]`; controller advances one step at a time and validates whole objective after final step
|verification: optional `verifyWith` command runs controller-side only in `allow-all`; tokenized via `execFile`, shell metacharacters blocked
|config: optional `.autopilot/config.{jsonc,json}` adds prompt hints, directive rules, workflow compaction reminders

## Flow
|ambient: slash/tool `on` > `createSessionState(...session-defaults)` > permission mode saved > system transform injects autonomy prompt without markers
|objective: slash/tool objective > parse plan/infer planning ctx > state persisted > first idle dispatches worker > worker marker cached > next idle advances/continues/validates/stops
|validation: model marks complete/validate > validation prompt > final complete triggers `verifyWith` if set > passed => `COMPLETED`; failed => continue; blocked => stop for user
|events: OpenCode messages populate `SessionCache`; `session.idle` drives loop; `session.error/deleted` stop/cleanup
|build: `bun build ./index.ts --outdir ./dist --target node --external @opencode-ai/{plugin,sdk}`

## Directory Summary
| Directory | Responsibility | codemap |
|---|---|---|
| `config/` | Optional repo-local config loading and workflow summaries. | `config/codemap.md` |
| `hooks/` | OpenCode hook adapters and event/message/permission plumbing. | `hooks/codemap.md` |
| `prompts/` | System/continuation/validation prompt builders, directive parsing, status formatting. | `prompts/codemap.md` |
| `state/` | State factories, durable persistence, transient session cache. | `state/codemap.md` |
| `tools/` | `autopilot` tool API, plan parsing, planning inference, usage text. | `tools/codemap.md` |
| `types/` | Shared runtime/state type vocabulary. | `types/codemap.md` |
| `__tests__/` | Unit/integration coverage for tool, plugin, prompts, config. | `__tests__/codemap.md` |
| `__tests__/e2e/` | Guarded behavioral PTY/simulation validation. | `__tests__/e2e/codemap.md` |

## Integration
|package: npm package `@withakay/opencode-autopilot`; peer deps `@opencode-ai/plugin`, `@opencode-ai/sdk`
|assets: package ships `dist`, `README.md`, `.opencode/commands/autopilot.md`, wingman agents/config, installer script
|external surfaces: OpenCode hooks `tool.autopilot`, `permission.ask`, `experimental.chat.system.transform`, `chat.message`, `experimental.session.compacting`, `event`, `tool.execute.after`

## Gotchas
|!: source is root-level TypeScript, not `src/`, despite older README file-layout text mentioning `src/`
|!: `.autopilot/state.json` is local runtime state and ignored; do not commit it
|!: `.opencode/`, `.ito/`, `.github/`, `.codex/` may be tool-managed; avoid placing generated codemaps there unless explicitly requested
|!: ambient and objective modes intentionally differ; do not make `/autopilot on` dispatch delegated work
|!: duplicate idle dispatch guard depends on `SessionTracking.awaitingWorkerReply`
|!: completion is two-phase; final `complete` should be validated before stop

## Tests
|tests: `bun test ./__tests__/` -> unit/integration plus skipped-by-default e2e
|checks: `bun run typecheck`; `bun run lint`; `bun run check` = lint + typecheck

## Update Triggers
|update-when: hook surfaces, `ExtendedState`, marker format, plan/verification semantics, config schema, package entry/assets, or test harness flows change
