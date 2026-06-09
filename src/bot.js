import dotenv from 'dotenv';
import { Telegraf, Markup } from 'telegraf';

dotenv.config();

const token = process.env.BOT_TOKEN;
const webAppUrl = process.env.WEBAPP_URL || process.env.APP_URL || 'http://localhost:3000';

if (!token || token.startsWith('123456:')) {
  console.error('BOT_TOKEN is not configured. Add BOT_TOKEN to .env.');
  process.exit(1);
}

const bot = new Telegraf(token);

bot.start(async (ctx) => {
  await ctx.reply(
    'Вітаємо у Star Club ⭐\nВідкрийте клубну карту, збирайте зірки та отримуйте пропозиції тільки для учасників.',
    Markup.inlineKeyboard([
      Markup.button.webApp('Відкрити Star Club', webAppUrl)
    ])
  );
});

bot.command('club', async (ctx) => {
  await ctx.reply('Відкрити Star Club:', Markup.inlineKeyboard([Markup.button.webApp('Star Club Mini App', webAppUrl)]));
});

bot.launch();
console.log('Star Club bot launched');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
