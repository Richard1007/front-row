import { describe, expect, it } from "vitest";

import { deduplicateEvents, type NormalizedEvent } from "../../src/core/index.js";
import { normalizeJamBaseEvent } from "../../src/providers/jambase.js";
import { normalizeTicketmasterEvent } from "../../src/providers/ticketmaster.js";

function event(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    canonicalKey: "provider:event-1",
    name: "Wang Leehom Live",
    startAt: "2026-10-10T03:00:00.000Z",
    status: "active",
    venue: { name: "Oakland Arena", city: "Oakland" },
    performers: [{ name: "Wang Leehom", canonicalId: "artist:leehom" }],
    genres: ["Mandopop"],
    languages: [],
    sources: [
      {
        provider: "ticketmaster",
        eventId: "tm-1",
        url: "https://ticketmaster.test/1",
        fetchedAt: "2026-09-19T00:00:00.000Z",
        mode: "fixture"
      }
    ],
    ...overrides
  };
}

describe("deduplicateEvents", () => {
  it("merges equivalent normalized Ticketmaster and JamBase listings", () => {
    const ticketmaster = normalizeTicketmasterEvent(
      {
        id: "tm-wlh-oakland",
        name: "Wang Leehom Live",
        dates: {
          start: { dateTime: "2026-10-10T03:00:00.000Z" },
          status: { code: "onsale" }
        },
        _embedded: {
          venues: [
            {
              name: "Oakland Arena",
              city: { name: "Oakland" },
              state: { stateCode: "CA" },
              location: { latitude: "37.7503", longitude: "-122.2028" }
            }
          ],
          attractions: [{ id: "tm-artist-wlh", name: "Wang Leehom" }]
        }
      },
      new Date("2026-09-19T00:00:00.000Z")
    );
    const jambase = normalizeJamBaseEvent(
      {
        identifier: "jb-wlh-oakland",
        name: "王力宏演唱会",
        startDate: "2026-10-09T20:00:00-07:00",
        eventStatus: "EventScheduled",
        location: {
          name: "Oakland Arena at Oakland",
          address: { addressLocality: "Oakland", addressRegion: "CA" },
          geo: { latitude: 37.7503, longitude: -122.2028 }
        },
        performer: [{ identifier: "jb-artist-wlh", name: "王力宏", "x-isHeadliner": true }]
      },
      new Date("2026-09-19T00:00:00.000Z")
    );

    expect(ticketmaster).toBeDefined();
    expect(jambase).toBeDefined();
    const result = deduplicateEvents([ticketmaster!, jambase!]);

    expect(result).toHaveLength(1);
    expect(result[0]?.sources.map((source) => source.provider).sort()).toEqual([
      "jambase",
      "ticketmaster"
    ]);
  });

  it("merges the same cross-provider event and preserves provider links", () => {
    const jambase = event({
      canonicalKey: "jambase:event-77",
      name: "Wang Leehom Concert",
      startAt: "2026-10-10T03:30:00.000Z",
      venue: {
        name: "Oakland Arena",
        city: "Oakland",
        region: "CA",
        coordinates: { latitude: 37.7503, longitude: -122.2028 }
      },
      genres: ["R&B"],
      languages: [
        { language: "cmn", role: "primary", confidence: 0.9, source: "manual" }
      ],
      sources: [
        {
          provider: "jambase",
          eventId: "jb-77",
          url: "https://jambase.test/77",
          fetchedAt: "2026-09-19T00:00:00.000Z",
          mode: "fixture"
        }
      ]
    });

    const result = deduplicateEvents([jambase, event()]);

    expect(result).toHaveLength(1);
    expect(result[0]?.sources.map((source) => source.provider).sort()).toEqual([
      "jambase",
      "ticketmaster"
    ]);
    expect(result[0]?.genres).toEqual(expect.arrayContaining(["Mandopop", "R&B"]));
    expect(result[0]?.venue.coordinates).toBeDefined();
    expect(result[0]?.languages[0]?.language).toBe("cmn");
  });

  it("merges records sharing a canonical identity even when titles differ", () => {
    const result = deduplicateEvents([
      event(),
      event({
        name: "王力宏巡演",
        sources: [
          {
            provider: "jambase",
            eventId: "jb-1",
            fetchedAt: "2026-09-19T00:00:00.000Z",
            mode: "fixture"
          }
        ]
      })
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.sources).toHaveLength(2);
  });

  it("does not merge matching titles at different venues", () => {
    const result = deduplicateEvents([
      event({ canonicalKey: "a" }),
      event({
        canonicalKey: "b",
        venue: { name: "Chase Center", city: "San Francisco" },
        sources: [
          {
            provider: "jambase",
            eventId: "other",
            fetchedAt: "2026-09-19T00:00:00.000Z",
            mode: "fixture"
          }
        ]
      })
    ]);

    expect(result).toHaveLength(2);
  });

  it("does not merge same-day matinee and evening listings across providers", () => {
    const matinee = event({
      canonicalKey: "same-day-key",
      startAt: "2026-10-10T20:00:00.000Z",
      sources: [
        {
          provider: "ticketmaster",
          eventId: "tm-matinee",
          fetchedAt: "2026-09-19T00:00:00.000Z",
          mode: "fixture"
        }
      ]
    });
    const evening = event({
      canonicalKey: "same-day-key",
      startAt: "2026-10-11T03:00:00.000Z",
      sources: [
        {
          provider: "jambase",
          eventId: "jb-evening",
          fetchedAt: "2026-09-19T00:00:00.000Z",
          mode: "fixture"
        }
      ]
    });

    expect(deduplicateEvents([matinee, evening])).toHaveLength(2);
  });

  it("does not fuzzy-merge different IDs from the same provider", () => {
    const first = event({
      canonicalKey: "same-provider-key",
      sources: [
        {
          provider: "ticketmaster",
          eventId: "tm-first",
          fetchedAt: "2026-09-19T00:00:00.000Z",
          mode: "fixture"
        }
      ]
    });
    const second = event({
      canonicalKey: "same-provider-key",
      sources: [
        {
          provider: "ticketmaster",
          eventId: "tm-second",
          fetchedAt: "2026-09-19T00:00:00.000Z",
          mode: "fixture"
        }
      ]
    });

    expect(deduplicateEvents([first, second])).toHaveLength(2);
  });

  it("does not mutate the caller's source arrays", () => {
    const original = event();
    const originalSources = original.sources;
    deduplicateEvents([original]);
    expect(original.sources).toBe(originalSources);
  });
});
