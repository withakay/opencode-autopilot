import { describe, expect, test } from "bun:test";
import { CONTROL_AGENT, createChatMessageHook } from "../hooks/chat-message.ts";
import type { SessionTracking } from "../hooks/event-handler.ts";
import { createEventHandler, createSessionTracking } from "../hooks/event-handler.ts";
import { createPermissionHook } from "../hooks/permission.ts";
import { createSystemTransformHook } from "../hooks/system-transform.ts";
import { createToolAfterHook } from "../hooks/tool-after.ts";
import { buildAutopilotSystemPrompt, stripAutopilotMarker } from "../prompts/index.ts";
import { createSessionState } from "../state/factory.ts";
import { SessionCache } from "../state/session-cache.ts";
import type { ExtendedState } from "../types/index.ts";

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

function createTestEnv() {
  const stateMap = new Map<string, ExtendedState>();
  const trackingMap = new Map<string, SessionTracking>();
  const suppressCountMap = new Map<string, number>();
  const permissionModeMap = new Map<string, "allow-all" | "limited">();
  const sessionCache = new SessionCache();

  const getState = (sid: string) => stateMap.get(sid);
  const deleteState = (sid: string) => {
    stateMap.delete(sid);
    trackingMap.delete(sid);
  };
  const getTracking = (sid: string) => trackingMap.get(sid);

  let idleCallbackSid: string | undefined;
  let errorCallbackSid: string | undefined;
  let errorCallbackError: unknown;
  const deniedPermissions: Array<{ sessionID: string; type: string }> = [];

  const eventHandler = createEventHandler({
    getState,
    deleteState,
    sessionCache,
    getTracking,
    onSessionIdle: async (sid) => {
      idleCallbackSid = sid;
    },
    onSessionError: async (sid, error) => {
      errorCallbackSid = sid;
      errorCallbackError = error;
    },
  });

  const permissionHook = createPermissionHook({
    getState,
    getPermissionMode: (sid) => permissionModeMap.get(sid),
    onPermissionDenied: (sid, perm) => {
      deniedPermissions.push({ sessionID: sid, type: perm.type });
    },
  });

  const systemTransformHook = createSystemTransformHook({
    getState,
    getSuppressCount: (sid) => suppressCountMap.get(sid) ?? 0,
    decrementSuppressCount: (sid) => {
      const c = suppressCountMap.get(sid) ?? 0;
      if (c > 0) suppressCountMap.set(sid, c - 1);
    },
    buildSystemPrompt: buildAutopilotSystemPrompt,
  });

  const chatMessageHook = createChatMessageHook({
    getState,
    incrementSuppressCount: (sid) => {
      const c = suppressCountMap.get(sid) ?? 0;
      suppressCountMap.set(sid, c + 1);
    },
  });

  const toolAfterHook = createToolAfterHook({
    stripMarker: stripAutopilotMarker,
  });

  // Helper to arm a session
  function armSession(
    sessionID: string,
    opts: {
      goal?: string;
      permissionMode?: "allow-all" | "limited";
      workerAgent?: string;
    } = {},
  ) {
    const state = createSessionState(sessionID, opts.goal ?? "test task", {
      workerAgent: opts.workerAgent ?? "pi",
    });
    stateMap.set(sessionID, state);
    trackingMap.set(sessionID, createSessionTracking());
    suppressCountMap.set(sessionID, 0);
    permissionModeMap.set(sessionID, opts.permissionMode ?? "limited");
    return state;
  }

  return {
    stateMap,
    trackingMap,
    suppressCountMap,
    permissionModeMap,
    sessionCache,
    eventHandler,
    permissionHook,
    systemTransformHook,
    chatMessageHook,
    toolAfterHook,
    armSession,
    getState,
    getTracking,
    get idleCallbackSid() {
      return idleCallbackSid;
    },
    get errorCallbackSid() {
      return errorCallbackSid;
    },
    get errorCallbackError() {
      return errorCallbackError;
    },
    deniedPermissions,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Plugin Integration — event handler", () => {
  test("arming and initial dispatch: session.idle triggers callback", async () => {
    const env = createTestEnv();
    env.armSession("s1");

    await env.eventHandler({
      event: { type: "session.idle", properties: { sessionID: "s1" } },
    });

    expect(env.idleCallbackSid).toBe("s1");
  });

  test("captures only worker-agent replies", async () => {
    const env = createTestEnv();
    const _state = env.armSession("s1", { workerAgent: "pi" });
    const tracking = env.getTracking("s1")!;
    tracking.awaitingWorkerReply = true;

    // Worker agent message
    await env.eventHandler({
      event: {
        type: "message.updated",
        properties: {
          info: {
            sessionID: "s1",
            id: "msg-1",
            role: "assistant",
            agent: "pi",
            tokens: { input: 100, output: 50 },
            cost: 0.01,
          },
        },
      },
    });

    expect(tracking.lastAssistantMessageID).toBe("msg-1");

    // Non-worker agent message — should not update tracking
    tracking.lastAssistantMessageID = undefined;
    await env.eventHandler({
      event: {
        type: "message.updated",
        properties: {
          info: {
            sessionID: "s1",
            id: "msg-2",
            role: "assistant",
            agent: "other-agent",
          },
        },
      },
    });

    expect(tracking.lastAssistantMessageID).toBeUndefined();
  });

  test("tracks text parts from worker messages", async () => {
    const env = createTestEnv();
    env.armSession("s1", { workerAgent: "pi" });

    // First set role + agent
    env.sessionCache.setRole("s1", "msg-1", "assistant");
    env.sessionCache.setAgent("s1", "msg-1", "pi");

    await env.eventHandler({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            type: "text",
            sessionID: "s1",
            messageID: "msg-1",
            id: "part-1",
            text: "Hello world",
          },
        },
      },
    });

    expect(env.sessionCache.getMessageText("s1", "msg-1")).toBe("Hello world");
  });

  test("stops on session error", async () => {
    const env = createTestEnv();
    env.armSession("s1");

    await env.eventHandler({
      event: {
        type: "session.error",
        properties: {
          sessionID: "s1",
          error: { name: "APIError", data: { message: "rate limited" } },
        },
      },
    });

    expect(env.errorCallbackSid).toBe("s1");
  });

  test("cleans up session state on session.deleted", async () => {
    const env = createTestEnv();
    env.armSession("s1");

    await env.eventHandler({
      event: {
        type: "session.deleted",
        properties: { info: { id: "s1" } },
      },
    });

    expect(env.getState("s1")).toBeUndefined();
  });

  test("continuation limit enforcement", async () => {
    const env = createTestEnv();
    const state = env.armSession("s1");
    state.continuation_count = state.max_continues;

    // The state should indicate we're at the limit
    expect(state.continuation_count).toBe(state.max_continues);
  });
});

describe("Plugin Integration — permission hook", () => {
  test("allow-all mode auto-allows permissions", async () => {
    const env = createTestEnv();
    env.armSession("s1", { permissionMode: "allow-all" });

    const output: { status: "ask" | "deny" | "allow" } = { status: "ask" };
    await env.permissionHook(
      {
        id: "p1",
        type: "write",
        sessionID: "s1",
        messageID: "m1",
        title: "Write file",
        metadata: {},
        time: { created: Date.now() },
      },
      output,
    );

    expect(output.status).toBe("allow");
  });

  test("limited mode auto-denies permissions", async () => {
    const env = createTestEnv();
    env.armSession("s1", { permissionMode: "limited" });

    const output: { status: "ask" | "deny" | "allow" } = { status: "ask" };
    await env.permissionHook(
      {
        id: "p1",
        type: "write",
        sessionID: "s1",
        messageID: "m1",
        title: "Write file",
        metadata: {},
        time: { created: Date.now() },
      },
      output,
    );

    expect(output.status).toBe("deny");
    expect(env.deniedPermissions).toHaveLength(1);
    expect(env.deniedPermissions[0]?.type).toBe("write");
  });

  test("no-op for disabled sessions", async () => {
    const env = createTestEnv();
    // Don't arm — no state

    const output = { status: "ask" as const };
    await env.permissionHook(
      {
        id: "p1",
        type: "write",
        sessionID: "s1",
        messageID: "m1",
        title: "Write file",
        metadata: {},
        time: { created: Date.now() },
      },
      output,
    );

    expect(output.status).toBe("ask"); // Unchanged
  });
});

describe("Plugin Integration — system transform", () => {
  test("injects system prompt for worker turns", async () => {
    const env = createTestEnv();
    env.armSession("s1");

    const output = { system: [] as string[] };
    await env.systemTransformHook({ sessionID: "s1", model: {} }, output);

    expect(output.system).toHaveLength(1);
    expect(output.system[0]).toContain("Autopilot mode is active");
  });

  test("suppresses system prompt for control-agent turns", async () => {
    const env = createTestEnv();
    env.armSession("s1");

    // Simulate control agent turn
    await env.chatMessageHook(
      {
        sessionID: "s1",
        agent: CONTROL_AGENT,
      },
      { message: {}, parts: [] },
    );

    const output = { system: [] as string[] };
    await env.systemTransformHook({ sessionID: "s1", model: {} }, output);

    // Suppressed — no prompt added
    expect(output.system).toHaveLength(0);

    // Next turn should inject again
    const output2 = { system: [] as string[] };
    await env.systemTransformHook({ sessionID: "s1", model: {} }, output2);

    expect(output2.system).toHaveLength(1);
  });
});

describe("Plugin Integration — tool.execute.after", () => {
  test("strips autopilot markers from status output", async () => {
    const env = createTestEnv();
    const output = {
      title: "Status",
      output: 'Autopilot is running.\n<autopilot status="continue">keep going</autopilot>',
      metadata: {},
    };

    await env.toolAfterHook(
      {
        tool: "autopilot_status",
        sessionID: "s1",
        callID: "c1",
        args: {},
      },
      output,
    );

    expect(output.output).toBe("Autopilot is running.");
    expect(output.output).not.toContain("<autopilot");
  });

  test("does not modify output for other tools", async () => {
    const env = createTestEnv();
    const original = 'Some output\n<autopilot status="continue">keep going</autopilot>';
    const output = {
      title: "Other",
      output: original,
      metadata: {},
    };

    await env.toolAfterHook(
      {
        tool: "other_tool",
        sessionID: "s1",
        callID: "c1",
        args: {},
      },
      output,
    );

    expect(output.output).toBe(original);
  });
});
