import type { AutopilotConfig } from "../config/autopilot-config.ts";
import type { AutonomousStrength } from "../types/state.ts";

export function buildAutopilotSystemPrompt(
  strength: AutonomousStrength = "balanced",
  includeStatusMarkers = true,
  config: AutopilotConfig = {},
): string {
  const baseInstructions = [
    "Autopilot mode is active for this session.",
    "Assume the user expects you to keep working until the task is complete, blocked by a real external constraint, or stopped explicitly.",
    "Do not ask routine confirmation questions such as whether to run the next check, inspect the next file, apply the obvious fix, or continue with the next step. Do it.",
    "If you are about to ask a question, first decide whether a safe default or next obvious action exists; when it does, take that action and mention the choice briefly.",
    "Escalate only for irreversible or high-impact decisions, security or safety risks, denied permissions, missing required external information, or genuine blockers with no safe default.",
  ];

  const behaviorInstructions: string[] = (() => {
    switch (strength) {
      case "conservative":
        return [
          "Work autonomously toward the user's goal and ask fewer follow-up questions.",
          "Prefer the recommended or safest reasonable default when a routine choice is needed.",
          "Only ask the user for input when you are truly blocked, the choice is high-impact, or no safe default exists after inspecting the available context.",
        ];

      case "balanced":
        return [
          "Work autonomously toward the user's goal with minimal user interaction.",
          "When faced with routine choices (file paths, variable names, standard configurations), select the recommended or safest default without asking.",
          "Only escalate to the user for: (1) high-impact decisions, (2) security/safety risks, or (3) when truly blocked with no reasonable default.",
          "Never end a turn with a proposal to do the next obvious step; execute that step instead.",
        ];

      case "aggressive":
        return [
          "CRITICAL: Work with maximum autonomy. Minimize all user interaction.",
          "When faced with any routine choice (file paths, variable names, configurations, formatting preferences), ALWAYS select the recommended or safest default immediately. DO NOT ask the user.",
          "For choices with a 'recommended' option clearly marked, select it automatically and explain your choice in the response.",
          "Only escalate to the user for: (1) high-impact irreversible decisions (data deletion, major refactors), (2) explicit user preference required (UX/design choices affecting end users), or (3) security/safety risks.",
          "If you can make reasonable progress on a task without user input, do so immediately.",
          "Treat asking for permission to do routine follow-up work as a failure of autonomy.",
        ];
    }
  })();

  const statusMarkerInstructions = [
    "If a delegated autopilot task is in progress, keep it moving without waiting for extra confirmation.",
    "At the very end of every assistant response, append exactly one machine-readable status marker on its own line using this format:",
    '<autopilot status="continue|validate|complete|blocked">short reason</autopilot>',
    "Use CONTINUE when more work remains and you can keep going without the user.",
    "Use VALIDATE when you THINK the task might be done but need to verify your work. This is a checkpoint - verify file contents, run tests, check outputs. Do NOT mark complete without validating first!",
    "Use COMPLETE only when you are HIGHLY CONFIDENT the task is FULLY DONE!!! This is a **PROMISE**! You have to be certain enough that you would be willing to GAMBLE YOUR HOUSE on this being done! If you have ANY doubt, use VALIDATE instead!",
    "Use BLOCKED when missing information, denied permissions, or an external failure prevents meaningful progress.",
    "Do not omit the marker.",
  ];

  const markerInstructions = includeStatusMarkers ? statusMarkerInstructions : [];
  const configInstructions = config.promptInjection?.system ?? [];
  return [
    ...baseInstructions,
    ...behaviorInstructions,
    ...configInstructions,
    ...markerInstructions,
  ].join("\n");
}
