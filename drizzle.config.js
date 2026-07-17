/** @type {import('drizzle-kit').Config} */
export default {
  schema: './lib/db/schema.js',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: '/app/data/erp.db',
  },
};
