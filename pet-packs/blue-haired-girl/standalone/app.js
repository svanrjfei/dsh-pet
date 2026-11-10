import { shell } from 'electron';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { apply } from '../index.js';
import { settingsPage } from './settings-page.js';

export function applyCompanion({ context, origin, token }) {
  const runtime = join(process.env.DSH_HOME, 'app-runtime.json');
  writeFileSync(runtime, JSON.stringify({ origin, token, pid: process.pid }), { mode: 0o600 });
  context.ctx.effect(() => () => rmSync(runtime, { force: true }));
  // 主应用路由已做回环、来源和令牌校验，这里沿用插件的 owner 权限接口。
  const connection = { admit: () => ({ peer: { principal: { kind: 'owner' } } }) };
  const petRequest = async (route, { method = 'GET', body, signal } = {}) => {
    const response = await fetch(new URL(`/dsh-pet-7340/${route}`, origin), {
      method, redirect: 'error',
      headers: { origin, 'x-dsh-pet-token': token, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error('桌宠接口暂时不可用');
    const result = await response.json();
    if (result.ok === false) throw new Error('桌宠操作未完成');
    return result;
  };
  context.ctx.effect(() => context.ctx.webServer.register({
    kind: 'exact', path: '/xiaotuantuan/',
    handler(req, res) {
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
      res.end(settingsPage);
    },
  }));
  apply({
    ...context.ctx, connection, petRequest,
    openScheduleSettings: () => {
      // 令牌放 URL 片段，页面用请求头换 cookie 后清掉片段。
      void shell.openExternal(`${origin}/xiaotuantuan/#token=${token}`);
    },
  });
}
