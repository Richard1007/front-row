import type {
  ImportanceLevel,
  LanguagePreference,
  ValidationInput,
  WeightedPreference
} from "../core/types";

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

const cleanLanguages = (items: EditableLanguage[]): LanguagePreference[] =>
  items
    .map(({ language, percentage }) => ({
      language: language.trim(),
      percentage: Number(percentage)
    }))
    .filter(({ language }) => language.length > 0);

const parseRequiredNumber = (value: string): number =>
  value.trim() === "" ? Number.NaN : Number(value);

export function validateForm(state: ValidationFormState): FormErrors {
  const errors: FormErrors = {};
  const artists = cleanPreferences(state.artists);
  const genres = cleanPreferences(state.genres);
  const latitude = parseRequiredNumber(state.latitude);
  const longitude = parseRequiredNumber(state.longitude);
  const travelMinutes = parseRequiredNumber(state.maxTravelMinutes);

  if (artists.length === 0) {
    errors.artists = "请至少填写一位你真正想看的艺人。";
  } else if (artists.length > 10) {
    errors.artists = "最多可以填写 10 位艺人。";
  }

  if (genres.length > 3) {
    errors.genres = "最多可以填写 3 种音乐风格。";
  }

  if (state.languageMode === "weighted") {
    const languages = cleanLanguages(state.languages);
    const hasInvalidPercentage = languages.some(
      ({ percentage }) => !Number.isFinite(percentage) || percentage < 0 || percentage > 100
    );
    const total = languages.reduce((sum, { percentage }) => sum + percentage, 0);

    if (languages.length === 0) {
      errors.languages = "请至少填写一种演唱语言，或者选择“语言不限”。";
    } else if (hasInvalidPercentage) {
      errors.languages = "每一种语言的比例必须在 0% 到 100% 之间。";
    } else if (Math.abs(total - 100) > 0.01) {
      errors.languages = `语言比例目前合计 ${total}%，需要正好是 100%。`;
    }
  }

  if (!state.originLabel.trim()) {
    errors.originLabel = "请给出发点写一个容易辨认的名称。";
  }
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    errors.latitude = "纬度需要在 -90 到 90 之间。";
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    errors.longitude = "经度需要在 -180 到 180 之间。";
  }
  if (!Number.isFinite(travelMinutes) || travelMinutes < 15 || travelMinutes > 360) {
    errors.maxTravelMinutes = "最长出行时间需要在 15 到 360 分钟之间。";
  }

  return errors;
}

export function toValidationInput(state: ValidationFormState): ValidationInput {
  return {
    artists: cleanPreferences(state.artists),
    genres: cleanPreferences(state.genres),
    languages: state.languageMode === "any" ? [] : cleanLanguages(state.languages),
    languageMode: state.languageMode,
    origin: {
      label: state.originLabel.trim(),
      latitude: parseRequiredNumber(state.latitude),
      longitude: parseRequiredNumber(state.longitude)
    },
    maxTravelMinutes: parseRequiredNumber(state.maxTravelMinutes),
    forecastDays: 90
  };
}
