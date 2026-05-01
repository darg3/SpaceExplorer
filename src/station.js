import * as THREE from 'three';

// ARGOS Station — dockable space station. Single instance built from a central
// spire, two counter-rotating torus rings, beacon lights, and an additive halo.
// The spire mesh itself is the raycast/context-menu target (userData below).

export class Station {
  constructor(scene, pos) {
    this._scene = scene;
    this._t     = 0;

    this.group = new THREE.Group();
    this.group.position.copy(pos);
    scene.add(this.group);

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x8899aa, emissive: 0x223344, metalness: 0.85, roughness: 0.3,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x445566, emissive: 0x101820, metalness: 0.7, roughness: 0.5,
    });

    // Central spire — also serves as the targetable hitbox (userData below).
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(8, 14, 220, 8), bodyMat);
    spire.userData = {
      label:      'ARGOS STATION',
      type:       'Space Station',
      targetable: true,
      isStation:  true,
    };
    this.group.add(spire);
    this.hitbox = spire;

    // Octahedron tip caps the spire
    const tip = new THREE.Mesh(new THREE.OctahedronGeometry(14, 0), bodyMat);
    tip.position.y = 120;
    this.group.add(tip);
    const tipBottom = new THREE.Mesh(new THREE.OctahedronGeometry(12, 0), darkMat);
    tipBottom.position.y = -118;
    this.group.add(tipBottom);

    // Outer + inner rings
    this.outerRing = new THREE.Mesh(new THREE.TorusGeometry(140, 12, 12, 48), bodyMat);
    this.outerRing.rotation.x = Math.PI / 2;
    this.group.add(this.outerRing);

    this.innerRing = new THREE.Mesh(new THREE.TorusGeometry(80, 6, 10, 36), darkMat);
    this.innerRing.rotation.x = Math.PI / 2;
    this.group.add(this.innerRing);

    // 4 strut connectors between spire and outer ring
    for (let i = 0; i < 4; i++) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 220), darkMat);
      const a = (i / 4) * Math.PI * 2;
      strut.position.set(Math.cos(a) * 75, 0, Math.sin(a) * 75);
      strut.lookAt(this.group.position.clone().add(new THREE.Vector3(Math.cos(a) * 140, 0, Math.sin(a) * 140)));
      this.group.add(strut);
    }

    // Beacons + lights distributed on the outer ring
    this.beacons = [];
    const BEACON_COUNT = 6;
    for (let i = 0; i < BEACON_COUNT; i++) {
      const a = (i / BEACON_COUNT) * Math.PI * 2;
      const px = Math.cos(a) * 140;
      const pz = Math.sin(a) * 140;

      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(2.5, 10, 8),
        new THREE.MeshBasicMaterial({
          color: 0xff3333,
          transparent: true,
          opacity: 1,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      dot.position.set(px, 0, pz);
      this.group.add(dot);

      const light = new THREE.PointLight(0xff3333, 1.6, 80);
      light.position.set(px, 0, pz);
      this.group.add(light);

      this.beacons.push({ dot, light, phase: i });
    }

    // Halo — large additive shell (matches planet halos in world.js)
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x66bbff,
      transparent: true,
      opacity: 0.06,
      side: THREE.FrontSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.group.add(new THREE.Mesh(new THREE.SphereGeometry(220, 24, 16), haloMat));

    // Hub light
    const hubLight = new THREE.PointLight(0xaaccff, 1.4, 600);
    this.group.add(hubLight);
  }

  get position() { return this.group.position; }

  update(dt) {
    this._t += dt;
    this.outerRing.rotation.z += 0.3 * dt;
    this.innerRing.rotation.z -= 0.5 * dt;

    // Beacon blink — additive opacity + light intensity
    for (const b of this.beacons) {
      const k = 0.55 + 0.45 * Math.sin((this._t + b.phase) * 5);
      b.dot.material.opacity = k;
      b.light.intensity = 0.6 + k * 1.4;
    }
  }
}
