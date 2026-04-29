// staging step
// generates a re-staged version of a room photo using reference images via nano banana
import { generateText } from "ai";
import { STAGE_FLASH_MODEL, STAGE_PRO_MODEL, STAGING_PROMPT } from "@/lib/ai";

export type ModelTier = "flash" | "pro";

export type StageResult = {
  base64: string;
  mediaType: string;
};

// returns base64 and media type of the generated image or throws when none
export async function stagePhotoStep(input: {
  photoUrl: string;
  refImageUrls: string[];
  modelTier: ModelTier;
}): Promise<StageResult> {
  "use step";
  const refs = input.refImageUrls.slice(0, 6);
  const result = await generateText({
    model: input.modelTier === "pro" ? STAGE_PRO_MODEL : STAGE_FLASH_MODEL,
    providerOptions: {
      google: { responseModalities: ["TEXT", "IMAGE"] },
      gateway: { tags: [`tier:${input.modelTier}`, "feature:stage"] },
    },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: STAGING_PROMPT },
          { type: "image", image: new URL(input.photoUrl) },
          ...refs.map((u) => ({ type: "image" as const, image: new URL(u) })),
        ],
      },
    ],
  });
  const file = result.files.find((f) => f.mediaType?.startsWith("image/"));
  if (!file) throw new Error("model returned no image");
  return {
    base64: file.base64,
    mediaType: file.mediaType ?? "image/png",
  };
}
