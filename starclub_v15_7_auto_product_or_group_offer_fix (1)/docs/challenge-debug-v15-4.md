# Star Club v15.4 — debug челенджів

## Увімкнення

Railway Variables:

```env
CHALLENGE_DEBUG=true
```

Після зміни зробіть Redeploy.

## Що буде видно

У Railway Deploy Logs шукайте:

```text
STARCLUB_CHALLENGE_DEBUG
```

Для кожного активного челенджу буде показано:

- expected_category;
- усі category/category_code/product_group_code з 1С;
- normalized_candidates;
- reason;
- progress_before/progress_after;
- чи чек уже був зарахований цього дня;
- чи receipt_id є дублем.

## Адмінський endpoint

```text
GET /api/admin/debug/challenges
```

Потребує авторизацію адмінки. Повертає активні челенджі та останні debug/audit записи.

## Найчастіші причини

- `DUPLICATE_RECEIPT_ID` — 1С повторно відправила той самий номер чека;
- `ALREADY_COUNTED_FOR_THIS_DAY` — поточна схема рахує максимум одне відвідування на день;
- `CATEGORY_NOT_MATCHED` — код/назва групи реально не прийшли або не збіглися;
- `MIN_TOTAL_NOT_REACHED` — сума нижча за мінімальну;
- `NO_ELIGIBLE_ITEMS` — усі товари виключені з нарахування.
