"""Local-only static server for the exported app during browser tests."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1] / 'dist'
    ThreadingHTTPServer(('127.0.0.1', 8767), partial(SimpleHTTPRequestHandler, directory=str(root))).serve_forever()
