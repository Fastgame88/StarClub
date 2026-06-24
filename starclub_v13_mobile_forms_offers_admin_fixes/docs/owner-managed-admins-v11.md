# Star Club v11 — Admin users managed by Owner

## Access model

- `OWNER_TELEGRAM_IDS` is used only to bootstrap/recover Owner access.
- Admin users are not read from ENV.
- Owner opens **Адміністратори** in the admin panel, enters Telegram ID, and chooses specific sections.
- An Admin can sign in through `/admin` only after Owner has created and activated that Telegram ID.
- Removing or disabling an Admin immediately blocks new access; deletion also removes active admin sessions.

## Railway

Keep:

```env
OWNER_TELEGRAM_IDS=111111111
```

Remove old variables if present:

```env
ADMIN_TELEGRAM_IDS
ADMIN_DEFAULT_PERMISSIONS
```
