# codemap: hooks

IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for this subsystem.

## Responsibility
|owns: OpenCode hook adapters for events, permissions, system prompt injection, compaction context, chat-message agent tracking, tool-output cleanup |not: high-level continuation policy (`plugin.ts`) or prompt wording (`prompts/`)

## Entry Points
|entry: `event-handler.ts#createEventHandler` -> handles `message.updated`, `message.part.updated`, `session.idle`, `session.error`, `session.deleted`
|entry: `permission.ts#createPermissionHook` -> `permission.ask` allow/deny policy
|entry: `system-transform.ts#createSystemTransformHook` -> `experimental.chat.system.transform` prompt injection
|entry: `session-compacting.ts#createSessionCompactingHook` -> `experimental.session.compacting` context preservation
|entry: `chat-message.ts#createChatMessageHook` -> records pending agent for next system transform
|entry: `tool-after.ts#createToolAfterHook` -> strips autopilot markers from autopilot tool output

## Design
|tracking: `SessionTracking={lastAssistantMessageID,lastUsage,awaitingWorkerReply,blockedByPermission,permissionBlockMessage}` lives outside persisted `ExtendedState`
|worker-scope: event handler only records assistant replies/text parts when cached agent matches `state.worker_agent`
|system-scope: delegated-task prompt injection only for pending worker agent; ambient session-defaults injects autonomy prompt without status markers
|permissions: `allow-all` -> allow; `limited` -> deny + callback; disabled/no state leaves output unchanged

## Flow
|reply capture: `message.updated` stores role/agent/usage and candidate messageID > `message.part.updated` stores text parts > `session.idle` calls plugin continuation
|compaction: active state + history + config workflow/hints -> single context block with objective, plan progress, worker, continuation count, recent events
|cleanup: `session.deleted` > cache cleanup + state deletion

## Integration
|up: OpenCode plugin hook surfaces assembled in `plugin.ts` |down: `state/session-cache.ts`, `prompts/*` through injected deps, `config/autopilot-config.ts`

## Gotchas
|!: event property shapes are normalized defensively; ignore malformed events instead of throwing
|!: `awaitingWorkerReply` guard is central to avoiding duplicate idle dispatches
|!: pending agent is consumed once in system transform; non-worker delegated turns must not receive status-marker instructions
|!: tool-after only mutates `tool === "autopilot"`; do not strip markers from arbitrary tool output

## Tests
|tests: `__tests__/plugin.test.ts` -> event capture/cleanup/error, permission modes, system-transform worker filtering, compaction context, marker stripping, duplicate idle guard
