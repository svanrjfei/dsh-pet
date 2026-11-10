const { app } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

// 每个应用独立保存配置和 Chromium 缓存，绝不接管 ~/.dsh。
const home = join(app.getPath('appData'), 'Xiaotuantuan');
process.env.DSH_HOME = home;
process.env.DSH_PET_APP_NAME = '小团团';
process.env.DSH_PET_APP_USER_DATA = join(home, 'browser');
app.setName('小团团');
app.setPath('userData', process.env.DSH_PET_APP_USER_DATA);
mkdirSync(join(home, 'dsh-pet'), { recursive: true });
try {
  writeFileSync(join(home, 'dsh-pet/main-config.jsonc'), JSON.stringify({ pets: [{ id: 'main', display: 'none', balanceEnabled: false, whisperEnabled: false, workStatusEnabled: false }], trayEnabled: true }), { flag: 'wx' });
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
import('../lib/app.js').catch((error) => {
  require('electron').dialog.showErrorBox('小团团启动失败', error.message);
  app.exit(1);
});
