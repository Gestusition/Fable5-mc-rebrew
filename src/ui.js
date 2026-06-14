// ============================================================
// UI — DOM chrome: title screen with splash text, loading bar,
// hotbar + item toast, inventory picker, pause/options/controls
// menus and the F3 debug readout.
// ============================================================

import { BLOCKS, PALETTE } from './blocks.js';
import { itemDef, itemForBlock } from './items.js';
import { HOTBAR_SIZE } from './inventory.js';

const SPLASHES = [
  'Now in JavaScript!',
  'Three.js powered!',
  '100% procedural pixels!',
  'Punch the TNT!',
  'Double-tap SPACE to fly!',
  'Infinite-ish terrain!',
  'No assets were harmed!',
  'Caves included!',
  'Also try the real one!',
  'Made of canvas!',
  'Sneak near edges!',
  'Watch for falling sand!',
];

const TIPS = [
  'Tip: Double-tap SPACE to fly',
  'Tip: Hold CTRL (or double-tap W) to sprint',
  'Tip: Press E to choose any block',
  'Tip: TNT explodes when you break it…',
  'Tip: Torches light up caves',
  'Tip: Middle-click copies the block you aim at',
  'Tip: SHIFT-sneaking stops you falling off edges',
];

export class UI {
  constructor(handlers) {
    this.h = handlers;
    this.$ = (id) => document.getElementById(id);

    this.screens = {
      title: this.$('title-screen'),
      loading: this.$('loading-screen'),
      pause: this.$('pause-menu'),
      options: this.$('options-menu'),
      controls: this.$('controls-menu'),
      picker: this.$('picker'),
      inventory: this.$('survival-inventory'),
      death: this.$('death-screen'),
      hud: this.$('hud'),
    };

    this.iconUrls = new Map();
    this.controlsReturn = 'title';

    this.$('splash-text').textContent = SPLASHES[(Math.random() * SPLASHES.length) | 0];
    this.$('loading-tip').textContent = TIPS[(Math.random() * TIPS.length) | 0];

    this._wireMenus();
    this._buildHotbar();
    this._buildSurvivalInventory();
  }

  // ----------------------------------------------------------
  // Screens
  // ----------------------------------------------------------

  show(name) { this.screens[name].classList.remove('hidden'); }
  hide(name) { this.screens[name].classList.add('hidden'); }
  hideAllMenus() {
  }

  // ----------------------------------------------------------
  // Screens
  // ----------------------------------------------------------

  show(name) { this.screens[name].classList.remove('hidden'); }
  hide(name) { this.screens[name].classList.add('hidden'); }
  hideAllMenus() {
    for (const k of ['title', 'loading', 'pause', 'options', 'controls', 'picker', 'inventory', 'death']) this.hide(k);
  }

  _wireMenus() {
    const click = (id, fn) => this.$(id).addEventListener('click', () => { this.h.onUiClick?.(); fn(); });

    click('btn-play', () => this.h.onPlay(this.$('world-select').value));
    click('btn-delete-world', () => this.h.onDeleteWorld(this.$('world-select').value));
    click('btn-new-world', () => this.h.onNewWorld(
      this.$('world-name-input').value.trim() || 'New World',
      this.$('seed-input').value.trim()
    ));
    click('btn-game-mode', () => this.h.onToggleMode());
    click('btn-title-controls', () => { this.controlsReturn = 'title'; this.hide('title'); this.show('controls'); });

    click('btn-resume', () => this.h.onResume());
    click('btn-quit', () => this.h.onQuit());
    click('btn-options', () => { this.hide('pause'); this.syncOptions(); this.show('options'); });
    click('btn-controls', () => { this.controlsReturn = 'pause'; this.hide('pause'); this.show('controls'); });
    click('btn-options-done', () => { this.hide('options'); this.show('pause'); });
    click('btn-controls-done', () => { this.hide('controls'); this.show(this.controlsReturn); });
    click('btn-respawn', () => this.h.onRespawn());
    click('btn-death-title', () => this.h.onDeathQuit());

    // option sliders
    const slider = (id, valId, key, fmt = (v) => v) => {
      this.$(id).addEventListener('input', (e) => {
        const v = Number(e.target.value);
        this.$(valId).textContent = fmt(v);
        this.h.onSetting(key, v);
      });
    };
    slider('opt-render', 'val-render', 'render');
    slider('opt-fov', 'val-fov', 'fov');
    slider('opt-sens', 'val-sens', 'sens');
    slider('opt-vol', 'val-vol', 'vol');

    const toggle = (id, key, label) => {
      this.$(id).addEventListener('click', () => {
        const s = this.h.getSettings();
        const v = !s[key];
        this.h.onSetting(key, v);
        this.$(id).textContent = `${label}: ${v ? 'ON' : 'OFF'}`;
        this.h.onUiClick?.();
      });
    };
    toggle('opt-bob', 'bob', 'View Bobbing');
    toggle('opt-clouds', 'clouds', 'Clouds');
    toggle('opt-music', 'music', 'Music');
    toggle('opt-smooth', 'smooth', 'Smooth Lighting');
  }

  syncOptions() {
    const s = this.h.getSettings();
    this.$('opt-render').value = s.render; this.$('val-render').textContent = s.render;
    this.$('opt-fov').value = s.fov; this.$('val-fov').textContent = s.fov;
    this.$('opt-sens').value = s.sens; this.$('val-sens').textContent = s.sens;
    this.$('opt-vol').value = s.vol; this.$('val-vol').textContent = s.vol;
    this.$('opt-bob').textContent = `View Bobbing: ${s.bob ? 'ON' : 'OFF'}`;
    this.$('opt-clouds').textContent = `Clouds: ${s.clouds ? 'ON' : 'OFF'}`;
    this.$('opt-music').textContent = `Music: ${s.music ? 'ON' : 'OFF'}`;
    this.$('opt-smooth').textContent = `Smooth Lighting: ${s.smooth ? 'ON' : 'OFF'}`;
  }

  setSeedPlaceholder(seed) {
    this.$('seed-input').placeholder = `Seed (leave empty = random)`;
  }

  setWorldsList(worlds) {
    const select = this.$('world-select');
    select.innerHTML = '';
    if (!worlds || worlds.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No worlds found';
      select.appendChild(opt);
      this.$('btn-play').disabled = true;
      this.$('btn-delete-world').disabled = true;
    } else {
      worlds.forEach(w => {
        const opt = document.createElement('option');
        opt.value = w.id;
        // Format last played date
        const date = w.lastPlayed ? new Date(w.lastPlayed).toLocaleString() : 'Unknown';
        opt.textContent = `${w.name} - ${w.gameMode === 'survival' ? 'Survival' : 'Creative'} (${date})`;
        select.appendChild(opt);
      });
      this.$('btn-play').disabled = false;
      this.$('btn-delete-world').disabled = false;
      // Sort by lastPlayed in main.js, so first is latest
      select.value = worlds[0].id;
    }
  }

  setGameMode(mode) {
    this.$('btn-game-mode').textContent = `Game Mode: ${mode === 'survival' ? 'Survival' : 'Creative'}`;
  }

  setLoadingProgress(frac) {
    this.$('loading-fill').style.width = `${Math.round(frac * 100)}%`;
  }

  // ----------------------------------------------------------
  // Hotbar
  // ----------------------------------------------------------

  _buildHotbar() {
    const bar = this.$('hotbar');
    this.slotEls = [];
    for (let i = 0; i < 9; i++) {
      const slot = document.createElement('div');
      slot.className = 'hotbar-slot';
      const num = document.createElement('span');
      num.className = 'slot-num';
      num.textContent = String(i + 1);
      const img = document.createElement('img');
      img.draggable = false;
      const count = document.createElement('span');
      count.className = 'slot-count';
      const durability = document.createElement('span');
      durability.className = 'durability-bar';
      durability.appendChild(document.createElement('span'));
      slot.appendChild(num);
      slot.appendChild(img);
      slot.appendChild(count);
      slot.appendChild(durability);
      bar.appendChild(slot);
      this.slotEls.push(slot);
    }
  }

  setIcons(iconUrls) {
    this.iconUrls = iconUrls;
    this._buildPicker();
  }

  updateHotbar(hotbar, selected, showCounts = false) {
    hotbar.forEach((slot, i) => {
      const id = slot?.id || null;
      const img = this.slotEls[i].querySelector('img');
      const url = this.iconUrls.get(id);
      if (url) {
        if (img.src !== url) img.src = url;
        img.style.visibility = 'visible';
      } else {
        img.removeAttribute('src');
        img.style.visibility = 'hidden';
      }
      const count = this.slotEls[i].querySelector('.slot-count');
      count.textContent = showCounts && slot?.count > 1 ? String(slot.count) : '';
      this._renderDurability(this.slotEls[i], slot);
      this.slotEls[i].classList.toggle('selected', i === selected);
    });
    if (this.pickerSlotEls) {
      hotbar.forEach((slot, i) => {
        const id = slot?.id || null;
        const img = this.pickerSlotEls[i].querySelector('img');
        const url = this.iconUrls.get(id);
        if (url) {
          if (img.src !== url) img.src = url;
          img.style.visibility = 'visible';
        } else {
          img.removeAttribute('src');
          img.style.visibility = 'hidden';
        }
      });
    }
  }

  showToast(text) {
    const el = this.$('item-name');
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 1400);
  }

  // ----------------------------------------------------------
  // Picker
  // ----------------------------------------------------------

  _buildPicker() {
    const grid = this.$('picker-grid');
    grid.innerHTML = '';
    for (const id of PALETTE) {
      const cell = document.createElement('div');
      cell.className = 'picker-cell';
      cell.dataset.name = BLOCKS[id].name;
      const img = document.createElement('img');
      img.draggable = false;
      const url = this.iconUrls.get(itemForBlock(id)) || this.iconUrls.get(id);
      if (url) img.src = url;
      cell.appendChild(img);
      cell.addEventListener('click', () => this.h.onPickBlock(id));
      grid.appendChild(cell);
    }

    const bar = this.$('picker-hotbar');
    bar.innerHTML = '';
    this.pickerSlotEls = [];
    for (let i = 0; i < 9; i++) {
      const slot = document.createElement('div');
      slot.className = 'hotbar-slot';
      const num = document.createElement('span');
      num.className = 'slot-num';
      num.textContent = String(i + 1);
      const img = document.createElement('img');
      img.draggable = false;
      const count = document.createElement('span');
      count.className = 'slot-count';
      slot.appendChild(num);
      slot.appendChild(img);
      slot.appendChild(count);
      slot.addEventListener('click', () => this.h.onHotbarSelect(i));
      bar.appendChild(slot);
      this.pickerSlotEls.push(slot);
    }
  }

  setPickerSelected(selected) {
    this.pickerSlotEls?.forEach((el, i) => el.classList.toggle('selected', i === selected));
  }

  // ----------------------------------------------------------
  // Misc HUD
  // ----------------------------------------------------------

  setUnderwater(on) {
    this.$('underwater-overlay').style.opacity = on ? '1' : '0';
  }

  // ----------------------------------------------------------
  // Survival inventory
  // ----------------------------------------------------------

  _makeItemSlot(className = 'inventory-slot') {
    const cell = document.createElement('div');
    cell.className = className;
    const img = document.createElement('img');
    img.draggable = false;
    const count = document.createElement('span');
    count.className = 'slot-count';
    const durability = document.createElement('span');
    durability.className = 'durability-bar';
    durability.appendChild(document.createElement('span'));
    cell.append(img, count, durability);
    return cell;
  }

  _wireItemSlot(cell, callback) {
    cell.addEventListener('mousedown', (event) => {
      if (event.button !== 0 && event.button !== 2) return;
      event.preventDefault();
      callback({
        button: event.button === 2 ? 'right' : 'left',
        shift: event.shiftKey,
      });
    });
    cell.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  _buildSurvivalInventory() {
    this.inventorySlotEls = [];
    const main = this.$('survival-main-grid');
    const hotbar = this.$('survival-hotbar-grid');
    for (let i = HOTBAR_SIZE; i < 36; i++) {
      const cell = this._makeItemSlot();
      this._wireItemSlot(cell, (action) => this.h.onInventorySlot(i, action));
      main.appendChild(cell);
      this.inventorySlotEls[i] = cell;
    }
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const cell = this._makeItemSlot();
      this._wireItemSlot(cell, (action) => this.h.onInventorySlot(i, action));
      hotbar.appendChild(cell);
      this.inventorySlotEls[i] = cell;
    }

    this.craftSlotEls = [];
    const craft = this.$('craft-grid');
    for (let i = 0; i < 9; i++) {
      const cell = this._makeItemSlot();
      this._wireItemSlot(cell, (action) => this.h.onCraftSlot(i, action));
      craft.appendChild(cell);
      this.craftSlotEls.push(cell);
    }
    this.craftOutputEl = this._makeItemSlot('inventory-slot output-slot');
    this._wireItemSlot(this.craftOutputEl, (action) => this.h.onCraftOutput(action));
    this.$('craft-output').appendChild(this.craftOutputEl);

    this.smeltInputEl = this._makeItemSlot();
    this.smeltFuelEl = this._makeItemSlot();
    this.smeltOutputEl = this._makeItemSlot('inventory-slot output-slot');
    this._wireItemSlot(this.smeltInputEl, (action) => this.h.onSmeltSlot('input', action));
    this._wireItemSlot(this.smeltFuelEl, (action) => this.h.onSmeltSlot('fuel', action));
    this._wireItemSlot(this.smeltOutputEl, (action) => this.h.onSmeltSlot('output', action));
    this.$('smelt-input').appendChild(this.smeltInputEl);
    this.$('smelt-fuel').appendChild(this.smeltFuelEl);
    this.$('smelt-output').appendChild(this.smeltOutputEl);
  }

  setSurvivalMode(mode, villager = null, trades = []) {
    const crafting = mode === 'inventory' || mode === 'crafting';
    this.$('survival-menu-title').textContent = mode === 'crafting'
      ? 'Crafting Table'
      : mode === 'furnace'
        ? 'Furnace'
        : mode === 'trade'
          ? 'Trading'
          : 'Survival Inventory';
    this.$('craft-panel').classList.toggle('hidden', !crafting);
    this.$('furnace-panel').classList.toggle('hidden', mode !== 'furnace');
    this.$('trade-panel').classList.toggle('hidden', mode !== 'trade');
    this.$('craft-label').textContent = mode === 'crafting' ? 'Crafting 3x3' : 'Crafting 2x2';
    this.$('craft-grid').classList.toggle('craft-grid-3', mode === 'crafting');
    this.craftSlotEls.forEach((slot, index) => {
      slot.classList.toggle('hidden', index >= (mode === 'crafting' ? 9 : 4));
    });
    if (mode === 'trade') {
      this.$('villager-name').textContent = villager?.name || 'Settler';
      this.$('villager-profession').textContent = villager?.profession || 'Provisioner';
      const list = this.$('trade-list');
      list.innerHTML = '';
      trades.forEach((trade, index) => {
        const button = document.createElement('button');
        button.className = 'trade-button';
        button.textContent = trade.label;
        button.addEventListener('click', () => this.h.onTrade?.(index));
        list.appendChild(button);
      });
    }
  }

  _renderItemSlot(el, slot) {
    const id = slot?.id || null;
    const def = itemDef(id);
    const img = el.querySelector('img');
    const count = el.querySelector('.slot-count');
    const url = this.iconUrls.get(id);
    if (url) {
      if (img.src !== url) img.src = url;
      img.style.visibility = 'visible';
    } else {
      img.removeAttribute('src');
      img.style.visibility = 'hidden';
    }
    count.textContent = slot?.count > 1 ? String(slot.count) : '';
    this._renderDurability(el, slot);
    const durability = def?.tool
      ? ` (${slot?.durability ?? def.tool.maxDurability}/${def.tool.maxDurability})`
      : '';
    if (def) el.dataset.name = `${def.name}${durability}`;
    else delete el.dataset.name;
  }

  _renderDurability(el, slot) {
    const bar = el.querySelector('.durability-bar');
    if (!bar) return;
    const tool = itemDef(slot?.id)?.tool;
    bar.classList.toggle('visible', !!tool);
    if (!tool) return;
    const durability = Math.max(0, Math.min(tool.maxDurability, slot.durability ?? tool.maxDurability));
    const ratio = durability / tool.maxDurability;
    const fill = bar.firstElementChild;
    fill.style.width = `${ratio * 100}%`;
    fill.style.backgroundColor = ratio > 0.5 ? '#5bd34e' : ratio > 0.2 ? '#e0b33e' : '#d34b3f';
  }

  updateSurvivalInventory(inventory, crafting, output, cursor, smelter) {
    for (let i = 0; i < this.inventorySlotEls.length; i++) {
      if (this.inventorySlotEls[i]) this._renderItemSlot(this.inventorySlotEls[i], inventory[i]);
    }
    this.craftSlotEls.forEach((el, i) => this._renderItemSlot(el, crafting?.[i]));
    this._renderItemSlot(this.craftOutputEl, output);
    this._renderItemSlot(this.smeltInputEl, smelter?.input);
    this._renderItemSlot(this.smeltFuelEl, smelter?.fuel);
    this._renderItemSlot(this.smeltOutputEl, smelter?.output);
    this.$('smelt-progress-fill').style.width = `${Math.min(100, ((smelter?.progress || 0) / 5) * 100)}%`;
    this.$('inventory-cursor').textContent = cursor?.id
      ? `Held: ${itemDef(cursor.id)?.name || cursor.id}${cursor.count > 1 ? ` x${cursor.count}` : ''}`
      : 'Held: Empty';
  }

  updateHealth(health, maxHealth, visible) {
    const bar = this.$('health');
    bar.classList.toggle('hidden', !visible);
    if (!visible) return;
    if (!this.heartEls) {
      this.heartEls = [];
      for (let i = 0; i < maxHealth / 2; i++) {
        const heart = document.createElement('span');
        heart.className = 'heart';
        const fill = document.createElement('span');
        fill.className = 'heart-fill';
        fill.textContent = '\u2665';
        heart.textContent = '\u2665';
        heart.appendChild(fill);
        bar.appendChild(heart);
        this.heartEls.push(fill);
      }
    }
    this.heartEls.forEach((fill, i) => {
      const points = Math.max(0, Math.min(2, health - i * 2));
      fill.style.width = `${points * 50}%`;
    });
  }

  updateHunger(hunger, maxHunger, visible) {
    const bar = this.$('hunger');
    bar.classList.toggle('hidden', !visible);
    if (!visible) return;
    if (!this.hungerEls) {
      this.hungerEls = [];
      for (let i = 0; i < maxHunger / 2; i++) {
        const pip = document.createElement('span');
        pip.className = 'hunger-pip';
        const fill = document.createElement('span');
        fill.className = 'hunger-fill';
        fill.textContent = '◆';
        pip.textContent = '◆';
        pip.appendChild(fill);
        bar.appendChild(pip);
        this.hungerEls.push(fill);
      }
    }
    this.hungerEls.forEach((fill, i) => {
      const points = Math.max(0, Math.min(2, hunger - i * 2));
      fill.style.width = `${points * 50}%`;
    });
  }

  showDeath(message) {
    this.$('death-message').textContent = message;
    this.show('death');
  }

  flashDamage() {
    const el = this.$('damage-vignette');
    el.style.opacity = '1';
    clearTimeout(this._dmgTimer);
    this._dmgTimer = setTimeout(() => { el.style.opacity = '0'; }, 220);
  }

  setDebug(visible, text = '') {
    const el = this.$('debug');
    el.classList.toggle('hidden', !visible);
    if (visible) el.textContent = text;
  }

  showWebglError() {
    this.$('webgl-error').classList.remove('hidden');
  }
}
