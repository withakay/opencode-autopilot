// ---------------------------------------------------------------------------
// tool.execute.after hook — strips autopilot markers from status output
// ---------------------------------------------------------------------------

const AUTOPILOT_STATUS_TOOL = "autopilot_status";

export interface ToolAfterHookDeps {
  stripMarker: (text: string) => string;
}

interface ToolAfterInput {
  tool: string;
  sessionID: string;
  callID: string;
  args: unknown;
}

interface ToolAfterOutput {
  title: string;
  output: string;
  metadata: unknown;
}

export function createToolAfterHook(
  deps: ToolAfterHookDeps,
): (input: ToolAfterInput, output: ToolAfterOutput) => Promise<void> {
  return async (
    input: ToolAfterInput,
    output: ToolAfterOutput,
  ): Promise<void> => {
    if (input.tool !== AUTOPILOT_STATUS_TOOL) {
      return;
    }

    output.output = deps.stripMarker(output.output);
  };
}
