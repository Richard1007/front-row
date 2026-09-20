# Front Row — Milestone 0

**Status:** active  
**Decision date:** 2026-09-19  
**Goal:** prove that a weekly concert email repeatedly finds something valuable for the founder and a few friends before deciding whether any broader product is worthwhile.

## Decision

Start as a **free, invitation-only, human-reviewed personal concert scout**. Do not start as a paid SaaS.

The first version uses:

- one city/region;
- the founder's preferences, then 3–5 friends;
- up to 10 explicitly selected artists with visible weights, with 3–5 recommended initially, rather than treating an imported library as equal preferences;
- up to 3 weighted genres and a language distribution such as Mandarin 90% / English 10%;
- an origin plus maximum travel time rather than city limits alone;
- a one-week comparison of Ticketmaster Discovery API and JamBase's noncommercial Developer plan, followed by one primary structured source;
- low-frequency web search of approved official sources to find gaps;
- human confirmation before sending;
- transparent program rules for ranking;
- one weekly email with 3–8 recommendations.

This decision postpones Stripe, nationwide ingestion, a traditional server, multiple paid data feeds and LLM-based factual processing. It preserves a route to a commercial version if the personal tool proves useful.

## Why the Plan Changed

The original plan assumed a $5/month product. Ticketmaster's ordinary developer terms make that unsafe without a partner agreement. The product goal is now clearer: solving the founder's own recurring problem matters more than revenue.

That changes the rational sequence:

| Stage | Primary question | Data approach | Engineering level |
| --- | --- | --- | --- |
| Personal pilot | Does one weekly email find a show I would have missed? | Ticketmaster/JamBase bake-off + manual official-web search | local/lightweight |
| Friend concierge | Does this work for different tastes, and how much review is needed? | same, with source tracking | simple form + manual review |
| Small free automation | Can 20–50 users receive reliable emails without much work? | one approved API + controlled search queue | serverless job + small database |
| Optional commercial product | Will people pay, and can we license the data? | contracted feed/API | full production architecture |

## Workstream 1 — Competitive Validation

Research confirms that the problem is real but crowded:

- Bandsintown and Songkick already offer followed-artist alerts and recommendations.
- Spotify Concerts Near You is a weekly personalized nearby-concert product.
- JamBase combines favorites, related artists, location and event discovery.
- DoStuff demonstrates a city-first, locally edited and email-driven approach.

Front Row's testable difference is not “AI concert recommendations.” It is:

> Cross-platform taste, one calm weekly email, only a few explained recommendations, and human-reviewed coverage of local gaps.

Full findings: [Competitor analysis](research/competitor-analysis.md).

## Workstream 2 — Data Source Decision

### Structured-source bake-off

Do not build a permanent multi-source system yet. During the founder's first week, query the same artists and region in two sources:

- **Ticketmaster Discovery API:** broader first-party Ticketmaster ecosystem, 5,000 calls/day, but ordinary terms leave email/caching specifics less explicit.
- **JamBase Developer:** explicitly noncommercial, $0, 1,000 calls/month, six months of future events, ticket links and attribution required.[^jambase-pricing]

Compare coverage, freshness, official links, duplicates and missing local events. Then choose one as the pilot's primary source and use official-web research only for gaps.

### Ticketmaster pilot rules

For the free private pilot, use Ticketmaster Discovery API conservatively:

- one shared candidate pool built from preferred-artist and selected venue/category queries, not repeated independently for every person;
- the next 90 days of music events;
- obey 5,000 requests/day and the stricter 2 requests/second limit;
- do not retain full raw responses; refresh selected facts each week and remove expired events promptly;
- retain source and verification timestamps, and support content removal within 24 hours of a rights-holder request;
- link back to Ticketmaster;
- do not monetize the pilot;
- do not send Ticketmaster data to an LLM until that processing right is confirmed.

The revenue restriction is no longer the immediate conflict for a genuinely free pilot, but this is not special approval from Ticketmaster. The pilot remains subject to the ordinary terms; background scheduling, email display and the exact caching pattern have not been specifically approved, and Ticketmaster may terminate access. Images, removal and all other terms still apply. A public paid launch remains blocked until written commercial permission is obtained.

### Web-search supplement

Use web search only to produce candidates and official source links. Search:

- favorite artists' official tour pages;
- selected venue calendars;
- promoter websites;
- trusted local music publications;
- sites that explicitly provide RSS, iCal, JSON feeds or public APIs under usable terms.

`schema.org/Event` or JSON-LD on a normal webpage can help a human find and understand an event, but it does not grant permission to automate access, store the page, or republish its content.

Do not build automated scraping of ticketing sites. Search indexes can be stale, and a search result does not grant reuse rights to the target page. For pilot results:

1. record the source URL and discovery time;
2. open the official page manually;
3. retain only factual fields needed for the email;
4. do not copy images or promotional descriptions without permission;
5. recheck the page within 24 hours before sending.

Google Custom Search is closing to existing users on 2027-01-01 and does not accept new customers; Bing Search APIs have already retired. Brave Search API is a current option, but its standard terms allow only operational temporary storage and do not grant rights to target-page content.[^google-search][^bing-search][^brave-search] For the first few users, manual search is simpler than buying a search API. An agent may use an authorized search tool to produce URL candidates, but a human should open and verify the target page; automatic extraction is allowed only when the target site explicitly permits it or provides a usable feed/API.

Detailed source and licensing findings: [Ticket data commercial-use and alternatives](research/ticket-data-commercial-and-alternatives.md).

Important exclusions and boundaries:

- Spotify can later provide preference signals, but its public Web API does not expose a general concert catalog.
- A normal Bandsintown API key is artist-specific; a multi-artist product needs organization partnership approval.
- JamBase is the closest supplier fit. Its current Developer plan explicitly permits noncommercial use within a 1,000-call monthly quota; a commercial version requires an appropriate paid plan and still needs a terms review.
- DoStuff demonstrates that web research plus human editing can work; it does not offer Front Row a public data feed.

## Workstream 3 — Personal Pilot

### Week 1 input

- one starting city/postal code, travel mode and maximum travel time;
- up to 10 artists chosen manually, each marked **优先 / 喜欢 / 偶尔**, with 3–5 recommended initially;
- an optional imported discovery pool that cannot assign explicit weights automatically;
- up to 3 genres, each with the same semantic weight;
- performance-language percentages totaling 100%, or “language does not matter”;
- optional “artists I would travel for” list;
- optional favorite local venues;
- next 90 days.

### Candidate generation

1. Resolve every selected artist to provider IDs while retaining original and alternate-language names.
2. Query both bake-off providers directly for every selected artist plus a short list of important venues/categories. A later Ticketmaster regional catalog must be partitioned by date and geography to stay below its 1,000-result deep-paging boundary.
3. Treat every verified selected-artist event inside the travel-time boundary as highest priority; artist weights order these events, but popularity and follower count cannot suppress them.
4. Add genre-adjacent candidates using simple explicit rules or a small manually maintained related-artist list.
5. Search official pages for selected artists and important local venues.
6. Deduplicate by normalized artist, venue and local date/time.
7. Recheck every selected event before sending.

### Email shape

- **一定要知道:** exact favorite artist or important on-sale change;
- **你可能会喜欢:** related artist with an explicit reason;
- **值得冒险:** one local human-curated choice.

Every event should show the date, venue, approximate distance, one-sentence reason, source, last-verified time and an allowed ticket link. For Ticketmaster records, use the URL returned by its API. For web-search candidates, do not automatically turn a result URL into a purchase link; verify that the official source and linking method are appropriate. Do not show a price unless its meaning, fee inclusion and freshness are known.

### Success criterion

The pilot succeeds when the email reveals at least one event that the recipient cares about and probably would not have found in time.

Track:

- valuable new discoveries;
- already-known events;
- irrelevant recommendations;
- missing/incorrect/duplicate events;
- API events versus web-search-only events;
- missed eligible selected-artist events, with a target of zero;
- time spent reviewing the email;
- ticket-link clicks or “想去” feedback.

## Workstream 4 — Friend Concierge

Only after the founder's email is useful:

- invite 3–5 friends;
- collect explicit email consent, origin/travel-time preference, weighted artists, weighted genres and language distribution in a simple form;
- place a short privacy notice beside the form explaining collection, storage, service providers and deletion; do not send email addresses or identifiable profiles to a search service;
- send 3–8 recommendations each week;
- add feedback: `想去`, `不感兴趣`, `已经知道`, `信息有误`;
- include a one-click unsubscribe even though the service is free;
- measure manual review time and source gaps for 2–3 weeks.

The human review step is a product feature during validation, not a failure to automate.

## What Is Deferred

- Stripe and subscription billing;
- nationwide public signup;
- native mobile app;
- a traditional always-on server;
- full multi-source ingestion and automated cross-source deduplication;
- live inventory and price tracking;
- guaranteed-savings marketing;
- automated ticket-site scraping;
- LLM selection of factual events;
- LLM processing of provider data without explicit permission.

An LLM can later write a short recommendation reason after program logic and a human have selected a real event, but it is not needed to validate the product.

## Exit Gates

Milestone 0 is complete when:

- the founder receives two useful weekly digests in a row;
- at least three friends complete a two-week concierge trial;
- every sent event has a source and recent verification time;
- at send time, no event known to be canceled, duplicate or fabricated is included, and every item was checked within the preceding 24 hours;
- review time is measured and judged sustainable;
- Ticketmaster and JamBase coverage gaps are compared and one pilot source is selected;
- a decision is made among: keep personal, automate for friends, pursue a data partnership, or stop.

Commercial provider outreach can continue in parallel, but it no longer blocks the personal pilot.

## Related Documents

- [Competitor analysis](research/competitor-analysis.md)
- [Bandsintown firsthand evaluation and preference ideas](research/bandsintown-firsthand-evaluation.md)
- [Weighted artist, style and language preference model](research/weighted-preference-model.md)
- [Ticket data commercial-use and alternative providers](research/ticket-data-commercial-and-alternatives.md)
- [Ticketmaster API details](research/ticketmaster-api.md)
- [Commercial V1 architecture, retained for a later stage](architecture-v1.md)

## Sources

[^google-search]: [Google Custom Search JSON API overview](https://developers.google.com/custom-search/v1/overview).
[^bing-search]: [Microsoft — Bing Search API retirement](https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement).
[^brave-search]: [Brave Search API](https://brave.com/search/api/) and [API terms](https://api-dashboard.search.brave.com/documentation/resources/terms-of-service).
[^jambase-pricing]: [JamBase Data — Pricing](https://data.jambase.com/pricing).
