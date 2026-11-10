import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { Context } from '@deepseek-ai/cordis';
import * as plugin from './index.js';

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'xiaotuantuan-test-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  const petRoot = join(home, 'dsh-pet', 'pet');
  mkdirSync(petRoot, { recursive: true });
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  });
  const config = join(petRoot, 'blue-haired-girl-config.json');
  return {
    home, petRoot, config, saved: `${config}.disabled`,
    video: join(petRoot, 'blue-haired-girl-animation', '待机呼吸.webm'),
  };
}

function enable(services = {}) {
  let dispose;
  plugin.apply({ ...services, webServer: { register: () => () => {}, ...services.webServer }, effect(fn) { dispose = fn(); } });
  return dispose;
}

test('激活独立宠物，不修改 main 或其他宠物；停用保留设置，再次启用恢复', (t) => {
  const f = fixture(t);
  const main = join(f.home, 'dsh-pet', 'main-config.jsonc');
  const other = join(f.petRoot, 'other-config.json');
  writeFileSync(main, 'original-main');
  writeFileSync(other, 'original-other');
  const dispose = enable();
  const config = JSON.parse(readFileSync(f.config));
  assert.equal(config.pets[0].name, '小团团');
  assert.deepEqual(config.animations.drag, ['拖拽悬空']);
  assert.deepEqual(config.animationWeights, { idle: 30, turn: 0, move: 0 });
  assert.equal(Object.keys(config.memes).length, 18);
  for (const meme of Object.keys(config.memes)) {
    assert.deepEqual(readFileSync(join(f.petRoot, 'blue-haired-girl-memes', `${meme}.png`)),
      readFileSync(new URL(`./pet/blue-haired-girl-memes/${meme}.png`, import.meta.url)));
  }
  assert.deepEqual(readFileSync(f.video).subarray(0, 4), Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  config.pets[0].size = 512;
  writeFileSync(f.config, JSON.stringify(config));
  dispose();
  assert.equal(existsSync(f.config), false);
  assert.equal(JSON.parse(readFileSync(f.saved)).pets[0].size, 512);
  assert.ok(existsSync(f.video));
  const again = enable();
  assert.equal(JSON.parse(readFileSync(f.config)).pets[0].size, 512);
  assert.equal(existsSync(f.saved), false);
  again();
  assert.equal(readFileSync(main, 'utf8'), 'original-main');
  assert.equal(readFileSync(other, 'utf8'), 'original-other');
});

test('不接管已有的手动宠物包，也不覆盖其中的素材', (t) => {
  const f = fixture(t);
  const raw = JSON.stringify({ pets: [{ id: 'user-pet' }] });
  writeFileSync(f.config, raw);
  assert.throws(enable, /已有同名宠物配置/);
  assert.equal(readFileSync(f.config, 'utf8'), raw);
  assert.equal(existsSync(f.video), false);
});

test('损坏的配置显式失败并原样保留', (t) => {
  const f = fixture(t);
  writeFileSync(f.saved, '{broken');
  assert.throws(enable, SyntaxError);
  assert.equal(readFileSync(f.saved, 'utf8'), '{broken');
  assert.equal(existsSync(f.config), false);
});

test('崩溃遗留的自有配置可恢复，已有素材不被覆盖', (t) => {
  const f = fixture(t);
  enable();
  writeFileSync(f.video, 'user-custom-animation');
  const dispose = enable();
  assert.equal(readFileSync(f.video, 'utf8'), 'user-custom-animation');
  dispose();
});

test('配置和素材目录的符号链接不能将写入引向其他位置', (t) => {
  const f = fixture(t);
  const outside = join(f.home, 'outside.json');
  writeFileSync(outside, '{}');
  symlinkSync(outside, f.config);
  assert.throws(enable, /非普通文件/);
  rmSync(f.config);
  const outsideDir = join(f.home, 'outside-dir');
  mkdirSync(outsideDir);
  symlinkSync(outsideDir, join(f.petRoot, 'blue-haired-girl-animation'), 'dir');
  assert.throws(enable, /符号链接/);
  assert.equal(existsSync(join(outsideDir, '待机呼吸.webm')), false);
  assert.equal(readFileSync(outside, 'utf8'), '{}');
});

test('停用时不覆盖已有备份，不删除后来换成的非插件配置', (t) => {
  const f = fixture(t);
  const dispose = enable();
  writeFileSync(f.saved, 'keep-this-backup');
  assert.throws(dispose, /备份已存在/);
  assert.ok(existsSync(f.config));
  assert.equal(readFileSync(f.saved, 'utf8'), 'keep-this-backup');
  rmSync(f.saved);
  writeFileSync(f.config, '{}');
  assert.throws(dispose, /已有同名宠物配置/);
  assert.equal(readFileSync(f.config, 'utf8'), '{}');
});

test('真实 Cordis 等待 dsh-pet 服务，启用及释放遵循插件生命周期', async (t) => {
  const f = fixture(t);
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  const fork = ctx.plugin(plugin);
  ctx.provide('webServer', { register: () => () => {}, getOrigin() { throw new Error('No HTTP in this test'); } });
  ctx.provide('connection', {});
  await setImmediate();
  assert.equal(existsSync(f.config), false);
  ctx.provide('petApi7340', {});
  await setImmediate();
  assert.ok(existsSync(f.config));
  await fork.dispose();
  assert.equal(existsSync(f.config), false);
  assert.ok(existsSync(f.saved));
});

test('启停通过宿主 cookie 鉴权刷新桌宠，不透传启动令牌到业务接口', async (t) => {
  fixture(t);
  const calls = [];
  const server = createServer((req, res) => {
    calls.push({ method: req.method, url: req.url, cookie: req.headers.cookie, origin: req.headers.origin });
    if (req.url === '/?token=test-only') {
      res.writeHead(302, { 'set-cookie': 'session=test-session; HttpOnly; Path=/', location: './' });
      res.end();
    } else if (req.method === 'POST' && req.url === '/dsh-pet-7340/reload' && req.headers.cookie === 'session=test-session') {
      res.writeHead(200); res.end('{}');
    } else if (req.url.startsWith('/dsh-pet-7340/menu/') && req.headers.cookie === 'session=test-session') {
      if (!req.url.includes('/events')) { res.writeHead(200); res.end('{"ok":true}'); }
    } else { res.writeHead(401); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const services = {
    webServer: { getOrigin: () => origin },
    connection: { authenticatedUrl: (base) => `${base}/?token=test-only` },
  };
  const waitForReloads = async (count) => {
    for (let i = 0; i < 100 && calls.filter((c) => c.url === '/dsh-pet-7340/reload').length < count; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(calls.filter((c) => c.url === '/dsh-pet-7340/reload').length, count);
  };
  const dispose = enable(services);
  await waitForReloads(1);
  for (let i = 0; i < 100 && !calls.some((c) => c.url.includes('/menu/events')); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(calls.some((c) => c.url.includes('/menu/events')));
  dispose();
  await waitForReloads(2);
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.url.includes('/menu/item')));
  for (const call of calls.filter((c) => c.method === 'POST')) {
    assert.equal(call.origin, origin);
    assert.equal(call.url.includes('token'), false);
  }
});

test('拒绝跨站鉴权地址；刷新失败不会删除配置或输出令牌', async (t) => {
  const f = fixture(t);
  const warnings = [];
  const fetchMock = t.mock.method(globalThis, 'fetch', () => { throw new Error('must not fetch'); });
  const dispose = enable({
    webServer: { getOrigin: () => 'http://127.0.0.1:3080' },
    connection: { authenticatedUrl: () => 'https://example.com/?token=secret' },
    logger: { warn: (message) => warnings.push(message) },
  });
  await setImmediate();
  assert.ok(existsSync(f.config));
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].includes('secret'), false);
  dispose();
  await setImmediate();
});

test('安装包含拖拽素材；升级启用或停用的旧配置，保留设置与自定义动作', (t) => {
  const f = fixture(t);
  const dragVideo = join(f.petRoot, 'blue-haired-girl-animation', '拖拽悬空.webm');
  for (const path of [f.config, f.saved]) {
    for (const drag of [[], ['用户自定义']]) {
      const old = { _plugin: plugin.name, pets: [{ name: '自定义名称', size: 512 }], animations: { idle: ['自定义待机'], drag } };
      writeFileSync(path, JSON.stringify(old));
      const dispose = enable();
      const actual = JSON.parse(readFileSync(f.config));
      assert.deepEqual(actual.pets, old.pets);
      assert.deepEqual(actual.animations.idle, old.animations.idle);
      assert.deepEqual(actual.animations.drag, drag.length ? drag : ['拖拽悬空']);
      assert.deepEqual(readFileSync(dragVideo).subarray(0, 4), Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
      actual.animations.drag = [];
      writeFileSync(f.config, JSON.stringify(actual));
      dispose();
      const again = enable();
      assert.deepEqual(JSON.parse(readFileSync(f.config)).animations.drag, []);
      again();
      rmSync(f.saved);
    }
  }
});

test('旧配置升级遇到已有临时文件时保留两份文件，不覆盖备份', (t) => {
  const f = fixture(t);
  const original = JSON.stringify({ _plugin: plugin.name, animations: { drag: [] } });
  writeFileSync(f.config, original);
  writeFileSync(`${f.config}.upgrade`, 'previous-upgrade');
  assert.throws(enable, /EEXIST/);
  assert.equal(readFileSync(f.config, 'utf8'), original);
  assert.equal(readFileSync(`${f.config}.upgrade`, 'utf8'), 'previous-upgrade');
});

test('新版素材安装不覆盖用户自定义拖拽文件，也不跟随同名符号链接', (t) => {
  const f = fixture(t);
  const dispose = enable();
  const dragVideo = join(f.petRoot, 'blue-haired-girl-animation', '拖拽悬空.webm');
  const bundled = readFileSync(new URL('./pet/blue-haired-girl-animation/拖拽悬空.webm', import.meta.url));
  assert.deepEqual(readFileSync(dragVideo), bundled);
  dispose();
  writeFileSync(dragVideo, 'user-custom-drag');
  const again = enable();
  assert.equal(readFileSync(dragVideo, 'utf8'), 'user-custom-drag');
  again();
  rmSync(dragVideo);
  const outside = join(f.home, 'outside-drag.webm');
  writeFileSync(outside, 'keep-outside');
  symlinkSync(outside, dragVideo);
  assert.throws(enable, /非普通文件/);
  assert.equal(readFileSync(outside, 'utf8'), 'keep-outside');
});

test('升级补入接你下班菜单及素材，保留配置且重复启用不重复添加', (t) => {
  const f = fixture(t);
  const old = {
    _plugin: plugin.name, _pluginVersion: '0.1.1',
    pets: [{ name: '我的小团团', size: 350, display: 'desktop' }],
    animations: { idle: ['待机呼吸'], categories: [{ id: '自定义', weight: 10, actions: ['原动作'] }] },
    animationWeights: { idle: 100, turn: 0, move: 0 },
  };
  writeFileSync(f.saved, JSON.stringify(old));
  const dispose = enable();
  const actual = JSON.parse(readFileSync(f.config));
  assert.deepEqual(actual.pets, old.pets);
  assert.deepEqual(actual.animationWeights, old.animationWeights);
  assert.deepEqual(actual.animations.categories[0], old.animations.categories[0]);
  assert.deepEqual(actual.animations.categories[1], { id: '小团团出行', weight: 10, noMirror: true, actions: ['接你下班'] });
  assert.ok(existsSync(join(f.petRoot, 'blue-haired-girl-animation', '接你下班.webm')));
  dispose();
  const again = enable();
  assert.equal(JSON.parse(readFileSync(f.config)).animations.categories.length, 3);
  again();
});

test('伸懒腰升级复用日常分类，保留权重与自定义素材；删除后不强行补回', (t) => {
  const f = fixture(t);
  const old = {
    _plugin: plugin.name, _pluginVersion: '0.1.3',
    pets: [{ id: 'mine', name: '我的小团团', size: 350, display: 'desktop' }],
    animations: { categories: [{ id: '日常小动作', weight: 27, actions: ['已有动作'] }] },
    animationWeights: { idle: 90, turn: 0, move: 0 },
  };
  writeFileSync(f.config, JSON.stringify(old));
  const dispose = enable();
  const actual = JSON.parse(readFileSync(f.config));
  assert.deepEqual(actual.pets, old.pets);
  assert.deepEqual(actual.animationWeights, old.animationWeights);
  assert.deepEqual(actual.animations.categories, [{ id: '日常小动作', weight: 27, actions: ['已有动作', '超大伸懒腰', '哈欠连天', '悠闲哼歌', '东张西望', '玩游戏气急败坏', '大口吃零食', '魔法换装-小猪睡衣'] }]);
  assert.equal(actual._pluginVersion, '0.1.21');
  const video = join(f.petRoot, 'blue-haired-girl-animation', '超大伸懒腰.webm');
  assert.deepEqual(readFileSync(video).subarray(0, 4), Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  actual.animations.categories[0].actions = ['已有动作'];
  writeFileSync(f.config, JSON.stringify(actual));
  writeFileSync(video, 'custom-stretch');
  dispose();
  const again = enable();
  assert.deepEqual(JSON.parse(readFileSync(f.config)), actual);
  assert.equal(readFileSync(video, 'utf8'), 'custom-stretch');
  again();
});


test('原装 0.1.7 启用随机伸懒腰，保留角色设置；再次启用保留用户新权重', (t) => {
  const f = fixture(t);
  const old = JSON.parse(readFileSync(new URL('./pet/blue-haired-girl-config.json', import.meta.url)));
  old._plugin = plugin.name;
  old._pluginVersion = '0.1.7';
  old.pets[0].size = 350;
  old.animationWeights.idle = 100;
  old.animations.categories.find((c) => c.id === '日常小动作').actions = ['超大伸懒腰'];
  old.animations.categories.reverse();
  old.animations.categories[0].weight = 10;
  writeFileSync(f.saved, JSON.stringify(old));
  const dispose = enable();
  const actual = JSON.parse(readFileSync(f.config));
  assert.deepEqual(actual.pets, old.pets);
  assert.deepEqual(actual.animationWeights, { idle: 30, turn: 0, move: 0 });
  assert.deepEqual(actual.animations.categories.map((c) => [c.id, c.weight]), [['日常小动作', 10], ['小团团出行', 0]]);
  actual.animationWeights.idle = 100;
  writeFileSync(f.config, JSON.stringify(actual));
  dispose();
  const again = enable();
  assert.deepEqual(JSON.parse(readFileSync(f.config)), actual);
  again();
});


test('哈欠升级保留权重与角色，自定义素材不覆盖；再次启用不重复添加', (t) => {
  const f = fixture(t);
  const old = {
    _plugin: plugin.name, _pluginVersion: '0.1.8',
    pets: [{ id: 'mine', size: 350 }],
    animations: { categories: [{ id: '日常小动作', weight: 27, actions: ['超大伸懒腰', '自定义动作'] }] },
    animationWeights: { idle: 85, turn: 0, move: 0 },
  };
  writeFileSync(f.saved, JSON.stringify(old));
  const dispose = enable();
  const actual = JSON.parse(readFileSync(f.config));
  assert.deepEqual(actual.pets, old.pets);
  assert.deepEqual(actual.animationWeights, old.animationWeights);
  assert.deepEqual(actual.animations.categories, [{ id: '日常小动作', weight: 27, actions: ['超大伸懒腰', '自定义动作', '哈欠连天', '悠闲哼歌', '东张西望', '玩游戏气急败坏', '大口吃零食', '魔法换装-小猪睡衣'] }]);
  const video = join(f.petRoot, 'blue-haired-girl-animation', '哈欠连天.webm');
  assert.deepEqual(readFileSync(video), readFileSync(new URL('./pet/blue-haired-girl-animation/哈欠连天.webm', import.meta.url)));
  writeFileSync(video, 'custom-yawn');
  dispose();
  const again = enable();
  assert.deepEqual(JSON.parse(readFileSync(f.config)), actual);
  assert.equal(readFileSync(video, 'utf8'), 'custom-yawn');
  again();
});


test('0.1.9 旧默认比例升级为 30/70，仅升级一次并保留动作池', (t) => {
  const f = fixture(t);
  const old = JSON.parse(readFileSync(new URL('./pet/blue-haired-girl-config.json', import.meta.url)));
  old._plugin = plugin.name;
  old._pluginVersion = '0.1.9';
  old.animationWeights.idle = 80;
  writeFileSync(f.config, JSON.stringify(old));
  const dispose = enable();
  const actual = JSON.parse(readFileSync(f.config));
  assert.deepEqual(actual.animationWeights, { idle: 30, turn: 0, move: 0 });
  assert.deepEqual(actual.animations, old.animations);
  actual.animationWeights.idle = 80;
  writeFileSync(f.config, JSON.stringify(actual));
  dispose();
  const again = enable();
  assert.deepEqual(JSON.parse(readFileSync(f.config)), actual);
  again();
});


test('哼歌升级加入一次，保留权重和自定义素材，后续删除动作不补回', (t) => {
  const f = fixture(t);
  const old = {
    _plugin: plugin.name, _pluginVersion: '0.1.10',
    pets: [{ id: 'mine', size: 350 }],
    animations: { categories: [{ id: '日常小动作', weight: 10, actions: ['超大伸懒腰', '哈欠连天'] }] },
    animationWeights: { idle: 30, turn: 0, move: 0 },
  };
  writeFileSync(f.saved, JSON.stringify(old));
  const dispose = enable();
  const actual = JSON.parse(readFileSync(f.config));
  assert.deepEqual(actual.pets, old.pets);
  assert.deepEqual(actual.animationWeights, old.animationWeights);
  assert.deepEqual(actual.animations.categories[0].actions, ['超大伸懒腰', '哈欠连天', '悠闲哼歌', '东张西望', '玩游戏气急败坏', '大口吃零食', '魔法换装-小猪睡衣']);
  const video = join(f.petRoot, 'blue-haired-girl-animation', '悠闲哼歌.webm');
  assert.deepEqual(readFileSync(video), readFileSync(new URL('./pet/blue-haired-girl-animation/悠闲哼歌.webm', import.meta.url)));
  writeFileSync(video, 'custom-humming');
  actual.animations.categories[0].actions = actual.animations.categories[0].actions.filter((name) => name !== '悠闲哼歌');
  writeFileSync(f.config, JSON.stringify(actual));
  dispose();
  const again = enable();
  assert.deepEqual(JSON.parse(readFileSync(f.config)), actual);
  assert.equal(readFileSync(video, 'utf8'), 'custom-humming');
  again();
});


test('修复待机与余额事件重名，保留权重及用户自定义余额动作', (t) => {
  const f = fixture(t);
  for (const balance of [['待机呼吸'], ['自定义余额']]) {
    const old = JSON.parse(readFileSync(new URL('./pet/blue-haired-girl-config.json', import.meta.url)));
    old._plugin = plugin.name;
    old._pluginVersion = '0.1.11';
    old.animations.events.balance = balance;
    writeFileSync(f.config, JSON.stringify(old));
    const dispose = enable();
    const actual = JSON.parse(readFileSync(f.config));
    assert.deepEqual(actual.animationWeights, old.animationWeights);
    assert.deepEqual(actual.animations.categories, old.animations.categories);
    assert.deepEqual(actual.animations.events.balance, balance[0] === '待机呼吸' ? ['余额展示'] : balance);
    assert.equal(actual.animations.idle.some((name) => actual.animations.events.balance.includes(name)), false);
    const video = join(f.petRoot, 'blue-haired-girl-animation', '余额展示.webm');
    assert.deepEqual(readFileSync(video), readFileSync(new URL('./pet/blue-haired-girl-animation/待机呼吸.webm', import.meta.url)));
    dispose();
    const again = enable();
    assert.deepEqual(JSON.parse(readFileSync(f.config)), actual);
    again();
    rmSync(f.saved);
  }
});


test('东张西望只加入日常随机池，升级保留转向配置及自定义素材', (t) => {
  const f = fixture(t);
  const old = JSON.parse(readFileSync(new URL('./pet/blue-haired-girl-config.json', import.meta.url)));
  old._plugin = plugin.name;
  old._pluginVersion = '0.1.12';
  old.animations.categories[0].actions = ['超大伸懒腰', '哈欠连天', '悠闲哼歌'];
  old.animations.turn = ['自定义转向'];
  writeFileSync(f.saved, JSON.stringify(old));
  const dispose = enable();
  const actual = JSON.parse(readFileSync(f.config));
  assert.deepEqual(actual.animationWeights, old.animationWeights);
  assert.deepEqual(actual.animations.turn, old.animations.turn);
  assert.deepEqual(actual.animations.categories[0].actions, ['超大伸懒腰', '哈欠连天', '悠闲哼歌', '东张西望', '玩游戏气急败坏', '大口吃零食', '魔法换装-小猪睡衣']);
  const video = join(f.petRoot, 'blue-haired-girl-animation', '东张西望.webm');
  assert.deepEqual(readFileSync(video), readFileSync(new URL('./pet/blue-haired-girl-animation/东张西望.webm', import.meta.url)));
  writeFileSync(video, 'custom-look');
  dispose();
  const again = enable();
  assert.deepEqual(JSON.parse(readFileSync(f.config)), actual);
  assert.equal(readFileSync(video, 'utf8'), 'custom-look');
  again();
});


test('游戏动画升级保留原动作与权重，不覆盖自定义素材或重复添加', (t) => {
  const f = fixture(t);
  const old = JSON.parse(readFileSync(new URL('./pet/blue-haired-girl-config.json', import.meta.url)));
  old._plugin = plugin.name;
  old._pluginVersion = '0.1.13';
  old.animations.categories[0].actions = ['超大伸懒腰', '哈欠连天', '悠闲哼歌', '东张西望'];
  writeFileSync(f.saved, JSON.stringify(old));
  const dispose = enable();
  const actual = JSON.parse(readFileSync(f.config));
  assert.deepEqual(actual.animationWeights, old.animationWeights);
  assert.deepEqual(actual.animations.categories[0].actions, [...old.animations.categories[0].actions, '玩游戏气急败坏', '大口吃零食', '魔法换装-小猪睡衣']);
  assert.deepEqual(actual.pets, old.pets);
  const video = join(f.petRoot, 'blue-haired-girl-animation', '玩游戏气急败坏.webm');
  assert.deepEqual(readFileSync(video), readFileSync(new URL('./pet/blue-haired-girl-animation/玩游戏气急败坏.webm', import.meta.url)));
  writeFileSync(video, 'custom-game');
  dispose();
  const again = enable();
  assert.deepEqual(JSON.parse(readFileSync(f.config)), actual);
  assert.equal(readFileSync(video, 'utf8'), 'custom-game');
  again();
});

test('零食动画升级保留原动作与权重，不覆盖自定义素材或重复添加', (t) => {
  const f = fixture(t);
  const old = JSON.parse(readFileSync(new URL('./pet/blue-haired-girl-config.json', import.meta.url)));
  old._plugin = plugin.name;
  old._pluginVersion = '0.1.14';
  old.animations.categories[0].actions = ['超大伸懒腰', '哈欠连天', '悠闲哼歌', '东张西望', '玩游戏气急败坏'];
  writeFileSync(f.saved, JSON.stringify(old));
  const dispose = enable();
  const actual = JSON.parse(readFileSync(f.config));
  assert.deepEqual(actual.animationWeights, old.animationWeights);
  assert.deepEqual(actual.animations.categories[0].actions, [...old.animations.categories[0].actions, '大口吃零食', '魔法换装-小猪睡衣']);
  assert.deepEqual(actual.pets, old.pets);
  const video = join(f.petRoot, 'blue-haired-girl-animation', '大口吃零食.webm');
  assert.deepEqual(readFileSync(video), readFileSync(new URL('./pet/blue-haired-girl-animation/大口吃零食.webm', import.meta.url)));
  writeFileSync(video, 'custom-snack');
  dispose();
  const again = enable();
  assert.deepEqual(JSON.parse(readFileSync(f.config)), actual);
  assert.equal(readFileSync(video, 'utf8'), 'custom-snack');
  again();
});


test('五秒待机升级保留配置与自定义同名素材，余额事件仍使用独立名称', (t) => {
  const f = fixture(t);
  const dispose = enable();
  dispose();
  const old = JSON.parse(readFileSync(f.saved));
  old._pluginVersion = '0.1.15';
  old.pets[0].size = 350;
  writeFileSync(f.saved, JSON.stringify(old));
  const balance = join(f.petRoot, 'blue-haired-girl-animation', '余额展示.webm');
  assert.deepEqual(readFileSync(balance), readFileSync(f.video));
  writeFileSync(f.video, 'custom-idle');
  writeFileSync(balance, 'custom-balance');
  const again = enable();
  const actual = JSON.parse(readFileSync(f.config));
  assert.deepEqual(actual, { ...old, _pluginVersion: '0.1.21' });
  assert.deepEqual(actual.animations.idle, ['待机呼吸']);
  assert.deepEqual(actual.animations.events.balance, ['余额展示']);
  assert.equal(readFileSync(f.video, 'utf8'), 'custom-idle');
  assert.equal(readFileSync(balance, 'utf8'), 'custom-balance');
  again();
});


test('摸头开心升级只补入点击池，保留其他动作、自定义素材及后续清空设置', (t) => {
  const f = fixture(t);
  const old = JSON.parse(readFileSync(new URL('./pet/blue-haired-girl-config.json', import.meta.url)));
  old._plugin = plugin.name;
  old._pluginVersion = '0.1.16';
  old.animations.clicks = ['自定义点击'];
  writeFileSync(f.saved, JSON.stringify(old));
  const dispose = enable();
  const actual = JSON.parse(readFileSync(f.config));
  assert.deepEqual(actual, {
    ...old, _pluginVersion: '0.1.21',
    animations: { ...old.animations, clicks: ['自定义点击', '点击回应-摸头开心', '点击回应-生气傲娇'] },
  });
  const video = join(f.petRoot, 'blue-haired-girl-animation', '点击回应-摸头开心.webm');
  assert.deepEqual(readFileSync(video), readFileSync(new URL('./pet/blue-haired-girl-animation/点击回应-摸头开心.webm', import.meta.url)));
  dispose();
  const again = enable();
  assert.deepEqual(JSON.parse(readFileSync(f.config)), actual);
  actual.animations.clicks = [];
  writeFileSync(f.config, JSON.stringify(actual));
  writeFileSync(video, 'custom-headpat');
  again();
  const third = enable();
  assert.deepEqual(JSON.parse(readFileSync(f.config)).animations.clicks, []);
  assert.equal(readFileSync(video, 'utf8'), 'custom-headpat');
  third();
});


test('魔法换装只进入日常随机池，保留点击动作、权重及用户自定义素材', (t) => {
  const f = fixture(t);
  const old = JSON.parse(readFileSync(new URL('./pet/blue-haired-girl-config.json', import.meta.url)));
  old._plugin = plugin.name;
  old._pluginVersion = '0.1.17';
  old.animations.categories[0].actions = ['已有动作'];
  old.animations.categories[0].weight = 27;
  old.animations.clicks = ['点击回应-摸头开心', '自定义点击'];
  writeFileSync(f.saved, JSON.stringify(old));
  const dispose = enable();
  const actual = JSON.parse(readFileSync(f.config));
  const expected = structuredClone(old);
  expected._pluginVersion = '0.1.21';
  expected.animations.categories[0].actions.push('魔法换装-小猪睡衣');
  expected.animations.clicks.push('点击回应-生气傲娇');
  assert.deepEqual(actual, expected);
  const video = join(f.petRoot, 'blue-haired-girl-animation', '魔法换装-小猪睡衣.webm');
  assert.deepEqual(readFileSync(video), readFileSync(new URL('./pet/blue-haired-girl-animation/魔法换装-小猪睡衣.webm', import.meta.url)));
  dispose();
  const again = enable();
  assert.deepEqual(JSON.parse(readFileSync(f.config)), actual);
  actual.animations.categories[0].actions = ['已有动作'];
  writeFileSync(f.config, JSON.stringify(actual));
  writeFileSync(video, 'custom-outfit');
  again();
  const third = enable();
  assert.deepEqual(JSON.parse(readFileSync(f.config)), actual);
  assert.equal(readFileSync(video, 'utf8'), 'custom-outfit');
  third();
});

test('独立应用直接接入菜单，不在引擎首次启动期间重载窗口', async (t) => {
  fixture(t);
  const calls = [];
  const dispose = enable({ petRequest: async (route, options) => {
    calls.push(route);
    if (route.startsWith('menu/events')) return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
    return {};
  } });
  await setImmediate();
  assert.equal(calls[0], 'menu/item');
  assert.ok(!calls.includes('reload'));
  dispose();
  await setImmediate();
  assert.ok(calls.includes('reload'));
});

test('表情包升级补齐十八张，保留自定义图片和描述，删除配置后不重复添加', (t) => {
  const f = fixture(t);
  const old = { _plugin: plugin.name, _pluginVersion: '0.1.18', pets: [{ id: 'mine', size: 348 }],
    memes: { '小团团-你好呀': '用户描述', '自己的表情': '用户自己的图片' } };
  writeFileSync(f.saved, JSON.stringify(old));
  const dir = join(f.petRoot, 'blue-haired-girl-memes');
  mkdirSync(dir);
  const custom = join(dir, '小团团-你好呀.png');
  writeFileSync(custom, 'custom-image');
  const dispose = enable();
  const actual = JSON.parse(readFileSync(f.config));
  assert.equal(actual._pluginVersion, '0.1.21');
  assert.equal(Object.keys(actual.memes).length, 19);
  assert.equal(actual.memes['小团团-你好呀'], '用户描述');
  assert.equal(actual.memes['自己的表情'], '用户自己的图片');
  assert.equal(readFileSync(custom, 'utf8'), 'custom-image');
  assert.deepEqual(actual.pets, old.pets);
  actual.memes = {};
  writeFileSync(f.config, JSON.stringify(actual));
  dispose();
  const again = enable();
  assert.deepEqual(JSON.parse(readFileSync(f.config)), actual);
  again();
});

test('表情包目录及文件拒绝符号链接，不覆盖外部文件', (t) => {
  const f = fixture(t);
  const dir = join(f.petRoot, 'blue-haired-girl-memes');
  const outside = join(f.home, 'outside-memes');
  mkdirSync(outside);
  symlinkSync(outside, dir, 'dir');
  assert.throws(enable, /符号链接/);
  rmSync(dir);
  mkdirSync(dir);
  const target = join(outside, 'keep.png');
  writeFileSync(target, 'keep');
  symlinkSync(target, join(dir, '小团团-你好呀.png'));
  assert.throws(enable, /非普通文件/);
  assert.equal(readFileSync(target, 'utf8'), 'keep');
});

test('第二组表情升级保留旧池删项、自定义描述及素材，重启不补回删项', (t) => {
  const f = fixture(t);
  const old = { _plugin: plugin.name, _pluginVersion: '0.1.19', pets: [{ id: 'mine', size: 348 }],
    memes: { '小团团-你好呀': '旧描述', '小团团-谢谢': '自定义感谢' } };
  writeFileSync(f.saved, JSON.stringify(old));
  const dir = join(f.petRoot, 'blue-haired-girl-memes');
  mkdirSync(dir);
  const custom = join(dir, '小团团-谢谢.png');
  writeFileSync(custom, 'custom-thanks');
  const dispose = enable();
  const actual = JSON.parse(readFileSync(f.config));
  assert.equal(actual._pluginVersion, '0.1.21');
  assert.equal(Object.keys(actual.memes).length, 10);
  assert.equal(actual.memes['小团团-好耶'], undefined);
  assert.equal(actual.memes['小团团-谢谢'], '自定义感谢');
  assert.equal(readFileSync(custom, 'utf8'), 'custom-thanks');
  assert.deepEqual(actual.pets, old.pets);
  delete actual.memes['小团团-晚安'];
  writeFileSync(f.config, JSON.stringify(actual));
  dispose();
  const again = enable();
  assert.deepEqual(JSON.parse(readFileSync(f.config)), actual);
  again();
});

test('生气傲娇仅升级点击池，保留随机池、用户设置与同名素材，后续清空不补回', (t) => {
  const f = fixture(t);
  const old = JSON.parse(readFileSync(new URL('./pet/blue-haired-girl-config.json', import.meta.url)));
  old._plugin = plugin.name;
  old._pluginVersion = '0.1.20';
  old.animations.clicks = ['点击回应-摸头开心', '自定义点击'];
  old.pets[0].size = 348;
  writeFileSync(f.saved, JSON.stringify(old));
  const dispose = enable();
  const actual = JSON.parse(readFileSync(f.config));
  assert.deepEqual(actual, { ...old, _pluginVersion: '0.1.21',
    animations: { ...old.animations, clicks: [...old.animations.clicks, '点击回应-生气傲娇'] } });
  assert.ok(!actual.animations.categories.some((c) => c.actions.includes('点击回应-生气傲娇')));
  const video = join(f.petRoot, 'blue-haired-girl-animation', '点击回应-生气傲娇.webm');
  assert.deepEqual(readFileSync(video), readFileSync(new URL('./pet/blue-haired-girl-animation/点击回应-生气傲娇.webm', import.meta.url)));
  actual.animations.clicks = [];
  writeFileSync(f.config, JSON.stringify(actual));
  writeFileSync(video, 'custom-tsundere');
  dispose();
  const again = enable();
  assert.deepEqual(JSON.parse(readFileSync(f.config)), actual);
  assert.equal(readFileSync(video, 'utf8'), 'custom-tsundere');
  again();
});
