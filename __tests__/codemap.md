# codemap: __tests__

IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for this subsystem.

## Responsibility
|owns: unit/integration tests for the command parser, controller flow through a fake `Plugin.Context`, tool surface, prompts, and config |not: live opencode2 end-to-end coverage

## Entry Points
|entry: `helpers.ts#createFakeContext` -> fake ctx recording `session.synthetic`/`interrupt`, storage KV, rpc emits; events pushed into a fake async iterable
|entry: `command-parse.test.ts` -> `/autopilot` grammar
|entry: `plugin.test.ts` -> dispatch-in-command, continuation, validation/complete, permission deny, limits, pause/interrupt, restart recovery
|entry: `autopilot-tool.test.ts` -> tool registered via `tool.transform`
|entry: `prompts.test.ts`, `config.test.ts` -> prompt builders, directive inference, repo config

## Gotchas
|!: event assertions must use `created` timestamps after the dispatch time; stale execution ends are ignored by design
|!: after pushing events call `settle()` so the plugin event loop drains
|!: the fake event stream must honor the abort signal or plugin cleanup hangs

## Tests
|tests: run with `bun test ./__tests__/`
