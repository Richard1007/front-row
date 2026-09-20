import cityRowsJson from "../data/cities15000.json" with { type: "json" };

type CityRow = [
  id: number,
  name: string,
  asciiName: string,
  aliases: string[],
  countryCode: string,
  adminName: string,
  latitude: number,
  longitude: number,
  population: number
];

export interface LocationSearchResult {
  id: string;
  label: string;
  city: string;
  region?: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  source: "geonames";
}

interface IndexedCity {
  row: CityRow;
  searchNames: string[];
}

const cityRows = cityRowsJson as CityRow[];
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export function normalizeLocationQuery(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[’'`]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const indexedCities: IndexedCity[] = cityRows.map((row) => ({
  row,
  searchNames: [...new Set([row[1], row[2], ...row[3]].map(normalizeLocationQuery).filter(Boolean))]
}));

function matchRank(names: string[], query: string): number | undefined {
  if (names.some((name) => name === query)) return 0;
  if (names.some((name) => name.startsWith(query))) return 1;
  if (names.some((name) => name.includes(query))) return 2;
  return undefined;
}

function locationLabel(row: CityRow): string {
  const [, name, , , countryCode, adminName] = row;
  const countryName = regionNames.of(countryCode) ?? countryCode;
  const parts = [name];
  if (adminName && normalizeLocationQuery(adminName) !== normalizeLocationQuery(name)) {
    parts.push(adminName);
  }
  parts.push(countryName);
  return parts.join(", ");
}

export function searchLocations(query: string, requestedLimit = 6): LocationSearchResult[] {
  const normalizedQuery = normalizeLocationQuery(query);
  if (normalizedQuery.length < 2 || query.length > 80) return [];

  const limit = Math.min(8, Math.max(1, Math.trunc(requestedLimit) || 6));
  return indexedCities
    .map(({ row, searchNames }) => ({ row, rank: matchRank(searchNames, normalizedQuery) }))
    .filter((candidate): candidate is { row: CityRow; rank: number } => candidate.rank !== undefined)
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        right.row[8] - left.row[8] ||
        left.row[1].localeCompare(right.row[1], "en")
    )
    .slice(0, limit)
    .map(({ row }) => ({
      id: `geonames:${row[0]}`,
      label: locationLabel(row),
      city: row[1],
      ...(row[5] ? { region: row[5] } : {}),
      countryCode: row[4],
      latitude: row[6],
      longitude: row[7],
      source: "geonames"
    }));
}
