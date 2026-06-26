# Telegram bot and Admin authorization v10

## Bot behavior

- `/start` sends a welcome message and **Open Star Club** Web App button.
- `/club` sends the client application button.
- `/admin` sends **Open admin panel** Web App button pointing to `/admin`.

The bot runs in the same Railway service as the web server when:

```env
RUN_BOT=true
BOT_TOKEN=<real BotFather token>
WEBAPP_URL=https://your-domain.up.railway.app
```

Do not run a second copy of the bot with the same token while Railway bot polling is active.

## Access by Telegram ID

```env
OWNER_TELEGRAM_IDS=111111111
ADMIN_TELEGRAM_IDS=222222222,333333333
ADMIN_DEFAULT_PERMISSIONS=dashboard,clients,rewards,offers,challenges,stamps,news,qrs,support,audit
```

- Owner receives full access.
- Admin receives the default sections above.
- Owners can also create and edit admins in the admin panel.
- IDs not present in the environment or admin database receive `ADMIN_ACCESS_DENIED`.

## Login test

1. Push and deploy the project.
2. Open the bot and send `/start` — client application button must appear.
3. Send `/admin` — admin panel button must appear.
4. Open the admin panel from this button.
5. Press **Login through Telegram**.
6. Owner/Admin is recognized from Telegram Web App `initData` and Telegram ID.
