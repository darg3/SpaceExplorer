import * as THREE from 'three';
import { Ship }         from './ship.js';
import { Stars }        from './stars.js';
import { InputHandler } from './input.js';
import { World }        from './world.js';
import { HUD }          from './hud.js';
import { NPCFleet }     from './npcs.js';
import { RocketManager } from './rockets.js';
import { Menu }         from './menu.js';

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

// ── Warp ──────────────────────────────────────────────────────────────────────
const WARP_ARRIVE_DIST = 500;   // units from target on arrival
const WARP_MIN_DIST    = 600;   // minimum distance to show warp button
const WARP_COOLDOWN    = 5.0;   // seconds before warp can be used again

let _warpCooldown = 0;

function doWarp() {
  if (!currentTarget || _warpCooldown > 0) return;

  const targetPos = new THREE.Vector3();
  currentTarget.getWorldPosition(targetPos);
  if (ship.position.distanceTo(targetPos) < WARP_MIN_DIST) return;

  const destLabel = currentTarget.userData.label || 'Unknown';

  // Arrive WARP_ARRIVE_DIST units from the target, on the side facing the ship
  const fromDir    = new THREE.Vector3().subVectors(ship.position, targetPos).normalize();
  const arrivalPos = targetPos.clone().addScaledVector(fromDir, WARP_ARRIVE_DIST);

  hud.showWarpButton(false);

  hud.triggerWarpFlash(destLabel, () => {
    // Teleport ship while the screen is white
    ship.group.position.copy(arrivalPos);

    // Orient to face the target
    const fwd = new THREE.Vector3().subVectors(targetPos, arrivalPos).normalize();
    if (fwd.lengthSq() > 0.001) {
      ship.group.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), fwd);
    }

    // Reset orbit camera to default behind-ship view
    inspTheta  = Math.PI;
    inspPhi    = Math.PI * 0.38;
    inspRadius = 320;

    _warpCooldown = WARP_COOLDOWN;
  });
}

// ── Mining ────────────────────────────────────────────────────────────────────
const MINE_RANGE    = 400;   // max distance to initiate mining
const MINE_DURATION = 3.0;   // seconds to complete a mine

let _isMining    = false;
let _miningAccum = 0;
let _miningTgt   = null;   // the mesh currently being mined
let _miningBeam  = null;   // { inner, outer, innerMat, outerMat, light }

function _createBeam() {
  const innerMat = new THREE.MeshBasicMaterial({
    color: 0x00ffcc, blending: THREE.AdditiveBlending,
    transparent: true, opacity: 0.9, depthWrite: false,
  });
  const outerMat = new THREE.MeshBasicMaterial({
    color: 0x00ffcc, blending: THREE.AdditiveBlending,
    transparent: true, opacity: 0.2, depthWrite: false,
  });
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1, 8), innerMat);
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 1, 8), outerMat);
  const light = new THREE.PointLight(0x00ffcc, 8, 260);
  scene.add(inner); scene.add(outer); scene.add(light);
  return { inner, outer, innerMat, outerMat, light };
}

function _positionBeam(beam, start, end) {
  const dir = new THREE.Vector3().subVectors(end, start);
  const len = dir.length();
  const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  const q   = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), dir.normalize(),
  );
  for (const m of [beam.inner, beam.outer]) {
    m.position.copy(mid);
    m.scale.set(1, len, 1);
    m.quaternion.copy(q);
    m.visible = true;
  }
  beam.light.position.copy(end);
}

function startMining() {
  if (!currentTarget || currentTarget.userData.mined || _isMining) return;
  _isMining    = true;
  _miningAccum = 0;
  _miningTgt   = currentTarget;
  _miningBeam  = _createBeam();
  hud.setMiningProgress(0);
}

function stopMining(completed) {
  _isMining = false;
  if (_miningBeam) {
    scene.remove(_miningBeam.inner);
    scene.remove(_miningBeam.outer);
    scene.remove(_miningBeam.light);
    _miningBeam = null;
  }
  if (completed && _miningTgt) {
    world.mineAsteroid(_miningTgt);
    hud.setMiningProgress(1);
    setTimeout(() => hud.setMiningProgress(null), 1400);
  } else {
    hud.setMiningProgress(null);
  }
  _miningTgt = null;
}

// ── FIRE button callback ──────────────────────────────────────────────────────
hud.setFireCallback(() => {
  if (!currentTarget) return;
  const npc = fleet.shipForMesh(currentTarget);
  if (!npc || npc._state === 'dead') return;
  const [turretPos] = ship.getTurretPositions();
  rockets.fire(turretPos, currentTarget);
  hud.triggerFireCooldown(600);
});

hud.setMineCallback(() => startMining());
hud.setWarpCallback(() => doWarp());

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

// ── Context menu (right-click) ────────────────────────────────────────────────
// Shows a list of named objects in space with their distances.
canvas.addEventListener('contextmenu', e => {
  e.preventDefault();

  const items = [];

  // Planets
  for (const mesh of world.namedTargetables) {
    if (mesh.userData.type === 'Asteroid Field') continue;
    mesh.getWorldPosition(_tgtWorldPos);
    const dist = ship.position.distanceTo(_tgtWorldPos);
    items.push({
      category: 'Planet',
      label:    mesh.userData.label,
      subtype:  mesh.userData.type,
      dist,
      onSelect: () => {
        currentTarget = mesh;
        hud.setTarget(mesh.userData.label, mesh.userData.type, false);
      },
    });
  }

  // Asteroid Fields
  for (const mesh of world.namedTargetables) {
    if (mesh.userData.type !== 'Asteroid Field') continue;
    mesh.getWorldPosition(_tgtWorldPos);
    const dist = ship.position.distanceTo(_tgtWorldPos);
    items.push({
      category: 'Asteroid Field',
      label:    mesh.userData.label,
      subtype:  mesh.userData.type,
      dist,
      onSelect: () => {
        currentTarget = mesh;
        hud.setTarget(mesh.userData.label, mesh.userData.type, false);
      },
    });
  }

  // NPC ships (alive only)
  for (const npcShip of fleet.ships) {
    if (npcShip._state === 'dead') continue;
    npcShip.group.getWorldPosition(_tgtWorldPos);
    const dist = ship.position.distanceTo(_tgtWorldPos);
    const lbl  = npcShip.fuselage.userData.label;
    items.push({
      category: 'Contact',
      label:    lbl,
      subtype:  'Hostile Fighter',
      dist,
      onSelect: () => {
        currentTarget = npcShip.fuselage;
        hud.setTarget(lbl, 'Hostile Fighter', true);
      },
    });
  }

  // Sort each category's entries by distance
  items.sort((a, b) => {
    if (a.category !== b.category) return 0; // keep category order
    return a.dist - b.dist;
  });

  hud.showContextMenu(items, e.clientX, e.clientY);
});

// Close context menu on any left- or middle-click (not right-click, which opens it)
document.addEventListener('mousedown', e => {
  if (e.button !== 2) hud.hideContextMenu();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') hud.hideContextMenu();
});

// ── Camera ────────────────────────────────────────────────────────────────────

// ── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

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

function startGame() {
  const hint = document.getElementById('hint');
  if (hint) {
    hint.style.opacity = '1';
    setTimeout(() => { hint.style.opacity = '0'; }, 6000);
  }

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
  _warpCooldown = Math.max(0, _warpCooldown - delta);

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

    // Show Mine button when targeting a nearby rocky body (not while actively mining)
    if (!_isMining) {
      const t = currentTarget.userData.type;
      const isRock = t === 'Rocky Body' || t === 'Large Rocky Body' || t === 'Space Fragment';
      hud.showMineButton(isRock && dist <= MINE_RANGE, currentTarget.userData.mined === true);
    }

    // Show Warp button when target is far enough and drive is ready
    hud.showWarpButton(
      _warpCooldown <= 0 && dist > WARP_MIN_DIST,
      currentTarget.userData.label,
    );
  } else if (!_isMining) {
    hud.showMineButton(false, false);
    hud.showWarpButton(false);
  }

  // ── Mining beam update ─────────────────────────────────────────────────
  if (_isMining && _miningTgt) {
    if (_miningTgt !== currentTarget) {
      // Target changed — abort
      stopMining(false);
    } else {
      _miningAccum += delta;
      const pct = Math.min(_miningAccum / MINE_DURATION, 1);
      hud.setMiningProgress(pct);

      // Stretch the beam from nose to asteroid each frame
      const [nosePos] = ship.getTurretPositions();
      _positionBeam(_miningBeam, nosePos, _tgtWorldPos);

      // Pulsing glow
      const pulse = 0.6 + Math.sin(elapsed * 18) * 0.4;
      _miningBeam.innerMat.opacity = 0.9 * pulse;
      _miningBeam.outerMat.opacity = 0.22 * pulse;
      _miningBeam.light.intensity  = 9 * pulse;

      if (pct >= 1) stopMining(true);
    }
  }

  renderer.render(scene, camera);
  }());
}

new Menu(() => startGame()).show();
