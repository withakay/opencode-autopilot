import type { EventEnvelope, EventPayloadMap, EventType, AgentPhase } from "../types/index.ts";

export interface CreateEventOptions {
  source?: EventEnvelope["source"];
  correlation_id?: string | null;
  causation_id?: string | null;
  phase_at_emit?: AgentPhase | null;
  event_id?: string;
  occurred_at?: string;
}

function createEventID(): string {
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  return `evt-${Date.now()}-${randomSuffix}`;
}

export function createEvent<TType extends EventType>(
  eventType: TType,
  payload: EventPayloadMap[TType],
  options: CreateEventOptions = {},
): EventEnvelope<TType> {
  return {
    event_id: options.event_id ?? createEventID(),
    event_type: eventType,
    occurred_at: options.occurred_at ?? new Date().toISOString(),
    source: options.source ?? "RUNTIME",
    correlation_id: options.correlation_id ?? null,
    causation_id: options.causation_id ?? null,
    phase_at_emit: options.phase_at_emit ?? null,
    payload,
  };
}
