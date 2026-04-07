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
    `continues=${state.continuation_count}/${state.max_continues}`,
    `agent=${state.worker_agent}`,
  ];

  if (state.session_mode === "delegated-task") {
    status.push(`task=${JSON.stringify(state.goal)}`);
  }

  if (state.stop_reason) {
    status.push(`stop=${state.stop_reason}`);
  }

  const latestEvent = state.latest_observations.events.at(-1);
  if (latestEvent) {
    status.push(`last_event=${latestEvent.event_type}`);
  }

  return `Autopilot status: ${status.join(", ")}`;
}
