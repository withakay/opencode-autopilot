import { describe, expect, test } from "bun:test";
import { createEvent } from "../events/index.ts";
import { runControlLoop } from "../loop/control-loop.ts";
import { createInitialState } from "../state/factory.ts";

describe("runControlLoop", () => {
  test("reports queue_drained when no more events remain after a non-terminal step", async () => {
    const state = createInitialState("Refactor the autopilot plugin", {
      mode: "ENABLED",
      phase: "OBSERVE",
    });

    const event = createEvent(
      "USER_INPUT",
      {
        message: "Start by reading the repository",
        attachments: [],
        requested_mode_change: null,
        referenced_paths: [],
        metadata: {},
      },
      {
        source: "USER",
        phase_at_emit: "OBSERVE",
      },
    );

    const result = await runControlLoop(state, event);

    expect(result.stoppedBecause).toBe("queue_drained");
    expect(result.finalState.phase).not.toBe("STOPPED");
    expect(result.iterations).toBeGreaterThan(0);
  });

  test("still reports max_iterations when the iteration cap is hit", async () => {
    const state = createInitialState("Refactor the autopilot plugin", {
      mode: "ENABLED",
      phase: "OBSERVE",
    });

    const event = createEvent(
      "USER_INPUT",
      {
        message: "Start by reading the repository",
        attachments: [],
        requested_mode_change: null,
        referenced_paths: [],
        metadata: {},
      },
      {
        source: "USER",
        phase_at_emit: "OBSERVE",
      },
    );

    const result = await runControlLoop(state, event, { maxIterations: 0 });

    expect(result.stoppedBecause).toBe("max_iterations");
    expect(result.iterations).toBe(0);
  });
});
