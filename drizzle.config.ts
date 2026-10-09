import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // Use the Supabase *transaction pooler* URL (port 6543) for migrations so
    // it works over IPv4 and doesn't exhaust connection limits.
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});