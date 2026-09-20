import { describe, expect, it } from "vitest";

import { buildRecommendationSelection } from "../../src/core/index.js";
import type { NormalizedEvent, ValidationInput } from "../../src/core/types.js";
import { hydrateExplicitArtists } from "../../src/discovery/hydrateExplicitArtists.js";

const JJ_LIN_MBID = "1d25f0f7-4257-4a77-a27b-2e9b4f612364";

describe("explicit artist identity hydration", () => {
  it("keeps the user's Chinese display name while adding MBID and confirmed English aliases", async () => {
    const [artist] = await hydrateExplicitArtists(
      [{ name: "林俊杰", weight: "priority", canonicalId: "frontrow:temporary" }],
      {
        resolveArtist: async () => ({ id: JJ_LIN_MBID, name: "林俊傑", score: 100 }),
        artistDetails: async () => ({
          id: JJ_LIN_MBID,
          name: "林俊傑",
          aliases: ["JJ Lin", "Lin Junjie", "林俊杰", "JJ Lin"]
        })
      }
    );

    expect(artist).toEqual({
      name: "林俊杰",
      weight: "priority",
      canonicalId: `musicbrainz:${JJ_LIN_MBID}`,
      aliases: ["林俊傑", "JJ Lin", "Lin Junjie"]
    });
  });

  it("lets an English provider performer remain an exact T1 match with the original name in the reason", async () => {
    const [artist] = await hydrateExplicitArtists(
      [{ name: "林俊杰", weight: "priority" }],
      {
        resolveArtist: async () => ({ id: JJ_LIN_MBID, name: "林俊傑", score: 100 }),
        artistDetails: async () => ({
          id: JJ_LIN_MBID,
          name: "林俊傑",
          aliases: ["JJ Lin"]
        })
      }
    );
    if (!artist) throw new Error("Expected a hydrated artist");

    const input: ValidationInput = {
      artists: [artist],
      genres: [],
      languages: [],
      languageMode: "any",
      origin: { label: "Oakland", latitude: 37.8044, longitude: -122.2712 },
      maxTravelMinutes: 120,
      forecastMonths: 4
    };
    const event: NormalizedEvent = {
      canonicalKey: "jj-lin|oakland-arena|2026-10-10",
      name: "JJ Lin Live",
      startAt: "2026-10-10T20:00:00-07:00",
      status: "active",
      venue: {
        name: "Oakland Arena",
        city: "Oakland",
        region: "CA",
        coordinates: { latitude: 37.7503, longitude: -122.2028 }
      },
      performers: [{ name: "JJ Lin", canonicalId: "provider:jj-lin" }],
      genres: [],
      languages: [],
      sources: [
        {
          provider: "ticketmaster",
          eventId: "tm-jj-lin",
          fetchedAt: "2026-09-20T12:00:00.000Z",
          mode: "live"
        }
      ]
    };

    const selection = buildRecommendationSelection(input, [event], {
      now: new Date("2026-09-20T12:00:00.000Z")
    });

    expect(selection.recommendations[0]).toMatchObject({ tier: "T1" });
    expect(selection.recommendations[0]?.reason).toContain("林俊杰");
  });

  it("uses resolved identity when details fail, and leaves the original untouched when resolution fails", async () => {
    const original = { name: "Unknown Artist", weight: "like" as const };
    const resolvedOnly = await hydrateExplicitArtists([original], {
      resolveArtist: async () => ({ id: JJ_LIN_MBID, name: "Official Artist", score: 100 }),
      artistDetails: async () => {
        throw new Error("temporary details outage");
      }
    });
    const unresolved = await hydrateExplicitArtists([original], {
      resolveArtist: async () => {
        throw new Error("temporary search outage");
      },
      artistDetails: async () => undefined
    });

    expect(resolvedOnly[0]).toEqual({
      ...original,
      canonicalId: `musicbrainz:${JJ_LIN_MBID}`,
      aliases: ["Official Artist"]
    });
    expect(unresolved[0]).toEqual(original);
  });

  it("ignores mismatched detail payloads rather than accepting unrelated aliases", async () => {
    const [artist] = await hydrateExplicitArtists(
      [{ name: "Seed", weight: "occasional", aliases: ["Existing Alias"] }],
      {
        resolveArtist: async () => ({ id: JJ_LIN_MBID, name: "Official Seed", score: 100 }),
        artistDetails: async () => ({
          id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          name: "Different Artist",
          aliases: ["Wrong Alias"]
        })
      }
    );

    expect(artist?.aliases).toEqual(["Existing Alias", "Official Seed"]);
    expect(artist?.aliases).not.toContain("Wrong Alias");
  });
});
