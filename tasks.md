# Autopilot Plugin — Implementation Tasks

> **Target**: `plugins/autopilot/` — strict TypeScript, Bun runtime
> **Spec**: `.local/autopilot-spec.md`
> **Legacy plugin** (to be deleted in Phase 13): `.opencode/plugins/autopilot/`
>
> Check off tasks as you complete them. Do not redo work that is already done.
> After completing each phase, run `bun test` from the project root to confirm nothing is broken.

---

## Target File Layout

```
plugins/
  autopilot.ts                      # Re-export entrypoint (one line)
  autopilot/
    index.ts                        # Barrel — re-exports AutopilotPlugin
    plugin.ts                       # Plugin function (OpenCode hook wiring)
    types/
      index.ts                      # Barrel for all type exports
      mode.ts                       # AgentMode
      phase.ts                      # AgentPhase
      stop-reason.ts                # StopReason union
      event.ts                      # EventType, EventSource, EventEnvelope, payload types
      effect.ts                     # Effect discriminated union
      state.ts                      # ExtendedState, PlanState, RetryCounters, etc.
      reducer.ts                    # ReducerResult
    state/
      index.ts                      # Barrel
      factory.ts                    # createInitialState(), createSessionState()
      session-cache.ts              # Per-session role/agent/text caches
    reducer/
      index.ts                      # Barrel — re-exports reduce()
      reduce.ts                     # Top-level reduce(state, event) -> ReducerResult
      integrate.ts                  # integrate_event()
      observe.ts                    # observe()
      orient.ts                     # orient(), completion_predicate()
      decide.ts                     # decide(), select_admissible_action()
      evaluate.ts                   # evaluate(), meaningful_progress(), retryable_failure()
      recover.ts                    # recover(), alternate_strategy_exists()
      guards.ts                     # admissibility guard, approval_required(), trust_required(), context_unsafe()
      transitions.ts                # stop(), block(), transition() helpers
    events/
      index.ts                      # Barrel
      validate.ts                   # validateEvent()
      factory.ts                    # createEvent()
      schemas.ts                    # Zod schemas for each payload type
    effects/
      index.ts                      # Barrel
      dispatcher.ts                 # dispatchEffect() — executes effects, returns events
      snapshot.ts                   # persistSnapshot(), restoreSnapshot()
    loop/
      index.ts                      # Barrel
      control-loop.ts               # Main OODA loop driver
    prompts/
      index.ts                      # Barrel
      system-prompt.ts              # buildAutopilotSystemPrompt()
      continuation.ts               # buildContinuationPrompt()
      directives.ts                 # inferAutopilotDirective(), parseAutopilotMarker(), stripAutopilotMarker()
      normalize.ts                  # normalizeMaxContinues()
      format.ts                     # formatUsageMetadata(), summarizeAutopilotState()
    hooks/
      index.ts                      # Barrel
      event-handler.ts              # event hook (session.idle, session.error, message.*, permission.asked)
      permission.ts                 # permission.ask hook
      system-transform.ts           # experimental.chat.system.transform hook
      chat-message.ts               # chat.message hook
      tool-after.ts                 # tool.execute.after hook
    tools/
      index.ts                      # Barrel
      start.ts                      # autopilot_start tool definition
      status.ts                     # autopilot_status tool definition
      stop.ts                       # autopilot_stop tool definition
    __tests__/
      reducer.test.ts
      events.test.ts
      effects.test.ts
      plugin.test.ts
      prompts.test.ts
      safety.test.ts
      helpers.ts                    # Shared test harness, mock factories
    tsconfig.json
```

---

## Phase 0 — Project Scaffold

- [x] **0.1** Create the directory tree shown above (empty files with barrel exports are fine)
- [x] **0.2** Create `plugins/autopilot/tsconfig.json` — `"strict": true`, Bun types, `"noUncheckedIndexedAccess": true`, `"verbatimModuleSyntax": true`
- [x] **0.3** Create `plugins/autopilot/index.ts` — barrel that re-exports `AutopilotPlugin` from `./plugin.ts`
- [x] **0.4** Create `plugins/autopilot.ts` — one-line re-export: `export { AutopilotPlugin } from "./autopilot/index.ts"`
- [x] **0.5** Stub `plugins/autopilot/plugin.ts` — skeleton `AutopilotPlugin` async function returning empty hooks, typed against `@opencode-ai/plugin`
- [x] **0.6** Verify `bun build --no-bundle plugins/autopilot/index.ts` succeeds with no errors

---

## Phase 1 — Core Types

Each type gets its own file under `types/`.

- [x] **1.1** `types/mode.ts` — `AgentMode` union: `"DISABLED" | "ENABLED"`
- [x] **1.2** `types/phase.ts` — `AgentPhase` union (8 phases)
- [x] **1.3** `types/stop-reason.ts` — `StopReason` union (14 reasons)
- [x] **1.4** `types/event.ts` — `EventType` union (12 types), `EventSource` union (8 sources), `EventEnvelope` interface, all 12 per-event payload interfaces
- [x] **1.5** `types/effect.ts` — `Effect` discriminated union (8 variants + `NO_OP`), per-effect payload types
- [x] **1.6** `types/state.ts` — `ExtendedState`, `PlanState`, `PlanItem`, `RetryCounters`, `ContextState`, `ApprovalState`, `TrustState`, `BackgroundTask`, `ForegroundAction`
- [x] **1.7** `types/reducer.ts` — `ReducerResult = { nextState: ExtendedState; effects: Effect[] }`
- [x] **1.8** `types/index.ts` — barrel re-exporting everything
- [x] **1.9** Verify `bun build --no-bundle plugins/autopilot/types/index.ts` — no type errors

---

## Phase 2 — State Factory & Session Cache

- [x] **2.1** `state/factory.ts` — `createInitialState(goal, opts): ExtendedState` with sensible defaults for all fields
- [x] **2.2** `state/session-cache.ts` — typed `SessionCache` class managing per-session maps for role, agent, text parts; `cleanup(sessionID)` method
- [x] **2.3** `state/index.ts` — barrel
- [x] **2.4** Verify `bun build --no-bundle plugins/autopilot/state/index.ts` — no errors

---

## Phase 3 — Prompts & Directives

Port and type-harden the helpers from the existing `core.js`.

- [x] **3.1** `prompts/normalize.ts` — `normalizeMaxContinues(value: unknown): number`
- [x] **3.2** `prompts/directives.ts` — `parseAutopilotMarker(text: string)`, `stripAutopilotMarker(text: string)`, `inferAutopilotDirective(text: string)`
- [x] **3.3** `prompts/system-prompt.ts` — `buildAutopilotSystemPrompt(): string`
- [x] **3.4** `prompts/continuation.ts` — `buildContinuationPrompt(opts): string`
- [x] **3.5** `prompts/format.ts` — `formatUsageMetadata(usage)`, `summarizeAutopilotState(state)`
- [x] **3.6** `prompts/index.ts` — barrel
- [x] **3.7** Write `__tests__/prompts.test.ts` — cover `normalizeMaxContinues`, `parseAutopilotMarker`, `stripAutopilotMarker`, `inferAutopilotDirective`, `buildContinuationPrompt`
- [x] **3.8** Run `bun test plugins/autopilot/__tests__/prompts.test.ts` — all pass

---

## Phase 4 — Event Validation & Factory

- [x] **4.1** `events/schemas.ts` — Zod schemas for each of the 12 payload types and the `EventEnvelope`
- [x] **4.2** `events/validate.ts` — `validateEvent(raw: unknown): { ok: true; event: EventEnvelope } | { ok: false; error: string }` — checks type recognized, payload matches schema, required fields present, timestamps parseable, IDs well-formed
- [x] **4.3** `events/factory.ts` — `createEvent(type, payload, opts?): EventEnvelope` — auto-generates `event_id`, `occurred_at`; accepts optional `correlation_id`, `causation_id`, `phase_at_emit`
- [x] **4.4** `events/index.ts` — barrel
- [x] **4.5** Write `__tests__/events.test.ts` — valid events pass, invalid events rejected, malformed payloads rejected, factory output validates
- [x] **4.6** Run `bun test plugins/autopilot/__tests__/events.test.ts` — all pass

---

## Phase 5 — Reducer

Each reducer sub-function in its own file.

- [x] **5.1** `reducer/transitions.ts` — pure helper functions: `stop()`, `block()`, `blockOrStop()`, `transition()`, `stayBlocked()`, `remainStopped()`
- [x] **5.2** `reducer/integrate.ts` — `integrateEvent(state, event): ExtendedState`
- [x] **5.3** `reducer/guards.ts` — `isAdmissible(state, action)`, `approvalRequired(state)`, `trustRequired(state)`, `contextUnsafe(state)`, `compactionAllowed(state)`
- [x] **5.4** `reducer/observe.ts` — `observe(state): ExtendedState`
- [x] **5.5** `reducer/orient.ts` — `orient(state): ExtendedState`, `completionPredicate(state): boolean`, `hardBlockDetected(state): boolean`, `deriveBlockReason(state): StopReason`
- [x] **5.6** `reducer/decide.ts` — `decide(state): ExtendedState`, `selectAdmissibleAction(state): ForegroundAction | null`
- [x] **5.7** `reducer/evaluate.ts` — `evaluate(state): ExtendedState`, `meaningfulProgress(prev, next): boolean`, `retryableFailure(state): boolean`, `noProgressDetected(state): boolean`
- [x] **5.8** `reducer/recover.ts` — `recover(state): ExtendedState`, `recoverable(state): boolean`, `alternateStrategyExists(state): boolean`, `backgroundWaitIsBestOption(state): boolean`, `unblockEventPresent(event, state): boolean`, `resumable(state): boolean`
- [x] **5.9** `reducer/reduce.ts` — top-level `reduce(state, event): ReducerResult` implementing the spec pseudocode, delegating to all the above
- [x] **5.10** `reducer/index.ts` — barrel (re-export `reduce` and any helpers tests need)
- [x] **5.11** Write `__tests__/reducer.test.ts`:
  - [x] normal completion path
  - [x] approval-required path
  - [x] trust-required path
  - [x] context-compaction path
  - [x] retryable tool failure path
  - [x] irrecoverable failure path
  - [x] non-progress limit behavior
  - [x] blocked-to-resumed path
  - [x] stopped-to-resumed path
  - [x] background task integration
- [x] **5.12** Run `bun test plugins/autopilot/__tests__/reducer.test.ts` — all pass

---

## Phase 6 — Effect Dispatcher

- [x] **6.1** `effects/dispatcher.ts` — `dispatchEffect(effect, context): Promise<EventEnvelope>` — executes effects, returns result events; discards inadmissible effects as `TOOL_ERROR` observations; never mutates phase
- [x] **6.2** `effects/snapshot.ts` — `persistSnapshot(state): void`, `restoreSnapshot(sessionID): ExtendedState | null` — enough state for safe resume, avoids repeating unsafe writes
- [x] **6.3** `effects/index.ts` — barrel
- [x] **6.4** Write `__tests__/effects.test.ts` — dispatcher admissibility, effect-to-event conversion, snapshot round-trip
- [x] **6.5** Run `bun test plugins/autopilot/__tests__/effects.test.ts` — all pass

---

## Phase 7 — Control Loop

- [x] **7.1** `loop/control-loop.ts` — main loop: while `mode = ENABLED`, call `reduce(state, event)`, dispatch effects, feed results back; enforce single foreground action, retry counters, no-progress limits
- [x] **7.2** Handle interrupt preemption (`INTERRUPT` -> `STOPPED` immediately)
- [x] **7.3** Handle `BLOCKED` -> `OBSERVE` on blocker cleared
- [x] **7.4** Handle `STOPPED` -> `OBSERVE` on valid resume
- [x] **7.5** `loop/index.ts` — barrel
- [x] **7.6** Verify `bun build --no-bundle plugins/autopilot/loop/index.ts` — no errors

---

## Phase 8 — OpenCode Hook Wiring

Each hook in its own file under `hooks/`.

- [x] **8.1** `hooks/event-handler.ts` — handles `session.idle`, `session.error`, `session.deleted`, `message.updated`, `message.part.updated`, `permission.asked`
- [x] **8.2** `hooks/permission.ts` — `permission.ask` hook: enforce `allow-all` / `limited` modes
- [x] **8.3** `hooks/system-transform.ts` — `experimental.chat.system.transform`: inject autopilot system prompt for worker turns, suppress for control turns
- [x] **8.4** `hooks/chat-message.ts` — `chat.message`: track control-agent turns for suppression counter
- [x] **8.5** `hooks/tool-after.ts` — `tool.execute.after`: strip autopilot markers from `autopilot_status` output
- [x] **8.6** `hooks/index.ts` — barrel

---

## Phase 9 — Tool Definitions

Each tool in its own file under `tools/`.

- [x] **9.1** `tools/start.ts` — `autopilot_start` tool: initializes state, sets mode `ENABLED`, begins loop
- [x] **9.2** `tools/status.ts` — `autopilot_status` tool: returns phase, stop reason, continuation count, history
- [x] **9.3** `tools/stop.ts` — `autopilot_stop` tool: sends `INTERRUPT`, transitions to `STOPPED`
- [x] **9.4** `tools/index.ts` — barrel

---

## Phase 10 — Plugin Assembly

- [x] **10.1** `plugin.ts` — assemble `AutopilotPlugin`: import hooks, tools, state factory, session cache; return full `Hooks` object to OpenCode
- [x] **10.2** `index.ts` — barrel re-exports `AutopilotPlugin`
- [x] **10.3** `plugins/autopilot.ts` (parent dir) — one-line re-export
- [x] **10.4** Verify `bun build --no-bundle plugins/autopilot.ts` — no errors

---

## Phase 11 — Tests (Plugin Integration)

- [x] **11.1** `__tests__/helpers.ts` — shared test harness: mock `client`, `context`, `PluginInput` factory
- [x] **11.2** `__tests__/plugin.test.ts`:
  - [x] arming and initial dispatch
  - [x] captures only worker-agent replies
  - [x] suppresses system prompt for control-agent turns
  - [x] consumes each worker reply only once
  - [x] blocks on denied permissions in limited mode
  - [x] allow-all mode auto-allows permissions
  - [x] stops on session error / abort
  - [x] cleans up session state on session.deleted
  - [x] continuation limit enforcement
  - [x] marker stripping on status output
- [x] **11.3** Run `bun test plugins/autopilot/__tests__/plugin.test.ts` — all pass

---

## Phase 12 — Safety Invariant Tests

- [x] **12.1** `__tests__/safety.test.ts`:
  - [x] S1 — no side effect without admissibility check
  - [x] S2 — approval cannot be bypassed by autonomy
  - [x] S3 — trust cannot be bypassed by autonomy
  - [x] S4 — blocked/stopped states always have explicit stop_reason
  - [x] S5 — denied approvals/trust preserved as observations, never silently retried
  - [x] S6 — no uncontrolled livelock (non-progress counter enforced)
  - [x] S7 — STOPPED is quiescent unless resumed
  - [x] S8 — interrupt preemption forces STOPPED
  - [x] S9 — state preserved across risky effects for safe resumability
- [x] **12.2** Run `bun test plugins/autopilot/__tests__/safety.test.ts` — all pass

---

## Phase 13 — Code Review & Spec Compliance

Dispatch the `code-review` or `coderabbit-code-review` subagent to audit the full implementation against the spec. Use parallel subagents to cover independent review areas simultaneously.

### 13A — Structural Review

- [x] **13.1** Verify file layout matches the Target File Layout exactly — no missing files, no extra files, no misplaced code
- [x] **13.2** Verify every barrel (`index.ts`) re-exports all public symbols from its directory — no orphaned exports, no missing re-exports
- [x] **13.3** Verify `plugins/autopilot.ts` re-export entrypoint is correct and `bun build --no-bundle plugins/autopilot.ts` succeeds
- [x] **13.4** Verify strict TypeScript compliance: no `any` types, no `@ts-ignore`, no `as unknown as`, no type assertions that weaken safety

### 13B — Spec Compliance: State Machine

- [x] **13.5** Verify all 8 phases (`OBSERVE`, `ORIENT`, `DECIDE`, `EXECUTE`, `EVALUATE`, `RECOVER`, `BLOCKED`, `STOPPED`) are implemented in the reducer
- [x] **13.6** Verify every row in the spec's Transition Table (Section "Transition Table") has a corresponding code path in the reducer — cross-reference each `Current Phase | Event/Condition | Guard | Next Phase` row
- [x] **13.7** Verify `reduce()` is pure and deterministic — no side effects, no randomness, no I/O
- [x] **13.8** Verify the reducer returns only admissible effects (effects must pass the admissibility guard before inclusion in the result)

### 13C — Spec Compliance: Core Invariants

- [x] **13.9** Verify Core Invariant 1: no side effect without admissibility check — trace every `RUN_TOOL`, `REQUEST_APPROVAL`, `REQUEST_TRUST`, `COMPACT_CONTEXT` effect back to an admissibility guard call
- [x] **13.10** Verify Core Invariant 2: approval cannot be bypassed — confirm `approval_required` check blocks dispatch when approval is missing
- [x] **13.11** Verify Core Invariant 3: trust cannot be bypassed — confirm `trust_required` check blocks dispatch when trust is missing
- [x] **13.12** Verify Core Invariant 4: every `BLOCKED`/`STOPPED` transition sets a non-empty `stop_reason`
- [x] **13.13** Verify Core Invariant 5: at most one active foreground action tracked at a time
- [x] **13.14** Verify Core Invariant 6: resumable snapshot is persisted before risky effects
- [x] **13.15** Verify Core Invariant 7: `INTERRUPT` event preempts to `STOPPED` immediately

### 13D — Spec Compliance: Safety Properties (S1-S9)

- [x] **13.16** Verify S1 (no unauthorized side effects) — code path analysis, not just test existence
- [x] **13.17** Verify S2 (approval bypass impossible) — trace all dispatch paths
- [x] **13.18** Verify S3 (trust bypass impossible) — trace all dispatch paths
- [x] **13.19** Verify S4 (blocked/stopped states explicit) — every `block()` and `stop()` call includes a reason
- [x] **13.20** Verify S5 (no silent denial loss) — denied approvals/trust become observations
- [x] **13.21** Verify S6 (no uncontrolled livelock) — non-progress counter incremented and limit enforced
- [x] **13.22** Verify S7 (STOPPED quiescent) — no effects dispatched from STOPPED without resume
- [x] **13.23** Verify S8 (interrupt preemption) — INTERRUPT always reaches STOPPED
- [x] **13.24** Verify S9 (state preserved across risky effects) — snapshot before risky dispatch

### 13E — Spec Compliance: Liveness Properties (L1-L7)

- [x] **13.25** Verify L1 (OBSERVE → ORIENT) — observation processing leads to orientation
- [x] **13.26** Verify L2 (completion terminates) — completion predicate true leads to STOPPED(COMPLETED)
- [x] **13.27** Verify L3 (admissible work executes) — admissible action eventually dispatched
- [x] **13.28** Verify L4 (recoverable failure leaves EVALUATE) — retryable failure reaches RECOVER
- [x] **13.29** Verify L5 (BLOCKED resumable) — blocker removal leads to OBSERVE
- [x] **13.30** Verify L6 (background completions observed) — background task updates ingested
- [x] **13.31** Verify L7 (resume restarts) — resume request from STOPPED with resumable state reaches OBSERVE

### 13F — Hook Integration Review

- [x] **13.32** Verify `event` hook handles all required OpenCode event types: `session.idle`, `session.error`, `session.deleted`, `message.updated`, `message.part.updated`, `permission.updated`
- [x] **13.33** Verify `permission.ask` hook correctly implements `allow-all` and `limited` modes
- [x] **13.34** Verify `experimental.chat.system.transform` hook injects prompt for worker turns and suppresses for control turns
- [x] **13.35** Verify `chat.message` hook tracks control-agent turns correctly
- [x] **13.36** Verify `tool.execute.after` hook strips `<autopilot>` markers only from `autopilot_status` output
- [x] **13.37** Verify `client.session.promptAsync` is called with correct parameters (directory, workspace, sessionID, agent, parts)

### 13G — Effect Dispatcher & Event System Review

- [x] **13.38** Verify effect dispatcher converts all 8 effect variants to appropriate result events
- [x] **13.39** Verify inadmissible effects are discarded as `TOOL_ERROR` observations (not silently dropped)
- [x] **13.40** Verify event factory produces valid `EventEnvelope` with auto-generated `event_id`, `occurred_at`
- [x] **13.41** Verify event validation rejects malformed payloads, unknown types, and missing required fields
- [x] **13.42** Verify correlation/causation ID chains are maintained through effect dispatch cycles

### 13H — Review Findings Resolution

- [x] **13.43** Fix all issues found in 13A-13G — each fix must be verified with `bun build --no-bundle` and `bun test`
- [x] **13.44** Re-run full test suite after fixes: `bun test plugins/autopilot/__tests__/` — all pass
- [x] **13.45** Get a clean second review pass — no remaining spec deviations or structural issues

---

## Phase 14 — Full Test Suite & Smoke Test

- [x] **14.1** Run `bun test` from project root — all autopilot tests pass
- [x] **14.2** Delete the legacy JS plugin directory: remove `.opencode/plugins/autopilot/` and `.opencode/plugins/autopilot.js` entirely
- [x] **14.3** Verify no duplicate tool registration errors
- [x] **14.4** Smoke test: `/autopilot status`, `/autopilot --max 1 echo hello`, `/autopilot stop`

---

## Phase 15 — Documentation

- [x] **15.1** `plugins/autopilot/README.md` — usage, architecture overview, file layout, how to run tests
- [x] **15.2** Document state machine phases and transition table
- [x] **15.3** Document reducer + effect model
- [x] **15.4** Document safety invariants and how they're enforced
