import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import "dotenv/config";

import type { RatioMetric } from "./benchmark.js";
import {
  loadLlmBenchmarkCase,
  scoreLlmBenchmarkCase,
  type LlmBenchmarkCase
} from "./llm-benchmark-suite.js";
import {
  LLM_EVALUATION_MODELS,
  estimateModelCostUsd,
  runLlmComparison,
  type LlmComparisonReport,
  type LlmEvaluationModel,
  type LlmModelEvaluationResult,
  type LlmReasoningEffort
} from "./llm-comparison.js";

const DEFAULT_REPETITIONS = 3;
const MAX_REPETITIONS = 100;
const ESTIMATE_OVERHEAD_INPUT_TOKENS = 10_000;
const MAX_OUTPUT_TOKENS_PER_REQUEST = 800;

export interface LlmSuiteCliArguments {
  fixturePaths: string[];
  repetitions: number;
  live: boolean;
  maxSpendUsd: number;
  reasoningEffort: LlmReasoningEffort;
  models: LlmEvaluationModel[];
}

export interface RunPaidLlmSuiteOptions {
  cases: readonly LlmBenchmarkCase[];
  repetitions?: number;
  live: boolean;
  maxSpendUsd: number;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
  reasoningEffort?: LlmReasoningEffort;
  models?: readonly LlmEvaluationModel[];
}

export interface LlmSuiteRunRecord {
  caseId: string;
  repetition: number;
  report: LlmComparisonReport;
}

export interface DistributionSummary {
  count: number;
  mean: number | null;
  p50: number | null;
  p95: number | null;
}

export interface CostSummary {
  requestCount: number;
  knownCostRequestCount: number;
  unknownCostRequestCount: number;
  totalCostUsd: number;
  meanCostPerRequestUsd: number | null;
  meanKnownCostUsd: number | null;
}

export interface SelectionStabilitySummary {
  /** Mean pairwise Jaccard similarity, compared only within the same fixture. */
  meanPairwiseJaccard: number | null;
  comparisons: number;
}

export interface LlmSuiteModelAggregate {
  model: LlmEvaluationModel;
  reasoningEffort: LlmReasoningEffort;
  scheduledRuns: number;
  requestCount: number;
  completedRuns: number;
  notRunCount: number;
  exactRecall: RatioMetric;
  precisionAmongSelected: RatioMetric;
  usefulFill: RatioMetric;
  invalidSchemaRate: RatioMetric;
  apiErrorRate: RatioMetric;
  failureRate: RatioMetric;
  latencyMs: DistributionSummary;
  cost: CostSummary;
  selectionStability: SelectionStabilitySummary;
}

export interface PaidLlmSuiteReport {
  schemaVersion: 1;
  mode: "live";
  reasoningEffort: LlmReasoningEffort;
  models: readonly LlmEvaluationModel[];
  fixtureIds: string[];
  repetitionsRequested: number;
  repetitionsCompleted: number;
  budget: {
    maxSpendUsd: number;
    estimatedMaximumSpendUsd: number;
    actualKnownSpendUsd: number;
    stoppedEarly: boolean;
    stopReason?: string;
  };
  aggregates: LlmSuiteModelAggregate[];
  runs: LlmSuiteRunRecord[];
}

function requiredValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

function positiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_REPETITIONS) {
    throw new Error(`${option} must be an integer from 1 to ${MAX_REPETITIONS}`);
  }
  return parsed;
}

function positiveMoney(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${option} must be a positive USD amount`);
  }
  return parsed;
}

function selectedModels(value: string): LlmEvaluationModel[] {
  const models = value.split(",").map((model) => model.trim()).filter(Boolean);
  if (models.length === 0) throw new Error("--models requires at least one model");
  const unknown = models.filter((model) =>
    !LLM_EVALUATION_MODELS.includes(model as LlmEvaluationModel)
  );
  if (unknown.length > 0) throw new Error(`Unknown model(s): ${unknown.join(", ")}`);
  if (new Set(models).size !== models.length) {
    throw new Error("--models cannot contain duplicates");
  }
  return models as LlmEvaluationModel[];
}

export function parseLlmSuiteCliArguments(args: readonly string[]): LlmSuiteCliArguments {
  const fixturePaths: string[] = [];
  let repetitions = DEFAULT_REPETITIONS;
  let live = false;
  let maxSpendUsd: number | undefined;
  let reasoningEffort: LlmReasoningEffort = "low";
  let models = [...LLM_EVALUATION_MODELS];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--live") {
      live = true;
    } else if (argument === "--fixture") {
      fixturePaths.push(requiredValue(args, index, argument));
      index += 1;
    } else if (argument === "--repetitions") {
      repetitions = positiveInteger(requiredValue(args, index, argument), argument);
      index += 1;
    } else if (argument === "--max-spend-usd") {
      maxSpendUsd = positiveMoney(requiredValue(args, index, argument), argument);
      index += 1;
    } else if (argument === "--effort") {
      const effort = requiredValue(args, index, argument);
      if (effort !== "low" && effort !== "medium") {
        throw new Error("--effort must be low or medium");
      }
      reasoningEffort = effort;
      index += 1;
    } else if (argument === "--models") {
      models = selectedModels(requiredValue(args, index, argument));
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!live) throw new Error("--live is required; no API requests were sent");
  if (fixturePaths.length === 0) throw new Error("At least one --fixture path is required");
  if (maxSpendUsd === undefined) {
    throw new Error("--max-spend-usd is required; no API requests were sent");
  }
  return {
    fixturePaths,
    repetitions,
    live,
    maxSpendUsd,
    reasoningEffort,
    models
  };
}

function estimatedCaseCost(
  benchmarkCase: LlmBenchmarkCase,
  models: readonly LlmEvaluationModel[]
): number {
  // One Unicode character per token plus a fixed request/schema allowance is
  // intentionally conservative and avoids depending on a tokenizer package.
  const inputTokens =
    JSON.stringify(benchmarkCase.fixture).length + ESTIMATE_OVERHEAD_INPUT_TOKENS;
  return models.reduce(
    (total, model) => total + estimateModelCostUsd(model, {
      inputTokens,
      cachedInputTokens: 0,
      outputTokens: MAX_OUTPUT_TOKENS_PER_REQUEST,
      totalTokens: inputTokens + MAX_OUTPUT_TOKENS_PER_REQUEST
    }),
    0
  );
}

export function estimatePaidLlmSuiteMaximumCost(
  cases: readonly LlmBenchmarkCase[],
  repetitions = DEFAULT_REPETITIONS,
  models: readonly LlmEvaluationModel[] = LLM_EVALUATION_MODELS
): number {
  const estimate = cases.reduce((sum, benchmarkCase) =>
    sum + estimatedCaseCost(benchmarkCase, models) * repetitions, 0);
  return Math.round(estimate * 1_000_000_000) / 1_000_000_000;
}

function ratio(numerator: number, denominator: number): RatioMetric {
  return {
    numerator,
    denominator,
    value: denominator === 0 ? null : numerator / denominator
  };
}

function distribution(values: readonly number[]): DistributionSummary {
  if (values.length === 0) return { count: 0, mean: null, p50: null, p95: null };
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (probability: number) =>
    sorted[Math.max(0, Math.ceil(probability * sorted.length) - 1)] ?? null;
  return {
    count: sorted.length,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p50: percentile(0.5),
    p95: percentile(0.95)
  };
}

function jaccard(left: readonly string[], right: readonly string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);
  if (union.size === 0) return 1;
  const intersection = [...leftSet].filter((id) => rightSet.has(id)).length;
  return intersection / union.size;
}

function selectionStability(
  values: ReadonlyArray<{ caseId: string; selectedEventIds: string[] }>
): SelectionStabilitySummary {
  const byCase = new Map<string, string[][]>();
  for (const value of values) {
    const existing = byCase.get(value.caseId) ?? [];
    existing.push(value.selectedEventIds);
    byCase.set(value.caseId, existing);
  }
  const comparisons: number[] = [];
  for (const selections of byCase.values()) {
    for (let left = 0; left < selections.length; left += 1) {
      for (let right = left + 1; right < selections.length; right += 1) {
        comparisons.push(jaccard(selections[left] ?? [], selections[right] ?? []));
      }
    }
  }
  return {
    meanPairwiseJaccard: comparisons.length === 0
      ? null
      : comparisons.reduce((sum, value) => sum + value, 0) / comparisons.length,
    comparisons: comparisons.length
  };
}

function actualRequest(result: LlmModelEvaluationResult): boolean {
  return result.status !== "not_run";
}

export function aggregatePaidLlmSuiteRuns(
  cases: readonly LlmBenchmarkCase[],
  runs: readonly LlmSuiteRunRecord[],
  models: readonly LlmEvaluationModel[] = LLM_EVALUATION_MODELS,
  reasoningEffort: LlmReasoningEffort = "low"
): LlmSuiteModelAggregate[] {
  const casesById = new Map(cases.map((benchmarkCase) => [
    benchmarkCase.fixture.id,
    benchmarkCase
  ]));

  return models.map((model) => {
    let exactNumerator = 0;
    let exactDenominator = 0;
    let precisionNumerator = 0;
    let precisionDenominator = 0;
    let fillNumerator = 0;
    let fillDenominator = 0;
    const results: Array<{ caseId: string; result: LlmModelEvaluationResult }> = [];

    for (const run of runs) {
      const benchmarkCase = casesById.get(run.caseId);
      if (!benchmarkCase) throw new Error(`Missing benchmark case ${run.caseId}`);
      const result = run.report.results.find((item) => item.model === model);
      if (!result) throw new Error(`Run ${run.caseId} is missing model ${model}`);
      results.push({ caseId: run.caseId, result });
      const score = scoreLlmBenchmarkCase(
        benchmarkCase,
        result.status === "completed" ? result.selectedEventIds : []
      );
      exactNumerator += score.exactRecall.numerator;
      exactDenominator += score.exactRecall.denominator;
      precisionNumerator += score.precisionAmongSelected.numerator;
      precisionDenominator += score.precisionAmongSelected.denominator;
      fillNumerator += score.usefulFill.numerator;
      fillDenominator += score.usefulFill.denominator;
    }

    const requestResults = results
      .map((item) => item.result)
      .filter(actualRequest);
    const invalidCount = requestResults.filter(
      (result) => result.status === "invalid_schema"
    ).length;
    const apiErrorCount = requestResults.filter(
      (result) => result.status === "api_error"
    ).length;
    const knownCosts = requestResults
      .map((result) => result.estimatedCostUsd)
      .filter((cost): cost is number => cost !== null);
    const totalCostUsd = knownCosts.reduce((sum, cost) => sum + cost, 0);
    const completedSelections = results
      .filter((item) => item.result.status === "completed")
      .map((item) => ({
        caseId: item.caseId,
        selectedEventIds: item.result.selectedEventIds
      }));

    return {
      model,
      reasoningEffort,
      scheduledRuns: results.length,
      requestCount: requestResults.length,
      completedRuns: results.filter((item) => item.result.status === "completed").length,
      notRunCount: results.filter((item) => item.result.status === "not_run").length,
      exactRecall: ratio(exactNumerator, exactDenominator),
      precisionAmongSelected: ratio(precisionNumerator, precisionDenominator),
      usefulFill: ratio(fillNumerator, fillDenominator),
      invalidSchemaRate: ratio(invalidCount, requestResults.length),
      apiErrorRate: ratio(apiErrorCount, requestResults.length),
      failureRate: ratio(invalidCount + apiErrorCount, requestResults.length),
      latencyMs: distribution(
        requestResults
          .map((result) => result.latencyMs)
          .filter((latency): latency is number => latency !== null)
      ),
      cost: {
        requestCount: requestResults.length,
        knownCostRequestCount: knownCosts.length,
        unknownCostRequestCount: requestResults.length - knownCosts.length,
        totalCostUsd,
        meanCostPerRequestUsd: requestResults.length === 0
          ? null
          : totalCostUsd / requestResults.length,
        meanKnownCostUsd: knownCosts.length === 0
          ? null
          : totalCostUsd / knownCosts.length
      },
      selectionStability: selectionStability(completedSelections)
    };
  });
}

function reportKnownCost(report: LlmComparisonReport): number {
  return report.results.reduce(
    (sum, result) => sum + (result.estimatedCostUsd ?? 0),
    0
  );
}

function billingExhausted(report: LlmComparisonReport): boolean {
  return report.results.some((result) =>
    result.status === "api_error" &&
    /no credits remaining|billing|insufficient_quota/i.test(result.error ?? "")
  );
}

export async function runPaidLlmSuite(
  options: RunPaidLlmSuiteOptions
): Promise<PaidLlmSuiteReport> {
  const repetitions = options.repetitions ?? DEFAULT_REPETITIONS;
  const reasoningEffort = options.reasoningEffort ?? "low";
  const models = options.models?.length ? [...options.models] : [...LLM_EVALUATION_MODELS];
  if (!options.live) throw new Error("Live mode is required; no API requests were sent");
  if (!options.apiKey?.trim()) {
    throw new Error("OPENAI_API_KEY is required; no API requests were sent");
  }
  if (options.cases.length === 0) throw new Error("At least one benchmark case is required");
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > MAX_REPETITIONS) {
    throw new Error(`repetitions must be an integer from 1 to ${MAX_REPETITIONS}`);
  }
  if (!Number.isFinite(options.maxSpendUsd) || options.maxSpendUsd <= 0) {
    throw new Error("maxSpendUsd must be a positive USD amount");
  }
  if (reasoningEffort !== "low" && reasoningEffort !== "medium") {
    throw new Error("reasoningEffort must be low or medium");
  }
  const unknownModels = models.filter((model) => !LLM_EVALUATION_MODELS.includes(model));
  if (unknownModels.length > 0) {
    throw new Error(`Unknown model(s): ${unknownModels.join(", ")}`);
  }
  if (new Set(models).size !== models.length) {
    throw new Error("models cannot contain duplicates");
  }

  const estimatedMaximumSpendUsd = estimatePaidLlmSuiteMaximumCost(
    options.cases,
    repetitions,
    models
  );
  if (estimatedMaximumSpendUsd > options.maxSpendUsd) {
    throw new Error(
      `Estimated maximum spend $${estimatedMaximumSpendUsd.toFixed(6)} exceeds ` +
      `--max-spend-usd $${options.maxSpendUsd.toFixed(6)}; no API requests were sent`
    );
  }

  const runs: LlmSuiteRunRecord[] = [];
  let actualKnownSpendUsd = 0;
  let stoppedEarly = false;
  let stopReason: string | undefined;

  runLoop: for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    for (const benchmarkCase of options.cases) {
      const nextRunEstimate = estimatedCaseCost(benchmarkCase, models);
      if (actualKnownSpendUsd + nextRunEstimate > options.maxSpendUsd) {
        stoppedEarly = true;
        stopReason = "Stopped before the next comparison to preserve the max spend guard";
        break runLoop;
      }
      const report = await runLlmComparison(benchmarkCase.fixture, {
        live: true,
        apiKey: options.apiKey,
        fetchImpl: options.fetchImpl,
        nowMs: options.nowMs,
        reasoningEffort,
        models
      });
      runs.push({ caseId: benchmarkCase.fixture.id, repetition, report });
      actualKnownSpendUsd += reportKnownCost(report);
      if (actualKnownSpendUsd > options.maxSpendUsd) {
        stoppedEarly = true;
        stopReason = "Stopped after reported usage exceeded the max spend guard";
        break runLoop;
      }
      if (billingExhausted(report)) {
        stoppedEarly = true;
        stopReason = "Stopped because the API account reported insufficient credits";
        break runLoop;
      }
    }
  }

  const repetitionsCompleted = Array.from(
    { length: repetitions },
    (_, index) => index + 1
  ).filter((repetition) => options.cases.every((benchmarkCase) =>
    runs.some((run) =>
      run.repetition === repetition && run.caseId === benchmarkCase.fixture.id
    )
  )).length;
  return {
    schemaVersion: 1,
    mode: "live",
    reasoningEffort,
    models,
    fixtureIds: options.cases.map((benchmarkCase) => benchmarkCase.fixture.id),
    repetitionsRequested: repetitions,
    repetitionsCompleted,
    budget: {
      maxSpendUsd: options.maxSpendUsd,
      estimatedMaximumSpendUsd,
      actualKnownSpendUsd,
      stoppedEarly,
      ...(stopReason ? { stopReason } : {})
    },
    aggregates: aggregatePaidLlmSuiteRuns(
      options.cases,
      runs,
      models,
      reasoningEffort
    ),
    runs
  };
}

function percentage(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

export function formatPaidLlmSuiteSummary(report: PaidLlmSuiteReport): string {
  const lines = [
    `Front Row paid LLM suite: ${report.fixtureIds.length} fixtures × ${report.repetitionsRequested} repetitions (${report.reasoningEffort})`,
    `Budget: estimated ≤ $${report.budget.estimatedMaximumSpendUsd.toFixed(6)}; known actual $${report.budget.actualKnownSpendUsd.toFixed(6)} / $${report.budget.maxSpendUsd.toFixed(6)}`
  ];
  for (const aggregate of report.aggregates) {
    lines.push(
      `${aggregate.model}+${aggregate.reasoningEffort}: recall ${percentage(aggregate.exactRecall.value)}; ` +
      `precision ${percentage(aggregate.precisionAmongSelected.value)}; ` +
      `fill ${percentage(aggregate.usefulFill.value)}; ` +
      `failures ${percentage(aggregate.failureRate.value)}; ` +
      `latency mean/p50/p95 ${aggregate.latencyMs.mean ?? "n/a"}/${aggregate.latencyMs.p50 ?? "n/a"}/${aggregate.latencyMs.p95 ?? "n/a"}ms; ` +
      `cost total/mean $${aggregate.cost.totalCostUsd.toFixed(6)}/${aggregate.cost.meanCostPerRequestUsd?.toFixed(6) ?? "n/a"}; ` +
      `stability ${percentage(aggregate.selectionStability.meanPairwiseJaccard)}`
    );
  }
  if (report.budget.stopReason) lines.push(report.budget.stopReason);
  return lines.join("\n");
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const parsed = parseLlmSuiteCliArguments(args);
  const cases = await Promise.all(parsed.fixturePaths.map((path) =>
    loadLlmBenchmarkCase(pathToFileURL(resolve(path)))
  ));
  const report = await runPaidLlmSuite({
    cases,
    repetitions: parsed.repetitions,
    live: parsed.live,
    maxSpendUsd: parsed.maxSpendUsd,
    apiKey: process.env.OPENAI_API_KEY,
    reasoningEffort: parsed.reasoningEffort,
    models: parsed.models
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stderr.write(`${formatPaidLlmSuiteSummary(report)}\n`);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
