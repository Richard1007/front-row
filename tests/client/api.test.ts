import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError, createValidationRun } from "../../src/client/api";
import type { ValidationInput } from "../../src/core/types";

const input: ValidationInput = {
  artists: [{ name: "王力宏", weight: "priority" }],
  genres: [],
  languages: [],
  languageMode: "any",
  origin: { label: "Oakland", latitude: 37.8044, longitude: -122.2712 },
  maxTravelMinutes: 120,
  forecastDays: 90
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("client API errors", () => {
  it("preserves server validation issues for the error summary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: "请检查输入内容。",
            issues: [{ path: "artists", message: "同一位艺人不能重复添加" }]
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    const request = createValidationRun(input);

    await expect(request).rejects.toBeInstanceOf(ApiRequestError);
    await expect(request).rejects.toMatchObject({
      message: "请检查输入内容。",
      status: 400,
      issues: [{ path: "artists", message: "同一位艺人不能重复添加" }]
    });
  });
});
