import { B } from './blocks.js';

export const HOTBAR_SIZE = 9;
export const MAX_STACK = 64;

export const emptyHotbar = () => Array(HOTBAR_SIZE).fill(B.AIR);
export const emptyCounts = () => Array(HOTBAR_SIZE).fill(0);

export function addToHotbar(hotbar, counts, id, selected = 0) {
  let slot = hotbar.findIndex((slotId, i) => slotId === id && counts[i] < MAX_STACK);
  if (slot < 0 && hotbar[selected] === B.AIR) slot = selected;
  if (slot < 0) slot = hotbar.findIndex((slotId) => slotId === B.AIR);
  if (slot < 0) return -1;
  hotbar[slot] = id;
  counts[slot]++;
  return slot;
}

export function consumeHotbarSlot(hotbar, counts, slot) {
  counts[slot] = Math.max(0, counts[slot] - 1);
  if (counts[slot] === 0) hotbar[slot] = B.AIR;
}
