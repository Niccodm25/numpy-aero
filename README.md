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

```bash
node js/scheduler.test.mjs
```

Controlla che ogni soluzione degli esercizi passi davvero il suo test nascosto.
Deve girare sullo stesso NumPy che Pyodide carica nel browser (2.2.5), altrimenti
il controllo non dice niente sull'app: fra 1.x e 2.x cambiano nomi (`trapz` →
`trapezoid`) e spariscono funzioni (`lookfor`). Setup una volta sola:

```bash
python -m venv .venv && .venv/Scripts/pip install numpy==2.2.5
```

Poi, a ogni modifica dei contenuti:

```bash
.venv/Scripts/python tools/check_content.py
```

Lo script si rifiuta di girare se la versione non corrisponde, e dice come
allinearla. Su Linux e macOS il percorso è `.venv/bin/python`.

Controlla che nessun esercizio chieda comandi che il suo modulo non ha ancora
insegnato:

```bash
.venv/Scripts/python tools/check_vocabolario.py
```

Analizza l'albero sintattico di `setup`, `starter` e `soluzione` di ogni
esercizio e li confronta con il vocabolario cumulativo dei moduli. Distingue
ciò che lo studente deve **scrivere** da ciò che gli viene solo **fornito**: il
campo `test` è nascosto e non viene controllato. Il vocabolario per modulo sta
in cima allo script — se aggiungi una funzione a una lezione, aggiungila lì.

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
