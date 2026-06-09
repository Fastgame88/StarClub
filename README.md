# Star Club — Telegram Mini App Prototype

Перший робочий прототип програми лояльності **Star Club** для продуктової мережі.

Усередині архіву вже є:

- Telegram Mini App у темному графітово-золотому стилі;
- цифрова карта з QR-кодом і штрихкодом;
- реєстрація клієнта;
- повний профіль із бонусом 500 зірок;
- баланс зірок без гривневого еквіваленту;
- товари за зірки;
- одноразовий QR для товару за зірки;
- клубні та оптові пропозиції;
- челенджі;
- прогрес 10-та кава / 10-й багет;
- історія зірок;
- історія чеків;
- новини;
- базова адмін-панель;
- REST API для тестової інтеграції з 1С;
- приклад модуля 1С у папці `integration-1c`.

> Це саме прототип/MVP-основа. Для бойового запуску треба підключити реальну 1С, провести тест на одному магазині, узгодити формат чеків і перевірити всі повернення/списання.

---

## 1. Технології

- Node.js 20+
- Express
- SQLite-файл через sql.js для прототипу
- Telegram Bot API / Telegram Mini App
- REST API для 1С

---

## 2. Структура проєкту

```txt
star-club-miniapp-prototype/
├─ public/
│  ├─ index.html              # Telegram Mini App
│  ├─ app.js                  # логіка клієнтського додатку
│  ├─ styles.css              # графітово-золотий дизайн
│  ├─ admin.html              # адмін-панель
│  ├─ admin.js
│  ├─ admin.css
│  └─ assets/                 # SVG-заглушки товарів і логотипу
├─ src/
│  ├─ index.js                # backend + API + 1C endpoints
│  ├─ db.js                   # SQLite-файл через sql.js, таблиці, seed-дані
│  ├─ telegram.js             # перевірка Telegram initData
│  ├─ bot.js                  # Telegram Bot
│  └─ seed.js                 # ручна ініціалізація БД
├─ docs/
│  ├─ api-contract.md         # API контракт для 1С
│  ├─ 1c-integration.md       # як підключати 1С
│  └─ acceptance-tests.md     # сценарії тестування
├─ integration-1c/
│  └─ StarClubHTTPClient.bsl  # приклад модуля для 1С
├─ data/                      # SQLite-файл через sql.js база створиться автоматично
├─ .env.example
├─ package.json
├─ railway.json
└─ Procfile
```

---

## 3. Локальний запуск

### Крок 1. Встановити Node.js

Потрібен Node.js 20 або новіший.

### Крок 2. Відкрити папку проєкту

```bash
cd star-club-miniapp-prototype
```

### Крок 3. Встановити залежності

```bash
npm install
```

### Крок 4. Створити `.env`

Скопіювати файл:

```bash
cp .env.example .env
```

Для Windows CMD:

```cmd
copy .env.example .env
```

### Крок 5. Запустити

```bash
npm start
```

Відкрити у браузері:

```txt
http://localhost:3000
```

Адмін-панель:

```txt
http://localhost:3000/admin
```

Ключ адмінки за замовчуванням у `.env.example`:

```txt
change-this-admin-key
```

---

## 4. Демо-режим

У `.env` є параметр:

```env
ALLOW_DEV_LOGIN=true
```

Він дозволяє відкривати Mini App у звичайному браузері без Telegram. Для реального Telegram-запуску потрібно поставити:

```env
ALLOW_DEV_LOGIN=false
BOT_TOKEN=реальний_токен_бота
WEBAPP_URL=https://ваш-домен
APP_URL=https://ваш-домен
```

---

## 5. Підключення Telegram Bot

1. У BotFather створити бота.
2. Отримати `BOT_TOKEN`.
3. У `.env` прописати:

```env
BOT_TOKEN=123456:xxxx
WEBAPP_URL=https://your-domain.up.railway.app
APP_URL=https://your-domain.up.railway.app
RUN_BOT=true
```

4. Для локального тесту бота:

```bash
npm run bot
```

5. Для Railway можна запускати в одному процесі лише веб-сервер, а бота окремим сервісом. У першому прототипі найпростіше використовувати веб-сервер і кнопку відкриття Mini App через BotFather.

---

## 6. Деплой на Railway

1. Створити GitHub репозиторій.
2. Запушити цей проєкт.
3. У Railway створити новий Project → Deploy from GitHub.
4. Додати змінні:

```env
NODE_ENV=production
PORT=3000
APP_URL=https://your-domain.up.railway.app
WEBAPP_URL=https://your-domain.up.railway.app
BOT_TOKEN=токен_бота
ADMIN_API_KEY=довгий_секретний_ключ
ONE_C_API_TOKEN=довгий_секретний_ключ_для_1С
ALLOW_DEV_LOGIN=false
DATABASE_FILE=/data/star-club.sqlite
```

5. Для SQLite-файл через sql.js на Railway бажано додати Volume і примонтувати його в `/data`, щоб база не зникала після redeploy.

Для production краще перейти на PostgreSQL, але для першого прототипу SQLite-файл через sql.js достатньо.

---

## 7. Основна логіка зірок

Базове правило:

```txt
1 грн дозволеної частини чека = 1 зірка
```

Не нараховуються зірки на позиції з ознаками:

- `is_alcohol`
- `is_tobacco`
- `is_min_margin`
- `no_star_accrual`

Списання за товари за зірки:

1. Клієнт у Mini App обирає товар.
2. Система створює одноразовий QR.
3. Зірки потрапляють у резерв.
4. 1С перевіряє QR.
5. Після закриття чека 1С викликає finalize.
6. Зірки списуються остаточно.
7. Якщо чек не завершено — 1С викликає cancel або QR протерміновується.

---

## 8. 1С інтеграція

Детально описано тут:

```txt
docs/1c-integration.md
docs/api-contract.md
integration-1c/StarClubHTTPClient.bsl
```

Коротко: 1С повинна звертатись до Star Club API з заголовком:

```http
X-Starclub-Token: ONE_C_API_TOKEN
```

Основні endpoints:

```txt
GET  /api/1c/client/search
POST /api/1c/receipts
POST /api/1c/reward-qr/validate
POST /api/1c/reward-qr/finalize
POST /api/1c/reward-qr/cancel
POST /api/1c/returns
POST /api/1c/products/sync
```

---

## 9. Що треба доробити перед бойовим запуском

1. Узгодити точний формат даних із 1С.
2. Підключити реальну 1С / касову систему.
3. Додати повноцінну адмінку створення пропозицій, челенджів і товарів.
4. Додати Telegram-розсилки з чергою відправки.
5. Перейти з SQLite-файл через sql.js на PostgreSQL.
6. Провести тест на одному магазині.
7. Перевірити повернення, дублікати чеків, відʼємний баланс.
8. Додати ролі Owner / Admin / Support в адмінці.
9. Додати журнал зміни правил бонусів.

---

## 10. Тестові дані

У демо вже є клієнт:

```txt
Імʼя: Андрій
Телефон: +380501112233
Картка: SC 1234 5678 9012
Баланс: 1250 ★
```

Для тесту 1С використовуйте:

```txt
card_number=SC 1234 5678 9012
phone=+380501112233
```


## Виправлення для Windows / Node 24

У цій версії прибрано `better-sqlite3`, бо на Windows із Node.js 24 він часто падає на `node-gyp`.
База працює через `sql.js`, тому Visual Studio Build Tools не потрібні.

Якщо раніше запускали стару версію, перед запуском очистіть залежності:

```cmd
rmdir /s /q node_modules
del package-lock.json
npm cache clean --force
npm install
npm start
```
