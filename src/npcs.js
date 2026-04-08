import * as THREE from 'three';

// ── Tuning ────────────────────────────────────────────────────────────────────
const APPROACH_SPEED = 250;   // m/s — slower than player cruise (400)
const APPROACH_DELAY = 10;    // seconds before NPCs start moving toward player
const MIN_DIST       = 220;   // units — transition to orbit within this range
const ORBIT_SPEED    = 180;   // units/s tangential speed while circling player
const NPC_PARTICLES  = 200;   // particle pool per ship
const EMIT_RATE      = 55;    // particles/sec at full thruster intensity
const TURN_RATE      = 2.0;   // slerp rate for orientation tracking

// ── Reusable temporaries (sequential per-frame updates — no concurrency) ──────
const _fwd      = new THREE.Vector3();
const _dir      = new THREE.Vector3();
const _targetQ  = new THREE.Quaternion();
const _fromAxis = new THREE.Vector3(1, 0, 0);  // ship local forward = +X
const _worldUp  = new THREE.Vector3(0, 0, 1);  // world up for orbit tangent

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
  constructor(scene, variant, spawnPos, hullProps) {
    this._scene  = scene;

    this.group = new THREE.Group();
    this.group.position.copy(spawnPos);
    // Slight random yaw so they don't all face the same direction at spawn
    this.group.rotation.z = (Math.random() - 0.5) * 0.5;

    this._state             = 'idle';
    this._thrusterIntensity = 0.15;
    this._emitAccum         = 0;
    this._nextParticle      = 0;

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
    if (this._state === 'dead') return;

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
    this.group.visible          = false;
    this._particleMesh.visible  = false;
    this._state = 'dead';
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

// ── NPCFleet (exported) ───────────────────────────────────────────────────────

export class NPCFleet {
  constructor(scene) {
    this._ships = VARIANTS.map(
      (v, i) => new NPCShip(scene, v, SPAWN_POSITIONS[i], HULL_PROPS[i]),
    );
  }

  // Fuselage meshes exposed so main.js raycaster can target NPC ships
  get targetables() { return this._ships.map(s => s.fuselage); }

  // Look up which NPCShip owns a given mesh (used by RocketManager)
  shipForMesh(mesh) { return this._ships.find(s => s.fuselage === mesh) ?? null; }

  get ships() { return this._ships; }

  update(delta, playerPos, elapsed) {
    for (const s of this._ships) s.update(delta, playerPos, elapsed);
  }

  dispose() {
    for (const s of this._ships) s.dispose();
  }
}
