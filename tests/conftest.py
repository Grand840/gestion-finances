"""One temporary PostgreSQL cluster shared by all integration test modules."""

import os
from pathlib import Path
import pgserver
import pytest
from fastapi.testclient import TestClient
import database as db
from server import app

SETUP = "test-only-setup-code-not-for-production"


@pytest.fixture(scope="session")
def client(tmp_path_factory):
    pg = pgserver.get_server(
        tmp_path_factory.mktemp("pg-family"), cleanup_mode="delete"
    )
    os.environ["DATABASE_URL"] = pg.get_uri()
    os.environ["SETUP_TOKEN"] = SETUP
    try:
        with TestClient(app) as client:
            yield client
    finally:
        pg.cleanup()


@pytest.fixture(autouse=True)
def empty(client):
    client.cookies.clear()
    with db.connect() as connection:
        connection.execute("TRUNCATE users,auth_attempts CASCADE")
