import type {
  ImportanceLevel,
  LanguagePreference,
  ValidationInput,
  WeightedPreference
} from "../core/types";
import { isGenreValue } from "../data/genres";
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
  percentage: string;
}

export interface ValidationFormState {
  artists: EditablePreference[];
  genres: EditablePreference[];
  languages: EditableLanguage[];
  languageMode: "weighted" | "any";
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

const cleanLanguages = (items: EditableLanguage[]): LanguagePreference[] =>
  items
    .map(({ language, percentage }) => ({
      language: language.trim(),
      percentage: Number(percentage)
    }))
    .filter(({ language }) => language.length > 0);

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
    const languages = cleanLanguages(state.languages);
    const hasInvalidPercentage = languages.some(
      ({ percentage }) => !Number.isFinite(percentage) || percentage < 0 || percentage > 100
    );
    const total = languages.reduce((sum, { percentage }) => sum + percentage, 0);

    if (languages.length === 0) {
      errors.languages = tr(locale, "formLanguageRequired");
    } else if (hasInvalidPercentage) {
      errors.languages = tr(locale, "formLanguageRange");
    } else if (Math.abs(total - 100) > 0.01) {
      errors.languages = tr(locale, "formLanguageTotal", { total });
    }
  }

  if (!state.originLabel.trim()) {
    errors.originLabel = tr(locale, "formOriginRequired");
  }
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    errors.latitude = tr(locale, "formLatitude");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    errors.longitude = tr(locale, "formLongitude");
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
    forecastMonths: 3
  };
}
