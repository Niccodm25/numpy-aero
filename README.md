# NumPy per Ingegneria Aerospaziale

Corso interattivo di NumPy, con esercizi che girano davvero: Python e NumPy sono
compilati in WebAssembly ([Pyodide](https://pyodide.org)) ed eseguiti nel browser.
Nessun backend, nessuna installazione, funziona da iPhone.

Il piano completo del progetto è in [PLAN.md](PLAN.md).

## Provarlo in locale

```bash
python -m http.server 8000
```

Poi apri <http://localhost:8000>. Serve un server HTTP: aprire `index.html` col
doppio clic non funziona, i moduli ES e `fetch` richiedono `http://`.

## Verifiche

```bash
node js/scheduler.test.mjs
```

Controlla che ogni soluzione degli esercizi passi davvero il suo test nascosto:

```bash
python tools/check_content.py
```

## Struttura

| Percorso | Cosa fa |
|---|---|
| `js/runner.js` | Avvia Pyodide, esegue il codice dell'utente e le asserzioni nascoste |
| `js/scheduler.js` | Leitner: cosa ripassare e quando un esercizio è chiuso |
| `js/app.js` | Router e viste |
| `js/md.js` | Markdown minimo per il testo delle lezioni |
| `sw.js` | Cachea Pyodide (rete-prima per l'app, cache-prima per il CDN) |
| `content/*.json` | Lezioni ed esercizi, un file per modulo |

Aggiungere contenuti significa editare un JSON in `content/`, mai il motore.
