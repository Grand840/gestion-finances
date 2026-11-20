"""Private forecasting and explicit, atomic whole-budget expenditure.

Handlers run under the owner's lock and idempotency transaction in server.mutate.
No account is linked or reserved while a budget is being prepared.
"""

from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException
from psycopg.types.json import Jsonb

import database as store

STATUS = {
    "draft": "Prévisionnel — non débité",
    "validated": "Validé et débité",
    "cancelled": "Annulé — sans débit",
}


def values(data):
    title = store.text(data.get("title"), 160)
    purpose = store.text(data.get("purpose"), 1000)
    optional = {
        key: store.text(data.get(key, ""), limit, False)
        for key, limit in [("project", 160), ("beneficiary", 160), ("notes", 2000)]
    }
    dates = {
        key: store.day(data[key]) if data.get(key) else None
        for key in ("start_date", "end_date", "due_date")
    }
    dates["budget_date"] = store.day(data.get("budget_date"))
    if (
        dates["start_date"]
        and dates["end_date"]
        and dates["end_date"] < dates["start_date"]
    ):
        raise HTTPException(422, "La fin de période doit suivre le début.")
    raw = data.get("items")
    if not isinstance(raw, list) or not 1 <= len(raw) <= 50:
        raise HTTPException(422, "Prévoyez entre 1 et 50 lignes budgétaires.")
    items = []
    subtotal = Decimal(0)
    for line in raw:
        if not isinstance(line, dict):
            raise HTTPException(422, "Ligne budgétaire invalide.")
        quantity = store.money(line.get("quantity"))
        price = store.money(line.get("unit_price"), True)
        if quantity > 1000000:
            raise HTTPException(422, "Quantité limitée à un million par ligne.")
        amount = store.money(
            (quantity * price).quantize(Decimal(".01"), rounding=ROUND_HALF_UP), True
        )
        item = dict(
            label=store.text(line.get("label"), 160),
            category=store.text(line.get("category", "Divers"), 80),
            reason=store.text(line.get("reason", ""), 400, False),
            beneficiary=store.text(line.get("beneficiary", ""), 160, False),
            due_date=str(store.day(line["due_date"])) if line.get("due_date") else "",
            quantity=str(quantity),
            unit_price=str(price),
            amount=str(amount),
        )
        items.append(item)
        subtotal += amount
    subtotal = store.money(subtotal)
    fees = store.money(data.get("fees", 0), True)
    total = store.money(subtotal + fees)
    return dict(
        title=title,
        purpose=purpose,
        **optional,
        **dates,
        items=items,
        subtotal=subtotal,
        fees=fees,
        total=total
    )


def editable(db, user, bid, data):
    budget = store.owned(db, "budgets", user["id"], bid)
    if budget["status"] != "draft":
        raise HTTPException(
            409, "Ce budget est clos. Dupliquez-le pour préparer une nouvelle version."
        )
    revision = data.get("revision")
    if type(revision) is not int or revision != budget["revision"]:
        raise HTTPException(
            409, "Budget modifié entre-temps : rechargez-le avant de confirmer."
        )
    if budget["currency"] != user["currency"]:
        raise HTTPException(
            409, "La devise du budget ne correspond plus à votre espace."
        )
    return budget


def create(db, user, data):
    v = values(data)
    bid = store.identifier()
    reference = (
        "BP-"
        + date.today().strftime("%Y%m%d")
        + "-"
        + bid.replace("-", "")[:12].upper()
    )
    keys = list(v)
    db.execute(
        "INSERT INTO budgets(id,user_id,reference,currency,"
        + ",".join(keys)
        + ") VALUES ("
        + ",".join(["%s"] * (4 + len(keys)))
        + ")",
        [bid, user["id"], reference, user["currency"]]
        + [Jsonb(v[k]) if k == "items" else v[k] for k in keys],
    )
    return dict(success=True, id=bid, reference=reference)


def mutate(db, user, path, data):
    if path == "budgets":
        return create(db, user, data)
    parts = path.split("/")
    if len(parts) != 3:
        raise HTTPException(404, "Action budgétaire introuvable.")
    _, bid, action = parts
    if action not in ("update", "validate", "cancel", "duplicate"):
        raise HTTPException(404, "Action budgétaire introuvable.")
    if action == "duplicate":
        original = store.owned(db, "budgets", user["id"], bid)
        if original["currency"] != user["currency"]:
            raise HTTPException(
                409, "Conversion de devise nécessaire ; préparez un nouveau budget."
            )
        original["title"] = ("Copie — " + original["title"])[:160]
        for key in ("budget_date", "start_date", "end_date", "due_date"):
            original[key] = str(original[key]) if original[key] else None
        original["budget_date"] = date.today().isoformat()
        return create(db, user, original)
    budget = editable(db, user, bid, data)
    if action == "update":
        v = values(data)
        db.execute(
            "UPDATE budgets SET "
            + ",".join(k + "=%s" for k in v)
            + ",revision=revision+1,updated_at=now() WHERE id=%s AND user_id=%s",
            [Jsonb(v[k]) if k == "items" else v[k] for k in v] + [bid, user["id"]],
        )
    elif action == "cancel":
        if data.get("confirmation") != budget["reference"]:
            raise HTTPException(422, "Confirmez la référence du budget à annuler.")
        db.execute(
            "UPDATE budgets SET status='cancelled',cancelled_at=now(),updated_at=now(),revision=revision+1 WHERE id=%s AND user_id=%s",
            [bid, user["id"]],
        )
    else:
        if data.get("confirmation") != budget["reference"]:
            raise HTTPException(
                422, "Recopiez la référence pour confirmer le débit réel."
            )
        payment_date = store.day(data.get("payment_date"))
        if payment_date > date.today():
            raise HTTPException(
                422,
                "Un débit réel ne peut pas être daté dans le futur. Gardez ce budget prévisionnel.",
            )
        aid = data.get("account_id")
        account = store.owned(db, "accounts", user["id"], aid, True)
        if account["currency"] != budget["currency"]:
            raise HTTPException(
                422, "Le compte doit avoir la même devise que le budget."
            )
        store.debit(db, user["id"], aid, budget["total"])
        tid = store.transaction(
            db,
            user["id"],
            aid,
            "expense",
            budget["subtotal"],
            "Budget validé",
            budget["reference"] + " · " + budget["title"] + "\n" + budget["purpose"],
            fee=budget["fees"],
            when=payment_date,
        )
        db.execute(
            "UPDATE budgets SET status='validated',account_id=%s,transaction_id=%s,payment_date=%s,validated_at=now(),updated_at=now(),revision=revision+1 WHERE id=%s AND user_id=%s",
            [aid, tid, payment_date, bid, user["id"]],
        )
        # Final, signed document in the same transaction: failure rolls back money too.
        from documents import issue

        snapshot = issue(db, user, "budget", bid)
        return dict(
            success=True,
            id=bid,
            document=dict(id=snapshot["id"], reference=snapshot["reference"]),
            transaction_id=tid,
        )
    return dict(success=True, id=bid)


def fill_document(db, user, bid, r):
    b = store.owned(db, "budgets", user["id"], bid)
    r.update(
        title=(
            "Budget validé — avis de débit"
            if b["status"] == "validated"
            else "Budget prévisionnel" if b["status"] == "draft" else "Budget annulé"
        ),
        subject=b["title"],
        stamp=(
            "BUDGET VALIDÉ"
            if b["status"] == "validated"
            else "PRÉVISIONNEL" if b["status"] == "draft" else "BUDGET ANNULÉ"
        ),
        currency=b["currency"],
        notes=b["notes"],
        budget_id=b["id"],
        budget_revision=b["revision"],
        budget_status=b["status"],
    )
    r["facts"] = [
        ["Référence budget", b["reference"]],
        ["État", STATUS[b["status"]]],
        ["Date de préparation", str(b["budget_date"])],
        ["Révision", str(b["revision"])],
        ["Projet", b["project"] or "Non précisé"],
        ["Bénéficiaire", b["beneficiary"] or "Non précisé"],
        ["Début", str(b["start_date"] or "Non fixé")],
        ["Fin", str(b["end_date"] or "Non fixée")],
        ["Échéance générale", str(b["due_date"] or "Non fixée")],
        ["Motif", b["purpose"]],
    ]
    if b["status"] == "validated":
        account = store.owned(db, "accounts", user["id"], b["account_id"])
        r["facts"] += [
            ["Compte débité", account["name"]],
            ["Date du débit", str(b["payment_date"])],
            ["Validé le (UTC)", b["validated_at"].strftime("%d/%m/%Y à %H:%M:%S")],
            ["Écriture", b["transaction_id"]],
        ]
    else:
        r["facts"] += [
            ["Incidence sur les comptes", "Aucun débit ni réservation de fonds"]
        ]
    r["summary"] = [
        ["Dépenses prévues", str(b["subtotal"])],
        ["Frais", str(b["fees"])],
        [
            "Total débité" if b["status"] == "validated" else "Total prévisionnel",
            str(b["total"]),
        ],
    ]
    r["sections"] = [
        dict(
            title="Détail des lignes budgétaires",
            columns=[
                "Échéance",
                "Libellé / motif / bénéficiaire",
                "Quantité",
                "Prix unitaire",
                "Montant",
            ],
            widths=[0.13, 0.39, 0.12, 0.17, 0.19],
            money_columns=[3, 4],
            rows=[
                [
                    i["due_date"] or "Non fixée",
                    i["label"]
                    + "\n"
                    + i["category"]
                    + ("\n" + i["reason"] if i["reason"] else "")
                    + (
                        "\nBénéficiaire : " + i["beneficiary"]
                        if i["beneficiary"]
                        else ""
                    ),
                    i["quantity"].replace(".", ","),
                    i["unit_price"],
                    i["amount"],
                ]
                for i in b["items"]
            ],
        )
    ]
