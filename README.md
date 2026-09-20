# Front Row

Front Row is currently a private, local validation tool for concert recommendations. It asks for weighted artists, genres, performance-language preferences, and a travel boundary, then compares available event sources and returns a small, explained shortlist.

Milestone 0 intentionally excludes accounts, payments, email delivery, cloud deployment, and LLM ranking.

## Run locally

Use [Node.js 24 LTS](https://nodejs.org/en/download). In a terminal, enter this project directory and run:

```bash
npm install
cp .env.example .env
npm run dev
```

Open the local address printed after `Local:` in the terminal, normally [http://127.0.0.1:5173](http://127.0.0.1:5173). If that port is already occupied, Vite automatically prints the next available port. The local API listens only on `127.0.0.1:8787`.

The default `FR_DATA_MODE=fixture` uses a synthetic Bay Area scenario, so no API keys are required. The page displays **演示数据** in this mode. Click **载入王力宏湾区示例**, then generate recommendations to verify the complete flow.

## Try real event data

1. Create a Ticketmaster Discovery API key and/or a JamBase Data API key.
2. Put the keys in `.env`:

```dotenv
FR_DATA_MODE=live
TICKETMASTER_API_KEY=your_key
JAMBASE_API_KEY=your_key
```

3. Restart `npm run dev`.

API keys remain in the localhost server and are never sent to browser code. Live mode reports an unconfigured provider explicitly; it does not silently replace missing live data with fixture events.

If the page still says a source is unconfigured, confirm that the file is named exactly `.env`, restart `npm run dev`, and check that the corresponding key line is not empty.

StubHub is represented in the provider status but remains disabled. Its official Catalog API requires approved partner or affiliate credentials, so Milestone 0 does not call it and does not scrape its website.

## What to evaluate

For each validation run, check:

- whether every known selected-artist show appears;
- which source found each event;
- whether duplicates from multiple sources were merged correctly;
- whether an exact selected artist always ranks ahead of discovery suggestions;
- whether the explanation matches your actual preference;
- whether the estimated travel boundary is reasonable;
- which artists or fields need manual correction.

Fixture data verifies the workflow and ranking logic. It does **not** measure Ticketmaster or JamBase coverage; only a live run can do that. Validation runs are not written to disk. Per-card feedback stays in this browser through local storage.

## Commands

```bash
npm run dev       # start local page and API
npm test          # run deterministic core and provider tests
npm run build     # type-check and build the page
```

## Project decisions

- [Milestone 0 plan](plans/milestone-0.md)
- [Weighted preference model](plans/research/weighted-preference-model.md)
- [Ticket-data source research](plans/research/ticket-data-commercial-and-alternatives.md)
- [Local validator work item](https://github.com/Richard1007/front-row/issues/1)
