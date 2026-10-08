import type { PluginServerContext } from "@getpaseo/plugin/server";
import { claudeTasksRoot, isOutputMissing, readOutputTail } from "./server/output-tail.ts";
import { ShellTracker } from "./server/tracker.ts";
import { DEFAULT_TAIL_BYTES, shellsListRpc, shellsSummaryRpc, shellsTailRpc } from "./shared/contracts.ts";

const FOOTER_BYTES = 128;

export default function contribute(server: PluginServerContext) {
  // /tmp/claude-<uid> appears when Claude Code first runs after a reboot, which can be
  // after the plugin loads, so keep resolving until it exists.
  let root: string | null = null;
  const tasksRoot = async () => (root ??= await claudeTasksRoot());
  const tracker = new ShellTracker({
    async readFooter(outputFile) {
      const tail = await readOutputTail(outputFile, FOOTER_BYTES, await tasksRoot());
      if (tail.footer) return { footer: tail.footer, at: tail.modifiedAt };
      return !tail.available && (await isOutputMissing(outputFile)) ? "missing" : null;
    },
  });

  server.handle(shellsSummaryRpc, async (_input, { paseo }) => {
    await tracker.start(paseo);
    return { agents: await tracker.summary() };
  });

  server.handle(shellsListRpc, async ({ agentId }, { paseo }) => {
    await tracker.start(paseo);
    return tracker.list(agentId);
  });

  server.handle(shellsTailRpc, async ({ agentId, taskId, maxBytes }, { paseo }) => {
    await tracker.start(paseo);
    const outputFile = tracker.outputFile(agentId, taskId);
    if (!outputFile) return { available: false, text: "", truncated: false, size: 0, footer: null };
    const { modifiedAt: _modifiedAt, ...tail } = await readOutputTail(
      outputFile,
      maxBytes ?? DEFAULT_TAIL_BYTES,
      await tasksRoot(),
    );
    return tail;
  });

  // Start tracking without waiting for an app to call an RPC.
  server.on("agent.created", (_event, { paseo }) => void tracker.start(paseo));
  server.on("agent.turn_started", (_event, { paseo }) => void tracker.start(paseo));

  return () => tracker.stop();
}
