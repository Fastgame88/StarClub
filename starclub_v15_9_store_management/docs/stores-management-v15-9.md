# Star Club v15.9 — керування магазинами

Додано окремий розділ **Магазини** в адмін-панелі.

Owner або Admin із правом `stores` може:
- створювати магазин;
- змінювати назву, адресу, графік, телефон і фото;
- вимикати магазин без видалення історії;
- видаляти магазин, якщо він ще ніде не використовується.

Клієнтський Mini App отримує список магазинів із API та відразу показує актуальні дані.

## API
- `GET /api/admin/stores`
- `POST /api/admin/stores`
- `PATCH /api/admin/stores/:id`
- `DELETE /api/admin/stores/:id`
- `GET /api/public/stores`
- `GET /api/client/stores`
