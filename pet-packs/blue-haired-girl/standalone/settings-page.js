export const settingsPage = `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>小团团 · 定时设置</title>
<style>
body{font:16px/1.7 system-ui;margin:0;background:#faf7fc;color:#332b40}main{max-width:440px;margin:48px auto;padding:28px;background:white;border-radius:20px}h1{font-size:24px;margin:0 0 24px}fieldset{border:0;padding:0;margin:20px 0}label{display:inline-flex;align-items:center;gap:8px}input{font:inherit;accent-color:#8755c1}input[type=time]{border:1px solid #ddd;border-radius:8px;padding:6px}.days{display:flex;gap:12px;flex-wrap:wrap}button{font:inherit;background:#8755c1;color:white;border:0;border-radius:10px;padding:8px 26px;cursor:pointer}small{display:block;color:#777;margin:20px 0}a{color:#7045a3}#status{min-height:28px}
</style><main><h1>小团团 · 定时设置</h1>
<form id="form"><fieldset id="fields" disabled>
<label><input type="checkbox" id="enabled">定时接你下班</label>
<fieldset><label for="time">播放时间</label> <input type="time" id="time" required></fieldset>
<fieldset><legend>重复星期</legend><div class="days" id="days"></div></fieldset>
<small>按电脑本地时间播放，小团团需保持运行。</small><button type="submit">保存</button>
</fieldset></form><p id="status" role="status" aria-live="polite">正在读取…</p><a href="/standalone-ai/">桌宠设置</a></main>
<script>
const token=new URLSearchParams(location.hash.slice(1)).get('token')||'';
history.replaceState(null,'',location.pathname);
const fields=document.getElementById('fields'),status=document.getElementById('status');
const enabled=document.getElementById('enabled'),time=document.getElementById('time');
for(const day of [1,2,3,4,5,6,0]){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=day;input.name='day';label.append(input,document.createTextNode('周'+'日一二三四五六'[day]));document.getElementById('days').append(label)}
async function request(options){const response=await fetch('/xiaotuantuan/schedule',{...options,headers:{...options?.headers,...(token?{'x-dsh-pet-token':token}:{})}});const value=await response.json();if(!response.ok)throw new Error(value.error||'无法读取设置');return value}
function show(value){enabled.checked=value.enabled;time.value=value.time;for(const input of document.querySelectorAll('[name=day]'))input.checked=value.days.includes(Number(input.value))}
request().then(value=>{show(value);fields.disabled=false;status.textContent=''}).catch(error=>status.textContent=error.message);
document.getElementById('form').onsubmit=async event=>{event.preventDefault();fields.disabled=true;try{const days=[...document.querySelectorAll('[name=day]:checked')].map(input=>Number(input.value));show(await request({method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({enabled:enabled.checked,time:time.value,days})}));status.textContent='已保存'}catch(error){status.textContent=error.message}finally{fields.disabled=false}};
</script></html>`;
