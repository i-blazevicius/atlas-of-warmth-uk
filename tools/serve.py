# Static server with HTTP Range support (python's http.server has none), for local PMTiles testing.
import os, re, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
class H(SimpleHTTPRequestHandler):
    def send_head(self):
        rng = self.headers.get('Range'); path = self.translate_path(self.path)
        if not rng or not os.path.isfile(path): return super().send_head()
        m = re.match(r'bytes=(\d*)-(\d*)', rng); size = os.path.getsize(path)
        a = int(m.group(1) or 0); b = int(m.group(2)) if m.group(2) else size - 1; b = min(b, size - 1)
        f = open(path, 'rb'); f.seek(a)
        self.send_response(206); self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Range', f'bytes {a}-{b}/{size}'); self.send_header('Content-Length', str(b - a + 1))
        self.send_header('Accept-Ranges', 'bytes'); self.end_headers(); self._left = b - a + 1; return f
    def copyfile(self, src, dst):
        if getattr(self, '_left', None) is not None:
            dst.write(src.read(self._left)); self._left = None
        else: super().copyfile(src, dst)
    def end_headers(self):
        self.send_header('Accept-Ranges', 'bytes'); super().end_headers()
    def log_message(self, *a): pass
os.chdir(sys.argv[1]); ThreadingHTTPServer(('', 8765), H).serve_forever()
