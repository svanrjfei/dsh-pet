import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const pack = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(pack, '../..');
const engine = join(repo, 'dsh-pet');
const output = resolve(process.argv[2] || join(engine, 'dist-app/xiaotuantuan'));
// 在同步目录以外签名，避免 Finder 自动补回的元数据使签名失败。
const buildOutput = mkdtempSync(join(tmpdir(), 'xiaotuantuan-build-'));
const electronDist = process.env.DSH_PET_ELECTRON_DIST || join(homedir(), '.dsh/electron');
if (process.platform !== 'darwin') throw new Error('此脚本用于构建 macOS 应用。');
if (!existsSync(join(electronDist, 'Electron.app'))) throw new Error('请设置 DSH_PET_ELECTRON_DIST 指向本机 Electron 解压目录。');
function run(command, args, cwd = engine) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
  if (result.status !== 0) throw new Error(`${command} 构建失败 (${result.status})`);
}
run('npm', ['run', 'bundle']);
run('npm', ['run', 'build:desktop-core']);
mkdirSync(join(repo, '.tools'), { recursive: true });
const stage = mkdtempSync(join(repo, '.tools/xiaotuantuan-app-'));
for (const name of ['lib', 'runtime', 'assets']) cpSync(join(engine, name), join(stage, name), { recursive: true });
const target = join(stage, 'xiaotuantuan');
mkdirSync(target);
cpSync(join(pack, 'pet'), join(target, 'pet'), { recursive: true });
cpSync(join(pack, 'standalone/launcher.cjs'), join(target, 'launcher.cjs'));
const { rolldown } = await import(pathToFileURL(join(engine, 'node_modules/rolldown/dist/esm/index.mjs')).href);
const bundle = await rolldown({
  input: join(pack, 'standalone/app.js'), platform: 'node', external: [/^node:/, 'electron'],
  plugins: [{ name: 'standalone-home',
    resolveId(id) { if (id === '@deepseek-ai/dsh-home-paths') return '\0standalone-home'; },
    load(id) { if (id === '\0standalone-home') return 'export function resolveDshHome(){if(!process.env.DSH_HOME)throw new Error("Missing standalone home");return process.env.DSH_HOME}'; },
  }],
});
await bundle.write({ format: 'esm', file: join(target, 'app.js') });
await bundle.close();
const metadata = JSON.parse(readFileSync(join(pack, 'package.json'), 'utf8'));
writeFileSync(join(stage, 'package.json'), JSON.stringify({
  name: 'xiaotuantuan-desktop', version: metadata.version, type: 'module', main: 'xiaotuantuan/launcher.cjs',
  description: '小团团独立桌宠', author: 'svanrjfei', license: 'MIT',
}, null, 2));
cpSync(join(repo, 'LICENSE'), join(stage, 'LICENSE'));
run('ffmpeg', ['-v', 'error', '-c:v', 'libvpx-vp9', '-i', join(pack, 'pet/blue-haired-girl-animation/待机呼吸.webm'),
  '-frames:v', '1', '-vf', 'crop=320:360:160:0,scale=455:512,pad=512:512:(ow-iw)/2:0:color=0x00000000',
  '-y', join(stage, 'assets/logo.png')]);
writeFileSync(join(stage, 'package-lock.json'), JSON.stringify({ name: 'xiaotuantuan-desktop', version: metadata.version, lockfileVersion: 3, packages: { '': { name: 'xiaotuantuan-desktop', version: metadata.version } } }));
const version = readFileSync(join(electronDist, 'version'), 'utf8').trim();
// 复制 Electron 后清理 Finder 元数据，否则 macOS 拒绝给新应用签名。
const afterPack = join(stage, 'after-pack.cjs');
writeFileSync(afterPack, `const {spawnSync}=require('node:child_process');const {join}=require('node:path');
module.exports=async ({appOutDir,packager})=>{const app=join(appOutDir,packager.appInfo.productFilename+'.app');for(const attr of ['com.apple.FinderInfo','com.apple.ResourceFork']){const result=spawnSync('/usr/bin/xattr',['-dr',attr,app],{encoding:'utf8'});if(result.status && !result.stderr.includes('No such xattr'))throw new Error(result.stderr)}};`);
const config = {
  appId: 'com.svanrj.xiaotuantuan', productName: '小团团', electronVersion: version, electronDist,
  directories: { app: stage, output: buildOutput }, asar: true, npmRebuild: false, afterPack,
  files: ['lib/**', 'runtime/**', 'xiaotuantuan/**', 'assets/webm/**', 'assets/fonts/**', 'assets/pic/**',
    'assets/memes/**', 'assets/sound/**', 'assets/config.jsonc', 'assets/logo.png', 'package.json', 'LICENSE'],
  mac: { target: 'dir', icon: join(stage, 'assets/logo.png'), identity: '-', hardenedRuntime: false, gatekeeperAssess: false },
};
const configFile = join(stage, 'builder.json');
writeFileSync(configFile, JSON.stringify(config, null, 2));
run(process.execPath, [join(engine, 'node_modules/electron-builder/out/cli/cli.js'), '--projectDir', stage, '--mac', 'dir', `--${process.arch}`, '--config', configFile]);
const appPath = join(buildOutput, `mac-${process.arch}`, '小团团.app');
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath]);
mkdirSync(output, { recursive: true });
run('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--keepParent', appPath, join(output, `小团团-mac-${process.arch}.zip`)]);
console.log(`小团团.app 已生成：${appPath}\n安装包：${output}`);
