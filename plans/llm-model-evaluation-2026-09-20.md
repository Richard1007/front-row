# LLM model evaluation — 2026-09-20

## Decision

Use **GPT-5.6 Terra** for the next opt-in prototype of discovery reranking. It matched the best observed quality on this small suite while costing materially less than GPT-5.6 Sol or GPT-6 Astra. Keep deterministic ranking as the fallback and keep T0/T1 exact-artist events outside the model.

This decision is provisional. Three controlled cases are enough to choose the next experiment, not enough to claim production accuracy.

## Test design

All four models received byte-identical preference profiles and provider-verified T2/T3 candidates. The model could only select candidate IDs and cite evidence attached to the same candidate. The application rejected unknown IDs, duplicate IDs, mismatched evidence, unsupported reason categories, and confidence greater than the cited evidence. API storage was disabled.

The suite contained three human-labelled cases:

1. Mixed Mandarin/English and R&B/alternative preferences.
2. Omnipotent Youth Society taste crossing language boundaries through indie, jazz and rock affinity.
3. A popular-artist trap where broad or weak matches must not displace art-rock discoveries.

Every eligible exact favorite was locked into the list before the model ran.

## Results

| Model | Exact favorite recall | Precision among selected | Useful fill | Total cost | Mean latency |
| --- | ---: | ---: | ---: | ---: | ---: |
| GPT-5.6 Luna | 100% | 100% | 14/15 (93.3%) | $0.002421 | 4.83 s |
| GPT-5.6 Terra | 100% | 100% | 15/15 (100%) | $0.023390 | 5.34 s |
| GPT-5.6 Sol | 100% | 100% | 15/15 (100%) | $0.037092 | 4.39 s |
| GPT-6 Astra | 100% | 100% | 15/15 (100%) | $0.072280 | 3.87 s |

Total spend for the 12 successful calls was approximately **$0.1352**.

Luna was precise but too conservative: it omitted the Cantonese jazz event in the Omnipotent Youth Society case. Terra, Sol and Astra all kept the four relevant cross-language candidates and rejected the generic Mandarin-pop and mainstream-rock distractors. Sol and Astra showed no quality gain over Terra on this suite.

Latency is descriptive only. One call per model per case is too small a sample for a latency conclusion.

## Explanation policy

The first implementation must render reasons from verified evidence rather than model-written prose. Supported reasons are:

- sourced artist similarity;
- explicit genre match;
- artist-inferred genre match;
- artist-inferred performance-language match;
- explicitly accepted performance-language match.

Claims such as “trending now,” “rare local appearance,” or “similar to this album” remain disabled until Front Row has a dated trend signal, local appearance history, or sourced album relationship. A similarity edge may justify “related to an artist you like”; it does not by itself justify a detailed claim about instrumentation, improvisation, or influence.

## Known limitation

The current recommendation core exposes only its already-limited final T2/T3 candidates. The benchmark can measure whether a model removes weak candidates, but it cannot yet measure whether a model rescues a better candidate that deterministic ranking truncated. Before enabling production reranking, split the core into a preparation stage that returns every eligible ranked candidate and a finalization stage that applies the list limit and diversity policy.

