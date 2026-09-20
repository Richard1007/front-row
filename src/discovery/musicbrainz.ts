import { ExpiringMemoryCache } from "./cache.js";

const DEFAULT_BASE_URL = "https://musicbrainz.org/ws/2";
const DEFAULT_USER_AGENT =
  "FrontRow/0.1.0 (https://github.com/Richard1007/front-row)";
const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export interface ResolvedMusicBrainzArtist {
  id: string;
  name: string;
  score: number;
  /** Community metadata; consumers must still apply a conservative allowlist. */
  tags?: string[];
  genres?: string[];
}

export interface MusicBrainzArtistDetails {
  id: string;
  name: string;
  aliases: string[];
}

export interface MusicBrainzClientOptions {
  baseUrl?: string;
  cacheTtlMs?: number;
  fetch?: typeof fetch;
  minRequestIntervalMs?: number;
  now?: () => number;
  requestTimeoutMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  userAgent?: string;
}

interface MusicBrainzArtistResult {
  id?: unknown;
  name?: unknown;
  score?: unknown;
  tags?: unknown;
  genres?: unknown;
}

export class MusicBrainzClient {
  private readonly baseUrl: string;
  private readonly cache: ExpiringMemoryCache<ResolvedMusicBrainzArtist | null>;
  private readonly detailsCache: ExpiringMemoryCache<MusicBrainzArtistDetails | null>;
  private readonly fetcher: typeof fetch;
  private readonly minRequestIntervalMs: number;
  private readonly now: () => number;
  private readonly requestTimeoutMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly userAgent: string;
  private lastRequestStartedAt: number | undefined;
  private requestQueue: Promise<void> = Promise.resolve();

  constructor(options: MusicBrainzClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetcher = options.fetch ?? fetch;
    this.minRequestIntervalMs = Math.max(0, options.minRequestIntervalMs ?? 1_000);
    this.now = options.now ?? Date.now;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 8_000;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.userAgent = options.userAgent?.trim() || DEFAULT_USER_AGENT;
    this.cache = new ExpiringMemoryCache({
      ttlMs: options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      now: this.now
    });
    this.detailsCache = new ExpiringMemoryCache({
      ttlMs: options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      now: this.now
    });
  }

  async resolveExactArtist(name: string): Promise<ResolvedMusicBrainzArtist | undefined> {
    const queryName = name.trim();
    if (!queryName) return undefined;
    const cacheKey = queryName.normalize("NFKC").toLocaleLowerCase("en-US");
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached ?? undefined;

    const result = await this.enqueue(async () => {
      const params = new URLSearchParams({
        fmt: "json",
        limit: "3",
        query: `"${escapeLucenePhrase(queryName)}"`
      });
      const response = await this.fetcher(`${this.baseUrl}/artist/?${params}`, {
        headers: {
          Accept: "application/json",
          "User-Agent": this.userAgent
        },
        signal: AbortSignal.timeout(this.requestTimeoutMs)
      });
      if (!response.ok) {
        throw new Error(`MusicBrainz artist search failed (${response.status}).`);
      }
      return parseExactArtist(await response.json());
    });

    this.cache.set(cacheKey, result ?? null);
    return result;
  }

  async artistDetails(id: string): Promise<MusicBrainzArtistDetails | undefined> {
    const musicBrainzId = id.trim();
    if (!/^[0-9a-f-]{36}$/i.test(musicBrainzId)) return undefined;
    const cached = this.detailsCache.get(musicBrainzId);
    if (cached !== undefined) return cached ?? undefined;

    const result = await this.enqueue(async () => {
      const params = new URLSearchParams({ fmt: "json", inc: "aliases" });
      const response = await this.fetcher(
        `${this.baseUrl}/artist/${encodeURIComponent(musicBrainzId)}?${params}`,
        {
          headers: {
            Accept: "application/json",
            "User-Agent": this.userAgent
          },
          signal: AbortSignal.timeout(this.requestTimeoutMs)
        }
      );
      if (!response.ok) throw new Error(`MusicBrainz artist lookup failed (${response.status}).`);
      return parseArtistDetails(await response.json());
    });

    this.detailsCache.set(musicBrainzId, result ?? null);
    return result;
  }

  private enqueue<T>(request: () => Promise<T>): Promise<T> {
    const run = this.requestQueue.then(async () => {
      if (this.lastRequestStartedAt !== undefined) {
        const waitMs = this.minRequestIntervalMs - (this.now() - this.lastRequestStartedAt);
        if (waitMs > 0) await this.sleep(waitMs);
      }
      this.lastRequestStartedAt = this.now();
      return request();
    });
    this.requestQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

export function parseArtistDetails(payload: unknown): MusicBrainzArtistDetails | undefined {
  const artist = asRecord(payload);
  if (!artist || typeof artist.id !== "string" || typeof artist.name !== "string") {
    return undefined;
  }
  const aliases = Array.isArray(artist.aliases)
    ? artist.aliases
        .map((alias) => asRecord(alias)?.name)
        .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    : [];
  return {
    id: artist.id,
    name: artist.name.trim(),
    aliases: [...new Set(aliases.map((alias) => alias.trim()))]
  };
}

export function parseExactArtist(payload: unknown): ResolvedMusicBrainzArtist | undefined {
  const record = asRecord(payload);
  const artists = Array.isArray(record?.artists) ? record.artists : [];
  const parsed = artists
    .map((artist) => parseArtist(artist))
    .filter((artist): artist is ResolvedMusicBrainzArtist => artist !== undefined)
    .sort((left, right) => right.score - left.score);
  const top = parsed[0];
  if (!top || top.score < 95) return undefined;
  const runnerUp = parsed[1];
  if (runnerUp && top.score - runnerUp.score < 10) return undefined;
  return top;
}

function parseArtist(value: unknown): ResolvedMusicBrainzArtist | undefined {
  const artist = asRecord(value) as MusicBrainzArtistResult | undefined;
  if (!artist || typeof artist.id !== "string" || typeof artist.name !== "string") {
    return undefined;
  }
  const score = typeof artist.score === "number" ? artist.score : Number(artist.score);
  if (!Number.isFinite(score)) return undefined;
  const tags = metadataNames(artist.tags);
  const genres = metadataNames(artist.genres);
  return {
    id: artist.id,
    name: artist.name,
    score,
    ...(tags.length > 0 ? { tags } : {}),
    ...(genres.length > 0 ? { genres } : {})
  };
}

function metadataNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map((item) => asRecord(item)?.name)
      .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
      .map((name) => name.trim())
  )];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function escapeLucenePhrase(value: string): string {
  return value.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, "\\$1");
}
