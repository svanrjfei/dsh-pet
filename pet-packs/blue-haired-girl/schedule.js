import { existsSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { playPickup } from './pickup.js';

export const schedulePath = '/xiaotuantuan/schedule';
const defaults = { enabled: false, time: '18:00', days: [1, 2, 3, 4, 5] };

export function validateSchedule(value) {
  if (!value || typeof value.enabled !== 'boolean' || typeof value.time !== 'string' ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time) || !Array.isArray(value.days) ||
      value.days.length > 7 || value.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
      new Set(value.days).size !== value.days.length || (value.enabled && !value.days.length)) {
    throw new Error('请填写有效时间，并至少选择一个重复星期。');
  }
  return { enabled: value.enabled, time: value.time, days: [...value.days] };
}

export function createScheduleStore(file) {
  const checkFile = () => {
    try { if (!lstatSync(file).isFile()) throw new Error('定时设置必须是普通文件。'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
  checkFile();
  const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : defaults;
  let settings = validateSchedule(saved);
  let lastRun = typeof saved.lastRun === 'string' ? saved.lastRun : '';
  const persist = (next, run) => {
    checkFile();
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify({ ...next, lastRun: run }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      renameSync(temporary, file);
    } finally { rmSync(temporary, { force: true }); }
    settings = next;
    lastRun = run;
  };
  return {
    read: () => validateSchedule(settings),
    save: (value) => { const next = validateSchedule(value); persist(next, lastRun); return next; },
    claim(now) {
      const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      if (!settings.enabled || !settings.days.includes(now.getDay()) || settings.time !== time) return false;
      const key = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}/${time}`;
      if (lastRun === key) return false;
      // 先记账再播放：同一分钟重启也不会重复；播放失败留待下次计划，不连续重试。
      persist(settings, key);
      return true;
    },
  };
}

export function scheduleRoute(store, connection) {
  return async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const admission = connection.admit(req);
    if ('rejection' in admission) return send(admission.rejection, { error: '无权访问设置。' });
    if (admission.peer.principal.kind !== 'owner') return send(403, { error: '无权修改设置。' });
    if (req.method === 'GET') return send(200, store.read());
    if (req.method !== 'PUT') return send(405, { error: '不支持的请求方式。' });
    if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: '需要 JSON 格式。' });
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 4096) return send(413, { error: '设置内容过长。' });
      }
      let value;
      try { value = validateSchedule(JSON.parse(body)); }
      catch { return send(400, { error: '请填写有效时间，并至少选择一个重复星期。' }); }
      return send(200, store.save(value));
    } catch { return send(500, { error: '保存失败，原设置已保留。' }); }
  };
}

export function startSchedule(store, api, pets, signal, warn) {
  let busy = false;
  const tick = async () => {
    if (signal.aborted || busy) return;
    busy = true;
    try {
      const visible = pets().filter((pet) => ['desktop', 'both'].includes(pet.display));
      if (visible.length && store.claim(new Date())) {
        await Promise.all(visible.map((pet) => playPickup(api, pet.id, signal)));
      }
    } catch { if (!signal.aborted) warn(); }
    finally { busy = false; }
  };
  if (signal.aborted) return;
  const timer = setInterval(() => void tick(), 1000);
  timer.unref();
  signal.addEventListener('abort', () => clearInterval(timer), { once: true });
}
