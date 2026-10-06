import { readFileSync } from "node:fs";

export interface LiveUpdate {
  timestamp: string;
  seq?: number;
  epoch?: string;
  event: { type: string; item?: Record<string, unknown> };
}

export interface HistoryEntry {
  timestamp: string;
  item: Record<string, unknown>;
}

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as T;
}

export const liveUpdates = readFixture<LiveUpdate[]>("live-updates.json");
export const historyEntries = readFixture<HistoryEntry[]>("history-entries.json");
// A foreground Bash call in another Paseo agent that hit its 90 s timeout.
export const timeoutEntries = readFixture<HistoryEntry[]>("timeout-backgrounded-entries.json");

export function liveItems(): { item: Record<string, unknown>; timestamp: string }[] {
  return liveUpdates.flatMap((update) =>
    update.event.type === "timeline" && update.event.item
      ? [{ item: update.event.item, timestamp: update.timestamp }]
      : [],
  );
}

/** The last live version of one tool call, matched by a predicate over the item. */
export function lastLive(predicate: (item: Record<string, unknown>) => boolean) {
  const matches = liveItems().filter(({ item }) => predicate(item));
  const last = matches.at(-1);
  if (!last) throw new Error("No live fixture matched");
  return last.item;
}

export function metadataTaskId(item: Record<string, unknown>): unknown {
  const metadata = item.metadata as Record<string, unknown> | undefined;
  return metadata?.taskId;
}
