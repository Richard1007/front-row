import {
  buildRecommendationSelection,
  type RankedEvent,
  type RecommendationTier
} from "../core/index.js";
import type { BenchmarkFixture, RatioMetric } from "./benchmark.js";

export const LLM_EVALUATION_MODELS = [
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol",
  "gpt-6-astra"
] as const;

export type LlmEvaluationModel = (typeof LLM_EVALUATION_MODELS)[number];

export interface VerifiedDiscoveryCandidate {
  id: string;
  tier: "T2" | "T3";
  name: string;
  startAt: string;
  venue: {
    name: string;
    city?: string;
    region?: string;
  };
  performers: string[];
  genres: string[];
  languages: string[];
  distanceMiles?: number;
  estimatedTravelMinutes?: number;
  sourceProviders: string[];
}

export interface LlmCandidatePayload {
  evaluationId: string;
  policy: {
    maximumSelections: number;
    lockedExactEventIds: string[];
    factsAreImmutable: true;
  };
  preferenceProfile: {
    artists: Array<{ name: string; weight: string }>;
    genres: Array<{ name: string; weight: string }>;
    inferredGenres: Array<{ name: string; percentage: number; confidence: number }>;
    acceptedLanguages: string[] | "any";
    inferredLanguages: Array<{ language: string; percentage: number }>;
    originLabel: string;
    maxTravelMinutes: number;
  };
  candidateEvents: VerifiedDiscoveryCandidate[];
}

export interface PreparedLlmEvaluation {
  lockedExactEvents: RankedEvent[];
  candidatePayload: LlmCandidatePayload;
}

interface ResponsesUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: {
    cached_tokens?: number;
  };
}

interface ResponsesApiBody {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  usage?: ResponsesUsage;
  error?: {
    message?: string;
  };
}

export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ModelQuality {
  selectedRelevant: RatioMetric;
  finalPrecisionAtKProxy: RatioMetric;
}

export interface LlmModelEvaluationResult {
  model: LlmEvaluationModel;
  status: "not_run" | "completed" | "invalid_schema" | "api_error";
  latencyMs: number | null;
  usage: TokenUsage | null;
  estimatedCostUsd: number | null;
  schemaValid: boolean | null;
  selectedEventIds: string[];
  finalSelectionIds: string[];
  quality: ModelQuality | null;
  error?: string;
}

export interface LlmComparisonReport {
  schemaVersion: 1;
  mode: "dry-run" | "live";
  evaluationId: string;
  models: readonly LlmEvaluationModel[];
  pricing: {
    asOf: string;
    currency: "USD";
    unit: "per_million_tokens";
  };
  safeguards: {
    explicitLiveFlagRequired: true;
    apiKeyRequired: true;
    store: false;
    strictStructuredOutput: true;
    exactTiersLockedOutsideModel: true;
    candidateFactsImmutable: true;
  };
  lockedExactEventIds: string[];
  candidatePayload: LlmCandidatePayload;
  results: LlmModelEvaluationResult[];
}

export interface RunLlmComparisonOptions {
  live: boolean;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export interface ResponsesRequestBody {
  model: LlmEvaluationModel;
  store: false;
  reasoning: { effort: "low" };
  instructions: string;
  input: string;
  text: {
    format: {
      type: "json_schema";
      name: "front_row_discovery_selection";
      strict: true;
      schema: {
        type: "object";
        additionalProperties: false;
        properties: {
          selectedEventIds: {
            type: "array";
            items: { type: "string"; enum: string[] };
            maxItems: number;
          };
        };
        required: ["selectedEventIds"];
      };
    };
  };
  max_output_tokens: 800;
}

const RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const RATE_CARD_AS_OF = "2026-09-20";
const LONG_CONTEXT_THRESHOLD = 272_000;

// Official Standard rates published per 1M text tokens. Keep the date in every
// report because prices are operational inputs, not timeless model metadata.
const RATE_CARD: Record<
  LlmEvaluationModel,
  { input: number; cachedInput: number; output: number }
> = {
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, output: 12 },
  "gpt-5.6-sol": { input: 4, cachedInput: 0.4, output: 20 },
  "gpt-6-astra": { input: 10, cachedInput: 1, output: 50 }
};

const RERANK_INSTRUCTIONS = [
  "You rerank verified concert candidates for one user; you are not a search engine.",
  "Select only event IDs present in candidateEvents, up to maximumSelections.",
  "Never invent, correct, enrich, or restate event facts.",
  "T0/T1 events are locked outside the model and must not be returned.",
  "Treat preferences as soft signals and favor a small, high-confidence, diverse list.",
  "Return only the structured output required by the schema."
].join(" ");

function isDiscoveryTier(tier: RecommendationTier): tier is "T2" | "T3" {
  return tier === "T2" || tier === "T3";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function verifiedCandidate(event: RankedEvent): VerifiedDiscoveryCandidate {
  if (!isDiscoveryTier(event.tier)) {
    throw new Error(`Only verified T2/T3 events may enter the LLM payload: ${event.canonicalKey}`);
  }
  return {
    id: event.canonicalKey,
    tier: event.tier,
    name: event.name,
    startAt: event.startAt,
    venue: {
      name: event.venue.name,
      ...(event.venue.city ? { city: event.venue.city } : {}),
      ...(event.venue.region ? { region: event.venue.region } : {})
    },
    performers: event.performers.map((performer) => performer.name),
    genres: event.genres,
    languages: event.languages.map((language) => language.language),
    ...(event.distanceMiles === undefined ? {} : { distanceMiles: event.distanceMiles }),
    ...(event.estimatedTravelMinutes === undefined
      ? {}
      : { estimatedTravelMinutes: event.estimatedTravelMinutes }),
    sourceProviders: unique(event.sources.map((source) => source.provider))
  };
}

/** Locks exact favorites in code and exposes only core-verified T2/T3 events. */
export function prepareLlmEvaluation(fixture: BenchmarkFixture): PreparedLlmEvaluation {
  const selection = buildRecommendationSelection(fixture.input, fixture.events, {
    now: new Date(fixture.now),
    limit: fixture.precisionK
  });
  const lockedExactEvents = selection.recommendations.filter(
    (event) => event.tier === "T0" || event.tier === "T1"
  );
  const maximumSelections = Math.max(0, fixture.precisionK - lockedExactEvents.length);
  const candidates = selection.recommendations
    .filter((event) => isDiscoveryTier(event.tier))
    .map(verifiedCandidate);

  return {
    lockedExactEvents,
    candidatePayload: {
      evaluationId: fixture.id,
      policy: {
        maximumSelections,
        lockedExactEventIds: lockedExactEvents.map((event) => event.canonicalKey),
        factsAreImmutable: true
      },
      preferenceProfile: {
        artists: fixture.input.artists.map(({ name, weight }) => ({ name, weight })),
        genres: fixture.input.genres.map(({ name, weight }) => ({ name, weight })),
        inferredGenres: fixture.input.inferredGenres ?? [],
        acceptedLanguages:
          fixture.input.languageMode === "any"
            ? "any"
            : fixture.input.languages.map((item) => item.language),
        inferredLanguages: fixture.input.inferredLanguages ?? [],
        originLabel: fixture.input.origin.label,
        maxTravelMinutes: fixture.input.maxTravelMinutes
      },
      candidateEvents: candidates
    }
  };
}

export function buildResponsesRequest(
  model: LlmEvaluationModel,
  payload: LlmCandidatePayload
): ResponsesRequestBody {
  const candidateIds = payload.candidateEvents.map((event) => event.id);
  return {
    model,
    store: false,
    reasoning: { effort: "low" },
    instructions: RERANK_INSTRUCTIONS,
    input: JSON.stringify(payload),
    text: {
      format: {
        type: "json_schema",
        name: "front_row_discovery_selection",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            selectedEventIds: {
              type: "array",
              items: { type: "string", enum: candidateIds },
              maxItems: payload.policy.maximumSelections
            }
          },
          required: ["selectedEventIds"]
        }
      }
    },
    max_output_tokens: 800
  };
}

function responseOutputText(body: ResponsesApiBody): string | undefined {
  if (typeof body.output_text === "string") return body.output_text;
  for (const item of body.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return undefined;
}

function tokenUsage(usage: ResponsesUsage | undefined): TokenUsage | null {
  if (!usage) return null;
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cachedInputTokens = Math.min(
    inputTokens,
    Math.max(0, usage.input_tokens_details?.cached_tokens ?? 0)
  );
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens: usage.total_tokens ?? inputTokens + outputTokens
  };
}

export function estimateModelCostUsd(
  model: LlmEvaluationModel,
  usage: TokenUsage
): number {
  const rates = RATE_CARD[model];
  const longContext = usage.inputTokens > LONG_CONTEXT_THRESHOLD;
  const inputMultiplier = longContext ? 2 : 1;
  const outputMultiplier = longContext ? 1.5 : 1;
  const uncachedInputTokens = usage.inputTokens - usage.cachedInputTokens;
  const cost =
    (uncachedInputTokens * rates.input * inputMultiplier +
      usage.cachedInputTokens * rates.cachedInput * inputMultiplier +
      usage.outputTokens * rates.output * outputMultiplier) /
    1_000_000;
  return Math.round(cost * 1_000_000_000) / 1_000_000_000;
}

function parseSelection(
  text: string | undefined,
  payload: LlmCandidatePayload
): { valid: true; ids: string[] } | { valid: false; error: string } {
  if (!text) return { valid: false, error: "Response did not contain output text" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { valid: false, error: "Response output was not valid JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { valid: false, error: "Response output was not an object" };
  }
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "selectedEventIds")) {
    return { valid: false, error: "Response output contained an unexpected property" };
  }
  if (!Array.isArray(record.selectedEventIds)) {
    return { valid: false, error: "selectedEventIds was not an array" };
  }
  const ids = record.selectedEventIds;
  if (ids.some((id) => typeof id !== "string")) {
    return { valid: false, error: "selectedEventIds contained a non-string value" };
  }
  const selectedIds = ids as string[];
  if (selectedIds.length > payload.policy.maximumSelections) {
    return { valid: false, error: "Model selected more events than allowed" };
  }
  if (new Set(selectedIds).size !== selectedIds.length) {
    return { valid: false, error: "Model selected a duplicate event ID" };
  }
  const candidateIds = new Set(payload.candidateEvents.map((event) => event.id));
  if (selectedIds.some((id) => !candidateIds.has(id))) {
    return { valid: false, error: "Model selected an ID outside the verified candidates" };
  }
  return { valid: true, ids: selectedIds };
}

function ratio(numerator: number, denominator: number): RatioMetric {
  return {
    numerator,
    denominator,
    value: denominator === 0 ? null : numerator / denominator
  };
}

function qualityFor(
  fixture: BenchmarkFixture,
  prepared: PreparedLlmEvaluation,
  selectedEventIds: string[]
): ModelQuality {
  const selectedRelevant = selectedEventIds.filter(
    (id) => fixture.relevanceLabels[id] === true
  ).length;
  const lockedIds = prepared.lockedExactEvents.map((event) => event.canonicalKey);
  const finalIds = [...lockedIds, ...selectedEventIds].slice(0, fixture.precisionK);
  const finalRelevant = finalIds.filter((id) => fixture.relevanceLabels[id] === true).length;
  return {
    selectedRelevant: ratio(selectedRelevant, selectedEventIds.length),
    finalPrecisionAtKProxy: ratio(finalRelevant, fixture.precisionK)
  };
}

function notRunResult(
  model: LlmEvaluationModel,
  prepared: PreparedLlmEvaluation,
  error?: string
): LlmModelEvaluationResult {
  return {
    model,
    status: "not_run",
    latencyMs: null,
    usage: null,
    estimatedCostUsd: null,
    schemaValid: null,
    selectedEventIds: [],
    finalSelectionIds: prepared.lockedExactEvents.map((event) => event.canonicalKey),
    quality: null,
    ...(error ? { error } : {})
  };
}

function isBillingExhausted(result: LlmModelEvaluationResult): boolean {
  return result.status === "api_error" &&
    /no credits remaining|billing|insufficient_quota/i.test(result.error ?? "");
}

async function runModelEvaluation(
  model: LlmEvaluationModel,
  fixture: BenchmarkFixture,
  prepared: PreparedLlmEvaluation,
  apiKey: string,
  fetchImpl: typeof fetch,
  nowMs: () => number
): Promise<LlmModelEvaluationResult> {
  const request = buildResponsesRequest(model, prepared.candidatePayload);
  const startedAt = nowMs();
  let response: Response;
  try {
    response = await fetchImpl(RESPONSES_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(request)
    });
  } catch (error) {
    return {
      ...notRunResult(model, prepared),
      status: "api_error",
      latencyMs: nowMs() - startedAt,
      schemaValid: false,
      error: error instanceof Error ? error.message : "Responses API request failed"
    };
  }
  const latencyMs = nowMs() - startedAt;
  let body: ResponsesApiBody;
  try {
    body = (await response.json()) as ResponsesApiBody;
  } catch {
    return {
      ...notRunResult(model, prepared),
      status: "api_error",
      latencyMs,
      schemaValid: false,
      error: `Responses API returned non-JSON HTTP ${response.status}`
    };
  }
  const usage = tokenUsage(body.usage);
  if (!response.ok) {
    return {
      ...notRunResult(model, prepared),
      status: "api_error",
      latencyMs,
      usage,
      estimatedCostUsd: usage ? estimateModelCostUsd(model, usage) : null,
      schemaValid: false,
      error: body.error?.message ?? `Responses API returned HTTP ${response.status}`
    };
  }

  const parsed = parseSelection(responseOutputText(body), prepared.candidatePayload);
  if (!parsed.valid) {
    return {
      ...notRunResult(model, prepared),
      status: "invalid_schema",
      latencyMs,
      usage,
      estimatedCostUsd: usage ? estimateModelCostUsd(model, usage) : null,
      schemaValid: false,
      error: parsed.error
    };
  }
  const lockedIds = prepared.lockedExactEvents.map((event) => event.canonicalKey);
  return {
    model,
    status: "completed",
    latencyMs,
    usage,
    estimatedCostUsd: usage ? estimateModelCostUsd(model, usage) : null,
    schemaValid: true,
    selectedEventIds: parsed.ids,
    finalSelectionIds: [...lockedIds, ...parsed.ids],
    quality: qualityFor(fixture, prepared, parsed.ids)
  };
}

export async function runLlmComparison(
  fixture: BenchmarkFixture,
  options: RunLlmComparisonOptions
): Promise<LlmComparisonReport> {
  const prepared = prepareLlmEvaluation(fixture);
  let results: LlmModelEvaluationResult[];

  if (!options.live) {
    results = LLM_EVALUATION_MODELS.map((model) => notRunResult(model, prepared));
  } else {
    if (!options.apiKey?.trim()) {
      throw new Error("--live requires OPENAI_API_KEY; no API requests were sent");
    }
    const fetchImpl = options.fetchImpl ?? fetch;
    const nowMs = options.nowMs ?? (() => performance.now());
    results = [];
    for (const model of LLM_EVALUATION_MODELS) {
      const result = await runModelEvaluation(
        model,
        fixture,
        prepared,
        options.apiKey,
        fetchImpl,
        nowMs
      );
      results.push(result);
      if (isBillingExhausted(result)) {
        for (const skippedModel of LLM_EVALUATION_MODELS.slice(results.length)) {
          results.push(notRunResult(
            skippedModel,
            prepared,
            "Skipped because the API account reported insufficient credits"
          ));
        }
        break;
      }
    }
  }

  return {
    schemaVersion: 1,
    mode: options.live ? "live" : "dry-run",
    evaluationId: fixture.id,
    models: LLM_EVALUATION_MODELS,
    pricing: {
      asOf: RATE_CARD_AS_OF,
      currency: "USD",
      unit: "per_million_tokens"
    },
    safeguards: {
      explicitLiveFlagRequired: true,
      apiKeyRequired: true,
      store: false,
      strictStructuredOutput: true,
      exactTiersLockedOutsideModel: true,
      candidateFactsImmutable: true
    },
    lockedExactEventIds: prepared.lockedExactEvents.map((event) => event.canonicalKey),
    candidatePayload: prepared.candidatePayload,
    results
  };
}

export function formatLlmComparisonSummary(report: LlmComparisonReport): string {
  const lines = [
    `Front Row LLM comparison: ${report.evaluationId} (${report.mode})`,
    `Locked T0/T1: ${report.lockedExactEventIds.length}; verified T2/T3 candidates: ${report.candidatePayload.candidateEvents.length}`
  ];
  for (const result of report.results) {
    if (result.status === "not_run") {
      lines.push(`${result.model}: not run`);
      continue;
    }
    const latency = result.latencyMs === null ? "n/a" : `${result.latencyMs}ms`;
    const cost = result.estimatedCostUsd === null
      ? "n/a"
      : `$${result.estimatedCostUsd.toFixed(6)}`;
    lines.push(
      `${result.model}: ${result.status}; ${latency}; ${cost}; selected ${result.selectedEventIds.length}`
    );
  }
  return lines.join("\n");
}
