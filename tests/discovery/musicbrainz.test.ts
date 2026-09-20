import { describe, expect, it, vi } from "vitest";

import {
  MusicBrainzClient,
  parseArtistDetails,
  parseExactArtist
} from "../../src/discovery/musicbrainz.js";

describe("MusicBrainz artist resolution", () => {
  it("keeps confirmed aliases for provider queries", () => {
    expect(parseArtistDetails({
      id: "ae0fd83f-8e50-4cb4-935e-ac7c0b7d7d17",
      name: "王力宏",
      aliases: [{ name: "Wang Leehom" }, { name: "Leehom Wang" }]
    })).toEqual({
      id: "ae0fd83f-8e50-4cb4-935e-ac7c0b7d7d17",
      name: "王力宏",
      aliases: ["Wang Leehom", "Leehom Wang"]
    });
  });

  it("accepts only a high-confidence result with a clear lead", () => {
    expect(
      parseExactArtist({
        artists: [
          { id: "wang", name: "王力宏", score: 100 },
          { id: "other", name: "Wang Chung", score: 42 }
        ]
      })
    ).toEqual({ id: "wang", name: "王力宏", score: 100 });
    expect(parseExactArtist({ artists: [{ id: "low", name: "Maybe", score: 94 }] })).toBeUndefined();
    expect(
      parseExactArtist({
        artists: [
          { id: "one", name: "Phoenix", score: 100 },
          { id: "two", name: "Phoenix", score: 95 }
        ]
      })
    ).toBeUndefined();
  });

  it("uses a meaningful User-Agent and caches exact searches", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      jsonResponse({ artists: [{ id: "wang", name: "王力宏", score: "100" }] })
    );
    const client = new MusicBrainzClient({ fetch: fetcher, minRequestIntervalMs: 0 });

    await expect(client.resolveExactArtist("Wang Leehom")).resolves.toMatchObject({ id: "wang" });
    await expect(client.resolveExactArtist("wang leehom")).resolves.toMatchObject({ id: "wang" });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [rawUrl, init] = fetcher.mock.calls[0] ?? [];
    const url = new URL(String(rawUrl));
    expect(url.searchParams.get("query")).toBe('"Wang Leehom"');
    expect(new Headers(init?.headers).get("User-Agent")).toContain("FrontRow/0.1.0");
  });

  it("serializes uncached requests at no more than one start per second", async () => {
    let now = 0;
    const sleep = vi.fn(async (milliseconds: number) => {
      now += milliseconds;
    });
    const fetcher = vi.fn<typeof fetch>(async (request) => {
      const query = new URL(String(request)).searchParams.get("query") ?? "unknown";
      return jsonResponse({ artists: [{ id: query, name: query, score: 100 }] });
    });
    const client = new MusicBrainzClient({ fetch: fetcher, now: () => now, sleep });

    await Promise.all([client.resolveExactArtist("Artist A"), client.resolveExactArtist("Artist B")]);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1_000);
  });
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
