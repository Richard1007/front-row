import { describe, expect, it } from "vitest";
import { toValidationInput, validateForm, type ValidationFormState } from "../../src/client/form-utils";

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
    expect(input.forecastDays).toBe(90);
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
});
