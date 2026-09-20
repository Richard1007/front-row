import { describe, expect, it, vi } from "vitest";

import { inferArtistLanguagePreferences } from "../../src/discovery/inferArtistLanguages.js";
import type { WeightedPreference } from "../../src/core/types.js";

describe("artist language preference inference", () => {
  it("infers an approximately 90/10 soft profile from nine Mandarin artists and one English artist", async () => {
    const artists: WeightedPreference[] = [
      ...Array.from({ length: 9 }, (_, index) => ({
        name: `Mandarin Artist ${index + 1}`,
        weight: "priority" as const
      })),
      { name: "English Artist", weight: "priority" }
    ];
    const resolveArtist = vi.fn(async (name: string) => ({
      id: `mbid-${name}`,
      name,
      score: 100,
      tags: [name === "English Artist" ? "english-language" : "mandopop"]
    }));

    const result = await inferArtistLanguagePreferences(artists, { resolveArtist });

    expect(result.distribution).toEqual([
      { language: "cmn", percentage: 90 },
      { language: "en", percentage: 10 }
    ]);
    expect(result.unknownPercentage).toBe(0);
    expect(result.evidence.every((item) => item.status === "known")).toBe(true);
  });

  it("uses reliable curated profiles without making a MusicBrainz request", async () => {
    const resolveArtist = vi.fn();

    const result = await inferArtistLanguagePreferences(
      [
        { name: "周杰伦", weight: "priority" },
        { name: "Bruno Mars", weight: "priority" }
      ],
      { resolveArtist }
    );

    expect(resolveArtist).not.toHaveBeenCalled();
    expect(result.distribution).toEqual([
      { language: "cmn", percentage: 50 },
      { language: "en", percentage: 50 }
    ]);
    expect(result.evidence.map((item) => item.languages[0]?.source)).toEqual([
      "curated",
      "curated"
    ]);
  });

  it("does not infer language from nationality, name script, or broad genre tags", async () => {
    const result = await inferArtistLanguagePreferences(
      [{ name: "中文名字", weight: "priority" }],
      {
        resolveArtist: async () => ({
          id: "unknown-language",
          name: "中文名字",
          score: 100,
          tags: ["chinese", "taiwan", "c-pop", "k-pop", "latin"]
        })
      }
    );

    expect(result.distribution).toEqual([]);
    expect(result.unknownPercentage).toBe(100);
    expect(result.evidence).toEqual([
      {
        artistName: "中文名字",
        status: "unknown",
        languages: [],
        musicBrainzId: "unknown-language"
      }
    ]);
  });

  it("reports unknown coverage separately and degrades cleanly when resolution fails", async () => {
    const result = await inferArtistLanguagePreferences(
      [
        { name: "Known", weight: "like" },
        { name: "No metadata", weight: "like" },
        { name: "Network failure", weight: "like" }
      ],
      {
        resolveArtist: async (name) => {
          if (name === "Network failure") throw new Error("offline");
          if (name === "No metadata") {
            return { id: "no-metadata", name, score: 100, genres: ["pop"] };
          }
          return { id: "known", name, score: 100, genres: ["cantopop"] };
        }
      }
    );

    expect(result.distribution).toEqual([{ language: "yue", percentage: 100 }]);
    expect(result.unknownPercentage).toBe(66.7);
    expect(result.evidence.map((item) => item.status)).toEqual(["known", "unknown", "unknown"]);
  });

  it("lets explicit artist importance affect the inferred soft distribution", async () => {
    const result = await inferArtistLanguagePreferences(
      [
        { name: "English priority", weight: "priority" },
        { name: "Mandarin occasional", weight: "occasional" }
      ],
      {
        resolveArtist: async (name) => ({
          id: name,
          name,
          score: 100,
          tags: [name.includes("English") ? "english language" : "mandarin pop"]
        })
      }
    );

    expect(result.distribution).toEqual([
      { language: "en", percentage: 66.7 },
      { language: "cmn", percentage: 33.3 }
    ]);
  });
});
