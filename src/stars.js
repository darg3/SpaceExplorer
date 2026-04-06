import * as THREE from 'three';

const CONFIGS = [
  { count: 3500, size: 0.9, opacity: 0.85, spread: 5000 },
  { count:  600, size: 2.2, opacity: 0.95, spread: 4000 },
];

export class Stars {
  constructor(scene) {
    this._scene  = scene;
    this._layers = CONFIGS.map(cfg => this._makeLayer(scene, cfg));
  }

  _makeLayer(scene, cfg) {
    const positions = new Float32Array(cfg.count * 3);
    const colors    = new Float32Array(cfg.count * 3);

    for (let i = 0; i < cfg.count; i++) {
      // Uniform sphere distribution
      const theta = 2 * Math.PI * Math.random();
      const phi   = Math.acos(2 * Math.random() - 1);
      const r     = cfg.spread * (0.3 + 0.7 * Math.cbrt(Math.random()));
      positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      const t = Math.random();
      colors[i * 3]     = 0.8 + t * 0.2;
      colors[i * 3 + 1] = 0.8 + t * 0.2;
      colors[i * 3 + 2] = 0.9 + t * 0.1;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(colors,    3));

    const mat = new THREE.PointsMaterial({
      size:            cfg.size,
      sizeAttenuation: false,
      vertexColors:    true,
      transparent:     true,
      opacity:         cfg.opacity,
    });

    const points = new THREE.Points(geo, mat);
    scene.add(points);
    return points;
  }

  // Stars follow ship so they appear as a fixed infinite starfield.
  update(shipPos) {
    for (const layer of this._layers) {
      layer.position.copy(shipPos);
    }
  }

  dispose() {
    for (const layer of this._layers) {
      layer.geometry.dispose();
      layer.material.dispose();
      this._scene.remove(layer);
    }
  }
}
