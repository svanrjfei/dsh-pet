import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { rolldown } from 'rolldown';
import { fileURLToPath } from 'node:url';

const bundle = await rolldown({
  input: fileURLToPath(new URL('../../src/client/pet/card/animation-flow.ts', import.meta.url)),
});
const { output } = await bundle.generate({ format: 'cjs' });
await bundle.close();
const module = { exports: {} };
runInNewContext(output[0].code, { module, exports: module.exports, console });
const { createAnimationFlow } = module.exports;

function desktop(pool) {
  function PetSprite() {}
  runInNewContext(readFileSync(new URL('../../runtime/electron-helper/events.js', import.meta.url), 'utf8'), {
    PetSprite,
    console: { log() {} },
    S: { pick: (items) => items[0], pickSlot: (item) => item, whisperBubbleView: (value) => value },
  });
  const played = [];
  const shown = [];
  const pet = Object.assign(new PetSprite(), {
    pet: { id: 'tuantuan' },
    animations: { events: { whisper: pool } },
    anim: 'idle',
    stopMove: () => played.push('stop'),
    playOnce: (name) => played.push(name),
    applyWhisperHold: (event) =>
      shown.push({ text: pet.whisperText, image: pet.whisperImage, duration: event.durationMs }),
  });
  return { played, shown, speak: (...args) => pet.showWhisper(...args) };
}

function web(pool) {
  const played = [];
  const shown = [];
  const hub = {
    card: { animRef: { current: 'idle' }, actions: { setOnce() {}, setAnim: (name) => played.push(name) } },
    cfg: () => ({ id: 'tuantuan' }),
    anims: () => ({ events: { whisper: pool } }),
    stopMotion: () => played.push('stop'),
    bubbles: { showWhisper: (text, { image }, duration) => shown.push({ text, image, duration }) },
  };
  const flow = createAnimationFlow({ useRef: (current) => ({ current }) })(hub, null);
  return { played, shown, speak: flow.speak };
}

for (const [name, setup] of [
  ['desktop', desktop],
  ['web', web],
]) {
  test(`${name}: 缺少或清空碎碎念动画仍显示文字与配图，保留当前动作`, () => {
    for (const pool of [undefined, []]) {
      const f = setup(pool);
      f.speak('喝口水吧', '可爱', undefined, 1234);
      assert.deepEqual(f.shown, [{ text: '喝口水吧', image: '可爱', duration: 1234 }]);
      assert.deepEqual(f.played, []);
    }
  });
  test(`${name}: 已配置动作仍联动，显式关闭动画时只显示气泡`, () => {
    for (const anim of [undefined, false]) {
      const f = setup(['说话']);
      f.speak('你好', '可爱', undefined, 1234, anim);
      assert.equal(f.shown.length, 1);
      assert.deepEqual(f.played, anim === false ? [] : ['stop', '说话']);
    }
  });
}
