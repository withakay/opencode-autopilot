# codemap: __tests__/e2e/helpers

IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for this subsystem.

## Responsibility
|owns: e2e scenario definitions, temp workspace helpers, OpenCode PTY/simulation runner, output pattern validation |not: unit test state machinery

## Entry Points
|entry: `fixtures.ts#{FILE_CREATION_SCENARIO,ROUTINE_CHOICE_SCENARIO,MULTI_STEP_SCENARIO,getCIScenarios,getFullScenarios}` -> scenario catalog
|entry: `pty-runner.ts#runAutopilotSession(prompt, config)` -> `RunResult`
|entry: `pty-runner.ts#{createTestWorkspace,isOpenCodeAvailable,isPTYAvailable,validatePatterns}` -> harness utilities

## Design
|runner cfg: `{strength,workDir,timeoutMs,verbose?,forceSimulation?}`
|result: `{exitCode,output,timedOut,durationMs,pluginActivated,behaviors}`
|real mode: `opencode` availability + POSIX PTY + no `forceSimulation`; uses Bun spawn/PTY support
|simulation: deterministic fallback output for harness/pattern checks
|fixtures: scenarios define expected patterns per strength plus forbidden patterns/timeouts

## Flow
|run: choose real/sim > race session vs timeout > kill timed-out real PTY if possible > parse output into behavior flags
|workspace: create `/tmp/opencode-autopilot-test-*` dir > optional side-effect verification > cleanup
|patterns: match required/forbidden substrings in output, returning `{matched,missing,forbidden}`

## Integration
|up: `__tests__/e2e/autonomous-behavior.test.ts` |down: Bun `spawn/spawnSync`, Node temp/fs APIs, `types/state.ts`

## Gotchas
|!: real PTY cleanup on timeout is safety-critical; do not remove kill/wait path
|!: `pluginActivated` is required evidence for real mode success; generic CLI output is insufficient
|!: scenarios validate tendencies; exact OpenCode output can drift
|edge: PTY unavailable on Windows by design; tests should fall back/skip, not fail due to platform

## Tests
|tests: `__tests__/e2e/autonomous-behavior.test.ts` exercises these helpers in simulation and optional real mode
