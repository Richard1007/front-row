import { describe, expect, it } from "vitest";

import {
  safeValidateInput,
  validateInput,
  type ValidationInput
} from "../../src/core/index.js";

function validInput(): ValidationInput {
  return {
    artists: [{ name: "王力宏", weight: "priority" as const }],
    genres: [{ name: "Mandopop", weight: "like" as const }],
    languages: [
      { language: "cmn", percentage: 90 },
      { language: "en", percentage: 10 }
    ],
    languageMode: "weighted" as const,
    origin: { label: "Oakland", latitude: 37.8044, longitude: -122.2712 },
    maxTravelMinutes: 120
  };
}

describe("validateInput", () => {
  it("trims values and defaults the fixed four-month window", () => {
    const input = validInput();
    input.artists[0]!.name = "  王力宏  ";
    const result = validateInput(input);

    expect(result.artists[0]?.name).toBe("王力宏");
    expect(result.forecastMonths).toBe(4);
  });

  it("enforces artist and genre limits", () => {
    const tooManyArtists = validInput();
    tooManyArtists.artists = Array.from({ length: 11 }, (_, index) => ({
      name: `Artist ${index}`,
      weight: "like" as const
    }));
    expect(safeValidateInput(tooManyArtists).success).toBe(false);

    const tooManyGenres = validInput();
    tooManyGenres.genres = Array.from({ length: 4 }, (_, index) => ({
      name: `Genre ${index}`,
      weight: "like" as const
    }));
    expect(safeValidateInput(tooManyGenres).success).toBe(false);
  });

  it("accepts only music styles from the controlled taxonomy", () => {
    const input = validInput();
    input.genres = [{ name: "A genre typed outside the pool", weight: "like" }];

    expect(safeValidateInput(input).success).toBe(false);
  });

  it("normalizes supported language labels to canonical values", () => {
    const input = validInput();
    input.languages = [
      { language: "普通话", percentage: 70 },
      { language: "English", percentage: 30 }
    ];

    expect(validateInput(input).languages).toEqual([
      { language: "cmn", percentage: 70 },
      { language: "en", percentage: 30 }
    ]);
  });

  it("rejects unsupported, duplicate, and more than three languages", () => {
    const unsupported = validInput();
    unsupported.languages = [{ language: "Klingon", percentage: 100 }];
    expect(safeValidateInput(unsupported).success).toBe(false);

    const duplicate = validInput();
    duplicate.languages = [
      { language: "Chinese", percentage: 50 },
      { language: "Mandarin", percentage: 50 }
    ];
    expect(safeValidateInput(duplicate).success).toBe(false);

    const tooMany = validInput();
    tooMany.languages = [
      { language: "cmn", percentage: 25 },
      { language: "en", percentage: 25 },
      { language: "es", percentage: 25 },
      { language: "fr", percentage: 25 }
    ];
    expect(safeValidateInput(tooMany).success).toBe(false);
  });

  it("requires weighted language percentages to total 100", () => {
    const input = validInput();
    input.languages = [{ language: "cmn", percentage: 90 }];
    const result = safeValidateInput(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("100%"))).toBe(true);
    }
  });

  it("allows language-independent mode only without percentages", () => {
    const valid = { ...validInput(), languageMode: "any" as const, languages: [] };
    expect(safeValidateInput(valid).success).toBe(true);

    const invalid = { ...validInput(), languageMode: "any" as const };
    expect(safeValidateInput(invalid).success).toBe(false);
  });

  it("rejects duplicate preferences case-insensitively", () => {
    const input = validInput();
    input.artists = [
      { name: "Leehom Wang", weight: "priority" },
      { name: "leehom wang", weight: "like" }
    ];

    expect(safeValidateInput(input).success).toBe(false);
  });

  it("rejects duplicate artists expressed as known aliases", () => {
    const input = validInput();
    input.artists = [
      { name: "王力宏", weight: "priority" },
      { name: "Wang Leehom", weight: "like" }
    ];

    expect(safeValidateInput(input).success).toBe(false);
  });

  it("requires at least one artist", () => {
    expect(safeValidateInput({ ...validInput(), artists: [] }).success).toBe(false);
  });

  it("enforces travel-time boundaries", () => {
    expect(safeValidateInput({ ...validInput(), maxTravelMinutes: 14 }).success).toBe(false);
    expect(safeValidateInput({ ...validInput(), maxTravelMinutes: 15 }).success).toBe(true);
    expect(safeValidateInput({ ...validInput(), maxTravelMinutes: 360 }).success).toBe(true);
    expect(safeValidateInput({ ...validInput(), maxTravelMinutes: 361 }).success).toBe(false);
  });

  it("rejects a non-four-month Milestone 0 window and invalid coordinates", () => {
    expect(safeValidateInput({ ...validInput(), forecastMonths: 1 }).success).toBe(false);
    expect(
      safeValidateInput({
        ...validInput(),
        origin: { label: "Invalid", latitude: 91, longitude: -122 }
      }).success
    ).toBe(false);
  });
});
