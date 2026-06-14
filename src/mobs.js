import * as THREE from 'three';
import { B, BLOCKS } from './blocks.js';
import { I, itemDef } from './items.js';
import { VILLAGER_PROFESSIONS } from './villages.js';

const GRAVITY = 18;
const MAX_PASSIVE = 8;
const MAX_HOSTILE = 10;

export const MOB_TYPES = {
  pig: { kind: 'passive', health: 10, speed: 1.65, height: 1.05, color: 0xe7a0a8 },
  sheep: { kind: 'passive', health: 10, speed: 1.5, height: 1.25, color: 0xe8e5dc },
  zombie: { kind: 'hostile', health: 20, speed: 2.25, height: 1.8, color: 0x5d8f4f, damage: 3 },
  skeleton: { kind: 'hostile', health: 16, speed: 2.0, height: 1.8, color: 0xd4d1c5, damage: 2 },
  spider: { kind: 'hostile', health: 14, speed: 3.0, height: 0.75, color: 0x332a2a, damage: 2 },
  creeper: { kind: 'hostile', health: 18, speed: 2.05, height: 1.7, color: 0x58a83e, damage: 8 },
  villager: { kind: 'villager', health: 20, speed: 1.35, height: 1.8, color: 0x8a5b3d },
  zombie_villager: { kind: 'hostile', health: 22, speed: 2.1, height: 1.8, color: 0x4d7a3e, damage: 3 },
};

const isSolid = (world, x, y, z) => BLOCKS[world.getBlock(x, y, z)]?.solid;

export function standHeight(world, x, z, currentY) {
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  const center = Math.floor(currentY);
  for (let by = center + 1; by >= center - 4; by--) {
    if (!isSolid(world, bx, by, bz)) continue;
    if (isSolid(world, bx, by + 1, bz) || isSolid(world, bx, by + 2, bz)) continue;
    return by + 1;
  }
  return null;
}

export function raySphereDistance(origin, direction, center, radius, maxDistance) {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = ox * direction.x + oy * direction.y + oz * direction.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) return null;
  const near = -b - Math.sqrt(discriminant);
  const far = -b + Math.sqrt(discriminant);
  const distance = near >= 0 ? near : far >= 0 ? far : null;
  return distance !== null && distance <= maxDistance ? distance : null;
}

function randomDirection() {
  const angle = Math.random() * Math.PI * 2;
  return { x: Math.cos(angle), z: Math.sin(angle) };
}

export class MobSystem {
  constructor({ scene, world = null }) {
    this.scene = scene;
    this.world = world;
    this.list = [];
    this.projectiles = [];
    this.pendingVillagers = [];
    this.nextId = 1;
    this.spawnTimer = 2;
    this.geometryCache = new Map();
    this.materialCache = new Map();
    this.onPlayerDamage = null;
    this.onDrop = null;
    this.onExplode = null;
  }

  setWorld(world) {
    this.clear();
    this.world = world;
  }

  material(color) {
    let material = this.materialCache.get(color);
    if (!material) {
      material = new THREE.MeshBasicMaterial({ color });
      this.materialCache.set(color, material);
    }
    return material;
  }

  box(width, height, depth) {
    const key = `${width},${height},${depth}`;
    let geometry = this.geometryCache.get(key);
    if (!geometry) {
      geometry = new THREE.BoxGeometry(width, height, depth);
      this.geometryCache.set(key, geometry);
    }
    return geometry;
  }

  part(group, width, height, depth, color, x, y, z) {
    const mesh = new THREE.Mesh(this.box(width, height, depth), this.material(color));
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  }

  makeMesh(type) {
    const def = MOB_TYPES[type];
    const group = new THREE.Group();
    if (type === 'pig') {
      // body
      this.part(group, 1.05, 0.65, 1.35, def.color, 0, 0.68, 0);
      // head
      const head = this.part(group, 0.62, 0.58, 0.58, def.color, 0, 0.78, -0.82);
      // snout (pink)
      this.part(group, 0.32, 0.22, 0.12, 0xf0b0b0, 0, 0.72, -1.15);
      // nostrils
      this.part(group, 0.06, 0.06, 0.02, 0x9f5050, -0.08, 0.72, -1.22);
      this.part(group, 0.06, 0.06, 0.02, 0x9f5050, 0.08, 0.72, -1.22);
      // eyes
      this.part(group, 0.08, 0.08, 0.02, 0x222222, -0.16, 0.86, -1.12);
      this.part(group, 0.08, 0.08, 0.02, 0x222222, 0.16, 0.86, -1.12);
      // ears
      this.part(group, 0.18, 0.14, 0.06, 0xd08888, -0.28, 0.98, -0.78);
      this.part(group, 0.18, 0.14, 0.06, 0xd08888, 0.28, 0.98, -0.78);
      // legs
      for (const [x, z] of [[-0.35, -0.38], [0.35, -0.38], [-0.35, 0.38], [0.35, 0.38]]) {
        this.part(group, 0.2, 0.55, 0.2, 0x9f6267, x, 0.28, z);
      }
      // curly tail
      this.part(group, 0.06, 0.12, 0.06, 0xd09090, 0, 0.88, 0.72);
      this.part(group, 0.06, 0.06, 0.08, 0xd09090, 0, 0.96, 0.70);
    } else if (type === 'sheep') {
      // fluffy wool body (slightly larger)
      this.part(group, 1.15, 0.75, 1.45, 0xf0ede5, 0, 0.72, 0);
      // inner body
      this.part(group, 1.0, 0.60, 1.30, def.color, 0, 0.70, 0);
      // head (darker face)
      this.part(group, 0.52, 0.50, 0.50, 0x8a7a6c, 0, 0.80, -0.86);
      // eyes
      this.part(group, 0.08, 0.08, 0.02, 0x222222, -0.14, 0.88, -1.12);
      this.part(group, 0.08, 0.08, 0.02, 0x222222, 0.14, 0.88, -1.12);
      // ears
      this.part(group, 0.20, 0.10, 0.06, 0x8a7a6c, -0.32, 0.90, -0.80);
      this.part(group, 0.20, 0.10, 0.06, 0x8a7a6c, 0.32, 0.90, -0.80);
      // legs (darker)
      for (const [x, z] of [[-0.35, -0.42], [0.35, -0.42], [-0.35, 0.42], [0.35, 0.42]]) {
        this.part(group, 0.2, 0.55, 0.2, 0x6c625c, x, 0.28, z);
      }
    } else if (type === 'spider') {
      // abdomen
      this.part(group, 0.9, 0.42, 1.15, def.color, 0, 0.42, 0.2);
      // head
      this.part(group, 0.7, 0.5, 0.65, 0x1f1919, 0, 0.48, -0.65);
      // red eyes (multiple pairs)
      for (const [x, ey] of [[-0.18, 0.56], [0.18, 0.56], [-0.10, 0.48], [0.10, 0.48]]) {
        this.part(group, 0.08, 0.08, 0.02, 0xcc2020, x, ey, -0.98);
      }
      // legs with joints
      for (const side of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const upper = this.part(group, 0.52, 0.09, 0.09, 0x211a1a, side * 0.55, 0.38, -0.48 + i * 0.34);
          upper.rotation.z = side * (0.35 + Math.abs(i - 1.5) * 0.12);
          const lower = this.part(group, 0.38, 0.07, 0.07, 0x2a2020, side * 0.82, 0.22, -0.48 + i * 0.34);
          lower.rotation.z = side * (-0.3);
        }
      }
    } else if (type === 'creeper') {
      // body
      this.part(group, 0.55, 0.85, 0.32, def.color, 0, 1.0, 0);
      // head
      this.part(group, 0.52, 0.52, 0.52, def.color, 0, 1.68, 0);
      // face - eyes (dark)
      this.part(group, 0.12, 0.12, 0.02, 0x1a1a1a, -0.14, 1.76, -0.27);
      this.part(group, 0.12, 0.12, 0.02, 0x1a1a1a, 0.14, 1.76, -0.27);
      // face - mouth (frown)
      this.part(group, 0.08, 0.14, 0.02, 0x1a1a1a, 0, 1.58, -0.27);
      this.part(group, 0.06, 0.06, 0.02, 0x1a1a1a, -0.10, 1.56, -0.27);
      this.part(group, 0.06, 0.06, 0.02, 0x1a1a1a, 0.10, 1.56, -0.27);
      // 4 short legs
      this.part(group, 0.22, 0.55, 0.22, def.color, -0.18, 0.28, -0.15);
      this.part(group, 0.22, 0.55, 0.22, def.color, 0.18, 0.28, -0.15);
      this.part(group, 0.22, 0.55, 0.22, def.color, -0.18, 0.28, 0.15);
      this.part(group, 0.22, 0.55, 0.22, def.color, 0.18, 0.28, 0.15);
    } else if (type === 'villager') {
      // robe body
      this.part(group, 0.62, 0.85, 0.32, 0x74472e, 0, 1.0, 0);
      // robe skirt (wider)
      this.part(group, 0.7, 0.55, 0.42, 0x69402b, 0, 0.45, 0);
      // head
      this.part(group, 0.52, 0.52, 0.52, def.color, 0, 1.68, 0);
      // big nose
      this.part(group, 0.16, 0.22, 0.26, 0xb57952, 0, 1.60, -0.38);
      // eyes
      this.part(group, 0.10, 0.08, 0.02, 0x222222, -0.14, 1.74, -0.27);
      this.part(group, 0.10, 0.08, 0.02, 0x222222, 0.14, 1.74, -0.27);
      // eyebrows
      this.part(group, 0.12, 0.04, 0.02, 0x553322, -0.14, 1.80, -0.27);
      this.part(group, 0.12, 0.04, 0.02, 0x553322, 0.14, 1.80, -0.27);
      // arms (crossed in front)
      this.part(group, 0.52, 0.18, 0.22, 0x69402b, 0, 1.08, -0.22);
    } else if (type === 'zombie_villager') {
      // zombie body with villager robe remnants
      this.part(group, 0.55, 0.85, 0.32, 0x4a6a35, 0, 1.0, 0);
      this.part(group, 0.65, 0.45, 0.38, 0x3d5530, 0, 0.45, 0);
      // zombie green head
      this.part(group, 0.52, 0.52, 0.52, 0x5d8f4f, 0, 1.68, 0);
      // villager nose (decayed)
      this.part(group, 0.14, 0.18, 0.22, 0x6a8a4a, 0, 1.60, -0.36);
      // glowing eyes
      this.part(group, 0.10, 0.08, 0.02, 0x44ff44, -0.14, 1.74, -0.27);
      this.part(group, 0.10, 0.08, 0.02, 0x44ff44, 0.14, 1.74, -0.27);
      // outstretched arms
      this.part(group, 0.2, 0.8, 0.2, 0x4a6a35, -0.42, 1.0, 0);
      this.part(group, 0.2, 0.8, 0.2, 0x4a6a35, 0.42, 1.0, 0);
      // legs
      this.part(group, 0.22, 0.8, 0.22, 0x3d5530, -0.18, 0.4, 0);
      this.part(group, 0.22, 0.8, 0.22, 0x3d5530, 0.18, 0.4, 0);
    } else {
      // skeleton, zombie - humanoid
      const bodyColor = type === 'skeleton' ? 0xb8b6ad : def.color;
      this.part(group, 0.55, 0.85, 0.32, bodyColor, 0, 1.0, 0);
      // head
      this.part(group, 0.52, 0.52, 0.52, def.color, 0, 1.68, 0);
      // eyes
      if (type === 'skeleton') {
        this.part(group, 0.10, 0.10, 0.02, 0x1a1a1a, -0.14, 1.72, -0.27);
        this.part(group, 0.10, 0.10, 0.02, 0x1a1a1a, 0.14, 1.72, -0.27);
        // jaw
        this.part(group, 0.36, 0.08, 0.02, 0x9a9890, 0, 1.58, -0.27);
      } else {
        // zombie eyes
        this.part(group, 0.10, 0.08, 0.02, 0x222222, -0.14, 1.74, -0.27);
        this.part(group, 0.10, 0.08, 0.02, 0x222222, 0.14, 1.74, -0.27);
      }
      // arms
      const armOffset = type === 'zombie' ? -0.3 : 0;
      this.part(group, 0.2, 0.8, 0.2, bodyColor, -0.42, 1.0, armOffset);
      this.part(group, 0.2, 0.8, 0.2, bodyColor, 0.42, 1.0, armOffset);
      // legs
      this.part(group, 0.22, 0.8, 0.22, bodyColor, -0.18, 0.4, 0);
      this.part(group, 0.22, 0.8, 0.22, bodyColor, 0.18, 0.4, 0);
    }
    this.scene.add(group);
    return group;
  }

  spawn(type, x, y, z, saved = {}) {
    const def = MOB_TYPES[type];
    if (!def || !this.world?.isLoaded(x, z)) return null;
    const floor = standHeight(this.world, x, z, y);
    if (floor === null) return null;
    const mesh = this.makeMesh(type);
    const mob = {
      id: saved.id || this.nextId++,
      type,
      kind: def.kind,
      mesh,
      pos: new THREE.Vector3(x, floor, z),
      vel: new THREE.Vector3(),
      health: Math.max(1, Number(saved.health) || def.health),
      maxHealth: def.health,
      direction: randomDirection(),
      decisionTimer: Math.random() * 1.5,
      attackCooldown: 0,
      hurtTimer: 0,
      fuse: 0,
      age: 0,
      home: saved.home || null,
      name: saved.name || null,
      profession: saved.profession || null,
    };
    mob.mesh.position.copy(mob.pos);
    mob.mesh.userData.mobId = mob.id;
    this.nextId = Math.max(this.nextId, mob.id + 1);
    this.list.push(mob);
    return mob;
  }

  spawnResidents(residents) {
    for (const resident of residents) this.spawn('villager', resident.x, resident.y, resident.z, resident);
  }

  load(saved) {
    if (!Array.isArray(saved)) return;
    for (const mob of saved) {
      if (mob?.type !== 'villager') continue;
      if (this.world.isLoaded(mob.x, mob.z)) this.spawn(mob.type, mob.x, mob.y, mob.z, mob);
      else this.pendingVillagers.push(mob);
    }
  }

  villagerView(mob) {
    const profession = VILLAGER_PROFESSIONS[mob.profession] || VILLAGER_PROFESSIONS.farmer;
    return {
      id: mob.id,
      name: mob.name || 'Settler',
      profession: profession.name,
      trades: profession.trades.map((trade) => ({
        ...trade,
        label: `${trade.cost.count} ${itemDef(trade.cost.id)?.name || trade.cost.id} -> ` +
          `${trade.result.count} ${itemDef(trade.result.id)?.name || trade.result.id}`,
      })),
    };
  }

  raycast(origin, direction, maxDistance = 4.5, blockDistance = Infinity, predicate = null) {
    let best = null;
    for (const mob of this.list) {
      if (predicate && !predicate(mob)) continue;
      const def = MOB_TYPES[mob.type];
      const center = {
        x: mob.pos.x,
        y: mob.pos.y + def.height * 0.55,
        z: mob.pos.z,
      };
      const distance = raySphereDistance(
        origin,
        direction,
        center,
        mob.type === 'spider' ? 0.72 : 0.62,
        Math.min(maxDistance, blockDistance),
      );
      if (distance !== null && (!best || distance < best.distance)) best = { mob, distance };
    }
    return best;
  }

  damage(mob, amount, source = null, attackerType = null) {
    if (!mob || amount <= 0 || !this.list.includes(mob)) return false;
    mob.health -= amount;
    mob.hurtTimer = 0.25;
    if (source) {
      const dx = mob.pos.x - source.x;
      const dz = mob.pos.z - source.z;
      const length = Math.hypot(dx, dz) || 1;
      mob.vel.x += (dx / length) * 4.5;
      mob.vel.z += (dz / length) * 4.5;
    }
    if (mob.health <= 0) this.kill(mob, attackerType);
    return true;
  }

  kill(mob, killerType = null) {
    if (mob.type === 'pig') this.onDrop?.(mob.pos.x, mob.pos.y + 0.5, mob.pos.z, I.RAW_PORK, 2);
    else if (mob.type === 'sheep') this.onDrop?.(mob.pos.x, mob.pos.y + 0.5, mob.pos.z, I.RAW_MUTTON, 1);
    else if (mob.type === 'skeleton') this.onDrop?.(mob.pos.x, mob.pos.y + 0.5, mob.pos.z, I.STICK, 2);
    else if (mob.kind === 'hostile') this.onDrop?.(mob.pos.x, mob.pos.y + 0.5, mob.pos.z, I.COAL, 1);
    // If a villager was killed by a zombie, convert to zombie villager
    if (mob.type === 'villager' && (killerType === 'zombie' || killerType === 'zombie_villager')) {
      this.spawn('zombie_villager', mob.pos.x, mob.pos.y, mob.pos.z);
    }
    this.removeMob(mob);
  }

  removeMob(mob) {
    const index = this.list.indexOf(mob);
    if (index < 0) return;
    this.scene.remove(mob.mesh);
    this.list.splice(index, 1);
  }

  chooseWander(mob) {
    const home = mob.home;
    if (home) {
      const dx = home.x - mob.pos.x;
      const dz = home.z - mob.pos.z;
      if (dx * dx + dz * dz > 14 * 14) {
        const length = Math.hypot(dx, dz) || 1;
        mob.direction = { x: dx / length, z: dz / length };
        mob.decisionTimer = 2;
        return;
      }
    }
    mob.direction = Math.random() < 0.28 ? { x: 0, z: 0 } : randomDirection();
    mob.decisionTimer = 1.2 + Math.random() * 3.5;
  }

  moveMob(mob, dt, speedScale = 1) {
    const def = MOB_TYPES[mob.type];
    const targetX = mob.direction.x * def.speed * speedScale;
    const targetZ = mob.direction.z * def.speed * speedScale;
    mob.vel.x += (targetX - mob.vel.x) * Math.min(1, dt * 5);
    mob.vel.z += (targetZ - mob.vel.z) * Math.min(1, dt * 5);
    const nx = mob.pos.x + mob.vel.x * dt;
    const nz = mob.pos.z + mob.vel.z * dt;
    const floor = standHeight(this.world, nx, nz, mob.pos.y);
    if (floor !== null && floor - mob.pos.y <= 1.05 && floor - mob.pos.y >= -2.5) {
      mob.pos.x = nx;
      mob.pos.z = nz;
      mob.pos.y += (floor - mob.pos.y) * Math.min(1, dt * 10);
    } else {
      mob.vel.x *= -0.15;
      mob.vel.z *= -0.15;
      mob.direction = randomDirection();
      mob.decisionTimer = 0.5;
    }
    if (Math.hypot(mob.vel.x, mob.vel.z) > 0.08) {
      mob.mesh.rotation.y = Math.atan2(mob.vel.x, mob.vel.z);
    }
    mob.mesh.position.copy(mob.pos);
    const bob = Math.sin(mob.age * 8) * Math.min(0.035, Math.hypot(mob.vel.x, mob.vel.z) * 0.015);
    mob.mesh.position.y += bob;
    mob.mesh.scale.setScalar(mob.hurtTimer > 0 ? 0.94 : 1);
  }

  pursue(mob, player, desiredDistance = 0) {
    const dx = player.pos.x - mob.pos.x;
    const dz = player.pos.z - mob.pos.z;
    const distance = Math.hypot(dx, dz) || 1;
    const sign = desiredDistance && distance < desiredDistance ? -1 : 1;
    mob.direction = { x: (dx / distance) * sign, z: (dz / distance) * sign };
    return distance;
  }

  spawnProjectile(mob, player) {
    const origin = new THREE.Vector3(mob.pos.x, mob.pos.y + 1.35, mob.pos.z);
    const target = new THREE.Vector3(player.pos.x, player.pos.y + 1.1, player.pos.z);
    const velocity = target.sub(origin).normalize().multiplyScalar(11);
    const mesh = new THREE.Mesh(this.box(0.08, 0.08, 0.45), this.material(0x8b7658));
    mesh.position.copy(origin);
    this.scene.add(mesh);
    this.projectiles.push({ mesh, velocity, age: 0, damage: MOB_TYPES[mob.type].damage });
  }

  updateProjectile(index, dt, player) {
    const projectile = this.projectiles[index];
    projectile.age += dt;
    projectile.velocity.y -= GRAVITY * 0.22 * dt;
    projectile.mesh.position.addScaledVector(projectile.velocity, dt);
    projectile.mesh.lookAt(projectile.mesh.position.clone().add(projectile.velocity));
    const p = projectile.mesh.position;
    const dx = player.pos.x - p.x;
    const dy = player.pos.y + 0.9 - p.y;
    const dz = player.pos.z - p.z;
    if (dx * dx + dy * dy + dz * dz < 0.7) {
      this.onPlayerDamage?.(projectile.damage, 'Shot by a skeleton');
      this.removeProjectile(index);
      return;
    }
    if (projectile.age > 6 || BLOCKS[this.world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))]?.solid) {
      this.removeProjectile(index);
    }
  }

  removeProjectile(index) {
    const projectile = this.projectiles[index];
    this.scene.remove(projectile.mesh);
    this.projectiles.splice(index, 1);
  }

  trySpawn(player, night) {
    const kind = night ? 'hostile' : 'passive';
    const count = this.list.filter((mob) => mob.kind === kind).length;
    if (count >= (night ? MAX_HOSTILE : MAX_PASSIVE)) return;
    const angle = Math.random() * Math.PI * 2;
    const distance = 18 + Math.random() * 18;
    const x = Math.floor(player.pos.x + Math.cos(angle) * distance) + 0.5;
    const z = Math.floor(player.pos.z + Math.sin(angle) * distance) + 0.5;
    if (!this.world.isLoaded(x, z)) return;
    const y = this.world.surfaceHeight(x, z) + 1;
    if (y <= 1 || this.world.getBlock(Math.floor(x), y, Math.floor(z)) !== B.AIR) return;
    const types = night ? ['zombie', 'skeleton', 'spider', 'creeper'] : ['pig', 'sheep'];
    this.spawn(types[(Math.random() * types.length) | 0], x, y, z);
  }

  update(dt, player, { night = false, spawning = true, gameMode = 'survival' } = {}) {
    if (!this.world || !player) return;
    for (let i = this.pendingVillagers.length - 1; i >= 0; i--) {
      const saved = this.pendingVillagers[i];
      if (!this.world.isLoaded(saved.x, saved.z)) continue;
      this.pendingVillagers.splice(i, 1);
      this.spawn('villager', saved.x, saved.y, saved.z, saved);
    }
    this.spawnTimer -= dt;
    if (spawning && this.spawnTimer <= 0) {
      this.spawnTimer = night ? 2.5 : 5;
      this.trySpawn(player, night);
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) this.updateProjectile(i, dt, player);

    const isCreative = gameMode === 'creative';

    for (let i = this.list.length - 1; i >= 0; i--) {
      const mob = this.list[i];
      mob.age += dt;
      mob.attackCooldown = Math.max(0, mob.attackCooldown - dt);
      mob.hurtTimer = Math.max(0, mob.hurtTimer - dt);
      mob.decisionTimer -= dt;
      const dx = player.pos.x - mob.pos.x;
      const dy = player.pos.y - mob.pos.y;
      const dz = player.pos.z - mob.pos.z;
      const distance = Math.hypot(dx, dy, dz);

      if (mob.kind === 'villager' && !this.world.isLoaded(mob.pos.x, mob.pos.z)) {
        mob.mesh.visible = false;
        continue;
      }
      mob.mesh.visible = true;

      if (distance > 80 && mob.kind !== 'villager') {
        this.removeMob(mob);
        continue;
      }

      // === Villager AI: flee from zombies ===
      if (mob.kind === 'villager') {
        let nearestZombie = null;
        let nearestZombieDist = 16;
        for (const other of this.list) {
          if (other.type !== 'zombie' && other.type !== 'zombie_villager') continue;
          const zd = Math.hypot(other.pos.x - mob.pos.x, other.pos.z - mob.pos.z);
          if (zd < nearestZombieDist) {
            nearestZombieDist = zd;
            nearestZombie = other;
          }
        }
        if (nearestZombie && nearestZombieDist < 14) {
          // Flee from zombie (opposite direction)
          const fdx = mob.pos.x - nearestZombie.pos.x;
          const fdz = mob.pos.z - nearestZombie.pos.z;
          const fl = Math.hypot(fdx, fdz) || 1;
          mob.direction = { x: fdx / fl, z: fdz / fl };
          this.moveMob(mob, dt, 1.6); // run faster when fleeing
          continue;
        } else if (mob.decisionTimer <= 0) {
          this.chooseWander(mob);
        }
        this.moveMob(mob, dt, 1);
        continue;
      }

      // === Hostile AI ===
      if (mob.kind === 'hostile') {
        // Find nearest villager target for zombies
        let villagerTarget = null;
        let villagerDist = Infinity;
        if (mob.type === 'zombie' || mob.type === 'zombie_villager') {
          for (const other of this.list) {
            if (other.kind !== 'villager') continue;
            const vd = Math.hypot(other.pos.x - mob.pos.x, other.pos.z - mob.pos.z);
            if (vd < 20 && vd < villagerDist) {
              villagerDist = vd;
              villagerTarget = other;
            }
          }
        }

        // Decide target: player or villager (pick closer one, but creative players are invisible)
        const playerVisible = !isCreative && distance < 24;
        const preferVillager = villagerTarget && (!playerVisible || villagerDist < distance);

        if (preferVillager) {
          // Chase villager
          const vdx = villagerTarget.pos.x - mob.pos.x;
          const vdz = villagerTarget.pos.z - mob.pos.z;
          const vl = Math.hypot(vdx, vdz) || 1;
          mob.direction = { x: vdx / vl, z: vdz / vl };
          if (villagerDist < 1.55 && mob.attackCooldown <= 0) {
            this.damage(villagerTarget, MOB_TYPES[mob.type].damage, mob.pos, mob.type);
            mob.attackCooldown = 1.15;
          }
        } else if (playerVisible) {
          if (mob.type === 'skeleton') {
            this.pursue(mob, player, 7);
            if (distance < 14 && mob.attackCooldown <= 0) {
              this.spawnProjectile(mob, player);
              mob.attackCooldown = 2.1;
            }
          } else {
            const horizontal = this.pursue(mob, player);
            if (mob.type === 'creeper') {
              mob.fuse = horizontal < 2.6 ? mob.fuse + dt : Math.max(0, mob.fuse - dt * 1.8);
              if (mob.fuse >= 1.45) {
                const position = mob.pos.clone();
                this.removeMob(mob);
                this.onExplode?.(position.x, position.y + 0.6, position.z, 3.2);
                continue;
              }
            } else if (distance < 1.55 && mob.attackCooldown <= 0) {
              this.onPlayerDamage?.(
                MOB_TYPES[mob.type].damage,
                mob.type === 'spider' ? 'Slain by a spider' : `Slain by a ${mob.type.replace('_', ' ')}`,
              );
              mob.attackCooldown = mob.type === 'spider' ? 0.85 : 1.15;
            }
          }
        } else if (mob.decisionTimer <= 0) {
          this.chooseWander(mob);
        }
      } else if (mob.decisionTimer <= 0) {
        this.chooseWander(mob);
      }

      this.moveMob(mob, dt, mob.type === 'spider' ? 1.12 : 1);
    }
  }

  serialize() {
    return [
      ...this.list
      .filter((mob) => mob.type === 'villager')
      .map((mob) => ({
        id: mob.id,
        type: mob.type,
        x: mob.pos.x,
        y: mob.pos.y,
        z: mob.pos.z,
        health: mob.health,
        home: mob.home,
        name: mob.name,
        profession: mob.profession,
      })),
      ...this.pendingVillagers,
    ];
  }

  clear() {
    for (const mob of this.list) this.scene.remove(mob.mesh);
    for (const projectile of this.projectiles) this.scene.remove(projectile.mesh);
    this.list = [];
    this.projectiles = [];
    this.pendingVillagers = [];
  }
}
