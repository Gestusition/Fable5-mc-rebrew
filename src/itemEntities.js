import * as THREE from 'three';
import { B, BLOCKS } from './blocks.js';
import { blockForItem, itemDef } from './items.js';
import { buildBlockGeometry } from './mesher.js';

const GRAVITY = 18;
const DESPAWN_SECONDS = 300;

export class ItemEntities {
  constructor({ scene, world, blockMaterial }) {
    this.scene = scene;
    this.world = world;
    this.blockMaterial = blockMaterial;
    this.list = [];
    this.geometryCache = new Map();
  }

  setWorld(world) {
    this.world = world;
    this.clear();
  }

  makeMesh(itemId) {
    const def = itemDef(itemId);
    if (!def) return null;
    const blockId = blockForItem(itemId);
    let geometry;
    let material;
    if (blockId !== null) {
      geometry = this.geometryCache.get(blockId);
      if (!geometry) {
        geometry = buildBlockGeometry(blockId);
        this.geometryCache.set(blockId, geometry);
      }
      material = this.blockMaterial;
    } else {
      geometry = new THREE.BoxGeometry(0.5, 0.12, 0.5);
      material = new THREE.MeshBasicMaterial({ color: def.icon.color || '#cccccc' });
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(blockId !== null ? 0.28 : 0.7);
    this.scene.add(mesh);
    return mesh;
  }

  spawn(x, y, z, itemId, count = 1, velocity = null, metadata = null) {
    if (!itemDef(itemId) || count <= 0) return;
    if (this.list.length >= 160) this.despawn(0);
    const mesh = this.makeMesh(itemId);
    if (!mesh) return;
    mesh.position.set(x, y, z);
    this.list.push({
      itemId,
      count,
      durability: Number.isFinite(metadata?.durability) ? metadata.durability : undefined,
      mesh,
      age: 0,
      pickupDelay: 0.45,
      vy: velocity?.y ?? 2.4,
      vx: velocity?.x ?? (Math.random() - 0.5) * 1.4,
      vz: velocity?.z ?? (Math.random() - 0.5) * 1.4,
    });
  }

  update(dt, player, tryPickup) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      e.age += dt;
      e.pickupDelay -= dt;
      if (e.age >= DESPAWN_SECONDS || e.mesh.position.y < -12) {
        this.despawn(i);
        continue;
      }

      e.vy -= GRAVITY * dt;
      e.mesh.position.x += e.vx * dt;
      e.mesh.position.y += e.vy * dt;
      e.mesh.position.z += e.vz * dt;
      e.vx *= Math.max(0, 1 - dt * 2.2);
      e.vz *= Math.max(0, 1 - dt * 2.2);

      const bx = Math.floor(e.mesh.position.x);
      const bz = Math.floor(e.mesh.position.z);
      const floorY = Math.floor(e.mesh.position.y - 0.12);
      const below = this.world.getBlock(bx, floorY, bz);
      if (below !== B.AIR && BLOCKS[below]?.solid && e.mesh.position.y < floorY + 1.18) {
        e.mesh.position.y = floorY + 1.18;
        e.vy = Math.max(0, e.vy) * 0.2;
      }

      e.mesh.rotation.y += dt * 1.8;
      e.mesh.position.y += Math.sin(e.age * 3.2) * dt * 0.025;

      if (player && e.pickupDelay <= 0) {
        const dx = player.pos.x - e.mesh.position.x;
        const dy = player.pos.y + 0.8 - e.mesh.position.y;
        const dz = player.pos.z - e.mesh.position.z;
        if (dx * dx + dy * dy + dz * dz < 1.8) {
          const remaining = tryPickup({
            id: e.itemId,
            count: e.count,
            ...(Number.isFinite(e.durability) ? { durability: e.durability } : {}),
          });
          if (remaining <= 0) this.despawn(i);
          else e.count = remaining;
        }
      }
    }
  }

  serialize() {
    return this.list.map((e) => ({
      itemId: e.itemId,
      count: e.count,
      ...(Number.isFinite(e.durability) ? { durability: e.durability } : {}),
      x: e.mesh.position.x,
      y: e.mesh.position.y,
      z: e.mesh.position.z,
      age: e.age,
    }));
  }

  load(list) {
    if (!Array.isArray(list)) return;
    for (const saved of list) {
      this.spawn(
        saved.x,
        saved.y,
        saved.z,
        saved.itemId,
        saved.count,
        { x: 0, y: 0, z: 0 },
        saved,
      );
      const e = this.list[this.list.length - 1];
      if (e) {
        e.age = Math.max(0, Number(saved.age) || 0);
        e.pickupDelay = 0;
      }
    }
  }

  despawn(index) {
    const e = this.list[index];
    if (!e) return;
    this.scene.remove(e.mesh);
    if (e.mesh.material !== this.blockMaterial) e.mesh.material.dispose();
    this.list.splice(index, 1);
  }

  clear() {
    for (let i = this.list.length - 1; i >= 0; i--) this.despawn(i);
  }
}
