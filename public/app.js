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

const persistedRoute = localStorage.getItem('starclub_route') || 'home';

const state = {
  token: localStorage.getItem('starclub_session') || '',
  client: null,
  route: persistedRoute === 'stars' ? 'home' : persistedRoute,
  stores: [],
  data: {},
  liveSignature: '',
  liveBusy: false,
  activitySnapshot: null,
  activityReady: false,
  activityBusy: false,
  lastNotifyAt: 0,
  notifications: [],
  notificationsLoadedFor: '',
  notificationPanelOpen: false,
  openCashierOnCard: false
};

const icons = {
  home: 'home', stores: 'store', offers: 'tags', more: 'menu', card: 'credit-card', rewards: 'gift',
  history: 'history', profile: 'user-round', challenges: 'trophy', news: 'newspaper', support: 'message-circle',
  qr: 'qr-code', progress: 'award', notification: 'bell', receipt: 'receipt-text'
};

const fallbackStores = [];

function safeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function appIcon(name, className = '') {
  const file = String(name || '').replace(/[^a-z0-9-]/g, '') || 'circle-star';
  return `<img class="app-icon ${safeHtml(className)}" src="/assets/icons/${file}.svg" alt="" aria-hidden="true">`;
}

function toast(text) {
  $toast.textContent = text;
  $toast.classList.add('show');
  setTimeout(() => $toast.classList.remove('show'), 2600);
}

function playAppNotificationSound() {
  try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch {}
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    setTimeout(() => ctx.close?.(), 450);
  } catch {}
}

function notificationStorageKey() {
  return `starclub_notifications_${state.client?.id || state.client?.card_number || 'guest'}`;
}

function ensureNotificationsLoaded() {
  const key = notificationStorageKey();
  if (state.notificationsLoadedFor === key) return;
  state.notificationsLoadedFor = key;
  try {
    const stored = JSON.parse(localStorage.getItem(key) || '[]');
    state.notifications = Array.isArray(stored) ? stored.slice(0, 30) : [];
  } catch {
    state.notifications = [];
  }
}

function saveNotifications() {
  ensureNotificationsLoaded();
  try { localStorage.setItem(notificationStorageKey(), JSON.stringify(state.notifications.slice(0, 30))); } catch {}
}

function notificationTitle(route) {
  if (route === 'rewardCodes') return 'Новий QR-код';
  if (route === 'history') return 'Нова покупка';
  if (route === 'support') return 'Відповідь підтримки';
  return 'Повідомлення';
}

function addInboxNotification(text, route = null, options = {}) {
  ensureNotificationsLoaded();
  const dedupeKey = options.dedupeKey || `${route || 'info'}:${text}`;
  if (state.notifications.some((n) => n.dedupeKey === dedupeKey)) return;
  const item = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: options.title || notificationTitle(route),
    text,
    route,
    dedupeKey,
    read: false,
    created_at: new Date().toISOString()
  };
  state.notifications = [item, ...state.notifications].slice(0, 30);
  saveNotifications();
  const now = Date.now();
  if (now - state.lastNotifyAt > 700) playAppNotificationSound();
  state.lastNotifyAt = now;
  renderNotificationBadgeOnly();
}

function notifyInApp(text, route = null, options = {}) {
  addInboxNotification(text, route, options);
}

function unreadNotificationsCount() {
  ensureNotificationsLoaded();
  return state.notifications.filter((n) => !n.read).length;
}

function renderNotificationPanel() {
  ensureNotificationsLoaded();
  const list = state.notifications.slice(0, 12);
  return `
    <div class="notification-panel">
      <div class="notification-head">
        <b>Повідомлення</b>
        ${list.length ? '<button type="button" data-clear-notifications>Очистити</button>' : ''}
      </div>
      <div class="notification-list">
        ${list.length ? list.map((n) => `
          <button type="button" class="notification-item ${n.read ? '' : 'unread'}" data-open-notification="${n.id}">
            <span>${n.title || 'Повідомлення'}</span>
            <p>${n.text || ''}</p>
            <small>${fmtTime(n.created_at)} ${fmtDate(n.created_at)}</small>
          </button>
        `).join('') : '<div class="notification-empty">Нових повідомлень поки немає</div>'}
      </div>
    </div>
  `;
}

function notificationButton() {
  if (!state.client?.registered) return '<span class="topbar-spacer"></span>';
  const unread = unreadNotificationsCount();
  return `
    <div class="notification-wrap">
      <button type="button" class="icon-btn notification-btn ${unread ? 'has-unread' : ''}" data-toggle-notifications aria-label="Повідомлення">
        ${appIcon(icons.notification)}${unread ? `<span class="notification-badge">${unread > 9 ? '9+' : unread}</span>` : ''}
      </button>
      ${state.notificationPanelOpen ? renderNotificationPanel() : ''}
    </div>
  `;
}

function renderNotificationBadgeOnly() {
  const existing = document.querySelector('.notification-wrap');
  if (!existing || !state.client?.registered) return;
  existing.outerHTML = notificationButton();
  bindNotificationEvents();
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
  state.notificationPanelOpen = false;
  state.route = route;
  localStorage.setItem('starclub_route', route);
  render();
  if (state.token && state.client?.registered) checkClientActivity({ initialize: true });
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
      ${back
        ? `<button class="back-button" type="button" data-back="1">${appIcon('arrow-left')}<span>Назад</span></button>`
        : `<span class="topbar-brand-mark" aria-hidden="true">${appIcon('circle-star')}</span>`}
      <h2>${title}</h2>
      ${notificationButton()}
    </div>
  `;
}

function renderNav() {
  const registered = state.client?.registered;
  $nav.classList.toggle('hidden', !registered);
  if (!registered) return;
  const items = [
    ['home', 'Головна', icons.home],
    ['offers', 'Пропозиції', icons.offers],
    ['card', 'Моя карта', icons.card],
    ['rewards', 'За зірки', icons.rewards],
    ['more', 'Ще', icons.more]
  ];
  const moreRoutes = ['stores', 'rewardCodes', 'progress', 'history', 'news', 'profile', 'support'];
  $nav.innerHTML = items.map(([route, label, icon]) => {
    const active = state.route === route || (route === 'more' && moreRoutes.includes(state.route));
    return `<button class="${active ? 'active' : ''} ${route === 'card' ? 'nav-card' : ''}" data-route="${route}" aria-label="${label}"><span class="nav-icon-shell">${appIcon(icon)}</span><small>${label}</small></button>`;
  }).join('');
}

function startScreen() {
  return `
    <section class="hero">
      <div class="hero-card">
        <div class="hero-logo"><div class="logo-star"></div></div>
        <h1>Ласкаво просимо<br>у Star Club</h1>
        <div class="benefits">
          <div class="benefit"><span class="circle-icon">${appIcon('circle-star')}</span>Збирайте зірки</div>
          <div class="benefit"><span class="circle-icon">${appIcon('badge-percent')}</span>Клубні ціни</div>
          <div class="benefit"><span class="circle-icon">${appIcon('gift')}</span>Товари за зірки</div>
          <div class="benefit"><span class="circle-icon">${appIcon('user-round')}</span>Персональні пропозиції</div>
        </div>
        <button class="btn" data-route="register">Зареєструватися</button>
        <div class="social-auth">
          <button class="social-btn" data-auth-telegram type="button">${appIcon('send')}<span>Увійти через Telegram</span></button>
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
        <button class="social-btn" data-auth-telegram type="button">${appIcon('send')}<span>Увійти через Telegram</span></button>
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
        <span class="circle-icon">${appIcon('send')}</span>
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
      <label class="registration-store-field">
        <select class="input" name="favorite_store" required>
          <option value="">Улюблений магазин</option>
          ${storeOptions}
        </select>
        <span class="registration-field-chevron" aria-hidden="true"></span>
      </label>
      <input class="input" name="email" type="email" autocomplete="email" placeholder="Email (необовʼязково)" value="${c.email || ''}">
      <input class="input" name="preferences" placeholder="Вподобання через кому: кава, випічка" value="${Array.isArray(c.preferences) ? c.preferences.join(', ') : ''}">
      ${needPassword ? `
        <input class="input" name="password" type="password" autocomplete="new-password" placeholder="Пароль мінімум 6 символів" minlength="6" required>
        <input class="input" name="password_confirm" type="password" autocomplete="new-password" placeholder="Повторіть пароль" minlength="6" required>
      ` : ''}
      <section class="card gold-border registration-privacy-card">
        <h3>Реєстрація і конфіденційність</h3>
        <label class="check registration-privacy-check">
          <input type="checkbox" name="agree_privacy" ${(c.consents?.rules && c.consents?.personal_data && c.consents?.phone) ? 'checked' : ''} required>
          <span>Погоджуюсь з <button class="privacy-link" type="button" data-route="privacy">правилами конфіденційності</button></span>
        </label>
      </section>
      <button class="btn" type="submit">${c.registered ? 'Зберегти профіль' : 'Завершити реєстрацію'}</button>
    </form>
  `;
}


function privacyScreen() {
  return `
    ${header('Правила і конфіденційність', true)}
    <div class="stack privacy-page">
      <section class="card gold-border">
        <p class="eyebrow">STAR CLUB</p>
        <h2>Правила програми лояльності та Політика конфіденційності</h2>
        <p class="small">Редакція від 12 липня 2026 року.</p>
      </section>

      <section class="card">
        <h3>1. Загальні положення</h3>
        <p>Star Club — програма лояльності мережі магазинів «Надія». Реєстрація є добровільною. Учасник створює особистий акаунт, отримує цифрову картку, може накопичувати зірки, користуватися клубними або оптовими цінами, накопичувальними програмами, QR-кодами та персональними пропозиціями.</p>
        <p>Фактичні умови окремої пропозиції, строк її дії, перелік товарів, магазинів та інші обмеження відображаються у застосунку або визначаються правилами конкретної акції.</p>
      </section>

      <section class="card">
        <h3>2. Які дані обробляються</h3>
        <p>Для роботи Star Club можуть оброблятися: ім’я, мобільний номер, дата народження, електронна пошта за бажанням, улюблений магазин і вподобання; Telegram ID та дані, які Telegram передає застосунку; номер цифрової картки; історія покупок, товари, кількість, суми чеків, нарахування і списання зірок; прогрес накопичувальних програм і челенджів; QR-коди, купони та звернення до підтримки; технічні дані сесії, необхідні для входу, безпеки й роботи застосунку.</p>
      </section>

      <section class="card">
        <h3>3. Мета обробки</h3>
        <p>Дані використовуються для реєстрації та ідентифікації учасника, входу за номером телефону або Telegram, прив’язки цифрової картки, застосування клубних і оптових цін у 1С, ведення балансу зірок та історії чеків, нарахування прогресу, створення і підтвердження QR-кодів, підтримки користувача, запобігання зловживанням і забезпечення технічної безпеки.</p>
        <p>Маркетингові повідомлення надсилаються лише за окремою згодою. Відмова від них не припиняє участь у програмі.</p>
      </section>

      <section class="card">
        <h3>4. Обробка мобільного номера</h3>
        <p>Мобільний номер використовується як ідентифікатор учасника, для пошуку і прив’язки картки, входу до акаунта, відновлення доступу, об’єднання покупок з профілем, сервісних повідомлень та звернень до підтримки. Номер не повинен використовуватися для сторонньої реклами без окремої згоди учасника.</p>
      </section>

      <section class="card">
        <h3>5. Передавання і зберігання</h3>
        <p>Дані можуть оброблятися постачальниками технічної інфраструктури, Telegram, касовою системою та 1С, а також підрядниками, які забезпечують роботу сервісу, лише в обсязі, необхідному для їхніх функцій. Доступ до адміністративної частини обмежується авторизацією.</p>
        <p>Дані зберігаються протягом участі у програмі та додаткового строку, необхідного для виконання законних, бухгалтерських, безпекових або технічних вимог. Після припинення участі дані видаляються або знеособлюються, крім відомостей, які мають зберігатися за законом.</p>
      </section>

      <section class="card">
        <h3>6. Права учасника</h3>
        <p>Учасник може отримати інформацію про свої дані, уточнити або виправити їх, відкликати згоду на маркетингові повідомлення, звернутися щодо видалення акаунта чи припинення обробки, коли це допускається законодавством, а також подати звернення через розділ «Підтримка».</p>
        <p>Відкликання обов’язкової згоди на обробку даних, без яких неможливо ідентифікувати учасника та вести його бонусний рахунок, може призвести до закриття акаунта і припинення участі у програмі.</p>
      </section>

      <section class="card">
        <h3>7. Згода під час реєстрації</h3>
        <p>Позначаючи обов’язкові поля згоди та натискаючи «Завершити реєстрацію», учасник підтверджує, що прочитав ці правила, надає добровільну й поінформовану згоду на обробку персональних даних та окремо погоджується на обробку мобільного номера для цілей Star Club.</p>
        <p class="small">Для юридичного оформлення перед публічним запуском у цей документ потрібно підставити повне найменування, код ЄДРПОУ, адресу та контакт власника програми/володільця персональних даних.</p>
      </section>

      <button class="btn" type="button" data-route="register">Повернутися до реєстрації</button>
    </div>
  `;
}

function homeBanner() {
  const bannerData = state.data.banners || { enabled: false, items: [] };
  const slides = bannerData.enabled === false ? [] : (bannerData.items || []).slice(0, 8);
  if (!slides.length) return '';
  return `
    <section class="home-banner" aria-label="Банери Star Club">
      <div class="home-banner-rail">
        ${slides.map((item) => `
          <button class="home-banner-slide" type="button" ${item.link_route && item.link_route !== 'none' ? `data-route="${safeHtml(item.link_route)}"` : ''}>
            <div class="home-banner-copy">
              <span>${safeHtml(item.tag || 'STAR CLUB')}</span>
              <h2>${safeHtml(item.title || 'Новини Star Club')}</h2>
              <p>${safeHtml(item.text || '')}</p>
            </div>
            <div class="home-banner-media">
              <img src="${safeHtml(item.image_url || '/assets/star.svg')}" alt="" onerror="this.onerror=null;this.src='/assets/star.svg'">
            </div>
          </button>
        `).join('')}
      </div>
      <div class="home-banner-dots" aria-hidden="true">${slides.map((_, index) => `<i class="${index === 0 ? 'active' : ''}"></i>`).join('')}</div>
    </section>`;
}

function bindHomeBannerCarousel() {
  const rail = document.querySelector('.home-banner-rail');
  const dots = [...document.querySelectorAll('.home-banner-dots i')];
  if (!rail || dots.length < 2) return;

  let frame = 0;
  const syncDots = () => {
    frame = 0;
    const pageWidth = Math.max(1, rail.clientWidth);
    const activeIndex = Math.min(dots.length - 1, Math.max(0, Math.round(rail.scrollLeft / pageWidth)));
    dots.forEach((dot, index) => dot.classList.toggle('active', index === activeIndex));
  };
  rail.addEventListener('scroll', () => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(syncDots);
  }, { passive: true });
  syncDots();
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
      <div class="home-heading"><span>${appIcon('sparkles')}</span><h1>Вітаємо, ${safeHtml(c.name || 'друже')}!</h1></div>
      ${notificationButton()}
    </div>
    ${homeBanner()}
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
      <div class="home-progress-grid">
        <button class="card home-progress-card" type="button" data-route="progress">
          <span class="home-progress-icon">${appIcon('trophy')}</span>
          <span><b>${safeHtml(challenge?.name || 'Активні челенджі')}</b><small>${challenge ? `Ще ${challengeLeft} до бонусу ${fmtStars(challenge.reward_stars)} ★` : 'Нові завдання зʼявляться тут'}</small></span>
          <strong>${challengeText}</strong>
        </button>
        <button class="card home-progress-card" type="button" data-route="progress">
          <span class="home-progress-icon">${appIcon('coffee')}</span>
          <span><b>${safeHtml(stamp?.name || 'Накопичувальні')}</b><small>${stamp ? `Ще ${stampLeft} до безкоштовного коду` : 'Прогрес зʼявиться після покупок'}</small></span>
          <strong>${stampText}</strong>
        </button>
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
  { const data = await api('/api/client/reward-qrs'); state.data.rewardQrs = data.qrs || []; state.data.personalCoupons = data.coupons || []; }
}

async function loadOffers() {
  const data = await api('/api/client/offers');
  state.data.offers = data.offers || [];
  state.data.offerStores = data.stores || [];
  state.data.offerStoreId = data.favorite_store || state.client?.favorite_store || 'all';
  state.data.offerStoreName = data.favorite_store_name || data.stores?.[0]?.name || '';
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

async function loadBanners() {
  const data = await api('/api/client/banners');
  state.data.banners = { enabled: data.enabled !== false, items: data.banners || [] };
}

async function loadSupport() {
  state.data.supportTickets = (await api('/api/client/support/tickets')).tickets || [];
}

function activityStorageKey() {
  return `starclub_activity_${state.client?.id || state.client?.card_number || 'guest'}`;
}

function getLatestCouponKey(coupons = []) {
  const c = [...coupons].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0))[0];
  return c ? `${c.id || c.code}:${c.status || 'active'}:${c.created_at || ''}` : '';
}

function getLatestReceiptKey(receipts = []) {
  const r = [...receipts].sort((a, b) => new Date(b.purchased_at || b.created_at || 0) - new Date(a.purchased_at || a.created_at || 0))[0];
  return r ? `${r.id || ''}|${r.purchased_at || r.created_at || ''}` : '';
}

function getLatestReservedQrKey(qrs = []) {
  const active = qrs.filter((q) => q.status === 'reserved');
  const q = active.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0];
  return q ? `${q.token || q.manual_code || q.id}|${q.created_at || ''}` : '';
}

function getLatestAdminSupportKey(tickets = []) {
  const adminMessages = [];
  tickets.forEach((ticket) => (ticket.messages || []).forEach((m) => {
    if (m.sender_type === 'admin') adminMessages.push(m);
  }));
  const m = adminMessages.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0];
  return m ? `${m.id || m.created_at}|${m.created_at || ''}` : '';
}

async function getClientActivitySnapshot() {
  const [qrsData, receiptsData, supportData, meData] = await Promise.all([
    api('/api/client/reward-qrs'),
    api('/api/client/receipts'),
    api('/api/client/support/tickets'),
    api('/api/client/me')
  ]);
  state.client = meData.client;
  renderNav();
  const qrs = qrsData.qrs || [];
  const receipts = receiptsData.receipts || [];
  const tickets = supportData.tickets || [];
  return {
    latestQr: getLatestReservedQrKey(qrs),
    latestReceipt: getLatestReceiptKey(receipts),
    latestSupport: getLatestAdminSupportKey(tickets),
    balance: state.client?.stars_balance ?? null,
    qrsCount: qrs.length,
    receiptsCount: receipts.length,
    latestCoupon: getLatestCouponKey(qrsData.coupons || []),
    supportCount: tickets.reduce((sum, t) => sum + (t.messages || []).length, 0)
  };
}

function loadStoredActivitySnapshot() {
  try { return JSON.parse(localStorage.getItem(activityStorageKey()) || 'null'); } catch { return null; }
}

function saveActivitySnapshot(snapshot) {
  state.activitySnapshot = snapshot;
  try { localStorage.setItem(activityStorageKey(), JSON.stringify(snapshot)); } catch {}
}

async function checkClientActivity({ initialize = false } = {}) {
  if (!state.token || !state.client?.registered || state.activityBusy || document.hidden) return;
  state.activityBusy = true;
  try {
    const previous = state.activitySnapshot || loadStoredActivitySnapshot();
    const next = await getClientActivitySnapshot();
    if (initialize || !previous || !state.activityReady) {
      saveActivitySnapshot(next);
      state.activityReady = true;
      return;
    }

    let message = '';
    let route = '';
    if (next.latestQr && next.latestQr !== previous.latestQr) {
      message = 'Новий QR-код уже доступний у розділі «Мої QR-коди»';
      route = 'rewardCodes';
    } else if (next.latestSupport && next.latestSupport !== previous.latestSupport) {
      message = 'Підтримка відповіла на ваше звернення';
      route = 'support';
    } else if (next.latestReceipt && next.latestReceipt !== previous.latestReceipt) {
      message = 'Покупку додано в історію';
      route = 'history';
    }

    saveActivitySnapshot(next);
    state.activityReady = true;
    if (message) notifyInApp(message, route, { dedupeKey: `${route}:${next.latestQr || next.latestSupport || next.latestReceipt}` });
  } catch (error) {
    console.warn('Activity check failed:', error.message || error);
  } finally {
    state.activityBusy = false;
  }
}

function hasFocusedEditor() {
  const active = document.activeElement;
  return Boolean(active && active.matches?.('input, textarea, select'));
}

function routeNeedsLiveRender(route = state.route) {
  return ['home', 'card', 'rewards', 'rewardCodes', 'history', 'progress', 'support'].includes(route);
}

async function refreshVisibleData({ forceRender = false } = {}) {
  if (!state.token || state.liveBusy || document.hidden) return;
  if (!forceRender && hasFocusedEditor()) return;
  state.liveBusy = true;
  try {
    await refreshClient();
    if (state.route === 'home') await Promise.all([loadProgress(), loadBanners()]);
    if (state.route === 'rewards') await loadRewards();
    if (state.route === 'rewardCodes') await loadRewardQrs();
    if (state.route === 'history') await loadHistory();
    if (state.route === 'progress') await loadProgress();
    if (state.route === 'support') await loadSupport();
    const signature = JSON.stringify({
      route: state.route,
      client: state.client,
      routeData: state.route === 'home'
        ? { progress: state.data.progress, banners: state.data.banners }
        : state.data[state.route === 'rewardCodes' ? 'rewardQrs' : state.route === 'support' ? 'supportTickets' : state.route]
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
  state.liveTimer = window.setInterval(() => {
    refreshVisibleData();
    checkClientActivity();
  }, 6000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshVisibleData({ forceRender: true });
      checkClientActivity();
    }
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
      <button class="card gold-border reward-codes-link" data-route="rewardCodes"><b>Мої QR-коди</b><p class="small">Активні коди та історія використання</p></button>
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
  const coupons = state.data.personalCoupons || [];
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
      ${coupons.length ? `<section class="card personal-coupon-list"><div class="section-heading compact"><span>${appIcon('ticket-percent')}</span><div><h3>Персональні знижки</h3><p>Лише для вас</p></div></div>${coupons.map(c=>`<article class="personal-coupon-card"><span class="personal-coupon-value">−${c.discount_percent}%</span><div class="personal-coupon-copy"><b>${safeHtml(c.product_name||'Персональна пропозиція')}</b><p>Діє до ${new Date(c.expires_at).toLocaleDateString('uk-UA')}</p></div><button type="button" class="btn personal-coupon-show" data-show-personal-coupon="${safeHtml(c.code)}" data-coupon-name="${safeHtml(c.product_name||'Персональна пропозиція')}" data-coupon-percent="${Number(c.discount_percent||0)}" data-coupon-expiry="${safeHtml(c.expires_at||'')}">Показати касиру</button></article>`).join('')}</section>` : ''}
      <section class="card gold-border"><b>Активні</b>${active.length ? active.map(renderQr).join('') : '<div class="empty">Активних кодів немає</div>'}</section>
      <section class="card"><b>Історія</b>${history.length ? history.map(renderQr).join('') : '<div class="empty">Історія кодів порожня</div>'}</section>
    </div>
  `;
}

function formatOfferMoney(cents) {
  return `${(Number(cents || 0) / 100).toFixed(2).replace('.', ',')} грн`;
}

function clientOfferPriceLabel(o) {
  if (o.current_price_cents !== null && o.current_price_cents !== undefined) {
    return `${o.price_from ? 'від ' : ''}${formatOfferMoney(o.current_price_cents)}`;
  }
  return o.discount_label || 'Star Club';
}

function offersScreen() {
  const all = state.data.offers || [];
  const tab = state.data.offerTab || 'club';
  const selectedStore = state.data.offerStoreId || state.client?.favorite_store || 'all';
  const selectedStoreName = state.data.offerStoreName || selectedStore;
  const items = all.filter((o) => {
    if (o.type !== tab) return false;
    const offerStore = String(o.store_id || 'all');
    return offerStore === 'all' || selectedStore === 'all' || offerStore === String(selectedStore);
  });
  return `
    ${header(tab === 'club' ? 'Клубні пропозиції' : 'Оптові пропозиції', true)}
    <div class="stack">
      <div class="tabs">
        <button class="${tab === 'club' ? 'active' : ''}" data-offer-tab="club">Клубні</button>
        <button class="${tab === 'wholesale' ? 'active' : ''}" data-offer-tab="wholesale">Оптові</button>
      </div>
      <div class="offers-store-note">${appIcon('store')}<span>Ціни для улюбленого магазину</span><b>${safeHtml(selectedStoreName || 'не вибрано')}</b></div>
      ${items.map((o) => {
        const oldPrice = o.old_price_cents === null || o.old_price_cents === undefined ? null : Number(o.old_price_cents);
        const newPrice = o.current_price_cents === null || o.current_price_cents === undefined ? null : Number(o.current_price_cents);
        const saving = o.saving_cents === null || o.saving_cents === undefined
          ? (oldPrice !== null && newPrice !== null ? Math.max(0, oldPrice - newPrice) : null)
          : Number(o.saving_cents);
        const kindLabel = o.type === 'wholesale' ? 'Оптова' : 'Клубна';
        const showRule = o.type === 'wholesale' && o.discount_label;
        return `<article class="card promo-feed-card offer-compact-card">
          <div class="promo-feed-card__body">
            <div class="offer-compact-meta"><span>${kindLabel}</span><small>${safeHtml(o.store_name || o.store_id || 'Усі магазини')}</small></div>
            <h3>${safeHtml(o.target_name || o.name)}</h3>
            <p class="promo-feed-description">${safeHtml(o.description || '')}</p>
            <div class="offer-compact-prices">${newPrice !== null ? `<strong>${o.price_from ? 'від ' : ''}${formatOfferMoney(newPrice)}</strong>` : `<strong>${safeHtml(o.discount_label || 'Star Club')}</strong>`}${oldPrice !== null ? `<s>${o.price_from ? 'від ' : ''}${formatOfferMoney(oldPrice)}</s>` : ''}${saving !== null && saving > 0 ? `<span>−${formatOfferMoney(saving)}</span>` : ''}</div>
            ${showRule ? `<p class="offer-compact-rule">${safeHtml(o.discount_label)}</p>` : ''}
          </div>
          <div class="promo-feed-card__media"><img src="${safeHtml(o.image_url || '/assets/star.svg')}" alt="${safeHtml(o.name)}" onerror="this.onerror=null;this.src='/assets/star.svg'"></div>
        </article>`;
      }).join('') || '<div class="card empty">Активних пропозицій для цього магазину поки немає</div>'}
    </div>`;
}

function progressScreen() {
  const p = state.data.progress || { stamps: [], challenges: [] };
  const progressSteps = (value, required, iconName) => {
    const total = Math.max(1, Math.min(10, Number(required || 1)));
    const filled = Math.min(total, Math.round((Number(value || 0) / Math.max(1, Number(required || 1))) * total));
    return Array.from({ length: total }, (_, index) => `<span class="program-step ${index < filled ? 'filled' : ''}">${appIcon(iconName)}</span>`).join('');
  };
  return `
    ${header('Прогрес і активність', true)}
    <div class="stack">
      <section class="progress-hero">
        <span>${appIcon('award')}</span>
        <div><p class="eyebrow">STAR CLUB</p><h2>Ваші цілі та винагороди</h2><p>Виконуйте завдання — прогрес оновлюється автоматично після покупок.</p></div>
      </section>
      <div class="section-heading"><span>${appIcon('trophy')}</span><div><h3>Активні челенджі</h3><p>Виконуйте завдання та отримуйте зірки</p></div></div>
      ${p.challenges.map((c) => `
        <section class="card challenge-card">
          <div class="challenge-card-head"><span>${appIcon('target')}</span><div><b>${safeHtml(c.name)}</b><p>${safeHtml(c.description || '')}</p></div><strong>${c.progress}/${c.required_visits}</strong></div>
          <div class="progressbar"><span style="width:${Math.min(100, c.progress / Math.max(1, c.required_visits) * 100)}%"></span></div>
          <p class="challenge-reward">Залишилось ${Math.max(0, c.required_visits - c.progress)} · винагорода <b>${fmtStars(c.reward_stars)} ★</b></p>
        </section>
      `).join('') || '<div class="empty">Активних челенджів поки немає</div>'}
      <div class="section-heading"><span>${appIcon('coffee')}</span><div><h3>Накопичувальні програми</h3><p>Збирайте покупки до безкоштовного коду</p></div></div>
      ${p.stamps.map((s) => `
        <section class="card stamp-program-card">
          <div class="stamp-program-head"><div><p class="eyebrow">ПРОГРАМА ЛОЯЛЬНОСТІ</p><h3>${safeHtml(s.name)}</h3></div><strong>${s.progress}/${s.required_qty}</strong></div>
          <div class="program-steps">${progressSteps(s.progress, s.required_qty, /кав|coffee/i.test(s.name || '') ? 'coffee' : 'shopping-bag')}</div>
          <div class="progressbar"><span style="width:${Math.min(100, s.progress / Math.max(1, s.required_qty) * 100)}%"></span></div>
          <div class="program-hint">${appIcon('gift')}<span>Ще <b>${Math.max(0, s.required_qty - s.progress)}</b> до безкоштовного коду. Винагорода зʼявиться автоматично.</span></div>
        </section>
      `).join('') || '<div class="empty">Накопичувальних програм поки немає</div>'}
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
      <p class="small">${receipt.store_name || receipt.display_title || 'Магазин Star'} · ${new Date(receipt.purchased_at).toLocaleDateString('uk-UA')} ${fmtTime(receipt.purchased_at)}</p>
      <div class="receipt-summary-grid">
        <div><span>Сума</span><b>${receipt.is_reward_purchase ? '0 грн' : `${receipt.total_uah} грн`}</b></div>
        <div>
  <span>Нараховано за інші товари</span>
  <b>+${fmtStars(receipt.stars_accrued || 0)} ★</b>
</div>
      </div>
      <div class="receipt-items">
        ${items.length ? items.map((item) => `
          <div class="receipt-item">
            <div class="receipt-item-main"><b>${item.name || 'Товар'}</b><p class="small">${item.external_product_id || item.product_id || 'Без коду'}</p></div>
            <div class="receipt-item-right"><span>${Number(item.qty || 1)} × ${(Math.round(Number(item.price_cents || 0)) / 100).toFixed(2)} грн</span><b>${(Math.round(Number(item.line_total_cents || 0)) / 100).toFixed(2)} грн</b></div>
          </div>
        `).join('') : '<div class="empty">1С не передала товарні позиції цього чека. Перевірте масив items у відправці чека.</div>'}
      </div>
      <div class="receipt-total">
  <span>${receipt.is_reward_purchase ? 'Нараховано за інші товари' : 'Разом'}</span>
  <b>${receipt.is_reward_purchase
    ? `+${fmtStars(receipt.stars_accrued || 0)} ★`
    : `${receipt.total_uah} грн`}</b>
</div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelectorAll('[data-close-modal]').forEach((b) => b.onclick = () => wrap.remove());
}

function historyScreen() {
  const ledger = state.data.ledger || [];
  const receipts = state.data.receipts || [];
  const filter = state.data.historyFilter || 'receipts';
  const filteredLedger = ledger.filter((item) => filter === 'income' ? Number(item.amount) > 0 : filter === 'expense' ? Number(item.amount) < 0 : false);
  let previousDay = '';
  const ledgerRows = filteredLedger.map((item) => {
    const day = new Date(item.created_at).toLocaleDateString('uk-UA');
    const dayLabel = day !== previousDay ? `<div class="history-day-label">${day}</div>` : ''; previousDay = day;
    const positive = Number(item.amount) > 0;
    return `${dayLabel}<div class="history-event"><span class="history-event-icon ${positive?'income':'expense'}">${appIcon(positive?'plus':'minus')}</span><div><b>${safeHtml(item.description||item.type)}</b><p>${fmtTime(item.created_at)}</p></div><strong class="${positive?'plus':'minus'}">${positive?'+':''}${fmtStars(item.amount)} ★</strong></div>`;
  }).join('');
  const receiptRows = receipts.map((r) => `
  <button
    class="receipt-history-row"
    type="button"
    data-open-receipt="${r.id}"
  >
    <span>${appIcon(r.is_reward_purchase ? 'gift' : 'receipt-text')}</span>

    <div>
      <b>
        ${r.is_reward_purchase
          ? 'Покупка за зірки'
          : safeHtml(r.store_name || r.display_title || 'Магазин Star')}
      </b>

      <p>
        ${new Date(r.purchased_at).toLocaleDateString('uk-UA')}
        · ${(r.items || []).length} товарів
      </p>
    </div>

    <strong class="${Number(r.stars_accrued || 0) > 0 ? 'plus' : ''}">
      ${r.is_reward_purchase
        ? `+${fmtStars(r.stars_accrued || 0)} ★`
        : `${r.total_uah} грн`}
    </strong>
  </button>
`).join('');
  return `${header('Історія', true)}<div class="stack"><section class="history-balance-card"><div><p>Ваш баланс</p><div>${fmtStars(state.client.stars_balance)} <span>★</span></div></div><i>${appIcon('circle-star')}</i></section><div class="history-filters">${[['receipts','Чеки'],['income','Нарахування'],['expense','Списання']].map(([v,l])=>`<button type="button" class="${filter===v?'active':''}" data-history-filter="${v}">${l}</button>`).join('')}</div><section class="card history-list-card">${filter==='receipts'?`<div class="section-heading compact"><span>${appIcon('receipt-text')}</span><div><h3>Чеки</h3><p>Без дублювання руху зірок</p></div></div><div class="timeline">${receiptRows||'<div class="empty">Чеків ще немає</div>'}</div>`:`<div class="section-heading compact"><span>${appIcon('history')}</span><div><h3>${filter==='income'?'Нарахування':'Списання'}</h3><p>Тільки операції руху зірок без чеків</p></div></div><div class="history-events">${ledgerRows||'<div class="empty">Операцій немає</div>'}</div>`}</section></div>`;
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
      <button data-route="stores"><b>${appIcon('store')}</b><span>Магазини</span></button>
      <button data-route="rewardCodes"><b>${appIcon('qr-code')}</b><span>Мої QR-коди</span></button>
      <button data-route="progress"><b>${appIcon('trophy')}</b><span>Прогрес</span></button>
      <button data-route="history"><b>${appIcon('history')}</b><span>Історія</span></button>
      <button data-route="news"><b>${appIcon('newspaper')}</b><span>Новини</span></button>
      <button data-route="profile"><b>${appIcon('user-round-pen')}</b><span>Профіль</span></button>
      <button data-route="support"><b>${appIcon('message-circle')}</b><span>Підтримка</span></button>
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
        <section class="card promo-feed-card news-feed-card">
          <div class="promo-feed-card__body">
            <p class="promo-feed-kicker">${safeHtml(n.tag || 'STAR CLUB')}</p>
            <h3>${safeHtml(n.title)}</h3>
            <p class="promo-feed-description">${safeHtml(n.text)}</p>
          </div>
          <div class="promo-feed-card__media"><img src="${safeHtml(n.image_url || '/assets/star.svg')}" alt="${safeHtml(n.title)}" onerror="this.onerror=null;this.src='/assets/star.svg'"></div>
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

function showPersonalCouponModal(button) {
  const code = String(button?.dataset?.showPersonalCoupon || '').trim();
  if (!code) return;
  const expiry = button.dataset.couponExpiry ? new Date(button.dataset.couponExpiry).toLocaleDateString('uk-UA') : '';
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal personal-coupon-modal personal-coupon-modal-simple">
    <button class="icon-btn compact personal-coupon-close" data-close-modal>×</button>
    <div class="barcode barcode-large"><img src="/api/svg/barcode?text=${encodeURIComponent(code)}" alt="Код персональної знижки"></div>
    <div class="manual-code"><span>Код для касира</span><b>${safeHtml(code)}</b><button type="button" class="mini-copy" data-copy-code="${safeHtml(code)}">Скопіювати</button></div>
    <p class="small coupon-use-note">Код одноразовий${expiry ? ` · діє до ${expiry}` : ''}.</p>
    <div class="modal-actions"><button class="btn" type="button" data-close-modal>Готово</button></div>
  </div>`;
  document.body.appendChild(wrap);
  wrap.querySelectorAll('[data-close-modal]').forEach(el=>el.onclick=()=>wrap.remove());
  wrap.querySelector('[data-copy-code]')?.addEventListener('click', async()=>{ try{await navigator.clipboard.writeText(code);toast('Код скопійовано');}catch{toast(code);} });
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
    await checkClientActivity({ initialize: true });
  };
  wrap.querySelector('[data-copy-code]').onclick = async () => { try { await navigator.clipboard.writeText(manualCode); toast('Код скопійовано'); } catch { toast(manualCode); } };
  wrap.querySelector('[data-cancel-reward-code]').onclick = async () => {
    try {
      await api('/api/client/reward-qr/cancel', { method: 'POST', body: JSON.stringify({ token: manualCode }) });
      toast('Код скасовано, зірки знову доступні');
      wrap.remove();
      await refreshClient();
      await loadRewards();
      await checkClientActivity({ initialize: true });
      if (state.route === 'rewards' || state.route === 'rewardCodes') render();
    } catch (e) { toast(e.message); }
  };
}

async function render() {
  renderNav();
  if (!state.client?.registered && !['register', 'login', 'telegramPassword', 'privacy'].includes(state.route)) {
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
    else if (state.route === 'more') $app.innerHTML = moreScreen();
    else if (state.route === 'news') { await loadNews(); $app.innerHTML = newsScreen(); }
    else if (state.route === 'support') { await loadSupport(); $app.innerHTML = supportScreen(); }
    else if (state.route === 'profile') $app.innerHTML = profileScreen();
    else if (state.route === 'rewardCodes') { await loadRewardQrs(); $app.innerHTML = rewardCodesScreen(); }
    else if (state.route === 'telegramPassword') $app.innerHTML = telegramPasswordScreen();
    else if (state.route === 'privacy') $app.innerHTML = privacyScreen();
    else if (state.route === 'register') $app.innerHTML = registerScreen();
    else if (state.route === 'login') $app.innerHTML = loginScreen();
    else { await Promise.all([loadProgress(), loadBanners()]); $app.innerHTML = homeScreen(); }
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
  if (state.route === 'card' && state.openCashierOnCard) {
    state.openCashierOnCard = false;
    const cashierButton = document.querySelector('[data-show-cashier]');
    if (cashierButton) showCashierModal(cashierButton.dataset.cardNumber);
  }
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
  if (!fd.has('agree_privacy')) return 'Потрібно погодитися з правилами конфіденційності';
  return null;
}

function bindNotificationEvents() {
  document.querySelectorAll('[data-toggle-notifications]').forEach((el) => el.onclick = (event) => {
    event.stopPropagation();
    state.notificationPanelOpen = !state.notificationPanelOpen;
    render();
  });
  document.querySelectorAll('[data-open-notification]').forEach((el) => el.onclick = (event) => {
    event.stopPropagation();
    ensureNotificationsLoaded();
    const n = state.notifications.find((item) => item.id === el.dataset.openNotification);
    if (!n) return;
    n.read = true;
    saveNotifications();
    state.notificationPanelOpen = false;
    if (n.route) setRoute(n.route);
    else render();
  });
  document.querySelectorAll('[data-clear-notifications]').forEach((el) => el.onclick = (event) => {
    event.stopPropagation();
    state.notifications = [];
    saveNotifications();
    state.notificationPanelOpen = false;
    render();
  });
}

function bindEvents() {
  bindHomeBannerCarousel();
  bindNotificationEvents();
  document.querySelectorAll('[data-route]').forEach((el) => {
    if ($nav.contains(el)) return;
    el.onclick = (event) => {
      event?.preventDefault?.();
      if (el.dataset.route === 'card') state.openCashierOnCard = true;
      setRoute(el.dataset.route);
    };
  });
  document.querySelectorAll('[data-back="1"]').forEach((el) => el.onclick = () => setRoute(state.client?.registered ? 'home' : 'start'));
  document.querySelectorAll('[data-offer-tab]').forEach((el) => el.onclick = () => { state.data.offerTab = el.dataset.offerTab; render(); });
  document.querySelectorAll('[data-history-filter]').forEach((el) => el.onclick = () => { state.data.historyFilter = el.dataset.historyFilter; render(); });
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
      await checkClientActivity({ initialize: true });
      if (state.route === 'rewards' || state.route === 'rewardCodes') render();
    } catch (e) { toast(e.message); }
  });
  document.querySelectorAll('[data-open-receipt]').forEach((el) => el.onclick = () => showReceiptModal(el.dataset.openReceipt));
  document.querySelectorAll('[data-show-personal-coupon]').forEach((el) => el.onclick = () => showPersonalCouponModal(el));

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
      notifyInApp('QR-код створено. Відкрийте його через дзвіночок або розділ «Мої QR-коди».', 'rewardCodes', { dedupeKey: `created-qr:${data.qr?.token || data.qr?.manual_code || Date.now()}` });
      await refreshClient();
      await loadRewards();
      await checkClientActivity({ initialize: true });
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
      const agreedPrivacy = fd.has('agree_privacy');
      body.agree_rules = agreedPrivacy;
      body.agree_personal_data = agreedPrivacy;
      body.agree_phone_processing = agreedPrivacy;
      body.consent_version = '2026-07-13';
      // Маркетингове налаштування не показуємо під час реєстрації і не змінюємо без окремої дії користувача.
      body.marketing_allowed = state.client?.marketing_allowed !== false;
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



// Делегований обробник не губиться, навіть коли renderNav() перебудовує кнопки.
$nav.addEventListener('click', (event) => {
  const button = event.target.closest('[data-route]');
  if (!button || !$nav.contains(button)) return;
  event.preventDefault();
  event.stopPropagation();
  if (button.disabled) return;
  if (button.dataset.route === 'card') state.openCashierOnCard = true;
  setRoute(button.dataset.route);
});

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
