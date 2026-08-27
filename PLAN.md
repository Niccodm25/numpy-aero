# NumPy per Ingegneria Aerospaziale — Piano di costruzione

App web didattica, mobile-first, che gira anche da iPhone.
Corso strutturato + esercizi eseguiti davvero + ripasso forzato di ciò che sbagli.

---

## 1. Decisioni architetturali

| Problema | Scelta | Perché |
|---|---|---|
| Far girare NumPy nel browser | **Pyodide** (CPython + NumPy compilati in WebAssembly, da CDN) | NumPy è già precompilato nella distribuzione Pyodide. Zero backend, zero server da mantenere, zero rischi di sandbox: il codice gira nel *tuo* browser. Funziona su Safari iOS. |
| Backend | **Nessuno** | Sito statico. Niente da deployare, niente da pagare, niente da aggiornare. |
| Framework JS | **Nessuno.** HTML + ES modules vanilla | 12 moduli e ~200 esercizi non giustificano React + build step. Nessun `npm install`, nessuna cartella che OneDrive deve sincronizzare. |
| Editor di codice | **`<textarea>` + barra simboli** | CodeMirror/Monaco su iOS è doloroso (cursore, selezione, zoom). Una textarea usa la tastiera nativa. Sopra ci metto una riga di bottoni: `[ ] ( ) : = , . np.` e tab. Meno codice E migliore su iPhone. |
| Salvataggio progressi | **localStorage** + export/import JSON | Vedi §9 per il sync desktop↔iPhone. |
| Installazione su iPhone | **PWA** (`manifest.json` + service worker) | "Aggiungi a Home" → icona, schermo intero, e Pyodide (~12 MB) cachato una volta sola invece che a ogni apertura. |
| Hosting | **GitHub Pages** o **Netlify drop** | Gratis, HTTPS (obbligatorio per il service worker), URL stabile da aprire sull'iPhone. |

**Il punto critico:** senza Pyodide questa app sarebbe un quiz a scelta multipla. Con Pyodide gli esercizi si correggono eseguendo NumPy vero contro asserzioni nascoste — che è l'unico modo per imparare davvero una libreria.

---

## 2. Struttura dei file

```
app_learning/
├── index.html              # unica pagina, tutto il resto è JS
├── manifest.json           # PWA
├── sw.js                   # service worker: cache Pyodide + contenuti
├── css/
│   └── style.css           # mobile-first, un solo file
├── js/
│   ├── app.js              # router + stato globale
│   ├── runner.js           # wrapper Pyodide: esegui codice, cattura output, valuta test
│   ├── scheduler.js        # sistema Leitner (§4)
│   ├── storage.js          # localStorage + export/import
│   └── ui/
│       ├── lesson.js       # render teoria
│       ├── exercise.js     # render esercizio + editor + feedback
│       └── dashboard.js    # progressi, coda di ripasso
├── content/
│   ├── index.json          # elenco moduli, ordine, prerequisiti
│   ├── m01-creazione.json
│   ├── m02-indexing.json
│   └── ...                 # un file per modulo (teoria + esercizi insieme)
└── PLAN.md
```

Contenuti in JSON separati dal codice: aggiungere un esercizio = editare un JSON, non toccare il motore.

---

## 3. Modello dati dei contenuti

Un modulo (`content/m07-linalg.json`):

```json
{
  "id": "m07",
  "titolo": "Algebra lineare",
  "perche": "Equilibrio di forze, centraggio, stabilità dinamica, fitting di dati di galleria.",
  "funzioni": ["@", "np.linalg.solve", "np.linalg.inv", "np.linalg.eig", "np.linalg.norm", "np.linalg.lstsq", "np.linalg.det"],
  "lezioni": [
    {
      "id": "m07-l1",
      "titolo": "solve vs inv",
      "md": "Teoria in markdown, con blocchi di codice eseguibili...",
      "demo": "A = np.array([[2,1],[1,3]])\nb = np.array([5,10])\nprint(np.linalg.solve(A,b))"
    }
  ],
  "esercizi": []
}
```

### Quattro tipi di esercizio

| Tipo | Cosa chiede | Come si corregge |
|---|---|---|
| `predict` | "Che shape ha `a[:, None] * b`?" — scelta multipla | confronto stringa |
| `write` | "Scrivi l'espressione che calcola X" | esegue il codice + asserzioni nascoste in Pyodide |
| `debug` | Codice rotto da sistemare | idem |
| `apply` | Problema aeronautico completo (10-20 righe) | idem, con più asserzioni |

Esempio di esercizio `write`:

```json
{
  "id": "m07-e3",
  "tipo": "write",
  "difficolta": 2,
  "testo": "Volo livellato: risolvi il sistema per trovare portanza L e resistenza D.",
  "starter": "A = np.array([[1.0, -0.05],[0.0, 1.0]])\nb = np.array([12000.0, 950.0])\n# scrivi qui: assegna L e D\n",
  "test": "assert np.isclose(L, 12047.5), f'L sbagliata: {L}'\nassert np.isclose(D, 950.0)",
  "hint": ["Il sistema è A @ [L, D] = b", "solve restituisce un array: spacchettalo"],
  "soluzione": "L, D = np.linalg.solve(A, b)",
  "spiegazione": "solve non calcola mai l'inversa: fa una fattorizzazione LU, più veloce e numericamente più stabile."
}
```

Il campo `test` non viene mai mostrato. Viene concatenato al codice dell'utente ed eseguito. Se nessun `AssertionError` → corretto.

---

## 4. Sistema di ripasso — "finché non è perfetto"

**Sistema Leitner.** Non SM-2/Anki: quello ottimizza la ritenzione a lungo termine con intervalli in giorni, tu vuoi *padronanza*, che è una cosa diversa e più semplice.

Ogni esercizio ha uno stato:

```js
{ id: "m07-e3", box: 0, errori: 1, tentativi: 2, ultimo: 1735689600000 }
```

Regole (implementate in `js/scheduler.js`, `MASTERED = 3`):

- Corretto al primo tentativo assoluto, senza aiuti → `box = MASTERED`, chiuso subito. Lo sai già, non ti faccio perdere tempo.
- **Sbagliato → `box = 0`, `errori += 1`.** Sempre, anche se era già padroneggiato. Nessuna eccezione.
- Corretto ma con hint aperti → `box = 1`. L'aiuto non conta come sapere: riparti quasi da capo anche se eri avanti.
- Corretto pulito → `box += 1`.
- **Padroneggiato a `box = 3`**: dopo un errore servono 3 risposte corrette pulite per chiudere l'esercizio.

Coda di ripasso ordinata per: `box` crescente, poi `errori` decrescente. Le cose che sbagli di più tornano su per prime.

**Leech detection:** `errori >= 4` sullo stesso esercizio → l'app non te lo ripropone subito, ti rimanda alla lezione collegata con un messaggio esplicito ("hai sbagliato 4 volte: il problema è il concetto, non l'esercizio"). Poi lo rimette in coda.

Il ripasso non è opzionale: all'apertura dell'app, se ci sono item in `box <= 1`, la dashboard apre direttamente la coda di ripasso, non i moduli nuovi.

---

## 5. Curriculum — 12 moduli

Ogni funzione è scelta perché ti servirà davvero. Ogni modulo chiude con un esercizio `apply` aeronautico.

| # | Modulo | Funzioni | Esercizio finale |
|---|---|---|---|
| **M1** | Creazione e dtype | `array`, `zeros`, `ones`, `full`, `eye`, `arange`, `linspace`, `.shape`, `.dtype`, `.ndim` | Griglia di quote 0→11 km per l'atmosfera standard |
| **M2** | Indexing e slicing | slice, fancy indexing, maschere booleane, `where`, `any`, `all`, view vs copy | Estrai da un log di volo i punti con Mach > 0.8 e quota > 9000 m |
| **M3** | **Broadcasting** | regole di broadcast, `None`/`newaxis`, `meshgrid` | Matrice L/D su griglia (α × Mach) senza un solo ciclo `for` |
| **M4** | Matematica elemento per elemento | `sin`, `cos`, `tan`, `arctan2`, `exp`, `log`, `sqrt`, `abs`, `deg2rad`, `rad2deg`, `pi` | Conversione coordinate: NED → assi corpo con angoli di Eulero |
| **M5** | Aggregazioni e **`axis`** | `sum`, `mean`, `std`, `min`, `max`, `argmin`, `argmax`, `cumsum`, `nanmean` | Statistiche su matrice di prove in galleria: per campione vs per condizione |
| **M6** | Forma e composizione | `reshape`, `ravel`, `transpose`/`.T`, `concatenate`, `stack`, `vstack`, `hstack`, `split` | Assembla la matrice di stato longitudinale 4×4 da blocchi |
| **M7** | Algebra lineare | `@`, `linalg.solve`, `inv`, `det`, `eig`, `norm`, `lstsq` | Autovalori del moto longitudinale → periodo e smorzamento di fugoide e corto periodo |
| **M8** | Calcolo numerico | `gradient`, `trapezoid`, `interp`, `polyfit`, `polyval`, `roots`, `diff` | Integra il profilo di spinta → impulso totale; deriva la traiettoria → accelerazioni |
| **M9** | Dati reali: I/O e NaN | `loadtxt`, `genfromtxt`, `savetxt`, `save`/`load`, `isnan`, `nan*`, `isfinite` | Ripulisci un CSV di telemetria con letture mancanti e calcola le medie corrette |
| **M10** | Casualità e Monte Carlo | `default_rng`, `normal`, `uniform`, `choice`, `percentile` | Propagazione delle tolleranze: dispersione della quota di apogeo su 10⁴ tiri |
| **M11** | Precisione e performance | `float64` vs `float32`, `isclose`, `allclose`, overflow, view vs copy | Perché il confronto `==` su float fallisce, e la versione vettorizzata 200× più veloce del ciclo |
| **M12** | **Trovare da solo le funzioni che non conosci** | vedi §6 | Tre problemi con funzioni mai viste nel corso. Devi trovarle da solo. |

### Dopo i 12: i moduli cantiere

I moduli M1–M12 insegnano **a usare NumPy**: l'aerospaziale è il contesto, ma quello che i test verificano è l'operazione NumPy, non la fisica. È una scelta deliberata — solo le competenze meccaniche si possono drillare col ripasso forzato. "Quale axis collassa le colonne" o lo sai o non lo sai; "capire il modo di corto periodo" non è una domanda con una risposta da ripetere finché non è perfetta.

L'applicazione arriva dopo, quando gli strumenti ci sono tutti, in 2-3 **moduli cantiere**: problemi aperti end-to-end, senza una singola riga da indovinare, dove il risultato si valuta sul risultato.

| # | Cantiere | Cosa metti insieme |
|---|---|---|
| **C1** | Traiettoria di lancio a due stadi | integrazione passo-passo, `where` per la separazione, aggregazioni, ricerca dell'apogeo |
| **C2** | Analisi di stabilità longitudinale completa | assemblaggio della matrice, autovalori, qualità di volo, studio di sensibilità su una derivata |
| **C3** | Riduzione dati di una campagna in galleria | I/O, NaN, medie per condizione, fitting, propagazione dell'incertezza |

Questi non entrano nel sistema Leitner: sono progetti, non esercizi da ripassare.

---

**Ordine non negoziabile:** M3 (broadcasting) prima di tutto il resto applicativo. È il concetto che separa chi scrive NumPy da chi scrive Python con array dentro. M5 (`axis`) è il secondo scoglio: quasi tutti gli errori dei principianti sono `axis` sbagliato.

---

## 6. Modulo M12 — come cercare (quello che hai chiesto esplicitamente)

Non una lezione, un **metodo in 4 livelli**, insegnato facendoteli usare dentro l'app:

1. **Dall'oggetto** — `dir(np.linalg)`, `[n for n in dir(np) if 'sort' in n]`. Serve quando sai *dove* ma non *come si chiama*.
2. **Dalla docstring** — `help(np.interp)`, `np.info(np.interp)`, e come si legge una signature: cosa sono i parametri con default, cosa significa `axis=-1`, cosa restituisce. **Questa è la competenza vera.** Il 90% delle domande su NumPy ha risposta nella prima schermata di `help()`.
3. **Dalla documentazione ufficiale** — struttura di numpy.org/doc: *API reference* per funzione nota, *Routines by topic* per categoria (`Linear algebra`, `Statistics`, `Polynomials`), e il blocco `See Also` in fondo a ogni pagina, che è il posto dove si scoprono le funzioni migliori.
4. **Riconoscere il pattern** — NumPy ha convenzioni ricorrenti: `arg*` restituisce indici, `nan*` ignora i NaN, `*_like` copia la shape, il suffisso `s` per assi multipli. Impararle vale più di memorizzare 200 nomi.

**Nota tecnica da inserire nella lezione:** `np.lookfor()` esisteva in NumPy 1.x ma **è stato rimosso in NumPy 2.0**. Pyodide oggi porta NumPy 2.x — la lezione insegna cosa fare al suo posto. Idem `np.trapz` → **`np.trapezoid`** (rinominato in 2.0). È materiale didattico prezioso: ti insegna a leggere le release note, cosa che farai per tutta la carriera.

**Esercizi M12** — ti do il problema, non la funzione:
- "Trova l'indice dove inserire un valore in un array ordinato mantenendo l'ordine" → `searchsorted`
- "Applica una funzione lungo un asse di un array 3D" → `apply_along_axis`
- "Trova i valori unici e quante volte compaiono" → `unique(return_counts=True)`
- "Costruisci una matrice a blocchi da sottomatrici" → `block`

La correzione verifica il *risultato*, non quale funzione hai usato — ma la spiegazione mostra poi la funzione canonica e perché è migliore.

---

## 7. UX su iPhone

- **Mobile-first vero:** tutto a colonna singola, target touch ≥ 44 px, niente hover.
- **Barra simboli sopra la tastiera:** `[ ] ( ) : = , * @ np.` — su iOS le parentesi quadre richiedono due tap sulla tastiera nativa, e in NumPy le usi in continuazione.
- **Textarea con `autocapitalize=off` `autocorrect=off` `spellcheck=false`** — altrimenti iOS trasforma `np` in `Np` e il codice non compila. Dettaglio banale che rovina l'esperienza se lo dimentichi.
- **Loading di Pyodide onesto:** ~12 MB al primo avvio. Barra di progresso, e la teoria si legge mentre carica in background. Dalla seconda volta è cachato dal service worker.
- **Feedback immediato:** verde/rosso + output reale + messaggio dell'assert. Se sbagli, mai la soluzione al primo colpo: prima hint 1, poi hint 2, poi soluzione con spiegazione.

---

## 8. Fasi di build

| Fase | Cosa | Verificabile quando |
|---|---|---|
| **F1** | `index.html` + Pyodide che carica ed esegue `print(np.__version__)` | Vedi la versione di NumPy sullo schermo del telefono |
| **F2** | `runner.js`: esegui codice utente + test nascosti, cattura stdout/eccezioni | Un esercizio hardcoded si corregge da solo |
| **F3** | Formato JSON contenuti + render lezione/esercizio. **Modulo M1 completo** | Fai M1 da cima a fondo |
| **F4** | `scheduler.js` (Leitner) + `storage.js` | Sbagli un esercizio, torna in coda, non ti molla finché non è box 5 |
| **F5** | Dashboard: progressi, coda ripasso, statistiche errori | Vedi dove sei debole |
| **F6** | PWA: manifest + service worker + cache Pyodide | Icona sulla Home dell'iPhone, funziona offline |
| **F7** | Contenuti M2→M12 | Il corso vero |
| **F8** | Deploy | URL pubblico |

F1→F6 è il motore: poche centinaia di righe. F7 è il lavoro grosso ed è scrittura di contenuti, non codice — si fa a moduli, uno alla volta, mentre già usi l'app.

**Ordine consigliato:** F1-F4 + M1 completo, poi *usalo per una settimana*. Se il sistema di ripasso ti funziona, scrivi gli altri moduli. Se non ti funziona, l'hai scoperto dopo 1 modulo e non dopo 12.

---

## 9. Dove vive il progetto: GitHub, non il PC

**Sì, si può tenere tutto su GitHub e non avere niente sul PC.** È esattamente il modello giusto per un sito statico.

Prima però il dato di realtà: **il progetto pesa meno di 1 MB.** HTML + CSS + JS sono ~100 KB, i 12 JSON di contenuti ~300 KB. I 12 MB di Pyodide arrivano da CDN e stanno nella cache del browser, non sono un file tuo. Lo spazio su disco non è il problema vero — i motivi buoni per stare su GitHub sono altri:

- **Backup e storico.** Rompi qualcosa, torni indietro di un commit.
- **Fuori da OneDrive.** OneDrive sincronizza ogni salvataggio di ogni file: rumore inutile, e i conflitti di sync su file di codice sono fastidiosi.
- **Hosting gratis incluso.** GitHub Pages serve il repo come sito HTTPS, che è il requisito per il service worker della PWA.
- **Un URL solo**, uguale da PC e da iPhone.

### Setup

1. Repo su GitHub (privato o pubblico, Pages funziona con entrambi sui piani attuali).
2. Settings → Pages → Source: `Deploy from a branch`, branch `main`, cartella `/root`.
3. URL finale: `https://<utente>.github.io/<repo>/` → aprilo su iPhone → *Condividi* → *Aggiungi a Home*.
4. Ogni `git push` è un deploy. Nessuna pipeline, nessun account in più.

### Modificarlo senza niente installato

- **github.dev** — sul repo premi `.` (punto). Si apre VS Code nel browser, editi, committi. Funziona anche da Safari su iPhone. Gratis, zero installazioni.
- **Codespaces** — VS Code completo con terminale e Python vero, 60 h/mese gratis. Serve solo se vuoi eseguire cose lato server; per editare JSON è sovradimensionato.

### L'unico vincolo di cui tenere conto

Claude Code gira **sul tuo PC** e lavora su file locali: per farmi scrivere il codice, i file devono esistere qui. Il modello pratico è quindi:

```
PC (working copy) --push--> GitHub (fonte di verità + hosting) --> iPhone (uso)
```

La cartella locale resta, ma diventa usa-e-getta: puoi cancellarla quando vuoi e riclonarla con un comando. Se vuoi davvero zero file locali, l'alternativa è usare **Claude Code sul web** (claude.ai/code), che lavora direttamente sul repo GitHub in cloud.

**Prima cosa da fare comunque: spostare il progetto fuori da `OneDrive/Desktop`** — es. `C:\dev\app_learning` — e inizializzare git lì.

---

## 10. Sync dei progressi desktop ↔ iPhone

Il problema: `localStorage` è per-browser. Studi sul PC, il telefono non lo sa.

**Ora:** localStorage + bottone *Esporta progressi* (scarica un JSON) / *Importa*. Zero infrastruttura.

**Se e quando diventa fastidioso:** un endpoint solo (`GET`/`PUT` di un blob JSON con una chiave segreta) su Cloudflare Workers + KV. Piano gratuito, ~30 righe, nessun database, nessun login. Non prima di averne effettivamente bisogno.

---

## 11. Cosa ho deliberatamente escluso

- **React / Vue / build step** — nessun `npm`, nessun `node_modules` dentro OneDrive. Riconsidera solo se la UI diventa davvero complessa.
- **Backend con esecuzione Python** — Pyodide lo rende inutile e sarebbe l'unica parte con rischi di sicurezza.
- **Login e account** — sei l'unico utente.
- **Anki/SM-2 con intervalli in giorni** — tu vuoi padronanza, non ritenzione a 6 mesi. Leitner basta.
- **Matplotlib** — funziona in Pyodide ma pesa e complica. Modulo separato dopo che NumPy è solido.
- **Database di contenuti** — 12 file JSON si editano a mano meglio di qualsiasi CMS.
