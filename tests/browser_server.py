"""Isolated real PostgreSQL server used only by browser tests."""

import os
import sys
import tempfile
from pathlib import Path
import pgserver
import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


class ReadyServer(uvicorn.Server):
    async def startup(self, sockets=None):
        await super().startup(sockets)
        if self.started:
            print(
                "READY:" + str(self.servers[0].sockets[0].getsockname()[1]), flush=True
            )


with tempfile.TemporaryDirectory(prefix="sillage-browser-") as directory:
    pg = pgserver.get_server(Path(directory) / "postgres", cleanup_mode="delete")
    os.environ["DATABASE_URL"] = pg.get_uri()
    os.environ["SETUP_TOKEN"] = "browser-test-only-setup-code"
    os.environ["COOKIE_SECURE"] = "false"
    try:
        ReadyServer(
            uvicorn.Config("server:app", host="127.0.0.1", port=0, log_level="warning")
        ).run()
    finally:
        pg.cleanup()
