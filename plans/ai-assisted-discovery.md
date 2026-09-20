# AI-assisted discovery guardrails

Status: free related-artist discovery implemented; paid LLM layer awaiting approval.

## Candidate pipeline

1. Resolve each selected artist to a unique MusicBrainz ID.
2. Ask ListenBrainz for sourced similar artists, respecting user importance and a global candidate cap.
3. Search Ticketmaster and JamBase for those candidates and the selected artists.
4. Show only events returned by a ticket-data provider.
5. T0/T1 remain exact selected-artist shows. T2 requires sourced artist similarity. T3 requires sourced artist similarity or both style and language evidence.

MusicBrainz and ListenBrainz are free and require no user API key for this personal validator. Front Row rate-limits and caches these requests. They can suggest artists, but never events.

## Optional OpenAI layer

The optional LLM layer may propose additional artists when sourced similarity is sparse and may rerank already verified candidates. It must never generate an event, date, venue, ticket URL, or T0/T1 classification.

Every LLM-proposed artist must pass these gates:

```text
LLM candidate
  -> unique MusicBrainz identity
  -> real Ticketmaster or JamBase event
  -> date, status, and travel filters
  -> deterministic recommendation ranking
```

Only artist, genre, and language preferences may be sent to the model. Email and precise location are excluded. The planned API call uses the Responses API, `store: false`, and a strict JSON schema.

## Cost gate

ChatGPT subscriptions and OpenAI API billing are separate. A project-scoped API key and API billing are required; a logged-in ChatGPT session cannot be exported as an application key.

The current candidate model is `gpt-5.4-nano`. At published pricing of $0.20 per million input tokens and $1.25 per million output tokens, an estimated 2,000-input/800-output expansion is about $0.0014 per run. It still requires explicit approval before enabling billing.

Official references:

- https://help.openai.com/en/articles/8156167
- https://help.openai.com/en/articles/9186755
- https://developers.openai.com/api/docs/models/gpt-5.4-nano
- https://musicbrainz.org/doc/MusicBrainz_API
- https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting
- https://listenbrainz.readthedocs.io/en/latest/users/api/core.html#lb-radio
