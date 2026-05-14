# codemap: types

IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for this subsystem.

## Responsibility
|owns: shared TypeScript vocabulary for autopilot runtime state, mode, phase, stop reasons |not: runtime validation or persistence migration

## Entry Points
|entry: `index.ts` -> barrel exports for plugin/runtime imports
|entry: `state.ts#ExtendedState` -> canonical per-session state shape

## Design
|state: `ExtendedState` = `{session_id, mode, phase, session_mode, goal, objective, run_mode, status, done_when, verify_with, plan_source, planning_framework, candidate_completion, plan, active_step_index, stop_reason, continuation_count, max_continues, worker_agent, autonomous_strength}`
|run: `AutopilotRunMode={ambient,objective}`; `AutopilotRunStatus={active,waiting_for_reply,validating,paused,blocked,completed,failed,cleared}`
|plan: `PlanStep={id,title,description,status,evidence?}`; `PlanStepStatus={pending,in_progress,done}`
|legacy: `goal` deprecated; new code should read/write `objective`, but keep alias while compatibility needed

## Flow
|creation: `state/factory.ts` materializes these types; `plugin.ts`, hooks, prompts, tools share them via barrel imports

## Integration
|up: all runtime folders import from `types/index.ts` |down: no runtime deps

## Gotchas
|!: adding/changing `ExtendedState` fields may require updates in `state/factory.ts`, `state/persistence.ts`, `prompts/format.ts`, `hooks/{system-transform,session-compacting}.ts`, tests
|!: `AgentPhase` intentionally narrow (`OBSERVE|STOPPED`); objective lifecycle detail lives in `status`
|!: `StopReason` values are user-visible in status summaries and tests

## Tests
|tests: indirectly covered across `__tests__/{autopilot-tool,plugin,prompts}.test.ts`
