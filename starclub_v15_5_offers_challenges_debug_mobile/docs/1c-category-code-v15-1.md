# Star Club v15.1 — передача коду групи 1С

У модулі `StarClubFullIntegration.bsl` додано версію `v15.1-category-code-fix`.

В обох місцях формування товарів тепер передаються поля:
- `category`
- `category_name`
- `category_code`
- `product_group_name`
- `product_group_code`

Після заміни модуля в 1С виконайте Ctrl+S, F7 і перезапустіть 1С:Підприємство.
