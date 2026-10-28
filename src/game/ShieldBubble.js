import * as THREE from 'three';

const GOLD = 0xffc42e;

function rimMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0.3 }, uMotion: { value: 1 } },
    vertexShader: `varying vec3 vNormal; varying vec3 vView; varying vec3 vPosition; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); vNormal=normalize(normalMatrix*normal); vView=normalize(-mv.xyz); vPosition=position; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform float uTime; uniform float uOpacity; uniform float uMotion; varying vec3 vNormal; varying vec3 vView; varying vec3 vPosition; void main(){ float rim=pow(1.0-max(dot(normalize(vNormal),normalize(vView)),0.0),2.25); float band=0.5+0.5*sin(vPosition.y*9.0-uTime*3.2*uMotion); float shine=smoothstep(0.78,1.0,band)*0.28*uMotion; vec3 gold=vec3(1.0,0.68,0.12); vec3 whiteGold=vec3(1.0,0.94,0.62); gl_FragColor=vec4(mix(gold,whiteGold,shine),clamp(rim*0.78+shine,uOpacity*0.28,0.78)*uOpacity); }`,
  });
}

export class ShieldBubble {
  constructor(parent, { quality = 'high', reducedMotion = false, scale = 1, particleCount = 6 } = {}) {
    this.group = new THREE.Group();
    this.group.position.set(0, 0.92, 0);
    this.group.scale.setScalar(scale);
    this.group.visible = false;
    parent.add(this.group);
    this.reducedMotion = reducedMotion;
    this.quality = quality;
    this.particleCount = particleCount;
    this.mode = 'off';
    this.elapsed = 0;
    this.remaining = 0;
    this.clock = 0;
    this._baseScale = new THREE.Vector3(0.78, 1.04, 0.56);
    this._rimMaterial = rimMaterial();
    this._lowMaterial = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), this._rimMaterial);
    this.sphere.scale.copy(this._baseScale);
    this.group.add(this.sphere);
    const fillMat = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.095, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide });
    this.fill = new THREE.Mesh(this.sphere.geometry, fillMat);
    this.fill.scale.copy(this._baseScale).multiplyScalar(0.99);
    this.group.add(this.fill);
    this.activationRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 32), new THREE.MeshBasicMaterial({ color: 0xfff0ad, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    this.activationRing.rotation.x = -Math.PI / 2;
    this.activationRing.position.y = -0.8;
    this.group.add(this.activationRing);
    this.ripple = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 32), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    this.ripple.position.set(0, 0, 0.04);
    this.group.add(this.ripple);
    this.particles = [];
    this.setQuality(quality);
  }

  setQuality(quality) {
    this.quality = quality;
    const low = quality === 'low';
    this.sphere.material = low ? this._lowMaterial : this._rimMaterial;
    this._rimMaterial.uniforms.uMotion.value = this.reducedMotion ? 0 : 1;
    this.fill.visible = !low;
    if (low || this.reducedMotion) this._removeParticles();
    else this._ensureParticles();
    for (const particle of this.particles) particle.visible = this.mode !== 'off';
  }

  _ensureParticles() {
    if (this.particles.length || this.particleCount <= 0) return;
    for (let i = 0; i < this.particleCount; i++) {
      const particle = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xfff5ca : GOLD, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      particle.userData.phase = i / this.particleCount * Math.PI * 2;
      this.group.add(particle);
      this.particles.push(particle);
    }
  }

  _removeParticles() {
    for (const particle of this.particles) {
      this.group.remove(particle);
      particle.geometry.dispose();
      particle.material.dispose();
    }
    this.particles.length = 0;
  }

  setReducedMotion(reduced) {
    this.reducedMotion = Boolean(reduced);
    if (this.reducedMotion && this.mode === 'in') {
      this.mode = 'on';
      this.sphere.scale.copy(this._baseScale);
      this.fill.scale.copy(this._baseScale).multiplyScalar(0.99);
    }
    this.setQuality(this.quality);
  }

  activate() {
    this.mode = this.reducedMotion ? 'on' : 'in';
    this.elapsed = 0;
    this.remaining = 15;
    this.group.visible = true;
    this.group.scale.setScalar(1);
    this.sphere.scale.copy(this.reducedMotion ? this._baseScale : new THREE.Vector3());
    this.fill.scale.copy(this.sphere.scale).multiplyScalar(0.99);
    this.activationRing.scale.setScalar(0.12);
    this.activationRing.material.opacity = this.reducedMotion ? 0 : 0.9;
    this.activationRing.visible = !this.reducedMotion;
    this.ripple.material.opacity = 0;
    this.ripple.visible = false;
    this.setQuality(this.quality);
  }

  setActive(active) {
    if (active) {
      if (this.mode === 'off' || this.mode === 'out') this.activate();
    } else if (this.mode === 'in' || this.mode === 'on') this.deactivate();
  }

  absorb() {
    if (this.reducedMotion) { this._hide(); return; }
    this.mode = 'absorb';
    this.elapsed = 0;
    this.group.visible = true;
    this.ripple.scale.setScalar(0.35);
    this.ripple.material.opacity = this.reducedMotion ? 0 : 0.9;
    this.ripple.visible = !this.reducedMotion;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const a = (i / this.particles.length) * Math.PI * 2;
      p.position.set(Math.cos(a) * 0.45, Math.sin(a) * 0.62, 0.05);
      p.material.opacity = this.reducedMotion || this.quality === 'low' ? 0 : 1;
    }
  }

  reset() { this._hide(); }

  deactivate() {
    if (this.mode === 'absorb') return;
    if (this.reducedMotion) { this._hide(); return; }
    if (this.mode !== 'off') {
      this.mode = 'out';
      this.elapsed = 0;
    }
  }

  update(dt, remaining = null) {
    this.clock += dt;
    if (Number.isFinite(remaining)) this.remaining = remaining;
    else if (this.mode === 'on') this.remaining = Math.max(0, this.remaining - dt);
    if (this.mode === 'off') return;
    this.elapsed += dt;
    const mat = this.sphere.material;
    if (mat.uniforms) mat.uniforms.uTime.value = this.reducedMotion ? 0 : this.clock;
    if (this.mode === 'in') {
      const t = Math.min(1, this.elapsed / 0.25);
      const eased = 1 - (1 - t) ** 3;
      this.sphere.scale.copy(this._baseScale).multiplyScalar(eased);
      this.fill.scale.copy(this.sphere.scale).multiplyScalar(0.99);
      this.activationRing.scale.setScalar(0.12 + t * 1.7);
      this.activationRing.material.opacity = (1 - t) * (this.reducedMotion ? 0 : 0.9);
      if (t >= 1) this.mode = 'on';
    } else if (this.mode === 'on') {
      const flicker = !this.reducedMotion && this.remaining <= 3 && Math.sin(this.clock * 32) > 0.35 ? 0.35 : 1;
      this._setSphereOpacity(0.34 * flicker);
      this.fill.material.opacity = 0.095 * flicker;
      if (!this.reducedMotion && this.quality !== 'low') {
        for (const p of this.particles) {
          const a = p.userData.phase + this.clock * 1.7;
          p.position.set(Math.cos(a) * 0.7, Math.sin(a * 0.8) * 0.88, Math.sin(a) * 0.35);
          p.material.opacity = 0.72;
        }
      }
    } else if (this.mode === 'absorb') {
      const t = Math.min(1, this.elapsed / 0.32);
      this._setSphereOpacity(0.34 * (1 - t));
      this.fill.material.opacity = 0.095 * (1 - t);
      this.ripple.scale.setScalar(0.35 + t * 2.8);
      this.ripple.material.opacity = (1 - t) * (this.reducedMotion ? 0 : 0.9);
      for (const p of this.particles) {
        p.position.multiplyScalar(1 + dt * 5);
        p.material.opacity = (1 - t) * (this.reducedMotion || this.quality === 'low' ? 0 : 1);
      }
      if (t >= 1) this._hide();
    } else if (this.mode === 'out') {
      const t = Math.min(1, this.elapsed / 0.18);
      this._setSphereOpacity(0.34 * (1 - t));
      this.fill.material.opacity = 0.095 * (1 - t);
      if (t >= 1) this._hide();
    }
  }

  _hide() {
    this.mode = 'off';
    this.group.visible = false;
    this.sphere.scale.copy(this._baseScale);
    this.activationRing.material.opacity = 0;
    this.activationRing.visible = false;
    this.ripple.material.opacity = 0;
    this.ripple.visible = false;
    for (const p of this.particles) p.material.opacity = 0;
  }

  _setSphereOpacity(opacity) {
    if (this.sphere.material.uniforms) this.sphere.material.uniforms.uOpacity.value = opacity;
    else this.sphere.material.opacity = opacity;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.group.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry?.dispose();
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose()); else o.material?.dispose();
    });
    this._rimMaterial.dispose();
    this._lowMaterial.dispose();
  }
}

export default ShieldBubble;
