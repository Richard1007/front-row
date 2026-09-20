# LLM model evaluation — 2026-09-20

## Decision

Use **GPT-6 Astra with low reasoning** for the next opt-in prototype of discovery reranking when recommendation performance is the top priority. Use **GPT-5.6 Sol with low reasoning** as the cost-conscious fallback. Keep deterministic ranking as the operational fallback and keep T0/T1 exact-artist events outside the model.

This supersedes the initial three-case Terra decision. The expanded ten-case suite exposed quality and structured-response differences that the first easy suite could not measure. The decision is still provisional because these are controlled human-labelled cases rather than live-user outcomes.

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

## Expanded performance-first round

The second round added seven difficult cases, for ten total:

- exact-favorite pressure with only five discovery slots;
- a silent week where the correct result is deliberately short;
- performance-language false positives;
- bilingual alias and provider deduplication;
- cross-language R&B;
- broad-genre noise;
- sparse niche taste;
- the three original mixed-language, Omnipotent Youth Society, and popularity-trap cases.

The recommendation core was split so the model now sees every verified eligible discovery candidate before the nine-item digest cutoff, capped at 30 candidates. This allows the evaluation to measure whether a model can recover a strong event that deterministic truncation would have removed.

### Broad screen: low reasoning

| Model | Exact recall | Precision | Useful fill | Failed responses | Mean latency | Mean cost/request |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| GPT-5.6 Luna | 100% | 89.4% | 93.3% | 10% | 4.18 s | $0.000841 |
| GPT-5.6 Terra | 100% | 90.7% | 86.7% | 20% | 4.09 s | $0.007160 |
| GPT-5.6 Sol | 100% | 95.6% | 95.6% | 0% | 4.33 s | $0.011924 |
| **GPT-6 Astra** | **100%** | **100%** | **97.8%** | **0%** | **3.26 s** | **$0.021954** |

### Broad screen: medium reasoning

| Model | Exact recall | Precision | Useful fill | Failed responses | Mean latency | Mean cost/request |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| GPT-5.6 Luna | 100% | 86.5% | 100% | 0% | 4.65 s | $0.000935 |
| GPT-5.6 Terra | 100% | 93.2% | 91.1% | 10% | 5.39 s | $0.008008 |
| GPT-5.6 Sol | 100% | 93.6% | 97.8% | 0% | 5.67 s | $0.013102 |
| **GPT-6 Astra** | **100%** | **100%** | **97.8%** | **0%** | **4.32 s** | **$0.025184** |

Medium reasoning did not improve Astra's recommendation quality, so low reasoning remains the better Astra configuration. A follow-up finalist run again produced 100% precision and 97.8% useful fill for Astra's completed ten-case pass. Sol varied more: its second full pass found all useful results but admitted one distractor.

The finalist stability run stopped when the API returned `insufficient credits`. The second round had spent only about **$1.038** at that point, so the reported API balance did not match the newly charged $10. No calls were retried after the billing error.

### Model-only operating cost

Using the uncached broad-screen mean as a conservative estimate for one weekly digest:

| Model + low | Cost/request | One weekly user/year | 1,000 weekly users/year |
| --- | ---: | ---: | ---: |
| Luna | $0.000841 | $0.04 | $44 |
| Terra | $0.007160 | $0.37 | $372 |
| Sol | $0.011924 | $0.62 | $620 |
| Astra | $0.021954 | $1.14 | $1,142 |

These figures cover only the model selection call. Actual cost changes with candidate count and output tokens and excludes ticket providers, storage, email delivery, and any separate enrichment calls.

## Explanation policy

The first implementation must render reasons from verified evidence rather than model-written prose. Supported reasons are:

- sourced artist similarity;
- explicit genre match;
- artist-inferred genre match;
- artist-inferred performance-language match;
- explicitly accepted performance-language match.

Claims such as “trending now,” “rare local appearance,” or “similar to this album” remain disabled until Front Row has a dated trend signal, local appearance history, or sourced album relationship. A similarity edge may justify “related to an artist you like”; it does not by itself justify a detailed claim about instrumentation, improvisation, or influence.

## Remaining limitations

The pre-limit candidate-pool limitation is resolved. Remaining limitations are the small number of human-labelled cases, labels produced by one evaluation process rather than independent blind raters, and synthetic frozen event facts rather than live-user conversion or feedback. Before enabling default paid ranking, run the same evaluation against saved real Ticketmaster/JamBase candidate sets and add deterministic fallback for timeouts, invalid schema, and billing exhaustion.
