import { describe, expect, it, vi } from "vitest";

import {
  inferArtistGenres,
  inferArtistGenresFromResolved
} from "../../src/discovery/inferArtistGenres.js";

describe("artist genre inference", () => {
  it("maps Omnipotent Youth Society metadata conservatively into the controlled pool", () => {
    const result = inferArtistGenresFromResolved([
      {
        preference: { name: "万能青年旅店", weight: "priority" },
        artist: {
          id: "4cd1ce8c-469e-4ff6-a987-59819b975a85",
          name: "万能青年旅店",
          score: 100,
          tags: ["progressive rock", "indie rock", "folk rock", "jazz rock", "art rock"]
        }
      }
    ]);

    expect(result.signals.map((signal) => signal.genre)).toEqual(["Rock", "Indie", "Folk"]);
    expect(
      new Set(result.evidence[0]?.terms.flatMap((term) => term.mappedGenres))
    ).toEqual(new Set(["Rock", "Indie", "Folk", "Jazz"]));
    expect(result.unknownArtistNames).toEqual([]);
  });

  it("surfaces Tao's R&B, soul, and pop evidence among the top three", () => {
    const result = inferArtistGenresFromResolved([
      {
        preference: { name: "陶喆", weight: "priority" },
        artist: {
          id: "38fe7fb3-2bde-4672-8016-2ba6f7d1808f",
          name: "陶喆",
          score: 100,
          tags: [
            "pop",
            "pop soul",
            "chinese",
            "taiwanese",
            "singer-songwriter",
            "rock",
            "mandopop",
            "contemporary r&b"
          ]
        }
      }
    ]);

    expect(new Set(result.signals.map((signal) => signal.genre))).toEqual(
      new Set(["Pop", "Soul", "R&B"])
    );
    expect(result.evidence[0]?.terms.map((term) => term.term)).not.toContain("chinese");
    expect(result.evidence[0]?.terms.map((term) => term.term)).not.toContain("taiwanese");
  });

  it("does not infer from country, language, name script, or unknown fuzzy terms", () => {
    const result = inferArtistGenresFromResolved([
      {
        preference: { name: "中文名字", weight: "like" },
        artist: {
          id: "unknown",
          name: "中文名字",
          score: 100,
          tags: ["chinese", "taiwanese", "singer-songwriter", "rockish", "urban"]
        }
      }
    ]);

    expect(result.signals).toEqual([]);
    expect(result.unknownArtistNames).toEqual(["中文名字"]);
    expect(result.evidence[0]).toMatchObject({ status: "unknown", terms: [] });
  });

  it("weights artist importance without letting tag-rich artists contribute extra total mass", () => {
    const result = inferArtistGenresFromResolved([
      {
        preference: { name: "Priority Artist", weight: "priority" },
        artist: { id: "priority", name: "Priority Artist", score: 100, genres: ["jazz"] }
      },
      {
        preference: { name: "Occasional Artist", weight: "occasional" },
        artist: {
          id: "occasional",
          name: "Occasional Artist",
          score: 100,
          tags: ["pop", "rock", "folk", "blues"]
        }
      }
    ], 5);

    expect(result.signals[0]).toMatchObject({ genre: "Jazz", percentage: 66.7 });
    expect(
      result.signals
        .filter((signal) => signal.genre !== "Jazz")
        .reduce((sum, signal) => sum + signal.percentage, 0)
    ).toBeCloseTo(33.2, 1);
  });

  it("offers a resolving wrapper but lets callers reuse pre-resolved metadata", async () => {
    const resolveArtist = vi.fn(async (name: string) => ({
      id: name,
      name,
      score: 100,
      genres: ["r&b"]
    }));

    const resolvedByWrapper = await inferArtistGenres(
      [{ name: "Artist", weight: "priority" }],
      { resolveArtist }
    );
    const reused = inferArtistGenresFromResolved([
      {
        preference: { name: "Artist", weight: "priority" },
        artist: { id: "Artist", name: "Artist", score: 100, genres: ["r&b"] }
      }
    ]);

    expect(resolveArtist).toHaveBeenCalledTimes(1);
    expect(reused).toEqual(resolvedByWrapper);
  });
});
