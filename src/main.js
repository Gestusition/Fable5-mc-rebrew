// ============================================================
// Main — bootstraps the renderer, owns the game state machine
// (title → loading → playing ⇄ paused), wires input, mining /
// placing with crack overlay & block outline, the first-person
// held block, support/gravity checks, saving to localStorage,
// the F3 debug screen and the render loop.
// ============================================================

import * as THREE from 'three';
import {
  buildAtlasCanvas, buildCrackCanvases, buildWaterCanvas, tileIconCanvas,
} from './textures.js';
import { B, BLOCKS, PALETTE, DEFAULT_HOTBAR } from './blocks.js';
import { CHUNK, WORLD_H, BIOME_NAMES } from './worldgen.js';
import { World } from './world.js';
import { Player, fallDamageForDistance, raycastVoxel } from './player.js';
import { buildBlockGeometry } from './mesher.js';
import { Sky } from './sky.js';
import { Particles } from './particles.js';
import { AudioFX } from './audio.js';
import { Entities } from './entities.js';
import { ItemEntities } from './itemEntities.js';
import { UI } from './ui.js';
import { hashString } from './noise.js';
import {
  HOTBAR_SIZE, addStack, capacityForItem, clickSlot, consumeSlot, countItem, emptyInventory,
  emptySlot, loadInventory, removeItem, transferSlot,
} from './inventory.js';
import {
  I, ITEMS, blockForItem, canHarvestBlock, damageTool, isToolEffective, itemDef,
  itemForBlock, miningSpeedFor,
} from './items.js';
import { getBlockDrops } from './drops.js';
import { craftOutput, takeCraftOutput, takeCraftOutputToInventory } from './crafting.js';
import {
  MAX_HUNGER, addExhaustion, createHunger, eatFood, tickHunger,
} from './hunger.js';
import { createSmelter, isFuelItem, smeltRecipeFor } from './smelting.js';
import { BlockEntities } from './blockEntities.js';
import { MobSystem } from './mobs.js';
import { VillageSystem } from './villages.js';

const SETTINGS_KEY = 'mcjs:settings';
const WORLDS_LIST_KEY = 'mcjs:worlds';
const OLD_WORLD_KEY = 'mcjs:world';
const REACH = 5;
const SPRINT_DOUBLE_TAP_MS = 350;

const DEFAULT_SETTINGS = {
  render: 7, fov: 70, sens: 100, vol: 70,
  bob: true, clouds: true, music: true, smooth: true,
};

const loadJSON = (k) => {
  try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
};
const saveJSON = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ }
};

function creativeInventory() {
  const inventory = emptyInventory();
  DEFAULT_HOTBAR.forEach((blockId, i) => {
    const id = itemForBlock(blockId);
    if (id) inventory[i] = { id, count: 1 };
  });
  return inventory;
}

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.settings = { ...DEFAULT_SETTINGS, ...(loadJSON(SETTINGS_KEY) || {}) };
    
    this.worldsList = loadJSON(WORLDS_LIST_KEY) || [];
    // Migration for older saves
    if (this.worldsList.length === 0) {
      const oldSave = loadJSON(OLD_WORLD_KEY);
      if (oldSave) {
        const id = Date.now().toString();
        this.worldsList.push({
          id,
          name: 'My World',
          seed: oldSave.seed,
          gameMode: oldSave.gameMode || 'survival',
          lastPlayed: Date.now()
        });
        saveJSON(WORLDS_LIST_KEY, this.worldsList);
        saveJSON(`mcjs:world:${id}`, oldSave);
      }
    }
    
    this.saveData = null;
    this.currentWorldId = null;

    // ---------- UI ----------
    this.ui = new UI({
      onPlay: (worldId) => this.play(worldId),
      onDeleteWorld: (worldId) => this.deleteWorld(worldId),
      onNewWorld: (name, seedStr) => this.newWorld(name, seedStr),
      onResume: () => this.resume(),
      onQuit: () => this.quitToTitle(),
      onSetting: (k, v) => this.applySetting(k, v),
      getSettings: () => this.settings,
      onPickBlock: (id) => this.assignBlock(id),
      onHotbarSelect: (i) => { this.selectSlot(i); },
      onInventorySlot: (i, action) => this.clickInventorySlot(i, action),
      onCraftSlot: (i, action) => this.clickCraftSlot(i, action),
      onCraftOutput: (action) => this.clickCraftOutput(action),
      onSmeltSlot: (slot, action) => this.clickSmeltSlot(slot, action),
      onTrade: (index) => this.performTrade(index),
      onWorldSelect: (worldId) => this.selectWorld(worldId),
      onToggleMode: () => this.toggleGameMode(),
      onRespawn: () => this.respawn(),
      onDeathQuit: () => this.quitAfterDeath(),
      onUiClick: () => { this.audio.ensure(); this.audio.click(); },
    });

    // Pass worlds list to UI
    this.ui.setWorldsList(this.worldsList);

    // ---------- renderer ----------
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas, antialias: false, powerPreference: 'high-performance',
      });
    } catch (e) {
      this.ui.showWebglError();
      throw e;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.autoClear = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.1, 1500);
    this.camera.rotation.order = 'YXZ';
    this.fovCurrent = this.settings.fov;

    // global light uniforms shared by every world material
    this.uniforms = { uDayLight: { value: 1 }, uMinLight: { value: 0.05 } };

    // ---------- textures & materials ----------
    const atlasTex = new THREE.CanvasTexture(buildAtlasCanvas());
    atlasTex.magFilter = THREE.NearestFilter;
    atlasTex.minFilter = THREE.NearestFilter;
    atlasTex.generateMipmaps = false;
    atlasTex.colorSpace = THREE.SRGBColorSpace;
    this.atlasTex = atlasTex;

    const waterTex = new THREE.CanvasTexture(buildWaterCanvas());
    waterTex.magFilter = THREE.NearestFilter;
    waterTex.minFilter = THREE.NearestFilter;
    waterTex.generateMipmaps = false;
    waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
    waterTex.colorSpace = THREE.SRGBColorSpace;
    this.waterTex = waterTex;

    this.materials = {
      solid: this.makeWorldMaterial({ map: atlasTex, alphaTest: 0.5 }),
      water: this.makeWorldMaterial({
        map: waterTex, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide,
      }),
      lava: this.makeWorldMaterial({
        map: atlasTex, alphaTest: 0.5,
      }),
    };

    // ---------- target outline + crack overlay ----------
    this.outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.75 }),
    );
    this.outline.visible = false;
    this.scene.add(this.outline);

    this.crackTextures = buildCrackCanvases().map((c) => {
      const t = new THREE.CanvasTexture(c);
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      return t;
    });
    this.crackMat = new THREE.MeshBasicMaterial({
      map: this.crackTextures[0], transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.004, 1.004, 1.004), this.crackMat);
    this.crack.visible = false;
    this.scene.add(this.crack);

    // ---------- subsystems ----------
    this.audio = new AudioFX();
    this.audio.setVolume(this.settings.vol / 100);
    this.audio.setMusicOn(this.settings.music);

    this.sky = new Sky(this.scene, this.uniforms);
    this.sky.setViewDistance(this.settings.render);
    this.sky.setCloudsVisible(this.settings.clouds);

    this.particles = new Particles(this.scene, this.materials.solid);
    this.entities = new Entities({
      scene: this.scene, world: null, particles: this.particles,
      audio: this.audio, material: this.materials.solid,
    });
    this.entities.getPlayer = () => this.player;
    this.entities.onExplosion = (x, y, z) => {
      this.shakeT = Math.max(this.shakeT, 0.45);
      const d = this.player.pos.distanceTo(new THREE.Vector3(x, y, z));
      if (d < 7) {
        this.ui.flashDamage();
        this.damage(Math.max(1, Math.ceil((7 - d) * 2.2)), 'Caught in an explosion');
      }
    };
    this.itemEntities = new ItemEntities({
      scene: this.scene,
      world: null,
      blockMaterial: this.materials.solid,
    });
    this.mobs = new MobSystem({ scene: this.scene });
    this.mobs.onPlayerDamage = (amount, message) => this.damage(amount, message);
    this.mobs.onDrop = (x, y, z, id, count) => {
      this.itemEntities.spawn(x, y, z, id, count);
    };
    this.mobs.onExplode = (x, y, z, radius) => this.entities.explode(x, y, z, radius);

    // ---------- held block (separate pass over the world) ----------
    this.handScene = new THREE.Scene();
    this.handCamera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.01, 10);
    this.handGroup = new THREE.Group();
    this.handScene.add(this.handGroup);
    this.heldMesh = null;
    this.heldGeoCache = new Map();
    this.swingT = 1;  // 1 = idle
    this.dipT = 1;

    // ---------- inventory state ----------
    this.gameMode = 'survival';
    this.inventory = emptyInventory();
    this.craftingGrid = Array.from({ length: 4 }, emptySlot);
    this.tableCraftingGrid = Array.from({ length: 9 }, emptySlot);
    this.inventoryCursor = emptySlot();
    this.blockEntities = new BlockEntities();
    this.legacySmelter = null;
    this.containerMode = 'inventory';
    this.activeBlock = null;
    this.activeVillager = null;
    this.selected = 0;
    this.maxHealth = 20;
    this.health = this.maxHealth;
    this.hungerState = createHunger();

    // ---------- icons ----------
    this.icons = this.makeIcons();
    this.ui.setIcons(this.icons);
    this.refreshHotbar();
    this.ui.setGameMode(this.gameMode);

    // ---------- game state ----------
    this.state = 'title';
    this.pickerOpen = false;
    this.locked = false;
    this.keys = new Set();
    this.sprintLatch = false;
    this.lastW = 0;
    this.lastSpace = 0;
    this.mining = false;
    this.miningCell = null;
    this.miningProgress = 0;
    this.placeTimer = 0;
    this.rmbHeld = false;
    this.mobAttackCooldown = 0;
    this.shakeT = 0;
    this.debugVisible = false;
    this.debugTimer = 0;
    this.autosaveTimer = 0;
    this.titleAngle = Math.random() * Math.PI * 2;
    this.fps = 0;
    this.fpsAccum = 0;
    this.fpsFrames = 0;
    this.lastDrawInfo = { calls: 0, triangles: 0 };

    const seed = (Math.random() * 0xffffffff) >>> 0;
    this.createWorld(seed, null, null, null);
    this.ui.setSeedPlaceholder(this.worldSeed);

    this.bindInput();
    
    this.lastT = performance.now();
    this._rafPending = false;
    this.scheduleFrame();
    // RAF is suspended in hidden/occluded tabs; this watchdog keeps the
    // simulation (loading, autosave, time of day) ticking at ~10 Hz there.
    setInterval(() => {
      if (performance.now() - this.lastT > 350) this.frame(performance.now());
    }, 100);
  }

  scheduleFrame() {
    if (this._rafPending) return;
    this._rafPending = true;
    requestAnimationFrame((t) => { this._rafPending = false; this.frame(t); });
  }

  // ============================================================
  // Materials (day/night + torch light shader injection)
  // ============================================================

  makeWorldMaterial(params) {
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, ...params });
    const uniforms = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uDayLight = uniforms.uDayLight;
      shader.uniforms.uMinLight = uniforms.uMinLight;
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          'uniform float uDayLight;\nuniform float uMinLight;\n#include <common>',
        )
        .replace(
          '#include <color_fragment>',
          `#if defined( USE_COLOR )
            vec3 mcLight = max(vec3(vColor.r * uDayLight), vec3(1.0, 0.82, 0.55) * vColor.g);
            mcLight = max(mcLight, vec3(uMinLight));
            diffuseColor.rgb *= mcLight;
          #endif`,
        );
    };
    mat.customProgramCacheKey = () => 'mc-world-light';
    return mat;
  }

  // ============================================================
  // World / player lifecycle
  // ============================================================

  createWorld(seed, edits, savedPlayer, droppedItems = null) {
    if (this.world) {
      this.world.dispose();
      this.entities.clear();
      this.itemEntities.clear();
      this.mobs.clear();
    }
    this.worldSeed = seed >>> 0;
    this.world = new World({
      seed: this.worldSeed,
      scene: this.scene,
      materials: this.materials,
      viewRadius: this.settings.render,
      smoothLighting: this.settings.smooth,
    });
    if (edits) this.world.loadEdits(edits);
    this.entities.setWorld(this.world);
    this.itemEntities.setWorld(this.world);
    this.itemEntities.load(droppedItems);
    this.mobs.setWorld(this.world);

    this.player = new Player(this.world);
    this.spawn = this.saveData?.spawn
      ? { x: this.saveData.spawn.x, y: this.saveData.spawn.y, z: this.saveData.spawn.z }
      : this.world.gen.findSpawn();
    this.village = new VillageSystem(this.worldSeed, this.saveData?.village);
    this.pendingSavedMobs = this.saveData?.mobs || null;
    this.usedSavedPos = false;
    this.spawnLandingProtected = !savedPlayer;
    this.health = this.gameMode === 'survival' && savedPlayer?.health > 0
      ? Math.min(this.maxHealth, savedPlayer.health)
      : this.maxHealth;
    if (savedPlayer) {
      this.player.teleport(savedPlayer.x, savedPlayer.y, savedPlayer.z);
      this.player.yaw = savedPlayer.yaw || 0;
      this.player.pitch = savedPlayer.pitch || 0;
      this.player.flying = this.gameMode === 'creative' && !!savedPlayer.flying;
      this.usedSavedPos = true;
    } else {
      this.player.teleport(this.spawn.x, this.spawn.y + 1, this.spawn.z);
    }
    this.ui.updateHealth(this.health, this.maxHealth, this.gameMode === 'survival');
    this.ui.updateHunger(this.hungerState.hunger, MAX_HUNGER, this.gameMode === 'survival');
    this.sky.setTimeOfDay(this.saveData?.time ?? 0.1); // fresh worlds start mid-morning
  }

  parseSeed(str) {
    if (!str) return (Math.random() * 0xffffffff) >>> 0;
    if (/^-?\d+$/.test(str)) return Number(str) >>> 0;
    return hashString(str);
  }

  // ============================================================
  // State machine
  // ============================================================

  play(worldId) {
    if (!worldId) return;
    this.audio.ensure();
    this.ui.hideAllMenus();
    this.ui.show('loading');
    this.state = 'loading';
    this.lockPointer();
    
    // Load world data
    this.currentWorldId = worldId;
    this.saveData = loadJSON(`mcjs:world:${worldId}`) || {};
    const worldMeta = this.worldsList.find(w => w.id === worldId);
    if (worldMeta) {
      const savedMode = worldMeta.gameMode || 'survival';
      const targetMode = this.gameMode;
      worldMeta.gameMode = targetMode;
      worldMeta.lastPlayed = Date.now();
      this.worldsList.sort((a, b) => b.lastPlayed - a.lastPlayed);
      saveJSON(WORLDS_LIST_KEY, this.worldsList);
      this.ui.setWorldsList(this.worldsList);
      this.ui.$('world-select').value = worldId;
      this.ui.setGameMode(this.gameMode);
      
      if (savedMode !== targetMode) {
        if (targetMode === 'creative') {
          this.saveData.inventory = creativeInventory();
        } else {
          this.saveData.inventory = emptyInventory();
          if (this.saveData.player) this.saveData.player.flying = false;
        }
        this.saveData.gameMode = targetMode;
      }
      
      this.inventory = this.saveData.inventory || (this.gameMode === 'survival' ? emptyInventory() : creativeInventory());
      this.craftingGrid = this.saveData.craftingGrid || Array.from({ length: 4 }, emptySlot);
      this.tableCraftingGrid = this.saveData.tableCraftingGrid || Array.from({ length: 9 }, emptySlot);
      this.inventoryCursor = this.saveData.inventoryCursor || emptySlot();
      this.blockEntities = new BlockEntities(this.saveData.blockEntities);
      this.legacySmelter = this.saveData.smelter || null;
      this.hungerState = createHunger(this.saveData.hunger);
      this.selected = this.saveData.selected || 0;
      this.refreshHotbar();
      this.createWorld(worldMeta.seed, this.saveData.edits, this.saveData.player, this.saveData.droppedItems);
    }
  }

  deleteWorld(worldId) {
    if (!worldId) return;
    this.worldsList = this.worldsList.filter(w => w.id !== worldId);
    saveJSON(WORLDS_LIST_KEY, this.worldsList);
    localStorage.removeItem(`mcjs:world:${worldId}`);
    this.ui.setWorldsList(this.worldsList);
  }

  newWorld(name, seedStr) {
    const seed = this.parseSeed(seedStr);
    
    // Create new world metadata
    this.currentWorldId = Date.now().toString();
    this.worldsList.unshift({
      id: this.currentWorldId,
      name: name,
      seed: seed,
      gameMode: this.gameMode,
      lastPlayed: Date.now()
    });
    saveJSON(WORLDS_LIST_KEY, this.worldsList);
    this.ui.setWorldsList(this.worldsList);
    
    this.saveData = null;
    this.inventory = this.gameMode === 'survival' ? emptyInventory() : creativeInventory();
    this.craftingGrid = Array.from({ length: 4 }, emptySlot);
    this.tableCraftingGrid = Array.from({ length: 9 }, emptySlot);
    this.inventoryCursor = emptySlot();
    this.blockEntities = new BlockEntities();
    this.legacySmelter = null;
    this.hungerState = createHunger();
    this.selected = 0;
    this.refreshHotbar();
    this.createWorld(seed, null, null);
    this.ui.setSeedPlaceholder(this.worldSeed);
    this.play(this.currentWorldId);
  }
  selectWorld(id) {
    const worldMeta = this.worldsList.find(w => w.id === id);
    if (worldMeta) {
      this.gameMode = worldMeta.gameMode || 'survival';
      this.ui.setGameMode(this.gameMode);
    }
  }

  toggleGameMode() {
    this.gameMode = this.gameMode === 'survival' ? 'creative' : 'survival';
    if (this.gameMode === 'survival') {
      if (this.player) this.player.flying = false;
      this.health = this.maxHealth;
      this.inventory = emptyInventory();
      this.hungerState = createHunger();
    } else {
      this.inventory = creativeInventory();
    }
    this.craftingGrid = Array.from({ length: 4 }, emptySlot);
    this.tableCraftingGrid = Array.from({ length: 9 }, emptySlot);
    this.inventoryCursor = emptySlot();
    this.blockEntities = new BlockEntities();
    this.legacySmelter = null;
    this.selected = 0;
    this.ui.setGameMode(this.gameMode);
    this.ui.updateHealth(this.health, this.maxHealth, this.gameMode === 'survival');
    this.ui.updateHunger(this.hungerState.hunger, MAX_HUNGER, this.gameMode === 'survival');
    this.refreshHotbar();

    if (this.state === 'title') {
      const selectVal = this.ui.$('world-select').value;
      if (selectVal) {
        const worldMeta = this.worldsList.find(w => w.id === selectVal);
        if (worldMeta) {
          worldMeta.gameMode = this.gameMode;
          this.saveWorldsList();
          this.ui.setWorldsList(this.worldsList);
          this.ui.$('world-select').value = selectVal;
        }
      }
    } else if (this.state === 'paused' || this.state === 'playing') {
      const worldMeta = this.worldsList.find(w => w.id === this.currentWorldId);
      if (worldMeta) {
        worldMeta.gameMode = this.gameMode;
        this.saveWorldsList();
      }
    }
  }

  finishLoading() {
    if (!this.usedSavedPos) {
      // snap to the real surface (caves may have carved under the estimate)
      const bx = Math.floor(this.player.pos.x), bz = Math.floor(this.player.pos.z);
      let y = WORLD_H - 2;
      while (y > 1 && !BLOCKS[this.world.getBlock(bx, y, bz)].solid) y--;
      this.player.teleport(bx + 0.5, y + 1, bz + 0.5);
      this.spawnLandingProtected = true;
    }
    this.recoverLegacySmelter();
    if (this.pendingSavedMobs) {
      this.mobs.load(this.pendingSavedMobs);
      this.pendingSavedMobs = null;
    }
    this.state = 'playing';
    this.ui.hideAllMenus();
    this.ui.show('hud');
    this.refreshHotbar();
    this.ui.updateHealth(this.health, this.maxHealth, this.gameMode === 'survival');
    this.ui.updateHunger(this.hungerState.hunger, MAX_HUNGER, this.gameMode === 'survival');
  }

  recoverLegacySmelter() {
    if (!this.legacySmelter || this.gameMode !== 'survival') {
      this.legacySmelter = null;
      return;
    }
    const legacy = createSmelter(this.legacySmelter);
    for (const slot of [legacy.input, legacy.fuel, legacy.output]) {
      if (!slot.id || slot.count <= 0) continue;
      const result = addStack(this.inventory, slot, this.selected);
      if (result.remaining > 0) {
        this.itemEntities.spawn(
          this.player.pos.x,
          this.player.pos.y + 1,
          this.player.pos.z,
          slot.id,
          result.remaining,
          null,
          slot,
        );
      }
    }
    this.legacySmelter = null;
    this.refreshHotbar();
    this.ui.showToast('Old smelter contents moved to inventory');
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.mining = false;
    this.rmbHeld = false;
    this.ui.show('pause');
  }

  resume() {
    this.ui.hideAllMenus();
    if (this.pickerOpen) this.closePicker(false);
    this.state = 'playing';
    this.lockPointer();
  }

  quitToTitle() {
    this.saveWorld();
    this.state = 'title';
    this.pickerOpen = false;
    this.ui.hideAllMenus();
    this.ui.hide('hud');
    this.ui.setWorldsList(this.worldsList);
    this.ui.show('title');
    document.exitPointerLock?.();
  }

  damage(amount, message) {
    if (this.gameMode !== 'survival' || this.state !== 'playing' || amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.ui.updateHealth(this.health, this.maxHealth, true);
    this.ui.flashDamage();
    if (this.health <= 0) this.die(message);
  }

  die(message) {
    if (this.pickerOpen) this.closePicker(false);
    this.state = 'dead';
    this.mining = false;
    this.rmbHeld = false;
    this.keys.clear();
    this.sprintLatch = false;
    this.player.flying = false;
    this.ui.showDeath(message);
    document.exitPointerLock?.();
  }

  respawn() {
    this.health = this.maxHealth;
    this.hungerState = createHunger();
    this.usedSavedPos = false;
    this.spawnLandingProtected = true;
    this.player.teleport(this.spawn.x, this.spawn.y + 2, this.spawn.z);
    this.ui.updateHealth(this.health, this.maxHealth, true);
    this.ui.updateHunger(this.hungerState.hunger, MAX_HUNGER, true);
    this.ui.hideAllMenus();
    this.ui.show('loading');
    this.state = 'loading';
    this.lockPointer();
  }

  quitAfterDeath() {
    this.health = this.maxHealth;
    this.hungerState = createHunger();
    this.player.teleport(this.spawn.x, this.spawn.y + 2, this.spawn.z);
    this.quitToTitle();
  }

  // ============================================================
  // Persistence
  // ============================================================

  saveWorld() {
    if (!this.world || !this.currentWorldId) return;
    this.saveData = {
      seed: this.worldSeed,
      gameMode: this.gameMode,
      time: this.sky.timeOfDay,
      player: {
        x: this.player.pos.x,
        y: this.player.pos.y,
        z: this.player.pos.z,
        yaw: this.player.yaw,
        pitch: this.player.pitch,
        health: this.health,
        flying: this.player.flying,
      },
      spawn: this.spawn,
      hunger: this.hungerState,
      edits: this.world.serializeEdits(),
      inventory: this.inventory,
      selected: this.selected,
      craftingGrid: this.craftingGrid,
      tableCraftingGrid: this.tableCraftingGrid,
      inventoryCursor: this.inventoryCursor,
      blockEntities: this.blockEntities.serialize(),
      droppedItems: this.itemEntities.serialize(),
      mobs: this.mobs.serialize(),
      village: this.village?.serialize(),
    };
    saveJSON(`mcjs:world:${this.currentWorldId}`, this.saveData);
  }

  applySetting(key, value) {
    this.settings[key] = value;
    saveJSON(SETTINGS_KEY, this.settings);
    switch (key) {
      case 'render':
        this.world.viewRadius = value;
        this.sky.setViewDistance(value);
        break;
      case 'fov': break; // applied smoothly each frame
      case 'vol': this.audio.setVolume(value / 100); break;
      case 'music': this.audio.setMusicOn(value); break;
      case 'clouds': this.sky.setCloudsVisible(value); break;
      case 'smooth':
        this.world.smoothLighting = value;
        this.world.remeshAll();
        break;
    }
  }

  // ============================================================
  // Input
  // ============================================================

  lockPointer() {
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p?.catch) {
        p.catch(() => {
          const fallback = this.canvas.requestPointerLock();
          fallback?.catch?.(() => {});
        });
      }
    } catch {
      const fallback = this.canvas.requestPointerLock();
      fallback?.catch?.(() => {});
    }
  }

  bindInput() {
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.mining = false;
        this.rmbHeld = false;
        if (this.state === 'playing' && !this.pickerOpen) this.pause();
      }
    });

    window.addEventListener('resize', () => {
      this.renderer.setSize(innerWidth, innerHeight);
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.handCamera.aspect = innerWidth / innerHeight;
      this.handCamera.updateProjectionMatrix();
    });

    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerdown', () => this.audio.ensure(), { capture: true });

    document.addEventListener('keydown', (e) => {
      if (e.repeat) {
        if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
        return;
      }
      this.keys.add(e.code);

      if (this.state === 'playing' && this.pickerOpen && (e.code === 'KeyE' || e.code === 'Escape')) {
        e.preventDefault();
        this.closePicker(true);
        return;
      }
      if (this.state !== 'playing' || this.pickerOpen) return;

      switch (e.code) {
        case 'F3':
          e.preventDefault();
          this.debugVisible = !this.debugVisible;
          if (!this.debugVisible) this.ui.setDebug(false);
          break;
        case 'KeyE':
          e.preventDefault();
          this.openPicker();
          break;
        case 'KeyF':
          if (this.gameMode === 'creative') {
            this.player.flying = !this.player.flying;
            this.ui.showToast(this.player.flying ? 'Flying enabled' : 'Flying disabled');
          } else {
            this.ui.showToast('Flying is Creative only');
          }
          break;
        case 'Space': {
          e.preventDefault();
          const now = performance.now();
          if (this.gameMode === 'creative' && now - this.lastSpace < 320) {
            this.player.flying = !this.player.flying;
            if (this.player.flying) this.player.vel.y = 0;
            this.ui.showToast(this.player.flying ? 'Flying enabled' : 'Flying disabled');
          }
          this.lastSpace = now;
          break;
        }
        case 'KeyW': {
          const now = performance.now();
          if (now - this.lastW <= SPRINT_DOUBLE_TAP_MS) {
            this.sprintLatch = true;
            this.ui.showToast('Sprinting');
          }
          this.lastW = now;
          break;
        }
        case 'ControlLeft':
        case 'ControlRight':
          if (this.keys.has('KeyW')) this.ui.showToast('Sprinting');
          break;
        default:
          if (/^Digit[1-9]$/.test(e.code)) {
            this.selectSlot(Number(e.code.slice(5)) - 1);
          }
      }
    });

    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyW') this.sprintLatch = false;
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked || this.state !== 'playing') return;
      const sens = (this.settings.sens / 100) * 0.0023;
      this.player.yaw -= e.movementX * sens;
      this.player.pitch -= e.movementY * sens;
      const lim = Math.PI / 2 - 0.001;
      this.player.pitch = Math.max(-lim, Math.min(lim, this.player.pitch));
    });

    document.addEventListener('mousedown', (e) => {
      if (this.state !== 'playing' || this.pickerOpen) return;
      if (!this.locked) { this.lockPointer(); return; }
      if (e.button === 0) {
        const mob = this.currentMobTarget();
        if (mob) {
          this.attackMob(mob);
          return;
        }
        this.mining = true;
        this.miningProgress = 0;
        this.miningCell = null;
        this.swing();
      } else if (e.button === 1) {
        e.preventDefault();
        this.pickTargetBlock();
      } else if (e.button === 2) {
        this.rmbHeld = this.useSelectedItem();
        this.placeTimer = 0.24;
      }
    });

    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.mining = false; this.miningProgress = 0; this.miningCell = null; }
      if (e.button === 2) this.rmbHeld = false;
    });

    document.addEventListener('wheel', (e) => {
      if (this.state !== 'playing' || !this.locked) return;
      const dir = e.deltaY > 0 ? 1 : -1;
      this.selectSlot((this.selected + dir + 9) % 9);
    }, { passive: true });

    window.addEventListener('beforeunload', () => {
      if (this.state === 'playing' || this.state === 'paused') this.saveWorld();
    });
  }

  // ============================================================
  // Hotbar / picker
  // ============================================================

  refreshHotbar() {
    this.ui.updateHotbar(
      this.inventory.slice(0, HOTBAR_SIZE),
      this.selected,
      this.gameMode === 'survival',
    );
  }

  selectSlot(i) {
    this.selected = i;
    this.refreshHotbar();
    this.ui.setPickerSelected(i);
    const slot = this.inventory[i];
    const def = itemDef(slot?.id);
    if (def) {
      const durability = def.tool ? ` (${slot.durability}/${def.tool.maxDurability})` : '';
      this.ui.showToast(`${def.name}${durability}`);
    }
    this.dipT = 0;
    this.audio.pop();
  }

  assignBlock(id) {
    if (this.gameMode !== 'creative') return;
    const itemId = itemForBlock(id);
    if (!itemId) return;
    this.inventory[this.selected] = { id: itemId, count: 1 };
    this.refreshHotbar();
    this.ui.showToast(BLOCKS[id].name);
    this.audio.click();
    this.dipT = 0;
  }

  openPicker() {
    if (this.gameMode === 'creative') {
      this.pickerOpen = true;
      this.mining = false;
      this.rmbHeld = false;
      this.ui.show('picker');
      this.ui.setPickerSelected(this.selected);
      document.exitPointerLock?.();
    } else {
      this.openSurvivalMenu('inventory');
    }
  }

  activeCraftGrid() {
    return this.containerMode === 'crafting' ? this.tableCraftingGrid : this.craftingGrid;
  }

  activeCraftWidth() {
    return this.containerMode === 'crafting' ? 3 : 2;
  }

  activeSmelter() {
    if (this.containerMode !== 'furnace' || !this.activeBlock) return null;
    if (this.world.getBlock(
      this.activeBlock.x,
      this.activeBlock.y,
      this.activeBlock.z,
    ) !== B.FURNACE) return null;
    return this.blockEntities.getFurnace(
      this.activeBlock.x,
      this.activeBlock.y,
      this.activeBlock.z,
    );
  }

  openSurvivalMenu(mode, target = null, villager = null) {
    if (this.gameMode !== 'survival') return;
    this.pickerOpen = true;
    this.mining = false;
    this.rmbHeld = false;
    this.containerMode = mode;
    this.activeBlock = target
      ? { x: target.x, y: target.y, z: target.z }
      : null;
    this.activeVillager = villager;
    this.ui.setSurvivalMode(mode, villager, villager?.trades || []);
    this.refreshSurvivalInventory();
    this.ui.show('inventory');
    document.exitPointerLock?.();
  }

  closePicker(relock) {
    if (this.gameMode === 'survival') this.returnLooseInventoryItems();
    this.pickerOpen = false;
    this.containerMode = 'inventory';
    this.activeBlock = null;
    this.activeVillager = null;
    this.ui.hide('picker');
    this.ui.hide('inventory');
    if (relock) this.lockPointer();
  }

  refreshSurvivalInventory() {
    if (this.gameMode !== 'survival') return;
    const craftingGrid = this.activeCraftGrid();
    const craftWidth = this.activeCraftWidth();
    this.ui.setSurvivalMode(
      this.containerMode,
      this.activeVillager,
      this.activeVillager?.trades || [],
    );
    this.ui.updateSurvivalInventory(
      this.inventory,
      craftingGrid,
      craftOutput(craftingGrid, craftWidth),
      this.inventoryCursor,
      this.activeSmelter(),
    );
  }

  clickInventorySlot(index, action = {}) {
    if (this.gameMode !== 'survival') return;
    let changed = false;
    if (action.shift && !this.inventoryCursor.id) {
      const targets = index < HOTBAR_SIZE
        ? Array.from({ length: this.inventory.length - HOTBAR_SIZE }, (_, i) => i + HOTBAR_SIZE)
        : Array.from({ length: HOTBAR_SIZE }, (_, i) => i);
      changed = transferSlot(this.inventory, index, targets) > 0;
    } else {
      const before = JSON.stringify([this.inventory[index], this.inventoryCursor]);
      this.inventoryCursor = clickSlot(
        this.inventory,
        index,
        this.inventoryCursor,
        action.button === 'right' ? 'right' : 'left',
      );
      changed = JSON.stringify([this.inventory[index], this.inventoryCursor]) !== before;
    }
    this.refreshHotbar();
    this.refreshSurvivalInventory();
    if (changed) this.audio.click();
  }

  clickCraftSlot(index, action = {}) {
    if (this.gameMode !== 'survival') return;
    const craftingGrid = this.activeCraftGrid();
    if (index < 0 || index >= craftingGrid.length) return;
    let changed = false;
    if (action.shift && !this.inventoryCursor.id) {
      const slot = craftingGrid[index];
      const result = addStack(this.inventory, slot, this.selected);
      if (result.added > 0) {
        consumeSlot(craftingGrid, index, result.added);
        changed = true;
      }
    } else {
      const before = JSON.stringify([craftingGrid[index], this.inventoryCursor]);
      this.inventoryCursor = clickSlot(
        craftingGrid,
        index,
        this.inventoryCursor,
        action.button === 'right' ? 'right' : 'left',
      );
      changed = JSON.stringify([craftingGrid[index], this.inventoryCursor]) !== before;
    }
    this.refreshHotbar();
    this.refreshSurvivalInventory();
    if (changed) this.audio.click();
  }

  clickCraftOutput(action = {}) {
    if (this.gameMode !== 'survival') return;
    const craftingGrid = this.activeCraftGrid();
    const craftWidth = this.activeCraftWidth();
    let crafted = false;
    if (action.shift && !this.inventoryCursor.id) {
      crafted = takeCraftOutputToInventory(
        craftingGrid,
        this.inventory,
        this.selected,
        craftWidth,
      );
      if (crafted) this.refreshHotbar();
    } else {
      const before = JSON.stringify(this.inventoryCursor);
      this.inventoryCursor = takeCraftOutput(craftingGrid, this.inventoryCursor, craftWidth);
      crafted = JSON.stringify(this.inventoryCursor) !== before;
    }
    if (crafted) this.audio.pop();
    this.refreshSurvivalInventory();
  }

  clickSmeltSlot(name, action = {}) {
    if (this.gameMode !== 'survival') return;
    const smelter = this.activeSmelter();
    if (!smelter) return;
    if (name === 'output') {
      const out = smelter.output;
      if (!out.id) return;
      if (action.shift && !this.inventoryCursor.id) {
        const result = addStack(this.inventory, out, this.selected);
        if (result.added <= 0) return;
        smelter.output.count -= result.added;
        if (smelter.output.count <= 0) smelter.output = emptySlot();
        this.refreshHotbar();
      } else {
        const amount = action.button === 'right' ? 1 : out.count;
        const max = itemDef(out.id)?.maxStack ?? 64;
        if (this.inventoryCursor.id && this.inventoryCursor.id !== out.id) return;
        if ((this.inventoryCursor.count || 0) + amount > max) return;
        this.inventoryCursor = {
          id: out.id,
          count: (this.inventoryCursor.id ? this.inventoryCursor.count : 0) + amount,
        };
        smelter.output.count -= amount;
        if (smelter.output.count <= 0) smelter.output = emptySlot();
      }
      this.audio.pop();
    } else {
      if (action.shift && !this.inventoryCursor.id) {
        const result = addStack(this.inventory, smelter[name], this.selected);
        if (result.added <= 0) return;
        smelter[name].count -= result.added;
        if (smelter[name].count <= 0) smelter[name] = emptySlot();
        this.refreshHotbar();
        this.refreshSurvivalInventory();
        this.audio.click();
        return;
      }
      const accepts = name === 'input' ? smeltRecipeFor : isFuelItem;
      if (this.inventoryCursor.id && !accepts(this.inventoryCursor.id)) return;
      const holder = [smelter[name]];
      this.inventoryCursor = clickSlot(
        holder,
        0,
        this.inventoryCursor,
        action.button === 'right' ? 'right' : 'left',
      );
      smelter[name] = holder[0];
      this.audio.click();
    }
    this.refreshSurvivalInventory();
  }

  returnLooseInventoryItems() {
    const returnStack = (slot) => {
      if (!slot?.id || slot.count <= 0) return emptySlot();
      const result = addStack(this.inventory, slot, this.selected);
      if (result.remaining > 0) {
        this.itemEntities.spawn(
          this.player.pos.x,
          this.player.pos.y + 1,
          this.player.pos.z,
          slot.id,
          result.remaining,
          null,
          slot,
        );
      }
      return emptySlot();
    };
    this.inventoryCursor = returnStack(this.inventoryCursor);
    if (this.containerMode === 'inventory') {
      this.craftingGrid = this.craftingGrid.map(returnStack);
    } else if (this.containerMode === 'crafting') {
      this.tableCraftingGrid = this.tableCraftingGrid.map(returnStack);
    }
    this.refreshHotbar();
  }

  // ============================================================
  // Interaction: mining / placing / picking
  // ============================================================

  currentTarget() {
    const eye = this.player.eyePosition(new THREE.Vector3());
    const dir = this.player.lookDir(new THREE.Vector3());
    return raycastVoxel(this.world, eye, dir, REACH);
  }

  currentMobTarget(predicate = null) {
    const eye = this.player.eyePosition(new THREE.Vector3());
    const dir = this.player.lookDir(new THREE.Vector3());
    const block = raycastVoxel(this.world, eye, dir, REACH);
    return this.mobs.raycast(
      eye,
      dir,
      REACH,
      block?.dist ?? Infinity,
      predicate,
    )?.mob || null;
  }

  attackMob(mob) {
    if (this.mobAttackCooldown > 0) return;
    const held = this.inventory[this.selected];
    const tool = itemDef(held?.id)?.tool;
    const damage = this.gameMode === 'creative'
      ? 100
      : tool
        ? tool.tier + (tool.type === 'axe' ? 3 : tool.type === 'pickaxe' ? 2 : 1)
        : 1;
    if (!this.mobs.damage(mob, damage, this.player.pos)) return;
    this.mobAttackCooldown = tool?.type === 'axe' ? 0.65 : 0.42;
    this.swing();
    if (this.gameMode === 'survival') {
      addExhaustion(this.hungerState, 0.1);
      if (tool) {
        const result = damageTool(held, 1);
        if (result.broken) {
          this.inventory[this.selected] = emptySlot();
          this.ui.showToast(`${itemDef(held.id)?.name || 'Tool'} broke`);
        }
        this.refreshHotbar();
      }
    }
  }

  swing() { this.swingT = 0; }

  updateInteraction(dt) {
    const target = this.currentTarget();

    // ---- outline ----
    if (target) {
      this.outline.visible = true;
      this.outline.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
    } else {
      this.outline.visible = false;
    }

    // ---- mining ----
    if (this.mining && target) {
      const key = `${target.x},${target.y},${target.z}`;
      if (this.miningCell !== key) {
        this.miningCell = key;
        this.miningProgress = 0;
      }
      const def = BLOCKS[target.id];
      if (def.hardness !== Infinity) {
        const heldItem = this.inventory[this.selected]?.id;
        const toolSpeed = this.gameMode === 'survival' ? miningSpeedFor(heldItem, target.id) : 1;
        const speed = (this.player.headInWater ? 0.35 : 1) * toolSpeed;
        this.miningProgress += dt * speed;
        if (this.gameMode === 'survival') addExhaustion(this.hungerState, dt * 0.1);
        if (this.swingT > 0.7) this.swing(); // keep punching
        const frac = Math.min(1, this.miningProgress / def.hardness);
        const stage = Math.min(7, Math.floor(frac * 8));
        if (frac > 0.02 && def.hardness > 0.12) {
          this.crack.visible = true;
          this.crack.position.copy(this.outline.position);
          this.crackMat.map = this.crackTextures[stage];
          this.crackMat.needsUpdate = true;
        } else {
          this.crack.visible = false;
        }
        if (this.miningProgress >= def.hardness) {
          this.breakBlock(target);
          this.miningCell = null;
          this.miningProgress = -0.08; // tiny grace before next block
          this.crack.visible = false;
        }
      } else {
        this.crack.visible = false;
      }
    } else {
      this.crack.visible = false;
      if (!this.mining) { this.miningProgress = 0; this.miningCell = null; }
    }

    // ---- place repeat ----
    if (this.rmbHeld) {
      this.placeTimer -= dt;
      if (this.placeTimer <= 0) {
        this.placeTimer = 0.24;
        this.placeBlock();
      }
    }
  }

  breakBlock(target) {
    const id = target.id;
    if (id === B.TNT) {
      this.entities.igniteTNT(target.x, target.y, target.z);
      return;
    }
    const removedId = this.world.setBlock(target.x, target.y, target.z, B.AIR);
    if (removedId === null) return;

    if (removedId === B.DOOR_CLOSED || removedId === B.DOOR_OPEN) {
      if (this.world.getBlock(target.x, target.y + 1, target.z) === B.DOOR_CLOSED || this.world.getBlock(target.x, target.y + 1, target.z) === B.DOOR_OPEN) {
        this.world.setBlock(target.x, target.y + 1, target.z, B.AIR);
      }
      if (this.world.getBlock(target.x, target.y - 1, target.z) === B.DOOR_CLOSED || this.world.getBlock(target.x, target.y - 1, target.z) === B.DOOR_OPEN) {
        this.world.setBlock(target.x, target.y - 1, target.z, B.AIR);
      }
    }

    const furnace = removedId === B.FURNACE
      ? this.blockEntities.removeFurnace(target.x, target.y, target.z)
      : null;
    if (this.gameMode === 'survival') {
      if (furnace) {
        for (const slot of [furnace?.input, furnace?.fuel, furnace?.output]) {
          if (!slot?.id || slot.count <= 0) continue;
          this.itemEntities.spawn(
            target.x + 0.5,
            target.y + 0.65,
            target.z + 0.5,
            slot.id,
            slot.count,
            null,
            slot,
          );
        }
      }
      const held = this.inventory[this.selected];
      const heldItemId = held?.id || null;
      for (const drop of getBlockDrops(removedId, heldItemId)) {
        this.itemEntities.spawn(
          target.x + 0.5,
          target.y + 0.65,
          target.z + 0.5,
          drop.id,
          drop.count,
        );
      }
      if (isToolEffective(heldItemId, removedId) && canHarvestBlock(heldItemId, removedId)) {
        const result = damageTool(held, 1);
        if (result.broken) {
          this.inventory[this.selected] = emptySlot();
          this.ui.showToast(`${itemDef(heldItemId)?.name || 'Tool'} broke`);
        }
        if (result.damaged) {
          this.refreshHotbar();
          if (this.pickerOpen) this.refreshSurvivalInventory();
        }
      }
    }
    this.particles.spawnBlockBreak(target.x, target.y, target.z, removedId);
    this.audio.blockBreak(removedId);
  }

  useSelectedItem() {
    if (this.gameMode === 'survival') {
      const villager = this.currentMobTarget((mob) => mob.type === 'villager');
      if (villager) {
        const view = this.mobs.villagerView(villager);
        view.mob = villager;
        this.openSurvivalMenu('trade', null, view);
        return false;
      }
    }
    const target = this.currentTarget();
    const interaction = target ? BLOCKS[target.id]?.interaction : null;
    // Door toggle
    if (interaction === 'door') {
      const newId = target.id === B.DOOR_CLOSED ? B.DOOR_OPEN : B.DOOR_CLOSED;
      this.world.setBlock(target.x, target.y, target.z, newId);
      
      const topId = this.world.getBlock(target.x, target.y + 1, target.z);
      if (topId === B.DOOR_CLOSED || topId === B.DOOR_OPEN) {
        this.world.setBlock(target.x, target.y + 1, target.z, newId);
      }
      const botId = this.world.getBlock(target.x, target.y - 1, target.z);
      if (botId === B.DOOR_CLOSED || botId === B.DOOR_OPEN) {
        this.world.setBlock(target.x, target.y - 1, target.z, newId);
      }

      this.audio.blockPlace(newId);
      return false;
    }
    // Bed interaction
    if (interaction === 'bed') {
      if (this.sky.dayLight < 0.34) {
        // Night: sleep and set spawn
        this.spawn = {
          x: target.x + 0.5,
          y: target.y + 1,
          z: target.z + 0.5,
        };
        this.sky.setTimeOfDay(0.1); // skip to morning
        this.ui.showToast('Spawn point set. Good morning!');
      } else {
        this.ui.showToast('You can only sleep at night');
      }
      return false;
    }
    if (this.gameMode === 'survival' && interaction) {
      this.openSurvivalMenu(interaction, target);
      return false;
    }
    const slot = this.inventory[this.selected];
    const def = itemDef(slot?.id);
    if (!def) return false;
    if (this.gameMode === 'survival' && def.food) {
      if (eatFood(this.hungerState, def.food)) {
        consumeSlot(this.inventory, this.selected, 1);
        this.refreshHotbar();
        this.ui.updateHunger(this.hungerState.hunger, MAX_HUNGER, true);
        this.ui.showToast(`Ate ${def.name}`);
        this.audio.pop();
      }
      return false;
    }
    // Door item placement
    if (slot?.id === I.DOOR) {
      return this.placeDoor();
    }
    // Bed item placement
    if (slot?.id === I.BED) {
      return this.placeBed();
    }
    return def.blockId !== null ? this.placeBlock() : false;
  }

  placeDoor() {
    const target = this.currentTarget();
    if (!target) return false;
    const slot = this.inventory[this.selected];
    if (this.gameMode === 'survival' && (!slot || slot.count <= 0)) return false;
    const cx = target.x + target.nx;
    const cy = target.y + target.ny;
    const cz = target.z + target.nz;
    if (cy < 1 || cy >= WORLD_H - 1) return false;
    
    const cellId = this.world.getBlock(cx, cy, cz);
    const topId = this.world.getBlock(cx, cy + 1, cz);
    if ((cellId !== B.AIR && !BLOCKS[cellId]?.replaceable) || 
        (topId !== B.AIR && !BLOCKS[topId]?.replaceable)) return false;
        
    if (this.player.intersectsCell(cx, cy, cz) || this.player.intersectsCell(cx, cy + 1, cz)) return false;
    
    this.world.setBlock(cx, cy, cz, B.DOOR_CLOSED);
    this.world.setBlock(cx, cy + 1, cz, B.DOOR_CLOSED);
    this.consumeSelectedBlock();
    this.audio.blockPlace(B.DOOR_CLOSED);
    this.swing();
    return true;
  }

  placeBed() {
    const target = this.currentTarget();
    if (!target) return false;
    const slot = this.inventory[this.selected];
    if (this.gameMode === 'survival' && (!slot || slot.count <= 0)) return false;
    const cx = target.x + target.nx;
    const cy = target.y + target.ny;
    const cz = target.z + target.nz;
    if (cy < 1 || cy >= 128) return false;
    const cellId = this.world.getBlock(cx, cy, cz);
    if (cellId !== B.AIR && !BLOCKS[cellId]?.replaceable) return false;
    // Bed needs solid block below
    const below = this.world.getBlock(cx, cy - 1, cz);
    if (!BLOCKS[below]?.solid) return false;
    this.world.setBlock(cx, cy, cz, B.BED);
    this.consumeSelectedBlock();
    this.audio.blockPlace(B.BED);
    this.swing();
    return true;
  }

  performTrade(index) {
    if (this.containerMode !== 'trade' || !this.activeVillager) return;
    const trade = this.activeVillager.trades?.[index];
    if (!trade) return;
    if (countItem(this.inventory, trade.cost.id) < trade.cost.count) {
      this.ui.showToast(`Need ${trade.cost.count} ${itemDef(trade.cost.id)?.name || 'items'}`);
      return;
    }
    if (capacityForItem(this.inventory, trade.result.id) < trade.result.count) {
      this.ui.showToast('Not enough inventory space');
      return;
    }
    if (!removeItem(this.inventory, trade.cost.id, trade.cost.count)) return;
    const result = addStack(this.inventory, trade.result, this.selected);
    if (result.remaining > 0) {
      addStack(this.inventory, trade.cost, this.selected);
      return;
    }
    this.refreshHotbar();
    this.refreshSurvivalInventory();
    this.audio.pop();
    this.ui.showToast(`Traded for ${itemDef(trade.result.id)?.name || 'item'}`);
  }

  placeBlock() {
    const target = this.currentTarget();
    if (!target) return false;
    const slot = this.inventory[this.selected];
    const id = blockForItem(slot?.id);
    if (id === null || (this.gameMode === 'survival' && slot.count <= 0)) return false;
    const def = BLOCKS[id];
    const targetDef = BLOCKS[target.id];

    let cx, cy, cz;
    if (targetDef.replaceable) {
      cx = target.x; cy = target.y; cz = target.z;
    } else {
      if (target.nx === 0 && target.ny === 0 && target.nz === 0) return false;
      cx = target.x + target.nx; cy = target.y + target.ny; cz = target.z + target.nz;
    }
    if (cy < 1 || cy >= WORLD_H) return false;

    const cellId = this.world.getBlock(cx, cy, cz);
    const cellDef = BLOCKS[cellId];
    if (cellId !== B.AIR && !cellDef.replaceable) return false;
    if (def.solid && this.player.intersectsCell(cx, cy, cz)) return false;

    // support rules
    const below = this.world.getBlock(cx, cy - 1, cz);
    if (def.support === 'floor') {
      if (id === B.TORCH) {
        if (!BLOCKS[below].solid) return false;
      } else if (below !== B.GRASS && below !== B.DIRT && below !== B.SNOW_GRASS && below !== B.SAND) {
        return false; // plants need soil
      }
    }
    if (def.support === 'sand' && below !== B.SAND && below !== B.CACTUS) return false;

    this.world.setBlock(cx, cy, cz, id);
    this.consumeSelectedBlock();
    this.audio.blockPlace(id);
    this.swing();
    return true;
  }

  pickTargetBlock() {
    if (this.gameMode !== 'creative') return;
    const target = this.currentTarget();
    if (!target) return;
    if (PALETTE.includes(target.id)) {
      this.assignBlock(target.id);
    }
  }

  tryPickupItem(stackOrId, count) {
    const stack = typeof stackOrId === 'string'
      ? { id: stackOrId, count }
      : stackOrId;
    if (this.gameMode !== 'survival') return stack?.count || 0;
    const result = addStack(this.inventory, stack, this.selected);
    if (result.added <= 0) return result.remaining;
    this.refreshHotbar();
    if (this.pickerOpen) this.refreshSurvivalInventory();
    this.ui.showToast(`Picked up ${itemDef(stack.id)?.name || 'item'}`);
    this.audio.pop();
    return result.remaining;
  }

  consumeSelectedBlock() {
    if (this.gameMode !== 'survival') return;
    consumeSlot(this.inventory, this.selected, 1);
    this.refreshHotbar();
  }

  // ============================================================
  // Support / gravity checks (queued by world.setBlock)
  // ============================================================

  processSupportChecks() {
    const list = this.world.supportChecks;
    if (!list.length) return;
    const batch = list.splice(0, 128);
    for (const [x, y, z] of batch) {
      const id = this.world.getBlock(x, y, z);
      if (id === B.AIR) continue;
      const def = BLOCKS[id];
      const below = this.world.getBlock(x, y - 1, z);
      const belowSolid = BLOCKS[below].solid;

      if (def.gravity && !belowSolid) {
        this.entities.spawnFallingBlock(x, y, z, id);
      } else if (def.support === 'floor' && !belowSolid) {
        this.world.setBlock(x, y, z, B.AIR);
        if (this.gameMode === 'survival') {
          for (const drop of getBlockDrops(id)) {
            this.itemEntities.spawn(x + 0.5, y + 0.5, z + 0.5, drop.id, drop.count);
          }
        }
        this.particles.spawnBlockBreak(x, y, z, id);
        this.audio.blockBreak(id);
      } else if (def.support === 'sand' && below !== B.SAND && below !== B.CACTUS) {
        this.world.setBlock(x, y, z, B.AIR);
        if (this.gameMode === 'survival') {
          for (const drop of getBlockDrops(id)) {
            this.itemEntities.spawn(x + 0.5, y + 0.5, z + 0.5, drop.id, drop.count);
          }
        }
        this.particles.spawnBlockBreak(x, y, z, id);
        this.audio.blockBreak(id);
      }
    }
  }

  // ============================================================
  // Held block (first-person view model)
  // ============================================================

  heldGeometry(id) {
    let g = this.heldGeoCache.get(id);
    if (!g) { g = buildBlockGeometry(id); this.heldGeoCache.set(id, g); }
    return g;
  }

  updateHand(dt) {
    const itemId = this.inventory[this.selected]?.id;
    const item = itemDef(itemId);
    if (!item) {
      if (this.heldMesh) {
        this.handGroup.remove(this.heldMesh);
        if (this.heldMesh.material !== this.materials.solid) this.heldMesh.material.dispose();
        this.heldMesh = null;
      }
      this.heldId = null;
      return;
    }
    if (!this.heldMesh || this.heldId !== itemId) {
      if (this.heldMesh) {
        this.handGroup.remove(this.heldMesh);
        if (this.heldMesh.material !== this.materials.solid) this.heldMesh.material.dispose();
      }
      const blockId = blockForItem(itemId);
      if (blockId !== null) {
        this.heldMesh = new THREE.Mesh(this.heldGeometry(blockId), this.materials.solid);
        this.heldMesh.scale.setScalar(0.4);
      } else {
        const geometry = item.tool
          ? new THREE.BoxGeometry(0.14, 0.85, 0.14)
          : new THREE.BoxGeometry(0.48, 0.16, 0.48);
        const material = new THREE.MeshBasicMaterial({ color: item.icon.color || '#cccccc' });
        this.heldMesh = new THREE.Mesh(geometry, material);
        this.heldMesh.rotation.z = item.tool ? -0.55 : 0;
      }
      this.handGroup.add(this.heldMesh);
      this.heldId = itemId;
    }

    this.swingT = Math.min(1, this.swingT + dt / 0.26);
    this.dipT = Math.min(1, this.dipT + dt / 0.22);

    const p = this.player;
    const bobX = Math.sin(p.walkCycle * 1.0) * 0.022 * p.bobStrength;
    const bobY = -Math.abs(Math.sin(p.walkCycle * 1.0)) * 0.018 * p.bobStrength;
    const swing = Math.sin(Math.min(1, this.swingT) * Math.PI);
    const dip = Math.sin(Math.min(1, this.dipT) * Math.PI);

    this.handGroup.position.set(
      0.42 + bobX,
      -0.42 + bobY - dip * 0.3 - swing * 0.08,
      -0.72 - swing * 0.18,
    );
    this.handGroup.rotation.set(
      -swing * 0.9,
      Math.PI * 0.13 - swing * 0.45,
      0,
    );
  }

  // ============================================================
  // Icons (rendered with the real block geometry + atlas)
  // ============================================================

  makeIcons() {
    const icons = new Map();
    const SIZE = 64;
    const rt = new THREE.WebGLRenderTarget(SIZE, SIZE);
    const iconScene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-0.82, 0.82, 0.82, -0.82, 0.1, 10);
    cam.position.set(1.84, 1.5, 1.84);
    cam.lookAt(0, 0, 0);

    const buf = new Uint8Array(SIZE * SIZE * 4);
    const cnv = document.createElement('canvas');
    cnv.width = cnv.height = SIZE;
    const ctx = cnv.getContext('2d');

    for (const blockId of PALETTE) {
      const def = BLOCKS[blockId];
      const itemId = itemForBlock(blockId);
      if (!itemId) continue;
      if (def.shape === 'cross' || def.shape === 'torch' || def.shape === 'liquid') {
        const url = tileIconCanvas(def.tex.py, SIZE).toDataURL();
        icons.set(itemId, url);
        icons.set(blockId, url);
        continue;
      }
      const mesh = new THREE.Mesh(this.heldGeometry(blockId), this.materials.solid);
      iconScene.add(mesh);
      this.renderer.setRenderTarget(rt);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear();
      this.renderer.render(iconScene, cam);
      this.renderer.readRenderTargetPixels(rt, 0, 0, SIZE, SIZE, buf);
      this.renderer.setRenderTarget(null);
      iconScene.remove(mesh);

      // flip vertically + linear -> sRGB-ish gamma
      const img = ctx.createImageData(SIZE, SIZE);
      for (let y = 0; y < SIZE; y++) {
        const src = (SIZE - 1 - y) * SIZE * 4;
        const dst = y * SIZE * 4;
        for (let x = 0; x < SIZE * 4; x += 4) {
          img.data[dst + x] = Math.round(255 * Math.pow(buf[src + x] / 255, 1 / 2.2));
          img.data[dst + x + 1] = Math.round(255 * Math.pow(buf[src + x + 1] / 255, 1 / 2.2));
          img.data[dst + x + 2] = Math.round(255 * Math.pow(buf[src + x + 2] / 255, 1 / 2.2));
          img.data[dst + x + 3] = buf[src + x + 3];
        }
      }
      ctx.putImageData(img, 0, 0);
      const url = cnv.toDataURL();
      icons.set(itemId, url);
      icons.set(blockId, url);
    }

    for (const [id, def] of ITEMS) {
      if (icons.has(id)) continue;
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.imageSmoothingEnabled = false;
      const color = def.icon.color || '#bbbbbb';
      const hi = def.icon.highlight || '#eeeeee';
      ctx.lineWidth = 7;
      ctx.lineCap = 'square';
      ctx.lineJoin = 'miter';
      if (def.icon.type === 'stick') {
        ctx.strokeStyle = '#5c3a20';
        ctx.beginPath(); ctx.moveTo(18, 52); ctx.lineTo(48, 12); ctx.stroke();
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(18, 50); ctx.lineTo(48, 12); ctx.stroke();
      } else if (def.icon.type === 'tool') {
        ctx.strokeStyle = '#77502d';
        ctx.lineWidth = 8;
        ctx.beginPath(); ctx.moveTo(30, 54); ctx.lineTo(34, 19); ctx.stroke();
        ctx.fillStyle = color;
        ctx.fillRect(13, 10, 39, 15);
        ctx.fillStyle = hi;
        ctx.fillRect(17, 12, 30, 4);
      } else if (def.icon.type === 'ingot') {
        ctx.fillStyle = '#8d8a82';
        ctx.beginPath();
        ctx.moveTo(10, 45); ctx.lineTo(19, 22); ctx.lineTo(47, 22);
        ctx.lineTo(55, 45); ctx.lineTo(47, 52); ctx.lineTo(17, 52); ctx.closePath();
        ctx.fill();
        ctx.fillStyle = color;
        ctx.fillRect(18, 28, 29, 17);
        ctx.fillStyle = hi;
        ctx.fillRect(22, 29, 22, 4);
      } else if (def.icon.type === 'food') {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(32, 36, 18, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = hi;
        ctx.fillRect(21, 23, 8, 8);
        ctx.fillStyle = '#4e7c32';
        ctx.fillRect(34, 12, 12, 7);
        ctx.fillStyle = '#654322';
        ctx.fillRect(31, 15, 6, 10);
      } else if (def.icon.type === 'meat') {
        ctx.fillStyle = '#dfdcd0'; // bone
        ctx.fillRect(40, 16, 8, 8);
        ctx.fillRect(44, 20, 8, 8);
        ctx.lineWidth = 6; ctx.strokeStyle = '#dfdcd0';
        ctx.beginPath(); ctx.moveTo(44, 20); ctx.lineTo(26, 38); ctx.stroke();
        
        ctx.fillStyle = color;
        ctx.beginPath(); 
        ctx.arc(28, 40, 14, 0, Math.PI * 2); 
        ctx.arc(20, 32, 12, 0, Math.PI * 2); 
        ctx.arc(36, 32, 12, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = hi;
        ctx.fillRect(20, 26, 8, 6);
      } else {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(13, 34); ctx.lineTo(24, 16); ctx.lineTo(45, 14);
        ctx.lineTo(54, 32); ctx.lineTo(43, 51); ctx.lineTo(20, 49); ctx.closePath();
        ctx.fill();
        ctx.fillStyle = hi;
        ctx.fillRect(23, 20, 15, 7);
      }
      icons.set(id, cnv.toDataURL());
    }
    rt.dispose();
    return icons;
  }

  // ============================================================
  // Frame loop
  // ============================================================

  frame(t) {
    // never let a single bad frame kill the whole game loop
    try {
      this.frameInner(t);
    } catch (err) {
      console.error('[frame]', err);
      window.__lastFrameError = (err && err.stack) || String(err);
    }
    this.scheduleFrame();
  }

  frameInner(t) {
    const dt = Math.min(0.1, (t - this.lastT) / 1000);
    this.lastT = t;

    // fps tracking
    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsAccum);
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    switch (this.state) {
      case 'title': this.frameTitle(dt); break;
      case 'loading': this.frameLoading(dt); break;
      case 'playing': this.framePlaying(dt); break;
      case 'paused': break; // fully frozen, like MC singleplayer
    }

    this.renderer.render(this.scene, this.camera);
    this.lastDrawInfo.calls = this.renderer.info.render.calls;
    this.lastDrawInfo.triangles = this.renderer.info.render.triangles;

    if (this.state === 'playing') {
      // overlay pass: keep the world pixels, only reset depth
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.handScene, this.handCamera);
      this.renderer.autoClear = true;
    }
  }

  frameTitle(dt) {
    this.titleAngle += dt * 0.05;
    this.world.update(this.spawn.x, this.spawn.z, 10);
    const r = 42;
    this.camera.position.set(
      this.spawn.x + Math.cos(this.titleAngle) * r,
      this.spawn.y + 22,
      this.spawn.z + Math.sin(this.titleAngle) * r,
    );
    this.camera.lookAt(this.spawn.x, this.spawn.y + 2, this.spawn.z);
    this.sky.update(dt, this.camera.position);
  }

  frameLoading(dt) {
    this.world.update(this.player.pos.x, this.player.pos.z, 14);
    const radius = Math.min(4, this.settings.render);
    const { ready, total } = this.world.readiness(this.player.pos.x, this.player.pos.z, radius);
    this.ui.setLoadingProgress(total ? ready / total : 0);
    this.sky.update(dt, this.camera.position);
    if (ready >= total) this.finishLoading();
  }

  framePlaying(dt) {
    const p = this.player;
    this.mobAttackCooldown = Math.max(0, this.mobAttackCooldown - dt);

    // ---- input snapshot ----
    const inputActive = !this.pickerOpen;
    const input = {
      forward: inputActive && this.keys.has('KeyW'),
      back: inputActive && this.keys.has('KeyS'),
      left: inputActive && this.keys.has('KeyA'),
      right: inputActive && this.keys.has('KeyD'),
      jump: inputActive && this.keys.has('Space'),
      sneak: inputActive && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')),
    };
    const wantSprint = inputActive &&
      (this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.sprintLatch);
    p.sprinting = wantSprint && input.forward && !input.sneak &&
      (this.gameMode === 'creative' || this.hungerState.hunger > 0);

    // ---- simulate ----
    p.update(dt, input);
    if (this.gameMode === 'survival' && p.sprinting) addExhaustion(this.hungerState, dt * 0.32);

    // void rescue
    if (p.pos.y < -14) {
      if (this.gameMode === 'survival') {
        this.damage(this.maxHealth, 'Fell out of the world');
      } else {
        p.teleport(this.spawn.x, Math.max(this.spawn.y + 2, 70), this.spawn.z);
      }
      if (this.state !== 'playing') return;
    }

    // ---- player audio events ----
    for (const ev of p.events) {
      if (ev.type === 'step') this.audio.step(ev.id);
      else if (ev.type === 'jump' && this.gameMode === 'survival') {
        addExhaustion(this.hungerState, p.sprinting ? 0.22 : 0.12);
      }
      else if (ev.type === 'land') {
        this.audio.land(ev.impact);
        if (this.spawnLandingProtected) {
          this.spawnLandingProtected = false;
          p.fallDistance = 0;
        } else {
          const damage = fallDamageForDistance(ev.distance);
          if (damage > 0) this.damage(damage, 'Fell from a high place');
        }
      }
      else if (ev.type === 'splash') this.audio.splash();
    }
    p.events.length = 0;
    if (this.spawnLandingProtected && p.onGround) {
      this.spawnLandingProtected = false;
      p.fallDistance = 0;
    }
    if (this.state !== 'playing') return;


    // ---- interaction & world streaming ----
    if (this.locked && !this.pickerOpen) this.updateInteraction(dt);
    else { this.outline.visible = false; this.crack.visible = false; }

    this.world.update(p.pos.x, p.pos.z, 5);
    if (this.village.update(this.world, this.player.pos, 256)) {
      this.world.remeshAll();
    }
    const spawns = this.village.takeResidentSpawns(this.player.pos);
    if (spawns.length) this.mobs.spawnResidents(spawns);
    this.processSupportChecks();
    this.entities.update(dt);
    this.itemEntities.update(dt, p, (stack) => this.tryPickupItem(stack));
    this.mobs.update(dt, p, {
      night: this.sky.dayLight < 0.34,
      spawning: this.gameMode === 'survival',
      gameMode: this.gameMode,
    });
    if (this.state !== 'playing') return;

    // Lava damage
    if (this.gameMode === 'survival' && p.inLava) {
      this.damage(Math.ceil(4 * dt), 'Tried to swim in lava');
      if (this.state !== 'playing') return;
    }

    if (this.gameMode === 'survival') {
      const healthDelta = tickHunger(this.hungerState, dt, {
        health: this.health,
        maxHealth: this.maxHealth,
      });
      if (healthDelta < 0) {
        this.damage(-healthDelta, 'Starved');
        if (this.state !== 'playing') return;
      } else if (healthDelta > 0) {
        this.health = Math.min(this.maxHealth, this.health + healthDelta);
        this.ui.updateHealth(this.health, this.maxHealth, true);
      }
      this.blockEntities.update(
        dt,
        (x, z) => this.world.isLoaded(x, z),
        (x, y, z) => this.world.getBlock(x, y, z) === B.FURNACE,
      );
      this.ui.updateHunger(this.hungerState.hunger, MAX_HUNGER, true);
      if (this.pickerOpen) this.refreshSurvivalInventory();
    }

    // ---- camera ----
    const eye = p.eyePosition(new THREE.Vector3());
    let bobY = 0, bobRoll = 0;
    if (this.settings.bob && !p.flying) {
      bobY = Math.abs(Math.sin(p.walkCycle)) * 0.052 * p.bobStrength;
      bobRoll = Math.sin(p.walkCycle) * 0.004 * p.bobStrength;
    }
    this.shakeT = Math.max(0, this.shakeT - dt);
    const sh = this.shakeT * this.shakeT * 0.35;
    this.camera.position.set(
      eye.x + (Math.random() - 0.5) * sh,
      eye.y + bobY + (Math.random() - 0.5) * sh,
      eye.z + (Math.random() - 0.5) * sh,
    );
    this.camera.rotation.set(p.pitch, p.yaw, bobRoll);

    // smooth FOV (sprint kick)
    const targetFov = this.settings.fov * (p.sprinting ? (p.flying ? 1.18 : 1.12) : 1);
    this.fovCurrent += (targetFov - this.fovCurrent) * Math.min(1, 10 * dt);
    if (Math.abs(this.fovCurrent - this.camera.fov) > 0.05) {
      this.camera.fov = this.fovCurrent;
      this.camera.updateProjectionMatrix();
    }

    // ---- environment ----
    this.sky.setUnderwater(p.headInWater || p.headInLava);
    this.ui.setUnderwater(p.headInWater || p.headInLava);
    this.sky.update(dt, this.camera.position);
    this.waterTex.offset.x = (t_now() * 0.018) % 1;
    this.waterTex.offset.y = (t_now() * 0.011) % 1;

    this.updateHand(dt);

    // ---- autosave ----
    this.autosaveTimer += dt;
    if (this.autosaveTimer > 6) {
      this.autosaveTimer = 0;
      this.saveWorld();
    }

    // ---- debug ----
    if (this.debugVisible) {
      this.debugTimer -= dt;
      if (this.debugTimer <= 0) {
        this.debugTimer = 0.2;
        this.ui.setDebug(true, this.debugText());
      }
    }
  }

  debugText() {
    const p = this.player;
    const bx = Math.floor(p.pos.x), by = Math.floor(p.pos.y), bz = Math.floor(p.pos.z);
    const cx = Math.floor(bx / CHUNK), cz = Math.floor(bz / CHUNK);
    const yawDeg = ((THREE.MathUtils.radToDeg(p.yaw) % 360) + 360) % 360;
    const dirs = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'];
    const facing = dirs[Math.round(yawDeg / 45) % 8];
    const target = this.currentTarget();
    const biome = BIOME_NAMES[this.world.biomeAt(bx, bz)] ?? '?';
    return [
      `Minecraft JS (Three.js) — ${this.fps} fps`,
      `XYZ: ${p.pos.x.toFixed(2)} / ${p.pos.y.toFixed(2)} / ${p.pos.z.toFixed(2)}`,
      `Block: ${bx} ${by} ${bz}   Chunk: ${cx} ${cz} [${bx & 15} ${bz & 15}]`,
      `Facing: ${facing} (yaw ${yawDeg.toFixed(1)}°, pitch ${THREE.MathUtils.radToDeg(p.pitch).toFixed(1)}°)`,
      `Biome: ${biome}   Time: ${this.sky.clockString()}`,
      `Seed: ${this.worldSeed}   Mode: ${this.gameMode}   Health: ${this.health}/${this.maxHealth}   Hunger: ${this.hungerState.hunger.toFixed(1)}/${MAX_HUNGER}`,
      `Chunks: ${this.world.countLoaded()} ready / ${this.world.chunks.size} loaded   Edits: ${this.world.editCount}`,
      `Entities: ${this.entities.list.length + this.itemEntities.list.length}   Particles: ${this.particles.list.length}`,
      `Draw calls: ${this.lastDrawInfo.calls}   Tris: ${(this.lastDrawInfo.triangles / 1000).toFixed(1)}k`,
      `Flags: ${p.onGround ? 'ground ' : ''}${p.flying ? 'flying ' : ''}${p.inWater ? 'water ' : ''}${p.sprinting ? 'sprint ' : ''}${p.sneaking ? 'sneak' : ''}`,
      target ? `Target: ${BLOCKS[target.id].name} @ ${target.x} ${target.y} ${target.z}` : 'Target: —',
    ].join('\n');
  }
}

const t_now = () => performance.now() / 1000;

// ------------------------------------------------------------

window.addEventListener('DOMContentLoaded', () => {
  try {
    window.game = new Game(); // exposed for debugging / tinkering
  } catch (err) {
    console.error('Failed to start:', err);
    document.getElementById('webgl-error')?.classList.remove('hidden');
    throw err;
  }
});
