import { describe, expect, it, vi } from "vitest";

import type { RankedEvent, ValidationInput } from "../../src/core/types.js";
import {
  LlmEventSelectionClient,
  applyLlmEventSelections,
  buildLlmEventSelectionRequest,
  estimateLlmEventSelectionCost,
  mergeLlmEventRecommendations,
  prepareLlmEventSelection
} from "../../src/discovery/llmEventSelection.js";

const preferences: ValidationInput = {
  artists: [
    { name: "万能青年旅店", weight: "priority" },
    { name: "陶喆", weight: "like" }
  ],
  genres: [],
  inferredGenres: [{ name: "Jazz", percentage: 55, confidence: 0.8 }],
  languages: [],
  inferredLanguages: [{ language: "cmn", percentage: 80 }],
  languageMode: "any",
  origin: { label: "Oakland, CA", latitude: 37.8, longitude: -122.27 },
  maxTravelMinutes: 120,
  forecastMonths: 4
};

function event(
  id: string,
  performer: string,
  tier: RankedEvent["tier"] = "T3",
  sourceMode: "live" | "fixture" = "live"
): RankedEvent {
  return {
    canonicalKey: id,
    name: `${performer} Live`,
    startAt: "2026-11-10T03:00:00.000Z",
    status: "active",
    venue: {
      name: "Fox Theater",
      city: "Oakland",
      region: "CA",
      coordinates: { latitude: 37.808, longitude: -122.27 }
    },
    performers: [{ name: performer, role: "headliner" }],
    genres: ["Jazz"],
    languages: [{ language: "en", role: "primary", confidence: 0.8, source: "provider" }],
    sources: [{
      provider: sourceMode === "live" ? "ticketmaster" : "fixture",
      eventId: id,
      fetchedAt: "2026-09-20T12:00:00.000Z",
      mode: sourceMode
    }],
    tier,
    score: { final: 0.5, coverage: 1 },
    reason: "deterministic reason",
    warnings: [],
    distanceMiles: 12,
    estimatedTravelMinutes: 25
  };
}

function response(output: unknown, usage?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({
    output_text: JSON.stringify(output),
    ...(usage ? { usage } : {})
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("verified event AI selection", () => {
  it("locks exact favorites, removes duplicate performers, caps forty candidates, and omits coordinates", () => {
    const exact = event("exact", "陶喆", "T1");
    const candidates = [
      exact,
      event("bruno-1", "Bruno Mars", "T2"),
      event("bruno-2", "Bruno Mars", "T3"),
      event("fixture", "Fixture Only", "T3", "fixture"),
      ...Array.from({ length: 45 }, (_, index) => event(`candidate-${index}`, `Artist ${index}`))
    ];

    const payload = prepareLlmEventSelection({
      preferences,
      lockedExactEvents: [exact],
      candidates
    });
    const request = buildLlmEventSelectionRequest(payload);
    const serialized = JSON.stringify(request);

    expect(payload.policy).toMatchObject({
      maximumSelections: 8,
      maximumTotalResults: 9,
      lockedExactEventIds: ["exact"],
      candidateFactsAreImmutable: true
    });
    expect(payload.candidateEvents).toHaveLength(40);
    expect(payload.candidateEvents.filter((candidate) => candidate.performers.includes("Bruno Mars")))
      .toHaveLength(1);
    expect(payload.candidateEvents.map((candidate) => candidate.id)).not.toContain("exact");
    expect(payload.candidateEvents.map((candidate) => candidate.id)).not.toContain("fixture");
    expect(request).toMatchObject({
      model: "gpt-6-astra",
      store: false,
      reasoning: { effort: "low" },
      max_output_tokens: 800,
      text: { format: { type: "json_schema", strict: true } }
    });
    expect(serialized).not.toContain("latitude");
    expect(serialized).not.toContain("longitude");
    expect(serialized).not.toContain("Oakland, CA");
    expect(request.instructions).toContain("Do not search the web");
  });

  it("selects only supplied IDs and converts every AI choice to T3 with an AI reason", async () => {
    const exact = event("exact", "陶喆", "T1");
    const bruno = event("bruno", "Bruno Mars", "T2");
    const client = new LlmEventSelectionClient({
      apiKey: "test-key",
      fetchImpl: async () => response({
        selections: [{
          eventId: "bruno",
          relatedSeed: "陶喆",
          rationale: "Both center polished R&B songwriting and rhythmic vocal phrasing."
        }]
      }, {
        input_tokens: 100,
        output_tokens: 10,
        total_tokens: 110,
        input_tokens_details: { cached_tokens: 20 }
      })
    });

    const result = await client.select({
      preferences,
      lockedExactEvents: [exact],
      candidates: [bruno]
    });
    const ranked = applyLlmEventSelections([bruno], result.selections);

    expect(result).toMatchObject({
      status: "completed",
      usage: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 10, totalTokens: 110 },
      estimatedCostUsd: 0.00132
    });
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({
      canonicalKey: "bruno",
      tier: "T3",
      reason: "AI 根据 陶喆 推断：Both center polished R&B songwriting and rhythmic vocal phrasing."
    });
    expect(ranked[0]?.warnings).toContain("推荐理由由 AI 根据音乐偏好生成；演出信息仍来自票务平台");
  });

  it("keeps exact events locked and uses deterministic recommendations only to preserve the floor", () => {
    const exact = event("exact", "陶喆", "T1");
    const ai = event("ai", "Nai Palm", "T3");
    const deterministicTwo = event("det-2", "Local Two", "T3");
    const deterministicThree = event("det-3", "Local Three", "T3");

    const merged = mergeLlmEventRecommendations(
      [exact],
      [ai],
      [exact, ai, deterministicTwo, deterministicThree]
    );

    expect(merged.map((item) => item.canonicalKey)).toEqual(["exact", "ai", "det-2"]);
    expect(merged[0]?.tier).toBe("T1");
  });

  it("rejects unknown, duplicate, and unsupported selections", async () => {
    const candidate = event("candidate", "Candidate Artist");
    const outputs = [
      { selections: [{ eventId: "unknown", relatedSeed: "陶喆", rationale: "No." }] },
      { selections: [
        { eventId: "candidate", relatedSeed: "陶喆", rationale: "First." },
        { eventId: "candidate", relatedSeed: "陶喆", rationale: "Duplicate." }
      ] },
      { selections: [{ eventId: "candidate", relatedSeed: "Unknown Seed", rationale: "No." }] }
    ];
    let index = 0;
    const client = new LlmEventSelectionClient({
      apiKey: "test-key",
      cacheTtlMs: 0,
      fetchImpl: async () => response(outputs[index++])
    });

    for (let run = 0; run < outputs.length; run += 1) {
      const result = await client.select({ preferences, lockedExactEvents: [], candidates: [candidate] });
      expect(result).toMatchObject({ status: "invalid_response", selections: [] });
    }
  });

  it("uses a 24h cache and coalesces concurrent identical requests", async () => {
    let now = 1_000;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      await Promise.resolve();
      return response({ selections: [] });
    });
    const client = new LlmEventSelectionClient({ apiKey: "test-key", fetchImpl, nowMs: () => now });
    const input = { preferences, lockedExactEvents: [], candidates: [event("one", "One")] };

    const [first, concurrent] = await Promise.all([client.select(input), client.select(input)]);
    now += 23 * 60 * 60 * 1_000;
    const cached = await client.select(input);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(first.cached).toBe(false);
    expect(concurrent).toMatchObject({ cached: true, estimatedCostUsd: 0 });
    expect(cached).toMatchObject({ cached: true, estimatedCostUsd: 0 });
  });

  it("returns non-throwing disabled, API-error, and timeout fallbacks", async () => {
    const input = { preferences, lockedExactEvents: [], candidates: [event("one", "One")] };
    const disabled = await new LlmEventSelectionClient().select(input);
    const apiError = await new LlmEventSelectionClient({
      apiKey: "test-key",
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: "rate limited" } }), {
        status: 429,
        headers: { "content-type": "application/json" }
      })
    }).select(input);
    const timedOut = await new LlmEventSelectionClient({
      apiKey: "test-key",
      timeoutMs: 5,
      fetchImpl: (() => new Promise<Response>(() => undefined)) as typeof fetch
    }).select(input);

    expect(disabled.status).toBe("disabled");
    expect(apiError).toMatchObject({ status: "api_error", error: "rate limited" });
    expect(timedOut.status).toBe("timed_out");
  });

  it("estimates cached and uncached token cost", () => {
    expect(estimateLlmEventSelectionCost("gpt-5.6-luna", {
      inputTokens: 1_000,
      cachedInputTokens: 400,
      outputTokens: 100,
      totalTokens: 1_100
    })).toBe(0.000248);
  });
});
