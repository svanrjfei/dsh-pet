import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { petsScript } from './script/pets.ts';
import { pickupScheduleScript } from './script/pickup-schedule.ts';

type TestControl = {
  id?: string;
  class?: string;
  value?: string;
  checked?: boolean;
  oninput?: () => void;
  change?: (checked: boolean) => void;
};

function fixture(companion = true) {
  const config = {
    main: { pets: [{ id: 'main', display: 'none' }], font: { size: 21 } },
    'blue-haired-girl': { pets: [{ id: 'tuantuan', name: '小团团', size: 348 }] },
  };
  const calls: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  const tabs: Array<{ label: string; click: () => void }> = [];
  const cards: unknown[] = [];
  const controls: Record<string, TestControl> = {};
  const schedule = { enabled: true, time: '19:30', days: [1, 3, 5] };
  const requests: Array<{ method: string; body?: string }> = [];
  const failures = { read: false, save: false };
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
    TOKEN: 'test-token',
    fetch: async (path: string, options: { method: string; body?: string; headers: Record<string, string> }) => {
      assert.equal(path, '/xiaotuantuan/schedule');
      assert.equal(options.headers['X-DSH-Pet-Token'], 'test-token');
      requests.push(options);
      const failed = options.method === 'GET' ? failures.read : failures.save;
      return {
        ok: !failed,
        json: async () =>
          failed ? { error: '接口失败' } : options.body ? JSON.parse(options.body) : structuredClone(schedule),
      };
    },
    byId: (id: keyof typeof nodes) => nodes[id],
    tabButton: (label: string, _active: boolean, click: () => void) => {
      const tab = { label, click };
      tabs.push(tab);
      return tab;
    },
    make: (_tag: string, props: TestControl = {}) => {
      if (props.class === 'tabs') return 'tabs';
      const node = { ...props };
      if (props.id) controls[props.id] = node;
      return node;
    },
    card: (title: string) => (title === '定时接你下班' ? 'schedule-card' : 'pack-note'),
    button: () => 'retry',
    fieldRow: () => 'field',
    toggleRow: (id: string, _title: string, _hint: unknown, checked: boolean, change: (value: boolean) => void) => {
      controls[id] = { checked, change };
      return id;
    },
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
  const api = runInNewContext(
    petsScript(companion) + pickupScheduleScript() + '\n({initDrafts,renderPetsPanel,savePets,loadPickupSchedule})',
    context,
  ) as {
    initDrafts(config: unknown): void;
    renderPetsPanel(): void;
    savePets(): Promise<void>;
    loadPickupSchedule(): Promise<void>;
  };
  api.initDrafts(config);
  api.renderPetsPanel();
  return { ...api, context, config, nodes, cards, tabs, calls, controls, schedule, requests, failures };
}

test('小团团与全局分区分开，分别保存到原接口且保留隐藏宠物', async () => {
  const f = fixture();
  assert.equal(f.context.state.entry, 'blue-haired-girl');
  assert.deepEqual(
    f.tabs.map((t) => t.label),
    ['小团团设置', '全局设置'],
  );
  assert.deepEqual(f.cards, ['tabs', 'pet-card', 'schedule-card']);
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

test('定时设置读入旧值，和小团团设置一起保存，失败后保留草稿可重试', async () => {
  const f = fixture();
  await f.loadPickupSchedule();
  f.renderPetsPanel();
  assert.equal(f.controls['pickup-time'].value, '19:30');
  assert.equal(f.controls['pickup-day-3'].checked, true);
  f.controls['pickup-time'].value = '20:15';
  f.controls['pickup-time'].oninput!();
  f.controls['pickup-day-6'].change!(true);
  assert.equal(f.context.state.dirty, true);
  f.failures.save = true;
  await f.savePets();
  assert.match(f.nodes['pet-status'].textContent, /定时设置未保存/);
  assert.equal(f.context.state.dirty, true);
  f.renderPetsPanel();
  assert.equal(f.controls['pickup-time'].value, '20:15');
  f.failures.save = false;
  await f.savePets();
  assert.deepEqual(JSON.parse(f.requests.at(-1)!.body!), { enabled: true, time: '20:15', days: [1, 3, 5, 6] });
  assert.equal(f.context.state.dirty, false);
  assert.match(f.nodes['pet-status'].textContent, /已保存/);
});

test('无效定时设置在写入任何配置前拦截', async () => {
  const f = fixture();
  await f.loadPickupSchedule();
  f.renderPetsPanel();
  f.controls['pickup-time'].value = '';
  f.controls['pickup-time'].oninput!();
  await f.savePets();
  assert.equal(f.calls.length, 0);
  assert.equal(f.requests.length, 1);
  assert.match(f.nodes['pet-status'].textContent, /有效播放时间/);
  f.controls['pickup-time'].value = '18:00';
  f.controls['pickup-time'].oninput!();
  for (const day of [1, 3, 5]) f.controls['pickup-day-' + day].change!(false);
  await f.savePets();
  assert.equal(f.calls.length, 0);
  f.controls['pickup-enabled'].change!(false);
  await f.savePets();
  assert.deepEqual(JSON.parse(f.requests.at(-1)!.body!), { enabled: false, time: '18:00', days: [] });
});

test('定时设置读取失败时不会用默认值覆盖原计划，仍可保存角色设置', async () => {
  const f = fixture();
  f.failures.read = true;
  await f.loadPickupSchedule();
  await f.savePets();
  assert.equal(f.calls[0].path, '/pet-config');
  assert.deepEqual(
    f.requests.map((request) => request.method),
    ['GET'],
  );
});
