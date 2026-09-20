import { describe, expect, it } from "vitest";

import { estimateDrivingTravel, haversineMiles } from "../../src/core/index.js";

describe("travel estimation", () => {
  it("returns zero for identical coordinates", () => {
    const oakland = { latitude: 37.8044, longitude: -122.2712 };
    expect(haversineMiles(oakland, oakland)).toBe(0);
    expect(estimateDrivingTravel(oakland, oakland).travelMinutes).toBe(0);
  });

  it("produces a deterministic Oakland-to-San Francisco estimate", () => {
    const result = estimateDrivingTravel(
      { latitude: 37.8044, longitude: -122.2712 },
      { latitude: 37.7749, longitude: -122.4194 }
    );

    expect(result.distanceMiles).toBeGreaterThan(7);
    expect(result.distanceMiles).toBeLessThan(10);
    expect(result.travelMinutes).toBeGreaterThan(10);
    expect(result.method).toBe("straight-line-estimate");
  });
});
