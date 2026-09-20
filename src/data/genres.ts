export const GENRE_OPTIONS = [
  { value: "Pop", en: "Pop", zh: "流行" },
  { value: "Rock", en: "Rock", zh: "摇滚" },
  { value: "R&B", en: "R&B", zh: "节奏布鲁斯" },
  { value: "Hip-Hop/Rap", en: "Hip-Hop / Rap", zh: "嘻哈 / 说唱" },
  { value: "Electronic", en: "Electronic", zh: "电子" },
  { value: "Alternative", en: "Alternative", zh: "另类" },
  { value: "Indie", en: "Indie", zh: "独立" },
  { value: "Jazz", en: "Jazz", zh: "爵士" },
  { value: "Classical", en: "Classical", zh: "古典" },
  { value: "Country", en: "Country", zh: "乡村" },
  { value: "Folk", en: "Folk", zh: "民谣" },
  { value: "Blues", en: "Blues", zh: "蓝调" },
  { value: "Soul", en: "Soul", zh: "灵魂乐" },
  { value: "Metal", en: "Metal", zh: "金属" },
  { value: "Punk", en: "Punk", zh: "朋克" },
  { value: "Reggae", en: "Reggae", zh: "雷鬼" },
  { value: "Latin", en: "Latin", zh: "拉丁" },
  { value: "Mandopop", en: "Mandopop", zh: "华语流行" },
  { value: "Cantopop", en: "Cantopop", zh: "粤语流行" },
  { value: "K-Pop", en: "K-Pop", zh: "韩国流行" },
  { value: "J-Pop", en: "J-Pop", zh: "日本流行" },
  { value: "World", en: "World", zh: "世界音乐" }
] as const;

export type GenreValue = (typeof GENRE_OPTIONS)[number]["value"];
export type GenreLocale = "en" | "zh";

export function isGenreValue(value: string): value is GenreValue {
  return GENRE_OPTIONS.some((option) => option.value === value);
}

export function genreLabel(value: string, locale: GenreLocale): string {
  const option = GENRE_OPTIONS.find((candidate) => candidate.value === value);
  return option?.[locale] ?? value;
}
