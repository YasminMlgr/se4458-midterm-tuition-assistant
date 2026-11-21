/** OpenAPI 3.0 contract for the Tuition API (served at /openapi.json and /api-docs). */
function buildOpenApi() {
  const err = (description) => ({
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  });
  const secured = [{ bearerAuth: [] }];
  const studentNoParam = {
    name: "studentNo",
    in: "path",
    required: true,
    schema: { type: "string", example: "20260001" },
  };
  const termQuery = (required) => ({
    name: "term",
    in: "query",
    required,
    description: "Academic term, e.g. 2026-FALL. When omitted on Query Tuition the OVERALL balance (all terms) is returned.",
    schema: { type: "string", example: "2026-FALL" },
  });

  return {
    openapi: "3.0.3",
    info: {
      title: "University Tuition API",
      version: "1.0.0",
      description:
        "Versioned REST API (all routes under /api/v1) used by the mobile app, banking app, admin web site and the AI Tuition Assistant. " +
        "Money amounts have at most 2 decimals. Query Tuition returns the TERM balance when `term` is given and the OVERALL balance otherwise.",
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "Auth" },
      { name: "Mobile App" },
      { name: "Banking App" },
      { name: "Admin" },
    ],
    paths: {
      "/api/v1/auth/login": {
        post: {
          tags: ["Auth"],
          summary: "Log in and obtain a JWT (HS256, 1 hour)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["username", "password"],
                  properties: { username: { type: "string", example: "20260001" }, password: { type: "string" } },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Token issued",
              content: { "application/json": { schema: { $ref: "#/components/schemas/LoginResponse" } } },
            },
            400: err("Missing username/password"),
            401: err("Invalid credentials"),
          },
        },
      },
      "/api/v1/tuition/mobile/{studentNo}": {
        get: {
          tags: ["Mobile App"],
          summary: "Query Tuition (mobile app) - no authentication, max 3 calls per student per day",
          description:
            "The limit is keyed by the student number (not by client IP) and resets at local midnight (Europe/Istanbul). " +
            "The 4th call of the day returns 429 with a Retry-After header.",
          parameters: [studentNoParam, termQuery(false)],
          responses: {
            200: {
              description: "Tuition total and balance",
              headers: {
                "X-RateLimit-Limit": { schema: { type: "integer" } },
                "X-RateLimit-Remaining": { schema: { type: "integer" } },
              },
              content: { "application/json": { schema: { $ref: "#/components/schemas/TuitionStatus" } } },
            },
            400: err("Invalid student number or term"),
            404: err("Student or tuition record not found"),
            429: err("Daily limit exceeded"),
          },
        },
      },
      "/api/v1/tuition/{studentNo}": {
        get: {
          tags: ["Banking App"],
          summary: "Query Tuition (banking app / AI agent) - JWT required",
          description: "A student token can read only its own record; an admin token can read any record.",
          security: secured,
          parameters: [studentNoParam, termQuery(false)],
          responses: {
            200: {
              description: "Tuition total and balance",
              content: { "application/json": { schema: { $ref: "#/components/schemas/TuitionStatus" } } },
            },
            400: err("Invalid student number or term"),
            401: err("Missing/invalid token"),
            403: err("Token belongs to another student"),
            404: err("Student or tuition record not found"),
          },
        },
      },
      "/api/v1/tuition/payments": {
        post: {
          tags: ["Banking App"],
          summary: "Pay Tuition - records a simulated partial or full payment (JWT, student role)",
          description:
            "No real card processing. The studentNo must match the token. Duplicate transactionId values are rejected (409) " +
            "and an amount above the outstanding balance is rejected (422).",
          security: secured,
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/PaymentRequest" } } },
          },
          responses: {
            201: {
              description: "Payment recorded",
              content: { "application/json": { schema: { $ref: "#/components/schemas/PaymentResponse" } } },
            },
            400: err("Validation error"),
            401: err("Missing/invalid token"),
            403: err("Not the owner of the account / wrong role"),
            404: err("Tuition record not found"),
            409: err("Duplicate transactionId"),
            422: err("Amount exceeds the outstanding balance"),
          },
        },
      },
      "/api/v1/admin/tuition": {
        post: {
          tags: ["Admin"],
          summary: "Add Tuition - create or update the tuition amount for a student and term (admin)",
          description:
            "(studentNo, term) is unique. A second call for the same pair UPDATES the record (200, status UPDATED) unless the new amount " +
            "is below what was already paid (409 AMOUNT_BELOW_PAID) or the currency would be inconsistent (409 CURRENCY_MISMATCH).",
          security: secured,
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/AddTuitionRequest" } } },
          },
          responses: {
            200: { description: "Existing record updated", content: { "application/json": { schema: { $ref: "#/components/schemas/AddTuitionResponse" } } } },
            201: { description: "Record created", content: { "application/json": { schema: { $ref: "#/components/schemas/AddTuitionResponse" } } } },
            400: err("Validation error"),
            401: err("Missing/invalid token"),
            403: err("Admin role required"),
            409: err("Conflict with existing data"),
          },
        },
      },
      "/api/v1/admin/tuition/batch": {
        post: {
          tags: ["Admin"],
          summary: "Add Tuition - Batch (CSV, admin)",
          description:
            "Content-Type: text/csv. Header must be `studentNo,term,amount,currency`. Rows are processed independently; the response lists " +
            "success/failure counts and a per-row result. Max 1000 rows.",
          security: secured,
          requestBody: {
            required: true,
            content: {
              "text/csv": {
                schema: { type: "string" },
                example: "studentNo,term,amount,currency\n20260001,2026-FALL,3000,USD\n20260002,2026-FALL,2500.50,USD\n",
              },
            },
          },
          responses: {
            200: { description: "Batch processed", content: { "application/json": { schema: { $ref: "#/components/schemas/BatchResponse" } } } },
            400: err("Empty body or invalid header"),
            401: err("Missing/invalid token"),
            403: err("Admin role required"),
            413: err("Too many rows"),
          },
        },
      },
      "/api/v1/admin/tuition/unpaid": {
        get: {
          tags: ["Admin"],
          summary: "Unpaid Tuition Status - paged list of students with an outstanding balance (admin)",
          security: secured,
          parameters: [
            termQuery(true),
            { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
            { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
          ],
          responses: {
            200: { description: "A page of unpaid students", content: { "application/json": { schema: { $ref: "#/components/schemas/UnpaidPage" } } } },
            400: err("Validation error"),
            401: err("Missing/invalid token"),
            403: err("Admin role required"),
          },
        },
      },
      "/api/v1/health": {
        get: { tags: ["Auth"], summary: "Health check", responses: { 200: { description: "OK" } } },
      },
    },
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                code: { type: "string", example: "AMOUNT_EXCEEDS_BALANCE" },
                message: { type: "string" },
              },
            },
          },
        },
        LoginResponse: {
          type: "object",
          properties: {
            accessToken: { type: "string" },
            tokenType: { type: "string", example: "Bearer" },
            expiresIn: { type: "string", example: "1h" },
            role: { type: "string", enum: ["student", "admin"] },
          },
        },
        TermBreakdown: {
          type: "object",
          properties: {
            term: { type: "string", example: "2026-FALL" },
            tuitionTotal: { type: "number", example: 3000 },
            paid: { type: "number", example: 0 },
            balance: { type: "number", example: 3000 },
          },
        },
        TuitionStatus: {
          type: "object",
          properties: {
            studentNo: { type: "string", example: "20260001" },
            term: { type: "string", nullable: true, example: "2026-FALL" },
            scope: { type: "string", enum: ["TERM", "OVERALL"] },
            currency: { type: "string", example: "USD" },
            tuitionTotal: { type: "number", example: 3000 },
            paidTotal: { type: "number", example: 0 },
            balance: { type: "number", example: 3000 },
            terms: { type: "array", items: { $ref: "#/components/schemas/TermBreakdown" } },
          },
        },
        PaymentRequest: {
          type: "object",
          required: ["studentNo", "term", "amount", "transactionId"],
          properties: {
            studentNo: { type: "string", example: "20260001" },
            term: { type: "string", example: "2026-FALL" },
            amount: { type: "number", example: 500 },
            transactionId: { type: "string", example: "TX-2026-0001" },
          },
        },
        PaymentResponse: {
          type: "object",
          properties: {
            status: { type: "string", example: "SUCCESS" },
            transactionId: { type: "string" },
            studentNo: { type: "string" },
            term: { type: "string" },
            currency: { type: "string" },
            paidAmount: { type: "number", description: "Amount recorded by this transaction" },
            totalPaid: { type: "number", description: "Total paid for the term so far" },
            remainingBalance: { type: "number" },
          },
        },
        AddTuitionRequest: {
          type: "object",
          required: ["studentNo", "term", "amount", "currency"],
          properties: {
            studentNo: { type: "string", example: "20260001" },
            term: { type: "string", example: "2026-FALL" },
            amount: { type: "number", example: 3000 },
            currency: { type: "string", enum: ["USD", "TRY", "EUR"] },
          },
        },
        AddTuitionResponse: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["CREATED", "UPDATED"] },
            studentNo: { type: "string" },
            term: { type: "string" },
            amount: { type: "number" },
            currency: { type: "string" },
          },
        },
        BatchResponse: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["COMPLETED", "PARTIALLY_COMPLETED", "FAILED"] },
            total: { type: "integer" },
            succeeded: { type: "integer" },
            failed: { type: "integer" },
            results: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  line: { type: "integer" },
                  studentNo: { type: "string" },
                  term: { type: "string" },
                  status: { type: "string", enum: ["CREATED", "UPDATED", "FAILED"] },
                  errorCode: { type: "string" },
                  error: { type: "string" },
                },
              },
            },
          },
        },
        UnpaidPage: {
          type: "object",
          properties: {
            term: { type: "string" },
            page: { type: "integer" },
            pageSize: { type: "integer" },
            totalItems: { type: "integer" },
            totalPages: { type: "integer" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  studentNo: { type: "string" },
                  fullName: { type: "string", nullable: true },
                  currency: { type: "string" },
                  tuitionTotal: { type: "number" },
                  paid: { type: "number" },
                  balance: { type: "number" },
                },
              },
            },
          },
        },
      },
    },
  };
}

module.exports = { buildOpenApi };
