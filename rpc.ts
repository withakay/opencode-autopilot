import { Rpc } from "@opencode-ai/plugin/rpc";

export const AutopilotRpc = Rpc.define({
  id: "autopilot",
  methods: {
    status: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { text: { type: "string" }, active: { type: "boolean" } },
        required: ["text", "active"],
        additionalProperties: false,
      },
    },
  },
  events: {
    notice: {
      schema: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          title: { type: "string" },
          message: { type: "string" },
          variant: { enum: ["info", "success", "warning", "error"] },
        },
        required: ["sessionID", "title", "message", "variant"],
        additionalProperties: false,
      },
    },
    card: {
      schema: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          title: { type: "string" },
          text: { type: "string" },
        },
        required: ["sessionID", "title", "text"],
        additionalProperties: false,
      },
    },
  },
} as const);
