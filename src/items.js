import { B, BLOCKS, PALETTE } from './blocks.js';

export const I = {
  DIRT: 'block:dirt',
  GRASS: 'block:grass',
  STONE: 'block:stone',
  COBBLE: 'block:cobble',
  SAND: 'block:sand',
  GLASS: 'block:glass',
  LOG: 'block:log',
  PLANKS: 'block:planks',
  LEAVES: 'block:leaves',
  TORCH: 'block:torch',
  WATER: 'block:water',
  COAL_ORE: 'block:coal_ore',
  IRON_ORE: 'block:iron_ore',
  CRAFTING_TABLE: 'block:crafting_table',
  FURNACE: 'block:furnace',
  STICK: 'item:stick',
  COAL: 'item:coal',
  IRON_INGOT: 'item:iron_ingot',
  EMERALD: 'item:emerald',
  WOOD_PICKAXE: 'tool:wood',
  STONE_PICKAXE: 'tool:stone',
  IRON_PICKAXE: 'tool:iron',
  WOOD_AXE: 'tool:wood_axe',
  STONE_AXE: 'tool:stone_axe',
  IRON_AXE: 'tool:iron_axe',
  WOOD_SHOVEL: 'tool:wood_shovel',
  STONE_SHOVEL: 'tool:stone_shovel',
  IRON_SHOVEL: 'tool:iron_shovel',
  WOOD_TOOL: 'tool:wood',
  STONE_TOOL: 'tool:stone',
  IRON_TOOL: 'tool:iron',
  APPLE: 'food:apple',
  RAW_MEAT: 'food:raw_meat',
  COOKED_MEAT: 'food:cooked_meat',
  RAW_PORK: 'food:raw_pork',
  COOKED_PORK: 'food:cooked_pork',
  RAW_MUTTON: 'food:raw_mutton',
  COOKED_MUTTON: 'food:cooked_mutton',
  DOOR: 'item:door',
  BED: 'item:bed',
};

const BLOCK_ITEM_IDS = new Map([
  [B.GRASS, I.GRASS],
  [B.DIRT, I.DIRT],
  [B.STONE, I.STONE],
  [B.COBBLE, I.COBBLE],
  [B.SAND, I.SAND],
  [B.GLASS, I.GLASS],
  [B.LOG, I.LOG],
  [B.PLANKS, I.PLANKS],
  [B.LEAVES, I.LEAVES],
  [B.TORCH, I.TORCH],
  [B.WATER, I.WATER],
  [B.COAL_ORE, I.COAL_ORE],
  [B.IRON_ORE, I.IRON_ORE],
  [B.CRAFTING_TABLE, I.CRAFTING_TABLE],
  [B.FURNACE, I.FURNACE],
]);

for (const blockId of PALETTE) {
  if (blockId === B.AIR || blockId === B.WATER) continue;
  if (!BLOCK_ITEM_IDS.has(blockId)) BLOCK_ITEM_IDS.set(blockId, `block:${blockId}`);
}

const item = (id, name, props = {}) => ({
  id,
  name,
  maxStack: 64,
  blockId: null,
  icon: { type: 'generated', color: '#b8b8b8' },
  ...props,
});

export const ITEMS = new Map();

for (const [blockId, id] of BLOCK_ITEM_IDS) {
  ITEMS.set(id, item(id, BLOCKS[blockId].name, {
    blockId,
    icon: { type: 'block', blockId },
  }));
}
ITEMS.get(I.LOG).fuel = { seconds: 5 };
ITEMS.get(I.PLANKS).fuel = { seconds: 2.5 };

ITEMS.set(I.STICK, item(I.STICK, 'Stick', {
  icon: { type: 'stick', color: '#9a6d3c' },
}));
ITEMS.set(I.COAL, item(I.COAL, 'Coal', {
  icon: { type: 'gem', color: '#2d2d32', highlight: '#696970' },
  fuel: { seconds: 10 },
}));
ITEMS.set(I.IRON_INGOT, item(I.IRON_INGOT, 'Iron Ingot', {
  icon: { type: 'ingot', color: '#d8d4ca', highlight: '#ffffff' },
}));
ITEMS.set(I.EMERALD, item(I.EMERALD, 'Emerald', {
  icon: { type: 'gem', color: '#26a65b', highlight: '#75e39c' },
}));
const toolItem = (id, name, type, tier, speed, maxDurability, color) => {
  ITEMS.set(id, item(id, name, {
    maxStack: 1,
    icon: { type: 'tool', toolType: type, color },
    tool: { type, tier, speed, maxDurability },
  }));
};

toolItem(I.WOOD_PICKAXE, 'Wooden Pickaxe', 'pickaxe', 1, 1.7, 60, '#aa7b48');
toolItem(I.STONE_PICKAXE, 'Stone Pickaxe', 'pickaxe', 2, 2.6, 132, '#858585');
toolItem(I.IRON_PICKAXE, 'Iron Pickaxe', 'pickaxe', 3, 3.8, 251, '#d9d9d9');
toolItem(I.WOOD_AXE, 'Wooden Axe', 'axe', 1, 1.7, 60, '#aa7b48');
toolItem(I.STONE_AXE, 'Stone Axe', 'axe', 2, 2.6, 132, '#858585');
toolItem(I.IRON_AXE, 'Iron Axe', 'axe', 3, 3.8, 251, '#d9d9d9');
toolItem(I.WOOD_SHOVEL, 'Wooden Shovel', 'shovel', 1, 1.7, 60, '#aa7b48');
toolItem(I.STONE_SHOVEL, 'Stone Shovel', 'shovel', 2, 2.6, 132, '#858585');
toolItem(I.IRON_SHOVEL, 'Iron Shovel', 'shovel', 3, 3.8, 251, '#d9d9d9');
ITEMS.set(I.APPLE, item(I.APPLE, 'Wild Apple', {
  icon: { type: 'food', color: '#c83d35', highlight: '#f26b54' },
  food: { hunger: 6 },
}));
ITEMS.set(I.RAW_MEAT, item(I.RAW_MEAT, 'Raw Game Meat', {
  icon: { type: 'food', color: '#b75f5f', highlight: '#e89586' },
  food: { hunger: 3 },
}));
ITEMS.set(I.COOKED_MEAT, item(I.COOKED_MEAT, 'Cooked Game Meat', {
  icon: { type: 'food', color: '#8b462d', highlight: '#d68a55' },
  food: { hunger: 8 },
}));
ITEMS.set(I.RAW_PORK, item(I.RAW_PORK, 'Raw Porkchop', {
  icon: { type: 'food', color: '#e8a0a0', highlight: '#f5c4b8' },
  food: { hunger: 3 },
}));
ITEMS.set(I.COOKED_PORK, item(I.COOKED_PORK, 'Cooked Porkchop', {
  icon: { type: 'food', color: '#a45e30', highlight: '#d68a55' },
  food: { hunger: 8 },
}));
ITEMS.set(I.RAW_MUTTON, item(I.RAW_MUTTON, 'Raw Mutton', {
  icon: { type: 'food', color: '#c76e6e', highlight: '#e5a090' },
  food: { hunger: 2 },
}));
ITEMS.set(I.COOKED_MUTTON, item(I.COOKED_MUTTON, 'Cooked Mutton', {
  icon: { type: 'food', color: '#7a4025', highlight: '#c07848' },
  food: { hunger: 6 },
}));
ITEMS.set(I.DOOR, item(I.DOOR, 'Wooden Door', {
  icon: { type: 'generated', color: '#9a6d3c' },
  blockId: null,
}));
ITEMS.set(I.BED, item(I.BED, 'Bed', {
  icon: { type: 'generated', color: '#b33030' },
  blockId: null,
}));

export function itemDef(id) {
  return ITEMS.get(id) || null;
}

export function itemForBlock(blockId) {
  return BLOCK_ITEM_IDS.get(blockId) || null;
}

export function blockForItem(id) {
  return itemDef(id)?.blockId ?? null;
}

export function migrateLegacyItemId(value) {
  if (typeof value === 'string' && ITEMS.has(value)) return value;
  if (Number.isInteger(value) && value !== B.AIR) return itemForBlock(value);
  return null;
}

export function createItemStack(id, count = 1, saved = {}) {
  const def = itemDef(id);
  if (!def || count <= 0) return { id: null, count: 0 };
  const stack = { id, count: Math.min(def.maxStack, Math.max(1, Math.floor(count))) };
  if (def.tool) {
    const durability = Number(saved.durability);
    stack.durability = Math.max(
      1,
      Math.min(def.tool.maxDurability, Number.isFinite(durability) ? durability : def.tool.maxDurability),
    );
  }
  return stack;
}

export function canHarvestBlock(itemId, blockId) {
  const block = BLOCKS[blockId];
  if (!block || block.hardness === Infinity) return false;
  if (!block.requiredToolType) return true;
  const tool = itemDef(itemId)?.tool;
  return !!tool && tool.type === block.requiredToolType && tool.tier >= block.requiredToolTier;
}

export function isToolEffective(itemId, blockId) {
  const tool = itemDef(itemId)?.tool;
  const block = BLOCKS[blockId];
  return !!tool && !!block?.preferredToolType && tool.type === block.preferredToolType;
}

export function damageTool(stack, amount = 1) {
  const tool = itemDef(stack?.id)?.tool;
  if (!tool || amount <= 0) return { damaged: false, broken: false };
  const current = Number.isFinite(stack.durability) ? stack.durability : tool.maxDurability;
  stack.durability = Math.max(0, current - amount);
  return { damaged: true, broken: stack.durability <= 0 };
}

export function miningSpeedFor(itemId, blockId) {
  const tool = itemDef(itemId)?.tool;
  const block = BLOCKS[blockId];
  if (!block) return 1;
  if (block.requiredToolType && !canHarvestBlock(itemId, blockId)) return 0.35;
  if (!tool) return 1;
  return isToolEffective(itemId, blockId) ? tool.speed : 1;
}
