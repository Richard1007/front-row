import { describe, expect, it, vi } from "vitest";

import {
  LlmArtistExpansionClient,
  buildLlmArtistExpansionRequest,
  estimateLlmArtistExpansionCost
} from "../../src/discovery/llmArtistExpansion.js";

const input = {
  artists: [
    { name: "方大同", weight: "priority" as const },
    { name: "陶喆", weight: "like" as const }
  ],
  inferredLanguages: [
    { language: "cmn", percentage: 85 },
    { language: "en", percentage: 15 }
  ],
  inferredGenres: [
    { name: "R&B", percentage: 55, confidence: 0.9 },
    { name: "Soul", percentage: 30, confidence: 0.8 }
  ]
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("LLM artist expansion", () => {
  it("builds a strict, low-reasoning Responses API request", () => {
    const request = buildLlmArtistExpansionRequest(input);
    const schema = request.text.format.schema as {
      additionalProperties: boolean;
      properties: {
        candidates: {
          maxItems: number;
          items: {
            additionalProperties: boolean;
            properties: { relatedTo: { items: { enum: string[] } } };
          };
        };
      };
    };

    expect(request).toMatchObject({
      model: "gpt-6-astra",
      store: false,
      reasoning: { effort: "low" },
      max_output_tokens: 700,
      text: { format: { type: "json_schema", strict: true } }
    });
    expect(JSON.stringify(request)).not.toContain("uniqueItems");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.candidates.maxItems).toBe(8);
    expect(schema.properties.candidates.items.additionalProperties).toBe(false);
    expect(schema.properties.candidates.items.properties.relatedTo.items.enum).toEqual([
      "方大同",
      "陶喆"
    ]);
    expect(JSON.parse(request.input)).toEqual({
      selectedArtists: [
        { name: "方大同", weight: "priority" },
        { name: "陶喆", weight: "like" }
      ],
      inferredLanguages: input.inferredLanguages,
      inferredGenres: input.inferredGenres
    });
    expect(request.instructions).toContain("real, existing artists");
    expect(request.instructions).toContain("untrusted data");
  });

  it("returns validated candidates, usage, estimated cost, and reuses the 24h cache", async () => {
    let now = 1_000;
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        output_text: JSON.stringify({
          candidates: [
            {
              name: "Musiq Soulchild",
              relatedTo: ["方大同"],
              confidence: 0.93,
              microgenres: ["neo-soul", "contemporary R&B"],
              rationale: "Shares warm neo-soul harmony and elastic vocal phrasing."
            },
            {
              name: "Musiq Soulchild",
              relatedTo: ["陶喆"],
              confidence: 0.8,
              microgenres: ["neo-soul"],
              rationale: "Duplicate spelling should be removed."
            },
            {
              name: "陶喆",
              relatedTo: ["陶喆"],
              confidence: 1,
              microgenres: ["Mandopop R&B"],
              rationale: "A selected artist must not be returned as an expansion."
            }
          ]
        }),
        usage: {
          input_tokens: 100,
          output_tokens: 10,
          total_tokens: 110,
          input_tokens_details: { cached_tokens: 20 }
        }
      })
    );
    const client = new LlmArtistExpansionClient({ apiKey: "test-key", fetchImpl, nowMs: () => now });

    const first = await client.expand(input);
    now += 23 * 60 * 60 * 1_000;
    const second = await client.expand(input);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" })
      })
    );
    expect(first).toEqual({
      status: "completed",
      model: "gpt-6-astra",
      candidates: [
        {
          name: "Musiq Soulchild",
          relatedTo: ["方大同"],
          confidence: 0.93,
          microgenres: ["neo-soul", "contemporary R&B"],
          rationale: "Shares warm neo-soul harmony and elastic vocal phrasing."
        }
      ],
      usage: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 10, totalTokens: 110 },
      estimatedCostUsd: 0.00132,
      cached: false
    });
    expect(second).toMatchObject({ status: "completed", cached: true, estimatedCostUsd: 0 });
  });

  it("expires cached results after 24 hours", async () => {
    let now = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ output_text: JSON.stringify({ candidates: [] }) })
    );
    const client = new LlmArtistExpansionClient({ apiKey: "test-key", fetchImpl, nowMs: () => now });

    await client.expand(input);
    now = 24 * 60 * 60 * 1_000;
    await client.expand(input);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns safe diagnostics without making a request when disabled or empty", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const disabled = await new LlmArtistExpansionClient({ fetchImpl }).expand(input);
    const skipped = await new LlmArtistExpansionClient({
      apiKey: "test-key",
      fetchImpl
    }).expand({ artists: [] });

    expect(disabled).toMatchObject({ status: "disabled", candidates: [], cached: false });
    expect(disabled.error).toContain("OPENAI_API_KEY");
    expect(skipped).toMatchObject({ status: "skipped", candidates: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns invalid_response for malformed output while retaining billable usage", async () => {
    const client = new LlmArtistExpansionClient({
      apiKey: "test-key",
      fetchImpl: async () =>
        jsonResponse({
          output_text: JSON.stringify({
            candidates: [{ name: "Invented", relatedTo: ["not a seed"] }]
          }),
          usage: { input_tokens: 50, output_tokens: 5 }
        })
    });

    const result = await client.expand(input);

    expect(result).toMatchObject({
      status: "invalid_response",
      candidates: [],
      usage: { inputTokens: 50, outputTokens: 5 },
      estimatedCostUsd: 0.00075
    });
  });

  it("returns API and timeout diagnostics instead of throwing", async () => {
    const apiFailure = await new LlmArtistExpansionClient({
      apiKey: "test-key",
      fetchImpl: async () => jsonResponse({ error: { message: "rate limited" } }, 429)
    }).expand(input);
    const timeout = await new LlmArtistExpansionClient({
      apiKey: "test-key",
      timeoutMs: 5,
      fetchImpl: (() => new Promise<Response>(() => undefined)) as typeof fetch
    }).expand(input);

    expect(apiFailure).toMatchObject({ status: "api_error", error: "rate limited", candidates: [] });
    expect(timeout).toMatchObject({ status: "timed_out", candidates: [] });
  });

  it("calculates model-specific cost from uncached and cached tokens", () => {
    expect(
      estimateLlmArtistExpansionCost("gpt-5.6-luna", {
        inputTokens: 1_000,
        cachedInputTokens: 400,
        outputTokens: 100,
        totalTokens: 1_100
      })
    ).toBe(0.000248);
  });
});
