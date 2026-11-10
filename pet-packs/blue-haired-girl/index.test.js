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
  plugin.apply({ ...services, effect(fn) { dispose = fn(); } });
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
  assert.deepEqual(config.animationWeights, { idle: 100, turn: 0, move: 0 });
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
  ctx.provide('webServer', { getOrigin() { throw new Error('No HTTP in this test'); } });
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
    for (let i = 0; i < 100 && calls.filter((c) => c.method === 'POST').length < count; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(calls.filter((c) => c.method === 'POST').length, count);
  };
  const dispose = enable(services);
  await waitForReloads(1);
  dispose();
  await waitForReloads(2);
  assert.equal(calls.length, 4);
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
