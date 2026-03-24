import type { EventEnvelope } from "../types/index.ts";

import { eventEnvelopeSchema } from "./schemas.ts";

const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export type EventValidationResult =
  | { ok: true; event: EventEnvelope }
  | { ok: false; error: string };

function isWellFormedIdentifier(value: string | null | undefined): boolean {
  return value == null || IDENTIFIER_RE.test(value);
}

function isWellFormedTimestamp(value: string | null | undefined): boolean {
  return value == null || !Number.isNaN(Date.parse(value));
}

function findIdentifierError(event: EventEnvelope): string | null {
  if (!isWellFormedIdentifier(event.event_id)) {
    return "event_id is not well-formed";
  }

  const payload = event.payload as unknown as Record<string, unknown>;
  const invocationID = payload.invocation_id;
  if (typeof invocationID === "string" && !isWellFormedIdentifier(invocationID)) {
    return "payload invocation_id is not well-formed";
  }

  const taskID = payload.task_id;
  if (typeof taskID === "string" && !isWellFormedIdentifier(taskID)) {
    return "payload task_id is not well-formed";
  }

  return null;
}

function findTimestampError(event: EventEnvelope): string | null {
  if (!isWellFormedTimestamp(event.occurred_at)) {
    return "occurred_at is not parseable";
  }

  const payload = event.payload as unknown as Record<string, unknown>;
  const timestampFields = ["started_at", "completed_at", "approved_until", "deadline_at"] as const;

  for (const field of timestampFields) {
    const value = payload[field];
    if ((typeof value === "string" || value === null) && !isWellFormedTimestamp(value)) {
      return `payload ${field} is not parseable`;
    }
  }

  return null;
}

export function validateEvent(raw: unknown): EventValidationResult {
  const parsed = eventEnvelopeSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((issue) => issue.message).join("; "),
    };
  }

  const event = parsed.data as EventEnvelope;
  const identifierError = findIdentifierError(event);
  if (identifierError) {
    return { ok: false, error: identifierError };
  }

  const timestampError = findTimestampError(event);
  if (timestampError) {
    return { ok: false, error: timestampError };
  }

  return { ok: true, event };
}
