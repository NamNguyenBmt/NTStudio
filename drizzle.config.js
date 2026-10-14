// drizzle-kit: sinh migration SQL vào drizzle/ từ schema (npm run db:generate)
/** @type {import('drizzle-kit').Config} */
module.exports = {
  dialect: "sqlite",
  schema: "./src/main/db/schema.js",
  out: process.env.DRIZZLE_OUT || "./drizzle",
};
