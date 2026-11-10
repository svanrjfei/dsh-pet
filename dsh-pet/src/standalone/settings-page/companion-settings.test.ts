import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { petsScript } from './script/pets.ts';

function fixture(companion = true) {
  const config = {
    main: { pets: [{ id: 'main', display: 'none' }], font: { size: 21 } },
    'blue-haired-girl': { pets: [{ id: 'tuantuan', name: '小团团', size: 348 }] },
  };
  const calls: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  const tabs: Array<{ label: string; click: () => void }> = [];
  const cards: unknown[] = [];
  const nodes = {
    'pet-cards': { textContent: '', append: (card: unknown) => cards.push(card) },
    'pet-save': { disabled: false, textContent: '' },
    'pet-status': { textContent: '' },
    settings: { hidden: false },
  };
  const context = {
    state: { config: null, entry: 'main', petIndex: 0, dirty: false },
    FALLBACK_WEIGHTS: { idle: 10, turn: 5, move: 5 },
    FALLBACK_PHYSICS: {},
    FALLBACK_FONT: {},
    VOICES: [],
    byId: (id: keyof typeof nodes) => nodes[id],
    tabButton: (label: string, _active: boolean, click: () => void) => {
      const tab = { label, click };
      tabs.push(tab);
      return tab;
    },
    make: () => 'tabs',
    card: () => 'pack-note',
    petCard: () => 'pet-card',
    globalCards: () => [() => 'global-card'],
    setStatus: (node: { textContent: string }, text: string) => {
      node.textContent = text;
    },
    markDirty: (value: boolean) => {
      context.state.dirty = value;
    },
    callApi: async (method: string, path: string, body: Record<string, unknown>) => {
      calls.push({ method, path, body });
      return config;
    },
  };
  const api = runInNewContext(petsScript(companion) + '\n({initDrafts,renderPetsPanel,savePets})', context) as {
    initDrafts(config: unknown): void;
    renderPetsPanel(): void;
    savePets(): Promise<void>;
  };
  api.initDrafts(config);
  api.renderPetsPanel();
  return { ...api, context, config, nodes, cards, tabs, calls };
}

test('小团团与全局分区分开，分别保存到原接口且保留隐藏宠物', async () => {
  const f = fixture();
  assert.equal(f.context.state.entry, 'blue-haired-girl');
  assert.deepEqual(
    f.tabs.map((t) => t.label),
    ['小团团设置', '全局设置'],
  );
  assert.deepEqual(f.cards, ['tabs', 'pet-card']);
  assert.equal(f.nodes.settings.hidden, true);
  await f.savePets();
  assert.equal(f.calls[0].path, '/pet-config');
  assert.equal(f.calls[0].body.entry, 'blue-haired-girl');
  const globalTab = f.tabs.find((t) => t.label === '全局设置')!;
  f.cards.length = 0;
  globalTab.click();
  assert.deepEqual(f.cards, ['tabs', 'global-card']);
  assert.equal(f.nodes.settings.hidden, false);
  assert.equal(f.nodes['pet-save'].textContent, '保存全局设置');
  await f.savePets();
  assert.equal(f.calls[1].path, '/config');
  assert.equal(f.calls[1].method, 'PUT');
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[1].body.pets)), f.config.main.pets);
  assert.equal(f.context.state.entry, 'main', '保存后留在全局设置');
});

test('未保存时不切换分区，避免保存一处后丢弃另一处草稿', () => {
  const f = fixture();
  f.context.state.dirty = true;
  f.tabs[1].click();
  assert.equal(f.context.state.entry, 'blue-haired-girl');
  assert.match(f.nodes['pet-status'].textContent, /请先保存/);
});

test('普通独立版保持原设置页布局', () => {
  const f = fixture(false);
  assert.equal(f.context.state.entry, 'main');
  assert.deepEqual(
    f.tabs.map((t) => t.label),
    ['默认条目', 'blue-haired-girl'],
  );
  assert.deepEqual(f.cards, ['tabs', 'pet-card', 'global-card']);
});
