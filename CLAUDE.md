# Regole del progetto

App di studio statica (nessun build, nessun npm). Contenuto in `content/*.json`,
motore in `js/`, controlli in `tools/`. Si pubblica con un push su `main`:
GitHub Pages serve `origin/main`, quindi **push = pubblicato**.

Chi lavora qui — persona o agente — segue queste regole.

## 1. Non rompere quello che c'è

Il 2026-08-30 una sessione ha creato il simulatore dei dischi in `js/storage.js`,
che era il modulo dei progressi: `S.load()` è sparito, l'app è diventata una
pagina bianca su tutti i dispositivi, e nessun test se n'è accorto. Da lì queste
regole.

- **Mai scrivere su un file che esiste già senza averlo letto prima.** Un file
  nuovo si crea con un nome che non esiste: controllalo con `ls js/`.
- **Un modulo nuovo del motore = un file nuovo.** Nomi già presi:
  `app storage runner scheduler percorso md vfs shell ambienti powershell html
  frasi processi sistema utenti testo rete remoto servizi hardware prestazioni
  dischi container sicurezza automazione traguardi`.
- **Prima di cominciare**: `git pull --rebase`. Alla fine: commit e push, senza
  lasciare lavoro non pubblicato.
- **Una sessione alla volta.** Due agenti sugli stessi JSON si sovrascrivono
  senza accorgersene. Se ne stanno girando due, fermane una.
- **Prima di ogni commit**, tutti e quattro:

  ```bash
  node tools/check_app.mjs && node tools/test_shell.mjs && python tools/check_lezioni.py && python tools/check_moduli.py
  ```

  Se uno fallisce non si committa: si sistema.
- **Ogni file nuovo in `js/` va aggiunto al `PRECACHE` di `sw.js`**, altrimenti
  l'app funziona online e resta bianca offline. `check_app.mjs` lo verifica.

## 2. Che cosa deve essere un esercizio

**L'obiettivo dell'app è formare specialisti giocando.** Un esercizio che si
risolve con un comando copiato dalla lezione non insegna niente: insegna a
copiare. La difficoltà deve crescere lungo il ramo, e ogni modulo deve dare per
acquisito quello che viene prima.

Regole di forma — le verifica `tools/check_moduli.py`:

- **24 esercizi per modulo**, in **3 raccolte da 8** (una per comando o per
  gruppo stretto di comandi). Meno di così è una bozza, non un modulo.
- **Almeno il 40% degli esercizi è composto**: più comandi in sequenza o in
  pipe, non una riga sola.
- **Ogni raccolta finisce con uno scenario**: gli ultimi due esercizi di ogni
  raccolta mettono insieme il comando nuovo con almeno un comando dei moduli
  precedenti.
- **Ogni modulo dal terzo in poi riusa comandi dei moduli precedenti** in
  almeno un terzo dei suoi esercizi. Il vocabolario non si azzera a ogni
  modulo: si accumula.

Regole di sostanza — non automatizzabili, ma non negoziabili:

- **Il nome del comando si scioglie la prima volta.** `ls` e' *list*, `cd` e'
  *change directory*, `chmod` e' *change mode*, `grep` viene da *g/re/p*. Un
  nome che significa qualcosa si ricorda; tre lettere a caso si ripassano ogni
  volta. La lezione che introduce un comando dice da dove viene il nome.
- **Lo scenario prima del comando.** «Il banco ha smesso di scrivere alle 3:12,
  trova perché» è un esercizio; «usa `journalctl -u X`» è una didascalia.
  Il testo descrive una situazione da laboratorio, da cluster o da volo, e
  lascia scegliere gli strumenti.
- **Niente comandi finti.** Un comando del simulatore che stampa sempre la
  stessa riga insegna una bugia. O si modella lo stato — e il comando lo legge e
  lo modifica davvero — oppure quell'argomento si insegna con un `predict`
  onesto, dicendo nella lezione che sulla macchina vera è diverso.
- **Ogni esercizio `terminale` ha una `verifica` che guarda lo stato**, non solo
  `usa`. Se l'unica verifica è quale comando hai digitato, l'esercizio non
  controlla se hai ottenuto qualcosa.
- **La difficoltà sale dentro la raccolta**: 1-3 il comando da solo, 4-6 con le
  opzioni che contano, 7-8 lo scenario che combina. Il campo `difficolta` lo
  dichiara (2 base, 3 composto, 4 scenario).
- **Guasti veri, non esercizi di stile.** I casi migliori vengono da come si
  rompono le cose davvero: disco pieno, permesso sbagliato dopo un `sudo`,
  variabile vuota, log ruotato, servizio che non riparte dopo il riavvio, chiave
  ssh con i permessi troppo aperti.
- **Ogni soluzione viene rieseguita dai test.** `tools/test_shell.mjs` esegue le
  soluzioni `terminale` contro la loro stessa `verifica`: se un esercizio non
  passa, l'esercizio è sbagliato, non il test.

## 3. Convenzioni di contenuto

- L'id di un esercizio comincia con l'id del modulo (`l07-ta-3`): la vista di
  ripasso ricava il modulo da lì.
- Le lezioni introducono ogni comando **prima** che un esercizio lo usi:
  `check_lezioni.py` fallisce se un esercizio usa qualcosa di mai spiegato.
- I moduli pianificati stanno nell'indice con `"disponibile": false`: l'app li
  mostra come carte "in arrivo".
- I traguardi (`content/traguardi.json`) dichiarano il proprio ramo e i moduli
  che richiedono. Un modulo nuovo va agganciato al traguardo che serve.
- Italiano, tono asciutto, niente esclamativi, niente complimenti per cose non
  fatte.
