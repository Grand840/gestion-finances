"""Application seals of frozen data, not PAdES or independently certified identities.

Private Ed25519 keys remain in PostgreSQL; proofs carry only public material.
The SHA-256 convention preserves compatibility with pre-seal snapshots.
"""

import base64
import hashlib
import json
from datetime import datetime, timezone
from uuid import uuid4

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

PAYLOAD_FIELDS = {
    "version",
    "algorithm",
    "key_id",
    "public_key",
    "key_fingerprint",
    "issuer_id",
    "issuer_name",
    "issued_at",
    "document_hash",
}


def data_hash(snapshot):
    data = {k: v for k, v in snapshot.items() if k not in ("seal", "document_hash")}
    return hashlib.sha256(
        json.dumps(data, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def canonical(payload):
    return json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def key_fingerprint(public_key):
    return hashlib.sha256(public_key).hexdigest()


def apply_seal(db, user, snapshot):
    """Call in the same transaction and owner lock as document issuance."""
    from database import one

    key = one(db, "SELECT * FROM document_keys WHERE user_id=%s", [user["id"]])
    if not key:
        generated = Ed25519PrivateKey.generate()
        db.execute(
            "INSERT INTO document_keys(id,user_id,private_key,public_key) VALUES (%s,%s,%s,%s) ON CONFLICT (user_id) DO NOTHING",
            [
                str(uuid4()),
                user["id"],
                generated.private_bytes_raw(),
                generated.public_key().public_bytes_raw(),
            ],
        )
        key = one(db, "SELECT * FROM document_keys WHERE user_id=%s", [user["id"]])
    if snapshot["document_hash"] != data_hash(snapshot):
        raise ValueError("Snapshot hash mismatch before sealing")
    payload = dict(
        version=1,
        algorithm="Ed25519",
        key_id=str(key["id"]),
        public_key=base64.b64encode(key["public_key"]).decode("ascii"),
        key_fingerprint=key_fingerprint(key["public_key"]),
        issuer_id=str(user["id"]),
        issuer_name=snapshot["issuer_name"],
        issued_at=datetime.now(timezone.utc).isoformat(),
        document_hash=snapshot["document_hash"],
    )
    signature = Ed25519PrivateKey.from_private_bytes(key["private_key"]).sign(
        canonical(payload)
    )
    snapshot["seal"] = dict(
        payload, signature=base64.b64encode(signature).decode("ascii")
    )
    return snapshot


def verify_snapshot(snapshot, trusted_fingerprint=None):
    """Never trusts a verification status supplied in an imported proof."""
    hashed = data_hash(snapshot)
    result = dict(
        data_hash_valid=hashed == snapshot.get("document_hash"),
        seal_present=bool(snapshot.get("seal")),
        signature_valid=False,
        key_fingerprint=None,
        trusted_key_match=None,
    )
    try:
        seal = snapshot["seal"]
        if set(seal) != PAYLOAD_FIELDS | {"signature"}:
            return result
        payload = {k: seal[k] for k in PAYLOAD_FIELDS}
        public = base64.b64decode(seal["public_key"], validate=True)
        fingerprint = key_fingerprint(public)
        result["key_fingerprint"] = fingerprint
        if trusted_fingerprint is not None:
            result["trusted_key_match"] = fingerprint == trusted_fingerprint.lower()
        if (
            seal["version"] != 1
            or seal["algorithm"] != "Ed25519"
            or seal["document_hash"] != hashed
            or seal["issuer_name"] != snapshot["issuer_name"]
            or seal["key_fingerprint"] != fingerprint
        ):
            return result
        Ed25519PublicKey.from_public_bytes(public).verify(
            base64.b64decode(seal["signature"], validate=True), canonical(payload)
        )
        result["signature_valid"] = result["data_hash_valid"]
    except (KeyError, TypeError, ValueError, InvalidSignature):
        pass
    return result


def proof(snapshot):
    return dict(
        format="sillage-data-proof-v1",
        scope="frozen-data-not-pdf-bytes",
        snapshot=snapshot,
        verification=verify_snapshot(snapshot),
    )
