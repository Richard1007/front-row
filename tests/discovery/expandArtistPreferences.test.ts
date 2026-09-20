import { describe, expect, it, vi } from "vitest";

import { expandArtistPreferences } from "../../src/discovery/expandArtistPreferences.js";
import type { WeightedPreference } from "../../src/core/types.js";

describe("artist preference expansion", () => {
  it("caps each seed by preference weight and caps the complete result", async () => {
    const artists: WeightedPreference[] = [
      { name: "Occasional", weight: "occasional" },
      { name: "Priority", weight: "priority", canonicalId: "frontrow:priority" },
      { name: "Like", weight: "like" }
    ];
    const resolveArtist = vi.fn(async (name: string) => ({
      id: `seed-${name.toLocaleLowerCase("en-US")}`,
      name,
      score: 100
    }));
    const similarArtists = vi.fn(async (seedId: string, limit: number) =>
      Array.from({ length: limit }, (_, index) => ({
        id: `${seedId}-related-${index}`,
        name: `${seedId} related ${index}`,
        rank: index + 1
      }))
    );

    const result = await expandArtistPreferences(artists, {
      resolveArtist,
      similarArtists,
      maxCandidates: 10
    });

    expect(resolveArtist.mock.calls.map(([name]) => name)).toEqual(["Priority", "Like"]);
    expect(similarArtists.mock.calls.map(([, limit]) => limit)).toEqual([8, 5]);
    expect(result.candidates).toHaveLength(10);
    expect(result.candidates[0]).toMatchObject({
      canonicalId: "musicbrainz:seed-priority-related-0",
      evidence: [{ source: "listenbrainz", seedName: "Priority", seedWeight: "priority", rank: 1 }]
    });
  });

  it("deduplicates candidates while retaining evidence from each seed", async () => {
    const result = await expandArtistPreferences(
      [
        { name: "Seed A", weight: "priority" },
        { name: "Seed B", weight: "like" }
      ],
      {
        resolveArtist: async (name) => ({ id: name, name, score: 100 }),
        similarArtists: async () => [{ id: "shared", name: "Shared Artist", rank: 1 }]
      }
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.evidence.map((item) => item.seedName)).toEqual(["Seed A", "Seed B"]);
  });

  it("excludes selected artists and degrades gracefully per failing seed", async () => {
    const result = await expandArtistPreferences(
      [
        { name: "Selected", aliases: ["Selected Alias"], weight: "priority" },
        { name: "Ambiguous", weight: "like" },
        { name: "Unavailable", weight: "occasional" }
      ],
      {
        resolveArtist: async (name) => {
          if (name === "Ambiguous") return undefined;
          if (name === "Unavailable") throw new Error("network down");
          return { id: "selected-id", name, score: 100 };
        },
        similarArtists: async () => [
          { id: "alias-id", name: "Selected Alias", rank: 1 },
          { id: "new-id", name: "New Artist", rank: 2 }
        ]
      }
    );

    expect(result.candidates.map((artist) => artist.name)).toEqual(["New Artist"]);
    expect(result.diagnostics).toEqual([
      { seedName: "Selected", status: "expanded", candidateCount: 1 },
      { seedName: "Ambiguous", status: "unresolved", candidateCount: 0 },
      { seedName: "Unavailable", status: "failed", candidateCount: 0 }
    ]);
  });
});
