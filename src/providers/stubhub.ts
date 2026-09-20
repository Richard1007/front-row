import type {
  NormalizedEvent,
  ProviderCapability,
  ValidationInput,
} from "../core/types";
import type { EventProvider } from "./types";
import { ProviderUnavailableError } from "./types";

/**
 * StubHub's current catalog access is partner-gated. This provider deliberately
 * has no fetch dependency and cannot make a network request until an approved
 * contract and credential flow are implemented.
 */
export class StubHubProvider implements EventProvider {
  readonly id = "stubhub" as const;

  capability(): ProviderCapability {
    return {
      id: this.id,
      label: "StubHub",
      mode: "disabled",
      message: "需要 StubHub 合作方批准与凭据；当前不会发送任何网络请求。",
    };
  }

  async fetchEvents(_input: ValidationInput): Promise<NormalizedEvent[]> {
    throw new ProviderUnavailableError(
      this.id,
      "StubHub 需要合作方批准与凭据，Milestone 0 暂不连接。",
    );
  }
}
