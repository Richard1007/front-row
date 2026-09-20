import type {
  NormalizedEvent,
  ProviderCapability,
  ProviderId,
  ValidationInput,
} from "../core/types";

export type ProviderFetch = typeof fetch;

export interface EventProvider {
  readonly id: ProviderId;
  capability(): ProviderCapability;
  fetchEvents(input: ValidationInput): Promise<NormalizedEvent[]>;
}

export interface ProviderDependencies {
  fetch?: ProviderFetch;
  now?: () => Date;
  requestTimeoutMs?: number;
}

export class ProviderRequestError extends Error {
  readonly provider: ProviderId;
  readonly status?: number;

  constructor(provider: ProviderId, message: string, status?: number) {
    super(message);
    this.name = "ProviderRequestError";
    this.provider = provider;
    this.status = status;
  }
}

export class ProviderUnavailableError extends Error {
  readonly provider: ProviderId;

  constructor(provider: ProviderId, message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
    this.provider = provider;
  }
}
