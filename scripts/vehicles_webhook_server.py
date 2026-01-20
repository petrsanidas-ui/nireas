#!/usr/bin/env python3
import hmac
import json
import os
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer


SHEET_ID = os.getenv("SHEET_ID", "")
DEFAULT_MUNICIPALITY_ID = os.getenv("DEFAULT_MUNICIPALITY_ID", "")
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "")
PORT = int(os.getenv("PORT", "8787"))


class WebhookHandler(BaseHTTPRequestHandler):
    def _json(self, code: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/vehicles/sync":
            return self._json(404, {"error": "not_found"})

        if WEBHOOK_SECRET:
            sig = self.headers.get("X-Webhook-Token", "")
            if not hmac.compare_digest(sig, WEBHOOK_SECRET):
                return self._json(401, {"error": "unauthorized"})

        if not SHEET_ID or not DEFAULT_MUNICIPALITY_ID:
            return self._json(400, {"error": "missing_env"})

        try:
            subprocess.check_call(
                [
                    "python",
                    "scripts/sync_vehicles_from_sheet.py",
                    "--sheet-id",
                    SHEET_ID,
                    "--default-municipality-id",
                    DEFAULT_MUNICIPALITY_ID,
                ]
            )
        except subprocess.CalledProcessError as exc:
            return self._json(500, {"error": "sync_failed", "code": exc.returncode})

        return self._json(200, {"status": "ok"})


def main() -> int:
    server = HTTPServer(("0.0.0.0", PORT), WebhookHandler)
    print(f"Listening on 0.0.0.0:{PORT} for /vehicles/sync")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
