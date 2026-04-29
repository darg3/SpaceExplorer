import * as THREE from 'three';

// ── Tuning ────────────────────────────────────────────────────────────────────
const ROCKET_SPEED   = 800;   // units/s
const ROCKET_LIFE    = 4.0;   // seconds before auto-destruct
const ROCKET_DAMAGE  = 25;    // hp per hit
const DETONATE_DIST  = 18;    // world units — close enough = hit
const MAX_ROCKETS    = 20;    // pool size
const EXP_DURATION   = 0.55;  // seconds explosion lasts
const EXP_PARTICLES  = 80;
const TURN_RATE      = 3.5;   // homing slerp rate
const TRAIL_COUNT    = 30;    // particles per rocket trail

// ── Reusable temporaries ──────────────────────────────────────────────────────
const _rktDir    = new THREE.Vector3();
const _rktTargQ  = new THREE.Quaternion();
const _rktFwd    = new THREE.Vector3();
const _rktPos    = new THREE.Vector3();

// ── Rocket (internal) ─────────────────────────────────────────────────────────
class Rocket {
  constructor(scene) {
    this._scene = scene;
    this._life  = 0;
    this._target = null;

    // ── Mesh ─────────────────────────────────────────────────────────────────
    this.group = new THREE.Group();

    const mat = new THREE.MeshStandardMaterial({
      color: 0x88ccff, emissive: 0x224466,
      emissiveIntensity: 0.8, metalness: 0.6, roughness: 0.3,
    });

    // Body cylinder along +X
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 14, 8), mat);
    body.rotation.z = -Math.PI / 2;
    this.group.add(body);

    // Nose cone
    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.2, 6, 8), mat);
    nose.rotation.z = -Math.PI / 2;
    nose.position.x = 10;
    this.group.add(nose);

    // Thruster glow light
    this._light = new THREE.PointLight(0x4488ff, 0, 120);
    this._light.position.set(-8, 0, 0);
    this.group.add(this._light);

    this.group.visible = false;
    scene.add(this.group);

    // ── Particle trail ────────────────────────────────────────────────────────
    this._tPositions  = new Float32Array(TRAIL_COUNT * 3);
    this._tVelocities = Array.from({ length: TRAIL_COUNT }, () => new THREE.Vector3());
    this._tLife       = new Float32Array(TRAIL_COUNT);
    this._tMaxLife    = Float32Array.from(
      { length: TRAIL_COUNT }, () => 0.12 + Math.random() * 0.18,
    );
    for (let i = 0; i < TRAIL_COUNT; i++) this._tPositions[i * 3] = -1e5;

    const tGeo = new THREE.BufferGeometry();
    this._tPosAttr = new THREE.BufferAttribute(this._tPositions, 3);
    tGeo.setAttribute('position', this._tPosAttr);
    this._trailMesh = new THREE.Points(tGeo, new THREE.PointsMaterial({
      color: 0x88ccff, size: 4, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, transparent: true, opacity: 0.8,
      depthWrite: false,
    }));
    scene.add(this._trailMesh);

    this._tNext = 0;
    this._tAccum = 0;
  }

  get active() { return this._life > 0; }

  activate(pos, targetMesh) {
    this._life   = ROCKET_LIFE;
    this._target = targetMesh;
    this.group.position.copy(pos);

    // Aim initial orientation toward target
    targetMesh.getWorldPosition(_rktPos);
    _rktDir.subVectors(_rktPos, pos).normalize();
    if (_rktDir.lengthSq() > 0) {
      this.group.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), _rktDir);
    }

    this.group.visible  = true;
    this._light.intensity = 0.8;
    this._tAccum = 0;
  }

  deactivate() {
    this._life   = 0;
    this._target = null;
    this.group.visible    = false;
    this._light.intensity = 0;
    // Hide trail particles
    for (let i = 0; i < TRAIL_COUNT; i++) this._tPositions[i * 3] = -1e5;
    this._tPosAttr.needsUpdate = true;
  }

  update(delta) {
    if (!this.active) return;

    this._life -= delta;
    if (this._life <= 0) { this.deactivate(); return; }

    this.group.updateMatrixWorld(true);

    // ── Homing ───────────────────────────────────────────────────────────────
    if (this._target && this._target.parent) {
      this._target.getWorldPosition(_rktPos);
      _rktFwd.set(1, 0, 0).applyQuaternion(this.group.quaternion);
      _rktDir.subVectors(_rktPos, this.group.position).normalize();

      // Only slerp if direction differs (avoid NaN from setFromUnitVectors with parallel vecs)
      const dot = _rktFwd.dot(_rktDir);
      if (dot < 0.9999) {
        _rktTargQ.setFromUnitVectors(_rktFwd, _rktDir);
        this.group.quaternion.slerp(
          this.group.quaternion.clone().premultiply(_rktTargQ),
          Math.min(delta * TURN_RATE, 1),
        );
      }
    }

    // ── Advance along local +X ────────────────────────────────────────────────
    _rktFwd.set(1, 0, 0).applyQuaternion(this.group.quaternion);
    this.group.position.addScaledVector(_rktFwd, ROCKET_SPEED * delta);

    // ── Emit trail ────────────────────────────────────────────────────────────
    this._tAccum += 120 * delta;
    while (this._tAccum >= 1) {
      this._spawnTrailParticle();
      this._tAccum -= 1;
    }

    // ── Advance trail particles ───────────────────────────────────────────────
    for (let i = 0; i < TRAIL_COUNT; i++) {
      if (this._tLife[i] <= 0) continue;
      this._tLife[i] -= delta;
      if (this._tLife[i] <= 0) { this._tPositions[i * 3] = -1e5; continue; }
      this._tPositions[i * 3]     += this._tVelocities[i].x * delta;
      this._tPositions[i * 3 + 1] += this._tVelocities[i].y * delta;
      this._tPositions[i * 3 + 2] += this._tVelocities[i].z * delta;
    }
    this._tPosAttr.needsUpdate = true;
  }

  _spawnTrailParticle() {
    const i = this._tNext++ % TRAIL_COUNT;
    // Spawn at rocket tail (local -X)
    const tail = new THREE.Vector3(-8, 0, 0).applyMatrix4(this.group.matrixWorld);
    this._tPositions[i * 3]     = tail.x;
    this._tPositions[i * 3 + 1] = tail.y;
    this._tPositions[i * 3 + 2] = tail.z;

    // Velocity: mostly backward + small spread
    const back = new THREE.Vector3(-1, 0, 0).applyQuaternion(this.group.quaternion);
    const speed = 40 + Math.random() * 40;
    this._tVelocities[i]
      .copy(back)
      .multiplyScalar(speed)
      .addScaledVector(
        new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5),
        15,
      );
    this._tLife[i] = this._tMaxLife[i];
  }

  // Returns current world position
  getWorldPosition(out) { return this.group.getWorldPosition(out); }

  dispose() {
    this._trailMesh.geometry.dispose();
    this._trailMesh.material.dispose();
    this._scene.remove(this._trailMesh);
    this._scene.remove(this.group);
  }
}

// ── Explosion (internal) ──────────────────────────────────────────────────────
class Explosion {
  constructor(scene) {
    this._scene = scene;
    this._age   = 0;

    // ── Particles ────────────────────────────────────────────────────────────
    this._ePositions  = new Float32Array(EXP_PARTICLES * 3);
    this._eVelocities = Array.from({ length: EXP_PARTICLES }, () => new THREE.Vector3());
    this._eLife       = new Float32Array(EXP_PARTICLES);

    for (let i = 0; i < EXP_PARTICLES; i++) this._ePositions[i * 3] = -1e5;

    const geo = new THREE.BufferGeometry();
    this._ePosAttr = new THREE.BufferAttribute(this._ePositions, 3);
    geo.setAttribute('position', this._ePosAttr);
    this._mesh = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xff6622, size: 7, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, transparent: true, opacity: 0.9,
      depthWrite: false,
    }));
    scene.add(this._mesh);

    // ── Flash light ──────────────────────────────────────────────────────────
    this._light = new THREE.PointLight(0xff4400, 0, 350);
    scene.add(this._light);
  }

  get alive() { return this._age > 0; }

  trigger(pos) {
    this._age = EXP_DURATION;
    this._light.position.copy(pos);
    this._light.intensity = 14;

    for (let i = 0; i < EXP_PARTICLES; i++) {
      // Random sphere direction
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      ).normalize();
      const speed = 120 + Math.random() * 180;

      this._ePositions[i * 3]     = pos.x;
      this._ePositions[i * 3 + 1] = pos.y;
      this._ePositions[i * 3 + 2] = pos.z;
      this._eVelocities[i].copy(dir).multiplyScalar(speed);
      this._eLife[i] = EXP_DURATION * (0.6 + Math.random() * 0.4);
    }
    this._ePosAttr.needsUpdate = true;
  }

  update(delta) {
    if (!this.alive) return;
    this._age -= delta;

    // Fade light
    const t = Math.max(0, this._age / EXP_DURATION);
    this._light.intensity = 14 * t * t;

    // Advance particles
    for (let i = 0; i < EXP_PARTICLES; i++) {
      if (this._eLife[i] <= 0) continue;
      this._eLife[i] -= delta;
      if (this._eLife[i] <= 0) { this._ePositions[i * 3] = -1e5; continue; }
      this._ePositions[i * 3]     += this._eVelocities[i].x * delta;
      this._ePositions[i * 3 + 1] += this._eVelocities[i].y * delta;
      this._ePositions[i * 3 + 2] += this._eVelocities[i].z * delta;
    }
    this._ePosAttr.needsUpdate = true;

    if (!this.alive) {
      this._light.intensity = 0;
      for (let i = 0; i < EXP_PARTICLES; i++) this._ePositions[i * 3] = -1e5;
      this._ePosAttr.needsUpdate = true;
    }
  }

  dispose() {
    this._mesh.geometry.dispose();
    this._mesh.material.dispose();
    this._scene.remove(this._mesh);
    this._scene.remove(this._light);
  }
}

// ── RocketManager (exported) ──────────────────────────────────────────────────
const _detPos = new THREE.Vector3();

export class RocketManager {
  constructor(scene) {
    this._scene     = scene;
    this._rockets   = Array.from({ length: MAX_ROCKETS }, () => new Rocket(scene));
    this._explosions = Array.from({ length: 4 }, () => new Explosion(scene));
  }

  // Launch a rocket from originPos homing on targetMesh.
  fire(originPos, targetMesh) {
    const rocket = this._rockets.find(r => !r.active);
    if (!rocket) return;   // pool exhausted — just drop the shot
    rocket.activate(originPos, targetMesh);
  }

  update(delta, npcFleet) {
    for (const rocket of this._rockets) {
      if (!rocket.active) continue;
      rocket.update(delta);
      if (!rocket.active) continue;   // may have expired inside update

      // ── Hit detection ─────────────────────────────────────────────────────
      if (rocket._target && rocket._target.parent) {
        rocket._target.getWorldPosition(_detPos);
        const dist = rocket.group.position.distanceTo(_detPos);
        if (dist <= DETONATE_DIST) {
          this._detonate(rocket, npcFleet);
        }
      } else {
        // Target destroyed / removed — self-destruct rocket
        rocket.deactivate();
      }
    }

    for (const exp of this._explosions) {
      if (exp.alive) exp.update(delta);
    }
  }

  _detonate(rocket, npcFleet) {
    // Trigger visual explosion at rocket's current position
    const exp = this._explosions.find(e => !e.alive);
    if (exp) exp.trigger(rocket.group.position.clone());

    // Apply damage to the NPC that owns the target mesh
    const npcShip = npcFleet.shipForMesh(rocket._target);
    if (npcShip) npcShip.takeDamage(ROCKET_DAMAGE);

    rocket.deactivate();
  }

  dispose() {
    for (const r of this._rockets) r.dispose();
    for (const e of this._explosions) e.dispose();
  }
}
