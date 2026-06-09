const $app = document.querySelector('#app');
const $nav = document.querySelector('#bottomNav');
const $toast = document.querySelector('#toast');

const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor('#0b0d10');
  tg.setBackgroundColor('#0b0d10');
}

const state = {
  token: localStorage.getItem('starclub_session') || '',
  client: null,
  route: localStorage.getItem('starclub_route') || 'home',
  stores: [],
  data: {}
};

const icons = {
  home: '⌂', stores: '⌖', offers: '◇', stars: '★', more: '•••', card: '▣', rewards: '🎁', history: '↺', profile: '♙', challenges: '🏆', news: '✦'
};

const fallbackStores = [
  { id: 'star-center', name: 'Star Центр', address: 'вул. Центральна, 10', work_hours: '08:00–22:00', phone: '+380000000001' },
  { id: 'star-market', name: 'Star Маркет', address: 'вул. Шевченка, 24', work_hours: '08:00–22:00', phone: '+380000000002' },
  { id: 'star-bakery', name: 'Star Bakery', address: 'вул. Миру, 5', work_hours: '07:30–21:30', phone: '+380000000003' }
];

function toast(text) {
  $toast.textContent = text;
  $toast.classList.add('show');
  setTimeout(() => $toast.classList.remove('show'), 2600);
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  let res;
  try {
    res = await fetch(path, { ...options, headers });
  } catch (error) {
    throw new Error('Сервер не відповідає. Перевірте, чи запущено npm start');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const message = data.message || data.error || data.detail || 'Помилка запиту';
    const err = new Error(message);
    err.code = data.error || message;
    err.status = res.status;
    throw err;
  }
  return data;
}

function setRoute(route) {
  state.route = route;
  localStorage.setItem('starclub_route', route);
  render();
}

function fmtStars(n) {
  return new Intl.NumberFormat('uk-UA').format(Number(n || 0));
}

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('uk-UA', { day: '2-digit', month: 'long' });
}

function fmtTime(s) {
  if (!s) return '';
  return new Date(s).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

async function bootstrap() {
  try {
    if (state.token) {
      const me = await api('/api/client/me');
      state.client = me.client;
    } else if (tg?.initData) {
      const auth = await api('/api/auth/telegram', {
        method: 'POST',
        body: JSON.stringify({ initData: tg.initData })
      });
      state.token = auth.session.token;
      localStorage.setItem('starclub_session', state.token);
      state.client = auth.client;
    }
  } catch (e) {
    console.error(e);
    localStorage.removeItem('starclub_session');
    state.token = '';
    state.client = null;
    state.route = 'start';
  }

  try {
    const stores = await api('/api/public/stores');
    state.stores = stores.stores?.length ? stores.stores : fallbackStores;
  } catch {
    state.stores = fallbackStores;
  }
  render();
}

function header(title, back = false) {
  return `
    <div class="topbar">
      <button class="icon-btn" data-back="${back ? 1 : 0}">${back ? '‹' : '<span class="gold">★</span>'}</button>
      <h2>${title}</h2>
      <button class="icon-btn">♧</button>
    </div>
  `;
}

function renderNav() {
  const registered = state.client?.registered;
  $nav.classList.toggle('hidden', !registered);
  if (!registered) return;
  const items = [
    ['home', 'Головна', icons.home],
    ['stores', 'Магазини', icons.stores],
    ['offers', 'Пропозиції', icons.offers],
    ['stars', 'Мої зірки', icons.stars],
    ['more', 'Ще', icons.more]
  ];
  $nav.innerHTML = items.map(([route, label, icon]) => `<button class="${state.route === route ? 'active' : ''}" data-route="${route}"><span>${icon}</span>${label}</button>`).join('');
}

function startScreen() {
  return `
    <section class="hero">
      <div class="hero-card">
        <div class="hero-logo"><div class="logo-star"></div></div>
        <h1>Ласкаво просимо<br>у Star Club</h1>
        <div class="benefits">
          <div class="benefit"><span class="circle-icon">★</span>Збирайте зірки</div>
          <div class="benefit"><span class="circle-icon">🏷</span>Клубні ціни</div>
          <div class="benefit"><span class="circle-icon">🎁</span>Товари за зірки</div>
          <div class="benefit"><span class="circle-icon">👤</span>Персональні пропозиції</div>
        </div>
        <button class="btn" data-route="register">Зареєструватися</button>
        <div class="social-auth">
          <button class="social-btn" data-auth-telegram type="button">✈ Увійти через Telegram</button>
          <button class="social-btn" data-auth-google type="button">G Увійти через Google</button>
        </div>
        <p class="link-row">Вже є акаунт? <button data-route="login">Увійти</button></p>
      </div>
    </section>
  `;
}

function loginScreen() {
  return `
    ${header('Вхід', true)}
    <form id="loginForm" class="stack">
      <div class="banner">
        <span class="circle-icon">★</span>
        <div>Увійдіть у Star Club<br><strong>за номером і паролем</strong></div>
      </div>
      <input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+380XXXXXXXXX" value="+380" maxlength="13" required>
      <input class="input" name="password" type="password" autocomplete="current-password" placeholder="Пароль" minlength="6" required>
      <button class="btn" type="submit">Увійти</button>
      <div class="social-auth">
        <button class="social-btn" data-auth-telegram type="button">✈ Увійти через Telegram</button>
        <button class="social-btn" data-auth-google type="button">G Увійти через Google</button>
      </div>
      <p class="link-row">Ще немає акаунта? <button type="button" data-route="register">Зареєструватися</button></p>
    </form>
  `;
}

function registerScreen() {
  const c = state.client || {};
  const stores = state.stores?.length ? state.stores : fallbackStores;
  const storeOptions = stores.map((s) => `<option value="${s.id}" ${c.favorite_store === s.id ? 'selected' : ''}>${s.name}</option>`).join('');
  return `
    ${header('Реєстрація', true)}
    <form id="registerForm" class="stack">
      <div class="banner">
        <span class="circle-icon">★</span>
        <div>Заповніть повний профіль<br>та отримайте <strong>500 ★</strong></div>
      </div>
      <input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+380XXXXXXXXX" value="${c.phone || '+380'}" pattern="^(\\+?380\\d{9}|0\\d{9})$" maxlength="13" required>
      <input class="input" name="name" placeholder="Імʼя" value="${c.name || ''}" required>
      <input class="input" name="birth_date" type="date" value="${c.birth_date || ''}" required>
      <select class="input" name="favorite_store" required>
        <option value="">Улюблений магазин</option>
        ${storeOptions}
      </select>
      <input class="input" name="password" type="password" autocomplete="new-password" placeholder="Пароль мінімум 6 символів" minlength="6" required>
      <input class="input" name="password_confirm" type="password" autocomplete="new-password" placeholder="Повторіть пароль" minlength="6" required>
      <label class="check"><input type="checkbox" name="agree_rules" required>Я ознайомлений(а) та погоджуюсь з правилами програми лояльності</label>
      <label class="check"><input type="checkbox" name="agree_personal_data" required>Я надаю згоду на обробку персональних даних</label>
      <label class="check"><input type="checkbox" name="marketing_allowed" checked>Дозволяю повідомлення про клубні пропозиції</label>
      <button class="btn" type="submit">Зареєструватися</button>
    </form>
  `;
}

function homeScreen() {
  const c = state.client;
  const progress = c.profile_progress || { percent: 0 };
  const live = state.data.progress || { stamps: [], challenges: [] };
  const challenge = live.challenges?.[0];
  const stamp = live.stamps?.[0];
  const challengeText = challenge
    ? `${challenge.progress}/${challenge.required_visits}`
    : '0/0';
  const stampText = stamp
    ? `${stamp.progress}/${stamp.required_qty}`
    : '0/0';
  const challengeLeft = challenge ? Math.max(0, challenge.required_visits - challenge.progress) : 0;
  const stampLeft = stamp ? Math.max(0, stamp.required_qty - stamp.progress) : 0;
  return `
    <div class="topbar">
      <h1>Вітаємо, ${c.name || 'друже'}! 👋</h1>
      <button class="icon-btn">♧</button>
    </div>
    <div class="stack">
      <section class="card balance-card spark">
        <div class="label">Ваш баланс</div>
        <div class="balance">${fmtStars(c.stars_balance)} <span class="star">★</span></div>
        ${c.reserved_stars ? `<p class="small">У резерві: ${fmtStars(c.reserved_stars)} ★</p>` : ''}
      </section>
      ${progress.percent < 100 ? `
        <section class="card gold-border" data-route="profile">
          <div class="progress-row">
            <div>
              <b>Заповніть профіль</b>
              <p class="small">Отримайте бонус 500 ★ після завершення анкети</p>
            </div>
            <div class="progress-ring">${progress.percent}%</div>
          </div>
          <div class="progressbar"><span style="width:${progress.percent}%"></span></div>
        </section>` : ''}
      <section class="card gold-border" data-route="progress">
        <div class="progress-row">
          <div>
            <b>${challenge?.name || 'Активний челендж'}</b>
            <p class="small">${challenge ? `Залишилось ${challengeLeft} відвідувань до бонусу ${fmtStars(challenge.reward_stars)} ★` : 'Челенджі зʼявляться після налаштування в адмінці'}</p>
          </div>
          <div class="progress-ring">${challengeText}</div>
        </div>
      </section>
      <section class="card gold-border" data-route="progress">
        <div class="progress-row">
          <div>
            <b>${stamp?.name || 'Накопичувальна програма'}</b>
            <p class="small">${stamp ? `Ще ${stampLeft} до бонусу ${fmtStars(stamp.reward_stars)} ★` : 'Прогрес зʼявиться після чеків із 1С'}</p>
          </div>
          <div class="progress-ring">${stampText}</div>
        </div>
      </section>
      <section class="card spark" data-route="offers">
        <b>Клубні пропозиції лише для учасників</b>
        <p class="small">Перегляньте актуальні пропозиції Star Club</p>
      </section>
      <div class="quick">
        <button data-route="card"><b>▣</b>Моя карта</button>
        <button data-route="rewards"><b>🎁</b>За зірки</button>
        <button data-route="history"><b>↺</b>Історія</button>
        <button data-route="profile"><b>♙</b>Профіль</button>
      </div>
    </div>
  `;
}

async function loadRewards() {
  const data = await api('/api/client/rewards');
  state.data.rewards = data;
}

async function loadOffers() {
  const data = await api('/api/client/offers');
  state.data.offers = data.offers;
}

async function loadProgress() {
  state.data.progress = await api('/api/client/progress');
}

async function loadHistory() {
  state.data.ledger = (await api('/api/client/star-history')).items;
  state.data.receipts = (await api('/api/client/receipts')).receipts;
}

async function loadNews() {
  state.data.news = (await api('/api/client/news')).news;
}

async function cardScreen() {
  const data = await api('/api/client/card');
  const card = data.card;
  return `
    ${header('Моя карта', true)}
    <div class="stack">
      <section class="card-visual">
        <div class="logo-mark" style="width:62px;height:62px;margin:0 auto 8px"><div class="logo-star" style="width:34px;height:34px"></div></div>
        <div class="club-logo">STAR CLUB</div>
        <h3>${card.name}</h3>
        <p class="small">№ картки<br><span class="gold">${card.card_number}</span></p>
        <div class="qrbox"><img src="/api/svg/qr?text=${encodeURIComponent(card.card_token)}" alt="QR"></div>
        <div class="barcode"><img src="/api/svg/barcode?text=${encodeURIComponent(card.card_number.replaceAll(' ', ''))}" alt="barcode"></div>
      </section>
      <section class="card gold-border">
        <div class="small">Ваш баланс</div>
        <div class="balance" style="font-size:34px">${fmtStars(card.stars_balance)} <span class="star">★</span></div>
        <button class="btn" data-show-cashier>Показати касиру</button>
      </section>
    </div>
  `;
}

function rewardsScreen() {
  const data = state.data.rewards;
  const items = data?.items || [];
  return `
    ${header('За зірки', true)}
    <div class="stack">
      <section class="card gold-border spark">
        <b>Оберіть улюблені нагороди за зірки</b>
        <p class="small">Доступно: ${fmtStars(data?.available_stars || 0)} ★. Гривневий еквівалент не показується.</p>
      </section>
      ${items.map((r) => `
        <article class="product">
          <img src="${r.image_url}" alt="${r.name}">
          <div>
            <h3>${r.name}</h3>
            <div class="price">${fmtStars(r.stars_price)}★</div>
            <p class="small" style="color:#555">${r.conditions || ''}</p>
            <button class="mini-btn" data-create-reward="${r.id}" ${r.can_get ? '' : 'disabled'}>${r.can_get ? 'Отримати' : 'Недостатньо'}</button>
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function offersScreen() {
  const all = state.data.offers || [];
  const tab = state.data.offerTab || 'club';
  const items = all.filter((o) => o.type === tab);
  return `
    ${header(tab === 'club' ? 'Клубні пропозиції' : 'Оптові пропозиції', true)}
    <div class="stack">
      <div class="tabs">
        <button class="${tab === 'club' ? 'active' : ''}" data-offer-tab="club">Клубні</button>
        <button class="${tab === 'wholesale' ? 'active' : ''}" data-offer-tab="wholesale">Оптові</button>
      </div>
      <section class="card gold-border spark">
        <b>${tab === 'club' ? 'Ексклюзивно для учасників Star Club' : 'Вигідні умови для оптових покупок'}</b>
        <p class="small">Лише для зареєстрованих клієнтів програми лояльності.</p>
      </section>
      ${items.map((o) => tab === 'club' ? `
        <article class="card offer">
          <div>
            <h3>${o.name}</h3>
            <p class="small">${o.description || ''}</p>
            ${o.club_price_cents ? `<div class="big-price">${Math.round(o.club_price_cents / 100)}★</div><p class="small">Замість ${Math.round(o.old_price_cents / 100)}</p>` : `<div class="big-price">x${o.stars_multiplier}</div><p class="small">підвищене нарахування зірок</p>`}
          </div>
          <img src="${o.image_url}" alt="${o.name}">
        </article>
      ` : `
        <article class="card offer">
          <div>
            <h3>${o.name}</h3>
            <p class="small">${o.description || ''}</p>
            ${(o.tiers || []).map((t) => `<div class="progress-row small"><span>від ${t.qty} шт</span><b class="gold">${t.price} грн/шт</b></div>`).join('')}
          </div>
          <img src="${o.image_url}" alt="${o.name}">
        </article>
      `).join('')}
    </div>
  `;
}

function starsScreen() {
  return `
    ${header('Мої зірки', false)}
    <div class="stack">
      <button class="card gold-border" data-route="card"><b>Моя карта</b><p class="small">QR-код, штрихкод, номер картки</p></button>
      <button class="card gold-border" data-route="rewards"><b>За зірки</b><p class="small">Каталог товарів за накопичені зірки</p></button>
      <button class="card gold-border" data-route="progress"><b>Прогрес</b><p class="small">10-та кава, 10-й багет, челенджі</p></button>
      <button class="card gold-border" data-route="history"><b>Історія</b><p class="small">Нарахування, витрати, чеки</p></button>
    </div>
  `;
}

function progressScreen() {
  const p = state.data.progress || { stamps: [], challenges: [] };
  return `
    ${header('Прогрес і активність', true)}
    <div class="stack">
      <section class="card gold-border spark"><b>Активні челенджі</b><p class="small">Виконуйте завдання та отримуйте зірки</p></section>
      ${p.challenges.map((c) => `
        <section class="card">
          <div class="progress-row"><div><b>${c.name}</b><p class="small">${c.description || ''}</p></div><b>${c.progress}/${c.required_visits}</b></div>
          <div class="progressbar"><span style="width:${Math.min(100, c.progress / c.required_visits * 100)}%"></span></div>
          <p class="small">Залишилось ${Math.max(0, c.required_visits - c.progress)} відвідування до бонусу ${fmtStars(c.reward_stars)} ★</p>
        </section>
      `).join('')}
      <section class="card gold-border spark"><b>10-та кава / багет</b><p class="small">Бонус нараховується автоматично після досягнення 10 позицій.</p></section>
      ${p.stamps.map((s) => `
        <section class="card">
          <div class="progress-row"><div><b>${s.name}</b><p class="small">Ще ${Math.max(0, s.required_qty - s.progress)} до бонусу ${fmtStars(s.reward_stars)} ★</p></div><b>${s.progress}/${s.required_qty}</b></div>
          <div class="progressbar"><span style="width:${Math.min(100, s.progress / s.required_qty * 100)}%"></span></div>
        </section>
      `).join('')}
    </div>
  `;
}

function historyScreen() {
  const ledger = state.data.ledger || [];
  const receipts = state.data.receipts || [];
  return `
    ${header('Історія', true)}
    <div class="stack">
      <section class="card balance-card"><div class="small">Ваш баланс</div><div class="balance" style="font-size:34px">${fmtStars(state.client.stars_balance)} <span class="star">★</span></div></section>
      <section class="card">
        <b>Історія зірок</b>
        <div class="timeline">
          ${ledger.length ? ledger.map((l) => `<div class="tx"><span>${l.amount > 0 ? '＋' : '−'}</span><div><b>${l.description || l.type}</b><p class="small">${fmtDate(l.created_at)} ${fmtTime(l.created_at)}</p></div><b class="amount ${l.amount > 0 ? 'plus' : 'minus'}">${l.amount > 0 ? '+' : ''}${fmtStars(l.amount)} ★</b></div>`).join('') : '<div class="empty">Поки немає операцій</div>'}
        </div>
      </section>
      <section class="card">
        <b>Чеки</b>
        <div class="timeline">
          ${receipts.length ? receipts.map((r) => `<div class="tx"><span>🧾</span><div><b>${r.store_id || 'Магазин Star'}</b><p class="small">${fmtDate(r.purchased_at)} · ${r.items.length} товарів</p></div><b>${r.total_uah} грн</b></div>`).join('') : '<div class="empty">Чеки зʼявляться після покупок із картою</div>'}
        </div>
      </section>
    </div>
  `;
}

function storesScreen() {
  return `
    ${header('Магазини', false)}
    <div class="stack">
      ${(state.stores?.length ? state.stores : fallbackStores).map((s) => `
        <section class="card gold-border store">
          <h3>${s.name}</h3>
          <p class="small">${s.address || ''}</p>
          <div class="progress-row small"><span>Графік</span><b>${s.work_hours || '08:00–22:00'}</b></div>
          <div class="progress-row small"><span>Телефон</span><b>${s.phone || '—'}</b></div>
          ${state.client.favorite_store === s.id ? '<span class="gold">★ Улюблений магазин</span>' : ''}
        </section>
      `).join('')}
    </div>
  `;
}

function moreScreen() {
  return `
    ${header('Ще', false)}
    <div class="more-grid">
      <button data-route="card"><b>▣</b>Моя карта</button>
      <button data-route="rewards"><b>🎁</b>За зірки</button>
      <button data-route="progress"><b>🏆</b>Челенджі</button>
      <button data-route="history"><b>↺</b>Історія</button>
      <button data-route="news"><b>✦</b>Новини</button>
      <button data-route="profile"><b>♙</b>Профіль</button>
    </div>
  `;
}

function newsScreen() {
  const news = state.data.news || [];
  return `
    ${header('Новини', true)}
    <div class="stack">
      ${news.map((n) => `
        <section class="card offer">
          <div>
            <p class="small gold">${n.tag || 'STAR CLUB'}</p>
            <h3>${n.title}</h3>
            <p class="small">${n.text}</p>
          </div>
          <img src="${n.image_url}" alt="${n.title}">
        </section>
      `).join('')}
    </div>
  `;
}

function profileScreen() {
  const c = state.client;
  return `
    ${header('Профіль', true)}
    <div class="stack">
      <section class="card gold-border">
        <b>${c.name || 'Клієнт Star Club'}</b>
        <p class="small">${c.phone || 'Номер не вказано'}</p>
        <div class="progressbar"><span style="width:${c.profile_progress.percent}%"></span></div>
        <p class="small">Заповнено ${c.profile_progress.completed} з ${c.profile_progress.total} полів</p>
      </section>
      <button class="btn" data-route="register">Редагувати профіль</button>
      <button class="btn secondary" data-logout>Вийти з демо-сесії</button>
      <section class="card"><b>Правила програми</b><p class="small">Зірки — внутрішня валюта Star Club. У клієнтському інтерфейсі не показується гривневий еквівалент зірок. Алкоголь і тютюн не беруть участі в нарахуванні/списанні без окремої юридичної перевірки.</p></section>
    </div>
  `;
}

function showRewardModal(qr) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal">
      <h2>QR для касира</h2>
      <p class="small">${qr.reward.name} · ${fmtStars(qr.reward.stars_price)} ★</p>
      <div class="qrbox"><img src="/api/svg/qr?text=${encodeURIComponent(qr.token)}" alt="QR"></div>
      <p class="small">Діє до ${fmtTime(qr.expires_at)}. QR одноразовий, після використання стає недійсним.</p>
      <button class="btn" data-close-modal>Готово</button>
    </div>
  `;
  document.body.appendChild(wrap);
}

async function render() {
  renderNav();
  if (!state.client?.registered && !['register', 'login'].includes(state.route)) {
    $app.innerHTML = startScreen();
    bindEvents();
    return;
  }
  try {
    if (state.route === 'card') $app.innerHTML = await cardScreen();
    else if (state.route === 'rewards') { await loadRewards(); $app.innerHTML = rewardsScreen(); }
    else if (state.route === 'offers') { await loadOffers(); $app.innerHTML = offersScreen(); }
    else if (state.route === 'progress') { await loadProgress(); $app.innerHTML = progressScreen(); }
    else if (state.route === 'history') { await loadHistory(); $app.innerHTML = historyScreen(); }
    else if (state.route === 'stores') $app.innerHTML = storesScreen();
    else if (state.route === 'stars') $app.innerHTML = starsScreen();
    else if (state.route === 'more') $app.innerHTML = moreScreen();
    else if (state.route === 'news') { await loadNews(); $app.innerHTML = newsScreen(); }
    else if (state.route === 'profile') $app.innerHTML = profileScreen();
    else if (state.route === 'register') $app.innerHTML = registerScreen();
    else if (state.route === 'login') $app.innerHTML = loginScreen();
    else { await loadProgress(); $app.innerHTML = homeScreen(); }
  } catch (e) {
    if (e.code === 'CLIENT_UNAUTHORIZED' || e.message === 'CLIENT_UNAUTHORIZED') {
      localStorage.removeItem('starclub_session');
      state.token = '';
      state.client = null;
      state.route = 'login';
      localStorage.setItem('starclub_route', 'login');
      $app.innerHTML = loginScreen();
    } else {
      $app.innerHTML = `<div class="empty">${e.message}</div>`;
    }
  }
  bindEvents();
}

function normalizeClientPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (/^380\d{9}$/.test(digits)) return `+${digits}`;
  if (/^0\d{9}$/.test(digits)) return `+38${digits}`;
  return null;
}

function validateRegisterForm(form) {
  const fd = new FormData(form);
  const phone = normalizeClientPhone(fd.get('phone'));
  if (!phone) return 'Введіть правильний номер телефону у форматі +380XXXXXXXXX або 0XXXXXXXXX';
  if (String(fd.get('name') || '').trim().length < 2) return 'Вкажіть імʼя мінімум з 2 символів';
  if (!fd.get('birth_date')) return 'Вкажіть дату народження';
  if (!fd.get('favorite_store')) return 'Оберіть улюблений магазин';
  const password = String(fd.get('password') || '');
  const confirm = String(fd.get('password_confirm') || '');
  if (password.length < 6) return 'Пароль має містити мінімум 6 символів';
  if (password !== confirm) return 'Паролі не співпадають';
  if (!fd.has('agree_rules') || !fd.has('agree_personal_data')) return 'Потрібно погодитись з правилами та обробкою персональних даних';
  return null;
}

function bindEvents() {
  document.querySelectorAll('[data-route]').forEach((el) => el.onclick = () => setRoute(el.dataset.route));
  document.querySelectorAll('[data-back="1"]').forEach((el) => el.onclick = () => setRoute(state.client?.registered ? 'home' : 'start'));
  document.querySelectorAll('[data-login-demo]').forEach((el) => el.onclick = async () => { localStorage.removeItem('starclub_session'); await bootstrap(); });
  document.querySelectorAll('[data-offer-tab]').forEach((el) => el.onclick = () => { state.data.offerTab = el.dataset.offerTab; render(); });
  document.querySelectorAll('[data-logout]').forEach((el) => el.onclick = () => { localStorage.removeItem('starclub_session'); localStorage.removeItem('starclub_route'); location.reload(); });
  document.querySelectorAll('[data-show-cashier]').forEach((el) => el.onclick = () => toast('Покажіть QR-код або штрихкод касиру'));
  document.querySelectorAll('[data-close-modal]').forEach((el) => el.onclick = () => el.closest('.modal-backdrop')?.remove());
  document.querySelectorAll('[data-create-reward]').forEach((el) => el.onclick = async () => {
    try {
      const data = await api(`/api/client/rewards/${el.dataset.createReward}/create-qr`, { method: 'POST', body: '{}' });
      showRewardModal(data.qr);
      const me = await api('/api/client/me');
      state.client = me.client;
      renderNav();
    } catch (e) { toast(e.message); }
  });

  document.querySelectorAll('[data-auth-telegram]').forEach((el) => el.onclick = async () => {
    try {
      const data = await api('/api/auth/telegram', {
        method: 'POST',
        body: JSON.stringify({
          initData: tg?.initData || '',
          devUser: { id: '111111111', first_name: 'Андрій', username: 'demo' }
        })
      });
      state.token = data.session.token;
      localStorage.setItem('starclub_session', state.token);
      state.client = data.client;
      toast('Вхід через Telegram виконано');
      setRoute(state.client?.registered ? 'home' : 'register');
    } catch (e) {
      toast(e.message);
    }
  });

  document.querySelectorAll('[data-auth-google]').forEach((el) => el.onclick = async () => {
    try {
      const data = await api('/api/auth/google-demo', {
        method: 'POST',
        body: JSON.stringify({ name: 'Google User', email: 'google.demo@starclub.local' })
      });
      state.token = data.session.token;
      localStorage.setItem('starclub_session', state.token);
      state.client = data.client;
      toast('Вхід через Google виконано');
      setRoute(state.client?.registered ? 'home' : 'register');
    } catch (e) {
      toast(e.message);
    }
  });

  const loginForm = document.querySelector('#loginForm');
  if (loginForm) {
    loginForm.onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(loginForm);
      const phone = normalizeClientPhone(fd.get('phone'));
      const password = String(fd.get('password') || '');
      if (!phone) return toast('Введіть правильний номер телефону');
      if (password.length < 6) return toast('Введіть пароль мінімум 6 символів');
      try {
        const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ phone, password }) });
        state.token = data.session.token;
        localStorage.setItem('starclub_session', state.token);
        state.client = data.client;
        toast('Вхід виконано');
        setRoute('home');
      } catch (e) {
        toast(e.code === 'INVALID_CREDENTIALS' || e.message === 'INVALID_CREDENTIALS' ? 'Невірний номер або пароль' : e.message);
      }
    };
  }

  const form = document.querySelector('#registerForm');
  if (form) {
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const validationError = validateRegisterForm(form);
      if (validationError) {
        toast(validationError);
        return;
      }
      const fd = new FormData(form);
      const body = Object.fromEntries(fd.entries());
      body.phone = normalizeClientPhone(body.phone);
      body.name = String(body.name || '').trim();
      body.agree_rules = fd.has('agree_rules');
      body.agree_personal_data = fd.has('agree_personal_data');
      body.marketing_allowed = fd.has('marketing_allowed');
      try {
        const data = await api('/api/client/register', { method: 'POST', body: JSON.stringify(body) });
        if (data.session?.token) {
          state.token = data.session.token;
          localStorage.setItem('starclub_session', state.token);
        }
        state.client = data.client;
        toast('Реєстрацію збережено');
        setRoute('home');
      } catch (e) {
        if (e.message === 'CLIENT_UNAUTHORIZED') {
          toast('Сесія не активна. Увійдіть або відкрийте додаток через Telegram');
          setRoute('login');
        } else {
          toast(e.message);
        }
      }
    };
  }
}

bootstrap();
