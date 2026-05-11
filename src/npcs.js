import * as THREE from 'three';

// ── Tuning (shared across all archetypes) ────────────────────────────────────
const NPC_PARTICLES  = 200;   // particle pool per ship
const EMIT_RATE      = 55;    // particles/sec at full thruster intensity
const TURN_RATE      = 2.0;   // slerp rate for orientation tracking
const WRECK_DESPAWN  = 30;    // seconds a wreck lingers before disposal

// ── Reusable temporaries (sequential per-frame updates — no concurrency) ──────
const _fwd      = new THREE.Vector3();
const _dir      = new THREE.Vector3();
const _targetQ  = new THREE.Quaternion();
const _fromAxis = new THREE.Vector3(1, 0, 0);  // ship local forward = +X
const _worldUp  = new THREE.Vector3(0, 0, 1);  // world up for orbit tangent
const _tmpPos   = new THREE.Vector3();
const _muzzleWp = new THREE.Vector3();
const _perp     = new THREE.Vector3();   // orbit-state strafe direction
const _spawnWp  = new THREE.Vector3();   // particle spawn world position
const _spawnBack = new THREE.Vector3();   // particle backward direction
const _spawnJit  = new THREE.Vector3();   // particle jitter

// ── Archetypes ────────────────────────────────────────────────────────────────
// Each archetype is the full per-type spec: visuals, hull silhouette, stats,
// AI tuning, weapon cadence. Wave difficulty is layered on at construction
// via a multiplier object {hp, dmg}.

export const ARCHETYPES = {
  scout: {
    name: 'SCOUT',
    type: 'Hostile Scout',
    scale: 0.78,
    shield: 50, armor: 50, hull: 50,
    approachSpeed: 320, orbitSpeed: 230, minDist: 200,
    fireCooldownMin: 1.4, fireCooldownMax: 2.6,
    fireRange: 720, fireDamage: 2,
    burstCount: 1, burstSpacing: 0,
    isBoss: false,
    variant: {
      body: 0x992222, dark: 0x1a0808, accent: 0xff4422,
      glass: 0xff2200, glassEm: 0x330808, particle: 0xff4400,
      light1: 0xff2200, light2: 0xff4400,
    },
    hullProps: { fusTipR: 5, fusBaseR: 12, wingSpan: 32, noseH: 32 },
  },
  heavy: {
    name: 'HEAVY',
    type: 'Hostile Heavy',
    scale: 1.15,
    shield: 160, armor: 160, hull: 160,
    approachSpeed: 200, orbitSpeed: 140, minDist: 260,
    fireCooldownMin: 3.0, fireCooldownMax: 5.0,
    fireRange: 800, fireDamage: 6,
    burstCount: 1, burstSpacing: 0,
    isBoss: false,
    variant: {
      body: 0x1f6633, dark: 0x081a0e, accent: 0x33ff88,
      glass: 0x00cc66, glassEm: 0x082211, particle: 0x33ff66,
      light1: 0x00ff44, light2: 0x22ff66,
    },
    hullProps: { fusTipR: 9, fusBaseR: 20, wingSpan: 46, noseH: 40 },
  },
  boss: {
    name: 'DREADNOUGHT',
    type: 'Hostile Boss',
    scale: 2.2,
    shield: 600, armor: 600, hull: 600,
    approachSpeed: 160, orbitSpeed: 120, minDist: 360,
    fireCooldownMin: 2.5, fireCooldownMax: 3.5,
    fireRange: 1100, fireDamage: 5,
    burstCount: 3, burstSpacing: 0.12,
    isBoss: true,
    variant: {
      body: 0x551166, dark: 0x110318, accent: 0xff44cc,
      glass: 0xff22aa, glassEm: 0x330522, particle: 0xff66dd,
      light1: 0xff22aa, light2: 0xff88ee,
    },
    hullProps: { fusTipR: 11, fusBaseR: 26, wingSpan: 60, noseH: 56 },
  },
};

// ── Material helper ───────────────────────────────────────────────────────────
const mkStd = (color, emissive = 0x000000, metalness = 0.75, roughness = 0.25) =>
  new THREE.MeshStandardMaterial({ color, emissive, metalness, roughness });

// ── Per-archetype shared resources ────────────────────────────────────────────
// Hull materials are identical across every ship of the same archetype, so we
// build them once and reuse. This eliminates per-spawn allocation churn AND
// keeps Three.js's shader-program cache hot — only the FIRST ship of an
// archetype triggers a shader compile (and even that is moved to startup by
// NPCFleet.prewarm). Nozzle materials stay per-ship because their opacity is
// animated independently per ship's thruster intensity.
const _archResources = new WeakMap();

function _getArchResources(arch) {
  let r = _archResources.get(arch);
  if (r) return r;
  const v = arch.variant;
  r = {
    materials: {
      body:   mkStd(v.body, 0x000000, 0.8, 0.2),
      dark:   mkStd(v.dark, 0x000000, 0.9, 0.15),
      accent: mkStd(v.accent, v.accent >> 1, 0.5, 0.3),
      glass:  new THREE.MeshStandardMaterial({
        color: v.glass, emissive: v.glassEm, emissiveIntensity: 0.6,
        metalness: 0.1, roughness: 0.0, transparent: true, opacity: 0.82,
      }),
      particle: new THREE.PointsMaterial({
        color: v.particle, size: 5, sizeAttenuation: true,
        blending: THREE.AdditiveBlending, transparent: true, opacity: 0.85,
        depthWrite: false,
      }),
    },
  };
  _archResources.set(arch, r);
  return r;
}

// Single global hitbox material — invisible, no per-ship state, never mutated.
const _SHARED_HITBOX_MAT = new THREE.MeshBasicMaterial({ visible: false });

// ── NPCShip (internal) ────────────────────────────────────────────────────────
class NPCShip {
  constructor(scene, archetype, spawnPos, mult, label, onDeath = null, onShoot = null) {
    this._scene   = scene;
    this._onDeath = onDeath;
    this._onShoot = onShoot;
    this._arch    = archetype;
    this._name    = label;

    const v = archetype.variant;
    const p = archetype.hullProps;

    this.group = new THREE.Group();
    this.group.position.copy(spawnPos);
    this.group.scale.setScalar(archetype.scale);
    // Slight random yaw so they don't all face the same direction at spawn
    this.group.rotation.z = (Math.random() - 0.5) * 0.5;

    this._state             = 'idle';
    this._thrusterIntensity = 0.15;
    this._emitAccum         = 0;
    this._nextParticle      = 0;
    this._deadAge           = 0;
    this._disposable        = false;
    this._burstQueue        = 0;     // remaining shots in current burst
    this._burstTimer        = 0;     // delay until next shot in burst

    // Stagger initial fire timer so co-spawned ships don't volley in lockstep
    this._fireCooldown = 1.5 + Math.random() * 2.5;
    // Local muzzle offset, just past the nose tip (nose center at x=45 + noseH/2)
    this._muzzleLocal = new THREE.Vector3(45 + p.noseH + 6, 0, 0);

    this._prevPos = this.group.position.clone();
    this.velocity = new THREE.Vector3();   // world-space u/s, sampled per frame

    // Health — shield absorbs first, then armor, then hull. Per-wave HP scaling.
    const hp = mult?.hp ?? 1;
    this.shield = archetype.shield * hp;
    this.armor  = archetype.armor  * hp;
    this.hull   = archetype.hull   * hp;
    this.maxShield = this.shield;
    this.maxArmor  = this.armor;
    this.maxHull   = this.hull;

    // Per-ship rocket damage (read by main.js when forwarding the fire callback)
    this.dmg = archetype.fireDamage * (mult?.dmg ?? 1);

    this._buildHull(archetype, v, p);
    this._buildThrusters(v);
    this._buildParticleTrail(archetype);

    scene.add(this.group);
  }

  // ── Hull ──────────────────────────────────────────────────────────────────

  _buildHull(arch, v, p) {
    const M = _getArchResources(arch).materials;
    const body   = M.body;
    const dark   = M.dark;
    const accent = M.accent;
    const glass  = M.glass;

    // Fuselage — visible hull mesh (no longer the targetable proxy)
    const fuselage = new THREE.Mesh(
      new THREE.CylinderGeometry(p.fusTipR, p.fusBaseR, 90, 20), body,
    );
    fuselage.rotation.z = -Math.PI / 2;
    this.group.add(fuselage);
    this.fuselage = fuselage;

    // Invisible hitbox — generous click radius around the ship so the player
    // can lock on without precision-aiming. Boss gets a fatter hitbox.
    const hitR = arch.isBoss ? 130 : 95;
    const hitbox = new THREE.Mesh(
      new THREE.SphereGeometry(hitR, 8, 6),
      _SHARED_HITBOX_MAT,
    );
    hitbox.userData = { targetable: true, label: this._name, type: arch.type };
    this.group.add(hitbox);
    this.hitbox = hitbox;  // exposed for NPCFleet.targetables

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

    // Boss-only crown ring — visually distinguishes the dreadnought silhouette.
    if (arch.isBoss) {
      const crown = new THREE.Mesh(
        new THREE.TorusGeometry(28, 2.4, 12, 36), accent,
      );
      crown.rotation.y = Math.PI / 2;
      crown.position.set(8, 0, 0);
      this.group.add(crown);
    }
  }

  // ── Thruster glow ─────────────────────────────────────────────────────────

  _buildThrusters(v) {
    this._nozzleGlows = [];

    // No PointLights here — every dynamically-added PointLight changes the
    // scene's NUM_POINT_LIGHTS, which forces Three.js to recompile every
    // MeshStandardMaterial shader in the scene. With NPCs spawning per wave
    // that produced multi-hundred-millisecond stutters on every wave start.
    // The visible thruster effect comes entirely from the additive-blending
    // nozzle meshes below (MeshBasicMaterial doesn't read scene lights).

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

  _buildParticleTrail(arch) {
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

    // Particle material is shared per archetype — same color/size/blending for
    // every ship of the type, no per-ship state animated on it.
    this._particleMesh = new THREE.Points(geo, _getArchResources(arch).materials.particle);
    this._scene.add(this._particleMesh);
  }

  _spawnParticle() {
    const i = this._nextParticle++ % NPC_PARTICLES;
    const engLocal = this._enginePositions[
      Math.floor(Math.random() * this._enginePositions.length)
    ];
    _spawnWp.copy(engLocal).applyMatrix4(this.group.matrixWorld);

    this._pPositions[i * 3]     = _spawnWp.x;
    this._pPositions[i * 3 + 1] = _spawnWp.y;
    this._pPositions[i * 3 + 2] = _spawnWp.z;

    _spawnBack.set(-1, 0, 0).applyQuaternion(this.group.quaternion);
    const speed = 90 + Math.random() * 70;
    _spawnJit.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    this._pVelocities[i]
      .copy(_spawnBack)
      .multiplyScalar(speed)
      .addScaledVector(_spawnJit, 25);
    this._pLife[i] = this._pMaxLife[i];
  }

  _fireOnce() {
    _muzzleWp.copy(this._muzzleLocal).applyMatrix4(this.group.matrixWorld);
    this._onShoot(_muzzleWp.clone(), this._name, this.dmg);
  }

  // ── Update (called every frame) ───────────────────────────────────────────

  update(delta, playerPos) {
    if (this._state === 'dead') {
      // Wrecks drift at their last velocity (with friction) — no tumble
      this.group.position.addScaledVector(this._driftVel, delta);
      this._driftVel.multiplyScalar(Math.max(0, 1 - delta * 0.4));

      // Fade hull then mark for disposal once the timer expires
      this._deadAge += delta;
      if (this._deadAge > WRECK_DESPAWN - 2) {
        const t = Math.max(0, (WRECK_DESPAWN - this._deadAge) / 2);
        this.group.traverse(obj => {
          if (!obj.isMesh) return;
          if (obj.material && 'opacity' in obj.material) {
            obj.material.transparent = true;
            obj.material.opacity = t;
          }
        });
      }
      if (this._deadAge >= WRECK_DESPAWN) this._disposable = true;
      return;
    }

    this.group.updateMatrixWorld(true);

    const arch = this._arch;
    const dist = this.group.position.distanceTo(playerPos);
    let targetIntensity;

    // State transitions: scouts/heavies/bosses all start engaging immediately
    // — the WaveManager owns spawn-time pacing now, no global APPROACH_DELAY.
    if (this._state === 'idle') this._state = 'approaching';

    if (this._state === 'approaching' && dist > arch.minDist) {
      // Smoothly rotate to face the player then advance
      _dir.subVectors(playerPos, this.group.position).normalize();
      _targetQ.setFromUnitVectors(_fromAxis, _dir);
      this.group.quaternion.slerp(_targetQ, Math.min(delta * TURN_RATE, 1));

      _fwd.set(1, 0, 0).applyQuaternion(this.group.quaternion);
      this.group.position.addScaledVector(_fwd, arch.approachSpeed * delta);

      targetIntensity = 0.55;
    } else if (this._state === 'approaching' && dist <= arch.minDist) {
      this._state = 'orbiting';
      targetIntensity = 0.45;
    } else if (this._state === 'orbiting') {
      // Keep facing player
      _dir.subVectors(playerPos, this.group.position).normalize();
      _targetQ.setFromUnitVectors(_fromAxis, _dir);
      this.group.quaternion.slerp(_targetQ, Math.min(delta * TURN_RATE, 1));

      // Strafe tangentially (perpendicular to dir-to-player in the XY plane)
      _perp.copy(_dir).cross(_worldUp).normalize();
      this.group.position.addScaledVector(_perp, arch.orbitSpeed * delta);

      // If orbit drift brings the ship too close, nudge outward
      const newDist = this.group.position.distanceTo(playerPos);
      if (newDist < arch.minDist * 0.85) {
        _dir.subVectors(this.group.position, playerPos).normalize();
        this.group.position.addScaledVector(_dir, 80 * delta);
      }

      targetIntensity = 0.45;
    } else {
      targetIntensity = 0.15;
    }

    // ── Fire rockets at the player while engaged ──────────────────────────
    if (this._onShoot && this._state !== 'idle') {
      // In-burst follow-up shots take priority over the cooldown clock
      if (this._burstQueue > 0) {
        this._burstTimer -= delta;
        if (this._burstTimer <= 0 && dist <= arch.fireRange) {
          this._fireOnce();
          this._burstQueue -= 1;
          this._burstTimer = arch.burstSpacing;
        }
      } else {
        this._fireCooldown -= delta;
        if (this._fireCooldown <= 0) {
          if (dist <= arch.fireRange) {
            this._fireOnce();
            // Queue the rest of the burst (boss-only typically)
            if (arch.burstCount > 1) {
              this._burstQueue = arch.burstCount - 1;
              this._burstTimer = arch.burstSpacing;
            }
          }
          this._fireCooldown =
            arch.fireCooldownMin + Math.random() * (arch.fireCooldownMax - arch.fireCooldownMin);
        }
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
    this._onDeath?.(_tmpPos, this._arch);

    // Kill alive-only visual elements
    for (const { inner, outer, halo } of this._nozzleGlows) {
      inner.visible = outer.visible = halo.visible = false;
    }

    // Char the hull — darken every PBR material on the ship. Hull materials
    // are SHARED across live ships of this archetype, so we clone each mesh's
    // material before mutating; otherwise darkening one wreck would dim every
    // other ship of the same type. Cheap (~5 clones per death, no shader
    // recompile since color/emissive/metalness/roughness are uniforms).
    this.group.traverse(obj => {
      if (!obj.isMesh) return;
      const m = obj.material;
      if (!m || !m.color) return;
      const wm = m.clone();
      wm.color.multiplyScalar(0.18);
      if (wm.emissive) wm.emissive.setHex(0x000000);
      if ('metalness' in wm) wm.metalness = 0.3;
      if ('roughness' in wm) wm.roughness = 0.95;
      obj.material = wm;
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
    // Particle geometry is per-ship; particle material is shared per archetype
    // and reused by other ships, so do not dispose it here.
    this._particleMesh.geometry.dispose();
    this._scene.remove(this._particleMesh);

    // Skip shared archetype materials and the shared invisible hitbox material
    // when disposing — they're still in use by other live ships. Per-ship
    // geometries (cylinders, cones, boxes, nozzle circles) and per-wreck
    // cloned hull materials are safe to dispose.
    const sharedMats = _getArchResources(this._arch).materials;
    const isShared = m => (
      m === sharedMats.body || m === sharedMats.dark ||
      m === sharedMats.accent || m === sharedMats.glass ||
      m === sharedMats.particle || m === _SHARED_HITBOX_MAT
    );
    this.group.traverse(obj => {
      if (!obj.isMesh) return;
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material && !isShared(obj.material)) obj.material.dispose();
    });
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
// Constructor no longer spawns ships — call fleet.spawn(archId, pos, mult)
// per-wave. Ships register their own `dmg` for the rocket damage callback.

export class NPCFleet {
  constructor(scene, onShoot = null, onDeath = null) {
    this._scene   = scene;
    this._onShoot = onShoot;
    this._onDeath = onDeath;
    this._blasts  = Array.from({ length: 5 }, () => new DeathBlast(scene));
    this._ships   = [];
    this._labelCounter = { scout: 0, heavy: 0, boss: 0 };
  }

  // Pre-compile shaders for every archetype at startup, so the first wave
  // doesn't stutter when Three.js compiles the body/glass/nozzle/particle
  // shaders for the first time. Spawns one warmup ship per archetype far
  // below the world, calls renderer.compile (sync — walks the scene graph
  // and forces shader compilation), then disposes the warmups. Also seeds
  // the per-archetype material cache (subsequent ships reuse those mats).
  prewarm(renderer, scene, camera) {
    const farPos = new THREE.Vector3(0, 0, -1e7);
    const warmups = [];
    for (const archetypeId of Object.keys(ARCHETYPES)) {
      warmups.push(this.spawn(archetypeId, farPos, { hp: 1, dmg: 1 }));
    }
    renderer.compile(scene, camera);
    for (const ship of warmups) {
      ship.dispose();
      const idx = this._ships.indexOf(ship);
      if (idx !== -1) this._ships.splice(idx, 1);
    }
    // Reset spawn counters so the first real wave's labels are -1, -2, ...
    this._labelCounter = { scout: 0, heavy: 0, boss: 0 };
  }

  spawn(archetypeId, position, mult = { hp: 1, dmg: 1 }) {
    const arch = ARCHETYPES[archetypeId];
    if (!arch) throw new Error(`Unknown archetype: ${archetypeId}`);

    const idx = ++this._labelCounter[archetypeId];
    const label = arch.isBoss ? arch.name : `${arch.name}-${idx}`;

    const ship = new NPCShip(
      this._scene, arch, position, mult, label,
      (deathPos, deadArch) => {
        this.triggerDeathBlast(deathPos);
        // Boss death — second blast for emphasis, plus extra loot
        if (deadArch.isBoss) {
          setTimeout(() => this.triggerDeathBlast(deathPos), 200);
          setTimeout(() => this.triggerDeathBlast(deathPos), 420);
        }
        this._onDeath?.(deathPos, deadArch);
      },
      this._onShoot,
    );
    this._ships.push(ship);
    return ship;
  }

  // Hitbox meshes exposed so main.js raycaster can target NPC ships.
  // Wrecks (dead ships) are excluded so they can't be re-targeted.
  get targetables() {
    return this._ships.filter(s => s._state !== 'dead').map(s => s.hitbox);
  }

  get aliveCount() {
    let n = 0;
    for (const s of this._ships) if (s._state !== 'dead') n++;
    return n;
  }

  // Look up which NPCShip owns a given mesh (used by RocketManager)
  shipForMesh(mesh) { return this._ships.find(s => s.hitbox === mesh) ?? null; }

  get ships() { return this._ships; }

  triggerDeathBlast(pos) {
    const blast = this._blasts.find(b => !b.alive);
    if (blast) blast.trigger(pos);
  }

  update(delta, playerPos) {
    for (const s of this._ships) s.update(delta, playerPos);
    for (const b of this._blasts) if (b.alive) b.update(delta);

    // Reap any wrecks past their despawn timer
    for (let i = this._ships.length - 1; i >= 0; i--) {
      const s = this._ships[i];
      if (s._disposable) {
        s.dispose();
        this._ships.splice(i, 1);
      }
    }
  }

  dispose() {
    for (const s of this._ships) s.dispose();
    for (const b of this._blasts) b.dispose();
  }
}
