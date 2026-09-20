import fixtureTemplates from "../../fixtures/providers/fixture-events.json";
import type {
  EventStatus,
  LanguageEvidence,
  NormalizedEvent,
  Performer,
  ProviderCapability,
  ValidationInput,
} from "../core/types";
import { forecastEnd } from "../core/forecast.js";
import type { EventProvider, ProviderDependencies } from "./types";
import {
  candidateRadiusMiles,
  canonicalEventKey,
  haversineMiles,
  safeProviderUrl,
} from "./utils";

interface FixtureTemplate {
  eventId: string;
  dayOffset: number;
  localTime: string;
  name: string;
  status: EventStatus;
  venue: {
    name: string;
    city: string;
    region: string;
    latitude: number;
    longitude: number;
  };
  performers: Performer[];
  genres: string[];
  languages: LanguageEvidence[];
  url: string;
  isTribute?: boolean;
}

export class FixtureProvider implements EventProvider {
  readonly id = "fixture" as const;
  private readonly now: () => Date;

  constructor(options: Pick<ProviderDependencies, "now"> = {}) {
    this.now = options.now ?? (() => new Date());
  }

  capability(): ProviderCapability {
    return {
      id: this.id,
      label: "离线演示数据",
      mode: "fixture",
      message: "使用内置的王力宏湾区场景，不发送网络请求。",
    };
  }

  async fetchEvents(input: ValidationInput): Promise<NormalizedEvent[]> {
    const now = this.now();
    const windowEnd = forecastEnd(now, input.forecastMonths).getTime();
    const radiusMiles = candidateRadiusMiles(input.maxTravelMinutes);

    return (fixtureTemplates as FixtureTemplate[])
      .filter(
        (template) =>
          now.getTime() + template.dayOffset * 86_400_000 <= windowEnd,
      )
      .filter((template) =>
        haversineMiles(input.origin, {
          latitude: template.venue.latitude,
          longitude: template.venue.longitude,
        }) <= radiusMiles,
      )
      .map((template) => {
        const date = new Date(now.getTime() + template.dayOffset * 86_400_000)
          .toISOString()
          .slice(0, 10);
        const startAt = `${date}T${template.localTime}`;
        return {
          canonicalKey: canonicalEventKey(template.name, startAt, template.venue.name),
          name: template.name,
          startAt,
          status: template.status,
          venue: {
            name: template.venue.name,
            city: template.venue.city,
            region: template.venue.region,
            coordinates: {
              latitude: template.venue.latitude,
              longitude: template.venue.longitude,
            },
          },
          performers: template.performers,
          genres: template.genres,
          languages: template.languages,
          sources: [
            {
              provider: "fixture" as const,
              eventId: template.eventId,
              url: safeProviderUrl("fixture", template.url),
              fetchedAt: now.toISOString(),
              mode: "fixture" as const,
            },
          ],
          isTribute: template.isTribute,
        };
      });
  }
}
