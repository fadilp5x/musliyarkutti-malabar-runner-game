import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PlayerAvatar } from '../src/game/PlayerAvatar.js';
import { AVATAR_SKIN_IDS, getAvatarSkin } from '../src/game/AvatarSkins.js';
import { Wardrobe } from '../src/game/Wardrobe.js';

describe('procedural wardrobe', () => {
  it('recolours only the jubba, thalappav, and lungi hem border', () => {
    const avatar = new PlayerAvatar(new THREE.Scene());
    const originalLungi = avatar.parts.lungiMesh.material.color.getHex();
    const skin = getAvatarSkin('laterite');

    avatar.setSkin('laterite');

    expect(avatar.skinId).toBe('laterite');
    expect(avatar.skinMaterials.jubba.color.getHex()).toBe(skin.colors.jubba);
    expect(avatar.skinMaterials.thalappav.color.getHex()).toBe(skin.colors.thalappav);
    expect(avatar.skinMaterials.tail.color.getHex()).toBe(skin.colors.thalappav);
    expect(avatar.skinMaterials.border.color.getHex()).toBe(skin.colors.border);
    expect(avatar.parts.lungiMesh.material.color.getHex()).toBe(originalLungi);
    expect(avatar.parts.lungiMesh.material.color.getHex()).toBe(0xf5f1e6);
  });

  it('offers only fixed palette skins and rejects unowned selections', () => {
    const wardrobe = new Wardrobe();
    expect(AVATAR_SKIN_IDS).toEqual(['classic', 'monsoon', 'laterite', 'coastal', 'festival']);
    expect(wardrobe.select('custom-upload')).toBe(false);
    expect(wardrobe.buy('custom-upload', 100000)).toBe(false);
  });
});
