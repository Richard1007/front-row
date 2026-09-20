# AI Recommendation Research

## Phase 1 Decision

Use a hybrid ranker. The application first applies non-negotiable eligibility filters—active US music event, user radius, date window, and valid Ticketmaster link—and computes a deterministic relevance score. It then passes only the strongest bounded candidate list plus the user's artist/genre preferences to the model. The model may rerank supplied event IDs and write a short match reason; the deterministic score remains the fallback.

## Architecture and Guardrails

- Cloudflare Workers calls the remote model API using `fetch`; it does not run inference or host model weights. Keep the model API key in Worker secrets.
- Do not send the full Ticketmaster catalog. Use an indexed database query and deterministic scoring to provide a bounded candidate set (target: 30; maximum: 50) so requests are fast, cheap, and within context limits.
- Require JSON Schema output containing event IDs from the supplied candidate set, rank, and a one-sentence reason. Validate schema, uniqueness, supplied IDs, continued eligibility, and unsupported claims before sending email.
- Send only artists, genres, coarse city/radius context, and event metadata. Never send email addresses, Stripe data, or precise home address. Review privacy/cross-region data processing before production use.
- Cap per-run tokens and monthly cost; log model/version, tokens, latency, and rejection/fallback rate. If a response times out, fails validation, or the model is unavailable, use a deterministic fallback order so the weekly email still sends.

## Low-Cost Candidate

Alibaba Cloud Model Studio currently lists Qwen-Turbo in its Singapore international deployment at USD $0.05 per million input tokens, $0.20 per million non-thinking output tokens, and $0.50 per million thinking output tokens, with a 50% batch discount where supported. Prices and model IDs can change, so verify them when production is enabled. Use the hosted API through a provider adapter; do not self-host a model for Phase 1.

## Source

- [Alibaba Cloud Model Studio pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing)
- [Qwen API reference](https://www.alibabacloud.com/help/en/model-studio/qwen-api-reference)
- [Qwen structured output](https://docs.modelstudio.console.alibabacloud.com/en/model-studio/qwen-structured-output)
