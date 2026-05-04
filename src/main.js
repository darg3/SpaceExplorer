import * as THREE from 'three';
import { Ship }         from './ship.js';
import { Stars }        from './stars.js';
import { InputHandler } from './input.js';
import { World }        from './world.js';
import { HUD }          from './hud.js';
import { NPCFleet }     from './npcs.js';
import { RocketManager }  from './rockets.js';
import { WeaponSystem }   from './weapons.js';
import { LootManager }    from './loot.js';
import { Menu }           from './menu.js';
import { MobileControls } from './mobile.js';
import { Station }        from './station.js';
import { Shop }           from './shop.js';
import { Minimap }        from './minimap.js';

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
  200000,
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

// Wrap a flat (non-equirectangular) photo onto a sphere without visible seams.
// Two artifacts to fix:
//   (1) Horizontal seam: photo's left edge ≠ right edge. We draw a copy of the
//       photo shifted by W/2 (so what was at the center is now at both edges),
//       masked with a cosine alpha that's 1 at the seam and 0 at the middle.
//       Result: both edges of the canvas now show the photo's center pixels —
//       identical content meeting at theta = 0/2π, no seam line.
//   (2) Pole pinching: equirect's top and bottom rows collapse to single sphere
//       poles. Any non-uniform color there becomes a star-shaped artifact. We
//       fade the top and bottom into the dark base so pole pixels are uniform.
function makeSeamlessFromImage(img) {
  const W = 2048, H = 1024;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // Dark base
  ctx.fillStyle = '#00000e';
  ctx.fillRect(0, 0, W, H);

  // Original photo, stretched to the equirect aspect
  ctx.drawImage(img, 0, 0, W, H);

  // Build a shifted copy: photo's left half goes to the right half of this
  // canvas, and vice versa. After the shift, x = 0 and x = W of `shifted`
  // both show what was at x = W/2 of the original — i.e. identical pixels.
  const shifted = document.createElement('canvas');
  shifted.width = W; shifted.height = H;
  const sctx = shifted.getContext('2d');
  sctx.drawImage(img,    0, 0, img.width / 2, img.height,    W / 2, 0, W / 2, H);
  sctx.drawImage(img, img.width / 2, 0, img.width / 2, img.height,  0, 0, W / 2, H);

  // Cosine alpha mask: opaque at the seam (x = 0 and x = W), transparent at
  // the middle. destination-in keeps the shifted pixels weighted by this mask.
  sctx.globalCompositeOperation = 'destination-in';
  const gradH = sctx.createLinearGradient(0, 0, W, 0);
  gradH.addColorStop(0,    'rgba(255,255,255,1)');
  gradH.addColorStop(0.5,  'rgba(255,255,255,0)');
  gradH.addColorStop(1,    'rgba(255,255,255,1)');
  sctx.fillStyle = gradH;
  sctx.fillRect(0, 0, W, H);

  // Composite the seam-fix overlay onto the base canvas
  ctx.drawImage(shifted, 0, 0);

  // Pole fade: top and bottom 20% blend to the dark base so pole pixels are
  // uniform and don't pinch into a star artifact.
  const gradV = ctx.createLinearGradient(0, 0, 0, H);
  gradV.addColorStop(0,    'rgba(0,0,14,1)');
  gradV.addColorStop(0.2,  'rgba(0,0,14,0)');
  gradV.addColorStop(0.8,  'rgba(0,0,14,0)');
  gradV.addColorStop(1,    'rgba(0,0,14,1)');
  ctx.fillStyle = gradV;
  ctx.fillRect(0, 0, W, H);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Try the user's nebula.jpg first, then the bundled GSFC photo, then fall back
// to the fully procedural (already-seamless) equirect.
new THREE.ImageLoader().load(
  'assets/nebula.jpg',
  img => buildSkybox(makeSeamlessFromImage(img)),
  undefined,
  () => new THREE.ImageLoader().load(
    'assets/GSFC_20171208_nebula.jpg',
    img => buildSkybox(makeSeamlessFromImage(img)),
    undefined,
    () => buildSkybox(makeProceduralEquirect()),
  ),
);

// ── Player damage tuning ──────────────────────────────────────────────────────
const SHIP_COL_RADIUS       = 15;   // approximate ship bounding sphere (world units)
const ASTEROID_DAMAGE       = 15;   // hp per collision tick
const ASTEROID_HIT_COOLDOWN = 2.0;  // seconds between collision damage ticks
const SHIELD_REGEN_DELAY    = 5.0;  // seconds after last damage before shields regen
const SHIELD_REGEN_RATE     = 0.5;  // shield points per second (1 per 2 seconds)
const NPC_ROCKET_DAMAGE     = 3;    // hp per hit from an NPC rocket

// ── Input ─────────────────────────────────────────────────────────────────────
const input = new InputHandler();

// ── Star Field ────────────────────────────────────────────────────────────────
const stars = new Stars(scene);

// ── World ─────────────────────────────────────────────────────────────────────
const world = new World(scene);

// ── Station ───────────────────────────────────────────────────────────────────
// Single dockable station. Spire mesh is registered as a targetable so the
// raycaster and right-click context menu can both pick it up.
const station = new Station(scene, new THREE.Vector3(4500, -3500, 600));
world.targetables.push(station.hitbox);
world.namedTargetables.push(station.hitbox);

const DOCK_RANGE = 300;
let _docked = false;

// ── Ship ──────────────────────────────────────────────────────────────────────
const ship    = new Ship(scene, input);
const hud     = new HUD(ship);
const minimap = new Minimap();
const rockets = new RocketManager(scene);

// Player death state — set when hull reaches 0. Gates input-driven actions
// (firing, mining, warp, asteroid damage) and prevents further damage being
// applied to the wreck.
let _playerDead = false;

// Persistent credits counter — increments on each loot pickup.
let score = 0;

// Loot manager — spawns drops on NPC death, applies pickups on player contact.
const loot = new LootManager(scene, ({ type }) => {
  if (_playerDead) return;
  if (type === 'shield') {
    ship.shield = Math.min(ship.maxShield, ship.shield + 30);
    score += 100;
    hud.showCombatMessage('+30 Shield  (+100 cr)');
  } else {
    ship.hull = Math.min(ship.maxHull, ship.hull + 15);
    score += 200;
    hud.showCombatMessage('+15 Hull  (+200 cr)');
  }
  hud.setScore(score);
});
hud.setScore(score);

// NPC fires a rocket at the player ship. Damage is deferred via onHit until
// the rocket detonates (RocketManager.update calls onHit on close approach).
// On NPC death, the fleet calls our onDeath hook which spawns a loot drop.
const fleet = new NPCFleet(
  scene,
  (originPos, npcName) => {
    if (_playerDead) return;
    rockets.fire(originPos, ship.group, () => onPlayerHit(npcName, NPC_ROCKET_DAMAGE));
  },
  pos => loot.spawn(pos),
);

let elapsed = 0;

// ── Warp ──────────────────────────────────────────────────────────────────────
const WARP_ARRIVE_DIST = 500;   // units from target on arrival
const WARP_MIN_DIST    = 600;   // minimum distance to show warp button
const WARP_COOLDOWN    = 5.0;   // seconds before warp can be used again

let _warpCooldown = 0;

function doWarp() {
  if (_playerDead) return;
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

const _beamDir = new THREE.Vector3();
const _beamMid = new THREE.Vector3();
const _beamQ   = new THREE.Quaternion();
const _beamUp  = new THREE.Vector3(0, 1, 0);

function _positionBeam(beam, start, end) {
  _beamDir.subVectors(end, start);
  const len = _beamDir.length();
  _beamMid.addVectors(start, end).multiplyScalar(0.5);
  _beamDir.normalize();
  _beamQ.setFromUnitVectors(_beamUp, _beamDir);
  beam.inner.position.copy(_beamMid);
  beam.inner.scale.set(1, len, 1);
  beam.inner.quaternion.copy(_beamQ);
  beam.inner.visible = true;
  beam.outer.position.copy(_beamMid);
  beam.outer.scale.set(1, len, 1);
  beam.outer.quaternion.copy(_beamQ);
  beam.outer.visible = true;
  beam.light.position.copy(end);
}

function startMining() {
  if (_playerDead) return;
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

// ── Player damage handler (called when NPC rockets detonate on the ship) ─────
function onPlayerHit(npcName, dmg) {
  if (_playerDead || _docked) return;
  ship.takeDamage(dmg);
  hud.flashDamage();
  hud.showCombatMessage(`${npcName} does ${dmg} damage to your ship`);
  _timeSinceHit = 0;
  if (ship.hull <= 0) killPlayer();
}

function killPlayer() {
  if (_playerDead) return;
  _playerDead = true;
  ship.destroyShip();
  if (_isMining) stopMining(false);
  currentTarget = null;
  hud.clearTarget();
  hud.showMineButton(false);
  hud.showWarpButton(false);
  hud.setHullWarning(false);
  hud.showGameOver(() => location.reload());
}

// ── Weapon system ─────────────────────────────────────────────────────────────
// Slot 1 = Laser (forward bolts, no lock), 2 = Missile (rebadged rockets, ammo
// gated), 3 = Plasma (hold-to-charge). Damage & cooldown for missiles still
// live on the ship — shop upgrades mutate them directly.
const weapons = new WeaponSystem(
  scene, ship, hud,
  () => currentTarget,
  fleet, rockets,
  () => _playerDead,
  () => _docked,
);

hud.setFirePressCallback(()    => weapons.pressFire());
hud.setFireReleaseCallback(()  => weapons.releaseFire());
hud.setWeaponSelectCallback(n  => weapons.setSlot(n));

hud.setMineCallback(() => startMining());
hud.setWarpCallback(() => doWarp());

// ── Shop / Docking ────────────────────────────────────────────────────────────
const shop = new Shop(
  ship,
  () => score,
  n => { score = n; hud.setScore(n); },
);

function doDock() {
  if (_playerDead || _docked) return;
  if (currentTarget !== station.hitbox) return;
  if (ship.position.distanceTo(station.position) > DOCK_RANGE) return;
  _docked = true;
  ship.engineOn = false;
  ship.setTargetSpeed(0);
  // Free missile reload on dock
  ship.missileAmmo = ship.missileAmmoMax;
  hud.setMissileAmmo(ship.missileAmmo, ship.missileAmmoMax);
  weapons.cancelCharge();
  hud.showDockButton(false);
  hud.showWarpButton(false);
  hud.showMineButton(false);
  shop.open(doUndock);
}

function doUndock() {
  if (!_docked) return;
  _docked = false;
  // Push the ship away from the station so we don't immediately re-enter dock range.
  const dir = ship.group.position.clone().sub(station.position);
  if (dir.lengthSq() < 1) dir.set(1, 0, 0);
  dir.normalize();
  ship.group.position.addScaledVector(dir, 50);
  ship.engineOn = true;
}

hud.setDockCallback(doDock);

// ── Targeting ─────────────────────────────────────────────────────────────────
// Click (not drag) on any world object to lock it as the current target.
// Clicking the same object again or empty space clears the lock.
const raycaster    = new THREE.Raycaster();
const _mouse       = new THREE.Vector2();
const _tgtWorldPos = new THREE.Vector3();
const _tgtProj     = new THREE.Vector3();   // reused for camera.project per frame
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
    if (mesh.userData.isStation) continue;
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

  // Stations
  for (const mesh of world.namedTargetables) {
    if (!mesh.userData.isStation) continue;
    mesh.getWorldPosition(_tgtWorldPos);
    const dist = ship.position.distanceTo(_tgtWorldPos);
    items.push({
      category: 'Station',
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
    const lbl  = npcShip.hitbox.userData.label;
    items.push({
      category: 'Contact',
      label:    lbl,
      subtype:  'Hostile Fighter',
      dist,
      onSelect: () => {
        currentTarget = npcShip.hitbox;
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
  // Space-bar fire (in addition to the HUD button). Skip when typing in any
  // form control so the shop / future inputs aren't hijacked. e.repeat blocks
  // OS-level auto-repeat from re-triggering pressFire each tick.
  if (e.code === 'Space' && !e.repeat) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
    e.preventDefault();
    weapons.pressFire();
  }
});

document.addEventListener('keyup', e => {
  if (e.code === 'Space') {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
    weapons.releaseFire();
  }
});

// ── Camera ────────────────────────────────────────────────────────────────────

// ── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  hud.onWindowResize();
});

// ── Orbit Camera ──────────────────────────────────────────────────────────────
let inspTheta    = Math.PI;       // azimuth: π = behind ship (ship faces +X)
let inspPhi      = Math.PI * 0.38; // elevation from Z (~68° — slightly above horizontal)
let inspRadius   = 320;
let inspDragging = false;
let inspLastX    = 0;
let inspLastY    = 0;

window.addEventListener('mousedown', e => {
  // Don't start an orbit-camera drag when the click lands on the HUD —
  // those clicks belong to HUD panel drag-and-drop.
  if (e.target.closest('#hud')) return;
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
  inspRadius = THREE.MathUtils.clamp(inspRadius * Math.pow(1.001, e.deltaY), 60, 80000);
}, { passive: true });

new MobileControls(
  input,
  (dx, dy) => {
    inspTheta -= dx * 0.007;
    inspPhi = THREE.MathUtils.clamp(inspPhi + dy * 0.007, 0.05, Math.PI - 0.05);
  },
  delta => {
    // pinch apart (positive delta) = zoom in = decrease radius
    inspRadius = THREE.MathUtils.clamp(inspRadius * Math.pow(1.005, -delta), 60, 80000);
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

  weapons.handleInput(input);
  ship.update(delta);
  hud.update();
  minimap.update({ ship, fleet, world, loot, station, currentTarget, delta });
  world.update(delta);
  station.update(delta);
  elapsed += delta;

  // ── Asteroid collision damage ──────────────────────────────────────────
  _timeSinceHit += delta;
  if (!_playerDead && !_docked && ship.hull > 0 && _timeSinceHit > ASTEROID_HIT_COOLDOWN) {
    for (const ast of world.asteroids) {
      const r = ast.userData.radius ?? 20;
      if (ship.position.distanceTo(ast.position) < r + SHIP_COL_RADIUS) {
        ship.takeDamage(ASTEROID_DAMAGE);
        hud.flashDamage();
        _timeSinceHit = 0;
        if (ship.hull <= 0) killPlayer();
        break;
      }
    }
  }

  // Shield regen after delay
  if (!_playerDead && _timeSinceHit > SHIELD_REGEN_DELAY && ship.shield < ship.maxShield) {
    ship.shield = Math.min(ship.maxShield, ship.shield + SHIELD_REGEN_RATE * delta);
  }

  // Sync player health HUD every frame
  hud.setPlayerHealth(ship.shield, ship.armor, ship.hull);
  hud.setHullWarning(ship.hull < 20);
  fleet.update(delta, ship.position, elapsed);
  rockets.update(delta, fleet);
  weapons.update(delta, fleet);
  loot.update(delta, ship.position);
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
  // Auto-untarget when locked NPC has been destroyed
  if (currentTarget) {
    const npcCheck = fleet.shipForMesh(currentTarget);
    if (npcCheck && npcCheck._state === 'dead') {
      currentTarget = null;
      hud.clearTarget();
    }
  }
  if (currentTarget) {
    currentTarget.getWorldPosition(_tgtWorldPos);
    const dist = ship.position.distanceTo(_tgtWorldPos);

    // Project world position → normalised device coords → screen pixels
    _tgtProj.copy(_tgtWorldPos).project(camera);
    const sx = ( _tgtProj.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-_tgtProj.y * 0.5 + 0.5) * window.innerHeight;
    hud.updateTarget(dist, sx, sy, _tgtProj.z < 1.0);

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

    // Show Dock button only when targeting the station
    if (currentTarget.userData.isStation && !_docked) {
      hud.showDockButton(true, dist <= DOCK_RANGE);
    } else {
      hud.showDockButton(false);
    }
  } else if (!_isMining) {
    hud.showMineButton(false, false);
    hud.showWarpButton(false);
    hud.showDockButton(false);
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
  input.tick();   // snapshot keys for next-frame edge-trigger detection
  }());
}

new Menu(() => startGame()).show();
