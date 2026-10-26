import * as THREE from 'three';

// AssetLoader — loads SVG files as THREE textures.
// Pipeline: fetch SVG text → inject explicit width/height (from viewBox) →
// blob URL → TextureLoader → SRGBColorSpace texture. Results are cached.
// In dev and build, SVGs are served from `public/svg/` (copied from assets/svg/).

const SVG_FILES = [
  'obstacle_low_barrier',
  'obstacle_puddle',
  'obstacle_overhead_gate',
  'obstacle_handcart',
  'obstacle_bus',
  'obstacle_auto_rickshaw',
  'obstacle_smartphone_portal',
  'shaytan_disappear',
  'shaytan_warning',
  'location_library_exit',
  'character_reference',
];

export class AssetLoader {
  constructor() {
    this._cache = new Map();
  }

  _resolve(path) {
    if (/^(https?:|blob:|data:|\/)/.test(path)) return path;
    return `${import.meta.env.BASE_URL}${path}`;
  }

  async loadSVGTexture(path, pxW, pxH) {
    if (this._cache.has(path)) return this._cache.get(path);

    const url = this._resolve(path);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`AssetLoader: fetch failed for ${url} (${res.status})`);
    let text = await res.text();

    // Determine raster size: explicit args win, else fall back to viewBox dims.
    let w = pxW;
    let h = pxH;
    const vbMatch = text.match(/viewBox="([^"]+)"/);
    if (vbMatch) {
      const parts = vbMatch[1].trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
        if (!w && !h) {
          w = Math.round(parts[2]);
          h = Math.round(parts[3]);
        } else if (!h) {
          h = Math.max(1, Math.round((w * parts[3]) / parts[2]));
        } else if (!w) {
          w = Math.max(1, Math.round((h * parts[2]) / parts[3]));
        }
      }
    }
    w = w || 512;
    h = h || 512;

    // Inject explicit width/height so the SVG rasterizes at a real size
    // (some SVGs ship with width="100%"/height="100%", which rasterizes tiny).
    text = text.replace(/<svg([\s\S]*?)>/, (m, attrs) => {
      const cleaned = attrs.replace(/\s+width="[^"]*"/, '').replace(/\s+height="[^"]*"/, '');
      return `<svg${cleaned} width="${w}" height="${h}">`;
    });

    const blob = new Blob([text], { type: 'image/svg+xml;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    try {
      const tex = await new THREE.TextureLoader().loadAsync(blobUrl);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      this._cache.set(path, tex);
      return tex;
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  // Loads every game SVG; returns { baseName: THREE.Texture }.
  // A single failure resolves to null for that key instead of rejecting.
  async loadAll() {
    const out = {};
    await Promise.all(
      SVG_FILES.map(async (name) => {
        try {
          out[name] = await this.loadSVGTexture(`svg/${name}.svg`, 512);
        } catch (err) {
          console.warn(`[assets] failed to load ${name}.svg:`, err);
          out[name] = null;
        }
      })
    );
    return out;
  }
}
