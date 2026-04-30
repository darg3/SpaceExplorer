import * as THREE from 'three';

// ── Tuning ────────────────────────────────────────────────────────────────────
const PICKUP_RADIUS = 80;
const POOL_SIZE     = 6;
const SHIELD_RATIO  = 0.65;   // probability of a Shield Cell vs Hull Plate

const SHIELD_COLOR = 0x00ccff;
const HULL_COLOR   = 0x33ff66;

// ── Reusable temporaries ──────────────────────────────────────────────────────
const _itemPos = new THREE.Vector3();

// ── LootItem (internal) ──────────────────────────────────────────────────────
// Pooled glowing orb. Two additive spheres (core + halo) plus a point light.
// Bobs and rotates while active.
class LootItem {
  constructor(scene) {
    this._scene = scene;
    this._active = false;
    this._type   = 'shield';
    this._baseZ  = 0;
    this._phase  = 0;

    this.group = new THREE.Group();

    this._coreMat = new THREE.MeshBasicMaterial({
      color: SHIELD_COLOR, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this._haloMat = new THREE.MeshBasicMaterial({
      color: SHIELD_COLOR, transparent: true, opacity: 0.25,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });

    this._core = new THREE.Mesh(new THREE.SphereGeometry(12, 16, 12), this._coreMat);
    this._halo = new THREE.Mesh(new THREE.SphereGeometry(28, 16, 12), this._haloMat);
    this.group.add(this._core);
    this.group.add(this._halo);

    this._light = new THREE.PointLight(SHIELD_COLOR, 0, 280);
    this.group.add(this._light);

    this.group.visible = false;
    scene.add(this.group);
  }

  get active() { return this._active; }
  get type()   { return this._type; }

  activate(pos, type) {
    this._active = true;
    this._type   = type;
    const color  = type === 'shield' ? SHIELD_COLOR : HULL_COLOR;

    this._coreMat.color.setHex(color);
    this._haloMat.color.setHex(color);
    this._light.color.setHex(color);
    this._light.intensity = 4;

    this.group.position.copy(pos);
    this._baseZ = pos.z;
    this._phase = Math.random() * Math.PI * 2;
    this.group.visible = true;
  }

  deactivate() {
    this._active = false;
    this.group.visible = false;
    this._light.intensity = 0;
  }

  update(delta, elapsed) {
    if (!this._active) return;
    const t = elapsed + this._phase;
    const pulse = (Math.sin(t * 3.2) + 1) * 0.5;   // 0..1
    this.group.rotation.y += delta * 0.6;
    this.group.position.z  = this._baseZ + Math.sin(t * 1.5) * 4;
    this.group.scale.setScalar(0.85 + pulse * 0.45);
    this._light.intensity  = 6 + pulse * 10;
    this._coreMat.opacity  = 0.7 + pulse * 0.3;
    this._haloMat.opacity  = 0.2 + pulse * 0.45;
  }

  distanceTo(p) {
    return this.group.position.distanceTo(p);
  }

  getPosition(out) {
    return out.copy(this.group.position);
  }

  dispose() {
    this._core.geometry.dispose();
    this._halo.geometry.dispose();
    this._coreMat.dispose();
    this._haloMat.dispose();
    this._scene.remove(this.group);
  }
}

// ── LootManager (exported) ───────────────────────────────────────────────────
// Spawns loot orbs at NPC death positions and reports pickups via onPickup.
//
// onPickup signature: ({ type, pos }) => void
//   type — 'shield' or 'hull'
//   pos  — THREE.Vector3 of pickup location (cloned)
export class LootManager {
  constructor(scene, onPickup = null) {
    this._scene    = scene;
    this._onPickup = onPickup;
    this._items    = Array.from({ length: POOL_SIZE }, () => new LootItem(scene));
    this._elapsed  = 0;
  }

  spawn(pos) {
    const item = this._items.find(i => !i.active);
    if (!item) return;   // pool exhausted — drop silently
    const type = Math.random() < SHIELD_RATIO ? 'shield' : 'hull';
    item.activate(pos, type);
  }

  update(delta, shipPos) {
    this._elapsed += delta;
    for (const item of this._items) {
      if (!item.active) continue;
      item.update(delta, this._elapsed);
      if (item.distanceTo(shipPos) <= PICKUP_RADIUS) {
        const type = item.type;
        item.getPosition(_itemPos);
        item.deactivate();
        this._onPickup?.({ type, pos: _itemPos.clone() });
      }
    }
  }

  dispose() {
    for (const item of this._items) item.dispose();
  }
}
