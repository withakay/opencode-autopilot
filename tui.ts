import { Plugin } from "@opencode-ai/plugin/tui";
import { AutopilotRpc } from "./rpc.ts";

type NoticeData = {
  title: string;
  message: string;
  variant: "info" | "success" | "warning" | "error";
};

type CardData = {
  title: string;
  text: string;
};

export default Plugin.define({
  id: "autopilot.tui",
  setup(context) {
    try {
      const rpc = context.client.rpc(AutopilotRpc);
      const offNotice = rpc.events.on("notice", (e) => {
        const data = e.data as NoticeData;
        context.ui.toast.show({
          title: data.title,
          message: data.message,
          variant: data.variant,
          duration: 3000,
        });
      });
      const offCard = rpc.events.on("card", (e) => {
        const data = e.data as CardData;
        void context.ui.dialog.alert({ title: data.title, message: data.text });
      });
      return () => {
        offNotice();
        offCard();
      };
    } catch {
      console.warn("Autopilot TUI companion could not connect to the server plugin.");
    }
  },
});
