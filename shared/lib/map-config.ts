/**
 * Global Map Configuration Constants
 * 
 * To change the maximum zoom multiplier across both CAD Map and User Map in a single change:
 * Change MAX_MAP_ZOOM below (e.g. 40 means 40x zoom, 20 means 20x zoom).
 */
export const MAX_MAP_ZOOM = 400.0;
export const MIN_MAP_ZOOM = 0.5;
export const DEFAULT_MAP_ZOOM = 80.0;

/**
 * Removes level number and level name from staircase and elevator names.
 * e.g. "Main Staircase A (Floor 3)" -> "Main Staircase A"
 *      "Main Staircase A (Ground Floor)" -> "Main Staircase A"
 *      "Elevator 1 (Level 2)" -> "Elevator 1"
 *      "Stairs - Floor 1" -> "Stairs"
 */
export function cleanStairLiftDisplayName(name: string): string {
  if (!name) return "";
  return name
    .replace(/\s*\((floor|level|ground|gnd|basement|l\d+|\d+)[^)]*\)/gi, "")
    .replace(/\s*[-–—:]\s*(floor|level|ground|gnd|basement|l\d+|\d+).*$/gi, "")
    .replace(/\s+(floor|level)\s*\d+$/gi, "")
    .trim();
}
