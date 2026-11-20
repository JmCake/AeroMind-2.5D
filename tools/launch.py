"""Local-only static app host. Classroom builds include the entire dist/ tree."""
import argparse
import functools
import http.client
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import webbrowser


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
            super().do_GET()

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
    opts = parser.parse_args()
    root = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1])) / "dist"
    if not (root / "game.js").is_file():
        raise SystemExit("Build the game first with npm run build.")
    handler = functools.partial(Handler, directory=str(root))
    for port in range(opts.port, opts.port + 16):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", port), handler)
            break
        except OSError:
            if not opts.no_browser:
                try:
                    probe = http.client.HTTPConnection("127.0.0.1", port, timeout=.4)
                    probe.request("GET", "/identity")
                    same = probe.getresponse().read(32) == b"AeroMind-2.5D"
                    probe.close()
                    if same:
                        show(f"http://127.0.0.1:{port}/")
                        return
                except OSError:
                    pass
    else:
        raise SystemExit("No available loopback port.")
    url = f"http://127.0.0.1:{server.server_port}/"
    if sys.stdout:
        print(url, flush=True)
    server.last_seen = time.monotonic()
    if not opts.no_browser:
        show(url)

        def idle_watch():
            while time.monotonic() - server.last_seen < 180:
                time.sleep(15)
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
