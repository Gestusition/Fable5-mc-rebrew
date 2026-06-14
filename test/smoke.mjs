// ============================================================
// Headless smoke tests (node): worldgen determinism, chunk
// streaming + meshing integrity, block editing, raycasting,
// player physics landing. Run: npm install && npm test
// ============================================================

import assert from 'node:assert';
import * as THREE from 'three';
import { SimplexNoise, hashString } from '../src/noise.js';
import { B, BLOCKS, PALETTE } from '../src/blocks.js';
import { WorldGen, CHUNK, WORLD_H, SEA, BIOME_NAMES } from '../src/worldgen.js';
import { World } from '../src/world.js';
import { buildBlockGeometry } from '../src/mesher.js';
import { Player, fallDamageForDistance, raycastVoxel } from '../src/player.js';
import {
  MAX_STACK, addItem, addToHotbar, consumeHotbarSlot, emptyCounts, emptyHotbar,
  clickSlot, emptyInventory, loadInventory, transferSlot,
} from '../src/inventory.js';
import {
  I, canHarvestBlock, createItemStack, damageTool, itemForBlock, miningSpeedFor,
} from '../src/items.js';
import { getBlockDrops } from '../src/drops.js';
import {
  craftOutput, takeCraftOutput, takeCraftOutputToInventory,
} from '../src/crafting.js';
import { createHunger, eatFood, tickHunger } from '../src/hunger.js';
import { createSmelter, smeltRecipeFor, tickSmelter } from '../src/smelting.js';
import { BlockEntities } from '../src/blockEntities.js';
import { MobSystem, raySphereDistance, standHeight } from '../src/mobs.js';
import { VillageSystem, findVillageSite } from '../src/villages.js';

const fakeScene = { add() {}, remove() {} };
const fakeMaterials = { solid: {}, water: {} };

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('— noise —');
ok('simplex deterministic + bounded', () => {
  const a = new SimplexNoise(123), b = new SimplexNoise(123), c = new SimplexNoise(124);
  let differs = false;
  for (let i = 0; i < 500; i++) {
    const x = i * 0.13, y = i * 0.07;
    assert.strictEqual(a.noise2(x, y), b.noise2(x, y));
    if (a.noise2(x, y) !== c.noise2(x, y)) differs = true;
    assert.ok(Math.abs(a.noise2(x, y)) <= 1.01);
    assert.ok(Math.abs(a.noise3(x, y, x + y)) <= 1.01);
  }
  assert.ok(differs, 'different seeds must differ');
});

console.log('— worldgen —');
const gen = new WorldGen(hashString('test-seed'));
ok('column heights within world bounds', () => {
  for (let x = -200; x <= 200; x += 7) {
    for (let z = -200; z <= 200; z += 11) {
      const c = gen.columnInfo(x, z);
      assert.ok(c.h >= 8 && c.h < WORLD_H, `h=${c.h}`);
      assert.ok(c.biome >= 0 && c.biome < BIOME_NAMES.length);
    }
  }
});
ok('spawn is on dry land', () => {
  const s = gen.findSpawn();
  const c = gen.columnInfo(Math.floor(s.x), Math.floor(s.z));
  assert.ok(c.h >= SEA + 1);
});

console.log('— world streaming & meshing —');
const world = new World({ seed: 42, scene: fakeScene, materials: fakeMaterials, viewRadius: 2 });
// operate around the (dry land) spawn column
const spawn = new WorldGen(42).findSpawn();
const SX = Math.floor(spawn.x), SZ = Math.floor(spawn.z);
const SCX = Math.floor(SX / CHUNK), SCZ = Math.floor(SZ / CHUNK);

ok('chunks generate and mesh', () => {
  for (let i = 0; i < 300; i++) world.update(spawn.x, spawn.z, 50);
  const c = world.getChunk(SCX, SCZ);
  assert.ok(c, 'chunk exists');
  assert.strictEqual(c.state, 'ready');
  assert.ok(c.solidMesh, 'has solid mesh');
  const pos = c.solidMesh.geometry.getAttribute('position');
  assert.ok(pos.count > 100, 'has vertices');
  for (let i = 0; i < pos.array.length; i++) assert.ok(Number.isFinite(pos.array[i]), 'no NaN positions');
  const col = c.solidMesh.geometry.getAttribute('color');
  for (let i = 0; i < col.array.length; i++) {
    assert.ok(col.array[i] >= 0 && col.array[i] <= 1.001, `color in range, got ${col.array[i]}`);
  }
});
ok('bedrock floor everywhere', () => {
  for (let x = 0; x < 16; x++)
    for (let z = 0; z < 16; z++)
      assert.strictEqual(world.getBlock(SCX * CHUNK + x, 0, SCZ * CHUNK + z), B.BEDROCK);
});
ok('terrain matches heightmap sanity', () => {
  const h = world.surfaceHeight(SX, SZ);
  assert.ok(h > 4 && h < WORLD_H);
  assert.notStrictEqual(world.getBlock(SX, h, SZ), B.AIR);
});

console.log('— editing —');
ok('setBlock + heightmap + dirty marking', () => {
  const h = world.surfaceHeight(SX, SZ);
  const y = h + 3;
  world.setBlock(SX, y, SZ, B.STONE);
  assert.strictEqual(world.getBlock(SX, y, SZ), B.STONE);
  assert.strictEqual(world.surfaceHeight(SX, SZ), y, 'heightmap raised');
  assert.ok(world.dirty.size > 0, 'chunk marked dirty');
  world.setBlock(SX, y, SZ, B.AIR);
  assert.strictEqual(world.surfaceHeight(SX, SZ), h, 'heightmap restored');
});
ok('torch tracking', () => {
  const h = world.surfaceHeight(SX, SZ);
  world.setBlock(SX, h + 1, SZ, B.TORCH);
  assert.strictEqual(world.getTorchesNear(SCX, SCZ).length, 1);
  world.setBlock(SX, h + 1, SZ, B.AIR);
  assert.strictEqual(world.getTorchesNear(SCX, SCZ).length, 0);
});
ok('edit persistence roundtrip', () => {
  const h = world.surfaceHeight(SX + 1, SZ + 1);
  world.setBlock(SX + 1, h + 1, SZ + 1, B.BRICKS);
  const ser = world.serializeEdits();
  assert.ok(ser.length > 0);
  const world2 = new World({ seed: 42, scene: fakeScene, materials: fakeMaterials, viewRadius: 2 });
  world2.loadEdits(ser);
  for (let i = 0; i < 300; i++) world2.update(spawn.x, spawn.z, 50);
  assert.strictEqual(world2.getBlock(SX + 1, h + 1, SZ + 1), B.BRICKS, 'edit survives regen');
});

console.log('— raycast —');
ok('downward ray hits terrain', () => {
  const hit = raycastVoxel(world, new THREE.Vector3(SX + 0.5, 120, SZ + 0.5), new THREE.Vector3(0, -1, 0), 140);
  assert.ok(hit, 'hit something');
  assert.strictEqual(hit.ny, 1, 'entered from the top face');
  assert.notStrictEqual(hit.id, B.AIR);
});
ok('sideways ray reports the entry face', () => {
  const y = 110; // well above any terrain
  for (let x = SX - 4; x < SX; x++) world.setBlock(x, y, SZ, B.AIR); // ensure clear path
  world.setBlock(SX, y, SZ, B.STONE);
  const hit = raycastVoxel(world, new THREE.Vector3(SX - 3.5, y + 0.5, SZ + 0.5), new THREE.Vector3(1, 0, 0), 10);
  assert.ok(hit);
  assert.strictEqual(hit.x, SX);
  assert.strictEqual(hit.nx, -1);
  world.setBlock(SX, y, SZ, B.AIR);
});

console.log('— player physics —');
// clear a drop zone above the spawn surface (trees etc.)
const groundH = world.surfaceHeight(SX, SZ);
for (let y = groundH + 1; y < groundH + 12; y++)
  for (let dx = -1; dx <= 2; dx++)
    for (let dz = -1; dz <= 1; dz++)
      world.setBlock(SX + dx, y, SZ + dz, B.AIR);

ok('fall damage matches Minecraft distance thresholds', () => {
  assert.strictEqual(fallDamageForDistance(0), 0);
  assert.strictEqual(fallDamageForDistance(3), 0);
  assert.strictEqual(fallDamageForDistance(3.01), 1);
  assert.strictEqual(fallDamageForDistance(4), 1);
  assert.strictEqual(fallDamageForDistance(4.01), 2);
  assert.strictEqual(fallDamageForDistance(23), 20);
});

ok('player falls and lands on the surface', () => {
  const p = new Player(world);
  p.teleport(SX + 0.5, groundH + 8, SZ + 0.5);
  const input = { forward: false, back: false, left: false, right: false, jump: false, sneak: false };
  for (let i = 0; i < 600; i++) p.update(1 / 60, input);
  assert.ok(p.onGround, 'landed');
  assert.ok(Math.abs(p.pos.y - (groundH + 1)) < 0.1, `rests on surface (y=${p.pos.y}, h=${groundH})`);
  const landing = p.events.find((event) => event.type === 'land');
  assert.ok(landing, 'landing event emitted');
  assert.strictEqual(fallDamageForDistance(landing.distance), 4);
});
ok('water resets accumulated fall distance', () => {
  const p = new Player(world);
  world.setBlock(SX, groundH + 1, SZ, B.WATER);
  world.setBlock(SX, groundH + 2, SZ, B.WATER);
  p.teleport(SX + 0.5, groundH + 9, SZ + 0.5);
  const input = { forward: false, back: false, left: false, right: false, jump: false, sneak: false };
  for (let i = 0; i < 600 && !p.onGround; i++) p.update(1 / 60, input);
  const landing = p.events.find((event) => event.type === 'land');
  assert.ok(landing, 'landed through the water');
  assert.strictEqual(fallDamageForDistance(landing.distance), 0);
  world.setBlock(SX, groundH + 1, SZ, B.AIR);
  world.setBlock(SX, groundH + 2, SZ, B.AIR);
});
ok('player collides with walls', () => {
  const p = new Player(world);
  // build a wall two blocks to the +x side
  world.setBlock(SX + 2, groundH + 1, SZ, B.STONE);
  world.setBlock(SX + 2, groundH + 2, SZ, B.STONE);
  p.teleport(SX + 0.5, groundH + 1, SZ + 0.5);
  const input = { forward: false, back: false, left: false, right: true, jump: false, sneak: false };
  for (let i = 0; i < 300; i++) p.update(1 / 60, input); // yaw=0 → "right" pushes +x
  assert.ok(p.pos.x < SX + 2, `stopped by wall (x=${p.pos.x})`);
  assert.ok(p.pos.x > SX + 1.5, `actually walked up to it (x=${p.pos.x})`);
  world.setBlock(SX + 2, groundH + 1, SZ, B.AIR);
  world.setBlock(SX + 2, groundH + 2, SZ, B.AIR);
});
ok('sprinting is faster than walking', () => {
  const flatWorld = {
    getBlock(_x, y) { return y === 0 ? B.STONE : B.AIR; },
  };
  const input = { forward: true, back: false, left: false, right: false, jump: false, sneak: false };
  const walker = new Player(flatWorld);
  const sprinter = new Player(flatWorld);
  walker.teleport(0.5, 1, 0.5);
  sprinter.teleport(0.5, 1, 0.5);
  sprinter.sprinting = true;
  for (let i = 0; i < 120; i++) {
    walker.update(1 / 60, input);
    sprinter.update(1 / 60, input);
  }
  const walkDistance = 0.5 - walker.pos.z;
  const sprintDistance = 0.5 - sprinter.pos.z;
  assert.ok(sprintDistance > walkDistance * 1.25, `${sprintDistance} > ${walkDistance} * 1.25`);
});

console.log('— survival inventory —');
ok('survival hotbar starts empty and stacks mined blocks', () => {
  const hotbar = emptyHotbar();
  const counts = emptyCounts();
  assert.deepStrictEqual(hotbar, Array(9).fill(B.AIR));
  assert.strictEqual(addToHotbar(hotbar, counts, B.STONE, 0), 0);
  assert.strictEqual(addToHotbar(hotbar, counts, B.STONE, 0), 0);
  assert.strictEqual(hotbar[0], B.STONE);
  assert.strictEqual(counts[0], 2);
  consumeHotbarSlot(hotbar, counts, 0);
  consumeHotbarSlot(hotbar, counts, 0);
  assert.strictEqual(hotbar[0], B.AIR);
  assert.strictEqual(counts[0], 0);
});
ok('full stacks spill into the next empty slot', () => {
  const hotbar = emptyHotbar();
  const counts = emptyCounts();
  hotbar[0] = B.DIRT;
  counts[0] = MAX_STACK;
  assert.strictEqual(addToHotbar(hotbar, counts, B.DIRT, 0), 1);
  assert.strictEqual(counts[0], MAX_STACK);
  assert.strictEqual(hotbar[1], B.DIRT);
  assert.strictEqual(counts[1], 1);
});
ok('full inventory stacks block and non-block items safely', () => {
  const inventory = emptyInventory();
  assert.deepStrictEqual(addItem(inventory, I.COBBLE, 70, 0), { added: 70, remaining: 0 });
  assert.strictEqual(inventory[0].count, 64);
  assert.strictEqual(inventory[1].count, 6);
  assert.deepStrictEqual(addItem(inventory, I.STICK, 4), { added: 4, remaining: 0 });
  assert.strictEqual(inventory[2].id, I.STICK);
  assert.strictEqual(inventory[2].count, 4);
});
ok('slot clicks move, merge and swap stacks without duplication', () => {
  const inventory = emptyInventory(2);
  inventory[0] = { id: I.STICK, count: 3 };
  let cursor = clickSlot(inventory, 0, { id: null, count: 0 });
  assert.deepStrictEqual(cursor, { id: I.STICK, count: 3 });
  cursor = clickSlot(inventory, 1, cursor);
  assert.deepStrictEqual(cursor, { id: null, count: 0 });
  assert.deepStrictEqual(inventory[1], { id: I.STICK, count: 3 });
  cursor = clickSlot(inventory, 1, { id: I.STICK, count: 2 });
  assert.deepStrictEqual(cursor, { id: null, count: 0 });
  assert.deepStrictEqual(inventory[1], { id: I.STICK, count: 5 });
});
ok('right click splits stacks and places one item at a time', () => {
  const inventory = emptyInventory(3);
  inventory[0] = { id: I.PLANKS, count: 5 };
  let cursor = clickSlot(inventory, 0, {}, 'right');
  assert.deepStrictEqual(cursor, { id: I.PLANKS, count: 3 });
  assert.deepStrictEqual(inventory[0], { id: I.PLANKS, count: 2 });
  cursor = clickSlot(inventory, 1, cursor, 'right');
  cursor = clickSlot(inventory, 2, cursor, 'right');
  assert.deepStrictEqual(inventory[1], { id: I.PLANKS, count: 1 });
  assert.deepStrictEqual(inventory[2], { id: I.PLANKS, count: 1 });
  assert.deepStrictEqual(cursor, { id: I.PLANKS, count: 1 });
});
ok('random slot clicks conserve item counts', () => {
  const inventory = emptyInventory(8);
  inventory[0] = { id: I.PLANKS, count: 37 };
  inventory[1] = { id: I.PLANKS, count: 11 };
  inventory[2] = { id: I.STICK, count: 19 };
  let cursor = { id: null, count: 0 };
  let seed = 12345;
  const random = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const totals = () => {
    const all = [...inventory, cursor];
    return {
      planks: all.reduce((sum, slot) => sum + (slot.id === I.PLANKS ? slot.count : 0), 0),
      sticks: all.reduce((sum, slot) => sum + (slot.id === I.STICK ? slot.count : 0), 0),
    };
  };
  for (let i = 0; i < 500; i++) {
    const index = Math.floor(random() * inventory.length);
    cursor = clickSlot(inventory, index, cursor, random() < 0.5 ? 'left' : 'right');
    assert.deepStrictEqual(totals(), { planks: 48, sticks: 19 });
  }
});
ok('shift transfer moves stacks between inventory ranges', () => {
  const inventory = emptyInventory();
  inventory[12] = { id: I.COBBLE, count: 18 };
  const moved = transferSlot(inventory, 12, Array.from({ length: 9 }, (_, i) => i));
  assert.strictEqual(moved, 18);
  assert.deepStrictEqual(inventory[0], { id: I.COBBLE, count: 18 });
  assert.deepStrictEqual(inventory[12], { id: null, count: 0 });
});
ok('old numeric hotbar saves migrate to item ids', () => {
  const inventory = loadInventory(null, [B.STONE, B.LOG, ...Array(7).fill(B.AIR)], [3, 2, ...Array(7).fill(0)]);
  assert.deepStrictEqual(inventory[0], { id: I.STONE, count: 3 });
  assert.deepStrictEqual(inventory[1], { id: I.LOG, count: 2 });
});
ok('old Creative saves without counts keep their block items', () => {
  const inventory = loadInventory(null, [B.WATER, B.STONE, ...Array(7).fill(B.AIR)]);
  assert.deepStrictEqual(inventory[0], { id: I.WATER, count: 1 });
  assert.deepStrictEqual(inventory[1], { id: I.STONE, count: 1 });
});
ok('tool durability survives inventory save normalization', () => {
  const inventory = loadInventory([{ id: I.STONE_TOOL, count: 1, durability: 47 }]);
  assert.deepStrictEqual(inventory[0], { id: I.STONE_TOOL, count: 1, durability: 47 });
  assert.strictEqual(createItemStack(I.WOOD_TOOL).durability, 60);
});

console.log('— drops, crafting & progression —');
ok('block drops use survival loot rules', () => {
  assert.deepStrictEqual(getBlockDrops(B.GRASS), [{ id: I.DIRT, count: 1 }]);
  assert.deepStrictEqual(getBlockDrops(B.STONE), []);
  assert.deepStrictEqual(getBlockDrops(B.STONE, I.WOOD_TOOL), [{ id: I.COBBLE, count: 1 }]);
  assert.deepStrictEqual(getBlockDrops(B.COAL_ORE, I.WOOD_TOOL), [{ id: I.COAL, count: 1 }]);
  assert.deepStrictEqual(getBlockDrops(B.IRON_ORE, I.WOOD_TOOL), []);
  assert.deepStrictEqual(getBlockDrops(B.IRON_ORE, I.STONE_TOOL), [{ id: I.IRON_ORE, count: 1 }]);
  assert.deepStrictEqual(getBlockDrops(B.WATER), []);
  assert.deepStrictEqual(getBlockDrops(B.BEDROCK), []);
});
ok('crafting consumes ingredients only when output is taken', () => {
  const grid = [{ id: I.LOG, count: 2 }, {}, {}, {}];
  assert.deepStrictEqual(craftOutput(grid), { id: I.PLANKS, count: 4 });
  assert.strictEqual(grid[0].count, 2, 'preview does not consume');
  const cursor = takeCraftOutput(grid, {});
  assert.deepStrictEqual(cursor, { id: I.PLANKS, count: 4 });
  assert.strictEqual(grid[0].count, 1);
});
ok('split ingredient stacks can be distributed into a recipe', () => {
  const inventory = emptyInventory(2);
  inventory[0] = { id: I.PLANKS, count: 1 };
  inventory[1] = { id: I.PLANKS, count: 1 };
  const grid = [{}, {}, {}, {}];
  let cursor = clickSlot(inventory, 0, {}, 'left');
  cursor = clickSlot(grid, 0, cursor, 'right');
  cursor = clickSlot(inventory, 1, cursor, 'left');
  cursor = clickSlot(grid, 2, cursor, 'right');
  assert.deepStrictEqual(cursor, { id: null, count: 0 });
  assert.deepStrictEqual(craftOutput(grid), { id: I.STICK, count: 4 });
});
ok('shift crafting is atomic when inventory cannot fit output', () => {
  const grid = [{ id: I.LOG, count: 1 }, {}, {}, {}];
  const full = Array.from({ length: 2 }, () => ({ id: I.COBBLE, count: 64 }));
  assert.strictEqual(takeCraftOutputToInventory(grid, full), false);
  assert.strictEqual(grid[0].count, 1);
  full[1] = { id: I.PLANKS, count: 60 };
  assert.strictEqual(takeCraftOutputToInventory(grid, full), true);
  assert.deepStrictEqual(full[1], { id: I.PLANKS, count: 64 });
  assert.deepStrictEqual(full[0], { id: I.COBBLE, count: 64 });
  assert.deepStrictEqual(grid[0], { id: null, count: 0 });
});
ok('vertical planks make sticks and tools improve mining speed', () => {
  const grid = [{ id: I.PLANKS, count: 1 }, {}, { id: I.PLANKS, count: 1 }, {}];
  assert.deepStrictEqual(craftOutput(grid), { id: I.STICK, count: 4 });
  assert.ok(miningSpeedFor(I.STONE_TOOL, B.STONE) > miningSpeedFor(I.WOOD_TOOL, B.STONE));
  assert.strictEqual(miningSpeedFor(I.IRON_TOOL, B.LOG), 1);
});
ok('tool tiers and durability enforce successful harvest use', () => {
  assert.strictEqual(canHarvestBlock(null, B.STONE), false);
  assert.strictEqual(canHarvestBlock(I.WOOD_TOOL, B.STONE), true);
  assert.strictEqual(canHarvestBlock(I.WOOD_TOOL, B.IRON_ORE), false);
  assert.strictEqual(canHarvestBlock(I.STONE_TOOL, B.IRON_ORE), true);
  const tool = createItemStack(I.WOOD_TOOL);
  assert.deepStrictEqual(damageTool(tool), { damaged: true, broken: false });
  assert.strictEqual(tool.durability, 59);
  tool.durability = 1;
  assert.deepStrictEqual(damageTool(tool), { damaged: true, broken: true });
  assert.strictEqual(tool.durability, 0);
});
ok('3x3 crafting gates workbench recipes and creates every tool family', () => {
  const pickaxe = [
    { id: I.PLANKS, count: 1 }, { id: I.PLANKS, count: 1 }, { id: I.PLANKS, count: 1 },
    {}, { id: I.STICK, count: 1 }, {},
    {}, { id: I.STICK, count: 1 }, {},
  ];
  assert.deepStrictEqual(craftOutput(pickaxe, 3), {
    id: I.WOOD_PICKAXE,
    count: 1,
    durability: 60,
  });
  assert.deepStrictEqual(craftOutput(pickaxe.slice(0, 4), 2), { id: null, count: 0 });

  const axe = [
    { id: I.COBBLE, count: 1 }, { id: I.COBBLE, count: 1 }, {},
    { id: I.COBBLE, count: 1 }, { id: I.STICK, count: 1 }, {},
    {}, { id: I.STICK, count: 1 }, {},
  ];
  assert.strictEqual(craftOutput(axe, 3).id, I.STONE_AXE);

  const shovel = [
    {}, { id: I.IRON_INGOT, count: 1 }, {},
    {}, { id: I.STICK, count: 1 }, {},
    {}, { id: I.STICK, count: 1 }, {},
  ];
  assert.strictEqual(craftOutput(shovel, 3).id, I.IRON_SHOVEL);
  assert.ok(miningSpeedFor(I.STONE_AXE, B.LOG) > miningSpeedFor(I.STONE_PICKAXE, B.LOG));
  assert.ok(miningSpeedFor(I.STONE_SHOVEL, B.DIRT) > miningSpeedFor(I.STONE_PICKAXE, B.DIRT));
});
ok('crafting table and furnace blocks are obtainable recipes', () => {
  const table = Array.from({ length: 4 }, () => ({ id: I.PLANKS, count: 1 }));
  assert.strictEqual(craftOutput(table, 2).id, I.CRAFTING_TABLE);
  const furnace = [
    { id: I.COBBLE, count: 1 }, { id: I.COBBLE, count: 1 }, { id: I.COBBLE, count: 1 },
    { id: I.COBBLE, count: 1 }, {}, { id: I.COBBLE, count: 1 },
    { id: I.COBBLE, count: 1 }, { id: I.COBBLE, count: 1 }, { id: I.COBBLE, count: 1 },
  ];
  assert.strictEqual(craftOutput(furnace, 3).id, I.FURNACE);
});
ok('coal smelts iron ore without duplicating fuel or output', () => {
  const smelter = createSmelter({
    input: { id: I.IRON_ORE, count: 2 },
    fuel: { id: I.COAL, count: 1 },
  });
  tickSmelter(smelter, 2);
  assert.strictEqual(smelter.fuel.count, 0);
  assert.strictEqual(smelter.output.count, 0);
  tickSmelter(smelter, 3.1);
  assert.deepStrictEqual(smelter.output, { id: I.IRON_INGOT, count: 1 });
  assert.strictEqual(smelter.input.count, 1);
  assert.ok(smelter.burnRemaining > 4.8 && smelter.burnRemaining < 5);
  tickSmelter(smelter, 4.9);
  assert.deepStrictEqual(smelter.output, { id: I.IRON_INGOT, count: 2 });
  assert.deepStrictEqual(smelter.input, { id: null, count: 0 });
  assert.strictEqual(smelter.fuel.count, 0);
});
ok('smelter progress and burn time survive save normalization', () => {
  const smelter = createSmelter({
    input: { id: I.IRON_ORE, count: 1 },
    progress: 2.5,
    burnRemaining: 6.25,
  });
  assert.strictEqual(smelter.progress, 2.5);
  assert.strictEqual(smelter.burnRemaining, 6.25);
});
ok('blocked smelter output does not consume fuel or input', () => {
  const smelter = createSmelter({
    input: { id: I.IRON_ORE, count: 1 },
    fuel: { id: I.COAL, count: 1 },
    output: { id: I.IRON_INGOT, count: 64 },
  });
  tickSmelter(smelter, 20);
  assert.strictEqual(smelter.input.count, 1);
  assert.strictEqual(smelter.fuel.count, 1);
  assert.strictEqual(smelter.output.count, 64);
  assert.strictEqual(smelter.progress, 0);
});
ok('furnaces keep independent persistent block state', () => {
  const entities = new BlockEntities();
  const first = entities.getFurnace(1, 64, 1);
  const second = entities.getFurnace(2, 64, 1);
  first.input = { id: I.RAW_MEAT, count: 1 };
  first.fuel = { id: I.COAL, count: 1 };
  second.input = { id: I.SAND, count: 1 };
  second.fuel = { id: I.PLANKS, count: 2 };
  entities.update(5.1);
  assert.deepStrictEqual(first.output, { id: I.COOKED_MEAT, count: 1 });
  assert.deepStrictEqual(second.output, { id: I.GLASS, count: 1 });
  const loaded = new BlockEntities(entities.serialize());
  assert.deepStrictEqual(loaded.getFurnace(1, 64, 1, false).output, first.output);
  assert.deepStrictEqual(loaded.getFurnace(2, 64, 1, false).output, second.output);
  loaded.update(0, () => true, (x) => x !== 2);
  assert.strictEqual(loaded.getFurnace(2, 64, 1, false), null);
  assert.strictEqual(smeltRecipeFor(I.RAW_MEAT).outputId, I.COOKED_MEAT);
  assert.strictEqual(smeltRecipeFor(I.SAND).outputId, I.GLASS);
});

console.log('— hunger —');
ok('food restores hunger and starvation damages health', () => {
  const hunger = createHunger({ hunger: 10 });
  assert.strictEqual(eatFood(hunger, { hunger: 6 }), true);
  assert.strictEqual(hunger.hunger, 16);
  hunger.hunger = 0;
  assert.strictEqual(tickHunger(hunger, 4.1, { health: 10, maxHealth: 20, passive: false }), -1);
});
ok('hunger state defaults safely for old saves', () => {
  assert.strictEqual(createHunger({}).hunger, 20);
  assert.strictEqual(createHunger({ hunger: 0 }).hunger, 0);
  assert.strictEqual(itemForBlock(B.TORCH), I.TORCH);
});

console.log('— mobs & villages —');
ok('mob grounding and ray targeting respect voxel space', () => {
  const flat = {
    getBlock(_x, y) { return y === 0 ? B.STONE : B.AIR; },
  };
  assert.strictEqual(standHeight(flat, 0.5, 0.5, 1), 1);
  const distance = raySphereDistance(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, 1, -3),
    0.5,
    5,
  );
  assert.ok(distance > 2.4 && distance < 2.6);
});
ok('villagers serialize with named professions and real trades', () => {
  const scene = { add() {}, remove() {} };
  const flat = {
    isLoaded() { return true; },
    getBlock(_x, y) { return y === 0 ? B.STONE : B.AIR; },
    surfaceHeight() { return 0; },
  };
  const mobs = new MobSystem({ scene, world: flat });
  const villager = mobs.spawn('villager', 0.5, 1, 0.5, {
    name: 'Mira',
    profession: 'toolsmith',
    home: { x: 0, y: 1, z: 0 },
  });
  const view = mobs.villagerView(villager);
  assert.strictEqual(view.name, 'Mira');
  assert.strictEqual(view.profession, 'Toolsmith');
  assert.ok(view.trades.some((trade) => trade.result.id === I.IRON_PICKAXE));
  assert.strictEqual(mobs.serialize()[0].profession, 'toolsmith');
});
ok('villagers wait safely when their saved chunk is unloaded', () => {
  let loaded = false;
  const scene = { add() {}, remove() {} };
  const flat = {
    isLoaded() { return loaded; },
    getBlock(_x, y) { return y === 0 ? B.STONE : B.AIR; },
    surfaceHeight() { return 0; },
  };
  const mobs = new MobSystem({ scene, world: flat });
  mobs.load([{
    id: 7,
    type: 'villager',
    x: 20.5,
    y: 1,
    z: 20.5,
    health: 20,
    name: 'Cora',
    profession: 'farmer',
  }]);
  assert.strictEqual(mobs.list.length, 0);
  assert.strictEqual(mobs.serialize().length, 1);
  loaded = true;
  mobs.update(0.01, { pos: new THREE.Vector3(0, 1, 0) }, { spawning: false });
  assert.strictEqual(mobs.list.length, 1);
  assert.strictEqual(mobs.list[0].name, 'Cora');
});
ok('village sites and structures are deterministic and include residents', () => {
  const seed = hashString('village-test');
  const villageGen = new WorldGen(seed);
  const villageSpawn = villageGen.findSpawn();
  assert.deepStrictEqual(
    findVillageSite(villageGen, villageSpawn, seed),
    findVillageSite(villageGen, villageSpawn, seed),
  );
  const edits = new Map();
  const fakeWorld = {
    gen: villageGen,
    isLoaded() { return true; },
    getBlock(x, y, z) { return edits.get(`${x},${y},${z}`) ?? B.AIR; },
    setBlock(x, y, z, id) { edits.set(`${x},${y},${z}`, id); return B.AIR; },
  };
  const villages = new VillageSystem(seed, villageSpawn);
  for (let i = 0; i < 40 && !villages.generated; i++) villages.update(fakeWorld, 512);
  assert.strictEqual(villages.generated, true);
  assert.ok([...edits.values()].includes(B.CRAFTING_TABLE));
  assert.ok([...edits.values()].includes(B.FURNACE));
  const residents = villages.takeResidentSpawns();
  assert.strictEqual(residents.length, 4);
  assert.deepStrictEqual(villages.takeResidentSpawns(), []);
});

console.log('— block geometry —');
ok('standalone geometry for every palette block', () => {
  for (const id of PALETTE) {
    const g = buildBlockGeometry(id);
    const pos = g.getAttribute('position');
    assert.ok(pos.count >= 4, `${BLOCKS[id].name} has vertices`);
    for (let i = 0; i < pos.array.length; i++) assert.ok(Number.isFinite(pos.array[i]));
  }
});

console.log(`\nAll ${passed} smoke tests passed ✔`);
