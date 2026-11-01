"""Sillage family server: cookie sessions, PostgreSQL and isolated financial spaces."""

import hashlib
import hmac
import json
import logging
import os
import re
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHashError
from fastapi import FastAPI, Request, Response, HTTPException, Depends
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from psycopg.errors import IntegrityError
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, ConfigDict

import database as store
from receipts import build_pdf

ROOT = Path(__file__).parent
PASSWORDS = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
DUMMY_HASH = PASSWORDS.hash(secrets.token_urlsafe(24))
COOKIE = "sillage_session"
SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
SESSION_HOURS = int(os.getenv("SESSION_HOURS", "24"))


@asynccontextmanager
async def lifespan(app):
    store.init_db()
    with store.connect() as db:
        if (
            not store.one(db, "SELECT id FROM users LIMIT 1")
            and len(os.getenv("SETUP_TOKEN", "")) < 16
        ):
            raise RuntimeError(
                "Définissez un SETUP_TOKEN aléatoire de 16 caractères minimum pour créer le premier administrateur."
            )
    yield
    store.pool.close()


app = FastAPI(
    title="Sillage",
    version="2.0.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.middleware("http")
async def security(request, call_next):
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        origin = request.headers.get("origin")
        if origin and (
            urlparse(origin).netloc != request.headers.get("host")
            or urlparse(origin).scheme != request.url.scheme
        ):
            return JSONResponse({"error": "Origine de la requête refusée."}, 403)
        try:
            if int(request.headers.get("content-length", "0")) > 65536:
                return JSONResponse({"error": "Requête trop volumineuse."}, 413)
        except ValueError:
            return JSONResponse({"error": "Requête invalide."}, 400)
        chunks, size = [], 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > 65536:
                return JSONResponse({"error": "Requête trop volumineuse."}, 413)
            chunks.append(chunk)
        request._body = b"".join(chunks)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'"
    )
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, private"
    return response


@app.exception_handler(HTTPException)
async def http_error(request, exc):
    return JSONResponse({"error": exc.detail}, exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    return JSONResponse(
        {"error": "Formulaire invalide. Vérifiez les champs et leur longueur."}, 422
    )


@app.exception_handler(IntegrityError)
async def integrity_error(request, exc):
    logging.warning(
        "Database constraint prevented an invalid write (%s)", type(exc).__name__
    )
    return JSONResponse(
        {"error": "Cette opération entre en conflit avec les données existantes."}, 409
    )


class Form(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Login(Form):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class Register(Login):
    name: str = Field(min_length=2, max_length=80)
    code: str = Field(min_length=1, max_length=160)


class PasswordChange(Form):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


class MemberStatus(Form):
    active: bool


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def email_address(value):
    value = value.strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
        raise HTTPException(422, "Adresse e-mail invalide.")
    return value


def password_valid(value):
    if not 12 <= len(value) <= 128 or not value.strip():
        raise HTTPException(422, "Utilisez un mot de passe de 12 à 128 caractères.")
    return value


def verify(encoded, password):
    try:
        return PASSWORDS.verify(encoded, password)
    except (VerificationError, InvalidHashError):
        return False


def user_view(user):
    return {
        key: user[key]
        for key in (
            "id",
            "name",
            "email",
            "role",
            "active",
            "currency",
            "created_at",
            "last_login",
        )
    }


def consume_attempt(key, limit):
    with store.connect() as db:
        db.execute(
            "DELETE FROM auth_attempts WHERE window_start<now()-interval '1 day'"
        )
        row = store.one(
            db,
            """INSERT INTO auth_attempts(key,failures) VALUES (%s,1) ON CONFLICT(key) DO UPDATE
        SET failures=CASE WHEN auth_attempts.window_start<now()-interval '15 minutes' THEN 1 ELSE auth_attempts.failures+1 END,
        window_start=CASE WHEN auth_attempts.window_start<now()-interval '15 minutes' THEN now() ELSE auth_attempts.window_start END RETURNING failures""",
            [digest(key)],
        )
    if row["failures"] > limit:
        raise HTTPException(429, "Trop de tentatives. Réessayez dans 15 minutes.")


def new_session(db, user, response):
    token, csrf = secrets.token_urlsafe(48), secrets.token_urlsafe(32)
    db.execute("DELETE FROM sessions WHERE expires_at<now()")
    db.execute(
        "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES (%s,%s,%s,%s)",
        [
            digest(token),
            user["id"],
            csrf,
            datetime.now(timezone.utc) + timedelta(hours=SESSION_HOURS),
        ],
    )
    db.execute("UPDATE users SET last_login=now() WHERE id=%s", [user["id"]])
    response.set_cookie(
        COOKIE,
        token,
        max_age=SESSION_HOURS * 3600,
        httponly=True,
        secure=SECURE,
        samesite="lax",
        path="/",
    )
    return dict(authenticated=True, user=user_view(user), csrf_token=csrf)


def session_user(request):
    token = request.cookies.get(COOKIE, "")
    if not token or len(token) > 200:
        return None
    with store.connect() as db:
        return store.one(
            db,
            """SELECT u.*,s.csrf,s.token_hash,s.expires_at FROM users u JOIN sessions s ON s.user_id=u.id
                                 WHERE s.token_hash=%s AND s.expires_at>now() AND u.active""",
            [digest(token)],
        )


def current_user(request: Request):
    user = session_user(request)
    if not user:
        raise HTTPException(401, "Connectez-vous pour accéder à votre espace.")
    if request.method not in ("GET", "HEAD") and not hmac.compare_digest(
        user["csrf"].encode(), request.headers.get("x-csrf-token", "").encode()
    ):
        raise HTTPException(403, "Session de formulaire expirée. Actualisez la page.")
    return user


def admin(user=Depends(current_user)):
    if user["role"] != "admin":
        raise HTTPException(403, "Accès réservé à l’administrateur.")
    return user


@app.get("/api/health")
def health():
    with store.connect() as db:
        db.execute("SELECT 1")
    return dict(status="ok", database="postgresql")


@app.get("/api/auth/status")
def auth_status(request: Request):
    user = session_user(request)
    if user:
        return dict(
            authenticated=True,
            user=user_view(user),
            csrf_token=user["csrf"],
            expires_at=user["expires_at"],
        )
    with store.connect() as db:
        bootstrap = not bool(store.one(db, "SELECT id FROM users LIMIT 1"))
    return dict(
        authenticated=False, bootstrap_required=bootstrap, registration="invitation"
    )


@app.post("/api/auth/register")
def register(data: Register, request: Request, response: Response):
    consume_attempt("register:" + request.client.host, 15)
    email = email_address(data.email)
    encoded = PASSWORDS.hash(password_valid(data.password))
    with store.connect() as db:
        db.execute("SELECT pg_advisory_xact_lock(837402)")
        first = not store.one(db, "SELECT id FROM users LIMIT 1")
        if first:
            if not hmac.compare_digest(
                data.code.encode(), os.environ["SETUP_TOKEN"].encode()
            ):
                raise HTTPException(403, "Code de configuration incorrect.")
        else:
            invitation = store.one(
                db,
                "SELECT * FROM invitations WHERE token_hash=%s AND used_at IS NULL AND expires_at>now() FOR UPDATE",
                [digest(data.code)],
            )
            if not invitation:
                raise HTTPException(
                    403, "Invitation invalide, expirée ou déjà utilisée."
                )
            db.execute(
                "UPDATE invitations SET used_at=now() WHERE token_hash=%s",
                [digest(data.code)],
            )
        if store.one(db, "SELECT id FROM users WHERE email=%s", [email]):
            raise HTTPException(
                409, "Impossible de créer ce compte avec ces informations."
            )
        user = store.one(
            db,
            "INSERT INTO users(id,email,name,password_hash,role) VALUES (%s,%s,%s,%s,%s) RETURNING *",
            [
                store.identifier(),
                email,
                data.name,
                encoded,
                "admin" if first else "member",
            ],
        )
        store.create_defaults(db, user)
        store.audit(db, user["id"], "auth.register")
        return new_session(db, user, response)


@app.post("/api/auth/login")
def login(data: Login, request: Request, response: Response):
    email = email_address(data.email)
    consume_attempt("login-ip:" + request.client.host, 60)
    consume_attempt("login-email:" + email, 15)
    with store.connect() as db:
        user = store.one(db, "SELECT * FROM users WHERE email=%s FOR UPDATE", [email])
        valid = verify(user["password_hash"] if user else DUMMY_HASH, data.password)
        if not user or not valid or not user["active"]:
            raise HTTPException(
                401, "Adresse e-mail ou mot de passe incorrect, ou compte désactivé."
            )
        if PASSWORDS.check_needs_rehash(user["password_hash"]):
            db.execute(
                "UPDATE users SET password_hash=%s WHERE id=%s",
                [PASSWORDS.hash(data.password), user["id"]],
            )
        store.audit(db, user["id"], "auth.login")
        return new_session(db, user, response)


class Recovery(Login):
    code: str = Field(min_length=1, max_length=160)


@app.post("/api/auth/recover")
def recover(data: Recovery, request: Request):
    consume_attempt("recovery-ip:" + request.client.host, 20)
    email = email_address(data.email)
    consume_attempt("recovery-email:" + email, 10)
    with store.connect() as db:
        user = store.one(db, "SELECT * FROM users WHERE email=%s FOR UPDATE", [email])
        token = store.one(
            db,
            "SELECT * FROM password_resets WHERE token_hash=%s AND used_at IS NULL AND expires_at>now() FOR UPDATE",
            [digest(data.code)],
        )
        if (
            not user
            or not user["active"]
            or not token
            or token["user_id"] != user["id"]
        ):
            raise HTTPException(422, "Code de récupération ou informations invalides.")
        db.execute(
            "UPDATE users SET password_hash=%s WHERE id=%s",
            [PASSWORDS.hash(password_valid(data.password)), user["id"]],
        )
        db.execute(
            "UPDATE password_resets SET used_at=now() WHERE user_id=%s AND used_at IS NULL",
            [user["id"]],
        )
        db.execute("DELETE FROM sessions WHERE user_id=%s", [user["id"]])
        store.audit(db, user["id"], "auth.password_recovered")
    return dict(success=True)


def recovery_code(db, uid):
    code = secrets.token_urlsafe(32)
    db.execute(
        "UPDATE password_resets SET used_at=now() WHERE user_id=%s AND used_at IS NULL",
        [uid],
    )
    db.execute(
        "INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES (%s,%s,now()+interval '30 minutes')",
        [digest(code), uid],
    )
    return code


@app.post("/api/admin/users/{uid}/recovery")
def create_recovery(uid: str, user=Depends(admin)):
    with store.connect() as db:
        target = store.one(
            db,
            "SELECT id FROM users WHERE id=%s AND active AND role='member' FOR UPDATE",
            [uid],
        )
        if not target:
            raise HTTPException(404, "Membre actif introuvable.")
        code = recovery_code(db, uid)
        store.audit(db, user["id"], "admin.recovery_created", uid)
    return dict(code=code, expires_in_minutes=30)


@app.post("/api/admin/invitations/revoke")
def revoke_invitations(user=Depends(admin)):
    with store.connect() as db:
        db.execute("DELETE FROM invitations WHERE used_at IS NULL")
        store.audit(db, user["id"], "admin.invitations_revoked")
    return dict(success=True)


@app.post("/api/auth/logout")
def logout(response: Response, user=Depends(current_user)):
    with store.connect() as db:
        db.execute("DELETE FROM sessions WHERE token_hash=%s", [user["token_hash"]])
        store.audit(db, user["id"], "auth.logout")
    response.delete_cookie(
        COOKIE, path="/", secure=SECURE, httponly=True, samesite="lax"
    )
    return dict(success=True)


@app.post("/api/auth/password")
def change_password(
    data: PasswordChange, response: Response, user=Depends(current_user)
):
    consume_attempt("password:" + user["id"], 15)
    with store.connect() as db:
        latest = store.one(
            db, "SELECT * FROM users WHERE id=%s FOR UPDATE", [user["id"]]
        )
        if not latest["active"]:
            raise HTTPException(401, "Compte désactivé.")
        if not verify(latest["password_hash"], data.current_password):
            raise HTTPException(422, "Mot de passe actuel incorrect.")
        db.execute(
            "UPDATE users SET password_hash=%s WHERE id=%s",
            [PASSWORDS.hash(password_valid(data.new_password)), user["id"]],
        )
        db.execute("DELETE FROM sessions WHERE user_id=%s", [user["id"]])
        store.audit(db, user["id"], "auth.password_changed")
        return new_session(db, latest, response)


@app.get("/api/admin/users")
def members(user=Depends(admin)):
    with store.connect() as db:
        return [
            user_view(u)
            for u in store.rows(db, "SELECT * FROM users ORDER BY created_at")
        ]


@app.post("/api/admin/invitations")
def invite(user=Depends(admin)):
    token = secrets.token_urlsafe(24)
    with store.connect() as db:
        db.execute(
            "INSERT INTO invitations(token_hash,created_by,expires_at) VALUES (%s,%s,now()+interval '7 days')",
            [digest(token), user["id"]],
        )
        store.audit(db, user["id"], "admin.invitation_created")
    return dict(code=token, expires_in_days=7)


@app.post("/api/admin/users/{uid}/status")
def member_status(uid: str, data: MemberStatus, user=Depends(admin)):
    if uid == user["id"]:
        raise HTTPException(422, "Vous ne pouvez pas désactiver votre propre compte.")
    with store.connect() as db:
        target = store.one(
            db,
            "UPDATE users SET active=%s WHERE id=%s AND role='member' RETURNING id",
            [data.active, uid],
        )
        if not target:
            raise HTTPException(404, "Membre introuvable.")
        if not data.active:
            db.execute("DELETE FROM sessions WHERE user_id=%s", [uid])
        store.audit(
            db,
            user["id"],
            "admin.member_activated" if data.active else "admin.member_disabled",
            uid,
        )
    return dict(success=True)


@app.get("/api/metrics")
def metrics(user=Depends(current_user)):
    with store.connect() as db:
        return store.metrics(db, user)


@app.get("/api/accounts")
def accounts(include_archived: bool = False, user=Depends(current_user)):
    with store.connect() as db:
        return store.rows(
            db,
            "SELECT a.*,(SELECT count(*) FROM transactions t WHERE t.user_id=a.user_id AND (t.account_id=a.id OR t.to_account_id=a.id)) transaction_count FROM accounts a WHERE user_id=%s AND (is_active OR %s) ORDER BY type,name",
            [user["id"], include_archived],
        )


@app.get("/api/transactions")
def transactions(
    limit: int = 200,
    offset: int = 0,
    account_id: str | None = None,
    user=Depends(current_user),
):
    if not 1 <= limit <= 500 or not 0 <= offset <= 10000000:
        raise HTTPException(422, "Pagination invalide.")
    with store.connect() as db:
        return store.list_transactions(db, user["id"], limit, offset, account_id)


@app.get("/api/accounts/{aid}")
def account_detail(aid: str, user=Depends(current_user)):
    with store.connect() as db:
        account = store.owned(db, "accounts", user["id"], aid)
        summary = store.one(
            db,
            """SELECT count(*) count,
        COALESCE(sum(CASE WHEN type='income' OR to_account_id=%s THEN amount ELSE 0 END),0) income,
        COALESCE(sum(CASE WHEN account_id=%s AND type IN ('expense','transfer') THEN amount+fee ELSE 0 END),0) expense
        FROM transactions WHERE user_id=%s AND (account_id=%s OR to_account_id=%s)""",
            [aid, aid, user["id"], aid, aid],
        )
        return dict(account=account, summary=summary)


@app.get("/api/loans/{kind}")
def loans(kind: str, user=Depends(current_user)):
    if kind not in ("given", "borrowed"):
        raise HTTPException(404, "Rubrique introuvable.")
    with store.connect() as db:
        return store.list_loans(db, user["id"], kind)


@app.get("/api/receipt/{rid}")
def receipt(rid: str, user=Depends(current_user)):
    with store.connect() as db:
        return dict(
            success=True,
            receipt=store.owned(db, "receipts", user["id"], rid)["snapshot"],
        )


@app.get("/api/receipt/{rid}/pdf")
def receipt_pdf(rid: str, user=Depends(current_user)):
    with store.connect() as db:
        snapshot = store.owned(db, "receipts", user["id"], rid)["snapshot"]
    return Response(
        build_pdf(snapshot),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{snapshot["receipt_no"]}.pdf"'
        },
    )


@app.get("/api/third-party")
def funds(user=Depends(current_user)):
    with store.connect() as db:
        return store.rows(
            db,
            "SELECT f.*,a.name account_name,(initial_amount-spent_amount-returned_amount) remaining_amount FROM funds f JOIN accounts a ON a.id=f.account_id WHERE f.user_id=%s ORDER BY status,created_at DESC",
            [user["id"]],
        )


@app.get("/api/assets")
def assets(user=Depends(current_user)):
    with store.connect() as db:
        return store.rows(
            db,
            "SELECT * FROM assets WHERE user_id=%s ORDER BY category,name",
            [user["id"]],
        )


@app.get("/api/settings")
def settings(user=Depends(current_user)):
    return dict(user_name=user["name"], main_currency=user["currency"])


@app.get("/api/audit")
def audit(user=Depends(current_user)):
    with store.connect() as db:
        return store.rows(
            db,
            "SELECT action,resource_id,created_at FROM audit_events WHERE user_id=%s ORDER BY id DESC LIMIT 100",
            [user["id"]],
        )


@app.get("/api/export")
def export(user=Depends(current_user)):
    with store.connect() as db:
        result = {
            table: store.rows(
                db, f"SELECT * FROM {table} WHERE user_id=%s", [user["id"]]
            )
            for table in (
                "accounts",
                "transactions",
                "loans",
                "funds",
                "assets",
                "receipts",
            )
        }
        return dict(
            version=2,
            exported_at=datetime.now(timezone.utc),
            profile=user_view(user),
            **result,
        )


@app.post("/api/accounts/{aid}/restore")
def restore_account(aid: str, user=Depends(current_user)):
    with store.connect() as db:
        latest = store.one(
            db, "SELECT active FROM users WHERE id=%s FOR UPDATE", [user["id"]]
        )
        if not latest["active"]:
            raise HTTPException(401, "Compte désactivé.")
        store.owned(db, "accounts", user["id"], aid)
        db.execute(
            "UPDATE accounts SET is_active=true WHERE id=%s AND user_id=%s",
            [aid, user["id"]],
        )
        store.audit(db, user["id"], "accounts.restored", aid)
    return dict(success=True)


@app.post("/api/{path:path}")
def mutate(path: str, data: dict, request: Request, user=Depends(current_user)):
    handlers = {
        "accounts": store.create_account,
        "transactions": store.create_transaction,
        "loans/borrowed": lambda d, u, v: store.create_loan(d, u, v, "borrowed"),
        "loans/given": lambda d, u, v: store.create_loan(d, u, v, "given"),
        "loans/borrowed/repay": lambda d, u, v: store.repay(d, u, v, "borrowed"),
        "loans/given/receive": lambda d, u, v: store.repay(d, u, v, "given"),
        "third-party": store.create_fund,
        "third-party/refund": store.refund,
        "third-party/spend": store.spend_fund,
    }
    with store.connect() as db:
        # One lock per financial owner: atomic balances, repayments and duplicate prevention.
        latest = store.one(
            db, "SELECT * FROM users WHERE id=%s FOR UPDATE", [user["id"]]
        )
        if not latest["active"]:
            raise HTTPException(401, "Compte désactivé.")
        key = request.headers.get("idempotency-key")
        if key and len(key) > 100:
            raise HTTPException(422, "Clé d’opération invalide.")
        fingerprint = digest(path + json.dumps(data, sort_keys=True))
        if key:
            previous = store.one(
                db,
                "SELECT * FROM idempotency WHERE user_id=%s AND key=%s",
                [user["id"], key],
            )
            if previous:
                if previous["request_hash"] != fingerprint:
                    raise HTTPException(
                        409, "Clé déjà utilisée pour une autre opération."
                    )
                return previous["response"]
        if path in handlers:
            result = handlers[path](db, latest, data)
        elif path == "settings":
            name = store.text(data.get("user_name"), 80)
            currency = data.get("main_currency", latest["currency"])
            if currency not in ("FCFA", "EUR", "USD"):
                raise HTTPException(422, "Devise invalide.")
            if currency != latest["currency"]:
                if (
                    store.one(
                        db,
                        "SELECT id FROM transactions WHERE user_id=%s LIMIT 1",
                        [user["id"]],
                    )
                    or store.one(
                        db,
                        "SELECT id FROM loans WHERE user_id=%s LIMIT 1",
                        [user["id"]],
                    )
                    or store.one(
                        db,
                        "SELECT id FROM assets WHERE user_id=%s LIMIT 1",
                        [user["id"]],
                    )
                ):
                    raise HTTPException(
                        422,
                        "La devise est verrouillée après la première opération : aucune conversion automatique.",
                    )
                db.execute(
                    "UPDATE accounts SET currency=%s WHERE user_id=%s",
                    [currency, user["id"]],
                )
            db.execute(
                "UPDATE users SET name=%s,currency=%s WHERE id=%s",
                [name, currency, user["id"]],
            )
            result = dict(success=True)
        elif path == "assets":
            category = data.get("category")
            if category not in ("material", "real_estate", "investment", "inventory"):
                raise HTTPException(422, "Catégorie invalide.")
            aid = store.identifier()
            db.execute(
                "INSERT INTO assets(id,user_id,name,category,purchase_value,current_value,purchase_date,notes) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                [
                    aid,
                    user["id"],
                    store.text(data.get("name")),
                    category,
                    store.money(data.get("purchase_value"), True),
                    store.money(data.get("current_value"), True),
                    (
                        store.day(data["purchase_date"])
                        if data.get("purchase_date")
                        else None
                    ),
                    store.text(data.get("notes", ""), 1000, False),
                ],
            )
            result = dict(success=True, id=aid)
        else:
            raise HTTPException(404, "Fonction introuvable.")
        store.audit(
            db,
            user["id"],
            path,
            result.get("id") or data.get("loan_id") or data.get("fund_id"),
        )
        if key:
            db.execute(
                "INSERT INTO idempotency(user_id,key,request_hash,response) VALUES (%s,%s,%s,%s)",
                [user["id"], key, fingerprint, Jsonb(result)],
            )
        return result


@app.patch("/api/accounts/{aid}")
def update_account(aid: str, data: dict, user=Depends(current_user)):
    with store.connect() as db:
        latest = store.one(
            db, "SELECT active FROM users WHERE id=%s FOR UPDATE", [user["id"]]
        )
        if not latest["active"]:
            raise HTTPException(401, "Compte désactivé.")
        store.owned(db, "accounts", user["id"], aid, True)
        db.execute(
            "UPDATE accounts SET name=%s,account_number=%s WHERE id=%s AND user_id=%s",
            [
                store.text(data.get("name")),
                store.text(data.get("account_number", ""), required=False),
                aid,
                user["id"],
            ],
        )
        store.audit(db, user["id"], "accounts.updated", aid)
    return dict(success=True)


@app.delete("/api/assets/{aid}")
def delete_asset(aid: str, user=Depends(current_user)):
    with store.connect() as db:
        db.execute("SELECT id FROM users WHERE id=%s FOR UPDATE", [user["id"]])
        store.owned(db, "assets", user["id"], aid)
        db.execute("DELETE FROM assets WHERE id=%s AND user_id=%s", [aid, user["id"]])
        store.audit(db, user["id"], "assets.deleted", aid)
    return dict(success=True)


@app.delete("/api/accounts/{aid}")
def archive_account(aid: str, user=Depends(current_user)):
    with store.connect() as db:
        db.execute("SELECT id FROM users WHERE id=%s FOR UPDATE", [user["id"]])
        account = store.owned(db, "accounts", user["id"], aid, True)
        if account["balance"] != 0:
            raise HTTPException(422, "Transférez le solde avant d’archiver ce compte.")
        db.execute(
            "UPDATE accounts SET is_active=false WHERE id=%s AND user_id=%s",
            [aid, user["id"]],
        )
        store.audit(db, user["id"], "accounts.archived", aid)
    return dict(success=True)


app.mount("/css", StaticFiles(directory=ROOT / "public/css"), name="css")
app.mount("/js", StaticFiles(directory=ROOT / "public/js"), name="js")
app.mount("/icons", StaticFiles(directory=ROOT / "public/icons"), name="icons")


@app.get("/{path:path}")
def frontend(path: str):
    if path.startswith("api/"):
        raise HTTPException(404, "Route introuvable.")
    if path in ("sw.js", "manifest.json"):
        return FileResponse(
            ROOT / "public" / path, headers={"Cache-Control": "no-cache"}
        )
    return FileResponse(
        ROOT / "public/index.html", headers={"Cache-Control": "no-cache"}
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8080")),
        proxy_headers=True,
        forwarded_allow_ips=os.getenv("FORWARDED_ALLOW_IPS", "127.0.0.1"),
    )
