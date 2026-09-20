import { describe, expect, it } from "vitest";
import { app } from "../../src/server/index.js";
import {
  normalizeLocationQuery,
  searchLocations
} from "../../src/server/locations.js";

describe("local city search", () => {
  it("normalizes case and diacritics", () => {
    expect(normalizeLocationQuery("  SÃO-Paulo  ")).toBe("sao paulo");
    expect(searchLocations("sao paulo")[0]).toMatchObject({
      city: "São Paulo",
      countryCode: "BR"
    });
  });

  it("finds retained Unicode aliases without sending a network request", () => {
    expect(searchLocations("旧金山")[0]).toMatchObject({
      city: "San Francisco",
      countryCode: "US"
    });
  });

  it("ranks exact matches before population-heavy substring matches", () => {
    const results = searchLocations("York", 8);
    const newYorkIndex = results.findIndex((result) => result.city === "New York City");
    const exactYorkIndex = results.findIndex((result) => result.city === "York");
    expect(exactYorkIndex).toBeGreaterThanOrEqual(0);
    expect(newYorkIndex).toBeGreaterThan(exactYorkIndex);
  });

  it("returns a compact label, internal coordinates, and at most eight results", () => {
    const results = searchLocations("san", 100);
    expect(results).toHaveLength(8);
    expect(results[0]).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^geonames:/),
        label: expect.any(String),
        latitude: expect.any(Number),
        longitude: expect.any(Number)
      })
    );
  });
});

describe("GET /api/locations", () => {
  it("returns confirmed city options", async () => {
    const response = await app.request("/api/locations?q=Oakland");
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { locations: unknown[] };
    expect(payload.locations[0]).toEqual(
      expect.objectContaining({
        city: "Oakland",
        countryCode: "US",
        latitude: expect.any(Number),
        longitude: expect.any(Number)
      })
    );
  });

  it.each(["a", "🎵", "a".repeat(81)])("rejects an out-of-range query", async (query) => {
    const response = await app.request(`/api/locations?q=${query}`);
    expect(response.status).toBe(400);
  });
});
