import { describe, expect, it, vi } from "vitest";

import {
  ListenBrainzClient,
  parseSimilarArtists
} from "../../src/discovery/listenbrainz.js";

const RESPONSE = {
  relatedOne: [
    {
      similar_artist_mbid: "related-one",
      similar_artist_name: "林俊杰",
      recording_mbid: "recording-one"
    }
  ],
  seed: [
    {
      similar_artist_mbid: "seed-id",
      similar_artist_name: "王力宏",
      recording_mbid: "recording-seed"
    }
  ],
  relatedTwo: [
    {
      similar_artist_mbid: "related-two",
      similar_artist_name: "五月天",
      recording_mbid: "recording-two"
    }
  ]
};

describe("ListenBrainz artist discovery", () => {
  it("parses related artists, preserves source rank, and removes the seed", () => {
    expect(parseSimilarArtists(RESPONSE, "seed-id")).toEqual([
      { id: "related-one", name: "林俊杰", rank: 1 },
      { id: "related-two", name: "五月天", rank: 2 }
    ]);
  });

  it("uses easy mode without authentication and caches results", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(RESPONSE));
    const client = new ListenBrainzClient({ fetch: fetcher });

    await expect(client.similarArtists("seed-id", 2)).resolves.toHaveLength(2);
    await expect(client.similarArtists("seed-id", 2)).resolves.toHaveLength(2);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [rawUrl, init] = fetcher.mock.calls[0] ?? [];
    const url = new URL(String(rawUrl));
    expect(url.pathname).toBe("/1/lb-radio/artist/seed-id");
    expect(url.searchParams.get("mode")).toBe("easy");
    expect(url.searchParams.get("max_similar_artists")).toBe("2");
    expect(url.searchParams.get("pop_begin")).toBe("0");
    expect(url.searchParams.get("pop_end")).toBe("100");
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
  });
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
