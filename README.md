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

| Key     | Action                              |
| ------- | ----------------------------------- |
| `W`     | Pitch up                            |
| `S`     | Pitch down                          |
| `A`     | Yaw left                            |
| `D`     | Yaw right                           |
| `Q`     | Roll left                           |
| `E`     | Roll right                          |
| `Shift` | Boost (1 000 u/s vs 400 u/s cruise) |

Rotation controls work even when the engine is off.

### Keyboard — Weapons

| Key     | Action                                                      |
| ------- | ----------------------------------------------------------- |
| `1`     | Select **Laser** (auto-fire while held, homing on target)   |
| `2`     | Select **Missile** (single shot, 12 ammo, requires lock)    |
| `3`     | Select **Plasma** (hold to charge, release to fire)         |
| `Space` | Fire current weapon — press-and-hold for laser / plasma     |

### Mouse

| Input        | Action                         |
| ------------ | ------------------------------ |
| Left-click   | Lock / unlock target           |
| Right-click  | Open target context menu       |
| Left-drag    | Orbit camera around ship       |
| Scroll wheel | Zoom in / out (60 – 800 units) |

### HUD Buttons

| Button             | Action                                                        |
| ------------------ | ------------------------------------------------------------- |
| **Thrusters**      | Toggle engine on/off                                          |
| **Stop Ship**      | Cut engine immediately                                        |
| **Speed bar**      | Drag to set cruise speed (0 – 1 000 u/s)                      |
| **[1] / [2] / [3]**| Click to switch weapon (mirrors `1`/`2`/`3` hotkeys)          |
| **Fire**           | Fire / press-and-hold the active weapon                       |
| **Mine Asteroid**  | Mine the targeted rock when within 400 units                  |
| **Warp To Target** | Warp to the target when it is > 600 units away (5 s cooldown) |
| **Dock at Station**| Dock when the station is targeted and within 300 units        |

Mine, Warp, and Dock buttons appear only when their conditions are met.

---

## Mobile Controls

On touch devices a control overlay appears automatically (hidden on desktop):

| Control                         | Action                                            |
| ------------------------------- | ------------------------------------------------- |
| Left thumbstick                 | Pitch + Yaw                                       |
| **Q** button                    | Roll left                                         |
| **E** button                    | Roll right                                        |
| **BOOST** button (hold)         | Max speed                                         |
| **FIRE** button (hold)          | Fire active weapon — hold to charge plasma        |
| Single-finger drag (right half) | Orbit camera                                      |
| Two-finger pinch (right half)   | Zoom in / out                                     |

Weapon switching, mining, warp, and docking all work via the existing HUD buttons (tap them). Tap any object in the upper part of the screen to target it.

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

- 600-particle pool emitted from engine positions each frame
- Particles travel backward in world space with random spread
- Lifetime 0.35 – 0.8 s; emission rate proportional to thruster intensity

### Star Field

Three-layer parallax star field — small dim stars, medium stars, and bright foreground stars. Stars stay pixel-sized regardless of zoom and translate with the ship to simulate an infinite field.

### Procedural Nebula Skybox

A 2 048 × 1 024 equirectangular nebula is generated at startup with layered 3D cloud directions (purple, blue, red, teal, orange) and converted to a seamless cube-environment map by `THREE.PMREMGenerator`. A real NASA image takes priority if present (see **Optional Assets**); seam-fix and pole-fade passes hide the equirectangular artifacts.

### World — Asteroids & Planets

**Asteroid fields**

- Multiple named clumps of rocky asteroids scattered through the play space
- Each rock is an `IcosahedronGeometry` with per-vertex displacement
- Sizes range from small fragments to large bodies; each tumbles at a random spin rate
- Fields show in the right-click context menu under their own category

**Planets**

Three large bodies at fixed positions, each named and targetable:

|              | Type                | Special     |
| ------------ | ------------------- | ----------- |
| KEPLER-7b    | Gas Giant           | Ring system |
| MARS-IV      | Terrestrial Planet  | —           |
| (third body) | Terrestrial Planet  | —           |

### Targeting System

- Left-click any asteroid, planet, station, or enemy ship to lock it as the current target
- A pulsing orange reticle tracks the target's projected screen position (with off-screen indicator)
- Top-right panel shows target name, type, live distance, and Shield/Armor/Hull bars when targeting an NPC
- Right-click anywhere opens a categorised context menu listing all named objects with distances; click an entry to select it
- Click the same target again, or click empty space, to deselect
- A locked NPC is auto-untargeted when destroyed

### Weapons — Laser / Missile / Plasma

Three weapon slots, switchable at any time with `1`/`2`/`3` (or by clicking the HUD slot panel). Active slot is highlighted; the Fire button label and the slot indicator update on switch.

| Slot | Weapon  | Behaviour                                                                                  |
| ---- | ------- | ------------------------------------------------------------------------------------------ |
| 1    | Laser   | Fast cyan bolts (140 ms cooldown). Press-and-hold for auto-fire. Lead-aims and lightly homes on the locked NPC. |
| 2    | Missile | Single homing rocket. Requires a locked hostile target. 12 rounds — refilled free on dock. |
| 3    | Plasma  | Hold Fire to charge (max ~1.5 s). Release fires a glowing orb whose damage and radius scale with charge. Below 20% charge, release does nothing. |

The HUD weapon strip shows the missile ammo counter and a charge bar that fills while plasma is winding up. Damage and missile cooldown are both upgradable in the shop.

### Endless Wave System

Combat spawns are organised into escalating waves:

- Each wave's roster and difficulty multiplier (HP × 1.15, damage × 1.10 per wave) ramps with the wave number
- Non-boss waves mix **Scout** (light, fast) and **Heavy** (slow, tanky) hostiles
- Every **5th wave** is a single **Dreadnought boss** with a multi-shot burst, large hull, and brighter death blasts
- A wave banner announces each wave (and "BOSS INCOMING" on boss waves); a small panel tracks the current wave number and remaining hostiles
- A short pre-start delay gives you a few seconds to read the controls; intermissions sit between waves

NPC ships spawn on a sphere 800 – 1 200 units around the player and use a simple approach / orbit / fire AI. Their shaders are pre-compiled at startup so the first encounter doesn't stutter.

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

### Loot & Credits

- NPC kills drop loot orbs; **boss** kills drop three at once
- Orbs auto-pickup on contact and grant either +30 shield / +100 cr or +15 hull / +200 cr
- A small combat-log toast confirms each pickup; the score counter tracks total credits earned

### Space Station & Upgrade Shop

A single dockable station — **ARGOS STATION** — sits roughly 5 800 units from spawn. It appears in the right-click context menu under its own "Station" category.

**Docking**

- Target the station and fly within 300 units (warp gets you most of the way; fly the last gap)
- The orange **Dock at Station** button appears when in range, or reads "Approach to Dock" when too far
- Dock cuts the engine, halts the ship, refills missile ammo for free, and opens the shop overlay; combat damage is suspended while docked

**Shop — session-only progression**

Credits earned from looting are spent here. All upgrades and credits reset on page reload.

| Upgrade            | Effect                       | Levels | Pricing                       |
| ------------------ | ---------------------------- | ------ | ----------------------------- |
| Hull Plating       | +25 max hull (and +25 hull)  | 5      | 500 / 1.5k / 4k / 9k / 20k    |
| Shield Capacitor   | +25 max shield, fully charged| 5      | 500 / 1.5k / 4k / 9k / 20k    |
| Engine Tuning      | +20 % cruise & boost speed   | 3      | 2k / 6k / 15k                 |
| Warhead Yield      | +10 missile damage           | 3      | 1.5k / 5k / 12k               |
| Autoloader         | −100 ms missile cooldown     | 3      | 1.5k / 5k / 12k               |

**Full Repair** — 300 cr, restores shield + armor + hull to maximum (one purchase per dock).

**Undock** pushes the ship 50 units away from the station and re-enables the engine.

### Minimap

A radar-style panel in the corner shows a top-down XY projection of the surrounding 2 500-unit area, **heading-up** (the ship's forward always points to the canvas top):

- Cyan dot — player ship; orange dots — live NPCs; dim red — wrecks
- Cyan rings — planets; pale-cyan triangle — station; green dots — loot orbs
- Asteroids appear as faint grey specks
- An arrow on the rim points toward the current target when it is off-radar
- Blips dim when their target is far above or below the ship's altitude band, so the 2D view stays readable in 3D space

### HUD Overlay

HTML/CSS overlay (no Three.js canvas involvement). All panels are draggable to relocate:

- Octagonal main panel with weapon slot strip, fire button, contextual action buttons, and animated cyan border pulse
- **Shield** (cyan) / **Armor** (gold) / **Hull** (green) values rendered as concentric SVG arc rings around a glowing core
- Speed bar with drag-to-set speed (0 – 1 000 u/s)
- Wave panel and big-text banners for wave start / cleared / boss alerts
- Damage vignette flashes red on hit; hull-critical state pulses the panel
- Combat-log toasts surface NPC damage messages and loot pickups
- Game-over overlay with restart button when the ship is destroyed

### Orbit Camera

- Spherical-coordinate camera that always looks at the ship
- Azimuth and elevation controlled by mouse drag (or touch drag on mobile)
- Radius controlled by scroll wheel or pinch gesture (60 – 80 000 units)
- Starts at π azimuth (directly behind the ship) at ~68° elevation

### Mobile Touch Layer

- Auto-detects touch capability at runtime — zero overhead on desktop
- Virtual thumbstick (bottom-left) writes binary pitch/yaw states to the same `InputHandler.keys` object that desktop keyboard uses — no changes to flight physics
- Roll, Boost, and **Fire** buttons inject `KeyQ` / `KeyE` / `ShiftLeft` (Roll, Boost) or call the weapon system directly (Fire)
- Fire button supports press-and-hold so plasma can be charged on touch
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
  hud.js            ← HUD class: orb health rings, weapon strip, target panel, action buttons
  minimap.js        ← Minimap class: top-down heading-up radar with off-radar target arrow
  input.js          ← InputHandler: keyboard state tracker with edge-trigger detection
  stars.js          ← Stars class: multi-layer parallax star field
  world.js          ← World class: asteroid fields and planets
  npcs.js           ← NPCFleet + NPCShip + DeathBlast: enemy AI, archetypes, health system
  waves.js          ← WaveManager: wave roster generation, difficulty scaling, boss every 5th
  weapons.js        ← WeaponSystem + LaserManager + PlasmaManager: slot dispatch, fire logic
  rockets.js        ← RocketManager: missile firing, homing, hit detection, explosions
  loot.js           ← LootManager: loot orb pool, drops on NPC death, auto-pickup
  station.js        ← Station class: ARGOS Station geometry, beacons, ring spin
  shop.js           ← Shop class: upgrade definitions, overlay UI, purchase logic
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
- **Plain HTML/CSS** for all overlay UI (menu, HUD, mobile controls, shop, minimap)
