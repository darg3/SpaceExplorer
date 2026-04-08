import * as THREE from 'three';

// Three-layer star field for depth and variety.
// sizeAttenuation is off so stars stay pixel-sized regardless of zoom.
//
//  Layer 0 — dense micro-stars   : numerous, tiny, mostly white/blue
//  Layer 1 — mid background      : moderate count, slightly varied warm/cool tint
//  Layer 2 — bright foreground   : fewer, large, vivid colour tints
const CONFIGS = [
  { count: 6000, size: 0.6, opacity: 0.70, spread: 6000, warm: 0.15 }, // dense micro layer
  { count: 3000, size: 1.1, opacity: 0.82, spread: 5000, warm: 0.30 }, // mid layer
  { count:  700, size: 2.6, opacity: 0.95, spread: 4000, warm: 0.55 }, // bright foreground
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
      // Uniform sphere distribution (rejection-free)
      const theta = 2 * Math.PI * Math.random();
      const phi   = Math.acos(2 * Math.random() - 1);
      const r     = cfg.spread * (0.3 + 0.7 * Math.cbrt(Math.random()));
      positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      // Star colour: mix of cool blue-white and warm yellow-white
      const t    = Math.random();
      const warm = Math.random() < cfg.warm; // fraction of warm-tinted stars
      if (warm) {
        // Warm: yellow-orange tint
        colors[i * 3]     = 1.0;
        colors[i * 3 + 1] = 0.85 + t * 0.15;
        colors[i * 3 + 2] = 0.60 + t * 0.20;
      } else {
        // Cool: blue-white
        colors[i * 3]     = 0.75 + t * 0.25;
        colors[i * 3 + 1] = 0.80 + t * 0.20;
        colors[i * 3 + 2] = 1.0;
      }
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
