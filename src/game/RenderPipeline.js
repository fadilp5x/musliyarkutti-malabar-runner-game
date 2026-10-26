// RenderPipeline.js — renderer output chain for the graphics overhaul.
//
// Two render paths:
//   bloom OFF (Low/Medium): direct renderer.render — identical cost to before,
//     ACES tone mapping + sRGB output applied by the renderer itself.
//   bloom ON (High): EffectComposer → RenderPass → UnrealBloomPass →
//     OutputPass. OutputPass applies the renderer's toneMapping/colorSpace,
//     so both paths look the same apart from the bloom itself.
//
// Bloom is deliberately restrained: threshold HIGH (0.85), strength LOW (0.3),
// radius 0.4. In linear HDR pre-tonemapping space only genuinely emissive
// surfaces (emissiveIntensity > ~1: gate lamps, glow strips, the sun) cross
// the threshold. UI is DOM-based, so the composer never touches it.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const BLOOM_STRENGTH = 0.3;
const BLOOM_RADIUS = 0.4;
const BLOOM_THRESHOLD = 0.85;

export class RenderPipeline {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this._bloomOn = false;

    const size = new THREE.Vector2();
    renderer.getDrawingBufferSize(size);

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloomPass = new UnrealBloomPass(size, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    this.bloomPass.enabled = false;
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
  }

  /** Enable/disable the bloom pass. Composer is only used while enabled. */
  setBloom(on) {
    this._bloomOn = on === true;
    if (this.bloomPass) this.bloomPass.enabled = this._bloomOn;
  }

  get bloomOn() {
    return this._bloomOn;
  }

  setSize(w, h) {
    if (this.composer) this.composer.setSize(w, h);
  }

  setPixelRatio(pr) {
    if (this.composer) this.composer.setPixelRatio(pr);
  }

  render() {
    if (this._bloomOn && this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Test hook: current bloom params. */
  bloomParams() {
    return {
      strength: this.bloomPass.strength,
      radius: this.bloomPass.radius,
      threshold: this.bloomPass.threshold,
      enabled: this.bloomPass.enabled,
    };
  }
}
