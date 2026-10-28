export const AVATAR_SKINS = [
  { id: 'classic', name: 'Malabar Classic', cost: 0, colors: { jubba: 0xfaf7f0, thalappav: 0xffffff, border: 0x697682, borderDark: 0x4d5761 } },
  { id: 'monsoon', name: 'Monsoon Green', cost: 250, colors: { jubba: 0x176b5b, thalappav: 0xe1f2dc, border: 0xd9a441, borderDark: 0x8b6914 } },
  { id: 'laterite', name: 'Laterite Road', cost: 500, colors: { jubba: 0xa53b2c, thalappav: 0xffead0, border: 0xe6a13a, borderDark: 0x793b26 } },
  { id: 'coastal', name: 'Coastal Blue', cost: 750, colors: { jubba: 0x1767a4, thalappav: 0xf4f6ed, border: 0x4ba58b, borderDark: 0x28604f } },
  { id: 'festival', name: 'Utsavam Gold', cost: 1000, colors: { jubba: 0x246044, thalappav: 0xe8bd55, border: 0xb83025, borderDark: 0x76241f } },
];

export const AVATAR_SKIN_IDS = AVATAR_SKINS.map((skin) => skin.id);
export const DEFAULT_SKIN_ID = AVATAR_SKINS[0].id;

export function getAvatarSkin(id) {
  return AVATAR_SKINS.find((skin) => skin.id === id) || AVATAR_SKINS[0];
}
