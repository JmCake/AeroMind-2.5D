"""Local-only static app host. Classroom builds include the entire dist/ tree."""
import argparse
import functools
import http.client
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import webbrowser


class ClassroomServer(ThreadingHTTPServer):
    # Windows SO_REUSEADDR allows two listeners to receive the same address.
    # Reserve this port exclusively, or let the launcher try the next one.
    allow_reuse_address = os.name != "nt"

    def server_bind(self):
        if os.name == "nt":
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".wasm": "application/wasm",
                      ".mjs": "text/javascript", ".onnx": "application/octet-stream"}

    def do_GET(self):
        if self.path in ("/ping", "/identity"):
            self.server.last_seen = time.monotonic()
            body = b"AeroMind-2.5D"
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
        else:
            try:
                super().do_GET()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                # Changing lessons or closing the browser can cancel an asset transfer.
                pass

    def list_directory(self, path):
        return self.send_error(404)

    def log_message(self, *args):
        pass


def show(url):
    candidates = [Path(os.environ.get("ProgramFiles(x86)", "")) / "Microsoft/Edge/Application/msedge.exe",
                  Path(os.environ.get("ProgramFiles", "")) / "Google/Chrome/Application/chrome.exe"]
    for browser in candidates:
        if browser.is_file():
            subprocess.Popen([str(browser), "--app=" + url, "--window-size=1280,800"], close_fds=True)
            return
    webbrowser.open(url)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--session-file", type=Path, help=argparse.SUPPRESS)
    opts = parser.parse_args()
    root = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1])) / "dist"
    if not (root / "guide.js").is_file() or not (root / "version.txt").is_file():
        raise SystemExit("Build the game first with npm run build.")
    version = (root / "version.txt").read_bytes()
    handler = functools.partial(Handler, directory=str(root))
    for port in range(opts.port, opts.port + 16):
        try:
            server = ClassroomServer(("127.0.0.1", port), handler)
            break
        except OSError:
            if not opts.no_browser:
                probe = http.client.HTTPConnection("127.0.0.1", port, timeout=.4)
                try:
                    probe.request("GET", "/version.txt")
                    response = probe.getresponse()
                    if response.status == 200 and response.read(len(version) + 1) == version:
                        show(f"http://127.0.0.1:{port}/")
                        return
                except (OSError, http.client.HTTPException):
                    pass
                finally:
                    probe.close()
    else:
        raise SystemExit("No available loopback port.")
    url = f"http://127.0.0.1:{server.server_port}/"
    if sys.stdout:
        print(url, flush=True)
    server.last_seen = time.monotonic()
    if not opts.no_browser:
        show(url)
    if opts.session_file or not opts.no_browser:
        def idle_watch():
            while True:
                if opts.session_file and not opts.session_file.exists():
                    break
                if not opts.no_browser and time.monotonic() - server.last_seen >= 180:
                    break
                time.sleep(.3 if opts.session_file else 10)
            server.shutdown()
        threading.Thread(target=idle_watch, daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
