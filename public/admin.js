const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const content = $('#content');
const title = $('#title');
const keyInput = $('#apiKey');
let tab = 'dashboard';
keyInput.value = localStorage.getItem('starclub_admin_key') || 'change-this-admin-key';

function key(){return localStorage.getItem('starclub_admin_key') || keyInput.value || 'change-this-admin-key'}
async function api(path, options={}){
  const res = await fetch(path,{...options,headers:{'Content-Type':'application/json','x-admin-key':key(),...(options.headers||{})}});
  const data = await res.json().catch(()=>({}));
  if(!res.ok||data.ok===false) throw new Error(data.message||data.error||'Admin API error');
  return data;
}
function num(n){return new Intl.NumberFormat('uk-UA').format(Number(n||0))}
function money(n){return `${num(n)} грн`}
function dt(s){return s?new Date(s).toLocaleString('uk-UA'):'—'}
function val(form, name){return new FormData(form).get(name)}
function bool(v){return v === 'on' || v === true || v === 'true'}

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
    ${clients.map(c=>`<tr><td><b>${c.name||'—'}</b><div class="small">${dt(c.registered_at)}</div></td><td>${c.phone||'—'}</td><td>${c.card_number}</td><td>${num(c.stars_balance)} ★</td><td>${c.profile_progress.percent}%</td><td><span class="pill">${c.registered?'registered':'lead'}</span></td><td><div class="actions"><button data-client="${c.id}">Деталі</button></div></td></tr>`).join('')}
  </tbody></table></div>`;
  $$('[data-client]').forEach(b=>b.onclick=()=>clientDetails(b.dataset.client));
}
async function clientDetails(id){
  const data=await api(`/api/admin/clients/${id}`);
  const c=data.client;
  content.innerHTML=`<div class="card"><h2>${c.name||'Клієнт'} · ${num(c.stars_balance)} ★</h2><p class="small">${c.phone||''} · ${c.card_number}</p><div class="actions"><button id="plus100">+100 ★</button><button id="minus100">-100 ★</button><button id="backClients">Назад</button></div></div>
  <div class="card"><h3>Історія зірок</h3><table><tbody>${data.ledger.map(l=>`<tr><td>${dt(l.created_at)}</td><td>${l.description||l.type}</td><td>${l.amount>0?'+':''}${num(l.amount)} ★</td></tr>`).join('') || '<tr><td colspan="3">Поки немає операцій</td></tr>'}</tbody></table></div>
  <div class="card"><h3>Чеки</h3><table><tbody>${data.receipts.map(r=>`<tr><td>${r.id}</td><td>${dt(r.purchased_at)}</td><td>${num(r.total_cents/100)} грн</td><td>${num(r.stars_accrued)} ★</td></tr>`).join('') || '<tr><td colspan="4">Поки немає чеків</td></tr>'}</tbody></table></div>`;
  $('#backClients').onclick=clients;
  $('#plus100').onclick=async()=>{await api(`/api/admin/clients/${id}/adjust-stars`,{method:'POST',body:JSON.stringify({amount:100,description:'Ручне коригування +100 ★'})});clientDetails(id)};
  $('#minus100').onclick=async()=>{await api(`/api/admin/clients/${id}/adjust-stars`,{method:'POST',body:JSON.stringify({amount:-100,description:'Ручне коригування -100 ★'})});clientDetails(id)};
}

async function rewards(){
  title.textContent='Товари за зірки';
  const {items}=await api('/api/admin/catalog/rewards');
  content.innerHTML=`<div class="card"><h3>Додати товар за зірки</h3><form id="rewardForm" class="form-grid">
    <input name="name" placeholder="Назва" required><input name="stars_price" type="number" placeholder="Ціна в зірках" required><input name="product_external_id" placeholder="ID товару з 1С"><input name="image_url" placeholder="Фото URL /assets/coffee.svg"><input name="store_id" placeholder="Магазин або all" value="all"><input name="per_client_limit" type="number" placeholder="Ліміт на клієнта" value="1"><textarea name="conditions" placeholder="Умови отримання"></textarea><button>Додати</button>
  </form></div><div class="card"><table><thead><tr><th>Назва</th><th>Зірки</th><th>1С товар</th><th>Магазин</th><th>Статус</th></tr></thead><tbody>${items.map(r=>`<tr><td>${r.name}</td><td>${num(r.stars_price)} ★</td><td>${r.product_external_id||'—'}</td><td>${r.store_id||'all'}</td><td>${r.is_active?'активний':'вимкнений'}</td></tr>`).join('')}</tbody></table></div>`;
  $('#rewardForm').onsubmit=async ev=>{ev.preventDefault();const f=ev.target;await api('/api/admin/catalog/rewards',{method:'POST',body:JSON.stringify({name:val(f,'name'),stars_price:Number(val(f,'stars_price')),product_external_id:val(f,'product_external_id'),image_url:val(f,'image_url')||'/assets/star.svg',store_id:val(f,'store_id')||'all',per_client_limit:Number(val(f,'per_client_limit')||1),conditions:val(f,'conditions')})});rewards()};
}

async function offers(){
  title.textContent='Клубні та оптові пропозиції';
  const {offers}=await api('/api/admin/catalog/offers');
  content.innerHTML=`<div class="card"><h3>Створити пропозицію</h3><div class="muted-box">Для клубної ціни вказуйте club/ціни у копійках. Для множника зірок — stars_multiplier. Для оптової — wholesale і tiers_json.</div><form id="offerForm" class="form-grid">
    <select name="type"><option value="club">club</option><option value="wholesale">wholesale</option></select><input name="name" placeholder="Назва" required><input name="description" placeholder="Опис"><input name="image_url" placeholder="Фото URL"><input name="club_price_cents" type="number" placeholder="Клубна ціна коп."><input name="old_price_cents" type="number" placeholder="Стара ціна коп."><input name="stars_multiplier" type="number" step="0.1" placeholder="Множник зірок"><input name="store_id" placeholder="Магазин/all" value="all"><textarea name="tiers_json" placeholder='[{"qty":1,"price":45},{"qty":2,"price":39}]'></textarea><button>Створити</button>
  </form></div><div class="card"><table><thead><tr><th>Тип</th><th>Назва</th><th>Умова</th><th>Магазин</th></tr></thead><tbody>${offers.map(o=>`<tr><td>${o.type}</td><td>${o.name}</td><td>${o.club_price_cents?num(o.club_price_cents/100)+' грн':o.stars_multiplier?'x'+o.stars_multiplier: o.tiers_json||'—'}</td><td>${o.store_id||'all'}</td></tr>`).join('')}</tbody></table></div>`;
  $('#offerForm').onsubmit=async ev=>{ev.preventDefault();const f=ev.target;let tiers=null;try{tiers=val(f,'tiers_json')?JSON.parse(val(f,'tiers_json')):null}catch{alert('tiers_json має бути валідним JSON');return}await api('/api/admin/catalog/offers',{method:'POST',body:JSON.stringify({type:val(f,'type'),name:val(f,'name'),description:val(f,'description'),image_url:val(f,'image_url')||'/assets/star.svg',club_price_cents:Number(val(f,'club_price_cents')||0)||null,old_price_cents:Number(val(f,'old_price_cents')||0)||null,stars_multiplier:Number(val(f,'stars_multiplier')||0)||null,store_id:val(f,'store_id')||'all',tiers})});offers()};
}

async function challenges(){
  title.textContent='Челенджі';
  const {challenges}=await api('/api/admin/catalog/challenges');
  content.innerHTML=`<div class="card"><h3>Створити челендж</h3><form id="challengeForm" class="form-grid"><input name="name" placeholder="Назва" required><input name="description" placeholder="Опис"><input name="required_visits" type="number" placeholder="Відвідувань" required><input name="min_total_cents" type="number" placeholder="Мін. чек коп." value="5000"><input name="reward_stars" type="number" placeholder="Бонус ★" required><select name="period_type"><option value="week">week</option><option value="month">month</option></select><input name="store_id" value="all"><button>Створити</button></form></div><div class="card"><table><thead><tr><th>Назва</th><th>Прогрес</th><th>Мін. чек</th><th>Бонус</th></tr></thead><tbody>${challenges.map(c=>`<tr><td>${c.name}</td><td>${c.required_visits} відвідувань</td><td>${num(c.min_total_cents/100)} грн</td><td>${num(c.reward_stars)} ★</td></tr>`).join('')}</tbody></table></div>`;
  $('#challengeForm').onsubmit=async ev=>{ev.preventDefault();const f=ev.target;await api('/api/admin/catalog/challenges',{method:'POST',body:JSON.stringify({name:val(f,'name'),description:val(f,'description'),required_visits:Number(val(f,'required_visits')),min_total_cents:Number(val(f,'min_total_cents')||0),reward_stars:Number(val(f,'reward_stars')),period_type:val(f,'period_type'),store_id:val(f,'store_id')||'all'})});challenges()};
}

async function stamps(){
  title.textContent='Накопичувальні програми';
  const {programs}=await api('/api/admin/catalog/stamps');
  content.innerHTML=`<div class="card"><h3>Створити програму</h3><form id="stampForm" class="form-grid"><input name="name" placeholder="Назва" required><input name="category" placeholder="Категорія з 1С, напр. coffee" required><input name="required_qty" type="number" placeholder="Кількість" value="10"><input name="reward_stars" type="number" placeholder="Бонус ★" value="1000"><input name="code" placeholder="Код"><button>Створити</button></form></div><div class="card"><table><thead><tr><th>Назва</th><th>Категорія</th><th>Кількість</th><th>Бонус</th></tr></thead><tbody>${programs.map(p=>`<tr><td>${p.name}</td><td>${p.category}</td><td>${p.required_qty}</td><td>${num(p.reward_stars)} ★</td></tr>`).join('')}</tbody></table></div>`;
  $('#stampForm').onsubmit=async ev=>{ev.preventDefault();const f=ev.target;await api('/api/admin/catalog/stamps',{method:'POST',body:JSON.stringify({name:val(f,'name'),category:val(f,'category'),required_qty:Number(val(f,'required_qty')),reward_stars:Number(val(f,'reward_stars')),code:val(f,'code')||undefined})});stamps()};
}

async function news(){
  title.textContent='Новини';
  const {news}=await api('/api/admin/catalog/news');
  content.innerHTML=`<div class="card"><h3>Додати новину</h3><form id="newsForm" class="form-grid"><input name="title" placeholder="Заголовок" required><input name="tag" placeholder="Тег"><input name="image_url" placeholder="Фото URL"><textarea name="text" placeholder="Текст" required></textarea><button>Додати</button></form></div><div class="card"><table><thead><tr><th>Дата</th><th>Тег</th><th>Заголовок</th><th>Текст</th></tr></thead><tbody>${news.map(n=>`<tr><td>${dt(n.created_at)}</td><td>${n.tag||''}</td><td>${n.title}</td><td>${n.text}</td></tr>`).join('')}</tbody></table></div>`;
  $('#newsForm').onsubmit=async ev=>{ev.preventDefault();const f=ev.target;await api('/api/admin/catalog/news',{method:'POST',body:JSON.stringify({title:val(f,'title'),tag:val(f,'tag'),image_url:val(f,'image_url')||'/assets/star.svg',text:val(f,'text')})});news()};
}

async function qrs(){
  title.textContent='QR за зірки';
  const {qrs}=await api('/api/admin/reward-qrs');
  content.innerHTML=`<div class="card"><table><thead><tr><th>Дата</th><th>Клієнт</th><th>Товар</th><th>Зірки</th><th>Статус</th><th>Діє до</th></tr></thead><tbody>${qrs.map(q=>`<tr><td>${dt(q.created_at)}</td><td>${q.client_name||q.phone}</td><td>${q.reward_name}</td><td>${num(q.stars_reserved)} ★</td><td><span class="pill">${q.status}</span></td><td>${dt(q.expires_at)}</td></tr>`).join('') || '<tr><td colspan="6">Поки QR не створювались</td></tr>'}</tbody></table></div>`;
}
async function audit(){
  title.textContent='Журнал дій';
  const {logs}=await api('/api/admin/audit');
  content.innerHTML=`<div class="card"><table><thead><tr><th>Дата</th><th>Хто</th><th>Дія</th><th>Обʼєкт</th><th>Дані</th></tr></thead><tbody>${logs.map(l=>`<tr><td>${dt(l.created_at)}</td><td>${l.actor_type}</td><td>${l.action}</td><td>${l.entity_type||''} ${l.entity_id||''}</td><td><pre>${l.payload_json||''}</pre></td></tr>`).join('') || '<tr><td colspan="5">Журнал порожній</td></tr>'}</tbody></table></div>`;
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
    if(tab==='audit') await audit();
  }
  catch(e){content.innerHTML=`<div class="card"><h2>Помилка</h2><p>${e.message}</p><p class="small">Перевір ADMIN_API_KEY у .env і введи його у полі зверху.</p></div>`}
}
$$('.sidebar button[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;render()});
$('#saveKey').onclick=()=>{localStorage.setItem('starclub_admin_key',keyInput.value);render()};
render();
