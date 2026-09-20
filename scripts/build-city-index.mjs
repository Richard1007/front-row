#!/usr/bin/env node

import { inflateRawSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CITIES_URL = "https://download.geonames.org/export/dump/cities15000.zip";
const ADMIN_URL = "https://download.geonames.org/export/dump/admin1CodesASCII.txt";
const LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "src/data/cities15000.json");
const metadataPath = resolve(root, "src/data/cities15000.meta.json");

async function fetchBuffer(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Front-Row city index builder (github.com/Richard1007/front-row)" }
  });
  if (!response.ok) {
    throw new Error(`Unable to download ${url}: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

// GeoNames' archive contains one deflated text file. Reading the local ZIP entry
// keeps this maintenance script dependency-free.
function readFirstZipEntry(archive) {
  const endSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const endOffset = archive.lastIndexOf(endSignature);
  if (endOffset < 0) {
    throw new Error("Unexpected GeoNames ZIP format.");
  }
  const centralOffset = archive.readUInt32LE(endOffset + 16);
  if (archive.readUInt32LE(centralOffset) !== 0x02014b50) {
    throw new Error("Unexpected GeoNames ZIP directory.");
  }
  const method = archive.readUInt16LE(centralOffset + 10);
  const compressedSize = archive.readUInt32LE(centralOffset + 20);
  const localOffset = archive.readUInt32LE(centralOffset + 42);
  const fileNameLength = archive.readUInt16LE(localOffset + 26);
  const extraLength = archive.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + fileNameLength + extraLength;
  const compressed = archive.subarray(start, start + compressedSize);
  if (method === 0) return compressed;
  if (method === 8) return inflateRawSync(compressed);
  throw new Error(`Unsupported ZIP compression method: ${method}`);
}

function normalized(value) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[’'`]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function selectAliases(name, asciiName, alternateNames) {
  const seen = new Set([normalized(name), normalized(asciiName)]);
  const aliases = alternateNames
    .split(",")
    .map((alias) => alias.trim())
    .filter((alias) => {
      const key = normalized(alias);
      if (!key || key.length > 60 || seen.has(key) || /https?:|\d{4,}/iu.test(alias)) return false;
      // Very short Latin abbreviations (for example, "SA") create noisy exact
      // matches while a person is still typing a city name.
      if (key.length < 3 && /^[a-z]+$/u.test(key)) return false;
      seen.add(key);
      return true;
    });

  const han = aliases.filter((alias) => /\p{Script=Han}/u.test(alias)).slice(0, 3);
  const latin = aliases
    .filter((alias) => /\p{Script=Latin}/u.test(alias))
    .sort((left, right) => left.length - right.length || left.localeCompare(right))
    .slice(0, 5);
  const other = aliases
    .filter((alias) => !/\p{Script=Han}|\p{Script=Latin}/u.test(alias))
    .slice(0, 2);

  return [...new Set([...han, ...latin, ...other])];
}

function parseAdminNames(text) {
  return new Map(
    text
      .trim()
      .split("\n")
      .map((line) => line.split("\t"))
      .filter((fields) => fields.length >= 2)
      .map((fields) => [fields[0], fields[1]])
  );
}

function parseCities(text, adminNames) {
  return text
    .trim()
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((fields) => fields.length >= 19)
    .map((fields) => {
      const [id, name, asciiName, alternateNames, latitude, longitude, , , countryCode, , adminCode, , , , population] = fields;
      const aliases = selectAliases(name, asciiName, alternateNames);
      const adminName = adminNames.get(`${countryCode}.${adminCode}`) ?? "";
      return [
        Number(id),
        name,
        asciiName !== name ? asciiName : "",
        aliases,
        countryCode,
        adminName,
        Number(latitude),
        Number(longitude),
        Number(population)
      ];
    })
    .sort((left, right) => right[8] - left[8] || left[0] - right[0]);
}

const [archive, adminResponse] = await Promise.all([
  fetchBuffer(CITIES_URL),
  fetchBuffer(ADMIN_URL)
]);
const adminNames = parseAdminNames(adminResponse.toString("utf8"));
const cities = parseCities(readFirstZipEntry(archive).toString("utf8"), adminNames);

await mkdir(dirname(outputPath), { recursive: true });
await Promise.all([
  writeFile(outputPath, `${JSON.stringify(cities)}\n`),
  writeFile(
    metadataPath,
    `${JSON.stringify(
      {
        title: "GeoNames cities15000",
        source: CITIES_URL,
        adminSource: ADMIN_URL,
        license: "CC BY 4.0",
        licenseUrl: LICENSE_URL,
        attribution: "GeoNames (https://www.geonames.org/)",
        generatedAt: new Date().toISOString(),
        cityCount: cities.length,
        aliasLimitPerCity: 10,
        rowSchema: [
          "geonameId",
          "name",
          "asciiName",
          "aliases",
          "countryCode",
          "adminName",
          "latitude",
          "longitude",
          "population"
        ]
      },
      null,
      2
    )}\n`
  )
]);

console.log(`Wrote ${cities.length.toLocaleString("en-US")} cities to ${outputPath}`);
