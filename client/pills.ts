import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { shellsSummaryRpc } from "../shared/contracts.ts";
import type { AgentShellSummary } from "../shared/shell.ts";
import { pillLabel } from "./format.ts";

const PILL_ID = "background-shells";
const POLL_RUNNING_MS = 2000;
const POLL_IDLE_MS = 5000;

interface Pill {
  workspaceId: string;
  registration: PluginButtonRegistration;
  label: string;
  visible: boolean;
}

interface DirectoryAgent {
  id: string;
  provider: string;
  workspaceId?: string | null;
  archivedAt?: string | null;
}

/** One hidden pill per Claude agent, shown with a count once the agent has shells. */
export function contributePills(client: PluginClientContext, panelId: string): () => void {
  const pills = new Map<string, Pill>();
  const lifetime = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const remove = (agentId: string) => {
    pills.get(agentId)?.registration.remove();
    pills.delete(agentId);
  };

  const register = (agent: DirectoryAgent) => {
    if (stopped) return;
    if (agent.provider !== "claude" || !agent.workspaceId || agent.archivedAt) {
      remove(agent.id);
      return;
    }
    if (pills.get(agent.id)?.workspaceId === agent.workspaceId) return;
    remove(agent.id);
    const workspaceId = agent.workspaceId;
    const agentId = agent.id;
    const registration = client.addComposerPill({
      id: PILL_ID,
      workspaceId,
      agentId,
      button: {
        title: "Background shells",
        icon: "SquareTerminal",
        label: "Shells",
        visible: false,
        behavior: {
          kind: "action",
          onPress() {
            client.openPanel(panelId, { workspaceId, agentId });
          },
        },
      },
    });
    pills.set(agentId, { workspaceId, registration, label: "Shells", visible: false });
  };

  const apply = (summaries: readonly AgentShellSummary[]) => {
    const byAgent = new Map(summaries.map((summary) => [summary.agentId, summary]));
    for (const [agentId, pill] of pills) {
      const summary = byAgent.get(agentId);
      const visible = summary !== undefined && summary.total > 0;
      const label = summary ? pillLabel(summary) : pill.label;
      if (visible === pill.visible && label === pill.label) continue;
      pill.registration.update({ visible, label });
      pill.visible = visible;
      pill.label = label;
    }
  };

  const poll = async () => {
    let running = false;
    try {
      const { agents } = await client.rpc(shellsSummaryRpc, {});
      if (stopped) return;
      apply(agents);
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
