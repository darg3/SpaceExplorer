import * as THREE from 'three';
import { Ship }         from './ship.js';
import { Stars }        from './stars.js';
import { InputHandler } from './input.js';
import { World }        from './world.js';
import { HUD }          from './hud.js';
import { NPCFleet }     from './npcs.js';
import { RocketManager }  from './rockets.js';
import { Menu }           from './menu.js';
import { MobileControls } from './mobile.js';

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

// ── Skybox (seamless nebula sphere) ──────────────────────────────────────────
// PMREMGenerator converts any equirectangular texture into a seamless cube-env
// map with properly filtered face edges — no visible seams in any direction.
// Falls back to a procedurally generated equirectangular canvas whose clouds
// are defined in spherical coordinates so left/right edges wrap perfectly.

const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();

// Cloud centres as 3D unit-sphere directions + angular spread + colour
const NEBULA_CLOUDS_3D = [
  { dir: [ 0.60,  0.60,  0.52], spread: 0.55, r: 110, g:  30, b: 190, a: 0.55 },
  { dir: [-0.55,  0.70,  0.46], spread: 0.50, r:  30, g:  70, b: 210, a: 0.50 },
  { dir: [ 0.50, -0.50,  0.70], spread: 0.38, r: 200, g:  70, b:  35, a: 0.32 },
  { dir: [-0.70, -0.50,  0.52], spread: 0.44, r:  30, g: 160, b: 210, a: 0.38 },
  { dir: [ 0.80, -0.40, -0.45], spread: 0.32, r: 170, g:  90, b: 230, a: 0.42 },
  { dir: [-0.60,  0.20, -0.78], spread: 0.40, r:  60, g: 200, b: 160, a: 0.28 },
  { dir: [ 0.10,  0.90, -0.43], spread: 0.28, r: 230, g: 140, b:  40, a: 0.25 },
  { dir: [-0.30, -0.80, -0.52], spread: 0.30, r:  80, g:  20, b: 160, a: 0.22 },
  { dir: [ 0.90,  0.10,  0.43], spread: 0.42, r: 255, g:  80, b:  20, a: 0.18 },
  { dir: [-0.10,  0.50, -0.86], spread: 0.36, r:  20, g: 180, b: 255, a: 0.20 },
  { dir: [ 0.40, -0.90,  0.17], spread: 0.25, r: 140, g: 200, b:  80, a: 0.15 },
];

// Normalise a direction vector in-place and return it
function _norm(d) {
  const len = Math.sqrt(d[0]*d[0] + d[1]*d[1] + d[2]*d[2]);
  return [d[0]/len, d[1]/len, d[2]/len];
}

function makeProceduralEquirect() {
  const W = 2048, H = 1024;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // Black base
  ctx.fillStyle = '#00000e';
  ctx.fillRect(0, 0, W, H);

  // Normalise all cloud directions
  const clouds = NEBULA_CLOUDS_3D.map(c => ({ ...c, dir: _norm(c.dir) }));

  // Pixel-level equirectangular sampling in spherical coordinates.
  // u = theta / 2PI  (azimuth, wraps seamlessly)
  // v = phi   / PI   (elevation, 0=top 1=bottom)
  const imgData = ctx.createImageData(W, H);
  const px = imgData.data;

  for (let y = 0; y < H; y++) {
    const phi   = (y / H) * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    for (let x = 0; x < W; x++) {
      const theta = (x / W) * 2 * Math.PI;
      // 3-D unit direction for this pixel
      const px3 = sinPhi * Math.cos(theta);
      const py3 = sinPhi * Math.sin(theta);
      const pz3 = cosPhi;

      let R = 0, G = 0, B = 0, A = 0;
      for (const c of clouds) {
        const dot = Math.max(0, px3 * c.dir[0] + py3 * c.dir[1] + pz3 * c.dir[2]);
        const t   = 1 - dot;
        const intensity = Math.exp(-(t / c.spread) * (t / c.spread) * 4) * c.a;
        if (intensity < 0.002) continue;
        R += c.r * intensity;
        G += c.g * intensity;
        B += c.b * intensity;
        A += intensity;
      }
      const i = (y * W + x) * 4;
      px[i]   = Math.min(255, R);
      px[i+1] = Math.min(255, G);
      px[i+2] = Math.min(255, B);
      px[i+3] = Math.min(255, A * 255 * 2.5);
    }
  }
  ctx.putImageData(imgData, 0, 0);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildSkybox(tex) {
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const envTex = pmrem.fromEquirectangular(tex).texture;
  scene.background = envTex;
  tex.dispose();
}

// Try actual file first, then fallback to procedural equirectangular
new THREE.TextureLoader().load(
  'assets/GSFC_20171208_nebula.jpg',
  tex => buildSkybox(tex),
  undefined,
  () => new THREE.TextureLoader().load(
    'assets/nebula.jpg',
    tex => buildSkybox(tex),
    undefined,
    () => buildSkybox(makeProceduralEquirect()),
  ),
);

// ── Player damage tuning ──────────────────────────────────────────────────────
const SHIP_COL_RADIUS       = 15;   // approximate ship bounding sphere (world units)
const ASTEROID_DAMAGE       = 15;   // hp per collision tick
const ASTEROID_HIT_COOLDOWN = 2.0;  // seconds between collision damage ticks
const SHIELD_REGEN_DELAY    = 5.0;  // seconds after last damage before shields regen
const SHIELD_REGEN_RATE     = 8;    // shield points per second

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

new MobileControls(
  input,
  (dx, dy) => {
    inspTheta -= dx * 0.007;
    inspPhi = THREE.MathUtils.clamp(inspPhi + dy * 0.007, 0.05, Math.PI - 0.05);
  },
  delta => {
    // pinch apart (positive delta) = zoom in = decrease radius
    inspRadius = THREE.MathUtils.clamp(inspRadius - delta * 0.4, 60, 800);
  },
);

// ── Animation Loop ────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
let _timeSinceHit = 999; // seconds since last player damage (starts high = no regen delay)

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

  // ── Asteroid collision damage ──────────────────────────────────────────
  _timeSinceHit += delta;
  if (ship.hull > 0 && _timeSinceHit > ASTEROID_HIT_COOLDOWN) {
    for (const ast of world.asteroids) {
      const r = ast.userData.radius ?? 20;
      if (ship.position.distanceTo(ast.position) < r + SHIP_COL_RADIUS) {
        ship.takeDamage(ASTEROID_DAMAGE);
        hud.flashDamage();
        _timeSinceHit = 0;
        break;
      }
    }
  }

  // Shield regen after delay
  if (_timeSinceHit > SHIELD_REGEN_DELAY && ship.shield < 100) {
    ship.shield = Math.min(100, ship.shield + SHIELD_REGEN_RATE * delta);
  }

  // Sync player health HUD every frame
  hud.setPlayerHealth(ship.shield, ship.armor, ship.hull);
  hud.setHullWarning(ship.hull < 20);
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
