"""Disposable CI containers only: verify the runtime SQL role and restored data."""

import json
import os
import subprocess
from pathlib import Path
import sys
from uuid import uuid4

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from seals import verify_snapshot

EMAIL = "docker-ci@example.test"
PASSWORD = "Only-for-disposable-CI-2026!"
STATE = Path("test-results/docker-state.json")


def post(client, path, **data):
    result = client.post(
        "/api/" + path, json=data, headers={"Idempotency-Key": str(uuid4())}
    )
    assert result.status_code == 200, result.text
    return result.json()


def main():
    if os.environ.get("SILLAGE_CI_SMOKE") != "1" or os.environ.get("CI") != "true":
        raise SystemExit(
            "Réservé aux conteneurs éphémères CI, jamais à une installation personnelle."
        )
    with httpx.Client(base_url="http://127.0.0.1:8080", timeout=15) as client:
        if "--verify" in sys.argv:
            state = json.loads(STATE.read_text())
            client.cookies.set("sillage_session", state["session"])
            assert not client.get("/api/auth/status").json()["authenticated"]
            auth = post(client, "auth/login", email=EMAIL, password=PASSWORD)
            client.headers["X-CSRF-Token"] = auth["csrf_token"]
            assert client.get("/api/metrics").json()["real_available_cash"] == 925
            detail = client.get("/api/accounts/" + state["account"])
            assert (
                detail.status_code == 200 and detail.json()["account"]["balance"] == 925
            )
            receipt = client.get("/api/receipt/" + state["receipt"])
            assert receipt.status_code == 200
            pdf = client.get("/api/receipt/" + state["receipt"] + "/pdf")
            assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF-")
            assert client.get("/api/profile/signature").status_code == 200
            assert client.get(
                "/api/documents/" + state["document"] + "/pdf"
            ).content.startswith(b"%PDF-")
            assert client.get("/api/people").json()[0]["balance"] == 500
            validated = client.get("/api/budgets/" + state["budget"]).json()
            assert validated["status"] == "validated" and validated["total"] == 25
            assert (
                client.get("/api/budgets/" + state["forecast"]).json()["status"]
                == "draft"
            )
            snapshot = client.get(
                "/api/documents/" + state["budget_document"] + "/proof"
            ).json()["snapshot"]
            assert verify_snapshot(snapshot, state["key_fingerprint"])[
                "signature_valid"
            ]
            assert (
                client.post(
                    "/api/budgets/" + state["budget"] + "/validate",
                    json=dict(
                        revision=validated["revision"],
                        confirmation=validated["reference"],
                        account_id=state["account"],
                    ),
                ).status_code
                == 409
            )
            assert client.get("/api/metrics").json()["real_available_cash"] == 925
            for kind, identifier in [
                ("receipt", state["receipt"]),
                ("documents", state["document"]),
            ]:
                snapshot = client.get(f"/api/{kind}/{identifier}/proof").json()[
                    "snapshot"
                ]
                result = verify_snapshot(snapshot, state["key_fingerprint"])
                assert result["signature_valid"] and result["trusted_key_match"]
            assert (
                client.get("/api/profile/document-key").json()["key_fingerprint"]
                == state["key_fingerprint"]
            )
            print(
                "OK — données, signature, comptes dédiés et PDF préservés après restauration ; ancienne session révoquée."
            )
            return
        env = dict(
            line.split("=", 1)
            for line in Path(".env").read_text().splitlines()
            if line and not line.startswith("#")
        )
        assert client.get("/api/auth/status").json()["bootstrap_required"]
        auth = post(
            client,
            "auth/register",
            email=EMAIL,
            name="Compte CI éphémère",
            password=PASSWORD,
            code=env["SETUP_TOKEN"],
        )
        client.headers["X-CSRF-Token"] = auth["csrf_token"]
        assert client.get("/api/profile/signature-source").json()["available"]
        aid = client.get("/api/accounts").json()[0]["id"]
        post(
            client,
            "transactions",
            type="income",
            amount=1000,
            account_id=aid,
            category="Test CI",
        )
        loan = post(
            client,
            "loans/given",
            borrower_name="Destinataire fictif CI",
            title="Prêt de test",
            amount=100,
            from_account_id=aid,
        )
        payment = post(
            client,
            "loans/given/receive",
            loan_id=loan["id"],
            amount=50,
            to_account_id=aid,
            notes="Versement CI",
        )
        rid = payment["receipt"]["id"]
        pdf = client.get("/api/receipt/" + rid + "/pdf")
        assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF-")
        image = subprocess.check_output([sys.executable, "tests/signature-fixture.py"])
        assert (
            client.put(
                "/api/profile/signature",
                content=image,
                headers={"Content-Type": "image/png"},
            ).status_code
            == 200
        )
        post(
            client,
            "third-party",
            person_name="Personne fictive Docker",
            reason="Dépôt de test",
            amount=500,
        )
        borrowed = post(
            client,
            "loans/borrowed",
            lender_name="Prêteur fictif Docker",
            title="Crédit CI",
            amount=100,
        )
        post(
            client,
            "loans/borrowed/repay",
            loan_id=borrowed["id"],
            amount=10,
            notes="Acompte CI",
        )
        document = post(client, "documents", kind="loan", resource_id=borrowed["id"])
        assert client.get(
            "/api/documents/" + document["id"] + "/pdf"
        ).content.startswith(b"%PDF-")
        draft = post(
            client,
            "budgets",
            title="Projet Docker",
            purpose="Préparation sans débit",
            fees=5,
            items=[dict(label="Achat CI", quantity=2, unit_price=10)],
        )
        assert client.get("/api/metrics").json()["real_available_cash"] == 950
        forecast = post(
            client,
            "budgets",
            title="Prévision conservée",
            purpose="Ne pas débiter",
            items=[dict(label="Futur achat", quantity=1, unit_price=50)],
        )
        budget = client.get("/api/budgets/" + draft["id"]).json()
        approved = post(
            client,
            "budgets/" + draft["id"] + "/validate",
            revision=budget["revision"],
            confirmation=budget["reference"],
            account_id=aid,
        )
        assert client.get("/api/metrics").json()["real_available_cash"] == 925
        assert verify_snapshot(
            client.get(
                "/api/documents/" + approved["document"]["id"] + "/proof"
            ).json()["snapshot"]
        )["signature_valid"]
        invitation = post(client, "admin/invitations")["code"]
        post(client, "admin/invitations")
        with httpx.Client(base_url=client.base_url, timeout=15) as member:
            auth_member = post(
                member,
                "auth/register",
                email="docker-member@example.test",
                name="Membre CI éphémère",
                password=PASSWORD,
                code=invitation,
            )
            assert member.get("/api/accounts/" + aid).status_code == 404
            assert member.get("/api/receipt/" + rid + "/pdf").status_code == 404
            post(client, "admin/users/" + auth_member["user"]["id"] + "/recovery")
        STATE.parent.mkdir(exist_ok=True)
        STATE.write_text(
            json.dumps(
                dict(
                    account=aid,
                    receipt=rid,
                    document=document["id"],
                    budget=draft["id"],
                    forecast=forecast["id"],
                    budget_document=approved["document"]["id"],
                    session=client.cookies.get("sillage_session"),
                    key_fingerprint=client.get("/api/profile/document-key").json()[
                        "key_fingerprint"
                    ],
                )
            )
        )
        STATE.chmod(0o600)
        print(
            "OK — écritures avec le rôle SQL applicatif, prêts, reçus PDF et isolation dans Docker."
        )


if __name__ == "__main__":
    main()
