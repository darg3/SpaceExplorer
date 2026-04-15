export class Menu {
  constructor(onStart) {
    this._onStart = onStart;
    this._el = this._build();
    document.body.appendChild(this._el);
  }

  show() {
    this._el.style.opacity = '1';
    this._el.style.pointerEvents = 'auto';
  }

  #hide() {
    this._el.style.opacity = '0';
    this._el.style.pointerEvents = 'none';
    setTimeout(() => this._el.remove(), 420);
  }

  _build() {
    const overlay = document.createElement('div');
    overlay.id = 'menu';
    overlay.style.cssText = `
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.88);
      display: flex; align-items: center; justify-content: center;
      font-family: 'Courier New', monospace;
      color: rgba(100,200,255,0.9);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.4s;
      z-index: 100;
    `;

    overlay.appendChild(this._buildMain());
    overlay.appendChild(this._buildHowToPlay());
    return overlay;
  }

  _buildMain() {
    const screen = document.createElement('div');
    screen.id = 'menu-main';
    screen.style.cssText = 'text-align: center;';

    screen.innerHTML = `
      <div style="
        font-size: 56px;
        letter-spacing: 0.25em;
        text-shadow: 0 0 30px rgba(80,160,255,0.9), 0 0 60px rgba(80,160,255,0.4);
        margin-bottom: 12px;
      ">SPACEMAN</div>
      <div style="
        font-size: 13px;
        letter-spacing: 0.2em;
        color: rgba(100,200,255,0.4);
        margin-bottom: 56px;
      ">DEEP SPACE EXPLORER</div>
    `;

    screen.appendChild(this._btn('START GAME', () => {
      this.#hide();
      this._onStart();
    }));

    const gap = document.createElement('div');
    gap.style.height = '14px';
    screen.appendChild(gap);

    screen.appendChild(this._btn('HOW TO PLAY', () => {
      document.getElementById('menu-main').style.display = 'none';
      document.getElementById('menu-howtoplay').style.display = 'block';
    }));

    return screen;
  }

  _buildHowToPlay() {
    const screen = document.createElement('div');
    screen.id = 'menu-howtoplay';
    screen.style.cssText = `
      display: none;
      text-align: center;
      max-width: 560px;
      width: 90vw;
    `;

    const title = document.createElement('div');
    title.textContent = 'HOW TO PLAY';
    title.style.cssText = `
      font-size: 26px;
      letter-spacing: 0.2em;
      text-shadow: 0 0 20px rgba(80,160,255,0.8);
      margin-bottom: 28px;
    `;
    screen.appendChild(title);

    const sections = [
      {
        heading: 'FLIGHT',
        rows: [
          ['W / S',     'Pitch up / down'],
          ['A / D',     'Yaw left / right'],
          ['Q / E',     'Roll left / right'],
          ['Shift',     'Boost  (1000 m/s)'],
        ],
      },
      {
        heading: 'CAMERA',
        rows: [
          ['Mouse Drag',    'Orbit around ship'],
          ['Scroll Wheel',  'Zoom in / out'],
        ],
      },
      {
        heading: 'TARGETING & ACTIONS',
        rows: [
          ['Left Click',          'Lock / unlock target'],
          ['Right Click',         'Open target menu'],
          ['HUD · Fire Rockets',  'Shoot at enemy (600 ms cooldown)'],
          ['HUD · Mine Asteroid', 'Mine rock within 400 units'],
          ['HUD · Warp To Target','Warp to target (> 600 units)'],
        ],
      },
      {
        heading: 'ENGINE',
        rows: [
          ['HUD · Thrusters',  'Toggle engine on / off'],
          ['HUD · Stop Ship',  'Cut engines immediately'],
          ['HUD · Speed Bar',  'Drag to set cruise speed'],
        ],
      },
    ];

    sections.forEach(({ heading, rows }) => {
      const h = document.createElement('div');
      h.textContent = heading;
      h.style.cssText = `
        font-size: 11px;
        letter-spacing: 0.18em;
        color: rgba(100,200,255,0.45);
        margin: 20px 0 8px;
        text-align: left;
      `;
      screen.appendChild(h);

      rows.forEach(([key, desc]) => {
        const row = document.createElement('div');
        row.style.cssText = `
          display: flex;
          justify-content: space-between;
          padding: 5px 0;
          border-bottom: 1px solid rgba(100,200,255,0.08);
          font-size: 13px;
        `;
        row.innerHTML = `
          <span style="color:rgba(100,200,255,0.85); min-width:180px; text-align:left">${key}</span>
          <span style="color:rgba(180,220,255,0.55); text-align:right">${desc}</span>
        `;
        screen.appendChild(row);
      });
    });

    const backGap = document.createElement('div');
    backGap.style.height = '28px';
    screen.appendChild(backGap);

    screen.appendChild(this._btn('BACK', () => {
      document.getElementById('menu-howtoplay').style.display = 'none';
      document.getElementById('menu-main').style.display = 'block';
    }));

    return screen;
  }

  _btn(label, onClick) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `
      background: transparent;
      border: 1px solid rgba(100,200,255,0.35);
      color: rgba(100,200,255,0.85);
      font-family: 'Courier New', monospace;
      font-size: 13px;
      letter-spacing: 0.18em;
      padding: 11px 36px;
      cursor: pointer;
      box-shadow: 0 0 12px rgba(80,160,255,0.2);
      transition: box-shadow 0.2s, border-color 0.2s, color 0.2s;
      width: 220px;
    `;
    b.addEventListener('mouseenter', () => {
      b.style.boxShadow = '0 0 22px rgba(80,160,255,0.55)';
      b.style.borderColor = 'rgba(100,200,255,0.8)';
      b.style.color = 'rgba(150,220,255,1)';
    });
    b.addEventListener('mouseleave', () => {
      b.style.boxShadow = '0 0 12px rgba(80,160,255,0.2)';
      b.style.borderColor = 'rgba(100,200,255,0.35)';
      b.style.color = 'rgba(100,200,255,0.85)';
    });
    b.addEventListener('click', onClick);
    return b;
  }
}
