import type {
  ImportanceLevel,
  LanguagePreference,
  ValidationInput,
  WeightedPreference
} from "../core/types";
import { isGenreValue } from "../data/genres";
import { isLanguageValue } from "../data/languages";
import { tr, type Locale } from "./i18n";

export { GENRE_OPTIONS, genreLabel, isGenreValue } from "../data/genres";
export type { GenreValue } from "../data/genres";

export interface EditablePreference {
  id: string;
  name: string;
  weight: ImportanceLevel;
}

export interface EditableLanguage {
  id: string;
  language: string;
}

export interface ValidationFormState {
  artists: EditablePreference[];
  genres: EditablePreference[];
  languages: EditableLanguage[];
  languageMode: "weighted" | "any";
  locationMode: "city" | "current";
  selectedCityId: string;
  originLabel: string;
  latitude: string;
  longitude: string;
  maxTravelMinutes: string;
}

export type FormErrors = Partial<
  Record<
    | "artists"
    | "genres"
    | "languages"
    | "originLabel"
    | "latitude"
    | "longitude"
    | "maxTravelMinutes",
    string
  >
>;

const cleanPreferences = (items: EditablePreference[]): WeightedPreference[] =>
  items
    .map(({ name, weight }) => ({ name: name.trim(), weight }))
    .filter(({ name }) => name.length > 0);

const cleanGenres = (items: EditablePreference[]): WeightedPreference[] =>
  cleanPreferences(items).filter(({ name }) => isGenreValue(name));

const cleanLanguages = (items: EditableLanguage[]): LanguagePreference[] => {
  const values = items
    .map(({ language }) => language.trim())
    .filter(isLanguageValue);
  if (values.length === 0) return [];

  const hundredths = Math.floor(10_000 / values.length);
  return values.map((language, index) => ({
    language,
    percentage:
      index === values.length - 1
        ? (10_000 - hundredths * (values.length - 1)) / 100
        : hundredths / 100
  }));
};

const parseRequiredNumber = (value: string): number =>
  value.trim() === "" ? Number.NaN : Number(value);

export function validateForm(state: ValidationFormState, locale: Locale = "zh"): FormErrors {
  const errors: FormErrors = {};
  const artists = cleanPreferences(state.artists);
  const genres = cleanPreferences(state.genres);
  const latitude = parseRequiredNumber(state.latitude);
  const longitude = parseRequiredNumber(state.longitude);
  const travelMinutes = parseRequiredNumber(state.maxTravelMinutes);

  if (artists.length === 0) {
    errors.artists = tr(locale, "formArtistRequired");
  } else if (artists.length > 10) {
    errors.artists = tr(locale, "formArtistMax");
  }

  if (genres.length > 3) {
    errors.genres = tr(locale, "formGenreMax");
  } else if (genres.some(({ name }) => !isGenreValue(name))) {
    errors.genres = tr(locale, "formGenreInvalid");
  }

  if (state.languageMode === "weighted") {
    if (state.languages.length === 0) {
      errors.languages = tr(locale, "formLanguageRequired");
    } else if (state.languages.length > 3) {
      errors.languages = tr(locale, "formLanguageMax");
    } else if (state.languages.some(({ language }) => !isLanguageValue(language))) {
      errors.languages = tr(locale, "formLanguageInvalid");
    }
  }

  if (
    !state.originLabel.trim() ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    errors.originLabel = tr(locale, "formOriginRequired");
  }
  if (!Number.isFinite(travelMinutes) || travelMinutes < 15 || travelMinutes > 360) {
    errors.maxTravelMinutes = tr(locale, "formTravel");
  }

  return errors;
}

export function toValidationInput(state: ValidationFormState): ValidationInput {
  return {
    artists: cleanPreferences(state.artists),
    genres: cleanGenres(state.genres),
    languages: state.languageMode === "any" ? [] : cleanLanguages(state.languages),
    languageMode: state.languageMode,
    origin: {
      label: state.originLabel.trim(),
      latitude: parseRequiredNumber(state.latitude),
      longitude: parseRequiredNumber(state.longitude)
    },
    maxTravelMinutes: parseRequiredNumber(state.maxTravelMinutes),
    forecastMonths: 4
  };
}
