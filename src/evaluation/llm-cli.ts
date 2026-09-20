import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import "dotenv/config";

import { loadBenchmarkFixture } from "./benchmark.js";
import {
  formatLlmComparisonSummary,
  runLlmComparison
} from "./llm-comparison.js";

const args = new Set(process.argv.slice(2));
const live = args.has("--live");
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
  apiKey: process.env.OPENAI_API_KEY
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.stderr.write(`${formatLlmComparisonSummary(report)}\n`);
