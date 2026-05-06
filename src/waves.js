import * as THREE from 'three';
import { ARCHETYPES } from './npcs.js';

// ── Tuning ────────────────────────────────────────────────────────────────────
const SPAWN_R_MIN     = 800;   // min spawn radius around player
const SPAWN_R_MAX     = 1200;  // max spawn radius
const SPAWN_DELAY     = 0.4;   // seconds between spawns inside a wave
const PRESTART_DELAY  = 3.0;   // seconds after start() before wave 1 spawns
const INTERMISSION    = 4.0;   // seconds between waves
const HP_PER_WAVE     = 1.15;  // HP multiplier per wave
const DMG_PER_WAVE    = 1.10;  // damage multiplier per wave

// Reusable temporaries
const _spawnPos = new THREE.Vector3();

// ── Roster generator ──────────────────────────────────────────────────────────
// Returns a flat list of archetype ids to spawn for this wave. Boss waves
// (every 5th) are exactly one boss. Non-boss waves mix scouts and heavies
// with counts that ramp up and a difficulty-tier bonus per 5-wave cycle.
function rosterFor(wave) {
  if (wave % 5 === 0) return ['boss'];

  const tier   = Math.floor((wave - 1) / 5);   // 0,1,2,... harder per cycle
  const w      = ((wave - 1) % 5) + 1;          // 1..4 within the current cycle
  const scouts = 2 + Math.floor(w / 2) + tier;
  const heavies = w >= 2 ? Math.floor(w / 2) + tier : 0;

  const list = [];
  for (let i = 0; i < scouts; i++)  list.push('scout');
  for (let i = 0; i < heavies; i++) list.push('heavy');
  return list;
}

export class WaveManager {
  constructor(fleet, hud, getPlayerPos) {
    this._fleet = fleet;
    this._hud   = hud;
    this._getPlayerPos = getPlayerPos;

    this.wave        = 0;
    this._phase      = 'idle';   // idle | preStart | spawning | active | cleared | intermission
    this._timer      = 0;        // multi-purpose phase timer
    this._spawnQueue = [];       // remaining archetype ids for current wave
    this._spawnAccum = 0;        // delay accumulator between spawns
  }

  start() {
    if (this._phase !== 'idle') return;
    this._phase = 'preStart';
    this._timer = PRESTART_DELAY;
    this._hud?.setWave(0);
    this._hud?.setEnemiesRemaining(0);
  }

  update(delta) {
    switch (this._phase) {
      case 'idle':
        return;

      case 'preStart':
        this._timer -= delta;
        if (this._timer <= 0) this._beginWave();
        return;

      case 'spawning':
        this._spawnAccum += delta;
        while (this._spawnAccum >= SPAWN_DELAY && this._spawnQueue.length > 0) {
          this._spawnAccum -= SPAWN_DELAY;
          const archId = this._spawnQueue.shift();
          this._spawnOne(archId);
        }
        if (this._spawnQueue.length === 0) this._phase = 'active';
        // fall through to active accounting on the same frame is fine, but we
        // wait one frame so newly-spawned ships register in fleet.aliveCount.
        this._hud?.setEnemiesRemaining(this._fleet.aliveCount);
        return;

      case 'active': {
        const alive = this._fleet.aliveCount;
        this._hud?.setEnemiesRemaining(alive);
        if (alive === 0) {
          this._phase = 'cleared';
          this._timer = 1.2;   // brief beat before the banner
          this._hud?.showWaveBanner(`WAVE ${this.wave} CLEARED`);
        }
        return;
      }

      case 'cleared':
        this._timer -= delta;
        if (this._timer <= 0) {
          this._phase = 'intermission';
          this._timer = INTERMISSION;
        }
        return;

      case 'intermission':
        this._timer -= delta;
        if (this._timer <= 0) this._beginWave();
        return;
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _beginWave() {
    this.wave += 1;
    this._spawnQueue = rosterFor(this.wave);
    this._spawnAccum = SPAWN_DELAY;   // first spawn lands immediately
    this._phase = 'spawning';

    const isBoss = this.wave % 5 === 0;
    this._hud?.setWave(this.wave);
    this._hud?.setEnemiesRemaining(this._spawnQueue.length);
    this._hud?.showWaveBanner(
      isBoss ? `WAVE ${this.wave} — BOSS INCOMING` : `WAVE ${this.wave}`,
    );
  }

  _spawnOne(archId) {
    const playerPos = this._getPlayerPos();
    this._randomSpawnPos(playerPos, _spawnPos);
    const mult = {
      hp:  HP_PER_WAVE  ** (this.wave - 1),
      dmg: DMG_PER_WAVE ** (this.wave - 1),
    };
    this._fleet.spawn(archId, _spawnPos, mult);
  }

  _randomSpawnPos(playerPos, out) {
    const theta = Math.random() * Math.PI * 2;
    // Tilt: bias toward the equator so ships don't all spawn straight above
    const phi   = (Math.random() - 0.5) * Math.PI * 0.7;
    const r     = SPAWN_R_MIN + Math.random() * (SPAWN_R_MAX - SPAWN_R_MIN);
    const cp    = Math.cos(phi);
    out.set(
      playerPos.x + r * cp * Math.cos(theta),
      playerPos.y + r * cp * Math.sin(theta),
      playerPos.z + r * Math.sin(phi),
    );
  }
}

// Re-export so callers don't need to reach into npcs.js for archetype info
export { ARCHETYPES };
