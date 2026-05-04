import * as THREE from 'three';

// Corner radar HUD. Top-down XY projection of the 4000u world, heading-up
// (ship's forward always points to canvas top). Reuses existing HUD styling
// — same border/clip-path/scan-line/glow as .hud-panel.

const DEFAULT_RADIUS = 2500;   // world units shown out to the radar edge
const PANEL_SIZE     = 200;    // px (pre-scale) — square panel, matches HUD vibe
const CANVAS_SIZE    = 180;    // px (pre-scale) — radar drawing area inside

const COLOR_PLAYER  = '#00e5ff';
const COLOR_NPC     = '#ff8c00';
const COLOR_NPC_DIM = 'rgba(120, 60, 30, 0.55)';   // dead NPCs
const COLOR_ASTEROID = 'rgba(170, 160, 145, 0.55)';
const COLOR_PLANET  = '#00cfff';
const COLOR_STATION = '#7fdcff';
const COLOR_LOOT    = '#69f0ae';
const COLOR_TARGET  = '#ff8c00';
const COLOR_GRID    = 'rgba(0, 180, 255, 0.18)';
const COLOR_RING    = 'rgba(0, 200, 255, 0.28)';

const Z_BAND = 300;   // |Δz| above this dims the blip (entity is far above/below)

const _fwd     = new THREE.Vector3();
const _up      = new THREE.Vector3(1, 0, 0);
const _wpTemp  = new THREE.Vector3();   // reused for getWorldPosition
const _tgtTemp = new THREE.Vector3();   // reused for currentTarget projection

export class Minimap {
  constructor() {
    this._radius = DEFAULT_RADIUS;
    this._t      = 0;
    this._injectStyle();
    this._injectDOM();
  }

  setRadius(r) { this._radius = r; }

  update({ ship, fleet, world, loot, station, currentTarget, delta = 0.016 }) {
    this._t += delta;

    const ctx  = this._ctx;
    const size = CANVAS_SIZE;
    const cx   = size / 2;
    const cy   = size / 2;
    const half = size / 2 - 4;        // leave a px or two for blip radius
    const radius = this._radius;
    const scale  = half / radius;

    // ── Ship heading: forward vector in world XY → canvas-up rotation ────────
    _fwd.copy(_up).applyQuaternion(ship.group.quaternion);
    const h    = Math.atan2(_fwd.y, _fwd.x);
    // Rotate world XY by (-h + π/2) so ship-forward maps to +Y, then flip Y
    // for screen coords. Precompute cos/sin of (π/2 - h).
    const ang  = Math.PI / 2 - h;
    const cosA = Math.cos(ang);
    const sinA = Math.sin(ang);
    const sx   = ship.position.x;
    const sy   = ship.position.y;
    const sz   = ship.position.z;
    const r2   = radius * radius;

    // ── Background ──────────────────────────────────────────────────────────
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(0, 14, 30, 0.55)';
    ctx.beginPath();
    ctx.arc(cx, cy, half + 2, 0, Math.PI * 2);
    ctx.fill();

    // Range rings
    ctx.strokeStyle = COLOR_RING;
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.arc(cx, cy, half,        0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, half * 0.66, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, half * 0.33, 0, Math.PI * 2); ctx.stroke();

    // Crosshairs
    ctx.strokeStyle = COLOR_GRID;
    ctx.beginPath();
    ctx.moveTo(cx, 4);    ctx.lineTo(cx, size - 4);
    ctx.moveTo(4, cy);    ctx.lineTo(size - 4, cy);
    ctx.stroke();

    // ── Helpers (closures over ship pos + heading) ──────────────────────────
    const project = (wx, wy) => {
      const dx = wx - sx;
      const dy = wy - sy;
      // rotate (dx,dy) by ang
      const rx =  dx * cosA - dy * sinA;
      const ry =  dx * sinA + dy * cosA;
      // flip Y so +forward points up on screen
      return { x: cx + rx * scale, y: cy - ry * scale, distSq: dx*dx + dy*dy };
    };

    const drawBlip = (wx, wy, wz, color, size = 2.5, shape = 'dot') => {
      const dx = wx - sx;
      const dy = wy - sy;
      const dSq = dx*dx + dy*dy;
      const dz  = wz - sz;
      let bx, by, clamped = false;

      if (dSq > r2) {
        // Clamp to ring edge in the rotated frame
        const rx =  dx * cosA - dy * sinA;
        const ry =  dx * sinA + dy * cosA;
        const len = Math.sqrt(rx*rx + ry*ry);
        const k   = half / len;
        bx = cx + rx * k;
        by = cy - ry * k;
        clamped = true;
      } else {
        const rx =  dx * cosA - dy * sinA;
        const ry =  dx * sinA + dy * cosA;
        bx = cx + rx * scale;
        by = cy - ry * scale;
      }

      // Z dimming: alpha falls with |dz| beyond Z_BAND
      const zFade = Math.max(0.45, 1 - Math.max(0, Math.abs(dz) - Z_BAND) / 1500);

      ctx.globalAlpha = clamped ? 0.6 * zFade : zFade;
      ctx.fillStyle   = color;

      if (clamped) {
        // Small triangular pip pointing outward
        const ang2 = Math.atan2(by - cy, bx - cx);
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(ang2);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-5, -3);
        ctx.lineTo(-5,  3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (shape === 'square') {
        ctx.fillRect(bx - size, by - size, size * 2, size * 2);
      } else if (shape === 'ring') {
        ctx.beginPath();
        ctx.arc(bx, by, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(bx, by, size + 2, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(bx, by, size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      return { bx, by, clamped };
    };

    // ── Asteroids ───────────────────────────────────────────────────────────
    if (world?.asteroids) {
      for (const ast of world.asteroids) {
        const p = ast.position;
        const dx = p.x - sx, dy = p.y - sy;
        if (dx*dx + dy*dy > r2) continue;   // cull off-radar (no clamp for clutter)
        drawBlip(p.x, p.y, p.z, COLOR_ASTEROID, 1.4, 'dot');
      }
    }

    // ── Planets & field markers (from namedTargetables) ─────────────────────
    if (world?.namedTargetables) {
      for (const mesh of world.namedTargetables) {
        const ud = mesh.userData || {};
        if (ud.isStation) continue;          // station drawn separately
        const wp = mesh.getWorldPosition
          ? mesh.getWorldPosition(_wpTemp)
          : mesh.position;
        const isPlanet = /Planet|World|Giant|Class/i.test(ud.type || '');
        if (isPlanet) {
          drawBlip(wp.x, wp.y, wp.z, COLOR_PLANET, 4.5, 'dot');
        } else {
          // Field marker — tiny hollow ring
          drawBlip(wp.x, wp.y, wp.z, 'rgba(60, 130, 180, 0.55)', 2.5, 'square');
        }
      }
    }

    // ── Station ─────────────────────────────────────────────────────────────
    if (station) {
      const sp = station.group ? station.group.position : station.position;
      const pulse = 0.7 + 0.3 * Math.sin(this._t * 4);
      ctx.globalAlpha = pulse;
      drawBlip(sp.x, sp.y, sp.z, COLOR_STATION, 4, 'square');
      ctx.globalAlpha = 1;
    }

    // ── Loot ────────────────────────────────────────────────────────────────
    if (loot?._items) {
      for (const item of loot._items) {
        if (!item.active) continue;
        const p = item.group.position;
        drawBlip(p.x, p.y, p.z, COLOR_LOOT, 2.5, 'dot');
      }
    }

    // ── NPCs ────────────────────────────────────────────────────────────────
    if (fleet?.ships) {
      for (const npc of fleet.ships) {
        const dead = npc._state === 'dead';
        const p = npc.group.position;
        drawBlip(p.x, p.y, p.z, dead ? COLOR_NPC_DIM : COLOR_NPC, dead ? 2 : 3, 'dot');
      }
    }

    // ── Target highlight ring ───────────────────────────────────────────────
    if (currentTarget) {
      const tp = currentTarget.getWorldPosition(_tgtTemp);
      const proj = project(tp.x, tp.y);
      // Place the ring at the clamped edge if outside radius
      let rx = proj.x, ry = proj.y;
      if (proj.distSq > r2) {
        const dx = tp.x - sx, dy = tp.y - sy;
        const rxR =  dx * cosA - dy * sinA;
        const ryR =  dx * sinA + dy * cosA;
        const len = Math.sqrt(rxR*rxR + ryR*ryR);
        const k   = half / len;
        rx = cx + rxR * k;
        ry = cy - ryR * k;
      }
      ctx.strokeStyle = COLOR_TARGET;
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.arc(rx, ry, 7, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ── Player (always center, pointing up) ─────────────────────────────────
    ctx.fillStyle = COLOR_PLAYER;
    ctx.beginPath();
    ctx.moveTo(cx,     cy - 6);
    ctx.lineTo(cx - 4, cy + 4);
    ctx.lineTo(cx + 4, cy + 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  dispose() {
    if (this._el?.parentNode) this._el.parentNode.removeChild(this._el);
    if (this._style?.parentNode) this._style.parentNode.removeChild(this._style);
  }

  _injectStyle() {
    const style = document.createElement('style');
    style.textContent = `
.mm-wrap {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: ${PANEL_SIZE}px;
  height: ${PANEL_SIZE}px;
  pointer-events: none;
  font-family: 'Courier New', monospace;
  z-index: 10;
  transform: scale(var(--hud-scale, 0.85));
  transform-origin: bottom right;
  filter:
    drop-shadow(0 0 6px  rgba(0, 180, 255, 0.55))
    drop-shadow(0 0 22px rgba(0,  90, 220, 0.30));
}
.mm-panel {
  position: relative;
  width: 100%;
  height: 100%;
  background: rgba(0, 7, 22, 0.92);
  border: 1px solid rgba(0, 180, 255, 0.35);
  overflow: hidden;
  clip-path: polygon(
    16px 0%,   calc(100% - 16px) 0%,
    100% 16px, 100% calc(100% - 16px),
    calc(100% - 16px) 100%, 16px 100%,
    0% calc(100% - 16px), 0% 16px
  );
  animation: mm-border-pulse 3.5s ease-in-out infinite;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 0 4px;
}
@keyframes mm-border-pulse {
  0%, 100% { border-color: rgba(0, 180, 255, 0.30); }
  50%      { border-color: rgba(0, 230, 255, 0.65); }
}
.mm-panel::after {
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
  animation: mm-scan 5s linear infinite;
  pointer-events: none;
}
@keyframes mm-scan {
  0%   { top: -35%; }
  100% { top: 135%; }
}
.mm-title {
  font-size: 9px;
  letter-spacing: 0.28em;
  color: rgba(0, 220, 255, 0.85);
  text-shadow: 0 0 6px rgba(0, 200, 255, 0.55);
  text-transform: uppercase;
  margin-bottom: 2px;
}
.mm-canvas {
  width: ${CANVAS_SIZE}px;
  height: ${CANVAS_SIZE}px;
  display: block;
}
.mm-corner {
  position: absolute;
  width: 11px;
  height: 11px;
  pointer-events: none;
}
.mm-corner::before,
.mm-corner::after {
  content: '';
  position: absolute;
  background: rgba(0, 220, 255, 0.85);
  box-shadow: 0 0 5px rgba(0, 220, 255, 0.7);
}
.mm-corner::before { width: 100%; height: 1.5px; top: 0; left: 0; }
.mm-corner::after  { width: 1.5px; height: 100%; top: 0; left: 0; }
.mm-corner.tl { top: 0;    left: 0; }
.mm-corner.tr { top: 0;    right: 0;  transform: scaleX(-1); }
.mm-corner.bl { bottom: 0; left: 0;   transform: scaleY(-1); }
.mm-corner.br { bottom: 0; right: 0;  transform: scale(-1,-1); }
`;
    document.head.appendChild(style);
    this._style = style;
  }

  _injectDOM() {
    this._el = document.createElement('div');
    this._el.className = 'mm-wrap';
    this._el.innerHTML = `
      <div class="mm-panel">
        <div class="mm-corner tl"></div>
        <div class="mm-corner tr"></div>
        <div class="mm-corner bl"></div>
        <div class="mm-corner br"></div>
        <div class="mm-title">&#9672; Radar &#9672;</div>
        <canvas class="mm-canvas" width="${CANVAS_SIZE * 2}" height="${CANVAS_SIZE * 2}"
                style="width:${CANVAS_SIZE}px;height:${CANVAS_SIZE}px"></canvas>
      </div>
    `;
    document.body.appendChild(this._el);
    this._canvas = this._el.querySelector('.mm-canvas');
    // Crisp 2x rendering: backing store is 2x CSS size, scale context to match
    this._ctx = this._canvas.getContext('2d');
    this._ctx.scale(2, 2);
  }
}
