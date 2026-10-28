export const GOAL_DEFS = [
  { id: 'street-walk', name: 'Kuttikkattur Street Walk', detail: 'Travel farther through the Malabar streets.', stat: 'distance', target: 1000, step: 500, reward: 25 },
  { id: 'kitab-journey', name: 'Carry the Kitab', detail: 'Reach a new distance in a single run.', stat: 'runDistance', target: 400, step: 200, reward: 30 },
  { id: 'arabic-letters', name: 'Arabic-Letter Coins', detail: 'Gather glowing Arabic-letter coins.', stat: 'coins', target: 30, step: 20, reward: 25 },
  { id: 'market-crossing', name: 'Market Crossing', detail: 'Slip past busy carts and traffic.', stat: 'nearMisses', target: 10, step: 5, reward: 35 },
  { id: 'bazaar-voucher', name: 'Bazaar Errand', detail: 'Find a voucher along the road.', stat: 'vouchers', target: 1, step: 1, reward: 45 },
];

function blankGoals() {
  return Object.fromEntries(GOAL_DEFS.map(({ id }) => [id, { level: 1, progress: 0 }]));
}

export function defaultGoalsSave() {
  return { version: 1, goals: blankGoals() };
}

export function isValidGoalsSave(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 1 || !data.goals || typeof data.goals !== 'object' || Array.isArray(data.goals)) return false;
  const ids = GOAL_DEFS.map(({ id }) => id);
  if (Object.keys(data.goals).length !== ids.length) return false;
  return ids.every((id) => {
    const state = data.goals[id];
    return state && typeof state === 'object' && !Array.isArray(state) &&
      Number.isInteger(state.level) && state.level >= 1 && state.level <= 1_000_000 &&
      typeof state.progress === 'number' && Number.isFinite(state.progress) && state.progress >= 0 && state.progress <= 1_000_000_000;
  });
}

export class Goals {
  constructor() {
    this.reset();
  }

  get(id) {
    const definition = GOAL_DEFS.find((entry) => entry.id === id);
    const state = this.states[id];
    if (!definition || !state) return null;
    return {
      ...definition,
      level: state.level,
      progress: state.progress,
      target: definition.target + (state.level - 1) * definition.step,
      reward: definition.reward + (state.level - 1) * 10,
    };
  }

  list() {
    return GOAL_DEFS.map(({ id }) => this.get(id));
  }

  update(stats = {}) {
    let changed = false;
    for (const definition of GOAL_DEFS) {
      const value = Number(stats[definition.stat]) || 0;
      if (value <= 0) continue;
      const state = this.states[definition.id];
      const next = definition.stat === 'runDistance'
        ? Math.max(state.progress, value)
        : state.progress + value;
      if (next !== state.progress) {
        state.progress = next;
        changed = true;
      }
    }
    return changed;
  }

  claim(id) {
    const goal = this.get(id);
    if (!goal || goal.progress < goal.target) return 0;
    const state = this.states[id];
    state.level += 1;
    state.progress = 0;
    return goal.reward;
  }

  serialize() {
    return { version: 1, goals: Object.fromEntries(Object.entries(this.states).map(([id, state]) => [id, { ...state }])) };
  }

  load(data) {
    this.reset();
    if (isValidGoalsSave(data)) {
      this.states = Object.fromEntries(Object.entries(data.goals).map(([id, state]) => [id, { ...state }]));
    }
  }

  reset() {
    this.states = blankGoals();
  }
}
