export const MAX_HUNGER = 20;

export function createHunger(saved = {}) {
  const hunger = Number(saved.hunger);
  return {
    hunger: Math.max(0, Math.min(MAX_HUNGER, Number.isFinite(hunger) ? hunger : MAX_HUNGER)),
    exhaustion: Math.max(0, Number(saved.exhaustion) || 0),
    starvationTimer: Math.max(0, Number(saved.starvationTimer) || 0),
    regenTimer: Math.max(0, Number(saved.regenTimer) || 0),
  };
}

export function addExhaustion(state, amount) {
  state.exhaustion += Math.max(0, amount);
}

export function eatFood(state, food) {
  if (!food || state.hunger >= MAX_HUNGER) return false;
  state.hunger = Math.min(MAX_HUNGER, state.hunger + food.hunger);
  return true;
}

export function tickHunger(state, dt, { health, maxHealth, passive = true } = {}) {
  if (passive) state.exhaustion += dt * 0.1;
  while (state.exhaustion >= 4) {
    state.exhaustion -= 4;
    state.hunger = Math.max(0, state.hunger - 1);
  }

  let healthDelta = 0;
  if (state.hunger <= 0) {
    state.regenTimer = 0;
    state.starvationTimer += dt;
    if (state.starvationTimer >= 4) {
      state.starvationTimer %= 4;
      if (health > 1) healthDelta = -1; // Don't kill the player from starvation
    }
  } else {
    state.starvationTimer = 0;
    // Regen health if hunger is at least half full (10+)
    if (state.hunger >= 10 && health < maxHealth) {
      state.regenTimer += dt;
      if (state.regenTimer >= 3) { // Faster regen
        state.regenTimer %= 3;
        healthDelta = 1;
        state.exhaustion += 1.5;
      }
    } else {
      state.regenTimer = 0;
    }
  }
  return healthDelta;
}
