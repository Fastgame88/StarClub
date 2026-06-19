const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const content = $('#content');
const title = $('#title');
const keyInput = $('#apiKey');
let tab = 'dashboard';
keyInput.value = localStorage.getItem('starclub_admin_key') || 'change-this-admin-key';

function key(){ return localStorage.getItem('starclub_admin_key') || keyInput.value || 'change-this-admin-key'; }
async function api(path, options={}){
  const res = await fetch(path,{...options,headers:{'Content-Type':'application/json','x-admin-key':key(),...(options.headers||{})}});
  const data = await res.json().catch(()=>({}));
  if(!res.ok||data.ok===false) throw new Error(data.message||data.error||'Admin API error');
  return data;
}
function esc(v){return String(v ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function num(n){return new Intl.NumberFormat('uk-UA').format(Number(n||0));}
function money(n){return `${num(n)} грн`;}
function dt(s){return s?new Date(s).toLocaleString('uk-UA'):'—';}
function val(form, name){return new FormData(form).get(name);}
function check(form, name){return new FormData(form).has(name);}
function uahToCents(v){return v === '' || v == null ? null : Math.round(Number(v)*100);}
function centsToUah(v){return v ? Number(v)/100 : '';}
function activeText(v){return Number(v) ? 'активний' : 'вимкнений';}
function btn(label, attrs=''){ return `<button type="button" ${attrs}>${label}</button>`; }

async function dashboard(){
  title.textContent='Аналітика';
  const {summary}=await api('/api/admin/summary');
  content.innerHTML=`<div class="grid">
    <div class="card metric"><span>Клієнти</span><b>${num(summary.clients)}</b></div>
    <div class="card metric"><span>Активні клієнти</span><b>${num(summary.active)}</b></div>
    <div class="card metric"><span>Зірки на балансах</span><b>${num(summary.stars)} ★</b></div>
    <div class="card metric"><span>Сума чеків</span><b>${money(summary.total_sales_uah)}</b></div>
    <div class="card metric"><span>Чеки</span><b>${num(summary.receipts)}</b></div>
    <div class="card metric"><span>Використано QR</span><b>${num(summary.rewards_used)}</b></div>
  </div>`;
}

async function clients(){
  title.textContent='Клієнти';
  const {clients}=await api('/api/admin/clients');
  content.innerHTML=`<div class="card"><table><thead><tr><th>Клієнт</th><th>Телефон</th><th>Картка</th><th>Баланс</th><th>Профіль</th><th>Статус</th><th></th></tr></thead><tbody>
    ${clients.map(c=>`<tr><td><b>${esc(c.name||'—')}</b><div class="small">${dt(c.registered_at)}</div></td><td>${esc(c.phone||'—')}</td><td>${esc(c.card_number)}</td><td>${num(c.stars_balance)} ★</td><td>${c.profile_progress.percent}%</td><td><span class="pill">${c.registered?'registered':'lead'}</span></td><td><div class="actions"><button data-client="${c.id}">Деталі</button></div></td></tr>`).join('')}
  </tbody></table></div>`;
  $$('[data-client]').forEach(b=>b.onclick=()=>clientDetails(b.dataset.client));
}
async function clientDetails(id){
  const data=await api(`/api/admin/clients/${id}`);
  const c=data.client;
  content.innerHTML=`<div class="card"><h2>${esc(c.name||'Клієнт')} · ${num(c.stars_balance)} ★</h2><p class="small">${esc(c.phone||'')} · ${esc(c.card_number)}</p><div class="actions"><button id="plus100">+100 ★</button><button id="minus100">-100 ★</button><button id="backClients">Назад</button></div></div>
  <div class="card"><h3>Історія зірок</h3><table><tbody>${data.ledger.map(l=>`<tr><td>${dt(l.created_at)}</td><td>${esc(l.description||l.type)}</td><td>${l.amount>0?'+':''}${num(l.amount)} ★</td></tr>`).join('') || '<tr><td colspan="3">Поки немає операцій</td></tr>'}</tbody></table></div>
  <div class="card"><h3>Чеки</h3><table><tbody>${data.receipts.map(r=>`<tr><td>${esc(r.id)}</td><td>${dt(r.purchased_at)}</td><td>${num(r.total_cents/100)} грн</td><td>${num(r.stars_accrued)} ★</td></tr>`).join('') || '<tr><td colspan="4">Поки немає чеків</td></tr>'}</tbody></table></div>`;
  $('#backClients').onclick=clients;
  $('#plus100').onclick=async()=>{await api(`/api/admin/clients/${id}/adjust-stars`,{method:'POST',body:JSON.stringify({amount:100,description:'Ручне коригування +100 ★'})});clientDetails(id)};
  $('#minus100').onclick=async()=>{await api(`/api/admin/clients/${id}/adjust-stars`,{method:'POST',body:JSON.stringify({amount:-100,description:'Ручне коригування -100 ★'})});clientDetails(id)};
}

function rewardForm(r={}){
  return `<form id="rewardForm" class="form-grid">
    <input name="name" placeholder="Назва товару" value="${esc(r.name||'')}" required>
    <input name="stars_price" type="number" placeholder="Ціна у зірках" value="${esc(r.stars_price||'')}" required>
    <input name="product_external_id" placeholder="Код товару з 1С" value="${esc(r.product_external_id||'')}">
    <input name="image_url" placeholder="Фото URL" value="${esc(r.image_url||'/assets/star.svg')}">
    <input name="store_id" placeholder="Магазин або all" value="${esc(r.store_id||'all')}">
    <input name="per_client_limit" type="number" placeholder="Ліміт на клієнта" value="${esc(r.per_client_limit||1)}">
    <label class="checkline"><input type="checkbox" name="is_active" ${r.id ? (Number(r.is_active)?'checked':'') : 'checked'}> Активний</label>
    <textarea name="conditions" placeholder="Умови отримання">${esc(r.conditions||'')}</textarea>
    <button>${r.id?'Зберегти':'Додати'}</button>
    ${r.id ? '<button type="button" id="cancelEdit">Скасувати</button>' : ''}
  </form>`;
}
async function rewards(editId=null){
  title.textContent='Товари за зірки';
  const {items}=await api('/api/admin/catalog/rewards');
  const edit = editId ? items.find(x=>String(x.id)===String(editId)) : null;
  content.innerHTML=`<div class="card"><h3>${edit?'Редагувати товар':'Додати товар за зірки'}</h3>${rewardForm(edit||{})}</div><div class="card"><table><thead><tr><th>Назва</th><th>Зірки</th><th>1С товар</th><th>Магазин</th><th>Статус</th><th>Дії</th></tr></thead><tbody>${items.map(r=>`<tr><td>${esc(r.name)}</td><td>${num(r.stars_price)} ★</td><td>${esc(r.product_external_id||'—')}</td><td>${esc(r.store_id||'all')}</td><td>${activeText(r.is_active)}</td><td class="actions">${btn('Редагувати',`data-edit-reward="${r.id}"`)}${btn('Видалити',`data-delete-reward="${r.id}"`)}</td></tr>`).join('')}</tbody></table></div>`;
  const form=$('#rewardForm');
  form.onsubmit=async ev=>{ev.preventDefault();const body={name:val(form,'name'),stars_price:Number(val(form,'stars_price')),product_external_id:val(form,'product_external_id'),image_url:val(form,'image_url')||'/assets/star.svg',store_id:val(form,'store_id')||'all',per_client_limit:Number(val(form,'per_client_limit')||1),conditions:val(form,'conditions'),is_active:check(form,'is_active')}; await api(edit?`/api/admin/catalog/rewards/${edit.id}`:'/api/admin/catalog/rewards',{method:edit?'PATCH':'POST',body:JSON.stringify(body)}); rewards();};
  $('#cancelEdit')?.addEventListener('click',()=>rewards());
  $$('[data-edit-reward]').forEach(b=>b.onclick=()=>rewards(b.dataset.editReward));
  $$('[data-delete-reward]').forEach(b=>b.onclick=async()=>{if(confirm('Видалити товар за зірки?')){await api(`/api/admin/catalog/rewards/${b.dataset.deleteReward}`,{method:'DELETE'});rewards();}});
}

function offerCondition(o){
  if(o.type==='wholesale' && o.tiers_json) return JSON.parse(o.tiers_json).map(t=>`від ${t.qty} шт — ${t.price} грн`).join('; ');
  if(o.stars_multiplier) return `x${o.stars_multiplier} зірок`;
  if(o.club_price_cents) return `${num(o.club_price_cents/100)} грн`;
  return '—';
}
function offerForm(o={}){
  let tiers=[]; try{tiers=o.tiers_json?JSON.parse(o.tiers_json):[]}catch{}
  const p1=tiers[0]?.price||'', p2=tiers[1]?.price||'', p3=tiers[2]?.price||'';
  return `<form id="offerForm" class="form-grid">
    <select name="type"><option value="club" ${o.type==='club'?'selected':''}>Клубна ціна</option><option value="stars_multiplier" ${o.type==='stars_multiplier'?'selected':''}>Множник зірок</option><option value="wholesale" ${o.type==='wholesale'?'selected':''}>Оптова ціна</option></select>
    <input name="name" placeholder="Назва" value="${esc(o.name||'')}" required><input name="description" placeholder="Опис" value="${esc(o.description||'')}"><input name="image_url" placeholder="Фото URL" value="${esc(o.image_url||'/assets/star.svg')}">
    <input name="club_price_uah" type="number" step="0.01" placeholder="Клубна ціна грн" value="${esc(centsToUah(o.club_price_cents))}"><input name="old_price_uah" type="number" step="0.01" placeholder="Стара ціна грн" value="${esc(centsToUah(o.old_price_cents))}"><input name="stars_multiplier" type="number" step="0.1" placeholder="Множник зірок" value="${esc(o.stars_multiplier||'')}"><input name="store_id" placeholder="Магазин або all" value="${esc(o.store_id||'all')}">
    <input name="price1" type="number" step="0.01" placeholder="Опт: ціна від 1 шт" value="${esc(p1)}"><input name="price2" type="number" step="0.01" placeholder="Опт: ціна від 2 шт" value="${esc(p2)}"><input name="price3" type="number" step="0.01" placeholder="Опт: ціна від 3 шт" value="${esc(p3)}"><label class="checkline"><input type="checkbox" name="is_active" ${o.id?(Number(o.is_active)?'checked':''):'checked'}> Активна</label>
    <button>${o.id?'Зберегти':'Створити'}</button>${o.id?'<button type="button" id="cancelEdit">Скасувати</button>':''}
  </form>`;
}
async function offers(editId=null){
  title.textContent='Пропозиції';
  const {offers}=await api('/api/admin/catalog/offers');
  const edit=editId?offers.find(x=>String(x.id)===String(editId)):null;
  content.innerHTML=`<div class="card"><h3>${edit?'Редагувати пропозицію':'Створити пропозицію'}</h3>${offerForm(edit||{})}</div><div class="card"><table><thead><tr><th>Тип</th><th>Назва</th><th>Умова</th><th>Магазин</th><th>Статус</th><th>Дії</th></tr></thead><tbody>${offers.map(o=>`<tr><td>${esc(o.type)}</td><td>${esc(o.name)}</td><td>${esc(offerCondition(o))}</td><td>${esc(o.store_id||'all')}</td><td>${activeText(o.is_active)}</td><td class="actions">${btn('Редагувати',`data-edit-offer="${o.id}"`)}${btn('Видалити',`data-delete-offer="${o.id}"`)}</td></tr>`).join('')}</tbody></table></div>`;
  const form=$('#offerForm');
  form.onsubmit=async ev=>{ev.preventDefault();const type=val(form,'type');const tiers=[]; if(val(form,'price1')) tiers.push({qty:1,price:Number(val(form,'price1'))}); if(val(form,'price2')) tiers.push({qty:2,price:Number(val(form,'price2'))}); if(val(form,'price3')) tiers.push({qty:3,price:Number(val(form,'price3'))}); const body={type,name:val(form,'name'),description:val(form,'description'),image_url:val(form,'image_url')||'/assets/star.svg',club_price_cents:uahToCents(val(form,'club_price_uah')),old_price_cents:uahToCents(val(form,'old_price_uah')),stars_multiplier:val(form,'stars_multiplier')?Number(val(form,'stars_multiplier')):null,store_id:val(form,'store_id')||'all',tiers,is_active:check(form,'is_active')}; await api(edit?`/api/admin/catalog/offers/${edit.id}`:'/api/admin/catalog/offers',{method:edit?'PATCH':'POST',body:JSON.stringify(body)}); offers();};
  $('#cancelEdit')?.addEventListener('click',()=>offers());
  $$('[data-edit-offer]').forEach(b=>b.onclick=()=>offers(b.dataset.editOffer));
  $$('[data-delete-offer]').forEach(b=>b.onclick=async()=>{if(confirm('Видалити пропозицію?')){await api(`/api/admin/catalog/offers/${b.dataset.deleteOffer}`,{method:'DELETE'});offers();}});
}

async function challenges(editId=null){
  title.textContent='Челенджі';
  const {challenges}=await api('/api/admin/catalog/challenges');
  const edit=editId?challenges.find(x=>String(x.id)===String(editId)):null;
  content.innerHTML=`<div class="card"><h3>${edit?'Редагувати челендж':'Створити челендж'}</h3><form id="challengeForm" class="form-grid"><input name="name" placeholder="Назва" value="${esc(edit?.name||'')}" required><input name="description" placeholder="Опис" value="${esc(edit?.description||'')}"><input name="required_visits" type="number" placeholder="Кількість відвідувань" value="${esc(edit?.required_visits||'')}" required><input name="min_total_uah" type="number" step="0.01" placeholder="Мін. чек грн" value="${esc(centsToUah(edit?.min_total_cents)||50)}"><input name="reward_stars" type="number" placeholder="Бонус зірками" value="${esc(edit?.reward_stars||'')}" required><select name="period_type"><option value="week" ${edit?.period_type==='week'?'selected':''}>Тиждень</option><option value="month" ${edit?.period_type==='month'?'selected':''}>Місяць</option></select><input name="store_id" placeholder="Магазин або all" value="${esc(edit?.store_id||'all')}"><label class="checkline"><input type="checkbox" name="is_active" ${edit?(Number(edit.is_active)?'checked':''):'checked'}> Активний</label><button>${edit?'Зберегти':'Створити'}</button>${edit?'<button type="button" id="cancelEdit">Скасувати</button>':''}</form></div><div class="card"><table><thead><tr><th>Назва</th><th>Умова</th><th>Мін. чек</th><th>Бонус</th><th>Статус</th><th>Дії</th></tr></thead><tbody>${challenges.map(c=>`<tr><td>${esc(c.name)}</td><td>${c.required_visits} відвідувань</td><td>${num(c.min_total_cents/100)} грн</td><td>${num(c.reward_stars)} ★</td><td>${activeText(c.is_active)}</td><td class="actions">${btn('Редагувати',`data-edit-challenge="${c.id}"`)}${btn('Видалити',`data-delete-challenge="${c.id}"`)}</td></tr>`).join('')}</tbody></table></div>`;
  const form=$('#challengeForm'); form.onsubmit=async ev=>{ev.preventDefault();const body={name:val(form,'name'),description:val(form,'description'),required_visits:Number(val(form,'required_visits')),min_total_cents:uahToCents(val(form,'min_total_uah'))||0,reward_stars:Number(val(form,'reward_stars')),period_type:val(form,'period_type'),store_id:val(form,'store_id')||'all',is_active:check(form,'is_active')}; await api(edit?`/api/admin/catalog/challenges/${edit.id}`:'/api/admin/catalog/challenges',{method:edit?'PATCH':'POST',body:JSON.stringify(body)});challenges();}; $('#cancelEdit')?.addEventListener('click',()=>challenges()); $$('[data-edit-challenge]').forEach(b=>b.onclick=()=>challenges(b.dataset.editChallenge)); $$('[data-delete-challenge]').forEach(b=>b.onclick=async()=>{if(confirm('Видалити челендж?')){await api(`/api/admin/catalog/challenges/${b.dataset.deleteChallenge}`,{method:'DELETE'});challenges();}});
}

async function stamps(editId=null){
  title.textContent='Накопичувальні програми';
  const {programs}=await api('/api/admin/catalog/stamps');
  const edit=editId?programs.find(x=>String(x.id)===String(editId)):null;
  content.innerHTML=`<div class="card"><h3>${edit?'Редагувати програму':'Створити програму'}</h3><form id="stampForm" class="form-grid"><input name="name" placeholder="Назва" value="${esc(edit?.name||'')}" required><input name="category" placeholder="Категорія з 1С, напр. coffee" value="${esc(edit?.category||'')}" required><input name="required_qty" type="number" placeholder="Кількість" value="${esc(edit?.required_qty||10)}"><input name="reward_stars" type="number" placeholder="Бонус ★" value="${esc(edit?.reward_stars||1000)}"><input name="code" placeholder="Код" value="${esc(edit?.code||'')}"><label class="checkline"><input type="checkbox" name="is_active" ${edit?(Number(edit.is_active)?'checked':''):'checked'}> Активна</label><button>${edit?'Зберегти':'Створити'}</button>${edit?'<button type="button" id="cancelEdit">Скасувати</button>':''}</form></div><div class="card"><table><thead><tr><th>Назва</th><th>Категорія</th><th>Кількість</th><th>Бонус</th><th>Статус</th><th>Дії</th></tr></thead><tbody>${programs.map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.category)}</td><td>${p.required_qty}</td><td>${num(p.reward_stars)} ★</td><td>${activeText(p.is_active)}</td><td class="actions">${btn('Редагувати',`data-edit-stamp="${p.id}"`)}${btn('Видалити',`data-delete-stamp="${p.id}"`)}</td></tr>`).join('')}</tbody></table></div>`;
  const form=$('#stampForm'); form.onsubmit=async ev=>{ev.preventDefault();const body={name:val(form,'name'),category:val(form,'category'),required_qty:Number(val(form,'required_qty')),reward_stars:Number(val(form,'reward_stars')),code:val(form,'code')||undefined,is_active:check(form,'is_active')}; await api(edit?`/api/admin/catalog/stamps/${edit.id}`:'/api/admin/catalog/stamps',{method:edit?'PATCH':'POST',body:JSON.stringify(body)});stamps();}; $('#cancelEdit')?.addEventListener('click',()=>stamps()); $$('[data-edit-stamp]').forEach(b=>b.onclick=()=>stamps(b.dataset.editStamp)); $$('[data-delete-stamp]').forEach(b=>b.onclick=async()=>{if(confirm('Видалити програму?')){await api(`/api/admin/catalog/stamps/${b.dataset.deleteStamp}`,{method:'DELETE'});stamps();}});
}

async function news(editId=null){
  title.textContent='Новини';
  const {news}=await api('/api/admin/catalog/news');
  const edit=editId?news.find(x=>String(x.id)===String(editId)):null;
  content.innerHTML=`<div class="card"><h3>${edit?'Редагувати новину':'Додати новину'}</h3><form id="newsForm" class="form-grid"><input name="title" placeholder="Заголовок" value="${esc(edit?.title||'')}" required><input name="tag" placeholder="Тег" value="${esc(edit?.tag||'')}"><input name="image_url" placeholder="Фото URL" value="${esc(edit?.image_url||'/assets/star.svg')}"><textarea name="text" placeholder="Текст" required>${esc(edit?.text||'')}</textarea><label class="checkline"><input type="checkbox" name="is_active" ${edit?(Number(edit.is_active)?'checked':''):'checked'}> Активна</label><button>${edit?'Зберегти':'Додати'}</button>${edit?'<button type="button" id="cancelEdit">Скасувати</button>':''}</form></div><div class="card"><table><thead><tr><th>Дата</th><th>Тег</th><th>Заголовок</th><th>Текст</th><th>Статус</th><th>Дії</th></tr></thead><tbody>${news.map(n=>`<tr><td>${dt(n.created_at)}</td><td>${esc(n.tag||'')}</td><td>${esc(n.title)}</td><td>${esc(n.text)}</td><td>${activeText(n.is_active)}</td><td class="actions">${btn('Редагувати',`data-edit-news="${n.id}"`)}${btn('Видалити',`data-delete-news="${n.id}"`)}</td></tr>`).join('')}</tbody></table></div>`;
  const form=$('#newsForm'); form.onsubmit=async ev=>{ev.preventDefault();const body={title:val(form,'title'),tag:val(form,'tag'),image_url:val(form,'image_url')||'/assets/star.svg',text:val(form,'text'),is_active:check(form,'is_active')}; await api(edit?`/api/admin/catalog/news/${edit.id}`:'/api/admin/catalog/news',{method:edit?'PATCH':'POST',body:JSON.stringify(body)});news();}; $('#cancelEdit')?.addEventListener('click',()=>news()); $$('[data-edit-news]').forEach(b=>b.onclick=()=>news(b.dataset.editNews)); $$('[data-delete-news]').forEach(b=>b.onclick=async()=>{if(confirm('Видалити новину?')){await api(`/api/admin/catalog/news/${b.dataset.deleteNews}`,{method:'DELETE'});news();}});
}

async function settings(){
  title.textContent='Налаштування';
  const data=await api('/api/admin/settings');
  const map={};
  (data.settings||[]).forEach(s=>map[s.key]=s.value);
  const bonus=map.profile_bonus||{enabled:true,stars:500,grantWhen:'immediately',requiredFields:['phone','name','birth_date','favorite_store']};
  const required=new Set(bonus.requiredFields||[]);
  const field = (name,label) => `<label class="checkline"><input type="checkbox" name="requiredFields" value="${name}" ${required.has(name)?'checked':''}> ${label}</label>`;
  content.innerHTML=`<div class="card"><h2>Бонус за повний профіль</h2><p class="small">Ці параметри керують тим, чи отримує клієнт бонус, який розмір бонусу, коли він нараховується і які поля вважаються повним профілем.</p>
    <form id="bonusSettingsForm" class="form-grid">
      <label class="checkline"><input type="checkbox" name="enabled" ${bonus.enabled!==false?'checked':''}> Давати бонус</label>
      <input name="stars" type="number" min="0" step="1" placeholder="Розмір бонусу, ★" value="${esc(bonus.stars??500)}">
      <select name="grantWhen">
        <option value="immediately" ${bonus.grantWhen!=='after_first_purchase'?'selected':''}>Одразу після повного профілю</option>
        <option value="after_first_purchase" ${bonus.grantWhen==='after_first_purchase'?'selected':''}>Після першої покупки</option>
      </select>
      <div class="card inner"><b>Поля повного профілю</b>
        ${field('phone','Номер телефону')}
        ${field('name','Імʼя')}
        ${field('birth_date','Дата народження')}
        ${field('favorite_store','Улюблений магазин')}
        ${field('email','Email')}
        ${field('preferences','Вподобання')}
      </div>
      <button>Зберегти налаштування</button>
    </form>
  </div>`;
  const form=$('#bonusSettingsForm');
  form.onsubmit=async ev=>{ev.preventDefault();const fd=new FormData(form);const requiredFields=fd.getAll('requiredFields');const body={value:{enabled:fd.has('enabled'),stars:Number(fd.get('stars')||0),grantWhen:fd.get('grantWhen')||'immediately',requiredFields}};await api('/api/admin/settings/profile_bonus',{method:'PUT',body:JSON.stringify(body)});alert('Налаштування бонусу збережено');settings();};
}

async function qrs(){
  title.textContent='QR за зірки';
  const {qrs}=await api('/api/admin/reward-qrs');
  content.innerHTML=`<div class="card"><table><thead><tr><th>Дата</th><th>Клієнт</th><th>Товар</th><th>Код</th><th>Зірки</th><th>Статус</th><th>Діє до</th></tr></thead><tbody>${qrs.map(q=>`<tr><td>${dt(q.created_at)}</td><td>${esc(q.client_name||q.phone)}</td><td>${esc(q.reward_name)}</td><td><b>${esc(q.token)}</b></td><td>${num(q.stars_reserved)} ★</td><td><span class="pill">${esc(q.status)}</span></td><td>${dt(q.expires_at)}</td></tr>`).join('') || '<tr><td colspan="7">Поки QR не створювались</td></tr>'}</tbody></table></div>`;
}
async function audit(){
  title.textContent='Журнал дій';
  const {logs}=await api('/api/admin/audit');
  content.innerHTML=`<div class="card"><table><thead><tr><th>Дата</th><th>Хто</th><th>Дія</th><th>Обʼєкт</th><th>Опис</th></tr></thead><tbody>${logs.map(l=>`<tr><td>${dt(l.created_at)}</td><td>${esc(l.actor_type)} ${esc(l.actor_id||'')}</td><td>${esc(l.action)}</td><td>${esc(l.entity_type||'')} ${esc(l.entity_id||'')}</td><td><pre>${esc(l.payload_json||'')}</pre></td></tr>`).join('') || '<tr><td colspan="5">Журнал порожній</td></tr>'}</tbody></table></div>`;
}
async function render(){
  $$('.sidebar button[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  try{
    if(tab==='dashboard') await dashboard();
    if(tab==='clients') await clients();
    if(tab==='rewards') await rewards();
    if(tab==='offers') await offers();
    if(tab==='challenges') await challenges();
    if(tab==='stamps') await stamps();
    if(tab==='news') await news();
    if(tab==='qrs') await qrs();
    if(tab==='settings') await settings();
    if(tab==='audit') await audit();
  } catch(e){content.innerHTML=`<div class="card"><h2>Помилка</h2><p>${esc(e.message)}</p><p class="small">Перевір ADMIN_API_KEY у .env і введи його у полі зверху.</p></div>`;}
}
$$('.sidebar button[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;render();});
$('#saveKey').onclick=()=>{localStorage.setItem('starclub_admin_key',keyInput.value);render();};
render();
