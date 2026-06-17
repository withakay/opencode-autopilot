import type { ExtendedState } from "../types/index.ts";

export interface UsageMetadata {
  tokens?: {
    total?: number;
    input?: number;
    output?: number;
  };
  cost?: {
    total?: number;
  };
}

export function formatUsageMetadata(usage: UsageMetadata | null | undefined): string {
  if (!usage) {
    return "";
  }

  const parts: string[] = [];

  if (usage.tokens) {
    const { total, input, output } = usage.tokens;

    if (Number.isFinite(total)) {
      parts.push(`${total} tokens`);
    } else if (Number.isFinite(input) || Number.isFinite(output)) {
      const tokenParts: string[] = [];

      if (Number.isFinite(input)) {
        tokenParts.push(`in ${input}`);
      }

      if (Number.isFinite(output)) {
        tokenParts.push(`out ${output}`);
      }

      if (tokenParts.length > 0) {
        parts.push(tokenParts.join(", "));
      }
    }
  }

  const totalCost = usage.cost?.total;
  if (Number.isFinite(totalCost)) {
    parts.push(`cost ${totalCost}`);
  }

  return parts.join("; ");
}

export function summarizeAutopilotState(state: ExtendedState | null | undefined): string {
  if (!state) {
    return "Autopilot is idle.";
  }

  const activeCheckpoint = state.checkpoints.find(
    (checkpoint) => checkpoint.id === state.current_checkpoint,
  );
  const completedCheckpoints = state.checkpoints.filter(
    (checkpoint) => checkpoint.status === "done",
  ).length;
  const criterionLines = state.goal_contract.criteria.map((criterion) => {
    const prefix =
      criterion.status === "verified" ? "✓" : criterion.status === "unverified" ? "?" : "•";
    return `${prefix} ${criterion.text}${criterion.evidence ? ` — ${criterion.evidence}` : ""}`;
  });
  const requiredSources = state.goal_contract.required_sources;
  const finalDigest = state.final_digest;
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - state.started_at) / 1000));

  const status = [
    `phase=${state.phase}`,
    `mode=${state.mode}`,
    `session_mode=${state.session_mode}`,
    `run_mode=${state.run_mode}`,
    `status=${state.status}`,
    `continues=${state.continuation_count}/${state.max_continues}`,
    `agent=${state.worker_agent}`,
  ];

  if (state.session_mode === "delegated-task") {
    status.push(`objective=${JSON.stringify(state.objective || state.goal)}`);
  }

  if (state.done_when) {
    status.push(`done_when=${JSON.stringify(state.done_when)}`);
  }

  if (state.verify_with) {
    status.push(`verify_with=${JSON.stringify(state.verify_with)}`);
  }

  if (state.plan.length > 0) {
    const doneSteps = state.plan.filter((step) => step.status === "done").length;
    const activeStep = state.plan[state.active_step_index];
    status.push(`plan=${doneSteps}/${state.plan.length}`);
    if (activeStep) status.push(`step=${JSON.stringify(activeStep.title)}`);
  }

  if (state.candidate_completion) {
    status.push(`candidate=${JSON.stringify(state.candidate_completion)}`);
  }

  if (state.stop_reason) {
    status.push(`stop=${state.stop_reason}`);
  }

  return [
    `Autopilot status: ${status.join(", ")}`,
    "",
    "## Autopilot Run Card",
    `Objective: ${state.objective || state.goal || "Session-level autonomy defaults"}`,
    `Status: ${state.status} (${state.mode})`,
    `Goal quality: ${state.goal_contract.quality}`,
    state.goal_contract.stop_condition
      ? `Stop condition: ${state.goal_contract.stop_condition}`
      : "Stop condition: not explicit",
    requiredSources.length > 0 ? `Read-first sources: ${requiredSources.join(", ")}` : undefined,
    activeCheckpoint
      ? `Current checkpoint: ${activeCheckpoint.title} (${activeCheckpoint.status})`
      : state.checkpoints.length > 0
        ? `Checkpoints: ${completedCheckpoints}/${state.checkpoints.length} complete`
        : undefined,
    state.plan.length > 0
      ? `Plan progress: ${state.plan.filter((step) => step.status === "done").length}/${state.plan.length}`
      : undefined,
    criterionLines.length > 0 ? ["Acceptance criteria:", ...criterionLines].join("\n") : undefined,
    state.last_verification
      ? `Last verification: ${state.last_verification.status} — ${state.last_verification.summary}`
      : state.verify_with
        ? `Last verification: not-run — ${state.verify_with}`
        : undefined,
    `Budget: continuation ${state.continuation_count}/${state.max_continues}; tokens ${state.total_tokens.toLocaleString()}/${state.max_tokens.toLocaleString()}; elapsed ${elapsedSeconds}s/${Math.round(state.max_duration_ms / 1000)}s; low-progress ${state.no_progress_turns}/${state.no_progress_turns_before_pause}; agent ${state.worker_agent}`,
    state.candidate_completion ? `Candidate completion: ${state.candidate_completion}` : undefined,
    finalDigest
      ? [
          "Final digest:",
          `- status: ${finalDigest.status}`,
          `- reason: ${finalDigest.reason}`,
          finalDigest.evidence.length > 0
            ? `- evidence: ${finalDigest.evidence.join("; ")}`
            : undefined,
          finalDigest.next_action ? `- next action: ${finalDigest.next_action}` : undefined,
        ]
          .filter((line): line is string => Boolean(line))
          .join("\n")
      : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
