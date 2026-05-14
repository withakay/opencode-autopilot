# codemap: __tests__/e2e

IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for this subsystem.

## Responsibility
|owns: guarded behavioral validation that autonomous strength modes produce observable tendencies in OpenCode/autopilot sessions |not: deterministic unit guarantees; default CI should not run real PTY tests

## Entry Points
|entry: `autonomous-behavior.test.ts` -> `E2E_ENABLED=1 bun test autonomous-behavior`
|entry: `helpers/pty-runner.ts#runAutopilotSession` -> real PTY or simulation execution
|entry: `helpers/fixtures.ts` -> scenarios and expected/forbidden output patterns

## Design
|guard: `E2E_ENABLED !== "1"` => `describe.skip`
|modes: simulation for reliable harness checks; real PTY when OpenCode CLI + POSIX PTY available and not forced simulation
|assertion style: pattern/tendency checks, plugin activation evidence, workspace side-effect checks where applicable

## Flow
|harness: create temp workspace > run simulated or real session > parse output > validate patterns > cleanup
|comparison: run same scenario under aggressive/balanced/conservative > compare behavior signals, not exact text

## Integration
|up: manual dev validation, optional CI with env var |down: `helpers/{pty-runner,fixtures}.ts`, OpenCode CLI when real mode

## Gotchas
|!: skipped by default; do not treat skipped e2e as missing coverage during normal `bun test`
|!: comments explicitly call this best-effort/flaky; avoid hardening into brittle exact-output assertions
|!: real PTY tests must fail/skip with explicit reason if plugin activation is not proven; no generic output passes
|edge: test file currently logs warning text with non-ASCII symbols; preserve existing style unless doing formatting cleanup

## Tests
|tests: `autonomous-behavior.test.ts` validates harness, scenario structure, simulation behavior, optional real PTY activation
