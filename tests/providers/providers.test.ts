import { describe, expect, it, vi } from "vitest";
import jambaseResponse from "../../fixtures/providers/jambase-events-response.json";
import ticketmasterResponse from "../../fixtures/providers/ticketmaster-events-response.json";
import type { NormalizedEvent, ValidationInput } from "../../src/core/types";
import { FixtureProvider } from "../../src/providers/fixture";
import { JamBaseProvider, normalizeJamBaseEvent } from "../../src/providers/jambase";
import { createProviderRegistry } from "../../src/providers/providerRegistry";
import { StubHubProvider } from "../../src/providers/stubhub";
import {
  normalizeTicketmasterEvent,
  TicketmasterProvider,
} from "../../src/providers/ticketmaster";
import type { EventProvider } from "../../src/providers/types";
import { ProviderUnavailableError } from "../../src/providers/types";
import { preferredArtistQueryName, safeProviderUrl } from "../../src/providers/utils";

const NOW = new Date("2026-09-19T18:00:00.000Z");

const input: ValidationInput = {
  artists: [
    { name: "王力宏", weight: "priority" },
    { name: "Bruno Mars", weight: "like" },
  ],
  genres: [
    { name: "Mandopop", weight: "priority" },
    { name: "R&B", weight: "like" },
  ],
  languages: [
    { language: "Mandarin", percentage: 90 },
    { language: "English", percentage: 10 },
  ],
  languageMode: "weighted",
  origin: { label: "Oakland, CA", latitude: 37.8044, longitude: -122.2712 },
  maxTravelMinutes: 120,
  forecastMonths: 4,
};

describe("provider contract", () => {
  it("prefers an ASCII alias when querying ticket providers", () => {
    expect(preferredArtistQueryName({
      name: "林俊傑",
      aliases: ["林俊傑", "JJ Lin"]
    })).toBe("JJ Lin");
  });

  it("returns an offline Wang Leehom Bay Area scenario", async () => {
    const provider = new FixtureProvider({ now: () => NOW });
    const events = await provider.fetchEvents(input);

    expect(events.some((event) => event.performers.some((artist) => artist.name === "王力宏"))).toBe(true);
    expect(events.some((event) => event.venue.city === "San Francisco")).toBe(true);
    expect(events.some((event) => event.venue.city === "Inglewood")).toBe(false);
    expect(events.some((event) => event.isTribute)).toBe(true);
    assertNormalizedEvents(events, "fixture");
  });

  it("builds direct Ticketmaster artist searches and normalizes optional fields", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_request, _init) =>
      jsonResponse(ticketmasterResponse),
    );
    const provider = new TicketmasterProvider({
      apiKey: "tm_test_secret",
      fetch: fetcher as typeof fetch,
      now: () => NOW,
      minRequestIntervalMs: 0,
    });

    const events = await provider.fetchEvents(input);

    expect(fetcher).toHaveBeenCalledTimes(3);
    const firstUrl = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(firstUrl.origin + firstUrl.pathname).toBe(
      "https://app.ticketmaster.com/discovery/v2/events.json",
    );
    expect(firstUrl.searchParams.get("attractionId")).toBe("K8vZ9173-Uf");
    expect(firstUrl.searchParams.has("keyword")).toBe(false);
    expect(firstUrl.searchParams.get("classificationName")).toBe("Music");
    expect(firstUrl.searchParams.get("startDateTime")).toBe("2026-09-19T18:00:00Z");
    expect(firstUrl.searchParams.get("endDateTime")).toBe("2027-01-19T18:00:00Z");
    expect(firstUrl.searchParams.get("radius")).toBe("90");
    expect(firstUrl.searchParams.get("geoPoint")).toMatch(/^[0-9b-hjkmnp-z]{9}$/);
    const regionalUrl = new URL(String(fetcher.mock.calls[2]?.[0]));
    expect(regionalUrl.searchParams.has("attractionId")).toBe(false);
    expect(regionalUrl.searchParams.has("keyword")).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      status: "active",
      genres: ["Pop", "R&B"],
      venue: { city: "San Francisco", region: "CA" },
      performers: [{ name: "王力宏", canonicalId: "artist-wang" }],
      onSaleAt: "2026-09-20T17:00:00Z",
    });
    assertNormalizedEvents(events, "ticketmaster");
  });

  it("keeps successful Ticketmaster results when an artist query fails", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: "temporary" }, 503))
      .mockResolvedValue(jsonResponse(ticketmasterResponse));
    const provider = new TicketmasterProvider({
      apiKey: "tm_test_secret",
      fetch: fetcher,
      now: () => NOW,
      minRequestIntervalMs: 0,
    });

    const events = await provider.fetchEvents(input);

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(events).toHaveLength(1);
  });

  it("uses JamBase v3 Bearer auth, User-Agent, and compatible filters", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_request, _init) =>
      jsonResponse(jambaseResponse),
    );
    const provider = new JamBaseProvider({
      apiKey: "jbd_test_secret",
      fetch: fetcher as typeof fetch,
      now: () => NOW,
      userAgent: "FrontRow-Test/1.0",
    });

    const events = await provider.fetchEvents(input);

    expect(fetcher).toHaveBeenCalledTimes(3);
    const [rawUrl, init] = fetcher.mock.calls[0] ?? [];
    const url = new URL(String(rawUrl));
    expect(url.origin + url.pathname).toBe("https://api.data.jambase.com/v3/events");
    expect(url.searchParams.get("artistId")).toBe("jambase:5911976");
    expect(url.searchParams.has("artistName")).toBe(false);
    expect(url.searchParams.get("eventDateFrom")).toBe("2026-09-19");
    expect(url.searchParams.get("eventDateTo")).toBe("2027-01-19");
    expect(url.searchParams.get("geoLatitude")).toBe("37.8044");
    expect(url.searchParams.get("geoLongitude")).toBe("-122.2712");
    expect(url.searchParams.get("geoRadiusAmount")).toBe("90");
    const secondArtistUrl = new URL(String(fetcher.mock.calls[1]?.[0]));
    expect(secondArtistUrl.searchParams.get("artistId")).toBe("jambase:276337");
    const regionalUrl = new URL(String(fetcher.mock.calls[2]?.[0]));
    expect(regionalUrl.searchParams.has("artistId")).toBe(false);
    expect(regionalUrl.searchParams.has("artistName")).toBe(false);
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer jbd_test_secret");
    expect(headers.get("User-Agent")).toBe("FrontRow-Test/1.0");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      status: "active",
      genres: ["mandopop", "r&b"],
      venue: { city: "San Francisco", region: "US-CA" },
      performers: [{ name: "王力宏", role: "headliner" }],
      onSaleAt: "2026-09-20T10:00:00-07:00",
    });
    assertNormalizedEvents(events, "jambase");
  });

  it("keeps the JamBase regional result when its artist query fails", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: "temporary" }, 503))
      .mockResolvedValue(jsonResponse(jambaseResponse));
    const provider = new JamBaseProvider({
      apiKey: "jbd_test_secret",
      fetch: fetcher,
      now: () => NOW,
    });

    const events = await provider.fetchEvents(input);

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(events).toHaveLength(1);
  });

  it("marks explicit postponed and cancelled title listings inactive", () => {
    const postponedTicketmaster = structuredClone(ticketmasterResponse._embedded.events[0]!);
    postponedTicketmaster.name =
      "Pablo Cruise [Event Postponed to 12/6 at Uptown Theatre Napa]";
    const cancelledJamBase = structuredClone(jambaseResponse.events[0]!);
    cancelledJamBase.name = "Artist Live — Event Canceled";

    const ticketmaster = normalizeTicketmasterEvent(postponedTicketmaster, NOW);
    const jambase = normalizeJamBaseEvent(cancelledJamBase, NOW);

    expect(ticketmaster).toMatchObject({
      status: "postponed",
      notes: expect.arrayContaining([
        "Provider title indicates an obsolete postponed or rescheduled listing",
      ]),
    });
    expect(jambase).toMatchObject({
      status: "cancelled",
      notes: expect.arrayContaining(["Provider title indicates a cancelled listing"]),
    });
  });

  it("marks explicit old reschedule targets inactive for both providers", () => {
    const ticketmasterFixture = structuredClone(ticketmasterResponse._embedded.events[0]!);
    ticketmasterFixture.name = "Artist Live — Event Rescheduled to December 6";
    const jambaseFixture = structuredClone(jambaseResponse.events[0]!);
    jambaseFixture.name = "Artist Live moved to a new venue";

    expect(normalizeTicketmasterEvent(ticketmasterFixture, NOW)?.status).toBe("postponed");
    expect(normalizeJamBaseEvent(jambaseFixture, NOW)?.status).toBe("postponed");
  });

  it("keeps a replacement show labelled as a rescheduled date active", () => {
    const ticketmasterFixture = structuredClone(ticketmasterResponse._embedded.events[0]!);
    ticketmasterFixture.name = "Artist Live — Rescheduled Date";
    ticketmasterFixture.dates.status.code = "rescheduled";
    const jambaseFixture = structuredClone(jambaseResponse.events[0]!);
    jambaseFixture.name = "Artist Live (Rescheduled Date)";
    jambaseFixture.eventStatus = "rescheduled";

    expect(normalizeTicketmasterEvent(ticketmasterFixture, NOW)).toMatchObject({
      status: "active",
      notes: ["Ticketmaster status: rescheduled"],
    });
    expect(normalizeJamBaseEvent(jambaseFixture, NOW)).toMatchObject({
      status: "active",
      notes: ["JamBase status: rescheduled"],
    });
  });

  it("rejects hostile or malformed outbound provider URLs", () => {
    expect(safeProviderUrl("ticketmaster", "https://www.ticketmaster.com/event/123")).toBe(
      "https://www.ticketmaster.com/event/123",
    );
    expect(safeProviderUrl("jambase", "https://www.jambase.com/show/123")).toBe(
      "https://www.jambase.com/show/123",
    );
    expect(safeProviderUrl("fixture", "https://example.test/event/123")).toBe(
      "https://example.test/event/123",
    );
    expect(
      safeProviderUrl("ticketmaster", "https://ticketmaster.com.evil.example/event/123"),
    ).toBeUndefined();
    expect(
      safeProviderUrl("ticketmaster", "https://evil-ticketmaster.com/event/123"),
    ).toBeUndefined();
    expect(
      safeProviderUrl("ticketmaster", "http://www.ticketmaster.com/event/123"),
    ).toBeUndefined();
    expect(
      safeProviderUrl("jambase", "https://user:password@www.jambase.com/show/123"),
    ).toBeUndefined();
    expect(
      safeProviderUrl("jambase", "https://www.jambase.com:8443/show/123"),
    ).toBeUndefined();
    expect(safeProviderUrl("fixture", "not a URL")).toBeUndefined();

    const hostileFixture = structuredClone(ticketmasterResponse);
    hostileFixture._embedded.events[0]!.url =
      "https://www.ticketmaster.com.attacker.example/steal";
    const normalized = normalizeTicketmasterEvent(hostileFixture._embedded.events[0], NOW);
    expect(normalized?.sources[0]?.url).toBeUndefined();
  });

  it("keeps StubHub partner-gated without a network implementation", async () => {
    const provider = new StubHubProvider();

    expect(provider.capability()).toMatchObject({
      id: "stubhub",
      mode: "disabled",
    });
    expect(provider.capability().message).toContain("合作方");
    await expect(provider.fetchEvents(input)).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("supports the explicit fixture mode", async () => {
    const registry = createProviderRegistry(
      { FR_DATA_MODE: "fixture" },
      { now: () => NOW },
    );

    expect(registry.capabilities()).toHaveLength(4);
    const result = await registry.fetchEvents(input);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.diagnostics).toHaveLength(4);
    expect(result.diagnostics.find((item) => item.provider === "fixture")).toMatchObject({
      status: "success",
    });
    expect(result.diagnostics.find((item) => item.provider === "stubhub")).toMatchObject({
      status: "skipped",
      mode: "disabled",
    });
  });

  it("defaults to live mode and never silently returns fixture events", async () => {
    const registry = createProviderRegistry({}, { now: () => NOW });

    expect(registry.capabilities().find((item) => item.id === "fixture")).toMatchObject({
      mode: "disabled",
    });
    const result = await registry.fetchEvents(input);
    expect(result.events).toEqual([]);
    expect(result.diagnostics.find((item) => item.provider === "fixture")).toMatchObject({
      status: "skipped",
      mode: "disabled",
    });
  });

  it("keeps one live provider's success when another provider fails", async () => {
    const sample = (await new FixtureProvider({ now: () => NOW }).fetchEvents(input))[0];
    if (!sample) throw new Error("Expected fixture event for registry test.");
    const failingProvider: EventProvider = {
      id: "ticketmaster",
      capability: () => ({
        id: "ticketmaster",
        label: "Failing Ticketmaster",
        mode: "live",
        message: "configured",
      }),
      fetchEvents: async () => {
        throw new Error("temporary Ticketmaster outage");
      },
    };
    const successfulProvider: EventProvider = {
      id: "jambase",
      capability: () => ({
        id: "jambase",
        label: "Working JamBase",
        mode: "live",
        message: "configured",
      }),
      fetchEvents: async () => [
        {
          ...sample,
          sources: [
            {
              provider: "jambase",
              eventId: "jambase:survivor",
              fetchedAt: NOW.toISOString(),
              mode: "live",
            },
          ],
        },
      ],
    };
    const registry = createProviderRegistry(
      { FR_DATA_MODE: "live" },
      { providers: [failingProvider, successfulProvider] },
    );

    const result = await registry.fetchEvents(input);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.sources[0]?.provider).toBe("jambase");
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: "ticketmaster", status: "failed" }),
        expect.objectContaining({ provider: "jambase", status: "success", eventCount: 1 }),
      ]),
    );
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function assertNormalizedEvents(
  events: NormalizedEvent[],
  provider: "ticketmaster" | "jambase" | "fixture",
): void {
  for (const event of events) {
    expect(event.canonicalKey).toBeTruthy();
    expect(event.name).toBeTruthy();
    expect(event.startAt).toBeTruthy();
    expect(event.venue.name).toBeTruthy();
    expect(Array.isArray(event.performers)).toBe(true);
    expect(Array.isArray(event.genres)).toBe(true);
    expect(Array.isArray(event.languages)).toBe(true);
    expect(event.sources).toHaveLength(1);
    expect(event.sources[0]?.provider).toBe(provider);
    expect(event.sources[0]?.eventId).toBeTruthy();
  }
}
