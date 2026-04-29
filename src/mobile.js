const STICK_MAX_R = 44;
const THRESHOLD   = 18;

export class MobileControls {
  constructor(inp, onCameraMove, onZoom) {
    if (!('ontouchstart' in window) && navigator.maxTouchPoints === 0) return;

    this._inp           = inp;
    this._onCameraMove  = onCameraMove;
    this._onZoom        = onZoom;

    this._stickTouchId  = null;
    this._stickOriginX  = 0;
    this._stickOriginY  = 0;

    this._camTouchId    = null;
    this._camLastX      = 0;
    this._camLastY      = 0;

    this._pinchActive   = false;
    this._pinchLastDist = 0;

    this._buildDOM();
    this._bindEvents();
  }

  // ── DOM ────────────────────────────────────────────────────────────────────

  _buildDOM() {
    const style = document.createElement('style');
    style.textContent = `
      #mobile-overlay {
        position: fixed; inset: 0;
        pointer-events: none;
        touch-action: none;
        user-select: none;
        z-index: 5;
      }
      #mob-left, #mob-right {
        position: absolute; bottom: 0; height: 55%;
        pointer-events: auto;
      }
      #mob-left  { left: 0;  width: 40%; }
      #mob-right { right: 0; width: 60%; }

      #mob-stick-ring {
        position: absolute;
        bottom: 120px; left: 50%;
        transform: translateX(-50%);
        width: 110px; height: 110px;
        border-radius: 50%;
        border: 2px solid rgba(0,180,255,0.45);
        background: rgba(0,7,22,0.35);
        box-shadow: 0 0 14px rgba(0,140,255,0.25);
      }
      #mob-stick-thumb {
        position: absolute;
        width: 44px; height: 44px;
        border-radius: 50%;
        background: rgba(0,180,255,0.65);
        box-shadow: 0 0 10px rgba(0,180,255,0.5);
        top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        pointer-events: none;
        transition: background 0.1s;
      }
      .mob-btn {
        position: absolute;
        width: 56px; height: 56px;
        border-radius: 50%;
        background: rgba(0,7,22,0.75);
        border: 1.5px solid rgba(0,180,255,0.45);
        color: rgba(0,210,255,0.85);
        font-family: 'Courier New', monospace;
        font-size: 10px; letter-spacing: 0.1em;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 0 8px rgba(0,140,255,0.25);
        -webkit-tap-highlight-color: transparent;
        touch-action: none;
      }
      .mob-btn--active {
        background: rgba(0,120,200,0.55);
        box-shadow: 0 0 18px rgba(0,180,255,0.5);
      }
      #mob-btn-roll-q { bottom: 22px; left: 12px; }
      #mob-btn-roll-e { bottom: 22px; right: 12px; }
      #mob-btn-boost {
        bottom: 22px; right: 18px;
        width: 68px; height: 68px;
        font-size: 11px;
        border-color: rgba(255,165,0,0.55);
        color: rgba(255,200,60,0.9);
        box-shadow: 0 0 12px rgba(255,120,0,0.3);
      }
      #mob-btn-boost.mob-btn--active {
        background: rgba(180,80,0,0.55);
        box-shadow: 0 0 20px rgba(255,160,0,0.5);
      }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'mobile-overlay';

    // ── Left zone ──────────────────────────────────────────────────────────
    const left = document.createElement('div');
    left.id = 'mob-left';

    const ring = document.createElement('div');
    ring.id = 'mob-stick-ring';
    const thumb = document.createElement('div');
    thumb.id = 'mob-stick-thumb';
    ring.appendChild(thumb);

    const rollQ = document.createElement('div');
    rollQ.id = 'mob-btn-roll-q';
    rollQ.className = 'mob-btn';
    rollQ.textContent = 'Q';

    const rollE = document.createElement('div');
    rollE.id = 'mob-btn-roll-e';
    rollE.className = 'mob-btn';
    rollE.textContent = 'E';

    left.appendChild(ring);
    left.appendChild(rollQ);
    left.appendChild(rollE);

    // ── Right zone ─────────────────────────────────────────────────────────
    const right = document.createElement('div');
    right.id = 'mob-right';

    const boost = document.createElement('div');
    boost.id = 'mob-btn-boost';
    boost.className = 'mob-btn';
    boost.textContent = 'BOOST';

    right.appendChild(boost);

    overlay.appendChild(left);
    overlay.appendChild(right);
    document.body.appendChild(overlay);

    this._stickRing  = ring;
    this._stickThumb = thumb;
    this._leftZone   = left;
    this._rightZone  = right;
    this._rollQ      = rollQ;
    this._rollE      = rollE;
    this._boost      = boost;
  }

  // ── Event Binding ──────────────────────────────────────────────────────────

  _bindEvents() {
    const opts = { passive: false };

    // Left zone — thumbstick
    this._leftZone.addEventListener('touchstart',  e => this._onLeftStart(e),  opts);
    this._leftZone.addEventListener('touchmove',   e => this._onLeftMove(e),   opts);
    this._leftZone.addEventListener('touchend',    e => this._onLeftEnd(e),    opts);
    this._leftZone.addEventListener('touchcancel', e => this._onLeftEnd(e),    opts);

    // Right zone — camera + pinch
    this._rightZone.addEventListener('touchstart',  e => this._onRightStart(e), opts);
    this._rightZone.addEventListener('touchmove',   e => this._onRightMove(e),  opts);
    this._rightZone.addEventListener('touchend',    e => this._onRightEnd(e),   opts);
    this._rightZone.addEventListener('touchcancel', e => this._onRightEnd(e),   opts);

    // Roll buttons
    this._bindBtn(this._rollQ, 'KeyQ');
    this._bindBtn(this._rollE, 'KeyE');

    // Boost button
    this._bindBtn(this._boost, 'ShiftLeft');
  }

  _bindBtn(el, code) {
    el.addEventListener('touchstart', e => {
      e.stopPropagation(); e.preventDefault();
      this._inp.keys[code] = true;
      el.classList.add('mob-btn--active');
    }, { passive: false });
    const release = () => {
      this._inp.keys[code] = false;
      el.classList.remove('mob-btn--active');
    };
    el.addEventListener('touchend',    release);
    el.addEventListener('touchcancel', release);
  }

  // ── Left Zone (Thumbstick) ─────────────────────────────────────────────────

  _onLeftStart(e) {
    e.preventDefault();
    if (this._stickTouchId !== null) return;
    // Ignore touches that started on a button
    if (e.target === this._rollQ || e.target === this._rollE) return;

    const t = e.changedTouches[0];
    this._stickTouchId = t.identifier;

    const rect = this._stickRing.getBoundingClientRect();
    this._stickOriginX = rect.left + rect.width  / 2;
    this._stickOriginY = rect.top  + rect.height / 2;

    const dx = t.clientX - this._stickOriginX;
    const dy = t.clientY - this._stickOriginY;
    this._moveThumb(dx, dy);
    this._updateStickKeys(dx, dy);
  }

  _onLeftMove(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== this._stickTouchId) continue;
      const dx = t.clientX - this._stickOriginX;
      const dy = t.clientY - this._stickOriginY;
      this._moveThumb(dx, dy);
      this._updateStickKeys(dx, dy);
    }
  }

  _onLeftEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier !== this._stickTouchId) continue;
      this._stickTouchId = null;
      this._clearStickKeys();
      this._stickThumb.style.transform = 'translate(-50%, -50%)';
    }
  }

  _moveThumb(dx, dy) {
    const len = Math.hypot(dx, dy);
    if (len > STICK_MAX_R) {
      dx = (dx / len) * STICK_MAX_R;
      dy = (dy / len) * STICK_MAX_R;
    }
    this._stickThumb.style.transform =
      `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  _updateStickKeys(dx, dy) {
    const k = this._inp.keys;
    k['KeyW'] = k['KeyS'] = k['KeyA'] = k['KeyD'] = false;
    if (dy < -THRESHOLD) k['KeyW'] = true;
    if (dy >  THRESHOLD) k['KeyS'] = true;
    if (dx < -THRESHOLD) k['KeyA'] = true;
    if (dx >  THRESHOLD) k['KeyD'] = true;
  }

  _clearStickKeys() {
    const k = this._inp.keys;
    k['KeyW'] = k['KeyS'] = k['KeyA'] = k['KeyD'] = false;
  }

  // ── Right Zone (Camera drag + Pinch) ──────────────────────────────────────

  _onRightStart(e) {
    e.preventDefault();
    if (e.targetTouches.length >= 2) {
      // Switch to pinch mode
      this._camTouchId  = null;
      this._pinchActive = true;
      const t0 = e.targetTouches[0], t1 = e.targetTouches[1];
      this._pinchLastDist = Math.hypot(
        t1.clientX - t0.clientX,
        t1.clientY - t0.clientY,
      );
      return;
    }
    if (this._camTouchId !== null) return;
    // Single touch — camera drag (ignore boost button)
    if (e.target === this._boost) return;
    const t = e.changedTouches[0];
    this._camTouchId = t.identifier;
    this._camLastX   = t.clientX;
    this._camLastY   = t.clientY;
  }

  _onRightMove(e) {
    e.preventDefault();
    if (this._pinchActive) {
      if (e.targetTouches.length < 2) return;
      const t0 = e.targetTouches[0], t1 = e.targetTouches[1];
      const dist = Math.hypot(
        t1.clientX - t0.clientX,
        t1.clientY - t0.clientY,
      );
      this._onZoom(dist - this._pinchLastDist);
      this._pinchLastDist = dist;
      return;
    }
    for (const t of e.changedTouches) {
      if (t.identifier !== this._camTouchId) continue;
      const dx = t.clientX - this._camLastX;
      const dy = t.clientY - this._camLastY;
      this._camLastX = t.clientX;
      this._camLastY = t.clientY;
      this._onCameraMove(dx, dy);
    }
  }

  _onRightEnd(e) {
    if (this._pinchActive && e.targetTouches.length < 2) {
      this._pinchActive = false;
    }
    for (const t of e.changedTouches) {
      if (t.identifier === this._camTouchId) this._camTouchId = null;
    }
  }
}
