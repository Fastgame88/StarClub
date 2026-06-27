const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const content = $('#content');
const title = $('#title');
const keyInput = $('#apiKey');
const loginOverlay = $('#adminLogin');
const tg = window.Telegram?.WebApp;
try {
  tg?.ready();
  tg?.expand();
  tg?.setHeaderColor?.('#0b0d11');
  tg?.setBackgroundColor?.('#0b0d11');
} catch {}
let tab = 'dashboard';
let admin = null;
let adminToken = localStorage.getItem('starclub_admin_session') || '';
keyInput.value = localStorage.getItem('starclub_admin_key') || '';
if ($('#mobileApiKey')) $('#mobileApiKey').value = keyInput.value;

function key(){ return localStorage.getItem('starclub_admin_key') || keyInput.value || ''; }
function showLogin(){ loginOverlay?.classList.remove('hidden'); }
function hideLogin(){ loginOverlay?.classList.add('hidden'); }
async function api(path, options={}){
  const headers={'Content-Type':'application/json',...(options.headers||{})};
  if(adminToken) headers.Authorization=`Bearer ${adminToken}`;
  else if(key()) headers['x-admin-key']=key();
  const res = await fetch(path,{...options,headers});
  const data = await res.json().catch(()=>({}));
  if(!res.ok||data.ok===false){
    const err=new Error(data.message||data.error||'Admin API error'); err.status=res.status; err.code=data.error; throw err;
  }
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

async function adminAction(action, successText='Готово'){
  try { await action(); if(successText) console.info(successText); }
  catch(error){ alert(error.message || 'Не вдалося виконати дію'); throw error; }
}
function scrollAdminFormIntoView(){
  requestAnimationFrame(()=>document.querySelector('.edit-panel, .editor-card')?.scrollIntoView({behavior:'smooth',block:'start'}));
}

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

let clientDetailState = { id: null, receiptLimit: 3, ledgerLimit: 3 };

async function clients(q=''){
  title.textContent='Клієнти';
  const query = String(q || '').trim();
  const {clients: clientItems}=await api(`/api/admin/clients${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  content.innerHTML=`<div class="card"><div class="form-grid" style="grid-template-columns:1fr auto"><input id="clientSearch" placeholder="Пошук за імʼям або телефоном" value="${esc(query)}"><button id="clientSearchBtn">Пошук</button></div></div>
  <div class="card"><table><thead><tr><th>Імʼя</th><th>Телефон</th><th></th></tr></thead><tbody>
    ${clientItems.map(c=>`<tr><td><b>${esc(c.name||'—')}</b><div class="small">${esc(c.card_number||'')}</div></td><td>${esc(c.phone||'—')}</td><td><div class="actions"><button data-client="${c.id}">Детально</button></div></td></tr>`).join('') || '<tr><td colspan="3">Клієнтів не знайдено</td></tr>'}
  </tbody></table></div>`;
  $('#clientSearchBtn').onclick=()=>clients($('#clientSearch').value);
  $('#clientSearch').onkeydown=(e)=>{ if(e.key==='Enter') clients($('#clientSearch').value); };
  $$('[data-client]').forEach(b=>b.onclick=()=>{clientDetailState={id:b.dataset.client,receiptLimit:3,ledgerLimit:3};clientDetails(b.dataset.client)});
}
async function clientDetails(id, opts={}){
  clientDetailState.id = id;
  if (opts.receiptLimit) clientDetailState.receiptLimit = opts.receiptLimit;
  if (opts.ledgerLimit) clientDetailState.ledgerLimit = opts.ledgerLimit;
  const data=await api(`/api/admin/clients/${id}?receipt_limit=${clientDetailState.receiptLimit}&ledger_limit=${clientDetailState.ledgerLimit}`);
  const c=data.client;
  const receiptRows=(data.receipts||[]).map(r=>`<tr><td><b>${esc(r.id)}</b><div class="small">${dt(r.purchased_at)}</div></td><td>${num(r.total_cents/100)} грн</td><td>${num(r.stars_accrued)} ★</td><td><details><summary>Товари</summary>${(r.items||[]).map(i=>`<div class="small">${esc(i.name)} × ${num(i.qty)} — ${num(i.line_total_cents/100)} грн</div>`).join('')||'—'}</details></td></tr>`).join('') || '<tr><td colspan="4">Поки немає чеків</td></tr>';
  const ledgerRows=(data.ledger||[]).map(l=>`<tr><td>${dt(l.created_at)}</td><td>${esc(l.description||l.type)}</td><td>${l.amount>0?'+':''}${num(l.amount)} ★</td></tr>`).join('') || '<tr><td colspan="3">Поки немає операцій</td></tr>';
  const topProducts=(data.top_products||[]).map(p=>`<article class="card"><b>${esc(p.name)}</b><p class="small">Куплено: ${num(p.qty_total)} · чеків: ${num(p.times)}</p><div class="actions"><button data-create-coupon="${esc(p.external_product_id||'')}" data-product-name="${esc(p.name)}">QR знижка</button></div></article>`).join('') || '<div class="empty">Недостатньо покупок для аналітики</div>';
  const coupons=(data.coupons||[]).map(cpn=>`<div class="small"><b>${esc(cpn.token)}</b> · ${esc(cpn.product_name||'товар')} · ${cpn.discount_value}${cpn.discount_type==='percent'?'%':' грн'} · ${esc(cpn.status)}</div>`).join('') || '<div class="small">Персональних QR ще немає</div>';
  content.innerHTML=`<div class="card"><h2>${esc(c.name||'Клієнт')} · ${num(c.stars_balance)} ★</h2><p class="small">${esc(c.phone||'')} · ${esc(c.card_number)}</p><div class="actions"><button id="plus100">+100 ★</button><button id="minus100">-100 ★</button><button id="backClients">Назад</button></div></div>
  <div class="card"><h3>Аналітика клієнта: топ-3 товари</h3><div class="grid">${topProducts}</div><h4>Персональні QR-знижки</h4>${coupons}</div>
  <div class="card"><h3>Історія зірок</h3><table><tbody>${ledgerRows}</tbody></table><div class="actions"><button id="ledgerMore">Детальніше +10</button><button id="ledgerLess">Приховати</button></div></div>
  <div class="card"><h3>Чеки</h3><table><tbody>${receiptRows}</tbody></table><div class="actions"><button id="receiptsMore">Детальніше +10</button><button id="receiptsLess">Приховати</button></div></div>`;
  $('#backClients').onclick=()=>clients();
  $('#plus100').onclick=async()=>{await api(`/api/admin/clients/${id}/adjust-stars`,{method:'POST',body:JSON.stringify({amount:100,description:'Ручне коригування +100 ★'})});clientDetails(id)};
  $('#minus100').onclick=async()=>{await api(`/api/admin/clients/${id}/adjust-stars`,{method:'POST',body:JSON.stringify({amount:-100,description:'Ручне коригування -100 ★'})});clientDetails(id)};
  $('#receiptsMore').onclick=()=>clientDetails(id,{receiptLimit:clientDetailState.receiptLimit+10});
  $('#receiptsLess').onclick=()=>clientDetails(id,{receiptLimit:3});
  $('#ledgerMore').onclick=()=>clientDetails(id,{ledgerLimit:clientDetailState.ledgerLimit+10});
  $('#ledgerLess').onclick=()=>clientDetails(id,{ledgerLimit:3});
  $$('[data-create-coupon]').forEach(b=>b.onclick=async()=>{const discount=prompt('Вкажіть знижку у %, наприклад 10', '10'); if(!discount)return; await api(`/api/admin/clients/${id}/coupons`,{method:'POST',body:JSON.stringify({product_external_id:b.dataset.createCoupon||null,product_name:b.dataset.productName,discount_type:'percent',discount_value:Number(discount),valid_days:7})}); clientDetails(id);});
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

async function stores(editId=null){
  title.textContent='Магазини';
  const {stores: storeItems}=await api('/api/admin/stores');
  const edit=editId?storeItems.find(x=>String(x.id)===String(editId)):null;
  content.innerHTML=`
    <div class="card editor-card ${edit?'edit-panel':''}">
      <h3>${edit?'Редагувати магазин':'Додати магазин'}</h3>
      <form id="storeForm" class="form-grid">
        <label class="admin-field"><span>ID магазину</span><input name="id" value="${esc(edit?.id||'')}" placeholder="star-center" ${edit?'readonly':''} required></label>
        <label class="admin-field"><span>Назва</span><input name="name" value="${esc(edit?.name||'')}" placeholder="Star Центр" required></label>
        <label class="admin-field"><span>Адреса</span><input name="address" value="${esc(edit?.address||'')}" placeholder="вул. Центральна, 10"></label>
        <label class="admin-field"><span>Графік роботи</span><input name="work_hours" value="${esc(edit?.work_hours||'')}" placeholder="08:00–22:00"></label>
        <label class="admin-field"><span>Телефон</span><input name="phone" value="${esc(edit?.phone||'')}" placeholder="+380..."></label>
        <label class="admin-field"><span>Фото URL</span><input name="image_url" value="${esc(edit?.image_url||'/assets/star.svg')}" placeholder="/assets/star.svg"></label>
        <label class="checkline"><input type="checkbox" name="is_active" ${edit?(Number(edit.is_active)?'checked':''):'checked'}> Показувати магазин у застосунку</label>
        <button class="primary">${edit?'Зберегти':'Створити магазин'}</button>
        ${edit?'<button type="button" id="cancelStoreEdit">Скасувати</button>':''}
      </form>
    </div>
    <div class="store-admin-grid ${edit?'hide-while-editing':''}">
      ${storeItems.map(store=>`<article class="card store-admin-card">
        <div class="store-admin-head">
          <div><span class="pill">${store.is_active?'активний':'вимкнений'}</span><h3>${esc(store.name)}</h3><p class="small">ID: ${esc(store.id)}</p></div>
          <img src="${esc(store.image_url||'/assets/star.svg')}" alt="" onerror="this.src='/assets/star.svg'">
        </div>
        <dl>
          <div><dt>Адреса</dt><dd>${esc(store.address||'—')}</dd></div>
          <div><dt>Графік</dt><dd>${esc(store.work_hours||'—')}</dd></div>
          <div><dt>Телефон</dt><dd>${esc(store.phone||'—')}</dd></div>
        </dl>
        <div class="actions">${btn('Редагувати',`data-edit-store="${store.id}"`)}${btn('Видалити',`data-delete-store="${store.id}" class="danger"`)}</div>
      </article>`).join('')||'<div class="card">Магазинів поки немає</div>'}
    </div>`;
  const form=$('#storeForm');
  form.onsubmit=async ev=>{
    ev.preventDefault();
    const body={id:val(form,'id'),name:val(form,'name'),address:val(form,'address'),work_hours:val(form,'work_hours'),phone:val(form,'phone'),image_url:val(form,'image_url')||'/assets/star.svg',is_active:check(form,'is_active')};
    await api(edit?`/api/admin/stores/${encodeURIComponent(edit.id)}`:'/api/admin/stores',{method:edit?'PATCH':'POST',body:JSON.stringify(body)});
    stores();
  };
  $('#cancelStoreEdit')?.addEventListener('click',()=>stores());
  $$('[data-edit-store]').forEach(b=>b.onclick=async()=>{await stores(b.dataset.editStore);scrollAdminFormIntoView();});
  $$('[data-delete-store]').forEach(b=>b.onclick=async()=>{if(confirm('Видалити магазин? Якщо він уже використовується, його потрібно просто вимкнути.')){await api(`/api/admin/stores/${encodeURIComponent(b.dataset.deleteStore)}`,{method:'DELETE'});stores();}});
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
  let tiers=[];
  try{tiers=o.tiers_json?JSON.parse(o.tiers_json):(Array.isArray(o.tiers)?o.tiers:[])}catch{}
  const tierRows=(tiers.length?tiers:[{qty:'',price:''}]).map((t)=>`
    <div class="tier-row" data-tier-row>
      <label class="admin-field"><span>Від кількості, шт</span><input data-tier-qty type="number" min="1" step="1" inputmode="numeric" value="${esc(t.qty??'')}"></label>
      <label class="admin-field"><span>Ціна за 1 шт, грн</span><input data-tier-price type="number" min="0" step="0.01" inputmode="decimal" value="${esc(t.price??'')}"></label>
      <button type="button" class="tier-remove" data-remove-tier>Видалити</button>
    </div>`).join('');
  return `<form id="offerForm" class="form-grid offer-editor">
    <label class="admin-field"><span>Тип пропозиції</span><select name="type" id="offerType"><option value="club" ${o.type==='club'?'selected':''}>Клубна ціна</option><option value="stars_multiplier" ${o.type==='stars_multiplier'?'selected':''}>Множник зірок</option><option value="wholesale" ${o.type==='wholesale'?'selected':''}>Оптова ціна</option></select></label>
    <label class="admin-field"><span>Назва для клієнта</span><input name="name" placeholder="Наприклад: Подвійні зірки на випічку" value="${esc(o.name||'')}" required></label>
    <label class="admin-field"><span>Опис</span><input name="description" placeholder="Коротко поясніть умову" value="${esc(o.description||'')}"></label>
    <label class="admin-field"><span>Фото</span><input name="image_url" placeholder="Фото URL" value="${esc(o.image_url||'/assets/star.svg')}"></label>
    <label class="admin-field"><span>Код товару або групи з 1С</span><input name="target_ref" placeholder="Наприклад: ЦБ000008652 або ЦБ000001210" value="${esc(o.product_external_id||o.category||'')}" required></label>
    <div class="admin-help">Введіть один код. Система сама визначить: це конкретний товар чи папка/група товарів. Для групи враховуються всі вкладені підгрупи.</div>
    <div class="offer-type-fields" data-offer-field="club">
      <label class="admin-field"><span>Клубна ціна, грн</span><input name="club_price_uah" type="number" min="0" step="0.01" inputmode="decimal" placeholder="42" value="${esc(centsToUah(o.club_price_cents))}"></label>
      <label class="admin-field"><span>Звичайна ціна, грн</span><input name="old_price_uah" type="number" min="0" step="0.01" inputmode="decimal" placeholder="55" value="${esc(centsToUah(o.old_price_cents))}"></label>
    </div>
    <div class="offer-type-fields" data-offer-field="stars_multiplier">
      <label class="admin-field"><span>Множник зірок</span><input name="stars_multiplier" type="number" min="1" step="0.1" inputmode="decimal" placeholder="2" value="${esc(o.stars_multiplier||'')}"></label>
    </div>
    <div class="offer-type-fields wholesale-builder" data-offer-field="wholesale">
      <div class="wholesale-head"><div><b>Рівні оптових цін</b><div class="small">Додавайте скільки завгодно рівнів.</div></div><button type="button" id="addWholesaleTier" class="secondary">+ Додати рівень</button></div>
      <div id="wholesaleTiers" class="tier-list">${tierRows}</div>
    </div>
    <label class="admin-field"><span>Магазин</span><input name="store_id" placeholder="all або ID магазину" value="${esc(o.store_id||'all')}"></label>
    <label class="checkline"><input type="checkbox" name="is_active" ${o.id?(Number(o.is_active)?'checked':''):'checked'}> Активна</label>
    <div class="form-actions"><button class="primary">${o.id?'Зберегти':'Створити'}</button>${o.id?'<button type="button" id="cancelEdit">Скасувати</button>':''}</div>
  </form>`;
}

async function offers(editId=null){
  title.textContent='Пропозиції';
  const {offers: offerItems}=await api('/api/admin/catalog/offers');
  const edit=editId?offerItems.find(x=>String(x.id)===String(editId)):null;
  content.innerHTML=`<div class="card editor-card ${edit?'edit-panel':''}"><h3>${edit?'Редагувати пропозицію':'Створити пропозицію'}</h3>${offerForm(edit||{})}</div>
  <div class="offer-list">${offerItems.map(o=>`<article class="offer-mobile-card">
    <div class="offer-card-head"><div><span class="pill">${esc(o.type)}</span><h3>${esc(o.name)}</h3></div><span>${activeText(o.is_active)}</span></div>
    <dl><div><dt>Умова</dt><dd>${esc(offerCondition(o))}</dd></div><div><dt>Товар або група</dt><dd>${esc(o.product_external_id||o.category||'усі')}</dd></div><div><dt>Магазин</dt><dd>${esc(o.store_id||'all')}</dd></div></dl>
    <div class="actions">${btn('Редагувати',`data-edit-offer="${o.id}"`)}${btn('Видалити',`data-delete-offer="${o.id}"`)}</div>
  </article>`).join('')||'<div class="card">Пропозицій поки немає</div>'}</div>`;
  const form=$('#offerForm');
  const typeSelect=$('#offerType');
  const syncOfferFields=()=>{
    const current=typeSelect.value;
    $$('[data-offer-field]').forEach(el=>el.classList.toggle('hidden',el.dataset.offerField!==current));
  };
  const bindTierButtons=()=>{
    $$('[data-remove-tier]').forEach(btn=>btn.onclick=()=>{
      const rows=$$('[data-tier-row]');
      if(rows.length===1){ rows[0].querySelector('[data-tier-qty]').value=''; rows[0].querySelector('[data-tier-price]').value=''; return; }
      btn.closest('[data-tier-row]')?.remove();
    });
  };
  $('#addWholesaleTier')?.addEventListener('click',()=>{
    $('#wholesaleTiers').insertAdjacentHTML('beforeend',`<div class="tier-row" data-tier-row>
      <label class="admin-field"><span>Від кількості, шт</span><input data-tier-qty type="number" min="1" step="1" inputmode="numeric"></label>
      <label class="admin-field"><span>Ціна за 1 шт, грн</span><input data-tier-price type="number" min="0" step="0.01" inputmode="decimal"></label>
      <button type="button" class="tier-remove" data-remove-tier>Видалити</button>
    </div>`);
    bindTierButtons();
  });
  typeSelect.addEventListener('change',syncOfferFields);
  syncOfferFields();
  bindTierButtons();
  form.onsubmit=async ev=>{
    ev.preventDefault();
    const type=val(form,'type');
    const tiers=$$('[data-tier-row]').map(row=>({
      qty:Number(row.querySelector('[data-tier-qty]').value),
      price:Number(row.querySelector('[data-tier-price]').value)
    })).filter(t=>t.qty>0&&t.price>=0).sort((a,b)=>a.qty-b.qty);
    if(type==='wholesale'&&!tiers.length){alert('Додайте хоча б один рівень оптової ціни');return;}
    const targetRef=String(val(form,'target_ref')||'').trim();
    if(!targetRef){alert('Вкажіть код товару або групи з 1С');return;}
    if(type==='stars_multiplier'&&Number(val(form,'stars_multiplier'))<=1){alert('Вкажіть множник більше 1, наприклад 2');return;}
    const body={type,name:val(form,'name'),description:val(form,'description'),image_url:val(form,'image_url')||'/assets/star.svg',target_ref:targetRef,club_price_cents:type==='club'?uahToCents(val(form,'club_price_uah')):null,old_price_cents:type==='club'?uahToCents(val(form,'old_price_uah')):null,stars_multiplier:type==='stars_multiplier'&&val(form,'stars_multiplier')?Number(val(form,'stars_multiplier')):null,store_id:val(form,'store_id')||'all',tiers:type==='wholesale'?tiers:[],is_active:check(form,'is_active')};
    const submitButton=form.querySelector('button.primary');
    if(submitButton){submitButton.disabled=true;submitButton.textContent='Збереження…';}
    try{
      await api(edit?`/api/admin/catalog/offers/${edit.id}`:'/api/admin/catalog/offers',{method:edit?'PATCH':'POST',body:JSON.stringify(body)});
      await offers();
    }catch(error){
      alert(`Не вдалося зберегти пропозицію: ${error.message||'невідома помилка'}`);
      if(submitButton){submitButton.disabled=false;submitButton.textContent=edit?'Зберегти':'Створити';}
    }
  };
  $('#cancelEdit')?.addEventListener('click',()=>offers());
  $$('[data-edit-offer]').forEach(b=>b.onclick=async()=>{await offers(b.dataset.editOffer);scrollAdminFormIntoView();});
  $$('[data-delete-offer]').forEach(b=>b.onclick=async()=>{if(confirm('Видалити пропозицію?')){await api(`/api/admin/catalog/offers/${b.dataset.deleteOffer}`,{method:'DELETE'});offers();}});
}

async function challenges(editId=null){
  title.textContent='Челенджі';
  const {challenges: challengeItems}=await api('/api/admin/catalog/challenges');
  const edit=editId?challengeItems.find(x=>String(x.id)===String(editId)):null;
  content.innerHTML=`<div class="card editor-card ${edit?'edit-panel':''}"><h3>${edit?'Редагувати челендж':'Створити челендж'}</h3>
    <form id="challengeForm" class="form-grid">
      <label class="admin-field"><span>Назва</span><input name="name" value="${esc(edit?.name||'')}" required></label>
      <label class="admin-field"><span>Опис</span><input name="description" value="${esc(edit?.description||'')}"></label>
      <label class="admin-field"><span>Код товару або групи з 1С</span><input name="category" placeholder="Наприклад: ЦБ000001210 або bakery" value="${esc(edit?.category||'')}"></label>
      <label class="admin-field"><span>Кількість відвідувань</span><input name="required_visits" type="number" min="1" value="${esc(edit?.required_visits||1)}" required></label>
      <label class="admin-field"><span>Мінімальний чек, грн</span><input name="min_total_uah" type="number" min="0" step="0.01" value="${esc(centsToUah(edit?.min_total_cents)||0)}"></label>
      <label class="admin-field"><span>Бонус, зірок</span><input name="reward_stars" type="number" min="1" value="${esc(edit?.reward_stars||100)}" required></label>
      <label class="admin-field"><span>Період</span><select name="period_type"><option value="week" ${edit?.period_type==='week'?'selected':''}>Тиждень</option><option value="month" ${edit?.period_type==='month'?'selected':''}>Місяць</option></select></label>
      <label class="admin-field"><span>Магазин</span><input name="store_id" placeholder="all або ID магазину" value="${esc(edit?.store_id||'all')}"></label>
      <label class="checkline"><input type="checkbox" name="is_repeatable" ${Number(edit?.is_repeatable)?'checked':''}> Повторюваний</label>
      <label class="checkline"><input type="checkbox" name="is_active" ${edit?(Number(edit.is_active)?'checked':''):'checked'}> Активний</label>
      <div class="form-actions"><button class="primary">${edit?'Зберегти':'Створити'}</button>${edit?'<button type="button" id="cancelEdit">Скасувати</button>':''}</div>
    </form>
  </div>
  <div class="offer-list">${challengeItems.map(c=>`<article class="offer-mobile-card">
    <div class="offer-card-head"><div><span class="pill">Челендж</span><h3>${esc(c.name)}</h3></div><span>${activeText(c.is_active)}</span></div>
    <dl><div><dt>Група 1С</dt><dd>${esc(c.category||'усі товари')}</dd></div><div><dt>Умова</dt><dd>${c.required_visits} відвідувань</dd></div><div><dt>Мін. чек</dt><dd>${num(c.min_total_cents/100)} грн</dd></div><div><dt>Бонус</dt><dd>${num(c.reward_stars)} ★</dd></div></dl>
    <div class="actions">${btn('Редагувати',`data-edit-challenge="${c.id}"`)}${btn('Видалити',`data-delete-challenge="${c.id}"`)}</div>
  </article>`).join('')||'<div class="card">Челенджів поки немає</div>'}</div>`;
  const form=$('#challengeForm');
  form.onsubmit=async ev=>{
    ev.preventDefault();
    const body={name:val(form,'name'),description:val(form,'description'),category:val(form,'category')||null,required_visits:Number(val(form,'required_visits')),min_total_cents:uahToCents(val(form,'min_total_uah'))||0,reward_stars:Number(val(form,'reward_stars')),period_type:val(form,'period_type'),store_id:val(form,'store_id')||'all',is_repeatable:check(form,'is_repeatable'),is_active:check(form,'is_active')};
    await api(edit?`/api/admin/catalog/challenges/${edit.id}`:'/api/admin/catalog/challenges',{method:edit?'PATCH':'POST',body:JSON.stringify(body)});
    challenges();
  };
  $('#cancelEdit')?.addEventListener('click',()=>challenges());
  $$('[data-edit-challenge]').forEach(b=>b.onclick=async()=>{await challenges(b.dataset.editChallenge);scrollAdminFormIntoView();});
  $$('[data-delete-challenge]').forEach(b=>b.onclick=async()=>{if(confirm('Видалити челендж?')){await api(`/api/admin/catalog/challenges/${b.dataset.deleteChallenge}`,{method:'DELETE'});challenges();}});
}

async function stamps(editId=null){
  title.textContent='Накопичувальні програми';
  const {programs}=await api('/api/admin/catalog/stamps');
  const edit=editId?programs.find(x=>String(x.id)===String(editId)):null;
  content.innerHTML=`
    <div class="card editor-card ${edit?'edit-panel':''}">
      <h3>${edit?'Редагувати програму':'Створити програму'}</h3>
      <p class="small">Вкажіть код одного товару або код/назву папки з 1С. Система сама визначить тип. Для папки враховуються всі вкладені підпапки.</p>
      <form id="stampForm" class="form-grid">
        <label class="admin-field"><span>Назва програми</span><input name="name" placeholder="Наприклад: 10-та покупка випічки" value="${esc(edit?.name||'')}" required></label>
        <label class="admin-field"><span>Код товару або групи з 1С</span><input name="category" placeholder="Наприклад: ЦБ000001210" value="${esc(edit?.category||'')}" required></label>
        <label class="admin-field"><span>Скільки товарів потрібно купити</span><input name="required_qty" type="number" min="1" placeholder="10" value="${esc(edit?.required_qty||10)}" required></label>
        <label class="admin-field"><span>Бонус після виконання, ★ (можна 0, якщо видається QR)</span><input name="reward_stars" type="number" min="0" placeholder="0" value="${esc(edit?.reward_stars||0)}"></label>
        <label class="admin-field"><span>ID товару за зірки для безкоштовного QR</span><input name="reward_product_id" type="number" min="1" placeholder="ID з розділу Товари за зірки" value="${esc(edit?.reward_product_id||'')}"></label>
        <label class="admin-field"><span>Строк дії QR, днів</span><input name="reward_valid_days" type="number" min="1" value="${esc(edit?.reward_valid_days||7)}"></label>
        <label class="checkline"><input type="checkbox" name="is_repeatable" ${edit?(Number(edit.is_repeatable)?'checked':''):'checked'}> Повторювати програму після отримання бонусу</label>
        <label class="checkline"><input type="checkbox" name="is_active" ${edit?(Number(edit.is_active)?'checked':''):'checked'}> Активна</label>
        ${edit?`<div class="technical-code">Технічний код: <b>${esc(edit.code)}</b></div>`:''}
        <div class="form-actions"><button class="primary">${edit?'Зберегти':'Створити'}</button>${edit?'<button type="button" id="cancelEdit">Скасувати</button>':''}</div>
      </form>
    </div>
    <div class="offer-list ${edit?'hide-while-editing':''}">
      ${programs.map(p=>`<article class="offer-mobile-card">
        <div class="offer-card-head"><div><span class="pill">Накопичувальна</span><h3>${esc(p.name)}</h3></div><span>${activeText(p.is_active)}</span></div>
        <dl>
          <div><dt>Товар або група 1С</dt><dd>${esc(p.category)}</dd></div>
          <div><dt>Потрібно товарів</dt><dd>${num(p.required_qty)}</dd></div>
          <div><dt>Винагорода</dt><dd>QR на товар за 0,10 грн · ${num(p.reward_valid_days||7)} днів</dd></div>
          <div><dt>Повторювана</dt><dd>${Number(p.is_repeatable)?'так':'ні'}</dd></div>
        </dl>
        <div class="actions">${btn('Редагувати',`data-edit-stamp="${p.id}"`)}${btn('Видалити',`data-delete-stamp="${p.id}"`)}</div>
      </article>`).join('')||'<div class="card">Програм поки немає</div>'}
    </div>`;
  const form=$('#stampForm');
  form.onsubmit=async ev=>{
    ev.preventDefault();
    const body={
      name:val(form,'name'),
      category:val(form,'category'),
      required_qty:Number(val(form,'required_qty')),
      reward_stars:Number(val(form,'reward_stars')||0),
      reward_product_id:val(form,'reward_product_id')?Number(val(form,'reward_product_id')):null,
      reward_valid_days:Number(val(form,'reward_valid_days')||7),
      is_repeatable:check(form,'is_repeatable'),
      is_active:check(form,'is_active')
    };
    await api(edit?`/api/admin/catalog/stamps/${edit.id}`:'/api/admin/catalog/stamps',{method:edit?'PATCH':'POST',body:JSON.stringify(body)});
    stamps();
  };
  $('#cancelEdit')?.addEventListener('click',()=>stamps());
  $$('[data-edit-stamp]').forEach(b=>b.onclick=async()=>{await stamps(b.dataset.editStamp);scrollAdminFormIntoView();});
  $$('[data-delete-stamp]').forEach(b=>b.onclick=async()=>{if(confirm('Видалити програму?')){await api(`/api/admin/catalog/stamps/${b.dataset.deleteStamp}`,{method:'DELETE'});stamps();}});
}

async function news(editId=null){
  title.textContent='Новини';
  const {news: newsItems}=await api('/api/admin/catalog/news');
  const edit=editId?newsItems.find(x=>String(x.id)===String(editId)):null;
  content.innerHTML=`<div class="card editor-card ${edit?'edit-panel':''}"><h3>${edit?'Редагувати новину':'Додати новину'}</h3><form id="newsForm" class="form-grid"><input name="title" placeholder="Заголовок" value="${esc(edit?.title||'')}" required><input name="tag" placeholder="Тег" value="${esc(edit?.tag||'')}"><input name="image_url" placeholder="Фото URL" value="${esc(edit?.image_url||'/assets/star.svg')}"><textarea name="text" placeholder="Текст" required>${esc(edit?.text||'')}</textarea><label class="checkline"><input type="checkbox" name="is_active" ${edit?(Number(edit.is_active)?'checked':''):'checked'}> Активна</label><button>${edit?'Зберегти':'Додати'}</button>${edit?'<button type="button" id="cancelEdit">Скасувати</button>':''}</form></div><div class="card listing-card ${edit?'hide-while-editing':''}"><table><thead><tr><th>Дата</th><th>Тег</th><th>Заголовок</th><th>Текст</th><th>Статус</th><th>Дії</th></tr></thead><tbody>${newsItems.map(n=>`<tr><td>${dt(n.created_at)}</td><td>${esc(n.tag||'')}</td><td>${esc(n.title)}</td><td>${esc(n.text)}</td><td>${activeText(n.is_active)}</td><td class="actions">${btn('Редагувати',`data-edit-news="${n.id}"`)}${btn('Видалити',`data-delete-news="${n.id}"`)}</td></tr>`).join('')}</tbody></table></div>`;
  const form=$('#newsForm'); form.onsubmit=async ev=>{ev.preventDefault();const body={title:val(form,'title'),tag:val(form,'tag'),image_url:val(form,'image_url')||'/assets/star.svg',text:val(form,'text'),is_active:check(form,'is_active')}; await api(edit?`/api/admin/catalog/news/${edit.id}`:'/api/admin/catalog/news',{method:edit?'PATCH':'POST',body:JSON.stringify(body)});news();}; $('#cancelEdit')?.addEventListener('click',()=>news()); $$('[data-edit-news]').forEach(b=>b.onclick=async()=>{await news(b.dataset.editNews);scrollAdminFormIntoView();}); $$('[data-delete-news]').forEach(b=>b.onclick=async()=>{if(confirm('Видалити новину?')){await api(`/api/admin/catalog/news/${b.dataset.deleteNews}`,{method:'DELETE'});news();}});
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

async function support(){
  title.textContent='Підтримка';
  const {tickets}=await api('/api/admin/support/tickets');
  content.innerHTML=`<div class="support-board">${tickets.map(t=>`<article class="card support-admin-card"><div class="support-head"><div><span class="ticket-id">#${t.id}</span><h3>${esc(t.subject)}</h3><p class="small">${esc(t.client_name||'Клієнт')} · ${esc(t.phone||'')} · ${esc(t.card_number||'')}</p></div><span class="pill">${esc(t.status)}</span></div><div class="support-thread">${(t.messages||[]).map(m=>`<div class="support-message ${m.sender_type}"><b>${m.sender_type==='client'?'Клієнт':'Адмін'}</b><p>${esc(m.message)}</p><span>${dt(m.created_at)}</span></div>`).join('')}</div><form class="adminReply" data-ticket="${t.id}"><textarea name="message" placeholder="Відповідь клієнту" required></textarea><div class="actions"><button class="primary">Відповісти</button><button type="button" data-close-ticket="${t.id}">Закрити</button></div></form></article>`).join('')||'<div class="card">Звернень немає</div>'}</div>`;
  $$('.adminReply').forEach(f=>f.onsubmit=async e=>{e.preventDefault();const fd=new FormData(f);await api(`/api/admin/support/tickets/${f.dataset.ticket}/reply`,{method:'POST',body:JSON.stringify({message:fd.get('message')})});support();});
  $$('[data-close-ticket]').forEach(b=>b.onclick=async()=>{await api(`/api/admin/support/tickets/${b.dataset.closeTicket}`,{method:'PATCH',body:JSON.stringify({status:'closed'})});support();});
}

async function admins(){
  title.textContent='Адміністратори';
  const {users}=await api('/api/admin/users');
  const permissionLabels={
    dashboard:'Аналітика',clients:'Клієнти',stores:'Магазини',rewards:'Товари за зірки',offers:'Пропозиції',
    challenges:'Челенджі',stamps:'Накопичувальні',news:'Новини',qrs:'QR-коди',
    support:'Підтримка',settings:'Налаштування',audit:'Журнал дій'
  };
  const perms=Object.keys(permissionLabels);
  const checks=(selected=[])=>perms.map(p=>`<label class="checkline"><input type="checkbox" name="permissions" value="${p}" ${selected.includes(p)?'checked':''}> ${permissionLabels[p]}</label>`).join('');
  content.innerHTML=`
    <div class="card">
      <h2>Призначити адміністратора</h2>
      <p class="small">Owner вказує Telegram ID та сам обирає, до яких розділів матиме доступ Admin.</p>
      <form id="adminForm" class="form-grid">
        <input name="telegram_id" placeholder="Telegram ID" inputmode="numeric" required>
        <input name="name" placeholder="Імʼя адміністратора">
        <input name="username" placeholder="Telegram username без @">
        <div class="permission-grid">${checks(perms.filter(p=>!['settings','audit'].includes(p)))}</div>
        <button class="primary">Додати Admin</button>
      </form>
    </div>
    <div class="admin-user-grid">
      ${users.map(u=>`<article class="card admin-user-card" data-admin-id="${u.id}">
        <div class="support-head"><div><h3>${esc(u.name||'—')}</h3><p class="small">Telegram ID: ${esc(u.telegram_id)}${u.username?` · @${esc(u.username)}`:''}</p></div><span class="pill">${u.role==='owner'?'Owner':'Admin'}</span></div>
        ${u.role==='owner'
          ? `<p class="small">Owner має повний доступ. Основний Owner визначається через OWNER_TELEGRAM_IDS.</p>`
          : `<form class="adminEditForm">
              <input name="name" value="${esc(u.name||'')}" placeholder="Імʼя">
              <input name="username" value="${esc(u.username||'')}" placeholder="Telegram username">
              <div class="permission-grid">${checks(u.permissions||[])}</div>
              <label class="checkline"><input type="checkbox" name="is_active" ${u.is_active?'checked':''}> Доступ активний</label>
              <div class="actions"><button class="primary">Зберегти права</button><button type="button" class="danger" data-delete-admin="${u.id}">Видалити Admin</button></div>
            </form>`}
      </article>`).join('')}
    </div>`;
  $('#adminForm').onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.currentTarget);
    const permissions=fd.getAll('permissions');
    if(!permissions.length) return alert('Оберіть хоча б один доступний розділ.');
    await api('/api/admin/users',{method:'POST',body:JSON.stringify({telegram_id:fd.get('telegram_id'),name:fd.get('name'),username:fd.get('username'),permissions})});
    admins();
  };
  $$('.adminEditForm').forEach(form=>form.onsubmit=async e=>{
    e.preventDefault();
    const card=form.closest('[data-admin-id]');
    const fd=new FormData(form);
    const permissions=fd.getAll('permissions');
    const is_active=fd.has('is_active');
    if(is_active&&!permissions.length) return alert('Для активного Admin оберіть хоча б один розділ.');
    await api(`/api/admin/users/${card.dataset.adminId}`,{method:'PATCH',body:JSON.stringify({name:fd.get('name'),username:fd.get('username'),permissions,is_active})});
    admins();
  });
  $$('[data-delete-admin]').forEach(btn=>btn.onclick=async()=>{
    if(!confirm('Видалити цього адміністратора та завершити його активні сесії?')) return;
    await api(`/api/admin/users/${btn.dataset.deleteAdmin}`,{method:'DELETE'});
    admins();
  });
}
async function qrs(){
  title.textContent='QR за зірки';
  const {qrs: qrItems}=await api('/api/admin/reward-qrs');
  content.innerHTML=`<div class="card"><table><thead><tr><th>Дата</th><th>Клієнт</th><th>Товар</th><th>Код</th><th>Зірки</th><th>Статус</th><th>Діє до</th></tr></thead><tbody>${qrItems.map(q=>`<tr><td>${dt(q.created_at)}</td><td>${esc(q.client_name||q.phone)}</td><td>${esc(q.reward_name)}</td><td><b>${esc(q.token)}</b></td><td>${num(q.stars_reserved)} ★</td><td><span class="pill">${esc(q.status)}</span></td><td>${dt(q.expires_at)}</td></tr>`).join('') || '<tr><td colspan="7">Поки QR не створювались</td></tr>'}</tbody></table></div>`;
}
async function audit(){
  title.textContent='Журнал дій';
  const {logs}=await api('/api/admin/audit');
  content.innerHTML=`<div class="card"><table><thead><tr><th>Дата</th><th>Хто</th><th>Дія</th><th>Обʼєкт</th><th>Опис</th></tr></thead><tbody>${logs.map(l=>`<tr><td>${dt(l.created_at)}</td><td>${esc(l.actor_type)} ${esc(l.actor_id||'')}</td><td>${esc(l.action)}</td><td>${esc(l.entity_type||'')} ${esc(l.entity_id||'')}</td><td><pre>${esc(l.payload_json||'')}</pre></td></tr>`).join('') || '<tr><td colspan="5">Журнал порожній</td></tr>'}</tbody></table></div>`;
}
function syncActiveNavigation(){
  $$('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
}
function enhanceMobileTables(root=content){
  root.querySelectorAll('table').forEach(table=>{
    table.classList.add('mobile-cards');
    const headers=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim());
    table.querySelectorAll('tbody tr').forEach(row=>{
      [...row.children].forEach((cell,index)=>{
        if(cell.tagName==='TD'&&!cell.hasAttribute('colspan')) cell.dataset.label=headers[index]||'';
      });
    });
  });
}
const mobileTableObserver=new MutationObserver(()=>requestAnimationFrame(()=>enhanceMobileTables()));
mobileTableObserver.observe(content,{childList:true,subtree:true});
function closeMobileMenu(){ $('#mobileMenuOverlay')?.classList.add('hidden'); }
async function render(){
  syncActiveNavigation();
  try{
    if(tab==='dashboard') await dashboard();
    if(tab==='clients') await clients();
    if(tab==='stores') await stores();
    if(tab==='rewards') await rewards();
    if(tab==='offers') await offers();
    if(tab==='challenges') await challenges();
    if(tab==='stamps') await stamps();
    if(tab==='news') await news();
    if(tab==='qrs') await qrs();
    if(tab==='support') await support();
    if(tab==='admins') await admins();
    if(tab==='settings') await settings();
    if(tab==='audit') await audit();
  } catch(e){ if(e.status===401){showLogin(); return;} content.innerHTML=`<div class="card"><h2>Помилка</h2><p>${esc(e.message)}</p></div>`; }
  enhanceMobileTables();
  syncActiveNavigation();
}
$$('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;closeMobileMenu();render();});
$('#mobileMenuButton')?.addEventListener('click',()=>$('#mobileMenuOverlay')?.classList.remove('hidden'));
$('#mobileMoreButton')?.addEventListener('click',()=>$('#mobileMenuOverlay')?.classList.remove('hidden'));
$('#mobileMenuClose')?.addEventListener('click',closeMobileMenu);
$('#mobileMenuBackdrop')?.addEventListener('click',closeMobileMenu);
$('#mobileSaveKey')?.addEventListener('click',()=>{const v=$('#mobileApiKey')?.value||'';localStorage.setItem('starclub_admin_key',v);keyInput.value=v;adminToken='';localStorage.removeItem('starclub_admin_session');closeMobileMenu();bootstrapAdmin();});
$('#saveKey').onclick=()=>{localStorage.setItem('starclub_admin_key',keyInput.value);adminToken='';localStorage.removeItem('starclub_admin_session');hideLogin();bootstrapAdmin();};
$('#keyAdminLogin').onclick=()=>{const v=$('#loginApiKey').value.trim();if(!v)return;localStorage.setItem('starclub_admin_key',v);keyInput.value=v;adminToken='';localStorage.removeItem('starclub_admin_session');hideLogin();bootstrapAdmin();};
$('#telegramAdminLogin').onclick=async()=>{
  try {
    const initData = tg?.initData || '';
    const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
    if (!initData && !isLocal) {
      throw new Error('Відкрийте адмін-панель через команду /admin у Telegram-боті.');
    }
    const payload = { initData };
    if (!initData && isLocal) {
      payload.devUser = { id: '111111111', first_name: 'Local Owner' };
    }
    const data = await fetch('/api/admin/auth/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const messages = {
          ADMIN_ACCESS_DENIED: 'Ваш Telegram ID не має доступу до адмін-панелі.',
          TELEGRAM_AUTH_FAILED: 'Не вдалося підтвердити Telegram-вхід. Відкрийте панель повторно через /admin.',
          TELEGRAM_USER_REQUIRED: 'Telegram не передав дані користувача. Відкрийте панель через кнопку бота.'
        };
        throw new Error(messages[d.error] || d.error || 'LOGIN_FAILED');
      }
      return d;
    });
    adminToken = data.session.token;
    localStorage.setItem('starclub_admin_session', adminToken);
    localStorage.removeItem('starclub_admin_key');
    keyInput.value = '';
    admin = data.admin;
    hideLogin();
    applyAdminVisibility();
    render();
  } catch (e) {
    alert(e.message);
  }
};
function applyAdminVisibility(){
  const owner = admin?.role === 'owner' || Boolean(key());
  const permissions = new Set(admin?.permissions || []);
  $$('[data-owner-only]').forEach(el=>el.style.display=owner?'':'none');
  $$('[data-tab]').forEach(el=>{
    if(owner) return el.style.display='';
    el.style.display = permissions.has(el.dataset.tab) ? '' : 'none';
  });
}
async function bootstrapAdmin(){try{const data=await api('/api/admin/me');admin=data.admin;hideLogin();applyAdminVisibility();render();startAdminLiveRefresh();}catch(e){showLogin();}}

let adminLiveRefreshTimer = null;
function startAdminLiveRefresh(){
  if(adminLiveRefreshTimer) clearInterval(adminLiveRefreshTimer);
  adminLiveRefreshTimer=setInterval(()=>{ if(!loginOverlay || loginOverlay.classList.contains('hidden')) render(); },15000);
}


function setupAdminMobileKeyboard(){
  const fields='input,textarea,select';
  document.addEventListener('focusin',event=>{
    if(!event.target.matches(fields)) return;
    document.body.classList.add('keyboard-open');
    setTimeout(()=>event.target.scrollIntoView({behavior:'smooth',block:'center'}),180);
  });
  document.addEventListener('focusout',()=>setTimeout(()=>{if(!document.activeElement?.matches?.(fields))document.body.classList.remove('keyboard-open');},80));
  document.addEventListener('pointerdown',event=>{
    if(!document.body.classList.contains('keyboard-open')) return;
    if(event.target.closest(fields)||event.target.closest('button')) return;
    document.activeElement?.blur?.();
  });
}
setupAdminMobileKeyboard();
bootstrapAdmin();
