import * as THREE from 'three';

// ── Tuning ────────────────────────────────────────────────────────────────────
const CRUISE_SPEED        = 400;   // world units / second
const MAX_SHIELD = 100;
const MAX_ARMOR  = 100;
const MAX_HULL   = 100;
const BOOST_SPEED         = 1000;
const PITCH_RATE          = 1.2;   // radians / second
const YAW_RATE            = 1.2;
const ROLL_RATE           = 1.8;
const THRUSTER_UP_RATE    = 3.0;
const THRUSTER_DOWN_RATE  = 1.8;
const PARTICLE_COUNT      = 600;
const PARTICLE_EMIT_RATE  = 80;

// ── Reusable temporaries (avoid GC) ──────────────────────────────────────────
const _fwd    = new THREE.Vector3();
const _pitchQ = new THREE.Quaternion();
const _yawQ   = new THREE.Quaternion();
const _rollQ  = new THREE.Quaternion();
const _AX     = new THREE.Vector3(1, 0, 0);
const _AY     = new THREE.Vector3(0, 1, 0);
const _AZ     = new THREE.Vector3(0, 0, 1);

// ── Materials ─────────────────────────────────────────────────────────────────
const mkStd = (color, emissive = 0x000000, metalness = 0.75, roughness = 0.25) =>
  new THREE.MeshStandardMaterial({ color, emissive, metalness, roughness });

export class Ship {
  constructor(scene, input) {
    this._scene  = scene;
    this._input  = input;
    this.group   = new THREE.Group();
    this.thrusterIntensity = 0.45;
    this.engineOn          = true;          // toggled by HUD buttons; false = no thrust, glow fades to 0
    this.targetSpeed       = CRUISE_SPEED;  // desired speed set by HUD bar (0–BOOST_SPEED)
    this.speed             = 0;             // lerped current speed (m/s), read by HUD each frame
    this.shield            = MAX_SHIELD;
    this.armor             = MAX_ARMOR;
    this.hull              = MAX_HULL;
    this._emitAccum      = 0;
    this._nextParticle   = 0;

    this._buildHull();
    this._buildThrusters();
    this._buildParticleTrail();

    scene.add(this.group);
  }

  // ── Health ────────────────────────────────────────────────────────────────

  takeDamage(amount) {
    if (this.shield > 0) {
      const a = Math.min(this.shield, amount);
      this.shield -= a;
      amount -= a;
    }
    if (amount > 0 && this.armor > 0) {
      const a = Math.min(this.armor, amount);
      this.armor -= a;
      amount -= a;
    }
    if (amount > 0) this.hull = Math.max(0, this.hull - amount);
  }

  // ── Hull ──────────────────────────────────────────────────────────────────

  _buildHull() {
    const body   = mkStd(0x2277cc, 0x061422, 0.8, 0.2);
    const dark   = mkStd(0x0d1f3c, 0x040a12, 0.9, 0.15);
    const accent = mkStd(0x66bbff, 0x1a4466, 0.5, 0.3);
    const glass  = new THREE.MeshStandardMaterial({
      color: 0x44aaff, emissive: 0x0a2255, emissiveIntensity: 0.6,
      metalness: 0.1, roughness: 0.0,
      transparent: true, opacity: 0.82,
    });

    // Fuselage (tapered cylinder lying along +X)
    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(7, 16, 90, 20), body);
    fuselage.rotation.z = -Math.PI / 2;
    this.group.add(fuselage);

    // Nose cone
    const nose = new THREE.Mesh(new THREE.ConeGeometry(7, 38, 20), accent);
    nose.rotation.z = -Math.PI / 2;
    nose.position.x = 64;
    this.group.add(nose);

    // Cockpit dome
    const cockpit = new THREE.Mesh(
      new THREE.SphereGeometry(9, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.55),
      glass,
    );
    cockpit.position.set(18, 8, 0);
    cockpit.rotation.z = -0.15;
    this.group.add(cockpit);

    // Wings (±Y) and engine pods
    this._enginePositions = [];
    [-1, 1].forEach(side => {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(55, 45, 3), dark);
      wing.position.set(-8, side * 38, 0);
      wing.rotation.z = side * 0.18;
      this.group.add(wing);

      const stripe = new THREE.Mesh(new THREE.BoxGeometry(50, 4, 3.5), accent);
      stripe.position.set(-4, side * 55, 0);
      stripe.rotation.z = side * 0.18;
      this.group.add(stripe);

      const pod = new THREE.Mesh(new THREE.CylinderGeometry(5, 6.5, 28, 16), dark);
      pod.rotation.z = -Math.PI / 2;
      pod.position.set(-22, side * 40, 0);
      this.group.add(pod);

      const nozzleRing = new THREE.Mesh(new THREE.TorusGeometry(5.5, 1.2, 12, 32), accent);
      nozzleRing.rotation.y = Math.PI / 2;
      nozzleRing.position.set(-37, side * 40, 0);
      this.group.add(nozzleRing);

      this._enginePositions.push(new THREE.Vector3(-38, side * 40, 0));
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

    // Rocket turret pods — two symmetric barrels along +X near the nose
    this._turretPositions = [];
    [1, -1].forEach(side => {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.5, 8, 8), accent);
      base.rotation.z = -Math.PI / 2;
      base.position.set(28, 0, side * 10);
      this.group.add(base);

      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 18, 8), dark);
      barrel.rotation.z = -Math.PI / 2;
      barrel.position.set(40, 0, side * 10);
      this.group.add(barrel);

      this._turretPositions.push(new THREE.Vector3(50, 0, side * 10));
    });
  }

  // ── Thruster Glow ──────────────────────────────────────────────────────────

  _buildThrusters() {
    this._nozzleGlows = [];

    this._thrusterLight = new THREE.PointLight(0xff5500, 0, 220);
    this._thrusterLight.position.set(-50, 0, 0);
    this.group.add(this._thrusterLight);

    this._thrusterFill = new THREE.PointLight(0xff8800, 0, 120);
    this._thrusterFill.position.set(-30, 0, 0);
    this.group.add(this._thrusterFill);

    const additiveMat = color => new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this._enginePositions.forEach(pos => {
      const inner = new THREE.Mesh(new THREE.CircleGeometry(4.5, 20), additiveMat(0xffcc44));
      const outer = new THREE.Mesh(new THREE.CircleGeometry(11,   20), additiveMat(0xff5500));
      const halo  = new THREE.Mesh(new THREE.CircleGeometry(20,   20), additiveMat(0xff2200));

      [inner, outer, halo].forEach(m => {
        m.position.copy(pos);
        m.position.x -= 1;
        m.rotation.y = Math.PI / 2;
        this.group.add(m);
      });

      this._nozzleGlows.push({ inner, outer, halo });
    });
  }

  // ── Particle Trail ────────────────────────────────────────────────────────

  _buildParticleTrail() {
    this._pPositions  = new Float32Array(PARTICLE_COUNT * 3);
    this._pVelocities = Array.from({ length: PARTICLE_COUNT }, () => new THREE.Vector3());
    this._pLife       = new Float32Array(PARTICLE_COUNT);
    this._pMaxLife    = Float32Array.from({ length: PARTICLE_COUNT }, () => 0.35 + Math.random() * 0.45);

    for (let i = 0; i < PARTICLE_COUNT; i++) this._pPositions[i * 3] = -1e5;

    const geo = new THREE.BufferGeometry();
    this._pPosAttr = new THREE.BufferAttribute(this._pPositions, 3);
    geo.setAttribute('position', this._pPosAttr);

    this._particleMesh = new THREE.Points(geo, new THREE.PointsMaterial({
      color:           0xff9900,
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
    const i = this._nextParticle++ % PARTICLE_COUNT;

    const engLocal = this._enginePositions[Math.floor(Math.random() * this._enginePositions.length)];
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

  // ── Public API ────────────────────────────────────────────────────────────

  get position()   { return this.group.position; }
  get quaternion() { return this.group.quaternion; }

  // ── Engine control (called by HUD) ──────────────────────────────────────
  setEngine(on)        { this.engineOn = on; }
  stopShip()           { this.engineOn = false; }
  setTargetSpeed(s)    { this.targetSpeed = THREE.MathUtils.clamp(s, 0, BOOST_SPEED); }

  // Returns world-space positions of both turret barrels (used by RocketManager)
  getTurretPositions() {
    this.group.updateMatrixWorld(true);
    return this._turretPositions.map(p => p.clone().applyMatrix4(this.group.matrixWorld));
  }

  // ── Update (call every frame) ─────────────────────────────────────────────

  update(delta) {
    this.group.updateMatrixWorld(true);

    const inp = this._input;

    // ── 3D Flight Controls ────────────────────────────────────────────────
    // W/S = pitch up/down   A/D = yaw left/right   Q/E = roll   Shift = boost
    const pitch = (inp.is('KeyS') ? 1 : 0) - (inp.is('KeyW') ? 1 : 0);
    const yaw   = (inp.is('KeyA') ? 1 : 0) - (inp.is('KeyD') ? 1 : 0);
    const roll  = (inp.is('KeyQ') ? 1 : 0) - (inp.is('KeyE') ? 1 : 0);
    const boost =  inp.is('ShiftLeft') || inp.is('ShiftRight');

    if (pitch !== 0 || yaw !== 0 || roll !== 0) {
      _pitchQ.setFromAxisAngle(_AY, pitch * PITCH_RATE * delta);
      _yawQ.setFromAxisAngle(_AZ,   yaw   * YAW_RATE   * delta);
      _rollQ.setFromAxisAngle(_AX,  roll  * ROLL_RATE  * delta);
      this.group.quaternion.multiply(_pitchQ).multiply(_yawQ).multiply(_rollQ).normalize();
    }

    // ── Fly forward along local +X ────────────────────────────────────────
    if (this.engineOn) {
      const speed = boost ? BOOST_SPEED : this.targetSpeed;
      _fwd.set(1, 0, 0).applyQuaternion(this.group.quaternion);
      this.group.position.addScaledVector(_fwd, speed * delta);
    }

    // ── Lerped speed (for HUD readout) ───────────────────────────────────
    const _targetSpeed = this.engineOn ? (boost ? BOOST_SPEED : this.targetSpeed) : 0;
    this.speed = THREE.MathUtils.lerp(this.speed, _targetSpeed, Math.min(delta * 5, 1));

    // ── Thruster intensity ────────────────────────────────────────────────
    // Scale glow proportionally to targetSpeed so the nozzle dims at low speed.
    // Formula gives 0.1 (faint idle) at 0 m/s → 0.46 at 400 → 1.0 at 1000.
    const targetT = this.engineOn
      ? (boost ? 1.0 : 0.1 + (this.targetSpeed / BOOST_SPEED) * 0.9)
      : 0;
    const rate    = targetT > this.thrusterIntensity ? THRUSTER_UP_RATE : THRUSTER_DOWN_RATE;
    this.thrusterIntensity = THREE.MathUtils.clamp(
      this.thrusterIntensity + (targetT - this.thrusterIntensity) * Math.min(delta * rate * 3, 1),
      0, 1,
    );
    const t = this.thrusterIntensity;

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
      this._emitAccum += PARTICLE_EMIT_RATE * t * delta;
      while (this._emitAccum >= 1) {
        this._spawnParticle();
        this._emitAccum -= 1;
      }
    }

    // ── Advance existing particles ────────────────────────────────────────
    for (let i = 0; i < PARTICLE_COUNT; i++) {
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

  dispose() {
    this._particleMesh.geometry.dispose();
    this._particleMesh.material.dispose();
    this._scene.remove(this._particleMesh);
    this._scene.remove(this.group);
  }
}
