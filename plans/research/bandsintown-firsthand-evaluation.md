# Bandsintown Firsthand Evaluation — Product Ideas

**Source:** Founder firsthand product test  
**Captured:** 2026-09-19  
**Status:** accepted as Milestone 0 product hypotheses; not yet implementation-ready

## 1. Observed Problems

### Preference import removes work but flattens intent

Bandsintown can import artists from Apple Music and Spotify, which reduces onboarding effort. However, importing 40–50 artists and selecting them all by default creates an inaccurate model: every artist appears equally important even though the user has a much smaller set they truly do not want to miss.

The burden is then reversed. Instead of helping the user state what matters, the product asks them to deselect dozens of weak preferences. Most users will accept the default, leaving the ranking system with noisy, equal-weight input.

### City selection does not represent real willingness to travel

A single city is not the user's actual concert market. A person starting in Oakland may reasonably attend shows in San Francisco, Berkeley, San Jose, Napa or other places depending on travel time. Selecting several cities manually is an incomplete substitute for “I am willing to drive up to two hours.”

### Popularity can hide the most important long-tail event

The founder follows many Chinese artists with smaller platform follower counts. If global popularity, follower count or recommendation volume influences ranking, an eligible Wang Leehom show can disappear beneath dozens of popular but low-intent suggestions.

For Front Row, missing a user-selected artist is much worse than omitting a popular discovery candidate.

The test does not prove that Bandsintown's follower count caused the omission. Other plausible causes are a city/metro boundary, an artist-alias mismatch, the event never entering the candidate set, source coverage, or final ranking. Front Row's rules should prevent all of these failure modes from becoming a silent miss.

### High recommendation volume destroys trust

Dozens of unfamiliar recommendations create work for the user. The product may have broad coverage but does not answer the decision question: “Which few shows should I actually pay attention to?”

## 2. Product Principles

1. **Import proposes; the user confirms.** Imported artists enter a candidate tray and are never all treated as confirmed favorites.
2. **Use positive selection, not mass deselection.** Ask users to choose the few artists that matter most.
3. **Core favorites receive a coverage guarantee.** Popularity cannot demote an eligible exact favorite below a similar-artist recommendation.
4. **Travel willingness is the boundary.** Model origin, travel mode and maximum travel time; do not make one city the sole geographic filter.
5. **Recommend less.** Send 3–8 strong events and skip a week rather than pad the list.
6. **Explain every result.** Show whether it came from a core favorite, related artist, genre match or local exploration.
7. **Protect long-tail and multilingual identity.** Store provider IDs plus original and alternate-language artist names.
8. **Make preference strength explicit without arithmetic burden.** Let users weight selected artists and genres with semantic levels, and use percentages only where a distribution is natural, such as language.

## 3. Proposed Preference Model

### Explicit artist preferences

- User actively selects up to 10 artists; the interface recommends beginning with 3–5.
- Required during onboarding; never inferred solely from a library import.
- Every eligible event is placed in the highest-priority section.
- Every artist receives a visible **优先 / 喜欢 / 偶尔** weight.
- User can later mark a subset as “I would travel farther for this artist.”

### Discovery pool — weak signals only

- Optional artists imported from Apple Music/Spotify, broader listening behavior, genres, related artists, venue preferences and human-curated discoveries.
- Used as recommendation evidence but does not guarantee an event appears.
- An imported artist becomes explicit only after a user selects and weights it.
- Discovery candidates never displace a qualifying selected-artist event.

### Onboarding interaction

1. Offer music-library import as an optional shortcut.
2. Show imported artists as a searchable candidate tray, not 50 checked boxes.
3. Ask the user to choose 3–5 artists to begin, allow up to 10, and assign a simple weight to each.
4. Allow manual entry for artists missing from the import.
5. Resolve each selected artist to provider IDs while retaining the exact text and aliases the user entered.
6. Ask for up to three weighted genres only after artists are set.

For the personal pilot, skip music-platform OAuth and enter the weighted artists manually. Import is an optimization to test later.

Add two more weighted sections: up to three genres with semantic levels, and a language distribution such as Mandarin 90% / English 10%. See the [weighted preference model](weighted-preference-model.md).

## 4. Proposed Location Model

Ask for:

- starting ZIP code, neighborhood or city; a full home address is optional and should not be retained unless needed;
- travel mode: drive for the MVP; public transit can be added later as a separate routing mode;
- normal maximum travel time, such as 30, 60, 90 or 120 minutes;
- optional cities the user would visit independently of normal travel time;
- optional expanded travel time for designated “travel-for” artists.

For initial candidate collection, use a generous straight-line radius around the origin. For the final shortlist, estimate route time to each venue and keep only events inside the user's time budget. Because route time changes with traffic and departure time, present it as an estimate and define a standard assumption, such as a typical Saturday evening departure.

The private pilot can check route times manually. Automated routing is a later optimization, not a Milestone 0 dependency.

## 5. Ranking and Coverage Rules

Ranking runs in strict stages:

1. Find eligible events for every selected artist using direct artist/provider-ID queries and known aliases.
2. Verify date, status, venue and estimated travel eligibility.
3. Put every qualifying selected-artist event into **一定要知道**. Use artist weights for ordering; if there are many, show the nearest/soonest and list the remainder under “更多你关注的艺人”; never silently drop them.
4. Rank discovery-pool and related-artist candidates using preference evidence, distance, date and freshness.
5. Add at most one controlled local discovery.
6. Return 3–8 events normally; do not fill unused space with weak recommendations.

Popularity/follower count rules:

- may help order two exploration candidates of otherwise similar quality;
- may not reduce or exclude a selected-artist exact match;
- may not be presented as evidence that the user personally likes an artist;
- may not override explicit negative feedback.

## 6. Example — Wang Leehom

Assume:

- the user explicitly selects and weights 王力宏 / Wang Leehom;
- an event occurs in two months;
- the venue is within the user's two-hour driving limit;
- the event is active and has an allowed ticket link.

Expected behavior:

- query by resolved provider artist ID and known aliases rather than relying on a popularity-ranked regional feed;
- show the event in **一定要知道** regardless of follower count;
- explain: “你把王力宏标记为绝不能错过；这场演出距离约 X 分钟车程。”

If the structured provider has no event, the weekly official-web check for selected artists should create a candidate for manual verification.

## 7. Prioritized Ideas

| Priority | Idea | Customer impact | Feasibility | Dependency |
| --- | --- | --- | --- | --- |
| P0 | Allow up to 10 explicitly selected and weighted artists | Very high | High | preference storage |
| P0 | Guarantee eligible selected-artist event coverage | Very high | High | direct artist queries and verification |
| P0 | Add up to 3 weighted genres and a weighted language distribution | High | Medium | taxonomy and language profiles |
| P0 | Limit normal digest to 3–8 events | High | High | ranking threshold |
| P0 | Use origin + maximum travel time | Very high | Medium | venue coordinates; manual route check first |
| P0 | Preserve multilingual names and provider IDs | High | High | artist resolution |
| P1 | Optional music-library import into the weak discovery pool | Medium | Medium | Apple/Spotify authorization |
| P1 | “Travel farther for this artist” setting | High for superfans | High | core preference model |
| P1 | One-tap promote/demote and negative feedback | High | High | feedback links |
| P2 | Automated route-time calculation | Medium | Medium | routing provider and usage terms |
| P2 | Listening-frequency-based import ordering | Medium | Medium/low | platform data access and privacy |

## 8. Acceptance Criteria

- Onboarding requires at least one actively chosen artist, recommends three to five, and permits at most ten.
- Importing 50 artists does not mark all 50 as equally preferred.
- The user can add a missing Chinese-language artist and retain both original and alternate names.
- A verified selected-artist event inside the travel boundary appears before every discovery-pool event.
- No popularity score can remove an eligible selected-artist event.
- Oakland plus a two-hour drive is not reduced to Oakland city limits; nearby eligible venues across the Bay Area are considered.
- A normal email contains no more than eight main recommendations.
- Every recommendation states whether it is a core match or discovery and gives a human-readable reason.
- When no candidate clears the quality threshold, Front Row does not send a padded recommendation email.

## 9. Validation Questions

During the founder pilot, record:

- Is the 10-artist maximum right, and do users naturally begin with three to five?
- Should every selected-artist event appear, or only the nearest date per artist?
- Does “two-hour drive” mean typical traffic, current traffic, or no-traffic time?
- How often does direct artist search find an event that a broad regional feed misses?
- How many discovery recommendations remain useful before the email feels noisy?
- Are users willing to review imported artists if the product asks only for positive core selection?

No Jira issue was created. These ideas should be refined after the first personal-pilot results.
