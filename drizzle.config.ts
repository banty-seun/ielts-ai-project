import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

console.log('[drizzle] DATABASE_URL =', process.env.DATABASE_URL);

export default defineConfig({
  dialect: 'postgresql',
  schema: './shared/schema.ts', // <- adjust if your schema path differs
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL! },
  verbose: true,
  strict: true,
});
