import type {
  NormalizedEvent,
  ProviderCapability,
  ProviderDiagnostic,
  ValidationInput,
} from "../core/types";
import { FixtureProvider } from "./fixture";
import { JamBaseProvider } from "./jambase";
import { StubHubProvider } from "./stubhub";
import { TicketmasterProvider } from "./ticketmaster";
import type { EventProvider, ProviderDependencies } from "./types";

type RegistryMode = "fixture" | "live" | "auto";

export interface ProviderRegistry {
  capabilities(): ProviderCapability[];
  fetchEvents(input: ValidationInput): Promise<{
    events: NormalizedEvent[];
    diagnostics: ProviderDiagnostic[];
  }>;
}

export interface ProviderRegistryOptions extends ProviderDependencies {
  providers?: EventProvider[];
}

export function createProviderRegistry(
  env: NodeJS.ProcessEnv = process.env,
  options: ProviderRegistryOptions = {},
): ProviderRegistry {
  const mode = registryMode(env.FR_DATA_MODE);
  const timeout = positiveInteger(env.FR_REQUEST_TIMEOUT_MS) ?? options.requestTimeoutMs;
  const shared = {
    fetch: options.fetch,
    now: options.now,
    requestTimeoutMs: timeout,
  };
  const providers = options.providers ?? [
    new TicketmasterProvider({
      ...shared,
      apiKey: env.TICKETMASTER_API_KEY,
    }),
    new JamBaseProvider({
      ...shared,
      apiKey: env.JBD_API_KEY ?? env.JAMBASE_API_KEY,
    }),
    new StubHubProvider(),
    new FixtureProvider({ now: options.now }),
  ];

  return {
    capabilities: () => providers.map((provider) => effectiveCapability(provider, mode)),
    fetchEvents: async (input) => fetchFromProviders(providers, mode, input),
  };
}

async function fetchFromProviders(
  providers: EventProvider[],
  mode: RegistryMode,
  input: ValidationInput,
): Promise<{ events: NormalizedEvent[]; diagnostics: ProviderDiagnostic[] }> {
  const fixture = providers.find((provider) => provider.id === "fixture");
  const live = providers.filter(
    (provider) =>
      provider.id !== "fixture" &&
      provider.id !== "stubhub" &&
      provider.capability().mode === "live",
  );
  const events: NormalizedEvent[] = [];
  const diagnostics: ProviderDiagnostic[] = [];

  if (mode === "fixture") {
    if (fixture) await collect(fixture, input, events, diagnostics);
  } else {
    const results = await Promise.all(
      live.map(async (provider) => {
        const collected: NormalizedEvent[] = [];
        const providerDiagnostics: ProviderDiagnostic[] = [];
        await collect(provider, input, collected, providerDiagnostics);
        return { collected, providerDiagnostics };
      }),
    );
    for (const result of results) {
      events.push(...result.collected);
      diagnostics.push(...result.providerDiagnostics);
    }

    if (mode === "auto" && events.length === 0 && fixture) {
      await collect(fixture, input, events, diagnostics);
    }
  }

  for (const provider of providers) {
    if (diagnostics.some((diagnostic) => diagnostic.provider === provider.id)) continue;
    const capability = effectiveCapability(provider, mode);
    diagnostics.push({
      provider: provider.id,
      mode: capability.mode,
      status: "skipped",
      eventCount: 0,
      message: capability.message,
    });
  }

  return { events, diagnostics };
}

async function collect(
  provider: EventProvider,
  input: ValidationInput,
  events: NormalizedEvent[],
  diagnostics: ProviderDiagnostic[],
): Promise<void> {
  try {
    const fetched = await provider.fetchEvents(input);
    events.push(...fetched);
    diagnostics.push({
      provider: provider.id,
      mode: provider.capability().mode,
      status: "success",
      eventCount: fetched.length,
    });
  } catch (error) {
    diagnostics.push({
      provider: provider.id,
      mode: provider.capability().mode,
      status: "failed",
      eventCount: 0,
      message: error instanceof Error ? error.message : "Unknown provider error.",
    });
  }
}

function effectiveCapability(
  provider: EventProvider,
  mode: RegistryMode,
): ProviderCapability {
  const capability = provider.capability();
  if (provider.id === "stubhub") return capability;
  if (provider.id === "fixture" && mode === "live") {
    return { ...capability, mode: "disabled", message: "真实数据模式下不使用演示数据。" };
  }
  if (provider.id !== "fixture" && mode === "fixture" && capability.mode === "live") {
    return { ...capability, mode: "disabled", message: "离线演示模式下不会读取此 API。" };
  }
  if (provider.id === "fixture" && mode === "auto") {
    return { ...capability, message: "真实数据不可用或没有结果时自动使用。" };
  }
  return capability;
}

function registryMode(value: string | undefined): RegistryMode {
  return value === "live" || value === "auto" ? value : "fixture";
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
