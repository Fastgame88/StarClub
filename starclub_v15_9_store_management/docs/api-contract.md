# Star Club API Contract для 1С

Базова адреса:

```txt
https://your-domain.up.railway.app
```

Авторизація 1С:

```http
X-Starclub-Token: ONE_C_API_TOKEN
Content-Type: application/json
```

---

## 1. Пошук клієнта

### Request

```http
GET /api/1c/client/search?card_number=SC%201234%205678%209012
GET /api/1c/client/search?card_token=card_xxx
GET /api/1c/client/search?phone=%2B380501112233
```

### Response

```json
{
  "ok": true,
  "found": true,
  "client": {
    "card_number": "SC 1234 5678 9012",
    "name": "Андрій",
    "phone": "+380501112233",
    "stars_balance": 1250,
    "available_stars": 1250,
    "status": "active",
    "available_rewards": [
      { "id": 4, "name": "Вода 0,5 л", "stars_price": 1500 }
    ],
    "stamp_rewards": [
      { "code": "coffee-10", "name": "10-та кава", "progress": 8, "required_qty": 10 }
    ],
    "restrictions": ["no_alcohol", "no_tobacco", "no_min_margin"]
  }
}
```

Якщо клієнта немає:

```json
{ "ok": true, "found": false }
```

---

## 2. Передача чека після продажу

### Request

```http
POST /api/1c/receipts
```

```json
{
  "id": "CHK-000001",
  "fiscal_number": "FN-123456",
  "purchased_at": "2026-05-17T12:30:00+03:00",
  "store_id": "star-center",
  "cash_register": "KASA-1",
  "cashier": "Іван",
  "card_number": "SC 1234 5678 9012",
  "phone": "+380501112233",
  "total_cents": 35600,
  "eligible_cents": 35600,
  "stars_spent": 0,
  "club_conditions": [
    { "type": "club_price", "product": "coffee", "value": "35 грн" }
  ],
  "items": [
    {
      "external_product_id": "1C-COFFEE-001",
      "name": "Кава",
      "category": "coffee",
      "qty": 1,
      "price_cents": 3500,
      "line_total_cents": 3500,
      "flags": {
        "is_alcohol": false,
        "is_tobacco": false,
        "is_min_margin": false,
        "no_star_accrual": false,
        "no_redeem": false
      }
    }
  ]
}
```

### Response

```json
{
  "ok": true,
  "duplicate": false,
  "receipt_id": "CHK-000001",
  "stars_accrued": 356,
  "balance": 1606
}
```

Якщо 1С повторно передала той самий чек, відповідь буде:

```json
{
  "ok": true,
  "duplicate": true,
  "receipt_id": "CHK-000001",
  "stars_accrued": 356
}
```

Це захист від подвійного нарахування.

---

## 3. Перевірка QR товару за зірки

### Request

```http
POST /api/1c/reward-qr/validate
```

```json
{
  "token": "SCR_...."
}
```

### Response

```json
{
  "ok": true,
  "valid": true,
  "qr": {
    "id": 1,
    "product_name": "Кава",
    "product_external_id": null,
    "qty": 1,
    "stars_to_spend": 3000,
    "expires_at": "2026-05-17T12:45:00.000Z",
    "client": {
      "card_number": "SC 1234 5678 9012",
      "phone": "+380501112233",
      "name": "Андрій"
    }
  }
}
```

---

## 4. Фінальне списання QR після закриття чека

### Request

```http
POST /api/1c/reward-qr/finalize
```

```json
{
  "token": "SCR_....",
  "receipt_id": "CHK-000002",
  "store_id": "star-center"
}
```

### Response

```json
{
  "ok": true,
  "status": "used",
  "balance": 2500
}
```

---

## 5. Скасування QR, якщо чек не завершено

### Request

```http
POST /api/1c/reward-qr/cancel
```

```json
{
  "token": "SCR_....",
  "store_id": "star-center",
  "reason": "receipt_canceled"
}
```

### Response

```json
{
  "ok": true,
  "status": "canceled"
}
```

---

## 6. Повернення

### Request

```http
POST /api/1c/returns
```

```json
{
  "id": "RET-000001",
  "original_receipt_id": "CHK-000001",
  "returned_at": "2026-05-18T10:00:00+03:00",
  "store_id": "star-center",
  "total_cents": 3500,
  "eligible_cents": 3500,
  "items": [
    {
      "external_product_id": "1C-COFFEE-001",
      "name": "Кава",
      "category": "coffee",
      "qty": 1,
      "price_cents": 3500,
      "line_total_cents": 3500,
      "flags": {
        "is_alcohol": false,
        "is_tobacco": false,
        "is_min_margin": false,
        "no_star_accrual": false,
        "no_redeem": false
      }
    }
  ]
}
```

### Response

```json
{
  "ok": true,
  "return_id": "RET-000001",
  "stars_canceled": 35,
  "balance": 1215
}
```

---

## 7. Синхронізація товарів і ознак з 1С

### Request

```http
POST /api/1c/products/sync
```

```json
{
  "products": [
    {
      "external_id": "1C-COFFEE-001",
      "name": "Кава",
      "category": "coffee",
      "price_cents": 3500,
      "flags": {
        "is_alcohol": false,
        "is_tobacco": false,
        "is_min_margin": false,
        "no_star_accrual": false,
        "no_redeem": false
      }
    }
  ]
}
```

### Response

```json
{
  "ok": true,
  "synced": 1
}
```

## POST /api/1c/calculate

Попередній розрахунок клубних та оптових цін до оплати.

Headers:

`x-starclub-token: ONE_C_API_TOKEN`

Request:

```json
{
  "card_number": "SC 1234 5678 90",
  "store_id": "star-market",
  "purchased_at": "2026-06-24T18:00:00",
  "items": [
    {
      "line_no": 1,
      "external_product_id": "ЦБ000008652",
      "name": "Круасан",
      "category": "bakery",
      "qty": 1,
      "price_cents": 5500,
      "line_total_cents": 5500,
      "flags": {}
    }
  ]
}
```

Response містить `final_price_cents`, `discount_cents`, `stars_multiplier`, `expected_stars` та підсумки чека.
