import type { Plugin } from "@opencode-ai/plugin";
import { parseAutopilotCommand } from "./command/parse.ts";
import { loadAutopilotConfig } from "./config/autopilot-config.ts";
import { runAction } from "./controller/actions.ts";
import { createCore, type NoticeVariant } from "./controller/core.ts";
import {
  handleExecutionFailed,
  handleExecutionInterrupted,
  handleExecutionSucceeded,
  handleSessionDeleted,
} from "./controller/reply.ts";
import { createEventHandler } from "./hooks/event-handler.ts";
import { createPermissionHook } from "./hooks/permission.ts";
import { buildAutopilotContextText } from "./hooks/system-transform.ts";
import { stripAutopilotMarker } from "./prompts/index.ts";
import { AutopilotRpc } from "./rpc.ts";
import { StorageStateStore } from "./state/persistence.ts";
import {
  AUTOPILOT_TOOL_DESCRIPTION,
  AUTOPILOT_TOOL_NAME,
  autopilotToolInput,
  normalizeAutopilotToolInput,
} from "./tools/autopilot.ts";

type Registration = { readonly dispose: () => Promise<void> };

export async function createAutopilotPlugin(ctx: Plugin.Context): Promise<Plugin.Cleanup> {
  const directory = ctx.location.directory;
  const config = await loadAutopilotConfig(directory);
  const store = new StorageStateStore(ctx.storage);

  // -- RPC: status method + notice/card events -------------------------------
  // Feedback must never break the controller, so every emit is wrapped.
  let rpc: Awaited<ReturnType<typeof ctx.rpc.register<typeof AutopilotRpc>>> | undefined;
  const notice = (
    sessionID: string,
    title: string,
    message: string,
    variant: NoticeVariant,
  ): void => {
    try {
      void rpc?.events.emit("notice", { sessionID, title, message, variant }).catch(() => {});
    } catch {
      // Ignore feedback failures.
    }
  };
  const card = (sessionID: string, title: string, text: string): void => {
    try {
      void rpc?.events.emit("card", { sessionID, title, text }).catch(() => {});
    } catch {
      // Ignore feedback failures.
    }
  };

  const core = createCore({ config, directory, session: ctx.session, store, notice });
  await core.recover();

  try {
    rpc = await ctx.rpc.register(AutopilotRpc, {
      status: async (input) => {
        // JSON-schema method inputs are untyped at the boundary.
        const { sessionID } = input as { sessionID: string };
        return {
          text: core.statusText(sessionID),
          active: core.getState(sessionID)?.mode === "ENABLED",
        };
      },
    });
  } catch {
    // RPC is a feedback channel only; the controller works without it.
  }

  const registrations: Registration[] = [];

  // -- /autopilot command: parse and act (start dispatches immediately) ------
  registrations.push(
    await ctx.command.transform((editor) => {
      editor.add({
        name: AUTOPILOT_TOOL_NAME,
        description: AUTOPILOT_TOOL_DESCRIPTION,
        execute: async ({ sessionID, prompt }) => {
          const args = parseAutopilotCommand(prompt.text);
          const result = await runAction(core, sessionID, args);
          if (args.action === "status" || args.action === "help") {
            card(sessionID, "Autopilot", result);
          }
        },
      });
    }),
  );

  // -- autopilot tool (same runAction) ---------------------------------------
  registrations.push(
    await ctx.tool.transform((editor) => {
      editor.add({
        name: AUTOPILOT_TOOL_NAME,
        description: AUTOPILOT_TOOL_DESCRIPTION,
        input: autopilotToolInput,
        execute: async (input, context) => {
          const args = normalizeAutopilotToolInput(input);
          const result = await runAction(core, context.sessionID, args);
          // Strip autopilot status markers inline so the model does not echo them.
          return { content: stripAutopilotMarker(result) };
        },
      });
    }),
  );

  // -- context hook: inject guidance while enabled ---------------------------
  registrations.push(
    await ctx.session.hook("context", (event) => {
      const state = core.getState(event.sessionID);
      if (!state) return;
      const text = buildAutopilotContextText({
        state,
        history: core.getHistory(event.sessionID),
        config,
      });
      if (text) event.system.push({ type: "text", text });
    }),
  );

  // -- permission hook -------------------------------------------------------
  const permissionHook = createPermissionHook({
    getState: core.getState,
    getPermissionMode: core.getPermissionMode,
    onPermissionDenied: (sessionID, permission) => {
      const tracking = core.getTracking(sessionID);
      if (!tracking) return;
      tracking.blockedByPermission = true;
      tracking.permissionBlockMessage =
        `Denied ${permission.action} ${permission.resources.join(", ")}`.trim();
      core.recordHistory(sessionID, tracking.permissionBlockMessage);
    },
  });
  registrations.push(await ctx.permission.hook("evaluate", permissionHook));

  // -- event loop ------------------------------------------------------------
  const handleEvent = createEventHandler({
    onExecutionSucceeded: (sessionID, created) =>
      handleExecutionSucceeded(core, sessionID, created),
    onExecutionFailed: (sessionID, message) => handleExecutionFailed(core, sessionID, message),
    onExecutionInterrupted: (sessionID, reason) =>
      handleExecutionInterrupted(core, sessionID, reason),
    onSessionDeleted: (sessionID) => handleSessionDeleted(core, sessionID),
  });

  const abort = new AbortController();
  const loop = (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: abort.signal })) {
        try {
          await handleEvent(event);
        } catch {
          // One bad event must not kill the loop.
        }
      }
    } catch {
      // Subscription ended (abort/shutdown).
    }
  })();

  return async () => {
    abort.abort();
    await loop.catch(() => {});
    for (const registration of registrations) {
      await registration.dispose().catch(() => {});
    }
    await rpc?.dispose().catch(() => {});
  };
}
