import type {
  NormalizedEvent,
  ProviderDiagnostic,
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
