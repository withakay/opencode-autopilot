# codemap: config

IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for this subsystem.

## Responsibility
|owns: optional repo-local `.autopilot/config.{jsonc,json}` loading, normalization, workflow summary lines |not: durable runtime state (`state/persistence.ts` owns `.autopilot/state.json`)

## Entry Points
|entry: `autopilot-config.ts#loadAutopilotConfig(directory)` -> `AutopilotConfig` |caller: `plugin.ts` at plugin initialization
|entry: `autopilot-config.ts#summarizeWorkflow(config)` -> compaction/workflow reminder lines |caller: `plugin.ts` > `hooks/session-compacting.ts`

## Design
|schema: `promptInjection.{system,continuation,validation,compaction}`, `directiveRules.{blockedPatterns,highImpactPatterns}`, `workflow.{active,name,phase,goal,doneCriteria,nextActions}`
|normalization: ignores non-object roots, filters string arrays to trimmed non-empty strings, `workflow.active !== false` means active
|precedence: `.autopilot/config.jsonc` before `.autopilot/config.json`

## Flow
|load: directory > `.autopilot/` > first existing candidate > strip comments for jsonc > `JSON.parse` > `normalizeConfig` > `{}` on parse/read failure
|summary: active workflow > optional lines for name/phase/goal/doneCriteria/nextActions

## Integration
|up: `plugin.ts` caches config once per plugin instance |down: `prompts/*` consume injection/rules, `hooks/session-compacting.ts` consumes workflow summary

## Gotchas
|!: config is best-effort; malformed config returns `{}` and must not break plugin startup
|!: `stripJsonComments` is simple regex stripping, not a full JSONC parser; avoid supporting exotic comment-in-string cases unless replacing parser intentionally
|edge: `loadAutopilotConfig` uses `existsSync` before async read; tests create temp config dirs

## Tests
|tests: `__tests__/config.test.ts` -> jsonc loading, jsonc-over-json precedence, prompt injection, directive rule extension, workflow summary
