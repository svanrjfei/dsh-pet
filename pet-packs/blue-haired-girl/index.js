import { createHash } from 'node:crypto';
import { constants, copyFileSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScheduleStore, schedulePath, scheduleRoute, startSchedule } from './schedule.js';
import { runPickupMenu } from './pickup.js';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';

export const name = 'dsh-pet-xiaotuantuan';
export const inject = ['petApi7340', 'webServer', 'connection'];

const prefix = 'blue-haired-girl';
const source = fileURLToPath(new URL('./pet/', import.meta.url));

function regularFile(path) {
  try {
    if (!lstatSync(path).isFile()) throw new Error(`小团团拒绝访问非普通文件：${path}`);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function ownedConfig(path) {
  if (!regularFile(path)) return false;
  const config = JSON.parse(readFileSync(path, 'utf8'));
  if (config._plugin !== name) throw new Error(`已有同名宠物配置，请先移走再启用小团团：${path}`);
  return true;
}

async function connectPetApi(webServer, connection, signal) {
  const origin = webServer.getOrigin();
  const login = new URL(connection.authenticatedUrl(origin));
  if (login.origin !== new URL(origin).origin) throw new Error('Unexpected authentication origin');
  // 宿主要求先在根路径用启动凭据换 cookie；凭据只在内存中使用，不记录、不跟随重定向。
  const auth = await fetch(login, { redirect: 'manual', signal });
  const cookie = auth.headers.getSetCookie().map((value) => value.split(';', 1)[0]).join('; ');
  await auth.body?.cancel();
  if (auth.status >= 400 || !cookie) throw new Error('Desktop authentication failed');
  return async (route, { method = 'GET', body, signal } = {}) => {
    const response = await fetch(new URL(`/dsh-pet-7340/${route}`, origin), {
      method, headers: { cookie, origin, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Pet request failed'); }
    const result = await response.json();
    if (result.ok === false) throw new Error('Pet request rejected');
    return result;
  };
}

export function apply(ctx) {
  const { webServer, connection, logger } = ctx;
  const refresh = async (signal) => {
    const api = await connectPetApi(webServer, connection, signal);
    await api('reload', { method: 'POST', signal });
    return api;
  };
  const warn = () => logger?.warn?.('小团团刷新或招呼菜单连接失败，请重新启用插件。');
  ctx.effect(() => {
    const petRoot = join(resolveDshHome(), 'dsh-pet', 'pet');
    const active = join(petRoot, `${prefix}-config.json`);
    const saved = `${active}.disabled`;
    const animationDir = join(petRoot, `${prefix}-animation`);
    const hasActive = ownedConfig(active);
    const hasSaved = ownedConfig(saved);
    if (hasActive && hasSaved) throw new Error('小团团存在两份配置，请先保留需要的一份再启用。');

    mkdirSync(animationDir, { recursive: true });
    if (!lstatSync(animationDir).isDirectory()) throw new Error('小团团素材目录不能是符号链接。');
    for (const filename of ['待机呼吸.webm', '拖拽悬空.webm', '接你下班.webm']) {
      const video = join(animationDir, filename);
      const bundled = join(source, `${prefix}-animation`, filename);
      if (!regularFile(video)) {
        copyFileSync(bundled, video, constants.COPYFILE_EXCL);
      } else if (filename === '拖拽悬空.webm' &&
        createHash('sha256').update(readFileSync(video)).digest('hex') ===
          '7041f30333a828ff865c3d68ebe6a03b7f3a260397bea96ae75c1158ac351a33') {
        // 只更新 0.1.1 原装素材，用户替换过的同名动画保持不变。
        const temporary = `${video}.upgrade`;
        copyFileSync(bundled, temporary, constants.COPYFILE_EXCL);
        renameSync(temporary, video);
      }
    }
    // 仅为旧版补一次拖拽动作，之后保留用户自己清空或替换的动画池。
    const existing = hasSaved ? saved : hasActive ? active : null;
    if (existing) {
      const config = JSON.parse(readFileSync(existing, 'utf8'));
      let changed = false;
      if (config._pluginVersion === undefined) {
        config.animations ??= {};
        if (config.animations.drag === undefined || (Array.isArray(config.animations.drag) && !config.animations.drag.length)) {
          config.animations.drag = ['拖拽悬空'];
        }
        config._pluginVersion = '0.1.1';
        changed = true;
      }
      if (['0.1.1', '0.1.2'].includes(config._pluginVersion)) {
        config.animations ??= {};
        config.animations.categories ??= [];
        if (!config.animations.categories.some((category) => category.actions?.includes('接你下班'))) {
          config.animations.categories.push({ id: '小团团出行', weight: 10, noMirror: true, actions: ['接你下班'] });
        }
        config._pluginVersion = '0.1.3';
        changed = true;
      }
      if (changed) {
        const temporary = `${existing}.upgrade`;
        writeFileSync(temporary, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
        renameSync(temporary, existing);
      }
    }
    // 先放完整素材，再让 dsh-pet 扫描到配置；再次启用保留用户改过的名称、大小和位置。
    if (hasSaved) renameSync(saved, active);
    else if (!hasActive) {
      const config = JSON.parse(readFileSync(join(source, `${prefix}-config.json`), 'utf8'));
      writeFileSync(active, JSON.stringify({ ...config, _plugin: name, _pluginVersion: '0.1.3' }, null, 2) + '\n', { flag: 'wx' });
    }
    const schedule = createScheduleStore(join(petRoot, '../xiaotuantuan-schedule.json'));
    const unregisterSchedule = webServer.register({ kind: 'exact', path: schedulePath, handler: scheduleRoute(schedule, connection) });
    const pets = () => JSON.parse(readFileSync(active, 'utf8')).pets;
    const abort = new AbortController();
    void refresh(AbortSignal.any([abort.signal, AbortSignal.timeout(3000)]))
      .then((api) => {
        startSchedule(schedule, api, pets, abort.signal, () => logger?.warn?.('小团团定时播放失败，请检查桌宠是否可用。'));
        return runPickupMenu(api, () => pets().map((pet) => pet.id), abort.signal, warn);
      })
      .catch(() => { if (!abort.signal.aborted) warn(); });
    logger?.info?.('小团团已启用。');

    return () => {
      abort.abort();
      unregisterSchedule();
      // shortcut: pet pack 是 DSH_HOME 级共享配置，同一数据目录仅启用一份本插件。
      if (ownedConfig(active)) {
        if (regularFile(saved)) throw new Error('小团团停用备份已存在，保留当前配置以避免覆盖。');
        renameSync(active, saved);
      }
      void refresh(AbortSignal.timeout(3000)).catch(warn);
      logger?.info?.('小团团已停用，设置与素材已保留。');
    };
  });
}
