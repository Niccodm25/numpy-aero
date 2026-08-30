# NumPy per Ingegneria Aerospaziale

Corso interattivo di NumPy, con esercizi che girano davvero: Python e NumPy sono
compilati in WebAssembly ([Pyodide](https://pyodide.org)) ed eseguiti nel browser.
Nessun backend, nessuna installazione, funziona da iPhone.

Il piano completo del progetto è in [PLAN.md](PLAN.md).

## Provarlo in locale

```bash
.venv/Scripts/python tools/serve.py
```

Poi apri <http://localhost:8000>. Serve un server HTTP: aprire `index.html` col
doppio clic non funziona, i moduli ES e `fetch` richiedono `http://`.

Usa `tools/serve.py` e non `python -m http.server`: quest'ultimo non manda header
di cache, il browser applica la sua euristica e continua a eseguire i moduli ES
vecchi anche dopo un reload. Modifichi un file, ricarichi, e vedi ancora il
comportamento di prima.

## Verifiche

Prima di ogni commit esegui, in quest'ordine:

```bash
node tools/test_shell.mjs
python tools/check_lezioni.py
.venv/Scripts/python tools/check_content.py
```

- `test_shell.mjs` riesegue le soluzioni di terminale e HTML contro le loro
  verifiche, oltre ai casi del motore shell.
- `check_lezioni.py` impedisce a un esercizio di chiedere un comando o un'opzione
  non ancora introdotti da una lezione precedente.
- `check_content.py` esegue tutte le soluzioni Python contro i test nascosti.
  Richiede NumPy 2.2.5, la stessa versione dell'app.

Setup Python una volta sola:

```bash
python -m venv .venv
.venv/Scripts/pip install numpy==2.2.5
.venv/Scripts/python tools/check_content.py
```

Su Linux e macOS il percorso è `.venv/bin/python`. `check_content.py` rifiuta
una versione diversa e spiega come allinearla.

Quando modifichi il ripasso, esegui anche:

```bash
node js/scheduler.test.mjs
```

Il controllo storico `tools/check_vocabolario.py` resta disponibile per audit
mirati del curriculum Python, ma non sostituisce i tre controlli di rilascio.

## Struttura

| Percorso | Cosa fa |
|---|---|
| `js/runner.js` | Avvia Pyodide, esegue il codice dell'utente e le asserzioni nascoste |
| `js/scheduler.js` | Leitner: cosa ripassare e quando un esercizio è chiuso |
| `js/app.js` | Router e viste |
| `js/shell.js`, `js/vfs.js` | Terminale POSIX simulato e filesystem isolato per ogni esercizio |
| `js/powershell.js`, `js/ambienti.js`, `js/processi.js` | Adattatori di ramo sullo stesso motore: cmdlet, ambienti e processi |
| `js/traguardi.js` | Mostra capacità raggiunte e quelle che richiedono moduli in arrivo |
| `js/md.js` | Markdown minimo per il testo delle lezioni |
| `sw.js` | Cachea Pyodide (rete-prima per l'app, cache-prima per il CDN) |
| `content/index.json` | Rami, ordine didattico, moduli disponibili e pianificati |
| `content/traguardi.json` | Competenze, prerequisiti e punti sensati in cui fermarsi |
| `content/*.json` | Lezioni ed esercizi, un file per modulo o cantiere |
| `tools/` | Porte di qualità per contenuti, lezioni e motore shell |

Aggiungere contenuti significa aggiornare JSON, indice e traguardi; il motore si
tocca solo quando una nuova capacità non può essere descritta dai contratti già
esistenti.
