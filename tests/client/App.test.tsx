// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../../src/client/App";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear()
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ providers: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("simple preference form", () => {
  it("shows four preference sections without editable coordinates", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Artists you most want to see" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Music styles you enjoy" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Accepted performance languages" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Location" })).toBeTruthy();
    expect(screen.queryByLabelText("Latitude")).toBeNull();
    expect(screen.queryByLabelText("Longitude")).toBeNull();
  });

  it("limits categorical language selection to three", () => {
    render(<App />);

    const languageSection = screen.getByRole("heading", { name: "Accepted performance languages" })
      .closest("section")!;
    const languageControls = within(languageSection);
    fireEvent.click(languageControls.getByRole("button", { name: "Chinese / Mandarin" }));
    fireEvent.click(languageControls.getByRole("button", { name: "English" }));
    fireEvent.click(languageControls.getByRole("button", { name: "French" }));

    expect((languageControls.getByRole("button", { name: "Cantonese" }) as HTMLButtonElement).disabled).toBe(true);
    expect(languageControls.getByText("3 / 3")).toBeTruthy();
  });

  it("loads a confirmed Oakland example without exposing its coordinates", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Try the Wang Leehom example" }));

    expect((screen.getByLabelText("artist 1 name") as HTMLInputElement).value).toBe("王力宏");
    expect((screen.getByRole("combobox", { name: "City" }) as HTMLInputElement).value)
      .toBe("Oakland, California, United States");
    expect(screen.queryByDisplayValue("37.8044")).toBeNull();
  });

  it("explains accepted languages and the recommendation tiers concisely", () => {
    render(<App />);

    expect(screen.getByText(/not a recommendation quota/i)).toBeTruthy();
    expect(screen.getByText("What T0–T3 mean")).toBeTruthy();
    expect(screen.getByText("A confirmed show by an artist you selected.")).toBeTruthy();
    expect(screen.getByText(/Up to five discovery picks/)).toBeTruthy();
    expect(screen.getByText(/selected artists come first/)).toBeTruthy();
  });

  it("shows the truthful result funnel supported by the current API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const body = url.includes("/api/validation-runs")
          ? {
              runId: "run-1",
              generatedAt: "2026-09-20T12:00:00.000Z",
              dataMode: "live",
              recommendations: [],
              diagnostics: [
                {
                  provider: "ticketmaster",
                  mode: "live",
                  status: "success",
                  eventCount: 210
                }
              ],
              coverage: {
                rawEvents: 210,
                deduplicatedEvents: 161,
                eligibleEvents: 0,
                funnel: {
                  inputEvents: 210,
                  deduplicatedEvents: 161,
                  insideForecast: 150,
                  withVenueCoordinates: 145,
                  activeNonTribute: 140,
                  insideTravelBoundary: 50,
                  preferenceEligible: 0,
                  fallbackEligible: 0,
                  fallbackSelected: 0,
                  selectedEvents: 0,
                  rejected: {
                    duplicate_event: 49,
                    outside_forecast: 11,
                    missing_venue_coordinates: 5,
                    tribute_event: 2,
                    inactive_event: 3,
                    outside_travel_boundary: 90,
                    no_preference_affinity: 50,
                    exploration_cap: 0,
                    result_limit: 0
                  }
                }
              }
            }
          : { providers: [] };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      })
    );

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Try the Wang Leehom example" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate my recommendations" }));

    const funnel = await screen.findByRole("region", { name: "How this shortlist was made" });
    expect(within(funnel).getByText("210")).toBeTruthy();
    expect(within(funnel).getByText("161")).toBeTruthy();
    expect(within(funnel).getByText("Preference-backed")).toBeTruthy();
    expect(within(funnel).getByText("Duplicate listing: 49")).toBeTruthy();
    expect(within(funnel).getByText("Outside the travel range: 90")).toBeTruthy();
    expect(within(funnel).queryByText(/Extra exploration pick/)).toBeNull();
  });

  it("labels a nearby fallback clearly and does not show a misleading recommendation score", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const body = url.includes("/api/validation-runs")
          ? {
              runId: "fallback-run",
              generatedAt: "2026-09-20T12:00:00.000Z",
              dataMode: "live",
              recommendations: [{
                canonicalKey: "tm:fallback",
                name: "Nearby Live Show",
                startAt: "2026-10-10T03:00:00.000Z",
                status: "active",
                venue: { name: "Oakland Arena", city: "Oakland", region: "CA" },
                performers: [{ name: "Nearby Artist" }],
                genres: ["Rock"],
                languages: [],
                sources: [{
                  provider: "ticketmaster",
                  eventId: "fallback",
                  fetchedAt: "2026-09-20T12:00:00.000Z",
                  mode: "live"
                }],
                tier: "T3",
                isFallback: true,
                score: { coverage: 0.25, final: 0.9 },
                reason: "在你的出行范围内，作为少量探索推荐",
                warnings: ["没有找到可靠的偏好匹配。这是经过验证的附近演出，不代表强匹配"]
              }],
              diagnostics: [{
                provider: "ticketmaster",
                mode: "live",
                status: "success",
                eventCount: 1
              }],
              coverage: {
                rawEvents: 1,
                deduplicatedEvents: 1,
                eligibleEvents: 1,
                funnel: {
                  inputEvents: 1,
                  deduplicatedEvents: 1,
                  insideForecast: 1,
                  withVenueCoordinates: 1,
                  activeNonTribute: 1,
                  insideTravelBoundary: 1,
                  preferenceEligible: 0,
                  fallbackEligible: 1,
                  fallbackSelected: 1,
                  selectedEvents: 1,
                  rejected: {
                    duplicate_event: 0,
                    outside_forecast: 0,
                    missing_venue_coordinates: 0,
                    tribute_event: 0,
                    inactive_event: 0,
                    outside_travel_boundary: 0,
                    no_preference_affinity: 0,
                    exploration_cap: 0,
                    result_limit: 0
                  }
                }
              }
            }
          : { providers: [] };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      })
    );

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Try the Wang Leehom example" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate my recommendations" }));

    const card = (await screen.findByRole("heading", { name: "Nearby Live Show" })).closest("article")!;
    expect(within(card).getByText("Nearby fallback")).toBeTruthy();
    expect(within(card).queryByText("90 pts")).toBeNull();
    expect(within(card).queryByText("View score details")).toBeNull();
    expect(within(card).getByText(/not a strong match/i)).toBeTruthy();
    expect(screen.getByText("Nearby fallbacks")).toBeTruthy();
  });
});
