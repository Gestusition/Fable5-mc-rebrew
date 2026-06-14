import { I, createItemStack, itemDef } from './items.js';
import { addStack, capacityForItem, emptySlot } from './inventory.js';

const shaped = (id, minGrid, width, height, pattern, outputId, outputCount) => ({
  id,
  minGrid,
  width,
  height,
  pattern,
  output: { id: outputId, count: outputCount },
});

const materials = [
  { key: 'wood', id: I.PLANKS, pickaxe: I.WOOD_PICKAXE, axe: I.WOOD_AXE, shovel: I.WOOD_SHOVEL },
  { key: 'stone', id: I.COBBLE, pickaxe: I.STONE_PICKAXE, axe: I.STONE_AXE, shovel: I.STONE_SHOVEL },
  { key: 'iron', id: I.IRON_INGOT, pickaxe: I.IRON_PICKAXE, axe: I.IRON_AXE, shovel: I.IRON_SHOVEL },
];

export const RECIPES = [
  shaped('planks', 2, 1, 1, [I.LOG], I.PLANKS, 4),
  shaped('sticks', 2, 1, 2, [I.PLANKS, I.PLANKS], I.STICK, 4),
  shaped(
    'crafting-table',
    2,
    2,
    2,
    [I.PLANKS, I.PLANKS, I.PLANKS, I.PLANKS],
    I.CRAFTING_TABLE,
    1,
  ),
  shaped('torches', 3, 1, 2, [I.COAL, I.STICK], I.TORCH, 4),
  shaped(
    'furnace',
    3,
    3,
    3,
    [I.COBBLE, I.COBBLE, I.COBBLE, I.COBBLE, null, I.COBBLE, I.COBBLE, I.COBBLE, I.COBBLE],
    I.FURNACE,
    1,
  ),
  shaped(
    'door',
    3,
    2,
    3,
    [I.PLANKS, I.PLANKS, I.PLANKS, I.PLANKS, I.PLANKS, I.PLANKS],
    I.DOOR,
    3,
  ),
  shaped('bed', 3, 3, 1, [I.PLANKS, I.PLANKS, I.PLANKS], I.BED, 1),
];

for (const material of materials) {
  RECIPES.push(
    shaped(
      `${material.key}-pickaxe`,
      3,
      3,
      3,
      [material.id, material.id, material.id, null, I.STICK, null, null, I.STICK, null],
      material.pickaxe,
      1,
    ),
    shaped(
      `${material.key}-axe`,
      3,
      2,
      3,
      [material.id, material.id, material.id, I.STICK, null, I.STICK],
      material.axe,
      1,
    ),
    shaped(
      `${material.key}-axe-mirrored`,
      3,
      2,
      3,
      [material.id, material.id, I.STICK, material.id, I.STICK, null],
      material.axe,
      1,
    ),
    shaped(
      `${material.key}-shovel`,
      3,
      1,
      3,
      [material.id, I.STICK, I.STICK],
      material.shovel,
      1,
    ),
  );
}

function gridWidthFor(grid, explicitWidth) {
  if (explicitWidth === 2 || explicitWidth === 3) return explicitWidth;
  const width = Math.sqrt(grid.length);
  return Number.isInteger(width) ? width : 2;
}

function bounds(grid, gridWidth) {
  const used = [];
  for (let i = 0; i < grid.length; i++) {
    if (grid[i]?.id) used.push([i % gridWidth, Math.floor(i / gridWidth)]);
  }
  if (!used.length) return null;
  const xs = used.map((point) => point[0]);
  const ys = used.map((point) => point[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

export function findRecipe(grid, explicitWidth) {
  const gridWidth = gridWidthFor(grid, explicitWidth);
  const b = bounds(grid, gridWidth);
  if (!b) return null;
  const width = b.maxX - b.minX + 1;
  const height = b.maxY - b.minY + 1;
  for (const recipe of RECIPES) {
    if (gridWidth < recipe.minGrid || recipe.width !== width || recipe.height !== height) continue;
    let matches = true;
    for (let y = 0; y < height && matches; y++) {
      for (let x = 0; x < width; x++) {
        const actual = grid[(b.minY + y) * gridWidth + b.minX + x]?.id || null;
        if (actual !== recipe.pattern[y * width + x]) {
          matches = false;
          break;
        }
      }
    }
    if (matches) return recipe;
  }
  return null;
}

export function craftOutput(grid, gridWidth) {
  const recipe = findRecipe(grid, gridWidth);
  return recipe ? createItemStack(recipe.output.id, recipe.output.count) : emptySlot();
}

function consumeRecipe(grid, recipe, explicitWidth) {
  const gridWidth = gridWidthFor(grid, explicitWidth);
  const b = bounds(grid, gridWidth);
  for (let y = 0; y < recipe.height; y++) {
    for (let x = 0; x < recipe.width; x++) {
      if (!recipe.pattern[y * recipe.width + x]) continue;
      const index = (b.minY + y) * gridWidth + b.minX + x;
      grid[index].count--;
      if (grid[index].count <= 0) grid[index] = emptySlot();
    }
  }
}

export function takeCraftOutput(grid, cursor, gridWidth) {
  const recipe = findRecipe(grid, gridWidth);
  if (!recipe) return cursor;
  const output = createItemStack(recipe.output.id, recipe.output.count);
  const max = itemDef(output.id)?.maxStack ?? 64;
  if (cursor.id && cursor.id !== output.id) return cursor;
  if ((cursor.count || 0) + output.count > max) return cursor;

  consumeRecipe(grid, recipe, gridWidth);
  return {
    ...output,
    count: (cursor.id ? cursor.count : 0) + output.count,
  };
}

export function takeCraftOutputToInventory(grid, inventory, preferred = -1, gridWidth) {
  const recipe = findRecipe(grid, gridWidth);
  if (!recipe) return false;
  const output = createItemStack(recipe.output.id, recipe.output.count);
  if (capacityForItem(inventory, output.id) < output.count) return false;
  const result = addStack(inventory, output, preferred);
  if (result.remaining > 0) return false;
  consumeRecipe(grid, recipe, gridWidth);
  return true;
}
