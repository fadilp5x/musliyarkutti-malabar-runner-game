// CollisionSystem.js — PURE helpers (no three, no DOM). Unit-tested in node.
// Shared lane constant: every workstream imports LANES from here.

// Lane x-positions (metres). Lane index 0|1|2.
export const LANES = [-2.4, 0, 2.4];

/**
 * Axis-aligned bounding-box overlap test.
 * Boxes: { x0, x1, y0, y1, z0, z1 }. Touching edges do NOT count as overlap.
 */
export function aabbOverlap(a, b) {
  return (
    a.x0 < b.x1 && a.x1 > b.x0 &&
    a.y0 < b.y1 && a.y1 > b.y0 &&
    a.z0 < b.z1 && a.z1 > b.z0
  );
}

/**
 * Row fairness check for obstacle generation.
 * cells: array of exactly 3 lane kinds, each 'free'|'jump'|'slide'|'block'.
 * A row is fair when at least one lane is 'free', OR all three lanes are
 * 'jump' (jumpable), OR all three lanes are 'slide' (slidable).
 */
export function rowIsFair(cells) {
  if (!Array.isArray(cells) || cells.length !== 3) return false;
  if (cells.includes('free')) return true;
  if (cells.every((c) => c === 'jump')) return true;
  if (cells.every((c) => c === 'slide')) return true;
  return false;
}
