import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ImportanceLevel,
  ProviderCapability,
  RankedEvent,
  ValidationResult
} from "../core/types";
import {
  ApiRequestError,
  createValidationRun,
  getProviderCapabilities,
  type ApiIssue
} from "./api";
import {
  toValidationInput,
  validateForm,
  type EditableLanguage,
  type EditablePreference,
  type FormErrors,
  type ValidationFormState
} from "./form-utils";
import "./styles.css";

type FeedbackValue = "interested" | "not-interested" | "known" | "incorrect";
type DisplayDataMode = ValidationResult["dataMode"] | "unavailable";

const weightOptions: Array<{ value: ImportanceLevel; label: string }> = [
  { value: "priority", label: "优先" },
  { value: "like", label: "喜欢" },
  { value: "occasional", label: "偶尔" }
];

const feedbackOptions: Array<{ value: FeedbackValue; label: string }> = [
  { value: "interested", label: "想去" },
  { value: "not-interested", label: "不感兴趣" },
  { value: "known", label: "已经知道" },
  { value: "incorrect", label: "信息有误" }
];

const providerFallbacks: ProviderCapability[] = [
  { id: "ticketmaster", label: "Ticketmaster", mode: "unconfigured", message: "正在检查配置" },
  { id: "jambase", label: "JamBase", mode: "unconfigured", message: "正在检查配置" },
  { id: "stubhub", label: "StubHub", mode: "unconfigured", message: "正在检查配置" }
];

function createInitialState(): ValidationFormState {
  return {
    artists: [{ id: crypto.randomUUID(), name: "", weight: "priority" }],
    genres: [],
    languages: [
      { id: crypto.randomUUID(), language: "普通话", percentage: "70" },
      { id: crypto.randomUUID(), language: "英语", percentage: "30" }
    ],
    languageMode: "weighted",
    originLabel: "",
    latitude: "",
    longitude: "",
    maxTravelMinutes: "120"
  };
}

function createOaklandExample(): ValidationFormState {
  return {
    artists: [{ id: crypto.randomUUID(), name: "王力宏", weight: "priority" }],
    genres: [
      { id: crypto.randomUUID(), name: "Mandopop", weight: "priority" },
      { id: crypto.randomUUID(), name: "R&B", weight: "like" }
    ],
    languages: [
      { id: crypto.randomUUID(), language: "普通话", percentage: "70" },
      { id: crypto.randomUUID(), language: "英语", percentage: "30" }
    ],
    languageMode: "weighted",
    originLabel: "Oakland",
    latitude: "37.8044",
    longitude: "-122.2712",
    maxTravelMinutes: "120"
  };
}

const modeLabels = {
  live: "实时数据",
  fixture: "演示数据",
  mixed: "混合数据",
  unavailable: "数据暂不可用"
} satisfies Record<DisplayDataMode, string>;

const providerModeLabels = {
  live: "实时",
  fixture: "演示",
  disabled: "已停用",
  unconfigured: "未配置"
} as const;

const tierLabels = {
  T0: "重要变化",
  T1: "明确喜欢",
  T2: "猜你喜欢",
  T3: "探索一下"
} as const;

function PreferenceEditor({
  heading,
  hint,
  singular,
  items,
  max,
  error,
  onChange
}: {
  heading: string;
  hint: string;
  singular: string;
  items: EditablePreference[];
  max: number;
  error?: string;
  onChange: (items: EditablePreference[]) => void;
}) {
  const itemLabel = singular === "artist" ? "艺人" : "音乐风格";
  const addItem = () => {
    if (items.length < max) {
      onChange([...items, { id: crypto.randomUUID(), name: "", weight: "like" }]);
    }
  };

  return (
    <section className="preference-section" aria-labelledby={`${singular}-heading`}>
      <div className="section-heading-row">
        <div>
          <p className="section-kicker">偏好</p>
          <h2 id={`${singular}-heading`}>{heading}</h2>
          <p className="section-hint">{hint}</p>
        </div>
        <span className="count-badge" aria-label={`已填写 ${items.length} 项，最多 ${max} 项`}>
          {items.length}/{max}
        </span>
      </div>

      <div className="preference-list">
        {items.map((item, index) => (
          <div className="preference-row" key={item.id}>
            <label className="sr-only" htmlFor={`${singular}-name-${item.id}`}>
              {itemLabel} {index + 1} 名称
            </label>
            <input
              id={`${singular}-name-${item.id}`}
              value={item.name}
              onChange={(event) =>
                onChange(items.map((current) => (current.id === item.id ? { ...current, name: event.target.value } : current)))
              }
              placeholder={singular === "artist" ? "例如：王力宏" : "例如：R&B"}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${singular}-error` : undefined}
            />
            <label className="sr-only" htmlFor={`${singular}-weight-${item.id}`}>
              {item.name || `${itemLabel} ${index + 1}`}的重要程度
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
              {weightOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="icon-button"
              onClick={() => onChange(items.filter((current) => current.id !== item.id))}
              aria-label={`删除${item.name || `第 ${index + 1} 项`}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {error && <p className="field-error" id={`${singular}-error`}>{error}</p>}
      <button type="button" className="secondary-button add-button" onClick={addItem} disabled={items.length >= max}>
        <span aria-hidden="true">＋</span> 添加{singular === "artist" ? "艺人" : "风格"}
      </button>
    </section>
  );
}

function LanguageEditor({
  mode,
  items,
  error,
  onModeChange,
  onChange
}: {
  mode: ValidationFormState["languageMode"];
  items: EditableLanguage[];
  error?: string;
  onModeChange: (mode: ValidationFormState["languageMode"]) => void;
  onChange: (items: EditableLanguage[]) => void;
}) {
  const total = items.reduce((sum, item) => sum + (Number(item.percentage) || 0), 0);

  return (
    <section className="preference-section language-section" aria-labelledby="language-heading">
      <div className="section-heading-row">
        <div>
          <p className="section-kicker">偏好</p>
          <h2 id="language-heading">演唱语言</h2>
          <p className="section-hint">用比例表达长期倾向；单次推荐不一定严格照这个比例。</p>
        </div>
        {mode === "weighted" && (
          <span className={`count-badge ${total === 100 ? "is-complete" : "is-warning"}`} aria-live="polite">
            合计 {total}%
          </span>
        )}
      </div>

      <fieldset className="segmented-control">
        <legend className="sr-only">语言偏好模式</legend>
        <label className={mode === "weighted" ? "is-selected" : ""}>
          <input type="radio" name="language-mode" checked={mode === "weighted"} onChange={() => onModeChange("weighted")} />
          设置比例
        </label>
        <label className={mode === "any" ? "is-selected" : ""}>
          <input type="radio" name="language-mode" checked={mode === "any"} onChange={() => onModeChange("any")} />
          语言不限
        </label>
      </fieldset>

      {mode === "weighted" && (
        <>
          <div className="preference-list">
            {items.map((item, index) => (
              <div className="preference-row language-row" key={item.id}>
                <label className="sr-only" htmlFor={`language-name-${item.id}`}>语言 {index + 1}</label>
                <input
                  id={`language-name-${item.id}`}
                  value={item.language}
                  onChange={(event) =>
                    onChange(items.map((current) => current.id === item.id ? { ...current, language: event.target.value } : current))
                  }
                  placeholder="例如：普通话"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "languages-error" : undefined}
                />
                <label className="percentage-input" htmlFor={`language-percentage-${item.id}`}>
                  <span className="sr-only">{item.language || `语言 ${index + 1}`}的比例</span>
                  <input
                    id={`language-percentage-${item.id}`}
                    type="number"
                    min="0"
                    max="100"
                    inputMode="decimal"
                    value={item.percentage}
                    aria-invalid={Boolean(error)}
                    onChange={(event) =>
                      onChange(items.map((current) => current.id === item.id ? { ...current, percentage: event.target.value } : current))
                    }
                    aria-describedby={error ? "languages-error" : undefined}
                  />
                  <span aria-hidden="true">%</span>
                </label>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => onChange(items.filter((current) => current.id !== item.id))}
                  aria-label={`删除${item.language || `第 ${index + 1} 种语言`}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          {error && <p className="field-error" id="languages-error">{error}</p>}
          <button
            type="button"
            className="secondary-button add-button"
            onClick={() => onChange([...items, { id: crypto.randomUUID(), language: "", percentage: "0" }])}
          >
            <span aria-hidden="true">＋</span> 添加语言
          </button>
        </>
      )}
    </section>
  );
}

function ProviderPanel({ providers, loading, error }: { providers: ProviderCapability[]; loading: boolean; error?: string }) {
  return (
    <aside className="provider-panel" aria-labelledby="provider-heading">
      <div className="provider-heading-row">
        <div>
          <p className="section-kicker">数据源</p>
          <h2 id="provider-heading">当前连接状态</h2>
        </div>
        {loading && <span className="tiny-loader" aria-label="正在检查数据源" />}
      </div>
      <div className="provider-list">
        {providers.map((provider) => (
          <div className="provider-item" key={provider.id}>
            <span className={`status-dot status-${provider.mode}`} aria-hidden="true" />
            <div>
              <strong>{provider.label}</strong>
              <span>{providerModeLabels[provider.mode]}</span>
              <p>{provider.message}</p>
            </div>
          </div>
        ))}
      </div>
      {error && <p className="provider-error">无法读取最新状态：{error}</p>}
      <p className="provider-note">“演示”代表本地样本；只有“实时”才来自当前票务数据。</p>
    </aside>
  );
}

function DataModeBanner({ mode }: { mode: DisplayDataMode }) {
  const descriptions = {
    live: "以下结果全部来自本次实时查询。",
    fixture: "以下结果全部是本地演示样本，不能据此决定购票。",
    mixed: "以下结果混合了实时查询和演示样本，请查看每张卡片的数据来源。",
    unavailable: "本次没有可用的数据源结果。请检查连接状态或 API 配置后重试。"
  } satisfies Record<DisplayDataMode, string>;

  return (
    <div className={`data-mode-banner mode-${mode}`} role="status">
      <span className="mode-icon" aria-hidden="true">
        {mode === "live" ? "●" : mode === "mixed" ? "◐" : mode === "unavailable" ? "!" : "◇"}
      </span>
      <div>
        <strong>{modeLabels[mode]}</strong>
        <p>{descriptions[mode]}</p>
      </div>
    </div>
  );
}

function formatEventDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
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

function scoreValue(value: number | undefined) {
  return value === undefined ? "未知（中性处理）" : `${formatScore(value)} 分`;
}

function displayedDataMode(result: ValidationResult): DisplayDataMode {
  const hasSuccessfulSource = result.diagnostics.some((diagnostic) => diagnostic.status === "success");
  if (!hasSuccessfulSource && result.recommendations.length === 0) return "unavailable";
  return result.dataMode;
}

function formErrorsFromApiIssues(issues: ApiIssue[]): FormErrors {
  const next: FormErrors = {};
  for (const issue of issues) {
    const field = issue.path.startsWith("origin.latitude")
      ? "latitude"
      : issue.path.startsWith("origin.longitude")
        ? "longitude"
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
      field === "maxTravelMinutes"
    ) {
      next[field] ??= issue.message;
    }
  }
  return next;
}

function RecommendationCard({ event, feedback, onFeedback }: {
  event: RankedEvent;
  feedback?: FeedbackValue;
  onFeedback: (value: FeedbackValue) => void;
}) {
  const city = [event.venue.city, event.venue.region].filter(Boolean).join(" · ");

  return (
    <article className="event-card">
      <div className="event-card-topline">
        <span className={`tier-badge tier-${event.tier.toLowerCase()}`}>{event.tier} · {tierLabels[event.tier]}</span>
        <span className="score-pill" aria-label={`推荐分数 ${formatScore(event.score.final)} 分`}>
          {formatScore(event.score.final)} 分
        </span>
      </div>
      <h3>{event.name}</h3>
      <p className="event-reason">{event.reason}</p>

      <details className="score-details">
        <summary>查看评分明细</summary>
        <dl>
          <div><dt>艺人匹配</dt><dd>{scoreValue(event.score.artist)}</dd></div>
          <div><dt>风格匹配</dt><dd>{scoreValue(event.score.genre)}</dd></div>
          <div><dt>语言匹配</dt><dd>{scoreValue(event.score.language)}</dd></div>
          <div><dt>信息覆盖</dt><dd>{formatScore(event.score.coverage)}%</dd></div>
        </dl>
        <p>未知资料会按中性处理，不会记作 0 分。总分只用于同一优先层级内排序；T0/T1 始终排在猜你喜欢之前。</p>
      </details>

      <dl className="event-details">
        <div>
          <dt>时间</dt>
          <dd>{formatEventDate(event.startAt)}</dd>
        </div>
        <div>
          <dt>场地</dt>
          <dd>{event.venue.name}{city && <span> · {city}</span>}</dd>
        </div>
        {(event.estimatedTravelMinutes !== undefined || event.distanceMiles !== undefined) && (
          <div>
            <dt>出行</dt>
            <dd>
              {event.estimatedTravelMinutes !== undefined && `约 ${event.estimatedTravelMinutes} 分钟`}
              {event.estimatedTravelMinutes !== undefined && event.distanceMiles !== undefined && " · "}
              {event.distanceMiles !== undefined && `${Math.round(event.distanceMiles)} 英里`}
            </dd>
          </div>
        )}
      </dl>

      <div className="source-row" aria-label="数据来源">
        {event.sources.map((source) => (
          source.url ? (
            <a key={`${source.provider}-${source.eventId}`} href={source.url} target="_blank" rel="noreferrer">
              {source.provider} · {source.mode === "live" ? "实时" : "演示"}
            </a>
          ) : (
            <span key={`${source.provider}-${source.eventId}`}>
              {source.provider} · {source.mode === "live" ? "实时" : "演示"}
            </span>
          )
        ))}
      </div>

      {event.warnings.length > 0 && (
        <div className="warning-box">
          <strong>请留意</strong>
          <ul>
            {event.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      )}

      <fieldset className="feedback-control">
        <legend>这个推荐怎么样？</legend>
        <div>
          {feedbackOptions.map((option) => (
            <button
              type="button"
              key={option.value}
              className={feedback === option.value ? "is-selected" : ""}
              aria-pressed={feedback === option.value}
              onClick={() => onFeedback(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>
    </article>
  );
}

export default function App() {
  const [form, setForm] = useState<ValidationFormState>(() => createInitialState());
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverIssues, setServerIssues] = useState<ApiIssue[]>([]);
  const [providers, setProviders] = useState<ProviderCapability[]>(providerFallbacks);
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
  const resultsRef = useRef<HTMLElement>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    getProviderCapabilities()
      .then((nextProviders) => {
        if (active && nextProviders.length > 0) setProviders(nextProviders);
      })
      .catch((error: unknown) => {
        if (active) setProvidersError(error instanceof Error ? error.message : "未知错误");
      })
      .finally(() => {
        if (active) setProvidersLoading(false);
      });
    return () => { active = false; };
  }, []);

  const languageTotal = useMemo(
    () => form.languages.reduce((sum, language) => sum + (Number(language.percentage) || 0), 0),
    [form.languages]
  );

  const errorMessages = useMemo(() => {
    const messages = [
      ...Object.values(errors).filter((message): message is string => Boolean(message)),
      ...serverIssues.map((issue) => issue.message)
    ];
    if (messages.length === 0 && submitError) messages.push(submitError);
    return [...new Set(messages)];
  }, [errors, serverIssues, submitError]);

  const loadOaklandExample = () => {
    setForm(createOaklandExample());
    setErrors({});
    setServerIssues([]);
    setSubmitError(undefined);
    setResult(undefined);
    setLocationMessage("已载入王力宏 Oakland 演示输入，你可以直接生成推荐或继续修改。");
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocationMessage("这个浏览器不支持读取当前位置，请手动填写经纬度。");
      return;
    }
    setLocationLoading(true);
    setLocationMessage(undefined);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setForm((current) => ({
          ...current,
          originLabel: current.originLabel || "我的当前位置",
          latitude: coords.latitude.toFixed(6),
          longitude: coords.longitude.toFixed(6)
        }));
        setLocationLoading(false);
        setLocationMessage("已读取当前位置。你可以把名称改成“家”或“Oakland”。");
      },
      () => {
        setLocationLoading(false);
        setLocationMessage("无法读取当前位置。请允许定位权限，或手动填写经纬度。");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors = validateForm(form);
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
        setErrors(formErrorsFromApiIssues(error.issues));
        setSubmitError(error.message);
      } else {
        setServerIssues([]);
        setSubmitError(error instanceof Error ? error.message : "暂时无法生成推荐，请稍后再试。");
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
        <a className="brand" href="#top" aria-label="Front Row 首页">
          <span className="brand-mark" aria-hidden="true">F</span>
          <span>FRONT ROW</span>
        </a>
        <span className="local-badge">仅在本机运行</span>
      </header>

      <main id="top">
        <section className="hero">
          <div>
            <p className="eyebrow">MILESTONE 0 · PERSONAL VALIDATION</p>
            <h1>看看系统是否真的<br />懂你想看的演出。</h1>
            <p className="hero-copy">
              填写少而精的偏好和出行范围，比较 Ticketmaster、JamBase 的活动数据，并查看 StubHub 的接入状态。
            </p>
            <button type="button" className="secondary-button example-button" onClick={loadOaklandExample}>
              载入王力宏 Oakland 示例
            </button>
          </div>
          <div className="hero-ornament" aria-hidden="true">
            <span>90</span>
            <small>DAYS AHEAD</small>
          </div>
        </section>

        <div className="workspace-grid">
          <form className="validation-form" onSubmit={submit} noValidate>
            {errorMessages.length > 0 && (
              <div className="error-summary" role="alert" tabIndex={-1} ref={errorSummaryRef}>
                <strong>请先修正以下内容</strong>
                <ul>
                  {errorMessages.map((message) => <li key={message}>{message}</li>)}
                </ul>
              </div>
            )}
            <PreferenceEditor
              heading="最想看的艺人"
              hint="最多 10 位。优先级只在这些艺人之间比较，不会因为新增艺人而稀释。"
              singular="artist"
              items={form.artists}
              max={10}
              error={errors.artists}
              onChange={(artists) => setForm((current) => ({ ...current, artists }))}
            />

            <PreferenceEditor
              heading="喜欢的音乐风格"
              hint="最多 3 种，用于寻找相似但你可能还不知道的演出。"
              singular="genre"
              items={form.genres}
              max={3}
              error={errors.genres}
              onChange={(genres) => setForm((current) => ({ ...current, genres }))}
            />

            <LanguageEditor
              mode={form.languageMode}
              items={form.languages}
              error={errors.languages}
              onModeChange={(languageMode) => setForm((current) => ({ ...current, languageMode }))}
              onChange={(languages) => setForm((current) => ({ ...current, languages }))}
            />

            <section className="preference-section location-section" aria-labelledby="location-heading">
              <div className="section-heading-row">
                <div>
                  <p className="section-kicker">范围</p>
                  <h2 id="location-heading">从哪里出发？</h2>
                  <p className="section-hint">目前按直线距离粗略估算出行时间，不代表实际路线或实时路况。</p>
                </div>
              </div>

              <button type="button" className="location-button" onClick={useCurrentLocation} disabled={locationLoading}>
                <span className="location-icon" aria-hidden="true">⌖</span>
                {locationLoading ? "正在读取位置…" : "使用我的当前位置"}
              </button>
              {locationMessage && <p className="location-message" role="status">{locationMessage}</p>}

              <div className="field-stack">
                <label htmlFor="origin-label">出发点名称</label>
                <input
                  id="origin-label"
                  value={form.originLabel}
                  placeholder="例如：Oakland 的家"
                  onChange={(event) => setForm((current) => ({ ...current, originLabel: event.target.value }))}
                  aria-invalid={Boolean(errors.originLabel)}
                  aria-describedby={errors.originLabel ? "origin-label-error" : undefined}
                />
                {errors.originLabel && <p className="field-error" id="origin-label-error">{errors.originLabel}</p>}
              </div>

              <div className="coordinate-grid">
                <div className="field-stack">
                  <label htmlFor="latitude">纬度</label>
                  <input
                    id="latitude"
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={form.latitude}
                    placeholder="37.8044"
                    onChange={(event) => setForm((current) => ({ ...current, latitude: event.target.value }))}
                    aria-invalid={Boolean(errors.latitude)}
                    aria-describedby={errors.latitude ? "latitude-error" : undefined}
                  />
                  {errors.latitude && <p className="field-error" id="latitude-error">{errors.latitude}</p>}
                </div>
                <div className="field-stack">
                  <label htmlFor="longitude">经度</label>
                  <input
                    id="longitude"
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={form.longitude}
                    placeholder="-122.2712"
                    onChange={(event) => setForm((current) => ({ ...current, longitude: event.target.value }))}
                    aria-invalid={Boolean(errors.longitude)}
                    aria-describedby={errors.longitude ? "longitude-error" : undefined}
                  />
                  {errors.longitude && <p className="field-error" id="longitude-error">{errors.longitude}</p>}
                </div>
              </div>

              <div className="field-stack travel-field">
                <div className="label-row">
                  <label htmlFor="travel-time">最长单程出行时间</label>
                  <output htmlFor="travel-time">{form.maxTravelMinutes} 分钟</output>
                </div>
                <input
                  id="travel-time"
                  type="range"
                  min="15"
                  max="360"
                  step="15"
                  value={form.maxTravelMinutes}
                  onChange={(event) => setForm((current) => ({ ...current, maxTravelMinutes: event.target.value }))}
                  aria-invalid={Boolean(errors.maxTravelMinutes)}
                  aria-describedby={errors.maxTravelMinutes ? "travel-time-error" : "travel-time-hint"}
                />
                <div className="range-labels" id="travel-time-hint"><span>15 分钟</span><span>6 小时</span></div>
                {errors.maxTravelMinutes && <p className="field-error" id="travel-time-error">{errors.maxTravelMinutes}</p>}
              </div>
            </section>

            <div className="submit-panel">
              <div>
                <strong>准备查询未来 90 天</strong>
                <p>
                  {form.artists.filter((item) => item.name.trim()).length} 位艺人 · {form.genres.filter((item) => item.name.trim()).length} 种风格 · {form.languageMode === "any" ? "语言不限" : `语言合计 ${languageTotal}%`}
                </p>
              </div>
              <button className="primary-button" type="submit" disabled={submitting}>
                {submitting ? <><span className="button-loader" aria-hidden="true" />正在寻找演出</> : <>生成我的推荐 <span aria-hidden="true">→</span></>}
              </button>
            </div>
          </form>

          <ProviderPanel providers={providers} loading={providersLoading} error={providersError} />
        </div>

        <section className="results-section" ref={resultsRef} tabIndex={-1} aria-labelledby="results-heading">
          <div className="results-heading-row">
            <div>
              <p className="eyebrow">YOUR SHORTLIST</p>
              <h2 id="results-heading">本周值得关注</h2>
            </div>
            {result && <span className="run-time">更新于 {new Date(result.generatedAt).toLocaleString("zh-CN")}</span>}
          </div>

          {!result && !submitting && (
            <div className="empty-state">
              <span aria-hidden="true">↗</span>
              <h3>推荐结果会出现在这里</h3>
              <p>先填写偏好并生成推荐。目标是留下 3–8 场真正值得看的演出。</p>
            </div>
          )}

          {submitting && (
            <div className="results-loading" role="status">
              <span className="large-loader" aria-hidden="true" />
              <h3>正在跨数据源寻找演出…</h3>
              <p>我们会合并重复活动，再按明确喜欢、相似偏好和出行范围排序。</p>
            </div>
          )}

          {result && !submitting && (
            <>
              <DataModeBanner mode={displayedDataMode(result)} />
              <div className="coverage-strip" aria-label="查询覆盖情况">
                <span><strong>{result.coverage.rawEvents}</strong> 条原始活动</span>
                <span><strong>{result.coverage.deduplicatedEvents}</strong> 条去重后</span>
                <span><strong>{result.coverage.eligibleEvents}</strong> 条入选推荐</span>
                <span><strong>{result.recommendations.length}</strong> 条最终推荐</span>
              </div>

              {result.recommendations.length === 0 ? (
                <div className="empty-state result-empty">
                  <span aria-hidden="true">○</span>
                  <h3>这次没有找到合适的演出</h3>
                  <p>可以扩大出行时间、补充艺人别名，或检查下方数据源是否处于实时模式。</p>
                </div>
              ) : (
                <div className="event-grid">
                  {result.recommendations.map((event) => (
                    <RecommendationCard
                      event={event}
                      key={event.canonicalKey}
                      feedback={feedback[event.canonicalKey]}
                      onFeedback={(value) => saveFeedback(event.canonicalKey, value)}
                    />
                  ))}
                </div>
              )}

              <details className="diagnostics">
                <summary>查看本次数据源明细</summary>
                <div>
                  {result.diagnostics.map((diagnostic) => (
                    <p key={diagnostic.provider}>
                      <strong>{diagnostic.provider}</strong>
                      <span>{diagnostic.status} · {diagnostic.eventCount} 条</span>
                      {diagnostic.message && <small>{diagnostic.message}</small>}
                    </p>
                  ))}
                </div>
              </details>
            </>
          )}
        </section>
      </main>

      <footer>
        <span>FRONT ROW · LOCAL VALIDATION</span>
        <span>反馈仅保存在这台设备的浏览器中</span>
      </footer>
    </div>
  );
}
