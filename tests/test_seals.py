"""Document identity, isolated keys and offline tamper detection on real PostgreSQL."""

import base64
from copy import deepcopy
from io import BytesIO
import json
import subprocess
import sys

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from PIL import Image
from pypdf import PdfReader

import database as db
from seals import canonical, data_hash, key_fingerprint, verify_snapshot
from test_family import funded, member, post, register
from test_documents import signature_image


def report(client, aid):
    return post(client, "documents", dict(kind="account", resource_id=aid))


def fetch_proof(client, document):
    response = client.get(f'/api/documents/{document["id"]}/proof')
    assert response.status_code == 200
    assert "no-store" in response.headers["cache-control"]
    assert response.headers["content-disposition"].endswith('-preuve.json"')
    return response.json()


def test_repository_signature_requires_admin_and_explicit_consent(client):
    assert client.get("/api/profile/signature-source").status_code == 401
    assert client.post(
        "/api/profile/signature-source", json={"consent": True}
    ).status_code in (401, 403)
    register(client, name="Younous Tchao")
    assert client.get("/api/profile/signature").status_code == 404
    assert client.get("/api/profile/signature-source").json()["available"]
    assert (
        client.post(
            "/api/profile/signature-source", json={"consent": False}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/profile/signature-source",
            json={"consent": True},
            headers={"X-CSRF-Token": ""},
        ).status_code
        == 403
    )
    post(client, "profile/signature-source", dict(consent=True))
    response = client.get("/api/profile/signature")
    image = Image.open(BytesIO(response.content))
    assert image.mode == "RGBA" and not image.info
    assert image.width <= 900 and image.height <= 300
    assert image.getchannel("A").getextrema() == (0, 255)
    assert image.getpixel((0, 0))[3] == 0
    assert "no-store" in response.headers["cache-control"]
    # The repository folder is never a static route.
    assert (
        not client.get("/signature/sign%20younous.jpg")
        .headers["content-type"]
        .startswith("image/")
    )
    code = post(client, "admin/invitations", {})["code"]
    client.cookies.clear()
    register(client, "other@example.test", code, "Autre membre")
    assert client.get("/api/profile/signature-source").status_code == 403
    assert (
        client.post("/api/profile/signature-source", json={"consent": True}).status_code
        == 403
    )
    assert client.get("/api/profile/signature").status_code == 404


def test_signature_normalization_rejects_blank_and_preserves_geometry(client):
    register(client)
    blank = BytesIO()
    Image.new("RGB", (300, 120), "white").save(blank, format="PNG")
    assert (
        client.put("/api/profile/signature", content=blank.getvalue()).status_code
        == 422
    )
    assert (
        client.put("/api/profile/signature", content=signature_image()).status_code
        == 200
    )
    image = Image.open(BytesIO(client.get("/api/profile/signature").content))
    assert image.getpixel((0, 0))[3] == 0
    assert not image.info


def test_reports_are_sealed_and_cannot_be_forged_by_updating_hash(client, tmp_path):
    aid, _ = funded(client, 100)
    assert client.get("/api/profile/document-key").json() == {"available": False}
    document = report(client, aid)
    evidence = fetch_proof(client, document)
    snapshot = evidence["snapshot"]
    status = verify_snapshot(snapshot)
    assert status["data_hash_valid"] and status["signature_valid"]
    key = client.get("/api/profile/document-key").json()
    assert key["key_fingerprint"] == status["key_fingerprint"]
    assert "private_key" not in json.dumps(evidence) + json.dumps(key)
    assert "private_key" not in client.get("/api/export").text
    assert (
        fetch_proof(client, report(client, aid))["snapshot"]["seal"]["key_id"]
        == snapshot["seal"]["key_id"]
    )
    with db.connect() as connection:
        assert db.one(connection, "SELECT count(*) n FROM document_keys")["n"] == 1
    changed = deepcopy(snapshot)
    changed["summary"][0][1] = "99999999.00"
    assert not verify_snapshot(changed)["signature_valid"]
    changed["document_hash"] = data_hash(changed)
    changed["seal"]["document_hash"] = changed["document_hash"]
    assert verify_snapshot(changed)["data_hash_valid"]
    assert not verify_snapshot(changed)["signature_valid"]
    changed = deepcopy(snapshot)
    changed["seal"]["issued_at"] = "1900-01-01T00:00:00+00:00"
    assert not verify_snapshot(changed)["signature_valid"]
    # Replacing the public key is detectable when a trusted fingerprint is pinned.
    replaced = deepcopy(snapshot)
    rogue = Ed25519PrivateKey.generate()
    seal = replaced["seal"]
    public = rogue.public_key().public_bytes_raw()
    seal["public_key"] = base64.b64encode(public).decode()
    seal["key_fingerprint"] = key_fingerprint(public)
    seal["signature"] = base64.b64encode(
        rogue.sign(canonical({k: v for k, v in seal.items() if k != "signature"}))
    ).decode()
    assert verify_snapshot(replaced)["signature_valid"]
    assert (
        verify_snapshot(replaced, key["key_fingerprint"])["trusted_key_match"] is False
    )
    proof_path = tmp_path / "proof.json"
    proof_path.write_text(json.dumps(evidence))
    command = [
        sys.executable,
        "scripts/verify_document.py",
        str(proof_path),
        "--trusted-key",
        key["key_fingerprint"],
    ]
    assert subprocess.run(command, capture_output=True).returncode == 0
    assert (
        subprocess.run(command[:-1] + ["0" * 64], capture_output=True).returncode == 1
    )
    evidence["snapshot"] = changed
    evidence["verification"]["signature_valid"] = True  # Never trust a stored status.
    proof_path.write_text(json.dumps(evidence))
    assert subprocess.run(command, capture_output=True).returncode == 1
    proof_path.write_text(
        '{"format":"sillage-data-proof-v1","scope":"frozen-data-not-pdf-bytes","snapshot":null}'
    )
    assert subprocess.run(command, capture_output=True).returncode == 1


def test_new_unsigned_receipt_stays_frozen_when_profile_is_later_configured(client):
    aid, _ = funded(client, 100)
    loan = post(
        client,
        "loans/given",
        dict(borrower_name="Partie test", title="Prêt", amount=50, from_account_id=aid),
    )
    receipt = post(
        client,
        "loans/given/receive",
        dict(loan_id=loan["id"], amount=10, to_account_id=aid),
    )["receipt"]
    assert (
        verify_snapshot(receipt)["signature_valid"] is False
    )  # API-only collection IDs are not part of the frozen data.
    url = f'/api/receipt/{receipt["id"]}'
    original = client.get(url + "/proof").json()["snapshot"]
    assert verify_snapshot(original)["signature_valid"]
    assert (
        client.put("/api/profile/signature", content=signature_image()).status_code
        == 200
    )
    current = client.get(url).json()["receipt"]
    assert current == original and not current["signature_png"]
    assert client.get(url + "/proof").json()["snapshot"] == original
    reader = PdfReader(BytesIO(client.get(url + "/pdf").content))
    assert len(reader.pages) == 1
    text = "\n".join(page.extract_text() for page in reader.pages)
    assert "Scellé Ed25519" in text
    assert "Exemplaire personnel" not in text
    assert "certification bancaire" not in text


def test_real_signature_is_frozen_in_receipt_and_reports_and_pdf_is_compact(client):
    aid, _ = funded(client, 100)
    post(client, "profile/signature-source", dict(consent=True))
    signature = base64.b64encode(client.get("/api/profile/signature").content).decode()
    loan = post(
        client,
        "loans/borrowed",
        dict(lender_name="Prêteur test", title="Emprunt test", amount=50),
    )
    receipt = post(client, "loans/borrowed/repay", dict(loan_id=loan["id"], amount=10))[
        "receipt"
    ]
    receipt_path = f'/api/receipt/{receipt["id"]}'
    original = client.get(receipt_path + "/proof").json()["snapshot"]
    assert (
        original["signature_png"] == signature
        and verify_snapshot(original)["signature_valid"]
    )
    frozen = []
    post(
        client,
        "third-party",
        dict(person_name="Tiers test", reason="Mission", amount=50),
    )
    person = client.get("/api/people").json()[0]
    for kind, resource in [
        ("loan", loan["id"]),
        ("account", aid),
        ("person", person["id"]),
    ]:
        document = post(client, "documents", dict(kind=kind, resource_id=resource))
        evidence = fetch_proof(client, document)
        assert evidence["snapshot"]["signature_png"] == signature
        assert verify_snapshot(evidence["snapshot"])["signature_valid"]
        reader = PdfReader(
            BytesIO(client.get(f'/api/documents/{document["id"]}/pdf').content)
        )
        assert len(reader.pages) == 1
        assert sum(len(page.images) for page in reader.pages) >= 2
        frozen.append((document, evidence))
    reader = PdfReader(BytesIO(client.get(receipt_path + "/pdf").content))
    assert (
        len(reader.pages) == 1 and sum(len(page.images) for page in reader.pages) >= 2
    )
    client.delete("/api/profile/signature")
    assert client.get(receipt_path + "/proof").json()["snapshot"] == original
    for document, evidence in frozen:
        assert fetch_proof(client, document) == evidence


def test_keys_and_proofs_are_isolated_between_members(client):
    admin = member(client)
    member_accounts = client.get("/api/accounts").json()
    member_doc = report(client, member_accounts[0]["id"])
    member_proof = fetch_proof(client, member_doc)
    member_key = member_proof["snapshot"]["seal"]["key_fingerprint"]
    member_cookie = client.cookies.get("sillage_session")
    member_csrf = client.headers["X-CSRF-Token"]
    client.cookies.clear()
    client.cookies.set("sillage_session", admin["cookie"])
    client.headers["X-CSRF-Token"] = admin["csrf"]
    admin_doc = report(client, admin["accounts"][0]["id"])
    admin_proof = fetch_proof(client, admin_doc)
    assert admin_proof["snapshot"]["seal"]["key_fingerprint"] != member_key
    assert client.get(f'/api/documents/{member_doc["id"]}/proof').status_code == 404
    aid = admin["accounts"][0]["id"]
    post(
        client,
        "transactions",
        dict(type="income", amount=100, account_id=aid, category="Test"),
    )
    loan = post(
        client,
        "loans/given",
        dict(borrower_name="Test", title="Test", amount=50, from_account_id=aid),
    )
    receipt = post(
        client,
        "loans/given/receive",
        dict(loan_id=loan["id"], amount=10, to_account_id=aid),
    )["receipt"]
    client.cookies.clear()
    client.cookies.set("sillage_session", member_cookie)
    client.headers["X-CSRF-Token"] = member_csrf
    assert client.get(f'/api/documents/{admin_doc["id"]}/proof').status_code == 404
    assert client.get(f'/api/receipt/{receipt["id"]}/proof').status_code == 404
    assert (
        client.get("/api/profile/document-key").json()["key_fingerprint"] == member_key
    )


def test_historic_receipts_are_not_resealed_or_rewritten(client):
    aid, _ = funded(client, 100)
    loan = post(
        client,
        "loans/given",
        dict(
            borrower_name="Test",
            title="Prêt historique",
            amount=50,
            from_account_id=aid,
        ),
    )
    receipt = post(
        client,
        "loans/given/receive",
        dict(loan_id=loan["id"], amount=10, to_account_id=aid),
    )["receipt"]
    # Reproduce a pre-2.2 snapshot in a disposable test DB only.
    from psycopg.types.json import Jsonb

    with db.connect() as connection:
        row = db.one(
            connection, "SELECT snapshot FROM receipts WHERE id=%s", [receipt["id"]]
        )
        original = row["snapshot"]
        original.pop("seal")
        # The existing immutability trigger is intentionally disabled only in this test transaction.
        connection.execute("ALTER TABLE receipts DISABLE TRIGGER USER")
        connection.execute(
            "UPDATE receipts SET snapshot=%s WHERE id=%s",
            [Jsonb(original), receipt["id"]],
        )
        connection.execute("ALTER TABLE receipts ENABLE TRIGGER USER")
    client.put("/api/profile/signature", content=signature_image())
    path = f'/api/receipt/{receipt["id"]}'
    reissued = client.get(path).json()["receipt"]
    assert reissued["signature_reissued"] and reissued["signature_png"]
    evidence = client.get(path + "/proof").json()
    assert evidence["snapshot"] == original
    assert evidence["verification"]["data_hash_valid"]
    assert not evidence["verification"]["seal_present"]
    text = "\n".join(
        page.extract_text()
        for page in PdfReader(BytesIO(client.get(path + "/pdf").content)).pages
    )
    assert "Réédition" in text and "Scellé Ed25519" not in text
