"""Owner-scoped, point-in-time statements. Every generated report is immutable."""

import hashlib
import json
from datetime import datetime, timezone
from decimal import Decimal

import database as store


def freeze(db, user, kind, resource):
    uid = user["id"]
    now = datetime.now(timezone.utc)
    did = store.identifier()
    r = dict(
        id=did,
        kind=kind,
        issuer_name=user["name"],
        currency=user["currency"],
        date=now.date().isoformat(),
        issued_at=now.isoformat(),
        reference="SD-"
        + now.strftime("%Y%m%d")
        + "-"
        + did.replace("-", "")[:12].upper(),
        signature_png=store.signature(db, uid),
        notes="",
        facts=[],
        summary=[],
        sections=[],
    )
    if kind == "loan":
        loan = store.owned(db, "loans", uid, resource)
        receipts = [
            row["snapshot"]
            for row in store.rows(
                db,
                "SELECT snapshot FROM receipts WHERE user_id=%s AND loan_id=%s ORDER BY installment_number",
                [uid, resource],
            )
        ]
        r.update(
            title=(
                "Rapport d’emprunt" if loan["kind"] == "borrowed" else "Rapport de prêt"
            ),
            stamp="RAPPORT D’ENGAGEMENT",
            subject=loan["contact_name"],
            notes=loan["notes"],
        )
        r["facts"] = [
            ["Objet / motif", loan["title"]],
            ["Partie concernée", loan["contact_name"]],
            ["Ouverture", str(loan["created_at"].date())],
            ["Échéance", str(loan["due_date"] or "Non fixée")],
            ["État", "Soldé" if loan["status"] == "settled" else "En cours"],
            ["Référence dossier", resource],
        ]
        r["summary"] = [
            ["Montant initial", str(loan["initial_amount"])],
            ["Total remboursé", str(loan["initial_amount"] - loan["current_balance"])],
            ["Reste dû", str(loan["current_balance"])],
        ]
        r["sections"] = [
            dict(
                title="Historique exhaustif des acomptes",
                columns=[
                    "Date / n°",
                    "Versement",
                    "Reste dû",
                    "Compte / motif / référence",
                ],
                rows=[
                    [
                        p["date"] + " · n° " + str(p["installment_number"]),
                        p["amount"],
                        p["remaining_balance_after"],
                        p["account_name"]
                        + "\n"
                        + (p["notes"] or "Sans observation")
                        + "\n"
                        + p["receipt_no"],
                    ]
                    for p in receipts
                ],
                money_columns=[1, 2],
            )
        ]
        entries = store.rows(
            db,
            "SELECT * FROM transactions WHERE user_id=%s AND related_loan_id=%s AND category IN ('Emprunt reçu','Prêt accordé','Utilisation emprunt','Provision remboursement') ORDER BY date,created_at,id",
            [uid, resource],
        )
        r["sections"].append(
            dict(
                title="Mise à disposition et utilisation des fonds (hors acomptes)",
                columns=["Date", "Opération / motif", "Montant", "Frais"],
                rows=[
                    [
                        str(t["date"]),
                        t["category"] + "\n" + t["description"],
                        str(t["amount"]),
                        str(t["fee"]),
                    ]
                    for t in entries
                ],
                money_columns=[2, 3],
            )
        )
        if loan["legacy_account_id"]:
            r[
                "notes"
            ] += "\nDossier antérieur aux comptes dédiés : les fonds historiques n’ont pas été encaissés une seconde fois. Alimenter le compte dédié avant de rembourser si nécessaire."
    elif kind == "person":
        person = store.owned(db, "people", uid, resource)
        funds = store.rows(
            db,
            "SELECT * FROM funds WHERE user_id=%s AND person_id=%s ORDER BY date_received,created_at,id",
            [uid, resource],
        )
        initial = sum((f["initial_amount"] for f in funds), Decimal(0))
        spent = sum((f["spent_amount"] for f in funds), Decimal(0))
        returned = sum((f["returned_amount"] for f in funds), Decimal(0))
        r.update(
            title="Relevé des fonds confiés",
            stamp="RELEVÉ DE FONDS TIERS",
            subject=person["name"],
        )
        r["facts"] = [
            ["Titulaire des fonds", person["name"]],
            ["Téléphone", person["phone"] or "Non renseigné"],
            ["Compte dédié", person["account_id"]],
            ["Périmètre", "Tous les dépôts · historique intégral"],
        ]
        r["summary"] = [
            ["Total confié", str(initial)],
            ["Achats et frais", str(spent)],
            ["Restitué", str(returned)],
            ["Reliquat", str(initial - spent - returned)],
        ]
        r["sections"] = [
            dict(
                title="Dépôts / motifs",
                columns=["Date", "Objet du dépôt", "Confié", "Reliquat"],
                rows=[
                    [
                        str(f["date_received"]),
                        f["reason"],
                        str(f["initial_amount"]),
                        str(
                            f["initial_amount"]
                            - f["spent_amount"]
                            - f["returned_amount"]
                        ),
                    ]
                    for f in funds
                ],
                money_columns=[2, 3],
            )
        ]
        entries = store.rows(
            db,
            "SELECT t.* FROM transactions t JOIN funds f ON f.id=t.third_party_fund_id AND f.user_id=t.user_id WHERE t.user_id=%s AND f.person_id=%s ORDER BY t.date,t.created_at,t.id",
            [uid, resource],
        )
        balance = Decimal(0)
        rows = []
        for t in entries:
            delta = t["amount"] if t["type"] == "income" else -t["amount"] - t["fee"]
            balance += delta
            rows.append(
                [
                    str(t["date"]),
                    t["category"] + "\n" + t["description"] + "\nRéf. " + t["id"],
                    str(delta),
                    str(t["fee"]),
                    str(balance),
                ]
            )
        r["sections"].append(
            dict(
                title="Traçabilité des mouvements — frais inclus dans les sorties",
                columns=[
                    "Date",
                    "Nature / motif / référence",
                    "Mouvement",
                    "Frais inclus",
                    "Solde",
                ],
                rows=rows,
                money_columns=[2, 3, 4],
            )
        )
    elif kind == "account":
        account = store.owned(db, "accounts", uid, resource)
        entries = store.rows(
            db,
            "SELECT * FROM transactions WHERE user_id=%s AND (account_id=%s OR to_account_id=%s) ORDER BY date,created_at,id",
            [uid, resource, resource],
        )
        r.update(
            title="Relevé de compte", stamp="RELEVÉ DE COMPTE", subject=account["name"]
        )
        r["facts"] = [
            ["Compte", account["name"]],
            ["Numéro", account["account_number"] or "Non renseigné"],
            ["Référence", resource],
            ["Statut", "Actif" if account["is_active"] else "Archivé"],
        ]
        r["summary"] = [["Solde à l’émission", str(account["balance"])]]
        running = Decimal(0)
        rows = []
        for t in entries:
            incoming = t["to_account_id"] == resource or t["type"] == "income"
            delta = t["amount"] if incoming else -t["amount"] - t["fee"]
            running += delta
            rows.append(
                [
                    str(t["date"]),
                    t["category"] + "\n" + t["description"] + "\nRéf. " + t["id"],
                    str(delta),
                    str(0 if incoming else t["fee"]),
                    str(running),
                ]
            )
        r["sections"] = [
            dict(
                title="Historique intégral — frais inclus dans les sorties",
                columns=[
                    "Date",
                    "Motif / référence",
                    "Mouvement",
                    "Frais inclus",
                    "Solde",
                ],
                rows=rows,
                money_columns=[2, 3, 4],
            )
        ]
    else:
        from fastapi import HTTPException

        raise HTTPException(422, "Type de document inconnu.")
    r["document_hash"] = hashlib.sha256(
        json.dumps(r, ensure_ascii=False, sort_keys=True).encode()
    ).hexdigest()
    return r
