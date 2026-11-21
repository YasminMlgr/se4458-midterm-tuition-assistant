const { resolveSeedPasswords, MIN_LENGTH } = require("../../db/seedPasswords");

const good = { SEED_STUDENT_PASSWORD: "a-long-student-pass-1", SEED_ADMIN_PASSWORD: "a-long-admin-pass-2" };

describe("seed passwords come only from the environment", () => {
  test("accepts two sufficiently long values", () => {
    expect(resolveSeedPasswords(good)).toEqual({ student: good.SEED_STUDENT_PASSWORD, admin: good.SEED_ADMIN_PASSWORD });
  });

  test.each(["SEED_STUDENT_PASSWORD", "SEED_ADMIN_PASSWORD"])("%s is mandatory (no built-in default)", (name) => {
    const env = { ...good };
    delete env[name];
    expect(() => resolveSeedPasswords(env)).toThrow(new RegExp(`${name} is not set`));
  });

  test("rejects short values and well-known placeholders", () => {
    expect(() => resolveSeedPasswords({ ...good, SEED_ADMIN_PASSWORD: "x".repeat(MIN_LENGTH - 1) })).toThrow(/at least/);
    expect(() => resolveSeedPasswords({ ...good, SEED_ADMIN_PASSWORD: "Admin123!" })).toThrow();
    expect(() => resolveSeedPasswords({ ...good, SEED_STUDENT_PASSWORD: "CHANGE-ME" })).toThrow();
  });

  test("error messages never echo the password", () => {
    const secret = "tiny-pass";
    expect(() => resolveSeedPasswords({ ...good, SEED_ADMIN_PASSWORD: secret })).toThrow(/at least/);
    try {
      resolveSeedPasswords({ ...good, SEED_ADMIN_PASSWORD: secret });
    } catch (e) {
      expect(e.message).not.toContain(secret);
    }
  });
});
