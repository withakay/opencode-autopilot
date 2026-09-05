import { describe, expect, test } from "bun:test";
import { createAutopilotPlugin } from "../plugin.ts";
import type { FakeContext } from "./helpers.ts";
import {
  assistantMessage,
  createFakeContext,
  executionInterrupted,
  executionSucceeded,
  settle,
} from "./helpers.ts";

async function startPlugin(harness: FakeContext) {
  const cleanup = await createAutopilotPlugin(harness.ctx);
  const command = harness.commands.find((definition) => definition.name === "autopilot");
  if (!command) throw new Error("expected the autopilot command to be registered");
  return { cleanup, command };
}

async function runCommand(harness: FakeContext, sessionID: string, text: string) {
  const command = harness.commands.find((definition) => definition.name === "autopilot");
  if (!command) throw new Error("expected the autopilot command to be registered");
  await command.execute({ sessionID, prompt: { text }, delivery: "queue" });
}

async function replyAndSucceed(harness: FakeContext, sessionID: string, text: string) {
  const created = Date.now() + 120_000;
  harness.setContextMessages([assistantMessage({ text, created })]);
  harness.pushEvent(executionSucceeded(sessionID, created + 1));
  await settle();
}

describe("Autopilot v2 controller", () => {
  test("command start dispatches the first worker prompt in the same call", async () => {
    const harness = createFakeContext();
    const { cleanup } = await startPlugin(harness);

    await runCommand(harness, "s1", "Fix the failing tests --max=5");

    // Dispatch happened synchronously within execute — no events pushed yet.
    expect(harness.syntheticCalls).toHaveLength(1);
    const dispatch = harness.syntheticCalls[0];
    expect(dispatch?.sessionID).toBe("s1");
    expect(dispatch?.description?.trim()).toBeTruthy();
    expect(dispatch?.text).toContain("Autopilot objective run started");

    const status = await harness.status("s1");
    expect(status.active).toBe(true);
    expect(status.text).toContain("Fix the failing tests");

    await cleanup?.();
  });

  test("an execution end that predates the dispatch is ignored", async () => {
    const harness = createFakeContext();
    const { cleanup } = await startPlugin(harness);

    await runCommand(harness, "s1", "Fix tests");
    expect(harness.syntheticCalls).toHaveLength(1);

    // Event created before the dispatch time — must not be treated as a reply.
    harness.pushEvent(executionSucceeded("s1", Date.now() - 60_000));
    await settle();

    expect(harness.syntheticCalls).toHaveLength(1);
    const status = await harness.status("s1");
    expect(status.active).toBe(true);

    await cleanup?.();
  });

  test("normal reply dispatches continuation 1/N", async () => {
    const harness = createFakeContext();
    const { cleanup } = await startPlugin(harness);

    await runCommand(harness, "s1", "Fix tests");
    await replyAndSucceed(harness, "s1", "**Autopilot status: continue**\nmore work remains");

    expect(harness.syntheticCalls).toHaveLength(2);
    expect(harness.syntheticCalls[1]?.text).toContain("Autopilot continuation 1/10");
    expect(harness.syntheticCalls[1]?.description).toContain("1/10");

    await cleanup?.();
  });

  test("complete marker triggers validation then stops COMPLETED", async () => {
    const harness = createFakeContext();
    const { cleanup } = await startPlugin(harness);

    await runCommand(harness, "s1", "Fix tests");
    await replyAndSucceed(harness, "s1", "**Autopilot status: complete**\ncandidate done");

    expect(harness.syntheticCalls).toHaveLength(2);
    expect(harness.syntheticCalls[1]?.text).toContain("VALIDATION");
    let status = await harness.status("s1");
    expect(status.text).toContain("status=validating");

    await replyAndSucceed(harness, "s1", "**Autopilot status: complete**\nverified done");

    expect(harness.syntheticCalls).toHaveLength(2);
    status = await harness.status("s1");
    expect(status.active).toBe(false);
    expect(status.text).toContain("status=completed");
    expect(status.text).toContain("stop=COMPLETED");
    expect(status.text).toContain("Final digest:");

    await cleanup?.();
  });

  test("--limited: permission hook denies and the run stops PERMISSION_DENIED", async () => {
    const harness = createFakeContext();
    const { cleanup } = await startPlugin(harness);

    await runCommand(harness, "s1", "Fix tests --limited");
    expect(harness.syntheticCalls).toHaveLength(1);

    const hook = harness.permissionHooks[0];
    if (!hook) throw new Error("expected a permission evaluate hook");
    const evaluation = {
      sessionID: "s1",
      action: "shell",
      resources: ["rm -rf /"],
      effect: "ask" as string,
      message: undefined as string | undefined,
    };
    await hook(evaluation);
    expect(evaluation.effect).toBe("deny");
    expect(evaluation.message).toBeTruthy();

    await replyAndSucceed(harness, "s1", "tried something");

    const status = await harness.status("s1");
    expect(status.active).toBe(false);
    expect(status.text).toContain("status=blocked");
    expect(status.text).toContain("stop=PERMISSION_DENIED");

    await cleanup?.();
  });

  test("allow-all: permission hook auto-allows", async () => {
    const harness = createFakeContext();
    const { cleanup } = await startPlugin(harness);

    await runCommand(harness, "s1", "Fix tests --allow-all");
    const hook = harness.permissionHooks[0];
    if (!hook) throw new Error("expected a permission evaluate hook");
    const evaluation = {
      sessionID: "s1",
      action: "edit",
      resources: ["file.ts"],
      effect: "ask" as string,
    };
    await hook(evaluation);
    expect(evaluation.effect).toBe("allow");

    await cleanup?.();
  });

  test("max continues exhausted stops RETRY_EXHAUSTED", async () => {
    const harness = createFakeContext();
    const { cleanup } = await startPlugin(harness);

    await runCommand(harness, "s1", "Fix tests --max=1");
    await replyAndSucceed(harness, "s1", "**Autopilot status: continue**\nstep 1 done");
    expect(harness.syntheticCalls).toHaveLength(2);

    await replyAndSucceed(harness, "s1", "**Autopilot status: continue**\nstill going");
    expect(harness.syntheticCalls).toHaveLength(2);

    const status = await harness.status("s1");
    expect(status.active).toBe(false);
    expect(status.text).toContain("stop=RETRY_EXHAUSTED");

    await cleanup?.();
  });

  test("pause interrupts the worker without counting as a user stop", async () => {
    const harness = createFakeContext();
    const { cleanup } = await startPlugin(harness);

    await runCommand(harness, "s1", "Fix tests");
    expect(harness.syntheticCalls).toHaveLength(1);

    await runCommand(harness, "s1", "pause");
    expect(harness.interruptCalls).toHaveLength(1);
    expect(harness.interruptCalls[0]?.continue).toBe(false);

    // The interrupt we issued produces a user-reason interrupted event.
    harness.pushEvent(executionInterrupted("s1", "user"));
    await settle();

    const status = await harness.status("s1");
    expect(status.text).toContain("status=paused");
    expect(status.text).not.toContain("stop=USER_STOP");

    await cleanup?.();
  });

  test("a genuine user interrupt stops the run USER_STOP", async () => {
    const harness = createFakeContext();
    const { cleanup } = await startPlugin(harness);

    await runCommand(harness, "s1", "Fix tests");
    harness.pushEvent(executionInterrupted("s1", "user"));
    await settle();

    const status = await harness.status("s1");
    expect(status.active).toBe(false);
    expect(status.text).toContain("stop=USER_STOP");

    await cleanup?.();
  });

  test("resume re-arms and dispatches a continuation immediately", async () => {
    const harness = createFakeContext();
    const { cleanup } = await startPlugin(harness);

    await runCommand(harness, "s1", "Fix tests");
    await replyAndSucceed(harness, "s1", "**Autopilot status: continue**\nprogress");
    expect(harness.syntheticCalls).toHaveLength(2);

    await runCommand(harness, "s1", "pause");
    harness.pushEvent(executionInterrupted("s1", "user"));
    await settle();

    await runCommand(harness, "s1", "resume --allow-all");
    expect(harness.syntheticCalls).toHaveLength(3);
    expect(harness.syntheticCalls[2]?.text).toContain("Autopilot continuation 2/10");

    await cleanup?.();
  });

  test("restart recovery marks active runs paused", async () => {
    const first = createFakeContext();
    const started = await startPlugin(first);
    await runCommand(first, "persisted", "Persist this objective");
    await started.cleanup?.();

    // Second plugin instance sharing the same storage.
    const second = createFakeContext();
    for (const [key, value] of first.storageMap) second.storageMap.set(key, value);
    const restarted = await startPlugin(second);

    const status = await second.status("persisted");
    expect(status.active).toBe(false);
    expect(status.text).toContain("Persist this objective");
    expect(status.text).toContain("status=paused");
    expect(status.text).toContain("stop=RECOVERED_AFTER_RESTART");

    // Recovered runs do not auto-dispatch until resumed.
    expect(second.syntheticCalls).toHaveLength(0);
    await runCommand(second, "persisted", "resume");
    expect(second.syntheticCalls).toHaveLength(1);

    await restarted.cleanup?.();
  });

  test("session.deleted clears state and storage", async () => {
    const harness = createFakeContext();
    const { cleanup } = await startPlugin(harness);

    await runCommand(harness, "s1", "Fix tests");
    expect(harness.storageMap.has("state/s1")).toBe(true);

    harness.pushEvent({
      id: "evt",
      created: Date.now(),
      type: "session.deleted",
      durable: { aggregateID: "s1", seq: 1, version: 2 },
      data: { sessionID: "s1" },
    });
    await settle();

    expect(harness.storageMap.has("state/s1")).toBe(false);
    const status = await harness.status("s1");
    expect(status.active).toBe(false);

    await cleanup?.();
  });

  test("plan-backed run advances steps and validates at the end", async () => {
    const harness = createFakeContext();
    const { cleanup } = await startPlugin(harness);

    await runCommand(harness, "s1", "Implement PLAN.md\n1. Read PLAN.md\n2. Implement changes");
    expect(harness.syntheticCalls).toHaveLength(1);
    expect(harness.syntheticCalls[0]?.text).toContain("Autopilot plan step 1/2");

    await replyAndSucceed(harness, "s1", "**Autopilot status: step-done**\nread the plan");
    expect(harness.syntheticCalls).toHaveLength(2);
    expect(harness.syntheticCalls[1]?.text).toContain("Autopilot plan step 2/2");

    await replyAndSucceed(harness, "s1", "**Autopilot status: step-done**\nimplemented changes");
    expect(harness.syntheticCalls).toHaveLength(3);
    expect(harness.syntheticCalls[2]?.text).toContain("VALIDATION");

    await cleanup?.();
  });

  test("context hook injects objective guidance while enabled", async () => {
    const harness = createFakeContext();
    const { cleanup } = await startPlugin(harness);

    await runCommand(harness, "s1", "Fix tests");
    const hook = harness.contextHooks[0];
    if (!hook) throw new Error("expected a context hook");

    const input = {
      sessionID: "s1",
      agent: "pi",
      system: [] as Array<{ type: string; text: string }>,
    };
    await hook(input);
    expect(input.system).toHaveLength(1);
    expect(input.system[0]?.text).toContain("Autopilot mode is active");
    expect(input.system[0]?.text).toContain("<autopilot_objective>");

    // Disabled sessions get nothing.
    const other = { sessionID: "s2", agent: "pi", system: [] as unknown[] };
    await hook(other);
    expect(other.system).toHaveLength(0);

    await cleanup?.();
  });
});
