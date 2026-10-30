"""
Base de données SQLite et logique financière pour le Togo (FCFA).
Prise en compte native de T-Money, Moov Money, Espèces (Poche) et Banques (Ecobank, etc.).
Ségrégation stricte des fonds et génération de reçus d'acomptes détaillés.
"""

import sqlite3
import os
import uuid
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "finances.db")

def get_connection():
    conn = sqlite3.connect(DB_PATH, timeout=30.0, isolation_level=None)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = sqlite3.connect(DB_PATH, timeout=30.0, isolation_level=None)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    c = conn.cursor()

    # 1. Comptes de liquidités (T-Money, Moov Money, Poche, Banques)
    c.execute("""
    CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL, -- 'momo', 'cash', 'bank'
        balance REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'FCFA',
        account_number TEXT DEFAULT '',
        color TEXT DEFAULT '#8b7355',
        is_active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL
    )
    """)

    # 2. Compte Emprunts Reçus (Ce que j'emprunte à autrui ou banque)
    c.execute("""
    CREATE TABLE IF NOT EXISTS loans_borrowed (
        id TEXT PRIMARY KEY,
        lender_name TEXT NOT NULL,
        title TEXT NOT NULL,
        initial_amount REAL NOT NULL,
        current_balance REAL NOT NULL,
        disbursed_to_account_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        due_date TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY (disbursed_to_account_id) REFERENCES accounts (id) ON DELETE SET NULL
    )
    """)

    # 3. Compte Prêts Accordés (Ce que je prête à un tiers)
    c.execute("""
    CREATE TABLE IF NOT EXISTS loans_given (
        id TEXT PRIMARY KEY,
        borrower_name TEXT NOT NULL,
        title TEXT NOT NULL,
        initial_amount REAL NOT NULL,
        current_balance REAL NOT NULL,
        funded_from_account_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        due_date TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY (funded_from_account_id) REFERENCES accounts (id) ON DELETE SET NULL
    )
    """)

    # 4. Historique des remboursements avec suivi des acomptes et reçu
    c.execute("""
    CREATE TABLE IF NOT EXISTS loan_repayments (
        id TEXT PRIMARY KEY,
        receipt_no TEXT UNIQUE,
        loan_type TEXT NOT NULL, -- 'borrowed' ou 'given'
        loan_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        amount REAL NOT NULL,
        installment_number INTEGER NOT NULL DEFAULT 1,
        remaining_balance_after REAL NOT NULL DEFAULT 0,
        date TEXT NOT NULL,
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY (account_id) REFERENCES accounts (id)
    )
    """)

    # 5. Argent Confié par des Tiers (Mandats / Séquestres)
    c.execute("""
    CREATE TABLE IF NOT EXISTS third_party_funds (
        id TEXT PRIMARY KEY,
        person_name TEXT NOT NULL,
        phone TEXT DEFAULT '',
        reason TEXT NOT NULL,
        initial_amount REAL NOT NULL,
        account_id TEXT NOT NULL,
        spent_amount REAL DEFAULT 0,
        returned_amount REAL DEFAULT 0,
        status TEXT DEFAULT 'active',
        date_received TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (account_id) REFERENCES accounts (id)
    )
    """)

    # 6. Transactions Financières
    c.execute("""
    CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        category TEXT NOT NULL,
        description TEXT DEFAULT '',
        date TEXT NOT NULL,
        fee REAL DEFAULT 0,
        to_account_id TEXT,
        related_loan_id TEXT,
        third_party_fund_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
    )
    """)

    # 7. Actifs & Patrimoine
    c.execute("""
    CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        purchase_value REAL NOT NULL,
        current_value REAL NOT NULL,
        purchase_date TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL
    )
    """)

    # 8. Paramètres
    c.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )
    """)

    c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('main_currency', 'FCFA')")
    c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('pin_enabled', '0')")
    c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('pin_code', '1234')")
    c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('user_name', 'Moi')")

    # Initialisation des comptes togolais par défaut (T-Money, Moov Money, Poche, Ecobank)
    c.execute("SELECT COUNT(*) FROM accounts")
    if c.fetchone()[0] == 0:
        now = datetime.now().isoformat()
        togo_default_accounts = [
            (str(uuid.uuid4()), "T-Money (Togocom)", "momo", 0.0, "FCFA", "", "#e60000", 1, now),
            (str(uuid.uuid4()), "Moov Money Togo", "momo", 0.0, "FCFA", "", "#005baa", 1, now),
            (str(uuid.uuid4()), "Dans ma poche (Cash)", "cash", 0.0, "FCFA", "", "#276749", 1, now),
            (str(uuid.uuid4()), "Ecobank Togo", "bank", 0.0, "FCFA", "", "#004b87", 1, now),
        ]
        c.executemany("""
        INSERT INTO accounts (id, name, type, balance, currency, account_number, color, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, togo_default_accounts)

    conn.close()

# ==================== CALCUL DES MÉTRIQUES CLÉS & DONNÉES DE GRAPHES ====================
def get_dashboard_metrics():
    conn = get_connection()
    c = conn.cursor()

    # 1. Total liquidités en caisse
    c.execute("SELECT COALESCE(SUM(balance), 0) FROM accounts WHERE is_active = 1")
    total_cash_in_hand = c.fetchone()[0]

    # 2. Argent des tiers confié (séquestre)
    c.execute("""
    SELECT COALESCE(SUM(initial_amount - spent_amount - returned_amount), 0) 
    FROM third_party_funds 
    WHERE status = 'active'
    """)
    third_party_held = c.fetchone()[0]

    # 3. Encours Emprunts que je dois
    c.execute("SELECT COALESCE(SUM(current_balance), 0) FROM loans_borrowed WHERE status = 'active'")
    total_borrowed_due = c.fetchone()[0]

    # 4. Encours Prêts que j'ai accordés (qu'on me doit)
    c.execute("SELECT COALESCE(SUM(current_balance), 0) FROM loans_given WHERE status = 'active'")
    total_loans_given_due = c.fetchone()[0]

    # 5. Actifs matériels
    c.execute("SELECT COALESCE(SUM(current_value), 0) FROM assets")
    total_assets = c.fetchone()[0]

    # 6. MON CAPITAL PROPRE DISPONIBLE (Fonds 100% à moi, hors argent de tiers)
    real_available_cash = max(0.0, total_cash_in_hand - third_party_held)

    # 7. FORTUNE / PATRIMOINE NET
    net_worth = (total_cash_in_hand - third_party_held - total_borrowed_due) + total_loans_given_due + total_assets

    # Données pour diagramme de répartition des liquidités par compte
    c.execute("SELECT name, balance, color, type FROM accounts WHERE is_active = 1")
    accounts_distribution = [dict(row) for row in c.fetchall()]

    # Données pour diagramme des dépenses par catégorie
    c.execute("""
    SELECT category, COALESCE(SUM(amount), 0) as total 
    FROM transactions 
    WHERE type = 'expense' 
    GROUP BY category 
    ORDER BY total DESC 
    LIMIT 6
    """)
    categories_distribution = [dict(row) for row in c.fetchall()]

    # Paramètres
    c.execute("SELECT key, value FROM settings")
    settings = dict(c.fetchall())

    conn.close()

    return {
        "total_cash_in_hand": total_cash_in_hand,
        "real_available_cash": real_available_cash,
        "third_party_held": third_party_held,
        "total_borrowed_due": total_borrowed_due,
        "total_loans_given_due": total_loans_given_due,
        "total_assets": total_assets,
        "net_worth": net_worth,
        "accounts_distribution": accounts_distribution,
        "categories_distribution": categories_distribution,
        "currency": settings.get("main_currency", "FCFA"),
        "user_name": settings.get("user_name", "Moi"),
        "pin_enabled": settings.get("pin_enabled", "0") == "1"
    }

# ==================== TRANSACTIONS ====================
def record_transaction(account_id, trans_type, amount, category, description="", date=None, fee=0.0, to_account_id=None, third_party_fund_id=None):
    conn = get_connection()
    c = conn.cursor()
    trans_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    if not date:
        date = datetime.now().strftime("%Y-%m-%d")

    amount = float(amount)
    fee = float(fee or 0.0)

    if trans_type == 'income':
        c.execute("UPDATE accounts SET balance = balance + ? WHERE id = ?", (amount, account_id))

    elif trans_type == 'expense':
        total_deduction = amount + fee
        c.execute("UPDATE accounts SET balance = balance - ? WHERE id = ?", (total_deduction, account_id))

        if third_party_fund_id:
            c.execute("UPDATE third_party_funds SET spent_amount = spent_amount + ? WHERE id = ?", (amount, third_party_fund_id))
            c.execute("SELECT initial_amount, spent_amount, returned_amount FROM third_party_funds WHERE id = ?", (third_party_fund_id,))
            tpf = c.fetchone()
            if tpf and (tpf['spent_amount'] + tpf['returned_amount'] >= tpf['initial_amount']):
                c.execute("UPDATE third_party_funds SET status = 'settled' WHERE id = ?", (third_party_fund_id,))

    elif trans_type == 'transfer':
        if not to_account_id:
            conn.close()
            raise ValueError("Compte destination requis pour un virement.")
        c.execute("UPDATE accounts SET balance = balance - ? WHERE id = ?", (amount + fee, account_id))
        c.execute("UPDATE accounts SET balance = balance + ? WHERE id = ?", (amount, to_account_id))

    c.execute("""
    INSERT INTO transactions (id, account_id, type, amount, category, description, date, fee, to_account_id, third_party_fund_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (trans_id, account_id, trans_type, amount, category, description, date, fee, to_account_id, third_party_fund_id, now))

    conn.close()
    return trans_id

# ==================== GESTION DES EMPRUNTS REÇUS (DETTES) ====================
def create_borrowed_loan(lender_name, title, amount, account_id=None, due_date="", notes=""):
    conn = get_connection()
    c = conn.cursor()
    loan_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    today = datetime.now().strftime("%Y-%m-%d")
    amount = float(amount)

    c.execute("""
    INSERT INTO loans_borrowed (id, lender_name, title, initial_amount, current_balance, disbursed_to_account_id, status, due_date, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    """, (loan_id, lender_name, title, amount, amount, account_id, due_date, notes, now))

    if account_id:
        c.execute("UPDATE accounts SET balance = balance + ? WHERE id = ?", (amount, account_id))
        trans_id = str(uuid.uuid4())
        c.execute("""
        INSERT INTO transactions (id, account_id, type, amount, category, description, date, fee, related_loan_id, created_at)
        VALUES (?, ?, 'income', ?, 'Fonds Empruntés', ?, ?, 0, ?, ?)
        """, (trans_id, account_id, amount, f"Encaissement emprunt : {title} ({lender_name})", today, loan_id, now))

    conn.close()
    return loan_id

def repay_borrowed_loan(loan_id, account_id, amount, notes=""):
    conn = get_connection()
    c = conn.cursor()
    amount = float(amount)
    now = datetime.now().isoformat()
    today = datetime.now().strftime("%Y-%m-%d")

    c.execute("SELECT lender_name, title, initial_amount, current_balance FROM loans_borrowed WHERE id = ?", (loan_id,))
    loan = c.fetchone()
    if not loan:
        conn.close()
        raise ValueError("Emprunt introuvable.")

    new_balance = max(0.0, loan['current_balance'] - amount)
    status = 'settled' if new_balance == 0 else 'active'

    # Calcul du numéro d'acompte
    c.execute("SELECT COUNT(*) FROM loan_repayments WHERE loan_id = ? AND loan_type = 'borrowed'", (loan_id,))
    prev_count = c.fetchone()[0]
    installment_number = prev_count + 1

    # N° de reçu unique
    receipt_no = f"REC-EMP-{datetime.now().strftime('%y%m%d')}-{installment_number:02d}-{str(uuid.uuid4())[:4].upper()}"

    # Débiter le compte choisi (T-Money, Moov, Espèces, Banque)
    c.execute("UPDATE accounts SET balance = balance - ? WHERE id = ?", (amount, account_id))

    # Mettre à jour l'emprunt
    c.execute("UPDATE loans_borrowed SET current_balance = ?, status = ? WHERE id = ?", (new_balance, status, loan_id))

    # Enregistrer le remboursement avec son n° d'acompte et reste dû
    rep_id = str(uuid.uuid4())
    c.execute("""
    INSERT INTO loan_repayments (id, receipt_no, loan_type, loan_id, account_id, amount, installment_number, remaining_balance_after, date, notes, created_at)
    VALUES (?, ?, 'borrowed', ?, ?, ?, ?, ?, ?, ?, ?)
    """, (rep_id, receipt_no, loan_id, account_id, amount, installment_number, new_balance, today, notes, now))

    # Transaction
    trans_id = str(uuid.uuid4())
    c.execute("""
    INSERT INTO transactions (id, account_id, type, amount, category, description, date, fee, related_loan_id, created_at)
    VALUES (?, ?, 'expense', ?, 'Remboursement Emprunt', ?, ?, 0, ?, ?)
    """, (trans_id, account_id, amount, f"{installment_number}e Acompte : {loan['title']} à {loan['lender_name']}", today, loan_id, now))

    conn.close()
    return {
        "repayment_id": rep_id,
        "receipt_no": receipt_no,
        "installment_number": installment_number,
        "amount_paid": amount,
        "initial_amount": loan['initial_amount'],
        "remaining_balance": new_balance,
        "beneficiary": loan['lender_name'],
        "title": loan['title'],
        "date": today,
        "is_settled": status == 'settled'
    }

# ==================== GESTION DES PRÊTS ACCORDÉS (CRÉANCES) ====================
def create_given_loan(borrower_name, title, amount, from_account_id, due_date="", notes=""):
    conn = get_connection()
    c = conn.cursor()
    loan_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    today = datetime.now().strftime("%Y-%m-%d")
    amount = float(amount)

    c.execute("UPDATE accounts SET balance = balance - ? WHERE id = ?", (amount, from_account_id))

    c.execute("""
    INSERT INTO loans_given (id, borrower_name, title, initial_amount, current_balance, funded_from_account_id, status, due_date, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    """, (loan_id, borrower_name, title, amount, amount, from_account_id, due_date, notes, now))

    trans_id = str(uuid.uuid4())
    c.execute("""
    INSERT INTO transactions (id, account_id, type, amount, category, description, date, fee, related_loan_id, created_at)
    VALUES (?, ?, 'expense', ?, 'Prêt accordé', ?, ?, 0, ?, ?)
    """, (trans_id, from_account_id, amount, f"Prêt accordé à {borrower_name} : {title}", today, loan_id, now))

    conn.close()
    return loan_id

def receive_loan_repayment(loan_id, to_account_id, amount, notes=""):
    conn = get_connection()
    c = conn.cursor()
    amount = float(amount)
    now = datetime.now().isoformat()
    today = datetime.now().strftime("%Y-%m-%d")

    c.execute("SELECT borrower_name, title, initial_amount, current_balance FROM loans_given WHERE id = ?", (loan_id,))
    loan = c.fetchone()
    if not loan:
        conn.close()
        raise ValueError("Prêt introuvable.")

    new_balance = max(0.0, loan['current_balance'] - amount)
    status = 'settled' if new_balance == 0 else 'active'

    # Calcul du numéro d'acompte reçu
    c.execute("SELECT COUNT(*) FROM loan_repayments WHERE loan_id = ? AND loan_type = 'given'", (loan_id,))
    prev_count = c.fetchone()[0]
    installment_number = prev_count + 1

    # N° de quittance unique
    receipt_no = f"REC-PRT-{datetime.now().strftime('%y%m%d')}-{installment_number:02d}-{str(uuid.uuid4())[:4].upper()}"

    # Créditer le compte choisi
    c.execute("UPDATE accounts SET balance = balance + ? WHERE id = ?", (amount, to_account_id))

    # Diminuer l'encours du prêt accordé
    c.execute("UPDATE loans_given SET current_balance = ?, status = ? WHERE id = ?", (new_balance, status, loan_id))

    # Enregistrer le versement reçu
    rep_id = str(uuid.uuid4())
    c.execute("""
    INSERT INTO loan_repayments (id, receipt_no, loan_type, loan_id, account_id, amount, installment_number, remaining_balance_after, date, notes, created_at)
    VALUES (?, ?, 'given', ?, ?, ?, ?, ?, ?, ?, ?)
    """, (rep_id, receipt_no, loan_id, to_account_id, amount, installment_number, new_balance, today, notes, now))

    # Transaction
    trans_id = str(uuid.uuid4())
    c.execute("""
    INSERT INTO transactions (id, account_id, type, amount, category, description, date, fee, related_loan_id, created_at)
    VALUES (?, ?, 'income', ?, 'Encaissement Prêt', ?, ?, 0, ?, ?)
    """, (trans_id, to_account_id, amount, f"{installment_number}e Acompte reçu de {loan['borrower_name']} pour {loan['title']}", today, loan_id, now))

    conn.close()
    return {
        "collection_id": rep_id,
        "receipt_no": receipt_no,
        "installment_number": installment_number,
        "amount_paid": amount,
        "initial_amount": loan['initial_amount'],
        "remaining_balance": new_balance,
        "debtor": loan['borrower_name'],
        "title": loan['title'],
        "date": today,
        "is_settled": status == 'settled'
    }

# ==================== DÉTAILS D'UN REÇU POUR IMPRESSION ====================
def get_receipt_data(repayment_id):
    conn = get_connection()
    c = conn.cursor()

    c.execute("""
    SELECT r.*, a.name as account_name, a.type as account_type,
           CASE 
             WHEN r.loan_type = 'borrowed' THEN (SELECT lender_name FROM loans_borrowed lb WHERE lb.id = r.loan_id)
             ELSE (SELECT borrower_name FROM loans_given lg WHERE lg.id = r.loan_id)
           END as contact_name,
           CASE 
             WHEN r.loan_type = 'borrowed' THEN (SELECT title FROM loans_borrowed lb WHERE lb.id = r.loan_id)
             ELSE (SELECT title FROM loans_given lg WHERE lg.id = r.loan_id)
           END as loan_title,
           CASE 
             WHEN r.loan_type = 'borrowed' THEN (SELECT initial_amount FROM loans_borrowed lb WHERE lb.id = r.loan_id)
             ELSE (SELECT initial_amount FROM loans_given lg WHERE lg.id = r.loan_id)
           END as initial_amount
    FROM loan_repayments r
    JOIN accounts a ON r.account_id = a.id
    WHERE r.id = ?
    """, (repayment_id,))

    row = c.fetchone()
    conn.close()
    return dict(row) if row else None

# ==================== ARGENT DE TIERS ====================
def add_third_party_fund(person_name, phone, reason, amount, account_id, date_received=None):
    conn = get_connection()
    c = conn.cursor()
    fund_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    if not date_received:
        date_received = datetime.now().strftime("%Y-%m-%d")

    amount = float(amount)
    c.execute("UPDATE accounts SET balance = balance + ? WHERE id = ?", (amount, account_id))

    trans_id = str(uuid.uuid4())
    c.execute("""
    INSERT INTO transactions (id, account_id, type, amount, category, description, date, fee, third_party_fund_id, created_at)
    VALUES (?, ?, 'income', ?, 'Dépôt Tiers', ?, ?, 0, ?, ?)
    """, (trans_id, account_id, amount, f"Argent confié par {person_name} : {reason}", date_received, fund_id, now))

    c.execute("""
    INSERT INTO third_party_funds (id, person_name, phone, reason, initial_amount, account_id, spent_amount, returned_amount, status, date_received, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'active', ?, ?)
    """, (fund_id, person_name, phone, reason, amount, account_id, date_received, now))

    conn.close()
    return fund_id

def refund_third_party_fund(fund_id, account_id, amount, notes=""):
    conn = get_connection()
    c = conn.cursor()
    amount = float(amount)
    now = datetime.now().isoformat()
    today = datetime.now().strftime("%Y-%m-%d")

    c.execute("UPDATE accounts SET balance = balance - ? WHERE id = ?", (amount, account_id))
    c.execute("UPDATE third_party_funds SET returned_amount = returned_amount + ? WHERE id = ?", (amount, fund_id))

    c.execute("SELECT initial_amount, spent_amount, returned_amount, person_name FROM third_party_funds WHERE id = ?", (fund_id,))
    row = c.fetchone()
    if row and (row['spent_amount'] + row['returned_amount'] >= row['initial_amount']):
        c.execute("UPDATE third_party_funds SET status = 'settled' WHERE id = ?", (fund_id,))

    trans_id = str(uuid.uuid4())
    c.execute("""
    INSERT INTO transactions (id, account_id, type, amount, category, description, date, fee, third_party_fund_id, created_at)
    VALUES (?, ?, 'expense', ?, 'Restitution Tiers', ?, ?, 0, ?, ?)
    """, (trans_id, account_id, amount, f"Restitution à {row['person_name']}: {notes}", today, fund_id, now))

    conn.close()

# ==================== ACTIFS ====================
def add_asset(name, category, purchase_value, current_value, purchase_date="", notes=""):
    conn = get_connection()
    c = conn.cursor()
    asset_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    if not purchase_date:
        purchase_date = datetime.now().strftime("%Y-%m-%d")

    c.execute("""
    INSERT INTO assets (id, name, category, purchase_value, current_value, purchase_date, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (asset_id, name, category, float(purchase_value), float(current_value), purchase_date, notes, now))

    conn.close()
    return asset_id

def delete_asset(asset_id):
    conn = get_connection()
    c = conn.cursor()
    c.execute("DELETE FROM assets WHERE id = ?", (asset_id,))
    conn.close()
