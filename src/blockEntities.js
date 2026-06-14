import { createSmelter, tickSmelter } from './smelting.js';

export const blockEntityKey = (x, y, z) => `${x},${y},${z}`;

export class BlockEntities {
  constructor(saved = []) {
    this.furnaces = new Map();
    this.load(saved);
  }

  load(saved) {
    if (!Array.isArray(saved)) return;
    for (const entry of saved) {
      const x = Number(entry?.x);
      const y = Number(entry?.y);
      const z = Number(entry?.z);
      if (![x, y, z].every(Number.isInteger)) continue;
      this.furnaces.set(blockEntityKey(x, y, z), {
        x,
        y,
        z,
        state: createSmelter(entry.state),
      });
    }
  }

  getFurnace(x, y, z, create = true) {
    const key = blockEntityKey(x, y, z);
    let entry = this.furnaces.get(key);
    if (!entry && create) {
      entry = { x, y, z, state: createSmelter() };
      this.furnaces.set(key, entry);
    }
    return entry?.state || null;
  }

  removeFurnace(x, y, z) {
    const key = blockEntityKey(x, y, z);
    const entry = this.furnaces.get(key);
    this.furnaces.delete(key);
    return entry?.state || null;
  }

  update(dt, isLoaded = () => true, isValid = () => true) {
    let changed = false;
    for (const [key, entry] of this.furnaces) {
      if (!isLoaded(entry.x, entry.z)) continue;
      if (!isValid(entry.x, entry.y, entry.z)) {
        this.furnaces.delete(key);
        changed = true;
        continue;
      }
      if (tickSmelter(entry.state, dt)) changed = true;
    }
    return changed;
  }

  serialize() {
    return [...this.furnaces.values()].map((entry) => ({
      x: entry.x,
      y: entry.y,
      z: entry.z,
      state: entry.state,
    }));
  }
}
