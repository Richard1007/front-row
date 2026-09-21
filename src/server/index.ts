import { config as loadEnvironment } from "dotenv";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { pathToFileURL } from "node:url";
import {
  buildRecommendationSelection,
  enrichValidationInput,
  safeValidateInput,
} from "../core/index.js";
import type { ProviderCapability, ValidationResult } from "../core/types.js";
import {
  applyExpansionEvidence,
  expandArtistPreferences,
  hydrateExplicitArtists,
  inferArtistGenres,
  inferArtistLanguagePreferences,
  ListenBrainzClient,
  LLM_ARTIST_EXPANSION_MODELS,
  LlmArtistExpansionClient,
  MusicBrainzClient,
  verifyLlmArtistExpansion
} from "../discovery/index.js";
import type { LlmArtistExpansionModel } from "../discovery/index.js";
import { createProviderRegistry } from "../providers/index.js";
import { normalizeLocationQuery, searchLocations } from "./locations.js";
import { deriveDataMode, recommendationCoverage } from "./result.js";

loadEnvironment({ path: [".env.local", ".env"] });

const app = new Hono();
const registry = createProviderRegistry();
const musicBrainz = new MusicBrainzClient();
const listenBrainz = new ListenBrainzClient();
const llmDiscoveryEnabled = process.env.FR_LLM_DISCOVERY_ENABLED === "true";
const configuredLlmModel = LLM_ARTIST_EXPANSION_MODELS.includes(
  process.env.FR_LLM_DISCOVERY_MODEL as LlmArtistExpansionModel
)
  ? process.env.FR_LLM_DISCOVERY_MODEL as LlmArtistExpansionModel
  : "gpt-6-astra";
const llmArtistExpansion = new LlmArtistExpansionClient({
  apiKey: llmDiscoveryEnabled ? process.env.OPENAI_API_KEY : undefined,
  model: configuredLlmModel,
  maxCandidates: 4,
  timeoutMs: 30_000
});
const port = Number(process.env.FR_LOCAL_API_PORT || 8787);
const MAX_JSON_BYTES = 64 * 1024;

app.get("/api/health", (context) =>
  context.json({ ok: true, service: "front-row-local-api" })
);

function providerPayload(): { providers: ProviderCapability[] } {
  return { providers: registry.capabilities() };
}

app.get("/api/providers", (context) => context.json(providerPayload()));
app.get("/api/capabilities", (context) => context.json(providerPayload()));
app.get("/api/locations", (context) => {
  const query = context.req.query("q")?.trim() ?? "";
  if (normalizeLocationQuery(query).length < 2 || query.length > 80) {
    return context.json({ error: "City search must contain between 2 and 80 characters." }, 400);
  }
  const requestedLimit = Number(context.req.query("limit") ?? 6);
  return context.json({
    locations: searchLocations(query, Number.isFinite(requestedLimit) ? requestedLimit : 6)
  });
});

app.post("/api/validation-runs", async (context) => {
  const origin = context.req.header("Origin");
  if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) {
    return context.json({ error: "只接受来自本地 Front Row 页面的请求。" }, 403);
  }
  if (!context.req.header("Content-Type")?.toLowerCase().includes("application/json")) {
    return context.json({ error: "请求必须使用 JSON 格式。" }, 415);
  }

  let body: unknown;
  try {
    const rawBody = await context.req.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_JSON_BYTES) {
      return context.json({ error: "请求内容过大。" }, 413);
    }
    body = JSON.parse(rawBody);
  } catch {
    return context.json({ error: "请求内容不是有效的 JSON。" }, 400);
  }

  const parsed = safeValidateInput(body);
  if (!parsed.success) {
    return context.json(
      {
        error: "请检查输入内容。",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      },
      400
    );
  }

  const enrichedInput = enrichValidationInput(parsed.data);
  const hydratedArtists = await hydrateExplicitArtists(enrichedInput.artists, {
    resolveArtist: (name) => musicBrainz.resolveExactArtist(name),
    artistDetails: (musicBrainzId) => musicBrainz.artistDetails(musicBrainzId)
  });
  const identityInput = { ...enrichedInput, artists: hydratedArtists };
  const inferredLanguageProfile = await inferArtistLanguagePreferences(
    identityInput.artists,
    { resolveArtist: (name) => musicBrainz.resolveExactArtist(name) }
  );
  const inferredGenreProfile = await inferArtistGenres(identityInput.artists, {
    resolveArtist: (name) => musicBrainz.resolveExactArtist(name)
  });
  const rankingInput = {
    ...identityInput,
    inferredLanguages: inferredLanguageProfile.distribution,
    inferredGenres: inferredGenreProfile.signals.map((signal) => ({
      name: signal.genre,
      percentage: signal.percentage,
      confidence: signal.confidence
    }))
  };
  const expansion = await expandArtistPreferences(identityInput.artists, {
    resolveArtist: (name) => musicBrainz.resolveExactArtist(name),
    similarArtists: (musicBrainzId, limit) =>
      listenBrainz.similarArtists(musicBrainzId, limit),
    maxCandidates: 8
  });
  const llmExpansion = await llmArtistExpansion.expand({
    artists: identityInput.artists,
    inferredLanguages: inferredLanguageProfile.distribution,
    inferredGenres: rankingInput.inferredGenres
  });
  const verifiedLlmCandidates = llmExpansion.status === "completed"
    ? await verifyLlmArtistExpansion(llmExpansion.candidates, identityInput.artists, {
        resolveArtist: (name) => musicBrainz.resolveExactArtist(name),
        existingCandidates: expansion.candidates,
        maxCandidates: 4,
        maxVerificationAttempts: 6
      })
    : [];
  const combinedCandidates = [...expansion.candidates, ...verifiedLlmCandidates].slice(0, 12);
  const hydratedCandidates = await Promise.all(
    combinedCandidates.map(async (candidate) => {
      try {
        const details = await musicBrainz.artistDetails(candidate.musicBrainzId);
        if (!details) return candidate;
        return {
          ...candidate,
          name: details.name,
          aliases: [...new Set([candidate.name, ...details.aliases])]
        };
      } catch {
        return candidate;
      }
    })
  );
  const retrievalInput = {
    ...rankingInput,
    discoveryArtists: hydratedCandidates
  };
  const { events, diagnostics } = await registry.fetchEvents(retrievalInput);
  const eventsWithSimilarity = applyExpansionEvidence(events, hydratedCandidates);
  const selection = buildRecommendationSelection(rankingInput, eventsWithSimilarity);
  const recommendations = selection.recommendations;
  const dataMode = deriveDataMode(events, diagnostics);

  const result: ValidationResult = {
    runId: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    dataMode,
    recommendations,
    diagnostics,
    discovery: {
      source: verifiedLlmCandidates.length > 0
        ? "musicbrainz-listenbrainz-openai"
        : "musicbrainz-listenbrainz",
      candidateArtists: hydratedCandidates.map((candidate) => candidate.name),
      unresolvedSeeds: expansion.diagnostics
        .filter((diagnostic) => diagnostic.status !== "expanded")
        .map((diagnostic) => diagnostic.seedName),
      inferredLanguages: inferredLanguageProfile.distribution,
      unknownLanguagePercentage: inferredLanguageProfile.unknownPercentage,
      inferredGenres: inferredGenreProfile.signals.map((signal) => ({
        name: signal.genre,
        percentage: signal.percentage,
        confidence: signal.confidence
      })),
      llmExpansion: {
        status: llmExpansion.status === "completed"
          ? "completed"
          : llmExpansion.status === "disabled" || llmExpansion.status === "skipped"
            ? "disabled"
            : "failed",
        model: llmExpansion.model,
        candidateArtists: verifiedLlmCandidates.map((candidate) => candidate.name),
        cached: llmExpansion.cached,
        ...(llmExpansion.estimatedCostUsd === null
          ? {}
          : { estimatedCostUsd: llmExpansion.estimatedCostUsd }),
        ...(llmExpansion.error ? { message: llmExpansion.error } : {})
      }
    },
    coverage: recommendationCoverage(events.length, selection.funnel)
  };

  return context.json(result);
});

app.onError((error, context) => {
  console.error(error);
  return context.json({ error: "本地服务发生错误，请查看终端信息。" }, 500);
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  serve({
    fetch: app.fetch,
    hostname: "127.0.0.1",
    port
  });

  console.log(`Front Row local API: http://127.0.0.1:${port}`);
}

export { app };
