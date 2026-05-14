# codemap: tools

IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for this subsystem.

## Responsibility
|owns: OpenCode `autopilot` control tool UX, args, objective/ambient state creation, inline plan parsing, planning-context inference, usage text |not: continuation scheduling, hook wiring, persisted storage

## Entry Points
|entry: `autopilot.ts#createAutopilotTool` -> `tool({ args, execute })` |caller: `plugin.ts` registers as `tool.autopilot`
|entry: `usage.ts#buildAutopilotUsage` -> help text for slash/direct tool usage

## Design
|args: `action`, `{objective,goal,target,task}`, `doneWhen`, `verifyWith`, `plan`, `permissionMode`, `maxContinues`, `workerAgent`, `autonomousStrength`
|modes: explicit `on` => ambient/session-defaults; `start|run|implicit objective` => delegated objective run
|aliases: `task|goal|target` normalize to `objective`; `task`/`goal` remain compatibility aliases
|plan: `plan.ts#parsePlan` accepts JSON array or newline text -> `PlanStep[]`
|planning: `planning.ts#inferPlanningContext` uses objective/plan text + repo artifacts (`.ito`, `openspec`, `.specify`, `PLAN.md`, `specs`) -> `{planSource,planningFramework}`

## Flow
|start: execute args > normalize objective/action > parse plan > infer planning ctx > `createSessionState` > `setState` > `initSession` > `onArmed` > status string
|ambient: `action=on` > blank objective > `sessionMode=session-defaults` > system autonomy only; no continuation loop dispatch
|manage: `status` reads state+history; `pause/resume/clear/off/stop` mutate existing objective via deps callbacks

## Integration
|up: `.opencode/commands/autopilot.md`, OpenCode tool calls, `plugin.ts` deps |down: `state/factory.ts`, `prompts/normalize.ts`, `tools/{plan,planning,usage}.ts`
|events: returns metadata via `context.metadata` with objective, verify, plan framework/source, plan step count

## Gotchas
|!: `action="on"` stays ambient even if objective text is present; do not accidentally start objective runs from explicit ambient enable
|!: objective runs force `effectiveStrength="aggressive"`; ambient honors supplied/default strength
|!: direct `start/run` without objective returns help/error, not ambient enable
|edge: `inferPlanningContext` requires valid `context.directory || context.worktree`; tests usually pass temp paths

## Tests
|tests: `__tests__/autopilot-tool.test.ts` -> arg aliases, ambient/objective split, plan parsing, planning inference, status/history, pause/resume/clear, strength defaults
