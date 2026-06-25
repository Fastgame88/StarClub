import { initDb } from './db.js';

await initDb();
console.log('Star Club database migrated and seeded.');
