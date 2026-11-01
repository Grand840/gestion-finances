"""Trusted server console only: issue a short-lived, single-use recovery code."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import database
from server import recovery_code, email_address


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/recover.py adresse@email")
    database.init_db()
    try:
        with database.connect() as db:
            user = database.one(
                db,
                "SELECT * FROM users WHERE email=%s AND active FOR UPDATE",
                [email_address(sys.argv[1])],
            )
            if not user:
                raise SystemExit("Compte actif introuvable.")
            code = recovery_code(db, user["id"])
            database.audit(db, user["id"], "console.recovery_created")
        print("Code personnel, valable 30 minutes, à transmettre en privé :")
        print(code)
    finally:
        database.pool.close()


if __name__ == "__main__":
    main()
