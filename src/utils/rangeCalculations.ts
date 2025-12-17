/**
 * Range and distance calculations for EV trip planning
 */

/**
 * Calculate effective distance accounting for elevation gain
 * Rule: 1% range penalty per 100ft of elevation gain (from planning doc)
 *
 * @param distanceMiles Actual driving distance in miles
 * @param elevationGainFt Net elevation gain in feet
 * @returns Effective distance in miles (accounts for extra energy needed for climbing)
 */
export function calculateEffectiveDistance(
  distanceMiles: number,
  elevationGainFt: number
): number {
  if (elevationGainFt <= 0) {
    // Downhill or flat - use actual distance (could give bonus for regen, but keep conservative)
    return distanceMiles;
  }

  // 1% penalty per 100ft gain
  const elevationPenalty = (elevationGainFt / 100) * 0.01;
  return distanceMiles * (1 + elevationPenalty);
}

/**
 * Calculate estimated arrival battery percentage
 *
 * @param currentBatteryPercent Current battery percentage (0-100)
 * @param distanceMiles Distance to travel in miles
 * @param vehicleRangeMiles Vehicle's total range in miles
 * @param elevationGainFt Optional elevation gain for the segment
 * @returns Estimated battery percentage on arrival
 */
export function calculateArrivalBattery(
  currentBatteryPercent: number,
  distanceMiles: number,
  vehicleRangeMiles: number,
  elevationGainFt: number = 0
): number {
  const effectiveDistance = calculateEffectiveDistance(distanceMiles, elevationGainFt);
  const energyUsedPercent = (effectiveDistance / vehicleRangeMiles) * 100;
  return Math.max(0, currentBatteryPercent - energyUsedPercent);
}

/**
 * Determine risk level for a route segment
 *
 * @param distanceMiles Distance in miles
 * @param vehicleRangeMiles Vehicle's total range in miles
 * @param elevationGainFt Optional elevation gain
 * @returns Risk level: 'safe' (<180mi), 'tight' (180-200mi), 'risky' (>200mi)
 */
export function getSegmentRiskLevel(
  distanceMiles: number,
  vehicleRangeMiles: number,
  elevationGainFt: number = 0
): 'safe' | 'tight' | 'risky' {
  const effectiveDistance = calculateEffectiveDistance(distanceMiles, elevationGainFt);

  // Based on planning doc: tight at 180-200, risky above 200
  // Normalize to user's vehicle range
  const rangeRatio = effectiveDistance / vehicleRangeMiles;

  if (rangeRatio >= 0.93) return 'risky'; // >93% of range
  if (rangeRatio >= 0.83) return 'tight'; // 83-93% of range
  return 'safe';
}

/**
 * Convert miles to kilometers
 */
export function milesToKm(miles: number): number {
  return miles * 1.60934;
}

/**
 * Convert kilometers to miles
 */
export function kmToMiles(km: number): number {
  return km / 1.60934;
}
