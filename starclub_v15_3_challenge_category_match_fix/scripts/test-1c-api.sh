#!/usr/bin/env bash
set -euo pipefail
BASE_URL="${BASE_URL:-http://localhost:3000}"
TOKEN="${ONE_C_API_TOKEN:-change-this-1c-token}"

echo "1) Search client"
curl -s -H "X-Starclub-Token: $TOKEN" "$BASE_URL/api/1c/client/search?phone=%2B380501112233" | jq .

echo "2) Send receipt"
curl -s -X POST "$BASE_URL/api/1c/receipts" \
  -H "Content-Type: application/json" \
  -H "X-Starclub-Token: $TOKEN" \
  -d '{
    "id":"CHK-SHELL-001",
    "purchased_at":"2026-05-17T12:30:00+03:00",
    "store_id":"star-center",
    "cash_register":"KASA-1",
    "cashier":"Іван",
    "phone":"+380501112233",
    "total_cents":6000,
    "items":[
      {"external_product_id":"1C-COFFEE-001","name":"Кава","category":"coffee","qty":1,"price_cents":3500,"line_total_cents":3500,"flags":{"is_alcohol":false,"is_tobacco":false,"is_min_margin":false,"no_star_accrual":false,"no_redeem":false}},
      {"external_product_id":"1C-BAGUETTE-001","name":"Багет","category":"bakery","qty":1,"price_cents":2500,"line_total_cents":2500,"flags":{"is_alcohol":false,"is_tobacco":false,"is_min_margin":false,"no_star_accrual":false,"no_redeem":false}}
    ]
  }' | jq .
