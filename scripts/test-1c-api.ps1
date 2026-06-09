$BaseUrl = $env:BASE_URL
if (-not $BaseUrl) { $BaseUrl = "http://localhost:3000" }
$Token = $env:ONE_C_API_TOKEN
if (-not $Token) { $Token = "change-this-1c-token" }

Write-Host "1) Search client"
Invoke-RestMethod -Method GET -Uri "$BaseUrl/api/1c/client/search?phone=%2B380501112233" -Headers @{"X-Starclub-Token"=$Token} | ConvertTo-Json -Depth 10

Write-Host "2) Send receipt"
$body = @{
  id = "CHK-POWERSHELL-001"
  purchased_at = "2026-05-17T12:30:00+03:00"
  store_id = "star-center"
  cash_register = "KASA-1"
  cashier = "Іван"
  phone = "+380501112233"
  total_cents = 6000
  items = @(
    @{
      external_product_id = "1C-COFFEE-001"
      name = "Кава"
      category = "coffee"
      qty = 1
      price_cents = 3500
      line_total_cents = 3500
      flags = @{ is_alcohol=$false; is_tobacco=$false; is_min_margin=$false; no_star_accrual=$false; no_redeem=$false }
    },
    @{
      external_product_id = "1C-BAGUETTE-001"
      name = "Багет"
      category = "bakery"
      qty = 1
      price_cents = 2500
      line_total_cents = 2500
      flags = @{ is_alcohol=$false; is_tobacco=$false; is_min_margin=$false; no_star_accrual=$false; no_redeem=$false }
    }
  )
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Method POST -Uri "$BaseUrl/api/1c/receipts" -Headers @{"X-Starclub-Token"=$Token; "Content-Type"="application/json"} -Body $body | ConvertTo-Json -Depth 10
