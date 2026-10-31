"""Tiny local server for EchoDaily.

Usage:
    python serve.py                              # http://127.0.0.1:8765
    python serve.py --host 0.0.0.0 --port 8766   # also reachable on the LAN
    python serve.py --port 9000 --no-browser
"""
from __future__ import annotations

import argparse
import http.server
import socket
import socketserver
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Keep the console quiet; uncomment the next line for access logs.
        # super().log_message(fmt, *args)
        pass


def lan_ip() -> str:
    """Best-effort LAN IP (does not send any packets)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return "127.0.0.1"


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve EchoDaily locally.")
    parser.add_argument("--host", default="127.0.0.1", help="127.0.0.1 (local only) or 0.0.0.0 (LAN)")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    with Server((args.host, args.port), Handler) as httpd:
        local_url = f"http://127.0.0.1:{args.port}/"
        print(f"EchoDaily is running at {local_url}")
        if args.host == "0.0.0.0":
            print(f"Phone / LAN URL: http://{lan_ip()}:{args.port}/")
            print("Phone and computer must be on the same Wi-Fi.")
        print("Press Ctrl+C to stop.")
        if not args.no_browser:
            threading.Timer(0.8, lambda: webbrowser.open(local_url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
