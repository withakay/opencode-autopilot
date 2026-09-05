# codemap: tools

IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for this subsystem.

## Responsibility
|owns: the `autopilot` tool JSON Schema surface + input normalization, inline plan parsing, planning-context inference, usage text |not: action execution (`controller/actions.ts#runAction`)

## Entry Points
|entry: `autopilot.ts#autopilotToolInput` -> JSON Schema with the v1 argument surface |caller: `plugin.ts` registers via `ctx.tool.transform`
|entry: `autopilot.ts#normalizeAutopilotToolInput` -> validates untyped tool input into `AutopilotActionArgs`
|entry: `plan.ts#parsePlan` -> JSON array or newline text -> `PlanStep[]`
|entry: `planning.ts#inferPlanningContext` -> repo artifacts + wording -> `{planSource,planningFramework}`
|entry: `usage.ts#buildAutopilotUsage` -> help text

## Gotchas
|!: the tool and the `/autopilot` command share one `runAction(sessionID, args)`; keep the argument surfaces aligned with `command/parse.ts#AutopilotActionArgs`
|!: `action="on"` stays ambient even if objective text is present; objective runs force `aggressive` strength
|!: tool output has autopilot status markers stripped inline in `plugin.ts`

## Tests
|tests: `__tests__/autopilot-tool.test.ts` -> normalization, ambient/objective split, plan parsing, stop/clear, agent switch
