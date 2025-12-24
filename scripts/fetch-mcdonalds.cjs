#!/usr/bin/env node
/**
 * Fetch McDonald's locations across the US using restaurant-location-search-api.
 *
 * Strategy: Query a grid of points across the continental US with overlapping
 * radius searches to ensure full coverage.
 *
 * Usage:
 *   npm install restaurant-location-search-api
 *   node scripts/fetch-mcdonalds.js
 *
 * Output: poi_data/mcdonalds.csv
 */

const fs = require('fs');
const path = require('path');

let restaurantApi;
try {
  restaurantApi = require('restaurant-location-search-api');
} catch {
  console.error('Please install the required package first:');
  console.error('  npm install restaurant-location-search-api');
  process.exit(1);
}

// US bounding box (continental)
const US_BOUNDS = {
  minLat: 24.5,
  maxLat: 49.0,
  minLng: -125.0,
  maxLng: -66.5,
};

// Grid spacing in degrees - with 50 mile search radius, 0.6 degrees (~40 miles) ensures overlap
const GRID_STEP_LAT = 0.6;
const GRID_STEP_LNG = 0.7;

// Search radius in miles (API converts to km internally)
const SEARCH_RADIUS_MILES = 50;

// Rate limiting - be respectful but reasonable
const DELAY_BETWEEN_REQUESTS_MS = 400;
const MAX_RETRIES = 3;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(lat, lng, retries = 0) {
  try {
    // API is a function that returns {features: [...]} for McDonald's
    // Third param is radius in km, fourth is max results
    const radiusKm = SEARCH_RADIUS_MILES * 1.60934;
    const response = await restaurantApi('mcdonalds', { lat, long: lng }, radiusKm.toFixed(1), 100);
    // Extract features array from response
    if (response && response.features) {
      return response.features;
    }
    return Array.isArray(response) ? response : [];
  } catch (error) {
    if (retries < MAX_RETRIES) {
      const backoff = Math.pow(2, retries) * 1000;
      console.log(`  Retry ${retries + 1} after ${backoff}ms...`);
      await sleep(backoff);
      return fetchWithRetry(lat, lng, retries + 1);
    }
    console.error(`  Failed after ${MAX_RETRIES} retries: ${error.message}`);
    return [];
  }
}

function parseLocation(item) {
  // McDonald's API returns GeoJSON-style features with properties
  const props = item.properties || item;
  const coords = item.geometry?.coordinates;

  const lat = coords?.[1] || props.latitude || props.lat;
  const lng = coords?.[0] || props.longitude || props.lng || props.lon;

  if (!lat || !lng) return null;

  // Extract store ID from the id field (format: "195500284446:en-US")
  const rawId = props.id || item.id;
  const storeId = rawId ? rawId.split(':')[0] : `${lat},${lng}`;

  return {
    id: storeId,
    name: props.shortDescription || props.addressLine1 || "McDonald's",
    address: props.addressLine1 || props.address,
    city: props.addressLine3 || props.city,
    state: props.subDivision || props.state,
    zip: props.postcode || props.zip || props.postalCode,
    phone: props.telephone || props.phone,
    latitude: parseFloat(lat),
    longitude: parseFloat(lng),
  };
}

function generateGridPoints() {
  const points = [];
  for (let lat = US_BOUNDS.minLat; lat <= US_BOUNDS.maxLat; lat += GRID_STEP_LAT) {
    for (let lng = US_BOUNDS.minLng; lng <= US_BOUNDS.maxLng; lng += GRID_STEP_LNG) {
      points.push({ lat, lng });
    }
  }
  return points;
}

function escapeCsvField(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function main() {
  console.log("Fetching McDonald's locations across the US...\n");

  const gridPoints = generateGridPoints();
  console.log(`Generated ${gridPoints.length} grid points to query\n`);

  const allLocations = new Map(); // Use Map to dedupe by ID/coordinates
  let queriesCompleted = 0;

  for (const point of gridPoints) {
    queriesCompleted++;
    process.stdout.write(`\rQuerying ${queriesCompleted}/${gridPoints.length} (${allLocations.size} unique locations)...`);

    try {
      const results = await fetchWithRetry(point.lat, point.lng);

      for (const item of results) {
        const loc = parseLocation(item);
        if (!loc) continue;

        // Validate US coordinates
        if (loc.latitude < 24 || loc.latitude > 50) continue;
        if (loc.longitude < -125 || loc.longitude > -66) continue;

        // Use ID or coordinates as dedup key
        const key = loc.id || `${loc.latitude.toFixed(5)},${loc.longitude.toFixed(5)}`;
        if (!allLocations.has(key)) {
          allLocations.set(key, loc);
        }
      }

      await sleep(DELAY_BETWEEN_REQUESTS_MS);
    } catch (error) {
      console.error(`\nError at (${point.lat.toFixed(2)}, ${point.lng.toFixed(2)}): ${error.message}`);
    }
  }

  console.log(`\n\nFound ${allLocations.size} unique McDonald's locations\n`);

  if (allLocations.size === 0) {
    console.error('No locations found. The API may have changed or be unavailable.');
    process.exit(1);
  }

  // Write CSV
  const outputPath = path.resolve(__dirname, '../poi_data/mcdonalds.csv');
  const headers = ['longitude', 'latitude', 'name', 'address', 'city', 'state', 'zip', 'phone'];

  const rows = [headers.join(',')];
  for (const loc of allLocations.values()) {
    rows.push([
      escapeCsvField(loc.longitude),
      escapeCsvField(loc.latitude),
      escapeCsvField(loc.name),
      escapeCsvField(loc.address),
      escapeCsvField(loc.city),
      escapeCsvField(loc.state),
      escapeCsvField(loc.zip),
      escapeCsvField(loc.phone),
    ].join(','));
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, rows.join('\n'), 'utf8');

  console.log(`Wrote ${allLocations.size} locations to ${outputPath}`);
}

main().catch(console.error);
