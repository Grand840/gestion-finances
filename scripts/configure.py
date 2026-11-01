#!/usr/bin/env python3
"""Generate local-only secrets. Never overwrites an existing configuration."""

from pathlib import Path
import os
import secrets


def main():
    root = Path(__file__).resolve().parent.parent
    path = root / ".env"
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        print(
            "Une configuration .env existe déjà. Elle est conservée ; aucun secret n’a été modifié."
        )
        return
    values = dict(
        POSTGRES_PASSWORD=secrets.token_hex(32),
        APP_DB_PASSWORD=secrets.token_hex(32),
        SETUP_TOKEN=secrets.token_urlsafe(32),
        APP_BIND="0.0.0.0",
        APP_PORT="8080",
        COOKIE_SECURE="false",
        FORWARDED_ALLOW_IPS="127.0.0.1",
        SILLAGE_DOMAIN="localhost",
    )
    with os.fdopen(fd, "w") as stream:
        stream.write(
            "\n".join(f"{key}={value}" for key, value in values.items()) + "\n"
        )
    print("Configuration créée dans .env (permissions 0600).")
    print(
        "Pour le premier compte, utilisez la valeur SETUP_TOKEN de ce fichier, sans la publier."
    )


if __name__ == "__main__":
    main()
