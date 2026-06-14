import { B } from './blocks.js';
import { I, canHarvestBlock, itemForBlock } from './items.js';

export function getBlockDrops(blockId, toolItemId = null, random = Math.random) {
  if (typeof toolItemId === 'function') {
    random = toolItemId;
    toolItemId = null;
  }
  if (!canHarvestBlock(toolItemId, blockId)) return [];
  switch (blockId) {
    case B.AIR:
    case B.BEDROCK:
    case B.WATER:
    case B.LAVA:
      return [];
    case B.DOOR_CLOSED:
    case B.DOOR_OPEN:
      return [{ id: I.DOOR, count: 1 }];
    case B.BED:
      return [{ id: I.BED, count: 1 }];
    case B.GRASS:
    case B.SNOW_GRASS:
      return [{ id: I.DIRT, count: 1 }];
    case B.STONE:
      return [{ id: I.COBBLE, count: 1 }];
    case B.COAL_ORE:
      return [{ id: I.COAL, count: 1 }];
    case B.IRON_ORE:
      return [{ id: I.IRON_ORE, count: 1 }];
    case B.LEAVES:
    case B.SPRUCE_LEAVES: {
      if (random() < 0.12) return [{ id: I.APPLE, count: 1 }];
      if (random() < 0.28) return [{ id: I.STICK, count: 1 }];
      return [];
    }
    case B.TALLGRASS:
      return random() < 0.2 ? [{ id: I.STICK, count: 1 }] : [];
    default: {
      const id = itemForBlock(blockId);
      return id ? [{ id, count: 1 }] : [];
    }
  }
}
