import { z } from "zod";

// "ended" means the shell stopped with the agent session, or its output file was deleted,
// and left no exit status.
export const shellStatusSchema = z.enum(["running", "completed", "failed", "stopped", "ended"]);

export type ShellStatus = z.infer<typeof shellStatusSchema>;

export const shellTaskSchema = z.object({
  taskId: z.string(),
  toolUseId: z.string(),
  command: z.string(),
  description: z.string().nullable(),
  status: shellStatusSchema,
  exitCode: z.number().int().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
});

export type ShellTask = z.infer<typeof shellTaskSchema>;

export const agentShellSummarySchema = z.object({
  agentId: z.string(),
  running: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export type AgentShellSummary = z.infer<typeof agentShellSummarySchema>;

export const outputFooterSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("exited"), exitCode: z.number().int() }),
  z.object({ kind: z.literal("killed") }),
]);

export type OutputFooter = z.infer<typeof outputFooterSchema>;
