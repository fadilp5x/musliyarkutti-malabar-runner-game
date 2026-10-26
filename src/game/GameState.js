// Game states for MUSLIYARKUTTI: MALABAR RUNNER (see CONTRACTS.md).
// Oct 14, 2026: cinematic library opening states added. The old SHAYTAN /
// CHASE states are superseded by the finer-grained cinematic states but kept
// for backward compatibility with save data and UI mappings.
export const STATES = {
  LOADING: 'LOADING',
  LIBRARY: 'LIBRARY',       // title screen (tap to begin), mascot visible
  // Cinematic opening sequence (in order):
  LIBRARY_INTRO: 'LIBRARY_INTRO',     // camera glides, avatar walks searching
  LIBRARY_SEARCH: 'LIBRARY_SEARCH',   // avatar finds shelf, reaches for book
  SHAYTAN_REVEAL: 'SHAYTAN_REVEAL',   // lights dim, Shaytan 3D appears, rushes
  RECITATION: 'RECITATION',           // audhu-billahi plays, avatar faces threat
  LIBRARY_ESCAPE: 'LIBRARY_ESCAPE',   // avatar runs through shelves to exit
  LIBRARY_EXIT: 'LIBRARY_EXIT',       // through doorway into courtyard
  ACADEMY_GATE: 'ACADEMY_GATE',       // courtyard → gate → street transition
  RUNNING: 'RUNNING',                 // endless runner (was RUNNER)
  // Legacy (kept for compatibility):
  SHAYTAN: 'SHAYTAN',
  CHASE: 'CHASE',
  RUNNER: 'RUNNER',
  TUTORIAL: 'TUTORIAL', // first-time guided tutorial (uses runner mechanics)
  PAUSED: 'PAUSED',
  GAMEOVER: 'GAMEOVER',
};
