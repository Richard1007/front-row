import { config as loadEnvironment } from "dotenv";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { pathToFileURL } from "node:url";
import {
  buildRecommendationCandidatePool,
  buildRecommendationSelection,
  enrichValidationInput,
  safeValidateInput,
} from "../core/index.js";
import type {
  ArtistExpansionCandidate,
  ProviderCapability,
  ValidationResult
} from "../core/types.js";
import {
  applyLlmEventSelections,
  applyExpansionEvidence,
  expandArtistPreferences,
  hydrateExplicitArtists,
  inferArtistGenres,
  inferArtistLanguagePreferences,
  ListenBrainzClient,
  LLM_ARTIST_EXPANSION_MODELS,
  LlmArtistExpansionClient,
  LlmEventSelectionClient,
  mergeLlmEventRecommendations,
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
const MAX_LLM_ARTIST_PROPOSALS = 20;
const MAX_VERIFIED_LLM_ARTISTS = 12;
// Ticketmaster queries discovery artists individually while JamBase batches
// them. This hard ceiling still prevents a wide model response from multiplying
// quota and latency downstream.
const MAX_TICKET_DISCOVERY_ARTISTS = 12;
const llmDiscoveryEnabled = process.env.FR_LLM_DISCOVERY_ENABLED === "true";
const configuredLlmModel = LLM_ARTIST_EXPANSION_MODELS.includes(
  process.env.FR_LLM_DISCOVERY_MODEL as LlmArtistExpansionModel
)
  ? process.env.FR_LLM_DISCOVERY_MODEL as LlmArtistExpansionModel
  : "gpt-6-astra";
const llmArtistExpansion = new LlmArtistExpansionClient({
  apiKey: llmDiscoveryEnabled ? process.env.OPENAI_API_KEY : undefined,
  model: configuredLlmModel,
  maxCandidates: MAX_LLM_ARTIST_PROPOSALS,
  timeoutMs: 45_000
});
const llmEventSelection = new LlmEventSelectionClient({
  apiKey: llmDiscoveryEnabled ? process.env.OPENAI_API_KEY : undefined,
  model: configuredLlmModel,
  timeoutMs: 45_000
});
const port = Number(process.env.FR_LOCAL_API_PORT || 8787);
const MAX_JSON_BYTES = 64 * 1024;

app.get("/api/health", (context) =>
  context.json({ ok: true, service: "front-row-local-api" })
);

function providerPayload(): { providers: ProviderCapability[] } {
  return { providers: registry.capabilities() };
}

function selectTicketDiscoveryCandidates(
  sourced: readonly ArtistExpansionCandidate[],
  modelExpanded: readonly ArtistExpansionCandidate[]
): ArtistExpansionCandidate[] {
  const selected: ArtistExpansionCandidate[] = [];
  const seen = new Set<string>();
  const longest = Math.max(sourced.length, modelExpanded.length);
  for (let index = 0; index < longest && selected.length < MAX_TICKET_DISCOVERY_ARTISTS; index += 1) {
    // Alternating keeps independently sourced similarity represented while
    // giving fine-grained model expansion meaningful room in the fixed budget.
    for (const candidate of [sourced[index], modelExpanded[index]]) {
      if (!candidate || seen.has(candidate.canonicalId)) continue;
      seen.add(candidate.canonicalId);
      selected.push(candidate);
      if (selected.length >= MAX_TICKET_DISCOVERY_ARTISTS) break;
    }
  }
  return selected;
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
        maxCandidates: MAX_VERIFIED_LLM_ARTISTS,
        maxVerificationAttempts: MAX_LLM_ARTIST_PROPOSALS
      })
    : [];
  const combinedCandidates = selectTicketDiscoveryCandidates(
    expansion.candidates,
    verifiedLlmCandidates
  );
  const selectedLlmCandidateIds = new Set(
    combinedCandidates
      .filter((candidate) => candidate.evidence.some((evidence) => evidence.source === "openai"))
      .map((candidate) => candidate.canonicalId)
  );
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
  const deterministicRecommendations = selection.recommendations;
  const exactRecommendations = deterministicRecommendations.filter(
    (event) => event.tier === "T0" || event.tier === "T1"
  );
  const candidatePool = buildRecommendationCandidatePool(rankingInput, eventsWithSimilarity);
  const verifiedRegionalCandidates = [
    ...candidatePool.candidates.filter((event) => event.tier === "T2" || event.tier === "T3"),
    ...candidatePool.fallbackCandidates
  ];
  const eventSelection = await llmEventSelection.select({
    preferences: rankingInput,
    lockedExactEvents: exactRecommendations,
    candidates: verifiedRegionalCandidates,
    resultLimit: 9
  });
  const recommendations = eventSelection.status === "completed"
    ? mergeLlmEventRecommendations(
        exactRecommendations,
        applyLlmEventSelections(verifiedRegionalCandidates, eventSelection.selections),
        deterministicRecommendations
      )
    : deterministicRecommendations;
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
        candidateArtists: verifiedLlmCandidates
          .filter((candidate) => selectedLlmCandidateIds.has(candidate.canonicalId))
          .map((candidate) => candidate.name),
        cached: llmExpansion.cached,
        ...(llmExpansion.estimatedCostUsd === null
          ? {}
          : { estimatedCostUsd: llmExpansion.estimatedCostUsd }),
        ...(llmExpansion.error ? { message: llmExpansion.error } : {})
      },
      llmSelection: {
        status: eventSelection.status === "completed"
          ? "completed"
          : eventSelection.status === "disabled" || eventSelection.status === "skipped"
            ? "disabled"
            : "failed",
        model: eventSelection.model,
        selectedEvents: eventSelection.selections.length,
        cached: eventSelection.cached,
        ...(eventSelection.latencyMs === null ? {} : { latencyMs: eventSelection.latencyMs }),
        ...(eventSelection.estimatedCostUsd === null
          ? {}
          : { estimatedCostUsd: eventSelection.estimatedCostUsd }),
        ...(eventSelection.error ? { message: eventSelection.error } : {})
      }
    },
    coverage: recommendationCoverage(events.length, {
      ...selection.funnel,
      selectedEvents: recommendations.length
    })
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
