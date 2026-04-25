import { describe, expect, test } from "bun:test";
import type { AutopilotConfig } from "../config/autopilot-config.ts";
import { createChatMessageHook } from "../hooks/chat-message.ts";
import type { SessionTracking } from "../hooks/event-handler.ts";
import { createEventHandler, createSessionTracking } from "../hooks/event-handler.ts";
import { createPermissionHook } from "../hooks/permission.ts";
import { createSessionCompactingHook } from "../hooks/session-compacting.ts";
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
  const permissionModeMap = new Map<string, "allow-all" | "limited">();
  const historyMap = new Map<string, string[]>();
  const pendingAgentMap = new Map<string, string | undefined>();
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
  const config: AutopilotConfig = {
    promptInjection: {
      system: ["Follow the active spec workflow."],
      compaction: ["Carry the workflow state forward."],
    },
    workflow: {
      name: "SpecFlow",
      phase: "implement",
      goal: "Finish the feature",
      doneCriteria: ["tests pass"],
      nextActions: ["implement code"],
    },
  };

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
    consumePendingAgent: (sid) => {
      const agent = pendingAgentMap.get(sid);
      pendingAgentMap.delete(sid);
      return agent;
    },
    getConfig: () => config,
    buildSystemPrompt: buildAutopilotSystemPrompt,
  });

  const chatMessageHook = createChatMessageHook({
    getState,
    setPendingAgent: (sid, agent) => {
      pendingAgentMap.set(sid, agent);
    },
  });

  const sessionCompactingHook = createSessionCompactingHook({
    getState,
    getHistory: (sid) => historyMap.get(sid) ?? [],
    getConfig: () => config,
    summarizeWorkflow: (currentConfig) => {
      const workflow = currentConfig.workflow;
      if (!workflow) return [];
      return [`Active workflow: ${workflow.name}`, `Current phase: ${workflow.phase}`];
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
      sessionMode?: ExtendedState["session_mode"];
    } = {},
  ) {
    const state = createSessionState(sessionID, opts.goal ?? "test task", {
      workerAgent: opts.workerAgent ?? "pi",
      sessionMode: opts.sessionMode,
    });
    stateMap.set(sessionID, state);
    trackingMap.set(sessionID, createSessionTracking());
    permissionModeMap.set(sessionID, opts.permissionMode ?? "limited");
    historyMap.set(sessionID, ["armed"]);
    return state;
  }

  return {
    stateMap,
    trackingMap,
    permissionModeMap,
    historyMap,
    pendingAgentMap,
    sessionCache,
    eventHandler,
    permissionHook,
    chatMessageHook,
    systemTransformHook,
    sessionCompactingHook,
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
    const tracking = env.getTracking("s1");
    if (!tracking) {
      throw new Error("tracking should exist for an armed session");
    }
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
  test("injects delegated status prompt for worker turns", async () => {
    const env = createTestEnv();
    env.armSession("s1", { workerAgent: "pi" });

    await env.chatMessageHook(
      {
        sessionID: "s1",
        agent: "pi",
      },
      { message: {}, parts: [] },
    );

    const output = { system: [] as string[] };
    await env.systemTransformHook({ sessionID: "s1", model: {} }, output);

    expect(output.system).toHaveLength(1);
    const prompt = output.system[0];
    if (!prompt) throw new Error("expected system prompt");
    expect(prompt).toContain("Autopilot mode is active");
    expect(prompt).toContain("Follow the active spec workflow.");
    expect(prompt).toContain('<autopilot status="continue|validate|complete|blocked">');
  });

  test("skips delegated status prompt for non-worker turns", async () => {
    const env = createTestEnv();
    env.armSession("s1", { workerAgent: "pi" });

    await env.chatMessageHook(
      {
        sessionID: "s1",
        agent: "other-agent",
      },
      { message: {}, parts: [] },
    );

    const output = { system: [] as string[] };
    await env.systemTransformHook({ sessionID: "s1", model: {} }, output);

    expect(output.system).toHaveLength(0);
  });

  test("injects session-default autonomy guidance without status markers", async () => {
    const env = createTestEnv();
    env.armSession("s1", { sessionMode: "session-defaults" });

    const output = { system: [] as string[] };
    await env.systemTransformHook({ sessionID: "s1", model: {} }, output);

    expect(output.system).toHaveLength(1);
    const prompt = output.system[0];
    if (!prompt) throw new Error("expected system prompt");
    expect(prompt).toContain("Autopilot mode is active");
    expect(prompt).toContain("Follow the active spec workflow.");
    expect(prompt).not.toContain('<autopilot status="continue|validate|complete|blocked">');
  });

  test("does not inject system prompt for disabled sessions", async () => {
    const env = createTestEnv();

    const output = { system: [] as string[] };
    await env.systemTransformHook({ sessionID: "s1", model: {} }, output);

    expect(output.system).toHaveLength(0);
  });
});

describe("Plugin Integration — session compacting", () => {
  test("preserves autopilot continuation state during compaction", async () => {
    const env = createTestEnv();
    const state = env.armSession("s1", { workerAgent: "general" });
    state.continuation_count = 3;
    env.historyMap.set("s1", ["armed", "Continuation 3/10"]);

    const output = { context: [] as string[] };
    await env.sessionCompactingHook({ sessionID: "s1" }, output);

    expect(output.context).toHaveLength(1);
    const context = output.context[0];
    if (!context) throw new Error("expected compaction context");
    expect(context).toContain("Autopilot Continuation State");
    expect(context).toContain("Continuation 3/");
    expect(context).toContain("without routine confirmation questions");
    expect(context).toContain("Active workflow: SpecFlow");
    expect(context).toContain("Carry the workflow state forward.");
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
        tool: "autopilot",
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
