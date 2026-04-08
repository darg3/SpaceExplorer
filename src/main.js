import * as THREE from 'three';
import { Ship }         from './ship.js';
import { Stars }        from './stars.js';
import { InputHandler } from './input.js';
import { World }        from './world.js';
import { HUD }          from './hud.js';
import { NPCFleet }     from './npcs.js';
import { RocketManager } from './rockets.js';

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

// ── Skybox (nebula cube) ──────────────────────────────────────────────────────
// Using a CubeTexture as scene.background avoids both problems of the old
// sphere-mesh approach: pole stretching (equirectangular projection) and the
// visible seam where the texture's left/right edges meet.  Each cube face is
// an independent canvas, so there are no edge-matching requirements.
// scene.background also sits at true infinity — no per-frame camera chase needed.

// Shared cloud definitions: [cx, cy, radius, r, g, b, alpha]
// More layers = richer nebula with overlapping colour regions
const NEBULA_CLOUDS = [
  [0.28, 0.42, 0.55,  110,  30, 190, 0.55],
  [0.72, 0.58, 0.50,   30,  70, 210, 0.50],
  [0.50, 0.28, 0.38,  200,  70,  35, 0.32],
  [0.18, 0.75, 0.44,   30, 160, 210, 0.38],
  [0.82, 0.20, 0.32,  170,  90, 230, 0.42],
  [0.60, 0.80, 0.40,   60, 200, 160, 0.28],
  [0.35, 0.15, 0.28,  230, 140,  40, 0.25],
  // Extra layers for more depth and colour saturation
  [0.45, 0.65, 0.30,   80, 20,  160, 0.22],
  [0.10, 0.35, 0.42,  255, 80,   20, 0.18],
  [0.88, 0.72, 0.36,   20, 180, 255, 0.20],
  [0.65, 0.12, 0.25,  140, 200,  80, 0.15],
];

function makeNebulaCubeFace(S, offX, offY) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');

  ctx.fillStyle = '#00000e';
  ctx.fillRect(0, 0, S, S);

  for (const [cx, cy, r, cr, cg, cb, ca] of NEBULA_CLOUDS) {
    // Shift cloud centres per face so each face looks distinct
    const px  = ((cx + offX) % 1.0) * S;
    const py  = ((cy + offY) % 1.0) * S;
    const grd = ctx.createRadialGradient(px, py, 0, px, py, r * S);
    grd.addColorStop(0,   `rgba(${cr},${cg},${cb},${ca})`);
    grd.addColorStop(0.5, `rgba(${cr},${cg},${cb},${(ca * 0.28).toFixed(2)})`);
    grd.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, S, S);
  }

  // Subtle central glow
  const core = ctx.createRadialGradient(S*0.5, S*0.5, 0, S*0.5, S*0.5, S*0.2);
  core.addColorStop(0, 'rgba(220,200,255,0.14)');
  core.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, S, S);

  return cv;
}

function makeProceduralNebulaCube() {
  const S = 1024;
  // CubeTexture face order: +X, -X, +Y, -Y, +Z, -Z
  const offsets = [
    [0.00, 0.00],
    [0.50, 0.20],
    [0.20, 0.50],
    [0.70, 0.30],
    [0.30, 0.70],
    [0.60, 0.60],
  ];
  const faces = offsets.map(([ox, oy]) => makeNebulaCubeFace(S, ox, oy));
  const tex = new THREE.CubeTexture(faces);
  tex.needsUpdate = true;
  return tex;
}

function buildSkybox(tex) {
  // Equirectangular JPEG loaded from assets — remap so Three.js handles projection
  if (!tex.isCubeTexture) tex.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = tex;
}

// Try actual file first, then fallback to procedural cube
new THREE.TextureLoader().load(
  'assets/GSFC_20171208_nebula.jpg',
  tex  => buildSkybox(tex),
  undefined,
  ()   => new THREE.TextureLoader().load(
    'assets/nebula.jpg',
    tex => buildSkybox(tex),
    undefined,
    ()  => buildSkybox(makeProceduralNebulaCube()),
  ),
);

// ── Input ─────────────────────────────────────────────────────────────────────
const input = new InputHandler();

// ── Star Field ────────────────────────────────────────────────────────────────
const stars = new Stars(scene);

// ── World ─────────────────────────────────────────────────────────────────────
const world = new World(scene);

// ── Ship ──────────────────────────────────────────────────────────────────────
const ship    = new Ship(scene, input);
const hud     = new HUD(ship);
const fleet   = new NPCFleet(scene);
const rockets = new RocketManager(scene);
let   elapsed = 0;

// ── FIRE button callback ──────────────────────────────────────────────────────
hud.setFireCallback(() => {
  if (!currentTarget) return;
  const npc = fleet.shipForMesh(currentTarget);
  if (!npc || npc._state === 'dead') return;
  const [turretPos] = ship.getTurretPositions();
  rockets.fire(turretPos, currentTarget);
  hud.triggerFireCooldown(600);
});

// ── Targeting ─────────────────────────────────────────────────────────────────
// Click (not drag) on any world object to lock it as the current target.
// Clicking the same object again or empty space clears the lock.
const raycaster    = new THREE.Raycaster();
const _mouse       = new THREE.Vector2();
const _tgtWorldPos = new THREE.Vector3();
let   currentTarget  = null;
let   _clickStartX   = 0;
let   _clickStartY   = 0;

canvas.addEventListener('mousedown', e => {
  _clickStartX = e.clientX;
  _clickStartY = e.clientY;
});

canvas.addEventListener('mouseup', e => {
  // Ignore if the mouse moved more than 5px (it was a drag, not a click)
  const dx = e.clientX - _clickStartX;
  const dy = e.clientY - _clickStartY;
  if (dx * dx + dy * dy > 25) return;

  _mouse.x =  (e.clientX / window.innerWidth)  * 2 - 1;
  _mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(_mouse, camera);

  const hits = raycaster.intersectObjects([...world.targetables, ...fleet.targetables]);
  if (hits.length > 0) {
    const hit = hits[0].object;
    if (hit === currentTarget) {
      currentTarget = null;         // click same target = deselect
      hud.clearTarget();
    } else {
      currentTarget = hit;
      const isEnemy = hit.userData.type === 'Hostile Fighter';
      hud.setTarget(hit.userData.label, hit.userData.type, isEnemy);
    }
  } else {
    currentTarget = null;
    hud.clearTarget();
  }
});

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
  hud.update();
  world.update(delta);
  elapsed += delta;
  fleet.update(delta, ship.position, elapsed);
  rockets.update(delta, fleet);
  stars.update(ship.position);

  // Orbit camera: always follows ship, mouse drag to rotate, scroll to zoom
  const sinPhi = Math.sin(inspPhi);
  camera.position.set(
    ship.position.x + inspRadius * sinPhi * Math.cos(inspTheta),
    ship.position.y + inspRadius * sinPhi * Math.sin(inspTheta),
    ship.position.z + inspRadius * Math.cos(inspPhi),
  );
  camera.up.set(0, 0, 1);
  camera.lookAt(ship.position);

  // ── Target HUD update ──────────────────────────────────────────────────
  if (currentTarget) {
    currentTarget.getWorldPosition(_tgtWorldPos);
    const dist = ship.position.distanceTo(_tgtWorldPos);

    // Project world position → normalised device coords → screen pixels
    const proj = _tgtWorldPos.clone().project(camera);
    const sx = ( proj.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-proj.y * 0.5 + 0.5) * window.innerHeight;
    hud.updateTarget(dist, sx, sy, proj.z < 1.0);

    // Update enemy health bars when targeting an NPC ship
    const npc = fleet.shipForMesh(currentTarget);
    if (npc) {
      const h = npc.healthPct;
      hud.updateTargetHealth(h.shield, h.armor, h.hull);
    }
  }

  renderer.render(scene, camera);
}());
