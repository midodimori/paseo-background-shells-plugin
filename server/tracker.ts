import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { AgentShellSummary, OutputFooter, ShellTask } from "../shared/shell.ts";
import { applyTimelineItem, createAgentShells, resolveShell, type AgentShells } from "./reduce.ts";

type PaseoApi = PluginHandlerContext["paseo"];
export type TrackerPaseo = { agents: Pick<PaseoApi["agents"], "list" | "ref"> };
type AgentSnapshot = Awaited<ReturnType<PaseoApi["agents"]["list"]>>["entries"][number]["agent"];
type TimelineSubscription = ReturnType<ReturnType<PaseoApi["agents"]["ref"]>["timeline"]["subscribe"]>;

export interface FooterReading {
  footer: OutputFooter;
  at: string | null;
}

export interface TrackerOptions {
  readFooter(outputFile: string): Promise<FooterReading | null>;
  /** How long list() waits for an agent's first history load. */
  loadTimeoutMs?: number;
}

interface TrackedAgent {
  id: string;
  sessionEnded: boolean;
  shells: AgentShells;
  subscription: TimelineSubscription | null;
  loaded: Promise<void>;
  isLoaded: boolean;
  // A footer never changes once written, so each file is read until it has one.
  footers: Map<string, FooterReading>;
}

const CLAUDE = "claude";

/**
 * Follows every non-archived Claude agent on the daemon and folds its timeline into
 * background-shell state. Starts on the first RPC or lifecycle hook, because the
 * server entry receives no Paseo client until then.
 */
export class ShellTracker {
  private paseo: TrackerPaseo | null = null;
  private ready: Promise<void> | null = null;
  private readonly agents = new Map<string, TrackedAgent>();
  private releaseDirectory: (() => Promise<void>) | null = null;
  private stopped = false;
  private readonly options: TrackerOptions;

  constructor(options: TrackerOptions) {
    this.options = options;
  }

  start(paseo: TrackerPaseo): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.ready) return this.ready;
    this.paseo = paseo;
    this.ready = this.observeDirectory(paseo).catch((error: unknown) => {
      console.error("Agent directory observation failed; retrying on the next call", error);
      this.ready = null;
      this.paseo = null;
    });
    return this.ready;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const releases = [...this.agents.values()].map((agent) => this.untrack(agent.id));
    if (this.releaseDirectory) releases.push(this.releaseDirectory());
    await Promise.allSettled(releases);
  }

  async summary(): Promise<AgentShellSummary[]> {
    const summaries: AgentShellSummary[] = [];
    for (const agent of this.agents.values()) {
      if (agent.shells.shells.size === 0) continue;
      const shells = await this.resolve(agent);
      summaries.push({
        agentId: agent.id,
        running: shells.filter((shell) => shell.status === "running").length,
        total: shells.length,
      });
    }
    return summaries;
  }

  async list(agentId: string): Promise<{ tracked: boolean; shells: ShellTask[] }> {
    await this.ready;
    const agent = this.agents.get(agentId);
    if (!agent) return { tracked: false, shells: [] };
    await withTimeout(agent.loaded, this.options.loadTimeoutMs ?? 5000);
    return { tracked: agent.isLoaded, shells: await this.resolve(agent) };
  }

  outputFile(agentId: string, taskId: string): string | null {
    return this.agents.get(agentId)?.shells.shells.get(taskId)?.outputFile ?? null;
  }

  private async resolve(agent: TrackedAgent): Promise<ShellTask[]> {
    const shells = [...agent.shells.shells.values()];
    const resolved = await Promise.all(
      shells.map(async (shell) => {
        const reading = shell.end ? null : await this.footer(agent, shell.outputFile);
        return resolveShell(shell, {
          footer: reading?.footer ?? null,
          footerAt: reading?.at ?? null,
          sessionEnded: agent.sessionEnded,
        });
      }),
    );
    return resolved.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  private async footer(agent: TrackedAgent, outputFile: string): Promise<FooterReading | null> {
    const cached = agent.footers.get(outputFile);
    if (cached) return cached;
    const reading = await this.options.readFooter(outputFile).catch(() => null);
    if (reading) agent.footers.set(outputFile, reading);
    return reading;
  }

  private async observeDirectory(paseo: TrackerPaseo): Promise<void> {
    const directory = await paseo.agents.list({
      filter: { includeArchived: false },
      page: { limit: 200 },
      subscribe: {},
    });
    this.releaseDirectory = () => directory.subscription.release();
    if (this.stopped) {
      await directory.subscription.release();
      return;
    }
    for (const { agent } of directory.entries) this.sync(agent);
    directory.subscription.subscribe({
      snapshot: ({ entries }) => {
        const present = new Set(entries.map(({ agent }) => agent.id));
        for (const id of this.agents.keys()) if (!present.has(id)) void this.untrack(id);
        for (const { agent } of entries) this.sync(agent);
      },
      update: (message) => {
        if (message.type !== "agent_update") return;
        const update = message.payload;
        if (update.kind === "remove") void this.untrack(update.agentId);
        else this.sync(update.agent);
      },
    });
  }

  private sync(agent: AgentSnapshot): void {
    if (this.stopped) return;
    if (agent.provider !== CLAUDE || agent.archivedAt) {
      void this.untrack(agent.id);
      return;
    }
    const existing = this.agents.get(agent.id);
    const sessionEnded = agent.status === "closed";
    if (existing) {
      existing.sessionEnded = sessionEnded;
      return;
    }
    this.track(agent.id, sessionEnded);
  }

  private track(agentId: string, sessionEnded: boolean): void {
    const paseo = this.paseo;
    if (!paseo) return;
    const handle = paseo.agents.ref(agentId);
    const agent: TrackedAgent = {
      id: agentId,
      sessionEnded,
      shells: createAgentShells(),
      subscription: null,
      loaded: Promise.resolve(),
      isLoaded: false,
      footers: new Map(),
    };
    this.agents.set(agentId, agent);

    const load = async () => {
      const page = await handle.timeline.refetch({ direction: "tail", limit: 0, projection: "projected" });
      // The reducer is idempotent, so history and live events can overlap freely.
      for (const entry of page.entries) applyTimelineItem(agent.shells, entry.item, entry.timestamp);
      if (page.agent) agent.sessionEnded = page.agent.status === "closed";
      agent.isLoaded = true;
    };
    const reload = () => {
      agent.loaded = load().catch((error: unknown) => {
        console.error(`Timeline load failed for agent ${agentId}`, error);
      });
    };

    agent.subscription = handle.timeline.subscribe((update) => {
      const { event } = update;
      if (event.type === "timeline" && "timestamp" in update) {
        applyTimelineItem(agent.shells, event.item, update.timestamp);
      } else if (event.type === "replacement" || event.type === "subscription_restored") {
        reload();
      } else if (event.type === "error") {
        // The observation is released; the agent's next directory update tracks it again.
        console.error(`Timeline observation stopped for agent ${agentId}: ${event.error}`);
        agent.subscription = null;
        this.agents.delete(agentId);
      }
    });
    reload();
  }

  private async untrack(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    this.agents.delete(agentId);
    await agent.subscription?.release();
  }
}

async function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([promise, new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)))]);
  clearTimeout(timer);
}
