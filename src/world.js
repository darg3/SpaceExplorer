import * as THREE from 'three';

// ── Asteroid field ─────────────────────────────────────────────────────────────

const ASTEROID_MAT = new THREE.MeshStandardMaterial({
  color:     0x8a7a6a,
  roughness: 0.95,
  metalness: 0.05,
});

function makeAsteroid(radius) {
  // Start with an icosahedron and displace vertices for a rocky look
  const geo = new THREE.IcosahedronGeometry(radius, 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const jitter = 0.22 + Math.random() * 0.18;
    pos.setXYZ(i, pos.getX(i) * jitter * (radius / radius),
                  pos.getY(i) * jitter * (radius / radius),
                  pos.getZ(i) * jitter * (radius / radius));
    // Scale back to approximate target radius, then perturb
    const scale = (0.78 + Math.random() * 0.44);
    pos.setXYZ(i, pos.getX(i) * scale, pos.getY(i) * scale, pos.getZ(i) * scale);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, ASTEROID_MAT);
}

// ── Planets ────────────────────────────────────────────────────────────────────

const PLANET_DEFS = [
  {
    pos:   new THREE.Vector3( 3200,  800, -400),
    r:     320,
    color: 0x4466aa,
    emissive: 0x112244,
    ring:  true,
  },
  {
    pos:   new THREE.Vector3(-2600, -600,  900),
    r:     180,
    color: 0xaa5533,
    emissive: 0x331100,
    ring:  false,
  },
  {
    pos:   new THREE.Vector3( 800,  3000, -1200),
    r:     420,
    color: 0x336655,
    emissive: 0x0a2218,
    ring:  false,
  },
];

function makePlanet({ pos, r, color, emissive, ring }) {
  const group = new THREE.Group();
  group.position.copy(pos);

  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: 0.35,
    roughness: 0.8,
    metalness: 0.05,
  });

  const sphere = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 24), mat);
  group.add(sphere);

  if (ring) {
    const ringMat = new THREE.MeshBasicMaterial({
      color:       0x8899bb,
      transparent: true,
      opacity:     0.45,
      side:        THREE.DoubleSide,
      depthWrite:  false,
    });
    const ringGeo = new THREE.RingGeometry(r * 1.45, r * 2.2, 64);
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI * 0.38;
    group.add(ringMesh);
  }

  return group;
}

// ── World class ────────────────────────────────────────────────────────────────

export class World {
  constructor(scene) {
    this._scene    = scene;
    this._asteroids = [];

    this._buildAsteroids(scene);
    this._buildPlanets(scene);
  }

  _buildAsteroids(scene) {
    // Distribute ~90 asteroids in a large volume around origin
    const SPREAD = 2200;
    for (let i = 0; i < 90; i++) {
      const r    = 8 + Math.random() * Math.random() * 72; // bias toward small
      const mesh = makeAsteroid(r);

      // Random position in a sphere, avoiding the very center (ship spawn)
      let x, y, z;
      do {
        x = (Math.random() - 0.5) * SPREAD * 2;
        y = (Math.random() - 0.5) * SPREAD * 2;
        z = (Math.random() - 0.5) * SPREAD;
      } while (Math.sqrt(x*x + y*y + z*z) < 350);

      mesh.position.set(x, y, z);
      mesh.rotation.set(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
      );

      // Slow tumble: store rotation speed per axis
      mesh.userData.spin = new THREE.Vector3(
        (Math.random() - 0.5) * 0.18,
        (Math.random() - 0.5) * 0.18,
        (Math.random() - 0.5) * 0.12,
      );

      scene.add(mesh);
      this._asteroids.push(mesh);
    }
  }

  _buildPlanets(scene) {
    for (const def of PLANET_DEFS) {
      scene.add(makePlanet(def));
    }
  }

  update(delta) {
    for (const ast of this._asteroids) {
      ast.rotation.x += ast.userData.spin.x * delta;
      ast.rotation.y += ast.userData.spin.y * delta;
      ast.rotation.z += ast.userData.spin.z * delta;
    }
  }

  dispose() {
    for (const ast of this._asteroids) {
      ast.geometry.dispose();
      this._scene.remove(ast);
    }
  }
}
