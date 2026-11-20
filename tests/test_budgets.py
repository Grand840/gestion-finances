"""Forecasts are not money; explicit validation is one atomic owner-scoped expense."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from decimal import Decimal
from io import BytesIO
from pathlib import Path

from psycopg.errors import RaiseException
from pypdf import PdfReader
import pytest

import database as store
from seals import verify_snapshot
from test_family import funded, member, post, register
from test_documents import signature_image


def payload():
    return dict(
        title="Travaux maison",
        purpose="Préparer les dépenses de rénovation",
        project="Maison",
        beneficiary="Famille",
        budget_date="2026-10-30",
        start_date="2026-11-01",
        end_date="2026-12-31",
        due_date="2026-12-20",
        notes="Conserver les devis.",
        fees="5.00",
        items=[
            dict(
                label="Peinture",
                category="Matériaux",
                reason="Repeindre le salon",
                beneficiary="Fournisseur",
                quantity="2.50",
                unit_price="10.00",
                due_date="2026-11-15",
            ),
            dict(
                label="Main d’œuvre",
                category="Service",
                reason="Préparation des murs",
                quantity="1",
                unit_price="20.00",
            ),
        ],
    )


def detail(client, bid):
    response = client.get("/api/budgets/" + bid)
    assert response.status_code == 200, response.text
    return response.json()


def make(client, data=None):
    return post(client, "budgets", data or payload())["id"]


def validate(client, bid, aid, **extra):
    budget = detail(client, bid)
    return dict(
        revision=budget["revision"],
        account_id=aid,
        confirmation=budget["reference"],
        payment_date=date.today().isoformat(),
        **extra,
    )


def balance(client, aid):
    return Decimal(str(client.get("/api/accounts/" + aid).json()["account"]["balance"]))


def test_prepare_edit_cancel_duplicate_and_export_never_touch_money(client):
    aid, _ = funded(client, 1000)
    before = client.get("/api/transactions").json()
    bid = make(client)
    b = detail(client, bid)
    assert b["status"] == "draft" and b["total"] == 50
    assert b["account_id"] is None and b["transaction_id"] is None
    assert b["items"][0]["amount"] == "25.00"
    update = payload()
    update.update(title="Travaux révisés", revision=1, fees=10)
    post(client, f"budgets/{bid}/update", update)
    b = detail(client, bid)
    assert b["revision"] == 2 and b["total"] == 55
    duplicate = post(client, f"budgets/{bid}/duplicate", {})
    copied = detail(client, duplicate["id"])
    assert copied["status"] == "draft" and copied["items"] == b["items"]
    assert copied["reference"] != b["reference"] and copied["revision"] == 1
    post(client, f"budgets/{bid}/cancel", dict(revision=2, confirmation=b["reference"]))
    assert detail(client, bid)["status"] == "cancelled"
    assert balance(client, aid) == 1000
    assert client.get("/api/transactions").json() == before
    assert len(client.get("/api/export").json()["budgets"]) == 2
    assert client.get("/api/budgets?status=cancelled").json()["total"] == 1
    assert client.get("/api/budgets?q=révisés&limit=1").json()["total"] == 2
    assert client.get("/api/budgets?limit=1&offset=1").json()["items"][0]["id"] == bid


def test_validation_debits_total_once_with_fee_and_signed_final_document(client):
    aid, _ = funded(client, 1000)
    assert (
        client.put("/api/profile/signature", content=signature_image()).status_code
        == 200
    )
    bid = make(client)
    data = validate(client, bid, aid)
    result = post(client, f"budgets/{bid}/validate", data, key="one-budget-debit")
    assert balance(client, aid) == 950
    assert (
        post(client, f"budgets/{bid}/validate", data, key="one-budget-debit") == result
    )
    assert balance(client, aid) == 950
    assert client.post(f"/api/budgets/{bid}/validate", json=data).status_code == 409
    b = detail(client, bid)
    assert b["status"] == "validated" and b["revision"] == 2
    tx = [
        t
        for t in client.get("/api/transactions").json()
        if t["id"] == b["transaction_id"]
    ][0]
    assert tx["amount"] == 45 and tx["fee"] == 5 and tx["type"] == "expense"
    assert b["reference"] in tx["description"]
    did = result["document"]["id"]
    snapshot = client.get(f"/api/documents/{did}/proof").json()["snapshot"]
    assert snapshot["budget_status"] == "validated" and snapshot["signature_png"]
    assert verify_snapshot(snapshot)["signature_valid"]
    assert any(label == "Compte débité" for label, value in snapshot["facts"])
    reader = PdfReader(BytesIO(client.get(f"/api/documents/{did}/pdf").content))
    text = "\n".join(page.extract_text() for page in reader.pages)
    assert "Budget validé" in text and "BUDGET VALIDÉ" in text
    assert "Scellé Ed25519" in text and "Peinture" in text and "Fournisseur" in text
    assert sum(len(page.images) for page in reader.pages) >= 2
    assert len(reader.pages) == 1
    client.delete("/api/profile/signature")
    assert client.get(f"/api/documents/{did}/proof").json()["snapshot"] == snapshot
    # Validated budgets may only be duplicated, not edited/cancelled/re-debited.
    for action in ["update", "cancel", "validate"]:
        assert client.post(f"/api/budgets/{bid}/{action}", json=data).status_code == 409
    new = post(client, f"budgets/{bid}/duplicate", {})["id"]
    assert detail(client, new)["status"] == "draft"
    assert balance(client, aid) == 950
    with store.connect() as db:
        with pytest.raises(RaiseException):
            with db.transaction():
                db.execute("UPDATE budgets SET title='tampered' WHERE id=%s", [bid])


def test_validation_preconditions_and_stale_revision_do_not_debit(client):
    aid, accounts = funded(client, 25)
    bid = make(client)
    data = validate(client, bid, aid)
    assert client.post(f"/api/budgets/{bid}/validate", json=data).status_code == 422
    post(
        client,
        "transactions",
        dict(type="income", account_id=aid, amount=100, category="Test"),
    )
    for changed in [
        dict(confirmation="oui"),
        dict(revision=0),
        dict(revision=True),
        dict(revision="1"),
        dict(account_id=store.identifier()),
        dict(payment_date=(date.today() + timedelta(days=1)).isoformat()),
    ]:
        attempted = {**data, **changed}
        assert client.post(
            f"/api/budgets/{bid}/validate", json=attempted
        ).status_code in (409, 422, 404)
        assert balance(client, aid) == 125
    # Another tab changed the total after opening the validation dialogue.
    updated = payload()
    updated.update(revision=1, fees=10)
    post(client, f"budgets/{bid}/update", updated)
    assert client.post(f"/api/budgets/{bid}/validate", json=data).status_code == 409
    archived = accounts[1]
    assert client.delete("/api/accounts/" + archived["id"]).status_code == 200
    assert (
        client.post(
            f"/api/budgets/{bid}/validate",
            json={**data, "revision": 2, "account_id": archived["id"]},
        ).status_code
        == 404
    )
    post(client, "third-party", dict(person_name="Ami", amount=1000, reason="Mission"))
    dedicated = client.get("/api/people").json()[0]["account_id"]
    assert (
        client.post(
            f"/api/budgets/{bid}/validate",
            json={**data, "revision": 2, "account_id": dedicated},
        ).status_code
        == 422
    )
    borrowed = post(
        client,
        "loans/borrowed",
        dict(lender_name="Prêteur", title="Fonds dédiés", amount=1000),
    )
    loan = next(
        l for l in client.get("/api/loans/borrowed").json() if l["id"] == borrowed["id"]
    )
    assert (
        client.post(
            f"/api/budgets/{bid}/validate",
            json={**data, "revision": 2, "account_id": loan["account_id"]},
        ).status_code
        == 422
    )
    assert balance(client, aid) == 125
    assert detail(client, bid)["status"] == "draft"


def test_concurrent_validation_with_different_keys_is_a_single_expense(client):
    aid, _ = funded(client, 1000)
    bid = make(client)
    data = validate(client, bid, aid)
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(
            pool.map(
                lambda _: client.post(
                    f"/api/budgets/{bid}/validate", json=data
                ).status_code,
                range(2),
            )
        )
    assert sorted(statuses) == [200, 409]
    assert balance(client, aid) == 950
    with store.connect() as db:
        assert (
            store.one(
                db, "SELECT count(*) n FROM transactions WHERE category='Budget validé'"
            )["n"]
            == 1
        )
        assert (
            store.one(db, "SELECT count(*) n FROM documents WHERE kind='budget'")["n"]
            == 1
        )


def test_failure_of_document_sealing_rolls_back_budget_and_debit(client, monkeypatch):
    aid, _ = funded(client, 100)
    bid = make(client)
    import documents
    from fastapi import HTTPException

    def fail(*args):
        raise HTTPException(503, "Simulated signing failure")

    monkeypatch.setattr(documents, "issue", fail)
    assert (
        client.post(
            f"/api/budgets/{bid}/validate", json=validate(client, bid, aid)
        ).status_code
        == 503
    )
    assert balance(client, aid) == 100
    assert detail(client, bid)["status"] == "draft"
    assert len(client.get("/api/transactions").json()) == 1


def test_budget_isolation_including_admin_cannot_access_member_budget(client):
    admin = member(client)
    member_account = client.get("/api/accounts").json()[0]["id"]
    member_bid = make(client)
    assert client.get("/api/budgets").json()["total"] == 1
    client.cookies.clear()
    client.cookies.set("sillage_session", admin["cookie"])
    client.headers["X-CSRF-Token"] = admin["csrf"]
    assert client.get("/api/budgets").json()["items"] == []
    assert client.get("/api/budgets/" + member_bid).status_code == 404
    for action in ["update", "validate", "duplicate", "cancel"]:
        assert (
            client.post(f"/api/budgets/{member_bid}/{action}", json={}).status_code
            == 404
        )
    assert (
        client.post(
            "/api/documents", json=dict(kind="budget", resource_id=member_bid)
        ).status_code
        == 404
    )
    assert client.get("/api/export").json()["budgets"] == []
    admin_bid = make(client)
    assert (
        client.post(
            f"/api/budgets/{admin_bid}/validate",
            json=validate(client, admin_bid, member_account),
        ).status_code
        == 404
    )


@pytest.mark.parametrize(
    "changes",
    [
        dict(items=[]),
        dict(items=[{}]),
        dict(items="not-lines"),
        dict(start_date="2026-12-01", end_date="2026-11-01"),
        dict(due_date="bad"),
        dict(fees=-1),
        dict(items=[dict(label="x", quantity="NaN", unit_price=1)]),
        dict(items=[dict(label="x", quantity=0, unit_price=1)]),
        dict(items=[dict(label="x", quantity="1.001", unit_price=1)]),
        dict(items=[dict(label="x", quantity=1000001, unit_price=1)]),
        dict(items=[dict(label="x", quantity=1, unit_price=0)]),
        dict(items=[dict(label="x", quantity=1, unit_price="Infinity")]),
        dict(items=[dict(label="x", quantity=1000000, unit_price="999999999999.99")]),
        dict(items=[dict(label="x", quantity=1, unit_price=1)] * 51),
    ],
)
def test_invalid_budget_input_is_rejected_atomically(client, changes):
    aid, _ = funded(client, 100)
    data = payload()
    data.update(changes)
    response = client.post("/api/budgets", json=data)
    assert response.status_code == 422, response.text
    assert client.get("/api/budgets").json()["total"] == 0
    assert balance(client, aid) == 100


def test_exact_rounding_no_forged_totals_and_currency_lock_without_transactions(client):
    register(client)
    data = payload()
    data.update(
        fees=0,
        subtotal=999,
        total=999,
        account_id="ignored",
        status="validated",
        items=[
            dict(label="Fraction", quantity="0.01", unit_price="0.50", amount="9999")
        ]
        * 3,
    )
    bid = make(client, data)
    b = detail(client, bid)
    assert b["total"] == 0.03 and b["status"] == "draft" and b["account_id"] is None
    assert [i["amount"] for i in b["items"]] == ["0.01"] * 3
    assert (
        client.post(
            "/api/settings", json=dict(user_name="Alex", main_currency="EUR")
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/budgets", json=payload(), headers={"X-CSRF-Token": ""}
        ).status_code
        == 403
    )
    assert client.get("/api/budgets?status=bad").status_code == 422
    assert client.get("/api/budgets?limit=100000").status_code == 422
    assert client.get("/api/budgets/not-an-id").status_code == 404


def test_draft_pdf_and_long_budget_keep_frozen_versions_and_every_line(client):
    aid, _ = funded(client, 100)
    bid = make(client)
    doc = post(client, "documents", dict(kind="budget", resource_id=bid))
    snapshot = client.get(f'/api/documents/{doc["id"]}/proof').json()["snapshot"]
    assert (
        snapshot["budget_status"] == "draft"
        and verify_snapshot(snapshot)["signature_valid"]
    )
    assert snapshot["stamp"] == "PRÉVISIONNEL"
    updated = payload()
    updated["revision"] = 1
    updated["items"] = [
        dict(
            label=f"Ligne {i+1}",
            reason=f"Motif détaillé {i+1}",
            quantity=1,
            unit_price=1,
            due_date="2026-12-01",
        )
        for i in range(50)
    ]
    post(client, f"budgets/{bid}/update", updated)
    long_doc = post(client, "documents", dict(kind="budget", resource_id=bid))
    reader = PdfReader(
        BytesIO(client.get(f'/api/documents/{long_doc["id"]}/pdf').content)
    )
    assert len(reader.pages) > 1
    text = "\n".join(p.extract_text() for p in reader.pages)
    assert "Motif détaillé 50" in text and "Aucun débit" in text
    for page in reader.pages:
        assert long_doc["reference"] in page.extract_text()
    assert (
        client.get(f'/api/documents/{doc["id"]}/proof').json()["snapshot"] == snapshot
    )
    assert balance(client, aid) == 100
    assert len(detail(client, bid)["documents"]) == 2


def test_upgrade_from_22_preserves_financial_data_and_document_proofs(client):
    # Reproduce a populated 2.2 schema; apply only the new additive migration.
    from psycopg.rows import dict_row
    from psycopg import connect
    import os
    import documents

    with connect(os.environ["DATABASE_URL"], row_factory=dict_row) as db:
        db.execute("CREATE SCHEMA budget_upgrade_test")
        db.execute("SET LOCAL search_path TO budget_upgrade_test")
        for name in [
            "001_family.sql",
            "002_recovery.sql",
            "003_documents_wallets.sql",
            "004_document_seals.sql",
        ]:
            db.execute(Path("migrations", name).read_text(), prepare=False)
        uid, aid = store.identifier(), store.identifier()
        db.execute(
            "INSERT INTO users(id,email,name,password_hash) VALUES (%s,'upgrade@example.test','Upgrade test','unused')",
            [uid],
        )
        db.execute(
            "INSERT INTO accounts(id,user_id,name,type,currency,balance) VALUES (%s,%s,'Compte préexistant','cash','FCFA',100)",
            [aid, uid],
        )
        store.transaction(
            db, uid, aid, "income", Decimal(100), "Historique avant mise à jour"
        )
        user = store.one(db, "SELECT * FROM users WHERE id=%s", [uid])
        db.execute(
            "UPDATE users SET signature_png=%s WHERE id=%s", [signature_image(), uid]
        )
        loan = store.create_loan(
            db,
            user,
            dict(
                borrower_name="Ancien dossier",
                title="Prêt préexistant",
                amount=10,
                from_account_id=aid,
            ),
            "given",
        )
        store.repay(
            db, user, dict(loan_id=loan["id"], amount=5, to_account_id=aid), "given"
        )
        receipt = store.one(db, "SELECT snapshot FROM receipts")["snapshot"]
        snapshot = documents.issue(db, user, "account", aid)
        before = store.rows(db, "SELECT * FROM accounts")
        transactions = store.rows(db, "SELECT * FROM transactions")
        key = store.one(db, "SELECT * FROM document_keys")
        db.execute(Path("migrations/005_budgets.sql").read_text(), prepare=False)
        assert store.rows(db, "SELECT * FROM accounts") == before
        assert store.rows(db, "SELECT * FROM transactions") == transactions
        assert store.one(db, "SELECT * FROM document_keys") == key
        assert store.one(db, "SELECT snapshot FROM documents")["snapshot"] == snapshot
        assert verify_snapshot(snapshot)["signature_valid"]
        assert store.one(db, "SELECT snapshot FROM receipts")["snapshot"] == receipt
        assert verify_snapshot(receipt)["signature_valid"]
        assert snapshot["signature_png"] and receipt["signature_png"]
        assert store.one(db, "SELECT count(*) n FROM budgets")["n"] == 0
        import budgets

        planned = budgets.create(db, user, payload())
        assert store.rows(db, "SELECT * FROM accounts") == before
        assert planned["id"]
        db.execute("SET LOCAL search_path TO public")
        db.execute("DROP SCHEMA budget_upgrade_test CASCADE")
