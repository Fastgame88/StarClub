const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const content = $('#content');
const title = $('#title');
const keyInput = $('#apiKey');
let tab = 'dashboard';
let editing = null;

keyInput.value = localStorage.getItem('starclub_admin_key') || 'change-this-admin-key';
function key(){ return localStorage.getItem('starclub_admin_key') || keyInput.value || 'change-this-admin-key'; }
async function api(path, options={}){
  const res = await fetch(path,{...options,headers:{'Content-Type':'application/json','x-admin-key':key(),...(options.headers||{})}});
  const data = await res.json().catch(()=>({}));
  if(!res.ok||data.ok===false) throw new Error(data.message||data.error||'Admin API error');
  return data;
}
function num(n){return new Intl.NumberFormat('uk-UA').format(Number(n||0));}
function money(n){return `${num(n)} грн`;}
function dt(s){return s?new Date(s).toLocaleString('uk-UA'):'—';}
function safe(s){return String(s ?? '').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function formData(form){return Object.fromEntries(new FormData(form).entries());}
function confirmDelete(name){return confirm(`Видалити/вимкнути: ${name}?`);}
function setForm(form, data={}){ for(const [k,v] of Object.entries(data)){ const el=form.elements[k]; if(!el) continue; if(el.type==='checkbox') el.checked=!!Number(v); else el.value=v ?? ''; } }
function offerCondition(o){
  if(o.type==='club') return `${num((o.club_price_cents||0)/100)} грн${o.old_price_cents?` замість ${num(o.old_price_cents/100)} грн`:''}`;
  if(o.type==='stars_multiplier') return `x${o.stars_multiplier||2} зірок`;
  const tiers=o.tiers||[];
  return tiers.length?tiers.map(t=>`від ${t.qty} шт — ${t.price} грн`).join(', '):'оптові ціни';
}
function typeLabel(type){return {club:'Клубна ціна',stars_multiplier:'Множник зірок',wholesale:'Оптова ціна'}[type]||type;}
function activePill(row){return `<span class="pill ${Number(row.is_active)===0?'muted':''}">${Number(row.is_active)===0?'вимкнено':'активно'}</span>`;}

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
    ${clients.map(c=>`<tr><td><b>${safe(c.name||'—')}</b><div class="small">${dt(c.registered_at)}</div></td><td>${safe(c.phone||'—')}</td><td>${safe(c.card_number)}</td><td>${num(c.stars_balance)} ★</td><td>${c.profile_progress.percent}%</td><td><span class="pill">${c.registered?'registered':'lead'}</span></td><td><div class="actions"><button data-client="${c.id}">Деталі</button></div></td></tr>`).join('')}
  </tbody></table></div>`;
  $$('[data-client]').forEach(b=>b.onclick=()=>clientDetails(b.dataset.client));
}
async function clientDetails(id){
  const data=await api(`/api/admin/clients/${id}`);
  const c=data.client;
  content.innerHTML=`<div class="card"><h2>${safe(c.name||'Клієнт')} · ${num(c.stars_balance)} ★</h2><p class="small">${safe(c.phone||'')} · ${safe(c.card_number)}</p><div class="actions"><button id="plus100">+100 ★</button><button id="minus100">-100 ★</button><button id="backClients">Назад</button></div></div>
  <div class="card"><h3>Історія зірок</h3><table><tbody>${data.ledger.map(l=>`<tr><td>${dt(l.created_at)}</td><td>${safe(l.description||l.type)}</td><td>${l.amount>0?'+':''}${num(l.amount)} ★</td></tr>`).join('') || '<tr><td colspan="3">Поки немає операцій</td></tr>'}</tbody></table></div>
  <div class="card"><h3>Чеки</h3><table><tbody>${data.receipts.map(r=>`<tr><td>${safe(r.id)}</td><td>${dt(r.purchased_at)}</td><td>${num(r.total_cents/100)} грн</td><td>${num(r.stars_accrued)} ★</td></tr>`).join('') || '<tr><td colspan="4">Поки немає чеків</td></tr>'}</tbody></table></div>`;
  $('#backClients').onclick=clients;
  $('#plus100').onclick=async()=>{await api(`/api/admin/clients/${id}/adjust-stars`,{method:'POST',body:JSON.stringify({amount:100,description:'Ручне нарахування'})}); clientDetails(id)};
  $('#minus100').onclick=async()=>{await api(`/api/admin/clients/${id}/adjust-stars`,{method:'POST',body:JSON.stringify({amount:-100,description:'Ручне списання'})}); clientDetails(id)};
}

async function rewards(){
  title.textContent='Товари за зірки';
  const {items}=await api('/api/admin/catalog/rewards');
  const edit = editing?.type==='reward' ? editing.item : null;
  content.innerHTML=`<div class="card"><h3>${edit?'Редагувати товар':'Створити товар'}</h3><form id="rewardForm" class="form-grid">
    <input name="name" placeholder="Назва товару" required><input name="stars_price" type="number" placeholder="Ціна у зірках" required><input name="product_external_id" placeholder="Код товару з 1С"><input name="image_url" placeholder="Фото URL">
    <input name="store_id" placeholder="Магазин або all" value="all"><input name="per_client_limit" type="number" placeholder="Ліміт на клієнта" value="1"><input name="total_limit" type="number" placeholder="Загальний ліміт"><input name="conditions" placeholder="Умови видачі">
    <button>${edit?'Зберегти':'Створити'}</button>${edit?'<button type="button" id="cancelEdit">Скасувати</button>':''}</form></div>
    <div class="card"><table><thead><tr><th>Назва</th><th>Зірки</th><th>1С товар</th><th>Магазин</th><th>Статус</th><th>Дії</th></tr></thead><tbody>${items.map(r=>`<tr><td>${safe(r.name)}</td><td>${num(r.stars_price)} ★</td><td>${safe(r.product_external_id||'—')}</td><td>${safe(r.store_id||'all')}</td><td>${activePill(r)}</td><td><div class="actions"><button data-edit-reward="${r.id}">Редагувати</button><button data-del-reward="${r.id}">Видалити</button></div></td></tr>`).join('')}</tbody></table></div>`;
  if(edit) setForm($('#rewardForm'), edit);
  $('#cancelEdit')?.addEventListener('click',()=>{editing=null;rewards();});
  $('#rewardForm').onsubmit=async(e)=>{e.preventDefault(); const b=formData(e.target); const url=edit?`/api/admin/catalog/rewards/${edit.id}`:'/api/admin/catalog/rewards'; await api(url,{method:edit?'PATCH':'POST',body:JSON.stringify(b)}); editing=null; rewards();};
  $$('[data-edit-reward]').forEach(b=>b.onclick=()=>{editing={type:'reward',item:items.find(x=>String(x.id)===b.dataset.editReward)};rewards();});
  $$('[data-del-reward]').forEach(b=>b.onclick=async()=>{const item=items.find(x=>String(x.id)===b.dataset.delReward); if(confirmDelete(item?.name||'товар')){await api(`/api/admin/catalog/rewards/${b.dataset.delReward}`,{method:'DELETE'}); rewards();}});
}

async function offers(){
  title.textContent='Пропозиції';
  const {offers}=await api('/api/admin/catalog/offers');
  const edit = editing?.type==='offer' ? editing.item : null;
  const tiers=edit?.tiers||[];
  content.innerHTML=`<div class="card"><h3>${edit?'Редагувати пропозицію':'Створити пропозицію'}</h3><form id="offerForm" class="form-grid">
    <select name="type"><option value="club">Клубна ціна</option><option value="stars_multiplier">Подвійні/потрійні зірки</option><option value="wholesale">Оптова ціна</option></select>
    <input name="name" placeholder="Назва" required><input name="description" placeholder="Опис"><input name="image_url" placeholder="Фото URL">
    <input name="club_price_uah" type="number" step="0.01" placeholder="Клубна ціна, грн"><input name="old_price_uah" type="number" step="0.01" placeholder="Стара ціна, грн"><input name="stars_multiplier" type="number" step="0.1" placeholder="Множник зірок, напр. 2"><input name="store_id" placeholder="Магазин або all" value="all">
    <input name="tier_1_price" type="number" step="0.01" placeholder="Опт: 1 шт грн"><input name="tier_2_price" type="number" step="0.01" placeholder="Опт: від 2 шт грн"><input name="tier_3_price" type="number" step="0.01" placeholder="Опт: від 3 шт грн"><input name="category" placeholder="Категорія з 1С">
    <button>${edit?'Зберегти':'Створити'}</button>${edit?'<button type="button" id="cancelEdit">Скасувати</button>':''}</form></div>
    <div class="card"><table><thead><tr><th>Тип</th><th>Назва</th><th>Умова</th><th>Магазин</th><th>Статус</th><th>Дії</th></tr></thead><tbody>${offers.map(o=>`<tr><td>${typeLabel(o.type)}</td><td>${safe(o.name)}</td><td>${safe(offerCondition(o))}</td><td>${safe(o.store_id||'all')}</td><td>${activePill(o)}</td><td><div class="actions"><button data-edit-offer="${o.id}">Редагувати</button><button data-del-offer="${o.id}">Видалити</button></div></td></tr>`).join('')}</tbody></table></div>`;
  if(edit){ setForm($('#offerForm'),{...edit,club_price_uah:edit.club_price_cents?edit.club_price_cents/100:'',old_price_uah:edit.old_price_cents?edit.old_price_cents/100:'',tier_1_price:tiers[0]?.price||'',tier_2_price:tiers[1]?.price||'',tier_3_price:tiers[2]?.price||''}); }
  $('#cancelEdit')?.addEventListener('click',()=>{editing=null;offers();});
  $('#offerForm').onsubmit=async(e)=>{e.preventDefault(); const b=formData(e.target); const url=edit?`/api/admin/catalog/offers/${edit.id}`:'/api/admin/catalog/offers'; await api(url,{method:edit?'PATCH':'POST',body:JSON.stringify(b)}); editing=null; offers();};
  $$('[data-edit-offer]').forEach(b=>b.onclick=()=>{editing={type:'offer',item:offers.find(x=>String(x.id)===b.dataset.editOffer)};offers();});
  $$('[data-del-offer]').forEach(b=>b.onclick=async()=>{const item=offers.find(x=>String(x.id)===b.dataset.delOffer); if(confirmDelete(item?.name||'пропозицію')){await api(`/api/admin/catalog/offers/${b.dataset.delOffer}`,{method:'DELETE'}); offers();}});
}

async function challenges(){
  title.textContent='Челенджі';
  const {challenges}=await api('/api/admin/catalog/challenges');
  const edit=editing?.type==='challenge'?editing.item:null;
  content.innerHTML=`<div class="card"><h3>${edit?'Редагувати челендж':'Створити челендж'}</h3><form id="challengeForm" class="form-grid"><input name="name" placeholder="Назва" required><input name="description" placeholder="Опис"><input name="required_visits" type="number" placeholder="Відвідувань" required><input name="min_total_cents" type="number" placeholder="Мін. чек коп." value="5000"><input name="reward_stars" type="number" placeholder="Бонус ★" required><select name="period_type"><option value="week">Тиждень</option><option value="month">Місяць</option></select><input name="store_id" value="all"><input name="category" placeholder="Категорія"><button>${edit?'Зберегти':'Створити'}</button>${edit?'<button type="button" id="cancelEdit">Скасувати</button>':''}</form></div><div class="card"><table><thead><tr><th>Назва</th><th>Умова</th><th>Мін. чек</th><th>Бонус</th><th>Статус</th><th>Дії</th></tr></thead><tbody>${challenges.map(c=>`<tr><td>${safe(c.name)}</td><td>${c.required_visits} відвідувань</td><td>${num(c.min_total_cents/100)} грн</td><td>${num(c.reward_stars)} ★</td><td>${activePill(c)}</td><td><div class="actions"><button data-edit-challenge="${c.id}">Редагувати</button><button data-del-challenge="${c.id}">Видалити</button></div></td></tr>`).join('')}</tbody></table></div>`;
  if(edit) setForm($('#challengeForm'), edit);
  $('#cancelEdit')?.addEventListener('click',()=>{editing=null;challenges();});
  $('#challengeForm').onsubmit=async(e)=>{e.preventDefault(); const b=formData(e.target); const url=edit?`/api/admin/catalog/challenges/${edit.id}`:'/api/admin/catalog/challenges'; await api(url,{method:edit?'PATCH':'POST',body:JSON.stringify(b)}); editing=null; challenges();};
  $$('[data-edit-challenge]').forEach(b=>b.onclick=()=>{editing={type:'challenge',item:challenges.find(x=>String(x.id)===b.dataset.editChallenge)};challenges();});
  $$('[data-del-challenge]').forEach(b=>b.onclick=async()=>{const item=challenges.find(x=>String(x.id)===b.dataset.delChallenge); if(confirmDelete(item?.name||'челендж')){await api(`/api/admin/catalog/challenges/${b.dataset.delChallenge}`,{method:'DELETE'}); challenges();}});
}

async function stamps(){
  title.textContent='Накопичувальні';
  const {programs}=await api('/api/admin/catalog/stamps');
  const edit=editing?.type==='stamp'?editing.item:null;
  content.innerHTML=`<div class="card"><h3>${edit?'Редагувати програму':'Створити програму'}</h3><form id="stampForm" class="form-grid"><input name="name" placeholder="Назва" required><input name="category" placeholder="Категорія з 1С, напр. coffee" required><input name="required_qty" type="number" placeholder="Кількість" value="10"><input name="reward_stars" type="number" placeholder="Бонус ★" value="1000"><input name="code" placeholder="Код"><button>${edit?'Зберегти':'Створити'}</button>${edit?'<button type="button" id="cancelEdit">Скасувати</button>':''}</form></div><div class="card"><table><thead><tr><th>Назва</th><th>Категорія</th><th>Кількість</th><th>Бонус</th><th>Статус</th><th>Дії</th></tr></thead><tbody>${programs.map(p=>`<tr><td>${safe(p.name)}</td><td>${safe(p.category)}</td><td>${p.required_qty}</td><td>${num(p.reward_stars)} ★</td><td>${activePill(p)}</td><td><div class="actions"><button data-edit-stamp="${p.id}">Редагувати</button><button data-del-stamp="${p.id}">Видалити</button></div></td></tr>`).join('')}</tbody></table></div>`;
  if(edit) setForm($('#stampForm'), edit);
  $('#cancelEdit')?.addEventListener('click',()=>{editing=null;stamps();});
  $('#stampForm').onsubmit=async(e)=>{e.preventDefault(); const b=formData(e.target); const url=edit?`/api/admin/catalog/stamps/${edit.id}`:'/api/admin/catalog/stamps'; await api(url,{method:edit?'PATCH':'POST',body:JSON.stringify(b)}); editing=null; stamps();};
  $$('[data-edit-stamp]').forEach(b=>b.onclick=()=>{editing={type:'stamp',item:programs.find(x=>String(x.id)===b.dataset.editStamp)};stamps();});
  $$('[data-del-stamp]').forEach(b=>b.onclick=async()=>{const item=programs.find(x=>String(x.id)===b.dataset.delStamp); if(confirmDelete(item?.name||'програму')){await api(`/api/admin/catalog/stamps/${b.dataset.delStamp}`,{method:'DELETE'}); stamps();}});
}

async function news(){
  title.textContent='Новини';
  const {news}=await api('/api/admin/catalog/news');
  const edit=editing?.type==='news'?editing.item:null;
  content.innerHTML=`<div class="card"><h3>${edit?'Редагувати новину':'Додати новину'}</h3><form id="newsForm" class="form-grid"><input name="title" placeholder="Заголовок" required><input name="tag" placeholder="Тег"><input name="image_url" placeholder="Фото URL"><textarea name="text" placeholder="Текст" required></textarea><button>${edit?'Зберегти':'Додати'}</button>${edit?'<button type="button" id="cancelEdit">Скасувати</button>':''}</form></div><div class="card"><table><thead><tr><th>Дата</th><th>Тег</th><th>Заголовок</th><th>Текст</th><th>Статус</th><th>Дії</th></tr></thead><tbody>${news.map(n=>`<tr><td>${dt(n.created_at)}</td><td>${safe(n.tag||'')}</td><td>${safe(n.title)}</td><td>${safe(n.text)}</td><td>${activePill(n)}</td><td><div class="actions"><button data-edit-news="${n.id}">Редагувати</button><button data-del-news="${n.id}">Видалити</button></div></td></tr>`).join('')}</tbody></table></div>`;
  if(edit) setForm($('#newsForm'), edit);
  $('#cancelEdit')?.addEventListener('click',()=>{editing=null;news();});
  $('#newsForm').onsubmit=async(e)=>{e.preventDefault(); const b=formData(e.target); const url=edit?`/api/admin/catalog/news/${edit.id}`:'/api/admin/catalog/news'; await api(url,{method:edit?'PATCH':'POST',body:JSON.stringify(b)}); editing=null; news();};
  $$('[data-edit-news]').forEach(b=>b.onclick=()=>{editing={type:'news',item:news.find(x=>String(x.id)===b.dataset.editNews)};news();});
  $$('[data-del-news]').forEach(b=>b.onclick=async()=>{const item=news.find(x=>String(x.id)===b.dataset.delNews); if(confirmDelete(item?.title||'новину')){await api(`/api/admin/catalog/news/${b.dataset.delNews}`,{method:'DELETE'}); news();}});
}

async function qrs(){
  title.textContent='QR за зірки';
  const {qrs}=await api('/api/admin/reward-qrs');
  content.innerHTML=`<div class="card"><table><thead><tr><th>Дата</th><th>Клієнт</th><th>Товар</th><th>Зірки</th><th>Код вручну</th><th>Статус</th><th>Діє до</th></tr></thead><tbody>${qrs.map(q=>`<tr><td>${dt(q.created_at)}</td><td>${safe(q.client_name||q.phone)}</td><td>${safe(q.reward_name)}</td><td>${num(q.stars_reserved)} ★</td><td><b>${safe(String(q.token||'').replace(/^SCR[-_]?/i,''))}</b></td><td><span class="pill">${safe(q.status)}</span></td><td>${dt(q.expires_at)}</td></tr>`).join('') || '<tr><td colspan="7">Поки QR не створювались</td></tr>'}</tbody></table></div>`;
}

async function audit(){
  title.textContent='Журнал дій';
  const {logs}=await api('/api/admin/audit');
  const label={receipt_imported:'Імпорт чека',reward_qr_created:'Створено QR за зірки',reward_qr_expired:'QR прострочено',reward_qr_finalized:'QR використано',reward_qr_canceled:'QR скасовано',offer_created:'Створено пропозицію',offer_updated:'Оновлено пропозицію',offer_deleted:'Видалено пропозицію',reward_product_created:'Створено товар за зірки',reward_product_updated:'Оновлено товар за зірки',reward_product_deleted:'Видалено товар за зірки'};
  content.innerHTML=`<div class="card"><table><thead><tr><th>Дата</th><th>Хто</th><th>Дія</th><th>Обʼєкт</th><th>Опис</th></tr></thead><tbody>${logs.map(l=>`<tr><td>${dt(l.created_at)}</td><td>${safe(l.actor_type)}${l.actor_id?` · ${safe(l.actor_id)}`:''}</td><td>${safe(label[l.action]||l.action)}</td><td>${safe(l.entity_type||'')} ${safe(l.entity_id||'')}</td><td><pre>${safe(l.payload_json||'')}</pre></td></tr>`).join('') || '<tr><td colspan="5">Журнал порожній</td></tr>'}</tbody></table></div>`;
}

const routes={dashboard,clients,rewards,offers,challenges,stamps,news,qrs,audit};
function render(){editing=null; (routes[tab]||dashboard)().catch(e=>{content.innerHTML=`<div class="card"><h2>Помилка</h2><p>${safe(e.message)}</p><p class="small">Перевір ADMIN_API_KEY у полі зверху.</p></div>`});}
$$('[data-tab]').forEach(b=>b.onclick=()=>{$$('[data-tab]').forEach(x=>x.classList.remove('active'));b.classList.add('active');tab=b.dataset.tab;render();});
$('#saveKey').onclick=()=>{localStorage.setItem('starclub_admin_key',keyInput.value.trim());render();};
render();
