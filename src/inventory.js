import { B } from './blocks.js';
import { createItemStack, itemDef, migrateLegacyItemId } from './items.js';

export const HOTBAR_SIZE = 9;
export const MAIN_INVENTORY_SIZE = 27;
export const INVENTORY_SIZE = HOTBAR_SIZE + MAIN_INVENTORY_SIZE;
export const MAX_STACK = 64;

export const emptySlot = () => ({ id: null, count: 0 });
export const emptyInventory = (size = INVENTORY_SIZE) =>
  Array.from({ length: size }, emptySlot);

export function normalizeSlot(slot) {
  const id = migrateLegacyItemId(slot?.id);
  const def = itemDef(id);
  const count = Math.max(0, Math.min(def?.maxStack ?? MAX_STACK, Number(slot?.count) || 0));
  return id && count > 0 ? createItemStack(id, count, slot) : emptySlot();
}

export function loadInventory(saved, legacyHotbar, legacyCounts) {
  const out = emptyInventory();
  if (Array.isArray(saved)) {
    for (let i = 0; i < Math.min(out.length, saved.length); i++) out[i] = normalizeSlot(saved[i]);
    return out;
  }
  if (Array.isArray(legacyHotbar)) {
    for (let i = 0; i < Math.min(HOTBAR_SIZE, legacyHotbar.length); i++) {
      const id = migrateLegacyItemId(legacyHotbar[i]);
      const count = Math.max(0, Array.isArray(legacyCounts) ? Number(legacyCounts[i]) || 0 : (id ? 1 : 0));
      if (id && count) out[i] = normalizeSlot({ id, count });
    }
  }
  return out;
}

export function cloneStack(slot) {
  return slot?.id ? { ...slot } : emptySlot();
}

export function addStack(slots, stack, preferred = -1) {
  const def = itemDef(stack?.id);
  const count = Math.max(0, Math.floor(Number(stack?.count) || 0));
  if (!def || count <= 0) return { added: 0, remaining: Math.max(0, count) };
  const id = stack.id;
  let remaining = count;
  const order = [];
  if (preferred >= 0 && preferred < slots.length) order.push(preferred);
  for (let i = 0; i < slots.length; i++) if (i !== preferred) order.push(i);

  for (const i of order) {
    const slot = slots[i];
    if (slot.id !== id || slot.count >= def.maxStack) continue;
    const moved = Math.min(remaining, def.maxStack - slot.count);
    slot.count += moved;
    remaining -= moved;
    if (!remaining) break;
  }
  for (const i of order) {
    if (!remaining) break;
    const slot = slots[i];
    if (slot.id) continue;
    const moved = Math.min(remaining, def.maxStack);
    slots[i] = createItemStack(id, moved, stack);
    remaining -= moved;
  }
  return { added: count - remaining, remaining };
}

export function addItem(slots, id, count = 1, preferred = -1) {
  return addStack(slots, { id, count }, preferred);
}

export function capacityForItem(slots, id) {
  const def = itemDef(id);
  if (!def) return 0;
  return slots.reduce((total, slot) => {
    if (!slot?.id) return total + def.maxStack;
    if (slot.id === id) return total + Math.max(0, def.maxStack - slot.count);
    return total;
  }, 0);
}

export function consumeSlot(slots, index, count = 1) {
  const slot = slots[index];
  if (!slot?.id || slot.count < count || count <= 0) return false;
  slot.count -= count;
  if (slot.count <= 0) slots[index] = emptySlot();
  return true;
}

export function countItem(slots, id) {
  return slots.reduce((sum, slot) => sum + (slot.id === id ? slot.count : 0), 0);
}

export function removeItem(slots, id, count = 1) {
  if (countItem(slots, id) < count) return false;
  let remaining = count;
  for (let i = slots.length - 1; i >= 0 && remaining > 0; i--) {
    if (slots[i].id !== id) continue;
    const moved = Math.min(remaining, slots[i].count);
    consumeSlot(slots, i, moved);
    remaining -= moved;
  }
  return remaining === 0;
}

function leftClickSlot(slots, index, cursor) {
  const slot = cloneStack(slots[index]);
  if (!cursor.id) {
    slots[index] = emptySlot();
    return slot;
  }
  if (!slot.id) {
    slots[index] = cloneStack(cursor);
    return emptySlot();
  }
  if (slot.id === cursor.id) {
    const max = itemDef(slot.id)?.maxStack ?? MAX_STACK;
    const moved = Math.min(cursor.count, max - slot.count);
    slots[index].count += moved;
    const rest = cloneStack(cursor);
    rest.count -= moved;
    return rest.count > 0 ? rest : emptySlot();
  }
  slots[index] = cloneStack(cursor);
  return slot;
}

function rightClickSlot(slots, index, cursor) {
  const slot = cloneStack(slots[index]);
  if (!cursor.id) {
    if (!slot.id) return emptySlot();
    const taken = Math.ceil(slot.count / 2);
    const left = slot.count - taken;
    slots[index] = left > 0 ? { ...slot, count: left } : emptySlot();
    return { ...slot, count: taken };
  }
  if (!slot.id) {
    slots[index] = { ...cursor, count: 1 };
    return cursor.count > 1 ? { ...cursor, count: cursor.count - 1 } : emptySlot();
  }
  const max = itemDef(slot.id)?.maxStack ?? MAX_STACK;
  if (slot.id !== cursor.id || slot.count >= max) return cloneStack(cursor);
  slots[index].count++;
  return cursor.count > 1 ? { ...cursor, count: cursor.count - 1 } : emptySlot();
}

export function clickSlot(slots, index, cursor, button = 'left') {
  if (index < 0 || index >= slots.length) return cloneStack(cursor);
  return button === 'right'
    ? rightClickSlot(slots, index, cloneStack(cursor))
    : leftClickSlot(slots, index, cloneStack(cursor));
}

export function transferSlot(slots, fromIndex, targetIndices) {
  const source = slots[fromIndex];
  if (!source?.id || source.count <= 0) return 0;
  const targets = targetIndices.filter((index) => index !== fromIndex && index >= 0 && index < slots.length);
  const proxy = targets.map((index) => slots[index]);
  const result = addStack(proxy, source);
  targets.forEach((index, i) => { slots[index] = proxy[i]; });
  if (result.added > 0) consumeSlot(slots, fromIndex, result.added);
  return result.added;
}

// Legacy helpers retained for old callers and saves.
export const emptyHotbar = () => Array(HOTBAR_SIZE).fill(B.AIR);
export const emptyCounts = () => Array(HOTBAR_SIZE).fill(0);

export function addToHotbar(hotbar, counts, blockId, selected = 0) {
  let slot = hotbar.findIndex((id, i) => id === blockId && counts[i] < MAX_STACK);
  if (slot < 0 && hotbar[selected] === B.AIR) slot = selected;
  if (slot < 0) slot = hotbar.findIndex((id) => id === B.AIR);
  if (slot < 0) return -1;
  hotbar[slot] = blockId;
  counts[slot]++;
  return slot;
}

export function consumeHotbarSlot(hotbar, counts, slot) {
  counts[slot] = Math.max(0, counts[slot] - 1);
  if (!counts[slot]) hotbar[slot] = B.AIR;
}
