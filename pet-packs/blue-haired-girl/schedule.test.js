import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import { createScheduleStore, scheduleRoute, startSchedule, validateSchedule } from './schedule.js';

function fixture(t) {
  const folder = mkdtempSync(join(tmpdir(), 'xiaotuantuan-schedule-'));
  t.after(() => rmSync(folder, { force: true, recursive: true }));
  const file = join(folder, 'schedule.json');
  return { file, store: createScheduleStore(file) };
}
const setting = { enabled: true, time: '18:00', days: [1, 2, 3, 4, 5] };

test('默认关闭；只在选定星期和本地分钟触发，跨日可重播，重启不重复、不补播', (t) => {
  const { file, store } = fixture(t);
  assert.equal(store.claim(new Date(2026, 10, 10, 18)), false);
  store.save(setting);
  assert.equal(store.claim(new Date(2026, 10, 10, 17, 59)), false);
  assert.equal(store.claim(new Date(2026, 10, 10, 18)), true);
  assert.equal(store.claim(new Date(2026, 10, 10, 18, 0, 30)), false);
  assert.equal(createScheduleStore(file).claim(new Date(2026, 10, 10, 18, 0, 40)), false);
  assert.equal(store.claim(new Date(2026, 10, 11, 18, 1)), false);
  assert.equal(store.claim(new Date(2026, 10, 12, 18)), true);
  assert.equal(store.claim(new Date(2026, 10, 14, 18)), false);
  store.save({ ...setting, time: '19:30', days: [6, 0] });
  assert.equal(store.claim(new Date(2026, 10, 14, 19, 30)), true);
  assert.deepEqual(createScheduleStore(file).read(), { ...setting, time: '19:30', days: [6, 0] });
});

test('拒绝无效输入、损坏文件和符号链接，保留旧设置', (t) => {
  const { file, store } = fixture(t);
  store.save(setting);
  const original = readFileSync(file, 'utf8');
  for (const patch of [{ time: '24:00' }, { time: '18:60' }, { time: '8:00' }, { days: [] }, { days: [7] }, { days: ['1'] }, { days: [1, 1] }, { enabled: 'yes' }]) {
    assert.throws(() => store.save({ ...setting, ...patch }));
    assert.equal(readFileSync(file, 'utf8'), original);
  }
  assert.throws(() => validateSchedule(null));
  writeFileSync(file, '{broken');
  assert.throws(() => createScheduleStore(file));
  assert.equal(readFileSync(file, 'utf8'), '{broken');
  const link = file + '.link';
  symlinkSync(file, link);
  assert.throws(() => createScheduleStore(link), /普通文件/);
});

test('设置路由鉴权、保存和体积校验；GET 不修改配置', async (t) => {
  const { store } = fixture(t);
  const call = async (method, body, admission = { peer: { principal: { kind: 'owner' } } }, type = 'application/json') => {
    const req = Readable.from(body === undefined ? [] : [body]);
    Object.assign(req, { method, headers: { 'content-type': type } });
    let status, result;
    await scheduleRoute(store, { admit: () => admission })(req, {
      writeHead(code) { status = code; }, end(text) { result = JSON.parse(text); },
    });
    return { status, result };
  };
  assert.equal((await call('PUT', JSON.stringify(setting), { rejection: 403 })).status, 403);
  assert.equal((await call('GET', undefined, { peer: { principal: { kind: 'remote' } } })).status, 403);
  assert.equal(store.read().enabled, false);
  assert.equal((await call('PUT', '{')).status, 400);
  assert.equal((await call('PUT', ' '.repeat(4097))).status, 413);
  assert.equal((await call('PUT', '{}', undefined, 'text/plain')).status, 415);
  assert.equal((await call('DELETE')).status, 405);
  assert.deepEqual(await call('PUT', JSON.stringify(setting)), { status: 200, result: setting });
  assert.deepEqual(await call('GET'), { status: 200, result: setting });
});

test('计时器调用现有动画及气泡流程，保存立即生效，停用取消，隐藏宠物不触发', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: new Date(2026, 10, 10, 18).getTime() });
  const { store } = fixture(t);
  const abort = new AbortController();
  t.after(() => abort.abort());
  const calls = [], warnings = [];
  let visible = false;
  startSchedule(store, async (route) => {
    calls.push(route);
    return { playbackId: 'test', status: 'playing' };
  }, () => [{ id: 'own-pet', display: visible ? 'desktop' : 'none' }], abort.signal, () => warnings.push('failed'));
  t.mock.timers.tick(1000);
  await setImmediate();
  store.save(setting);
  t.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(calls.length, 0);
  visible = true;
  t.mock.timers.tick(1000);
  await setImmediate();
  assert.ok(calls.some((route) => route === 'broadcast?pet=own-pet&surface=desktop'));
  t.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(calls.filter((route) => route.startsWith('anim?')).length, 1);
  abort.abort();
  t.mock.timers.tick(86400000);
  await setImmediate();
  assert.equal(calls.filter((route) => route.startsWith('anim?')).length, 1);
  assert.deepEqual(warnings, []);
});
