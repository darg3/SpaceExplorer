// Tracks keyboard state for 3D flight controls.
// is(code) returns true while that key is held.
export class InputHandler {
  constructor() {
    this.keys = {};
    this._onDown = e => { this.keys[e.code] = true; };
    this._onUp   = e => { this.keys[e.code] = false; };
    window.addEventListener('keydown', this._onDown);
    window.addEventListener('keyup',   this._onUp);
  }

  is(code) { return !!this.keys[code]; }

  dispose() {
    window.removeEventListener('keydown', this._onDown);
    window.removeEventListener('keyup',   this._onUp);
  }
}
