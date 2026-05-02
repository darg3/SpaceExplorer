// ── Helpers ───────────────────────────────────────────────────────────────────

// Update a bar-row's fill width and percentage text. Used by enemy bars only;
// player health now drives the orb arcs (see _setArc).
function _setBar(row, pct) {
  row.querySelector(".bar-fill").style.width = pct + "%";
  row.querySelector(".bar-pct").textContent = Math.round(pct) + "%";
}

// Set an SVG <circle>'s stroke-dasharray so it renders an arc covering pct%
// (0..100) of its circumference. Combined with `transform: rotate(-90deg)` on
// the parent SVG, the arc starts at 12 o'clock and grows clockwise.
function _setArc(circle, pct, radius) {
  const C = 2 * Math.PI * radius;
  const len = (Math.max(0, Math.min(100, pct)) / 100) * C;
  circle.style.strokeDasharray = len + " " + (C - len);
}

// ── HUD ───────────────────────────────────────────────────────────────────────
// Holographic-orb redesign. The bottom-center panel now centers on a glowing
// core wrapped by three concentric SVG arc rings — one per system:
//
//   • Outer arc (cyan)  → Shield
//   • Middle arc (amber) → Armor
//   • Inner arc (green)  → Hull
//
// Each arc's length encodes its system's current %. The core pulses faster as
// the ship accelerates (driven from update() each frame). Speed slider, action
// buttons, target panel, reticle, damage vignette, warp flash, crosshair, and
// context menu retain their previous design and behaviour.
//
// Public API matches the legacy implementation (see commented block below):
//   setTarget / clearTarget / updateTarget / update
//   setFireCallback / triggerFireCooldown
//   updateTargetHealth / setPlayerHealth / flashDamage / setHullWarning
//   setMineCallback / showMineButton / setMiningProgress
//   setWarpCallback / showWarpButton / triggerWarpFlash
//   showContextMenu / hideContextMenu / dispose

export class HUD {
  constructor(ship) {
    this._ship = ship;
    this._injectStyle();
    this._injectDOM();
    this._bindButtons();
    this._tgtPanelPositioned = false;
    this._updateScale();
    this._initLayoutAndDrag();
  }

  // ── Responsive scale ──────────────────────────────────────────────────────

  _updateScale() {
    const ref = Math.min(window.innerWidth / 1600, window.innerHeight / 900);
    const scale = Math.max(0.5, Math.min(1.1, ref * 0.85));
    document.documentElement.style.setProperty("--hud-scale", scale.toFixed(3));
    this._hudScale = scale;
  }

  // ── Drag-and-drop layout ──────────────────────────────────────────────────

  _initLayoutAndDrag() {
    // Place main HUD at default bottom-center using its rendered size
    requestAnimationFrame(() => {
      const r = this._hudGlowWrap.getBoundingClientRect();
      const x = (window.innerWidth - r.width) / 2;
      const y = window.innerHeight - r.height - 28;
      this._setPanelPos(this._hudGlowWrap, x, y);
    });

    this._attachDrag(this._hudGlowWrap);
    this._attachDrag(this._tgtPanel);

    // Document-level mousemove/mouseup so the drag continues even if the
    // cursor leaves the panel during a fast drag
    document.addEventListener("mousemove", e => {
      if (!this._dragState) return;
      const { panel, offX, offY } = this._dragState;
      this._setPanelPos(panel, e.clientX - offX, e.clientY - offY);
    });
    document.addEventListener("mouseup", () => {
      if (!this._dragState) return;
      this._dragState.panel.classList.remove("dragging");
      this._dragState = null;
    });
  }

  _attachDrag(panel) {
    panel.addEventListener("mousedown", e => {
      // Don't start a drag when clicking interactive elements inside the panel
      if (e.target.closest("button, input, .hud-speed-track")) return;
      const r = panel.getBoundingClientRect();
      this._dragState = {
        panel,
        offX: e.clientX - r.left,
        offY: e.clientY - r.top,
      };
      panel.classList.add("dragging");
      e.preventDefault();
    });
  }

  // Set panel position in viewport pixels, clamped so the panel stays visible.
  _setPanelPos(panel, x, y) {
    const r = panel.getBoundingClientRect();
    const maxX = Math.max(0, window.innerWidth  - r.width);
    const maxY = Math.max(0, window.innerHeight - r.height);
    const cx = Math.max(0, Math.min(maxX, x));
    const cy = Math.max(0, Math.min(maxY, y));
    panel.style.left = cx + "px";
    panel.style.top  = cy + "px";
  }

  // Called from main.js's window resize listener.
  onWindowResize() {
    this._updateScale();
    // Re-clamp positions; panels stay where they were unless they'd go offscreen
    requestAnimationFrame(() => {
      const hr = this._hudGlowWrap.getBoundingClientRect();
      this._setPanelPos(this._hudGlowWrap, hr.left, hr.top);
      if (this._tgtPanelPositioned) {
        const tr = this._tgtPanel.getBoundingClientRect();
        this._setPanelPos(this._tgtPanel, tr.left, tr.top);
      }
    });
  }

  // ── Style ─────────────────────────────────────────────────────────────────

  _injectStyle() {
    const style = document.createElement("style");
    style.textContent = `
:root { --hud-scale: 0.75; }

/* ── Root overlay ─────────────────────────────────────── */
#hud {
  position: fixed;
  inset: 0;
  pointer-events: none;
  font-family: 'Courier New', monospace;
  user-select: none;
  z-index: 10;
}

/* ── Outer glow wrapper ───────────────────────────────── */
.hud-glow-wrap {
  position: fixed;
  transform: scale(var(--hud-scale));
  transform-origin: top left;
  cursor: grab;
  pointer-events: auto;
  filter:
    drop-shadow(0 0 6px  rgba(0, 180, 255, 0.55))
    drop-shadow(0 0 22px rgba(0,  90, 220, 0.30));
}
.hud-glow-wrap.dragging { cursor: grabbing; }

/* ── Main panel ───────────────────────────────────────── */
.hud-panel {
  width: 320px;
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
  50%      { border-color: rgba(0, 230, 255, 0.65); }
}

/* ── Scan line ────────────────────────────────────────── */
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
.hud-corner.tl { top: 6px;    left: 6px; }
.hud-corner.tr { top: 6px;    right: 6px;  transform: scaleX(-1); }
.hud-corner.bl { bottom: 6px; left: 6px;   transform: scaleY(-1); }
.hud-corner.br { bottom: 6px; right: 6px;  transform: scale(-1,-1); }

/* ── Title bar ────────────────────────────────────────── */
.hud-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
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
  50%      { opacity: 0.25; }
}

/* ── Holographic Orb ──────────────────────────────────── */
/* Container sized to the SVG viewBox; absolute children are positioned
   around it. Three SVG <circle>s render the arcs; their stroke-dasharray
   is updated per-frame via setPlayerHealth(). The SVG itself is rotated
   -90deg so each arc starts at 12 o'clock and grows clockwise. */
.orb-wrap {
  position: relative;
  width: 200px;
  height: 200px;
  margin: 8px auto 4px;
}
.orb-svg {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
  filter: drop-shadow(0 0 6px rgba(0, 180, 255, 0.25));
}
.orb-track {
  fill: none;
  stroke: rgba(0, 180, 255, 0.08);
  stroke-width: 3;
}
.orb-arc {
  fill: none;
  stroke-width: 4;
  stroke-linecap: round;
  transition: stroke-dasharray 0.35s ease;
}
.orb-shd-arc { stroke: #00e5ff; filter: drop-shadow(0 0 4px rgba(0, 229, 255, 0.9)); }
.orb-arm-arc { stroke: #ffb300; filter: drop-shadow(0 0 4px rgba(255, 179, 0, 0.9)); }
.orb-hul-arc { stroke: #69f0ae; filter: drop-shadow(0 0 4px rgba(105, 240, 174, 0.9)); }

/* Decorative orbiting tick ring between the arcs and the core */
.orb-orbit {
  position: absolute;
  top: 50%; left: 50%;
  width: 92px; height: 92px;
  margin: -46px 0 0 -46px;
  border: 1px dashed rgba(0, 200, 255, 0.25);
  border-radius: 50%;
  animation: orb-orbit-spin 22s linear infinite;
  pointer-events: none;
}
@keyframes orb-orbit-spin {
  to { transform: rotate(360deg); }
}

/* Pulsing core. Transform & box-shadow are written each frame from update(). */
.orb-core {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 60px; height: 60px;
  border-radius: 50%;
  background: radial-gradient(circle, #b6f5ff 0%, #00e5ff 45%, #003a66 100%);
  box-shadow:
    0 0 24px rgba(0, 229, 255, 0.85),
    inset 0 0 16px rgba(255, 255, 255, 0.3);
  pointer-events: none;
}

/* Numeric stat readouts arranged around the orb (top / right / bottom) */
.orb-stat {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  font-size: 9px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  pointer-events: none;
}
.orb-stat .orb-key { font-size: 8px; opacity: 0.7; }
.orb-stat .orb-val { font-size: 11px; font-weight: bold; text-shadow: 0 0 6px currentColor; }
.orb-stat-shd { top: -4px;    left: 50%; transform: translateX(-50%); color: #00e5ff; }
.orb-stat-arm { top: 50%;     right: -4px; transform: translateY(-50%); color: #ffb300; }
.orb-stat-hul { bottom: -4px; left: 50%; transform: translateX(-50%); color: #69f0ae; }

/* ── Bars (kept for ENEMY target panel only) ─────────── */
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
.bar-track {
  flex: 1;
  height: 9px;
  background: rgba(0, 180, 255, 0.06);
  border: 1px solid rgba(0, 160, 255, 0.15);
  clip-path: polygon(6px 0%, 100% 0%, calc(100% - 6px) 100%, 0% 100%);
  overflow: hidden;
}
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
.hud-buttons button.off {
  color: rgba(70, 95, 115, 0.65);
  text-shadow: none;
  background: rgba(0, 10, 25, 0.9);
}
.hud-buttons button.off::before {
  border-color: rgba(60, 90, 120, 0.2);
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

/* ── Credits panel (top-left) ────────────────────────── */
.hud-score-panel {
  position: fixed;
  top: 24px;
  left: 24px;
  padding: 7px 14px;
  background: rgba(0, 7, 22, 0.92);
  border: 1px solid rgba(0, 180, 255, 0.35);
  clip-path: polygon(
    12px 0%, 100% 0%,
    100% calc(100% - 12px), calc(100% - 12px) 100%,
    0% 100%, 0% 12px
  );
  pointer-events: none;
  transform: scale(var(--hud-scale));
  transform-origin: top left;
  filter: drop-shadow(0 0 6px rgba(0, 180, 255, 0.45));
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-family: 'Courier New', monospace;
}
.hud-score-label {
  font-size: 11px;
  letter-spacing: 1.5px;
  color: rgba(0, 200, 255, 0.75);
}
.hud-score-num {
  font-size: 18px;
  font-weight: bold;
  color: #00e5ff;
  text-shadow: 0 0 6px #00ccff;
  min-width: 36px;
  text-align: right;
}

/* ── Target info panel (top-right) ───────────────────── */
.tgt-panel {
  position: fixed;
  width: 200px;
  background: rgba(0, 7, 22, 0.92);
  border: 1px solid rgba(255, 140, 0, 0.35);
  clip-path: polygon(
    14px 0%, 100% 0%,
    100% calc(100% - 14px), calc(100% - 14px) 100%,
    0% 100%, 0% 14px
  );
  pointer-events: auto;
  transform: scale(var(--hud-scale));
  transform-origin: top left;
  cursor: grab;
  animation: tgt-panel-in 0.25s ease forwards;
  filter: drop-shadow(0 0 8px rgba(255, 120, 0, 0.35));
}
.tgt-panel.dragging { cursor: grabbing; }
@keyframes tgt-panel-in {
  from { opacity: 0; transform: translateX(16px) scale(var(--hud-scale)); }
  to   { opacity: 1; transform: translateX(0)    scale(var(--hud-scale)); }
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
  50%      { opacity: 0.55; }
}
.tgt-body { padding: 10px 12px 13px; }
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
  transform: translate(-50%, -50%) scale(0.75);
  animation: tgt-pulse 2s ease-in-out infinite;
}
@keyframes tgt-pulse {
  0%, 100% { opacity: 1;   transform: translate(-50%, -50%) scale(0.75); }
  50%      { opacity: 0.6; transform: translate(-50%, -50%) scale(0.81); }
}
.tgt-corner { position: absolute; width: 13px; height: 13px; }
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

/* ── FIRE button ──────────────────────────────────────── */
.fire-btn { color: #ff6622 !important; text-shadow: 0 0 10px rgba(255, 100, 30, 0.8) !important; }
.fire-btn:hover { background: rgba(80, 20, 0, 0.98) !important; }
.fire-btn:hover::before { border-color: rgba(255, 100, 30, 0.7) !important; }
.fire-btn.cooldown { opacity: 0.45; pointer-events: none; }

/* ── WARP button ──────────────────────────────────────── */
.warp-btn { color: #cc88ff !important; text-shadow: 0 0 10px rgba(180, 100, 255, 0.8) !important; }
.warp-btn:hover { background: rgba(30, 0, 55, 0.98) !important; }
.warp-btn:hover::before { border-color: rgba(180, 100, 255, 0.7) !important; }
.warp-btn.cooldown { opacity: 0.45; pointer-events: none; }

/* ── DOCK button ──────────────────────────────────────── */
.dock-btn { color: #ffcc44 !important; text-shadow: 0 0 10px rgba(255, 200, 80, 0.8) !important; }
.dock-btn:hover { background: rgba(60, 40, 0, 0.98) !important; }
.dock-btn:hover::before { border-color: rgba(255, 200, 80, 0.7) !important; }
.dock-btn.disabled { opacity: 0.45; pointer-events: none; }

/* ── MINE button ──────────────────────────────────────── */
.mine-btn { color: #33ff99 !important; text-shadow: 0 0 10px rgba(50, 255, 150, 0.8) !important; }
.mine-btn:hover { background: rgba(0, 40, 20, 0.98) !important; }
.mine-btn:hover::before { border-color: rgba(50, 255, 150, 0.7) !important; }
.mine-btn.mining { color: #ffcc00 !important; text-shadow: 0 0 10px rgba(255, 200, 0, 0.8) !important; pointer-events: none; }
.mine-btn.done { color: #aaffcc !important; text-shadow: none !important; pointer-events: none; }
.mine-btn.depleted { color: rgba(80, 110, 90, 0.5) !important; text-shadow: none !important; }

/* ── Damage vignette ──────────────────────────────────── */
#damage-vignette {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 200;
  box-shadow: inset 0 0 120px rgba(255, 0, 0, 0.85);
  opacity: 0;
}
@keyframes dmg-flash {
  0%   { opacity: 1; }
  100% { opacity: 0; }
}
#damage-vignette.flashing {
  animation: dmg-flash 0.9s ease-out forwards;
}

/* ── Crosshair ────────────────────────────────────────── */
#crosshair {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0.75);
  width: 24px;
  height: 24px;
  pointer-events: none;
  z-index: 50;
  opacity: 0.75;
}
#crosshair::before,
#crosshair::after {
  content: '';
  position: absolute;
  background: #00e5ff;
  box-shadow: 0 0 4px rgba(0, 229, 255, 0.7);
}
#crosshair::before {
  width: 2px; height: 100%;
  left: 50%; top: 0;
  transform: translateX(-50%);
}
#crosshair::after {
  height: 2px; width: 100%;
  top: 50%; left: 0;
  transform: translateY(-50%);
}

/* ── Hull critical warning ────────────────────────────── */
@keyframes hull-warn {
  0%, 100% { filter: drop-shadow(0 0 6px rgba(255,  0,  0, 0.0)) drop-shadow(0 0 22px rgba(0, 90, 220, 0.30)); }
  50%      { filter: drop-shadow(0 0 18px rgba(255, 50, 50, 0.9)) drop-shadow(0 0 22px rgba(0, 90, 220, 0.30)); }
}
.hud-glow-wrap.hull-critical {
  animation: hull-warn 0.8s ease-in-out infinite !important;
}

/* ── Fire cooldown countdown ──────────────────────────── */
#fire-cooldown-num {
  font-size: 10px;
  margin-left: 6px;
  opacity: 0.9;
  color: #ff9955;
}

/* ── Weapon loadout strip ─────────────────────────────── */
.weap-strip {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.weap-slot {
  flex: 1;
  position: relative;
  padding: 6px 4px 5px;
  background: rgba(0, 18, 40, 0.85);
  border: 1px solid rgba(0, 160, 255, 0.22);
  cursor: pointer;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  clip-path: polygon(
    8px 0%, calc(100% - 8px) 0%,
    100% 8px, 100% calc(100% - 8px),
    calc(100% - 8px) 100%, 8px 100%,
    0% calc(100% - 8px), 0% 8px
  );
  transition: background 0.15s, border-color 0.15s;
}
.weap-slot:hover {
  background: rgba(0, 40, 80, 0.95);
  border-color: rgba(0, 220, 255, 0.5);
}
.weap-slot.active {
  background: rgba(60, 20, 0, 0.9);
  border-color: rgba(255, 140, 60, 0.7);
  box-shadow: 0 0 10px rgba(255, 120, 30, 0.45);
}
.weap-slot.active .weap-name {
  color: #ff9955;
  text-shadow: 0 0 8px rgba(255, 120, 30, 0.85);
}
.weap-key {
  font-size: 9px;
  letter-spacing: 0.1em;
  color: rgba(140, 200, 255, 0.55);
  font-weight: bold;
}
.weap-slot.active .weap-key {
  color: #ffaa66;
}
.weap-name {
  font-size: 9px;
  letter-spacing: 0.18em;
  color: #00cfff;
  text-shadow: 0 0 6px rgba(0, 200, 255, 0.55);
  text-transform: uppercase;
}
.weap-ammo {
  font-size: 9px;
  letter-spacing: 0.06em;
  color: #69f0ae;
  text-shadow: 0 0 4px rgba(105, 240, 174, 0.6);
}
.weap-ammo.empty {
  color: #ff5555;
  text-shadow: 0 0 6px rgba(255, 80, 80, 0.7);
}
@keyframes weap-ammo-flash {
  0%, 100% { transform: scale(1); }
  40%      { transform: scale(1.25); color: #ff3333; }
}
.weap-ammo.flash { animation: weap-ammo-flash 0.4s ease; }
.weap-charge {
  width: 100%;
  height: 4px;
  background: rgba(0, 180, 255, 0.06);
  border: 1px solid rgba(0, 160, 255, 0.18);
  margin-top: 1px;
  overflow: hidden;
}
.weap-charge-fill {
  height: 100%;
  width: 0%;
  background-image: repeating-linear-gradient(
    90deg, #cc88ff 0px, #cc88ff 6px, transparent 6px, transparent 8px
  );
  filter: drop-shadow(0 0 3px #cc88ff);
  transition: width 0.05s linear;
}
.weap-charge-fill.full {
  background-image: repeating-linear-gradient(
    90deg, #ffccff 0px, #ffccff 6px, transparent 6px, transparent 8px
  );
  filter: drop-shadow(0 0 5px #ffaaff);
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

/* ── Combat log (NPC-hits-you message) ────────────────── */
#combat-log {
  position: fixed;
  top: 18%;
  left: 50%;
  transform: translateX(-50%);
  pointer-events: none;
  z-index: 60;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  letter-spacing: 0.15em;
  color: #ff5555;
  text-shadow: 0 0 8px rgba(255, 60, 60, 0.7);
  text-transform: uppercase;
  opacity: 0;
  transition: opacity 0.18s ease-out;
  white-space: nowrap;
}
#combat-log.show { opacity: 1; }

/* ── Game-over overlay ────────────────────────────────── */
#game-over {
  position: fixed;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 300;
  background: radial-gradient(ellipse at center,
    rgba(20, 0, 0, 0.55) 0%,
    rgba(0, 0, 0, 0.85) 70%,
    rgba(0, 0, 0, 0.95) 100%
  );
  font-family: 'Courier New', monospace;
}
#game-over .go-panel {
  background: rgba(0, 7, 22, 0.94);
  border: 1px solid rgba(255, 80, 80, 0.55);
  padding: 36px 56px 28px;
  text-align: center;
  clip-path: polygon(
    18px 0%,   calc(100% - 18px) 0%,
    100% 18px, 100% calc(100% - 18px),
    calc(100% - 18px) 100%, 18px 100%,
    0% calc(100% - 18px), 0% 18px
  );
  filter: drop-shadow(0 0 18px rgba(255, 60, 60, 0.45));
}
#game-over .go-title {
  color: #ff5555;
  font-size: 28px;
  letter-spacing: 0.4em;
  text-shadow: 0 0 18px rgba(255, 60, 60, 0.85);
  margin-bottom: 8px;
}
#game-over .go-sub {
  color: rgba(220, 200, 200, 0.75);
  font-size: 12px;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  margin-bottom: 22px;
}
#game-over .go-btn {
  pointer-events: auto;
  cursor: pointer;
  background: transparent;
  color: #00e5ff;
  border: 1px solid rgba(0, 180, 255, 0.55);
  padding: 10px 22px;
  font-family: 'Courier New', monospace;
  font-size: 14px;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  text-shadow: 0 0 10px rgba(0, 200, 255, 0.6);
  transition: background 0.15s, color 0.15s;
}
#game-over .go-btn:hover {
  background: rgba(0, 180, 255, 0.15);
  color: #ffffff;
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
  transform: scale(0.75);
  transform-origin: top left;
  filter: drop-shadow(0 0 10px rgba(0, 140, 255, 0.4));
  animation: ctx-in 0.12s ease forwards;
  user-select: none;
}
@keyframes ctx-in {
  from { opacity: 0; transform: scale(0.7);  }
  to   { opacity: 1; transform: scale(0.75); }
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
.ctx-item:hover { background: rgba(0, 100, 200, 0.25); }
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

/* ── Damage vignette ──────────────────────────────────── */
#damage-vignette {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 200;
  box-shadow: inset 0 0 120px rgba(255, 0, 0, 0.85);
  opacity: 0;
}
@keyframes dmg-flash {
  0%   { opacity: 1; }
  100% { opacity: 0; }
}
#damage-vignette.flashing {
  animation: dmg-flash 0.9s ease-out forwards;
}

/* ── Crosshair ────────────────────────────────────────── */
#crosshair {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0.75);
  width: 24px;
  height: 24px;
  pointer-events: none;
  z-index: 50;
  opacity: 0.75;
}
#crosshair::before,
#crosshair::after {
  content: '';
  position: absolute;
  background: #00e5ff;
  box-shadow: 0 0 4px rgba(0, 229, 255, 0.7);
}
#crosshair::before {
  width: 2px;
  height: 100%;
  left: 50%;
  top: 0;
  transform: translateX(-50%);
}
#crosshair::after {
  height: 2px;
  width: 100%;
  top: 50%;
  left: 0;
  transform: translateY(-50%);
}

/* ── Hull critical warning ────────────────────────────── */
@keyframes hull-warn {
  0%, 100% { filter: drop-shadow(0 0 6px rgba(255,  0,  0, 0.0)) drop-shadow(0 0 22px rgba(0, 90, 220, 0.30)); }
  50%       { filter: drop-shadow(0 0 18px rgba(255, 50, 50, 0.9)) drop-shadow(0 0 22px rgba(0, 90, 220, 0.30)); }
}
.hud-glow-wrap.hull-critical {
  animation: hull-warn 0.8s ease-in-out infinite !important;
}

/* ── Fire cooldown countdown ──────────────────────────── */
#fire-cooldown-num {
  font-size: 10px;
  margin-left: 6px;
  opacity: 0.9;
  color: #ff9955;
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
  transform: scale(0.75);
  transform-origin: top left;
  filter: drop-shadow(0 0 10px rgba(0, 140, 255, 0.4));
  animation: ctx-in 0.12s ease forwards;
  user-select: none;
}
@keyframes ctx-in {
  from { opacity: 0; transform: scale(0.7);  }
  to   { opacity: 1; transform: scale(0.75); }
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

  _injectDOM() {
    this._el = document.createElement("div");
    this._el.id = "hud";
    this._el.innerHTML = `
      <!-- Credits counter — top-left, persistent -->
      <div class="hud-score-panel" id="hud-score">
        <span class="hud-score-label">CREDITS</span>
        <span class="hud-score-num" id="hud-score-num">0</span>
      </div>

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

          <!-- Holographic orb: three concentric arcs encode shield/armor/hull -->
          <div class="orb-wrap">
            <svg class="orb-svg" viewBox="0 0 200 200">
              <circle class="orb-track" cx="100" cy="100" r="78" />
              <circle class="orb-track" cx="100" cy="100" r="64" />
              <circle class="orb-track" cx="100" cy="100" r="50" />
              <circle class="orb-arc orb-shd-arc" cx="100" cy="100" r="78" id="orb-shd-arc" />
              <circle class="orb-arc orb-arm-arc" cx="100" cy="100" r="64" id="orb-arm-arc" />
              <circle class="orb-arc orb-hul-arc" cx="100" cy="100" r="50" id="orb-hul-arc" />
            </svg>
            <div class="orb-orbit"></div>
            <div class="orb-core" id="orb-core"></div>
            <div class="orb-stat orb-stat-shd"><span class="orb-key">SHD</span><span class="orb-val" id="orb-shd-num">100</span></div>
            <div class="orb-stat orb-stat-arm"><span class="orb-key">ARM</span><span class="orb-val" id="orb-arm-num">100</span></div>
            <div class="orb-stat orb-stat-hul"><span class="orb-key">HUL</span><span class="orb-val" id="orb-hul-num">100</span></div>
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

          <div class="weap-strip">
            <div class="weap-slot" data-idx="1">
              <span class="weap-key">[1]</span>
              <span class="weap-name">Laser</span>
            </div>
            <div class="weap-slot" data-idx="2">
              <span class="weap-key">[2]</span>
              <span class="weap-name">Missile</span>
              <span class="weap-ammo" id="weap-ammo">12/12</span>
            </div>
            <div class="weap-slot" data-idx="3">
              <span class="weap-key">[3]</span>
              <span class="weap-name">Plasma</span>
              <div class="weap-charge"><div class="weap-charge-fill" id="weap-charge-fill"></div></div>
            </div>
          </div>

          <div class="hud-buttons">
            <button id="btn-fire" class="fire-btn">&#9650; Fire Laser<span id="fire-cooldown-num" style="display:none"></span></button>
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

          <div id="dock-btn-row" style="display:none">
            <div class="hud-sep"></div>
            <div class="hud-buttons">
              <button id="btn-dock" class="dock-btn">&#9678; Dock at Station</button>
            </div>
          </div>

        </div>
      </div>

      <!-- Fixed crosshair centered on screen -->
      <div id="crosshair"></div>
    `;
    document.body.appendChild(this._el);

    // Damage vignette — full viewport red flash on hit
    const vignette = document.createElement("div");
    vignette.id = "damage-vignette";
    document.body.appendChild(vignette);
    this._damageVignette = vignette;

    // Warp flash overlay — appended separately so it sits above everything
    const flash = document.createElement("div");
    flash.id = "warp-flash";
    flash.innerHTML = `
      <span class="warp-flash-label">&#9889; Warp Drive Engaged</span>
      <span class="warp-flash-dest" id="warp-dest-name"></span>
    `;
    document.body.appendChild(flash);
    this._warpFlash = flash;
    this._warpDestName = flash.querySelector("#warp-dest-name");

    // Combat log — small fading text shown when an NPC damages the player
    const combatLog = document.createElement("div");
    combatLog.id = "combat-log";
    document.body.appendChild(combatLog);
    this._combatLog      = combatLog;
    this._combatLogTimer = null;

    // Game-over overlay — shown when the player ship is destroyed
    const gameOver = document.createElement("div");
    gameOver.id = "game-over";
    gameOver.innerHTML = `
      <div class="go-panel">
        <div class="go-title">SHIP DESTROYED</div>
        <div class="go-sub">Hull integrity lost</div>
        <button id="btn-restart" class="go-btn">&#10227; Restart Game</button>
      </div>
    `;
    document.body.appendChild(gameOver);
    this._gameOver  = gameOver;
    this._restartBtn = gameOver.querySelector("#btn-restart");
    this._onRestart  = null;
    this._restartBtn.addEventListener("click", () => this._onRestart?.());

    // Cache DOM references
    this._thrusterBtn   = this._el.querySelector("#btn-thrusters");
    this._stopBtn       = this._el.querySelector("#btn-stop");
    this._fireBtn       = this._el.querySelector("#btn-fire");
    this._mineBtnRow    = this._el.querySelector("#mine-btn-row");
    this._mineBtn       = this._el.querySelector("#btn-mine");
    this._warpBtnRow    = this._el.querySelector("#warp-btn-row");
    this._warpBtn       = this._el.querySelector("#btn-warp");
    this._dockBtnRow    = this._el.querySelector("#dock-btn-row");
    this._dockBtn       = this._el.querySelector("#btn-dock");
    this._speedFill     = this._el.querySelector("#spd-fill");
    this._speedNum      = this._el.querySelector("#spd-num");
    this._speedTrack    = this._el.querySelector(".hud-speed-track");
    this._tgtPanel      = this._el.querySelector("#tgt-panel");
    this._tgtName       = this._el.querySelector("#tgt-name");
    this._tgtType       = this._el.querySelector("#tgt-type");
    this._tgtDist       = this._el.querySelector("#tgt-dist");
    this._tgtReticle    = this._el.querySelector("#tgt-reticle");
    this._enemyBars     = this._el.querySelector("#tgt-enemy-bars");
    this._tgtBarShield  = this._el.querySelector("#tgt-bar-s");
    this._tgtBarArmor   = this._el.querySelector("#tgt-bar-a");
    this._tgtBarHull    = this._el.querySelector("#tgt-bar-h");
    this._hudGlowWrap   = this._el.querySelector(".hud-glow-wrap");
    this._fireCooldownNum = this._el.querySelector("#fire-cooldown-num");

    // Orb-specific references
    this._orbCore   = this._el.querySelector("#orb-core");
    this._orbShdArc = this._el.querySelector("#orb-shd-arc");
    this._orbArmArc = this._el.querySelector("#orb-arm-arc");
    this._orbHulArc = this._el.querySelector("#orb-hul-arc");
    this._orbShdNum = this._el.querySelector("#orb-shd-num");
    this._orbArmNum = this._el.querySelector("#orb-arm-num");
    this._orbHulNum = this._el.querySelector("#orb-hul-num");
    this._scoreNum  = this._el.querySelector("#hud-score-num");

    // Weapon strip
    this._weapSlots      = Array.from(this._el.querySelectorAll(".weap-slot"));
    this._weapAmmo       = this._el.querySelector("#weap-ammo");
    this._weapChargeFill = this._el.querySelector("#weap-charge-fill");

    // Initialize arcs at full health
    _setArc(this._orbShdArc, 100, 78);
    _setArc(this._orbArmArc, 100, 64);
    _setArc(this._orbHulArc, 100, 50);
  }

  // ── Score ─────────────────────────────────────────────────────────────────

  setScore(n) {
    this._scoreNum.textContent = String(n);
  }

  // ── Button events ─────────────────────────────────────────────────────────

  _bindButtons() {
    this._onFirePress    = null; // set by main.js via setFirePressCallback()
    this._onFireRelease  = null; // set by main.js via setFireReleaseCallback()
    this._onWeaponSelect = null; // set by main.js via setWeaponSelectCallback()
    this._onMine = null; // set by main.js via setMineCallback()
    this._onWarp = null; // set by main.js via setWarpCallback()
    this._onDock = null; // set by main.js via setDockCallback()
    this._ctxMenu = null; // currently open context menu DOM node

    this._thrusterBtn.addEventListener("mousedown", (e) => {
      e.stopPropagation(); // block orbit-camera drag
      this._ship.setEngine(!this._ship.engineOn);
      this._syncThrusterButton();
    });

    this._stopBtn.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      this._ship.stopShip();
      this._syncThrusterButton();
    });

    // ── Speed bar drag ────────────────────────────────────────────────────
    // Click or drag on the track to set target speed (0 – 1000 m/s).
    let dragging = false;
    const applySpeed = (e) => {
      const rect = this._speedTrack.getBoundingClientRect();
      const frac = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width),
      );
      this._ship.setTargetSpeed(Math.round(frac * 1000));
      if (!this._ship.engineOn) {
        this._ship.setEngine(true);
        this._syncThrusterButton();
      }
    };

    this._speedTrack.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      dragging = true;
      applySpeed(e);
    });
    document.addEventListener("mousemove", (e) => {
      if (dragging) applySpeed(e);
    });
    document.addEventListener("mouseup", () => {
      dragging = false;
    });

    // Fire button: split mousedown/mouseup so plasma can charge-and-release.
    // mouseleave also releases so a drag-off the button doesn't strand a charge.
    this._fireBtn.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      if (this._onFirePress) this._onFirePress();
    });
    this._fireBtn.addEventListener("mouseup", (e) => {
      e.stopPropagation();
      if (this._onFireRelease) this._onFireRelease();
    });
    this._fireBtn.addEventListener("mouseleave", () => {
      if (this._onFireRelease) this._onFireRelease();
    });

    // Weapon slot click → switch active weapon
    for (const slot of this._weapSlots) {
      slot.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        const idx = parseInt(slot.dataset.idx, 10);
        if (this._onWeaponSelect) this._onWeaponSelect(idx);
      });
    }

    this._mineBtn.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      if (this._onMine) this._onMine();
    });
    this._warpBtn.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      if (this._onWarp) this._onWarp();
    });
    this._dockBtn.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      if (this._onDock) this._onDock();
    });
  }

  // ── Targeting API ────────────────────────────────────────────────────────

  // Show the target panel with the locked object's name and type.
  // isEnemy=true reveals the enemy health bars (NPC ships only).
  setTarget(label, type, isEnemy = false) {
    this._tgtName.textContent = label;
    this._tgtType.textContent = type;
    this._tgtDist.textContent = "---";
    this._enemyBars.style.display = isEnemy ? "" : "none";
    // Reset entry animation by forcing reflow
    this._tgtPanel.style.animation = "none";
    this._tgtPanel.offsetWidth;
    this._tgtPanel.style.animation = "";
    this._tgtPanel.style.display = "";
    this._tgtReticle.style.display = "";

    // Lazy default position the first time the panel is shown (it starts
    // display:none so its size isn't measurable until after this point).
    if (!this._tgtPanelPositioned) {
      requestAnimationFrame(() => {
        const r = this._tgtPanel.getBoundingClientRect();
        const x = window.innerWidth - r.width - 24;
        this._setPanelPos(this._tgtPanel, x, 24);
        this._tgtPanelPositioned = true;
      });
    }
  }

  clearTarget() {
    this._tgtPanel.style.display = "none";
    this._tgtReticle.style.display = "none";
    this._enemyBars.style.display = "none";
  }

  // distUnits — raw world-unit distance from ship to target.
  // screenX/Y — projected 2D position on the viewport.
  // onScreen  — false when target is behind the camera.
  updateTarget(distUnits, screenX, screenY, onScreen) {
    let distStr;
    if (distUnits < 1000) distStr = `${Math.round(distUnits)} km`;
    else if (distUnits < 1e6) distStr = `${(distUnits / 1000).toFixed(1)} Mm`;
    else distStr = `${(distUnits / 1e6).toFixed(2)} Gm`;
    this._tgtDist.textContent = distStr;

    if (onScreen) {
      this._tgtReticle.style.display = "";
      this._tgtReticle.style.left = `${screenX}px`;
      this._tgtReticle.style.top = `${screenY}px`;
    } else {
      this._tgtReticle.style.display = "none";
    }
  }

  // ── Per-frame update ─────────────────────────────────────────────────────
  // Refreshes the speed readout AND drives the orb core's pulse. The pulse
  // rate scales linearly with speed (0.5 Hz idle → 3 Hz at top speed) so the
  // HUD "breathes" faster as the ship accelerates.
  update() {
    const s = this._ship.speed;
    const pct = Math.min(s / 1000, 1) * 100;
    const isBoosting = s > 405;

    this._speedFill.style.width = pct.toFixed(1) + "%";
    this._speedFill.classList.toggle("boost", isBoosting);
    this._speedNum.innerHTML = Math.round(s) + " <small>m/s</small>";
    this._speedNum.classList.toggle("boost", isBoosting);

    // Drive the orb core via a manual sine wave so changing pulse rate
    // doesn't cause the CSS animation to restart and stutter.
    const t = performance.now() / 1000;
    const speedFrac = Math.min(s / 1000, 1);
    const pulseHz = 0.5 + speedFrac * 2.5;
    const pulse = 0.5 + 0.5 * Math.sin(t * pulseHz * Math.PI * 2);
    const scale = 1 + 0.08 * pulse;
    const glow = 18 + 18 * pulse;
    this._orbCore.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
    this._orbCore.style.boxShadow =
      `0 0 ${glow.toFixed(1)}px rgba(0, 229, 255, 0.85), inset 0 0 16px rgba(255,255,255,0.3)`;
  }

  // ── Combat API ────────────────────────────────────────────────────────────

  setFirePressCallback(fn)    { this._onFirePress = fn; }
  setFireReleaseCallback(fn)  { this._onFireRelease = fn; }
  setWeaponSelectCallback(fn) { this._onWeaponSelect = fn; }

  // Highlight the active weapon slot and re-label the fire button.
  setActiveWeapon(idx) {
    const labels = { 1: "&#9650; Fire Laser", 2: "&#9650; Fire Missile", 3: "&#9650; Fire Plasma" };
    for (const slot of this._weapSlots) {
      slot.classList.toggle("active", parseInt(slot.dataset.idx, 10) === idx);
    }
    const cooldownSpan = '<span id="fire-cooldown-num" style="display:none"></span>';
    this._fireBtn.innerHTML = (labels[idx] || labels[1]) + cooldownSpan;
    this._fireCooldownNum = this._el.querySelector("#fire-cooldown-num");
  }

  setMissileAmmo(n, max) {
    if (!this._weapAmmo) return;
    this._weapAmmo.textContent = `${n}/${max}`;
    this._weapAmmo.classList.toggle("empty", n <= 0);
  }

  // Quick attention-flash on the missile counter (e.g. when out of ammo).
  flashMissileAmmo() {
    if (!this._weapAmmo) return;
    this._weapAmmo.classList.remove("flash");
    void this._weapAmmo.offsetWidth;
    this._weapAmmo.classList.add("flash");
  }

  setPlasmaCharge(pct) {
    if (!this._weapChargeFill) return;
    const p = Math.max(0, Math.min(1, pct));
    this._weapChargeFill.style.width = (p * 100).toFixed(1) + "%";
    this._weapChargeFill.classList.toggle("full", p >= 1);
  }

  triggerFireCooldown(ms = 600) {
    this._fireBtn.classList.add("cooldown");
    const num = this._fireCooldownNum;
    const end = performance.now() + ms;
    num.style.display = "";
    const tick = () => {
      const remaining = end - performance.now();
      if (remaining <= 0) {
        this._fireBtn.classList.remove("cooldown");
        num.style.display = "none";
        return;
      }
      num.textContent = " " + (remaining / 1000).toFixed(1) + "s";
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Update enemy health bars in the target panel (called every frame).
  updateTargetHealth(shield, armor, hull) {
    _setBar(this._tgtBarShield, shield);
    _setBar(this._tgtBarArmor, armor);
    _setBar(this._tgtBarHull, hull);
  }

  // Player health drives the orb arcs and numeric readouts.
  setPlayerHealth(shield, armor, hull) {
    _setArc(this._orbShdArc, shield, 78);
    _setArc(this._orbArmArc, armor, 64);
    _setArc(this._orbHulArc, hull, 50);
    this._orbShdNum.textContent = Math.round(shield);
    this._orbArmNum.textContent = Math.round(armor);
    this._orbHulNum.textContent = Math.round(hull);
  }

  flashDamage() {
    const v = this._damageVignette;
    v.classList.remove("flashing");
    void v.offsetWidth;
    v.classList.add("flashing");
  }

  setHullWarning(critical) {
    this._hudGlowWrap.classList.toggle("hull-critical", critical);
  }

  // ── Mining API ────────────────────────────────────────────────────────────

  setMineCallback(fn) { this._onMine = fn; }

  showMineButton(show, alreadyMined = false) {
    this._mineBtnRow.style.display = show ? "" : "none";
    if (show) {
      this._mineBtn.classList.toggle("depleted", alreadyMined);
      if (alreadyMined) {
        this._mineBtn.innerHTML = "&#9671; Depleted";
        this._mineBtn.style.pointerEvents = "none";
      } else {
        this._mineBtn.style.pointerEvents = "";
      }
    }
  }

  setMiningProgress(pct) {
    if (pct === null) {
      this._mineBtn.innerHTML = "&#9671; Mine Asteroid";
      this._mineBtn.classList.remove("mining", "done");
    } else if (pct >= 1) {
      this._mineBtn.innerHTML = "&#10003; Resource Acquired";
      this._mineBtn.classList.remove("mining");
      this._mineBtn.classList.add("done");
    } else {
      this._mineBtn.innerHTML = `&#9671; Mining... ${Math.round(pct * 100)}%`;
      this._mineBtn.classList.add("mining");
      this._mineBtn.classList.remove("done");
    }
  }

  // ── Warp API ──────────────────────────────────────────────────────────────

  setWarpCallback(fn) { this._onWarp = fn; }

  showWarpButton(show, label = "Target") {
    this._warpBtnRow.style.display = show ? "" : "none";
    if (show) this._warpBtn.innerHTML = `&#9889; Warp To ${label}`;
  }

  // ── Dock API ──────────────────────────────────────────────────────────────

  setDockCallback(fn) { this._onDock = fn; }

  showDockButton(show, inRange = true) {
    this._dockBtnRow.style.display = show ? "" : "none";
    if (show) {
      this._dockBtn.classList.toggle("disabled", !inRange);
      this._dockBtn.innerHTML = inRange
        ? "&#9678; Dock at Station"
        : "&#9678; Approach to Dock";
    }
  }

  // ── Combat log ────────────────────────────────────────────────────────────

  showCombatMessage(text) {
    this._combatLog.textContent = text;
    this._combatLog.classList.add("show");
    if (this._combatLogTimer) clearTimeout(this._combatLogTimer);
    this._combatLogTimer = setTimeout(
      () => this._combatLog.classList.remove("show"),
      1600,
    );
  }

  // ── Game over ─────────────────────────────────────────────────────────────

  setRestartCallback(fn) { this._onRestart = fn; }

  showGameOver(onRestart) {
    if (onRestart) this._onRestart = onRestart;
    this._gameOver.style.display = "flex";
  }

  triggerWarpFlash(destLabel, onPeak) {
    const el = this._warpFlash;
    this._warpDestName.textContent = destLabel;
    el.classList.remove("fade-out", "active");
    el.offsetWidth; // reflow
    el.style.opacity = "1";
    el.classList.add("active");
    setTimeout(() => {
      onPeak();
      el.classList.add("fade-out");
      el.classList.remove("active");
      el.style.opacity = "0";
      setTimeout(() => el.classList.remove("fade-out"), 800);
    }, 240);
  }

  // ── Context menu API ──────────────────────────────────────────────────────

  showContextMenu(items, x, y) {
    this.hideContextMenu();
    const menu = document.createElement("div");
    menu.id = "ctx-menu";

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
        const d = it.dist;
        const ds =
          d < 1000
            ? `${Math.round(d)} km`
            : d < 1e6
              ? `${(d / 1000).toFixed(1)} Mm`
              : `${(d / 1e6).toFixed(2)} Gm`;
        html += `
          <div class="ctx-item" data-cat="${cat}" data-idx="${i}">
            <span class="ctx-item-label">${it.label}</span>
            <span class="ctx-item-sub">${it.subtype}</span>
            <span class="ctx-item-dist">${ds}</span>
          </div>`;
      }
    }
    menu.innerHTML = html;

    const W = window.innerWidth, H = window.innerHeight;
    menu.style.left = `${Math.min(x, W - 260)}px`;
    menu.style.top = `${Math.min(y, H - 40)}px`;

    menu.querySelectorAll(".ctx-item").forEach((el) => {
      const cat = el.dataset.cat;
      const idx = parseInt(el.dataset.idx);
      el.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        cats[cat][idx].onSelect();
        this.hideContextMenu();
      });
    });

    document.body.appendChild(menu);
    this._ctxMenu = menu;

    requestAnimationFrame(() => {
      if (!this._ctxMenu) return;
      const rect = menu.getBoundingClientRect();
      if (rect.bottom > H - 8) {
        menu.style.top = `${Math.max(8, H - rect.height - 8)}px`;
      }
    });
  }

  hideContextMenu() {
    if (this._ctxMenu) {
      this._ctxMenu.remove();
      this._ctxMenu = null;
    }
  }

  // Keep THRUSTERS button label/style in sync with ship.engineOn.
  _syncThrusterButton() {
    if (this._ship.engineOn) {
      this._thrusterBtn.innerHTML = "&#9889; Thrusters";
      this._thrusterBtn.classList.remove("off");
    } else {
      this._thrusterBtn.innerHTML = "&#9889; Thrusters: Off";
      this._thrusterBtn.classList.add("off");
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  dispose() {
    this._el.remove();
  }
}


// ════════════════════════════════════════════════════════════════════════════
// LEGACY HUD (pre-orb redesign) — kept for reference / restore
// Each line below is prefixed with // so the whole block is inert. To roll
// back to the original bar-based HUD, replace the new HUD class above with
// this implementation (uncomment by stripping the leading "// " from each
// line).
// ════════════════════════════════════════════════════════════════════════════
// // ── Helpers ───────────────────────────────────────────────────────────────────
// 
// // Update a bar-row's fill width and percentage text.
// function _setBar(row, pct) {
//   row.querySelector(".bar-fill").style.width = pct + "%";
//   row.querySelector(".bar-pct").textContent = Math.round(pct) + "%";
// }
// 
// // ── HUD ───────────────────────────────────────────────────────────────────────
// // Injects a fixed HTML overlay onto the page (no Three.js required).
// // Displays Shield / Armor / Hull health bars and two engine control buttons.
// //
// // Design notes:
// //   • #hud has pointer-events:none so the canvas orbit camera works everywhere
// //     outside the panel — only the panel itself re-enables pointer events.
// //   • Button mousedown calls e.stopPropagation() to prevent triggering the
// //     window-level mousedown that starts orbit-camera dragging (main.js).
// //   • The outer .hud-glow-wrap carries filter:drop-shadow so the glow follows
// //     the clipped octagonal shape (clip-path clips before filter on same element).
// 
// export class HUD {
//   constructor(ship) {
//     this._ship = ship;
//     this._thrusterBtn = null;
//     this._stopBtn = null;
//     this._el = null;
// 
//     this._injectStyle();
//     this._injectDOM();
//     this._bindButtons();
//   }
// 
//   // ── Style ─────────────────────────────────────────────────────────────────
//   // Appended to <head> so index.html stays clean.
// 
//   _injectStyle() {
//     const style = document.createElement("style");
//     style.textContent = `
// /* ── Root overlay ─────────────────────────────────────── */
// #hud {
//   position: fixed;
//   inset: 0;
//   pointer-events: none;
//   font-family: 'Courier New', monospace;
//   user-select: none;
//   z-index: 10;
// }
// 
// /* ── Outer glow wrapper (positions + drop-shadow) ─────── */
// .hud-glow-wrap {
//   position: absolute;
//   bottom: 28px;
//   left: 50%;
//   transform: translateX(-50%) scale(0.75);
//   transform-origin: bottom center;
//   pointer-events: auto;
//   filter:
//     drop-shadow(0 0 6px  rgba(0, 180, 255, 0.55))
//     drop-shadow(0 0 22px rgba(0,  90, 220, 0.30));
// }
// 
// /* ── Main panel ───────────────────────────────────────── */
// /* Octagonal corners via clip-path; border follows the cut */
// .hud-panel {
//   // width: 460px;
//   width: 300px;
//   background: rgba(0, 7, 22, 0.92);
//   border: 1px solid rgba(0, 180, 255, 0.35);
//   padding: 14px 20px 16px;
//   overflow: hidden;
//   position: relative;
//   clip-path: polygon(
//     18px 0%,   calc(100% - 18px) 0%,
//     100% 18px, 100% calc(100% - 18px),
//     calc(100% - 18px) 100%, 18px 100%,
//     0% calc(100% - 18px), 0% 18px
//   );
//   animation: hud-border-pulse 3.5s ease-in-out infinite;
// }
// 
// @keyframes hud-border-pulse {
//   0%, 100% { border-color: rgba(0, 180, 255, 0.30); }
//   50%       { border-color: rgba(0, 230, 255, 0.65); }
// }
// 
// /* ── Scan line ────────────────────────────────────────── */
// /* A soft horizontal band sweeps top-to-bottom continuously */
// .hud-panel::after {
//   content: '';
//   position: absolute;
//   left: 0; right: 0;
//   height: 35%;
//   top: -35%;
//   background: linear-gradient(
//     transparent 0%,
//     rgba(0, 200, 255, 0.05) 50%,
//     transparent 100%
//   );
//   animation: hud-scan 5s linear infinite;
//   pointer-events: none;
// }
// 
// @keyframes hud-scan {
//   0%   { top: -35%; }
//   100% { top: 135%; }
// }
// 
// /* ── Corner accents ───────────────────────────────────── */
// /* Four L-shaped brackets drawn with ::before / ::after   */
// .hud-corner {
//   position: absolute;
//   width: 13px;
//   height: 13px;
//   pointer-events: none;
// }
// .hud-corner::before,
// .hud-corner::after {
//   content: '';
//   position: absolute;
//   background: #00e5ff;
//   box-shadow: 0 0 4px #00e5ff;
// }
// .hud-corner::before { width: 100%; height: 1.5px; top: 0; left: 0; }
// .hud-corner::after  { width: 1.5px; height: 100%; top: 0; left: 0; }
// .hud-corner.tl { top: 6px;  left: 6px; }
// .hud-corner.tr { top: 6px;  right: 6px;  transform: scaleX(-1); }
// .hud-corner.bl { bottom: 6px; left: 6px;  transform: scaleY(-1); }
// .hud-corner.br { bottom: 6px; right: 6px; transform: scale(-1,-1); }
// 
// /* ── Title bar ────────────────────────────────────────── */
// .hud-title {
//   display: flex;
//   justify-content: space-between;
//   align-items: center;
//   margin-bottom: 12px;
//   padding-bottom: 9px;
//   border-bottom: 1px solid rgba(0, 180, 255, 0.18);
// }
// .hud-title-text {
//   font-size: 10px;
//   letter-spacing: 0.28em;
//   color: rgba(0, 210, 255, 0.75);
//   text-transform: uppercase;
//   text-shadow: 0 0 12px rgba(0, 210, 255, 0.6);
// }
// .hud-online {
//   display: flex;
//   align-items: center;
//   gap: 5px;
//   font-size: 9px;
//   letter-spacing: 0.18em;
//   color: rgba(105, 240, 174, 0.85);
//   text-transform: uppercase;
// }
// /* Blinking status dot */
// .hud-dot {
//   width: 5px;
//   height: 5px;
//   border-radius: 50%;
//   background: #69f0ae;
//   box-shadow: 0 0 5px #69f0ae;
//   animation: hud-blink 2.4s ease-in-out infinite;
// }
// @keyframes hud-blink {
//   0%, 100% { opacity: 1; }
//   50%       { opacity: 0.25; }
// }
// 
// /* ── Health bars ──────────────────────────────────────── */
// .hud-bars {
//   display: flex;
//   flex-direction: column;
//   gap: 9px;
//   margin-bottom: 15px;
// }
// .bar-row {
//   display: flex;
//   align-items: center;
//   gap: 10px;
// }
// .bar-label {
//   width: 46px;
//   font-size: 9px;
//   letter-spacing: 0.2em;
//   color: rgba(140, 200, 255, 0.6);
//   text-transform: uppercase;
// }
// /* Parallelogram track with angled end caps */
// .bar-track {
//   flex: 1;
//   height: 9px;
//   background: rgba(0, 180, 255, 0.06);
//   border: 1px solid rgba(0, 160, 255, 0.15);
//   clip-path: polygon(6px 0%, 100% 0%, calc(100% - 6px) 100%, 0% 100%);
//   overflow: hidden;
// }
// /* Segmented fill via repeating gradient */
// .bar-fill {
//   height: 100%;
//   width: 100%;
//   transition: width 0.4s ease;
//   background-image: repeating-linear-gradient(
//     90deg,
//     currentColor  0px,
//     currentColor  9px,
//     transparent   9px,
//     transparent  11px
//   );
// }
// .bar-shield .bar-fill { color: #00e5ff; filter: brightness(1) drop-shadow(0 0 2px #00e5ff); }
// .bar-armor  .bar-fill { color: #ffb300; filter: brightness(1) drop-shadow(0 0 2px #ffb300); }
// .bar-hull   .bar-fill { color: #69f0ae; filter: brightness(1) drop-shadow(0 0 2px #69f0ae); }
// .bar-pct {
//   width: 36px;
//   text-align: right;
//   font-size: 10px;
//   letter-spacing: 0.04em;
// }
// .bar-shield .bar-pct { color: #00e5ff; text-shadow: 0 0 6px #00e5ff; }
// .bar-armor  .bar-pct { color: #ffb300; text-shadow: 0 0 6px #ffb300; }
// .bar-hull   .bar-pct { color: #69f0ae; text-shadow: 0 0 6px #69f0ae; }
// 
// /* ── Buttons ──────────────────────────────────────────── */
// .hud-buttons {
//   display: flex;
//   gap: 10px;
// }
// /* Hexagonal / arrow-shaped buttons via clip-path */
// .hud-buttons button {
//   flex: 1;
//   padding: 9px 0;
//   background: rgba(0, 25, 55, 0.95);
//   border: none;
//   outline: none;
//   color: #00cfff;
//   font-family: 'Courier New', monospace;
//   font-size: 9px;
//   letter-spacing: 0.22em;
//   cursor: pointer;
//   text-transform: uppercase;
//   text-shadow: 0 0 10px rgba(0, 200, 255, 0.8);
//   position: relative;
//   clip-path: polygon(
//     10px 0%, calc(100% - 10px) 0%,
//     100% 50%,
//     calc(100% - 10px) 100%, 10px 100%,
//     0% 50%
//   );
//   transition: background 0.15s, color 0.15s;
// }
// /* Inner highlight border drawn via inset box-shadow on a pseudo-element */
// .hud-buttons button::before {
//   content: '';
//   position: absolute;
//   inset: 1px;
//   background: transparent;
//   clip-path: polygon(
//     9px 0%, calc(100% - 9px) 0%,
//     100% 50%,
//     calc(100% - 9px) 100%, 9px 100%,
//     0% 50%
//   );
//   border: 1px solid rgba(0, 160, 255, 0.35);
//   pointer-events: none;
//   transition: border-color 0.15s;
// }
// .hud-buttons button:hover {
//   background: rgba(0, 55, 100, 0.98);
//   text-shadow: 0 0 14px rgba(0, 220, 255, 1);
// }
// .hud-buttons button:hover::before {
//   border-color: rgba(0, 220, 255, 0.7);
// }
// .hud-buttons button:active {
//   background: rgba(0, 90, 150, 1);
// }
// /* ── Speed row ────────────────────────────────────────── */
// .hud-sep {
//   height: 1px;
//   background: linear-gradient(90deg, transparent, rgba(0,180,255,0.18), transparent);
//   margin: 10px 0;
// }
// .hud-speed-row {
//   display: flex;
//   align-items: center;
//   gap: 10px;
// }
// .hud-speed-label {
//   width: 46px;
//   font-size: 9px;
//   letter-spacing: 0.2em;
//   color: rgba(140, 200, 255, 0.6);
//   text-transform: uppercase;
// }
// .hud-speed-track {
//   flex: 1;
//   height: 9px;
//   background: rgba(0, 180, 255, 0.06);
//   border: 1px solid rgba(0, 160, 255, 0.15);
//   clip-path: polygon(6px 0%, 100% 0%, calc(100% - 6px) 100%, 0% 100%);
//   overflow: hidden;
//   cursor: crosshair;
//   transition: border-color 0.15s, background 0.15s;
// }
// .hud-speed-track:hover {
//   border-color: rgba(0, 210, 255, 0.45);
//   background: rgba(0, 180, 255, 0.12);
// }
// .hud-speed-fill {
//   height: 100%;
//   background-image: repeating-linear-gradient(
//     90deg, currentColor 0px, currentColor 9px, transparent 9px, transparent 11px
//   );
//   color: #00e5ff;
//   filter: drop-shadow(0 0 2px #00e5ff);
// }
// .hud-speed-fill.boost {
//   color: #ff8c00;
//   filter: drop-shadow(0 0 3px #ff8c00);
// }
// .hud-speed-num {
//   width: 62px;
//   text-align: right;
//   font-size: 10px;
//   letter-spacing: 0.04em;
//   color: #00e5ff;
//   text-shadow: 0 0 6px #00e5ff;
//   transition: color 0.2s, text-shadow 0.2s;
// }
// .hud-speed-num.boost {
//   color: #ff8c00;
//   text-shadow: 0 0 8px #ff8c00;
// }
// .hud-speed-num small { font-size: 8px; opacity: 0.7; }
// 
// /* ── Target info panel (top-right) ───────────────────── */
// .tgt-panel {
//   position: absolute;
//   top: 24px;
//   right: 24px;
//   width: 200px;
//   background: rgba(0, 7, 22, 0.92);
//   border: 1px solid rgba(255, 140, 0, 0.35);
//   clip-path: polygon(
//     14px 0%, 100% 0%,
//     100% calc(100% - 14px), calc(100% - 14px) 100%,
//     0% 100%, 0% 14px
//   );
//   pointer-events: auto;
//   transform: scale(0.75);
//   transform-origin: top right;
//   animation: tgt-panel-in 0.25s ease forwards;
//   filter: drop-shadow(0 0 8px rgba(255, 120, 0, 0.35));
// }
// @keyframes tgt-panel-in {
//   from { opacity: 0; transform: translateX(16px) scale(0.75); }
//   to   { opacity: 1; transform: translateX(0)    scale(0.75); }
// }
// .tgt-header {
//   padding: 7px 12px 6px;
//   border-bottom: 1px solid rgba(255, 140, 0, 0.2);
//   background: rgba(255, 100, 0, 0.07);
// }
// .tgt-header-text {
//   font-size: 8px;
//   letter-spacing: 0.26em;
//   color: #ff8c00;
//   text-shadow: 0 0 10px rgba(255, 140, 0, 0.7);
//   text-transform: uppercase;
//   animation: tgt-blink 1.8s ease-in-out infinite;
// }
// @keyframes tgt-blink {
//   0%, 100% { opacity: 1; }
//   50%       { opacity: 0.55; }
// }
// .tgt-body {
//   padding: 10px 12px 13px;
// }
// .tgt-name {
//   font-size: 13px;
//   letter-spacing: 0.1em;
//   color: #00e5ff;
//   text-shadow: 0 0 10px rgba(0, 229, 255, 0.65);
//   margin-bottom: 3px;
//   text-transform: uppercase;
// }
// .tgt-type {
//   font-size: 9px;
//   letter-spacing: 0.18em;
//   color: rgba(0, 180, 255, 0.55);
//   text-transform: uppercase;
//   margin-bottom: 10px;
// }
// .tgt-dist-row {
//   display: flex;
//   justify-content: space-between;
//   align-items: center;
//   padding-top: 7px;
//   border-top: 1px solid rgba(0, 180, 255, 0.12);
// }
// .tgt-dist-label {
//   font-size: 8px;
//   letter-spacing: 0.25em;
//   color: rgba(140, 200, 255, 0.45);
//   text-transform: uppercase;
// }
// .tgt-dist-val {
//   font-size: 11px;
//   letter-spacing: 0.06em;
//   color: #00cfff;
//   text-shadow: 0 0 6px rgba(0, 200, 255, 0.5);
// }
// 
// /* ── Screen-space targeting reticle ──────────────────── */
// .tgt-reticle {
//   position: absolute;
//   width: 68px;
//   height: 68px;
//   pointer-events: none;
//   transform: translate(-50%, -50%) scale(0.75);
//   animation: tgt-pulse 2s ease-in-out infinite;
// }
// @keyframes tgt-pulse {
//   0%, 100% { opacity: 1;   transform: translate(-50%, -50%) scale(0.75); }
//   50%       { opacity: 0.6; transform: translate(-50%, -50%) scale(0.81); }
// }
// .tgt-corner {
//   position: absolute;
//   width: 13px;
//   height: 13px;
// }
// .tgt-corner::before,
// .tgt-corner::after {
//   content: '';
//   position: absolute;
//   background: #ff8c00;
//   box-shadow: 0 0 5px rgba(255, 140, 0, 0.8);
// }
// .tgt-corner::before { width: 100%; height: 1.5px; top: 0; left: 0; }
// .tgt-corner::after  { width: 1.5px; height: 100%; top: 0; left: 0; }
// .tgt-corner.tl { top: 0;    left: 0; }
// .tgt-corner.tr { top: 0;    right: 0;  transform: scaleX(-1); }
// .tgt-corner.bl { bottom: 0; left: 0;   transform: scaleY(-1); }
// .tgt-corner.br { bottom: 0; right: 0;  transform: scale(-1,-1); }
// 
// /* Dimmed when engine is off */
// .hud-buttons button.off {
//   color: rgba(70, 95, 115, 0.65);
//   text-shadow: none;
//   background: rgba(0, 10, 25, 0.9);
// }
// .hud-buttons button.off::before {
//   border-color: rgba(60, 90, 120, 0.2);
// }
// 
// /* ── FIRE button ──────────────────────────────────────── */
// .fire-btn {
//   color: #ff6622 !important;
//   text-shadow: 0 0 10px rgba(255, 100, 30, 0.8) !important;
// }
// .fire-btn:hover {
//   background: rgba(80, 20, 0, 0.98) !important;
// }
// .fire-btn:hover::before {
//   border-color: rgba(255, 100, 30, 0.7) !important;
// }
// .fire-btn.cooldown {
//   opacity: 0.45;
//   pointer-events: none;
// }
// 
// /* ── WARP button ──────────────────────────────────────── */
// .warp-btn {
//   color: #cc88ff !important;
//   text-shadow: 0 0 10px rgba(180, 100, 255, 0.8) !important;
// }
// .warp-btn:hover {
//   background: rgba(30, 0, 55, 0.98) !important;
// }
// .warp-btn:hover::before {
//   border-color: rgba(180, 100, 255, 0.7) !important;
// }
// .warp-btn.cooldown {
//   opacity: 0.45;
//   pointer-events: none;
// }
// 
// /* ── MINE button ──────────────────────────────────────── */
// .mine-btn {
//   color: #33ff99 !important;
//   text-shadow: 0 0 10px rgba(50, 255, 150, 0.8) !important;
// }
// .mine-btn:hover {
//   background: rgba(0, 40, 20, 0.98) !important;
// }
// .mine-btn:hover::before {
//   border-color: rgba(50, 255, 150, 0.7) !important;
// }
// .mine-btn.mining {
//   color: #ffcc00 !important;
//   text-shadow: 0 0 10px rgba(255, 200, 0, 0.8) !important;
//   pointer-events: none;
// }
// .mine-btn.done {
//   color: #aaffcc !important;
//   text-shadow: none !important;
//   pointer-events: none;
// }
// .mine-btn.depleted {
//   color: rgba(80, 110, 90, 0.5) !important;
//   text-shadow: none !important;
// }
// 
// /* ── Damage vignette ──────────────────────────────────── */
// #damage-vignette {
//   position: fixed;
//   inset: 0;
//   pointer-events: none;
//   z-index: 200;
//   box-shadow: inset 0 0 120px rgba(255, 0, 0, 0.85);
//   opacity: 0;
// }
// @keyframes dmg-flash {
//   0%   { opacity: 1; }
//   100% { opacity: 0; }
// }
// #damage-vignette.flashing {
//   animation: dmg-flash 0.9s ease-out forwards;
// }
// 
// /* ── Crosshair ────────────────────────────────────────── */
// #crosshair {
//   position: fixed;
//   top: 50%;
//   left: 50%;
//   transform: translate(-50%, -50%);
//   width: 24px;
//   height: 24px;
//   pointer-events: none;
//   z-index: 50;
//   opacity: 0.75;
// }
// #crosshair::before,
// #crosshair::after {
//   content: '';
//   position: absolute;
//   background: #00e5ff;
//   box-shadow: 0 0 4px rgba(0, 229, 255, 0.7);
// }
// #crosshair::before {
//   width: 2px;
//   height: 100%;
//   left: 50%;
//   top: 0;
//   transform: translateX(-50%);
// }
// #crosshair::after {
//   height: 2px;
//   width: 100%;
//   top: 50%;
//   left: 0;
//   transform: translateY(-50%);
// }
// 
// /* ── Hull critical warning ────────────────────────────── */
// @keyframes hull-warn {
//   0%, 100% { filter: drop-shadow(0 0 6px rgba(255,  0,  0, 0.0)) drop-shadow(0 0 22px rgba(0, 90, 220, 0.30)); }
//   50%       { filter: drop-shadow(0 0 18px rgba(255, 50, 50, 0.9)) drop-shadow(0 0 22px rgba(0, 90, 220, 0.30)); }
// }
// .hud-glow-wrap.hull-critical {
//   animation: hull-warn 0.8s ease-in-out infinite !important;
// }
// 
// /* ── Fire cooldown countdown ──────────────────────────── */
// #fire-cooldown-num {
//   font-size: 10px;
//   margin-left: 6px;
//   opacity: 0.9;
//   color: #ff9955;
// }
// 
// /* ── Warp flash overlay ───────────────────────────────── */
// #warp-flash {
//   position: fixed;
//   inset: 0;
//   pointer-events: none;
//   z-index: 50;
//   opacity: 0;
//   display: flex;
//   flex-direction: column;
//   align-items: center;
//   justify-content: center;
//   gap: 12px;
//   background: radial-gradient(ellipse 80% 55% at center,
//     rgba(255, 255, 255, 1.0)    0%,
//     rgba(160, 210, 255, 0.96)  28%,
//     rgba(70,  130, 255, 0.80)  58%,
//     rgba(0,   30,  120, 0.0)  100%
//   );
//   transition: opacity 0.22s ease-in;
// }
// #warp-flash.fade-out {
//   transition: opacity 0.75s ease-out;
// }
// .warp-flash-label {
//   font-family: 'Courier New', monospace;
//   font-size: 11px;
//   letter-spacing: 0.38em;
//   color: rgba(0, 40, 130, 0.85);
//   text-transform: uppercase;
//   opacity: 0;
//   transform: scaleX(2.5);
//   transition: opacity 0.12s ease-in, transform 0.22s ease-in;
// }
// .warp-flash-dest {
//   font-family: 'Courier New', monospace;
//   font-size: 20px;
//   letter-spacing: 0.2em;
//   color: rgba(0, 20, 100, 0.9);
//   text-transform: uppercase;
//   text-shadow: 0 0 24px rgba(100, 180, 255, 0.9);
//   opacity: 0;
//   transform: scaleX(2.5);
//   transition: opacity 0.12s ease-in, transform 0.22s ease-in;
// }
// #warp-flash.active .warp-flash-label,
// #warp-flash.active .warp-flash-dest {
//   opacity: 1;
//   transform: scaleX(1);
// }
// 
// /* ── Context menu ─────────────────────────────────────── */
// #ctx-menu {
//   position: fixed;
//   background: rgba(0, 7, 22, 0.97);
//   border: 1px solid rgba(0, 180, 255, 0.4);
//   clip-path: polygon(
//     0% 0%, calc(100% - 16px) 0%,
//     100% 16px, 100% 100%,
//     16px 100%, 0% calc(100% - 16px)
//   );
//   min-width: 240px;
//   z-index: 30;
//   pointer-events: auto;
//   filter: drop-shadow(0 0 10px rgba(0, 140, 255, 0.4));
//   animation: ctx-in 0.12s ease forwards;
//   user-select: none;
// }
// @keyframes ctx-in {
//   from { opacity: 0; transform: scale(0.94); }
//   to   { opacity: 1; transform: scale(1); }
// }
// .ctx-header {
//   padding: 8px 14px 7px;
//   font-size: 9px;
//   letter-spacing: 0.28em;
//   color: rgba(0, 210, 255, 0.85);
//   text-transform: uppercase;
//   text-shadow: 0 0 10px rgba(0, 200, 255, 0.5);
//   border-bottom: 1px solid rgba(0, 180, 255, 0.2);
//   background: rgba(0, 30, 60, 0.4);
// }
// .ctx-section {
//   padding: 5px 14px 3px;
//   font-size: 8px;
//   letter-spacing: 0.22em;
//   color: rgba(255, 140, 0, 0.7);
//   text-transform: uppercase;
//   border-top: 1px solid rgba(255, 140, 0, 0.12);
//   margin-top: 2px;
// }
// .ctx-item {
//   display: flex;
//   justify-content: space-between;
//   align-items: center;
//   padding: 6px 14px 6px 20px;
//   cursor: pointer;
//   transition: background 0.1s;
// }
// .ctx-item:hover {
//   background: rgba(0, 100, 200, 0.25);
// }
// .ctx-item-label {
//   font-size: 11px;
//   letter-spacing: 0.08em;
//   color: #00e5ff;
//   text-shadow: 0 0 6px rgba(0, 229, 255, 0.4);
// }
// .ctx-item-sub {
//   font-size: 8px;
//   letter-spacing: 0.14em;
//   color: rgba(140, 200, 255, 0.45);
//   text-transform: uppercase;
//   margin-left: 8px;
//   flex: 1;
// }
// .ctx-item-dist {
//   font-size: 10px;
//   color: rgba(0, 200, 200, 0.65);
//   letter-spacing: 0.04em;
//   margin-left: 10px;
//   white-space: nowrap;
// }
//     `;
//     document.head.appendChild(style);
//   }
// 
//   // ── DOM ───────────────────────────────────────────────────────────────────
//   // Builds the panel HTML and appends it to <body>.
// 
//   _injectDOM() {
//     this._el = document.createElement("div");
//     this._el.id = "hud";
//     this._el.innerHTML = `
//       <!-- Target info panel — top-right, hidden until a target is locked -->
//       <div class="tgt-panel" id="tgt-panel" style="display:none">
//         <div class="tgt-header">
//           <span class="tgt-header-text">&#9654; Target Locked</span>
//         </div>
//         <div class="tgt-body">
//           <div class="tgt-name" id="tgt-name">---</div>
//           <div class="tgt-type" id="tgt-type">---</div>
//           <div class="tgt-dist-row">
//             <span class="tgt-dist-label">Dist</span>
//             <span class="tgt-dist-val" id="tgt-dist">---</span>
//           </div>
//         </div>
//       </div>
// 
//       <!-- Screen-space reticle — positioned via JS each frame -->
//       <div class="tgt-reticle" id="tgt-reticle" style="display:none">
//         <div class="tgt-corner tl"></div>
//         <div class="tgt-corner tr"></div>
//         <div class="tgt-corner bl"></div>
//         <div class="tgt-corner br"></div>
//       </div>
// 
//       <div class="hud-glow-wrap">
//         <div class="hud-panel">
// 
//           <div class="hud-corner tl"></div>
//           <div class="hud-corner tr"></div>
//           <div class="hud-corner bl"></div>
//           <div class="hud-corner br"></div>
// 
//           <div class="hud-title">
//             <span class="hud-title-text">&#9672; Ship Systems &#9672;</span>
//             <span class="hud-online"><span class="hud-dot"></span>Online</span>
//           </div>
// 
//           <div class="hud-bars">
//             <div class="bar-row bar-shield">
//               <span class="bar-label">Shield</span>
//               <div class="bar-track"><div class="bar-fill" style="width:100%"></div></div>
//               <span class="bar-pct">100%</span>
//             </div>
//             <div class="bar-row bar-armor">
//               <span class="bar-label">Armor</span>
//               <div class="bar-track"><div class="bar-fill" style="width:100%"></div></div>
//               <span class="bar-pct">100%</span>
//             </div>
//             <div class="bar-row bar-hull">
//               <span class="bar-label">Hull</span>
//               <div class="bar-track"><div class="bar-fill" style="width:100%"></div></div>
//               <span class="bar-pct">100%</span>
//             </div>
//           </div>
// 
//           <div class="hud-sep"></div>
// 
//           <div class="hud-speed-row">
//             <span class="hud-speed-label">Speed</span>
//             <div class="hud-speed-track">
//               <div class="hud-speed-fill" id="spd-fill" style="width:0%"></div>
//             </div>
//             <span class="hud-speed-num" id="spd-num">0 <small>m/s</small></span>
//           </div>
// 
//           <div class="hud-sep"></div>
// 
//           <div class="hud-buttons">
//             <button id="btn-thrusters">&#9889; Thrusters</button>
//             <button id="btn-stop">&#9632; Stop Ship</button>
//           </div>
// 
//         </div>
//       </div>
//     `;
//     document.body.appendChild(this._el);
// 
//     // Damage vignette — full viewport red flash on hit
//     const vignette = document.createElement("div");
//     vignette.id = "damage-vignette";
//     document.body.appendChild(vignette);
//     this._damageVignette = vignette;
// 
//     // Warp flash overlay — appended separately so it sits above everything
//     const flash = document.createElement("div");
//     flash.id = "warp-flash";
//     flash.innerHTML = `
//       <span class="warp-flash-label">&#9889; Warp Drive Engaged</span>
//       <span class="warp-flash-dest" id="warp-dest-name"></span>
//     `;
//     document.body.appendChild(flash);
//     this._warpFlash = flash;
//     this._warpDestName = flash.querySelector("#warp-dest-name");
// 
//     this._thrusterBtn = this._el.querySelector("#btn-thrusters");
//     this._stopBtn = this._el.querySelector("#btn-stop");
//     this._fireBtn = this._el.querySelector("#btn-fire");
//     this._mineBtnRow = this._el.querySelector("#mine-btn-row");
//     this._mineBtn = this._el.querySelector("#btn-mine");
//     this._warpBtnRow = this._el.querySelector("#warp-btn-row");
//     this._warpBtn = this._el.querySelector("#btn-warp");
//     this._speedFill = this._el.querySelector("#spd-fill");
//     this._speedNum = this._el.querySelector("#spd-num");
//     this._speedTrack = this._el.querySelector(".hud-speed-track");
//     this._tgtPanel = this._el.querySelector("#tgt-panel");
//     this._tgtName = this._el.querySelector("#tgt-name");
//     this._tgtType = this._el.querySelector("#tgt-type");
//     this._tgtDist = this._el.querySelector("#tgt-dist");
//     this._tgtReticle = this._el.querySelector("#tgt-reticle");
//     this._enemyBars = this._el.querySelector("#tgt-enemy-bars");
//     this._tgtBarShield = this._el.querySelector("#tgt-bar-s");
//     this._tgtBarArmor = this._el.querySelector("#tgt-bar-a");
//     this._tgtBarHull = this._el.querySelector("#tgt-bar-h");
//     this._plrBarShield = this._el.querySelector(".hud-bars .bar-shield");
//     this._plrBarArmor = this._el.querySelector(".hud-bars .bar-armor");
//     this._plrBarHull = this._el.querySelector(".hud-bars .bar-hull");
//     this._hudGlowWrap = this._el.querySelector(".hud-glow-wrap");
//     this._fireCooldownNum = this._el.querySelector("#fire-cooldown-num");
//   }
// 
//   // ── Button events ─────────────────────────────────────────────────────────
// 
//   _bindButtons() {
//     this._onFire = null; // set by main.js via setFireCallback()
//     this._onMine = null; // set by main.js via setMineCallback()
//     this._onWarp = null; // set by main.js via setWarpCallback()
//     this._ctxMenu = null; // currently open context menu DOM node
// 
//     this._thrusterBtn.addEventListener("mousedown", (e) => {
//       e.stopPropagation(); // block orbit-camera drag
//       this._ship.setEngine(!this._ship.engineOn);
//       this._syncThrusterButton();
//     });
// 
//     this._stopBtn.addEventListener("mousedown", (e) => {
//       e.stopPropagation();
//       this._ship.stopShip();
//       this._syncThrusterButton();
//     });
// 
//     // ── Speed bar drag ────────────────────────────────────────────────────
//     // Click or drag on the track to set target speed (0 – 1000 m/s).
//     // Drag is handled via document listeners so the cursor can leave the
//     // track without dropping the interaction.
//     let dragging = false;
// 
//     const applySpeed = (e) => {
//       const rect = this._speedTrack.getBoundingClientRect();
//       const frac = Math.max(
//         0,
//         Math.min(1, (e.clientX - rect.left) / rect.width),
//       );
//       this._ship.setTargetSpeed(Math.round(frac * 1000));
//       // Auto-enable engine when user explicitly sets a speed
//       if (!this._ship.engineOn) {
//         this._ship.setEngine(true);
//         this._syncThrusterButton();
//       }
//     };
// 
//     this._speedTrack.addEventListener("mousedown", (e) => {
//       e.stopPropagation();
//       dragging = true;
//       applySpeed(e);
//     });
// 
//     document.addEventListener("mousemove", (e) => {
//       if (dragging) applySpeed(e);
//     });
// 
//     document.addEventListener("mouseup", () => {
//       dragging = false;
//     });
// 
//     this._fireBtn.addEventListener("mousedown", (e) => {
//       e.stopPropagation();
//       if (this._onFire) this._onFire();
//     });
// 
//     this._mineBtn.addEventListener("mousedown", (e) => {
//       e.stopPropagation();
//       if (this._onMine) this._onMine();
//     });
// 
//     this._warpBtn.addEventListener("mousedown", (e) => {
//       e.stopPropagation();
//       if (this._onWarp) this._onWarp();
//     });
//   }
// 
//   // ── Targeting API (called by main.js) ────────────────────────────────────
// 
//   // Show the target panel with the locked object's name and type.
//   setTarget(label, type) {
//     this._tgtName.textContent = label;
//     this._tgtType.textContent = type;
//     this._tgtDist.textContent = "---";
//     this._enemyBars.style.display = isEnemy ? "" : "none";
//     // Reset entry animation by forcing reflow
//     this._tgtPanel.style.animation = "none";
//     this._tgtPanel.offsetWidth; // reflow
//     this._tgtPanel.style.animation = "";
//     this._tgtPanel.style.display = "";
//     this._tgtReticle.style.display = "";
//   }
// 
//   // Hide target panel and reticle.
//   clearTarget() {
//     this._tgtPanel.style.display = "none";
//     this._tgtReticle.style.display = "none";
//     this._enemyBars.style.display = "none";
//   }
// 
//   // Called every frame while a target is locked.
//   // distUnits — raw world-unit distance from ship to target.
//   // screenX/Y — projected 2D position on the viewport.
//   // onScreen  — false when target is behind the camera.
//   updateTarget(distUnits, screenX, screenY, onScreen) {
//     // Format distance: <1 000 → km  |  <1 000 000 → Mm  |  else → Gm
//     let distStr;
//     if (distUnits < 1000) distStr = `${Math.round(distUnits)} km`;
//     else if (distUnits < 1e6) distStr = `${(distUnits / 1000).toFixed(1)} Mm`;
//     else distStr = `${(distUnits / 1e6).toFixed(2)} Gm`;
//     this._tgtDist.textContent = distStr;
// 
//     // Move reticle to the target's screen position when it's in front of the camera
//     if (onScreen) {
//       this._tgtReticle.style.display = "";
//       this._tgtReticle.style.left = `${screenX}px`;
//       this._tgtReticle.style.top = `${screenY}px`;
//     } else {
//       this._tgtReticle.style.display = "none";
//     }
//   }
// 
//   // Called every frame from main.js to refresh the speed readout.
//   update() {
//     const s = this._ship.speed;
//     const pct = Math.min(s / 1000, 1) * 100;
//     const isBoosting = s > 405; // threshold avoids flicker right at cruise max
// 
//     this._speedFill.style.width = pct.toFixed(1) + "%";
//     this._speedFill.classList.toggle("boost", isBoosting);
//     this._speedNum.innerHTML = Math.round(s) + " <small>m/s</small>";
//     this._speedNum.classList.toggle("boost", isBoosting);
//   }
// 
//   // ── Combat API ────────────────────────────────────────────────────────────
// 
//   // Register the callback invoked when the FIRE button is pressed.
//   setFireCallback(fn) {
//     this._onFire = fn;
//   }
// 
//   // Grey out the FIRE button for `ms` milliseconds and show a countdown.
//   triggerFireCooldown(ms = 600) {
//     this._fireBtn.classList.add("cooldown");
//     const num = this._fireCooldownNum;
//     const end = performance.now() + ms;
//     num.style.display = "";
//     const tick = () => {
//       const remaining = end - performance.now();
//       if (remaining <= 0) {
//         this._fireBtn.classList.remove("cooldown");
//         num.style.display = "none";
//         return;
//       }
//       num.textContent = " " + (remaining / 1000).toFixed(1) + "s";
//       requestAnimationFrame(tick);
//     };
//     requestAnimationFrame(tick);
//   }
// 
//   // Update the enemy health bars in the target panel (called every frame).
//   updateTargetHealth(shield, armor, hull) {
//     _setBar(this._tgtBarShield, shield);
//     _setBar(this._tgtBarArmor, armor);
//     _setBar(this._tgtBarHull, hull);
//   }
// 
//   // Update the player's own health bars.
//   setPlayerHealth(shield, armor, hull) {
//     _setBar(this._plrBarShield, shield);
//     _setBar(this._plrBarArmor, armor);
//     _setBar(this._plrBarHull, hull);
//   }
// 
//   // Flash the red damage vignette on hit.
//   flashDamage() {
//     const v = this._damageVignette;
//     v.classList.remove("flashing");
//     void v.offsetWidth; // force reflow so animation restarts
//     v.classList.add("flashing");
//   }
// 
//   // Toggle pulsing red warning when hull is critical.
//   setHullWarning(critical) {
//     this._hudGlowWrap.classList.toggle("hull-critical", critical);
//   }
// 
//   // ── Mining API ────────────────────────────────────────────────────────────
// 
//   setMineCallback(fn) {
//     this._onMine = fn;
//   }
// 
//   // Show or hide the Mine Asteroid button.
//   // alreadyMined: true = show in "depleted" state (greyed, no pointer events).
//   showMineButton(show, alreadyMined = false) {
//     this._mineBtnRow.style.display = show ? "" : "none";
//     if (show) {
//       this._mineBtn.classList.toggle("depleted", alreadyMined);
//       if (alreadyMined) {
//         this._mineBtn.innerHTML = "&#9671; Depleted";
//         this._mineBtn.style.pointerEvents = "none";
//       } else {
//         this._mineBtn.style.pointerEvents = "";
//       }
//     }
//   }
// 
//   // Update the mine button to reflect progress (0–1), or null to reset.
//   setMiningProgress(pct) {
//     if (pct === null) {
//       this._mineBtn.innerHTML = "&#9671; Mine Asteroid";
//       this._mineBtn.classList.remove("mining", "done");
//     } else if (pct >= 1) {
//       this._mineBtn.innerHTML = "&#10003; Resource Acquired";
//       this._mineBtn.classList.remove("mining");
//       this._mineBtn.classList.add("done");
//     } else {
//       this._mineBtn.innerHTML = `&#9671; Mining... ${Math.round(pct * 100)}%`;
//       this._mineBtn.classList.add("mining");
//       this._mineBtn.classList.remove("done");
//     }
//   }
// 
//   // ── Warp API ──────────────────────────────────────────────────────────────
// 
//   setWarpCallback(fn) {
//     this._onWarp = fn;
//   }
// 
//   // Show or hide the Warp button; label is the target's name.
//   showWarpButton(show, label = "Target") {
//     this._warpBtnRow.style.display = show ? "" : "none";
//     if (show) this._warpBtn.innerHTML = `&#9889; Warp To ${label}`;
//   }
// 
//   // Full-screen hyperspace flash; calls onPeak() when screen is fully white
//   // so the caller can teleport the ship while nothing is visible.
//   triggerWarpFlash(destLabel, onPeak) {
//     const el = this._warpFlash;
//     this._warpDestName.textContent = destLabel;
//     el.classList.remove("fade-out", "active");
// 
//     // Force reflow so the transition fires cleanly
//     el.offsetWidth; // eslint-disable-line no-unused-expressions
// 
//     el.style.opacity = "1";
//     el.classList.add("active");
// 
//     setTimeout(() => {
//       onPeak();
//       el.classList.add("fade-out");
//       el.classList.remove("active");
//       el.style.opacity = "0";
//       setTimeout(() => el.classList.remove("fade-out"), 800);
//     }, 240);
//   }
// 
//   // ── Context menu API ──────────────────────────────────────────────────────
// 
//   // Show a sci-fi context menu at (x, y) with the given items.
//   // items: [{ category, label, subtype, dist, onSelect }]
//   showContextMenu(items, x, y) {
//     this.hideContextMenu();
// 
//     const menu = document.createElement("div");
//     menu.id = "ctx-menu";
// 
//     // Group by category, preserving insertion order
//     const cats = {};
//     for (const item of items) {
//       if (!cats[item.category]) cats[item.category] = [];
//       cats[item.category].push(item);
//     }
// 
//     let html = `<div class="ctx-header">&#9670; Spatial Objects</div>`;
//     for (const [cat, list] of Object.entries(cats)) {
//       html += `<div class="ctx-section">${cat}</div>`;
//       for (let i = 0; i < list.length; i++) {
//         const it = list[i];
//         const d = it.dist;
//         const ds =
//           d < 1000
//             ? `${Math.round(d)} km`
//             : d < 1e6
//               ? `${(d / 1000).toFixed(1)} Mm`
//               : `${(d / 1e6).toFixed(2)} Gm`;
//         html += `
//           <div class="ctx-item" data-cat="${cat}" data-idx="${i}">
//             <span class="ctx-item-label">${it.label}</span>
//             <span class="ctx-item-sub">${it.subtype}</span>
//             <span class="ctx-item-dist">${ds}</span>
//           </div>`;
//       }
//     }
// 
//     menu.innerHTML = html;
// 
//     // Position, clamped so the menu doesn't overflow the right/bottom edge
//     const W = window.innerWidth,
//       H = window.innerHeight;
//     menu.style.left = `${Math.min(x, W - 260)}px`;
//     menu.style.top = `${Math.min(y, H - 40)}px`; // rough estimate; adjusts after render
// 
//     // Wire item clicks
//     menu.querySelectorAll(".ctx-item").forEach((el) => {
//       const cat = el.dataset.cat;
//       const idx = parseInt(el.dataset.idx);
//       el.addEventListener("mousedown", (e) => {
//         e.stopPropagation();
//         cats[cat][idx].onSelect();
//         this.hideContextMenu();
//       });
//     });
// 
//     document.body.appendChild(menu);
//     this._ctxMenu = menu;
// 
//     // Re-clamp vertically now that we know the actual height
//     requestAnimationFrame(() => {
//       if (!this._ctxMenu) return;
//       const rect = menu.getBoundingClientRect();
//       if (rect.bottom > H - 8) {
//         menu.style.top = `${Math.max(8, H - rect.height - 8)}px`;
//       }
//     });
//   }
// 
//   hideContextMenu() {
//     if (this._ctxMenu) {
//       this._ctxMenu.remove();
//       this._ctxMenu = null;
//     }
//   }
// 
//   // Keep THRUSTERS button label/style in sync with ship.engineOn.
//   _syncThrusterButton() {
//     if (this._ship.engineOn) {
//       this._thrusterBtn.innerHTML = "&#9889; Thrusters";
//       this._thrusterBtn.classList.remove("off");
//     } else {
//       this._thrusterBtn.innerHTML = "&#9889; Thrusters: Off";
//       this._thrusterBtn.classList.add("off");
//     }
//   }
// 
//   // ── Cleanup ───────────────────────────────────────────────────────────────
// 
//   dispose() {
//     this._el.remove();
//   }
// }
