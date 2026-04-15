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

## Main Menu

On launch a full-screen menu appears over the game scene (the nebula and stars render behind it):

- **Start Game** — dismisses the menu and begins play
- **How to Play** — opens an in-menu control reference; **Back** returns to the main screen

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
| `Shift` | Boost (1 000 u/s vs 400 u/s cruise) |

Rotation controls work even when the engine is off.

### Mouse

| Input | Action |
|-------|--------|
| Left-click | Lock / unlock target |
| Right-click | Open target context menu |
| Left-drag | Orbit camera around ship |
| Scroll wheel | Zoom in / out (60 – 800 units) |

### HUD Buttons

| Button | Action |
|--------|--------|
| **Thrusters** | Toggle engine on/off |
| **Stop Ship** | Cut engine immediately |
| **Speed bar** | Drag to set cruise speed (0 – 1 000 u/s) |
| **Fire Rockets** | Fire at the locked enemy target (600 ms cooldown) |
| **Mine Asteroid** | Mine the targeted rock when within 400 units |
| **Warp To Target** | Warp to the target when it is > 600 units away (5 s cooldown) |

Mine and Warp buttons appear only when their conditions are met.

---

## Mobile Controls

On touch devices a control overlay appears automatically (hidden on desktop):

| Control | Action |
|---------|--------|
| Left thumbstick | Pitch + Yaw |
| **Q** button | Roll left |
| **E** button | Roll right |
| **BOOST** button (hold) | Max speed |
| Single-finger drag (right half) | Orbit camera |
| Two-finger pinch (right half) | Zoom in / out |

The existing HUD buttons work via tap. Tap any object in the upper part of the screen to target it.

---

## Features

### Main Menu & How-to-Play

- Semi-transparent overlay with the live game scene visible behind it
- "SPACEMAN" title with cyan text-shadow glow
- Animated button hover glow matching the HUD aesthetic
- Full control reference organised into Flight / Camera / Targeting / Engine sections

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
- Smooth lerp between cruise (45%) and boost (100%) intensity; fades to 0 when engine off

### Particle Trail

- 400-particle pool emitted from engine positions each frame
- Particles travel backward in world space with random spread
- Lifetime 0.35 – 0.8 s; emission rate proportional to thruster intensity

### Star Field

Two-layer parallax star field (4 100 stars total):

- Layer 1 — 3 500 small dim stars, spread 5 000 units
- Layer 2 — 600 large bright stars, spread 4 000 units

Stars stay pixel-sized regardless of zoom and translate with the ship to simulate an infinite field.

### Procedural Nebula Skybox

A 1 024 × 1 024 canvas nebula is generated at startup with layered radial gradients (purple, blue, red, teal, orange). Wrapped onto a `SphereGeometry` with `THREE.BackSide` at radius 6 000. A real NASA image takes priority if present (see **Optional Assets**).

### World — Asteroids & Planets

**Asteroids**

- 90 rocky asteroids scattered in a 2 200-unit radius sphere
- Each is an `IcosahedronGeometry` (2× subdivided) with per-vertex displacement
- Sizes range 8 – 80 units; each tumbles at a random spin rate

**Planets**

Three large bodies at fixed positions:

| | Color | Radius | Special |
|-|-------|--------|---------|
| Planet A | Blue-grey | 320 | Ring system |
| Planet B | Rust-red | 180 | — |
| Planet C | Deep teal | 420 | — |

### Targeting System

- Left-click any asteroid, planet, or enemy ship to lock it as the current target
- A pulsing orange reticle tracks the target's projected screen position
- Top-right panel shows target name, type, and live distance
- Right-click anywhere opens a categorised context menu listing all named objects with distances; click an entry to select it
- Click the same target again, or click empty space, to deselect

### Combat — NPC Enemies & Rockets

- A fleet of hostile fighter ships patrol the area with simple AI
- Enemy health panels show Shield / Armor / Hull bars when an NPC is targeted
- **Fire Rockets** launches projectiles from the ship's turret positions toward the locked target
- Rockets track distance; enemies take damage and enter a "dead" state when all hull is depleted

### Asteroid Mining

- Target a rocky body and fly within 400 units to reveal the **Mine Asteroid** button
- A cyan mining beam stretches from the ship's nose to the asteroid with a pulsing glow
- Progress bar fills over 3 seconds; maintaining lock and proximity completes the mine
- Mined asteroids darken visually and cannot be mined again

### Warp Drive

- Target any object more than 600 units away to reveal the **Warp To Target** button
- Full-screen white radial flash; at peak opacity the ship teleports 500 units from the target
- Target name is displayed during the flash
- 5-second cooldown before the next warp

### HUD Overlay

HTML/CSS overlay (no Three.js canvas involvement):

- Octagonal main panel (bottom-centre) with animated cyan border pulse
- **Shield** (cyan) / **Armor** (gold) / **Hull** (green) health bars
- Speed bar with drag-to-set speed (0 – 1 000 u/s)
- Contextual **Mine** and **Warp** buttons that appear only when usable
- Enemy health bars in the target panel when an NPC is locked
- All buttons use `pointer-events: auto`; the rest of the overlay is click-through

### Orbit Camera

- Spherical-coordinate camera that always looks at the ship
- Azimuth and elevation controlled by mouse drag (or touch drag on mobile)
- Radius controlled by scroll wheel or pinch gesture (60 – 800 units)
- Starts at π azimuth (directly behind the ship) at ~68° elevation

### Mobile Touch Layer

- Auto-detects touch capability at runtime — zero overhead on desktop
- Virtual thumbstick (bottom-left) writes binary pitch/yaw states to the same `InputHandler.keys` object that desktop keyboard uses — no changes to flight physics
- Roll and Boost buttons inject `KeyQ`, `KeyE`, `ShiftLeft` the same way
- Camera drag and pinch-zoom fire callbacks into the main module's orbit-camera state variables
- `z-index: 5` keeps it below the HUD (`z-index: 10`) so HUD buttons remain fully tappable

---

## File Structure

```
index.html          ← entry point, importmap (Three.js r169 via CDN)
src/
  main.js           ← renderer, scene, lighting, skybox, orbit camera, animation loop
  menu.js           ← Menu class: main menu + How to Play overlay
  mobile.js         ← MobileControls class: touch thumbstick, buttons, pinch-zoom
  ship.js           ← Ship class: hull geometry, thruster glow, particle trail, flight physics
  hud.js            ← HUD class: health bars, speed bar, targeting UI, action buttons
  input.js          ← InputHandler: keyboard state tracker
  stars.js          ← Stars class: two-layer parallax star field
  world.js          ← World class: asteroids and planets
  npcs.js           ← NPCFleet + NPCShip: enemy AI, health system
  rockets.js        ← RocketManager: projectile firing, travel, hit detection
assets/
  nebula.jpg        ← (optional) NASA nebula image — see below
```

---

## Optional Assets

Drop any NASA nebula JPEG as `assets/nebula.jpg` to replace the procedural background.

Good sources (public domain / CC):

- https://images.nasa.gov — search "nebula" or "pillars of creation"
- https://hubblesite.org/images/gallery

---

## Tech Stack

- **Three.js r169** via CDN importmap (jsDelivr) — no npm
- **ES Modules** in the browser — no bundler
- **Plain HTML/CSS** for all overlay UI (menu, HUD, mobile controls)
