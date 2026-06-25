# Star Club v15.3 — challenge category matching fix

Виправлено перевірку категорії в челенджах. Раніше челендж дивився тільки на `item.category` і назву товару. Тепер він використовує всі поля, які передає 1С:

- `category`
- `category_code`
- `category_name`
- `product_group_code`
- `product_group_name`
- `parent_group_code`
- `parent_group_name`

Тому челендж із категорією `ЦБ000001210` зарахує товар, якщо 1С передасть цей код як код батьківської групи або номенклатурної групи.

Додано аудит `challenge_category_not_matched`, щоб у журналі було видно очікувану категорію та фактичні кандидати з чека.
