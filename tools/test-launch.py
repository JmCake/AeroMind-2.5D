"""Check the Windows release's normal app window, bundled model and shutdown."""
import ctypes
from ctypes import wintypes
import hashlib
import http.client
import json
from pathlib import Path
import socket
import subprocess
import sys
import time


def app_windows():
    handles = set()
    callback_t = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32 = ctypes.windll.user32

    @callback_t
    def visit(hwnd, _):
        window = wintypes.HWND(hwnd)
        if user32.IsWindowVisible(window):
            title = ctypes.create_unicode_buffer(256)
            window_class = ctypes.create_unicode_buffer(64)
            user32.GetWindowTextW(window, title, len(title))
            user32.GetClassNameW(window, window_class, len(window_class))
            if title.value.startswith("AeroMind") and window_class.value == "Chrome_WidgetWin_1":
                handles.add(hwnd)
        return True

    user32.EnumWindows(visit, 0)
    return handles


def asset(port, resource, timeout=3):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    try:
        connection.request("GET", resource)
        response = connection.getresponse()
        if response.status != 200:
            raise ValueError(f"{resource} returned {response.status}")
        return response.read()
    finally:
        connection.close()


def find_app(ports):
    for port in ports:
        try:
            if asset(port, "/identity", timeout=0.2) == b"AeroMind-2.5D":
                return port
        except (OSError, ValueError, http.client.HTTPException):
            pass
    return None


def main():
    exe = Path(sys.argv[1]).resolve()
    args = [str(exe)]
    ports = range(8765, 8781)
    original = app_windows()
    if original or find_app(ports) is not None:
        # Keep an already-open classroom session outside this test.
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            ports = [probe.getsockname()[1]]
        args += ["--port", str(ports[0])]
    start = time.monotonic()
    process = subprocess.Popen(args)
    window = None
    try:
        while time.monotonic() - start < 45:
            opened = app_windows() - original
            if len(opened) == 1:
                window = opened.pop()
                break
            time.sleep(0.2)
        assert window, "An AeroMind browser app window did not appear."
        port = find_app(ports)
        assert port is not None, "The newly opened app has no loopback identity."
        bundled_hash = hashlib.sha256(asset(port, "/models/mature.onnx")).hexdigest()
        trained = json.loads(Path("public/models/training.json").read_text("utf-8"))
        assert bundled_hash == trained["checkpoints"]["mature"]["sha256"]
        opened_seconds = time.monotonic() - start
        if window in app_windows() - original:
            ctypes.windll.user32.PostMessageW(wintypes.HWND(window), 0x0010, 0, 0)
        print(f"App window and bundled model verified in {opened_seconds:.2f} seconds.", flush=True)
        closed_at = time.monotonic()
        assert process.wait(timeout=222) == 0
        report = {
            "mode": "launcher",
            "testedApplicationSha256": hashlib.sha256(exe.read_bytes()).hexdigest(),
            "defaultArguments": len(args) == 1,
            "appWindowOpenedSeconds": round(opened_seconds, 2),
            "automaticShutdownAfterCloseSeconds": round(time.monotonic() - closed_at, 2),
            "matureModelSha256": bundled_hash,
        }
        out = Path("output/playwright/launcher.json")
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print("PASS launcher", flush=True)
    finally:
        if process.poll() is None:
            process.terminate()


if __name__ == "__main__":
    main()
