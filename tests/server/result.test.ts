import { describe, expect, it } from "vitest";

import type {
  NormalizedEvent,
  ProviderDiagnostic,
  RecommendationFunnel
} from "../../src/core/types.js";
import { deriveDataMode, recommendationCoverage } from "../../src/server/result.js";

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

  it("derives legacy coverage counts from the detailed selection funnel", () => {
    const funnel: RecommendationFunnel = {
      inputEvents: 210,
      deduplicatedEvents: 161,
      insideForecast: 150,
      withVenueCoordinates: 148,
      activeNonTribute: 140,
      insideTravelBoundary: 42,
      preferenceEligible: 9,
      selectedEvents: 7,
      rejected: {
        duplicate_event: 49,
        outside_forecast: 11,
        missing_venue_coordinates: 2,
        tribute_event: 1,
        inactive_event: 7,
        outside_travel_boundary: 98,
        no_preference_affinity: 33,
        exploration_cap: 2,
        result_limit: 0
      }
    };

    expect(recommendationCoverage(210, funnel)).toEqual({
      rawEvents: 210,
      deduplicatedEvents: 161,
      eligibleEvents: 7,
      funnel
    });
  });
});
