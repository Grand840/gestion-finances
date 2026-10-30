#!/usr/bin/env python3
"""
Serveur Financier & Patrimoine (Togo - FCFA)
Support des comptes locaux (T-Money, Moov Money, Cash, Banques), graphiques et reçus PDF d'acomptes.
"""

import http.server
import socketserver
import json
import os
import urllib.parse
from datetime import datetime
import database

PORT = 8080
PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")

database.init_db()

class FinanceRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Pin-Code")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path.startswith("/api/"):
            self.handle_api_get(path, query)
        else:
            local_path = os.path.join(PUBLIC_DIR, path.lstrip("/"))
            if not os.path.exists(local_path) or os.path.isdir(local_path):
                self.path = "/index.html"
            super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else "{}"
        try:
            data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            data = {}

        if path.startswith("/api/"):
            self.handle_api_post(path, data)
        else:
            self.send_error(404, "Not Found")

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path.startswith("/api/"):
            self.handle_api_delete(path)
        else:
            self.send_error(404, "Not Found")

    # ==================== ROUTEUR GET ====================
    def handle_api_get(self, path, query):
        if path == "/api/metrics":
            metrics = database.get_dashboard_metrics()
            self.send_json(metrics)
            return

        if path.startswith("/api/receipt/"):
            rep_id = path.split("/")[-1]
            rec = database.get_receipt_data(rep_id)
            if rec:
                self.send_json({"success": True, "receipt": rec})
            else:
                self.send_json({"success": False, "error": "Reçu introuvable"}, status=404)
            return

        conn = database.get_connection()
        c = conn.cursor()

        try:
            if path == "/api/accounts":
                c.execute("""
                SELECT a.*, 
                  (SELECT COUNT(*) FROM transactions t WHERE t.account_id = a.id) as transaction_count
                FROM accounts a
                WHERE is_active = 1
                ORDER BY a.type, a.name
                """)
                accounts = [dict(row) for row in c.fetchall()]
                self.send_json(accounts)

            elif path == "/api/transactions":
                limit = int(query.get("limit", [50])[0])
                c.execute("""
                SELECT t.*, 
                  a.name as account_name, a.type as account_type, a.color as account_color,
                  d.name as to_account_name,
                  tpf.person_name as third_party_person
                FROM transactions t
                JOIN accounts a ON t.account_id = a.id
                LEFT JOIN accounts d ON t.to_account_id = d.id
                LEFT JOIN third_party_funds tpf ON t.third_party_fund_id = tpf.id
                ORDER BY t.date DESC, t.created_at DESC
                LIMIT ?
                """, (limit,))
                transactions = [dict(row) for row in c.fetchall()]
                self.send_json(transactions)

            # MES EMPRUNTS (avec historique de chaque acompte)
            elif path == "/api/loans/borrowed":
                c.execute("""
                SELECT lb.*, a.name as disbursed_to_account_name,
                  (initial_amount - current_balance) as total_repaid
                FROM loans_borrowed lb
                LEFT JOIN accounts a ON lb.disbursed_to_account_id = a.id
                ORDER BY lb.status ASC, lb.created_at DESC
                """)
                loans = [dict(row) for row in c.fetchall()]
                for l in loans:
                    c.execute("""
                    SELECT lr.*, acc.name as account_name 
                    FROM loan_repayments lr 
                    JOIN accounts acc ON lr.account_id = acc.id
                    WHERE lr.loan_id = ? AND lr.loan_type = 'borrowed' 
                    ORDER BY lr.installment_number ASC
                    """, (l['id'],))
                    l['repayments'] = [dict(r) for r in c.fetchall()]
                self.send_json(loans)

            # MES PRÊTS ACCORDÉS (avec historique de chaque acompte reçu)
            elif path == "/api/loans/given":
                c.execute("""
                SELECT lg.*, a.name as funded_from_account_name,
                  (initial_amount - current_balance) as total_collected
                FROM loans_given lg
                LEFT JOIN accounts a ON lg.funded_from_account_id = a.id
                ORDER BY lg.status ASC, lg.created_at DESC
                """)
                loans = [dict(row) for row in c.fetchall()]
                for l in loans:
                    c.execute("""
                    SELECT lr.*, acc.name as account_name 
                    FROM loan_repayments lr 
                    JOIN accounts acc ON lr.account_id = acc.id
                    WHERE lr.loan_id = ? AND lr.loan_type = 'given' 
                    ORDER BY lr.installment_number ASC
                    """, (l['id'],))
                    l['repayments'] = [dict(r) for r in c.fetchall()]
                self.send_json(loans)

            elif path == "/api/third-party":
                c.execute("""
                SELECT tpf.*, a.name as account_name,
                  (initial_amount - spent_amount - returned_amount) as remaining_amount
                FROM third_party_funds tpf
                JOIN accounts a ON tpf.account_id = a.id
                ORDER BY tpf.status ASC, tpf.created_at DESC
                """)
                funds = [dict(row) for row in c.fetchall()]
                self.send_json(funds)

            elif path == "/api/assets":
                c.execute("SELECT * FROM assets ORDER BY category, name")
                assets = [dict(row) for row in c.fetchall()]
                self.send_json(assets)

            elif path == "/api/settings":
                c.execute("SELECT key, value FROM settings")
                settings = dict(c.fetchall())
                settings["pin_is_set"] = bool(settings.get("pin_code"))
                settings.pop("pin_code", None)
                self.send_json(settings)

            elif path == "/api/export":
                backup = {}
                tables = ["accounts", "transactions", "loans_borrowed", "loans_given", "loan_repayments", "third_party_funds", "assets", "settings"]
                for tbl in tables:
                    c.execute(f"SELECT * FROM {tbl}")
                    backup[tbl] = [dict(row) for row in c.fetchall()]
                self.send_json(backup)

            else:
                self.send_error(404, "Endpoint introuvable")

        finally:
            conn.close()

    # ==================== ROUTEUR POST ====================
    def handle_api_post(self, path, data):
        try:
            if path == "/api/transactions":
                account_id = data.get("account_id")
                trans_type = data.get("type")
                amount = float(data.get("amount", 0))
                category = data.get("category", "Général")
                description = data.get("description", "")
                date = data.get("date")
                fee = float(data.get("fee", 0))
                to_account_id = data.get("to_account_id")
                third_party_fund_id = data.get("third_party_fund_id")

                tid = database.record_transaction(
                    account_id=account_id,
                    trans_type=trans_type,
                    amount=amount,
                    category=category,
                    description=description,
                    date=date,
                    fee=fee,
                    to_account_id=to_account_id,
                    third_party_fund_id=third_party_fund_id
                )
                self.send_json({"success": True, "id": tid, "message": "Opération enregistrée"})

            elif path == "/api/accounts":
                import uuid
                conn = database.get_connection()
                c = conn.cursor()
                acc_id = str(uuid.uuid4())
                name = data.get("name", "Nouveau Compte")
                acc_type = data.get("type", "momo")
                balance = float(data.get("balance", 0))
                currency = data.get("currency", "FCFA")
                account_number = data.get("account_number", "")
                color = data.get("color", "#8b7355")
                now = datetime.now().isoformat()

                c.execute("""
                INSERT INTO accounts (id, name, type, balance, currency, account_number, color, is_active, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
                """, (acc_id, name, acc_type, balance, currency, account_number, color, now))
                conn.close()
                self.send_json({"success": True, "id": acc_id})

            # NOUVEL EMPRUNT REÇU
            elif path == "/api/loans/borrowed":
                lender_name = data.get("lender_name")
                title = data.get("title", "Emprunt")
                amount = float(data.get("amount", 0))
                account_id = data.get("account_id")
                due_date = data.get("due_date", "")
                notes = data.get("notes", "")

                lid = database.create_borrowed_loan(lender_name, title, amount, account_id, due_date, notes)
                self.send_json({"success": True, "id": lid, "message": "Emprunt enregistré dans le compte dédié"})

            # REMBOURSER UN EMPRUNT (renvoie les données complètes pour impression de reçu)
            elif path == "/api/loans/borrowed/repay":
                loan_id = data.get("loan_id")
                account_id = data.get("account_id")
                amount = float(data.get("amount", 0))
                notes = data.get("notes", "")

                receipt_info = database.repay_borrowed_loan(loan_id, account_id, amount, notes)
                self.send_json({"success": True, "receipt": receipt_info, "message": "Remboursement validé"})

            # NOUVEAU PRÊT ACCORDÉ
            elif path == "/api/loans/given":
                borrower_name = data.get("borrower_name")
                title = data.get("title", "Prêt accordé")
                amount = float(data.get("amount", 0))
                from_account_id = data.get("from_account_id")
                due_date = data.get("due_date", "")
                notes = data.get("notes", "")

                lid = database.create_given_loan(borrower_name, title, amount, from_account_id, due_date, notes)
                self.send_json({"success": True, "id": lid, "message": "Prêt accordé et débité du compte"})

            # ENCAISSER UN REMBOURSEMENT DE PRÊT (renvoie les données de quittance pour impression)
            elif path == "/api/loans/given/receive":
                loan_id = data.get("loan_id")
                to_account_id = data.get("to_account_id")
                amount = float(data.get("amount", 0))
                notes = data.get("notes", "")

                receipt_info = database.receive_loan_repayment(loan_id, to_account_id, amount, notes)
                self.send_json({"success": True, "receipt": receipt_info, "message": "Acompte encaissé"})

            # ARGENT DE TIERS
            elif path == "/api/third-party":
                person_name = data.get("person_name")
                phone = data.get("phone", "")
                reason = data.get("reason", "Mandat")
                amount = float(data.get("amount", 0))
                account_id = data.get("account_id")
                date_received = data.get("date_received")

                fid = database.add_third_party_fund(person_name, phone, reason, amount, account_id, date_received)
                self.send_json({"success": True, "id": fid, "message": "Fonds tiers consigné"})

            elif path == "/api/third-party/refund":
                fund_id = data.get("fund_id")
                account_id = data.get("account_id")
                amount = float(data.get("amount", 0))
                notes = data.get("notes", "")

                database.refund_third_party_fund(fund_id, account_id, amount, notes)
                self.send_json({"success": True, "message": "Restitution validée"})

            # ACTIFS
            elif path == "/api/assets":
                name = data.get("name")
                category = data.get("category", "material")
                purchase_value = float(data.get("purchase_value", 0))
                current_value = float(data.get("current_value", purchase_value))
                purchase_date = data.get("purchase_date", "")
                notes = data.get("notes", "")

                aid = database.add_asset(name, category, purchase_value, current_value, purchase_date, notes)
                self.send_json({"success": True, "id": aid, "message": "Actif enregistré"})

            # SÉCURITÉ PIN
            elif path == "/api/verify-pin":
                entered_pin = str(data.get("pin", ""))
                conn = database.get_connection()
                c = conn.cursor()
                c.execute("SELECT value FROM settings WHERE key = 'pin_code'")
                stored_pin = c.fetchone()
                conn.close()
                correct_pin = stored_pin[0] if stored_pin else "1234"
                if entered_pin == correct_pin:
                    self.send_json({"valid": True})
                else:
                    self.send_json({"valid": False, "message": "Code PIN incorrect"}, status=401)

            elif path == "/api/settings":
                conn = database.get_connection()
                c = conn.cursor()
                for k, v in data.items():
                    c.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (str(k), str(v)))
                conn.close()
                self.send_json({"success": True, "message": "Paramètres actualisés"})

            else:
                self.send_error(404, "Endpoint introuvable")

        except Exception as e:
            self.send_json({"success": False, "error": str(e)}, status=500)

    # ==================== ROUTEUR DELETE ====================
    def handle_api_delete(self, path):
        try:
            if path.startswith("/api/assets/"):
                asset_id = path.split("/")[-1]
                database.delete_asset(asset_id)
                self.send_json({"success": True, "message": "Actif supprimé"})

            elif path.startswith("/api/accounts/"):
                acc_id = path.split("/")[-1]
                conn = database.get_connection()
                c = conn.cursor()
                c.execute("UPDATE accounts SET is_active = 0 WHERE id = ?", (acc_id,))
                conn.close()
                self.send_json({"success": True, "message": "Compte désactivé"})
            else:
                self.send_error(404, "Endpoint introuvable")
        except Exception as e:
            self.send_json({"success": False, "error": str(e)}, status=500)

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

def main():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("0.0.0.0", PORT), FinanceRequestHandler) as httpd:
        print("Sillage — Vos finances, en clair")
        print(f"📍 PC : http://localhost:{PORT}")
        print(f"Réseau : port {PORT}, toutes interfaces (réseau de confiance uniquement)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("Arrêt.")

if __name__ == "__main__":
    main()
