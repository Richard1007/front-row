# Front Row — Commercial Phase 1

> This plan is retained as the possible commercial product. It is **not** the immediate build target. Complete the free, human-reviewed [Milestone 0](milestone-0.md) first.

## Goal

Launch a US-only, paid weekly concert-discovery website after securing commercial event-data rights. Users choose up to 10 weighted artists, up to 3 weighted genres, a language distribution, an origin, and maximum travel time. Every Tuesday at 3:00 PM America/New_York (Eastern Time), they receive a small set of strong event matches.

## What We Build

### Customer website

- Responsive landing page, pricing, FAQ, Privacy Policy, and Terms.
- Passwordless email sign-in using a short-lived, single-use magic link.
- Profile: up to 10 weighted artists, up to 3 weighted genres, weighted performance languages, origin, normal maximum travel time, and optional expanded travel rules for selected artists.
- Account settings for profile edits, unsubscribe, and Stripe billing portal.
- A 7-day card-required trial, then $5/month; an approved ticketing partner handles checkout. Front Row does not sell tickets and provides contract-approved links to buy them. Stripe fees include card processing and the applicable Stripe Billing fee.

### Product backend

- Cloudflare Workers hosts the application API and schedulers. Cloudflare Queues runs idempotent per-region import and per-user digest jobs so one provider failure cannot stop the whole batch.
- Cloudflare D1 stores users, preferences, subscriptions, canonical events plus licensed source records, venues/attractions, and sent-digest records.
- Use the commercially approved event source selected in Milestone 0. Ticketmaster Discovery Feed is preferred if Ticketmaster grants the required subscription, email, caching, combination, image, and LLM rights; JamBase or PredictHQ is the fallback evaluation path.
- Stripe Checkout/Billing owns payment collection and subscription state; signed, idempotent webhooks update local eligibility.
- Resend delivers sign-in emails and weekly digests, with unsubscribe, bounce, and complaint suppression.

### Recommendations

- Apply only hard eligibility before ranking: active US music events up to three months ahead, inside the user's travel-time boundary, with a contract-approved ticket link. Eligible exact selected-artist events are guaranteed highest priority regardless of popularity.
- Place eligible exact selected-artist events in the highest priority tiers first. Within discovery candidates, combine artist similarity (60%), genre match (25%), and performance-language match (15%); missing metadata is neutral and the known dimensions are rebalanced. Popularity never suppresses an exact selected-artist event.
- Score candidates deterministically first, then send the user's weighted preferences and the best bounded candidate list to Qwen only when the event-data license permits hosted-model processing. The model returns structured ranked event IDs and short reasons; Front Row validates every returned ID before email delivery and falls back to the deterministic ranking.
- Send 3–8 strong matches in a normal digest. Penalize very recent repeats, but allow an important repeat when it remains a top match or has a new on-sale reason. Never pad the email with weak events merely to reach eight.
- Cloudflare Workers orchestrates the remote Qwen API call; it does not host or run the model. Keep an application-side fallback order for provider timeout, invalid JSON, or unavailable model responses.

## Best-Fit Services

| Need | Choice | Why |
| --- | --- | --- |
| Hosting, jobs, API | Cloudflare Workers | One serverless platform, no always-on server, $5/month paid production minimum. |
| User/event database | Cloudflare D1 | Native SQL storage for Workers; free for prototypes and included capacity on paid Workers. |
| Event source | Contract-approved Ticketmaster feed, or licensed fallback | The ordinary Ticketmaster developer terms are not sufficient for the planned paid service. |
| Email | Resend | Free through the first small cohort; $20/month before weekly Tuesday delivery exceeds the 100-email/day free limit. |
| Payments | Stripe | Hosted Checkout and billing portal; no card-data handling by Front Row. |
| Ranking | Deterministic scorer + Qwen API | Program logic guarantees eligibility and fallback; the LLM only reranks valid candidates and writes short reasons. |

See [the V1 architecture](architecture-v1.md), [weighted preference model](research/weighted-preference-model.md), [Milestone 0 ticket-data commercial-use research](research/ticket-data-commercial-and-alternatives.md), [Ticketmaster API research](research/ticketmaster-api.md), [hosting and database research](research/hosting-and-database.md), [email and payments research](research/email-and-payments.md), and [AI recommendation research](research/ai-recommendations.md).

## Deployment and Cost

- Publish the marketing site now. Create the production database and separate production provider accounts before storing real emails, preferences, or Stripe IDs.
- Use free tiers only for development, preview, and a closed prototype. Start private beta on Workers Paid ($5/month).
- Keep Resend Free until approximately 75 Tuesday recipients, then use Resend Pro ($20/month) to avoid its 100-email/day cap.
- Qwen inference is a variable usage cost. Target 30 candidates per ranking call (50 maximum), set a monthly spend cap, and track tokens per digest.
- Stripe's published domestic-card fee is 2.9% + $0.30 and Stripe Billing pay-as-you-go currently adds 0.7% of Billing volume, leaving about $4.52 from a $5 payment before infrastructure, tax, refund, and dispute costs. At this price, two paid subscribers cover the $5 baseline; six cover the $25 Workers + Resend baseline.

## Excluded From Phase 1

- Non-US coverage and direct venue scraping. Cross-source ingestion remains excluded unless Milestone 0 contracts require it as the viable fallback.
- Complex event-history filtering and curated digest slots such as “5 new + 5 popular” or “5 near me.” V1 does apply a simple recent-repeat penalty.
- User feedback, saves, recommendation feeds, click/open-driven ranking, and collaborative filtering.
- Real-time/on-sale alerts, SMS/push notifications, user-selected delivery days, mobile apps, direct ticket-sale flows, and affiliate programs beyond the approved outbound links needed for launch.
- Self-hosted model inference, LLM personalization from behavior, and any use of email/payment data or precise home address in model prompts.

## Acceptance Checks

- A US user can verify email, set preferences/location, start a trial, and manage billing.
- Daily import respects the selected provider's limits and licensed cache period, and survives retries/outages using the last permitted catalog.
- Every eligible user gets at most one correctly timed weekly email, normally containing 3–8 strong, valid matches. Model failure still produces a deterministic fallback digest; recent repeats are penalized.
- Canceled, unpaid, unsubscribed, bounced, and complained addresses do not receive digests.
- Payment webhooks, account access, personal-data deletion, and unsubscribe controls are secure and idempotent.

## Milestone 0 Release Gate

- Ticketmaster or an alternative provider grants written rights for the paid subscription, personalized email display, required retention, and images.
- Any source data sent to Qwen is explicitly permitted for hosted-model processing; otherwise that source uses deterministic ranking only.
- The selected provider supplies adequate US concert coverage and reliable outbound ticket links in a three-city, 90-day comparison.
- The product promise is “discover relevant shows earlier,” not a guaranteed ticket-price saving, unless an authorized price-history method is added later.
