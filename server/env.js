// Load env files from the repo root if present: `.env` (local overrides)
// first, then `.env.production` or `.env.development` depending on NODE_ENV.
// loadEnvFile never overwrites variables that are already set, so the real
// process environment beats `.env`, which beats the mode file. Must be the
// first import in index.js so values are in place before other modules read.
const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';
for (const file of ['.env', `.env.${mode}`]) {
  try {
    process.loadEnvFile(new URL(`../${file}`, import.meta.url));
  } catch {
    // Missing file — fine, run on whatever is already set.
  }
}
