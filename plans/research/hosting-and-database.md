# Hosting and Database Research

## Recommendation

Use Cloudflare Workers for the website/API and scheduled jobs, and Cloudflare D1 for relational data. Use the free tier for development only; begin private beta on Workers Paid at its $5/month minimum.

## Why This Fits Front Row

- The product needs a low-traffic website, webhooks, daily ingestion, and a weekly scheduler—not an always-on server.
- Workers and D1 are integrated, reducing vendor count and operational work. D1's SQL model suits users, preferences, subscriptions, events, and digest history.
- Static assets are free and unlimited. A static marketing site can use Pages, but Cloudflare advises Workers as the primary platform for new applications; use Workers for the dynamic product.

## Current Limits and Cost

| Plan | Workers | D1 | Best use |
| --- | --- | --- | --- |
| Free | 100,000 requests/day; 10 ms CPU/invocation | 5M rows read/day; 100k rows written/day; 5 GB | Development, previews, closed prototype |
| Paid | $5/month minimum; 10M requests/month; 30M CPU-ms/month included | 25B rows read/month; 50M rows written/month; 5 GB included | Private beta and production |

- The free tier can stop serving database queries when daily D1 limits are exceeded, and its 10 ms Worker CPU limit is too restrictive for dependable import/digest batches. Use Paid before accepting real paid subscriptions.
- Use separate development and production accounts/environments. Create production D1 before storing real emails, preferences, or Stripe identifiers.
- Track Worker CPU, D1 rows read/written, storage, failures, and event-catalog freshness. Upgrade based on measured limits, not visitor estimates.

## Deployment Timing

- Deploy the static landing page now.
- Add real waitlist collection only after privacy/consent and email suppression are configured.
- Enable production database, secrets, webhook endpoints, and billing only for a controlled private beta; start in Stripe test mode before that.

## Sources

- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [Cloudflare Pages pricing](https://developers.cloudflare.com/pages/functions/pricing/)
- [Cloudflare Pages overview](https://developers.cloudflare.com/pages/)
