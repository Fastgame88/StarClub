# Star Club v9 — full test stage

## Implemented

- Unified responsive Telegram Mini App design for all client screens.
- Redesigned admin panel with Telegram login and API-key fallback.
- Owner/Admin roles with server-side permission checks.
- Owner management of administrators by Telegram ID and permissions.
- Client support tickets, replies, history, statuses and admin workspace.
- Full receipt detail endpoint with product rows, quantity, unit price, totals and stars.
- Existing 1C test integration retained: client/card search, receipt import, accrual, reward redemption, idempotent codes, cancellation/expiration, returns, excluded goods and product synchronization.
- News CRUD and publication retained.
- Profile bonus settings retained: enabled, stars, timing, required fields.

## Railway variables

Add:

```env
OWNER_TELEGRAM_IDS=YOUR_TELEGRAM_ID
```

Keep existing `BOT_TOKEN`, `ADMIN_API_KEY`, `ONE_C_API_TOKEN`, `DATABASE_FILE`, `ALLOW_DEV_LOGIN` and URLs.

## Admin login

Open `/admin` inside Telegram Mini App and press **Увійти через Telegram**. The Telegram ID must exist in `OWNER_TELEGRAM_IDS` or be added by an Owner in the **Адміністратори** section.

## Support

Client: **Ще → Підтримка**. Admin: **Підтримка**. Messages and ticket status remain in the database.

## Receipt products

`POST /api/1c/receipts` must send `items`. Client receipt details are loaded from `GET /api/client/receipts/:id`.
