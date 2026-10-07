export type PlacementIssueCode =
  | 'outside-room'
  | 'wall-collision'
  | 'fixture-collision'
  | 'furniture-collision'
  | 'door-swing'
  | 'door-clearance'
  | 'window-blocked'
  | 'front-clearance';

/**
 * All spatial rules live here and are passed explicitly to the engine — nothing else in
 * the codebase hard-codes a clearance.
 */
export interface PlacementConstraints {
  /** Minimum free walkway in front of items that need access (sofas, beds, desks…), metres. */
  walkingClearance: number;
  /** Free depth to keep on both sides of every door/opening, metres. */
  doorClearance: number;
  /** Depth in front of a window that tall furniture should not block, metres. */
  windowClearance: number;
  /** Treat the area swept by hinged door leaves as occupied. */
  respectDoorSwings: boolean;
  /** Gap left between a wall and the back of wall-placed items by the fitting engine, metres. */
  wallGap: number;
  /** Penetration tolerated before two shapes count as colliding, metres. */
  tolerance: number;
  /** Issues that stop an interactive move outright (others are shown but allowed). */
  blocking: PlacementIssueCode[];
}

export const DEFAULT_CONSTRAINTS: Readonly<PlacementConstraints> = Object.freeze({
  walkingClearance: 0.6,
  doorClearance: 0.8,
  windowClearance: 0.3,
  respectDoorSwings: true,
  wallGap: 0.02,
  tolerance: 0.005,
  blocking: ['outside-room', 'wall-collision', 'fixture-collision'] as PlacementIssueCode[],
});

/** Severity of each issue: hard = physically impossible / blocks function; soft = poor layout. */
export const ISSUE_SEVERITY: Record<PlacementIssueCode, 'hard' | 'soft'> = {
  'outside-room': 'hard',
  'wall-collision': 'hard',
  'fixture-collision': 'hard',
  'furniture-collision': 'hard',
  'door-swing': 'hard',
  'door-clearance': 'soft',
  'window-blocked': 'soft',
  'front-clearance': 'soft',
};
