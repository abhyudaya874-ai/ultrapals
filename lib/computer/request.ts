import { z } from "zod";
import { ImagesIn } from "./images";

/** Largest request body /api/agent reads: 3 pictures at their cap plus text and a few selections. */
export const MAX_BODY_BYTES = 1_700_000;

/** The body of POST /api/agent. `model` is read leniently (parseChoice) so a stale client never breaks a send. */
export const AgentBody = z.object({
  sessionId: z.string().uuid().optional(),
  message: z.string().trim().min(2).max(2000),
  path: z.string().max(300).default("/"),
  attachments: z.array(z.object({ id: z.string().max(60), text: z.string().trim().min(1).max(4000), path: z.string().max(300) })).max(5).default([]),
  images: ImagesIn,
  model: z.unknown().optional(),
  /** Minutes east of UTC where the user is (for "daily 09:00" in an automation UltraPal creates). */
  tz: z.number().int().min(-840).max(840).optional(),
});
export type AgentBody = z.infer<typeof AgentBody>;
