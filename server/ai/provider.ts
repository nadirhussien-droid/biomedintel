// The one place BiomedIntel.ai talks to an AI provider (Stage 2: "behind one
// small ai module so the provider can be swapped").
//
//   AI_PROVIDER = "anthropic"  → Claude Messages API (server-side key only)
//   AI_PROVIDER = "mock"       → deterministic fake for development and tests;
//                                always labelled "Mock AI" in the interface
//   AI_PROVIDER unset / ""     → AI is off; manual troubleshooting still works
//
// The API key is read from the environment on the server and is never logged,
// returned, or sent to the browser. Provider errors are reduced to a short
// code (for example "provider_http_429") before they leave this module.
import "server-only";

export type AiCompletion = {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  stopReason: string | null;
};
export type AiCallInput = { system: string; user: string; maxTokens: number; signal: AbortSignal };
export type AiProvider = {
  name: string;
  model: string;
  /** True only for the mock provider: the interface labels its output as test output. */
  isMock: boolean;
  complete(input: AiCallInput): Promise<AiCompletion>;
};

/** A provider failure with a code that is safe to store and show. */
export class AiProviderError extends Error {
  constructor(
    public readonly code: string,
    public readonly timeout = false,
  ) {
    super(code);
  }
}

export type AiConfig = { provider: string | null; model: string | null; configured: boolean; problem: string | null };

const num = (v: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : fallback;
};

/** Limits, from the environment, with safe defaults. */
export function aiLimits() {
  return {
    timeoutMs: num(process.env.AI_TIMEOUT_MS, 60_000, 5_000, 300_000),
    maxOutputTokens: num(process.env.AI_MAX_OUTPUT_TOKENS, 2_000, 256, 8_000),
    userPerHour: num(process.env.AI_USER_HOURLY_LIMIT, 20, 0, 10_000),
    orgPerDay: num(process.env.AI_ORG_DAILY_LIMIT, 200, 0, 100_000),
    orgTokensPerMonth: num(process.env.AI_ORG_MONTHLY_TOKEN_LIMIT, 2_000_000, 0, 1_000_000_000),
  };
}

/** What is configured (never the key itself). */
export function aiConfig(): AiConfig {
  const provider = (process.env.AI_PROVIDER ?? "").trim().toLowerCase() || null;
  if (!provider)
    return {
      provider: null,
      model: null,
      configured: false,
      problem: "No AI provider is configured (AI_PROVIDER is empty).",
    };
  if (provider === "mock") return { provider, model: "mock-deterministic-1", configured: true, problem: null };
  if (provider === "anthropic") {
    const model = (process.env.AI_MODEL ?? "").trim();
    if (!(process.env.ANTHROPIC_API_KEY ?? "").trim())
      return { provider, model: model || null, configured: false, problem: "ANTHROPIC_API_KEY is not set." };
    if (!/^[a-z0-9][a-z0-9.\-]{2,80}$/.test(model))
      return { provider, model: null, configured: false, problem: "AI_MODEL is not set to a valid model name." };
    return { provider, model, configured: true, problem: null };
  }
  return { provider, model: null, configured: false, problem: `Unknown AI_PROVIDER "${provider.slice(0, 20)}".` };
}

// ─── Anthropic (Claude Messages API) ─────────────────────────────────────────

function anthropicProvider(model: string): AiProvider {
  const base = (process.env.AI_BASE_URL ?? "https://api.anthropic.com").replace(/\/+$/, "");
  return {
    name: "anthropic",
    model,
    isMock: false,
    async complete({ system, user, maxTokens, signal }) {
      let res: Response;
      try {
        res = await fetch(`${base}/v1/messages`, {
          method: "POST",
          signal,
          headers: {
            "content-type": "application/json",
            "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            system,
            messages: [{ role: "user", content: user }],
          }),
        });
      } catch (error) {
        if ((error as Error)?.name === "AbortError" || signal.aborted) throw new AiProviderError("timeout", true);
        throw new AiProviderError("provider_unreachable");
      }
      if (!res.ok) {
        // The body may echo request details; it is not logged or stored.
        await res.body?.cancel().catch(() => undefined);
        throw new AiProviderError(`provider_http_${res.status}`);
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new AiProviderError("provider_bad_json");
      }
      const b = body as {
        content?: { type?: string; text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
        stop_reason?: string;
      };
      const text = (b.content ?? [])
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text)
        .join("\n");
      return {
        text,
        inputTokens: typeof b.usage?.input_tokens === "number" ? b.usage.input_tokens : null,
        outputTokens: typeof b.usage?.output_tokens === "number" ? b.usage.output_tokens : null,
        stopReason: typeof b.stop_reason === "string" ? b.stop_reason : null,
      };
    },
  };
}

// ─── Mock (development and tests only) ───────────────────────────────────────

/**
 * Deterministic stand-in. It reads the passages in the prompt and turns the
 * first ones into "causes" that cite them, plus one deliberately uncited
 * cause, so the evidence labels and checks can be exercised end to end.
 * It knows nothing about equipment and must never be used for real work.
 */
export const mockProvider: AiProvider = {
  name: "mock",
  model: "mock-deterministic-1",
  isMock: true,
  async complete({ user }) {
    const passages = [...user.matchAll(/<passage id="(S\d+)"[^>]*>\n([\s\S]*?)\n<\/passage>/g)].slice(0, 3);
    const causes = passages.map(([, id, text], i) => {
      const sentence = text
        .replace(/\s+/g, " ")
        .trim()
        .split(/(?<=[.!?])\s/)[0]
        .slice(0, 200);
      return {
        cause: `Mock cause ${i + 1}: ${sentence}`,
        supporting_observations: ["Mock: matches the reported fault description"],
        citations: [id],
        next_steps: [`Mock: check the item described in passage ${id} following the cited procedure`],
        tools_or_qualifications: ["Mock: tools as listed in the cited source"],
        safety_notes: [],
        confirm_or_rule_out: [`Mock: the check in ${id} gives the documented result`],
      };
    });
    causes.push({
      cause: "Mock cause (no source): intermittent internal connection",
      supporting_observations: [],
      citations: [],
      next_steps: ["Mock: inspect internal connections"],
      tools_or_qualifications: ["Mock: should be dropped because it is uncited"],
      safety_notes: [],
      confirm_or_rule_out: [],
    });
    const answer = {
      missing_information: ["Mock: the firmware version is not recorded"],
      clarifying_questions: ["Mock: does the fault occur on mains power and on battery?"],
      causes,
    };
    return {
      text: JSON.stringify(answer),
      inputTokens: Math.ceil(user.length / 4),
      outputTokens: 200,
      stopReason: "end_turn",
    };
  },
};

let testOverride: AiProvider | null = null;
/** Tests only: replace the provider (for timeouts, bad output, injection). */
export function setAiProviderForTests(p: AiProvider | null) {
  if (process.env.NODE_ENV !== "test") throw new Error("Only available in tests");
  testOverride = p;
}

/** The configured provider, or null when AI is not configured. */
export function getAiProvider(): AiProvider | null {
  if (testOverride) return testOverride;
  const c = aiConfig();
  if (!c.configured) return null;
  if (c.provider === "mock") return mockProvider;
  if (c.provider === "anthropic" && c.model) return anthropicProvider(c.model);
  return null;
}
