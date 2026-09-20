export const LANGUAGE_OPTIONS = [
  {
    value: "cmn",
    en: "Chinese / Mandarin",
    zh: "中文 / 普通话",
    aliases: ["cmn", "zh", "zh-cn", "chinese", "mandarin", "mandarin chinese", "中文", "普通话", "普通話", "国语", "國語"]
  },
  {
    value: "yue",
    en: "Cantonese",
    zh: "粤语",
    aliases: ["yue", "zh-yue", "cantonese", "粤语", "粵語", "广东话", "廣東話"]
  },
  { value: "en", en: "English", zh: "英语", aliases: ["en", "english", "英语", "英語", "英文"] },
  { value: "es", en: "Spanish", zh: "西班牙语", aliases: ["es", "spanish", "español", "西班牙语", "西班牙語"] },
  { value: "fr", en: "French", zh: "法语", aliases: ["fr", "french", "français", "法语", "法語"] },
  { value: "ko", en: "Korean", zh: "韩语", aliases: ["ko", "korean", "한국어", "韩语", "韓語"] },
  { value: "ja", en: "Japanese", zh: "日语", aliases: ["ja", "japanese", "日本語", "日语", "日語"] },
  { value: "pt", en: "Portuguese", zh: "葡萄牙语", aliases: ["pt", "portuguese", "português", "葡萄牙语", "葡萄牙語"] },
  { value: "de", en: "German", zh: "德语", aliases: ["de", "german", "deutsch", "德语", "德語"] },
  { value: "it", en: "Italian", zh: "意大利语", aliases: ["it", "italian", "italiano", "意大利语", "意大利語"] },
  { value: "ar", en: "Arabic", zh: "阿拉伯语", aliases: ["ar", "arabic", "العربية", "阿拉伯语", "阿拉伯語"] },
  { value: "hi", en: "Hindi", zh: "印地语", aliases: ["hi", "hindi", "हिन्दी", "हिंदी", "印地语", "印地語"] }
] as const;

export type LanguageValue = (typeof LANGUAGE_OPTIONS)[number]["value"];
export type LanguageLocale = "en" | "zh";

function normalizedLanguageText(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

const languageValueByAlias = new Map<string, LanguageValue>();
for (const option of LANGUAGE_OPTIONS) {
  for (const alias of option.aliases) {
    languageValueByAlias.set(normalizedLanguageText(alias), option.value);
  }
}

export function normalizeLanguageValue(value: string): string {
  const normalized = normalizedLanguageText(value);
  return languageValueByAlias.get(normalized) ?? normalized;
}

export function isLanguageValue(value: string): value is LanguageValue {
  return LANGUAGE_OPTIONS.some((option) => option.value === value);
}

export function languageLabel(value: string, locale: LanguageLocale): string {
  const option = LANGUAGE_OPTIONS.find((candidate) => candidate.value === value);
  return option?.[locale] ?? value;
}
