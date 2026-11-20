-- Additive: planning never moves money. Only explicit validation links one expense.
ALTER TABLE transactions ADD CONSTRAINT transactions_id_owner UNIQUE(id,user_id);
CREATE TABLE budgets (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 reference TEXT NOT NULL UNIQUE, title TEXT NOT NULL, purpose TEXT NOT NULL,
 project TEXT NOT NULL DEFAULT '', beneficiary TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
 currency TEXT NOT NULL CHECK(currency IN ('FCFA','EUR','USD')),
 budget_date DATE NOT NULL, start_date DATE, end_date DATE, due_date DATE,
 items JSONB NOT NULL CHECK(jsonb_typeof(items)='array' AND jsonb_array_length(items) BETWEEN 1 AND 50),
 subtotal NUMERIC(18,2) NOT NULL CHECK(subtotal>0), fees NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK(fees>=0),
 total NUMERIC(18,2) NOT NULL CHECK(total=subtotal+fees),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','validated','cancelled')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 account_id TEXT, transaction_id TEXT UNIQUE, payment_date DATE,
 validated_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(id,user_id),
 FOREIGN KEY(account_id,user_id) REFERENCES accounts(id,user_id),
 FOREIGN KEY(transaction_id,user_id) REFERENCES transactions(id,user_id),
 CHECK(end_date IS NULL OR start_date IS NULL OR end_date>=start_date),
 CHECK((status='draft' AND account_id IS NULL AND transaction_id IS NULL AND payment_date IS NULL AND validated_at IS NULL AND cancelled_at IS NULL)
    OR (status='validated' AND account_id IS NOT NULL AND transaction_id IS NOT NULL AND payment_date IS NOT NULL AND validated_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status='cancelled' AND account_id IS NULL AND transaction_id IS NULL AND payment_date IS NULL AND validated_at IS NULL AND cancelled_at IS NOT NULL))
);
CREATE INDEX ON budgets(user_id,created_at DESC,id);
CREATE FUNCTION protect_budget() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status<>'draft' THEN
  RAISE EXCEPTION 'Final budgets are immutable; retain planning history';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_budgets BEFORE UPDATE OR DELETE ON budgets FOR EACH ROW EXECUTE FUNCTION protect_budget();
CREATE INDEX ON documents(user_id,(snapshot->>'budget_id'),created_at DESC) WHERE kind='budget';
