// The AI models a hospital can be set to use for IntellAssist.
//
// Platform staff (BiomedIntel.ai) choose one per hospital; hospital
// administrators can see which one is in use but cannot change it, because the
// model decides the AI bill. A hospital with no choice uses the app default
// (the AI_MODEL setting). Model names are the Claude API model IDs.
export const AI_MODEL_CHOICES = [
  { id: "claude-haiku-5-5", label: "Haiku", note: "Fastest and cheapest. Good for simple faults." },
  { id: "claude-sonnet-5-5", label: "Sonnet", note: "Balanced. Recommended starting point." },
  { id: "claude-opus-5-5", label: "Opus", note: "Strongest reasoning. About 5 times the cost of Sonnet." },
] as const;

/** Same shape the database accepts (organizations_ai_model_format). */
export const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9.-]{2,80}$/;

export function isChoosableModel(id: unknown): id is (typeof AI_MODEL_CHOICES)[number]["id"] {
  return typeof id === "string" && AI_MODEL_CHOICES.some((m) => m.id === id);
}

/** A friendly name for a model ID, falling back to the ID itself. */
export function modelLabel(id: string | null | undefined): string {
  if (!id) return "—";
  const found = AI_MODEL_CHOICES.find((m) => m.id === id);
  return found ? `${found.label} (${found.id})` : id;
}
