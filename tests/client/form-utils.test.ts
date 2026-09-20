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
    { id: "language-1", language: "cmn" },
    { id: "language-2", language: "en" }
  ],
  languageMode: "weighted",
  locationMode: "city",
  selectedCityId: "geonames:5378538",
  originLabel: "Oakland, California, United States",
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
    expect(errors.originLabel).toBe("Choose a city from the list or load your current location.");
  });

  it("limits language categories to three", () => {
    const state = validState();
    state.languages = ["cmn", "en", "es", "fr"].map((language, index) => ({
      id: `language-${index}`,
      language
    }));
    expect(validateForm(state, "en").languages).toBe("Choose up to 3 accepted performance languages.");
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
    expect(errors.originLabel).toBeTruthy();
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

    expect(errors.originLabel).toBeTruthy();
  });
});

describe("toValidationInput", () => {
  it("trims names and converts form numbers", () => {
    const input = toValidationInput(validState());
    expect(input.artists).toEqual([{ name: "王力宏", weight: "priority" }]);
    expect(input.languages).toEqual([
      { language: "cmn", percentage: 50 },
      { language: "en", percentage: 50 }
    ]);
    expect(input.origin.latitude).toBe(37.8044);
    expect(input.maxTravelMinutes).toBe(120);
    expect(input.forecastMonths).toBe(4);
    expect(input.genres).toEqual([{ name: "R&B", weight: "like" }]);
  });

  it("omits language entries when language is unrestricted", () => {
    const state = validState();
    state.languageMode = "any";
    expect(toValidationInput(state).languages).toEqual([]);
  });

  it("splits three selected languages to exactly 100 percent", () => {
    const state = validState();
    state.languages = ["cmn", "en", "fr"].map((language, index) => ({
      id: `language-${index}`,
      language
    }));

    const languages = toValidationInput(state).languages;
    expect(languages).toEqual([
      { language: "cmn", percentage: 33.33 },
      { language: "en", percentage: 33.33 },
      { language: "fr", percentage: 33.34 }
    ]);
    expect(languages.reduce((total, item) => total + item.percentage, 0)).toBe(100);
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
