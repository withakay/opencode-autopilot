# codemap: state

IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for this subsystem.

## Responsibility
|owns: constructing `ExtendedState`, normalization of persisted state, storage-backed persistence over `ctx.storage` |not: hook behavior or prompt text

## Entry Points
|entry: `factory.ts#createSessionState` -> enabled session state for run starts |caller: `controller/actions.ts`
|entry: `persistence.ts#StorageStateStore` -> per-session entries under `state/<sessionID>` in the plugin storage KV
|entry: `persistence.ts#normalizeState` / `normalizeEntry` -> defensive load-time normalization

## Design
|persistence: one JSON value per session `{version:2, state, history, permissionMode}`; `load()` scans prefix `state/`; `save`/`remove` per session
|plan init: first supplied plan step forced `in_progress`; `active_step_index=0` if plan exists else `-1`

## Gotchas
|!: storage is global (namespaced by plugin id, not project); session IDs are globally unique
|!: recovered active objective runs pause with `RECOVERED_AFTER_RESTART`; `/autopilot resume` re-arms them
|!: `save()` JSON round-trips the entry to drop `undefined` fields before the KV write

## Tests
|tests: `__tests__/plugin.test.ts` -> persistence across instances, restart recovery, deletion on `session.deleted`
