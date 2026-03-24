# Autopilot Mode Specification

## Status

Draft

## Purpose

**Autopilot Mode** is a continuation policy for an interactive coding agent.

When enabled, the agent SHOULD continue taking admissible next steps toward a declared task goal without requiring a new user prompt after every intermediate result.

Autopilot Mode is **not**:

- permission elevation
- an unconditional infinite loop
- a guarantee of completion
- a bypass for user approval, trusted-directory checks, or interruption controls

Its purpose is to maximize safe forward progress while remaining governed by runtime constraints.

## Scope

This specification defines:

- the control phases of autopilot execution
- the runtime state that MUST be tracked
- transition rules
- admissibility guards
- stop conditions
- recovery behavior
- required safety invariants

This specification does **not** require a specific implementation language or storage layer.

## Runtime Model

The runtime SHALL be modeled as a hierarchical state machine with extended state.

### Top-Level Mode

`mode ∈ { DISABLED, ENABLED }`

- `DISABLED`: the agent may answer normally, but does not autonomously continue work across intermediate steps
- `ENABLED`: the agent applies the autopilot continuation policy described here

### Control Phase

`phase ∈ { OBSERVE, ORIENT, DECIDE, EXECUTE, EVALUATE, RECOVER, BLOCKED, STOPPED }`

### Extended State

The runtime MUST track at least:

- `goal`: the task or requested outcome
- `plan_state`: current steps, open items, completed items, dependencies
- `completion_evidence`: evidence sufficient to justify declaring completion
- `allowed_tools`: tools approved or permitted for use
- `allowed_paths`: directories or paths the agent may access
- `approval_state`: pending, granted, denied approvals
- `trust_state`: whether the current directory or target directory is trusted
- `context_state`: remaining context budget and whether compaction is needed
- `foreground_action`: current active foreground action, if any
- `background_tasks`: async tasks and their statuses
- `retry_counters`: step-level and global retry / no-progress counters
- `stop_reason`: terminal or blocked reason, if any
- `latest_observations`: user input, tool output, tool errors, external workspace changes

## Core Invariants

The following invariants MUST hold:

1. **No side effect without admissibility check.**

   Any action that reads, writes, modifies, or executes MUST first pass an admissibility check.

2. **No approval bypass.**

   If an action requires approval, trust confirmation, or directory authorization, autopilot MUST NOT bypass it.

3. **No uncontrolled spinning.**

   If no admissible forward action exists, the machine MUST transition to `BLOCKED` or `STOPPED`.

4. **Explicit terminal reason.**

   Every terminal or blocked state MUST include a non-empty `stop_reason`.

5. **Foreground action tracking.**

   The runtime MUST track at most one active foreground action at a time, even if background tasks exist concurrently.

6. **Safe resumability.**

   The runtime MUST preserve enough state to resume safely and to avoid repeating unsafe side effects after interruption, restart, or compaction.

7. **Interruptibility.**

   User cancellation or interruption MUST be able to preempt further autonomous execution.

## Control Loop Semantics

When `mode = ENABLED`, the runtime SHALL execute the following loop.

### OBSERVE

The runtime ingests new evidence, including:

- new user messages
- tool output
- tool errors
- background task updates
- approval responses
- directory trust decisions
- workspace changes outside the agent’s direct actions
- context or resource warnings

Transition: `OBSERVE -> ORIENT`

### ORIENT

The runtime reconciles observations against the task goal and current plan state.

It MUST:

- update plan progress
- detect whether meaningful progress occurred
- identify blockers
- recompute whether the completion predicate holds
- detect whether state has become ambiguous or stale

Transitions:

- if completion holds: `ORIENT -> STOPPED(COMPLETED)`
- if a hard blocker exists: `ORIENT -> BLOCKED`
- otherwise: `ORIENT -> DECIDE`

### DECIDE

The runtime selects exactly one next foreground action, or determines that none is admissible.

Candidate actions may include:

- reading files
- searching code
- editing files
- running verification commands
- requesting approval
- requesting directory trust or path access
- compacting context
- waiting for background work
- stopping

Transitions:

- if approval or trust is required and missing: select `REQUEST_APPROVAL` or equivalent access request
- if context is below safe threshold: select `COMPACT_CONTEXT`, `BLOCKED`, or `STOPPED`
- if an admissible action exists: `DECIDE -> EXECUTE`
- if no admissible action exists but recovery is possible: `DECIDE -> RECOVER`
- otherwise: `DECIDE -> BLOCKED` or `STOPPED`

### EXECUTE

The runtime dispatches the selected action.

- synchronous actions transition to `EVALUATE` after completion
- asynchronous actions may register background tasks, then return the foreground loop to `OBSERVE`
- denied actions MUST NOT execute

### EVALUATE

The runtime classifies the result as one of:

- progress
- non-progress
- retryable failure
- irrecoverable failure
- completion

Transitions:

- progress but incomplete: `EVALUATE -> OBSERVE`
- completion: `EVALUATE -> STOPPED(COMPLETED)`
- retryable failure: `EVALUATE -> RECOVER`
- irrecoverable failure: `EVALUATE -> BLOCKED` or `STOPPED`

### RECOVER

The runtime attempts a bounded recovery strategy.

Permitted recovery actions include:

- re-planning
- selecting an alternative tool
- narrowing scope
- re-reading state
- requesting missing approval
- waiting on background tasks

If recovery yields an admissible path forward: `RECOVER -> DECIDE`

If recovery fails, retry budget is exhausted, or repeated no-progress is detected: `RECOVER -> BLOCKED` or `STOPPED`

## Admissibility Guard

An action is **admissible** only if all of the following hold:

- the action is permitted by policy
- the tool is allowed
- the target path is allowed and trusted
- required approval has been granted
- sufficient context and runtime resources remain
- the action does not violate a higher-priority interrupt or safety constraint

## Completion Predicate

There is no single mandatory `task_complete` primitive.

Completion SHALL be inferred from state.

The completion predicate is true only if:

- the declared goal has been satisfied
- no required open plan items remain
- no required foreground action is still pending
- no unresolved blocker prevents finalization
- available evidence is sufficient to justify a final answer

## Blocked and Stop Reasons

Valid explicit reasons include:

- `COMPLETED`
- `USER_STOP`
- `AUTOPILOT_DISABLED`
- `WAITING_FOR_APPROVAL`
- `WAITING_FOR_DIRECTORY_TRUST`
- `WAITING_FOR_USER_INPUT`
- `WAITING_FOR_EXTERNAL_RESOURCE`
- `PERMISSION_DENIED`
- `POLICY_BLOCKED`
- `PATH_OR_TOOL_NOT_ALLOWED`
- `CONTEXT_EXHAUSTED`
- `RETRY_EXHAUSTED`
- `NON_PROGRESS_LIMIT`
- `UNRECOVERABLE_ERROR`
- `AMBIGUOUS_STATE_REQUIRES_ESCALATION`

## Formal Continuation Rule

Replace the informal rule “if the task is not complete, do not stop” with:

> While `mode = ENABLED` and `completion_predicate = false`, the runtime SHOULD continue selecting admissible forward actions.
>
> If no admissible forward action exists, it MUST transition to `BLOCKED` or `STOPPED` with an explicit reason.

That is the strict version.

## Transition Table

The following table defines the normative control transitions for Autopilot Mode.

| Current Phase | Event / Condition                            | Guard                                                      | Required Action                                                                                                  | Next Phase             | Notes                                                                    |
| ------------- | -------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------ |
| `DISABLED`    | Autopilot enabled                            | None                                                       | Initialize or reuse resumable task state                                                                         | `OBSERVE`              | Entry into autonomous continuation mode                                  |
| `OBSERVE`     | New evidence available                       | None                                                       | Ingest user input, tool output, tool errors, approvals, trust decisions, background updates, workspace mutations | `ORIENT`               | Observation is mandatory before planning the next step                   |
| `ORIENT`      | Completion predicate is true                 | Completion evidence sufficient                             | Set `stop_reason = COMPLETED`                                                                                    | `STOPPED`              | Successful terminal transition                                           |
| `ORIENT`      | Hard blocker detected                        | No admissible forward action currently available           | Set explicit blocked reason                                                                                      | `BLOCKED`              | Use a specific reason such as `WAITING_FOR_APPROVAL` or `POLICY_BLOCKED` |
| `ORIENT`      | Task remains actionable                      | Completion predicate is false and blocker is not hard      | Reconcile plan state and identify next decision point                                                            | `DECIDE`               | Normal forward transition                                                |
| `DECIDE`      | User interrupt received                      | None                                                       | Cancel pending continuation, record `USER_STOP`                                                                  | `STOPPED`              | Interruption preempts autonomy                                           |
| `DECIDE`      | Autopilot disabled                           | None                                                       | Record `AUTOPILOT_DISABLED`                                                                                      | `STOPPED`              | Mode exits cleanly                                                       |
| `DECIDE`      | Approval required                            | Approval missing for the chosen action                     | Prepare and issue approval request                                                                               | `EXECUTE`              | The foreground action is `REQUEST_APPROVAL`                              |
| `DECIDE`      | Directory trust or path access required      | Trust or path authorization missing                        | Prepare and issue trust / directory access request                                                               | `EXECUTE`              | Applies before reading or writing outside currently trusted scope        |
| `DECIDE`      | Context below safe threshold                 | Compaction is possible                                     | Schedule compaction                                                                                              | `EXECUTE`              | The foreground action is `COMPACT_CONTEXT`                               |
| `DECIDE`      | Context below safe threshold                 | Compaction is not possible or would be unsafe              | Set `CONTEXT_EXHAUSTED` or escalation reason                                                                     | `BLOCKED` or `STOPPED` | The runtime MUST NOT continue arbitrary tool use                         |
| `DECIDE`      | Admissible foreground action exists          | Admissibility guard passes                                 | Select exactly one foreground action and bind it to `foreground_action`                                          | `EXECUTE`              | Only one active foreground action may exist at a time                    |
| `DECIDE`      | No admissible action, but recovery may help  | Recovery budget remains and alternate strategy exists      | Enter bounded recovery flow                                                                                      | `RECOVER`              | Used for re-planning or alternate tool selection                         |
| `DECIDE`      | No admissible action and no viable recovery  | None                                                       | Set explicit blocked or stop reason                                                                              | `BLOCKED` or `STOPPED` | Prevents livelock                                                        |
| `EXECUTE`     | Approval or trust request dispatched         | None                                                       | Wait for approval response or trust response                                                                     | `OBSERVE`              | Response returns as a new observation                                    |
| `EXECUTE`     | Context compaction dispatched                | None                                                       | Compact context and preserve resumable state                                                                     | `OBSERVE`              | Compaction returns control to the loop                                   |
| `EXECUTE`     | Synchronous action completes successfully    | None                                                       | Capture tool result                                                                                              | `EVALUATE`             | Applies to reads, edits, tests, and similar foreground work              |
| `EXECUTE`     | Synchronous action fails                     | None                                                       | Capture tool error                                                                                               | `EVALUATE`             | Failure is evaluated before recovery                                     |
| `EXECUTE`     | Background task started                      | Async execution permitted                                  | Register task in `background_tasks`                                                                              | `OBSERVE`              | Foreground loop continues while async work runs                          |
| `EXECUTE`     | Action denied before execution               | Approval denied, trust denied, or policy denied            | Record denial as observation                                                                                     | `OBSERVE`              | Denied actions MUST NOT run                                              |
| `EVALUATE`    | Result demonstrates completion               | Completion predicate becomes true                          | Set `stop_reason = COMPLETED`                                                                                    | `STOPPED`              | Terminal success after execution                                         |
| `EVALUATE`    | Result made meaningful progress              | Completion predicate remains false                         | Update plan state, completion evidence, and progress counters                                                    | `OBSERVE`              | Continue the loop                                                        |
| `EVALUATE`    | Result made no meaningful progress           | No-progress threshold not yet exceeded                     | Increment non-progress counters                                                                                  | `RECOVER`              | Recovery must decide whether an alternate path exists                    |
| `EVALUATE`    | Retryable failure                            | Recovery remains possible                                  | Classify error, retain evidence, and enter bounded recovery                                                      | `RECOVER`              | Example: alternate tool or revised command is available                  |
| `EVALUATE`    | Irrecoverable failure                        | No safe alternate path exists                              | Set explicit failure reason                                                                                      | `BLOCKED` or `STOPPED` | Use `UNRECOVERABLE_ERROR` when appropriate                               |
| `RECOVER`     | Alternate admissible strategy found          | Retry / recovery budget remains                            | Re-plan next step                                                                                                | `DECIDE`               | Recovery returns to normal decision-making                               |
| `RECOVER`     | Approval or trust is the only remaining path | None                                                       | Prepare approval or trust request                                                                                | `DECIDE`               | The next decision should request authorization explicitly                |
| `RECOVER`     | Waiting on background task is best next step | Relevant task exists and may unblock work                  | Yield to observation of background updates                                                                       | `OBSERVE`              | Recovery may defer action rather than forcing a retry                    |
| `RECOVER`     | Retry budget exhausted                       | None                                                       | Set `RETRY_EXHAUSTED`                                                                                            | `BLOCKED` or `STOPPED` | Terminal or semi-terminal outcome                                        |
| `RECOVER`     | Non-progress limit exceeded                  | None                                                       | Set `NON_PROGRESS_LIMIT`                                                                                         | `BLOCKED` or `STOPPED` | Formal livelock prevention                                               |
| `RECOVER`     | No alternate path exists                     | None                                                       | Set explicit blocker or escalation reason                                                                        | `BLOCKED` or `STOPPED` | Recovery is bounded, not infinite                                        |
| `BLOCKED`     | Approval granted                             | Blocker removed                                            | Re-enter the loop with updated observations                                                                      | `OBSERVE`              | Common unblock path                                                      |
| `BLOCKED`     | User provides new input                      | New information changes admissibility or goal state        | Re-enter the loop with updated observations                                                                      | `OBSERVE`              | Blocked is resumable                                                     |
| `BLOCKED`     | External resource becomes available          | Resource restoration observed                              | Re-enter the loop with updated observations                                                                      | `OBSERVE`              | Example: background task completes or path is added                      |
| `BLOCKED`     | User stops or session ends                   | None                                                       | Preserve resumable state if possible                                                                             | `STOPPED`              | Blocked does not imply abandoned, only non-progressing                   |
| `STOPPED`     | Resume requested                             | Resumable state available and user or runtime resumes work | Restore task state                                                                                               | `OBSERVE`              | Supports session continuation semantics                                  |

### Transition Notes

- Every transition that leads to `BLOCKED` or `STOPPED` MUST populate `stop_reason`.
- Any transition that performs a side effect MUST first satisfy the admissibility guard.
- A denied approval or denied trust request MUST be represented as an observation and MUST NOT be silently retried.
- The machine SHOULD prefer `BLOCKED` over `STOPPED` when future external input could plausibly unblock progress.
- The machine SHOULD prefer `STOPPED` when it has sufficient evidence that progress cannot continue safely within the current session.

## Reducer and Effect Model

The state machine MAY be implemented as a deterministic reducer plus an effect dispatcher.

Under this model:

- the reducer is pure and computes the next state plus requested effects
- the effect dispatcher performs side effects such as tool execution, approval requests, or context compaction
- effect results are converted back into events and re-enter the reducer

This model is recommended because it preserves inspectability, supports replay, and keeps the control logic separate from tool-specific execution details.

### Core Types

```text
AgentMode =
  | DISABLED
  | ENABLED

AgentPhase =
  | OBSERVE
  | ORIENT
  | DECIDE
  | EXECUTE
  | EVALUATE
  | RECOVER
  | BLOCKED
  | STOPPED

StopReason =
  | COMPLETED
  | USER_STOP
  | AUTOPILOT_DISABLED
  | WAITING_FOR_APPROVAL
  | WAITING_FOR_DIRECTORY_TRUST
  | WAITING_FOR_USER_INPUT
  | WAITING_FOR_EXTERNAL_RESOURCE
  | PERMISSION_DENIED
  | POLICY_BLOCKED
  | PATH_OR_TOOL_NOT_ALLOWED
  | CONTEXT_EXHAUSTED
  | RETRY_EXHAUSTED
  | NON_PROGRESS_LIMIT
  | UNRECOVERABLE_ERROR
  | AMBIGUOUS_STATE_REQUIRES_ESCALATION

Event =
  | USER_INPUT(payload)
  | TOOL_RESULT(payload)
  | TOOL_ERROR(payload)
  | APPROVAL_GRANTED(payload)
  | APPROVAL_DENIED(payload)
  | TRUST_GRANTED(payload)
  | TRUST_DENIED(payload)
  | BACKGROUND_TASK_UPDATED(payload)
  | CONTEXT_LOW(payload)
  | INTERRUPT(payload)
  | RESUME_REQUESTED(payload)
  | TIMER(payload)

Effect =
  | REQUEST_APPROVAL(payload)
  | REQUEST_TRUST(payload)
  | RUN_TOOL(payload)
  | COMPACT_CONTEXT(payload)
  | WAIT_FOR_BACKGROUND_TASK(payload)
  | EMIT_FINAL_RESPONSE(payload)
  | PERSIST_SNAPSHOT(payload)
  | NO_OP
```

### Reducer Contract

```text
reduce(state, event) -> { next_state, effects[] }
```

The reducer MUST:

- be deterministic for a given `(state, event)` input
- never directly execute a side effect
- return only effects that are admissible under the current state
- update `phase`, `stop_reason`, counters, and plan state consistently

### Reference Pseudocode

```text
function reduce(state, event):
    state1 = integrate_event(state, event)

    if event_is_interrupt(event):
        return stop(state1, USER_STOP)

    if autopilot_disabled(state1):
        return stop(state1, AUTOPILOT_DISABLED)

    switch state1.phase:

        case OBSERVE:
            state2 = observe(state1)
            return transition(state2, ORIENT)

        case ORIENT:
            state2 = orient(state1)

            if completion_predicate(state2):
                return stop(state2, COMPLETED, [EMIT_FINAL_RESPONSE(summary(state2))])

            if hard_block_detected(state2):
                return block(state2, derive_block_reason(state2))

            return transition(state2, DECIDE)

        case DECIDE:
            state2 = decide(state1)

            if context_unsafe(state2):
                if compaction_allowed(state2):
                    return execute(
                        set_foreground_action(state2, COMPACT_CONTEXT),
                        [COMPACT_CONTEXT(compaction_payload(state2))]
                    )
                return block_or_stop(state2, CONTEXT_EXHAUSTED)

            if approval_required(state2):
                return execute(
                    set_foreground_action(state2, REQUEST_APPROVAL),
                    [REQUEST_APPROVAL(approval_payload(state2))]
                )

            if trust_required(state2):
                return execute(
                    set_foreground_action(state2, REQUEST_TRUST),
                    [REQUEST_TRUST(trust_payload(state2))]
                )

            action = select_admissible_action(state2)

            if action exists:
                return execute(
                    set_foreground_action(state2, action),
                    [RUN_TOOL(tool_payload(action, state2))]
                )

            if recoverable(state2):
                return transition(state2, RECOVER)

            return block_or_stop(state2, derive_terminal_reason(state2))

        case EXECUTE:
            if foreground_action_is_async(state1):
                state2 = register_async_action(state1)
                return transition(state2, OBSERVE)

            return transition(state1, EVALUATE)

        case EVALUATE:
            state2 = evaluate(state1)

            if completion_predicate(state2):
                return stop(state2, COMPLETED, [EMIT_FINAL_RESPONSE(summary(state2))])

            if meaningful_progress(state1, state2):
                return transition(state2, OBSERVE)

            if retryable_failure(state2) or no_progress_detected(state2):
                return transition(increment_recovery_counters(state2), RECOVER)

            return block_or_stop(state2, derive_terminal_reason(state2))

        case RECOVER:
            state2 = recover(state1)

            if retry_budget_exhausted(state2):
                return block_or_stop(state2, RETRY_EXHAUSTED)

            if non_progress_limit_exceeded(state2):
                return block_or_stop(state2, NON_PROGRESS_LIMIT)

            if alternate_strategy_exists(state2):
                return transition(state2, DECIDE)

            if background_wait_is_best_option(state2):
                return transition(state2, OBSERVE)

            return block_or_stop(state2, derive_terminal_reason(state2))

        case BLOCKED:
            if unblock_event_present(event, state1):
                return transition(clear_block_reason(state1), OBSERVE)

            return stay_blocked(state1)

        case STOPPED:
            if event_is_resume_request(event) and resumable(state1):
                return transition(clear_stop_reason(state1), OBSERVE)

            return remain_stopped(state1)
```

### Required Helper Functions

An implementation SHOULD define the following helpers explicitly:

- `integrate_event`
- `observe`
- `orient`
- `decide`
- `evaluate`
- `recover`
- `completion_predicate`
- `hard_block_detected`
- `derive_block_reason`
- `derive_terminal_reason`
- `approval_required`
- `trust_required`
- `context_unsafe`
- `compaction_allowed`
- `select_admissible_action`
- `recoverable`
- `meaningful_progress`
- `retryable_failure`
- `no_progress_detected`
- `alternate_strategy_exists`
- `background_wait_is_best_option`
- `unblock_event_present`
- `resumable`

Each helper SHOULD be testable in isolation.

### Effect Dispatch Rules

The effect dispatcher MUST obey the following rules:

1. Effects MUST be executed only after the reducer has selected them.
2. Effects that would violate admissibility MUST be discarded and converted into failure observations.
3. Every completed effect MUST yield a new event, such as `TOOL_RESULT`, `TOOL_ERROR`, `APPROVAL_GRANTED`, or `APPROVAL_DENIED`.
4. The runtime SHOULD persist a resumable snapshot before or immediately after side effects that could be difficult or unsafe to repeat.
5. An effect dispatcher MUST NOT mutate the control phase directly; only the reducer may do that.

### Snapshot Guidance

The implementation does not need to persist state after every micro-step.

It MUST, however, preserve enough state to:

- resume safely after interruption
- avoid repeating unsafe writes or executions
- preserve pending approvals and trust decisions
- preserve background task tracking
- preserve the latest known plan and stop/block reason

### Recommended Test Categories

An implementation derived from this specification SHOULD include tests for:

- normal completion path
- approval-required path
- trust-required path
- context-compaction path
- retryable tool failure path
- irrecoverable failure path
- non-progress limit behavior
- blocked-to-resumed path
- stopped-to-resumed path
- background task integration

## Event Schema

This section defines the normative event contract consumed by the reducer.

The event schema exists to ensure that:

- every state transition is driven by a typed event
- effects return structured outcomes
- resumability and auditability are preserved
- approval, trust, tool execution, and interruption semantics are explicit

### Event Envelope

Every event MUST conform to the following logical envelope:

```text
EventEnvelope = {
  event_id: string,
  event_type: EventType,
  occurred_at: timestamp,
  source: EventSource,
  correlation_id: string | null,
  causation_id: string | null,
  phase_at_emit: AgentPhase | null,
  payload: EventPayload
}
```

### Envelope Field Rules

- `event_id` MUST be unique within a session.
- `event_type` MUST identify exactly one event kind.
- `occurred_at` MUST record when the event was emitted.
- `source` MUST identify the origin of the event.
- `correlation_id` SHOULD group related events belonging to the same high-level operation.
- `causation_id` SHOULD identify the immediately preceding event or effect that caused this event.
- `phase_at_emit` SHOULD record the control phase active when the event was emitted.
- `payload` MUST conform to the schema for the declared `event_type`.

### Event Types

```text
EventType =
  | USER_INPUT
  | TOOL_RESULT
  | TOOL_ERROR
  | APPROVAL_GRANTED
  | APPROVAL_DENIED
  | TRUST_GRANTED
  | TRUST_DENIED
  | BACKGROUND_TASK_UPDATED
  | CONTEXT_LOW
  | INTERRUPT
  | RESUME_REQUESTED
  | TIMER
```

### Event Sources

```text
EventSource =
  | USER
  | TOOL_DISPATCHER
  | APPROVAL_SYSTEM
  | TRUST_SYSTEM
  | BACKGROUND_TASK_RUNNER
  | CONTEXT_MANAGER
  | SESSION_MANAGER
  | RUNTIME
```

### Common Payload Conventions

All payloads SHOULD follow these conventions:

- use stable field names
- avoid embedding unstructured text where typed fields are possible
- include machine-usable status values in addition to human-readable messages
- preserve raw tool output when needed for debugging, but also provide normalized summaries where practical

### Event Payload Schemas

#### `USER_INPUT`

```text
payload = {
  message: string,
  attachments: Attachment[],
  requested_mode_change: AgentMode | null,
  referenced_paths: string[],
  metadata: map
}
```

Rules:

- `message` MUST contain the user-provided instruction or response.
- `requested_mode_change` MAY request enabling or disabling autopilot.
- `referenced_paths` SHOULD include any explicit file references.

#### `TOOL_RESULT`

```text
payload = {
  tool_name: string,
  invocation_id: string,
  status: "success",
  summary: string,
  output_ref: string | null,
  changed_paths: string[],
  started_at: timestamp | null,
  completed_at: timestamp,
  metadata: map
}
```

Rules:

- `invocation_id` MUST identify the effect invocation that produced the result.
- `changed_paths` MUST include any known modified files or directories.
- `output_ref` MAY point to stored large output instead of embedding it inline.

#### `TOOL_ERROR`

```text
payload = {
  tool_name: string,
  invocation_id: string,
  status: "error",
  error_code: string | null,
  message: string,
  stderr_ref: string | null,
  retryable_hint: boolean | null,
  started_at: timestamp | null,
  completed_at: timestamp,
  metadata: map
}
```

Rules:

- `message` MUST contain a readable failure description.
- `retryable_hint` MAY be supplied by the dispatcher, but the reducer MUST make the final retryability classification.

#### `APPROVAL_GRANTED`

```text
payload = {
  approval_scope: string,
  approved_action: string,
  approved_until: timestamp | null,
  session_scoped: boolean,
  metadata: map
}
```

#### `APPROVAL_DENIED`

```text
payload = {
  approval_scope: string,
  denied_action: string,
  user_feedback: string | null,
  metadata: map
}
```

Rules:

- Denials MUST be represented explicitly as events.
- A denial MUST NOT be silently converted into a retry of the same disallowed action.

#### `TRUST_GRANTED`

```text
payload = {
  trusted_path: string,
  scope: "session" | "persistent",
  metadata: map
}
```

#### `TRUST_DENIED`

```text
payload = {
  requested_path: string,
  user_feedback: string | null,
  metadata: map
}
```

Rules:

- Trust and approval are distinct concepts and SHOULD be tracked separately.

#### `BACKGROUND_TASK_UPDATED`

```text
payload = {
  task_id: string,
  task_status: "running" | "idle" | "completed" | "failed" | "cancelled",
  summary: string | null,
  output_ref: string | null,
  metadata: map
}
```

Rules:

- `task_id` MUST map to a tracked background task record.
- `task_status` MUST use one of the enumerated values.

#### `CONTEXT_LOW`

```text
payload = {
  remaining_budget: integer,
  threshold: integer,
  compaction_recommended: boolean,
  metadata: map
}
```

Rules:

- This event SHOULD be emitted before context exhaustion becomes terminal when possible.

#### `INTERRUPT`

```text
payload = {
  interrupt_type: "user_cancel" | "session_shutdown" | "runtime_abort",
  message: string | null,
  metadata: map
}
```

Rules:

- `INTERRUPT` MUST be treated as high priority.
- A user cancel interrupt SHOULD preempt further autonomous execution immediately.

#### `RESUME_REQUESTED`

```text
payload = {
  resume_token: string | null,
  source_session_id: string | null,
  metadata: map
}
```

Rules:

- Resume requests SHOULD only succeed when resumable state exists.

#### `TIMER`

```text
payload = {
  timer_name: string,
  deadline_at: timestamp | null,
  metadata: map
}
```

Rules:

- Timer events MAY be used for polling, timeout detection, or recovery backoff.

### Validation Rules

An implementation MUST validate events before they enter the reducer.

At minimum, validation MUST ensure:

1. `event_type` is recognized.
2. `payload` matches the schema for `event_type`.
3. required envelope fields are present.
4. timestamps are parseable.
5. referenced task IDs or invocation IDs are well-formed when provided.

Invalid events MUST NOT mutate agent state directly.

Instead, they SHOULD:

- be rejected before reducer entry, or
- be converted into a structured runtime error observation

### Ordering and Delivery Semantics

The runtime SHOULD process events in causal order when that order is known.

If strict ordering cannot be guaranteed:

- events MUST still preserve `correlation_id` and `causation_id` when available
- the reducer MUST tolerate late-arriving background task updates
- duplicate delivery SHOULD be handled safely through idempotence checks on `event_id`

### Event-to-Phase Mapping

The following defaults SHOULD apply:

- `USER_INPUT` -> usually consumed in `OBSERVE`
- `TOOL_RESULT` -> usually leads to `EVALUATE`
- `TOOL_ERROR` -> usually leads to `EVALUATE`
- `APPROVAL_GRANTED` and `APPROVAL_DENIED` -> usually re-enter through `OBSERVE`
- `TRUST_GRANTED` and `TRUST_DENIED` -> usually re-enter through `OBSERVE`
- `BACKGROUND_TASK_UPDATED` -> usually re-enter through `OBSERVE`
- `CONTEXT_LOW` -> usually influences `DECIDE`
- `INTERRUPT` -> may force immediate `STOPPED`
- `RESUME_REQUESTED` -> may transition `STOPPED -> OBSERVE`
- `TIMER` -> may reawaken `BLOCKED`, `RECOVER`, or `OBSERVE`

### Example Event

```text
{
  event_id: "evt-1042",
  event_type: TOOL_ERROR,
  occurred_at: "2026-03-24T10:30:00Z",
  source: TOOL_DISPATCHER,
  correlation_id: "op-88",
  causation_id: "evt-1041",
  phase_at_emit: EXECUTE,
  payload: {
    tool_name: "bash",
    invocation_id: "inv-55",
    status: "error",
    error_code: "EXIT_NONZERO",
    message: "Tests failed with exit code 1",
    stderr_ref: "artifact://stderr/inv-55",
    retryable_hint: true,
    started_at: "2026-03-24T10:29:45Z",
    completed_at: "2026-03-24T10:30:00Z",
    metadata: {}
  }
}
```

This event would normally be integrated in `OBSERVE`, classified during `EVALUATE`, and may transition the runtime into `RECOVER`.

## Safety and Liveness Properties

This section defines the correctness properties that an implementation of Autopilot Mode SHOULD satisfy.

These properties are divided into:

- **safety properties**, which describe things that must never happen
- **liveness properties**, which describe things that should eventually happen under fair conditions

The purpose of this section is to make the specification testable not just as a control flow, but also as a set of runtime guarantees and failure boundaries.

### Safety Properties

#### S1. No unauthorized side effects

The runtime MUST NOT execute a side-effecting action unless that action is admissible.

Formally:

```text
Always:
  if effect.kind in { RUN_TOOL, REQUEST_APPROVAL, REQUEST_TRUST, COMPACT_CONTEXT }
  and effect would modify, execute, or access protected resources,
  then admissible(state, effect) = true before dispatch
```

Implication:

- no file modification without permission
- no command execution without required approval
- no access outside trusted or allowed paths

#### S2. Approval cannot be bypassed by autonomy

Enabling autopilot MUST NOT allow any action that would be forbidden when autopilot is disabled.

Formally:

```text
Always:
  requires_approval(action) and not approval_granted(action)
  implies not dispatched(action)
```

#### S3. Trust cannot be bypassed by autonomy

The runtime MUST NOT access untrusted paths when trust is required and not granted.

Formally:

```text
Always:
  requires_trust(path) and not trust_granted(path)
  implies not dispatched(access(path))
```

#### S4. Blocked and stopped states are explicit

Whenever the machine enters `BLOCKED` or `STOPPED`, it MUST attach a reason.

Formally:

```text
Always:
  phase in { BLOCKED, STOPPED } implies stop_reason != null
```

#### S5. No silent denial loss

Approval or trust denials MUST be preserved as explicit observations.

Formally:

```text
Always:
  approval_denied or trust_denied
  implies exists event in history representing that denial
```

#### S6. No uncontrolled livelock

The runtime MUST NOT remain forever in a non-terminal loop that produces no meaningful progress and no explicit blocked or stop outcome.

Formally:

```text
Always:
  if no_progress_count exceeds limit
  then eventually phase in { BLOCKED, STOPPED, RECOVER }
```

Implication:

- repeated retries must be bounded
- repeated observation/decision cycles without advancement must be detected

#### S7. Stop is quiescent unless resumed

Once the machine is in `STOPPED`, it MUST NOT autonomously dispatch new work unless a valid resume condition occurs.

Formally:

```text
Always:
  phase = STOPPED and not resume_requested
  implies next dispatched_effect = none
```

#### S8. Interrupt preemption

High-priority interruption MUST preempt further autonomous progression.

Formally:

```text
Always:
  interrupt_received(type = user_cancel)
  implies eventually phase = STOPPED
```

#### S9. State preservation across risky effects

The runtime MUST preserve enough state to avoid unsafe re-execution of risky side effects after interruption or resume.

Formally:

```text
Always:
  if risky_effect_dispatched
  then resumable_snapshot_exists before repeated dispatch of equivalent risky_effect
```

This does not require persistence after every micro-transition, but it does require safe resumability.

### Liveness Properties

Liveness properties assume the following fairness conditions unless otherwise noted:

- the runtime continues receiving CPU time and is not externally frozen
- tool and storage subsystems eventually respond
- approval or trust systems eventually return a decision when queried
- required external resources eventually become available when the property depends on them

#### L1. Observation eventually leads to orientation

If the machine is in `OBSERVE` and observation processing succeeds, it SHOULD eventually transition to `ORIENT`.

Formally:

```text
Eventually:
  phase = OBSERVE and observation_processing_ok
  implies phase = ORIENT
```

#### L2. Completion eventually terminates

If the completion predicate becomes true, the runtime SHOULD eventually stop with `COMPLETED`.

Formally:

```text
Always:
  completion_predicate(state) = true
  implies eventually phase = STOPPED and stop_reason = COMPLETED
```

#### L3. Admissible work eventually executes

If an admissible foreground action exists and no higher-priority interrupt occurs, the runtime SHOULD eventually dispatch that action or an equivalent admissible action.

Formally:

```text
Eventually:
  exists admissible_action(state)
  and no interrupt or stronger blocker occurs
  implies dispatched(some admissible_action)
```

#### L4. Recoverable failure eventually leaves evaluation

If a failure is classified as recoverable, the machine SHOULD eventually transition into `RECOVER` and then either:

- find an alternate path
- become explicitly blocked
- stop explicitly

Formally:

```text
Always:
  recoverable_failure
  implies eventually phase in { RECOVER, BLOCKED, STOPPED }
```

#### L5. Blocked states are resumable when blockers clear

If the machine is blocked only by a removable blocker and the blocker is later removed, the machine SHOULD eventually return to `OBSERVE`.

Formally:

```text
Always:
  phase = BLOCKED
  and blocker_removed
  implies eventually phase = OBSERVE
```

#### L6. Background completions eventually become observations

If a tracked background task emits an update, the runtime SHOULD eventually ingest that update into the control loop.

Formally:

```text
Always:
  background_task_update_emitted(task_id)
  implies eventually observed(task_id)
```

#### L7. Resume eventually restarts a resumable machine

If the machine is stopped, resumable state exists, and a valid resume request is received, the runtime SHOULD eventually return to `OBSERVE`.

Formally:

```text
Always:
  phase = STOPPED
  and resumable(state)
  and resume_requested
  implies eventually phase = OBSERVE
```

### Non-Guarantees

This specification intentionally does **not** guarantee:

- eventual completion of every task
- successful recovery from every failure
- the existence of an admissible action at every point in time
- infinite autonomous persistence in the absence of progress

Autopilot is a continuation policy under constraints, not a proof that all tasks can be finished.

### Testable Obligations

An implementation SHOULD derive concrete tests from these properties.

At minimum, tests SHOULD verify:

1. side effects are blocked when approval is absent
2. side effects are blocked when trust is absent
3. completion transitions to `STOPPED(COMPLETED)`
4. repeated non-progress eventually produces `BLOCKED` or `STOPPED`
5. interrupt leads to quiescence
6. blocked state resumes when approval or trust is later granted
7. stopped state resumes only when resume conditions are met

### Verification Guidance

These properties may be validated using:

- state-machine unit tests
- reducer property tests
- model-based testing
- temporal logic or formal methods, if desired

If a formal method is later introduced, these properties are the best starting point for translation into temporal assertions.
