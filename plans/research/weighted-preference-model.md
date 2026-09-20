# Weighted Preference Model — Artists, Styles, and Languages

**Source:** Founder product direction  
**Captured:** 2026-09-19  
**Status:** accepted for Milestone 0 validation

## 1. Product Decision

Front Row collects preferences in three separate sections:

1. **Artists / bands:** up to 10 explicit selections, each with an importance weight.
2. **Styles / genres:** up to 3 selections, each with an importance weight.
3. **Performance languages:** one or more languages with a desired percentage distribution, or “no language preference.”

These signals influence recommendations, but they do not all behave the same way:

- An eligible event by an explicitly selected artist must never be lost because of genre, language, popularity or missing metadata.
- Artist and genre weights are independent importance strengths; adding a new item must not dilute an existing favorite.
- Language percentages express the user's preferred mix for discovery ranking, not a promise that each email will contain exactly that percentage.
- Unknown genre or language is neutral, not a negative match.

## 2. User Experience

Use three short onboarding steps.

### Step 1 — Artists and bands

Prompt:

> 你最想看到哪些艺人的现场？最多添加 10 位，并告诉我们谁更重要。

Each selected artist has a simple visible level:

- **优先:** 我很不想错过;
- **喜欢:** 正常推荐;
- **偶尔:** 只在很匹配时推荐.

Internally these can map to `4 / 2 / 1`. New artists default to **喜欢**. Recommend that the user choose 3–5 initially, but allow up to 10.

Do not require artist percentages to total 100%. If the user adds an eleventh artist, they must replace or remove one. A Spotify/Apple Music import supplies candidates only; it never assigns explicit weights automatically.

### Step 2 — Styles / genres

Prompt:

> 你通常喜欢哪些现场风格？最多选择 3 个。

Use the same **优先 / 喜欢 / 偶尔** control. Styles use a controlled Front Row taxonomy rather than unrestricted spelling variants. Genre is optional.

Examples:

- Mandopop — 优先;
- R&B — 喜欢;
- Indie rock — 偶尔.

### Step 3 — Performance languages

Prompt:

> 你希望推荐中的演唱语言大致是什么比例？这只影响推荐顺序，不会挡住你明确喜欢的艺人。

Examples:

- Mandarin 90%, English 10%;
- English 70%, Mandarin 30%;
- “语言不限.”

Language percentages must total 100% when language preference is enabled. Add useful distinctions such as Mandarin, Cantonese and English; do not equate simplified/traditional writing with singing language.

For accessibility and mobile usability, do not use ten continuous sliders or drag-only ranking. Use text-labelled controls and an optional advanced numeric editor. The user should be able to finish onboarding without doing arithmetic except for the small language distribution.[^wcag]

## 3. Preference Representation

```text
ArtistPreference
  artist_id
  importance_level       // priority | like | occasional
  importance_value       // 4 | 2 | 1
  source                 // explicit | imported_candidate | inferred

GenrePreference
  canonical_genre_id
  importance_level
  importance_value

LanguagePreference
  language_tag           // cmn, yue, en, etc.
  desired_share          // 0.0–1.0; enabled shares sum to 1
```

Only an explicit user action creates an `ArtistPreference`. Imported and inferred artists remain separate discovery evidence.

## 4. Hard Priority Buckets

The system first determines eligibility and priority bucket:

```text
T0: selected artist's important on-sale, cancellation or reschedule change
T1: valid event containing an explicitly selected artist
T2: artist/style/language discovery recommendation
T3: controlled local exploration
```

Every valid `T0/T1` event ranks ahead of every `T2/T3` event. The three-dimensional score sorts events **inside a bucket**; it cannot make a popular discovery event outrank an exact selected artist.

This preserves the Wang Leehom requirement: if 王力宏 is selected, the identity is confirmed, the event is active, and it falls inside the travel boundary and time window, the event enters `T1` regardless of follower count.

## 5. Weight Normalization

### Artists and genres

Use a fixed semantic scale or maximum normalization:

```text
normalized_weight(item) = item_weight / maximum_weight_in_that_dimension
```

Do not divide by the sum of all selected items. Sum normalization would reduce an existing favorite whenever the user adds another artist.

Example:

```text
王力宏  优先  4 → 1.00
周杰伦  喜欢  2 → 0.50
陶喆    偶尔  1 → 0.25
```

Adding another “喜欢” artist does not change 王力宏's `1.00`.

### Languages

Language is a desired distribution and therefore does sum to 100%:

```text
Mandarin 90% → 0.90
English  10% → 0.10
```

This means a high-confidence Mandarin discovery receives a much stronger language match than an English discovery. It does not exclude an English-language event by an explicitly selected artist.

## 6. Three-Dimensional Discovery Score

Default dimension contribution:

```text
artist similarity  60%
genre/style        25%
language           15%
```

These are product defaults, not user-facing controls in Milestone 0. Letting users also tune the three section contributions would add a second level of weights before we know it is needed.

For an event `e`:

```text
R(e) = weighted average of:
  0.60 × artist_match(e)
  0.25 × genre_match(e)
  0.15 × language_match(e)
```

Each dimension also carries metadata confidence. A missing or unknown dimension is removed from the numerator and denominator rather than treated as zero.

```text
R(e) = Σ(section_weight × confidence × match)
       ──────────────────────────────────────
         Σ(section_weight × confidence)
```

Popularity does not participate in this score. It may be a final tie-breaker only inside `T3` exploration.

## 7. Matching Rules

### Artist match

- canonical selected artist ID: `1.00` and `T1`;
- manually confirmed close relation: up to `0.85`;
- licensed/reliable similar-artist relation: up to `0.70`;
- genre-only relationship: at most `0.45`;
- popularity overlap alone: `0`.

For a multi-artist event, confirm performer roles. A selected artist appearing as headliner, support or confirmed festival lineup still triggers `T1`, but the email must describe the role accurately. A tribute event must not trigger an exact match without the canonical performer ID.

### Genre match

- exact canonical style: `1.00`;
- parent/child style: approximately `0.80`;
- adjacent subgenre: approximately `0.55`;
- only a broad Pop/Rock parent: approximately `0.30`.

Keep raw provider genres and map them to a small Front Row taxonomy. Genre is multi-label and source confidence must be retained.

### Language match

Language means expected repertoire/singing language, not nationality, artist name, page locale or writing script. Use controlled language identifiers; simplified/traditional Chinese describes writing script and does not distinguish Mandarin from Cantonese.[^cldr]

- matching primary language: strong match;
- significant secondary language: medium match;
- occasional language: light match;
- instrumental: language is not applicable;
- unknown: omit the dimension;
- mixed-language artist: retain multiple language labels.

The public Ticketmaster and JamBase documentation inspected exposes artist identity and genre-related fields but not a reliable singing-language field.[^ticketmaster-discovery][^jambase-data] Milestone 0 should therefore manually maintain a small, sourced artist-language profile only for artists that enter real candidates. Never infer language solely from country, genre, or Chinese/Latin script.

## 8. Example

User preferences:

```text
Artists
王力宏        优先 = 4
周杰伦        喜欢 = 2

Styles
Mandopop      优先 = 4
R&B           喜欢 = 2
Rock          偶尔 = 1

Languages
Mandarin      90%
English       10%
```

Event A — Wang Leehom:

```text
bucket             T1 exact artist
artist match       1.00
genre match        1.00
language match     0.90
popularity         ignored
```

Event B — a popular English-language R&B artist:

```text
bucket             T2 discovery
artist similarity  0.45
genre match        0.50
language match     0.10
popularity         ignored
```

Event A appears first because it is `T1`. Event B competes only with other discovery candidates.

## 9. Email Composition

Normal email: 3–8 full event cards.

- **一定要知道:** all new or materially changed `T0/T1` events first;
- **你可能会喜欢:** highest-scoring `T2` events;
- **值得冒险:** at most one `T3` event.

If more than eight selected-artist events exist, show the most urgent as full cards and the rest in a compact “更多你关注的艺人” list. Never silently remove them to make room for discovery.

Explanations use the actual dimensions:

> 因为王力宏是你的优先艺人；这场演出的 Mandopop 和普通话也符合你的偏好。

> 因为你把 R&B 设为喜欢，并希望约 30% 的推荐包含英文演出。

Do not say “AI thinks you will like this.”

## 10. Data Confidence and Language Limitations

Artist identity is relatively reliable through provider IDs and aliases; MusicBrainz is also useful for multilingual aliases and transliterations.[^musicbrainz-aliases] Genre is available but inconsistent across providers. Singing language is usually absent.

Maintain:

```text
ArtistLanguageProfile
  artist_id
  language_tag
  role                 // primary | significant | occasional
  confidence           // confirmed | high | medium | low | unknown
  evidence_reference
  reviewed_at
  vocal_status         // vocal | instrumental | mixed | unknown
```

Only confirmed/high language data receives full effect. Medium receives a reduced boost. Low/unknown is excluded from scoring and may enter manual review.

## 11. Acceptance Criteria

- Users may add at most 10 explicit artists and 3 genres.
- Imported artists are candidates only and receive no explicit weight until the user confirms them.
- Every artist and genre has a visible semantic weight; new items default to **喜欢**.
- Language preferences either total 100% or are set to “语言不限.”
- Adding a new artist does not reduce an existing artist's exact-match strength.
- A valid selected-artist event always enters `T0/T1` and outranks every discovery event.
- Changing popularity cannot affect `T0/T1` membership or priority over discovery.
- Missing genre or language cannot remove a selected-artist event.
- “王力宏,” “Leehom Wang,” and “Wang Leehom” resolve to the same canonical artist.
- A “Wang Leehom Tribute” without the matching performer ID does not trigger an exact match.
- Unknown language is neutral and is never inferred from nationality, name or genre.
- Every recommendation exposes whether it matched artist, style, language or local exploration.
- The normal email contains no more than eight full recommendation cards.

## 12. Validation Questions

- Do users understand **优先 / 喜欢 / 偶尔** better than numeric weights?
- Does anyone need exact artist percentages after using the semantic levels?
- Do language percentages behave like a ranking preference, or do users expect them to be an exact email quota?
- Are 60/25/15 reasonable section contributions?
- Does a maximum of 10 artists and 3 genres feel sufficient?
- How often is language metadata unknown, and how much manual review does it require?

No Jira issue was created. Refine these rules after the founder's first two weekly digests.

## Sources

[^ticketmaster-discovery]: [Ticketmaster — Discovery API v2](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/).
[^jambase-data]: [JamBase Data — Universal IDs and event data](https://data.jambase.com/data).
[^musicbrainz-aliases]: [MusicBrainz — Aliases](https://musicbrainz.org/doc/Aliases).
[^cldr]: [Unicode CLDR — Picking the Right Language Identifier](https://cldr.unicode.org/index/cldr-spec/picking-the-right-language-code).
[^wcag]: [Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/).
