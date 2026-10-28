import * as THREE from 'three';
import { PlayerAvatar } from './PlayerAvatar.js';
import './pose-test.css';

const STEP = 1 / 120;
const MAX_STEPS = 5;
const POSES = ['run', 'jump', 'slide', 'glide', 'jetpack', 'fall', 'stumble'];
const SPEEDS = [10, 20, 28];

const canvas = document.querySelector('#pose-canvas');
const title = document.querySelector('#pose-title');
const poseButtons = document.querySelector('#pose-buttons');
const speedButtons = document.querySelector('#speed-buttons');
const cycleButton = document.querySelector('#pose-cycle');
const details = document.querySelector('#pose-details');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#101a2f');
scene.fog = new THREE.Fog('#101a2f', 8, 20);

const camera = new THREE.PerspectiveCamera(37, 1, 0.05, 60);
camera.position.set(0, 1.12, 5.1);
camera.lookAt(0, 0.92, 0);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

scene.add(new THREE.HemisphereLight(0xe5f2ff, 0x314057, 2.0));
const keyLight = new THREE.DirectionalLight(0xffedcf, 3.0);
keyLight.position.set(-3, 6, 4);
keyLight.castShadow = true;
scene.add(keyLight);
const fill = new THREE.DirectionalLight(0x77aaff, 1.1);
fill.position.set(4, 3, 2);
scene.add(fill);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.MeshStandardMaterial({ color: 0x202d43, roughness: 0.9 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.015;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(30, 30, 0x52627e, 0x35435b);
grid.position.y = 0.002;
scene.add(grid);

const avatar = new PlayerAvatar(scene);
avatar.group.position.set(0, 0, 0);
avatar.runPhase = 0;

let pose = 'run';
let speed = 10;
let cycling = false;
let cycleElapsed = 0;
let poseIndex = 0;
let accumulator = 0;
let lastFrame = 0;
avatar.setAnim(pose);

function makeButton(label, selected, onClick, group) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('aria-pressed', String(selected));
  button.addEventListener('click', onClick);
  group.append(button);
  return button;
}

function renderControls() {
  title.textContent = `${pose[0].toUpperCase()}${pose.slice(1)} · ${speed} m/s`;
  poseButtons.replaceChildren();
  for (const candidate of POSES) {
    makeButton(candidate, candidate === pose, () => {
      pose = candidate;
      poseIndex = POSES.indexOf(pose);
      cycling = false;
      cycleButton.setAttribute('aria-pressed', 'false');
      avatar.setAnim(pose);
      renderControls();
    }, poseButtons);
  }
  speedButtons.replaceChildren();
  for (const candidate of SPEEDS) {
    makeButton(`${candidate} m/s`, candidate === speed, () => {
      speed = candidate;
      renderControls();
    }, speedButtons);
  }
  cycleButton.setAttribute('aria-pressed', String(cycling));
}

cycleButton.addEventListener('click', () => {
  cycling = !cycling;
  cycleElapsed = 0;
  cycleButton.setAttribute('aria-pressed', String(cycling));
});
renderControls();

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function frame(now) {
  requestAnimationFrame(frame);
  if (!lastFrame) lastFrame = now;
  let elapsed = Math.min((now - lastFrame) / 1000, 0.25);
  lastFrame = now;
  accumulator += elapsed;
  let steps = 0;
  while (accumulator >= STEP && steps < MAX_STEPS) {
    avatar.runRate = speed / 8;
    avatar.runPhase += STEP * 14 * (speed / 8);
    avatar.update(STEP);
    accumulator -= STEP;
    steps += 1;
    cycleElapsed += STEP;
    if (cycling && cycleElapsed >= 1.2) {
      cycleElapsed = 0;
      poseIndex = (poseIndex + 1) % POSES.length;
      pose = POSES[poseIndex];
      avatar.setAnim(pose);
      renderControls();
    }
  }
  if (steps === MAX_STEPS) accumulator = 0;
  details.textContent = `Fixed-step preview · 120 Hz · stride ${speed} m/s · ${pose}`;
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
