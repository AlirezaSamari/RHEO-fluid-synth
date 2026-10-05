"""Run RHEO on localhost using Python's standard library. No installation needed."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import webbrowser

def main():
    parser = argparse.ArgumentParser(description="Run the RHEO fluid synthesizer")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    public = Path(__file__).resolve().parent / "dist"
    class Handler(SimpleHTTPRequestHandler):
        extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript", ".js": "text/javascript", ".wav": "audio/wav"}
    server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, directory=str(public)))
    url = f"http://localhost:{args.port}/"
    print(f"RHEO is ready: {url}\nPress Ctrl+C to stop.")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == "__main__":
    main()
