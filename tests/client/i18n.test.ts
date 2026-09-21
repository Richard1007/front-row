import { describe, expect, it } from "vitest";

import {
  LOCALE_STORAGE_KEY,
  readStoredLocale,
  storeLocale,
  tr,
  translateServerText
} from "../../src/client/i18n";

describe("client localization", () => {
  it("defaults to English and restores a saved Chinese choice", () => {
    expect(readStoredLocale({ getItem: () => null })).toBe("en");
    expect(readStoredLocale({ getItem: () => "unexpected" })).toBe("en");
    expect(readStoredLocale({ getItem: () => "zh" })).toBe("zh");
  });

  it("persists the selected locale", () => {
    const calls: Array<[string, string]> = [];
    storeLocale("zh", { setItem: (key, value) => calls.push([key, value]) });
    expect(calls).toEqual([[LOCALE_STORAGE_KEY, "zh"]]);
  });

  it("keeps both dictionaries complete for representative UI copy", () => {
    expect(tr("en", "generate")).toBe("Generate my recommendations");
    expect(tr("zh", "generate")).toBe("生成我的推荐");
    expect(tr("en", "preferenceSummary", { artists: 2, genres: 1, language: "Any language" }))
      .toBe("2 artists · 1 styles · Any language");
  });

  it("translates dynamic recommendation reasons and known warnings", () => {
    expect(translateServerText("en", "Wang Leehom 是你明确选择的艺人；演唱语言包含 普通话"))
      .toBe("Wang Leehom is an artist you explicitly selected; Includes Mandarin as a performance language");
    expect(translateServerText("en", "暂无可靠的演唱语言信息，未因此降低排名"))
      .toContain("No reliable performance-language data");
    expect(translateServerText("en", "AI 根据 方大同 推断：shares jazz harmony"))
      .toBe("AI taste match from 方大同: shares jazz harmony");
  });

  it("never leaks an unknown Chinese server message into English mode", () => {
    const translated = translateServerText("en", "一个尚未收录的服务端消息");
    expect(translated).toBe("The data source returned an untranslated message.");
    expect(translated).not.toMatch(/\p{Script=Han}/u);
  });

  it("leaves server text unchanged in Chinese mode", () => {
    expect(translateServerText("zh", "演出状态尚未确认")).toBe("演出状态尚未确认");
  });
});
