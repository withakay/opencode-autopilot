// ---------------------------------------------------------------------------
// tool.execute.after hook — strips autopilot markers from status output
// ---------------------------------------------------------------------------

const AUTOPILOT_OUTPUT_TOOLS = new Set(["autopilot", "autopilot_status"]);

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
  return async (input: ToolAfterInput, output: ToolAfterOutput): Promise<void> => {
    if (!AUTOPILOT_OUTPUT_TOOLS.has(input.tool)) {
      return;
    }

    output.output = deps.stripMarker(output.output);
  };
}
