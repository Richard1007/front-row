import { describe, expect, it, vi } from "vitest";

import { verifyLlmArtistExpansion } from "../../src/discovery/verifyLlmArtistExpansion.js";
import type { ArtistExpansionCandidate } from "../../src/core/types.js";

const preferences = [
  { name: "陶喆", aliases: ["David Tao"], weight: "priority" as const },
  { name: "方大同", weight: "like" as const }
];

describe("verifyLlmArtistExpansion", () => {
  it("keeps only MusicBrainz-resolved, non-duplicate suggestions", async () => {
    const resolveArtist = vi.fn(async (name: string) => {
      if (name === "Nai Palm") return { id: "nai-id", name: "Nai Palm", score: 100 };
      if (name === "Invented Artist") return undefined;
      if (name === "David Tao") return { id: "tao-id", name: "陶喆", score: 100 };
      return undefined;
    });
    const result = await verifyLlmArtistExpansion([
      { name: "David Tao", relatedTo: ["陶喆"], confidence: 0.99, microgenres: [], rationale: "self" },
      { name: "Invented Artist", relatedTo: ["陶喆"], confidence: 0.8, microgenres: ["neo-soul"], rationale: "test" },
      { name: "Nai Palm", relatedTo: ["方大同"], confidence: 0.84, microgenres: ["neo-soul"], rationale: "harmony" }
    ], preferences, { resolveArtist, maxCandidates: 4 });

    expect(resolveArtist).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "Nai Palm",
      canonicalId: "musicbrainz:nai-id",
      evidence: [{ source: "openai", seedName: "方大同", confidence: 0.84 }]
    });
  });

  it("does not repeat an existing ListenBrainz identity", async () => {
    const existing: ArtistExpansionCandidate = {
      name: "周杰倫",
      canonicalId: "musicbrainz:jay-id",
      musicBrainzId: "jay-id",
      evidence: [{ source: "listenbrainz", seedName: "王力宏", seedWeight: "priority", rank: 1 }]
    };
    const result = await verifyLlmArtistExpansion([
      { name: "Jay Chou", relatedTo: ["陶喆"], confidence: 0.9, microgenres: ["Mandopop"], rationale: "related" }
    ], preferences, {
      existingCandidates: [existing],
      resolveArtist: async () => ({ id: "jay-id", name: "周杰倫", score: 100 })
    });

    expect(result).toEqual([]);
  });

  it("does not reintroduce a selected artist under an unknown spelling", async () => {
    const result = await verifyLlmArtistExpansion([
      { name: "Tao Ze", relatedTo: ["陶喆"], confidence: 0.95, microgenres: ["R&B"], rationale: "same identity" }
    ], [{ ...preferences[0]!, canonicalId: "musicbrainz:tao-id" }], {
      resolveArtist: async () => ({ id: "tao-id", name: "陶喆", score: 100 })
    });

    expect(result).toEqual([]);
  });

  it("drops low-confidence model candidates before making identity requests", async () => {
    const resolveArtist = vi.fn();
    const result = await verifyLlmArtistExpansion([
      { name: "Uncertain Artist", relatedTo: ["陶喆"], confidence: 0.69, microgenres: ["R&B"], rationale: "uncertain" }
    ], preferences, { resolveArtist });

    expect(result).toEqual([]);
    expect(resolveArtist).not.toHaveBeenCalled();
  });

  it("caps verification attempts and accepted candidates", async () => {
    const resolveArtist = vi.fn(async (name: string) => ({ id: `${name}-id`, name, score: 100 }));
    const suggestions = Array.from({ length: 8 }, (_, index) => ({
      name: `Artist ${index}`,
      relatedTo: ["陶喆"],
      confidence: 0.7,
      microgenres: [],
      rationale: "related"
    }));
    const result = await verifyLlmArtistExpansion(suggestions, preferences, {
      resolveArtist,
      maxCandidates: 2,
      maxVerificationAttempts: 3
    });

    expect(result).toHaveLength(2);
    expect(resolveArtist).toHaveBeenCalledTimes(2);
  });

  it("keeps at most twelve verified artists and never verifies more than twenty", async () => {
    const suggestions = Array.from({ length: 25 }, (_, index) => ({
      name: `Candidate ${index}`,
      relatedTo: ["陶喆"],
      confidence: 0.9,
      microgenres: ["neo-soul"],
      rationale: "A fine-grained musical connection."
    }));
    const resolved = vi.fn(async (name: string) => ({
      id: `${name}-id`,
      name,
      score: 100
    }));

    const accepted = await verifyLlmArtistExpansion(suggestions, preferences, {
      resolveArtist: resolved,
      maxCandidates: 100,
      maxVerificationAttempts: 100
    });

    expect(accepted).toHaveLength(12);
    expect(resolved).toHaveBeenCalledTimes(12);

    const unresolved = vi.fn(async () => undefined);
    const noneAccepted = await verifyLlmArtistExpansion(suggestions, preferences, {
      resolveArtist: unresolved,
      maxCandidates: 100,
      maxVerificationAttempts: 100
    });

    expect(noneAccepted).toEqual([]);
    expect(unresolved).toHaveBeenCalledTimes(20);
  });
});
