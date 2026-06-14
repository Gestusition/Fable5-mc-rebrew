import { B } from './blocks.js';
import { I } from './items.js';
import { BIOME, SEA } from './worldgen.js';
import { hash2 } from './noise.js';

const NAMES = [
  'Alden', 'Bran', 'Cora', 'Della', 'Edric', 'Fenna',
  'Galen', 'Hale', 'Iris', 'Jory', 'Kesta', 'Mira',
];

export const VILLAGER_PROFESSIONS = {
  farmer: {
    name: 'Farmer',
    trades: [
      { cost: { id: I.APPLE, count: 4 }, result: { id: I.EMERALD, count: 1 } },
      { cost: { id: I.EMERALD, count: 1 }, result: { id: I.COOKED_MEAT, count: 3 } },
    ],
  },
  mason: {
    name: 'Mason',
    trades: [
      { cost: { id: I.COBBLE, count: 20 }, result: { id: I.EMERALD, count: 1 } },
      { cost: { id: I.EMERALD, count: 2 }, result: { id: I.IRON_INGOT, count: 3 } },
    ],
  },
  toolsmith: {
    name: 'Toolsmith',
    trades: [
      { cost: { id: I.COAL, count: 8 }, result: { id: I.EMERALD, count: 1 } },
      { cost: { id: I.EMERALD, count: 4 }, result: { id: I.IRON_PICKAXE, count: 1 } },
    ],
  },
  fletcher: {
    name: 'Fletcher',
    trades: [
      { cost: { id: I.STICK, count: 24 }, result: { id: I.EMERALD, count: 1 } },
      { cost: { id: I.EMERALD, count: 2 }, result: { id: I.TORCH, count: 16 } },
    ],
  },
};

function siteScore(gen, x, z) {
  const samples = [];
  for (const dz of [-10, 0, 10]) {
    for (const dx of [-10, 0, 10]) {
      const info = gen.columnInfo(x + dx, z + dz);
      if (info.biome === BIOME.OCEAN || info.h <= SEA) return null;
      samples.push(info.h);
    }
  }
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const center = gen.columnInfo(x, z);
  const biomePenalty = center.biome === BIOME.PLAINS ? 0 : center.biome === BIOME.FOREST ? 2 : 7;
  return {
    x,
    z,
    y: Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length),
    score: (max - min) * 6 + biomePenalty,
  };
}

export function findVillageSite(gen, spawn, seed) {
  const sx = Math.floor(spawn.x);
  const sz = Math.floor(spawn.z);
  let best = null;
  for (const radius of [20, 28, 36, 44]) {
    for (let i = 0; i < 16; i++) {
      const offset = (hash2(seed, radius, 0x51a9) / 4294967296) * Math.PI * 2;
      const angle = offset + (i / 16) * Math.PI * 2;
      const x = Math.round((sx + Math.cos(angle) * radius) / 4) * 4;
      const z = Math.round((sz + Math.sin(angle) * radius) / 4) * 4;
      const candidate = siteScore(gen, x, z);
      if (candidate && (!best || candidate.score < best.score)) best = candidate;
    }
    if (best && best.score <= 12) break;
  }
  if (best) return best;
  const fallback = gen.columnInfo(sx + 20, sz);
  return { x: sx + 20, z: sz, y: fallback.h, score: 99 };
}

function buildVillagePlan(site) {
  const blocks = new Map();
  const set = (x, y, z, id) => blocks.set(`${x},${y},${z}`, { x, y, z, id });
  const { x: cx, y: base, z: cz } = site;

  const flatten = (x0, z0, x1, z1, surface = B.GRASS) => {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        set(x, base - 2, z, B.DIRT);
        set(x, base - 1, z, B.DIRT);
        set(x, base, z, surface);
        for (let y = base + 1; y <= base + 7; y++) set(x, y, z, B.AIR);
      }
    }
  };

  for (let d = -18; d <= 18; d++) {
    flatten(cx + d, cz - 1, cx + d, cz + 1, B.GRAVEL);
    flatten(cx - 1, cz + d, cx + 1, cz + d, B.GRAVEL);
  }

  const houses = [
    { x: cx - 13, z: cz - 13, door: 'south' },
    { x: cx + 7, z: cz - 13, door: 'south' },
    { x: cx - 13, z: cz + 8, door: 'north' },
    { x: cx + 7, z: cz + 8, door: 'north' },
  ];

  const buildHouse = ({ x: x0, z: z0, door }) => {
    const x1 = x0 + 6;
    const z1 = z0 + 5;
    flatten(x0 - 1, z0 - 1, x1 + 1, z1 + 1);
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        set(x, base, z, B.COBBLE);
        const edge = x === x0 || x === x1 || z === z0 || z === z1;
        if (!edge) continue;
        const corner = (x === x0 || x === x1) && (z === z0 || z === z1);
        for (let y = base + 1; y <= base + 3; y++) {
          set(x, y, z, corner ? B.LOG : B.PLANKS);
        }
      }
    }
    const doorX = x0 + 3;
    const doorZ = door === 'south' ? z1 : z0;
    set(doorX, base + 1, doorZ, B.DOOR_CLOSED);
    set(doorX, base + 2, doorZ, B.DOOR_CLOSED);
    for (const [wx, wz] of [[x0, z0 + 2], [x1, z0 + 2], [x0 + 2, z0], [x0 + 4, z1]]) {
      set(wx, base + 2, wz, B.GLASS);
    }
    for (let z = z0 - 1; z <= z1 + 1; z++) {
      for (let x = x0 - 1; x <= x1 + 1; x++) set(x, base + 4, z, B.PLANKS);
    }
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) set(x, base + 5, z, B.PLANKS);
    }
    set(x0 + 1, base + 1, z0 + 1, B.CRAFTING_TABLE);
    set(x1 - 1, base + 1, z1 - 1, B.FURNACE);
    // Add a bed inside the house (2 blocks long)
    set(x0 + 1, base + 1, z1 - 1, B.BED);
    set(x0 + 1, base + 1, z1 - 2, B.BED);
    const outsideZ = door === 'south' ? z1 + 1 : z0 - 1;
    set(doorX - 1, base + 1, outsideZ, B.TORCH);
  };

  houses.forEach(buildHouse);

  flatten(cx - 3, cz - 3, cx + 3, cz + 3, B.COBBLE);
  for (let z = cz - 2; z <= cz + 2; z++) {
    for (let x = cx - 2; x <= cx + 2; x++) {
      const edge = x === cx - 2 || x === cx + 2 || z === cz - 2 || z === cz + 2;
      set(x, base + 1, z, edge ? B.COBBLE : B.WATER);
    }
  }
  for (const [x, z] of [[cx - 2, cz - 2], [cx + 2, cz - 2], [cx - 2, cz + 2], [cx + 2, cz + 2]]) {
    set(x, base + 2, z, B.LOG);
    set(x, base + 3, z, B.TORCH);
  }

  return [...blocks.values()];
}

export class VillageSystem {
  constructor(seed, spawn, saved = null) {
    this.seed = seed >>> 0;
    this.spawn = spawn;
    this.site = saved?.site || null;
    this.generated = !!saved?.generated;
    this.residentsSpawned = !!saved?.residentsSpawned;
    this.plan = null;
    this.planIndex = 0;
  }

  ensureSite(world) {
    if (!this.site) this.site = findVillageSite(world.gen, this.spawn, this.seed);
    return this.site;
  }

  areaLoaded(world) {
    const site = this.ensureSite(world);
    for (const dz of [-20, 0, 20]) {
      for (const dx of [-20, 0, 20]) {
        if (!world.isLoaded(site.x + dx, site.z + dz)) return false;
      }
    }
    return true;
  }

  update(world, budget = 256) {
    if (this.generated || !this.areaLoaded(world)) return false;
    if (!this.plan) this.plan = buildVillagePlan(this.site);
    let changed = false;
    for (let count = 0; count < budget && this.planIndex < this.plan.length; count++) {
      const op = this.plan[this.planIndex++];
      if (world.getBlock(op.x, op.y, op.z) !== op.id) {
        world.setBlock(op.x, op.y, op.z, op.id, { silent: true });
        changed = true;
      }
    }
    if (this.planIndex >= this.plan.length) {
      this.generated = true;
      this.plan = null;
    }
    return changed;
  }

  takeResidentSpawns() {
    if (!this.generated || this.residentsSpawned) return [];
    this.residentsSpawned = true;
    const { x, y, z } = this.site;
    const professions = Object.keys(VILLAGER_PROFESSIONS);
    return professions.map((profession, index) => ({
      type: 'villager',
      x: x + (index % 2 ? 9 : -9) + 0.5,
      y: y + 1,
      z: z + (index < 2 ? -9 : 10) + 0.5,
      home: { x, y: y + 1, z },
      name: NAMES[hash2(this.seed, index, 0x71aa) % NAMES.length],
      profession,
    }));
  }

  serialize() {
    return {
      site: this.site,
      generated: this.generated,
      residentsSpawned: this.residentsSpawned,
    };
  }
}
