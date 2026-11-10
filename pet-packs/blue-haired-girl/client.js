window.__ModuleLoader__.load({
  id: 'dsh-pet-xiaotuantuan',
  factory: (require) => {
    const { createElement: h, useEffect, useState } = require('react');
    const path = '/xiaotuantuan/schedule';
    async function request(options) {
      const response = await fetch(path, options);
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || '无法读取定时设置。');
      return value;
    }
    function ScheduleSettings() {
      const [settings, setSettings] = useState(null);
      const [busy, setBusy] = useState(false);
      const [message, setMessage] = useState('');
      useEffect(() => {
        const abort = new AbortController();
        request({ signal: abort.signal }).then(setSettings).catch((error) => {
          if (!abort.signal.aborted) setMessage(error.message);
        });
        return () => abort.abort();
      }, []);
      const change = (patch) => { setSettings({ ...settings, ...patch }); setMessage(''); };
      const save = async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage('');
        try {
          setSettings(await request({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings) }));
          setMessage('已保存');
        } catch (error) { setMessage(error.message); }
        finally { setBusy(false); }
      };
      return h('section', { style: { maxWidth: 520, color: 'var(--dsw-alias-label-primary)' } },
        h('h2', null, '小团团'),
        settings ? h('form', { onSubmit: save },
          h('fieldset', { disabled: busy, style: { border: 0, padding: 0, display: 'grid', gap: 18 } },
            h('label', null, h('input', { type: 'checkbox', checked: settings.enabled, onChange: (event) => change({ enabled: event.target.checked }) }), ' 定时接你下班'),
            h('label', null, '播放时间 ', h('input', { type: 'time', required: true, value: settings.time, onChange: (event) => change({ time: event.target.value }) })),
            h('fieldset', { style: { border: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 14 } },
              h('legend', { style: { marginBottom: 8 } }, '重复星期'),
              ...[1, 2, 3, 4, 5, 6, 0].map((day) => h('label', { key: day },
                h('input', { type: 'checkbox', checked: settings.days.includes(day), onChange: (event) => change({ days: event.target.checked ? [...settings.days, day] : settings.days.filter((value) => value !== day) }) }),
                ` 周${'日一二三四五六'[day]}`))),
            h('small', null, '按电脑本地时间播放。DSH 需保持运行，错过不补播。'),
            h('button', { type: 'submit', style: { justifySelf: 'start', padding: '7px 22px' } }, busy ? '保存中…' : '保存')))
          : h('p', null, message ? '无法加载设置，请确认小团团插件已启用。' : '正在读取…'),
        h('p', { role: 'status', 'aria-live': 'polite' }, message));
    }
    return {
      name: 'dsh-pet-xiaotuantuan', inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', function* () {
          yield ctx.slots.register({ name: 'settings.section', id: 'xiaotuantuan', order: 31, label: () => '小团团' }, ScheduleSettings);
        });
      },
    };
  },
});
