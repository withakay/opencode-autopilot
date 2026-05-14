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

  return `Autopilot status: ${status.join(", ")}`;
}
