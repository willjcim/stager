// photo classification and board matching via gemini-2.5-flash through ai gateway
// each function is a workflow step so it is durable and auto-retried
import { generateObject } from "ai";
import { z } from "zod";
import { CLASSIFY_MODEL, CLASSIFY_PROMPT, MATCH_PROMPT } from "@/lib/ai";

const classifySchema = z.object({
  theme: z.string().describe("short canonical room or scene label"),
  confidence: z.number().min(0).max(1).describe("model confidence 0-1"),
});

const matchSchema = z.object({
  boardId: z
    .string()
    .nullable()
    .describe("id of the best matching board or null if nothing remotely fits"),
  confidence: z.number().min(0).max(1).describe("match confidence 0-1"),
  reasoning: z.string().describe("one sentence reasoning"),
});

export type ClassifyResult = z.infer<typeof classifySchema>;
export type MatchResult = z.infer<typeof matchSchema>;

// vision call returning a coarse room type and confidence
export async function classifyPhotoStep(input: { photoUrl: string }): Promise<ClassifyResult> {
  "use step";
  const { object } = await generateObject({
    model: CLASSIFY_MODEL,
    schema: classifySchema,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: CLASSIFY_PROMPT },
          { type: "image", image: new URL(input.photoUrl) },
        ],
      },
    ],
    providerOptions: {
      gateway: { tags: ["feature:classify"] },
    },
  });
  return object;
}

// loose theme-to-board matcher
// confidence below 0.3 means use-all-boards fallback
export async function matchBoardStep(input: {
  theme: string;
  boards: Array<{ id: string; title: string; description?: string | null }>;
}): Promise<MatchResult> {
  "use step";
  if (input.boards.length === 0) return { boardId: null, confidence: 0, reasoning: "no boards" };
  if (input.boards.length === 1) {
    return { boardId: input.boards[0].id, confidence: 1, reasoning: "only one board available" };
  }
  const boardList = input.boards
    .map((b) => `- id=${b.id} title="${b.title}"${b.description ? ` desc="${b.description}"` : ""}`)
    .join("\n");
  const { object } = await generateObject({
    model: CLASSIFY_MODEL,
    schema: matchSchema,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${MATCH_PROMPT}\n\nRoom theme: "${input.theme}"\n\nBoards:\n${boardList}\n\nPick the single best matching board id, or null only if nothing is even tangentially related.`,
          },
        ],
      },
    ],
    providerOptions: {
      gateway: { tags: ["feature:match"] },
    },
  });
  // drop ids the model invented that arent in our list
  if (object.boardId && !input.boards.some((b) => b.id === object.boardId)) {
    return { boardId: null, confidence: 0, reasoning: "model returned unknown id" };
  }
  return object;
}
