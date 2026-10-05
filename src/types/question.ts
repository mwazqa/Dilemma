import { z } from "zod";

export const questionSchema = z.object({
  language: z.string().min(2),
  topic: z.string().min(1),
  question: z.string().min(1),
  options: z.array(z.string().min(1)).min(2).max(4),
  correctOption: z.number().int().min(0).max(3),
  explanation: z.string().min(1)
});

export type Question = z.infer<typeof questionSchema>;
