// Every Claude Code string the plugin depends on is matched here. Fixtures for each
// shape live in tests/fixtures and docs/plans/001-background-shells-v1.md.

import type { OutputFooter, ShellStatus } from "../shared/shell.ts";

export interface BackgroundStart {
  taskId: string;
  toolUseId: string;
  command: string;
  outputFile: string;
}

export interface TaskNotification {
  taskId: string;
  toolUseId: string | null;
  status: Exclude<ShellStatus, "running">;
  exitCode: number | null;
  description: string | null;
}

export interface TaskStop {
  taskId: string;
}

const BACKGROUND_START =
  /^Command running in background with ID: (\S+?)\. Output is being written to: (.+?\.output)(?:\.|\s|$)/;
const SUMMARY_DESCRIPTION = /^Background command "([\s\S]*)" (?:completed|failed|was stopped|was killed)\b/;
const EXIT_CODE = /exit code (-?\d+)/;
const FOOTER = /\n?\[(?:exited with code (-?\d+)|killed)\]\s*$/;

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: JsonObject, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toolCall(item: unknown): (JsonObject & { detail: JsonObject }) | null {
  if (!isRecord(item) || item.type !== "tool_call" || !isRecord(item.detail)) return null;
  return item as JsonObject & { detail: JsonObject };
}

/** A Bash call started with run_in_background, recognized by the tool result text. */
export function parseBackgroundStart(item: unknown): BackgroundStart | null {
  const call = toolCall(item);
  if (!call || call.detail.type !== "shell") return null;
  const output = stringField(call.detail, "output");
  const command = stringField(call.detail, "command");
  const toolUseId = stringField(call, "callId");
  if (!output || !command || !toolUseId) return null;
  const match = BACKGROUND_START.exec(output.trimStart());
  if (!match) return null;
  return { taskId: match[1], toolUseId, command, outputFile: match[2] };
}

function notificationStatus(raw: string | null, exitCode: number | null): TaskNotification["status"] {
  switch (raw?.toLowerCase()) {
    case "completed":
      return exitCode !== null && exitCode !== 0 ? "failed" : "completed";
    case "failed":
      return "failed";
    case "stopped":
    case "killed":
    case "canceled":
    case "cancelled":
      return "stopped";
    default:
      return "ended";
  }
}

/**
 * Paseo's synthetic task_notification tool call. Read metadata.status, not item.status:
 * Paseo reports stopped and killed tasks as completed.
 */
export function parseTaskNotification(item: unknown): TaskNotification | null {
  const call = toolCall(item);
  if (!call || call.name !== "task_notification" || !isRecord(call.metadata)) return null;
  const metadata = call.metadata;
  if (metadata.source !== "claude_task_notification") return null;
  const taskId = stringField(metadata, "taskId");
  if (!taskId) return null;
  const label = stringField(call.detail, "label");
  const exitMatch = label ? EXIT_CODE.exec(label) : null;
  const exitCode = exitMatch ? Number(exitMatch[1]) : null;
  const rawStatus = stringField(metadata, "status");
  const status = notificationStatus(rawStatus, exitCode);
  return {
    taskId,
    toolUseId: stringField(metadata, "toolUseId"),
    status,
    exitCode,
    description: notificationDescription(label, status),
  };
}

function notificationDescription(label: string | null, status: TaskNotification["status"]): string | null {
  if (!label) return null;
  const match = SUMMARY_DESCRIPTION.exec(label);
  if (match) return match[1];
  // Live TaskStop notifications carry only the Bash description as their label.
  if (status === "stopped" && !label.startsWith("Background ")) return label;
  return null;
}

/** A successful TaskStop (or older KillShell) call. History keeps no stop notification. */
export function parseTaskStop(item: unknown): TaskStop | null {
  const call = toolCall(item);
  if (!call || call.status !== "completed") return null;
  if (call.name !== "TaskStop" && call.name !== "KillShell" && call.name !== "KillBash") return null;
  const input = isRecord(call.detail.input) ? call.detail.input : {};
  const taskId = stringField(input, "task_id") ?? stringField(input, "shell_id");
  if (!taskId) return null;
  const output = call.detail.output;
  const result = isRecord(output) && isRecord(output.output) ? output.output : output;
  const message = isRecord(result) ? stringField(result, "message") : typeof result === "string" ? result : null;
  if (message !== null && !/^Successfully (?:stopped|killed)/i.test(message)) return null;
  return { taskId };
}

/** Claude Code appends "[exited with code N]" or "[killed]" when a background task ends. */
export function parseOutputFooter(text: string): OutputFooter | null {
  const match = FOOTER.exec(text);
  if (!match) return null;
  return match[1] === undefined ? { kind: "killed" } : { kind: "exited", exitCode: Number(match[1]) };
}
