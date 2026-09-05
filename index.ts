import { Plugin } from "@opencode-ai/plugin";
import { createAutopilotPlugin } from "./plugin.ts";

export { createAutopilotPlugin } from "./plugin.ts";

export default Plugin.define({
  id: "autopilot",
  setup: createAutopilotPlugin,
});
