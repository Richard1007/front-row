import { describe, expect, it } from "vitest";

import {
  buildRecommendationCandidatePool,
  buildRecommendationSelection,
  buildRecommendations,
  type NormalizedEvent,
  type ValidationInput
} from "../../src/core/index.js";

const NOW = new Date("2026-09-19T12:00:00.000Z");

function input(overrides: Partial<ValidationInput> = {}): ValidationInput {
  return {
    artists: [
      {
        name: "王力宏",
        aliases: ["Wang Leehom", "Leehom Wang"],
        canonicalId: "artist:leehom",
        weight: "priority"
      }
    ],
    genres: [{ name: "Mandopop", weight: "priority" }],
    languages: [
      { language: "cmn", percentage: 90 },
      { language: "en", percentage: 10 }
    ],
    languageMode: "weighted",
    origin: { label: "Oakland", latitude: 37.8044, longitude: -122.2712 },
    maxTravelMinutes: 120,
    forecastMonths: 4,
    ...overrides
  };
}

function event(key: string, overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    canonicalKey: key,
    name: `Event ${key}`,
    startAt: "2026-10-10T03:00:00.000Z",
    status: "active",
    venue: {
      name: "Oakland Arena",
      city: "Oakland",
      region: "CA",
      coordinates: { latitude: 37.7503, longitude: -122.2028 }
    },
    performers: [{ name: `Artist ${key}`, canonicalId: `artist:${key}` }],
    genres: [],
    languages: [],
    sources: [
      {
        provider: "fixture",
        eventId: key,
        fetchedAt: NOW.toISOString(),
        mode: "fixture"
      }
    ],
    ...overrides
  };
}

function liveEvent(key: string, overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return event(key, {
    ...overrides,
    sources: overrides.sources ?? [{
      provider: "ticketmaster",
      eventId: key,
      fetchedAt: NOW.toISOString(),
      mode: "live"
    }]
  });
}

describe("buildRecommendations", () => {
  it("exposes every eligible candidate before digest limits are applied", () => {
    const exact = event("candidate-pool-exact", {
      performers: [{ name: "Wang Leehom", canonicalId: "artist:leehom" }]
    });
    const discovery = Array.from({ length: 12 }, (_, index) =>
      event(`candidate-pool-related-${index}`, {
        performers: [{
          name: `Related ${index}`,
          similarTo: [{
            preferenceCanonicalId: "artist:leehom",
            score: 0.8,
            confidence: 0.9,
            source: "listenbrainz"
          }]
        }]
      })
    );

    const pool = buildRecommendationCandidatePool(input(), [exact, ...discovery], {
      now: NOW
    });
    const final = buildRecommendationSelection(input(), [exact, ...discovery], {
      now: NOW
    });

    expect(pool.candidates).toHaveLength(13);
    expect(pool.resultLimit).toBe(9);
    expect(pool.funnel.rejected.result_limit).toBe(0);
    expect(final.recommendations).toHaveLength(9);
    expect(final.funnel.rejected.result_limit).toBe(4);
  });

  it("always ranks an exact selected artist above a stronger discovery event", () => {
    const exact = event("exact", {
      performers: [{ name: "Leehom Wang", canonicalId: "artist:leehom" }]
    });
    const discovery = event("discovery", {
      performers: [
        {
          name: "Perfect Similar Artist",
          similarTo: [
            {
              preferenceCanonicalId: "artist:leehom",
              score: 1,
              confidence: 1,
              source: "manual"
            }
          ]
        }
      ],
      genres: ["Mandopop"],
      languages: [{ language: "cmn", role: "primary", confidence: 1, source: "manual" }]
    });

    const result = buildRecommendations(input(), [discovery, exact], { now: NOW });

    expect(result.map((item) => item.canonicalKey)).toEqual(["exact", "discovery"]);
    expect(result[0]?.tier).toBe("T1");
    expect(result[1]?.tier).toBe("T2");
  });

  it("keeps AI-only artist expansion in the exploration tier", () => {
    const aiDiscovery = event("ai-discovery", {
      performers: [{
        name: "Nai Palm",
        similarTo: [{
          preferenceCanonicalId: "artist:leehom",
          score: 0.55,
          confidence: 0.7,
          source: "openai",
          rationale: "shares jazz harmony and neo-soul phrasing"
        }]
      }]
    });

    const [result] = buildRecommendations(input(), [aiDiscovery], { now: NOW });

    expect(result?.tier).toBe("T3");
    expect(result?.isFallback).toBeUndefined();
    expect(result?.reason).toContain("AI 根据 王力宏 推断");
    expect(result?.reason).toContain("jazz harmony");
  });

  it("uses canonical IDs and confirmed aliases for exact matches", () => {
    const byId = event("id", {
      performers: [{ name: "Different Display Name", canonicalId: "artist:leehom" }]
    });
    const byAlias = event("alias", {
      performers: [{ name: "Wang Leehom" }]
    });

    const result = buildRecommendations(input(), [byId, byAlias], { now: NOW });
    expect(result).toHaveLength(2);
    expect(result.every((item) => item.tier === "T1")).toBe(true);
  });

  it("includes a selected-artist show inside the four-month window", () => {
    const sanJose = event("wang-san-jose", {
      name: "Wang Leehom The Best Place II World Tour",
      startAt: "2026-12-20T04:00:00.000Z",
      venue: {
        name: "SAP Center at San Jose",
        city: "San Jose",
        region: "CA",
        coordinates: { latitude: 37.3328, longitude: -121.9012 }
      },
      performers: [{ name: "Wang Leehom", canonicalId: "K8vZ9173-Uf" }]
    });

    const [result] = buildRecommendations(input(), [sanJose], { now: NOW });

    expect(result).toMatchObject({
      canonicalKey: "wang-san-jose",
      tier: "T1",
      venue: { city: "San Jose" }
    });
  });

  it("uses the selected forecast window again after provider retrieval", () => {
    const laterShow = event("later-exact-show", {
      startAt: "2027-02-20T04:00:00.000Z",
      performers: [{ name: "Wang Leehom", canonicalId: "artist:leehom" }]
    });

    expect(buildRecommendations(input({ forecastMonths: 4 }), [laterShow], { now: NOW }))
      .toEqual([]);
    expect(buildRecommendations(input({ forecastMonths: 6 }), [laterShow], { now: NOW }))
      .toHaveLength(1);
  });

  it("never treats a tribute show as an exact artist match", () => {
    const tribute = event("tribute", {
      name: "Wang Leehom Tribute Night",
      performers: [{ name: "Wang Leehom", canonicalId: "artist:leehom" }],
      genres: ["Mandopop"],
      isTribute: true
    });

    expect(buildRecommendations(input(), [tribute], { now: NOW })).toEqual([]);
  });

  it("does not dilute an existing favorite when another preference is added", () => {
    const favorite = event("favorite", {
      performers: [{ name: "Wang Leehom", canonicalId: "artist:leehom" }]
    });
    const before = buildRecommendations(input(), [favorite], { now: NOW })[0];
    const after = buildRecommendations(
      input({
        artists: [
          ...input().artists,
          { name: "A New Favorite", canonicalId: "artist:new", weight: "priority" }
        ]
      }),
      [favorite],
      { now: NOW }
    )[0];

    expect(after?.score.artist).toBe(before?.score.artist);
    expect(after?.score.final).toBe(before?.score.final);
  });

  it("treats missing genre and language as neutral", () => {
    const related = event("related", {
      performers: [
        {
          name: "Related Artist",
          similarTo: [
            {
              preferenceName: "王力宏",
              score: 0.7,
              confidence: 1,
              source: "provider"
            }
          ]
        }
      ]
    });

    const [result] = buildRecommendations(input(), [related], { now: NOW });
    expect(result?.score.final).toBeCloseTo(0.7);
    expect(result?.score.genre).toBeUndefined();
    expect(result?.score.language).toBeUndefined();
    expect(result?.warnings.join(" ")).toContain("未因此降低排名");
  });

  it("uses specific artist-inferred genres as soft discovery signals without overriding explicit genres", () => {
    const rnbShow = event("inferred-rnb", { genres: ["R&B"] });
    const inferred = buildRecommendations(
      input({
        genres: [],
        inferredGenres: [{ name: "R&B", percentage: 70, confidence: 0.85 }],
        languageMode: "any",
        languages: []
      }),
      [rnbShow],
      { now: NOW }
    )[0];

    expect(inferred).toMatchObject({ tier: "T3" });
    expect(inferred?.score.genre).toBeCloseTo(0.7);

    const explicit = buildRecommendations(
      input({
        genres: [{ name: "R&B", weight: "occasional" }],
        inferredGenres: [{ name: "R&B", percentage: 70, confidence: 0.85 }],
        languageMode: "any",
        languages: []
      }),
      [rnbShow],
      { now: NOW }
    )[0];

    expect(explicit?.score.genre).toBe(0.25);
  });

  it("keeps a broad inferred genre out of the strong pool but may use it as a marked fallback", () => {
    const genericRock = liveEvent("generic-rock", { genres: ["Rock"] });
    const broadInput = input({
      genres: [],
      inferredGenres: [{ name: "Rock", percentage: 80, confidence: 0.9 }],
      languageMode: "any",
      languages: []
    });
    const pool = buildRecommendationCandidatePool(broadInput, [genericRock], { now: NOW });
    const [result] = buildRecommendations(broadInput, [genericRock], { now: NOW });

    expect(pool.candidates).toEqual([]);
    expect(pool.fallbackCandidates).toHaveLength(1);
    expect(result).toMatchObject({ canonicalKey: "generic-rock", tier: "T3", isFallback: true });
  });

  it("uses fixed artist importance values rather than sum normalization", () => {
    const liked = event("liked", {
      performers: [{ name: "Liked Artist", canonicalId: "artist:liked" }]
    });
    const base = input({
      artists: [{ name: "Liked Artist", canonicalId: "artist:liked", weight: "like" }],
      genres: [],
      languageMode: "any",
      languages: []
    });
    const before = buildRecommendations(base, [liked], { now: NOW })[0];
    const after = buildRecommendations(
      {
        ...base,
        artists: [...base.artists, { name: "Priority Artist", weight: "priority" }]
      },
      [liked],
      { now: NOW }
    )[0];

    expect(before?.score.artist).toBe(0.5);
    expect(after?.score.artist).toBe(0.5);
  });

  it("turns upcoming on-sale changes into T0 and excludes inactive events", () => {
    const exactPerformer = [{ name: "王力宏", canonicalId: "artist:leehom" }];
    const events = [
      event("cancelled", { performers: exactPerformer, status: "cancelled" }),
      event("postponed", {
        performers: exactPerformer,
        status: "postponed",
        startAt: "2026-10-12T03:00:00.000Z"
      }),
      event("on-sale", {
        performers: exactPerformer,
        startAt: "2026-10-14T03:00:00.000Z",
        onSaleAt: "2026-09-25T16:00:00.000Z"
      })
    ];

    const result = buildRecommendations(input(), events, { now: NOW });
    expect(result).toHaveLength(1);
    expect(result[0]?.canonicalKey).toBe("on-sale");
    expect(result[0]?.tier).toBe("T0");
  });

  it("treats an event as already on sale at the exact on-sale instant", () => {
    const [result] = buildRecommendations(input(), [event("on-sale-now", {
      performers: [{ name: "王力宏", canonicalId: "artist:leehom" }],
      onSaleAt: NOW.toISOString()
    })], { now: NOW });

    expect(result?.tier).toBe("T1");
  });

  it("filters events outside the date or travel boundary and events with unknown status", () => {
    const far = event("far", {
      genres: ["Mandopop"],
      venue: {
        name: "Madison Square Garden",
        city: "New York",
        coordinates: { latitude: 40.7505, longitude: -73.9934 }
      }
    });
    const tooLate = event("late", {
      genres: ["Mandopop"],
      startAt: "2027-02-01T03:00:00.000Z"
    });
    const unknown = event("unknown", { genres: ["Mandopop"], status: "unknown" });

    expect(buildRecommendations(input(), [far, tooLate, unknown], { now: NOW })).toEqual([]);
  });

  it("deduplicates provider records before ranking and keeps provenance", () => {
    const ticketmaster = event("shared", {
      name: "Wang Leehom Live",
      performers: [{ name: "王力宏", canonicalId: "artist:leehom" }],
      sources: [
        {
          provider: "ticketmaster",
          eventId: "tm-1",
          url: "https://tm.test/1",
          fetchedAt: NOW.toISOString(),
          mode: "fixture"
        }
      ]
    });
    const jambase = event("shared", {
      name: "王力宏演唱会",
      performers: [{ name: "Wang Leehom", canonicalId: "artist:leehom" }],
      sources: [
        {
          provider: "jambase",
          eventId: "jb-1",
          url: "https://jb.test/1",
          fetchedAt: NOW.toISOString(),
          mode: "fixture"
        }
      ]
    });

    const [result] = buildRecommendations(input(), [ticketmaster, jambase], { now: NOW });
    expect(result?.sources).toHaveLength(2);
    expect(result?.sources.map((source) => source.provider)).toEqual([
      "jambase",
      "ticketmaster"
    ]);
  });

  it("keeps the hard result limit below ten without relaxing affinity", () => {
    const strong = Array.from({ length: 10 }, (_, index) =>
      event(`strong-${index}`, {
        performers: [{
          name: `Related ${index}`,
          similarTo: [{
            preferenceName: "王力宏",
            score: 0.75,
            confidence: 0.8,
            source: "listenbrainz"
          }]
        }],
        genres: ["Mandopop"],
        startAt: `2026-10-${String(index + 10).padStart(2, "0")}T03:00:00.000Z`
      })
    );
    const exploratory = Array.from({ length: 2 }, (_, index) =>
      event(`explore-${index}`, {
        genres: ["Mandopop"],
        languages: [
          { language: "cmn", role: "significant", confidence: 1, source: "manual" }
        ]
      })
    );

    const result = buildRecommendations(input(), [...strong, ...exploratory], { now: NOW });
    expect(result).toHaveLength(9);
    expect(result.filter((item) => item.tier === "T3")).toHaveLength(0);

    const onlyExploration = buildRecommendations(input(), exploratory, { now: NOW });
    expect(onlyExploration.filter((item) => item.tier === "T3")).toHaveLength(2);
  });

  it("never lets T2 or T3 displace an eligible exact-artist event", () => {
    const lowWeightExactInput = input({
      artists: [{ name: "Exact Artist", canonicalId: "artist:exact", weight: "occasional" }]
    });
    const exact = event("protected-exact", {
      performers: [{ name: "Exact Artist", canonicalId: "artist:exact" }]
    });
    const discovery = Array.from({ length: 12 }, (_, index) =>
      event(`strong-discovery-${index}`, {
        performers: [{
          name: `Discovery ${index}`,
          similarTo: [{
            preferenceCanonicalId: "artist:exact",
            score: 1,
            confidence: 1,
            source: "manual"
          }]
        }]
      })
    );

    const selection = buildRecommendationSelection(
      lowWeightExactInput,
      [...discovery, exact],
      { now: NOW }
    );

    expect(selection.recommendations).toHaveLength(9);
    expect(selection.recommendations[0]).toMatchObject({
      canonicalKey: "protected-exact",
      tier: "T1"
    });
    expect(selection.recommendations.filter((item) => item.tier === "T2")).toHaveLength(8);
    expect(selection.funnel.rejected.result_limit).toBe(4);
  });

  it("fills remaining slots with discovery after including every eligible exact event", () => {
    const exact = Array.from({ length: 3 }, (_, index) =>
      event(`exact-fill-${index}`, {
        startAt: `2026-10-${String(index + 10).padStart(2, "0")}T03:00:00.000Z`,
        performers: [{ name: "Wang Leehom", canonicalId: "artist:leehom" }]
      })
    );
    const discovery = Array.from({ length: 8 }, (_, index) =>
      event(`discovery-fill-${index}`, {
        performers: [{
          name: `Related Fill ${index}`,
          similarTo: [{
            preferenceCanonicalId: "artist:leehom",
            score: 0.8,
            confidence: 0.9,
            source: "listenbrainz"
          }]
        }]
      })
    );

    const result = buildRecommendations(input(), [...discovery, ...exact], { now: NOW });
    expect(result).toHaveLength(9);
    expect(result.slice(0, 3).every((item) => item.tier === "T1")).toBe(true);
    expect(result.filter((item) => item.tier === "T2")).toHaveLength(6);
  });

  it("fills a sparse strong shortlist to three with marked nearby fallbacks", () => {
    const exact = event("only-relevant", {
      performers: [{ name: "Wang Leehom", canonicalId: "artist:leehom" }]
    });
    const irrelevant = Array.from({ length: 12 }, (_, index) =>
      liveEvent(`irrelevant-${index}`, { genres: ["Death metal"] })
    );

    const selection = buildRecommendationSelection(input(), [exact, ...irrelevant], {
      now: NOW
    });
    expect(selection.recommendations.map((item) => item.canonicalKey)).toEqual([
      "only-relevant",
      "irrelevant-0",
      "irrelevant-1"
    ]);
    expect(selection.recommendations.slice(1).every((item) => item.isFallback)).toBe(true);
    expect(selection.funnel.rejected.no_preference_affinity).toBe(10);
  });

  it("protects one show per selected artist before adding repeat exact shows", () => {
    const multiArtistInput = input({
      artists: [
        { name: "Artist A", canonicalId: "artist:a", weight: "priority" },
        { name: "Artist B", canonicalId: "artist:b", weight: "like" },
        { name: "Artist C", canonicalId: "artist:c", weight: "occasional" }
      ]
    });
    const artistAShows = Array.from({ length: 10 }, (_, index) =>
      event(`artist-a-${index}`, {
        startAt: `2026-10-${String(index + 10).padStart(2, "0")}T03:00:00.000Z`,
        performers: [{ name: "Artist A", canonicalId: "artist:a" }]
      })
    );
    const artistB = event("artist-b", {
      performers: [{ name: "Artist B", canonicalId: "artist:b" }]
    });
    const artistC = event("artist-c", {
      performers: [{ name: "Artist C", canonicalId: "artist:c" }]
    });

    const selection = buildRecommendationSelection(
      multiArtistInput,
      [...artistAShows, artistB, artistC],
      { now: NOW }
    );
    const performerNames = selection.recommendations.flatMap((item) =>
      item.performers.map((performer) => performer.name)
    );

    expect(selection.recommendations).toHaveLength(9);
    expect(performerNames).toEqual(
      expect.arrayContaining(["Artist A", "Artist B", "Artist C"])
    );
    expect(selection.funnel.rejected.result_limit).toBe(3);
  });

  it("allows ten results only to represent ten selected artists with eligible shows", () => {
    const artists = Array.from({ length: 10 }, (_, index) => ({
      name: `Selected Artist ${index}`,
      canonicalId: `artist:selected-${index}`,
      weight: "priority" as const
    }));
    const exactShows = artists.map((artist, index) =>
      event(`selected-artist-${index}`, {
        performers: [{ name: artist.name, canonicalId: artist.canonicalId }]
      })
    );

    const automatic = buildRecommendationSelection(
      input({ artists }),
      exactShows,
      { now: NOW }
    );
    const explicitlyLimited = buildRecommendations(input({ artists }), exactShows, {
      now: NOW,
      limit: 9
    });

    expect(automatic.recommendations).toHaveLength(10);
    expect(new Set(
      automatic.recommendations.flatMap((item) =>
        item.performers.map((performer) => performer.canonicalId)
      )
    ).size).toBe(10);
    expect(automatic.funnel.rejected.result_limit).toBe(0);
    expect(explicitlyLimited).toHaveLength(9);
  });

  it("caps T3 at five while keeping the no-affinity gate intact", () => {
    const exploratory = Array.from({ length: 7 }, (_, index) =>
      event(`exploration-cap-${index}`, { genres: ["Mandopop"] })
    );
    const selection = buildRecommendationSelection(input(), exploratory, { now: NOW });

    expect(selection.recommendations).toHaveLength(5);
    expect(selection.recommendations.every((item) => item.tier === "T3")).toBe(true);
    expect(selection.funnel.rejected.exploration_cap).toBe(2);
  });

  it("prefers performer diversity when discovery quality is otherwise comparable", () => {
    const similarity = [{
      preferenceCanonicalId: "artist:leehom",
      score: 0.8,
      confidence: 0.9,
      source: "listenbrainz" as const
    }];
    const repeats = Array.from({ length: 4 }, (_, index) =>
      event(`repeat-related-${index}`, {
        performers: [{
          name: "Repeated Related Artist",
          canonicalId: "artist:repeated-related",
          similarTo: similarity
        }]
      })
    );
    const distinct = Array.from({ length: 3 }, (_, index) =>
      event(`distinct-related-${index}`, {
        performers: [{
          name: `Distinct Related ${index}`,
          canonicalId: `artist:distinct-related-${index}`,
          similarTo: similarity
        }]
      })
    );

    const result = buildRecommendations(input(), [...repeats, ...distinct], {
      now: NOW,
      limit: 4
    });
    expect(new Set(result.map((item) => item.performers[0]?.canonicalId)).size).toBe(4);
  });

  it("prefers distinct verified nearby performers over a second discovery date", () => {
    const similarity = [{
      preferenceCanonicalId: "artist:leehom",
      score: 0.8,
      confidence: 0.9,
      source: "listenbrainz" as const
    }];
    const brunoShows = [
      event("bruno-first", {
        startAt: "2026-10-10T03:00:00.000Z",
        performers: [{
          name: "Bruno Mars",
          canonicalId: "artist:bruno",
          similarTo: similarity
        }]
      }),
      event("bruno-second", {
        startAt: "2026-10-11T03:00:00.000Z",
        performers: [{
          name: "Bruno Mars",
          canonicalId: "artist:bruno",
          similarTo: similarity
        }]
      })
    ];
    const nearby = [
      liveEvent("nearby-a", {
        performers: [{ name: "Nearby Artist A", canonicalId: "artist:nearby-a" }]
      }),
      liveEvent("nearby-b", {
        performers: [{ name: "Nearby Artist B", canonicalId: "artist:nearby-b" }]
      })
    ];

    const result = buildRecommendations(input(), [...brunoShows, ...nearby], { now: NOW });

    expect(result.map((item) => item.canonicalKey)).toEqual([
      "bruno-first",
      "nearby-a",
      "nearby-b"
    ]);
    expect(result.filter((item) => item.performers[0]?.canonicalId === "artist:bruno"))
      .toHaveLength(1);
  });

  it("uses a repeated discovery date only when distinct fallbacks cannot reach three", () => {
    const similarity = [{
      preferenceCanonicalId: "artist:leehom",
      score: 0.8,
      confidence: 0.9,
      source: "listenbrainz" as const
    }];
    const brunoShows = [
      event("bruno-primary", {
        startAt: "2026-10-10T03:00:00.000Z",
        performers: [{
          name: "Bruno Mars",
          canonicalId: "artist:bruno",
          similarTo: similarity
        }]
      }),
      event("bruno-repeat", {
        startAt: "2026-10-11T03:00:00.000Z",
        performers: [{
          name: "Bruno Mars",
          canonicalId: "artist:bruno",
          similarTo: similarity
        }]
      })
    ];
    const nearby = liveEvent("only-nearby", {
      performers: [{ name: "Nearby Artist", canonicalId: "artist:nearby" }]
    });

    const result = buildRecommendations(input(), [...brunoShows, nearby], { now: NOW });

    expect(result.map((item) => item.canonicalKey)).toEqual([
      "bruno-primary",
      "bruno-repeat",
      "only-nearby"
    ]);
    expect(result.find((item) => item.canonicalKey === "only-nearby")?.isFallback).toBe(true);
  });

  it("accepts T3 with reliable genre or language affinity alone", () => {
    const genreOnly = event("genre-only", { genres: ["Mandopop"] });
    const languageOnly = event("language-only", {
      languages: [{ language: "cmn", role: "primary", confidence: 0.9, source: "manual" }]
    });

    const result = buildRecommendations(input(), [genreOnly, languageOnly], { now: NOW });
    expect(result.map((item) => item.canonicalKey).sort()).toEqual([
      "genre-only",
      "language-only"
    ]);
    expect(result.every((item) => item.tier === "T3")).toBe(true);
  });

  it("uses inferred artist languages as a soft signal even in any-language mode", () => {
    const inferred = input({
      languageMode: "any",
      languages: [],
      inferredLanguages: [{ language: "cmn", percentage: 100 }],
      genres: []
    });
    const languageOnly = event("inferred-language", {
      languages: [{ language: "cmn", role: "primary", confidence: 0.9, source: "manual" }]
    });

    const [result] = buildRecommendations(inferred, [languageOnly], { now: NOW });
    expect(result?.tier).toBe("T3");
    expect(result?.score.language).toBe(1);
  });

  it("reports every recommendation funnel stage and first rejection reason", () => {
    const duplicate = event("exact", {
      performers: [{ name: "Wang Leehom", canonicalId: "artist:leehom" }]
    });
    const outsideForecast = event("old", { startAt: "2026-01-01T00:00:00.000Z" });
    const noAffinity = liveEvent("no-affinity", { genres: ["Death metal"] });

    const selection = buildRecommendationSelection(
      input(),
      [duplicate, { ...duplicate }, outsideForecast, noAffinity],
      { now: NOW }
    );

    expect(selection.recommendations).toHaveLength(2);
    expect(selection.funnel).toMatchObject({
      inputEvents: 4,
      deduplicatedEvents: 3,
      insideForecast: 2,
      withVenueCoordinates: 2,
      activeNonTribute: 2,
      insideTravelBoundary: 2,
      preferenceEligible: 1,
      selectedEvents: 2,
      rejected: {
        duplicate_event: 1,
        outside_forecast: 1,
        no_preference_affinity: 0
      }
    });
  });

  it("marks a zero-match provider event as fallback instead of presenting it as a strong match", () => {
    const irrelevant = liveEvent("irrelevant", {
      genres: ["Death metal"],
      languages: [{ language: "de", role: "primary", confidence: 1, source: "manual" }]
    });
    const [result] = buildRecommendations(input(), [irrelevant], { now: NOW });
    expect(result).toMatchObject({ canonicalKey: "irrelevant", tier: "T3", isFallback: true });
    expect(result?.warnings).toContain(
      "没有找到可靠的偏好匹配。这是经过验证的附近演出，不代表强匹配"
    );
  });

  it("does not call fixture-only data a verified nearby fallback", () => {
    const fixtureOnly = event("fixture-only", { genres: ["Death metal"] });
    const selection = buildRecommendationSelection(input(), [fixtureOnly], { now: NOW });

    expect(selection.recommendations).toEqual([]);
    expect(selection.funnel.fallbackEligible).toBe(0);
    expect(selection.funnel.fallbackSelected).toBe(0);
    expect(selection.funnel.rejected.no_preference_affinity).toBe(1);
  });

  it("always places preference-backed events before higher-scoring fallbacks", () => {
    const mixedInput = input({
      genres: [{ name: "Mandopop", weight: "occasional" }],
      inferredGenres: [{ name: "Rock", percentage: 90, confidence: 1 }],
      languageMode: "any",
      languages: []
    });
    const preferenceBacked = liveEvent("preference-backed", { genres: ["Mandopop"] });
    const fallback = liveEvent("high-score-fallback", { genres: ["Rock"] });

    const selection = buildRecommendationSelection(
      mixedInput,
      [fallback, preferenceBacked],
      { now: NOW }
    );

    expect(selection.recommendations.map((item) => item.canonicalKey)).toEqual([
      "preference-backed",
      "high-score-fallback"
    ]);
    expect(selection.recommendations[1]?.isFallback).toBe(true);
    expect(selection.funnel.fallbackSelected).toBe(1);
  });

  it("never uses structurally unsafe events as fallbacks", () => {
    const outsideRange = liveEvent("outside-range", {
      venue: {
        name: "Far Venue",
        city: "Los Angeles",
        region: "CA",
        coordinates: { latitude: 34.0522, longitude: -118.2437 }
      }
    });
    const inactive = liveEvent("inactive", { status: "cancelled" });
    const missingCoordinates = liveEvent("missing-coordinates", {
      venue: { name: "Unknown Venue", city: "Oakland", region: "CA" }
    });

    expect(buildRecommendations(
      input(),
      [outsideRange, inactive, missingCoordinates],
      { now: NOW }
    )).toEqual([]);
  });

  it("clamps non-finite and fractional result limits", () => {
    const related = Array.from({ length: 4 }, (_, index) =>
      event(`related-limit-${index}`, {
        performers: [{
          name: `Related ${index}`,
          similarTo: [{
            preferenceName: "王力宏",
            score: 0.8,
            confidence: 1,
            source: "listenbrainz"
          }]
        }]
      })
    );

    expect(buildRecommendations(input(), related, { now: NOW, limit: 2.9 })).toHaveLength(2);
    expect(buildRecommendations(input(), related, { now: NOW, limit: Number.NaN })).toHaveLength(4);
  });

  it("returns transparent score details, reasons, travel, and warnings", () => {
    const exact = event("details", {
      performers: [{ name: "王力宏", canonicalId: "artist:leehom", role: "headliner" }],
      genres: ["Mandopop"],
      languages: [{ language: "cmn", role: "primary", confidence: 1, source: "manual" }]
    });
    const [result] = buildRecommendations(input(), [exact], { now: NOW });

    expect(result?.reason).toContain("王力宏");
    expect(result?.score).toMatchObject({ artist: 1, genre: 1, language: 0.5 });
    expect(result?.estimatedTravelMinutes).toBeGreaterThan(0);
    expect(result?.distanceMiles).toBeGreaterThan(0);
    expect(result?.warnings[0]).toContain("估算");
  });
});
