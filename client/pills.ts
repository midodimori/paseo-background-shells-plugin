import type { PluginButtonIcon, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { shellsSummaryRpc } from "../shared/contracts.ts";
import type { AgentShellSummary } from "../shared/shell.ts";
import { hasIdleRunningShells, pillLabel } from "./format.ts";

const PILL_ID = "background-shells";
const ICON = "SquareTerminal";
const TITLE = "Background shells";
const IDLE_TITLE = "Background shells still running while the agent is idle";
const POLL_RUNNING_MS = 2000;
const POLL_IDLE_MS = 5000;

export interface PillOptions {
  panelId: string;
  // Passed in so this module stays free of React Native and testable under Node.
  idleIcon: PluginButtonIcon;
}

interface Pill {
  workspaceId: string;
  registration: PluginButtonRegistration;
  agentStatus: string | null;
  label: string;
  visible: boolean;
  warning: boolean;
}

interface DirectoryAgent {
  id: string;
  provider: string;
  status?: string | null;
  workspaceId?: string | null;
  archivedAt?: string | null;
}

/**
 * One hidden pill per Claude agent, shown with a count once the agent has shells.
 * An idle agent with running shells gets a warning icon and label.
 */
export function contributePills(client: PluginClientContext, options: PillOptions): () => void {
  const pills = new Map<string, Pill>();
  let summaries = new Map<string, AgentShellSummary>();
  const lifetime = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const remove = (agentId: string) => {
    pills.get(agentId)?.registration.remove();
    pills.delete(agentId);
  };

  const render = (agentId: string) => {
    const pill = pills.get(agentId);
    if (!pill) return;
    const summary = summaries.get(agentId);
    const visible = summary !== undefined && summary.total > 0;
    const warning = summary !== undefined && hasIdleRunningShells(pill.agentStatus, summary.running);
    const label = summary ? pillLabel(summary, warning) : pill.label;
    if (visible === pill.visible && label === pill.label && warning === pill.warning) return;
    pill.registration.update({
      visible,
      label,
      icon: warning ? options.idleIcon : ICON,
      title: warning ? IDLE_TITLE : TITLE,
    });
    Object.assign(pill, { visible, label, warning });
  };

  const register = (agent: DirectoryAgent) => {
    if (stopped) return;
    if (agent.provider !== "claude" || !agent.workspaceId || agent.archivedAt) {
      remove(agent.id);
      return;
    }
    const existing = pills.get(agent.id);
    if (existing?.workspaceId === agent.workspaceId) {
      existing.agentStatus = agent.status ?? null;
      render(agent.id);
      return;
    }
    remove(agent.id);
    const workspaceId = agent.workspaceId;
    const agentId = agent.id;
    const registration = client.addComposerPill({
      id: PILL_ID,
      workspaceId,
      agentId,
      button: {
        title: TITLE,
        icon: ICON,
        label: "Shells",
        visible: false,
        behavior: {
          kind: "action",
          onPress() {
            client.openPanel(options.panelId, { workspaceId, agentId });
          },
        },
      },
    });
    pills.set(agentId, {
      workspaceId,
      registration,
      agentStatus: agent.status ?? null,
      label: "Shells",
      visible: false,
      warning: false,
    });
    render(agentId);
  };

  const poll = async () => {
    let running = false;
    try {
      const { agents } = await client.rpc(shellsSummaryRpc, {});
      if (stopped) return;
      summaries = new Map(agents.map((summary) => [summary.agentId, summary]));
      for (const agentId of pills.keys()) render(agentId);
      running = agents.some((summary) => summary.running > 0);
    } catch (error) {
      if (!stopped) console.warn("Background shells summary failed", error);
    }
    if (!stopped) timer = setTimeout(() => void poll(), running ? POLL_RUNNING_MS : POLL_IDLE_MS);
  };

  void client.paseo.agents
    .list({ filter: { includeArchived: false }, subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          const present = new Set(entries.map(({ agent }) => agent.id));
          for (const agentId of [...pills.keys()]) if (!present.has(agentId)) remove(agentId);
          for (const { agent } of entries) register(agent);
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "remove") remove(update.agentId);
          else register(update.agent);
        },
      });
      void poll();
    })
    .catch((error: unknown) => {
      if (!stopped) console.error("Background shells agent observation failed", error);
    });

  return () => {
    stopped = true;
    lifetime.abort();
    clearTimeout(timer);
    for (const pill of pills.values()) pill.registration.remove();
    pills.clear();
  };
}
