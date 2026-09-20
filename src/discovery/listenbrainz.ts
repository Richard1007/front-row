import { ExpiringMemoryCache } from "./cache.js";

const DEFAULT_BASE_URL = "https://api.listenbrainz.org";
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

export interface ListenBrainzSimilarArtist {
  id: string;
  name: string;
  rank: number;
}

export interface ListenBrainzClientOptions {
  baseUrl?: string;
  cacheTtlMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  requestTimeoutMs?: number;
}

export class ListenBrainzClient {
  private readonly baseUrl: string;
  private readonly cache: ExpiringMemoryCache<ListenBrainzSimilarArtist[]>;
  private readonly fetcher: typeof fetch;
  private readonly requestTimeoutMs: number;

  constructor(options: ListenBrainzClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetcher = options.fetch ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 8_000;
    this.cache = new ExpiringMemoryCache({
      ttlMs: options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      now: options.now
    });
  }

  async similarArtists(
    seedMusicBrainzId: string,
    limit: number
  ): Promise<ListenBrainzSimilarArtist[]> {
    const safeLimit = Math.max(0, Math.floor(limit));
    if (!seedMusicBrainzId || safeLimit === 0) return [];
    const cacheKey = `${seedMusicBrainzId}:${safeLimit}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams({
      mode: "easy",
      max_similar_artists: String(safeLimit),
      max_recordings_per_artist: "1",
      pop_begin: "0",
      pop_end: "100"
    });
    const response = await this.fetcher(
      `${this.baseUrl}/1/lb-radio/artist/${encodeURIComponent(seedMusicBrainzId)}?${params}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(this.requestTimeoutMs)
      }
    );
    if (!response.ok) {
      throw new Error(`ListenBrainz artist radio failed (${response.status}).`);
    }
    const result = parseSimilarArtists(await response.json(), seedMusicBrainzId).slice(0, safeLimit);
    this.cache.set(cacheKey, result);
    return result;
  }
}

export function parseSimilarArtists(
  payload: unknown,
  seedMusicBrainzId: string
): ListenBrainzSimilarArtist[] {
  const record = asRecord(payload);
  if (!record) return [];

  const result: ListenBrainzSimilarArtist[] = [];
  const seen = new Set<string>([seedMusicBrainzId]);
  for (const recordings of Object.values(record)) {
    if (!Array.isArray(recordings)) continue;
    for (const recording of recordings) {
      const item = asRecord(recording);
      const id = typeof item?.similar_artist_mbid === "string" ? item.similar_artist_mbid : undefined;
      const name = typeof item?.similar_artist_name === "string" ? item.similar_artist_name.trim() : "";
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      result.push({ id, name, rank: result.length + 1 });
      break;
    }
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}
