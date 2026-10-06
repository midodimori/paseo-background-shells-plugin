import type { PluginClientContext } from "@getpaseo/plugin/client";
import { IdleShellsIcon } from "./client/idle-icon.tsx";
import { contributePills } from "./client/pills.ts";
import { ShellsPanel } from "./client/shells-panel.tsx";

const PANEL_ID = "background-shells";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: PANEL_ID,
    title: "Background shells",
    icon: "SquareTerminal",
    context: "agent",
    Component: ShellsPanel,
  });
  client.addCommandCenterItem({
    id: "open-background-shells",
    title: "Open background shells",
    icon: "SquareTerminal",
    context: "agent",
    onSelect({ openPanel }) {
      openPanel(PANEL_ID);
    },
  });
  return contributePills(client, { panelId: PANEL_ID, idleIcon: IdleShellsIcon });
}
