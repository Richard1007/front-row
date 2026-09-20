import type { Coordinates } from "./types.js";

const EARTH_RADIUS_MILES = 3_958.8;

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance. It is deterministic and does not call an external maps service. */
export function haversineMiles(from: Coordinates, to: Coordinates): number {
  const latitudeDelta = degreesToRadians(to.latitude - from.latitude);
  const longitudeDelta = degreesToRadians(to.longitude - from.longitude);
  const fromLatitude = degreesToRadians(from.latitude);
  const toLatitude = degreesToRadians(to.latitude);

  const chord =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(chord));
}

export interface TravelEstimate {
  distanceMiles: number;
  travelMinutes: number;
  method: "straight-line-estimate";
}

/**
 * Milestone 0 estimate: road distance is approximated as 1.25x great-circle
 * distance, at an average 40 mph. A maps provider can replace this later.
 */
export function estimateDrivingTravel(from: Coordinates, to: Coordinates): TravelEstimate {
  const distanceMiles = haversineMiles(from, to);
  const estimatedRoadMiles = distanceMiles * 1.25;
  const travelMinutes = Math.ceil((estimatedRoadMiles / 40) * 60);

  return {
    distanceMiles: Math.round(distanceMiles * 10) / 10,
    travelMinutes,
    method: "straight-line-estimate"
  };
}
