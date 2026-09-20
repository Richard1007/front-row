import { describe, expect, it } from "vitest";

import type { NormalizedEvent, ProviderDiagnostic } from "../../src/core/types.js";
import { deriveDataMode } from "../../src/server/result.js";

describe("deriveDataMode", () => {
  it("does not mislabel an all-failed live run as fixture data", () => {
    const diagnostics: ProviderDiagnostic[] = [
      {
        provider: "ticketmaster",
        mode: "live",
        status: "failed",
        eventCount: 0,
        message: "timeout"
      }
    ];
    expect(deriveDataMode([], diagnostics)).toBe("unavailable");
  });

  it("reports a successful empty live query as live", () => {
    const diagnostics: ProviderDiagnostic[] = [
      { provider: "jambase", mode: "live", status: "success", eventCount: 0 }
    ];
    expect(deriveDataMode([], diagnostics)).toBe("live");
  });

  it("reports mixed only when both kinds of data actually participated", () => {
    const event = {
      sources: [
        { provider: "fixture", eventId: "fixture-1", fetchedAt: "2026-09-19T00:00:00Z", mode: "fixture" },
        { provider: "ticketmaster", eventId: "tm-1", fetchedAt: "2026-09-19T00:00:00Z", mode: "live" }
      ]
    } as NormalizedEvent;
    expect(deriveDataMode([event], [])).toBe("mixed");
  });
});
