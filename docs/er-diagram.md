# ER / Data Model

```mermaid
erDiagram
    STUDENTS ||--o{ TUITIONS : "is billed"
    STUDENTS ||--o| USERS : "may log in as"
    TUITIONS ||--o{ PAYMENTS : "is paid by"
    STUDENTS ||--o{ QUERY_LOG : "daily mobile calls"

    STUDENTS {
        varchar student_no PK
        varchar full_name
        timestamptz created_at
    }
    USERS {
        serial id PK
        varchar username UK
        varchar password_hash "bcrypt"
        varchar role "student | admin"
        varchar student_no FK "NULL for admin"
    }
    TUITIONS {
        serial id PK
        varchar student_no FK
        varchar term "e.g. 2026-FALL"
        numeric amount "12,2  > 0"
        char currency "USD | TRY | EUR"
        timestamptz updated_at
    }
    PAYMENTS {
        serial id PK
        varchar transaction_id UK "idempotency key"
        varchar student_no FK
        varchar term FK
        numeric amount "12,2  > 0"
        varchar status "SUCCESS"
        timestamptz created_at
    }
    QUERY_LOG {
        varchar student_no PK
        date call_date PK "Europe/Istanbul day"
        int call_count "max 3 (mobile Query Tuition)"
    }
```

Key constraints: `UNIQUE (student_no, term)` on `tuitions`, `UNIQUE (transaction_id)` on `payments`,
`FOREIGN KEY (student_no, term)` from `payments` to `tuitions`, and a CHECK that a `student` user is bound to a
student record while an `admin` is not. Balance = `tuitions.amount - SUM(payments.amount)` (computed, never stored).
