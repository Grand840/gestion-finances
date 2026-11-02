"""Dedicated wallets, deletions, signature privacy and frozen statements."""

from io import BytesIO
from pathlib import Path
import base64
import json
from decimal import Decimal

from fastapi import HTTPException
from PIL import Image, ImageDraw
import pytest
from psycopg.errors import RaiseException
from test_family import funded, post, member
import database as db


def signature_image():
    image = Image.new("RGBA", (400, 120), "white")
    draw = ImageDraw.Draw(image)
    draw.line(
        [(15, 75), (60, 30), (75, 90), (160, 45), (220, 70), (380, 60)],
        fill="navy",
        width=3,
    )
    stream = BytesIO()
    image.save(stream, format="PNG")
    return stream.getvalue()


def test_account_delete_confirmation_and_guards(client):
    aid, accounts = funded(client, 1000)
    empty_account = accounts[1]
    endpoint = "/api/accounts/" + empty_account["id"] + "/delete"
    assert client.post(endpoint, json={"confirmation": "wrong"}).status_code == 422
    assert (
        client.post(endpoint, json={"confirmation": empty_account["name"]}).status_code
        == 200
    )
    assert client.get("/api/accounts/" + empty_account["id"]).status_code == 404
    name = accounts[0]["name"]
    assert (
        client.post(
            "/api/accounts/" + aid + "/delete", json={"confirmation": name}
        ).status_code
        == 409
    )
    # Even at zero, an account with history must be archived rather than deleted.
    post(
        client,
        "transactions",
        dict(type="expense", account_id=aid, amount=1000, category="Test"),
    )
    assert (
        client.post(
            "/api/accounts/" + aid + "/delete", json={"confirmation": name}
        ).status_code
        == 409
    )
    assert client.delete("/api/accounts/" + aid).status_code == 200


def test_third_party_person_wallet_and_trace(client):
    aid, _ = funded(client, 1000)
    f1 = post(
        client,
        "third-party",
        dict(person_name="Ama", phone="123", reason="Chantier", amount=10000),
    )
    person = client.get("/api/people").json()[0]
    wallet = person["account_id"]
    f2 = post(
        client,
        "third-party",
        dict(person_id=person["id"], reason="Courses", amount=2000),
    )
    assert len(client.get("/api/people").json()) == 1
    assert client.get("/api/accounts/" + aid).json()["account"]["balance"] == 1000
    assert client.get("/api/accounts/" + wallet).json()["account"]["balance"] == 12000
    for kind in ["income", "expense", "transfer"]:
        assert (
            client.post(
                "/api/transactions",
                json=dict(
                    type=kind,
                    amount=10,
                    account_id=wallet,
                    to_account_id=aid,
                    category="Interdit",
                ),
            ).status_code
            == 422
        )
    assert (
        client.post(
            "/api/third-party/spend",
            json=dict(fund_id=f1["id"], account_id=aid, amount=20, description="Wrong"),
        ).status_code
        == 422
    )
    post(
        client,
        "third-party/spend",
        dict(fund_id=f1["id"], amount=2000, fee=100, description="Ciment et livraison"),
    )
    post(
        client,
        "third-party/refund",
        dict(fund_id=f2["id"], amount=500, notes="Restitution en espèces"),
    )
    report = client.get("/api/people/" + person["id"]).json()
    assert report["summary"][-1] == ["Reliquat", "9400.00"]
    assert "Ciment et livraison" in json.dumps(report, ensure_ascii=False)
    assert "Restitution en espèces" in json.dumps(report, ensure_ascii=False)
    assert report["sections"][1]["rows"][-1][-1] == "9400.00"
    assert client.get("/api/accounts/" + wallet).json()["account"]["balance"] == 9400
    assert client.get("/api/metrics").json()["real_available_cash"] == 1000
    assert client.delete("/api/accounts/" + wallet).status_code == 422
    assert (
        client.patch("/api/accounts/" + wallet, json={"name": "Spoof"}).status_code
        == 422
    )


def test_borrowed_cash_provision_spending_and_reports(client):
    aid, _ = funded(client, 1000)
    assert (
        client.post(
            "/api/loans/borrowed",
            json=dict(lender_name="Banque", title="Test", amount=500, account_id=aid),
        ).status_code
        == 422
    )
    loan = post(
        client,
        "loans/borrowed",
        dict(
            lender_name="Banque",
            title="Travaux",
            amount=500,
            due_date="2026-12-31",
            notes="Motif complet",
        ),
    )
    wallet = client.get("/api/loans/borrowed").json()[0]["account_id"]
    assert client.get("/api/accounts/" + wallet).json()["account"]["balance"] == 500
    post(
        client,
        "loans/cash",
        dict(
            loan_id=loan["id"],
            mode="spend",
            amount=300,
            fee=10,
            description="Achat matériel",
        ),
    )
    assert (
        client.post(
            "/api/loans/borrowed/repay",
            json=dict(loan_id=loan["id"], account_id=aid, amount=100),
        ).status_code
        == 422
    )
    receipt = post(
        client,
        "loans/borrowed/repay",
        dict(loan_id=loan["id"], amount=100, notes="Acompte espèces"),
    )["receipt"]
    assert receipt["account_name"].startswith("Emprunt · ")
    post(
        client,
        "loans/cash",
        dict(
            loan_id=loan["id"],
            mode="fund",
            source_account_id=aid,
            amount=100,
            description="Provision personnelle",
        ),
    )
    report = post(client, "documents", dict(kind="loan", resource_id=loan["id"]))
    pdf = client.get("/api/documents/" + report["id"] + "/pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF-")
    with db.connect() as connection:
        snapshot = db.one(
            connection, "SELECT snapshot FROM documents WHERE id=%s", [report["id"]]
        )["snapshot"]
    assert snapshot["summary"][-1] == ["Reste dû", "400.00"]
    assert snapshot["sections"][0]["rows"][0][-1].find("Acompte espèces") >= 0
    assert len(snapshot["sections"][1]["rows"]) == 3
    assert client.get("/api/accounts/" + aid).json()["account"]["balance"] == 900
    assert client.get("/api/accounts/" + wallet).json()["account"]["balance"] == 190


def test_signature_is_private_and_frozen_in_documents(client):
    aid, _ = funded(client, 1000)
    image = signature_image()
    assert (
        client.put("/api/profile/signature", content=b"<svg>evil</svg>").status_code
        == 422
    )
    assert (
        client.put("/api/profile/signature", content=b"x" * 524289).status_code == 413
    )
    assert (
        client.put(
            "/api/profile/signature",
            content=image,
            headers={"Content-Type": "image/png"},
        ).status_code
        == 200
    )
    assert (
        client.get("/api/profile/signature").headers["cache-control"]
        == "no-store, private"
    )
    loan = post(
        client,
        "loans/given",
        dict(borrower_name="Ama", title="Prêt", amount=100, from_account_id=aid),
    )
    receipt = post(
        client,
        "loans/given/receive",
        dict(loan_id=loan["id"], to_account_id=aid, amount=20, notes="Acompte signé"),
    )["receipt"]
    assert base64.b64decode(receipt["signature_png"]).startswith(b"\x89PNG")
    report = post(client, "documents", dict(kind="loan", resource_id=loan["id"]))
    first_pdf = client.get("/api/documents/" + report["id"] + "/pdf").content
    assert client.delete("/api/profile/signature").status_code == 200
    assert client.get("/api/profile/signature").status_code == 404
    assert (
        client.get("/api/receipt/" + receipt["id"]).json()["receipt"]["signature_png"]
        == receipt["signature_png"]
    )
    with db.connect() as connection:
        snap = db.one(
            connection, "SELECT snapshot FROM documents WHERE id=%s", [report["id"]]
        )["snapshot"]
    assert snap["signature_png"] == receipt["signature_png"]
    post(
        client,
        "loans/given/receive",
        dict(loan_id=loan["id"], to_account_id=aid, amount=10),
    )
    assert snap["summary"][-1] == ["Reste dû", "80.00"]
    with pytest.raises(RaiseException):
        with db.connect() as connection:
            connection.execute(
                "UPDATE documents SET kind=kind WHERE id=%s", [report["id"]]
            )
    assert client.get("/api/documents/" + report["id"] + "/pdf").status_code == 200


def test_document_and_person_ownership(client):
    admin = member(client)
    member_id = client.get("/api/accounts").json()[0]["id"]
    assert (
        client.post(
            "/api/documents",
            json=dict(kind="account", resource_id=admin["accounts"][0]["id"]),
        ).status_code
        == 404
    )
    own = post(client, "documents", dict(kind="account", resource_id=member_id))
    client.cookies.clear()
    client.cookies.set("sillage_session", admin["cookie"])
    client.headers["X-CSRF-Token"] = admin["csrf"]
    assert client.get("/api/documents/" + own["id"] + "/pdf").status_code == 404
    assert client.get("/api/documents").json() == []


def test_upgrade_preserves_existing_cash_and_history(client):
    with db.connect() as connection:
        connection.execute("CREATE SCHEMA upgrade_test")
        connection.execute("SET LOCAL search_path TO upgrade_test, public")
        for filename in ["001_family.sql", "002_recovery.sql"]:
            connection.execute(
                (Path("migrations") / filename).read_text(), prepare=False
            )
        uid, aid, lid, fid = (db.identifier() for _ in range(4))
        connection.execute(
            "INSERT INTO users(id,email,name,password_hash) VALUES (%s,'old@example.test','Avant mise à jour','dummy')",
            [uid],
        )
        connection.execute(
            "INSERT INTO accounts(id,user_id,name,type,currency,balance) VALUES (%s,%s,'Ancien compte','cash','FCFA',7000)",
            [aid, uid],
        )
        connection.execute(
            "INSERT INTO funds(id,user_id,person_name,reason,initial_amount,spent_amount,account_id,date_received) VALUES (%s,%s,'Ama','Ancien chantier',3000,1000,%s,CURRENT_DATE)",
            [fid, uid, aid],
        )
        connection.execute(
            "INSERT INTO loans(id,user_id,kind,contact_name,title,initial_amount,current_balance,account_id) VALUES (%s,%s,'borrowed','Banque','Ancien emprunt',1000,500,%s)",
            [lid, uid, aid],
        )
        original_receipt = {
            "id": db.identifier(),
            "receipt_no": "SL-OLD-TEST",
            "amount": "500.00",
            "remaining_balance_after": "500.00",
        }
        connection.execute(
            "INSERT INTO receipts(id,user_id,loan_id,account_id,receipt_no,installment_number,amount,remaining_balance_after,snapshot) VALUES (%s,%s,%s,%s,'SL-OLD-TEST',1,500,500,%s::jsonb)",
            [original_receipt["id"], uid, lid, aid, json.dumps(original_receipt)],
        )
        db.transaction(connection, uid, aid, "income", Decimal(4500), "Solde initial")
        db.transaction(
            connection, uid, aid, "income", Decimal(3000), "Fonds confiés", fund=fid
        )
        db.transaction(
            connection, uid, aid, "expense", Decimal(1000), "Achat pour tiers", fund=fid
        )
        db.transaction(
            connection, uid, aid, "income", Decimal(1000), "Emprunt reçu", loan=lid
        )
        db.transaction(
            connection,
            uid,
            aid,
            "expense",
            Decimal(500),
            "Remboursement emprunt",
            loan=lid,
        )
        connection.execute(
            Path("migrations/003_documents_wallets.sql").read_text(), prepare=False
        )
        assert db.one(connection, "SELECT sum(balance) n FROM accounts")["n"] == 7000
        assert (
            db.one(connection, "SELECT balance FROM accounts WHERE id=%s", [aid])[
                "balance"
            ]
            == 5000
        )
        assert (
            db.one(
                connection, "SELECT balance FROM accounts WHERE purpose='third_party'"
            )["balance"]
            == 2000
        )
        assert (
            db.one(connection, "SELECT balance FROM accounts WHERE purpose='borrowed'")[
                "balance"
            ]
            == 0
        )
        assert db.one(
            connection,
            "SELECT legacy_account_id,current_balance FROM loans WHERE id=%s",
            [lid],
        ) == dict(legacy_account_id=aid, current_balance=Decimal("500.00"))
        assert db.one(connection, "SELECT person_id FROM funds WHERE id=%s", [fid])[
            "person_id"
        ]
        assert db.one(connection, "SELECT count(*) n FROM transactions")["n"] == 6
        assert (
            db.one(
                connection,
                "SELECT snapshot FROM receipts WHERE id=%s",
                [original_receipt["id"]],
            )["snapshot"]
            == original_receipt
        )
        user = db.one(connection, "SELECT * FROM users WHERE id=%s", [uid])
        with pytest.raises(HTTPException) as error:
            # Use a savepoint: the expected HTTP validation must not undo the fixture.
            with connection.transaction():
                db.repay(connection, user, {"loan_id": lid, "amount": 500}, "borrowed")
        assert getattr(error.value, "status_code", None) == 422
        db.borrowed_cash(
            connection,
            user,
            {
                "loan_id": lid,
                "mode": "fund",
                "source_account_id": aid,
                "amount": 500,
                "description": "Provision après mise à jour",
            },
        )
        db.repay(
            connection,
            user,
            {"loan_id": lid, "amount": 500, "notes": "Solde après reclassement"},
            "borrowed",
        )
        assert (
            db.one(connection, "SELECT current_balance FROM loans WHERE id=%s", [lid])[
                "current_balance"
            ]
            == 0
        )
        assert (
            db.one(
                connection,
                "SELECT snapshot FROM receipts WHERE id=%s",
                [original_receipt["id"]],
            )["snapshot"]
            == original_receipt
        )
        connection.execute("SET LOCAL search_path TO public")
        connection.execute("DROP SCHEMA upgrade_test CASCADE")


def test_long_report_is_paginated_with_every_installment(client):
    from pypdf import PdfReader

    aid, _ = funded(client, 1000)
    loan = post(
        client,
        "loans/given",
        dict(
            borrower_name="Personne de test",
            title="Engagement à plusieurs acomptes",
            amount=100,
            from_account_id=aid,
            notes="Motif complet du prêt",
        ),
    )
    for i in range(35):
        post(
            client,
            "loans/given/receive",
            dict(
                loan_id=loan["id"],
                to_account_id=aid,
                amount=1,
                notes=f"Motif de versement détaillé numéro {i+1}",
            ),
        )
    report = post(client, "documents", dict(kind="loan", resource_id=loan["id"]))
    reader = PdfReader(
        BytesIO(client.get("/api/documents/" + report["id"] + "/pdf").content)
    )
    assert len(reader.pages) > 1
    text = "\n".join(page.extract_text() for page in reader.pages)
    assert "Motif de versement détaillé numéro 1" in text
    assert "Motif de versement détaillé numéro 35" in text
    assert "65,00 FCFA" in text
    assert "RAPPORT D’ENGAGEMENT" in text
    assert "NON OFFICIEL" in text
    for page in reader.pages:
        assert report["reference"] in page.extract_text()


def test_signature_metadata_is_removed_and_report_contains_image(client):
    from PIL.PngImagePlugin import PngInfo
    from pypdf import PdfReader

    aid, _ = funded(client, 100)
    raw = Image.open(BytesIO(signature_image()))
    info = PngInfo()
    info.add_text("PrivateMetadata", "Do not publish this")
    out = BytesIO()
    raw.save(out, format="PNG", pnginfo=info)
    assert (
        client.put("/api/profile/signature", content=out.getvalue()).status_code == 200
    )
    normalized = Image.open(BytesIO(client.get("/api/profile/signature").content))
    assert not normalized.info
    report = post(client, "documents", dict(kind="account", resource_id=aid))
    reader = PdfReader(
        BytesIO(client.get("/api/documents/" + report["id"] + "/pdf").content)
    )
    assert len(reader.pages) == 1
    assert (
        sum(len(page.images) for page in reader.pages) >= 2
    )  # Brand logo + actual profile image.


def test_dedicated_resources_cannot_be_accessed_by_another_member(client):
    admin = member(client)
    cookie = client.cookies.get("sillage_session")
    csrf = client.headers["X-CSRF-Token"]
    client.cookies.clear()
    client.cookies.set("sillage_session", admin["cookie"])
    client.headers["X-CSRF-Token"] = admin["csrf"]
    post(
        client,
        "third-party",
        dict(person_name="Propriétaire privé", reason="Chantier privé", amount=300),
    )
    person = client.get("/api/people").json()[0]
    client.put("/api/profile/signature", content=signature_image())
    client.cookies.clear()
    client.cookies.set("sillage_session", cookie)
    client.headers["X-CSRF-Token"] = csrf
    assert client.get("/api/people").json() == []
    assert client.get("/api/people/" + person["id"]).status_code == 404
    assert client.get("/api/profile/signature").status_code == 404
    assert (
        client.post(
            "/api/third-party",
            json=dict(person_id=person["id"], reason="Interdit", amount=10),
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/api/documents", json=dict(kind="person", resource_id=person["id"])
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/api/accounts/" + person["account_id"] + "/delete",
            json=dict(confirmation="Tiers · Propriétaire privé"),
        ).status_code
        == 404
    )


def test_new_homonyms_are_not_merged_and_deposits_are_idempotent(client):
    funded(client, 100)
    values = dict(person_name="Même nom", phone="", reason="Dépôt", amount=500)
    first = post(client, "third-party", values, key="depot-identique")
    assert post(client, "third-party", values, key="depot-identique") == first
    assert len(client.get("/api/people").json()) == 1
    post(client, "third-party", values)
    people = client.get("/api/people").json()
    assert len(people) == 2 and all(p["balance"] == 500 for p in people)
    post(
        client,
        "third-party",
        dict(person_id=people[0]["id"], reason="Complément", amount=100),
    )
    assert len(client.get("/api/people").json()) == 2
