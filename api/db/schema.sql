-- Tuition database schema (PostgreSQL 14+)
-- Money is stored as NUMERIC(12,2); the API converts to integer cents for arithmetic.

CREATE TABLE IF NOT EXISTS students (
    student_no  VARCHAR(20)  PRIMARY KEY,
    full_name   VARCHAR(120),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id             SERIAL       PRIMARY KEY,
    username       VARCHAR(50)  NOT NULL UNIQUE,
    password_hash  VARCHAR(100) NOT NULL,
    role           VARCHAR(10)  NOT NULL CHECK (role IN ('student', 'admin')),
    student_no     VARCHAR(20)  REFERENCES students(student_no),
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- a student account must be bound to a student record, an admin must not be
    CONSTRAINT users_role_student_chk CHECK (
        (role = 'student' AND student_no IS NOT NULL) OR
        (role = 'admin'   AND student_no IS NULL)
    )
);

CREATE TABLE IF NOT EXISTS tuitions (
    id          SERIAL        PRIMARY KEY,
    student_no  VARCHAR(20)   NOT NULL REFERENCES students(student_no),
    term        VARCHAR(12)   NOT NULL,                 -- e.g. 2026-FALL
    amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    currency    CHAR(3)       NOT NULL CHECK (currency IN ('USD', 'TRY', 'EUR')),
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT tuitions_student_term_uq UNIQUE (student_no, term)
);

CREATE TABLE IF NOT EXISTS payments (
    id              SERIAL        PRIMARY KEY,
    transaction_id  VARCHAR(64)   NOT NULL,
    student_no      VARCHAR(20)   NOT NULL,
    term            VARCHAR(12)   NOT NULL,
    amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    status          VARCHAR(10)   NOT NULL DEFAULT 'SUCCESS' CHECK (status IN ('SUCCESS')),
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    -- duplicate transaction IDs are rejected at the database level
    CONSTRAINT payments_transaction_uq UNIQUE (transaction_id),
    CONSTRAINT payments_tuition_fk FOREIGN KEY (student_no, term)
        REFERENCES tuitions (student_no, term)
);

CREATE INDEX IF NOT EXISTS payments_student_term_idx ON payments (student_no, term);

-- Per-student daily call counter for the mobile Query Tuition endpoint (limit 3/day).
CREATE TABLE IF NOT EXISTS query_log (
    student_no  VARCHAR(20) NOT NULL,
    call_date   DATE        NOT NULL,
    call_count  INTEGER     NOT NULL DEFAULT 0,
    PRIMARY KEY (student_no, call_date)
);
