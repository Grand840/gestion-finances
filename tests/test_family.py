"""Integration regressions against real, temporary PostgreSQL (no SQLite fallback)."""

import concurrent.futures

import pytest
from psycopg.errors import RaiseException

import database as db

from conftest import SETUP

PASSWORD = "Un bon mot de passe 2026!"


def register(client, email="admin@example.test", code=SETUP, name="Alex Mensah"):
    result = client.post(
        "/api/auth/register",
        json=dict(email=email, password=PASSWORD, name=name, code=code),
    )
    assert result.status_code == 200, result.text
    client.headers["X-CSRF-Token"] = result.json()["csrf_token"]
    return result.json()


def post(client, path, data, key=None):
    result = client.post(
        "/api/" + path, json=data, headers={"Idempotency-Key": key or db.identifier()}
    )
    assert result.status_code == 200, result.text
    return result.json()


def funded(client, amount="250000"):
    register(client)
    accounts = client.get("/api/accounts").json()
    aid = accounts[0]["id"]
    post(
        client,
        "transactions",
        dict(type="income", amount=amount, account_id=aid, category="Salaire"),
    )
    return aid, accounts


def member(client):
    register(client)
    code = client.post("/api/admin/invitations").json()["code"]
    admin_cookie = client.cookies.get("sillage_session")
    admin_csrf = client.headers["X-CSRF-Token"]
    first_accounts = client.get("/api/accounts").json()
    client.cookies.clear()
    second = register(client, "member@example.test", code, "Membre de famille")
    return dict(
        cookie=admin_cookie,
        csrf=admin_csrf,
        accounts=first_accounts,
        member=second["user"],
    )


def test_authentication_and_csrf(client):
    assert client.get("/api/metrics").status_code == 401
    assert client.get("/api/auth/status").json()["bootstrap_required"] is True
    response = register(client)
    assert response["user"]["role"] == "admin"
    assert "password_hash" not in response["user"]
    assert client.get("/api/auth/status").json()["authenticated"] is True
    assert (
        client.post(
            "/api/transactions", json={"amount": 1}, headers={"X-CSRF-Token": ""}
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/auth/logout", json={}, headers={"Origin": "https://evil.test"}
        ).status_code
        == 403
    )
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/metrics").status_code == 401
    assert client.get("/api/auth/status").json()["authenticated"] is False
    assert (
        client.post(
            "/api/auth/login", json={"email": "admin@example.test", "password": "wrong"}
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/auth/login",
            json={"email": "admin@example.test", "password": PASSWORD},
        ).status_code
        == 200
    )


def test_invitation_private_spaces_and_admin(client):
    admin = member(client)
    assert client.get("/api/admin/users").status_code == 403
    assert client.get("/api/accounts/" + admin["accounts"][0]["id"]).status_code == 404
    assert (
        client.get(
            "/api/transactions", params={"account_id": admin["accounts"][0]["id"]}
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/api/transactions",
            json=dict(
                type="income",
                amount=100,
                category="Vol",
                account_id=admin["accounts"][0]["id"],
            ),
        ).status_code
        == 404
    )
    assert len(client.get("/api/accounts").json()) == 4
    assert client.get("/api/metrics").json()["real_available_cash"] == 0
    assert (
        client.post(
            "/api/auth/register",
            json=dict(
                email="third@example.test",
                password=PASSWORD,
                name="Third",
                code="invalid",
            ),
        ).status_code
        == 403
    )
    client.cookies.clear()
    client.cookies.set("sillage_session", admin["cookie"])
    client.headers["X-CSRF-Token"] = admin["csrf"]
    users = client.get("/api/admin/users").json()
    assert len(users) == 2 and all("password_hash" not in u for u in users)
    assert (
        client.post(
            "/api/admin/users/" + admin["member"]["id"] + "/status",
            json={"active": False},
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/auth/login", json=dict(email="member@example.test", password=PASSWORD)
        ).status_code
        == 401
    )


def test_financial_operations_and_snapshot_pdf(client):
    aid, accounts = funded(client)
    post(
        client,
        "transactions",
        dict(
            type="expense",
            account_id=aid,
            amount=15000,
            fee=100,
            category="Courses",
            description="Marché",
        ),
    )
    post(
        client,
        "transactions",
        dict(
            type="transfer",
            account_id=aid,
            to_account_id=accounts[1]["id"],
            amount=20000,
            category="Virement",
        ),
    )
    loan = post(
        client,
        "loans/given",
        dict(
            borrower_name="Kofi d'Avé <ami>",
            title="Équipement",
            amount=25000,
            from_account_id=aid,
        ),
    )
    receipt = post(
        client,
        "loans/given/receive",
        dict(
            loan_id=loan["id"], to_account_id=aid, amount=5000, notes="Premier acompte"
        ),
    )["receipt"]
    first = client.get("/api/receipt/" + receipt["id"]).json()["receipt"]
    assert first["remaining_balance_before"] == "25000.00"
    assert first["remaining_balance_after"] == "20000.00"
    assert first["issuer_name"] == "Alex Mensah"
    loan2 = post(
        client,
        "loans/borrowed",
        dict(lender_name="Banque", title="Avance", amount=50000),
    )
    r2 = post(
        client,
        "loans/borrowed/repay",
        dict(loan_id=loan2["id"], amount=10000),
    )["receipt"]
    assert r2["remaining_balance_after"] == "40000.00"
    fund = post(
        client,
        "third-party",
        dict(person_name="Client", reason="Achats", amount=30000),
    )
    post(
        client,
        "third-party/refund",
        dict(fund_id=fund["id"], amount=10000),
    )
    metrics = client.get("/api/metrics").json()
    assert metrics["real_available_cash"] == 214900
    assert metrics["categories_distribution"] == [
        {"category": "Courses", "total": 15100}
    ]
    pdf = client.get("/api/receipt/" + receipt["id"] + "/pdf")
    assert (
        pdf.status_code == 200
        and pdf.content.startswith(b"%PDF-")
        and len(pdf.content) > 15000
    )
    post(client, "settings", dict(user_name="Nouveau nom", main_currency="FCFA"))
    post(
        client,
        "loans/given/receive",
        dict(loan_id=loan["id"], to_account_id=aid, amount=20000),
    )
    assert client.get("/api/receipt/" + receipt["id"]).json()["receipt"] == first
    with pytest.raises(RaiseException):
        with db.connect() as connection:
            connection.execute("DELETE FROM receipts WHERE id=%s", [receipt["id"]])
    detail = client.get("/api/accounts/" + accounts[1]["id"]).json()
    assert detail["summary"]["count"] == 1 and detail["summary"]["income"] == 20000
    assert (
        client.get(
            "/api/transactions", params={"account_id": accounts[1]["id"]}
        ).json()[0]["type"]
        == "transfer"
    )


def test_invalid_amounts_rollback_and_idempotency(client):
    aid, accounts = funded(client, "10000")
    for amount in [-1, 0, "NaN", "Infinity", "0.001", "100000000000000"]:
        assert (
            client.post(
                "/api/transactions",
                json=dict(
                    type="expense", account_id=aid, amount=amount, category="Test"
                ),
            ).status_code
            == 422
        )
    assert (
        client.post(
            "/api/transactions",
            json=dict(
                type="transfer",
                account_id=aid,
                to_account_id=aid,
                amount=100,
                category="Test",
            ),
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/transactions",
            json=dict(type="expense", account_id=aid, amount=20000, category="Test"),
        ).status_code
        == 422
    )
    key = db.identifier()
    operation = dict(type="expense", account_id=aid, amount=500, category="Test")
    a = post(client, "transactions", operation, key)
    b = post(client, "transactions", operation, key)
    assert a == b
    operation["amount"] = 1000
    assert (
        client.post(
            "/api/transactions", json=operation, headers={"Idempotency-Key": key}
        ).status_code
        == 409
    )
    assert client.get("/api/metrics").json()["total_cash_in_hand"] == 9500
    assert (
        client.post(
            "/api/settings", json=dict(user_name="Alex", main_currency="EUR")
        ).status_code
        == 422
    )


def test_receipts_are_private_and_overpayment_fails(client):
    aid, _ = funded(client)
    loan = post(
        client,
        "loans/given",
        dict(borrower_name="Ami", title="Achat", amount=1000, from_account_id=aid),
    )
    assert (
        client.post(
            "/api/loans/given/receive",
            json=dict(loan_id=loan["id"], to_account_id=aid, amount=1100),
        ).status_code
        == 422
    )
    r = post(
        client,
        "loans/given/receive",
        dict(loan_id=loan["id"], to_account_id=aid, amount=1000),
    )["receipt"]
    code = client.post("/api/admin/invitations").json()["code"]
    client.cookies.clear()
    register(client, "new@example.test", code)
    for suffix in ("", "/pdf"):
        assert client.get("/api/receipt/" + r["id"] + suffix).status_code == 404
    assert not client.get("/api/export").json()["receipts"]


def test_atomic_concurrent_repayments(client):
    aid, _ = funded(client)
    loan = post(
        client,
        "loans/given",
        dict(
            borrower_name="Ami",
            title="Test concurrence",
            amount=1000,
            from_account_id=aid,
        ),
    )

    def pay(_):
        return client.post(
            "/api/loans/given/receive",
            json=dict(loan_id=loan["id"], to_account_id=aid, amount=700),
        ).status_code

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(pay, range(2)))
    assert sorted(results) == [200, 422]
    assert client.get("/api/loans/given").json()[0]["current_balance"] == 300
    assert len(client.get("/api/loans/given").json()[0]["repayments"]) == 1


def test_password_change_revokes_sessions(client):
    register(client)
    old_cookie = client.cookies.get("sillage_session")
    changed = client.post(
        "/api/auth/password",
        json=dict(
            current_password=PASSWORD, new_password="Ma nouvelle phrase très solide!"
        ),
    )
    assert changed.status_code == 200
    client.cookies.clear()
    client.cookies.set("sillage_session", old_cookie)
    assert client.get("/api/metrics").status_code == 401


def test_held_money_not_spent_and_archive(client):
    aid, _ = funded(client, "1000")
    post(
        client,
        "third-party",
        dict(person_name="Proche", reason="Dépôt", amount=10000),
    )
    assert (
        client.post(
            "/api/transactions",
            json=dict(type="expense", account_id=aid, amount=1500, category="Courses"),
        ).status_code
        == 422
    )
    assert client.delete("/api/accounts/" + aid).status_code == 422
    assert client.get("/api/metrics").json()["total_cash_in_hand"] == 11000


def test_password_recovery_is_one_use_and_revokes_sessions(client):
    admin = member(client)
    member_cookie = client.cookies.get("sillage_session")
    client.cookies.clear()
    client.cookies.set("sillage_session", admin["cookie"])
    client.headers["X-CSRF-Token"] = admin["csrf"]
    code = client.post(
        "/api/admin/users/" + admin["member"]["id"] + "/recovery"
    ).json()["code"]
    client.cookies.clear()
    values = dict(
        email="member@example.test",
        password="Une nouvelle phrase récupérée!",
        code=code,
    )
    assert client.post("/api/auth/recover", json=values).status_code == 200
    assert client.post("/api/auth/recover", json=values).status_code == 422
    client.cookies.set("sillage_session", member_cookie)
    assert client.get("/api/metrics").status_code == 401
    client.cookies.clear()
    assert (
        client.post(
            "/api/auth/login",
            json=dict(email=values["email"], password=values["password"]),
        ).status_code
        == 200
    )


def test_expired_invitation_and_revocation(client):
    register(client)
    code = client.post("/api/admin/invitations").json()["code"]
    client.post("/api/admin/invitations/revoke")
    assert (
        client.post(
            "/api/auth/register",
            json=dict(
                email="new@example.test", password=PASSWORD, name="New", code=code
            ),
        ).status_code
        == 403
    )
    code = client.post("/api/admin/invitations").json()["code"]
    with db.connect() as connection:
        connection.execute("UPDATE invitations SET expires_at=now()-interval '1 hour'")
    assert (
        client.post(
            "/api/auth/register",
            json=dict(
                email="new@example.test", password=PASSWORD, name="New", code=code
            ),
        ).status_code
        == 403
    )


def test_login_rate_limit_and_expired_session(client):
    register(client)
    with db.connect() as connection:
        connection.execute("UPDATE sessions SET expires_at=now()-interval '1 minute'")
    assert client.get("/api/metrics").status_code == 401
    for _ in range(15):
        assert (
            client.post(
                "/api/auth/login", json=dict(email="admin@example.test", password="bad")
            ).status_code
            == 401
        )
    assert (
        client.post(
            "/api/auth/login", json=dict(email="admin@example.test", password=PASSWORD)
        ).status_code
        == 429
    )


def test_transfer_fees_do_not_consume_held_money(client):
    aid, accounts = funded(client, "10")
    post(
        client,
        "third-party",
        dict(person_name="Proche", reason="Dépôt", amount=1000),
    )
    assert (
        client.post(
            "/api/transactions",
            json=dict(
                type="transfer",
                account_id=aid,
                to_account_id=accounts[1]["id"],
                amount=500,
                fee=11,
                category="Virement",
            ),
        ).status_code
        == 422
    )
    assert client.get("/api/metrics").json()["total_cash_in_hand"] == 1010


def test_decimal_amounts_and_request_limits(client):
    aid, _ = funded(client, "100.25")
    post(
        client,
        "transactions",
        dict(
            type="expense", account_id=aid, amount="0.10", fee="0.05", category="Test"
        ),
    )
    assert client.get("/api/metrics").json()["total_cash_in_hand"] == 100.1
    assert (
        client.post(
            "/api/transactions",
            content=b"x" * 65537,
            headers={"Content-Type": "application/json"},
        ).status_code
        == 413
    )


def test_delegated_purchase_and_account_edit(client):
    aid, _ = funded(client, "1000")
    fund = post(
        client,
        "third-party",
        dict(person_name="Proche", reason="Achat", amount=10000),
    )
    post(
        client,
        "third-party/spend",
        dict(
            fund_id=fund["id"],
            amount=2000,
            fee=100,
            description="Ciment pour le chantier",
        ),
    )
    metrics = client.get("/api/metrics").json()
    assert metrics["total_cash_in_hand"] == 8900
    assert metrics["third_party_held"] == 7900
    assert metrics["real_available_cash"] == 1000
    assert metrics["categories_distribution"] == []
    assert client.get("/api/third-party").json()[0]["spent_amount"] == 2100
    assert (
        client.patch(
            "/api/accounts/" + aid,
            json=dict(name="Banque personnelle", account_number="Référence privée"),
        ).status_code
        == 200
    )
    assert (
        client.get("/api/accounts/" + aid).json()["account"]["name"]
        == "Banque personnelle"
    )
    assert client.get("/api/accounts/" + aid).json()["account"]["balance"] == 1000


def test_archived_history_and_reactivation(client):
    register(client)
    aid = client.get("/api/accounts").json()[0]["id"]
    assert client.delete("/api/accounts/" + aid).status_code == 200
    assert all(a["id"] != aid for a in client.get("/api/accounts").json())
    archived = [
        a
        for a in client.get("/api/accounts?include_archived=true").json()
        if not a["is_active"]
    ]
    assert len(archived) == 1 and archived[0]["id"] == aid
    assert client.get("/api/accounts/" + aid).status_code == 200
    assert client.post("/api/accounts/" + aid + "/restore", json={}).status_code == 200
    assert len(client.get("/api/accounts").json()) == 4


def test_malformed_resource_ids_are_not_server_errors(client):
    register(client)
    for invalid in [123, {}, [], None]:
        response = client.post(
            "/api/transactions",
            json=dict(type="income", account_id=invalid, amount=10, category="Test"),
        )
        assert response.status_code == 404
