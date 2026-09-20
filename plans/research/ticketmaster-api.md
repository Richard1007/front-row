# Ticketmaster Discovery API Research

## Recommendation

Do **not** use an ordinary Ticketmaster developer key as the commercial foundation for Phase 1. Ticketmaster's general terms restrict deriving revenue from the API, while Front Row plans to charge a subscription. Apply for a Ticketmaster partner/affiliate agreement and obtain written approval for subscription revenue, email display, caching, images, source combination, and LLM processing before public launch.

If approved, prefer the Discovery Feed for production ingestion and use the Discovery API for development and targeted lookups. If not approved, evaluate a licensed JamBase or PredictHQ catalog and add separately approved ticket-affiliate links. See the full [Milestone 0 commercial-use and alternatives research](ticket-data-commercial-and-alternatives.md).

## How to Use It

- Create an application/API key in the Ticketmaster Developer Portal; call the Discovery v2 event and attraction endpoints from a Worker.
- Search music events with `classificationName=music`; constrain to `countryCode=US` and partition imports by DMA/geography and date range.
- Use `startDateTime`/`endDateTime`, `geoPoint` or location parameters, and artist/keyword or attraction identifiers for targeted requests. Request the maximum supported page size and paginate each partition.
- Store Ticketmaster event ID, name, status, dates/times, attractions, classifications, venue coordinates/address, on-sale fields when available, images, and Ticketmaster URL. Upsert rather than duplicate events.
- Cache attraction search for onboarding artist type-ahead. Store a fallback plain-text preference when no attraction is found.
- Refresh events in the next 30 days daily and events 31–90 days away every three days; enqueue an on-demand regional refresh when a new user's region has no fresh catalog.

## Limits and Operating Rules

- The Discovery API documentation lists a default quota of 5,000 calls/day and 5 requests/second. Ticketmaster's FAQ lists 5,000 calls/day and 2 requests/second for public APIs. Use the stricter 2 requests/second limit and keep daily ingestion below 5,000 calls.
- Deep paging is limited: the Discovery documentation permits results only while `size * page < 1000`. Partition by date/geography rather than attempting one deep nationwide query.
- Retry transient failures with exponential backoff, persist the last successful catalog, and alert when ingestion is stale. Never expose the API key in browser code.
- Treat Ticketmaster partner approval as a release gate. The public terms do not clearly authorize Front Row's paid subscription, 90-day catalog, email display, multi-source combination, or hosted-LLM processing.

## Price

- Ticketmaster's public documentation states API quotas but does not publish a per-call price for Discovery API. Do not treat the production data source as free until Ticketmaster confirms the intended commercial use and any partner/feed pricing in writing.
- If the 5,000-call quota becomes insufficient, contact Ticketmaster rather than bypassing limits; its FAQ suggests Discovery Feed for higher-volume use cases.

## Sources

- [Discovery API v2 documentation](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/)
- [Getting started and rate limits](https://developer.ticketmaster.com/products-and-docs/apis/getting-started/)
- [Ticketmaster FAQ](https://developer.ticketmaster.com/support/faq/)
- [Ticketmaster General Terms](https://developer.ticketmaster.com/support/terms-of-use/)
- [Discovery Feed](https://developer.ticketmaster.com/products-and-docs/apis/discovery-feed/)
