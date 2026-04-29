// shared model ids and prompts routed through the vercel ai gateway
// every id is a one-line swap thanks to the gateway

// classifier and matcher (vision capable cheap structured output)
export const CLASSIFY_MODEL = "google/gemini-2.5-flash";

// staging models (flash for previews pro for hero)
export const STAGE_FLASH_MODEL = "google/gemini-3.1-flash-image-preview";
export const STAGE_PRO_MODEL = "google/gemini-3-pro-image";

// staging instruction sent alongside the photo and reference images
export const STAGING_PROMPT = `You are a virtual home stager.
The first attached image is a real-estate photo of a room. The remaining images are style references.
Re-stage the room in the aesthetic of the references.
Strict rules:
- preserve walls, windows, ceiling, doors, flooring layout, and the camera angle exactly
- only change movable items: furniture, rugs, artwork, decor, color palette, textiles
- match the materials, colors, and tone of the reference images
- if the room is empty, furnish it tastefully in the reference style
- output only the edited photograph, no text overlays`;

// classifier prompt - maps any zillow photo to a coarse room type
export const CLASSIFY_PROMPT = `Identify the type of room or scene in this real-estate photo.
Respond with a short canonical label like:
"kitchen", "bathroom", "primary bedroom", "guest bedroom", "living room", "dining room",
"home office", "exterior front", "exterior back", "backyard", "garage", "hallway",
"laundry room", "basement", "stairwell", "closet", "patio", "pool".
Pick the closest single label and rate your confidence 0-1.`;

// matcher prompt - loose matching biased toward finding any reasonable connection
export const MATCH_PROMPT = `You match a room theme to the most relevant Pinterest board by board title.
Be loose: prefer ANY reasonable thematic connection over no match.
Only return a low confidence (<0.3) when no board title is even tangentially related.
Examples of acceptable matches:
- room theme "kitchen" -> board "modern kitchens", "cooking nook", "kitchen-island ideas"
- room theme "primary bedroom" -> "bedrooms", "guest suite", "boho bed"
- room theme "exterior front" -> "curb appeal", "landscaping", "front porch"`;
