import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { agentShellSummarySchema, outputFooterSchema, shellTaskSchema } from "./shell.ts";

export const DEFAULT_TAIL_BYTES = 16 * 1024;
export const MAX_TAIL_BYTES = 256 * 1024;

export const shellsSummaryRpc = defineRpc({
  name: "shells.summary",
  input: z.object({}),
  output: z.object({ agents: z.array(agentShellSummarySchema) }),
});

export const shellsListRpc = defineRpc({
  name: "shells.list",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({
    // False until the daemon has loaded this agent's timeline.
    tracked: z.boolean(),
    shells: z.array(shellTaskSchema),
  }),
});

export const shellsTailRpc = defineRpc({
  name: "shells.tail",
  input: z.object({
    agentId: z.string().min(1),
    taskId: z.string().min(1),
    maxBytes: z.number().int().positive().max(MAX_TAIL_BYTES).optional(),
  }),
  output: z.object({
    available: z.boolean(),
    text: z.string(),
    truncated: z.boolean(),
    size: z.number().int().nonnegative(),
    footer: outputFooterSchema.nullable(),
  }),
});
