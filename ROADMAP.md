# Roadmap — dai moduli NumPy ai quattro rami

Piano per l'evoluzione dell'app in una piattaforma a più rami. Nessun codice, solo
decisioni e sequenza. Il piano dell'app attuale resta in [PLAN.md](PLAN.md).

---

## 1. Verdetto sul piano

I quattro rami proposti sono complementari e coprono i buchi veri di un ingegnere
che programma: sai calcolare ma non sai installare, sai scrivere codice ma non sai
muoverti nel sistema che lo esegue. **La direzione è giusta.**

Due correzioni prima di partire.

**Il ramo ambienti va per primo, non per ultimo.** `pip`, `venv`, PATH e conda sono
quello che ti blocca *ora*: `ModuleNotFoundError` su un pacchetto che hai installato,
due Python diversi che si contendono la riga di comando, conda e pip che si pestano
i piedi. È anche il ramo più piccolo in termini di contenuti. Metterlo per ultimo
significa continuare a subire quei problemi per mesi.

**Impara PowerShell, non il Prompt dei comandi.** `cmd.exe` è in manutenzione da
oltre un decennio: nessuno lo usa per lavoro su Windows moderno. PowerShell è la
shell vera del sistema — oggetti invece di testo, accesso a servizi, registro,
processi, e il linguaggio in cui si automatizza Windows. Il ramo Windows deve essere
un ramo PowerShell, con `cmd` ridotto a una lezione su "cosa fare quando lo incontri".

---

## 2. Il problema strutturale

Il motore attuale funziona perché **Pyodide esegue Python vero nel browser**: scrivi
il codice, le asserzioni nascoste lo verificano, e la correzione è reale.

Quel motore non copre tre dei quattro rami.

| Ramo | Eseguibile nel browser? | Perché |
|---|---|---|
| Librerie Python | **Sì** | Stesso motore, nessun lavoro nuovo |
| pip, venv, ambienti | No | Pyodide non ha `subprocess`, né rete per PyPI, né `python -m venv` |
| Linux | No | Non c'è una shell |
| PowerShell | No | Idem, e nessun emulatore Windows nel browser |

**La soluzione sbagliata è il quiz.** Tre rami su quattro diventerebbero domande a
scelta multipla, cioè esattamente il modo di imparare che non funziona per una
competenza pratica. Sapere che `cd` cambia cartella non è saper navigare un
filesystem alla cieca.

---

## 3. La soluzione: il terminale simulato

Un interprete di comandi in JavaScript, con un **filesystem virtuale** in memoria.
Digiti i comandi, il filesystem cambia, e l'esercizio si corregge **controllando lo
stato finale** — stessa filosofia delle asserzioni nascoste, applicata al sistema
invece che agli array.

```
Esercizio: "Crea una cartella progetti, entraci, e crea dentro un file note.txt"
Verifica:  fs.esiste("/home/tu/progetti/note.txt") && cwd == "/home/tu/progetti"
```

### Perché è la scelta giusta e non un ripiego

- **Rende visibile lo stato invisibile.** Il vero problema di `venv` e PATH non è la
  sintassi, è che non vedi mai in che stato sei. Un pannello che mostra sempre
  cartella corrente, ambiente attivo, PATH e pacchetti installati insegna il modello
  mentale meglio di un terminale vero, dove quelle cose sono nascoste.
- **Gli errori sono sicuri.** `rm -rf` sul simulatore è una lezione. Sul tuo disco no.
- **Funziona offline**, come il resto dell'app, e non richiede nulla di installato.
- **Un solo motore per tre rami.** Linux, PowerShell e ambienti condividono lo stesso
  filesystem virtuale, cambiando solo il dizionario dei comandi.

### Il limite, dichiarato

Un simulatore non è la macchina vera: nessuna gestione dei permessi reale, nessuna
rete, nessuna delle mille asimmetrie di un sistema vero. Per questo ogni modulo
chiude con un **compito sulla macchina reale**: "fai la stessa cosa nel tuo terminale
e incolla l'output". La verifica lì è più debole, ma il transfer è reale.

### Dimensione

È il pezzo di software nuovo più grosso del piano: filesystem virtuale, parser dei
comandi, due dizionari di comandi, il pannello di stato. Nell'ordine delle centinaia
di righe, non delle migliaia — ma va costruito una volta bene, perché tre rami ci si
appoggiano.

---

## 4. I sei rami

Due si sono aggiunti dopo la prima stesura: **Python base**, che il corso NumPy
dava per scontato dalla prima riga, e **HTML**, che non e' prerequisito di niente
ma e' un dominio che serve a se'.


### Ramo A — Librerie Python

Estensione diretta di quello che c'è. Motore invariato.

| Corso | Contenuto | Stato |
|---|---|---|
| NumPy | 12 moduli + 3 cantieri | **fatto** |
| Matplotlib | figure e assi, plot e scatter, contour per le griglie del modulo 3, assi doppi, annotazioni, salvataggio. Cantiere: polare + diagramma V-n + traiettoria | da fare |
| SciPy | `solve_ivp` al posto dell'Eulero a mano, `minimize`, `interp1d` e spline, `signal` per i dati di volo | da fare |
| Pandas | solo se lavorerai con dataset veri e disordinati; per matrici numeriche NumPy basta | forse |

Matplotlib prima di SciPy: completa NumPy invece di aprire un fronte nuovo, e senza
grafici non vedi mai i risultati che calcoli.

### Ramo B — Ambienti e pacchetti  ← **iniziato**

Il ramo che sblocca tutto il resto. Simulato, con il pannello di stato sempre visibile.

1. **Dove sta Python** — PATH, `which`, venv, pip, e le tre righe di diagnostica. **fatto**
2. **pip** — install, uninstall, `list`, `show`, `freeze`, e cosa significa davvero
   "installato": in quale Python
3. **venv** — creare, attivare, disattivare, perché l'attivazione è solo una modifica
   temporanea del PATH, cosa cambia nel prompt
4. **requirements.txt** — bloccare le versioni, ricostruire un ambiente. Coperto in
   parte da 1 e 5; resta da fare un modulo suo se serve piu' spazio
5. **Conflitti** — quattro cause del `ModuleNotFoundError`, le tre righe di
   diagnostica, il file che oscura il pacchetto. **Il modulo diagnostico** — **fatto**
6. **conda e Anaconda** — cosa risolvono in più (pacchetti non-Python, compilatori),
   perché in ambito scientifico si usano, e la regola per non mescolarli con pip
7. **VS Code** — selezionare l'interprete, perché il terminale integrato può avere un
   ambiente diverso da quello del pulsante Run, come si legge la barra di stato

I moduli 5 e 7 sono i più preziosi: sono i problemi che avrai davvero.

### Ramo C — PowerShell (Windows)

Simulato, filesystem virtuale in stile Windows.

1. **Navigazione** — `Get-ChildItem`, `Set-Location`, percorsi, `C:\` contro `/`
2. **File** — creare, copiare, spostare, eliminare, leggere
3. **La pipeline a oggetti** — la differenza che conta: `Get-Process | Where-Object CPU -gt 100`
   filtra oggetti, non righe di testo. È il motivo per cui PowerShell non è bash
4. **Filtrare e ordinare** — `Where-Object`, `Select-Object`, `Sort-Object`, `Measure-Object`
5. **Testo e file di dati** — `Select-String`, import/export CSV, JSON
6. **Script** — variabili, cicli, funzioni, execution policy
7. **Sistema** — processi, servizi, variabili d'ambiente, task pianificati
8. **cmd.exe** — una lezione sola: riconoscerlo, i quattro comandi che servono, perché
   non impararlo

### Ramo D — Linux

Stesso motore, dizionario POSIX. Serve appena toccherai un cluster di calcolo, un
Raspberry, un server, o WSL.

1. **Filesystem e navigazione** — `ls`, `cd`, `pwd`, percorsi assoluti e relativi, `~`
2. **File** — `cp`, `mv`, `rm`, `mkdir`, `cat`, `less`
3. **Pipe e redirezione** — `|`, `>`, `>>`, `grep`, `wc`, `sort`, `head`, `tail`
4. **Ricerca** — `find`, `grep -r`, i glob
5. **Permessi** — `chmod`, `chown`, e perché `sudo` non è la risposta a tutto
6. **Processi** — `ps`, `kill`, background, `nohup`, `top`
7. **Bash scripting** — variabili, condizioni, cicli, argomenti
8. **WSL** — Linux dentro Windows: come si installa, dove sono i file di Windows visti
   da Linux e viceversa, quando conviene

**Nota sulla ridondanza fra C e D:** i concetti sono gli stessi, i comandi no. La
struttura parallela è deliberata: fatto uno, l'altro diventa una tabella di traduzione.
Vale la pena avere un modulo esplicito di **corrispondenze** fra le due shell.


### Ramo E — Python, il linguaggio  ← **fatto**

Gira sul motore che c'e' gia': Pyodide esegue Python vero, senza bisogno del
terminale simulato. E' il ramo piu' economico da costruire di tutti, ed e' quello
che il corso NumPy presupponeva senza dirlo.

Otto moduli, 430 esercizi, tutti verificati da `check_content.py`.

1. **print, variabili e tipi** — print mostra ma non restituisce, un numero letto
   da file e' testo, un metodo di stringa non modifica la stringa
2. **Operatori e formattazione** — le due divisioni, f-string, arrotondamenti
3. **Liste, tuple, dizionari** — i metodi che modificano restituiscono `None`
4. **Controllo di flusso** — l'indentazione e' la sintassi, `range` esclude a destra
5. **Funzioni** — il default mutabile, e assegnare un nome lo rende locale
6. **Leggere un errore** — il traceback si legge dal basso
7. **import** — le tre forme, e meta' di quello che hai scritto a mano esiste gia'
8. **File e contesti** — `with`, il modo `"w"` che svuota, il lettore a mano

Il modulo 6 e' il piu' prezioso: un traceback e' la sola diagnostica che avrai,
e va letto dal basso.

**Nota tecnica.** Gli esercizi sui file usano `io.StringIO` al posto di `open`:
il codice scritto e' lo stesso, ma nessuno tocca il disco — ne' quello del
browser ne' la cartella del progetto quando gira il controllo dei contenuti.
Le asserzioni sugli errori controllano il **tipo** dell'eccezione e mai il testo
del messaggio, che cambia fra la versione di Python del venv e quella di Pyodide.

### Ramo F — HTML, come e' fatta una pagina

Ultimo perche' non e' prerequisito di niente. Non serve il terminale simulato:
una pagina si verifica sul DOM prodotto, che il browser gia' espone.

1. **Un file .html minimo** — doctype, html, head, body, e perche' quell'ordine
2. **Il testo** — h1..h6, p, liste, link, e cosa vuol dire markup semantico
3. **Attributi** — id, class, href, src, alt
4. **Tabelle e immagini** — table/thead/tbody, img e il testo alternativo
5. **Form** — input, label, select, e cosa succede all'invio
6. **CSS** — selettori, box model, flex e grid
7. **Il browser** — DevTools, ordine di caricamento, cosa blocca il rendering
8. **Pubblicare** — sito statico, GitHub Pages, il perche' di HTTPS

---

## 5. Due ordini diversi

**Ordine di studio** — quello che vede l'utente in home, dal primo all'ultimo:
Python, Ambienti, Librerie, PowerShell, Linux, HTML. Il linguaggio prima di tutto,
poi come farlo girare, poi gli strumenti di calcolo, poi il sistema sotto.

**Ordine di costruzione** — quello che conviene a chi scrive i contenuti:


| # | Cosa | Perché in questa posizione |
|---|---|---|
| 1 | **Usare NumPy per qualche settimana** | Il sistema di ripasso non è mai stato provato da uno studente vero. Tararlo prima di replicarlo su sei rami |
| 2 | **Ramo E — Python base** | ~~Da fare~~ **fatto**: otto moduli sul motore che c'era gia', nessun software nuovo |
| 3 | **Motore del terminale simulato** | ~~Da fare~~ **fatto**: `js/vfs.js` e `js/shell.js`, piu' `js/ambienti.js` per python/pip/venv. 59 casi in `tools/test_shell.mjs` |
| 4 | **Ramo B — Ambienti** | Il più utile subito, e il più piccolo. Mette alla prova il motore nuovo su un dominio ristretto |
| 5 | **Ramo C — PowerShell** | La macchina che usi tutti i giorni |
| 6 | **Matplotlib** | Completa NumPy, motore già pronto |
| 7 | **Ramo D — Linux** | Quando serve: cluster, WSL, server |
| 8 | **SciPy** | Quando i problemi superano quello che NumPy risolve da solo |

Il passo 1 non è tempo perso. Se il Leitner a tre caselle è tarato male, scoprirlo su
un corso costa una settimana; scoprirlo su sei costa mesi di contenuti da rifare.

---

## 6. Cosa cambia nell'app

Modifiche contenute, perché i contenuti sono già separati dal motore.

- **`content/index.json` diventa un indice di rami**, ciascuno con i suoi moduli. La
  home mostra i rami; dentro un ramo, i moduli di adesso.
- **Il tipo di esercizio si estende**: oltre a `predict`, `write`, `debug`, `apply`
  serve `terminale`, con verifica sullo stato del filesystem virtuale invece che sul
  namespace Python.
- **Il progresso resta per esercizio**, quindi Leitner e coda di ripasso funzionano
  identici su tutti i rami senza toccarli.
- **Il ripasso va reso per ramo**, altrimenti mescola NumPy e PowerShell nella stessa
  sessione — cosa che non aiuta nessuno dei due.
- **Il service worker** già ricava i contenuti dall'indice: seguirà i rami da solo.

---

## 7. Decisioni ancora aperte

- ~~**Quanto in profondità simulare?**~~ **Deciso.** Filesystem, venti comandi POSIX,
  e per gli ambienti un solo modello: un interprete e' un percorso con dentro dei
  pacchetti, e il PATH decide quale risponde. Niente permessi, niente processi,
  niente rete, niente pipe — e il terminale lo dice quando incontra qualcosa che
  non supporta, invece di far finta.
- **Come si correggono gli esercizi di terminale.** Non con codice ma con un blocco
  dichiarativo (`cwd`, `esiste`, `contenuto`, `usa`, `stampa`, `errore`) che descrive
  lo stato finale atteso. Sta nel JSON accanto al testo, non c'e' niente da eseguire,
  e ogni soluzione viene rieseguita davvero da `tools/test_shell.mjs`.
- **I compiti sulla macchina vera si verificano?** Chiedere di incollare l'output e
  controllarlo con una regex è fragile ma reale. L'alternativa è l'autocertificazione.
- **Quanto Anaconda?** Se non ti servirà, tre lezioni concettuali bastano. Se il
  dipartimento lavora in conda, serve un modulo intero.
- **Un ramo o due per le shell?** Tenerli separati è più chiaro; un unico ramo "riga
  di comando" con le due varianti a confronto insegna meglio le differenze.
