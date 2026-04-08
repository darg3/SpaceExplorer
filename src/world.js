import * as THREE from 'three';

// ── Asteroid field ─────────────────────────────────────────────────────────────

// Four material variants keep the field from looking uniform
const ASTEROID_MATS = [
  new THREE.MeshStandardMaterial({ color: 0x8a7a6a, roughness: 0.95, metalness: 0.05 }),
  new THREE.MeshStandardMaterial({ color: 0x6a5a4a, roughness: 0.98, metalness: 0.02 }),
  new THREE.MeshStandardMaterial({ color: 0x9a9080, roughness: 0.90, metalness: 0.10 }),
  new THREE.MeshStandardMaterial({ color: 0x5a4838, roughness: 0.99, metalness: 0.01 }),
];

function makeAsteroid(radius) {
  // Use higher subdivision for large rocks; small ones don't need it
  const detail = radius > 28 ? 3 : 2;
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const jitter = 0.22 + Math.random() * 0.18;
    const scale  = 0.78 + Math.random() * 0.44;
    pos.setXYZ(
      i,
      pos.getX(i) * jitter * scale,
      pos.getY(i) * jitter * scale,
      pos.getZ(i) * jitter * scale,
    );
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, ASTEROID_MATS[Math.floor(Math.random() * ASTEROID_MATS.length)]);
}

// ── Planets ────────────────────────────────────────────────────────────────────

const PLANET_DEFS = [
  {
    pos:      new THREE.Vector3( 3200,  800, -400),
    r:        320,
    color:    0x4466aa,
    emissive: 0x112244,
    atmColor: 0x2255cc,
    ring:     true,
    label:    'KEPLER-7b',
    type:     'Gas Giant',
  },
  {
    pos:      new THREE.Vector3(-2600, -600,  900),
    r:        180,
    color:    0xaa5533,
    emissive: 0x331100,
    atmColor: 0xcc4411,
    ring:     false,
    label:    'MARS-IV',
    type:     'Terrestrial Planet',
  },
  {
    pos:      new THREE.Vector3( 800,  3000, -1200),
    r:        420,
    color:    0x336655,
    emissive: 0x0a2218,
    atmColor: 0x22aa66,
    ring:     false,
    label:    'EDEN-3',
    type:     'Habitable World',
  },
  {
    pos:      new THREE.Vector3(-4800, 1200,  2000),
    r:        240,
    color:    0x6633aa,
    emissive: 0x1a0a33,
    atmColor: 0x8844cc,
    ring:     true,
    label:    'NEXUS PRIME',
    type:     'Unknown Class',
  },
];

// Returns { group, sphere } so the sphere can be added to targetables.
function makePlanet({ pos, r, color, emissive, atmColor, ring, label, type }) {
  const group = new THREE.Group();
  group.position.copy(pos);

  // Planet surface — high segment count for smooth silhouette at close range
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: 0.35,
    roughness: 0.8,
    metalness: 0.05,
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(r, 80, 48), mat);
  // Tag for raycaster targeting
  sphere.userData.targetable = true;
  sphere.userData.label      = label;
  sphere.userData.type       = type;
  group.add(sphere);

  // Atmosphere glow — additive thin shell slightly larger than the planet
  if (atmColor) {
    const atmMat = new THREE.MeshBasicMaterial({
      color:       atmColor,
      transparent: true,
      opacity:     0.18,
      side:        THREE.FrontSide,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
    });
    group.add(new THREE.Mesh(new THREE.SphereGeometry(r * 1.06, 40, 24), atmMat));

    // Outer halo (very faint, larger)
    const haloMat = new THREE.MeshBasicMaterial({
      color:       atmColor,
      transparent: true,
      opacity:     0.06,
      side:        THREE.FrontSide,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
    });
    group.add(new THREE.Mesh(new THREE.SphereGeometry(r * 1.18, 32, 18), haloMat));
  }

  if (ring) {
    const ringMat = new THREE.MeshBasicMaterial({
      color:       0x8899bb,
      transparent: true,
      opacity:     0.45,
      side:        THREE.DoubleSide,
      depthWrite:  false,
    });
    const ringMesh = new THREE.Mesh(new THREE.RingGeometry(r * 1.45, r * 2.2, 80), ringMat);
    ringMesh.rotation.x = Math.PI * 0.38;
    group.add(ringMesh);
  }

  return { group, sphere };
}

// ── World class ────────────────────────────────────────────────────────────────

export class World {
  constructor(scene) {
    this._scene     = scene;
    this._asteroids = [];
    this.targetables = []; // all meshes the raycaster can hit

    this._buildAsteroids(scene);
    this._buildPlanets(scene);
  }

  _buildAsteroids(scene) {
    // 180 asteroids scattered in a 4000-unit sphere around origin
    const SPREAD = 4000;
    for (let i = 0; i < 180; i++) {
      const r    = 6 + Math.random() * Math.random() * 80; // biased toward small
      const mesh = makeAsteroid(r);

      // Random position, keeping a clear zone near ship spawn
      let x, y, z;
      do {
        x = (Math.random() - 0.5) * SPREAD * 2;
        y = (Math.random() - 0.5) * SPREAD * 2;
        z = (Math.random() - 0.5) * SPREAD;
      } while (Math.sqrt(x*x + y*y + z*z) < 400);

      mesh.position.set(x, y, z);
      mesh.rotation.set(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
      );

      // Random tumble speed per axis
      mesh.userData.spin = new THREE.Vector3(
        (Math.random() - 0.5) * 0.18,
        (Math.random() - 0.5) * 0.18,
        (Math.random() - 0.5) * 0.12,
      );

      // Targeting metadata — categorise by size
      mesh.userData.targetable = true;
      if (r > 45) {
        mesh.userData.label = 'MINOR PLANET';
        mesh.userData.type  = 'Large Rocky Body';
      } else if (r > 20) {
        mesh.userData.label = 'ASTEROID';
        mesh.userData.type  = 'Rocky Body';
      } else {
        mesh.userData.label = 'DEBRIS';
        mesh.userData.type  = 'Space Fragment';
      }

      scene.add(mesh);
      this._asteroids.push(mesh);
      this.targetables.push(mesh);
    }
  }

  _buildPlanets(scene) {
    for (const def of PLANET_DEFS) {
      const { group, sphere } = makePlanet(def);
      scene.add(group);
      this.targetables.push(sphere); // only the surface sphere, not atm/ring
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
