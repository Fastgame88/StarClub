# Інструкція підключення 1С до Star Club

Цей прототип очікує, що інтеграція з 1С буде через REST API.

## 1. Що потрібно доробити в 1С

У конфігурації 1С / касовій програмі потрібно додати невелику інтеграційну модифікацію:

1. Зберегти в налаштуваннях 1С:
   - `StarClubApiUrl` — адреса Star Club backend;
   - `StarClubApiToken` — секретний токен `ONE_C_API_TOKEN`.

2. Додати HTTP-клієнт для запитів до Star Club.

3. Додати обробку сканування карти клієнта:
   - якщо скановано QR/штрихкод картки — викликати `GET /api/1c/client/search`;
   - якщо код не сканується — шукати за телефоном.

4. Після закриття чека передавати чек у Star Club:
   - `POST /api/1c/receipts`.

5. При скануванні QR товару за зірки:
   - до закриття чека викликати `POST /api/1c/reward-qr/validate`;
   - після успішного закриття чека викликати `POST /api/1c/reward-qr/finalize`;
   - якщо чек скасовано — викликати `POST /api/1c/reward-qr/cancel`.

6. При поверненні:
   - викликати `POST /api/1c/returns`.

7. Раз на день або при зміні товарів синхронізувати номенклатуру:
   - `POST /api/1c/products/sync`.

---

## 2. Які додаткові модифікації потрібні в 1С

### 2.1. Константи / налаштування

Потрібно додати в 1С:

```txt
StarClubApiUrl = https://your-domain.up.railway.app
StarClubApiToken = довгий_секретний_токен
StarClubEnabled = true/false
```

### 2.2. Реквізити для чека

У документі чека або в касовій обробці потрібно мати можливість зберегти:

```txt
StarClubClientCardNumber
StarClubClientPhone
StarClubClientName
StarClubStarsBalance
StarClubRewardQrToken
StarClubStarsSpent
StarClubStarsAccrued
```

Не обов'язково створювати всі реквізити в документі, але бажано зберігати хоча б зв'язку `receipt_id ↔ card_number ↔ stars_accrued/spent`.

### 2.3. Ознаки товарів

У номенклатурі або характеристиках товару потрібно мати ознаки:

```txt
is_alcohol
is_tobacco
is_min_margin
no_star_accrual
no_redeem
```

Ці ознаки передаються в кожній позиції чека. Саме вони вирішують, нараховувати зірки чи ні.

### 2.4. Події, де потрібні виклики API

| Подія в 1С | Що робити |
|---|---|
| Скан карти клієнта | `/api/1c/client/search` |
| Введення телефону клієнта | `/api/1c/client/search?phone=` |
| Закриття чека | `/api/1c/receipts` |
| Скан QR товару за зірки | `/api/1c/reward-qr/validate` |
| Чек із товаром за зірки успішно закрито | `/api/1c/reward-qr/finalize` |
| Чек скасовано | `/api/1c/reward-qr/cancel` |
| Повернення | `/api/1c/returns` |
| Оновлення номенклатури | `/api/1c/products/sync` |

---

## 3. Правильний сценарій покупки

1. Клієнт показує QR/штрихкод карти.
2. Касир сканує код.
3. 1С викликає:

```http
GET /api/1c/client/search?card_token=...
```

4. Star Club повертає баланс, статус, доступні винагороди.
5. Касир проводить продаж.
6. Після оплати 1С передає чек:

```http
POST /api/1c/receipts
```

7. Star Club:
   - перевіряє, що чек не дубльований;
   - рахує зірки тільки по дозволених позиціях;
   - оновлює баланс;
   - оновлює челенджі;
   - оновлює 10-ту каву / багет;
   - пише операцію в журнал.

8. Клієнт бачить нові зірки в Mini App.

---

## 4. Правильний сценарій товару за зірки

1. Клієнт у Mini App натискає “Отримати”.
2. Star Club створює одноразовий QR на 15 хвилин.
3. Зірки стають зарезервованими.
4. Касир сканує QR.
5. 1С викликає:

```http
POST /api/1c/reward-qr/validate
```

6. Якщо QR дійсний, 1С додає відповідний товар у чек.
7. Після закриття чека 1С викликає:

```http
POST /api/1c/reward-qr/finalize
```

8. Star Club остаточно списує зірки.
9. QR отримує статус `used`.

Якщо чек скасовано:

```http
POST /api/1c/reward-qr/cancel
```

Тоді резерв скасовується.

---

## 5. Важливо для тестування

Обов'язково перевірити:

1. Один чек не нараховується двічі.
2. Алкоголь і тютюн не дають зірок.
3. Товари з `no_star_accrual=true` не дають зірок.
4. QR за зірки працює один раз.
5. Протермінований QR не приймається.
6. Якщо чек скасовано, QR скасовується.
7. Повернення зменшує баланс.
8. Якщо зірки вже витрачені, баланс може піти в мінус або потрібно ручне рішення — це треба погодити з власником.
9. Челендж рахує максимум одне відвідування на день.
10. 10-та кава / багет не збивається при повторних чеках.

---

## 6. Тестові curl-запити

### Пошук клієнта

```bash
curl -H "X-Starclub-Token: change-this-1c-token" \
  "http://localhost:3000/api/1c/client/search?phone=%2B380501112233"
```

### Передати чек

```bash
curl -X POST "http://localhost:3000/api/1c/receipts" \
  -H "Content-Type: application/json" \
  -H "X-Starclub-Token: change-this-1c-token" \
  -d '{
    "id":"CHK-TEST-001",
    "purchased_at":"2026-05-17T12:30:00+03:00",
    "store_id":"star-center",
    "cash_register":"KASA-1",
    "cashier":"Іван",
    "phone":"+380501112233",
    "total_cents":35600,
    "items":[
      {"external_product_id":"1C-COFFEE-001","name":"Кава","category":"coffee","qty":1,"price_cents":3500,"line_total_cents":3500,"flags":{"is_alcohol":false,"is_tobacco":false,"is_min_margin":false,"no_star_accrual":false,"no_redeem":false}},
      {"external_product_id":"1C-BREAD-001","name":"Багет","category":"bakery","qty":1,"price_cents":2500,"line_total_cents":2500,"flags":{"is_alcohol":false,"is_tobacco":false,"is_min_margin":false,"no_star_accrual":false,"no_redeem":false}}
    ]
  }'
```
