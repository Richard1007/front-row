# Front Row

Front Row is currently a private, local validation tool for concert recommendations. It asks for weighted artists, genres, performance-language preferences, and a travel boundary, then compares available event sources and returns a small, explained shortlist.

The search horizon is selectable from one to six calendar months and defaults to four. Music styles come from a controlled bilingual list (up to three), while artist names can be entered in Chinese or English. Known aliases are resolved to each provider's stable artist identifier before live queries are made.

Milestone 0 intentionally excludes accounts, payments, email delivery, cloud deployment, and LLM event ranking. It now includes an optional paid LLM step that expands selected artists into a small set of finer-grained artist candidates before ticket search.

Related-artist discovery uses the free MusicBrainz and ListenBrainz APIs. When enabled, OpenAI adds up to four candidates using fine-grained musical traits and cross-language similarity. Every AI suggestion must pass MusicBrainz identity verification, and every displayed event must still be confirmed by Ticketmaster or JamBase. ListenBrainz-backed matches can be T2; AI-only matches are conservatively capped at T3 so the model can never impersonate an explicit favorite. The safety design is documented in [AI-assisted discovery guardrails](plans/ai-assisted-discovery.md).

Explicit artist searches use one bounded, confirmed alias fallback when the provider's stable identifier or primary spelling returns no events, or when a request fails with a recoverable network or server error. This helps catalogs that list an artist under an English stage name without allowing uncontrolled query expansion.

## Run locally

Use [Node.js 24 LTS](https://nodejs.org/en/download). In a terminal, enter this project directory and run:

```bash
npm install
cp .env.example .env
npm run dev
```

Open the local address printed after `Local:` in the terminal, normally [http://127.0.0.1:5173](http://127.0.0.1:5173). If that port is already occupied, Vite automatically prints the next available port. The local API listens only on `127.0.0.1:8787`.

Front Row now defaults to English and `FR_DATA_MODE=live`. Until at least one API key is configured, the page clearly reports that its real-data sources are unavailable and returns no made-up recommendations. Use the language control in the page header to switch the entire interface to Chinese.

City autocomplete uses a city index stored inside this repository. Searches stay on the local server; the typed city is not sent to a geocoding service. The index includes cities with a population of 15,000 or more and a limited set of useful aliases. Run `npm run build:city-index` to refresh it from the official source.

## Try real event data

1. Create a Ticketmaster Discovery API key and/or a JamBase Data API key.
2. Put one or both keys in `.env`:

```dotenv
FR_DATA_MODE=live
TICKETMASTER_API_KEY=your_key
JBD_API_KEY=your_key
```

3. Restart `npm run dev`.

API keys remain in the localhost server and are never sent to browser code. Live mode reports an unconfigured provider explicitly; it does not silently replace missing live data with fixture events.

To enable AI artist expansion, add the following. A validation run makes at most one model call, caches the same taste profile for 24 hours, and safely falls back to ListenBrainz on any model error. Set `FR_LLM_DISCOVERY_ENABLED=false` to guarantee zero model calls.

```dotenv
OPENAI_API_KEY=your_key
FR_LLM_DISCOVERY_ENABLED=true
FR_LLM_DISCOVERY_MODEL=gpt-6-astra
```

For an explicit, paid model comparison, add `OPENAI_API_KEY` to `.env` and run `npm run benchmark:llm -- --live`. Pass a specific controlled case with `--fixture tests/evaluation/fixtures/llm-oys-jazz-cross-language.json`. Without `--live`, the command is always a zero-network dry run. The comparison locks T0/T1 outside the model and lets each model select only from verified T2/T3 event IDs with evidence-bound reason codes. See the [first four-model evaluation](plans/llm-model-evaluation-2026-09-20.md) for the current result and limitations.

For a repeated suite, use `npm run benchmark:llm:suite -- --live`, repeat `--fixture` for each case, and provide `--repetitions`, `--effort`, optional comma-separated `--models`, and the required `--max-spend-usd` guard. The runner refuses to start when its conservative maximum estimate exceeds that guard, then reports quality, failures, latency, selection stability, and cost per request. The current performance-first result favors GPT-6 Astra with low reasoning; GPT-5.6 Sol with low reasoning is the lower-cost fallback.

If the page still says a source is unconfigured, confirm that the file is named exactly `.env`, restart `npm run dev`, and check that the corresponding key line is not empty.

StubHub is represented in the provider status but remains disabled. Its official Catalog API requires approved partner or affiliate credentials, so Milestone 0 does not call it and does not scrape its website.

## Optional demonstration data

To test the interface without contacting any provider, set `FR_DATA_MODE=fixture` in `.env` and restart the app. The page labels these results as demonstration data. This mode is an explicit testing option, never the default and never a silent fallback in live mode.

## What to evaluate

For each validation run, check:

- whether every known selected-artist show appears;
- which source found each event;
- whether duplicates from multiple sources were merged correctly;
- whether an exact selected artist always ranks ahead of discovery suggestions;
- whether the explanation matches your actual preference;
- whether the estimated travel boundary is reasonable;
- which artists or fields need manual correction.

Performance language is a real ranking signal, but only when Front Row has reliable metadata for that artist or event. Unknown language is neutral rather than a negative score. In Milestone 0, this metadata is intentionally curated for a small set of validation artists, including Wang Leehom, Jay Chou, and Bruno Mars.

Fixture data verifies the workflow and ranking logic. It does **not** measure Ticketmaster or JamBase coverage; only a live run can do that. The checked-in capability benchmark is an initial, human-labelled regression baseline rather than a claim about overall product accuracy. Run `npm run benchmark` to measure Favorite Recall and the current Precision@9 proxy on that frozen dataset. Validation runs are not written to disk. Per-card feedback stays in this browser through local storage.

## Commands

```bash
npm run dev       # start local page and API
npm test          # run deterministic core and provider tests
npm run build     # type-check and build the page
npm run benchmark # run the frozen capability baseline
npm run benchmark:llm # dry-run the four-model comparison; add -- --live for billed calls
npm run benchmark:llm:suite # repeated paid suite with a required spend guard
npm run build:city-index # refresh the checked-in city search data
```

## City data attribution

City names, administrative areas, coordinates, populations, and aliases are derived from [GeoNames cities15000](https://download.geonames.org/export/dump/) and are used under the [Creative Commons Attribution 4.0 License](https://creativecommons.org/licenses/by/4.0/). Attribution: © GeoNames.

## Project decisions

- [Milestone 0 plan](plans/milestone-0.md)
- [Weighted preference model](plans/research/weighted-preference-model.md)
- [Ticket-data source research](plans/research/ticket-data-commercial-and-alternatives.md)
- [LLM model evaluation (2026-09-20)](plans/llm-model-evaluation-2026-09-20.md)
- [Local validator work item](https://github.com/Richard1007/front-row/issues/1)
