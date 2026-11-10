import { randomUUID } from 'node:crypto';

const label = '接你下班';

export async function playPickup(api, pet, signal) {
  const target = `pet=${encodeURIComponent(pet)}&surface=desktop`;
  const { playbackId } = await api(`anim?${target}`, { method: 'POST', body: { name: '接你下班' }, signal });
  if (typeof playbackId !== 'string' || !playbackId) throw new Error('Missing playback receipt');
  const playback = `playback/${encodeURIComponent(playbackId)}`;
  const started = await api(`${playback}?wait=playing,ended,cancelled,failed&timeout=5000`, { signal });
  if (started.status !== 'playing') return;
  // 按真实开播计时；等待中被拖拽、换动作或播放失败，就不再说迟到的台词。
  const arrival = await api(`${playback}?wait=ended,cancelled,failed&timeout=2000`, { signal });
  if (arrival.status !== 'playing') return;
  signal.throwIfAborted();
  await api(`broadcast?${target}`, {
    method: 'POST', body: { text: '下班啦，快上车！小团团来接你～', duration: 3000, anim: false, speak: false }, signal,
  });
}

export async function runPickupMenu(api, petIds, signal, warn) {
  // 每次启用独立 owner，旧连接异步注销不会删掉刚启用的新菜单。
  const owner = `xiaotuantuan-${randomUUID()}`;
  let playing;
  try {
    signal.throwIfAborted();
    await api('menu/item', { method: 'POST', body: { owner, labels: [label], target: 'desktop' }, signal });
    while (!signal.aborted) {
      const { events } = await api(`menu/events?owner=${owner}&wait=10000`, { signal });
      const pet = events?.[label];
      if (!pet || !petIds().includes(pet)) continue;
      playing?.abort();
      const current = new AbortController();
      playing = current;
      const playbackSignal = AbortSignal.any([signal, current.signal]);
      void playPickup(api, pet, playbackSignal).catch(() => { if (!playbackSignal.aborted) warn(); });
    }
  } finally {
    playing?.abort();
    await api(`menu/item?owner=${owner}`, { method: 'DELETE', signal: AbortSignal.timeout(3000) });
  }
}
