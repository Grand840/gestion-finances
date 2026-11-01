"""Disposable CI containers only: verify the runtime SQL role and restored data."""

import json
import os
from pathlib import Path
import sys
from uuid import uuid4

import httpx

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
            assert client.get("/api/metrics").json()["real_available_cash"] == 950
            detail = client.get("/api/accounts/" + state["account"])
            assert (
                detail.status_code == 200 and detail.json()["account"]["balance"] == 950
            )
            receipt = client.get("/api/receipt/" + state["receipt"])
            assert receipt.status_code == 200
            pdf = client.get("/api/receipt/" + state["receipt"] + "/pdf")
            assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF-")
            print(
                "OK — données, accès et reçus PDF préservés après restauration ; ancienne session révoquée."
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
                    session=client.cookies.get("sillage_session"),
                )
            )
        )
        STATE.chmod(0o600)
        print(
            "OK — écritures avec le rôle SQL applicatif, prêts, reçus PDF et isolation dans Docker."
        )


if __name__ == "__main__":
    main()
