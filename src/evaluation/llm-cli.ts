import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import "dotenv/config";

import { loadBenchmarkFixture } from "./benchmark.js";
import {
  LLM_EVALUATION_MODELS,
  formatLlmComparisonSummary,
  runLlmComparison,
  type LlmEvaluationModel
} from "./llm-comparison.js";

const args = new Set(process.argv.slice(2));
const live = args.has("--live");
const effortArgumentIndex = process.argv.indexOf("--effort");
const effortArgument = effortArgumentIndex === -1
  ? "low"
  : process.argv[effortArgumentIndex + 1];
if (effortArgument !== "low" && effortArgument !== "medium") {
  throw new Error("--effort must be low or medium");
}
const modelsArgumentIndex = process.argv.indexOf("--models");
const modelsArgument = modelsArgumentIndex === -1
  ? undefined
  : process.argv[modelsArgumentIndex + 1];
if (modelsArgumentIndex !== -1 && !modelsArgument) {
  throw new Error("--models requires a comma-separated model list");
}
const models = modelsArgument?.split(",").map((model) => model.trim());
if (models?.some((model) => !LLM_EVALUATION_MODELS.includes(model as LlmEvaluationModel))) {
  throw new Error(`--models must use: ${LLM_EVALUATION_MODELS.join(", ")}`);
}
const fixtureArgumentIndex = process.argv.indexOf("--fixture");
const fixtureArgument = fixtureArgumentIndex === -1
  ? undefined
  : process.argv[fixtureArgumentIndex + 1];
if (fixtureArgumentIndex !== -1 && !fixtureArgument) {
  throw new Error("--fixture requires a path");
}

const fixtureSource = fixtureArgument
  ? pathToFileURL(resolve(fixtureArgument))
  : new URL("../../tests/evaluation/fixtures/front-row-baseline.json", import.meta.url);
const fixture = await loadBenchmarkFixture(fixtureSource);
const report = await runLlmComparison(fixture, {
  live,
  apiKey: process.env.OPENAI_API_KEY,
  reasoningEffort: effortArgument,
  ...(models ? { models: models as LlmEvaluationModel[] } : {})
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.stderr.write(`${formatLlmComparisonSummary(report)}\n`);
