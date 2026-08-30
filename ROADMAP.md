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

### Ramo B — Ambienti e pacchetti  ← **finito**

Il ramo che sblocca tutto il resto. Simulato, con il pannello di stato sempre visibile.

1. **Dove sta Python** — PATH, `which`, venv, pip, e le tre righe di diagnostica. **fatto**
2. **pip** — install, uninstall, `list`, `show`, `freeze`, e cosa significa davvero
   "installato": in quale Python
3. **venv** — creare, attivare, disattivare, perché l'attivazione è solo una modifica
   temporanea del PATH, cosa cambia nel prompt
4. **requirements e riproducibilita'** — `freeze`, `install -r`, `==` contro `>=`,
   il `.gitignore` che tiene fuori la cartella. **fatto**
5. **Conflitti** — quattro cause del `ModuleNotFoundError`, le tre righe di
   diagnostica, il file che oscura il pacchetto. **Il modulo diagnostico** — **fatto**
6. **conda e Anaconda** — le due cose che risolve e `venv` no, e il modo tipico in
   cui un ambiente conda si rompe: due registri che non si parlano. **fatto**
7. **VS Code** — i due Python dell'editor, e la disposizione che toglie il problema
   alla radice. **fatto**

Cinque moduli, 104 esercizi. Il ramo e' completo.

I moduli 5 e 7 sono i più preziosi: sono i problemi che avrai davvero.

### Ramo C — PowerShell (Windows)  ← **iniziato**

Simulato, filesystem virtuale in stile Windows.

1. **La pipeline a oggetti** — Verbo-Sostantivo, `Get-ChildItem`, `New-Item`,
   `Where-Object`, `Sort-Object`, `Select-Object`, `Measure-Object`,
   `Select-String`. **fatto** — e' la differenza che conta: nella pipeline
   passano oggetti con dei campi, non righe di testo
5. **Testo e file di dati** — `Select-String`, import/export CSV, JSON
6. **Script** — variabili, cicli, funzioni, execution policy
7. **Sistema** — processi, servizi, variabili d'ambiente, task pianificati
8. **cmd.exe** — una lezione sola: riconoscerlo, i quattro comandi che servono, perché
   non impararlo

### Ramo D — Linux  ← **fatto**

Stesso motore, dizionario POSIX. Serve appena toccherai un cluster di calcolo, un
Raspberry, un server, o WSL.

1. **Muoversi e maneggiare file** — `pwd`, `ls`, `cd`, percorsi, `mkdir`, `touch`,
   `cat`, redirezione, `cp`, `mv`, `rm`. **fatto** — cinque raccolte, una per gruppo
   di comandi
2. **Cercare, filtrare, comporre** — `grep`, `find`, `wc`, `head`, `tail`, `sort`,
   `uniq`, la pipe e la redirezione. **fatto**
3. **Permessi e sudo** — `chmod`, `chown`, e perché `sudo` non è la risposta a tutto.
   **fatto** — i permessi vivono nel filesystem simulato, `sudo` cambia davvero utente
4. **Processi** — `ps`, `kill`, background, `nohup`, `top`. **fatto** — tabella dei
   processi finta condivisa con PowerShell
5. **Variabili e script** — variabili, argomenti, `set -eu`. **fatto** — niente
   condizioni né cicli: quella è la parte di bash che assomiglia a un linguaggio, e
   per quella c'è il ramo Python
6. **WSL** — Linux dentro Windows: i due dischi, il confine, le fine riga. **fatto** —
   `/mnt/c` è esercitabile davvero, `wsl` no: si impara per predizione
7. **Cantiere Linux** — una campagna di prova da mettere in ordine in cinque fasi.
   **fatto** — la verifica guarda cosa resta sul disco, non i comandi digitati

Fuori **per ora**: condizioni e cicli in Bash, `ssh` e `scp`, `awk` e `sed`.
Sono tutti **in arrivo** nel piano di estensione: rispettivamente l20, l12 e
l10. Non fanno parte dei sei moduli gia' sviluppati.

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

### Ramo F — HTML, come e' fatta una pagina  ← **iniziato**

Ultimo perche' non e' prerequisito di niente. Non serve il terminale simulato,
ma **non** basta nemmeno il DOM del browser: la verifica deve dare lo stesso
verdetto anche nel controllo dei contenuti, che gira in node dove `DOMParser`
non esiste. Da qui `js/html.js`, un analizzatore scritto una volta e usato
nei due posti.

1. **Com'e' fatta una pagina** — il documento minimo, il markup semantico,
   href/src/alt/class/id. **fatto**
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
| 4 | **Ramo B — Ambienti** | ~~Da fare~~ **fatto**: cinque moduli, dal PATH a VS Code |
| 5 | **Ramo C — PowerShell** | ~~Da fare~~ **iniziato**: stesso motore, dizionario di cmdlet e pipeline a oggetti |
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

### Traguardi di infrastruttura

L'infrastruttura non deve inseguire ogni modulo con eccezioni speciali. Ogni
traguardo qui sotto è una capacità riusabile da tutti i rami e ha un criterio di
uscita verificabile; i contenuti nuovi si appoggiano alla piattaforma, non la
riscrivono.

| Traguardo | Capacità da aggiungere | Fatto quando |
|---|---|---|
| **I1 — Contratto dei contenuti** | Metadati uniformi per stato (`disponibile`), file, tipo (modulo/cantiere), prerequisiti e ordine; schema controllato per indice, moduli e traguardi. | Un modulo pianificato appare come *in arrivo* senza fetch falliti; uno disponibile ha un file, ID univoci e prerequisiti risolvibili. |
| **I2 — Controlli come porta di uscita** | Un comando di verifica che riunisce shell, progressione delle lezioni e soluzioni Python; controlli per ID duplicati, file orfani, riferimenti mancanti e cantiere non verificabile. | Ogni commit passa `test_shell`, `check_lezioni` e `check_content`; un riferimento rotto ferma il controllo prima del deploy. |
| **I3 — Progresso durevole** | Versione del formato di salvataggio, migrazioni piccole e verificabili, esportazione/importazione con anteprima e fusione per esercizio. | Un export vecchio può essere importato senza perdere statistiche; due dispositivi divergenti possono fondere il progresso senza azzerarlo. |
| **I4 — PWA rilasciabile** | Versione esplicita della cache, messaggio di aggiornamento, strategia testabile per asset e contenuti, prova offline. | Un push porta una versione coerente su GitHub Pages e il secondo avvio usa il nuovo service worker senza asset mescolati. |
| **I5 — Mondi simulati componibili** | Il terminale dichiara capacità e stato del mondo (filesystem, processi, pacchetti, rete, macchina remota, servizi) invece di accumulare eccezioni per ramo. | Un esercizio può creare uno scenario isolato e verificare stato finale, output ed errore atteso senza dipendere dall'esecuzione precedente. |
| **I6 — Autore e revisore** | Template di modulo/cantiere, fixture di scenario, checklist di accessibilità e matrice browser/mobile/offline. | Un nuovo modulo è leggibile su telefono, ha almeno una verifica reale per ogni soluzione e può essere revisionato senza conoscere il motore. |
| **I7 — Sync e accesso, solo quando serve** | Sincronizzazione opt-in prima del login; conflitti e privacy decisi prima della UI. | PC e telefono ritrovano gli stessi progressi; l'app resta pienamente usabile offline e senza account. |

---

## 7. Decisioni ancora aperte

- ~~**Quanto in profondità simulare?**~~ **Deciso.** Filesystem, ventidue comandi POSIX
  con pipe e redirezione,
  e per gli ambienti un solo modello: un interprete e' un percorso con dentro dei
  pacchetti, e il PATH decide quale risponde. Niente permessi, niente processi,
  niente rete, niente glob nei comandi — e il terminale lo dice quando incontra
  qualcosa che non supporta, invece di far finta.
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


---

## 8. Ramo D — estensione: da nuovo a esperto  ← **piano, tutto in arrivo**

Il ramo Linux copre oggi la prima colonna e mezza della mappa classica (file,
permessi, processi, ricerca e filtri, script, WSL). Questo e' il piano per
arrivare in fondo — fino a quello che serve per **amministrare** una macchina,
non solo per usarla. Nessuno di questi moduli e' scritto: sono tutti **in
arrivo**, elencati nell'ordine in cui vanno fatti.

Convenzione dei moduli gia' esistenti: una raccolta per comando o per gruppo
stretto di comandi, otto esercizi ciascuna, tipo `terminale` dove il
simulatore puo' eseguire davvero e `predict` dove fingerlo insegnerebbe il
finto.

### Ordine didattico completo

Il percorso non segue l'ordine alfabetico degli strumenti, ma i modelli mentali
che ciascuno richiede. Prima impari a non perdere file o processi; poi a rendere
ripetibile un lavoro; solo dopo a collegare, mantenere e mettere in sicurezza
una macchina. I cantieri sono verifiche di trasferimento: arrivano appena il
gruppo di moduli precedente permette di chiuderli senza indovinare.

| Passo | Modulo o cantiere | Perché qui |
|---:|---|---|
| 1–4 | l01 File · l02 ricerca · l03 permessi · l04 processi | Il terminale, i dati che contiene, i confini di accesso e i programmi che stanno girando. **fatti** |
| 5 | l04-bis Job control | Completa subito i processi con `bg` e `fg`, prima di affidare lavori a uno script. **in arrivo** |
| 6–8 | l05 script · l06 WSL · c04 Cantiere Linux | Trasformare una sequenza manuale in un lavoro ripetibile, farlo sul proprio PC e applicarlo a una campagna. **fatti** |
| 9–12 | l07 archivi/pacchetti · l08 editor/link · l09 utenti/gruppi · l10 testo avanzato | Gestire ciò che arriva dall'esterno, modificare una macchina remota, condividerla e trasformare dati in massa. **in arrivo** |
| 13 | l20 Script operativi | Condizioni, cicli, funzioni e Python: il confine fra una riga di shell e uno strumento affidabile. **in arrivo** |
| 14–17 | l11 rete · l12 remoto · l13 servizi · c05 Server | Prima fai comunicare le macchine, poi ci entri, poi lasci un servizio acceso e lo diagnostichi. **in arrivo** |
| 18–21 | l14 hardware/kernel · l15 prestazioni · l16 storage · c06 Cluster | Osservare la macchina fisica, diagnosticare i colli di bottiglia, progettare i dati e usare più nodi. **in arrivo** |
| 22–23 | l17 container · c07 Pipeline | Rendere un'analisi portabile e verificabile su portatile e cluster. **in arrivo** |
| 24–25 | l18 sicurezza · c08 Stazione | Indurire una macchina esposta e tenerla operativa senza perdere dati. **in arrivo** |
| 26 | l19 automazione a scala | Solo alla fine replichi la configurazione: automatizzare un errore su dieci macchine è peggio che farlo una volta. **in arrivo** |

### Stadio 1 — completare le basi (colonna rossa)

**l04-bis — Controllare i job interattivi** ← **in arrivo**
Raccolte: `&`, `jobs`, `bg` e `fg` · sospendere e riprendere un lavoro ·
quando usare `nohup` o `tmux` invece del controllo interattivo.
Perche': l04 oggi copre processi, segnali e sottofondo; questo completa i
comandi di job control della mappa di base senza fingere che siano identici a
un servizio persistente.
Motore: richiede che il parser del terminale mantenga lo stato dei job sospesi
e del processo in primo piano. Finche' non c'e', gli esempi restano
esplicitamente `predict`.

**l07 — Archivi, pacchetti e spazio**
Raccolte: `tar` · `gzip e gunzip` · formati di pacchetto (`.deb`, `.rpm`,
snap e Flatpak) · `apt` (con `dnf` e `pacman` a confronto) · `df, du, free,
uname`.
Perche': i dati arrivano e partono compressi, il software si installa da un
gestore e non da un sito, e "il job e' morto" nove volte su dieci e' disco
pieno o memoria finita.
Motore: `tar`/`gzip` sono file nel filesystem virtuale, si simulano bene. Per
`apt` serve un **elenco di pacchetti finto** con dipendenze, sulla falsariga
del modello degli ambienti Python. `df`/`free` sono numeri inventati coerenti.

**l08 — Editor nel terminale, e i link**
Raccolte: `nano` · `vim, e come uscirne` · `ln e ln -s` · `rmdir e la pulizia`.
Perche': su una macchina remota non c'e' VS Code, e prima o poi ci si trova
dentro `vim` senza sapere come si esce. I link simbolici sono il modo in cui
mezzo sistema e' tenuto insieme (`/usr/bin/python` in testa).
Motore: serve un **editor a schermo dentro il terminale simulato** — la cosa
piu' invasiva di tutto il piano. In alternativa: `nano` a schermo vero, `vim`
solo per predizione (i tasti, la modalita', `:wq`).

**l09 — Utenti, gruppi e permessi speciali**
Raccolte: `useradd e passwd` · `groups, usermod e chgrp` ·
`/etc/passwd e /etc/group` · `setuid, setgid, sticky bit`.
Perche': completa l03. Il bit `s` su `passwd` e lo sticky su `/tmp` spiegano
come mai certi programmi possono fare cose che tu non puoi.
Motore: il filesystem virtuale ha gia' proprietario e modo; servono i gruppi e
un file `/etc/passwd` leggibile. Tutto simulabile.

**l10 — Testo avanzato: sed, awk, xargs**
Raccolte: `sed` · `awk` · `xargs` · `cut, tr e tee`.
Perche': la seconda meta' di l02. Estrarre una colonna, sostituire in massa,
applicare un comando a mille file. E' il punto in cui la shell smette di
cercare e comincia a trasformare.
Motore: `cut`, `tr`, `tee` sono banali. `sed` con la sola `s///` e `awk` con i
soli campi `$1`, `$3` e `NR` coprono il novanta per cento dell'uso reale —
oltre non si va, e va detto nella lezione.

**l20 — Script operativi: Bash e Python** ← **in arrivo**
Raccolte: Bash con condizioni, cicli, funzioni, input/output standard, codici
di uscita e `trap` · script Python per automazione di file, log e comandi ·
quando scegliere l'uno o l'altro.
Perche': l05 insegna a non avere paura di uno script breve; qui si arriva agli
script che controllano un processo ripetibile e segnalano un errore senza
richiedere un amministratore a ogni passaggio.
Motore: Bash resta nel terminale simulato con un sottoinsieme dichiarato;
Python usa Pyodide, come il ramo Python, e gli esercizi verificano artefatti e
codici di uscita anziche' simulare una macchina reale.

### Stadio 2 — la macchina come servizio (colonna verde)

**l11 — Rete**
Raccolte: `ip e ifconfig` · `ping e traceroute` · `ss e netstat` ·
`dig, nslookup e resolvectl` per la risoluzione dei nomi · `nmcli e
NetworkManager` · `ethtool`.
Perche': **e' il buco strutturale del percorso.** Meta' dei guasti e meta'
degli attacchi vivono qui, e oggi nessun ramo ne parla.
Motore: serve un **modello di rete finto** — interfacce, indirizzi, tabella di
routing, porte in ascolto, una zona DNS. E' il pezzo di motore piu' grosso del
piano, e da solo abilita anche l12 e parte di l19.

**l12 — La macchina remota**
Raccolte: `ssh` · `chiavi ssh` · `scp e rsync` · `~/.ssh/config e sshd_config` ·
`tmux`.
Perche': **la lacuna numero uno per te.** Senza questo il cluster non lo
tocchi. `tmux` sta qui perche' un job lungo lanciato via ssh muore quando cade
la connessione, ed e' la lezione di l04 vista da lontano.
Motore: serve una **seconda macchina finta** — un secondo filesystem
virtuale con un suo utente — e `ssh` che sposta la sessione da uno all'altro.
Concettualmente semplice, e rende esercitabili anche `scp` e `rsync`.

**l13 — Servizi, log e lavori periodici**
Raccolte: `systemctl` · `scrivere una unit` · `journalctl, dmesg e syslog` ·
`cron e systemd-timer` · `logrotate` · backup ripetibili con controllo del
ripristino.
Perche': un programma che deve girare sempre non si lancia a mano. E quando
qualcosa si rompe, la risposta e' nei log — se sai dove sono.
Motore: le unit sono file nel filesystem, lo stato dei servizi e' una tabella
finta come quella dei processi di l04. Il log e' un file che cresce.

**l14 — Hardware e kernel**
Raccolte: `lspci, lshw, dmidecode` · `lsmod e modprobe` · `/proc e /sys` ·
`sysctl`.
Perche': serve quando colleghi una scheda di acquisizione, un ricevitore SDR o
una GPU e il sistema non la vede. `/proc` e' il punto in cui si capisce che in
Unix tutto e' un file, davvero.
Motore: `/proc` e `/sys` sono cartelle finte nel filesystem virtuale — la
simulazione qui e' piu' fedele che altrove, perche' sul serio sono file.

### Stadio 3 — amministrare sul serio (colonna blu)

**l15 — Prestazioni e diagnosi**
Raccolte: `top, vmstat, iostat` · `strace e bpftrace` · `perf` · `cgroups e
namespaces` · `hdparm e tuned`.
Perche': la domanda "perche' e' lento" ha cinque risposte possibili (CPU,
memoria, disco, rete, attesa) e strumenti diversi per distinguerle. `cgroups` e
`namespaces` sono anche il pavimento dei container, quindi preparano l17.
Motore: numeri finti coerenti fra un comando e l'altro. Molto `predict`: qui
conta leggere l'uscita, non digitare il comando.

**l16 — Dischi, filesystem e volumi**
Raccolte: `mount e /etc/fstab` · `fdisk e mkfs` · `ext4, xfs, btrfs, zfs` ·
`LVM` · `RAID con mdadm` · `LUKS e dm-crypt`.
Perche': e' il modulo che ti fa passare da "uso un disco" a "progetto lo
storage": quale filesystem per dati di campagna, come si aggiunge spazio senza
spegnere, cosa protegge davvero il RAID (e cosa no: **non e' un backup**).
Motore: dischi e volumi finti, con lo stato che cambia. `mount` e' un'ottima
lezione perche' spiega anche `/mnt/c` di WSL.

**l17 — Container e virtualizzazione**
Raccolte: `docker run e le immagini` · `scrivere un Dockerfile` ·
`volumi e reti` · `Apptainer sui cluster` · `KVM, QEMU, libvirt`.
Perche': e' la versione seria del problema che il ramo *Ambienti e pacchetti*
affronta con `venv` e `conda`, ed e' il modo standard di portarsi dietro un
ambiente che funziona anche sul cluster dell'universita'.
Motore: immagini e container come tabella finta, il Dockerfile come file da
scrivere e verificare riga per riga — vicino agli esercizi `html`, che gia'
verificano un file scritto a mano.

**l18 — Sicurezza del sistema**
Raccolte: `ufw e firewalld` · `iptables e nftables` · `SELinux e AppArmor` ·
`capabilities` · `PAM` · `l'igiene di un server esposto`.
Perche': chiude la colonna blu, e insieme a l11 e l12 e' il pavimento di
qualunque percorso di sicurezza. Tutto difensivo: indurire una macchina tua,
non entrare in quelle degli altri.
Motore: le regole del firewall sono uno stato che si legge e si modifica, come
i permessi. Va scritto dopo l11, perche' senza il modello di rete non ha senso.

**l19 — Automazione a scala**
Raccolte: `Ansible: inventario e playbook` · `idempotenza` ·
`ruoli e riuso` · `Puppet e Chef, in che cosa differiscono`.
Perche': l'ultimo passo e' smettere di amministrare a mano. Dieci macchine
configurate a colpi di `ssh` divergono in un mese; un playbook e' la
configurazione scritta una volta e applicabile all'infinito.
Motore: quasi tutto `predict` e lettura di YAML. Un playbook applicato al
filesystem finto e' fattibile, ma e' l'ultimo pezzo e il meno urgente.

### Cantieri (progetti aperti, fuori dalla coda di ripasso)

- **c05 — Il server che regge** (dopo l13): un servizio che deve restare in
  piedi. Unit, log, rotazione, job periodico, backup verificato con ripristino
  e un guasto da diagnosticare leggendo `journalctl` e syslog.
- **c06 — Il cluster in miniatura** (dopo l16): quattro macchine finte, chiavi
  ssh, storage condiviso, un job lanciato da remoto che sopravvive alla
  disconnessione, i risultati riportati indietro con `rsync`. Il risultato non
  e' «il comando ha risposto»: e' un job rintracciabile, dati integri e spazio
  richiesto in modo ragionevole.
- **c07 — La pipeline riproducibile** (dopo l17): la stessa analisi di c04,
  ma dentro un container, con un `Dockerfile` che chiunque puo' rieseguire.
  Deve produrre lo stesso artefatto sia in locale sia sul nodo finto.
- **c08 — La stazione che non dorme** (dopo l18 e l20): una ground station
  simulata con ricevitore, servizio di acquisizione, rete, firewall, storage,
  backup, log e pipeline containerizzata. Si valutano avvio dopo un blackout,
  recupero da disco quasi pieno e accesso minimo necessario: il primo cantiere
  che verifica una piccola infrastruttura intera, non un comando alla volta.

### Note sul piano

- **L'ordine conta piu' della completezza.** l11 (rete) e l12 (remoto) valgono,
  per uno studente di aerospaziale, piu' di tutto lo stadio 3 messo insieme:
  sono quelli che aprono il cluster. Se il tempo finisce, finisce dopo l13.
- **Tre pezzi di motore da costruire**, in ordine di costo: la seconda macchina
  per `ssh` (piccola), l'elenco pacchetti per `apt` (media), il modello di rete
  per l11 (grande). L'editor a schermo di l08 e' opzionale: `nano` si puo'
  aggirare insegnando `echo` e `cat`, come si fa oggi.
- **Dove il simulatore non arriva, si dichiara.** La regola del ramo resta
  quella: meglio un `predict` onesto che un comando finto che risponde sempre
  di si'.
- **Corrispondenza con le certificazioni**, per chi volesse un riscontro
  esterno: stadio 1 e 2 coprono in larga parte LFCS; stadi 1-3 insieme sono
  l'area di RHCSA, con l18 e l19 che sconfinano in RHCE.


---

## 9. Cosa manca per un percorso davvero completo  ← **tutto in arrivo**

Il piano del ramo Linux (§8) chiude quel ramo. Questi sono i buchi che restano
**fuori** da Linux, e che oggi impediscono di dire "il percorso e' completo".
In ordine di urgenza, non di difficolta'.

1. **git** — *il buco piu' grave dell'intero percorso.* Senza versionamento uno
   strumento vive in una cartella che nessuno vede, non c'e' modo di tornare
   indietro da una modifica sbagliata, e collaborare significa scambiarsi file
   per email. Va fatto come **ramo suo**, non come modulo: `commit`, branch,
   merge e conflitti, remote, e cosa NON si mette in un repository (i dati
   grezzi di una campagna). Simulabile bene: e' un grafo e un filesystem, che
   sono cose che il motore gia' sa rappresentare.
2. **matplotlib** — nel ramo *Librerie Python* si calcola e non si disegna. Una
   relazione senza grafici non esiste, ed e' la prima cosa che chiede un
   relatore. Difficolta' vera: verificare un grafico non e' verificare un
   numero — si controlla la struttura della figura (assi, serie, etichette),
   non i pixel.
3. **pandas** — NumPy regge le matrici, non le tabelle con nomi di colonna e
   dati misti. Un CSV di campagna con testo, numeri e buchi e' pandas, non
   NumPy. Va dopo NumPy e prima di qualunque cosa seria sui dati.
4. **Espressioni regolari** — trasversali: servono in `grep`, in `sed`, in
   Python, negli editor. Oggi compaiono di sfuggita e non sono mai spiegate.
   Modulo corto, resa altissima.
5. **SciPy** — integrazione, ottimizzazione, interpolazione, FFT, statistica.
   È il pezzo che trasforma NumPy in uno strumento di ingegneria: `solve_ivp`
   al posto di un Eulero scritto a mano, `curve_fit` per una taratura, la FFT
   per un'analisi di vibrazioni.
6. **SLURM e le code** — sta sopra il traguardo *cluster*: `sbatch`, `squeue`,
   uno script di sottomissione, quanta memoria chiedere e cosa succede se
   sbagli. Senza, `ssh` da solo apre la porta ma non fa entrare.
7. **Jupyter** — dove l'analisi esplorativa si fa davvero, e dove si prendono le
   peggiori abitudini (celle eseguite fuori ordine, stato invisibile). Un
   modulo che insegna a usarlo *e* a sapere quando abbandonarlo per uno script.
8. **Test e verifica del proprio codice** — `assert`, casi limite, `pytest` di
   base. Per un ingegnere e' la domanda "come faccio a sapere che il risultato
   e' giusto", che e' il mestiere.
9. **Compilare codice altrui** — `gcc`, `make`, un `configure` che fallisce, le
   librerie di sviluppo mancanti. Serve la prima volta che un solutore CFD non
   arriva come pacchetto ma come sorgente.
10. **Reti, a fondo** — TCP/IP, DNS, TLS. Il modulo l11 del piano Linux ne
    insegna l'uso pratico; capirle davvero e' un'altra cosa, ed e' il
    prerequisito serio per qualunque percorso di sicurezza.

Fuori piano per scelta, con la ragione: **C e assembly** (un altro mestiere,
non un modulo), **sviluppo web** (irrilevante qui), **machine learning** (senza
pandas, SciPy e statistica prima sarebbe una scatola nera addestrata a caso).
