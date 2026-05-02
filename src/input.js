// Tracks keyboard state for 3D flight controls.
// is(code) returns true while that key is held.
// wasPressed(code) returns true on the frame a key first goes down — call
// tick() once per frame (end of animate) to advance the previous-frame snapshot.
export class InputHandler {
  constructor() {
    this.keys  = {};
    this._prev = {};
    this._onDown = e => { this.keys[e.code] = true; };
    this._onUp   = e => { this.keys[e.code] = false; };
    window.addEventListener('keydown', this._onDown);
    window.addEventListener('keyup',   this._onUp);
  }

  is(code) { return !!this.keys[code]; }

  wasPressed(code) { return !!this.keys[code] && !this._prev[code]; }

  tick() {
    for (const k in this.keys) this._prev[k] = this.keys[k];
  }

  dispose() {
    window.removeEventListener('keydown', this._onDown);
    window.removeEventListener('keyup',   this._onUp);
  }
}
