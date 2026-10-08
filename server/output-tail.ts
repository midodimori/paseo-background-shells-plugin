import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import type { OutputFooter } from "../shared/shell.ts";
import { parseOutputFooter } from "./parse.ts";

export interface OutputTail {
  available: boolean;
  text: string;
  truncated: boolean;
  size: number;
  footer: OutputFooter | null;
  modifiedAt: string | null;
}

const UNAVAILABLE: OutputTail = {
  available: false,
  text: "",
  truncated: false,
  size: 0,
  footer: null,
  modifiedAt: null,
};

// Claude Code writes task output under /tmp/claude-<uid> (/private/tmp on macOS).
export async function claudeTasksRoot(): Promise<string | null> {
  if (typeof process.getuid !== "function") return null;
  try {
    return await realpath(path.join("/tmp", `claude-${process.getuid()}`));
  } catch {
    return null;
  }
}

/** Resolves symlinks and accepts only <root>/**\/tasks/<id>.output. */
export async function resolveOutputPath(file: string, root: string): Promise<string | null> {
  if (!path.isAbsolute(file)) return null;
  let resolved: string;
  try {
    resolved = await realpath(file);
  } catch {
    return null;
  }
  if (!resolved.startsWith(root + path.sep)) return null;
  if (path.extname(resolved) !== ".output") return null;
  if (path.basename(path.dirname(resolved)) !== "tasks") return null;
  return resolved;
}

/**
 * True when the output file is gone, as after a reboot or Claude Code's cleanup of an
 * old session. Its shell cannot still be writing to it.
 */
export async function isOutputMissing(file: string): Promise<boolean> {
  if (!path.isAbsolute(file)) return false;
  try {
    await lstat(file);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

/** Reads at most maxBytes from the end of a task output file. */
export async function readOutputTail(file: string, maxBytes: number, root: string | null): Promise<OutputTail> {
  if (!root) return UNAVAILABLE;
  const resolved = await resolveOutputPath(file, root);
  if (!resolved) return UNAVAILABLE;
  let handle;
  try {
    handle = await open(resolved, "r");
  } catch {
    return UNAVAILABLE;
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) return UNAVAILABLE;
    const length = Math.min(stats.size, maxBytes);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, stats.size - length);
    let text = buffer.subarray(0, bytesRead).toString("utf8");
    const truncated = stats.size > length;
    // Drop the partial first line (and any split UTF-8 sequence) of a truncated read.
    if (truncated) {
      const newline = text.indexOf("\n");
      text = newline === -1 ? text : text.slice(newline + 1);
    }
    return {
      available: true,
      text,
      truncated,
      size: stats.size,
      footer: parseOutputFooter(text),
      modifiedAt: stats.mtime.toISOString(),
    };
  } finally {
    await handle.close();
  }
}
