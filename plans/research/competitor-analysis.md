# Milestone 0 — Competitor Analysis

**Research date:** 2026-09-19  
**Scope:** Consumer concert discovery, personalized recommendations, alerts, weekly digests, and ticket links.  
**Conclusion:** The need is validated, but the category is crowded. Front Row should not compete as another general concert-listing app. Its useful opening is a lightweight, email-first, cross-platform personal concert scout with a small number of explained recommendations and careful coverage of local gaps.

## 1. Market Summary

Three mature products already solve much of the headline problem:

- **Bandsintown:** follow artists, receive nearby-show and on-sale alerts, and discover related artists.
- **Songkick:** track artists and locations, receive personalized concert alerts, and avoid missing ticket opportunities.
- **Spotify Live Events / Concerts Near You:** use listening history and location to produce personalized nearby events, including a weekly playlist.

Spotify's weekly Concerts Near You feature is especially close to the original Front Row concept: it refreshes every Wednesday, shows 30 songs from artists performing nearby, and links to ticketing partners.[^spotify-weekly][^spotify-fandom] This validates the weekly cadence, but it also means “weekly personalized local concerts” by itself is not a differentiated proposition.

The opportunity is narrower and more human:

> One useful email a week, across music and ticketing platforms, with only the shows worth your attention and a clear explanation of why each one fits.

## 2. Competitor Comparison

| Product | Core promise | Personalization and delivery | Data model | Business model | Front Row lesson |
| --- | --- | --- | --- | --- | --- |
| Bandsintown | Never miss a show; discover artists and live events | Followed artists, location, inferred interests; weekly email, push, reminders, on-sale alerts | Ticketing feeds plus artists, venues, promoters and agencies | Consumer product free; paid promotion/tools for industry | Feature-complete direct competitor; win on focus and explanation |
| Songkick | Track favorite artists, get alerts, do not miss tickets | Tracked artists/cities, Spotify import; digest, push and reminders | 100+ ticket/local sources plus Tourbox and community submissions | Consumer product free; artist campaigns and commercial data licensing | Strongest proof of the original pain; standard API is unsuitable for multi-source use |
| Spotify Live Events | Find the right show while already listening | Listening history, followed artists, genres, location; in-app, email and push | Current page lists 40+ partner sites, including Bandsintown, Ticketmaster, AXS, DICE and Eventbrite | Bundled into Spotify Free/Premium; checkout at partners | Listening data is a major advantage; Front Row must be cross-platform and proactive |
| Apple Music / Shazam | Move from music discovery to a nearby live show | Music preferences, location, nearby/For You discovery and saved-event reminders | Bandsintown and Ticketmaster integrations | No separate concert-discovery fee; bundled into Apple Music/Shazam | Contextual discovery is strong, but it remains platform-bound |
| YouTube ticketing features | Show tickets when interest in an artist is highest | Current artist/video, subscriptions, watch/search behavior and location | Bandsintown-provided concert listings | No separate fee; bundled into YouTube's ads/Premium ecosystem | The best moment for an alert matters as much as ranking quality |
| JamBase | Go see live music; search, track and explore | Favorites, related artists, radius/date; alerts and Spotify Local Live Mixes | Direct partnerships and feeds normalized across sources | Free consumer discovery plus ads, promotion and commercial data | Both a competitor and a promising supplier |
| DICE | Tickets for your kind of shows | Music-library scan, follows, purchases and friend taste; app/email | First-party ticketing inventory supplied by event partners | Ticketing/service revenue | Great friend features, but primarily limited to events listed/ticketed through DICE |
| SeatGeek | Predict events and artists the user may like or forgot to track | SeatGeek actions, tracked artists/events, Spotify/Facebook signals and similar users; announcements and price-drop alerts | SeatGeek marketplace catalog | Ticket marketplace revenue | Strong direct competitor, but its API terms restrict AI use |
| Ticketmaster consumer app | Follow performers/venues and receive curated event recommendations | Favorites, category preferences, account alerts and SMS reminders one hour before a selected ticket sale | First-party Ticketmaster catalog | Primary/resale ticketing revenue | The data provider itself already solves part of the alert problem |
| DoStuff / DoMORE | Answer “what are you doing tonight?” with local authority | Local editors plus preferences, Spotify/Bandcamp and direct email/SMS | Local research, venue/promoter relationships and submissions | Advertising, campaigns; DoMORE membership is $7/month | Proves a small, city-first, partly human service can be valuable |

Apple documents nearby, For You and saved-event reminder experiences in Shazam, while Bandsintown states that it supplies event data to Apple surfaces.[^apple-shazam][^bandsintown-distribution] YouTube's feature appears on artist channels, videos and Shorts in the main YouTube experience; it is not a separate YouTube Music concert feed.[^youtube-tickets]

## 3. How Competitors Position Themselves

Competitors rarely lead with “AI recommendation” or technical architecture. Their messages focus on an outcome:

- **Bandsintown:** event alerts and recommendations, including automated weekly concert recommendations, so fans do not miss artists they love.[^bandsintown-about][^bandsintown-weekly]
- **Songkick:** “Track your favorite artists,” “Get personalized concert alerts,” and “Never miss out on tickets.”[^songkick-about]
- **Spotify:** connect listening habits with nearby events and ticket partners at the moment of musical engagement.[^spotify-live]
- **JamBase:** “Go See Live Music,” emphasizing discovery rather than technology.[^jambase-data]
- **DICE:** find events that match the user's taste, with personalized email, curated picks and friend matching.[^dice-discovery]
- **DoStuff:** be the trusted local answer to “What are you doing tonight?”[^dostuff]

Front Row's homepage should therefore not start with Qwen, Ticketmaster, APIs or “AI-powered.” A better product promise is:

> 每周一封邮件，告诉你未来三个月真正值得看的演出——包括你喜欢的艺人，也包括下一位你可能会喜欢的艺人。

Supporting points:

- no app to remember to open;
- a small number of strong matches, not an endless feed;
- a reason for every recommendation;
- cross-platform preferences rather than one streaming history;
- source and last-checked time on every event;
- earlier awareness and more time to decide, not a guaranteed lower price.

## 4. How Competitors Solve the Data Problem

Mature products use a supply chain, not one magic API.

### 4.1 Direct ticketing feeds

Spotify says its live-event listings come from Ticketmaster, AXS, DICE, Eventbrite, See Tickets and many other ticketing partners; its current page lists more than 40 partner sites.[^spotify-source] Bandsintown automatically imports from ticketing partners including Ticketmaster, AXS, Eventbrite and See Tickets.[^bandsintown-import]

### 4.2 Rights-holder submission and correction

Bandsintown lets artists, venues and promoters add or correct events. Its ordinary API key is normally tied to one artist; organization-wide, multi-artist use requires partnership approval.[^bandsintown-api] Songkick's Tourbox and support processes accept submissions from artists, managers, venues, promoters and fans.[^songkick-source] DICE obtains event and inventory information directly from the promoters, venues, artists, managers and agents using its ticketing system.[^dice-terms]

Aggregation does not guarantee perfect freshness. Bandsintown notes that some imported events do not automatically inherit later changes from the upstream ticketing page and may need manual correction.[^bandsintown-import] Every source still needs a pre-send cancellation and change check.

### 4.3 Aggregation, normalization and deduplication

JamBase says its data is sourced from ticketing companies, venues, promoters and festivals rather than scraped, then normalized into stable artist, venue and event entities with third-party ID mappings.[^jambase-data] This is the expensive infrastructure layer that Front Row should buy rather than rebuild if the price is reasonable.

### 4.4 Human and community gap filling

Songkick accepts community corrections. Do512 and other DoStuff local guides search artist and venue websites, receive press releases and user submissions, and use local editorial judgment.[^dostuff-source] DoMORE is a separate membership flow: venues or promoters offer inventory for selected events, then DoStuff matches it to members using stated preferences and Spotify/Bandcamp signals.[^dostuff-more] Concert Archives is community-maintained and history-oriented; Front Row should treat it as a secondary corroboration source unless an upcoming listing is independently verified.[^concert-archives]

### 4.5 Redistribution

Bandsintown states that it distributes artist event data into Spotify, Google, Apple/Shazam, YouTube and other platforms.[^bandsintown-distribution] This shows that some consumer platforms can obtain event listings through authorized redistribution instead of collecting every source themselves.

### 4.6 Ticketing platforms as competitors

SeatGeek predicts artists and concerts from tracked/purchased events, connected Spotify/Facebook signals and similar users, then sends alerts for announcements and price drops.[^seatgeek-recommendations] Ticketmaster lets consumers favorite performers and venues, receive curated recommendations, customize alerts, and request an SMS one hour before a ticket sale.[^ticketmaster-alerts][^ticketmaster-reminder]

These products have first-party inventory and checkout, so Front Row should not compete on transaction speed. Its test is whether a cross-provider, calmer, human-reviewed digest finds something their separate ecosystems miss.

## 5. Direct Competitive Risks

### Bandsintown

This is the closest feature competitor. It already supports followed and recommended artists, geography, just-announced and on-sale alerts, weekly recommendations, reminders and official purchase links. Front Row cannot beat it on feature count in an early version.

Potential gap: a calmer weekly email, transparent reasons, manual quality control, cross-platform preferences, smaller/local venue coverage and a personal-assistant tone.

### Spotify

Spotify has the strongest preference signal because it sees real listening behavior. Its Live Events feed refreshes daily, and Concerts Near You refreshes weekly.[^spotify-venues][^spotify-weekly]

Potential gap: users must live inside Spotify's ecosystem, recommendations are not centered on a three-month planning horizon, and the service is a feature rather than a dedicated concert-planning assistant.

### Songkick

Songkick's promise closely matches the emotional problem: learn early and avoid missing out. It is free and mature.

Potential gap: Front Row can be more selective, explain recommendations, combine music preferences from different sources, and apply a human check for important events. Songkick's standard API terms also require it to be the exclusive live-music data provider, which limits its usefulness as Front Row infrastructure.[^songkick-terms]

### JamBase

JamBase is both a strong discovery competitor and a possible shortcut. Its data offering explicitly targets fan apps and supports location, date, artist and genre discovery with ticket links.[^jambase-fan-apps]

JamBase now publishes a $0 noncommercial Developer plan with 1,000 calls/month, a six-month future-event window, ticket links and required attribution. Its Startup plan is $600/month or $500/month billed annually.[^jambase-pricing] Action: test the free Developer plan for the personal pilot; do not assume it covers a later commercial product.

### DoStuff / DoMORE

DoStuff is the strongest proof that a city-first, partly manual service can work. DoMORE matches selected partner event inventory to member preferences by email and currently lists a $7/month membership model.[^dostuff-events][^dostuff-price]

Action: borrow the local-editor model, not the ticket-giveaway business model.

## 6. Product Hypothesis to Test

Email recommendations already exist across Bandsintown, Songkick, Spotify and DICE, so “we send email” is not an established white space. The hypothesis is that this particular combination is more useful:

1. **Email is the product.** No app and no feed habit required.
2. **Cross-platform taste.** Users can type artists and genres now; Spotify/Apple/Last.fm imports can come later.
3. **Few, explained choices.** Three to eight recommendations with “why this fits,” not hundreds of listings.
4. **Human-reviewed local gaps.** A small trusted city scope can cover venues and independent shows missed by large feeds.
5. **Planning horizon.** Organize the next 90 days, including newly announced and soon-on-sale shows.
6. **Source transparency.** Show where the event came from and when it was last checked.
7. **Friend usefulness.** Eventually show overlap between two people's tastes or make a shareable shortlist, inspired by DICE.

This is not a venture-scale moat yet. It is a coherent personal tool and a strong way to test whether the email itself creates repeated value.

## 7. Recommended Experience to Test

Each weekly email should contain at most three sections:

- **一定要知道:** exact favorite artists or a major on-sale change;
- **你可能会喜欢:** adjacent artists with a concrete reason;
- **值得冒险:** one human-curated local discovery.

Each card needs only:

- artist/event name;
- date, venue and approximate distance;
- one-sentence recommendation reason;
- source and last verified time;
- one official/approved ticket link;
- simple feedback: “想去 / 不感兴趣 / 已经知道.”

The first success question is not conversion or revenue:

> Did this week's email reveal at least one show the recipient cared about and probably would not have found in time?

## 8. What Not to Build Yet

- another general nationwide event search page;
- a native mobile app;
- a complex LLM recommendation stack;
- real-time price comparison or guaranteed-savings claims;
- automatic scraping of ticketing sites;
- Stripe billing;
- a full multi-source deduplication platform;
- social networking beyond a shareable shortlist.

## 9. Founder Test Insight — Explicit Priority Beats Bulk Import

A firsthand Bandsintown test exposed a sharper differentiation hypothesis. Music-library import reduces setup work, but importing dozens of artists into a binary Follow/Unfollow model does not let the user express which few artists truly matter. A city selector also fails to represent a Bay Area user's real willingness to drive across Oakland, San Francisco and San Jose.

Front Row should therefore:

- require an explicit set of one to five core artists, recommending three to five;
- treat Apple Music/Spotify imports only as a weak discovery pool;
- guarantee that eligible core-artist events outrank popularity-based suggestions;
- preserve multilingual artist aliases and provider IDs;
- model an origin plus maximum one-way travel time instead of city boundaries;
- cap the normal email at three to eight strong events.

See the [full firsthand evaluation and acceptance criteria](bandsintown-firsthand-evaluation.md).

## Sources

[^bandsintown-about]: [Bandsintown company overview](https://www.bandsintown.company/).
[^bandsintown-import]: [Bandsintown — Creating, importing and publishing events](https://help.venues.bandsintown.com/en/articles/8486885-creating-importing-publishing-events).
[^bandsintown-distribution]: [Bandsintown — Distribution to Spotify, Google, Apple, Shazam and Amazon Music](https://help.artists.bandsintown.com/en/articles/10518205-distribution-to-spotify-google-apple-shazam-and-amazon-music).
[^bandsintown-api]: [Bandsintown — API access policy](https://help.artists.bandsintown.com/en/articles/7053475-what-is-the-bandsintown-api).
[^bandsintown-weekly]: [Bandsintown — Automated Weekly Concert Recommendations](https://help.artists.bandsintown.com/en/articles/13533897-how-to-use-boost).
[^songkick-about]: [Songkick — About](https://developer.songkick.com/info/about).
[^songkick-source]: [Songkick — Where listings come from](https://support.songkick.com/hc/en-us/articles/360012565233-Where-does-Songkick-get-its-listings-from).
[^songkick-terms]: [Songkick — API Terms of Use](https://www.songkick.com/developer/api-terms-of-use).
[^spotify-weekly]: [Spotify — Concerts Near You](https://support.spotify.com/fm/article/concerts-near-you/).
[^spotify-fandom]: [Spotify — Fandom feature updates](https://newsroom.spotify.com/2026-08-25/fandom-features-updates/).
[^spotify-live]: [Spotify — Find Shows Tailored to You](https://newsroom.spotify.com/2022-06-23/find-shows-tailored-to-you-right-in-the-spotify-app/).
[^spotify-source]: [Spotify for Artists — Adding concerts](https://support.spotify.com/sm-en/artists/article/adding-concerts-to-spotify/).
[^spotify-venues]: [Spotify — Search and Follow Your Favorite Venues](https://newsroom.spotify.com/2025-10-20/live-music-venues-on-spotify/).
[^jambase-data]: [JamBase Data](https://data.jambase.com/).
[^jambase-fan-apps]: [JamBase Data — Fan apps](https://data.jambase.com/fan-apps).
[^jambase-pricing]: [JamBase Data — Pricing](https://data.jambase.com/pricing).
[^dice-discovery]: [DICE — How to find events you'll love](https://dicefm.zendesk.com/hc/en-gb/articles/22365220986897-How-to-find-events-you-ll-love-on-DICE).
[^dice-terms]: [DICE — US ticketing terms](https://support.dice.fm/article/764-mio-ticketing-terms-and-conditions-us).
[^seatgeek-recommendations]: [SeatGeek — Recommendations](https://support.seatgeek.com/hc/en-us/articles/360007288053-What-are-SeatGeek-recommendations).
[^ticketmaster-alerts]: [Ticketmaster — New event alerts](https://help.ticketmaster.com/hc/en-us/articles/9613319708561-How-do-I-get-alerts-about-new-events).
[^ticketmaster-reminder]: [Ticketmaster — Ticket-sale reminders](https://help.ticketmaster.com/hc/en-us/articles/18179879687825-How-do-I-set-a-reminder-for-an-event-s-ticket-sale).
[^apple-shazam]: [Apple — Discover concerts with Shazam](https://support.apple.com/guide/shazam/discover-concerts-dev08d87910a/1.0/web/1.0).
[^youtube-tickets]: [YouTube — Ticketing and concert listings](https://support.google.com/youtubemusic/answer/7570245?hl=en-GB).
[^dostuff]: [DoStuff](https://dostuffmedia.com/).
[^dostuff-source]: [Do512 — About and event sourcing](https://do512.com/p/about).
[^dostuff-events]: [DoStuff — Event discovery](https://dostuffmedia.com/service/live-events).
[^dostuff-more]: [DoStuff — DoMORE](https://dostuffmedia.com/service/domore).
[^dostuff-price]: [DoStuff — Do more in your city](https://dostuffmedia.com/blog/want-to-do-more-in-your-city).
[^concert-archives]: [Concert Archives](https://www.concertarchives.org/).
