import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ImportanceLevel,
  ProviderCapability,
  RankedEvent,
  RecommendationRejectionReason,
  ValidationResult
} from "../core/types";
import {
  ApiRequestError,
  createValidationRun,
  getProviderCapabilities,
  searchLocations,
  type LocationOption,
  type ApiIssue
} from "./api";
import {
  GENRE_OPTIONS,
  genreLabel,
  toValidationInput,
  validateForm,
  type EditableLanguage,
  type EditablePreference,
  type FormErrors,
  type ValidationFormState
} from "./form-utils";
import { LANGUAGE_OPTIONS, languageLabel } from "../data/languages";
import {
  readStoredLocale,
  storeLocale,
  tr,
  translateServerText,
  type Locale
} from "./i18n";
import "./styles.css";

type FeedbackValue = "interested" | "not-interested" | "known" | "incorrect";
type DisplayDataMode = ValidationResult["dataMode"] | "unavailable";

const weightValues: ImportanceLevel[] = ["priority", "like", "occasional"];

const feedbackValues: FeedbackValue[] = ["interested", "not-interested", "known", "incorrect"];

const providerFallbacks = (locale: Locale): ProviderCapability[] => [
  { id: "ticketmaster", label: "Ticketmaster", mode: "unconfigured", message: tr(locale, "checkingSources") },
  { id: "jambase", label: "JamBase", mode: "unconfigured", message: tr(locale, "checkingSources") },
  { id: "stubhub", label: "StubHub", mode: "unconfigured", message: tr(locale, "checkingSources") }
];

function createInitialState(locale: Locale): ValidationFormState {
  return {
    artists: [{ id: crypto.randomUUID(), name: "", weight: "priority" }],
    genres: [],
    languages: [],
    languageMode: "any",
    locationMode: "city",
    selectedCityId: "",
    originLabel: "",
    latitude: "",
    longitude: "",
    maxTravelMinutes: "120",
    forecastMonths: "4"
  };
}

function createOaklandExample(locale: Locale): ValidationFormState {
  return {
    artists: [{ id: crypto.randomUUID(), name: "王力宏", weight: "priority" }],
    genres: [
      { id: crypto.randomUUID(), name: "Mandopop", weight: "priority" },
      { id: crypto.randomUUID(), name: "R&B", weight: "like" }
    ],
    languages: [
      { id: crypto.randomUUID(), language: "cmn" },
      { id: crypto.randomUUID(), language: "en" }
    ],
    languageMode: "weighted",
    locationMode: "city",
    selectedCityId: "geonames:5378538",
    originLabel: "Oakland, California, United States",
    latitude: "37.8044",
    longitude: "-122.2712",
    maxTravelMinutes: "120",
    forecastMonths: "4"
  };
}

const modeLabelKeys = {
  live: "modeLive",
  fixture: "modeFixture",
  mixed: "modeMixed",
  unavailable: "modeUnavailable"
} as const;

const providerModeLabelKeys = {
  live: "providerLive",
  fixture: "providerFixture",
  disabled: "providerDisabled",
  unconfigured: "providerUnconfigured"
} as const;

const tierLabelKeys = {
  T0: "tierT0",
  T1: "tierT1",
  T2: "tierT2",
  T3: "tierT3"
} as const;

const tierDescriptionKeys = {
  T0: "tierT0Description",
  T1: "tierT1Description",
  T2: "tierT2Description",
  T3: "tierT3Description"
} as const;

const tierOrder = ["T0", "T1", "T2", "T3"] as const;

const rejectionLabelKeys = {
  duplicate_event: "rejectedDuplicate",
  outside_forecast: "rejectedOutsideForecast",
  missing_venue_coordinates: "rejectedMissingVenue",
  tribute_event: "rejectedTribute",
  inactive_event: "rejectedInactive",
  outside_travel_boundary: "rejectedOutsideTravel",
  no_preference_affinity: "rejectedNoPreference",
  exploration_cap: "rejectedExplorationCap",
  result_limit: "rejectedResultLimit"
} as const satisfies Record<RecommendationRejectionReason, string>;

function providerName(locale: Locale, id: string, fallback?: string): string {
  if (id === "ticketmaster") return "Ticketmaster";
  if (id === "jambase") return "JamBase";
  if (id === "stubhub") return "StubHub";
  if (id === "fixture") return tr(locale, "fixtureProvider");
  return fallback ?? id;
}

function PreferenceEditor({
  locale,
  heading,
  hint,
  singular,
  items,
  max,
  error,
  onChange
}: {
  locale: Locale;
  heading: string;
  hint: string;
  singular: string;
  items: EditablePreference[];
  max: number;
  error?: string;
  onChange: (items: EditablePreference[]) => void;
}) {
  const itemLabel = tr(locale, singular === "artist" ? "artist" : "genre");
  const addItem = () => {
    if (items.length < max) {
      onChange([...items, { id: crypto.randomUUID(), name: "", weight: "like" }]);
    }
  };

  return (
    <section className="preference-section" aria-labelledby={`${singular}-heading`}>
      <div className="section-heading-row">
        <div>
          <p className="section-kicker">{tr(locale, "preferenceKicker")}</p>
          <h2 id={`${singular}-heading`}>{heading}</h2>
          <p className="section-hint">{hint}</p>
        </div>
        <span className="count-badge" aria-label={tr(locale, "countAria", { count: items.length, max })}>
          {tr(locale, "count", { count: items.length, max })}
        </span>
      </div>

      <div className="preference-list">
        {items.map((item, index) => (
          <div className="preference-row" key={item.id}>
            <label className="sr-only" htmlFor={`${singular}-name-${item.id}`}>
              {tr(locale, "itemName", { item: itemLabel, index: index + 1 })}
            </label>
            <input
              id={`${singular}-name-${item.id}`}
              value={item.name}
              onChange={(event) =>
                onChange(items.map((current) => (current.id === item.id ? { ...current, name: event.target.value } : current)))
              }
              placeholder={tr(locale, singular === "artist" ? "artistPlaceholder" : "genrePlaceholder")}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${singular}-error` : undefined}
            />
            <label className="sr-only" htmlFor={`${singular}-weight-${item.id}`}>
              {tr(locale, "itemImportance", { name: item.name || `${itemLabel} ${index + 1}` })}
            </label>
            <select
              id={`${singular}-weight-${item.id}`}
              value={item.weight}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${singular}-error` : undefined}
              onChange={(event) =>
                onChange(
                  items.map((current) =>
                    current.id === item.id ? { ...current, weight: event.target.value as ImportanceLevel } : current
                  )
                )
              }
            >
              {weightValues.map((value) => (
                <option key={value} value={value}>
                  {tr(locale, value)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="icon-button"
              onClick={() => onChange(items.filter((current) => current.id !== item.id))}
              aria-label={tr(locale, "deleteItem", { name: item.name || `${itemLabel} ${index + 1}` })}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {error && <p className="field-error" id={`${singular}-error`}>{error}</p>}
      <button type="button" className="secondary-button add-button" onClick={addItem} disabled={items.length >= max}>
        <span aria-hidden="true">＋</span> {tr(locale, singular === "artist" ? "addArtist" : "addGenre")}
      </button>
    </section>
  );
}

function GenreEditor({
  locale,
  items,
  error,
  onChange
}: {
  locale: Locale;
  items: EditablePreference[];
  error?: string;
  onChange: (items: EditablePreference[]) => void;
}) {
  const max = 3;
  const selectedNames = new Set(items.map((item) => item.name));

  const toggleGenre = (name: string) => {
    if (selectedNames.has(name)) {
      onChange(items.filter((item) => item.name !== name));
      return;
    }
    if (items.length < max) {
      onChange([...items, { id: crypto.randomUUID(), name, weight: "like" }]);
    }
  };

  return (
    <section className="preference-section genre-section" aria-labelledby="genre-heading">
      <div className="section-heading-row">
        <div>
          <p className="section-kicker">{tr(locale, "preferenceKicker")}</p>
          <h2 id="genre-heading">{tr(locale, "genresHeading")}</h2>
          <p className="section-hint">{tr(locale, "genresHint")}</p>
        </div>
        <span className="count-badge" aria-label={tr(locale, "countAria", { count: items.length, max })}>
          {tr(locale, "count", { count: items.length, max })}
        </span>
      </div>

      <fieldset className="genre-pool" aria-describedby={error ? "genre-error" : undefined}>
        <legend className="sr-only">{tr(locale, "genrePoolLegend")}</legend>
        {GENRE_OPTIONS.map((option) => {
          const selected = selectedNames.has(option.value);
          return (
            <button
              type="button"
              className={selected ? "genre-chip is-selected" : "genre-chip"}
              key={option.value}
              aria-pressed={selected}
              disabled={!selected && items.length >= max}
              onClick={() => toggleGenre(option.value)}
            >
              <span>{genreLabel(option.value, locale)}</span>
              {locale === "zh" && <small>{option.value}</small>}
            </button>
          );
        })}
      </fieldset>

      {error && <p className="field-error" id="genre-error">{error}</p>}
    </section>
  );
}

function LanguageEditor({
  locale,
  mode,
  items,
  error,
  onModeChange,
  onChange
}: {
  locale: Locale;
  mode: ValidationFormState["languageMode"];
  items: EditableLanguage[];
  error?: string;
  onModeChange: (mode: ValidationFormState["languageMode"]) => void;
  onChange: (items: EditableLanguage[]) => void;
}) {
  const max = 3;
  const selected = new Set(items.map((item) => item.language));

  const toggleLanguage = (language: string) => {
    if (selected.has(language)) {
      const next = items.filter((item) => item.language !== language);
      onChange(next);
      if (next.length === 0) onModeChange("any");
      return;
    }
    if (items.length >= max) return;
    onModeChange("weighted");
    onChange([...items, { id: crypto.randomUUID(), language }]);
  };

  return (
    <section className="preference-section language-section" aria-labelledby="language-heading">
      <div className="section-heading-row">
        <div>
          <p className="section-kicker">{tr(locale, "preferenceKicker")}</p>
          <h2 id="language-heading">{tr(locale, "languageHeading")}</h2>
          <p className="section-hint">{tr(locale, "languageHint")}</p>
        </div>
        <span className="count-badge" aria-live="polite">
          {tr(locale, "count", { count: items.length, max })}
        </span>
      </div>

      <fieldset className="genre-pool language-pool" aria-describedby={error ? "languages-error" : undefined}>
        <legend className="sr-only">{tr(locale, "languageMode")}</legend>
        <button
          type="button"
          className={mode === "any" ? "genre-chip is-selected" : "genre-chip"}
          aria-pressed={mode === "any"}
          onClick={() => {
            onModeChange("any");
            onChange([]);
          }}
        >
          {tr(locale, "anyLanguage")}
        </button>
        {LANGUAGE_OPTIONS.map((option) => {
          const isSelected = selected.has(option.value);
          return (
            <button
              type="button"
              className={isSelected ? "genre-chip is-selected" : "genre-chip"}
              key={option.value}
              aria-pressed={isSelected}
              disabled={!isSelected && items.length >= max}
              onClick={() => toggleLanguage(option.value)}
            >
              <span>{languageLabel(option.value, locale)}</span>
              {locale === "zh" && <small>{option.en}</small>}
            </button>
          );
        })}
      </fieldset>
      {error && <p className="field-error" id="languages-error">{error}</p>}
    </section>
  );
}

function ProviderPanel({
  locale,
  providers,
  loading,
  error
}: {
  locale: Locale;
  providers: ProviderCapability[];
  loading: boolean;
  error?: string;
}) {
  const liveCount = providers.filter((provider) => provider.mode === "live").length;
  return (
    <details className="provider-panel">
      <summary id="provider-heading">
        <span className="provider-summary-status" aria-hidden="true" />
        <span>{tr(locale, "sourceSummary", { count: liveCount })}</span>
        {loading && <span className="tiny-loader" aria-label={tr(locale, "checkingSources")} />}
      </summary>
      <div className="provider-list">
        {providers.map((provider) => (
          <div className="provider-item" key={provider.id}>
            <span className={`status-dot status-${provider.mode}`} aria-hidden="true" />
            <div>
              <strong>{providerName(locale, provider.id, provider.label)}</strong>
              <span>{tr(locale, providerModeLabelKeys[provider.mode])}</span>
              <p>{translateServerText(locale, provider.message)}</p>
            </div>
          </div>
        ))}
      </div>
      {error && <p className="provider-error">{tr(locale, "providerReadError", { error: translateServerText(locale, error) })}</p>}
      <p className="provider-note">{tr(locale, "providerNote")}</p>
    </details>
  );
}

function DataModeBanner({ locale, mode }: { locale: Locale; mode: DisplayDataMode }) {
  const descriptionKeys = {
    live: "modeLiveDescription",
    fixture: "modeFixtureDescription",
    mixed: "modeMixedDescription",
    unavailable: "modeUnavailableDescription"
  } as const;

  return (
    <div className={`data-mode-banner mode-${mode}`} role="status">
      <span className="mode-icon" aria-hidden="true">
        {mode === "live" ? "●" : mode === "mixed" ? "◐" : mode === "unavailable" ? "!" : "◇"}
      </span>
      <div>
        <strong>{tr(locale, modeLabelKeys[mode])}</strong>
        <p>{tr(locale, descriptionKeys[mode])}</p>
      </div>
    </div>
  );
}

function TierGuide({ locale }: { locale: Locale }) {
  return (
    <details className="tier-guide">
      <summary>{tr(locale, "tierGuide")}</summary>
      <p>{tr(locale, "tierGuideIntro")}</p>
      <div className="tier-guide-grid">
        {tierOrder.map((tier) => (
          <div key={tier}>
            <strong className={`tier-badge tier-${tier.toLowerCase()}`}>
              {tier} · {tr(locale, tierLabelKeys[tier])}
            </strong>
            <span>{tr(locale, tierDescriptionKeys[tier])}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function ResultFunnel({ locale, result }: { locale: Locale; result: ValidationResult }) {
  const funnel = result.coverage.funnel;
  const rejected = (Object.entries(funnel.rejected) as [RecommendationRejectionReason, number][])
    .filter(([, count]) => count > 0);

  return (
    <section className="result-funnel" aria-labelledby="result-flow-heading">
      <h3 id="result-flow-heading">{tr(locale, "resultFlow")}</h3>
      <div className="coverage-strip">
        <span><strong>{funnel.inputEvents}</strong>{tr(locale, "rawListings")}</span>
        <span><strong>{funnel.deduplicatedEvents}</strong>{tr(locale, "uniqueEvents")}</span>
        <span><strong>{funnel.preferenceEligible}</strong>{tr(locale, "preferenceEligible")}</span>
        {funnel.fallbackSelected > 0 && (
          <span><strong>{funnel.fallbackSelected}</strong>{tr(locale, "fallbackSelected")}</span>
        )}
        <span><strong>{funnel.selectedEvents}</strong>{tr(locale, "shownResults")}</span>
      </div>
      {rejected.length > 0 && (
        <div className="rejection-breakdown">
          <strong>{tr(locale, "rejectionsTitle")}</strong>
          <span>{tr(locale, "funnelExplanation")}</span>
          <ul>
            {rejected.map(([reason, count]) => (
              <li key={reason}>
                {tr(locale, "rejectionCount", {
                  label: tr(locale, rejectionLabelKeys[reason]),
                  count
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function formatEventDate(value: string, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatScore(value: number) {
  const normalized = value <= 1 ? value * 100 : value;
  return Math.round(normalized);
}

function scoreValue(value: number | undefined, locale: Locale) {
  return value === undefined
    ? tr(locale, "unknownNeutral")
    : tr(locale, "points", { score: formatScore(value) });
}

function displayedDataMode(result: ValidationResult): DisplayDataMode {
  const hasSuccessfulSource = result.diagnostics.some((diagnostic) => diagnostic.status === "success");
  if (!hasSuccessfulSource && result.recommendations.length === 0) return "unavailable";
  return result.dataMode;
}

function formErrorsFromApiIssues(issues: ApiIssue[], locale: Locale): FormErrors {
  const next: FormErrors = {};
  for (const issue of issues) {
    const field = issue.path.startsWith("origin.latitude")
      ? "originLabel"
      : issue.path.startsWith("origin.longitude")
        ? "originLabel"
        : issue.path.startsWith("origin.label")
          ? "originLabel"
          : issue.path.split(".")[0];
    if (
      field === "artists" ||
      field === "genres" ||
      field === "languages" ||
      field === "originLabel" ||
      field === "latitude" ||
      field === "longitude" ||
      field === "maxTravelMinutes" ||
      field === "forecastMonths"
    ) {
      next[field] ??= translateServerText(locale, issue.message);
    }
  }
  return next;
}

function RecommendationCard({ locale, event, feedback, onFeedback }: {
  locale: Locale;
  event: RankedEvent;
  feedback?: FeedbackValue;
  onFeedback: (value: FeedbackValue) => void;
}) {
  const city = [event.venue.city, event.venue.region].filter(Boolean).join(" · ");

  return (
    <article className="event-card">
      <div className="event-card-topline">
        <span className={`tier-badge tier-${event.tier.toLowerCase()}`}>
          {event.isFallback
            ? tr(locale, "fallbackBadge")
            : `${event.tier} · ${tr(locale, tierLabelKeys[event.tier])}`}
        </span>
        {!event.isFallback && (
          <span className="score-pill" aria-label={tr(locale, "recommendationScore", { score: formatScore(event.score.final) })}>
            {tr(locale, "points", { score: formatScore(event.score.final) })}
          </span>
        )}
      </div>
      <h3>{event.name}</h3>
      <p className="event-reason">{translateServerText(locale, event.reason)}</p>

      {!event.isFallback && (
        <details className="score-details">
          <summary>{tr(locale, "viewScore")}</summary>
          <dl>
            <div><dt>{tr(locale, "artistMatch")}</dt><dd>{scoreValue(event.score.artist, locale)}</dd></div>
            <div><dt>{tr(locale, "genreMatch")}</dt><dd>{scoreValue(event.score.genre, locale)}</dd></div>
            <div><dt>{tr(locale, "languageMatch")}</dt><dd>{scoreValue(event.score.language, locale)}</dd></div>
            <div><dt>{tr(locale, "informationCoverage")}</dt><dd>{formatScore(event.score.coverage)}%</dd></div>
          </dl>
          <p>{tr(locale, "scoreExplanation")}</p>
        </details>
      )}

      <dl className="event-details">
        <div>
          <dt>{tr(locale, "time")}</dt>
          <dd>{formatEventDate(event.startAt, locale)}</dd>
        </div>
        <div>
          <dt>{tr(locale, "venue")}</dt>
          <dd>{event.venue.name}{city && <span> · {city}</span>}</dd>
        </div>
        {(event.estimatedTravelMinutes !== undefined || event.distanceMiles !== undefined) && (
          <div>
            <dt>{tr(locale, "travel")}</dt>
            <dd>
              {event.estimatedTravelMinutes !== undefined && tr(locale, "travelMinutes", { minutes: event.estimatedTravelMinutes })}
              {event.estimatedTravelMinutes !== undefined && event.distanceMiles !== undefined && " · "}
              {event.distanceMiles !== undefined && tr(locale, "miles", { miles: Math.round(event.distanceMiles) })}
            </dd>
          </div>
        )}
      </dl>

      <div className="source-row" aria-label={tr(locale, "sources")}>
        {event.sources.map((source) => (
          source.url ? (
            <a key={`${source.provider}-${source.eventId}`} href={source.url} target="_blank" rel="noreferrer">
              {providerName(locale, source.provider)} · {tr(locale, source.mode === "live" ? "sourceLive" : "sourceFixture")}
            </a>
          ) : (
            <span key={`${source.provider}-${source.eventId}`}>
              {providerName(locale, source.provider)} · {tr(locale, source.mode === "live" ? "sourceLive" : "sourceFixture")}
            </span>
          )
        ))}
      </div>

      {event.warnings.length > 0 && (
        <div className="warning-box">
          <strong>{tr(locale, "attention")}</strong>
          <ul>
            {event.warnings.map((warning) => <li key={warning}>{translateServerText(locale, warning)}</li>)}
          </ul>
        </div>
      )}

      <fieldset className="feedback-control">
        <legend>{tr(locale, "feedbackQuestion")}</legend>
        <div>
          {feedbackValues.map((value) => (
            <button
              type="button"
              key={value}
              className={feedback === value ? "is-selected" : ""}
              aria-pressed={feedback === value}
              onClick={() => onFeedback(value)}
            >
              {tr(locale, value === "known" ? "alreadyKnown" : value === "not-interested" ? "notInterested" : value)}
            </button>
          ))}
        </div>
      </fieldset>
    </article>
  );
}

export default function App() {
  const [locale, setLocale] = useState<Locale>(() =>
    readStoredLocale(typeof localStorage === "undefined" ? undefined : localStorage)
  );
  const [form, setForm] = useState<ValidationFormState>(() => createInitialState(locale));
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverIssues, setServerIssues] = useState<ApiIssue[]>([]);
  const [providers, setProviders] = useState<ProviderCapability[]>(() => providerFallbacks(locale));
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providersError, setProvidersError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  const [result, setResult] = useState<ValidationResult>();
  const [feedback, setFeedback] = useState<Record<string, FeedbackValue>>(() => {
    try {
      return JSON.parse(localStorage.getItem("front-row-feedback") || "{}");
    } catch {
      return {};
    }
  });
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string>();
  const [cityOptions, setCityOptions] = useState<LocationOption[]>([]);
  const [cityLoading, setCityLoading] = useState(false);
  const [cityOpen, setCityOpen] = useState(false);
  const [cityHighlight, setCityHighlight] = useState(0);
  const resultsRef = useRef<HTMLElement>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const locationRequestRef = useRef(0);

  useEffect(() => {
    let active = true;
    getProviderCapabilities()
      .then((nextProviders) => {
        if (active && nextProviders.length > 0) setProviders(nextProviders);
      })
      .catch((error: unknown) => {
        if (active) setProvidersError(error instanceof Error ? error.message : tr(locale, "unknownError"));
      })
      .finally(() => {
        if (active) setProvidersLoading(false);
      });
    return () => { active = false; };
  }, [locale]);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.title = tr(locale, "pageTitle");
  }, [locale]);

  const errorMessages = useMemo(() => {
    const messages = [
      ...Object.values(errors).filter((message): message is string => Boolean(message)),
      ...serverIssues.map((issue) => translateServerText(locale, issue.message))
    ];
    if (messages.length === 0 && submitError) messages.push(translateServerText(locale, submitError));
    return [...new Set(messages)];
  }, [errors, locale, serverIssues, submitError]);

  useEffect(() => {
    if (
      form.locationMode !== "city" ||
      form.selectedCityId ||
      form.originLabel.trim().length < 2
    ) {
      setCityOptions([]);
      setCityLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setCityLoading(true);
      searchLocations(form.originLabel.trim(), controller.signal)
        .then((locations) => {
          setCityOptions(locations);
          setCityHighlight(0);
          setCityOpen(true);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setCityOptions([]);
          setLocationMessage(tr(locale, "citySearchFailed"));
        })
        .finally(() => setCityLoading(false));
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [form.locationMode, form.originLabel, form.selectedCityId, locale]);

  const changeLocale = (nextLocale: Locale) => {
    setLocale(nextLocale);
    storeLocale(nextLocale, typeof localStorage === "undefined" ? undefined : localStorage);
    setErrors({});
    setServerIssues([]);
    setSubmitError(undefined);
    setLocationMessage(undefined);
    setProvidersError(undefined);
  };

  const loadOaklandExample = () => {
    setForm(createOaklandExample(locale));
    setErrors({});
    setServerIssues([]);
    setSubmitError(undefined);
    setResult(undefined);
    setLocationMessage(tr(locale, "exampleLoaded"));
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocationMessage(tr(locale, "currentLocationUnsupported"));
      return;
    }
    setLocationLoading(true);
    setLocationMessage(undefined);
    const requestId = ++locationRequestRef.current;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setForm((current) => ({
          ...(current.locationMode === "current" && locationRequestRef.current === requestId
            ? {
                ...current,
                selectedCityId: "",
                originLabel: locale === "zh" ? "我的当前位置" : "My current location",
                latitude: coords.latitude.toFixed(3),
                longitude: coords.longitude.toFixed(3)
              }
            : current)
        }));
        setLocationLoading(false);
        if (locationRequestRef.current === requestId) {
          setLocationMessage(tr(locale, "currentLocationLoaded"));
        }
      },
      () => {
        setLocationLoading(false);
        setLocationMessage(tr(locale, "currentLocationFailed"));
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  };

  const setLocationMode = (locationMode: ValidationFormState["locationMode"]) => {
    locationRequestRef.current += 1;
    setLocationLoading(false);
    setLocationMessage(undefined);
    setCityOpen(false);
    setForm((current) => ({
      ...current,
      locationMode,
      selectedCityId: "",
      originLabel: "",
      latitude: "",
      longitude: ""
    }));
  };

  const selectCity = (city: LocationOption) => {
    setForm((current) => ({
      ...current,
      locationMode: "city",
      selectedCityId: city.id,
      originLabel: city.label,
      latitude: String(city.latitude),
      longitude: String(city.longitude)
    }));
    setCityOpen(false);
    setCityOptions([]);
    setLocationMessage(tr(locale, "citySelected"));
    setErrors((current) => ({ ...current, originLabel: undefined, latitude: undefined, longitude: undefined }));
  };

  const updateCityQuery = (value: string) => {
    setForm((current) => ({
      ...current,
      locationMode: "city",
      selectedCityId: "",
      originLabel: value,
      latitude: "",
      longitude: ""
    }));
    setLocationMessage(undefined);
    setCityOpen(value.trim().length >= 2);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors = validateForm(form, locale);
    setErrors(nextErrors);
    setServerIssues([]);
    setSubmitError(undefined);
    if (Object.keys(nextErrors).length > 0) {
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
      return;
    }

    setSubmitting(true);
    try {
      const nextResult = await createValidationRun(toValidationInput(form));
      setResult(nextResult);
      requestAnimationFrame(() => resultsRef.current?.focus());
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setServerIssues(error.issues);
        setErrors(formErrorsFromApiIssues(error.issues, locale));
        setSubmitError(error.message);
      } else {
        setServerIssues([]);
        setSubmitError(error instanceof Error ? error.message : tr(locale, "generateFailed"));
      }
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
    } finally {
      setSubmitting(false);
    }
  };

  const saveFeedback = (canonicalKey: string, value: FeedbackValue) => {
    setFeedback((current) => {
      const next = { ...current, [canonicalKey]: value };
      localStorage.setItem("front-row-feedback", JSON.stringify(next));
      return next;
    });
  };

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label={tr(locale, "home")}>
          <span className="brand-mark" aria-hidden="true">F</span>
          <span>FRONT ROW</span>
        </a>
        <div className="header-actions">
          <fieldset className="locale-switch">
            <legend className="sr-only">{tr(locale, "switchLanguage")}</legend>
            <button type="button" className={locale === "en" ? "is-selected" : ""} aria-pressed={locale === "en"} onClick={() => changeLocale("en")}>English</button>
            <button type="button" className={locale === "zh" ? "is-selected" : ""} aria-pressed={locale === "zh"} onClick={() => changeLocale("zh")}>中文</button>
          </fieldset>
          <span className="local-badge">{tr(locale, "localOnly")}</span>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div>
            <p className="eyebrow">{tr(locale, "heroEyebrow")}</p>
            <h1>{tr(locale, "heroTitleLine1")}<br />{tr(locale, "heroTitleLine2")}</h1>
            <p className="hero-copy">
              {tr(locale, "heroCopy")}
            </p>
            <button type="button" className="secondary-button example-button" onClick={loadOaklandExample}>
              {tr(locale, "loadExample")}
            </button>
          </div>
          <div className="hero-ornament" aria-hidden="true">
            <span>{form.forecastMonths}</span>
            <small>{tr(locale, "monthsAhead")}</small>
          </div>
        </section>

        <div className="workspace-grid">
          <form className="validation-form" onSubmit={submit} noValidate>
            {errorMessages.length > 0 && (
              <div className="error-summary" role="alert" tabIndex={-1} ref={errorSummaryRef}>
                <strong>{tr(locale, "fixFollowing")}</strong>
                <ul>
                  {errorMessages.map((message) => <li key={message}>{message}</li>)}
                </ul>
              </div>
            )}
            <PreferenceEditor
              locale={locale}
              heading={tr(locale, "artistsHeading")}
              hint={tr(locale, "artistsHint")}
              singular="artist"
              items={form.artists}
              max={10}
              error={errors.artists}
              onChange={(artists) => setForm((current) => ({ ...current, artists }))}
            />

            <GenreEditor
              locale={locale}
              items={form.genres}
              error={errors.genres}
              onChange={(genres) => setForm((current) => ({ ...current, genres }))}
            />

            <LanguageEditor
              locale={locale}
              mode={form.languageMode}
              items={form.languages}
              error={errors.languages}
              onModeChange={(languageMode) => setForm((current) => ({ ...current, languageMode }))}
              onChange={(languages) => setForm((current) => ({ ...current, languages }))}
            />

            <section className="preference-section location-section" aria-labelledby="location-heading">
              <div className="section-heading-row">
                <div>
                  <p className="section-kicker">{tr(locale, "rangeKicker")}</p>
                  <h2 id="location-heading">{tr(locale, "locationHeading")}</h2>
                  <p className="section-hint">{tr(locale, "locationHint")}</p>
                </div>
              </div>

              <fieldset className="segmented-control location-mode">
                <legend className="sr-only">{tr(locale, "locationMode")}</legend>
                <label className={form.locationMode === "city" ? "is-selected" : ""}>
                  <input
                    type="radio"
                    name="location-mode"
                    checked={form.locationMode === "city"}
                    onChange={() => setLocationMode("city")}
                  />
                  {tr(locale, "chooseCity")}
                </label>
                <label className={form.locationMode === "current" ? "is-selected" : ""}>
                  <input
                    type="radio"
                    name="location-mode"
                    checked={form.locationMode === "current"}
                    onChange={() => setLocationMode("current")}
                  />
                  {tr(locale, "currentLocation")}
                </label>
              </fieldset>

              {form.locationMode === "current" ? (
                <button type="button" className="location-button" onClick={useCurrentLocation} disabled={locationLoading}>
                  <span className="location-icon" aria-hidden="true">⌖</span>
                  {tr(locale, locationLoading ? "readingLocation" : "useCurrentLocation")}
                </button>
              ) : (
                <div className="field-stack city-combobox">
                  <label htmlFor="city-search">{tr(locale, "cityLabel")}</label>
                  <div className="combobox-shell">
                    <input
                      id="city-search"
                      role="combobox"
                      value={form.originLabel}
                      placeholder={tr(locale, "cityPlaceholder")}
                      autoComplete="off"
                      aria-autocomplete="list"
                      aria-expanded={cityOpen}
                      aria-controls="city-options"
                      aria-activedescendant={cityOpen && cityOptions[cityHighlight] ? `city-option-${cityOptions[cityHighlight].id}` : undefined}
                      aria-invalid={Boolean(errors.originLabel)}
                      aria-describedby={errors.originLabel ? "origin-label-error" : "city-privacy-note"}
                      onFocus={() => setCityOpen(cityOptions.length > 0)}
                      onBlur={() => window.setTimeout(() => setCityOpen(false), 100)}
                      onChange={(event) => updateCityQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (!cityOpen || cityOptions.length === 0) return;
                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          setCityHighlight((current) => (current + 1) % cityOptions.length);
                        } else if (event.key === "ArrowUp") {
                          event.preventDefault();
                          setCityHighlight((current) => (current - 1 + cityOptions.length) % cityOptions.length);
                        } else if (event.key === "Enter") {
                          event.preventDefault();
                          const city = cityOptions[cityHighlight];
                          if (city) selectCity(city);
                        } else if (event.key === "Escape") {
                          setCityOpen(false);
                        }
                      }}
                    />
                    {cityLoading && <span className="tiny-loader city-loader" aria-label={tr(locale, "searchingCities")} />}
                  </div>
                  {cityOpen && (
                    <ul className="city-options" id="city-options" role="listbox">
                      {cityOptions.length > 0 ? cityOptions.map((city, index) => (
                        <li
                          id={`city-option-${city.id}`}
                          key={city.id}
                          role="option"
                          aria-selected={index === cityHighlight}
                          className={index === cityHighlight ? "is-highlighted" : ""}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => selectCity(city)}
                        >
                          {city.label}
                        </li>
                      )) : !cityLoading && form.originLabel.trim().length >= 2 ? (
                        <li className="city-empty">{tr(locale, "noCities")}</li>
                      ) : null}
                    </ul>
                  )}
                  <p className="field-note" id="city-privacy-note">{tr(locale, "cityPrivacy")}</p>
                </div>
              )}
              {locationMessage && <p className="location-message" role="status">{locationMessage}</p>}
              {errors.originLabel && <p className="field-error" id="origin-label-error">{errors.originLabel}</p>}

              <div className="field-stack travel-field">
                <div className="label-row">
                  <label htmlFor="travel-time">{tr(locale, "maxTravel")}</label>
                  <output htmlFor="travel-time">{tr(locale, "hours", { hours: Number(form.maxTravelMinutes) / 60 })}</output>
                </div>
                <select
                  id="travel-time"
                  value={form.maxTravelMinutes}
                  onChange={(event) => setForm((current) => ({ ...current, maxTravelMinutes: event.target.value }))}
                  aria-invalid={Boolean(errors.maxTravelMinutes)}
                  aria-describedby={errors.maxTravelMinutes ? "travel-time-error" : undefined}
                >
                  {[60, 90, 120, 180, 240, 360].map((minutes) => (
                    <option value={minutes} key={minutes}>
                      {tr(locale, "hours", { hours: minutes / 60 })}
                    </option>
                  ))}
                </select>
                {errors.maxTravelMinutes && <p className="field-error" id="travel-time-error">{errors.maxTravelMinutes}</p>}
              </div>

              <div className="field-stack travel-field">
                <label htmlFor="forecast-months">{tr(locale, "forecastWindow")}</label>
                <select
                  id="forecast-months"
                  value={form.forecastMonths}
                  onChange={(event) => setForm((current) => ({ ...current, forecastMonths: event.target.value }))}
                  aria-invalid={Boolean(errors.forecastMonths)}
                  aria-describedby={errors.forecastMonths ? "forecast-months-error" : "forecast-months-note"}
                >
                  {[1, 2, 3, 4, 5, 6].map((months) => (
                    <option value={months} key={months}>
                      {months === 1
                        ? tr(locale, "oneMonth")
                        : tr(locale, "monthCount", { months })}
                    </option>
                  ))}
                </select>
                <p className="field-note" id="forecast-months-note">{tr(locale, "forecastWindowHint")}</p>
                {errors.forecastMonths && <p className="field-error" id="forecast-months-error">{errors.forecastMonths}</p>}
              </div>
            </section>

            <div className="submit-panel">
              <div>
                <strong>
                  {form.forecastMonths === "1"
                    ? tr(locale, "readyOneMonth")
                    : tr(locale, "readyMonths", { months: form.forecastMonths })}
                </strong>
                <p>
                  {tr(locale, "preferenceSummary", {
                    artists: form.artists.filter((item) => item.name.trim()).length,
                    genres: form.genres.filter((item) => item.name.trim()).length,
                    language: form.languageMode === "any"
                      ? tr(locale, "anyLanguage")
                      : tr(locale, "languageCountSummary", { count: form.languages.length })
                  })}
                </p>
              </div>
              <button className="primary-button" type="submit" disabled={submitting}>
                {submitting
                  ? <><span className="button-loader" aria-hidden="true" />{tr(locale, "generating")}</>
                  : <>{tr(locale, "generate")} <span aria-hidden="true">→</span></>}
              </button>
            </div>
          </form>

          <ProviderPanel locale={locale} providers={providers} loading={providersLoading} error={providersError} />
        </div>

        <section className="results-section" ref={resultsRef} tabIndex={-1} aria-labelledby="results-heading">
          <div className="results-heading-row">
            <div>
              <p className="eyebrow">{tr(locale, "shortlistEyebrow")}</p>
              <h2 id="results-heading">{tr(locale, "shortlistHeading")}</h2>
            </div>
            {result && (
              <span className="run-time">
                {tr(locale, "updatedAt", { date: new Date(result.generatedAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US") })}
              </span>
            )}
          </div>

          <TierGuide locale={locale} />

          {!result && !submitting && (
            <div className="empty-state">
              <span aria-hidden="true">↗</span>
              <h3>{tr(locale, "emptyHeading")}</h3>
              <p>{tr(locale, "emptyCopy")}</p>
            </div>
          )}

          {submitting && (
            <div className="results-loading" role="status">
              <span className="large-loader" aria-hidden="true" />
              <h3>{tr(locale, "loadingHeading")}</h3>
              <p>{tr(locale, "loadingCopy")}</p>
            </div>
          )}

          {result && !submitting && (
            <>
              <DataModeBanner locale={locale} mode={displayedDataMode(result)} />
              <ResultFunnel locale={locale} result={result} />

              {result.recommendations.length === 0 ? (
                <div className="empty-state result-empty">
                  <span aria-hidden="true">○</span>
                  <h3>{tr(locale, "noResultsHeading")}</h3>
                  <p>{tr(locale, "noResultsCopy")}</p>
                </div>
              ) : (
                <div className="event-grid">
                  {result.recommendations.map((event) => (
                    <RecommendationCard
                      locale={locale}
                      event={event}
                      key={event.canonicalKey}
                      feedback={feedback[event.canonicalKey]}
                      onFeedback={(value) => saveFeedback(event.canonicalKey, value)}
                    />
                  ))}
                </div>
              )}

              <details className="diagnostics">
                <summary>{tr(locale, "diagnostics")}</summary>
                <div>
                  {result.discovery && (
                    <>
                      <p>
                        <strong>{tr(locale, "relatedArtistSearch")}</strong>
                        <span>{tr(locale, "relatedArtistCount", { count: result.discovery.candidateArtists.length })}</span>
                        {result.discovery.candidateArtists.length > 0 && (
                          <small>{result.discovery.candidateArtists.join(" · ")}</small>
                        )}
                      </p>
                      {result.discovery.llmExpansion && (
                        <p>
                          <strong>{tr(locale, "aiTasteExpansion")}</strong>
                          <span>
                            {tr(
                              locale,
                              result.discovery.llmExpansion.status === "completed"
                                ? "aiExpansionCompleted"
                                : result.discovery.llmExpansion.status === "disabled"
                                  ? "aiExpansionDisabled"
                                  : "aiExpansionFailed",
                              { model: result.discovery.llmExpansion.model }
                            )}
                          </span>
                          <small>
                            {result.discovery.llmExpansion.candidateArtists.length > 0
                              ? tr(locale, "aiVerifiedCandidates", {
                                  artists: result.discovery.llmExpansion.candidateArtists.join(" · ")
                                })
                              : tr(locale, "aiNoVerifiedCandidates")}
                          </small>
                          {typeof result.discovery.llmExpansion.estimatedCostUsd === "number" && (
                            <small>
                              {tr(locale, "aiExpansionCost", {
                                cost: `$${result.discovery.llmExpansion.estimatedCostUsd.toFixed(4)}`,
                                cache: result.discovery.llmExpansion.cached
                                  ? tr(locale, "aiExpansionCached")
                                  : ""
                              })}
                            </small>
                          )}
                        </p>
                      )}
                      {(result.discovery.inferredLanguages?.length || result.discovery.inferredGenres?.length) && (
                        <p>
                          <strong>{tr(locale, "inferredProfile")}</strong>
                          {result.discovery.inferredLanguages && result.discovery.inferredLanguages.length > 0 && (
                            <span>
                              {tr(locale, "inferredLanguageMix", {
                                mix: result.discovery.inferredLanguages
                                  .map((item) => `${languageLabel(item.language, locale)} ${Math.round(item.percentage)}%`)
                                  .join(" · ")
                              })}
                            </span>
                          )}
                          {result.discovery.inferredGenres && result.discovery.inferredGenres.length > 0 && (
                            <span>
                              {tr(locale, "inferredGenreMix", {
                                mix: result.discovery.inferredGenres
                                  .map((item) => `${genreLabel(item.name, locale)} ${Math.round(item.percentage)}%`)
                                  .join(" · ")
                              })}
                            </span>
                          )}
                          {Boolean(result.discovery.unknownLanguagePercentage) && (
                            <small>
                              {tr(locale, "unknownLanguageShare", {
                                percentage: Math.round(result.discovery.unknownLanguagePercentage ?? 0)
                              })}
                            </small>
                          )}
                        </p>
                      )}
                    </>
                  )}
                  {result.diagnostics.map((diagnostic) => (
                    <p key={diagnostic.provider}>
                      <strong>{providerName(locale, diagnostic.provider)}</strong>
                      <span>
                        {tr(locale, diagnostic.status === "success" ? "diagnosticSuccess" : diagnostic.status === "failed" ? "diagnosticFailed" : "diagnosticSkipped")}
                        {" · "}{tr(locale, "eventCount", { count: diagnostic.eventCount })}
                      </span>
                      {diagnostic.message && <small>{translateServerText(locale, diagnostic.message)}</small>}
                    </p>
                  ))}
                </div>
              </details>
            </>
          )}
        </section>
      </main>

      <footer>
        <span>{tr(locale, "footerProduct")}</span>
        <span>{tr(locale, "footerPrivacy")}</span>
        <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">
          {tr(locale, "footerCityData")}
        </a>
      </footer>
    </div>
  );
}
