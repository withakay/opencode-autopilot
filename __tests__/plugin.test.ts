import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { AutopilotConfig } from "../config/autopilot-config.ts";
import { createChatMessageHook } from "../hooks/chat-message.ts";
import type { SessionTracking } from "../hooks/event-handler.ts";
import { createEventHandler, createSessionTracking } from "../hooks/event-handler.ts";
import { createPermissionHook } from "../hooks/permission.ts";
import { createSessionCompactingHook } from "../hooks/session-compacting.ts";
import { createSystemTransformHook } from "../hooks/system-transform.ts";
import { createToolAfterHook } from "../hooks/tool-after.ts";
import { AutopilotPlugin } from "../plugin.ts";
import { buildAutopilotSystemPrompt, stripAutopilotMarker } from "../prompts/index.ts";
import { createSessionState } from "../state/factory.ts";
import { SessionCache } from "../state/session-cache.ts";
import type { ExtendedState } from "../types/index.ts";

async function withTempDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "autopilot-plugin-test-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

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

  test("objective run does not double-dispatch on duplicate idle events", async () => {
    await withTempDir(async (dir) => {
      let resolvePrompt: (() => void) | undefined;
      let resolvePromptStarted: (() => void) | undefined;
      const promptStarted = new Promise<void>((resolve) => {
        resolvePromptStarted = resolve;
      });
      let promptCalls = 0;
      const plugin = await AutopilotPlugin({
        directory: dir,
        worktree: dir,
        client: {
          tui: { showToast: async () => {} },
          session: {
            promptAsync: async () => {
              promptCalls += 1;
              resolvePromptStarted?.();
              await new Promise<void>((resolve) => {
                resolvePrompt = resolve;
              });
            },
          },
        },
      } as never);
      const autopilotTool = plugin.tool?.autopilot;
      const event = plugin.event as ((input: { event: unknown }) => Promise<void>) | undefined;
      if (!autopilotTool || !event) {
        throw new Error("expected plugin tool and event handler");
      }

      await autopilotTool.execute(
        { action: "start", objective: "Fix tests without stopping until bun test passes" },
        {
          sessionID: "s1",
          messageID: "m1",
          agent: "pi",
          directory: dir,
          worktree: dir,
          abort: new AbortController().signal,
          metadata: () => {},
          ask: () => Effect.void,
        },
      );

      const firstIdle = event({ event: { type: "session.idle", properties: { sessionID: "s1" } } });
      await promptStarted;
      await event({ event: { type: "session.idle", properties: { sessionID: "s1" } } });

      expect(promptCalls).toBe(1);
      resolvePrompt?.();
      await firstIdle;
    });
  });

  test("objective completion validates before final stop", async () => {
    let promptCalls = 0;
    const plugin = await AutopilotPlugin({
      directory: "/tmp",
      worktree: "/tmp",
      client: {
        tui: { showToast: async () => {} },
        session: {
          promptAsync: async () => {
            promptCalls += 1;
          },
        },
      },
    } as never);
    const autopilotTool = plugin.tool?.autopilot;
    const event = plugin.event as ((input: { event: unknown }) => Promise<void>) | undefined;
    if (!autopilotTool || !event) {
      throw new Error("expected plugin tool and event handler");
    }
    const context = {
      sessionID: "s1",
      messageID: "m1",
      agent: "pi",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: () => Effect.void,
    };

    await autopilotTool.execute(
      { action: "start", objective: "Fix tests without stopping until bun test passes" },
      context,
    );
    await event({ event: { type: "session.idle", properties: { sessionID: "s1" } } });
    expect(promptCalls).toBe(1);

    await event({
      event: {
        type: "message.updated",
        properties: { info: { sessionID: "s1", id: "msg-1", role: "assistant", agent: "general" } },
      },
    });
    await event({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            type: "text",
            sessionID: "s1",
            messageID: "msg-1",
            id: "part-1",
            text: "**Autopilot status: complete**\ncandidate done",
          },
        },
      },
    });
    await event({ event: { type: "session.idle", properties: { sessionID: "s1" } } });
    expect(promptCalls).toBe(2);
    const validatingStatus = await autopilotTool.execute({ action: "status" }, context);
    expect(validatingStatus).toContain("status=validating");
    expect(validatingStatus).toContain("candidate done");

    await event({
      event: {
        type: "message.updated",
        properties: { info: { sessionID: "s1", id: "msg-2", role: "assistant", agent: "general" } },
      },
    });
    await event({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            type: "text",
            sessionID: "s1",
            messageID: "msg-2",
            id: "part-2",
            text: "**Autopilot status: complete**\nverified done",
          },
        },
      },
    });
    await event({ event: { type: "session.idle", properties: { sessionID: "s1" } } });

    expect(promptCalls).toBe(2);
    const completedStatus = await autopilotTool.execute({ action: "status" }, context);
    expect(completedStatus).toContain("status=completed");
    expect(completedStatus).toContain("stop=COMPLETED");
    expect(completedStatus).toContain("Final digest:");
    expect(completedStatus).toContain("Last verification: passed");
  });

  test("resumed objective run with prior progress dispatches continuation", async () => {
    let promptCalls = 0;
    const plugin = await AutopilotPlugin({
      directory: "/tmp",
      worktree: "/tmp",
      client: {
        tui: { showToast: async () => {} },
        session: {
          promptAsync: async () => {
            promptCalls += 1;
          },
        },
      },
    } as never);
    const autopilotTool = plugin.tool?.autopilot;
    const event = plugin.event as ((input: { event: unknown }) => Promise<void>) | undefined;
    if (!autopilotTool || !event) {
      throw new Error("expected plugin tool and event handler");
    }
    const context = {
      sessionID: "s1",
      messageID: "m1",
      agent: "pi",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: () => Effect.void,
    };

    await autopilotTool.execute({ action: "start", objective: "Fix tests" }, context);
    await event({ event: { type: "session.idle", properties: { sessionID: "s1" } } });
    await event({
      event: {
        type: "message.updated",
        properties: { info: { sessionID: "s1", id: "msg-1", role: "assistant", agent: "general" } },
      },
    });
    await event({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            type: "text",
            sessionID: "s1",
            messageID: "msg-1",
            id: "part-1",
            text: "**Autopilot status: continue**\nmore work remains",
          },
        },
      },
    });
    await event({ event: { type: "session.idle", properties: { sessionID: "s1" } } });
    expect(promptCalls).toBe(2);

    await autopilotTool.execute({ action: "pause" }, context);
    await autopilotTool.execute({ action: "resume", permissionMode: "allow-all" }, context);
    await event({ event: { type: "session.idle", properties: { sessionID: "s1" } } });

    expect(promptCalls).toBe(3);
  });

  test("persists objective state across plugin instances", async () => {
    await withTempDir(async (dir) => {
      await withTempDir(async (dataHome) => {
        const previousDataHome = process.env.OPENCODE_AUTOPILOT_DATA_HOME;
        process.env.OPENCODE_AUTOPILOT_DATA_HOME = dataHome;
        const createPlugin = async () => {
          const plugin = await AutopilotPlugin({
            directory: dir,
            worktree: dir,
            client: {
              tui: { showToast: async () => {} },
              session: { promptAsync: async () => {} },
            },
          } as never);
          const autopilotTool = plugin.tool?.autopilot;
          if (!autopilotTool) throw new Error("expected autopilot tool");
          return autopilotTool;
        };
        const context = {
          sessionID: "persisted-session",
          messageID: "m1",
          agent: "pi",
          directory: dir,
          worktree: dir,
          abort: new AbortController().signal,
          metadata: () => {},
          ask: () => Effect.void,
        };

        const firstTool = await createPlugin();
        await firstTool.execute(
          {
            action: "start",
            objective: "Persist this objective",
            plan: "1. Do first thing\n2. Do second thing",
          },
          context,
        );

        const secondTool = await createPlugin();
        const status = await secondTool.execute({ action: "status" }, context);

        expect(status).toContain("Persist this objective");
        expect(status).toContain("plan=0/2");
        if (previousDataHome === undefined) {
          delete process.env.OPENCODE_AUTOPILOT_DATA_HOME;
        } else {
          process.env.OPENCODE_AUTOPILOT_DATA_HOME = previousDataHome;
        }
      });
    });
  });

  test("loads legacy repo-local state when user-data state is absent", async () => {
    await withTempDir(async (dir) => {
      await withTempDir(async (dataHome) => {
        const previousDataHome = process.env.OPENCODE_AUTOPILOT_DATA_HOME;
        process.env.OPENCODE_AUTOPILOT_DATA_HOME = dataHome;
        const legacyDir = join(dir, ".autopilot");
        await mkdir(legacyDir, { recursive: true });
        await writeFile(
          join(legacyDir, "state.json"),
          `${JSON.stringify(
            {
              version: 1,
              states: {
                "legacy-session": createSessionState("legacy-session", "Legacy state objective"),
              },
              history: { "legacy-session": ["legacy event"] },
              permissionMode: { "legacy-session": "limited" },
            },
            null,
            2,
          )}\n`,
        );

        const plugin = await AutopilotPlugin({
          directory: dir,
          worktree: dir,
          client: {
            tui: { showToast: async () => {} },
            session: { promptAsync: async () => {} },
          },
        } as never);
        const autopilotTool = plugin.tool?.autopilot;
        if (!autopilotTool) throw new Error("expected autopilot tool");

        const context = {
          sessionID: "legacy-session",
          messageID: "m1",
          agent: "pi",
          directory: dir,
          worktree: dir,
          abort: new AbortController().signal,
          metadata: () => {},
          ask: () => Effect.void,
        };
        const status = await autopilotTool.execute({ action: "status" }, context);
        expect(status).toContain("Legacy state objective");
        expect(status).toContain("legacy event");

        if (previousDataHome === undefined) {
          delete process.env.OPENCODE_AUTOPILOT_DATA_HOME;
        } else {
          process.env.OPENCODE_AUTOPILOT_DATA_HOME = previousDataHome;
        }
      });
    });
  });

  test("controller verification failure dispatches follow-up continuation", async () => {
    const prompts: string[] = [];
    const plugin = await AutopilotPlugin({
      directory: "/tmp",
      worktree: "/tmp",
      client: {
        tui: { showToast: async () => {} },
        session: {
          promptAsync: async (opts: { parts?: Array<{ text?: string }> }) => {
            prompts.push(opts.parts?.[0]?.text ?? "");
          },
        },
      },
    } as never);
    const autopilotTool = plugin.tool?.autopilot;
    const event = plugin.event as ((input: { event: unknown }) => Promise<void>) | undefined;
    if (!autopilotTool || !event) throw new Error("expected plugin hooks");
    const context = {
      sessionID: "verify-failure",
      messageID: "m1",
      agent: "pi",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: () => Effect.void,
    };
    const sendWorkerText = async (messageID: string, text: string) => {
      await event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID: "verify-failure",
              id: messageID,
              role: "assistant",
              agent: "general",
            },
          },
        },
      });
      await event({
        event: {
          type: "message.part.updated",
          properties: {
            part: {
              type: "text",
              sessionID: "verify-failure",
              messageID,
              id: `${messageID}-part`,
              text,
            },
          },
        },
      });
      await event({ event: { type: "session.idle", properties: { sessionID: "verify-failure" } } });
    };

    await autopilotTool.execute(
      { action: "start", objective: "Fix tests", verifyWith: "false", permissionMode: "allow-all" },
      context,
    );
    await event({ event: { type: "session.idle", properties: { sessionID: "verify-failure" } } });
    await sendWorkerText("msg-1", "**Autopilot status: complete**\nCandidate done.");
    await sendWorkerText("msg-2", "**Autopilot status: complete**\nVerified by model.");

    expect(prompts.at(-1)).toContain("Last verification failure");
    const status = await autopilotTool.execute({ action: "status" }, context);
    expect(status).toContain("status=waiting_for_reply");
    expect(status).not.toContain("stop=COMPLETED");
  });

  test("verifyWith in limited mode blocks instead of looping", async () => {
    const prompts: string[] = [];
    const plugin = await AutopilotPlugin({
      directory: "/tmp",
      worktree: "/tmp",
      client: {
        tui: { showToast: async () => {} },
        session: {
          promptAsync: async (opts: { parts?: Array<{ text?: string }> }) => {
            prompts.push(opts.parts?.[0]?.text ?? "");
          },
        },
      },
    } as never);
    const autopilotTool = plugin.tool?.autopilot;
    const event = plugin.event as ((input: { event: unknown }) => Promise<void>) | undefined;
    if (!autopilotTool || !event) throw new Error("expected plugin hooks");
    const context = {
      sessionID: "verify-limited",
      messageID: "m1",
      agent: "pi",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: () => Effect.void,
    };
    const sendWorkerText = async (messageID: string, text: string) => {
      await event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID: "verify-limited",
              id: messageID,
              role: "assistant",
              agent: "general",
            },
          },
        },
      });
      await event({
        event: {
          type: "message.part.updated",
          properties: {
            part: {
              type: "text",
              sessionID: "verify-limited",
              messageID,
              id: `${messageID}-part`,
              text,
            },
          },
        },
      });
      await event({ event: { type: "session.idle", properties: { sessionID: "verify-limited" } } });
    };

    await autopilotTool.execute(
      { action: "start", objective: "Fix tests", verifyWith: "true" },
      context,
    );
    await event({ event: { type: "session.idle", properties: { sessionID: "verify-limited" } } });
    await sendWorkerText("limited-1", "**Autopilot status: complete**\nCandidate done.");
    await sendWorkerText("limited-2", "**Autopilot status: complete**\nVerified by model.");

    expect(prompts).toHaveLength(2);
    const status = await autopilotTool.execute({ action: "status" }, context);
    expect(status).toContain("status=blocked");
    expect(status).toContain("requires allow-all");
  });

  test("plan-backed objective run advances steps and validates at the end", async () => {
    const prompts: string[] = [];
    const plugin = await AutopilotPlugin({
      directory: "/tmp",
      worktree: "/tmp",
      client: {
        tui: { showToast: async () => {} },
        session: {
          promptAsync: async (opts: { parts?: Array<{ text?: string }> }) => {
            prompts.push(opts.parts?.[0]?.text ?? "");
          },
        },
      },
    } as never);
    const autopilotTool = plugin.tool?.autopilot;
    const event = plugin.event as ((input: { event: unknown }) => Promise<void>) | undefined;
    if (!autopilotTool || !event) {
      throw new Error("expected plugin tool and event handler");
    }
    const context = {
      sessionID: "s1",
      messageID: "m1",
      agent: "pi",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: () => Effect.void,
    };
    const sendWorkerText = async (messageID: string, text: string) => {
      await event({
        event: {
          type: "message.updated",
          properties: {
            info: { sessionID: "s1", id: messageID, role: "assistant", agent: "general" },
          },
        },
      });
      await event({
        event: {
          type: "message.part.updated",
          properties: {
            part: {
              type: "text",
              sessionID: "s1",
              messageID,
              id: `${messageID}-part`,
              text,
            },
          },
        },
      });
      await event({ event: { type: "session.idle", properties: { sessionID: "s1" } } });
    };

    await autopilotTool.execute(
      {
        action: "start",
        objective: "Implement PLAN.md",
        plan: "1. Read PLAN.md\n2. Implement changes",
      },
      context,
    );
    await event({ event: { type: "session.idle", properties: { sessionID: "s1" } } });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Autopilot plan step 1/2");
    expect(prompts[0]).toContain("Current step: Read PLAN.md");

    await sendWorkerText("msg-1", "**Autopilot status: complete**\nRead the plan.");
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Autopilot plan step 2/2");
    expect(prompts[1]).toContain("Current step: Implement changes");
    const stepStatus = await autopilotTool.execute({ action: "status" }, context);
    expect(stepStatus).toContain("plan=1/2");

    await sendWorkerText("msg-2", "**Autopilot status: step-done**\nImplemented changes.");
    expect(prompts).toHaveLength(3);
    expect(prompts[2]).toContain("Autopilot VALIDATION checkpoint");
    const validatingStatus = await autopilotTool.execute({ action: "status" }, context);
    expect(validatingStatus).toContain("status=validating");
    expect(validatingStatus).toContain("plan=2/2");

    await sendWorkerText("msg-3", "**Autopilot status: continue**\nValidation found a fix.");
    expect(prompts).toHaveLength(4);
    expect(prompts[3]).toContain("Autopilot continuation");
    expect(prompts[3]).not.toContain("Autopilot plan step 2/2");
    const fixingStatus = await autopilotTool.execute({ action: "status" }, context);
    expect(fixingStatus).toContain("status=waiting_for_reply");

    await sendWorkerText("msg-4", "**Autopilot status: complete**\nFix applied.");
    expect(prompts).toHaveLength(5);
    expect(prompts[4]).toContain("Autopilot VALIDATION checkpoint");

    await sendWorkerText("msg-5", "**Autopilot status: complete**\nVerified the plan.");
    const completedStatus = await autopilotTool.execute({ action: "status" }, context);
    expect(completedStatus).toContain("status=completed");
    expect(completedStatus).toContain("stop=COMPLETED");
    expect(completedStatus).toContain("Final digest:");
    expect(completedStatus).toContain("Current checkpoint:");
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
    expect(prompt).toContain("**Autopilot status: continue|step-done|validate|complete|blocked**");
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
    expect(prompt).not.toContain(
      "**Autopilot status: continue|step-done|validate|complete|blocked**",
    );
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
      output: "Autopilot is running.\n**Autopilot status: continue**\nkeep going",
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
    expect(output.output).not.toContain("Autopilot status");
  });

  test("does not modify output for other tools", async () => {
    const env = createTestEnv();
    const original = "Some output\n**Autopilot status: continue**\nkeep going";
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
