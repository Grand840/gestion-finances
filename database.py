"""PostgreSQL storage. Every financial operation runs atomically under its owner's lock."""

import hashlib
import json
import os
from contextlib import contextmanager
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from uuid import uuid4, UUID

from fastapi import HTTPException
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

pool = None


def init_db():
    global pool
    url = os.environ.get("DATABASE_URL", "")
    if not url.startswith(("postgresql://", "postgres://")):
        raise RuntimeError("DATABASE_URL doit désigner une base PostgreSQL.")
    pool = ConnectionPool(
        url, min_size=1, max_size=10, kwargs={"row_factory": dict_row}, open=True
    )
    pool.wait(timeout=30)
    with connect() as db:
        db.execute("SELECT pg_advisory_xact_lock(837401)")
        db.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ DEFAULT now())"
        )
        for path in sorted((Path(__file__).parent / "migrations").glob("*.sql")):
            content = path.read_text()
            checksum = hashlib.sha256(content.encode()).hexdigest()
            previous = one(
                db, "SELECT * FROM schema_migrations WHERE version=%s", [path.name]
            )
            if previous:
                if previous["checksum"] != checksum:
                    raise RuntimeError(
                        "Migration déjà appliquée modifiée : " + path.name
                    )
            else:
                db.execute(content, prepare=False)
                db.execute(
                    "INSERT INTO schema_migrations(version,checksum) VALUES (%s,%s)",
                    [path.name, checksum],
                )


@contextmanager
def connect():
    if pool is None:
        raise RuntimeError("Base non initialisée")
    with pool.connection() as db:
        with db.transaction():
            yield db


def one(db, sql, args=()):
    return db.execute(sql, args).fetchone()


def rows(db, sql, args=()):
    return db.execute(sql, args).fetchall()


def identifier():
    return str(uuid4())


def money(value, zero=False):
    try:
        amount = Decimal(str(value))
        if (
            not amount.is_finite()
            or amount < 0
            or (amount == 0 and not zero)
            or amount >= Decimal("1000000000000")
            or amount != amount.quantize(Decimal(".01"))
        ):
            raise ValueError()
        return amount.quantize(Decimal(".01"))
    except (ValueError, InvalidOperation, TypeError):
        raise HTTPException(422, "Montant invalide : positif, au plus deux décimales.")


def text(value, limit=200, required=True):
    if (
        not isinstance(value, str)
        or len(value.strip()) > limit
        or (required and not value.strip())
    ):
        raise HTTPException(422, "Texte manquant ou trop long.")
    return value.strip()


def day(value=None):
    try:
        return (
            date.today() if value is None or value == "" else date.fromisoformat(value)
        )
    except (ValueError, TypeError):
        raise HTTPException(422, "Date invalide.")


def owned(db, table, uid, resource, active=False):
    try:
        if not isinstance(resource, str) or str(UUID(resource)) != resource:
            raise ValueError()
    except (ValueError, AttributeError):
        raise HTTPException(404, "Élément introuvable dans votre espace.")
    if table not in ("accounts", "loans", "funds", "assets", "receipts"):
        raise ValueError("Unknown resource")
    result = one(
        db,
        f"SELECT * FROM {table} WHERE id=%s AND user_id=%s"
        + (" AND is_active" if active else ""),
        [resource, uid],
    )
    if not result:
        raise HTTPException(404, "Élément introuvable dans votre espace.")
    return result


def audit(db, uid, action, resource=None):
    db.execute(
        "INSERT INTO audit_events(user_id,action,resource_id) VALUES (%s,%s,%s)",
        [uid, action, resource],
    )


def create_defaults(db, user):
    for name, kind in [
        ("Espèces", "cash"),
        ("T-Money", "momo"),
        ("Moov Money", "momo"),
        ("Compte bancaire", "bank"),
    ]:
        db.execute(
            "INSERT INTO accounts(id,user_id,name,type,currency) VALUES (%s,%s,%s,%s,%s)",
            [identifier(), user["id"], name, kind, user["currency"]],
        )


def transaction(
    db,
    uid,
    account,
    kind,
    amount,
    category,
    description="",
    fee=Decimal(0),
    dest=None,
    loan=None,
    fund=None,
    when=None,
):
    tid = identifier()
    db.execute(
        """INSERT INTO transactions(id,user_id,account_id,type,amount,category,description,fee,to_account_id,related_loan_id,third_party_fund_id,date)
                  VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        [
            tid,
            uid,
            account,
            kind,
            amount,
            category,
            description,
            fee,
            dest,
            loan,
            fund,
            when or date.today(),
        ],
    )
    return tid


def debit(db, uid, aid, amount, personal=True):
    acc = owned(db, "accounts", uid, aid, True)
    if acc["balance"] < amount:
        raise HTTPException(422, "Solde insuffisant sur ce compte.")
    if personal:
        liquid = one(
            db,
            "SELECT COALESCE(sum(balance),0) AS n FROM accounts WHERE user_id=%s AND is_active",
            [uid],
        )["n"]
        held = one(
            db,
            "SELECT COALESCE(sum(initial_amount-spent_amount-returned_amount),0) AS n FROM funds WHERE user_id=%s",
            [uid],
        )["n"]
        if liquid - amount < held:
            raise HTTPException(
                422, "Cette opération utiliserait des fonds confiés par un tiers."
            )
    db.execute(
        "UPDATE accounts SET balance=balance-%s WHERE id=%s AND user_id=%s",
        [amount, aid, uid],
    )
    return acc


def credit(db, uid, aid, amount):
    acc = owned(db, "accounts", uid, aid, True)
    db.execute(
        "UPDATE accounts SET balance=balance+%s WHERE id=%s AND user_id=%s",
        [amount, aid, uid],
    )
    return acc


def list_transactions(db, uid, limit=200, offset=0, account=None):
    args = [uid]
    clause = ""
    if account:
        owned(db, "accounts", uid, account)
        clause = " AND (t.account_id=%s OR t.to_account_id=%s)"
        args += [account, account]
    return rows(
        db,
        """SELECT t.*, a.name AS account_name,a.type AS account_type,d.name AS to_account_name
                      FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN accounts d ON d.id=t.to_account_id
                      WHERE t.user_id=%s"""
        + clause
        + " ORDER BY t.date DESC,t.created_at DESC,t.id DESC LIMIT %s OFFSET %s",
        args + [limit, offset],
    )


def list_loans(db, uid, kind):
    loans = rows(
        db,
        "SELECT * FROM loans WHERE user_id=%s AND kind=%s ORDER BY status,created_at DESC",
        [uid, kind],
    )
    for loan in loans:
        loan["lender_name" if kind == "borrowed" else "borrower_name"] = loan[
            "contact_name"
        ]
        loan["repayments"] = [
            r["snapshot"]
            for r in rows(
                db,
                "SELECT snapshot FROM receipts WHERE user_id=%s AND loan_id=%s ORDER BY installment_number",
                [uid, loan["id"]],
            )
        ]
    return loans


def metrics(db, user):
    uid = user["id"]
    liquid = one(
        db,
        "SELECT COALESCE(sum(balance),0) n FROM accounts WHERE user_id=%s AND is_active",
        [uid],
    )["n"]
    held = one(
        db,
        "SELECT COALESCE(sum(initial_amount-spent_amount-returned_amount),0) n FROM funds WHERE user_id=%s",
        [uid],
    )["n"]
    borrowed = one(
        db,
        "SELECT COALESCE(sum(current_balance),0) n FROM loans WHERE user_id=%s AND kind='borrowed'",
        [uid],
    )["n"]
    given = one(
        db,
        "SELECT COALESCE(sum(current_balance),0) n FROM loans WHERE user_id=%s AND kind='given'",
        [uid],
    )["n"]
    assets = one(
        db,
        "SELECT COALESCE(sum(current_value),0) n FROM assets WHERE user_id=%s",
        [uid],
    )["n"]
    return dict(
        total_cash_in_hand=liquid,
        third_party_held=held,
        total_borrowed_due=borrowed,
        total_loans_given_due=given,
        total_assets=assets,
        real_available_cash=liquid - held - borrowed,
        net_worth=liquid - held - borrowed + given + assets,
        currency=user["currency"],
        user_name=user["name"],
        pin_enabled=False,
        accounts_distribution=rows(
            db,
            "SELECT name,balance,type,color FROM accounts WHERE user_id=%s AND is_active ORDER BY name",
            [uid],
        ),
        categories_distribution=rows(
            db,
            "SELECT category,sum(amount+fee) total FROM transactions WHERE user_id=%s AND type='expense' AND related_loan_id IS NULL AND third_party_fund_id IS NULL GROUP BY category ORDER BY total DESC LIMIT 5",
            [uid],
        ),
    )


def create_account(db, user, data):
    name, kind = text(data.get("name")), data.get("type")
    if (
        kind not in ("cash", "momo", "bank")
        or data.get("currency", user["currency"]) != user["currency"]
    ):
        raise HTTPException(
            422, "Type de compte ou devise invalide. Une seule devise par espace."
        )
    amount, aid = money(data.get("balance", 0), True), identifier()
    db.execute(
        "INSERT INTO accounts(id,user_id,name,type,currency,balance,account_number) VALUES (%s,%s,%s,%s,%s,%s,%s)",
        [
            aid,
            user["id"],
            name,
            kind,
            user["currency"],
            amount,
            text(data.get("account_number", ""), required=False),
        ],
    )
    if amount:
        transaction(
            db,
            user["id"],
            aid,
            "income",
            amount,
            "Solde initial",
            "Ouverture du compte",
        )
    return dict(success=True, id=aid)


def create_transaction(db, user, data):
    uid = user["id"]
    kind = data.get("type")
    if kind not in ("income", "expense", "transfer"):
        raise HTTPException(422, "Type d’opération invalide.")
    amount, fee = money(data.get("amount")), money(data.get("fee", 0), True)
    aid, dest = data.get("account_id"), data.get("to_account_id")
    if kind == "income" and fee:
        raise HTTPException(422, "Les frais ne sont pas autorisés sur une entrée.")
    if kind == "transfer":
        if aid == dest:
            raise HTTPException(422, "Choisissez deux comptes différents.")
        owned(db, "accounts", uid, dest, True)
        debit(db, uid, aid, amount + fee, personal=False)
        credit(db, uid, dest, amount)
        if fee:
            liquid = one(
                db,
                "SELECT COALESCE(sum(balance),0) n FROM accounts WHERE user_id=%s AND is_active",
                [uid],
            )["n"]
            held = one(
                db,
                "SELECT COALESCE(sum(initial_amount-spent_amount-returned_amount),0) n FROM funds WHERE user_id=%s",
                [uid],
            )["n"]
            if liquid < held:
                raise HTTPException(422, "Ces frais utiliseraient des fonds de tiers.")
    elif kind == "expense":
        debit(db, uid, aid, amount + fee)
    else:
        credit(db, uid, aid, amount)
    tid = transaction(
        db,
        uid,
        aid,
        kind,
        amount,
        text(data.get("category", "Général")),
        text(data.get("description", ""), 1000, False),
        fee,
        dest if kind == "transfer" else None,
        when=day(data.get("date")),
    )
    return dict(success=True, id=tid)


def create_loan(db, user, data, kind):
    uid, lid = user["id"], identifier()
    amount = money(data.get("amount"))
    contact = text(
        data.get("lender_name") if kind == "borrowed" else data.get("borrower_name")
    )
    aid = data.get("account_id") if kind == "borrowed" else data.get("from_account_id")
    title = text(data.get("title"))
    if aid:
        (credit if kind == "borrowed" else debit)(db, uid, aid, amount)
    elif kind == "given":
        raise HTTPException(422, "Compte à débiter obligatoire.")
    db.execute(
        "INSERT INTO loans(id,user_id,kind,contact_name,title,initial_amount,current_balance,account_id,due_date,notes) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        [
            lid,
            uid,
            kind,
            contact,
            title,
            amount,
            amount,
            aid or None,
            day(data["due_date"]) if data.get("due_date") else None,
            text(data.get("notes", ""), 1000, False),
        ],
    )
    if aid:
        transaction(
            db,
            uid,
            aid,
            "income" if kind == "borrowed" else "expense",
            amount,
            "Emprunt reçu" if kind == "borrowed" else "Prêt accordé",
            f"{title} · {contact}",
            loan=lid,
        )
    return dict(success=True, id=lid)


def repay(db, user, data, kind):
    uid = user["id"]
    loan = owned(db, "loans", uid, data.get("loan_id"))
    if loan["kind"] != kind:
        raise HTTPException(404, "Engagement introuvable.")
    amount = money(data.get("amount"))
    if amount > loan["current_balance"]:
        raise HTTPException(422, "Le versement dépasse le solde restant dû.")
    aid = data.get("account_id") if kind == "borrowed" else data.get("to_account_id")
    acc = (debit if kind == "borrowed" else credit)(db, uid, aid, amount)
    remaining, rid = loan["current_balance"] - amount, identifier()
    ordinal = one(
        db,
        "SELECT count(*)+1 n FROM receipts WHERE loan_id=%s AND user_id=%s",
        [loan["id"], uid],
    )["n"]
    notes = text(data.get("notes", ""), 1000, False)
    snapshot = dict(
        id=rid,
        receipt_no="SL-"
        + date.today().strftime("%Y%m%d")
        + "-"
        + rid[:13].replace("-", "").upper(),
        loan_id=loan["id"],
        loan_type=kind,
        loan_title=loan["title"],
        contact_name=loan["contact_name"],
        issuer_name=user["name"],
        currency=user["currency"],
        initial_amount=str(loan["initial_amount"]),
        amount=str(amount),
        remaining_balance_before=str(loan["current_balance"]),
        remaining_balance_after=str(remaining),
        total_paid=str(loan["initial_amount"] - remaining),
        installment_number=ordinal,
        date=date.today().isoformat(),
        account_name=acc["name"],
        account_type=acc["type"],
        notes=notes,
    )
    snapshot["document_hash"] = hashlib.sha256(
        json.dumps(snapshot, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()
    db.execute(
        "UPDATE loans SET current_balance=%s,status=%s WHERE id=%s AND user_id=%s",
        [remaining, "settled" if remaining == 0 else "active", loan["id"], uid],
    )
    db.execute(
        "INSERT INTO receipts(id,user_id,loan_id,account_id,receipt_no,installment_number,amount,remaining_balance_after,snapshot) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        [
            rid,
            uid,
            loan["id"],
            aid,
            snapshot["receipt_no"],
            ordinal,
            amount,
            remaining,
            Jsonb(snapshot),
        ],
    )
    transaction(
        db,
        uid,
        aid,
        "expense" if kind == "borrowed" else "income",
        amount,
        "Remboursement emprunt" if kind == "borrowed" else "Remboursement prêt",
        f'Versement n° {ordinal} · {loan["title"]}',
        loan=loan["id"],
    )
    return dict(
        success=True, receipt=dict(repayment_id=rid, collection_id=rid, **snapshot)
    )


def create_fund(db, user, data):
    uid, fid = user["id"], identifier()
    amount = money(data.get("amount"))
    aid = data.get("account_id")
    credit(db, uid, aid, amount)
    person, reason = text(data.get("person_name")), text(data.get("reason"))
    db.execute(
        "INSERT INTO funds(id,user_id,person_name,phone,reason,initial_amount,account_id,date_received) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
        [
            fid,
            uid,
            person,
            text(data.get("phone", ""), 80, False),
            reason,
            amount,
            aid,
            day(data.get("date_received")),
        ],
    )
    transaction(
        db,
        uid,
        aid,
        "income",
        amount,
        "Fonds confiés",
        f"{person} · {reason}",
        fund=fid,
        when=day(data.get("date_received")),
    )
    return dict(success=True, id=fid)


def refund(db, user, data):
    uid = user["id"]
    fund = owned(db, "funds", uid, data.get("fund_id"))
    amount = money(data.get("amount"))
    remaining = fund["initial_amount"] - fund["spent_amount"] - fund["returned_amount"]
    if amount > remaining:
        raise HTTPException(422, "Le montant dépasse le reliquat confié.")
    debit(db, uid, data.get("account_id"), amount, personal=False)
    db.execute(
        "UPDATE funds SET returned_amount=returned_amount+%s,status=%s WHERE id=%s AND user_id=%s",
        [amount, "settled" if amount == remaining else "active", fund["id"], uid],
    )
    transaction(
        db,
        uid,
        data["account_id"],
        "expense",
        amount,
        "Restitution tiers",
        text(data.get("notes", ""), 1000, False),
        fund=fund["id"],
    )
    return dict(success=True)


def spend_fund(db, user, data):
    uid = user["id"]
    fund = owned(db, "funds", uid, data.get("fund_id"))
    amount, fee = money(data.get("amount")), money(data.get("fee", 0), True)
    total = amount + fee
    remaining = fund["initial_amount"] - fund["spent_amount"] - fund["returned_amount"]
    if total > remaining:
        raise HTTPException(
            422, "Le montant et les frais dépassent le reliquat confié."
        )
    aid = data.get("account_id")
    debit(db, uid, aid, total, personal=False)
    db.execute(
        "UPDATE funds SET spent_amount=spent_amount+%s,status=%s WHERE id=%s AND user_id=%s",
        [total, "settled" if total == remaining else "active", fund["id"], uid],
    )
    tid = transaction(
        db,
        uid,
        aid,
        "expense",
        amount,
        "Achat pour tiers",
        text(data.get("description"), 1000),
        fee,
        fund=fund["id"],
        when=day(data.get("date")),
    )
    return dict(success=True, id=tid)
