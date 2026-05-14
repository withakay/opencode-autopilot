# codemap: __tests__

IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for this subsystem.

## Responsibility
|owns: unit/integration tests for tool args, plugin hooks/continuation loop, prompt/directive behavior, repo config |not: real end-user OpenCode coverage beyond guarded e2e folder

## Entry Points
|entry: `autopilot-tool.test.ts` -> direct `createAutopilotTool` behavior with fake deps/context
|entry: `plugin.test.ts` -> assembled plugin/hook integration with fake OpenCode client and temp dirs
|entry: `prompts.test.ts` -> prompt builders, marker parsing, directive inference, max normalization
|entry: `config.test.ts` -> `.autopilot/config.*` loading and config-driven prompt/directive behavior

## Design
|test runner: Bun (`bun test ./__tests__/`) |assertions: `bun:test` `describe/expect/test`
|fixtures: tests often create minimal tool context `{sessionID,messageID,agent,directory,worktree,abort,metadata,ask}`
|plugin tests: use synthetic OpenCode event payloads and fake `client.session.promptAsync`/`client.tui.showToast`
|temp dirs: `mkdtemp(join(tmpdir(), ...))` + `rm(...,{recursive:true,force:true})`

## Flow
|tool: execute args > inspect captured state maps/history callbacks
|plugin: arm objective > send `session.idle` > fake worker `message.updated` + `message.part.updated` > idle > assert prompt calls/status
|config: write temp `.autopilot/config.jsonc|json` > load > assert normalized output and prompt integration

## Integration
|up: package scripts `test`, `check`; pre-commit type/lint likely runs |down: all runtime folders via direct imports

## Gotchas
|!: many plugin tests depend on default worker agent being `general` from `plugin.ts`, while factory fallback is `pi`
|!: synthetic event payload shape must match hook normalizers; malformed payloads silently no-op
|!: persistence tests use real `.autopilot/state.json` under temp dirs; never point them at repo root
|edge: controller `verifyWith` tests execute simple commands (`true`/`false`) and require permission mode semantics

## Tests
|tests: this folder is itself test coverage; see `__tests__/e2e/codemap.md` for behavioral PTY tests
