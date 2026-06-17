# codemap: state

IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for this subsystem.

## Responsibility
|owns: constructing `ExtendedState`, durable user-data state storage with legacy `.autopilot/state.json` fallback, transient message text/agent cache |not: OpenCode hook behavior or prompt text

## Entry Points
|entry: `factory.ts#createInitialState` -> base `ExtendedState` with defaults |caller: tests, `createSessionState`
|entry: `factory.ts#createSessionState` -> enabled session state for tool starts |caller: `plugin.ts` tool deps
|entry: `persistence.ts#PersistentStateStore.forRoot(root)` -> user-data project state store with legacy fallback |caller: `plugin.ts`
|entry: `session-cache.ts#SessionCache` -> role/agent/text-part cache for worker messages |caller: `hooks/event-handler.ts`, `plugin.ts`

## Design
|defaults: max continues `25` in factory, worker `pi`, strength `balanced`; budget defaults include 15m duration, 200k tokens, 2 low-progress turns under 50 output tokens
|plan init: first supplied plan step forced `in_progress`; done steps preserved; `active_step_index=0` if plan exists else `-1`
|persistence: versioned JSON `{version:1,states,history,permissionMode}`; queued writes; atomic tmp write + rename; private `0600` file mode; malformed states skipped/normalized
|cache: per-session maps roles, agents, text parts; message text is concatenated parts matching messageID

## Flow
|start: tool > `createSessionState` > `plugin.setState` > `PersistentStateStore.save(createPersistedData(...))`
|load: plugin init > `stateStore.load()` > normalize states/history/permission modes; active objective states are recovered paused before any continuation replay
|message: event handler caches `message.updated` role/agent then `message.part.updated` text for worker-agent replies

## Integration
|up: `plugin.ts`, `hooks/event-handler.ts`, tests |down: Node fs/path, `types/index.ts`

## Gotchas
|!: persistence failures are swallowed in `plugin.ts`; store methods may throw, caller decides resilience
|!: `PersistentStateStore.save/clear` serialize via `queue`; preserve this to avoid clobbering state during rapid hook events
|!: primary runtime state lives outside the repo; `.autopilot/state.json` is legacy/local and ignored; do not commit it
|edge: recovered active objective runs pause after restart; `/autopilot resume` re-enters `OBSERVE`

## Tests
|tests: `__tests__/plugin.test.ts` -> persistence across instances, resume dispatch, validation/verification state; `__tests__/autopilot-tool.test.ts` -> state creation through tool
