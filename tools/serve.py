"""Server di sviluppo che non fa cachare niente al browser.

    .venv/Scripts/python tools/serve.py        (poi apri http://localhost:8000)

http.server non manda header di cache, quindi il browser applica la sua euristica
e continua a eseguire i moduli ES vecchi anche dopo un reload: modifichi un file,
ricarichi, e vedi ancora il comportamento di prima. Qui ogni risposta e' no-store.

In produzione vale l'opposto: GitHub Pages manda max-age=600 e il service worker
bypassa la cache HTTP dove serve (vedi sw.js).
"""
import os
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PORTA = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class SenzaCache(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


if __name__ == "__main__":
    print(f"http://localhost:{PORTA}  (no-store, Ctrl+C per fermare)")
    # ThreadingHTTPServer e non HTTPServer: con un server a thread singolo
    # una connessione tenuta aperta dal browser blocca tutte le altre, e la
    # pagina resta appesa a meta' caricamento senza nessun errore.
    ThreadingHTTPServer(("", PORTA), SenzaCache).serve_forever()
