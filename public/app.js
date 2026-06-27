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
  data: {},
  liveSignature: '',
  liveBusy: false
};

const icons = {
  home: '🏠', stores: '📍', offers: '🏷', stars: '⭐', more: '•••', card: '💳', rewards: '🎁', history: '↺', profile: '👤', challenges: '🏆', news: '✦', support: '💬'
};

const fallbackStores = [];

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
    state.stores = stores.stores || [];
  } catch {
    state.stores = [];
  }
  render();
}

function header(title, back = false) {
  return `
    <div class="topbar">
      <button class="icon-btn" data-back="${back ? 1 : 0}">${back ? '‹' : '<span class="gold">★</span>'}</button>
      <h2>${title}</h2>
      <span class="topbar-spacer"></span>
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
      </div>
      <p class="link-row">Ще немає акаунта? <button type="button" data-route="register">Зареєструватися</button></p>
    </form>
  `;
}

function telegramPasswordScreen() {
  const c = state.client || {};
  return `
    ${header('Створіть пароль', true)}
    <form id="telegramPasswordForm" class="stack">
      <div class="banner">
        <span class="circle-icon">✈</span>
        <div>Telegram підтверджено<br><strong>${c.name || 'Клієнт Star Club'}</strong>${c.phone ? `<br><span class="small">${c.phone}</span>` : ''}</div>
      </div>
      <p class="small">Перед входом створіть пароль. Далі ви зможете входити за номером телефону і паролем.</p>
      <input class="input" name="password" type="password" autocomplete="new-password" placeholder="Пароль мінімум 6 символів" minlength="6" required>
      <input class="input" name="password_confirm" type="password" autocomplete="new-password" placeholder="Повторіть пароль" minlength="6" required>
      <button class="btn" type="submit">Зберегти пароль</button>
    </form>
  `;
}

function registerScreen() {
  const c = state.client || {};
  const stores = state.stores || [];
  const storeOptions = stores.map((s) => `<option value="${s.id}" ${c.favorite_store === s.id ? 'selected' : ''}>${s.name}</option>`).join('');
  const needPassword = !c.password_set;
  const bonus = c.profile_progress?.bonus || { enabled: true, stars: 500, grantWhen: 'immediately' };
  const showBonus = bonus.enabled && !c.profile_bonus_awarded;
  const bonusText = bonus.grantWhen === 'after_first_purchase' ? 'після першої покупки' : 'після повного профілю';
  return `
    ${header(c.registered ? 'Профіль' : 'Реєстрація', true)}
    <form id="registerForm" class="stack">
      ${showBonus ? `<div class="banner"><span class="circle-icon">★</span><div>Заповніть повний профіль<br>та отримайте <strong>${fmtStars(bonus.stars)} ★</strong> ${bonusText}</div></div>` : ''}
      <input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+380XXXXXXXXX" value="${c.phone || '+380'}" pattern="^(\\+?380\\d{9}|0\\d{9})$" maxlength="13" required>
      <input class="input" name="name" placeholder="Імʼя" value="${c.name || ''}" required>
      <label class="input-field date-field"><span>Дата народження</span><input class="input" name="birth_date" type="date" value="${c.birth_date || ''}" required></label>
      <select class="input" name="favorite_store" required>
        <option value="">Улюблений магазин</option>
        ${storeOptions}
      </select>
      <input class="input" name="email" type="email" autocomplete="email" placeholder="Email (необовʼязково)" value="${c.email || ''}">
      <input class="input" name="preferences" placeholder="Вподобання через кому: кава, випічка" value="${Array.isArray(c.preferences) ? c.preferences.join(', ') : ''}">
      ${needPassword ? `
        <input class="input" name="password" type="password" autocomplete="new-password" placeholder="Пароль мінімум 6 символів" minlength="6" required>
        <input class="input" name="password_confirm" type="password" autocomplete="new-password" placeholder="Повторіть пароль" minlength="6" required>
      ` : ''}
      <label class="check"><input type="checkbox" name="agree_rules" required>Я погоджуюсь з правилами програми лояльності</label>
      <label class="check"><input type="checkbox" name="agree_personal_data" required>Я надаю згоду на обробку персональних даних</label>
      <label class="check"><input type="checkbox" name="marketing_allowed" ${c.marketing_allowed !== false ? 'checked' : ''}>Дозволяю повідомлення про клубні пропозиції</label>
      <button class="btn" type="submit">${c.registered ? 'Зберегти профіль' : 'Завершити реєстрацію'}</button>
    </form>
  `;
}

function homeScreen() {
  const c = state.client;
  const progress = c.profile_progress || { percent: 0, bonus: { enabled: true, stars: 500 } };
  const bonus = progress.bonus || { enabled: true, stars: 500 };
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
      <span class="topbar-spacer"></span>
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
              <p class="small">${bonus.enabled ? `Отримайте бонус ${fmtStars(bonus.stars)} ★` : 'Заповніть анкету для персональних пропозицій'}</p>
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
            <p class="small">${stamp ? `Ще ${stampLeft} до безкоштовного коду` : 'Прогрес зʼявиться після чеків із 1С'}</p>
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
      <button data-route="support"><b>💬</b>Підтримка</button>
      </div>
    </div>
  `;
}

async function refreshClient() {
  const me = await api('/api/client/me');
  state.client = me.client;
  renderNav();
}

async function loadRewards() {
  const data = await api('/api/client/rewards');
  const qrs = await api('/api/client/reward-qrs');
  state.data.rewards = { ...data, qrs: qrs.qrs || [] };
}

async function loadRewardQrs() {
  state.data.rewardQrs = (await api('/api/client/reward-qrs')).qrs || [];
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

async function loadSupport() {
  state.data.supportTickets = (await api('/api/client/support/tickets')).tickets || [];
}

function hasFocusedEditor() {
  const active = document.activeElement;
  return Boolean(active && active.matches?.('input, textarea, select'));
}

function routeNeedsLiveRender(route = state.route) {
  return ['home', 'card', 'rewards', 'rewardCodes', 'history', 'stars', 'progress', 'support'].includes(route);
}

async function refreshVisibleData({ forceRender = false } = {}) {
  if (!state.token || state.liveBusy || document.hidden) return;
  if (!forceRender && hasFocusedEditor()) return;
  state.liveBusy = true;
  try {
    await refreshClient();
    if (state.route === 'home') await loadProgress();
    if (state.route === 'rewards') await loadRewards();
    if (state.route === 'rewardCodes') await loadRewardQrs();
    if (state.route === 'history' || state.route === 'stars') await loadHistory();
    if (state.route === 'progress') await loadProgress();
    if (state.route === 'support') await loadSupport();
    const signature = JSON.stringify({
      route: state.route,
      client: state.client,
      routeData: state.data[state.route === 'rewardCodes' ? 'rewardQrs' : state.route === 'support' ? 'supportTickets' : state.route]
    });
    const changed = signature !== state.liveSignature;
    state.liveSignature = signature;
    if ((forceRender || changed) && routeNeedsLiveRender()) render();
  } catch (error) {
    console.warn('Live refresh failed:', error.message || error);
  } finally {
    state.liveBusy = false;
  }
}

function startLiveRefresh() {
  window.clearInterval(state.liveTimer);
  state.liveTimer = window.setInterval(() => refreshVisibleData(), 8000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshVisibleData({ forceRender: true });
  });
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
      </section>
      <section class="card gold-border card-balance-actions">
        <div>
          <div class="small">Актуальний баланс</div>
          <div class="balance" style="font-size:34px">${fmtStars(card.stars_balance)} <span class="star">★</span></div>
        </div>
        <button class="btn" data-show-cashier data-card-number="${card.card_number}">Показати касиру</button>
      </section>
    </div>
  `;
}

function rewardsScreen() {
  const data = state.data.rewards;
  const items = data?.items || [];
  const active = (data?.qrs || []).filter((q) => q.status === 'reserved');
  return `
    ${header('За зірки', true)}
    <div class="stack">
      <section class="card gold-border spark">
        <b>Оберіть улюблені нагороди за зірки</b>
        <p class="small">Доступно: ${fmtStars(data?.available_stars || 0)} ★</p>
      </section>
      ${active.length ? `<section class="card gold-border"><b>Активні коди</b><p class="small">У вас є активний QR-код. Його можна повторно відкрити.</p>${active.map((q)=>`<button class="reward-code-row" data-open-reward-code="${q.token}"><span>${q.reward.name}</span><b>${q.manual_code}</b></button>`).join('')}</section>` : ''}
      <button class="card gold-border" data-route="rewardCodes"><b>Мої QR-коди</b><p class="small">Активні коди та історія використання</p></button>
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

function rewardCodesScreen() {
  const qrs = state.data.rewardQrs || [];
  const active = qrs.filter((q) => q.status === 'reserved');
  const history = qrs.filter((q) => q.status !== 'reserved');
  const statusText = { reserved: 'активний', used: 'використаний', canceled: 'скасований', expired: 'прострочений' };
  const renderQr = (q) => `
    <section class="card reward-code-card">
      <div class="progress-row"><div><b>${q.reward.name}</b><p class="small">${q.manual_code} · ${fmtStars(q.stars_reserved)} ★</p></div><span class="pill">${statusText[q.status] || q.status}</span></div>
      <p class="small">Створено: ${fmtDate(q.created_at)} ${fmtTime(q.created_at)}${q.status === 'reserved' ? ` · діє до ${fmtTime(q.expires_at)}` : ''}</p>
      ${q.status === 'reserved' ? `<div class="modal-actions"><button class="btn secondary" data-cancel-reward-code="${q.manual_code}" type="button">Скасувати</button><button class="btn" data-open-reward-code="${q.manual_code}" type="button">Відкрити QR</button></div>` : ''}
    </section>`;
  return `
    ${header('Мої QR-коди', true)}
    <div class="stack">
      <section class="card gold-border"><b>Активні</b>${active.length ? active.map(renderQr).join('') : '<div class="empty">Активних кодів немає</div>'}</section>
      <section class="card"><b>Історія</b>${history.length ? history.map(renderQr).join('') : '<div class="empty">Історія кодів порожня</div>'}</section>
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
            ${o.club_price_cents ? `<div class="big-price">${Math.round(o.club_price_cents / 100)} грн</div><p class="small">Замість ${Math.round(o.old_price_cents / 100)} грн</p>` : `<div class="big-price">x${o.stars_multiplier}</div><p class="small">підвищене нарахування зірок</p>`}
            <p class="offer-scope">${o.product_external_id ? `Товар 1С: <b>${o.product_external_id}</b>` : o.category ? `Категорія 1С: <b>${o.category}</b>` : 'Для всіх дозволених товарів'}</p>
            <p class="small">Покажіть картку касиру — умова застосовується під час проведення чека в 1С.</p>
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
      <button class="card gold-border" data-route="rewardCodes"><b>Мої QR-коди</b><p class="small">Активні коди та історія</p></button>
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
      <section class="card gold-border spark"><b>Накопичувальні програми</b><p class="small">Після потрібної кількості покупок автоматично зʼявляється безкоштовний код на 7 днів.</p></section>
      ${p.stamps.map((s) => `
        <section class="card">
          <div class="progress-row"><div><b>${s.name}</b><p class="small">Ще ${Math.max(0, s.required_qty - s.progress)} до безкоштовного коду</p></div><b>${s.progress}/${s.required_qty}</b></div>
          <div class="progressbar"><span style="width:${Math.min(100, s.progress / s.required_qty * 100)}%"></span></div>
        </section>
      `).join('')}
    </div>
  `;
}

async function showReceiptModal(receiptId) {
  let receipt = (state.data.receipts || []).find((r) => String(r.id) === String(receiptId));
  try {
    const detail = await api(`/api/client/receipts/${encodeURIComponent(receiptId)}`);
    receipt = detail.receipt;
  } catch (error) {
    if (!receipt) return toast('Чек не знайдено');
  }
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  const items = receipt.items || [];
  wrap.innerHTML = `
    <div class="modal receipt-modal">
      <div class="modal-heading"><div><p class="eyebrow">STAR CLUB RECEIPT</p><h2>${receipt.is_reward_purchase ? 'Покупка за зірки' : 'Чек покупки'}</h2></div><button class="icon-btn compact" data-close-modal>×</button></div>
      <p class="small">${receipt.store_id || 'Магазин Star'} · ${fmtDate(receipt.purchased_at)} ${fmtTime(receipt.purchased_at)}</p>
      <div class="receipt-summary-grid">
        <div><span>Сума</span><b>${receipt.is_reward_purchase ? '0 грн' : `${receipt.total_uah} грн`}</b></div>
        <div><span>${receipt.is_reward_purchase ? 'Списано' : 'Нараховано'}</span><b>${receipt.is_reward_purchase ? `-${fmtStars(receipt.stars_spent)} ★` : `+${fmtStars(receipt.stars_accrued)} ★`}</b></div>
      </div>
      <div class="receipt-items">
        ${items.length ? items.map((item) => `
          <div class="receipt-item">
            <div class="receipt-item-main"><b>${item.name || 'Товар'}</b><p class="small">${item.external_product_id || item.product_id || 'Без коду'}</p></div>
            <div class="receipt-item-right"><span>${Number(item.qty || 1)} × ${(Math.round(Number(item.price_cents || 0)) / 100).toFixed(2)} грн</span><b>${(Math.round(Number(item.line_total_cents || 0)) / 100).toFixed(2)} грн</b></div>
          </div>
        `).join('') : '<div class="empty">1С не передала товарні позиції цього чека. Перевірте масив items у відправці чека.</div>'}
      </div>
      <div class="receipt-total"><span>Разом</span><b>${receipt.is_reward_purchase ? `${fmtStars(receipt.stars_spent)} ★` : `${receipt.total_uah} грн`}</b></div>
      <div class="modal-actions"><button class="btn" type="button" data-close-modal>Готово</button></div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelectorAll('[data-close-modal]').forEach((b) => b.onclick = () => wrap.remove());
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
          ${receipts.length ? receipts.map((r) => `<button class="tx receipt-row" type="button" data-open-receipt="${r.id}"><span>${r.is_reward_purchase ? '★' : '🧾'}</span><div><b>${r.is_reward_purchase ? 'Покупка за зірки' : (r.store_id || 'Магазин Star')}</b><p class="small">${fmtDate(r.purchased_at)} · ${r.items.length} товарів${r.is_reward_purchase ? ' · товар отримано за зірки' : ''}</p></div><b class="${r.is_reward_purchase ? 'minus' : ''}">${r.is_reward_purchase ? `-${r.stars_spent} ★` : `${r.total_uah} грн`}</b></button>`).join('') : '<div class="empty">Чеки зʼявляться після покупок із картою</div>'}
        </div>
      </section>
    </div>
  `;
}

function storesScreen() {
  return `
    ${header('Магазини', false)}
    <div class="stack">
      ${(state.stores || []).length ? (state.stores || []).map((s) => `
        <section class="card gold-border store">
          ${s.image_url ? `<img class="store-image" src="${s.image_url}" alt="${s.name}" onerror="this.style.display='none'">` : ''}
          <h3>${s.name}</h3>
          <p class="small">${s.address || ''}</p>
          <div class="progress-row small"><span>Графік</span><b>${s.work_hours || '08:00–22:00'}</b></div>
          <div class="progress-row small"><span>Телефон</span><b>${s.phone || '—'}</b></div>
          ${state.client.favorite_store === s.id ? '<span class="gold">★ Улюблений магазин</span>' : ''}
        </section>
      `).join('') : '<div class="empty">Магазини ще не додані адміністратором</div>'}
    </div>
  `;
}

function moreScreen() {
  return `
    ${header('Ще', false)}
    <div class="more-grid">
      <button data-route="card"><b>▣</b>Моя карта</button>
      <button data-route="rewards"><b>🎁</b>За зірки</button>
      <button data-route="rewardCodes"><b>▣</b>Мої QR-коди</button>
      <button data-route="progress"><b>🏆</b>Челенджі</button>
      <button data-route="history"><b>↺</b>Історія</button>
      <button data-route="news"><b>✦</b>Новини</button>
      <button data-route="profile"><b>♙</b>Профіль</button>
      <button data-route="support"><b>💬</b>Підтримка</button>
    </div>
  `;
}

function supportScreen() {
  const tickets = state.data.supportTickets || [];
  return `
    ${header('Підтримка', true)}
    <div class="stack">
      <section class="card gold-border support-intro"><p class="eyebrow">STAR CLUB SUPPORT</p><h3>Ми поруч</h3><p class="small">Опишіть питання, і невдовзі ми дамо вам відповідь.</p></section>
      <form id="supportForm" class="card stack compact-stack">
        <input class="input" name="subject" placeholder="Тема звернення" required>
        <textarea class="input textarea" name="message" placeholder="Опишіть проблему або запитання" required></textarea>
        <button class="btn" type="submit">Створити звернення</button>
      </form>
      <section class="stack">
        ${tickets.length ? tickets.map((t) => `
          <article class="card support-ticket">
            <div class="progress-row"><div><b>#${t.id} · ${t.subject}</b><p class="small">Оновлено ${fmtDate(t.updated_at)} ${fmtTime(t.updated_at)}</p></div><span class="pill">${t.status === 'open' ? 'відкрите' : t.status === 'answered' ? 'є відповідь' : 'закрите'}</span></div>
            <div class="support-thread">${(t.messages || []).map((m) => `<div class="support-message ${m.sender_type}"><b>${m.sender_type === 'client' ? 'Ви' : 'Підтримка'}</b><p>${m.message}</p><span>${fmtTime(m.created_at)}</span></div>`).join('')}</div>
            ${t.status !== 'closed' ? `<form class="supportReplyForm" data-ticket-id="${t.id}"><textarea class="input textarea" name="message" placeholder="Ваша відповідь" required></textarea><button class="btn secondary" type="submit">Надіслати</button></form>` : ''}
          </article>`).join('') : '<div class="empty">Звернень поки немає</div>'}
      </section>
    </div>`;
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
      <button class="btn secondary" data-logout>Вийти з акаунта</button>
    </div>
  `;
}

function showCashierModal(cardNumber) {
  const clean = String(cardNumber || '').replaceAll(' ', '');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal">
      <h2>Штрихкод картки</h2>
      <p class="small">Покажіть цей штрихкод касиру</p>
      <div class="barcode barcode-large"><img src="/api/svg/barcode?text=${encodeURIComponent(clean)}" alt="barcode"></div>
      <div class="manual-code"><span>Номер картки</span><b>${clean}</b></div>
      <div class="modal-actions"><button class="btn" type="button" data-close-modal>Готово</button></div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelector('[data-close-modal]').onclick = () => wrap.remove();
}

function showRewardModal(qr) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  const manualCode = qr.manual_code || qr.token;
  wrap.innerHTML = `
    <div class="modal">
      <h2>${qr.is_free_stamp_reward ? 'Безкоштовний код' : 'Код товару за зірки'}</h2>
      <p class="small">${qr.reward.name} · ${qr.is_free_stamp_reward ? 'накопичувальна програма' : `${fmtStars(qr.reward.stars_price)} ★`}</p>
      <div class="qrbox"><img src="/api/svg/qr?text=${encodeURIComponent(qr.token)}" alt="QR"></div>
      <div class="manual-code">
        <span>Ручний код для касира</span>
        <b>${manualCode}</b>
        <button type="button" class="mini-copy" data-copy-code="${manualCode}">Скопіювати</button>
      </div>
      <p class="small">Код діє до ${fmtTime(qr.expires_at)} ${fmtDate(qr.expires_at)}. Його можна використати тільки один раз.</p>
      <div class="modal-actions">
        <button class="btn secondary" type="button" data-cancel-reward-code="${manualCode}">Скасувати код</button>
        <button class="btn" type="button" data-close-modal>Готово</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wrap.querySelector('[data-close-modal]').onclick = async () => {
    wrap.remove();
    await refreshVisibleData({ forceRender: true });
  };
  wrap.querySelector('[data-copy-code]').onclick = async () => { try { await navigator.clipboard.writeText(manualCode); toast('Код скопійовано'); } catch { toast(manualCode); } };
  wrap.querySelector('[data-cancel-reward-code]').onclick = async () => {
    try {
      await api('/api/client/reward-qr/cancel', { method: 'POST', body: JSON.stringify({ token: manualCode }) });
      toast('Код скасовано, зірки знову доступні');
      wrap.remove();
      await refreshClient();
      await loadRewards();
      if (state.route === 'rewards' || state.route === 'rewardCodes') render();
    } catch (e) { toast(e.message); }
  };
}

async function render() {
  renderNav();
  if (!state.client?.registered && !['register', 'login', 'telegramPassword'].includes(state.route)) {
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
    else if (state.route === 'support') { await loadSupport(); $app.innerHTML = supportScreen(); }
    else if (state.route === 'profile') $app.innerHTML = profileScreen();
    else if (state.route === 'rewardCodes') { await loadRewardQrs(); $app.innerHTML = rewardCodesScreen(); }
    else if (state.route === 'telegramPassword') $app.innerHTML = telegramPasswordScreen();
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
  if (!state.client?.password_set || password.length || confirm.length) {
    if (password.length < 6) return 'Пароль має містити мінімум 6 символів';
    if (password !== confirm) return 'Паролі не співпадають';
  }
  if (!fd.has('agree_rules') || !fd.has('agree_personal_data')) return 'Потрібно погодитись з правилами та обробкою персональних даних';
  return null;
}

function bindEvents() {
  document.querySelectorAll('[data-route]').forEach((el) => el.onclick = () => setRoute(el.dataset.route));
  document.querySelectorAll('[data-back="1"]').forEach((el) => el.onclick = () => setRoute(state.client?.registered ? 'home' : 'start'));
  document.querySelectorAll('[data-offer-tab]').forEach((el) => el.onclick = () => { state.data.offerTab = el.dataset.offerTab; render(); });
  document.querySelectorAll('[data-logout]').forEach((el) => el.onclick = () => { localStorage.removeItem('starclub_session'); localStorage.removeItem('starclub_route'); location.reload(); });
  document.querySelectorAll('[data-show-cashier]').forEach((el) => el.onclick = () => showCashierModal(el.dataset.cardNumber));
  document.querySelectorAll('[data-close-modal]').forEach((el) => el.onclick = () => el.closest('.modal-backdrop')?.remove());
  document.querySelectorAll('[data-copy-code]').forEach((el) => el.onclick = async () => { try { await navigator.clipboard.writeText(el.dataset.copyCode); toast('Код скопійовано'); } catch { toast(el.dataset.copyCode); } });
  document.querySelectorAll('[data-cancel-reward-code]').forEach((el) => el.onclick = async () => {
    try {
      await api('/api/client/reward-qr/cancel', { method: 'POST', body: JSON.stringify({ token: el.dataset.cancelRewardCode }) });
      toast('Код скасовано, зірки знову доступні');
      el.closest('.modal-backdrop')?.remove();
      await loadRewards();
      const me = await api('/api/client/me');
      state.client = me.client;
      renderNav();
      if (state.route === 'rewards' || state.route === 'rewardCodes') render();
    } catch (e) { toast(e.message); }
  });
  document.querySelectorAll('[data-open-receipt]').forEach((el) => el.onclick = () => showReceiptModal(el.dataset.openReceipt));

  const supportForm = document.querySelector('#supportForm');
  if (supportForm) supportForm.onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(supportForm);
    try {
      await api('/api/client/support/tickets', { method: 'POST', body: JSON.stringify({ subject: fd.get('subject'), message: fd.get('message') }) });
      toast('Звернення створено');
      await loadSupport();
      render();
    } catch (e) { toast(e.message); }
  };
  document.querySelectorAll('.supportReplyForm').forEach((form) => form.onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    try {
      await api(`/api/client/support/tickets/${form.dataset.ticketId}/messages`, { method: 'POST', body: JSON.stringify({ message: fd.get('message') }) });
      await loadSupport();
      toast('Повідомлення надіслано');
      render();
    } catch (e) { toast(e.message); }
  });

  document.querySelectorAll('[data-open-reward-code]').forEach((el) => el.onclick = async () => {
    const qrs = state.data.rewards?.qrs || state.data.rewardQrs || (await api('/api/client/reward-qrs')).qrs || [];
    const qr = qrs.find((item) => item.token === el.dataset.openRewardCode || item.manual_code === el.dataset.openRewardCode);
    if (qr) showRewardModal(qr);
    else toast('Код не знайдено або вже неактивний');
  });

  document.querySelectorAll('[data-create-reward]').forEach((el) => el.onclick = async () => {
    try {
      el.disabled = true;
      const data = await api(`/api/client/rewards/${el.dataset.createReward}/create-qr`, { method: 'POST', body: '{}' });
      showRewardModal(data.qr);
      await refreshClient();
      await loadRewards();
      if (state.route === 'rewards') render();
    } catch (e) {
      el.disabled = false;
      toast(e.message);
    }
  });

  document.querySelectorAll('[data-auth-telegram]').forEach((el) => el.onclick = async () => {
    try {
      const data = await api('/api/auth/telegram', {
        method: 'POST',
        body: JSON.stringify({
          initData: tg?.initData || '',
          devUser: { id: '111111111', first_name: 'Андрій', last_name: '', phone_number: '+380635594256' }
        })
      });
      state.token = data.session.token;
      localStorage.setItem('starclub_session', state.token);
      state.client = data.client;
      if (!state.client.password_set || data.needs_password) {
        toast('Telegram підтверджено. Створіть пароль.');
        setRoute('telegramPassword');
      } else {
        toast('Вхід через Telegram виконано');
        setRoute(state.client?.registered ? 'home' : 'register');
      }
    } catch (e) {
      toast(e.message);
    }
  });
  const telegramPasswordForm = document.querySelector('#telegramPasswordForm');
  if (telegramPasswordForm) {
    telegramPasswordForm.onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(telegramPasswordForm);
      const password = String(fd.get('password') || '');
      const password_confirm = String(fd.get('password_confirm') || '');
      if (password.length < 6) return toast('Пароль має містити мінімум 6 символів');
      if (password !== password_confirm) return toast('Паролі не співпадають');
      try {
        const data = await api('/api/client/set-password', { method: 'POST', body: JSON.stringify({ password, password_confirm }) });
        state.client = data.client;
        toast('Пароль збережено. Завершіть профіль.');
        setRoute(state.client?.registered ? 'home' : 'register');
      } catch (e) { toast(e.message); }
    };
  }

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
        toast(data.client?.profile_bonus_awarded ? 'Профіль збережено. Бонус активний.' : 'Профіль збережено');
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


function setupMobileKeyboardUX() {
  const editableSelector = 'input, textarea, select';
  document.addEventListener('focusin', (event) => {
    if (!event.target.matches(editableSelector)) return;
    document.body.classList.add('keyboard-open');
    setTimeout(() => event.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 180);
  });
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!document.activeElement?.matches?.(editableSelector)) document.body.classList.remove('keyboard-open');
    }, 80);
  });
  document.addEventListener('pointerdown', (event) => {
    if (!document.body.classList.contains('keyboard-open')) return;
    if (event.target.closest(editableSelector) || event.target.closest('button')) return;
    const active = document.activeElement;
    if (active?.matches?.(editableSelector)) active.blur();
  });
  window.Telegram?.WebApp?.expand?.();
}

setupMobileKeyboardUX();
startLiveRefresh();
bootstrap();
