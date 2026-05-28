# codemap: prompts

IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for this subsystem.

## Responsibility
|owns: generated system/objective/continuation/validation/plan-step prompts, autopilot marker parsing/inference, status formatting, continuation count normalization |not: OpenCode hook registration or state mutation

## Entry Points
|entry: `system-prompt.ts#buildAutopilotSystemPrompt(strength, includeStatusMarkers, config)` -> autonomy + marker instructions
|entry: `continuation.ts#{buildObjectiveStartPrompt,buildPlanStepPrompt,buildContinuationPrompt}` -> worker prompts
|entry: `directives.ts#inferAutopilotDirective(text, config)` -> `continue|step-done|validate|complete|blocked`
|entry: `format.ts#{summarizeAutopilotState,formatUsageMetadata}` -> user-facing status/history snippets
|entry: `normalize.ts#normalizeMaxContinues` -> default/capped continuation limit

## Design
|marker: `**Autopilot status: continue|step-done|validate|complete|blocked**` plus a reason line must appear at assistant-response end for objective runs
|prompt contract: objective fields include `objective`, optional planning source/framework, `doneWhen`, `verifyWith`
|planning guidance: broad recognition of Ito/OpenSpec/SpecKit/OpenCode/Codex/Copilot/Claude/Superpower Skills/Total TypeScript/Grill Me/swarm/spec workflows
|validation: `complete` first triggers validation; validation prompt demands file/test/spec checks before final complete
|normalize: default `10`, hard cap `50`

## Flow
|objective: tool start > plugin builds objective/plan prompt > worker emits marker > plugin infers directive > continue/validate/complete/block
|fallback: no marker + routine confirmation + obvious next step + no high impact => continue; high-impact question/blocking language => blocked; otherwise continue
|status: `ExtendedState` -> compact `phase,mode,session_mode,run_mode,status,continues,agent,objective,done_when,verify_with,plan,step,candidate,stop`

## Integration
|up: `plugin.ts`, hooks, tool status, tests |down: `config/autopilot-config.ts`, `types/index.ts`

## Gotchas
|!: marker regex only matches at end of text; changing this affects marker stripping and directive inference
|!: config directive patterns are escaped literal strings, not regex input
|!: validation/completion wording is intentionally strong; weakening it can reintroduce premature completion
|edge: `formatUsageMetadata` expects numeric token/cost fields; unknown SDK shapes are ignored

## Tests
|tests: `__tests__/prompts.test.ts` -> max normalization, markers, directive inference, objective/plan/validation prompt text, strength prompts
|tests: `__tests__/config.test.ts` -> config hints/rules alter prompts/directives
