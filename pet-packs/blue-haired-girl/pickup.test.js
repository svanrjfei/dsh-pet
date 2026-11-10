import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { playPickup, runPickupMenu } from './pickup.js';

test('实际开播后等两秒再招呼，气泡不替换当前动画、不调用语音', async () => {
  const calls = [];
  const api = async (route, options) => {
    calls.push({ route, ...options });
    return route.startsWith('anim?') ? { playbackId: 'test-id' } : { status: 'playing' };
  };
  await playPickup(api, 'custom pet', new AbortController().signal);
  assert.deepEqual(calls.map((call) => call.route), [
    'anim?pet=custom%20pet&surface=desktop',
    'playback/test-id?wait=playing,ended,cancelled,failed&timeout=5000',
    'playback/test-id?wait=ended,cancelled,failed&timeout=2000',
    'broadcast?pet=custom%20pet&surface=desktop',
  ]);
  assert.deepEqual(calls[3].body, { text: '下班啦，快上车！小团团来接你～', duration: 3000, anim: false, speak: false });
});

test('视频未开播、被打断或播放失败均不发送迟到气泡', async () => {
  for (const status of ['accepted', 'ended', 'cancelled', 'failed']) {
    for (const afterStart of [false, true]) {
      let reads = 0;
      const api = async (route) => {
        assert.ok(!route.startsWith('broadcast'));
        if (route.startsWith('anim?')) return { playbackId: 'test-id' };
        return { status: afterStart && reads++ === 0 ? 'playing' : status };
      };
      await playPickup(api, 'pet', new AbortController().signal);
    }
  }
});

test('停用时取消尚未发送的气泡', async () => {
  const abort = new AbortController();
  const api = async (route) => {
    assert.ok(!route.startsWith('broadcast'));
    if (route.includes('timeout=2000')) abort.abort();
    return { playbackId: 'test-id', status: 'playing' };
  };
  await assert.rejects(playPickup(api, 'pet', abort.signal), { name: 'AbortError' });
});

test('菜单只响应自有宠物，重复点播取消旧等待，停用注销菜单', async () => {
  const abort = new AbortController();
  const pending = [];
  const calls = [];
  let polls = 0;
  const api = async (route, options) => {
    calls.push({ route, ...options });
    if (route.startsWith('menu/events')) {
      await setImmediate();
      const pets = ['other-pet', 'own-pet', 'own-pet'];
      if (polls < pets.length) return { events: { '小团团·接你下班': pets[polls++] } };
      abort.abort();
      throw abort.signal.reason;
    }
    if (route.startsWith('anim?')) {
      assert.ok(route.includes('pet=own-pet'));
      return { playbackId: 'test-id' };
    }
    if (route.startsWith('playback/')) {
      pending.push(options.signal);
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    }
    return { ok: true };
  };
  const warnings = [];
  await assert.rejects(runPickupMenu(api, () => ['own-pet'], abort.signal, () => warnings.push('warning')), { name: 'AbortError' });
  assert.equal(pending.length, 2);
  assert.ok(pending.every((signal) => signal.aborted));
  assert.equal(calls[0].body.target, 'desktop');
  assert.equal(calls.at(-1).route, `menu/item?owner=${calls[0].body.owner}`);
  assert.equal(calls.at(-1).method, 'DELETE');
  assert.equal(calls.at(-1).signal.aborted, false);
  assert.deepEqual(warnings, []);
});
