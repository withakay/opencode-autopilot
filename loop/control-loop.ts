import { createEvent } from "../events/index.ts";
import type { DispatchEffectContext } from "../effects/dispatcher.ts";
import { dispatchEffect } from "../effects/index.ts";
import { reduce } from "../reducer/index.ts";
import type {
  Effect,
  EventEnvelope,
  EventType,
  ExtendedState,
  ReducerResult,
} from "../types/index.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ReducedEvent = {
  [Type in EventType]: EventEnvelope<Type>;
}[EventType];

/**
 * Configuration for the control loop, including optional handler overrides
 * for effect dispatch (tool execution, approval, trust, etc.).
 */
export interface ControlLoopConfig {
  /** Maximum iterations before forced stop (safety valve). */
  maxIterations?: number;

  /**
   * Handlers injected into the effect dispatcher.
   * If omitted, effects use their default no-op/passthrough behavior.
   */
  handlers?: DispatchEffectContext["handlers"];

  /**
   * Optional abort signal for cooperative cancellation.
   * When aborted, the loop treats it as an INTERRUPT event.
   */
  signal?: AbortSignal;

  /**
   * Callback fired after each reducer step.
   * Useful for logging, tracing, or debugging.
   */
  onStep?: (step: ControlLoopStep) => void;
}

export interface ControlLoopStep {
  iteration: number;
  event: ReducedEvent;
  result: ReducerResult;
  dispatchedEffects: Effect[];
}

export interface ControlLoopResult {
  finalState: ExtendedState;
  iterations: number;
  stoppedBecause: "phase_stopped" | "phase_blocked" | "max_iterations" | "aborted" | "disabled";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Absolute upper bound to prevent runaway loops regardless of config. */
const HARD_ITERATION_LIMIT = 10_000;

/** Default max iterations if not configured. */
const DEFAULT_MAX_ITERATIONS = 1_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTerminalPhase(state: ExtendedState): boolean {
  return state.phase === "STOPPED" || state.phase === "BLOCKED";
}

function makeInterruptEvent(
  state: ExtendedState,
  message: string,
): ReducedEvent {
  return createEvent(
    "INTERRUPT",
    {
      interrupt_type: "user_cancel",
      message,
      metadata: {},
    },
    {
      source: "SESSION_MANAGER",
      phase_at_emit: state.phase,
    },
  );
}

// ---------------------------------------------------------------------------
// Control Loop
// ---------------------------------------------------------------------------

/**
 * Runs the OODA control loop until the state machine reaches a terminal phase
 * (STOPPED or BLOCKED), the iteration limit is hit, or the abort signal fires.
 *
 * The loop:
 * 1. Feeds the event into `reduce(state, event)` to get `{ nextState, effects }`.
 * 2. Dispatches each effect via `dispatchEffect`, collecting result events.
 * 3. Feeds result events back through the reducer (one at a time).
 * 4. Repeats until terminal or limit.
 *
 * **Interrupt preemption (7.2)**: If the abort signal fires, the loop creates
 * an INTERRUPT event and feeds it through the reducer, which transitions to
 * STOPPED with USER_STOP. The reducer itself handles the INTERRUPT -> STOPPED
 * transition.
 *
 * **BLOCKED -> OBSERVE (7.3)**: When the state is BLOCKED and a new event
 * arrives that clears the blocker (e.g. APPROVAL_GRANTED, TRUST_GRANTED,
 * USER_INPUT, BACKGROUND_TASK_UPDATED), the reducer's BLOCKED case calls
 * `unblockEventPresent()` and transitions to OBSERVE.
 *
 * **STOPPED -> OBSERVE (7.4)**: When the state is STOPPED and a
 * RESUME_REQUESTED event arrives with `resumable(state) = true`, the reducer's
 * STOPPED case transitions to OBSERVE.
 */
export async function runControlLoop(
  initialState: ExtendedState,
  seedEvent: ReducedEvent,
  config: ControlLoopConfig = {},
): Promise<ControlLoopResult> {
  const maxIterations = Math.min(
    config.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    HARD_ITERATION_LIMIT,
  );

  let state = initialState;
  let iteration = 0;

  // Event queue — seed it with the initial event.
  const eventQueue: ReducedEvent[] = [seedEvent];

  while (eventQueue.length > 0) {
    // ---- Safety: check abort signal ----
    if (config.signal?.aborted === true) {
      // Inject an INTERRUPT and process it through the reducer once.
      const interruptEvent = makeInterruptEvent(state, "Abort signal received");
      const interruptResult = reduce(state, interruptEvent);
      state = interruptResult.nextState;
      config.onStep?.({
        iteration,
        event: interruptEvent,
        result: interruptResult,
        dispatchedEffects: [],
      });
      return {
        finalState: state,
        iterations: iteration,
        stoppedBecause: "aborted",
      };
    }

    // ---- Safety: check iteration limit ----
    if (iteration >= maxIterations) {
      return {
        finalState: state,
        iterations: iteration,
        stoppedBecause: "max_iterations",
      };
    }

    // ---- Dequeue next event ----
    const event = eventQueue.shift()!;
    iteration++;

    // ---- Reduce ----
    const result = reduce(state, event);
    state = result.nextState;

    // ---- Dispatch effects and collect result events ----
    const dispatchedEffects = result.effects;

    config.onStep?.({
      iteration,
      event,
      result,
      dispatchedEffects,
    });

    // ---- Check for disabled mode ----
    if (state.mode === "DISABLED") {
      return {
        finalState: state,
        iterations: iteration,
        stoppedBecause: "disabled",
      };
    }

    // ---- Check terminal phase BEFORE dispatching effects ----
    // If we're STOPPED or BLOCKED and there are no effects to dispatch,
    // the loop ends. But if there are effects (e.g. EMIT_FINAL_RESPONSE,
    // PERSIST_SNAPSHOT), we dispatch them first.
    if (isTerminalPhase(state) && dispatchedEffects.length === 0) {
      return {
        finalState: state,
        iterations: iteration,
        stoppedBecause: state.phase === "STOPPED" ? "phase_stopped" : "phase_blocked",
      };
    }

    // ---- Dispatch effects ----
    // PERSIST_SNAPSHOT effects are dispatched first (safety invariant S9).
    // Then remaining effects in order.
    const snapshotEffects = dispatchedEffects.filter(
      (e) => e.kind === "PERSIST_SNAPSHOT",
    );
    const otherEffects = dispatchedEffects.filter(
      (e) => e.kind !== "PERSIST_SNAPSHOT",
    );

    // Dispatch snapshot effects first (don't re-queue their results,
    // they are housekeeping).
    for (const eff of snapshotEffects) {
      await dispatchEffect(eff, buildDispatchContext(state, event, config));
    }

    // Dispatch remaining effects and queue their result events.
    for (const eff of otherEffects) {
      // Check abort between effect dispatches.
      if (config.signal?.aborted === true) {
        const interruptEvent = makeInterruptEvent(state, "Abort signal received during effect dispatch");
        eventQueue.unshift(interruptEvent);
        break;
      }

      const resultEvent = await dispatchEffect(
        eff,
        buildDispatchContext(state, event, config),
      );
      eventQueue.push(resultEvent);
    }

    // ---- If terminal and no new events queued, exit ----
    if (isTerminalPhase(state) && eventQueue.length === 0) {
      return {
        finalState: state,
        iterations: iteration,
        stoppedBecause: state.phase === "STOPPED" ? "phase_stopped" : "phase_blocked",
      };
    }
  }

  // Event queue drained without reaching terminal — this is the
  // natural end when all effects have been consumed.
  return {
    finalState: state,
    iterations: iteration,
    stoppedBecause: isTerminalPhase(state)
      ? state.phase === "STOPPED"
        ? "phase_stopped"
        : "phase_blocked"
      : "max_iterations",
  };
}

/**
 * Convenience function to send an INTERRUPT into a running loop's state.
 * This is used by the `autopilot_stop` tool to force the loop to halt.
 *
 * Returns the reducer result so the caller can update the shared state.
 */
export function interruptLoop(
  state: ExtendedState,
  message?: string,
): ReducerResult {
  const event = makeInterruptEvent(state, message ?? "User requested stop");
  return reduce(state, event);
}

/**
 * Convenience function to send a RESUME_REQUESTED event into a stopped loop.
 * Returns the reducer result. If the state is resumable, the result will
 * transition to OBSERVE.
 */
export function resumeLoop(
  state: ExtendedState,
  resumeToken?: string | null,
  sourceSessionId?: string | null,
): ReducerResult {
  const event = createEvent(
    "RESUME_REQUESTED",
    {
      resume_token: resumeToken ?? null,
      source_session_id: sourceSessionId ?? null,
      metadata: {},
    },
    {
      source: "SESSION_MANAGER",
      phase_at_emit: state.phase,
    },
  );
  return reduce(state, event);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function buildDispatchContext(
  state: ExtendedState,
  event: ReducedEvent,
  config: ControlLoopConfig,
): DispatchEffectContext {
  return {
    state,
    phase_at_emit: state.phase,
    correlation_id: event.correlation_id,
    causation_id: event.event_id,
    handlers: config.handlers,
  };
}
