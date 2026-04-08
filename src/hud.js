// ── Helpers ───────────────────────────────────────────────────────────────────

// Update a bar-row's fill width and percentage text.
function _setBar(row, pct) {
  row.querySelector('.bar-fill').style.width = pct + '%';
  row.querySelector('.bar-pct').textContent  = Math.round(pct) + '%';
}

// ── HUD ───────────────────────────────────────────────────────────────────────
// Injects a fixed HTML overlay onto the page (no Three.js required).
// Displays Shield / Armor / Hull health bars and two engine control buttons.
//
// Design notes:
//   • #hud has pointer-events:none so the canvas orbit camera works everywhere
//     outside the panel — only the panel itself re-enables pointer events.
//   • Button mousedown calls e.stopPropagation() to prevent triggering the
//     window-level mousedown that starts orbit-camera dragging (main.js).
//   • The outer .hud-glow-wrap carries filter:drop-shadow so the glow follows
//     the clipped octagonal shape (clip-path clips before filter on same element).

export class HUD {
  constructor(ship) {
    this._ship        = ship;
    this._thrusterBtn = null;
    this._stopBtn     = null;
    this._el          = null;

    this._injectStyle();
    this._injectDOM();
    this._bindButtons();
  }

  // ── Style ─────────────────────────────────────────────────────────────────
  // Appended to <head> so index.html stays clean.

  _injectStyle() {
    const style = document.createElement('style');
    style.textContent = `
/* ── Root overlay ─────────────────────────────────────── */
#hud {
  position: fixed;
  inset: 0;
  pointer-events: none;
  font-family: 'Courier New', monospace;
  user-select: none;
  z-index: 10;
}

/* ── Outer glow wrapper (positions + drop-shadow) ─────── */
.hud-glow-wrap {
  position: absolute;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  pointer-events: auto;
  filter:
    drop-shadow(0 0 6px  rgba(0, 180, 255, 0.55))
    drop-shadow(0 0 22px rgba(0,  90, 220, 0.30));
}

/* ── Main panel ───────────────────────────────────────── */
/* Octagonal corners via clip-path; border follows the cut */
.hud-panel {
  width: 460px;
  background: rgba(0, 7, 22, 0.92);
  border: 1px solid rgba(0, 180, 255, 0.35);
  padding: 14px 20px 16px;
  overflow: hidden;
  position: relative;
  clip-path: polygon(
    18px 0%,   calc(100% - 18px) 0%,
    100% 18px, 100% calc(100% - 18px),
    calc(100% - 18px) 100%, 18px 100%,
    0% calc(100% - 18px), 0% 18px
  );
  animation: hud-border-pulse 3.5s ease-in-out infinite;
}

@keyframes hud-border-pulse {
  0%, 100% { border-color: rgba(0, 180, 255, 0.30); }
  50%       { border-color: rgba(0, 230, 255, 0.65); }
}

/* ── Scan line ────────────────────────────────────────── */
/* A soft horizontal band sweeps top-to-bottom continuously */
.hud-panel::after {
  content: '';
  position: absolute;
  left: 0; right: 0;
  height: 35%;
  top: -35%;
  background: linear-gradient(
    transparent 0%,
    rgba(0, 200, 255, 0.05) 50%,
    transparent 100%
  );
  animation: hud-scan 5s linear infinite;
  pointer-events: none;
}

@keyframes hud-scan {
  0%   { top: -35%; }
  100% { top: 135%; }
}

/* ── Corner accents ───────────────────────────────────── */
/* Four L-shaped brackets drawn with ::before / ::after   */
.hud-corner {
  position: absolute;
  width: 13px;
  height: 13px;
  pointer-events: none;
}
.hud-corner::before,
.hud-corner::after {
  content: '';
  position: absolute;
  background: #00e5ff;
  box-shadow: 0 0 4px #00e5ff;
}
.hud-corner::before { width: 100%; height: 1.5px; top: 0; left: 0; }
.hud-corner::after  { width: 1.5px; height: 100%; top: 0; left: 0; }
.hud-corner.tl { top: 6px;  left: 6px; }
.hud-corner.tr { top: 6px;  right: 6px;  transform: scaleX(-1); }
.hud-corner.bl { bottom: 6px; left: 6px;  transform: scaleY(-1); }
.hud-corner.br { bottom: 6px; right: 6px; transform: scale(-1,-1); }

/* ── Title bar ────────────────────────────────────────── */
.hud-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 9px;
  border-bottom: 1px solid rgba(0, 180, 255, 0.18);
}
.hud-title-text {
  font-size: 10px;
  letter-spacing: 0.28em;
  color: rgba(0, 210, 255, 0.75);
  text-transform: uppercase;
  text-shadow: 0 0 12px rgba(0, 210, 255, 0.6);
}
.hud-online {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 9px;
  letter-spacing: 0.18em;
  color: rgba(105, 240, 174, 0.85);
  text-transform: uppercase;
}
/* Blinking status dot */
.hud-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #69f0ae;
  box-shadow: 0 0 5px #69f0ae;
  animation: hud-blink 2.4s ease-in-out infinite;
}
@keyframes hud-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.25; }
}

/* ── Health bars ──────────────────────────────────────── */
.hud-bars {
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin-bottom: 15px;
}
.bar-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.bar-label {
  width: 46px;
  font-size: 9px;
  letter-spacing: 0.2em;
  color: rgba(140, 200, 255, 0.6);
  text-transform: uppercase;
}
/* Parallelogram track with angled end caps */
.bar-track {
  flex: 1;
  height: 9px;
  background: rgba(0, 180, 255, 0.06);
  border: 1px solid rgba(0, 160, 255, 0.15);
  clip-path: polygon(6px 0%, 100% 0%, calc(100% - 6px) 100%, 0% 100%);
  overflow: hidden;
}
/* Segmented fill via repeating gradient */
.bar-fill {
  height: 100%;
  width: 100%;
  transition: width 0.4s ease;
  background-image: repeating-linear-gradient(
    90deg,
    currentColor  0px,
    currentColor  9px,
    transparent   9px,
    transparent  11px
  );
}
.bar-shield .bar-fill { color: #00e5ff; filter: brightness(1) drop-shadow(0 0 2px #00e5ff); }
.bar-armor  .bar-fill { color: #ffb300; filter: brightness(1) drop-shadow(0 0 2px #ffb300); }
.bar-hull   .bar-fill { color: #69f0ae; filter: brightness(1) drop-shadow(0 0 2px #69f0ae); }
.bar-pct {
  width: 36px;
  text-align: right;
  font-size: 10px;
  letter-spacing: 0.04em;
}
.bar-shield .bar-pct { color: #00e5ff; text-shadow: 0 0 6px #00e5ff; }
.bar-armor  .bar-pct { color: #ffb300; text-shadow: 0 0 6px #ffb300; }
.bar-hull   .bar-pct { color: #69f0ae; text-shadow: 0 0 6px #69f0ae; }

/* ── Buttons ──────────────────────────────────────────── */
.hud-buttons {
  display: flex;
  gap: 10px;
}
/* Hexagonal / arrow-shaped buttons via clip-path */
.hud-buttons button {
  flex: 1;
  padding: 9px 0;
  background: rgba(0, 25, 55, 0.95);
  border: none;
  outline: none;
  color: #00cfff;
  font-family: 'Courier New', monospace;
  font-size: 9px;
  letter-spacing: 0.22em;
  cursor: pointer;
  text-transform: uppercase;
  text-shadow: 0 0 10px rgba(0, 200, 255, 0.8);
  position: relative;
  clip-path: polygon(
    10px 0%, calc(100% - 10px) 0%,
    100% 50%,
    calc(100% - 10px) 100%, 10px 100%,
    0% 50%
  );
  transition: background 0.15s, color 0.15s;
}
/* Inner highlight border drawn via inset box-shadow on a pseudo-element */
.hud-buttons button::before {
  content: '';
  position: absolute;
  inset: 1px;
  background: transparent;
  clip-path: polygon(
    9px 0%, calc(100% - 9px) 0%,
    100% 50%,
    calc(100% - 9px) 100%, 9px 100%,
    0% 50%
  );
  border: 1px solid rgba(0, 160, 255, 0.35);
  pointer-events: none;
  transition: border-color 0.15s;
}
.hud-buttons button:hover {
  background: rgba(0, 55, 100, 0.98);
  text-shadow: 0 0 14px rgba(0, 220, 255, 1);
}
.hud-buttons button:hover::before {
  border-color: rgba(0, 220, 255, 0.7);
}
.hud-buttons button:active {
  background: rgba(0, 90, 150, 1);
}
/* ── Speed row ────────────────────────────────────────── */
.hud-sep {
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(0,180,255,0.18), transparent);
  margin: 10px 0;
}
.hud-speed-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.hud-speed-label {
  width: 46px;
  font-size: 9px;
  letter-spacing: 0.2em;
  color: rgba(140, 200, 255, 0.6);
  text-transform: uppercase;
}
.hud-speed-track {
  flex: 1;
  height: 9px;
  background: rgba(0, 180, 255, 0.06);
  border: 1px solid rgba(0, 160, 255, 0.15);
  clip-path: polygon(6px 0%, 100% 0%, calc(100% - 6px) 100%, 0% 100%);
  overflow: hidden;
  cursor: crosshair;
  transition: border-color 0.15s, background 0.15s;
}
.hud-speed-track:hover {
  border-color: rgba(0, 210, 255, 0.45);
  background: rgba(0, 180, 255, 0.12);
}
.hud-speed-fill {
  height: 100%;
  background-image: repeating-linear-gradient(
    90deg, currentColor 0px, currentColor 9px, transparent 9px, transparent 11px
  );
  color: #00e5ff;
  filter: drop-shadow(0 0 2px #00e5ff);
}
.hud-speed-fill.boost {
  color: #ff8c00;
  filter: drop-shadow(0 0 3px #ff8c00);
}
.hud-speed-num {
  width: 62px;
  text-align: right;
  font-size: 10px;
  letter-spacing: 0.04em;
  color: #00e5ff;
  text-shadow: 0 0 6px #00e5ff;
  transition: color 0.2s, text-shadow 0.2s;
}
.hud-speed-num.boost {
  color: #ff8c00;
  text-shadow: 0 0 8px #ff8c00;
}
.hud-speed-num small { font-size: 8px; opacity: 0.7; }

/* ── Target info panel (top-right) ───────────────────── */
.tgt-panel {
  position: absolute;
  top: 24px;
  right: 24px;
  width: 200px;
  background: rgba(0, 7, 22, 0.92);
  border: 1px solid rgba(255, 140, 0, 0.35);
  clip-path: polygon(
    14px 0%, 100% 0%,
    100% calc(100% - 14px), calc(100% - 14px) 100%,
    0% 100%, 0% 14px
  );
  pointer-events: auto;
  animation: tgt-panel-in 0.25s ease forwards;
  filter: drop-shadow(0 0 8px rgba(255, 120, 0, 0.35));
}
@keyframes tgt-panel-in {
  from { opacity: 0; transform: translateX(16px); }
  to   { opacity: 1; transform: translateX(0); }
}
.tgt-header {
  padding: 7px 12px 6px;
  border-bottom: 1px solid rgba(255, 140, 0, 0.2);
  background: rgba(255, 100, 0, 0.07);
}
.tgt-header-text {
  font-size: 8px;
  letter-spacing: 0.26em;
  color: #ff8c00;
  text-shadow: 0 0 10px rgba(255, 140, 0, 0.7);
  text-transform: uppercase;
  animation: tgt-blink 1.8s ease-in-out infinite;
}
@keyframes tgt-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.55; }
}
.tgt-body {
  padding: 10px 12px 13px;
}
.tgt-name {
  font-size: 13px;
  letter-spacing: 0.1em;
  color: #00e5ff;
  text-shadow: 0 0 10px rgba(0, 229, 255, 0.65);
  margin-bottom: 3px;
  text-transform: uppercase;
}
.tgt-type {
  font-size: 9px;
  letter-spacing: 0.18em;
  color: rgba(0, 180, 255, 0.55);
  text-transform: uppercase;
  margin-bottom: 10px;
}
.tgt-dist-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 7px;
  border-top: 1px solid rgba(0, 180, 255, 0.12);
}
.tgt-dist-label {
  font-size: 8px;
  letter-spacing: 0.25em;
  color: rgba(140, 200, 255, 0.45);
  text-transform: uppercase;
}
.tgt-dist-val {
  font-size: 11px;
  letter-spacing: 0.06em;
  color: #00cfff;
  text-shadow: 0 0 6px rgba(0, 200, 255, 0.5);
}

/* ── Screen-space targeting reticle ──────────────────── */
.tgt-reticle {
  position: absolute;
  width: 68px;
  height: 68px;
  pointer-events: none;
  transform: translate(-50%, -50%);
  animation: tgt-pulse 2s ease-in-out infinite;
}
@keyframes tgt-pulse {
  0%, 100% { opacity: 1;   transform: translate(-50%, -50%) scale(1);    }
  50%       { opacity: 0.6; transform: translate(-50%, -50%) scale(1.08); }
}
.tgt-corner {
  position: absolute;
  width: 13px;
  height: 13px;
}
.tgt-corner::before,
.tgt-corner::after {
  content: '';
  position: absolute;
  background: #ff8c00;
  box-shadow: 0 0 5px rgba(255, 140, 0, 0.8);
}
.tgt-corner::before { width: 100%; height: 1.5px; top: 0; left: 0; }
.tgt-corner::after  { width: 1.5px; height: 100%; top: 0; left: 0; }
.tgt-corner.tl { top: 0;    left: 0; }
.tgt-corner.tr { top: 0;    right: 0;  transform: scaleX(-1); }
.tgt-corner.bl { bottom: 0; left: 0;   transform: scaleY(-1); }
.tgt-corner.br { bottom: 0; right: 0;  transform: scale(-1,-1); }

/* Dimmed when engine is off */
.hud-buttons button.off {
  color: rgba(70, 95, 115, 0.65);
  text-shadow: none;
  background: rgba(0, 10, 25, 0.9);
}
.hud-buttons button.off::before {
  border-color: rgba(60, 90, 120, 0.2);
}

/* ── FIRE button ──────────────────────────────────────── */
.fire-btn {
  color: #ff6622 !important;
  text-shadow: 0 0 10px rgba(255, 100, 30, 0.8) !important;
}
.fire-btn:hover {
  background: rgba(80, 20, 0, 0.98) !important;
}
.fire-btn:hover::before {
  border-color: rgba(255, 100, 30, 0.7) !important;
}
.fire-btn.cooldown {
  opacity: 0.45;
  pointer-events: none;
}

/* ── WARP button ──────────────────────────────────────── */
.warp-btn {
  color: #cc88ff !important;
  text-shadow: 0 0 10px rgba(180, 100, 255, 0.8) !important;
}
.warp-btn:hover {
  background: rgba(30, 0, 55, 0.98) !important;
}
.warp-btn:hover::before {
  border-color: rgba(180, 100, 255, 0.7) !important;
}
.warp-btn.cooldown {
  opacity: 0.45;
  pointer-events: none;
}

/* ── MINE button ──────────────────────────────────────── */
.mine-btn {
  color: #33ff99 !important;
  text-shadow: 0 0 10px rgba(50, 255, 150, 0.8) !important;
}
.mine-btn:hover {
  background: rgba(0, 40, 20, 0.98) !important;
}
.mine-btn:hover::before {
  border-color: rgba(50, 255, 150, 0.7) !important;
}
.mine-btn.mining {
  color: #ffcc00 !important;
  text-shadow: 0 0 10px rgba(255, 200, 0, 0.8) !important;
  pointer-events: none;
}
.mine-btn.done {
  color: #aaffcc !important;
  text-shadow: none !important;
  pointer-events: none;
}
.mine-btn.depleted {
  color: rgba(80, 110, 90, 0.5) !important;
  text-shadow: none !important;
}

/* ── Warp flash overlay ───────────────────────────────── */
#warp-flash {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 50;
  opacity: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: radial-gradient(ellipse 80% 55% at center,
    rgba(255, 255, 255, 1.0)    0%,
    rgba(160, 210, 255, 0.96)  28%,
    rgba(70,  130, 255, 0.80)  58%,
    rgba(0,   30,  120, 0.0)  100%
  );
  transition: opacity 0.22s ease-in;
}
#warp-flash.fade-out {
  transition: opacity 0.75s ease-out;
}
.warp-flash-label {
  font-family: 'Courier New', monospace;
  font-size: 11px;
  letter-spacing: 0.38em;
  color: rgba(0, 40, 130, 0.85);
  text-transform: uppercase;
  opacity: 0;
  transform: scaleX(2.5);
  transition: opacity 0.12s ease-in, transform 0.22s ease-in;
}
.warp-flash-dest {
  font-family: 'Courier New', monospace;
  font-size: 20px;
  letter-spacing: 0.2em;
  color: rgba(0, 20, 100, 0.9);
  text-transform: uppercase;
  text-shadow: 0 0 24px rgba(100, 180, 255, 0.9);
  opacity: 0;
  transform: scaleX(2.5);
  transition: opacity 0.12s ease-in, transform 0.22s ease-in;
}
#warp-flash.active .warp-flash-label,
#warp-flash.active .warp-flash-dest {
  opacity: 1;
  transform: scaleX(1);
}

/* ── Context menu ─────────────────────────────────────── */
#ctx-menu {
  position: fixed;
  background: rgba(0, 7, 22, 0.97);
  border: 1px solid rgba(0, 180, 255, 0.4);
  clip-path: polygon(
    0% 0%, calc(100% - 16px) 0%,
    100% 16px, 100% 100%,
    16px 100%, 0% calc(100% - 16px)
  );
  min-width: 240px;
  z-index: 30;
  pointer-events: auto;
  filter: drop-shadow(0 0 10px rgba(0, 140, 255, 0.4));
  animation: ctx-in 0.12s ease forwards;
  user-select: none;
}
@keyframes ctx-in {
  from { opacity: 0; transform: scale(0.94); }
  to   { opacity: 1; transform: scale(1); }
}
.ctx-header {
  padding: 8px 14px 7px;
  font-size: 9px;
  letter-spacing: 0.28em;
  color: rgba(0, 210, 255, 0.85);
  text-transform: uppercase;
  text-shadow: 0 0 10px rgba(0, 200, 255, 0.5);
  border-bottom: 1px solid rgba(0, 180, 255, 0.2);
  background: rgba(0, 30, 60, 0.4);
}
.ctx-section {
  padding: 5px 14px 3px;
  font-size: 8px;
  letter-spacing: 0.22em;
  color: rgba(255, 140, 0, 0.7);
  text-transform: uppercase;
  border-top: 1px solid rgba(255, 140, 0, 0.12);
  margin-top: 2px;
}
.ctx-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 14px 6px 20px;
  cursor: pointer;
  transition: background 0.1s;
}
.ctx-item:hover {
  background: rgba(0, 100, 200, 0.25);
}
.ctx-item-label {
  font-size: 11px;
  letter-spacing: 0.08em;
  color: #00e5ff;
  text-shadow: 0 0 6px rgba(0, 229, 255, 0.4);
}
.ctx-item-sub {
  font-size: 8px;
  letter-spacing: 0.14em;
  color: rgba(140, 200, 255, 0.45);
  text-transform: uppercase;
  margin-left: 8px;
  flex: 1;
}
.ctx-item-dist {
  font-size: 10px;
  color: rgba(0, 200, 200, 0.65);
  letter-spacing: 0.04em;
  margin-left: 10px;
  white-space: nowrap;
}
    `;
    document.head.appendChild(style);
  }

  // ── DOM ───────────────────────────────────────────────────────────────────
  // Builds the panel HTML and appends it to <body>.

  _injectDOM() {
    this._el = document.createElement('div');
    this._el.id = 'hud';
    this._el.innerHTML = `
      <!-- Target info panel — top-right, hidden until a target is locked -->
      <div class="tgt-panel" id="tgt-panel" style="display:none">
        <div class="tgt-header">
          <span class="tgt-header-text">&#9654; Target Locked</span>
        </div>
        <div class="tgt-body">
          <div class="tgt-name" id="tgt-name">---</div>
          <div class="tgt-type" id="tgt-type">---</div>
          <div class="tgt-dist-row">
            <span class="tgt-dist-label">Dist</span>
            <span class="tgt-dist-val" id="tgt-dist">---</span>
          </div>

          <!-- Enemy health bars — shown only when target is an NPC -->
          <div id="tgt-enemy-bars" style="display:none">
            <div class="hud-sep" style="margin:7px 0 9px"></div>
            <div class="bar-row bar-shield" id="tgt-bar-s">
              <span class="bar-label">Shield</span>
              <div class="bar-track"><div class="bar-fill" style="width:100%"></div></div>
              <span class="bar-pct">100%</span>
            </div>
            <div class="bar-row bar-armor" id="tgt-bar-a">
              <span class="bar-label">Armor</span>
              <div class="bar-track"><div class="bar-fill" style="width:100%"></div></div>
              <span class="bar-pct">100%</span>
            </div>
            <div class="bar-row bar-hull" id="tgt-bar-h">
              <span class="bar-label">Hull</span>
              <div class="bar-track"><div class="bar-fill" style="width:100%"></div></div>
              <span class="bar-pct">100%</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Screen-space reticle — positioned via JS each frame -->
      <div class="tgt-reticle" id="tgt-reticle" style="display:none">
        <div class="tgt-corner tl"></div>
        <div class="tgt-corner tr"></div>
        <div class="tgt-corner bl"></div>
        <div class="tgt-corner br"></div>
      </div>

      <div class="hud-glow-wrap">
        <div class="hud-panel">

          <div class="hud-corner tl"></div>
          <div class="hud-corner tr"></div>
          <div class="hud-corner bl"></div>
          <div class="hud-corner br"></div>

          <div class="hud-title">
            <span class="hud-title-text">&#9672; Ship Systems &#9672;</span>
            <span class="hud-online"><span class="hud-dot"></span>Online</span>
          </div>

          <div class="hud-bars">
            <div class="bar-row bar-shield">
              <span class="bar-label">Shield</span>
              <div class="bar-track"><div class="bar-fill" style="width:100%"></div></div>
              <span class="bar-pct">100%</span>
            </div>
            <div class="bar-row bar-armor">
              <span class="bar-label">Armor</span>
              <div class="bar-track"><div class="bar-fill" style="width:100%"></div></div>
              <span class="bar-pct">100%</span>
            </div>
            <div class="bar-row bar-hull">
              <span class="bar-label">Hull</span>
              <div class="bar-track"><div class="bar-fill" style="width:100%"></div></div>
              <span class="bar-pct">100%</span>
            </div>
          </div>

          <div class="hud-sep"></div>

          <div class="hud-speed-row">
            <span class="hud-speed-label">Speed</span>
            <div class="hud-speed-track">
              <div class="hud-speed-fill" id="spd-fill" style="width:0%"></div>
            </div>
            <span class="hud-speed-num" id="spd-num">0 <small>m/s</small></span>
          </div>

          <div class="hud-sep"></div>

          <div class="hud-buttons">
            <button id="btn-thrusters">&#9889; Thrusters</button>
            <button id="btn-stop">&#9632; Stop Ship</button>
          </div>

          <div class="hud-sep"></div>

          <div class="hud-buttons">
            <button id="btn-fire" class="fire-btn">&#9650; Fire Rockets</button>
          </div>

          <div id="mine-btn-row" style="display:none">
            <div class="hud-sep"></div>
            <div class="hud-buttons">
              <button id="btn-mine" class="mine-btn">&#9671; Mine Asteroid</button>
            </div>
          </div>

          <div id="warp-btn-row" style="display:none">
            <div class="hud-sep"></div>
            <div class="hud-buttons">
              <button id="btn-warp" class="warp-btn">&#9889; Warp To Target</button>
            </div>
          </div>

        </div>
      </div>
    `;
    document.body.appendChild(this._el);

    // Warp flash overlay — appended separately so it sits above everything
    const flash = document.createElement('div');
    flash.id = 'warp-flash';
    flash.innerHTML = `
      <span class="warp-flash-label">&#9889; Warp Drive Engaged</span>
      <span class="warp-flash-dest" id="warp-dest-name"></span>
    `;
    document.body.appendChild(flash);
    this._warpFlash    = flash;
    this._warpDestName = flash.querySelector('#warp-dest-name');

    this._thrusterBtn   = this._el.querySelector('#btn-thrusters');
    this._stopBtn       = this._el.querySelector('#btn-stop');
    this._fireBtn       = this._el.querySelector('#btn-fire');
    this._mineBtnRow    = this._el.querySelector('#mine-btn-row');
    this._mineBtn       = this._el.querySelector('#btn-mine');
    this._warpBtnRow    = this._el.querySelector('#warp-btn-row');
    this._warpBtn       = this._el.querySelector('#btn-warp');
    this._speedFill     = this._el.querySelector('#spd-fill');
    this._speedNum      = this._el.querySelector('#spd-num');
    this._speedTrack    = this._el.querySelector('.hud-speed-track');
    this._tgtPanel      = this._el.querySelector('#tgt-panel');
    this._tgtName       = this._el.querySelector('#tgt-name');
    this._tgtType       = this._el.querySelector('#tgt-type');
    this._tgtDist       = this._el.querySelector('#tgt-dist');
    this._tgtReticle    = this._el.querySelector('#tgt-reticle');
    this._enemyBars     = this._el.querySelector('#tgt-enemy-bars');
    this._tgtBarShield  = this._el.querySelector('#tgt-bar-s');
    this._tgtBarArmor   = this._el.querySelector('#tgt-bar-a');
    this._tgtBarHull    = this._el.querySelector('#tgt-bar-h');
  }

  // ── Button events ─────────────────────────────────────────────────────────

  _bindButtons() {
    this._onFire  = null;   // set by main.js via setFireCallback()
    this._onMine  = null;   // set by main.js via setMineCallback()
    this._onWarp  = null;   // set by main.js via setWarpCallback()
    this._ctxMenu = null;   // currently open context menu DOM node

    this._thrusterBtn.addEventListener('mousedown', e => {
      e.stopPropagation();                          // block orbit-camera drag
      this._ship.setEngine(!this._ship.engineOn);
      this._syncThrusterButton();
    });

    this._stopBtn.addEventListener('mousedown', e => {
      e.stopPropagation();
      this._ship.stopShip();
      this._syncThrusterButton();
    });

    // ── Speed bar drag ────────────────────────────────────────────────────
    // Click or drag on the track to set target speed (0 – 1000 m/s).
    // Drag is handled via document listeners so the cursor can leave the
    // track without dropping the interaction.
    let dragging = false;

    const applySpeed = e => {
      const rect = this._speedTrack.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this._ship.setTargetSpeed(Math.round(frac * 1000));
      // Auto-enable engine when user explicitly sets a speed
      if (!this._ship.engineOn) {
        this._ship.setEngine(true);
        this._syncThrusterButton();
      }
    };

    this._speedTrack.addEventListener('mousedown', e => {
      e.stopPropagation();
      dragging = true;
      applySpeed(e);
    });

    document.addEventListener('mousemove', e => {
      if (dragging) applySpeed(e);
    });

    document.addEventListener('mouseup', () => { dragging = false; });

    this._fireBtn.addEventListener('mousedown', e => {
      e.stopPropagation();
      if (this._onFire) this._onFire();
    });

    this._mineBtn.addEventListener('mousedown', e => {
      e.stopPropagation();
      if (this._onMine) this._onMine();
    });

    this._warpBtn.addEventListener('mousedown', e => {
      e.stopPropagation();
      if (this._onWarp) this._onWarp();
    });
  }

  // ── Targeting API (called by main.js) ────────────────────────────────────

  // Show the target panel with the locked object's name and type.
  // isEnemy=true reveals the enemy health bars (NPC ships only).
  setTarget(label, type, isEnemy = false) {
    this._tgtName.textContent = label;
    this._tgtType.textContent = type;
    this._tgtDist.textContent = '---';
    this._enemyBars.style.display = isEnemy ? '' : 'none';
    // Reset entry animation by forcing reflow
    this._tgtPanel.style.animation = 'none';
    this._tgtPanel.offsetWidth;      // reflow
    this._tgtPanel.style.animation  = '';
    this._tgtPanel.style.display    = '';
    this._tgtReticle.style.display  = '';
  }

  // Hide target panel and reticle.
  clearTarget() {
    this._tgtPanel.style.display   = 'none';
    this._tgtReticle.style.display = 'none';
    this._enemyBars.style.display  = 'none';
  }

  // Called every frame while a target is locked.
  // distUnits — raw world-unit distance from ship to target.
  // screenX/Y — projected 2D position on the viewport.
  // onScreen  — false when target is behind the camera.
  updateTarget(distUnits, screenX, screenY, onScreen) {
    // Format distance: <1 000 → km  |  <1 000 000 → Mm  |  else → Gm
    let distStr;
    if      (distUnits < 1000) distStr = `${Math.round(distUnits)} km`;
    else if (distUnits < 1e6)  distStr = `${(distUnits / 1000).toFixed(1)} Mm`;
    else                       distStr = `${(distUnits / 1e6).toFixed(2)} Gm`;
    this._tgtDist.textContent = distStr;

    // Move reticle to the target's screen position when it's in front of the camera
    if (onScreen) {
      this._tgtReticle.style.display = '';
      this._tgtReticle.style.left    = `${screenX}px`;
      this._tgtReticle.style.top     = `${screenY}px`;
    } else {
      this._tgtReticle.style.display = 'none';
    }
  }

  // Called every frame from main.js to refresh the speed readout.
  update() {
    const s          = this._ship.speed;
    const pct        = Math.min(s / 1000, 1) * 100;
    const isBoosting = s > 405;   // threshold avoids flicker right at cruise max

    this._speedFill.style.width = pct.toFixed(1) + '%';
    this._speedFill.classList.toggle('boost', isBoosting);
    this._speedNum.innerHTML = Math.round(s) + ' <small>m/s</small>';
    this._speedNum.classList.toggle('boost', isBoosting);
  }

  // ── Combat API ────────────────────────────────────────────────────────────

  // Register the callback invoked when the FIRE button is pressed.
  setFireCallback(fn) { this._onFire = fn; }

  // Grey out the FIRE button for `ms` milliseconds (rate limiting).
  triggerFireCooldown(ms = 600) {
    this._fireBtn.classList.add('cooldown');
    setTimeout(() => this._fireBtn.classList.remove('cooldown'), ms);
  }

  // Update the enemy health bars in the target panel (called every frame).
  updateTargetHealth(shield, armor, hull) {
    _setBar(this._tgtBarShield, shield);
    _setBar(this._tgtBarArmor,  armor);
    _setBar(this._tgtBarHull,   hull);
  }

  // ── Mining API ────────────────────────────────────────────────────────────

  setMineCallback(fn) { this._onMine = fn; }

  // Show or hide the Mine Asteroid button.
  // alreadyMined: true = show in "depleted" state (greyed, no pointer events).
  showMineButton(show, alreadyMined = false) {
    this._mineBtnRow.style.display = show ? '' : 'none';
    if (show) {
      this._mineBtn.classList.toggle('depleted', alreadyMined);
      if (alreadyMined) {
        this._mineBtn.innerHTML  = '&#9671; Depleted';
        this._mineBtn.style.pointerEvents = 'none';
      } else {
        this._mineBtn.style.pointerEvents = '';
      }
    }
  }

  // Update the mine button to reflect progress (0–1), or null to reset.
  setMiningProgress(pct) {
    if (pct === null) {
      this._mineBtn.innerHTML = '&#9671; Mine Asteroid';
      this._mineBtn.classList.remove('mining', 'done');
    } else if (pct >= 1) {
      this._mineBtn.innerHTML = '&#10003; Resource Acquired';
      this._mineBtn.classList.remove('mining');
      this._mineBtn.classList.add('done');
    } else {
      this._mineBtn.innerHTML = `&#9671; Mining... ${Math.round(pct * 100)}%`;
      this._mineBtn.classList.add('mining');
      this._mineBtn.classList.remove('done');
    }
  }

  // ── Warp API ──────────────────────────────────────────────────────────────

  setWarpCallback(fn) { this._onWarp = fn; }

  // Show or hide the Warp button; label is the target's name.
  showWarpButton(show, label = 'Target') {
    this._warpBtnRow.style.display = show ? '' : 'none';
    if (show) this._warpBtn.innerHTML = `&#9889; Warp To ${label}`;
  }

  // Full-screen hyperspace flash; calls onPeak() when screen is fully white
  // so the caller can teleport the ship while nothing is visible.
  triggerWarpFlash(destLabel, onPeak) {
    const el = this._warpFlash;
    this._warpDestName.textContent = destLabel;
    el.classList.remove('fade-out', 'active');

    // Force reflow so the transition fires cleanly
    el.offsetWidth;                           // eslint-disable-line no-unused-expressions

    el.style.opacity = '1';
    el.classList.add('active');

    setTimeout(() => {
      onPeak();
      el.classList.add('fade-out');
      el.classList.remove('active');
      el.style.opacity = '0';
      setTimeout(() => el.classList.remove('fade-out'), 800);
    }, 240);
  }

  // ── Context menu API ──────────────────────────────────────────────────────

  // Show a sci-fi context menu at (x, y) with the given items.
  // items: [{ category, label, subtype, dist, onSelect }]
  showContextMenu(items, x, y) {
    this.hideContextMenu();

    const menu = document.createElement('div');
    menu.id = 'ctx-menu';

    // Group by category, preserving insertion order
    const cats = {};
    for (const item of items) {
      if (!cats[item.category]) cats[item.category] = [];
      cats[item.category].push(item);
    }

    let html = `<div class="ctx-header">&#9670; Spatial Objects</div>`;
    for (const [cat, list] of Object.entries(cats)) {
      html += `<div class="ctx-section">${cat}</div>`;
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        const d  = it.dist;
        const ds = d < 1000 ? `${Math.round(d)} km`
                 : d < 1e6  ? `${(d / 1000).toFixed(1)} Mm`
                 :             `${(d / 1e6).toFixed(2)} Gm`;
        html += `
          <div class="ctx-item" data-cat="${cat}" data-idx="${i}">
            <span class="ctx-item-label">${it.label}</span>
            <span class="ctx-item-sub">${it.subtype}</span>
            <span class="ctx-item-dist">${ds}</span>
          </div>`;
      }
    }

    menu.innerHTML = html;

    // Position, clamped so the menu doesn't overflow the right/bottom edge
    const W = window.innerWidth, H = window.innerHeight;
    menu.style.left = `${Math.min(x, W - 260)}px`;
    menu.style.top  = `${Math.min(y, H - 40)}px`;  // rough estimate; adjusts after render

    // Wire item clicks
    menu.querySelectorAll('.ctx-item').forEach(el => {
      const cat = el.dataset.cat;
      const idx = parseInt(el.dataset.idx);
      el.addEventListener('mousedown', e => {
        e.stopPropagation();
        cats[cat][idx].onSelect();
        this.hideContextMenu();
      });
    });

    document.body.appendChild(menu);
    this._ctxMenu = menu;

    // Re-clamp vertically now that we know the actual height
    requestAnimationFrame(() => {
      if (!this._ctxMenu) return;
      const rect = menu.getBoundingClientRect();
      if (rect.bottom > H - 8) {
        menu.style.top = `${Math.max(8, H - rect.height - 8)}px`;
      }
    });
  }

  hideContextMenu() {
    if (this._ctxMenu) { this._ctxMenu.remove(); this._ctxMenu = null; }
  }

  // Keep THRUSTERS button label/style in sync with ship.engineOn.
  _syncThrusterButton() {
    if (this._ship.engineOn) {
      this._thrusterBtn.innerHTML = '&#9889; Thrusters';
      this._thrusterBtn.classList.remove('off');
    } else {
      this._thrusterBtn.innerHTML = '&#9889; Thrusters: Off';
      this._thrusterBtn.classList.add('off');
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  dispose() {
    this._el.remove();
  }
}
