import { AVATAR_SKIN_IDS, AVATAR_SKINS, DEFAULT_SKIN_ID } from './AvatarSkins.js';

export function defaultWardrobeSave() {
  return { owned: [DEFAULT_SKIN_ID], selected: DEFAULT_SKIN_ID };
}

export function isValidWardrobeSave(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.owned)) return false;
  if (!data.owned.every((id) => typeof id === 'string' && AVATAR_SKIN_IDS.includes(id))) return false;
  if (!data.owned.includes(DEFAULT_SKIN_ID) || new Set(data.owned).size !== data.owned.length) return false;
  return typeof data.selected === 'string' && data.owned.includes(data.selected);
}

export class Wardrobe {
  constructor() {
    this.reset();
  }

  get skins() {
    return AVATAR_SKINS;
  }

  buy(id, coinBalance) {
    const skin = AVATAR_SKINS.find((entry) => entry.id === id);
    if (!skin || this.owned.includes(id) || typeof coinBalance !== 'number' || coinBalance < skin.cost) return false;
    this.owned.push(id);
    return true;
  }

  select(id) {
    if (!this.owned.includes(id)) return false;
    this.selected = id;
    return true;
  }

  serialize() {
    return { owned: [...this.owned], selected: this.selected };
  }

  load(data) {
    this.reset();
    if (!isValidWardrobeSave(data)) return;
    this.owned = [...data.owned];
    this.selected = data.selected;
  }

  reset() {
    this.owned = [DEFAULT_SKIN_ID];
    this.selected = DEFAULT_SKIN_ID;
  }
}
