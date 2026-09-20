import { describe, expect, it, vi } from "vitest";

import { loadLlmBenchmarkCase } from "../../src/evaluation/llm-benchmark-suite.js";
import {
  estimatePaidLlmSuiteMaximumCost,
  parseLlmSuiteCliArguments,
  runPaidLlmSuite
} from "../../src/evaluation/llm-suite-cli.js";

const fixtureUrl = new URL("./fixtures/llm-baseline.json", import.meta.url);

function successfulResponse(init: RequestInit | undefined, sequence = 0): Response {
  const request = JSON.parse(String(init?.body)) as { input: string };
  const payload = JSON.parse(request.input) as {
    candidateEvents: Array<{
      id: string;
      evidence: Array<{
        ref: string;
        reasonCode: string;
        confidence: number;
      }>;
    }>;
  };
  const candidate = payload.candidateEvents[0];
  const evidence = candidate?.evidence[0];
  const selections = candidate && evidence
    ? [{
        eventId: candidate.id,
        reasonCode: evidence.reasonCode,
        confidence: evidence.confidence,
        evidenceRefs: [evidence.ref]
      }]
    : [];
  return new Response(JSON.stringify({
    output: [{
      type: "message",
      content: [{
        type: "output_text",
        text: JSON.stringify({ selections })
      }]
    }],
    usage: {
      input_tokens: 1_000 + sequence,
      output_tokens: 100,
      total_tokens: 1_100 + sequence,
      input_tokens_details: { cached_tokens: 100 }
    }
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("paid LLM suite runner", () => {
  it("parses repeated fixture paths and defaults to three repetitions", () => {
    expect(parseLlmSuiteCliArguments([
      "--live",
      "--fixture",
      "first.json",
      "--fixture",
      "second.json",
      "--max-spend-usd",
      "2.50",
      "--effort",
      "medium",
      "--models",
      "gpt-5.6-luna,gpt-5.6-sol"
    ])).toEqual({
      fixturePaths: ["first.json", "second.json"],
      repetitions: 3,
      live: true,
      maxSpendUsd: 2.5,
      reasoningEffort: "medium",
      models: ["gpt-5.6-luna", "gpt-5.6-sol"]
    });

    expect(() => parseLlmSuiteCliArguments([
      "--fixture",
      "first.json",
      "--max-spend-usd",
      "1"
    ])).toThrow("--live is required");
    expect(() => parseLlmSuiteCliArguments([
      "--live",
      "--fixture",
      "first.json"
    ])).toThrow("--max-spend-usd is required");
    expect(() => parseLlmSuiteCliArguments([
      "--live",
      "--fixture",
      "first.json",
      "--repetitions",
      "0",
      "--max-spend-usd",
      "1"
    ])).toThrow("integer from 1");
    expect(() => parseLlmSuiteCliArguments([
      "--live",
      "--fixture",
      "first.json",
      "--effort",
      "high",
      "--max-spend-usd",
      "1"
    ])).toThrow("low or medium");
    expect(() => parseLlmSuiteCliArguments([
      "--live",
      "--fixture",
      "first.json",
      "--models",
      "unknown-model",
      "--max-spend-usd",
      "1"
    ])).toThrow("Unknown model");
  });

  it("blocks the entire suite before a request when the spend estimate exceeds the guard", async () => {
    const benchmarkCase = await loadLlmBenchmarkCase(fixtureUrl);
    const fetchMock = vi.fn<typeof fetch>();
    const estimate = estimatePaidLlmSuiteMaximumCost([benchmarkCase], 3);
    const finalistEstimate = estimatePaidLlmSuiteMaximumCost(
      [benchmarkCase],
      3,
      ["gpt-5.6-luna"]
    );

    expect(estimate).toBeGreaterThan(0);
    expect(finalistEstimate).toBeLessThan(estimate);
    await expect(runPaidLlmSuite({
      cases: [benchmarkCase],
      live: false,
      maxSpendUsd: 100,
      apiKey: "test-key",
      fetchImpl: fetchMock
    })).rejects.toThrow("Live mode is required");
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(runPaidLlmSuite({
      cases: [benchmarkCase],
      repetitions: 3,
      live: true,
      maxSpendUsd: estimate / 2,
      apiKey: "test-key",
      fetchImpl: fetchMock
    })).rejects.toThrow("Estimated maximum spend");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("repeats selected fixtures and aggregates quality, latency, cost, and stability per model", async () => {
    const benchmarkCase = await loadLlmBenchmarkCase(fixtureUrl);
    let requestIndex = 0;
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) =>
      successfulResponse(init, requestIndex++)
    );
    let clock = 0;

    const report = await runPaidLlmSuite({
      cases: [benchmarkCase],
      repetitions: 2,
      live: true,
      maxSpendUsd: 100,
      apiKey: "test-key",
      fetchImpl: fetchMock,
      reasoningEffort: "medium",
      models: ["gpt-5.6-luna", "gpt-5.6-terra"],
      nowMs: () => {
        clock += 10;
        return clock;
      }
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(report.runs).toHaveLength(2);
    expect(report.repetitionsCompleted).toBe(2);
    expect(report.budget).toMatchObject({
      maxSpendUsd: 100,
      stoppedEarly: false
    });
    expect(report.budget.actualKnownSpendUsd).toBeGreaterThan(0);
    expect(report.reasoningEffort).toBe("medium");
    expect(report.models).toEqual(["gpt-5.6-luna", "gpt-5.6-terra"]);
    expect(report.aggregates).toHaveLength(2);
    for (const aggregate of report.aggregates) {
      expect(aggregate).toMatchObject({
        reasoningEffort: "medium",
        scheduledRuns: 2,
        requestCount: 2,
        completedRuns: 2,
        notRunCount: 0,
        exactRecall: { value: 1 },
        invalidSchemaRate: { numerator: 0, denominator: 2, value: 0 },
        apiErrorRate: { numerator: 0, denominator: 2, value: 0 },
        latencyMs: { count: 2, mean: 10, p50: 10, p95: 10 },
        selectionStability: { meanPairwiseJaccard: 1, comparisons: 1 }
      });
      expect(aggregate.precisionAmongSelected.value).not.toBeNull();
      expect(aggregate.usefulFill.value).not.toBeNull();
      expect(aggregate.cost).toMatchObject({
        requestCount: 2,
        knownCostRequestCount: 2,
        unknownCostRequestCount: 0
      });
      expect(aggregate.cost.totalCostUsd).toBeGreaterThan(0);
      expect(aggregate.cost.meanCostPerRequestUsd).toBeGreaterThan(0);
    }
  });

  it("reports invalid and API error rates without dropping locked exact recall", async () => {
    const benchmarkCase = await loadLlmBenchmarkCase(fixtureUrl);
    const callsByModel = new Map<string, number>();
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { model: string };
      const call = callsByModel.get(request.model) ?? 0;
      callsByModel.set(request.model, call + 1);
      if (call === 1 && request.model === "gpt-5.6-terra") {
        return new Response(JSON.stringify({
          output_text: JSON.stringify({
            selections: [{
              eventId: "invented",
              reasonCode: "trending",
              confidence: 1,
              evidenceRefs: ["invented#e1"]
            }]
          }),
          usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (call === 1 && request.model === "gpt-5.6-sol") {
        return new Response(JSON.stringify({ error: { message: "temporary outage" } }), {
          status: 503,
          headers: { "content-type": "application/json" }
        });
      }
      return successfulResponse(init, call);
    });

    const report = await runPaidLlmSuite({
      cases: [benchmarkCase],
      repetitions: 2,
      live: true,
      maxSpendUsd: 100,
      apiKey: "test-key",
      fetchImpl: fetchMock,
      nowMs: () => 0
    });
    const terra = report.aggregates.find((item) => item.model === "gpt-5.6-terra")!;
    const sol = report.aggregates.find((item) => item.model === "gpt-5.6-sol")!;

    expect(terra.invalidSchemaRate).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(sol.apiErrorRate).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(terra.exactRecall.value).toBe(1);
    expect(sol.exactRecall.value).toBe(1);
  });

  it("stops subsequent runs after the API reports insufficient credits", async () => {
    const benchmarkCase = await loadLlmBenchmarkCase(fixtureUrl);
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      error: { message: "You have no credits remaining." }
    }), { status: 429, headers: { "content-type": "application/json" } }));

    const report = await runPaidLlmSuite({
      cases: [benchmarkCase],
      repetitions: 3,
      live: true,
      maxSpendUsd: 100,
      apiKey: "test-key",
      fetchImpl: fetchMock,
      nowMs: () => 0
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(report.runs).toHaveLength(1);
    expect(report.budget).toMatchObject({
      stoppedEarly: true,
      stopReason: "Stopped because the API account reported insufficient credits"
    });
  });
});
