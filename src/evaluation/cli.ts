import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  evaluateBenchmark,
  formatBenchmarkSummary,
  loadBenchmarkFixture
} from "./benchmark.js";

const defaultFixture = new URL(
  "../../tests/evaluation/fixtures/front-row-baseline.json",
  import.meta.url
);
const fixtureSource = process.argv[2]
  ? pathToFileURL(resolve(process.argv[2]))
  : defaultFixture;

const fixture = await loadBenchmarkFixture(fixtureSource);
const report = evaluateBenchmark(fixture);

// Keep stdout valid JSON for automation; the concise human summary goes to stderr.
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.stderr.write(`${formatBenchmarkSummary(report)}\n`);
