// Shop overlay shown while docked at the station. Session-only progression.
// Upgrades mutate the live ship object directly. main.js reads ship.weaponDamage
// and ship.weaponCooldownMs each frame, so changes apply immediately on undock.

const REPAIR_COST = 300;

const UPGRADES = [
  {
    id: 'hull',
    label: 'Hull Plating',
    blurb: '+25 max hull per level',
    max: 5,
    prices: [500, 1500, 4000, 9000, 20000],
    apply: (s) => {
      s.maxHull += 25;
      s.hull = Math.min(s.maxHull, s.hull + 25);
    },
  },
  {
    id: 'shield',
    label: 'Shield Capacitor',
    blurb: '+25 max shield, fully charged',
    max: 5,
    prices: [500, 1500, 4000, 9000, 20000],
    apply: (s) => {
      s.maxShield += 25;
      s.shield = s.maxShield;
    },
  },
  {
    id: 'engineSpeed',
    label: 'Engine Tuning',
    blurb: '+20% cruise & boost speed',
    max: 3,
    prices: [2000, 6000, 15000],
    apply: (s, lvl) => { s.speedMul = 1 + 0.20 * lvl; },
  },
  {
    id: 'weaponDamage',
    label: 'Warhead Yield',
    blurb: '+10 rocket damage',
    max: 3,
    prices: [1500, 5000, 12000],
    apply: (s, lvl) => { s.weaponDamage = 25 + 10 * lvl; },
  },
  {
    id: 'weaponCooldown',
    label: 'Autoloader',
    blurb: '-100 ms fire cooldown',
    max: 3,
    prices: [1500, 5000, 12000],
    apply: (s, lvl) => { s.weaponCooldownMs = Math.max(200, 600 - 100 * lvl); },
  },
];

export class Shop {
  constructor(ship, getCredits, setCredits) {
    this._ship       = ship;
    this._getCredits = getCredits;
    this._setCredits = setCredits;
    this._levels     = Object.fromEntries(UPGRADES.map(u => [u.id, 0]));
    this._repaired   = false;
    this._overlay    = null;
    this._onUndock   = null;
  }

  isOpen() { return !!this._overlay; }

  open(onUndock) {
    if (this._overlay) return;
    this._onUndock = onUndock;
    this._repaired = false;

    if (!document.getElementById('shop-overlay-style')) this._injectStyle();

    const root = document.createElement('div');
    root.id = 'shop-overlay';
    root.innerHTML = `
      <div class="shop-panel">
        <div class="shop-title">ARGOS STATION — UPGRADE BAY</div>
        <div class="shop-credits">CREDITS: <span id="shop-credits-val">0</span></div>
        <div class="shop-rows" id="shop-rows"></div>
        <div class="shop-foot">
          <button class="shop-btn shop-repair" id="shop-repair-btn"></button>
          <button class="shop-btn shop-undock" id="shop-undock-btn">UNDOCK ▸</button>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    this._overlay = root;

    this._bindStatic();
    this._render();
  }

  close() {
    if (!this._overlay) return;
    this._overlay.remove();
    this._overlay = null;
    this._onUndock = null;
  }

  _bindStatic() {
    const repairBtn = this._overlay.querySelector('#shop-repair-btn');
    const undockBtn = this._overlay.querySelector('#shop-undock-btn');
    this._tap(repairBtn, () => this._repair());
    this._tap(undockBtn, () => this._undock());
  }

  _render() {
    const credits = this._getCredits();
    this._overlay.querySelector('#shop-credits-val').textContent = credits;

    const rows = this._overlay.querySelector('#shop-rows');
    rows.innerHTML = '';
    for (const up of UPGRADES) {
      const lvl  = this._levels[up.id];
      const max  = lvl >= up.max;
      const cost = max ? null : up.prices[lvl];
      const row  = document.createElement('div');
      row.className = 'shop-row';
      row.innerHTML = `
        <div class="shop-row-info">
          <div class="shop-row-label">${up.label}<span class="shop-row-lvl">LVL ${lvl}/${up.max}</span></div>
          <div class="shop-row-blurb">${up.blurb}</div>
        </div>
        <button class="shop-btn shop-buy" data-id="${up.id}" ${max || cost > credits ? 'disabled' : ''}>
          ${max ? 'MAXED' : `BUY · ${cost}cr`}
        </button>
      `;
      const btn = row.querySelector('button');
      if (!btn.disabled) this._tap(btn, () => this._purchase(up.id));
      rows.appendChild(row);
    }

    const rb = this._overlay.querySelector('#shop-repair-btn');
    const canRepair = !this._repaired && credits >= REPAIR_COST && !this._isShipFullHealth();
    rb.disabled = !canRepair;
    rb.textContent = this._repaired ? 'REPAIRED ✓' : `FULL REPAIR · ${REPAIR_COST}cr`;
  }

  _isShipFullHealth() {
    const s = this._ship;
    return s.shield >= s.maxShield && s.armor >= s.maxArmor && s.hull >= s.maxHull;
  }

  _purchase(id) {
    const up  = UPGRADES.find(u => u.id === id);
    const lvl = this._levels[id];
    if (lvl >= up.max) return;
    const cost = up.prices[lvl];
    const credits = this._getCredits();
    if (credits < cost) return;
    this._setCredits(credits - cost);
    this._levels[id] = lvl + 1;
    up.apply(this._ship, lvl + 1);
    this._render();
  }

  _repair() {
    if (this._repaired) return;
    const credits = this._getCredits();
    if (credits < REPAIR_COST) return;
    if (this._isShipFullHealth()) return;
    this._setCredits(credits - REPAIR_COST);
    this._ship.shield = this._ship.maxShield;
    this._ship.armor  = this._ship.maxArmor;
    this._ship.hull   = this._ship.maxHull;
    this._repaired = true;
    this._render();
  }

  _undock() {
    const cb = this._onUndock;
    this.close();
    if (cb) cb();
  }

  // mousedown + touchstart to match the existing HUD action button pattern.
  _tap(btn, fn) {
    const handler = (e) => {
      if (btn.disabled) return;
      e.preventDefault();
      fn();
    };
    btn.addEventListener('mousedown', handler);
    btn.addEventListener('touchstart', handler, { passive: false });
  }

  _injectStyle() {
    const style = document.createElement('style');
    style.id = 'shop-overlay-style';
    style.textContent = `
      #shop-overlay {
        position: fixed; inset: 0;
        background: rgba(2, 8, 16, 0.85);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        z-index: 9999;
        display: flex; align-items: center; justify-content: center;
        font-family: 'Courier New', monospace;
        color: #b8e8ff;
        animation: shopFadeIn 0.25s ease-out;
      }
      @keyframes shopFadeIn { from { opacity: 0; } to { opacity: 1; } }

      #shop-overlay .shop-panel {
        width: 540px;
        max-width: calc(100vw - 32px);
        max-height: calc(100vh - 48px);
        overflow-y: auto;
        padding: 24px 28px;
        background: linear-gradient(180deg, rgba(8, 22, 40, 0.95), rgba(4, 12, 24, 0.98));
        border: 1px solid rgba(80, 200, 255, 0.5);
        box-shadow: 0 0 30px rgba(80, 200, 255, 0.3), inset 0 0 60px rgba(80, 200, 255, 0.05);
      }
      #shop-overlay .shop-title {
        font-size: 18px; letter-spacing: 3px; color: #ffcc44;
        text-shadow: 0 0 10px rgba(255, 200, 80, 0.8);
        text-align: center; margin-bottom: 6px;
      }
      #shop-overlay .shop-credits {
        text-align: center; font-size: 14px; color: #88ddff;
        letter-spacing: 2px; margin-bottom: 18px;
      }
      #shop-overlay .shop-credits span { color: #ffe070; font-weight: bold; }

      #shop-overlay .shop-row {
        display: flex; align-items: center; gap: 14px;
        padding: 10px 12px; margin-bottom: 8px;
        background: rgba(20, 40, 70, 0.4);
        border-left: 2px solid rgba(80, 200, 255, 0.4);
      }
      #shop-overlay .shop-row-info { flex: 1; }
      #shop-overlay .shop-row-label {
        font-size: 14px; letter-spacing: 1.5px; color: #cce8ff;
        display: flex; justify-content: space-between;
      }
      #shop-overlay .shop-row-lvl { color: #88aacc; font-size: 12px; }
      #shop-overlay .shop-row-blurb { font-size: 11px; color: #6699bb; margin-top: 3px; }

      #shop-overlay .shop-btn {
        font-family: inherit; font-size: 13px; letter-spacing: 1.5px;
        color: #b8e8ff; background: rgba(10, 30, 60, 0.9);
        border: 1px solid rgba(80, 200, 255, 0.5);
        padding: 8px 14px; cursor: pointer;
        text-shadow: 0 0 6px rgba(120, 220, 255, 0.5);
        transition: background 0.15s, color 0.15s;
      }
      #shop-overlay .shop-btn:hover:not(:disabled) {
        background: rgba(20, 60, 100, 0.95);
        color: #ffffff;
      }
      #shop-overlay .shop-btn:disabled {
        opacity: 0.35; cursor: not-allowed;
        color: #6688aa; text-shadow: none;
      }
      #shop-overlay .shop-buy {
        min-width: 110px; color: #ffcc44; border-color: rgba(255, 200, 80, 0.5);
        text-shadow: 0 0 6px rgba(255, 200, 80, 0.6);
      }
      #shop-overlay .shop-buy:hover:not(:disabled) {
        background: rgba(60, 40, 0, 0.95); color: #ffffff;
      }

      #shop-overlay .shop-foot {
        display: flex; gap: 12px; margin-top: 16px;
        padding-top: 14px; border-top: 1px solid rgba(80, 200, 255, 0.2);
      }
      #shop-overlay .shop-repair { flex: 1; color: #33ff99; border-color: rgba(50, 255, 150, 0.5); }
      #shop-overlay .shop-repair:hover:not(:disabled) { background: rgba(0, 50, 25, 0.95); color: #ffffff; }
      #shop-overlay .shop-undock { flex: 1; color: #ff8866; border-color: rgba(255, 130, 90, 0.5); }
      #shop-overlay .shop-undock:hover:not(:disabled) { background: rgba(60, 20, 10, 0.95); color: #ffffff; }
    `;
    document.head.appendChild(style);
  }
}
