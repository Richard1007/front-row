import { describe, expect, it } from "vitest";
import {
  GENRE_OPTIONS,
  genreLabel,
  toValidationInput,
  validateForm,
  type ValidationFormState
} from "../../src/client/form-utils";

const validState = (): ValidationFormState => ({
  artists: [{ id: "artist-1", name: " 王力宏 ", weight: "priority" }],
  genres: [{ id: "genre-1", name: "R&B", weight: "like" }],
  languages: [
    { id: "language-1", language: "普通话", percentage: "90" },
    { id: "language-2", language: "英语", percentage: "10" }
  ],
  languageMode: "weighted",
  originLabel: "Oakland 家里",
  latitude: "37.8044",
  longitude: "-122.2712",
  maxTravelMinutes: "120"
});

describe("validateForm", () => {
  it("accepts a complete weighted-preference form", () => {
    expect(validateForm(validState())).toEqual({});
  });

  it("requires at least one artist", () => {
    const state = validState();
    state.artists = [{ id: "artist-1", name: "  ", weight: "priority" }];
    expect(validateForm(state).artists).toContain("至少");
  });

  it("returns English validation copy when requested", () => {
    const state = validState();
    state.artists = [];
    state.latitude = "";

    const errors = validateForm(state, "en");

    expect(errors.artists).toBe("Enter at least one artist you genuinely want to see.");
    expect(errors.latitude).toBe("Latitude must be between -90 and 90.");
  });

  it("requires weighted language percentages to total 100", () => {
    const state = validState();
    state.languages[0]!.percentage = "60";
    expect(validateForm(state).languages).toContain("70%");
  });

  it("does not require language rows in any-language mode", () => {
    const state = validState();
    state.languageMode = "any";
    state.languages = [];
    expect(validateForm(state).languages).toBeUndefined();
  });

  it("checks coordinate and travel-time boundaries", () => {
    const state = validState();
    state.latitude = "91";
    state.longitude = "-181";
    state.maxTravelMinutes = "10";
    const errors = validateForm(state);
    expect(errors.latitude).toBeTruthy();
    expect(errors.longitude).toBeTruthy();
    expect(errors.maxTravelMinutes).toBeTruthy();
  });

  it("rejects music styles that are not in the controlled list", () => {
    const state = validState();
    state.genres = [{ id: "genre-1", name: "Anything typed by a user", weight: "like" }];

    expect(validateForm(state, "en").genres).toBe("Choose music styles from the provided list.");
  });

  it("limits the controlled music-style selection to three", () => {
    const state = validState();
    state.genres = GENRE_OPTIONS.slice(0, 4).map((option, index) => ({
      id: `genre-${index}`,
      name: option.value,
      weight: "like"
    }));

    expect(validateForm(state, "en").genres).toBe("You can select up to 3 music styles.");
  });

  it("rejects blank coordinates instead of treating them as zero", () => {
    const state = validState();
    state.latitude = "";
    state.longitude = "   ";

    const errors = validateForm(state);

    expect(errors.latitude).toBeTruthy();
    expect(errors.longitude).toBeTruthy();
  });
});

describe("toValidationInput", () => {
  it("trims names and converts form numbers", () => {
    const input = toValidationInput(validState());
    expect(input.artists).toEqual([{ name: "王力宏", weight: "priority" }]);
    expect(input.languages[0]).toEqual({ language: "普通话", percentage: 90 });
    expect(input.origin.latitude).toBe(37.8044);
    expect(input.maxTravelMinutes).toBe(120);
    expect(input.forecastMonths).toBe(3);
    expect(input.genres).toEqual([{ name: "R&B", weight: "like" }]);
  });

  it("omits language entries when language is unrestricted", () => {
    const state = validState();
    state.languageMode = "any";
    expect(toValidationInput(state).languages).toEqual([]);
  });

  it("does not coerce blank required numbers to zero", () => {
    const state = validState();
    state.latitude = "";
    state.longitude = " ";

    const input = toValidationInput(state);

    expect(input.origin.latitude).toBeNaN();
    expect(input.origin.longitude).toBeNaN();
  });

  it("only sends canonical English genre values to the backend", () => {
    const state = validState();
    state.genres = [
      { id: "genre-1", name: "Mandopop", weight: "priority" },
      { id: "genre-2", name: "华语流行", weight: "like" }
    ];

    expect(toValidationInput(state).genres).toEqual([{ name: "Mandopop", weight: "priority" }]);
  });
});

describe("controlled genre taxonomy", () => {
  it("uses unique canonical English values with localized labels", () => {
    const values = GENRE_OPTIONS.map((option) => option.value);

    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain("Mandopop");
    expect(genreLabel("Mandopop", "en")).toBe("Mandopop");
    expect(genreLabel("Mandopop", "zh")).toBe("华语流行");
  });
});
