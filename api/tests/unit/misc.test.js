const { buildTestApp } = require("./helpers");
const { toCents, fromCents } = require("../../src/validation");
const { parseCsv } = require("../../src/csv");

describe("money handling", () => {
  test("converts to integer cents without floating point errors", () => {
    expect(toCents("0.30")).toBe(30);
    expect(toCents(0.3)).toBe(30);
    expect(toCents(19.99)).toBe(1999);
    expect(toCents("1000")).toBe(100000);
    expect(fromCents(1999)).toBe(19.99);
  });
  test.each([0, -1, "1e3", 1.234, "", null, NaN, Infinity])("rejects %p", (v) => {
    expect(() => toCents(v)).toThrow();
  });
});

describe("csv parser", () => {
  test("handles quotes, CRLF, BOM and blank lines", () => {
    expect(parseCsv('﻿a,b\r\n"x,1","y ""q"""\r\n\r\n')).toEqual([
      ["a", "b"],
      ["x,1", 'y "q"'],
    ]);
  });
});

describe("platform behaviour", () => {
  test("health and versioned health endpoints respond", async () => {
    const { api } = buildTestApp();
    expect((await api.get("/health")).status).toBe(200);
    expect((await api.get("/api/v1/health")).body.version).toBe("v1");
  });

  test("OpenAPI document and Swagger UI are served", async () => {
    const { api } = buildTestApp();
    const spec = await api.get("/openapi.json");
    expect(spec.status).toBe(200);
    expect(Object.keys(spec.body.paths)).toEqual(
      expect.arrayContaining([
        "/api/v1/tuition/mobile/{studentNo}",
        "/api/v1/tuition/{studentNo}",
        "/api/v1/tuition/payments",
        "/api/v1/admin/tuition",
        "/api/v1/admin/tuition/batch",
        "/api/v1/admin/tuition/unpaid",
      ])
    );
    expect((await api.get("/api-docs/")).status).toBe(200);
  });

  test("unknown routes and malformed JSON return structured errors", async () => {
    const { api } = buildTestApp();
    expect((await api.get("/api/v2/tuition/1")).body.error.code).toBe("ROUTE_NOT_FOUND");
    const bad = await api.post("/api/v1/auth/login").set("Content-Type", "application/json").send("{oops");
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_JSON");
  });
});
