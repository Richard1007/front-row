import { describe, expect, it } from "vitest";

import { applyExpansionEvidence } from "../../src/discovery/applyExpansionEvidence.js";
import type { ArtistExpansionCandidate, NormalizedEvent } from "../../src/core/types.js";

const event: NormalizedEvent = {
  canonicalKey: "event-1",
  name: "Jay Chou Live",
  startAt: "2026-11-01T04:00:00.000Z",
  status: "active",
  venue: { name: "Arena", coordinates: { latitude: 37.3, longitude: -121.9 } },
  performers: [{ name: "周杰倫" }],
  genres: [],
  languages: [],
  sources: [{ provider: "fixture", eventId: "1", fetchedAt: "2026-09-20T00:00:00Z", mode: "fixture" }]
};

const candidate: ArtistExpansionCandidate = {
  name: "周杰倫",
  canonicalId: "musicbrainz:jay",
  musicBrainzId: "jay",
  evidence: [{
    source: "listenbrainz",
    seedName: "王力宏",
    seedWeight: "priority",
    rank: 1
  }]
};

describe("applyExpansionEvidence", () => {
  it("attaches sourced similarity only to a provider-confirmed matching performer", () => {
    const [result] = applyExpansionEvidence([event], [candidate]);

    expect(result?.performers[0]).toMatchObject({
      canonicalId: "musicbrainz:jay",
      similarTo: [{ preferenceName: "王力宏", source: "listenbrainz", score: 0.85 }]
    });
  });

  it("does not annotate a different performer", () => {
    const [result] = applyExpansionEvidence([
      { ...event, performers: [{ name: "Unrelated Artist" }] }
    ], [candidate]);

    expect(result?.performers[0]?.similarTo).toBeUndefined();
  });

  it("keeps AI taste evidence distinct and conservatively capped", () => {
    const [result] = applyExpansionEvidence([event], [{
      ...candidate,
      evidence: [{
        source: "openai",
        seedName: "王力宏",
        seedWeight: "priority",
        rank: 1,
        confidence: 0.96,
        rationale: "Mandopop R&B with jazz harmony",
        microgenres: ["neo-soul"]
      }]
    }]);

    expect(result?.performers[0]?.similarTo).toEqual([expect.objectContaining({
      source: "openai",
      score: 0.55,
      confidence: 0.96,
      rationale: "Mandopop R&B with jazz harmony",
      microgenres: ["neo-soul"]
    })]);
  });
});
