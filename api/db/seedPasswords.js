// Demo-account passwords for db/seed.js. They come ONLY from the environment: no default value exists in
// the code, so nothing guessable is ever stored in the repository or the container image.
const MIN_LENGTH = 12;
const PLACEHOLDERS = ["student123!", "admin123!", "password123!", "changeme", "change-me", "change_me", "changeit"];

function check(name, value) {
  if (!value) throw new Error(`${name} is not set. Provide it as an environment variable (never commit it).`);
  if (value.length < MIN_LENGTH) throw new Error(`${name} must be at least ${MIN_LENGTH} characters long.`);
  if (PLACEHOLDERS.includes(value.toLowerCase())) throw new Error(`${name} is a well-known placeholder; choose your own value.`);
  return value;
}

/** Error messages never contain the password itself. */
function resolveSeedPasswords(env = process.env) {
  return {
    student: check("SEED_STUDENT_PASSWORD", env.SEED_STUDENT_PASSWORD),
    admin: check("SEED_ADMIN_PASSWORD", env.SEED_ADMIN_PASSWORD),
  };
}

module.exports = { resolveSeedPasswords, MIN_LENGTH };
