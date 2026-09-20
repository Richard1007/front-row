import { z } from "zod";

import { findArtistProfile } from "../data/artistProfiles.js";
import { isGenreValue } from "../data/genres.js";
import { isLanguageValue, normalizeLanguageValue } from "../data/languages.js";
import type { ValidationInput } from "./types.js";

const importanceSchema = z.enum(["priority", "like", "occasional"]);

const weightedPreferenceSchema = z.object({
  name: z.string().trim().min(1, "名称不能为空").max(120, "名称过长"),
  weight: importanceSchema,
  canonicalId: z.string().trim().min(1).max(200).optional(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(20).optional()
});

const genrePreferenceSchema = weightedPreferenceSchema.extend({
  name: z
    .string()
    .trim()
    .min(1, "名称不能为空")
    .refine(isGenreValue, "请选择提供的音乐风格")
});

const languagePreferenceSchema = z.object({
  language: z
    .string()
    .trim()
    .min(1, "语言不能为空")
    .max(40)
    .transform(normalizeLanguageValue)
    .refine(isLanguageValue, "请选择提供的语言"),
  percentage: z.number().finite().min(0).max(100)
});

function normalizedName(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

function containsDuplicates(values: string[]): boolean {
  return new Set(values.map(normalizedName)).size !== values.length;
}

function artistIdentityKey(artist: z.infer<typeof weightedPreferenceSchema>): string {
  const profile = findArtistProfile(artist.name, artist.canonicalId);
  if (profile) return `profile:${profile.canonicalId}`;
  if (artist.canonicalId) return `canonical:${normalizedName(artist.canonicalId)}`;
  return `name:${normalizedName(artist.name)}`;
}

export const validationInputSchema = z
  .object({
    artists: z
      .array(weightedPreferenceSchema)
      .min(1, "请至少选择 1 位艺人")
      .max(10, "最多选择 10 位艺人"),
    genres: z.array(genrePreferenceSchema).max(3, "最多选择 3 种风格"),
    languages: z.array(languagePreferenceSchema).max(3, "最多选择 3 种语言"),
    languageMode: z.enum(["weighted", "any"]),
    origin: z.object({
      label: z.string().trim().min(1, "出发地点不能为空").max(160),
      latitude: z.number().finite().min(-90).max(90),
      longitude: z.number().finite().min(-180).max(180)
    }),
    maxTravelMinutes: z.number().int().min(15).max(360),
    forecastMonths: z.number().int().default(4)
  })
  .superRefine((value, context) => {
    if (value.forecastMonths !== 4) {
      context.addIssue({
        code: "custom",
        path: ["forecastMonths"],
        message: "Milestone 0 固定搜索未来四个月"
      });
    }

    if (containsDuplicates(value.artists.map(artistIdentityKey))) {
      context.addIssue({
        code: "custom",
        path: ["artists"],
        message: "同一位艺人不能重复添加"
      });
    }

    if (containsDuplicates(value.genres.map((genre) => genre.name))) {
      context.addIssue({
        code: "custom",
        path: ["genres"],
        message: "同一种风格不能重复添加"
      });
    }

    if (containsDuplicates(value.languages.map((language) => language.language))) {
      context.addIssue({
        code: "custom",
        path: ["languages"],
        message: "同一种语言不能重复添加"
      });
    }

    if (value.languageMode === "any" && value.languages.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["languages"],
        message: "选择“语言不限”时无需设置语言比例"
      });
    }

    if (value.languageMode === "weighted") {
      if (value.languages.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["languages"],
          message: "请至少添加一种语言，或选择“语言不限”"
        });
      }

      const total = value.languages.reduce((sum, item) => sum + item.percentage, 0);
      if (Math.abs(total - 100) > 0.001) {
        context.addIssue({
          code: "custom",
          path: ["languages"],
          message: "语言比例总和必须是 100%"
        });
      }
    }
  });

export function validateInput(input: unknown): ValidationInput {
  return validationInputSchema.parse(input);
}

export function safeValidateInput(input: unknown) {
  return validationInputSchema.safeParse(input);
}
