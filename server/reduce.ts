import type { OutputFooter, ShellStatus, ShellTask } from "../shared/shell.ts";
import { parseBackgroundStart, parseTaskNotification, parseTaskStop } from "./parse.ts";

interface ShellEnd {
  status: Exclude<ShellStatus, "running">;
  exitCode: number | null;
  at: string;
  source: "notification" | "task-stop";
}

export interface ShellRecord {
  taskId: string;
  toolUseId: string;
  command: string;
  description: string | null;
  outputFile: string;
  startedAt: string;
  end: ShellEnd | null;
}

export interface AgentShells {
  shells: Map<string, ShellRecord>;
  // Ends seen before their start, kept so item order never matters.
  pendingEnds: Map<string, { end: ShellEnd; description: string | null }>;
}

export function createAgentShells(): AgentShells {
  return { shells: new Map(), pendingEnds: new Map() };
}

function applyEnd(state: AgentShells, taskId: string, end: ShellEnd, description: string | null) {
  const shell = state.shells.get(taskId);
  if (!shell) {
    const pending = state.pendingEnds.get(taskId);
    if (!pending || outranks(end, pending.end)) state.pendingEnds.set(taskId, { end, description });
    return;
  }
  if (description) shell.description = description;
  if (!shell.end || outranks(end, shell.end)) shell.end = end;
}

// A notification beats a TaskStop. Between equals, the first one stands (history repeats them).
function outranks(next: ShellEnd, current: ShellEnd): boolean {
  return next.source === "notification" && current.source === "task-stop";
}

/** Folds one timeline item into the agent's shells. Safe to replay any item any number of times. */
export function applyTimelineItem(state: AgentShells, item: unknown, timestamp: string): void {
  const start = parseBackgroundStart(item);
  if (start) {
    const existing = state.shells.get(start.taskId);
    if (existing) return;
    const pending = state.pendingEnds.get(start.taskId);
    state.pendingEnds.delete(start.taskId);
    const { ranForegroundMs, ...shell } = start;
    state.shells.set(start.taskId, {
      ...shell,
      description: pending?.description ?? null,
      startedAt: shiftTimestamp(timestamp, -ranForegroundMs),
      end: pending?.end ?? null,
    });
    return;
  }
  const notification = parseTaskNotification(item);
  if (notification) {
    const { taskId, status, exitCode, description } = notification;
    applyEnd(state, taskId, { status, exitCode, at: timestamp, source: "notification" }, description);
    return;
  }
  const stop = parseTaskStop(item);
  if (stop) {
    applyEnd(state, stop.taskId, { status: "stopped", exitCode: null, at: timestamp, source: "task-stop" }, null);
  }
}

export interface ResolveContext {
  footer: OutputFooter | null;
  footerAt: string | null;
  // The output file is gone, so the shell's session was cleaned up or the machine rebooted.
  outputMissing: boolean;
  // The agent's session is gone, so a shell with no recorded end cannot still be running.
  sessionEnded: boolean;
}

export function resolveShell(shell: ShellRecord, context: ResolveContext): ShellTask {
  const base = {
    taskId: shell.taskId,
    toolUseId: shell.toolUseId,
    command: shell.command,
    description: shell.description,
    startedAt: shell.startedAt,
  };
  const footerExit = context.footer?.kind === "exited" ? context.footer.exitCode : null;
  if (shell.end) {
    return {
      ...base,
      status: shell.end.status,
      exitCode: shell.end.exitCode ?? footerExit,
      endedAt: shell.end.at,
    };
  }
  if (context.footer) {
    const status: ShellStatus =
      context.footer.kind === "killed" ? "stopped" : footerExit === 0 ? "completed" : "failed";
    return { ...base, status, exitCode: footerExit, endedAt: context.footerAt };
  }
  if (context.sessionEnded || context.outputMissing) return { ...base, status: "ended", exitCode: null, endedAt: null };
  return { ...base, status: "running", exitCode: null, endedAt: null };
}

function shiftTimestamp(timestamp: string, ms: number): string {
  const time = Date.parse(timestamp);
  return ms === 0 || Number.isNaN(time) ? timestamp : new Date(time + ms).toISOString();
}
