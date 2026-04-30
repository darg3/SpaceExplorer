import * as THREE from 'three';

// ── Tuning ────────────────────────────────────────────────────────────────────
const APPROACH_SPEED = 250;   // m/s — slower than player cruise (400)
const APPROACH_DELAY = 10;    // seconds before NPCs start moving toward player
const MIN_DIST       = 220;   // units — transition to orbit within this range
const ORBIT_SPEED    = 180;   // units/s tangential speed while circling player
const NPC_PARTICLES  = 200;   // particle pool per ship
const EMIT_RATE      = 55;    // particles/sec at full thruster intensity
const TURN_RATE      = 2.0;   // slerp rate for orientation tracking
const FIRE_COOLDOWN_MIN = 2.5;// seconds between NPC shots (lower bound)
const FIRE_COOLDOWN_MAX = 4.5;// seconds between NPC shots (upper bound)
const FIRE_RANGE        = 700;// units — only fire when player is within range

// ── Reusable temporaries (sequential per-frame updates — no concurrency) ──────
const _fwd      = new THREE.Vector3();
const _dir      = new THREE.Vector3();
const _targetQ  = new THREE.Quaternion();
const _fromAxis = new THREE.Vector3(1, 0, 0);  // ship local forward = +X
const _worldUp  = new THREE.Vector3(0, 0, 1);  // world up for orbit tangent
const _tmpPos   = new THREE.Vector3();
const _muzzleWp = new THREE.Vector3();

// ── Colour variants ───────────────────────────────────────────────────────────
const VARIANTS = [
  {
    name:     'HUNTER-1',
    body:     0x992222, dark:    0x1a0808, accent:  0xff4422,
    glass:    0xff2200, glassEm: 0x330808, particle: 0xff4400,
    light1:   0xff2200, light2:  0xff4400,
  },
  {
    name:     'HUNTER-2',
    body:     0x1f6633, dark:    0x081a0e, accent:  0x33ff88,
    glass:    0x00cc66, glassEm: 0x082211, particle: 0x33ff66,
    light1:   0x00ff44, light2:  0x22ff66,
  },
  {
    name:     'HUNTER-3',
    body:     0x776622, dark:    0x1a1508, accent:  0xffcc33,
    glass:    0xffaa00, glassEm: 0x221a08, particle: 0xffaa22,
    light1:   0xff8800, light2:  0xffaa00,
  },
];

// ── Per-variant hull proportions ──────────────────────────────────────────────
// Small tweaks to silhouette so each ship reads differently at a glance.
const HULL_PROPS = [
  { fusTipR: 6,  fusBaseR: 14, wingSpan: 36, noseH: 34 }, // HUNTER-1: lean
  { fusTipR: 8,  fusBaseR: 18, wingSpan: 42, noseH: 38 }, // HUNTER-2: bulky
  { fusTipR: 7,  fusBaseR: 15, wingSpan: 34, noseH: 44 }, // HUNTER-3: long nose
];

// ── Spawn positions — spread around player start (origin) ─────────────────────
const SPAWN_POSITIONS = [
  new THREE.Vector3( 700,  450,  120),
  new THREE.Vector3(-550,  650, -100),
  new THREE.Vector3( 250, -700,  200),
];

// ── Material helper ───────────────────────────────────────────────────────────
const mkStd = (color, emissive = 0x000000, metalness = 0.75, roughness = 0.25) =>
  new THREE.MeshStandardMaterial({ color, emissive, metalness, roughness });

// ── NPCShip (internal) ────────────────────────────────────────────────────────
class NPCShip {
  constructor(scene, variant, spawnPos, hullProps, onDeath = null, onShoot = null) {
    this._scene   = scene;
    this._onDeath = onDeath;
    this._onShoot = onShoot;
    this._name    = variant.name;

    this.group = new THREE.Group();
    this.group.position.copy(spawnPos);
    // Slight random yaw so they don't all face the same direction at spawn
    this.group.rotation.z = (Math.random() - 0.5) * 0.5;

    this._state             = 'idle';
    this._thrusterIntensity = 0.15;
    this._emitAccum         = 0;
    this._nextParticle      = 0;

    // Stagger initial fire timer so the three hunters don't volley in lockstep
    this._fireCooldown = 1.5 + Math.random() * 2.5;
    // Local muzzle offset, just past the nose tip (nose center at x=45 + noseH/2)
    this._muzzleLocal = new THREE.Vector3(45 + hullProps.noseH + 6, 0, 0);

    this._prevPos = this.group.position.clone();
    this.velocity = new THREE.Vector3();   // world-space u/s, sampled per frame

    // Health — shield absorbs first, then armor, then hull
    this.shield = 100;
    this.armor  = 100;
    this.hull   = 100;

    this._buildHull(variant, hullProps);
    this._buildThrusters(variant);
    this._buildParticleTrail(variant);

    scene.add(this.group);
  }

  // ── Hull ──────────────────────────────────────────────────────────────────

  _buildHull(v, p) {
    const body   = mkStd(v.body,   0x000000, 0.8, 0.2);
    const dark   = mkStd(v.dark,   0x000000, 0.9, 0.15);
    const accent = mkStd(v.accent, v.accent >> 1, 0.5, 0.3);
    const glass  = new THREE.MeshStandardMaterial({
      color: v.glass, emissive: v.glassEm, emissiveIntensity: 0.6,
      metalness: 0.1, roughness: 0.0, transparent: true, opacity: 0.82,
    });

    // Fuselage — tagged as the targetable mesh for raycasting
    const fuselage = new THREE.Mesh(
      new THREE.CylinderGeometry(p.fusTipR, p.fusBaseR, 90, 20), body,
    );
    fuselage.rotation.z = -Math.PI / 2;
    fuselage.userData = { targetable: true, label: v.name, type: 'Hostile Fighter' };
    this.group.add(fuselage);
    this.fuselage = fuselage;  // exposed for NPCFleet.targetables

    // Nose cone — position accounts for varying height so base aligns with fuselage tip
    const nose = new THREE.Mesh(new THREE.ConeGeometry(p.fusTipR, p.noseH, 20), accent);
    nose.rotation.z = -Math.PI / 2;
    nose.position.x = 45 + p.noseH / 2;
    this.group.add(nose);

    // Cockpit dome
    const cockpit = new THREE.Mesh(
      new THREE.SphereGeometry(9, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.55),
      glass,
    );
    cockpit.position.set(18, 8, 0);
    cockpit.rotation.z = -0.15;
    this.group.add(cockpit);

    // Wings & engine pods (±Y)
    this._enginePositions = [];
    [-1, 1].forEach(side => {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(55, 45, 3), dark);
      wing.position.set(-8, side * p.wingSpan, 0);
      wing.rotation.z = side * 0.18;
      this.group.add(wing);

      const stripe = new THREE.Mesh(new THREE.BoxGeometry(50, 4, 3.5), accent);
      stripe.position.set(-4, side * (p.wingSpan + 17), 0);
      stripe.rotation.z = side * 0.18;
      this.group.add(stripe);

      const pod = new THREE.Mesh(new THREE.CylinderGeometry(5, 6.5, 28, 16), dark);
      pod.rotation.z = -Math.PI / 2;
      pod.position.set(-22, side * (p.wingSpan + 2), 0);
      this.group.add(pod);

      const nozzleRing = new THREE.Mesh(new THREE.TorusGeometry(5.5, 1.2, 12, 32), accent);
      nozzleRing.rotation.y = Math.PI / 2;
      nozzleRing.position.set(-37, side * (p.wingSpan + 2), 0);
      this.group.add(nozzleRing);

      this._enginePositions.push(new THREE.Vector3(-38, side * (p.wingSpan + 2), 0));
    });

    // Rear cross-fin
    const fin = new THREE.Mesh(new THREE.BoxGeometry(22, 3, 16), dark);
    fin.position.set(-35, 0, 0);
    fin.rotation.x = Math.PI / 2;
    this.group.add(fin);

    // Hull detail strips
    [0.3, -0.3].forEach(zOff => {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(70, 1.5, 1.5), accent);
      strip.position.set(0, zOff * 25, zOff > 0 ? 6 : -6);
      this.group.add(strip);
    });
  }

  // ── Thruster glow ─────────────────────────────────────────────────────────

  _buildThrusters(v) {
    this._nozzleGlows = [];

    this._thrusterLight = new THREE.PointLight(v.light1, 0, 220);
    this._thrusterLight.position.set(-50, 0, 0);
    this.group.add(this._thrusterLight);

    this._thrusterFill = new THREE.PointLight(v.light2, 0, 120);
    this._thrusterFill.position.set(-30, 0, 0);
    this.group.add(this._thrusterFill);

    const addMat = color => new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });

    this._enginePositions.forEach(pos => {
      const inner = new THREE.Mesh(new THREE.CircleGeometry(4.5, 20), addMat(v.accent));
      const outer = new THREE.Mesh(new THREE.CircleGeometry(11,   20), addMat(v.light1));
      const halo  = new THREE.Mesh(new THREE.CircleGeometry(20,   20), addMat(v.light1));

      [inner, outer, halo].forEach(m => {
        m.position.copy(pos);
        m.position.x -= 1;
        m.rotation.y = Math.PI / 2;
        this.group.add(m);
      });
      this._nozzleGlows.push({ inner, outer, halo });
    });
  }

  // ── Particle trail ────────────────────────────────────────────────────────

  _buildParticleTrail(v) {
    this._pPositions  = new Float32Array(NPC_PARTICLES * 3);
    this._pVelocities = Array.from({ length: NPC_PARTICLES }, () => new THREE.Vector3());
    this._pLife       = new Float32Array(NPC_PARTICLES);
    this._pMaxLife    = Float32Array.from(
      { length: NPC_PARTICLES }, () => 0.35 + Math.random() * 0.45,
    );

    for (let i = 0; i < NPC_PARTICLES; i++) this._pPositions[i * 3] = -1e5;

    const geo = new THREE.BufferGeometry();
    this._pPosAttr = new THREE.BufferAttribute(this._pPositions, 3);
    geo.setAttribute('position', this._pPosAttr);

    this._particleMesh = new THREE.Points(geo, new THREE.PointsMaterial({
      color:           v.particle,
      size:            5,
      sizeAttenuation: true,
      blending:        THREE.AdditiveBlending,
      transparent:     true,
      opacity:         0.85,
      depthWrite:      false,
    }));
    this._scene.add(this._particleMesh);
  }

  _spawnParticle() {
    const i = this._nextParticle++ % NPC_PARTICLES;
    const engLocal = this._enginePositions[
      Math.floor(Math.random() * this._enginePositions.length)
    ];
    const worldPos = engLocal.clone().applyMatrix4(this.group.matrixWorld);

    this._pPositions[i * 3]     = worldPos.x;
    this._pPositions[i * 3 + 1] = worldPos.y;
    this._pPositions[i * 3 + 2] = worldPos.z;

    const backward = new THREE.Vector3(-1, 0, 0).applyQuaternion(this.group.quaternion);
    const speed    = 90 + Math.random() * 70;
    this._pVelocities[i]
      .copy(backward)
      .multiplyScalar(speed)
      .addScaledVector(
        new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5),
        25,
      );
    this._pLife[i] = this._pMaxLife[i];
  }

  // ── Update (called every frame) ───────────────────────────────────────────

  update(delta, playerPos, elapsed) {
    if (this._state === 'dead') {
      // Wrecks drift at their last velocity (with friction) — no tumble
      this.group.position.addScaledVector(this._driftVel, delta);
      this._driftVel.multiplyScalar(Math.max(0, 1 - delta * 0.4));
      return;
    }

    this.group.updateMatrixWorld(true);

    // State transitions
    if (elapsed >= APPROACH_DELAY && this._state === 'idle') {
      this._state = 'approaching';
    }

    const dist = this.group.position.distanceTo(playerPos);
    let targetIntensity;

    if (this._state === 'approaching' && dist > MIN_DIST) {
      // Smoothly rotate to face the player then advance
      _dir.subVectors(playerPos, this.group.position).normalize();
      _targetQ.setFromUnitVectors(_fromAxis, _dir);
      this.group.quaternion.slerp(_targetQ, Math.min(delta * TURN_RATE, 1));

      _fwd.set(1, 0, 0).applyQuaternion(this.group.quaternion);
      this.group.position.addScaledVector(_fwd, APPROACH_SPEED * delta);

      targetIntensity = 0.55;
    } else if (this._state === 'approaching' && dist <= MIN_DIST) {
      this._state = 'orbiting';
      targetIntensity = 0.45;
    } else if (this._state === 'orbiting') {
      // Keep facing player
      _dir.subVectors(playerPos, this.group.position).normalize();
      _targetQ.setFromUnitVectors(_fromAxis, _dir);
      this.group.quaternion.slerp(_targetQ, Math.min(delta * TURN_RATE, 1));

      // Strafe tangentially (perpendicular to dir-to-player in the XY plane)
      const perp = _dir.clone().cross(_worldUp).normalize();
      this.group.position.addScaledVector(perp, ORBIT_SPEED * delta);

      // If orbit drift brings the ship too close, nudge outward
      const newDist = this.group.position.distanceTo(playerPos);
      if (newDist < MIN_DIST * 0.85) {
        _dir.subVectors(this.group.position, playerPos).normalize();
        this.group.position.addScaledVector(_dir, 80 * delta);
      }

      targetIntensity = 0.45;
    } else {
      // Idle — faint glow only
      targetIntensity = 0.15;
    }

    // ── Fire rockets at the player while engaged ──────────────────────────
    if (this._onShoot && this._state !== 'idle') {
      this._fireCooldown -= delta;
      if (this._fireCooldown <= 0) {
        if (dist <= FIRE_RANGE) {
          _muzzleWp.copy(this._muzzleLocal).applyMatrix4(this.group.matrixWorld);
          this._onShoot(_muzzleWp.clone(), this._name);
        }
        this._fireCooldown =
          FIRE_COOLDOWN_MIN + Math.random() * (FIRE_COOLDOWN_MAX - FIRE_COOLDOWN_MIN);
      }
    }

    // Lerp thruster intensity
    const rate = targetIntensity > this._thrusterIntensity ? 3.0 : 1.8;
    this._thrusterIntensity = THREE.MathUtils.clamp(
      this._thrusterIntensity +
        (targetIntensity - this._thrusterIntensity) * Math.min(delta * rate * 3, 1),
      0, 1,
    );
    const t = this._thrusterIntensity;

    // ── Nozzle glow visuals ───────────────────────────────────────────────
    this._thrusterLight.intensity = t * 9;
    this._thrusterFill.intensity  = t * 4;
    for (const { inner, outer, halo } of this._nozzleGlows) {
      inner.material.opacity = t * 0.95;
      outer.material.opacity = t * 0.6;
      halo.material.opacity  = t * 0.25;
      inner.scale.setScalar(0.7 + t * 0.8);
      outer.scale.setScalar(0.6 + t * 1.0);
      halo.scale.setScalar( 0.4 + t * 1.4);
    }

    // ── Emit particles ────────────────────────────────────────────────────
    if (t > 0.04) {
      this._emitAccum += EMIT_RATE * t * delta;
      while (this._emitAccum >= 1) {
        this._spawnParticle();
        this._emitAccum -= 1;
      }
    }

    // ── Advance existing particles ────────────────────────────────────────
    for (let i = 0; i < NPC_PARTICLES; i++) {
      if (this._pLife[i] <= 0) continue;
      this._pLife[i] -= delta;
      if (this._pLife[i] <= 0) {
        this._pPositions[i * 3] = -1e5;
        continue;
      }
      this._pPositions[i * 3]     += this._pVelocities[i].x * delta;
      this._pPositions[i * 3 + 1] += this._pVelocities[i].y * delta;
      this._pPositions[i * 3 + 2] += this._pVelocities[i].z * delta;
    }
    this._pPosAttr.needsUpdate = true;

    // Sample velocity for homing missiles (after position has been updated)
    if (delta > 0) {
      this.velocity.subVectors(this.group.position, this._prevPos).divideScalar(delta);
    }
    this._prevPos.copy(this.group.position);
  }

  // ── Health ────────────────────────────────────────────────────────────────

  takeDamage(amount) {
    if (this._state === 'dead') return;
    let rem = amount;
    const sa = Math.min(this.shield, rem); this.shield -= sa; rem -= sa;
    const aa = Math.min(this.armor,  rem); this.armor  -= aa; rem -= aa;
    this.hull = Math.max(0, this.hull - rem);
    if (this.hull <= 0) this._destroy();
  }

  _destroy() {
    this._state = 'dead';

    // Trigger blast at ship's last world position
    this.group.getWorldPosition(_tmpPos);
    this._onDeath?.(_tmpPos);

    // Kill alive-only visual elements
    this._thrusterLight.intensity = 0;
    this._thrusterFill.intensity  = 0;
    for (const { inner, outer, halo } of this._nozzleGlows) {
      inner.visible = outer.visible = halo.visible = false;
    }

    // Char the hull — darken every PBR material on the ship
    this.group.traverse(obj => {
      if (!obj.isMesh) return;
      const m = obj.material;
      if (!m || !m.color) return;
      m.color.multiplyScalar(0.18);
      if (m.emissive) m.emissive.setHex(0x000000);
      if ('metalness' in m) m.metalness = 0.3;
      if ('roughness' in m) m.roughness = 0.95;
    });

    // No more thrust particles — existing live ones fade naturally, hide the mesh
    this._particleMesh.visible = false;

    // Drift inherited from last velocity (dampened)
    this._driftVel = this.velocity.clone().multiplyScalar(0.4);
  }

  get healthPct() {
    return { shield: this.shield, armor: this.armor, hull: this.hull };
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  dispose() {
    this._particleMesh.geometry.dispose();
    this._particleMesh.material.dispose();
    this._scene.remove(this._particleMesh);
    this._scene.remove(this.group);
  }
}

// ── DeathBlast (internal) ─────────────────────────────────────────────────────
// Bigger, longer-lived than the rocket-impact Explosion: orange-white core
// + red outer ring + bright flash light. Used when an NPC's hull hits 0.

const BLAST_DURATION  = 1.0;
const BLAST_PARTICLES = 140;

class DeathBlast {
  constructor(scene) {
    this._scene = scene;
    this._age   = 0;

    this._positions  = new Float32Array(BLAST_PARTICLES * 3);
    this._velocities = Array.from({ length: BLAST_PARTICLES }, () => new THREE.Vector3());
    this._life       = new Float32Array(BLAST_PARTICLES);
    for (let i = 0; i < BLAST_PARTICLES; i++) this._positions[i * 3] = -1e5;

    const geo = new THREE.BufferGeometry();
    this._posAttr = new THREE.BufferAttribute(this._positions, 3);
    geo.setAttribute('position', this._posAttr);
    this._mesh = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xffaa33, size: 11, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, transparent: true, opacity: 0.95,
      depthWrite: false,
    }));
    scene.add(this._mesh);

    this._light = new THREE.PointLight(0xff5522, 0, 600);
    scene.add(this._light);
  }

  get alive() { return this._age > 0; }

  trigger(pos) {
    this._age = BLAST_DURATION;
    this._light.position.copy(pos);
    this._light.intensity = 24;

    for (let i = 0; i < BLAST_PARTICLES; i++) {
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      ).normalize();
      const speed = 200 + Math.random() * 300;

      this._positions[i * 3]     = pos.x;
      this._positions[i * 3 + 1] = pos.y;
      this._positions[i * 3 + 2] = pos.z;
      this._velocities[i].copy(dir).multiplyScalar(speed);
      this._life[i] = BLAST_DURATION * (0.6 + Math.random() * 0.4);
    }
    this._posAttr.needsUpdate = true;
  }

  update(delta) {
    if (!this.alive) return;
    this._age -= delta;

    const t = Math.max(0, this._age / BLAST_DURATION);
    this._light.intensity = 24 * t * t;

    for (let i = 0; i < BLAST_PARTICLES; i++) {
      if (this._life[i] <= 0) continue;
      this._life[i] -= delta;
      if (this._life[i] <= 0) { this._positions[i * 3] = -1e5; continue; }
      this._positions[i * 3]     += this._velocities[i].x * delta;
      this._positions[i * 3 + 1] += this._velocities[i].y * delta;
      this._positions[i * 3 + 2] += this._velocities[i].z * delta;
    }
    this._posAttr.needsUpdate = true;

    if (!this.alive) {
      this._light.intensity = 0;
      for (let i = 0; i < BLAST_PARTICLES; i++) this._positions[i * 3] = -1e5;
      this._posAttr.needsUpdate = true;
    }
  }

  dispose() {
    this._mesh.geometry.dispose();
    this._mesh.material.dispose();
    this._scene.remove(this._mesh);
    this._scene.remove(this._light);
  }
}

// ── NPCFleet (exported) ───────────────────────────────────────────────────────

export class NPCFleet {
  constructor(scene, onShoot = null) {
    this._blasts = Array.from({ length: 3 }, () => new DeathBlast(scene));
    this._ships  = VARIANTS.map(
      (v, i) => new NPCShip(
        scene, v, SPAWN_POSITIONS[i], HULL_PROPS[i],
        pos => this.triggerDeathBlast(pos),
        onShoot,
      ),
    );
  }

  // Fuselage meshes exposed so main.js raycaster can target NPC ships.
  // Wrecks (dead ships) are excluded so they can't be re-targeted.
  get targetables() {
    return this._ships.filter(s => s._state !== 'dead').map(s => s.fuselage);
  }

  // Look up which NPCShip owns a given mesh (used by RocketManager)
  shipForMesh(mesh) { return this._ships.find(s => s.fuselage === mesh) ?? null; }

  get ships() { return this._ships; }

  triggerDeathBlast(pos) {
    const blast = this._blasts.find(b => !b.alive);
    if (blast) blast.trigger(pos);
  }

  update(delta, playerPos, elapsed) {
    for (const s of this._ships) s.update(delta, playerPos, elapsed);
    for (const b of this._blasts) if (b.alive) b.update(delta);
  }

  dispose() {
    for (const s of this._ships) s.dispose();
    for (const b of this._blasts) b.dispose();
  }
}
