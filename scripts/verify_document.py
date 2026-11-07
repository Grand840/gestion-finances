#!/usr/bin/env python3
"""Offline verification of Sillage's frozen data, not PDF/PAdES verification."""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from seals import verify_snapshot


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("proof", type=Path)
    parser.add_argument(
        "--trusted-key", help="Empreinte SHA-256 de la clé émetteur obtenue séparément"
    )
    args = parser.parse_args()
    try:
        document = json.loads(args.proof.read_text(encoding="utf-8"))
        if (
            document.get("format") != "sillage-data-proof-v1"
            or document.get("scope") != "frozen-data-not-pdf-bytes"
        ):
            raise ValueError("Format de preuve inconnu")
        status = verify_snapshot(document["snapshot"], args.trusted_key)
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        print("ÉCHEC — preuve illisible ou invalide.", file=sys.stderr)
        return 1
    if not status["signature_valid"] or (
        args.trusted_key and not status["trusted_key_match"]
    ):
        print(
            "ÉCHEC — scellé absent, données altérées ou clé inattendue.",
            file=sys.stderr,
        )
        return 1
    print("OK — données figées et scellé Ed25519 vérifiés.")
    print("Clé émetteur :", status["key_fingerprint"])
    if not args.trusted_key:
        print(
            "Comparez cette empreinte à celle des paramètres Sillage pour confirmer la clé émetteur."
        )
    print(
        "Portée : données du document, pas les octets du PDF ni une certification d’identité indépendante."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
