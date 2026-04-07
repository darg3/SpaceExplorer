import * as THREE from 'three';
import { Ship }         from './ship.js';
import { Stars }        from './stars.js';
import { InputHandler } from './input.js';
import { World }        from './world.js';

// ── Renderer ──────────────────────────────────────────────────────────────────
const canvas   = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace   = THREE.SRGBColorSpace;
renderer.toneMapping        = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;

// ── Scene & Camera ────────────────────────────────────────────────────────────
const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  65,
  window.innerWidth / window.innerHeight,
  0.1,
  12000,
);
// Initial position: behind and slightly above ship (ship faces +X)
camera.position.set(-300, 0, 70);
camera.up.set(0, 0, 1);   // ship's local "up" = +Z
camera.lookAt(0, 0, 0);

// ── Lighting ──────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0x1a2a55, 1.2));

const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(120, 250, 300);
scene.add(sun);

const rimLight = new THREE.DirectionalLight(0x4488ff, 0.6);
rimLight.position.set(-200, -80, 100);
scene.add(rimLight);

// ── Skybox (nebula sphere) ────────────────────────────────────────────────────
let skybox = null;

function makeProceduralNebula() {
  const S  = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');

  ctx.fillStyle = '#00000e';
  ctx.fillRect(0, 0, S, S);

  const clouds = [
    { cx: 0.28, cy: 0.42, r: 0.55, c: 'rgba(110, 30, 190, 0.55)'  },
    { cx: 0.72, cy: 0.58, r: 0.50, c: 'rgba(30,  70, 210, 0.50)'  },
    { cx: 0.50, cy: 0.28, r: 0.38, c: 'rgba(200, 70,  35, 0.32)'  },
    { cx: 0.18, cy: 0.75, r: 0.44, c: 'rgba(30, 160, 210, 0.38)'  },
    { cx: 0.82, cy: 0.20, r: 0.32, c: 'rgba(170,  90, 230, 0.42)' },
    { cx: 0.60, cy: 0.80, r: 0.40, c: 'rgba(60,  200, 160, 0.28)' },
    { cx: 0.35, cy: 0.15, r: 0.28, c: 'rgba(230, 140,  40, 0.25)' },
  ];

  clouds.forEach(({ cx, cy, r, c }) => {
    const grd = ctx.createRadialGradient(cx*S, cy*S, 0, cx*S, cy*S, r*S);
    grd.addColorStop(0,   c);
    grd.addColorStop(0.5, c.replace(/[\d.]+\)$/, '0.15)'));
    grd.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, S, S);
  });

  const core = ctx.createRadialGradient(0.5*S, 0.48*S, 0, 0.5*S, 0.48*S, 0.18*S);
  core.addColorStop(0, 'rgba(220, 200, 255, 0.18)');
  core.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, S, S);

  return new THREE.CanvasTexture(cv);
}

function buildSkybox(tex) {
  const geo = new THREE.SphereGeometry(6000, 32, 16);
  const mat = new THREE.MeshBasicMaterial({
    map:       tex,
    side:      THREE.BackSide,
    depthWrite: false,
  });
  skybox = new THREE.Mesh(geo, mat);
  skybox.renderOrder = -1;
  scene.add(skybox);
}

// Try actual file first, then fallback to procedural
new THREE.TextureLoader().load(
  'assets/GSFC_20171208_nebula.jpg',
  tex  => buildSkybox(tex),
  undefined,
  ()   => new THREE.TextureLoader().load(
    'assets/nebula.jpg',
    tex => buildSkybox(tex),
    undefined,
    ()  => buildSkybox(makeProceduralNebula()),
  ),
);

// ── Input ─────────────────────────────────────────────────────────────────────
const input = new InputHandler();

// ── Star Field ────────────────────────────────────────────────────────────────
const stars = new Stars(scene);

// ── World ─────────────────────────────────────────────────────────────────────
const world = new World(scene);

// ── Ship ──────────────────────────────────────────────────────────────────────
const ship = new Ship(scene, input);

// ── Camera ────────────────────────────────────────────────────────────────────

// ── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Hint fade ─────────────────────────────────────────────────────────────────
setTimeout(() => {
  const hint = document.getElementById('hint');
  if (hint) hint.style.opacity = '0';
}, 6000);

// ── Orbit Camera ──────────────────────────────────────────────────────────────
let inspTheta    = Math.PI;       // azimuth: π = behind ship (ship faces +X)
let inspPhi      = Math.PI * 0.38; // elevation from Z (~68° — slightly above horizontal)
let inspRadius   = 320;
let inspDragging = false;
let inspLastX    = 0;
let inspLastY    = 0;

window.addEventListener('mousedown', e => {
  inspDragging = true;
  inspLastX = e.clientX;
  inspLastY = e.clientY;
});

window.addEventListener('mouseup',   () => { inspDragging = false; });
window.addEventListener('mouseleave',() => { inspDragging = false; });

window.addEventListener('mousemove', e => {
  if (!inspDragging) return;
  const dx = e.clientX - inspLastX;
  const dy = e.clientY - inspLastY;
  inspLastX = e.clientX;
  inspLastY = e.clientY;
  inspTheta -= dx * 0.007;
  inspPhi    = THREE.MathUtils.clamp(inspPhi + dy * 0.007, 0.05, Math.PI - 0.05);
});

window.addEventListener('wheel', e => {
  inspRadius = THREE.MathUtils.clamp(inspRadius + e.deltaY * 0.4, 60, 800);
}, { passive: true });

// ── Animation Loop ────────────────────────────────────────────────────────────
const clock = new THREE.Clock();

(function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05);

  ship.update(delta);
  world.update(delta);
  stars.update(ship.position);

  // Skybox follows camera (appears infinite)
  if (skybox) skybox.position.copy(camera.position);

  // Orbit camera: always follows ship, mouse drag to rotate, scroll to zoom
  const sinPhi = Math.sin(inspPhi);
  camera.position.set(
    ship.position.x + inspRadius * sinPhi * Math.cos(inspTheta),
    ship.position.y + inspRadius * sinPhi * Math.sin(inspTheta),
    ship.position.z + inspRadius * Math.cos(inspPhi),
  );
  camera.up.set(0, 0, 1);
  camera.lookAt(ship.position);

  renderer.render(scene, camera);
}());
