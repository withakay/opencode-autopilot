# codemap: hooks

IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for this subsystem.

## Responsibility
|owns: v2 hook adapters — terminal event routing, permission evaluate policy, context-hook text building |not: continuation policy (`controller/`), prompt wording (`prompts/`)

## Entry Points
|entry: `event-handler.ts#createEventHandler` -> routes `session.execution.succeeded|failed|interrupted`, `session.deleted`
|entry: `event-handler.ts#SessionTracking` -> transient per-session dispatch state (`awaitingWorkerReply`, `dispatchedAt`, `selfInterrupt`, permission block)
|entry: `permission.ts#createPermissionHook` -> `permission.hook("evaluate")` allow/deny policy
|entry: `system-transform.ts#buildAutopilotContextText` -> text for `session.hook("context")`; folds in the v1 compaction summary

## Gotchas
|!: `awaitingWorkerReply` + `dispatchedAt` guard against double dispatch and stale execution ends
|!: `selfInterrupt` must be set before autopilot interrupts its own worker so the interrupt is not read as a user stop
|!: permission `limited` only rewrites `ask` -> `deny`; configured denies are final upstream

## Tests
|tests: `__tests__/plugin.test.ts` -> permission modes, context injection, event-driven continuation
