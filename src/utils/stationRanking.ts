import type { Station } from '../types';
import { FACILITY_RANKINGS } from '../types';

/**
 * Calculate a composite rank score for a station
 * Lower score = better station
 *
 * Factors:
 * 1. Charger speed (350kW >> 150kW)
 * 2. Charger count (more = better)
 * 3. Facility type (Walmart/Target > Travel Center > Car Dealer)
 */
export function calculateStationRankScore(station: Station): number {
  // Speed score: lower is better
  // 350kW = 1, 150kW = 2.3
  const speedScore = station.max_power_kw
    ? 350 / station.max_power_kw
    : 2.3; // Default to ~150kW equivalent

  // Count score: lower is better
  // 10 chargers = 0.1, 2 chargers = 0.5
  const countScore = 1 / Math.max(station.ev_dc_fast_num, 1);

  // Facility score: from rankings (1-8)
  const facilityScore =
    FACILITY_RANKINGS[station.facility_type] ||
    FACILITY_RANKINGS['OTHER'];

  // Weighted combination (speed matters most, then count, then facility)
  return speedScore * 3 + countScore * 2 + facilityScore * 1;
}

/**
 * Sort stations by rank (best first)
 */
export function sortStationsByRank(stations: Station[]): Station[] {
  return [...stations].sort((a, b) => {
    const scoreA = a.rank_score ?? calculateStationRankScore(a);
    const scoreB = b.rank_score ?? calculateStationRankScore(b);
    return scoreA - scoreB;
  });
}

/**
 * Get human-readable description of station quality
 */
export function getStationQualityLabel(station: Station): string {
  const score = station.rank_score ?? calculateStationRankScore(station);

  if (score < 5) return 'Excellent';
  if (score < 7) return 'Good';
  if (score < 9) return 'Fair';
  return 'Basic';
}

/**
 * Get charger speed label
 */
export function getChargerSpeedLabel(powerKw: number | undefined): string {
  if (!powerKw) return 'Unknown';
  if (powerKw >= 300) return 'Ultra-Fast (350kW)';
  if (powerKw >= 150) return 'Fast (150kW)';
  return 'Standard';
}

/**
 * Get facility type display name
 */
export function getFacilityDisplayName(facilityType: string): string {
  const displayNames: Record<string, string> = {
    WALMART: 'Walmart',
    TARGET: 'Target',
    COSTCO: 'Costco',
    TRAVEL_CENTER: 'Travel Center',
    TRUCK_STOP: 'Truck Stop',
    REST_AREA: 'Rest Area',
    GROCERY: 'Grocery Store',
    SHOPPING_CENTER: 'Shopping Center',
    MALL: 'Mall',
    GAS_STATION: 'Gas Station',
    CONVENIENCE_STORE: 'Convenience Store',
    HOTEL: 'Hotel',
    CAR_DEALER: 'Car Dealer',
    OTHER: 'Other',
  };

  return displayNames[facilityType] || facilityType;
}
