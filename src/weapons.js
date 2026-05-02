import * as THREE from 'three';

// ── Tuning ────────────────────────────────────────────────────────────────────
// Laser: fast straight bolts, no target lock, low damage, short cooldown.
const LASER_SPEED        = 2400;
const LASER_LIFE         = 0.5;
const LASER_HIT_DIST     = 18;
const LASER_COOLDOWN_MS  = 140;
const MAX_LASER_BOLTS    = 16;

// Plasma: hold-to-charge, release fires; damage and orb size scale with charge.
const PLASMA_SPEED       = 600;
const PLASMA_LIFE        = 3.0;
const PLASMA_CHARGE_TIME = 1.5;       // seconds to reach full charge
const PLASMA_MIN_CHARGE  = 0.2;       // below this, release does nothing
const PLASMA_COOLDOWN_MS = 800;
const MAX_PLASMA_ORBS    = 4;
const PLASMA_BASE_DMG    = 30;
const PLASMA_BONUS_DMG   = 90;        // damage = BASE + BONUS * charge

// ── Reusable temporaries (avoid GC) ───────────────────────────────────────────
const _tmpFwd = new THREE.Vector3();
const _tmpPos = new THREE.Vector3();
const _segAB  = new THREE.Vector3();

// Closest distance from segment AB to point P. Mirrors rockets.js helper —
// kept private here so the two systems can evolve independently.
function _segPointDist(A, B, P) {
  _segAB.subVectors(B, A);
  const lenSq = _segAB.lengthSq();
  if (lenSq < 1e-6) return P.distanceTo(A);
  const t = THREE.MathUtils.clamp(
    ((P.x - A.x) * _segAB.x + (P.y - A.y) * _segAB.y + (P.z - A.z) * _segAB.z) / lenSq,
    0, 1,
  );
  return Math.sqrt(
    (A.x + _segAB.x * t - P.x) ** 2 +
    (A.y + _segAB.y * t - P.y) ** 2 +
    (A.z + _segAB.z * t - P.z) ** 2,
  );
}

// ── LaserBolt (internal) ──────────────────────────────────────────────────────
class LaserBolt {
  constructor(scene) {
    this._scene = scene;
    this._life  = 0;
    this._prevPos = new THREE.Vector3();
    this._dir     = new THREE.Vector3();

    const geo = new THREE.CylinderGeometry(0.55, 0.55, 14, 8);
    geo.rotateZ(-Math.PI / 2);   // align cylinder along +X
    const mat = new THREE.MeshBasicMaterial({
      color: 0x66e0ff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.visible = false;
    scene.add(this.mesh);

    this._light = new THREE.PointLight(0x66e0ff, 0, 70);
    scene.add(this._light);
  }

  get active() { return this._life > 0; }

  activate(pos, dirNormalized) {
    this._life = LASER_LIFE;
    this.mesh.position.copy(pos);
    this._prevPos.copy(pos);
    this._dir.copy(dirNormalized);
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), this._dir);
    this.mesh.visible = true;
    this._light.position.copy(pos);
    this._light.intensity = 0.9;
  }

  deactivate() {
    this._life = 0;
    this.mesh.visible = false;
    this._light.intensity = 0;
  }

  update(delta) {
    if (!this.active) return;
    this._life -= delta;
    if (this._life <= 0) { this.deactivate(); return; }
    this._prevPos.copy(this.mesh.position);
    this.mesh.position.addScaledVector(this._dir, LASER_SPEED * delta);
    this._light.position.copy(this.mesh.position);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this._scene.remove(this.mesh);
    this._scene.remove(this._light);
  }
}

// ── LaserManager ──────────────────────────────────────────────────────────────
export class LaserManager {
  constructor(scene) {
    this._scene = scene;
    this._bolts = Array.from({ length: MAX_LASER_BOLTS }, () => new LaserBolt(scene));
    this._turretAlt = 0;
  }

  fire(turretPositions, dirNormalized) {
    const bolt = this._bolts.find(b => !b.active);
    if (!bolt) return;
    const pos = turretPositions[this._turretAlt % turretPositions.length];
    this._turretAlt = (this._turretAlt + 1) % turretPositions.length;
    bolt.activate(pos, dirNormalized);
  }

  update(delta, fleet, damage) {
    for (const bolt of this._bolts) {
      if (!bolt.active) continue;
      bolt.update(delta);
      if (!bolt.active) continue;

      for (const npc of fleet.ships) {
        if (npc._state === 'dead') continue;
        npc.group.getWorldPosition(_tmpPos);
        const dist = _segPointDist(bolt._prevPos, bolt.mesh.position, _tmpPos);
        if (dist <= LASER_HIT_DIST) {
          npc.takeDamage(damage);
          bolt.deactivate();
          break;
        }
      }
    }
  }

  dispose() { for (const b of this._bolts) b.dispose(); }
}

// ── PlasmaOrb (internal) ──────────────────────────────────────────────────────
class PlasmaOrb {
  constructor(scene) {
    this._scene = scene;
    this._life = 0;
    this._prevPos = new THREE.Vector3();
    this._dir     = new THREE.Vector3();
    this._charge  = 0;
    this.damage   = 0;
    this.hitDist  = 4;

    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xddaaff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), coreMat);
    this.mesh.visible = false;
    scene.add(this.mesh);

    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x9944ff,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    });
    this._halo = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), haloMat);
    this._halo.visible = false;
    scene.add(this._halo);

    this._light = new THREE.PointLight(0xaa55ff, 0, 200);
    scene.add(this._light);
  }

  get active() { return this._life > 0; }

  activate(pos, dirNormalized, charge) {
    this._life   = PLASMA_LIFE;
    this._charge = charge;
    this.damage  = PLASMA_BASE_DMG + PLASMA_BONUS_DMG * charge;

    const radius = 4 + 10 * charge;
    this.hitDist = radius + 4;

    this.mesh.position.copy(pos);
    this._halo.position.copy(pos);
    this._light.position.copy(pos);
    this._prevPos.copy(pos);
    this._dir.copy(dirNormalized);

    this.mesh.scale.setScalar(radius);
    this._halo.scale.setScalar(radius * 1.7);

    this.mesh.material.opacity  = 0.7 + 0.25 * charge;
    this._halo.material.opacity = 0.18 + 0.32 * charge;
    this._light.intensity = 4 + 10 * charge;
    this._light.distance  = 180 + 220 * charge;

    this.mesh.visible  = true;
    this._halo.visible = true;
  }

  deactivate() {
    this._life = 0;
    this.mesh.visible  = false;
    this._halo.visible = false;
    this._light.intensity = 0;
  }

  update(delta) {
    if (!this.active) return;
    this._life -= delta;
    if (this._life <= 0) { this.deactivate(); return; }
    this._prevPos.copy(this.mesh.position);
    this.mesh.position.addScaledVector(this._dir, PLASMA_SPEED * delta);
    this._halo.position.copy(this.mesh.position);
    this._light.position.copy(this.mesh.position);

    // Subtle halo pulse so the orb feels alive
    const pulse = 1 + 0.12 * Math.sin(performance.now() * 0.012);
    this._halo.scale.setScalar((4 + 10 * this._charge) * 1.7 * pulse);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this._halo.geometry.dispose();
    this._halo.material.dispose();
    this._scene.remove(this.mesh);
    this._scene.remove(this._halo);
    this._scene.remove(this._light);
  }
}

// ── PlasmaManager ─────────────────────────────────────────────────────────────
export class PlasmaManager {
  constructor(scene, rocketManager) {
    this._scene = scene;
    this._orbs  = Array.from({ length: MAX_PLASMA_ORBS }, () => new PlasmaOrb(scene));
    this._rockets = rocketManager;   // borrow its explosion pool on hit
  }

  fire(turretPositions, dirNormalized, charge) {
    const orb = this._orbs.find(o => !o.active);
    if (!orb) return;
    orb.activate(turretPositions[0], dirNormalized, charge);
  }

  update(delta, fleet) {
    for (const orb of this._orbs) {
      if (!orb.active) continue;
      orb.update(delta);
      if (!orb.active) continue;

      for (const npc of fleet.ships) {
        if (npc._state === 'dead') continue;
        npc.group.getWorldPosition(_tmpPos);
        const dist = _segPointDist(orb._prevPos, orb.mesh.position, _tmpPos);
        if (dist <= orb.hitDist) {
          npc.takeDamage(orb.damage);
          // Borrow rocket explosion pool for the impact flash
          const exp = this._rockets?._explosions?.find(e => !e.alive);
          if (exp) exp.trigger(orb.mesh.position.clone());
          orb.deactivate();
          break;
        }
      }
    }
  }

  dispose() { for (const o of this._orbs) o.dispose(); }
}

// ── WeaponSystem (top-level coordinator) ─────────────────────────────────────
// Owns the slot index, transient charge state, per-weapon cooldowns, and
// dispatches pressFire / releaseFire / setSlot to the right manager.
export class WeaponSystem {
  constructor(scene, ship, hud, getTarget, fleet, rockets, isDead, isDocked) {
    this._scene  = scene;
    this._ship   = ship;
    this._hud    = hud;
    this._getTarget = getTarget;
    this._fleet  = fleet;
    this._rockets = rockets;
    this._isDead   = isDead;
    this._isDocked = isDocked;

    this._lasers = new LaserManager(scene);
    this._plasma = new PlasmaManager(scene, rockets);

    // Transient state
    this._laserCooldown  = 0;        // ms
    this._laserHeld      = false;    // press-and-hold auto-fire while on slot 1
    this._plasmaCooldown = 0;
    this._plasmaCharging = false;
    this._plasmaCharge   = 0;

    // Initial HUD sync
    this._hud.setActiveWeapon(this._ship.currentWeapon);
    this._hud.setMissileAmmo(this._ship.missileAmmo, this._ship.missileAmmoMax);
    this._hud.setPlasmaCharge(0);
  }

  // ── Slot switching ────────────────────────────────────────────────────────
  setSlot(n) {
    n = Math.max(1, Math.min(3, n | 0));
    if (this._ship.currentWeapon === n) return;
    this.cancelCharge();
    this._laserHeld = false;
    this._ship.currentWeapon = n;
    this._hud.setActiveWeapon(n);
  }

  cancelCharge() {
    if (!this._plasmaCharging) return;
    this._plasmaCharging = false;
    this._plasmaCharge = 0;
    this._hud.setPlasmaCharge(0);
  }

  // ── Fire press / release ──────────────────────────────────────────────────
  pressFire() {
    if (this._isDead() || this._isDocked()) return;
    const slot = this._ship.currentWeapon;

    if (slot === 1) {
      this._laserHeld = true;
      this._tryFireLaser();
    } else if (slot === 2) {
      this._fireMissile();
    } else if (slot === 3) {
      if (this._plasmaCooldown > 0) return;
      this._plasmaCharging = true;
      this._plasmaCharge = 0;
      this._hud.setPlasmaCharge(0);
    }
  }

  releaseFire() {
    const slot = this._ship.currentWeapon;
    if (slot === 1) {
      this._laserHeld = false;
    } else if (slot === 3) {
      if (!this._plasmaCharging) return;
      const c = this._plasmaCharge;
      this._plasmaCharging = false;
      this._plasmaCharge = 0;
      this._hud.setPlasmaCharge(0);
      if (c >= PLASMA_MIN_CHARGE && !this._isDead() && !this._isDocked()) {
        this._firePlasma(c);
        this._plasmaCooldown = PLASMA_COOLDOWN_MS;
      }
    }
  }

  // ── Internal fire helpers ─────────────────────────────────────────────────
  _tryFireLaser() {
    if (this._laserCooldown > 0) return;
    if (this._isDead() || this._isDocked()) return;
    const turrets = this._ship.getTurretPositions();
    _tmpFwd.set(1, 0, 0).applyQuaternion(this._ship.quaternion);
    this._lasers.fire(turrets, _tmpFwd);
    this._laserCooldown = LASER_COOLDOWN_MS;
  }

  _fireMissile() {
    if (this._ship.missileAmmo <= 0) {
      this._hud.showCombatMessage('Out of missiles');
      this._hud.flashMissileAmmo();
      return;
    }
    const target = this._getTarget();
    if (!target) {
      this._hud.showCombatMessage('No target lock');
      return;
    }
    const npc = this._fleet.shipForMesh(target);
    if (!npc || npc._state === 'dead') return;
    const [turretPos] = this._ship.getTurretPositions();
    const dmg = this._ship.weaponDamage;
    this._rockets.fire(turretPos, target, () => npc.takeDamage(dmg));
    this._ship.missileAmmo--;
    this._hud.setMissileAmmo(this._ship.missileAmmo, this._ship.missileAmmoMax);
    this._hud.triggerFireCooldown(this._ship.weaponCooldownMs);
  }

  _firePlasma(charge) {
    const turrets = this._ship.getTurretPositions();
    _tmpFwd.set(1, 0, 0).applyQuaternion(this._ship.quaternion);
    this._plasma.fire(turrets, _tmpFwd, charge);
    this._hud.triggerFireCooldown(PLASMA_COOLDOWN_MS);
  }

  // ── Per-frame ─────────────────────────────────────────────────────────────
  handleInput(input) {
    if (input.wasPressed('Digit1')) this.setSlot(1);
    if (input.wasPressed('Digit2')) this.setSlot(2);
    if (input.wasPressed('Digit3')) this.setSlot(3);
  }

  update(delta, fleet) {
    this._laserCooldown  = Math.max(0, this._laserCooldown  - delta * 1000);
    this._plasmaCooldown = Math.max(0, this._plasmaCooldown - delta * 1000);

    if (this._laserHeld && this._ship.currentWeapon === 1) {
      this._tryFireLaser();
    }

    if (this._plasmaCharging) {
      this._plasmaCharge = Math.min(1, this._plasmaCharge + delta / PLASMA_CHARGE_TIME);
      this._hud.setPlasmaCharge(this._plasmaCharge);
    }

    this._lasers.update(delta, fleet, this._ship.laserDamage);
    this._plasma.update(delta, fleet);
  }

  dispose() {
    this._lasers.dispose();
    this._plasma.dispose();
  }
}
