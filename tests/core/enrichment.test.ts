import { describe, expect, it } from "vitest";

import {
  buildRecommendations,
  enrichEvent,
  enrichValidationInput,
  validateInput,
  type NormalizedEvent,
  type ValidationInput
} from "../../src/core/index.js";
import { normalizeTicketmasterEvent } from "../../src/providers/ticketmaster.js";

const NOW = new Date("2026-09-19T12:00:00.000Z");

function defaultFormInput(artist = "王力宏"): ValidationInput {
  return {
    artists: [{ name: artist, weight: "priority" }],
    genres: [],
    languages: [
      { language: "普通话", percentage: 70 },
      { language: "英语", percentage: 30 }
    ],
    languageMode: "weighted",
    origin: { label: "Oakland", latitude: 37.8044, longitude: -122.2712 },
    maxTravelMinutes: 120,
    forecastDays: 90
  };
}

function ticketmasterWangLeehom(): NormalizedEvent {
  const result = normalizeTicketmasterEvent(
    {
      id: "tm-wlh-1",
      name: "Wang Leehom Live in Oakland",
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
        attractions: [{ id: "K8vZ9178abc", name: "Wang Leehom" }]
      }
    },
    NOW
  );
  if (!result) throw new Error("Ticketmaster fixture failed to normalize");
  return result;
}

describe("Milestone 0 curated enrichment", () => {
  it.each([
    ["普通话", "cmn"],
    ["国语", "cmn"],
    ["Mandarin", "cmn"],
    ["英语", "en"],
    ["英文", "en"],
    ["English", "en"],
    ["粤语", "yue"],
    ["Cantonese", "yue"]
  ])("normalizes UI language label %s to %s", (label, expected) => {
    const result = validateInput({
      ...defaultFormInput(),
      languages: [{ language: label, percentage: 100 }]
    });
    expect(result.languages[0]?.language).toBe(expected);
  });

  it("resolves required curated artists and their aliases", () => {
    const wang = enrichValidationInput(defaultFormInput("王力宏"));
    const jay = enrichValidationInput(defaultFormInput("Jay Chou"));
    const bruno = enrichValidationInput(defaultFormInput("Bruno Mars"));

    expect(wang.artists[0]).toMatchObject({ canonicalId: "frontrow:artist:wang-leehom" });
    expect(wang.artists[0]?.aliases).toEqual(
      expect.arrayContaining(["王力宏", "Wang Leehom", "Leehom Wang"])
    );
    expect(jay.artists[0]).toMatchObject({ canonicalId: "frontrow:artist:jay-chou" });
    expect(jay.artists[0]?.aliases).toEqual(expect.arrayContaining(["周杰伦", "Jay Chou"]));
    expect(bruno.artists[0]).toMatchObject({ canonicalId: "frontrow:artist:bruno-mars" });
  });

  it("matches Chinese UI input to an English provider performer end to end", () => {
    const [result] = buildRecommendations(defaultFormInput(), [ticketmasterWangLeehom()], {
      now: NOW
    });

    expect(result?.tier).toBe("T1");
    expect(result?.reason).toContain("王力宏");
    expect(result?.reason).toContain("普通话");
    expect(result?.score.language).toBeCloseTo(0.7);
    expect(result?.languages).toEqual(
      expect.arrayContaining([expect.objectContaining({ language: "cmn", source: "manual" })])
    );
  });

  it("enriches English aliases with curated language evidence", () => {
    const enriched = enrichEvent(ticketmasterWangLeehom());
    expect(enriched.languages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ language: "cmn", role: "primary" }),
        expect.objectContaining({ language: "en", role: "significant" })
      ])
    );
  });

  it("leaves an unknown artist's missing language neutral", () => {
    const unknownEvent: NormalizedEvent = {
      ...ticketmasterWangLeehom(),
      canonicalKey: "unknown-artist-event",
      name: "Unknown Artist Live",
      performers: [{ name: "Uncatalogued Artist", canonicalId: "provider:unknown" }],
      languages: []
    };
    const [result] = buildRecommendations(
      {
        ...defaultFormInput("Uncatalogued Artist"),
        artists: [{ name: "Uncatalogued Artist", weight: "priority" }]
      },
      [unknownEvent],
      { now: NOW }
    );

    expect(result?.tier).toBe("T1");
    expect(result?.score.language).toBeUndefined();
    expect(result?.warnings.join(" ")).toContain("未因此降低排名");
  });
});
