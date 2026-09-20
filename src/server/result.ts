import type {
  NormalizedEvent,
  ProviderDiagnostic,
  RecommendationFunnel,
  ValidationResult
} from "../core/types.js";

export function deriveDataMode(
  events: NormalizedEvent[],
  diagnostics: ProviderDiagnostic[]
): ValidationResult["dataMode"] {
  const sourceModes = new Set(events.flatMap((event) => event.sources.map((source) => source.mode)));
  if (sourceModes.has("live") && sourceModes.has("fixture")) return "mixed";
  if (sourceModes.has("live")) return "live";
  if (sourceModes.has("fixture")) return "fixture";

  const successfulModes = new Set(
    diagnostics
      .filter((diagnostic) => diagnostic.status === "success")
      .map((diagnostic) => diagnostic.mode)
  );
  if (successfulModes.has("live")) return "live";
  if (successfulModes.has("fixture")) return "fixture";
  return "unavailable";
}

export function recommendationCoverage(
  rawEventCount: number,
  funnel: RecommendationFunnel
): ValidationResult["coverage"] {
  return {
    rawEvents: rawEventCount,
    deduplicatedEvents: funnel.deduplicatedEvents,
    eligibleEvents: funnel.selectedEvents,
    funnel
  };
}
