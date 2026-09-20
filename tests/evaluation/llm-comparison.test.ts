import { describe, expect, it, vi } from "vitest";

import { loadBenchmarkFixture } from "../../src/evaluation/benchmark.js";
import {
  LLM_EVALUATION_MODELS,
  buildResponsesRequest,
  estimateModelCostUsd,
  prepareLlmEvaluation,
  runLlmComparison,
  type LlmEvaluationModel
} from "../../src/evaluation/llm-comparison.js";

const fixtureUrl = new URL("./fixtures/front-row-baseline.json", import.meta.url);

function responseFor(selectedEventIds: string[], index = 0): Response {
  return new Response(JSON.stringify({
    output: [{
      type: "message",
      content: [{
        type: "output_text",
        text: JSON.stringify({ selectedEventIds })
      }]
    }],
    usage: {
      input_tokens: 1_000 + index * 100,
      output_tokens: 100 + index * 10,
      total_tokens: 1_100 + index * 110,
      input_tokens_details: { cached_tokens: 200 }
    }
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("offline-first LLM comparison harness", () => {
  it("locks T0/T1 and exposes only verified T2/T3 candidates", async () => {
    const fixture = await loadBenchmarkFixture(fixtureUrl);
    const prepared = prepareLlmEvaluation(fixture);

    expect(prepared.lockedExactEvents.map((event) => event.canonicalKey)).toEqual([
      "favorite-tao-alias",
      "favorite-wang-alias",
      "favorite-radiohead"
    ]);
    expect(prepared.lockedExactEvents.every((event) => event.tier === "T0" || event.tier === "T1"))
      .toBe(true);
    expect(prepared.candidatePayload.candidateEvents).toHaveLength(6);
    expect(prepared.candidatePayload.candidateEvents.every(
      (event) => event.tier === "T2" || event.tier === "T3"
    )).toBe(true);
    expect(prepared.candidatePayload.candidateEvents.every(
      (event) => !("deterministicScore" in event) && !("deterministicReason" in event)
    )).toBe(true);
    expect(prepared.candidatePayload.policy).toMatchObject({
      maximumSelections: 6,
      factsAreImmutable: true
    });
  });

  it("builds a stateless strict Responses API request with an ID-only schema", async () => {
    const fixture = await loadBenchmarkFixture(fixtureUrl);
    const prepared = prepareLlmEvaluation(fixture);
    const request = buildResponsesRequest("gpt-5.6-luna", prepared.candidatePayload);
    const candidateIds = prepared.candidatePayload.candidateEvents.map((event) => event.id);

    expect(request.store).toBe(false);
    expect(request.text.format).toMatchObject({
      type: "json_schema",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["selectedEventIds"]
      }
    });
    expect(request.text.format.schema.properties.selectedEventIds.items.enum)
      .toEqual(candidateIds);
    expect(request.instructions).toContain("Never invent");
  });

  it("never calls the network without both explicit live mode and an API key", async () => {
    const fixture = await loadBenchmarkFixture(fixtureUrl);
    const fetchMock = vi.fn<typeof fetch>();

    const dryRun = await runLlmComparison(fixture, {
      live: false,
      apiKey: "present-but-insufficient",
      fetchImpl: fetchMock
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dryRun.mode).toBe("dry-run");
    expect(dryRun.results.every((result) => result.status === "not_run")).toBe(true);

    await expect(runLlmComparison(fixture, {
      live: true,
      fetchImpl: fetchMock
    })).rejects.toThrow("no API requests were sent");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("compares all four models on byte-identical candidate payloads and records metrics", async () => {
    const fixture = await loadBenchmarkFixture(fixtureUrl);
    const selections = [
      ["related-jj-lin", "related-dangelo"],
      ["related-jj-lin", "related-the-smile", "discovery-rnb"],
      ["related-jj-lin", "related-dangelo", "related-the-smile"],
      ["related-jj-lin", "related-dangelo", "related-the-smile", "discovery-mandopop"]
    ];
    const requestBodies: Array<Record<string, unknown>> = [];
    let responseIndex = 0;
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const response = responseFor(selections[responseIndex] ?? [], responseIndex);
      responseIndex += 1;
      return response;
    });
    let clock = 0;

    const report = await runLlmComparison(fixture, {
      live: true,
      apiKey: "test-key",
      fetchImpl: fetchMock,
      nowMs: () => {
        clock += 25;
        return clock;
      }
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(report.models).toEqual(LLM_EVALUATION_MODELS);
    expect(report.results.map((result) => result.model)).toEqual(LLM_EVALUATION_MODELS);
    expect(report.results.every((result) => result.status === "completed")).toBe(true);
    expect(report.results.every((result) => result.schemaValid)).toBe(true);
    expect(report.results.every((result) => result.latencyMs === 25)).toBe(true);
    expect(report.results.map((result) => result.selectedEventIds)).toEqual(selections);
    expect(report.results[3]?.quality?.finalPrecisionAtKProxy).toMatchObject({
      numerator: 7,
      denominator: 9,
      value: 7 / 9
    });

    const inputs = requestBodies.map((body) => body.input);
    expect(new Set(inputs).size).toBe(1);
    const withoutModel = requestBodies.map(({ model: _model, ...body }) => body);
    expect(withoutModel.every((body) => JSON.stringify(body) === JSON.stringify(withoutModel[0])))
      .toBe(true);
    expect(requestBodies.every((body) => body.store === false)).toBe(true);
    expect(requestBodies.map((body) => body.model)).toEqual(LLM_EVALUATION_MODELS);
    expect(report.results[0]?.usage).toEqual({
      inputTokens: 1_000,
      cachedInputTokens: 200,
      outputTokens: 100,
      totalTokens: 1_100
    });
    expect(report.results[0]?.estimatedCostUsd).toBe(0.000284);
  });

  it("rejects fabricated IDs even if a provider returns HTTP 200", async () => {
    const fixture = await loadBenchmarkFixture(fixtureUrl);
    let call = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      const response = call === 0
        ? responseFor(["fabricated-event-id"])
        : responseFor([]);
      call += 1;
      return response;
    });

    const report = await runLlmComparison(fixture, {
      live: true,
      apiKey: "test-key",
      fetchImpl: fetchMock,
      nowMs: () => 0
    });
    const invalid = report.results[0];

    expect(invalid).toMatchObject({
      status: "invalid_schema",
      schemaValid: false,
      selectedEventIds: [],
      finalSelectionIds: report.lockedExactEventIds
    });
    expect(invalid?.error).toContain("outside the verified candidates");
  });

  it("stops paid comparisons after the account reports insufficient credits", async () => {
    const fixture = await loadBenchmarkFixture(fixtureUrl);
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      error: { message: "You have no credits remaining." }
    }), { status: 429, headers: { "content-type": "application/json" } }));

    const report = await runLlmComparison(fixture, {
      live: true,
      apiKey: "test-key",
      fetchImpl: fetchMock,
      nowMs: () => 0
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(report.results[0]?.status).toBe("api_error");
    expect(report.results.slice(1).every((result) => result.status === "not_run"))
      .toBe(true);
    expect(report.results[1]?.error).toContain("insufficient credits");
  });

  it("uses the dated rate card, including cached and long-context token rates", () => {
    const usage = {
      inputTokens: 1_000,
      cachedInputTokens: 200,
      outputTokens: 100,
      totalTokens: 1_100
    };
    const expected: Record<LlmEvaluationModel, number> = {
      "gpt-5.6-luna": 0.000284,
      "gpt-5.6-terra": 0.00284,
      "gpt-5.6-sol": 0.00528,
      "gpt-6-astra": 0.0132
    };
    for (const model of LLM_EVALUATION_MODELS) {
      expect(estimateModelCostUsd(model, usage)).toBe(expected[model]);
    }
    expect(estimateModelCostUsd("gpt-5.6-luna", {
      inputTokens: 300_000,
      cachedInputTokens: 0,
      outputTokens: 1_000,
      totalTokens: 301_000
    })).toBe(0.1218);
  });
});
