/** 小团团配置页内的定时接送草稿，沿用插件的定时接口和存储。 */
export function pickupScheduleScript(): string {
  return `
let pickupSchedule = null;
let pickupScheduleDirty = false;
let pickupScheduleError = '';

async function pickupScheduleRequest(method, body) {
  const response = await fetch('/xiaotuantuan/schedule', {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: { 'X-DSH-Pet-Token': TOKEN, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '定时设置暂时不可用');
  return data;
}

async function loadPickupSchedule() {
  try {
    pickupSchedule = await pickupScheduleRequest('GET');
    pickupScheduleDirty = false;
    pickupScheduleError = '';
  } catch (error) {
    pickupScheduleError = error.message || String(error);
  }
}

function pickupScheduleCard() {
  if (!pickupSchedule) return card('定时接你下班', null, [
    make('p', { class: 'status', role: 'status', text: pickupScheduleError || '正在读取…' }),
    button('重新读取', async () => { await loadPickupSchedule(); renderPetsPanel(); }),
  ]);
  const changed = () => { pickupScheduleDirty = true; markDirty(true); };
  const time = make('input', { id: 'pickup-time', type: 'time', value: pickupSchedule.time,
    oninput: () => { pickupSchedule.time = time.value; changed(); } });
  const days = [1, 2, 3, 4, 5, 6, 0].map((day) => toggleRow(
    'pickup-day-' + day, '周' + '日一二三四五六'[day], null, pickupSchedule.days.includes(day),
    (checked) => {
      pickupSchedule.days = pickupSchedule.days.filter((value) => value !== day);
      if (checked) pickupSchedule.days.push(day);
      changed();
    },
  ));
  return card('定时接你下班', '按电脑本地时间播放，小团团需保持运行。', [
    toggleRow('pickup-enabled', '开启定时播放', null, pickupSchedule.enabled,
      (enabled) => { pickupSchedule.enabled = enabled; changed(); }),
    fieldRow('pickup-time', '播放时间', time),
    make('div', { role: 'group', 'aria-labelledby': 'pickup-days-label' }, [
      make('span', { id: 'pickup-days-label', class: 'fieldLabel', text: '重复星期' }),
      make('div', { class: 'grid3' }, days),
    ]),
  ]);
}

function validatePickupSchedule() {
  if (!pickupScheduleDirty) return;
  if (!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(pickupSchedule.time) ||
      (pickupSchedule.enabled && !pickupSchedule.days.length)) {
    throw new Error('请填写有效播放时间，并至少选择一个重复星期。');
  }
}

async function savePickupSchedule() {
  if (!pickupScheduleDirty) return;
  try {
    pickupSchedule = await pickupScheduleRequest('PUT', pickupSchedule);
    pickupScheduleDirty = false;
  } catch (error) {
    throw new Error('外观与互动已保存，定时设置未保存：' + (error.message || String(error)));
  }
}
`;
}
