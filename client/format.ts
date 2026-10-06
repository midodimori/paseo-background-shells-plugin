import type { AgentShellSummary, ShellStatus, ShellTask } from "../shared/shell.ts";

/**
 * An agent that is not mid-turn but still has a live session. Ask to stop sends
 * without interrupting in this state; closed sessions have no live shells.
 */
export function isAgentIdle(status: string | null | undefined): boolean {
  return status !== null && status !== undefined && status !== "running" && status !== "closed";
}

/** Running shells on an idle agent are easy to forget: they outlive the turn. */
export function hasIdleRunningShells(status: string | null | undefined, running: number): boolean {
  return running > 0 && isAgentIdle(status);
}

// Paseo caps a composer pill at 160 px (about 20 characters of label), so the idle
// label drops "Shells"; the warning icon and the pill's title carry the rest.
export function pillLabel(summary: Pick<AgentShellSummary, "running" | "total">, agentIdle = false): string {
  if (summary.running === 0) return `Shells · ${summary.total}`;
  return agentIdle ? `${summary.running} running · idle` : `Shells · ${summary.running} running`;
}

export function statusLabel(status: ShellStatus): string {
  switch (status) {
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
    case "ended":
      return "Ended (unknown)";
  }
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Elapsed time for a running shell, or its total run time once it ended. Null when unknown. */
export function shellElapsed(shell: Pick<ShellTask, "startedAt" | "endedAt" | "status">, now: number): string | null {
  const start = Date.parse(shell.startedAt);
  if (Number.isNaN(start)) return null;
  if (shell.status === "running") return formatElapsed(now - start);
  const end = shell.endedAt ? Date.parse(shell.endedAt) : Number.NaN;
  return Number.isNaN(end) ? null : formatElapsed(end - start);
}

export function shellDetail(shell: ShellTask, now: number): string {
  const parts = [statusLabel(shell.status)];
  const elapsed = shellElapsed(shell, now);
  if (elapsed) parts.push(elapsed);
  if (shell.exitCode !== null) parts.push(`exit ${shell.exitCode}`);
  parts.push(shell.taskId);
  return parts.join(" · ");
}

/** The prompt "Ask to stop" sends. A plugin cannot kill the shell; the agent's TaskStop can. */
export function stopPrompt(shell: Pick<ShellTask, "taskId" | "description" | "command">): string {
  const label = shell.description ?? firstLine(shell.command);
  return `Use TaskStop to stop background task ${shell.taskId} (${label}). Reply briefly.`;
}

function firstLine(text: string, max = 80): string {
  const line = text.split("\n", 1)[0];
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
