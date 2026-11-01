CREATE TABLE users (
 id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
 password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member')),
 active BOOLEAN NOT NULL DEFAULT TRUE, currency TEXT NOT NULL DEFAULT 'FCFA' CHECK(currency IN ('FCFA','EUR','USD')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_login TIMESTAMPTZ
);
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ON sessions(user_id);
CREATE TABLE invitations (
 token_hash TEXT PRIMARY KEY, created_by TEXT NOT NULL REFERENCES users(id),
 expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ
);
CREATE TABLE auth_attempts (
 key TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, window_start TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE accounts (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('cash','bank','momo')), balance NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK(balance>=0),
 currency TEXT NOT NULL CHECK(currency IN ('FCFA','EUR','USD')), account_number TEXT NOT NULL DEFAULT '',
 color TEXT NOT NULL DEFAULT '#527c68', is_active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(id,user_id)
);
CREATE TABLE loans (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL CHECK(kind IN ('given','borrowed')),
 contact_name TEXT NOT NULL, title TEXT NOT NULL, initial_amount NUMERIC(18,2) NOT NULL CHECK(initial_amount>0),
 current_balance NUMERIC(18,2) NOT NULL CHECK(current_balance>=0 AND current_balance<=initial_amount),
 account_id TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','settled')),
 due_date DATE, notes TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(id,user_id), FOREIGN KEY(account_id,user_id) REFERENCES accounts(id,user_id)
);
CREATE TABLE funds (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), person_name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
 reason TEXT NOT NULL, initial_amount NUMERIC(18,2) NOT NULL CHECK(initial_amount>0),
 spent_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK(spent_amount>=0), returned_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK(returned_amount>=0),
 account_id TEXT NOT NULL, date_received DATE NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','settled')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(id,user_id),
 CHECK(spent_amount+returned_amount<=initial_amount), FOREIGN KEY(account_id,user_id) REFERENCES accounts(id,user_id)
);
CREATE TABLE transactions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), account_id TEXT NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('income','expense','transfer')), amount NUMERIC(18,2) NOT NULL CHECK(amount>0),
 fee NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK(fee>=0), category TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 date DATE NOT NULL, to_account_id TEXT, related_loan_id TEXT, third_party_fund_id TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK((type='transfer' AND to_account_id IS NOT NULL AND to_account_id<>account_id) OR (type<>'transfer' AND to_account_id IS NULL)),
 FOREIGN KEY(account_id,user_id) REFERENCES accounts(id,user_id),
 FOREIGN KEY(to_account_id,user_id) REFERENCES accounts(id,user_id),
 FOREIGN KEY(related_loan_id,user_id) REFERENCES loans(id,user_id),
 FOREIGN KEY(third_party_fund_id,user_id) REFERENCES funds(id,user_id)
);
CREATE INDEX ON transactions(user_id,date DESC,created_at DESC);
CREATE INDEX ON transactions(account_id);
CREATE INDEX ON transactions(to_account_id);
CREATE TABLE receipts (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), loan_id TEXT NOT NULL, account_id TEXT NOT NULL,
 receipt_no TEXT UNIQUE NOT NULL, installment_number INTEGER NOT NULL CHECK(installment_number>0),
 amount NUMERIC(18,2) NOT NULL CHECK(amount>0), remaining_balance_after NUMERIC(18,2) NOT NULL CHECK(remaining_balance_after>=0),
 snapshot JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(loan_id,installment_number), FOREIGN KEY(loan_id,user_id) REFERENCES loans(id,user_id),
 FOREIGN KEY(account_id,user_id) REFERENCES accounts(id,user_id)
);
CREATE TABLE assets (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
 category TEXT NOT NULL CHECK(category IN ('material','real_estate','investment','inventory')),
 purchase_value NUMERIC(18,2) NOT NULL CHECK(purchase_value>=0), current_value NUMERIC(18,2) NOT NULL CHECK(current_value>=0),
 purchase_date DATE, notes TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE audit_events (
 id BIGSERIAL PRIMARY KEY, user_id TEXT REFERENCES users(id), action TEXT NOT NULL,
 resource_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_events(user_id,created_at DESC);
CREATE TABLE idempotency (
 user_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL, request_hash TEXT NOT NULL,
 response JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(user_id,key)
);
CREATE FUNCTION immutable_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Receipts are immutable'; END $$;
CREATE TRIGGER protect_receipts BEFORE UPDATE OR DELETE ON receipts FOR EACH ROW EXECUTE FUNCTION immutable_receipt();
