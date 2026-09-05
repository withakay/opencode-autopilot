// Pure ExtendedState helpers shared by the controller modules.
import type { CheckpointStatus, ExtendedState, VerificationRecord } from "../types/index.ts";

export function activePlanStep(state: ExtendedState) {
  if (state.active_step_index < 0) return undefined;
  const step = state.plan[state.active_step_index];
  return step?.status === "in_progress" ? step : undefined;
}

export function currentCheckpoint(state: ExtendedState) {
  return state.checkpoints.find((checkpoint) => checkpoint.id === state.current_checkpoint);
}

export function appendCheckpointEvidence(state: ExtendedState, evidence: string | undefined): void {
  const trimmed = evidence?.trim();
  if (!trimmed) return;
  const checkpoint = currentCheckpoint(state);
  if (!checkpoint) return;
  checkpoint.evidence.push(trimmed);
  if (checkpoint.evidence.length > 8) checkpoint.evidence = checkpoint.evidence.slice(-8);
}

export function finishCheckpoint(
  state: ExtendedState,
  status: CheckpointStatus,
  evidence?: string,
): void {
  const checkpoint = currentCheckpoint(state);
  if (!checkpoint) return;
  appendCheckpointEvidence(state, evidence);
  checkpoint.status = status;
  checkpoint.completed_at = new Date().toISOString();
}

export function startCheckpoint(state: ExtendedState, title: string, evidence?: string): void {
  const active = currentCheckpoint(state);
  if (active?.status === "active" && active.title === title) {
    appendCheckpointEvidence(state, evidence);
    return;
  }

  const checkpoint = {
    id: `checkpoint-${state.checkpoints.length + 1}`,
    title,
    status: "active" as const,
    evidence: evidence?.trim() ? [evidence.trim()] : [],
    started_at: new Date().toISOString(),
  };
  state.checkpoints.push(checkpoint);
  state.current_checkpoint = checkpoint.id;
}

export function recordVerification(state: ExtendedState, verification: VerificationRecord): void {
  state.last_verification = verification;
  const verificationCriterion = state.goal_contract.criteria.find((criterion) =>
    criterion.text.startsWith("Verification command passes:"),
  );
  if (verificationCriterion) {
    verificationCriterion.status = verification.status === "passed" ? "verified" : "pending";
    verificationCriterion.evidence = verification.summary;
  }
}

export function budgetStopMessage(state: ExtendedState): string | undefined {
  const elapsedMs = Date.now() - state.started_at;
  if (elapsedMs >= state.max_duration_ms) {
    return `Max duration reached (${Math.round(elapsedMs / 1000)}s/${Math.round(state.max_duration_ms / 1000)}s).`;
  }

  if (state.total_tokens >= state.max_tokens) {
    return `Max tracked tokens reached (${state.total_tokens.toLocaleString()}/${state.max_tokens.toLocaleString()}).`;
  }

  return undefined;
}
