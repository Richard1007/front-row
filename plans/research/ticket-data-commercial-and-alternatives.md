# Milestone 0 — Ticket Data Commercial-Use Research

**Research date:** 2026-09-19  
**Decision status:** A small, genuinely free private pilot may use an ordinary Ticketmaster developer key conservatively; Front Row should not launch a paid product on that key. Written partner approval remains the commercial release gate.  
**Scope:** United States, live-music discovery, weekly personalized email, three-month event horizon, paid subscription.

> This is product and engineering research, not legal advice. Provider contracts and order forms should be reviewed before launch.

## Executive Finding

Ticketmaster is technically a strong first source, but an ordinary Discovery API key is not a safe commercial foundation for Front Row. Its general terms prohibit deriving revenue from the API or access to it, while its FAQ separately describes an affiliate program that permits commission-based monetization.[^tm-terms][^tm-faq] The earlier plan to charge users $5/month is not the same as earning an affiliate commission.

The immediate goal is now a free, invitation-only personal pilot. That removes the clearest revenue conflict and makes the public Discovery API a reasonable pilot source, provided Front Row stays within quota, keeps caching operationally limited, honors takedowns, links to the source, and does not assume ungranted image or LLM-processing rights. This is a product-risk judgment, not a legal guarantee.

Before any paid launch, Ticketmaster still needs to confirm in writing that a partner or affiliate agreement permits all of the following:

- charging users for the Front Row subscription;
- storing and refreshing a rolling 90-day catalog;
- showing event data and images in personalized emails;
- combining Ticketmaster results with other licensed sources;
- sending permitted event fields to a hosted model for ranking or explanation;
- using tracked outbound links to Ticketmaster.

For the eventual commercial path, apply through Ticketmaster's **Partner with Us** route and ask for the Discovery Feed plus affiliate tracking. Ticketmaster says approved partners can receive hourly JSON or CSV feeds without public-API call limits.[^tm-contact][^tm-feed] Approval no longer blocks the personal pilot, but the paid public product remains blocked.

For the free personal pilot, compare Ticketmaster with **JamBase's published noncommercial Developer plan**. For a later commercial product, JamBase and **PredictHQ** are candidates for a provider-neutral catalog. **SeatGeek**, **StubHub**, and **TicketNetwork** are potentially useful ticket-link or secondary-market overlays, but each has material contract restrictions. A multi-source product is feasible only after the rights for every source are recorded and enforced separately.

## 1. Ticketmaster Commercial-Use Decision

### What the ordinary terms say

Ticketmaster's General Terms contain a broad restriction against selling, sublicensing, or deriving revenue from the Ticketmaster API or access to it.[^tm-terms] The terms also:

- allow only reasonable temporary caching needed to operate the service;
- require removal of content within 24 hours if the rights owner asks;
- allow Ticketmaster to rate-limit or block high-volume access;
- permit Ticketmaster to terminate the API license;
- do not give Front Row an operational guarantee or long-term data entitlement.

For this project, “we do not sell tickets” does not resolve the issue. Front Row would still derive subscription revenue from a service materially powered by Ticketmaster data. The safe interpretation is **not approved unless Ticketmaster grants additional written rights**.

### What the affiliate and partner material changes

Ticketmaster's FAQ explicitly offers an affiliate program in which approved publishers can earn commissions through tracked links.[^tm-faq] It also describes partner feeds and richer commercial integrations. This establishes that commercial relationships are possible, but it does **not** clearly establish that an affiliate may charge end users a subscription for data-driven recommendations.

Consequently:

| Question | Current answer | Confidence |
| --- | --- | --- |
| Can a free prototype use the public Discovery API? | Likely yes, subject to the terms and limits. | High |
| Can the planned $5/month product launch on a normal key? | Treat as no. | High |
| Can affiliate links generate commission? | Yes, after approval and under the affiliate agreement. | High |
| Does affiliate approval also permit subscription revenue? | Not stated publicly; written confirmation required. | Medium |
| Can Front Row cache a complete 90-day catalog indefinitely? | No. Only reasonable operational caching is stated; exact retention needs approval. | High |
| Can Ticketmaster data be sent to Qwen or another LLM? | Public terms do not grant this clearly; ask explicitly. | Medium |

## 2. What the Discovery API Can Search

Ticketmaster's Discovery API searches events, attractions, venues, and classifications. Its event catalog includes Ticketmaster and several Ticketmaster-owned or connected sources, including Universe, FrontGate, and Ticketmaster Resale.[^tm-discovery][^tm-faq]

Ticketmaster currently advertises access to more than 230,000 events worldwide, but it does not publish a guaranteed US-music count or coverage SLA for an ordinary key.[^tm-discovery] The three-city trial comparison is therefore more useful than treating the marketing total as guaranteed coverage.

### Useful search inputs

| Area | Supported filters useful to Front Row |
| --- | --- |
| Artist and text | keyword, attraction ID, event ID, venue ID |
| Location | postal code, city, state, country, market/DMA, latitude/longitude geohash, radius and unit |
| Time | event start/end date-time, local date/time range, public on-sale window, presale window |
| Music taxonomy | segment, classification, genre, subgenre, type, subtype |
| Availability/status | on-sale dates, event status, include/exclude TBA/TBD/test events |
| Ownership/source | source, promoter, collection, domain and locale |
| Ordering | relevance, date, distance, name, and on-sale-related sorting |

This is enough to build the first version of “artists/genres I like, within X miles, over the next three months.” Attraction IDs are preferable to raw artist strings once a preference has been resolved during onboarding.

### Useful response fields

The API can return:

- event name, stable provider ID, Ticketmaster URL, images and classifications;
- artists/attractions and embedded venue data;
- venue address, coordinates and timezone;
- local/UTC event dates, status, public on-sale and presale times;
- notices, ticket limits, accessibility and seat-map data when present;
- promoter and outlet data;
- optional minimum/maximum price ranges and currency.

Fields are not uniformly present. Front Row must treat image, price, presale, accessibility, seat map, and even some artist metadata as optional.

## 3. How Much Data Can Be Retrieved

The public documentation and FAQ both state a default limit of **5,000 requests per day**. They conflict on burst rate: the API documentation says 5 requests/second, while the FAQ says 2 requests/second. Front Row should obey the stricter **2 requests/second** until Ticketmaster confirms otherwise.[^tm-discovery][^tm-faq]

There is also a deep-pagination limit: only the first 1,000 matching results of a query are accessible (`size × page < 1000`).[^tm-discovery] A nationwide three-month query can therefore silently miss events. Imports must be partitioned by date and geography, then deduplicated by Ticketmaster event ID.

For production-scale nationwide ingestion, the approved Discovery Feed is operationally better than repeatedly querying the public API. Ticketmaster describes country-level JSON/CSV feeds, hourly refreshes, and affiliate tracking for eligible partners.[^tm-feed]

### What the API does not prove

The Discovery API is a catalog, not a price-history or live-inventory product:

- `priceRanges` is optional and is not guaranteed to be a current all-in checkout price;
- it does not provide historical price movement;
- it cannot prove that a user saved money by receiving an earlier email;
- real-time inventory and commerce capabilities are separate partner products.

The launch promise should therefore be **“discover relevant shows earlier and have more time to decide”**, not **“we guarantee a lower ticket price.”** If Front Row later makes savings claims, it will need authorized price snapshots, fee-inclusive semantics, and a documented comparison method.

## 4. Alternative Provider Assessment

| Provider | Broad discovery? | Commercial posture | Important limitation | Front Row fit |
| --- | --- | --- | --- | --- |
| Ticketmaster | Strong US primary-event catalog | Partner/affiliate path exists | Ordinary terms restrict revenue; approval required | Best first partner if approved |
| JamBase | Strong live-music focus | $0 noncommercial Developer plan; published paid tiers | Commercial email, retention, images, combination and LLM rights still need terms review | Strongest small-pilot alternative |
| PredictHQ | Broad, normalized event intelligence | Paid commercial plans/order forms | May not supply a direct official ticket-purchase URL for every event | Strong neutral catalog candidate |
| SeatGeek | Strong US/Canada marketplace data | Terms allow use for one's business, subject to enabled rights | Terms prohibit putting SeatGeek data into AI/ML and restrict competing/recreated services | Useful only with written expanded rights |
| StubHub | Broad secondary-market catalog | Partner/affiliate approval required | Not an open self-serve production source | Useful secondary-market overlay |
| TicketNetwork | Large secondary-market feed and affiliate links | Affiliate agreement available | Data is for generating ticket sales; email use needs prior approval | Possible link/coverage overlay |
| Bandsintown | Excellent artist-centric concert data | Organization-wide use requires partnership | Normal keys are tied to a single artist | Not a self-serve backbone |
| Songkick | Strong concert discovery | Paid business license offered | Standard API is noncommercial and requires exclusivity; ordinary key applications are paused | Poor fit for a multi-source plan without custom terms |
| Eventbrite | Strong organizer ecosystem | Commercial platform terms exist | Global public event search was discontinued; normal API is organizer-centric | Not suitable as the main catalog |
| AXS / Tixr | Important ticket sellers | No suitable public discovery API identified | Direct partnership appears necessary | Future partnership, not MVP dependency |

### Provider notes

**JamBase.** Its current pricing publishes a $0 noncommercial Developer plan with 1,000 calls/month, a six-month future-event window, ticket links and required attribution. Startup is currently $600/month or $500/month billed annually.[^jambase-pricing] This is a good match for the personal pilot, but commercial email display, retention, images, combination with other sources, and LLM processing still require a full plan/terms review.

**PredictHQ.** Its events API offers concert categories, location/date/full-text filters, performer-related entities, status, rank/popularity and attendance-related signals.[^predicthq-api] It is designed as event intelligence and has paid commercial plans, which makes its legal posture clearer than a consumer-ticketing site's public key.[^predicthq-terms] The commercial order form still needs to grant external display in emails, retention, and AI-processing rights. Direct ticket URLs need to be validated during a trial.

**SeatGeek.** Its API covers events, performers and venues, including geography, date, taxonomy and market-related data.[^seatgeek-docs] The current terms are a serious constraint: they prohibit putting SeatGeek materials or data into an AI/ML application or model, and they restrict recreating or competing with SeatGeek.[^seatgeek-terms] Front Row should not send SeatGeek fields to Qwen without a supplemental written agreement.

**StubHub.** The catalog API can search and synchronize events using geography, date, genre, status, price and update-time filters, but current production access is routed through its affiliate/partner process.[^stubhub-api][^stubhub-access]

**TicketNetwork.** Its affiliate materials offer event data and tracked ticket links, but the agreement ties data use to generating ticket sales and requires prior approval for email marketing.[^ticketnetwork][^ticketnetwork-terms] It is a possible secondary-market link source, not a neutral unrestricted catalog.

**Bandsintown and Songkick.** Bandsintown's ordinary API access is artist-specific; organization-wide use needs a partnership.[^bandsintown] Songkick's standard API is noncommercial and contractually exclusive, meaning it cannot simply be mixed with Ticketmaster or other concert data.[^songkick-terms] Its ordinary API-key page currently says it cannot process new applications.[^songkick-key] A custom Songkick business license could change those terms, but it must do so explicitly.

**Eventbrite.** The platform discontinued its public global Event Search endpoint in 2019. The remaining standard APIs are primarily useful to organizers working with their own events and venues, not to a broad discovery newsletter.[^eventbrite-search]

## 5. Can We Use Multiple Sources?

Yes technically, but not by assuming that all public APIs are interchangeable. The contract is part of the architecture.

Each source record should carry:

- provider name and provider event ID;
- license/contract version and permitted use class;
- attribution and outbound-link requirements;
- cache expiry and deletion deadline;
- whether the record may appear in email;
- whether it may be combined with other sources;
- whether its fields may be sent to an LLM;
- image-specific rights;
- last refresh and removal status.

Front Row can then create a canonical event that points to one or more source records. Likely duplicates can be identified with normalized headliner, venue, city, and local start time, but original source records must remain intact. The email renderer and recommendation job must enforce each source's permissions rather than treating the merged catalog as unrestricted data.

Example safe behavior: if SeatGeek permits email display but not AI processing, its candidate can be ranked by deterministic code and excluded from the Qwen prompt. If Songkick retains its exclusivity clause, Songkick records cannot enter the same combined catalog at all.

Do not scrape Ticketmaster, venue, AXS, Tixr, or other websites as a fallback. Scraping does not solve licensing, reliability, or maintenance risk.

## 6. Recommended Milestone 0 Plan

### Track 0 — free personal pilot now

Compare the public Ticketmaster Discovery API with JamBase's noncommercial Developer plan for one city and a small number of opted-in recipients, then select one pilot source. Query preferred artists and a short venue/category list, keep only necessary factual fields, manually review selected events, exclude provider images and provider data from LLM prompts unless the rights are confirmed, and do not monetize or attach affiliate links. Supplement gaps with low-frequency searches of official artist, venue and promoter pages; retain source URLs and recheck them before sending.

The detailed operating plan is in [Milestone 0](../milestone-0.md).

### Gate A — Ticketmaster partnership request

Submit the Partner with Us form and request:

1. permission for a paid weekly personalized-email subscription;
2. Discovery Feed access for US music events;
3. affiliate tracking for outbound ticket links;
4. a written data-use schedule covering caching, email, images, attribution, source combination, and hosted-LLM processing.

### Gate B — parallel commercial evaluation

Use JamBase's published Developer plan for noncommercial evaluation and contact PredictHQ for trial terms. If commercialization becomes relevant, compare JamBase's published Startup tier with a PredictHQ quote and verify:

- US concert coverage and missing-event rate in three test cities;
- official/affiliate ticket URL availability;
- event changes, cancellations and on-sale timestamps;
- permitted 90-day retention and refresh cadence;
- subscriber-email display and image rights;
- combination with other licensed sources;
- hosted-LLM ranking rights.

### Gate C — controlled data bake-off

After receiving trial access, compare the providers in New York, Los Angeles, and one smaller market over the same 90-day period. Measure event count, artist/venue completeness, duplicates, cancellations, official purchase links, and the percentage of events with usable images and prices.

### Decision rule

- **Preferred:** Ticketmaster approves subscription, email, caching, combining, and LLM use; use its feed as the primary source and add only contract-approved gap fillers.
- **Fallback:** JamBase or PredictHQ grants clearer commercial rights; use it as the canonical catalog and add approved ticket-affiliate links separately.
- **Stop condition:** no provider grants paid-email and retention rights at a viable price. Do not invest in the production recommendation pipeline until this is resolved.

## 7. Questions Requiring Written Answers

Send the same rights checklist to every provider:

1. May Front Row charge consumers $5/month for a personalized weekly concert-discovery email and website?
2. May we store event, attraction, venue, on-sale, price, image and URL fields for up to 90 days and refresh them daily?
3. May these fields and images be displayed inside email, not only on a website or app?
4. May data be combined and deduplicated with other licensed event sources?
5. May a bounded set of event fields be processed by a hosted LLM solely to rank candidates and write short recommendation reasons? Is model training explicitly excluded?
6. What attribution, logo, deep-link, affiliate-tracking and image-credit rules apply?
7. What takedown, cache-expiry and deleted/cancelled-event obligations apply?
8. Are price ranges face value or resale, do they include mandatory fees, and how fresh are they?
9. What limits, feed cadence, pricing, minimum term and service-level commitments apply at 100, 1,000 and 10,000 subscribers?
10. Does the negotiated agreement override any conflicting public developer terms?

## 8. Ticketmaster Partner Request Draft

**Subject:** Partnership request — paid personalized concert-discovery email for US fans

Hello Ticketmaster Partnerships team,

We are building Front Row, a US-focused consumer service that helps music fans discover relevant concerts earlier. Subscribers select favorite artists, genres, a city, and a travel radius. Front Row sends one personalized email per week with up to ten relevant events occurring during the next three months. Ticket purchases would remain on Ticketmaster through approved tracked links; Front Row would not sell or fulfill tickets.

We are beginning with a small, free, invitation-only pilot. One possible future business model is a 7-day trial followed by a $5/month consumer subscription. Before any commercial launch, we would like written confirmation of the appropriate Ticketmaster partnership and data license.

We are interested in the Discovery Feed and affiliate program. Initially we expect a small US beta, with daily catalog refreshes and one weekly email per subscriber. We would store only the event, attraction, venue, status, date/time, on-sale, image, price-range, and Ticketmaster-link fields needed to operate the service.

Could you confirm whether an approved agreement can permit us to:

- charge the consumer subscription described above;
- cache and refresh a rolling 90-day US music-event catalog;
- display approved event fields and images in personalized emails and on our website;
- combine and deduplicate Ticketmaster events with other separately licensed sources;
- process a bounded set of event fields with a hosted LLM solely for recommendation ranking and short explanations, without training a model on Ticketmaster data;
- use Ticketmaster affiliate links for all applicable purchases?

Please also advise on required attribution, image rules, cache/removal periods, feed pricing or minimums, price-range semantics, and the recommended agreement for this use case.

Thank you,

Front Row

## Sources

[^tm-terms]: [Ticketmaster Developer — General Terms](https://developer.ticketmaster.com/support/terms-of-use/), updated 2023-06-27.
[^tm-faq]: [Ticketmaster Developer — FAQ](https://developer.ticketmaster.com/support/faq/).
[^tm-contact]: [Ticketmaster Developer — Contact Us / Partner with Us](https://developer.ticketmaster.com/support/contact-us/).
[^tm-feed]: [Ticketmaster Developer — Discovery Feed](https://developer.ticketmaster.com/products-and-docs/apis/discovery-feed/).
[^tm-discovery]: [Ticketmaster Developer — Discovery API v2](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/).
[^jambase-pricing]: [JamBase Data — Pricing](https://data.jambase.com/pricing).
[^predicthq-api]: [PredictHQ — Search Events API](https://docs.predicthq.com/api/events/search-events).
[^predicthq-terms]: [PredictHQ — Terms](https://www.predicthq.com/legal/terms).
[^seatgeek-docs]: [SeatGeek Platform API documentation](https://seatgeek.github.io/).
[^seatgeek-terms]: [SeatGeek Platform API Terms of Use](https://seatgeek.com/api-terms), updated 2025-03-17.
[^stubhub-api]: [StubHub Developer — Catalog API](https://developer.stubhub.com/api-reference/catalog/).
[^stubhub-access]: [StubHub Developer Portal](https://developer.stubhub.com/).
[^ticketnetwork]: [TicketNetwork — Affiliate Program](https://www.ticketnetwork.com/en/affiliate-program).
[^ticketnetwork-terms]: [TicketNetwork — Affiliate Agreement](https://www.ticketnetwork.com/en/affiliate-agreement).
[^bandsintown]: [Bandsintown for Artists — API access](https://help.artists.bandsintown.com/en/articles/7053475-what-is-the-bandsintown-api).
[^songkick-terms]: [Songkick — API Terms of Use](https://www.songkick.com/developer/api-terms-of-use).
[^songkick-key]: [Songkick — API key request](https://www.songkick.com/api_key_requests/new).
[^eventbrite-search]: [Eventbrite Platform — API update](https://www.eventbrite.com/platform/new/api).
