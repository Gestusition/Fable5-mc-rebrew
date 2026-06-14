import { I, itemDef } from './items.js';
import { emptySlot, normalizeSlot } from './inventory.js';

export const SMELT_SECONDS = 5;

export const SMELT_RECIPES = new Map([
  [I.IRON_ORE, { outputId: I.IRON_INGOT, count: 1 }],
  [I.RAW_MEAT, { outputId: I.COOKED_MEAT, count: 1 }],
  [I.RAW_PORK, { outputId: I.COOKED_PORK, count: 1 }],
  [I.RAW_MUTTON, { outputId: I.COOKED_MUTTON, count: 1 }],
  [I.SAND, { outputId: I.GLASS, count: 1 }],
]);

export function smeltRecipeFor(inputId) {
  return SMELT_RECIPES.get(inputId) || null;
}

export function isFuelItem(itemId) {
  return (itemDef(itemId)?.fuel?.seconds || 0) > 0;
}

export function createSmelter(saved = {}) {
  const progress = Math.max(0, Math.min(SMELT_SECONDS, Number(saved.progress) || 0));
  const savedBurn = Number(saved.burnRemaining);
  return {
    input: normalizeSlot(saved.input),
    fuel: normalizeSlot(saved.fuel),
    output: normalizeSlot(saved.output),
    progress,
    burnRemaining: Math.max(
      0,
      Number.isFinite(savedBurn)
        ? savedBurn
        : (saved.fuelPaid ? SMELT_SECONDS - progress : 0),
    ),
  };
}

function currentRecipe(state) {
  if (!state.input.id || state.input.count <= 0) return null;
  return smeltRecipeFor(state.input.id);
}

function outputHasRoom(state, recipe) {
  if (!recipe) return false;
  const max = itemDef(recipe.outputId)?.maxStack ?? 64;
  return !state.output.id ||
    (state.output.id === recipe.outputId && state.output.count + recipe.count <= max);
}

function fuelSeconds(state) {
  return itemDef(state.fuel.id)?.fuel?.seconds || 0;
}

export function canSmelt(state) {
  const recipe = currentRecipe(state);
  return !!recipe && outputHasRoom(state, recipe) &&
    (state.burnRemaining > 0 || (state.fuel.count > 0 && fuelSeconds(state) > 0));
}

export function tickSmelter(state, dt) {
  dt = Math.max(0, Number(dt) || 0);
  let recipe = currentRecipe(state);
  if (!recipe) {
    state.progress = 0;
    return false;
  }
  if (!outputHasRoom(state, recipe)) return false;

  let produced = false;
  while (dt > 1e-9 && recipe && outputHasRoom(state, recipe)) {
    if (state.burnRemaining <= 1e-9) {
      const seconds = fuelSeconds(state);
      if (seconds <= 0 || state.fuel.count <= 0) break;
      state.fuel.count--;
      if (state.fuel.count <= 0) state.fuel = emptySlot();
      state.burnRemaining = seconds;
    }

    const step = Math.min(dt, state.burnRemaining, SMELT_SECONDS - state.progress);
    state.progress += step;
    state.burnRemaining -= step;
    dt -= step;

    if (state.progress >= SMELT_SECONDS - 1e-9) {
      state.progress = 0;
      state.input.count--;
      if (state.input.count <= 0) state.input = emptySlot();
      if (state.output.id === recipe.outputId) state.output.count += recipe.count;
      else state.output = { id: recipe.outputId, count: recipe.count };
      produced = true;
      recipe = currentRecipe(state);
    }
    if (step <= 1e-9) break;
  }
  return produced;
}
