"""Development only: optional pgserver binary, never used in production Docker."""

import os
from pathlib import Path
import pgserver
import uvicorn

root = Path(__file__).resolve().parent.parent
for line in (root / ".env").read_text().splitlines():
    if line and not line.startswith("#"):
        key, value = line.split("=", 1)
        os.environ.setdefault(key, value)
(root / ".local").mkdir(exist_ok=True)
pg = pgserver.get_server(root / ".local" / "postgres", cleanup_mode="stop")
os.environ["DATABASE_URL"] = pg.get_uri()
os.environ["COOKIE_SECURE"] = "false"
try:
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=8080,
        proxy_headers=True,
        forwarded_allow_ips="*",
        app_dir=str(root),
    )
finally:
    pg.cleanup()
