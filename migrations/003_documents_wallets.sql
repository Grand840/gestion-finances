-- Dedicated wallets and private document identity. Never edit earlier migrations.
ALTER TABLE users ADD COLUMN signature_png BYTEA;
ALTER TABLE accounts ADD COLUMN purpose TEXT NOT NULL DEFAULT 'personal' CHECK(purpose IN ('personal','third_party','borrowed'));
CREATE TABLE people (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
 phone TEXT NOT NULL DEFAULT '', account_id TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(id,user_id), UNIQUE(account_id),
 FOREIGN KEY(account_id,user_id) REFERENCES accounts(id,user_id)
);
ALTER TABLE funds ADD COLUMN person_id TEXT;
ALTER TABLE funds ADD FOREIGN KEY(person_id,user_id) REFERENCES people(id,user_id);
ALTER TABLE loans ADD COLUMN legacy_account_id TEXT;
ALTER TABLE loans ADD FOREIGN KEY(legacy_account_id,user_id) REFERENCES accounts(id,user_id);
CREATE TABLE documents (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
 reference TEXT UNIQUE NOT NULL, snapshot JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER protect_documents BEFORE UPDATE OR DELETE ON documents FOR EACH ROW EXECUTE FUNCTION immutable_receipt();
CREATE INDEX ON documents(user_id,created_at DESC);
-- Reclassify existing third-party balances, preserving total cash and every old entry.
DO $$
DECLARE p RECORD; f RECORD; a RECORD; wallet TEXT; person TEXT; needed NUMERIC; moved NUMERIC;
BEGIN
 FOR p IN SELECT user_id,person_name,phone,sum(initial_amount-spent_amount-returned_amount) total FROM funds GROUP BY user_id,person_name,phone LOOP
  wallet:=gen_random_uuid()::text; person:=gen_random_uuid()::text;
  INSERT INTO accounts(id,user_id,name,type,currency,purpose)
   SELECT wallet,id,'Tiers · '||p.person_name,'cash',currency,'third_party' FROM users WHERE id=p.user_id;
  INSERT INTO people(id,user_id,name,phone,account_id) VALUES(person,p.user_id,p.person_name,p.phone,wallet);
  needed:=p.total;
  FOR a IN SELECT * FROM accounts WHERE user_id=p.user_id AND purpose='personal' AND balance>0 ORDER BY balance DESC,id FOR UPDATE LOOP
   EXIT WHEN needed=0;
   moved:=LEAST(needed,a.balance);
   UPDATE accounts SET balance=balance-moved WHERE id=a.id;
   UPDATE accounts SET balance=balance+moved WHERE id=wallet;
   INSERT INTO transactions(id,user_id,account_id,to_account_id,type,amount,category,description,date)
    VALUES(gen_random_uuid()::text,p.user_id,a.id,wallet,'transfer',moved,'Reclassement tiers','Séparation des fonds confiés · '||p.person_name,CURRENT_DATE);
   needed:=needed-moved;
  END LOOP;
  IF needed<>0 THEN RAISE EXCEPTION 'Reclassement impossible : liquidités insuffisantes pour les fonds confiés. Restaurer la sauvegarde et vérifier les soldes.'; END IF;
  UPDATE funds SET person_id=person,account_id=wallet WHERE user_id=p.user_id AND person_name=p.person_name AND phone=p.phone;
 END LOOP;
 -- Past borrowed cash may already have been spent: do not invent or move it a second time.
 FOR f IN SELECT * FROM loans WHERE kind='borrowed' LOOP
  wallet:=gen_random_uuid()::text;
  INSERT INTO accounts(id,user_id,name,type,currency,purpose)
   SELECT wallet,id,'Emprunt · '||f.contact_name||' · '||f.title,'cash',currency,'borrowed' FROM users WHERE id=f.user_id;
  UPDATE loans SET legacy_account_id=account_id,account_id=wallet WHERE id=f.id;
 END LOOP;
END $$;
ALTER TABLE funds ALTER COLUMN person_id SET NOT NULL;
