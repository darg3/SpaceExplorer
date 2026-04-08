# SpaceMan — VibeJam

A browser-based 3D space flight game built with Three.js. No build tools, no install — just open and fly.

---

## Running the Game

Serve the project root with any local HTTP server (ES module imports require a server, not `file://`):

```bash
# Python (built-in)
python -m http.server 8080

# VS Code: use the Live Server extension and click "Go Live"
```

Then open `http://localhost:8080` in a modern browser (Chrome / Firefox / Edge).

---

## Controls

### Keyboard — Flight

| Key | Action |
|-----|--------|
| `W` | Pitch up |
| `S` | Pitch down |
| `A` | Yaw left |
| `D` | Yaw right |
| `Q` | Roll left |
| `E` | Roll right |
| `Shift` | Boost (500 u/s vs 180 u/s cruise) |

Rotation controls work even when the engine is off, so you can orient before re-engaging thrust.

### Mouse — Orbit Camera

| Input | Action |
|-------|--------|
| Left-drag | Rotate view around ship |
| Scroll wheel | Zoom in / out (60 – 800 units) |

### HUD Buttons

| Button | Action |
|--------|--------|
| **Thrusters** | Toggle engine on/off. Label dims to "Thrusters: Off" when cut. |
| **Stop Ship** | Immediately cut the engine. |

---

## Features

### 3D Ship

Custom-built geometry using Three.js primitives — no external model files:

- Tapered fuselage (`CylinderGeometry` along +X)
- Pointed nose cone with accent material
- Semi-transparent cockpit dome
- Two swept wings with engine pods and accent stripes
- Rear cross-fin

### Thruster Effects

- Two orange point lights pulse with engine intensity
- Per-engine additive-blended glow circles (inner / outer / halo) scale with thrust
- Smooth lerp between cruise (45%) and boost (100%) intensity, fades to 0 when engine off

### Particle Trail

- 400-particle pool emitted from engine positions each frame
- Particles travel backward in world space with random spread
- Lifetime 0.35 – 0.8 s; emission rate proportional to thruster intensity

### Star Field

Two-layer parallax star field (4 100 stars total):

- Layer 1 — 3 500 small dim stars, spread 5 000 units
- Layer 2 — 600 large bright stars, spread 4 000 units

Stars are rendered with `sizeAttenuation: false` so they stay pixel-sized regardless of zoom. Both layers translate with the ship to simulate an infinite field.

### Procedural Nebula Skybox

A 1 024 × 1 024 canvas nebula is generated at startup with layered radial gradients (purple, blue, red, teal, orange). It is wrapped onto a `SphereGeometry` with `THREE.BackSide` at radius 6 000. If a real NASA image is present it takes priority (see **Optional Assets** below).

### World — Asteroids & Planets

**Asteroids**

- 90 rocky asteroids scattered in a 2 200-unit radius sphere around the origin
- Each is an `IcosahedronGeometry` (subdivided 2×) with per-vertex displacement for a craggy look
- Sizes range 8 – 80 units, biased toward small
- Each tumbles at a random spin rate per axis

**Planets**

Three large bodies at fixed positions in the scene:

| | Color | Radius | Special |
|-|-------|--------|---------|
| Planet A | Blue-grey | 320 | Ring system |
| Planet B | Rust-red | 180 | — |
| Planet C | Deep teal | 420 | — |

### HUD Overlay

HTML/CSS overlay (no Three.js involvement):

- **Shield** bar — cyan
- **Armor** bar — gold
- **Hull** bar — green
- All bars display at 100% (combat damage system not yet implemented)
- THRUSTERS and STOP SHIP buttons wire directly to `ship.setEngine()` / `ship.stopShip()`

### Orbit Camera

Spherical-coordinate camera that always targets the ship:

- Azimuth and elevation controlled by mouse drag
- Radius controlled by scroll wheel (60 – 800 units)
- Starts at π azimuth (behind ship) and ~68° elevation

---

## File Structure

```
index.html          ← entry point, importmap (Three.js r169 via CDN)
src/
  main.js           ← renderer, scene, lighting, skybox, orbit camera, animation loop
  ship.js           ← Ship class: hull geometry, thruster glow, particle trail, flight physics
  hud.js            ← HUD class: health bars and engine control buttons
  input.js          ← InputHandler: keyboard state tracker
  stars.js          ← Stars class: two-layer parallax star field
  world.js          ← World class: asteroids and planets
assets/
  nebula.jpg        ← (optional) NASA nebula image — see below
```

---

## Optional Assets

Drop any NASA nebula JPEG as `assets/nebula.jpg` (or `assets/GSFC_20171208_nebula.jpg`) to replace the procedural background. The loader tries the specific filename first, then the generic one, then falls back to the generated nebula.

Good sources (public domain / CC):

- https://images.nasa.gov — search "nebula" or "pillars of creation"
- https://hubblesite.org/images/gallery

---

## Tech Stack

- **Three.js r169** via CDN importmap (jsDelivr) — no npm
- **ES Modules** in the browser — no bundler
- **Plain HTML/CSS** for the HUD overlay
