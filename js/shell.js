// Interprete di comandi sopra il filesystem virtuale.
//
// Un dizionario nome -> funzione, cosi' i rami che verranno (POSIX, PowerShell,
// pip e venv) aggiungono comandi senza toccare il parser. La funzione riceve gli
// argomenti gia' separati e restituisce il testo da stampare.

import * as V from "./vfs.js";
import { opzioneIgnota } from "./opzioni.js";

export function creaShell(iniziale = {}, opzioni = {}) {
  const fs = V.crea(iniziale);
  fs.cwd = opzioni.cwd ? V.normalizza(fs, opzioni.cwd) : V.HOME;
  if (!fs.nodi.has(fs.cwd)) V.creaDir(fs, fs.cwd, true);
  return {
    fs,
    env: { PATH: "/usr/bin:/bin", HOME: V.HOME, ...(opzioni.env || {}) },
    comandi: { ...POSIX, ...(opzioni.comandi || {}) },
    storia: [],
  };
}

/**
 * Divide una riga in parole rispettando le virgolette, e riconosce le
 * redirezioni > e >>. La riga arriva qui gia' spezzata sulle pipe.
 *
 * Non e' una shell vera: niente variabili nei comandi, niente glob, niente
 * sostituzione di comando. Sono le tre cose che aggiungerebbero piu' codice di
 * tutto il resto messo insieme, e nessuna delle tre serve a insegnare le altre.
 */
export function dividi(riga) {
  const parole = [];
  // Fra apici singoli il dollaro non si espande, e ">" o "|" non sono operatori:
  // e' l'unico modo per scrivere uno script con echo senza che la riga venga
  // eseguita dalla shell di fuori.
  const letterali = [];
  let corrente = "";
  let virgoletta = null;
  let aperta = false;
  let letterale = false;
  const chiudi = () => {
    if (corrente || aperta) {
      parole.push(corrente);
      letterali.push(letterale);
    }
    corrente = "";
    aperta = false;
    letterale = false;
  };
  for (const c of riga) {
    if (virgoletta) {
      if (c === virgoletta) virgoletta = null;
      else corrente += c;
      continue;
    }
    if (c === '"' || c === "'") {
      virgoletta = c;
      aperta = true;
      if (c === "'") letterale = true;
      continue;
    }
    if (c === " " || c === "	") {
      chiudi();
      continue;
    }
    corrente += c;
  }
  chiudi();

  // La redirezione si stacca qui: i comandi non devono saperne niente.
  let redirezione = null;
  for (let i = 0; i < parole.length; i++) {
    if (!letterali[i] && (parole[i] === ">" || parole[i] === ">>")) {
      redirezione = { modo: parole[i], file: parole[i + 1] };
      parole.splice(i, 2);
      letterali.splice(i, 2);
      break;
    }
  }
  return { parole, redirezione, letterali };
}

/** Esegue una riga. Restituisce sempre un oggetto: gli errori non si sollevano. */
export function esegui(sh, riga) {
  const testo = riga.trim();
  if (!testo || testo.startsWith("#")) return { out: "", errore: null };
  sh.storia.push(testo);

  // La pipe si risolve qui: ogni pezzo riceve come ingresso l'uscita del
  // precedente. I comandi non ne sanno niente — leggono da sh.stdin quando non
  // ricevono un nome di file, ed e' l'unica cosa che devono sapere.
  // Assegnazione di variabile: NOME=valore, senza spazi attorno all'uguale.
  // E' una riga a se' e non un comando, ed e' il motivo per cui in bash
  // "NOME = valore" con gli spazi non funziona — diventa il comando NOME.
  const primaDelleSostituzioni = sostituisciComandi(sh, testo);
  if (primaDelleSostituzioni.errore) return { out: "", errore: primaDelleSostituzioni.errore };
  const conComandi = primaDelleSostituzioni.riga;

  const assegnazione = conComandi.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (assegnazione) {
    sh.env[assegnazione[1]] = espandi(sh, assegnazione[2].replace(/^["']|["']$/g, ""));
    return { out: "", errore: null };
  }

  const pezzi = spezzaSuPipe(conComandi);
  let ingresso = null;
  let ultimo = { out: "", errore: null };

  for (let i = 0; i < pezzi.length; i++) {
    const { parole: grezze, redirezione: redGrezza, letterali } = dividi(pezzi[i]);
    let parole, redirezione;
    try {
      // Una variabile vuota SPARISCE: "mkdir -p $1" senza argomenti diventa
      // "mkdir -p", non "mkdir -p ''". E' il motivo per cui l'errore che leggi
      // parla del comando e non della variabile che mancava.
      parole = grezze
        .map((p, k) => (letterali[k] ? p : espandi(sh, p)))
        .filter((p, k) => p !== "" || grezze[k] === "");
      redirezione = redGrezza && { ...redGrezza, file: espandi(sh, redGrezza.file ?? "") };
    } catch (e) {
      if (e instanceof V.ErroreFs) return { out: "", errore: e.message };
      throw e;
    }
    const sottofondo = parole.at(-1) === "&";
    if (sottofondo) {
      // Una & e' un operatore di shell, non un argomento del programma. Per
      // restare onesti non simuliamo combinazioni ambigue (pipe/redirezione in
      // sottofondo); quelle non servono ai moduli e meritano una shell vera.
      if (pezzi.length !== 1 || redirezione)
        return { out: "", errore: "&: pipe e redirezioni in sottofondo non sono simulate" };
      parole.pop();
      if (!parole.length) return { out: "", errore: "&: manca il comando" };
      const avvia = parole[0] === "nohup" ? sh.comandi.nohup : sh.comandi.avvia;
      if (!avvia) return { out: "", errore: "&: job control non disponibile in questo esercizio" };
      const argomenti = parole[0] === "nohup" ? parole.slice(1) : parole;
      try {
        const out = formatta(avvia(sh, argomenti) ?? "");
        return { out, errore: null };
      } catch (e) {
        if (e instanceof V.ErroreFs) return { out: "", errore: `&: ${e.message}` };
        throw e;
      }
    }
    const nome = parole[0];
    if (!nome) return { out: "", errore: "manca un comando attorno alla pipe" };
    const fn = sh.comandi[nome];
    if (!fn) return { out: "", errore: `${nome}: comando non trovato` };
    // Le opzioni si controllano qui, prima del comando: un trattino che il
    // simulatore non implementa deve dirlo, non sparire in silenzio.
    const problema = opzioneIgnota(nome, parole.slice(1));
    if (problema) {
      sh.env["?"] = "1";
      sh.esito = null;
      return { out: "", errore: problema };
    }

    sh.stdin = ingresso;
    try {
      // Un comando puo' restituire testo oppure oggetti. Nella pipe passa il
      // valore grezzo — e' la differenza fra una shell POSIX e PowerShell, e
      // qui serve poterle rappresentare entrambe con lo stesso motore.
      const valore = fn(sh, parole.slice(1)) ?? "";
      const out = formatta(valore);
      if (redirezione) {
        if (!redirezione.file) return { out: "", errore: "manca il nome del file dopo >" };
        const testoOut = out.endsWith("\n") || out === "" ? out : out + "\n";
        if (redirezione.modo === ">") V.scrivi(sh.fs, redirezione.file, testoOut);
        else V.aggiungi(sh.fs, redirezione.file, testoOut);
        ultimo = { out: "", errore: null };
      } else {
        ultimo = { out, errore: null };
      }
      ingresso = valore;
    } catch (e) {
      if (e instanceof V.ErroreFs) {
        // Il codice di uscita si aggiorna anche qui, non solo dentro gli script:
        // "$?" deve rispondere pure quando provi un comando a mano.
        sh.env["?"] = "1";
        sh.esito = null;
        return { out: "", errore: `${nome}: ${e.message}` };
      }
      throw e;
    } finally {
      sh.stdin = null;
    }
  }
  // Un comando puo' dichiarare il proprio codice di uscita in sh.esito: e' cosi'
  // che "test" risponde, e che "grep" dice "non ho trovato niente" senza che
  // sia un errore.
  sh.env["?"] = String(sh.esito ?? 0);
  sh.esito = null;
  return ultimo;
}

/**
 * $(comando) sostituito con la sua uscita. Si fa sulla riga intera perche' il
 * comando dentro contiene spazi; gli apici singoli lo proteggono, come in bash.
 */
function sostituisciComandi(sh, riga) {
  if (!riga.includes("$(")) return { riga };
  let fuori = "";
  let virgoletta = null;
  for (let i = 0; i < riga.length; i++) {
    const c = riga[i];
    if (virgoletta) {
      if (c === virgoletta) virgoletta = null;
      fuori += c;
      continue;
    }
    if (c === "'" || c === '"') {
      virgoletta = c;
      fuori += c;
      continue;
    }
    if (c === "$" && riga[i + 1] === "(") {
      let profondita = 1;
      let dentro = "";
      let j = i + 2;
      for (; j < riga.length && profondita > 0; j++) {
        if (riga[j] === "(") profondita++;
        else if (riga[j] === ")") profondita--;
        if (profondita > 0) dentro += riga[j];
      }
      if (profondita > 0) return { errore: "manca la parentesi di chiusura in $(" };
      const r = esegui(sh, dentro);
      if (r.errore) return { errore: r.errore };
      fuori += (r.out ?? "").trimEnd().split("\n").join(" ");
      i = j - 1;
      continue;
    }
    fuori += c;
  }
  return { riga: fuori };
}

/**
 * Il corpo di uno script: righe normali, blocchi if/for e definizioni di
 * funzione. Torna quando il blocco finisce o quando lo script esce.
 */
function eseguiBlocco(sh, righe, stato) {
  for (let i = 0; i < righe.length; i++) {
    if (stato.uscito) return;
    const riga = righe[i].trim();
    if (!riga || riga.startsWith("#")) continue;

    if (riga.startsWith("set ")) {
      const opz = riga.slice(4).replace(/-/g, "");
      if (opz.includes("e")) stato.fermaSuErrore = true;
      if (opz.includes("u")) sh.severo = true;
      continue;
    }

    // trap 'comando' EXIT
    const trap = riga.match(/^trap\s+(.+)\s+EXIT$/);
    if (trap) {
      stato.trap = trap[1].replace(/^["']|["']$/g, "");
      continue;
    }

    // nome() { ... }  — la definizione si registra, non si esegue
    const definizione = riga.match(/^(\w+)\s*\(\)\s*\{?$/);
    if (definizione) {
      const [corpo, fine] = raccogliFino(righe, i + 1, ["}"], []);
      sh.funzioni[definizione[1]] = corpo;
      i = fine;
      continue;
    }

    if (riga.startsWith("if ")) {
      i = eseguiSe(sh, righe, i, stato);
      continue;
    }

    if (riga.startsWith("for ")) {
      i = eseguiPer(sh, righe, i, stato);
      continue;
    }

    esegiRigaScript(sh, riga, stato);
  }
}

/** Raccoglie le righe fino a una delle parole di chiusura, contando i blocchi
 *  annidati: senza, un if dentro un for chiuderebbe quello sbagliato. */
function raccogliFino(righe, da, chiusure, intermedie) {
  const corpo = [];
  const sezioni = { corpo };
  let attuale = corpo;
  let profondita = 0;
  for (let i = da; i < righe.length; i++) {
    const riga = righe[i].trim();
    const apre = /^(if |for |while )/.test(riga) || /^\w+\s*\(\)\s*\{?$/.test(riga);
    const chiude = ["fi", "done", "}"].includes(riga);
    if (profondita === 0 && chiusure.includes(riga)) return [sezioni, i, attuale === corpo ? null : attuale];
    if (profondita === 0 && intermedie.includes(riga)) {
      attuale = sezioni[riga] = [];
      continue;
    }
    if (apre) profondita++;
    if (chiude) profondita--;
    attuale.push(righe[i]);
  }
  throw new V.ErroreFs(`manca ${chiusure.join(" o ")}`);
}

function eseguiSe(sh, righe, i, stato) {
  const condizione = righe[i].trim().replace(/^if\s+/, "").replace(/;\s*then$/, "").trim();
  const [sezioni, fine] = raccogliFino(righe, i + 1, ["fi"], ["else"]);
  esegiRigaScript(sh, condizione, stato, true);
  const vero = sh.env["?"] === "0";
  const ramo = vero ? sezioni.corpo : sezioni.else || [];
  eseguiBlocco(sh, ramo, stato);
  return fine;
}

function eseguiPer(sh, righe, i, stato) {
  const testa = righe[i].trim().match(/^for\s+(\w+)\s+in\s+(.+?)(?:;\s*do)?$/);
  if (!testa) throw new V.ErroreFs("usa: for NOME in ELENCO; do");
  const [sezioni, fine] = raccogliFino(righe, i + 1, ["done"], []);
  const conComandi = sostituisciComandi(sh, testa[2]);
  if (conComandi.errore) throw new V.ErroreFs(conComandi.errore);
  const elenco = espandi(sh, conComandi.riga).split(/\s+/).filter(Boolean);
  for (const valore of elenco) {
    if (stato.uscito) break;
    sh.env[testa[1]] = valore;
    eseguiBlocco(sh, sezioni.corpo, stato);
  }
  return fine;
}

/** Una riga dentro uno script: funzione, exit, oppure un comando normale. */
function esegiRigaScript(sh, riga, stato, condizione = false) {
  const { parole: grezze, letterali } = dividi(riga);
  const parole = grezze.map((x, k) => (letterali[k] ? x : espandi(sh, x)));
  const nome = parole[0];

  if (nome === "exit") {
    stato.uscito = true;
    stato.codice = Number(parole[1] ?? 0);
    sh.env["?"] = String(stato.codice);
    return;
  }

  if (sh.funzioni && sh.funzioni[nome]) {
    // Gli argomenti della funzione coprono $1..$n per la durata della chiamata.
    const prima = { ...sh.env };
    parole.slice(1).forEach((a, n) => (sh.env[String(n + 1)] = a));
    sh.env["#"] = String(parole.length - 1);
    eseguiBlocco(sh, sh.funzioni[nome].corpo ?? sh.funzioni[nome], stato);
    sh.env = { ...sh.env, ...Object.fromEntries(Object.entries(prima).filter(([k]) => /^\d+$|^#$/.test(k))) };
    return;
  }

  const r = esegui(sh, riga);
  if (r.errore) {
    sh.env["?"] = "1";
    if (stato.fermaSuErrore) {
      stato.codice = 1;
      if (stato.trap) {
        const t = stato.trap;
        stato.trap = null;
        esegiRigaScript(sh, t, stato);
      }
      throw new V.ErroreFs(`${stato.file}: ${r.errore}`);
    }
    stato.uscite.push(`${stato.file}: ${r.errore}`);
  }
  if (r.out) stato.uscite.push(r.out);
}

/** Gli operatori di test che si usano davvero. */
function valutaTest(sh, args) {
  const vero = () => {
    sh.esito = 0;
    return "";
  };
  const falso = () => {
    sh.esito = 1;
    return "";
  };
  const [a, b, c] = args;

  if (args.length === 2) {
    if (a === "-f") return V.eFile(sh.fs, b) ? vero() : falso();
    if (a === "-d") return V.eDir(sh.fs, b) ? vero() : falso();
    if (a === "-e") return V.esiste(sh.fs, b) ? vero() : falso();
    if (a === "-z") return (b ?? "") === "" ? vero() : falso();
    if (a === "-n") return (b ?? "") !== "" ? vero() : falso();
    throw new V.ErroreFs(`operatore non supportato: ${a}`);
  }
  if (args.length === 3) {
    const numerico = (x) => Number(x);
    switch (b) {
      case "=":
      case "==": return a === c ? vero() : falso();
      case "!=": return a !== c ? vero() : falso();
      case "-eq": return numerico(a) === numerico(c) ? vero() : falso();
      case "-ne": return numerico(a) !== numerico(c) ? vero() : falso();
      case "-gt": return numerico(a) > numerico(c) ? vero() : falso();
      case "-lt": return numerico(a) < numerico(c) ? vero() : falso();
      case "-ge": return numerico(a) >= numerico(c) ? vero() : falso();
      case "-le": return numerico(a) <= numerico(c) ? vero() : falso();
      default: throw new V.ErroreFs(`operatore non supportato: ${b}`);
    }
  }
  if (args.length === 1) return (a ?? "") !== "" ? vero() : falso();
  throw new V.ErroreFs("test vuole due o tre argomenti");
}

/**
 * Da qualunque cosa un comando abbia restituito al testo da mostrare.
 * Gli oggetti diventano una tabella con le intestazioni, come fa PowerShell:
 * e' li' che si vede che nella pipeline non stava passando del testo.
 */
export function formatta(valore) {
  if (valore === null || valore === undefined) return "";
  if (typeof valore === "string") return valore;
  if (!Array.isArray(valore)) return formatta([valore]);
  if (valore.length === 0) return "";
  if (valore.every((v) => typeof v !== "object" || v === null))
    return valore.map(String).join("\n");

  const colonne = [...new Set(valore.flatMap((v) => Object.keys(v)))];
  const larghezza = Object.fromEntries(
    colonne.map((c) => [c, Math.max(c.length, ...valore.map((v) => String(v[c] ?? "").length))])
  );
  const riga = (celle) => colonne.map((c, i) => String(celle[i]).padEnd(larghezza[c])).join("  ").trimEnd();
  return [
    riga(colonne),
    riga(colonne.map((c) => "-".repeat(larghezza[c]))),
    ...valore.map((v) => riga(colonne.map((c) => v[c] ?? ""))),
  ].join("\n");
}

/**
 * Sostituisce $NOME e ${NOME} con il valore della variabile. Una variabile che
 * non esiste diventa la stringa vuota — senza errore, ed e' il comportamento di
 * bash: e' la ragione per cui `rm -rf $CARTELLA/` con la variabile vuota
 * cancella la radice.
 */
function espandi(sh, testo) {
  if (typeof testo !== "string" || !testo.includes("$")) return testo;
  // $# e' il numero di argomenti dello script, e non e' un nome come gli altri:
  // va riconosciuto a parte, altrimenti il cancelletto verrebbe letto come
  // l'inizio di un commento.
  return testo.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$(#|\?|[A-Za-z_0-9][A-Za-z0-9_]*)/g,
    (_, a, b) => {
      const nome = a ?? b;
      // Con "set -u" una variabile non definita e' un errore invece della
      // stringa vuota: e' l'unica difesa contro "rm -rf $CARTELLA/".
      if (sh.env[nome] === undefined && sh.severo)
        throw new V.ErroreFs(`${nome}: variabile non definita`);
      return sh.env[nome] ?? "";
    });
}

/** Spezza sulle pipe di primo livello, lasciando stare quelle fra virgolette. */
function spezzaSuPipe(riga) {
  const pezzi = [];
  let corrente = "";
  let virgoletta = null;
  for (const c of riga) {
    if (virgoletta) {
      if (c === virgoletta) virgoletta = null;
      corrente += c;
      continue;
    }
    if (c === '"' || c === "'") { virgoletta = c; corrente += c; continue; }
    if (c === "|") { pezzi.push(corrente); corrente = ""; continue; }
    corrente += c;
  }
  pezzi.push(corrente);
  return pezzi.map((p) => p.trim());
}

/** Esegue piu' righe in sequenza e restituisce la trascrizione. */
export function eseguiTutto(sh, righe) {
  const lista = Array.isArray(righe) ? righe : righe.split("\n");
  return lista.map((r) => ({ riga: r, ...esegui(sh, r) }));
}

// ---------- comandi ----------

// Le opzioni sono lettere singole raccolte da qualunque argomento che inizi per
// "-": "rm -r -f x" e "rm -rf x" devono comportarsi allo stesso modo.
/**
 * Il motivo di grep e' un'espressione regolare, non un pezzo di testo: `.`
 * vale per un carattere qualunque, `*` ripete, `^` e `$` sono l'inizio e la
 * fine della riga, e `\|` separa due alternative. Prima qui si cercava una
 * sottostringa e basta, cosi' `grep -i 'root\|password'` non trovava niente e
 * l'esercizio sembrava dire che nel file non c'era nulla.
 *
 * ponytail: si traduce la sintassi POSIX di base in quella di JavaScript,
 * invece di scrivere un motore di espressioni regolari. Le classi \w, i gruppi
 * di cattura e le ripetizioni {n,m} non servono a nessuna lezione: se
 * serviranno, si aggiungono qui.
 */
function espressione(motivo, ignoraMaiuscole) {
  let fuori = "";
  for (let i = 0; i < motivo.length; i++) {
    const c = motivo[i];
    if (c === "\\" && i + 1 < motivo.length) {
      const dopo = motivo[++i];
      // \| \( \) \+ \? sono operatori nella sintassi POSIX di base...
      if ("|()+?{}".includes(dopo)) fuori += dopo;
      // ...tutto il resto e' il carattere stesso, protetto.
      else fuori += "\\" + dopo;
      continue;
    }
    if ("+?(){}|".includes(c)) fuori += "\\" + c;
    else fuori += c;
  }
  let re;
  try {
    re = new RegExp(fuori, ignoraMaiuscole ? "i" : "");
  } catch {
    throw new V.ErroreFs(`espressione non valida: ${motivo}`);
  }
  return (riga) => re.test(riga);
}

/** Il numero di `-A2` o di `-A 2`, zero se l'opzione non c'e'. */
function numeroDi(args, lettera) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("-") || a.startsWith("--") || !a.includes(lettera)) continue;
    const attaccato = a.slice(a.indexOf(lettera) + 1);
    if (/^\d+$/.test(attaccato)) return Number(attaccato);
    if (/^\d+$/.test(args[i + 1] ?? "")) return Number(args[i + 1]);
  }
  return 0;
}

function opzioni(args) {
  const flag = new Set();
  const resto = [];
  for (const a of args) {
    if (a.startsWith("-") && a.length > 1) for (const c of a.slice(1)) flag.add(c);
    else resto.push(a);
  }
  return { flag, resto };
}

const righeDi = (testo) => (testo === "" ? [] : testo.replace(/\n$/, "").split("\n"));

/**
 * Il contenuto su cui lavorare: il file se e' stato nominato, altrimenti quello
 * che arriva dalla pipe. E' la sola cosa che un comando deve sapere delle pipe.
 */
function ingresso(sh, file) {
  if (file !== undefined) return V.leggi(sh.fs, file);
  if (sh.stdin === null || sh.stdin === undefined)
    throw new V.ErroreFs("manca il nome del file");
  // I comandi POSIX lavorano su testo: se dalla pipe arrivano oggetti — cosa
  // che succede solo nel ramo PowerShell — li si appiattisce qui.
  return formatta(sh.stdin);
}

/** Una riga di ls -l: tipo, permessi, proprietario, gruppo, dimensione, nome. */
function rigaLunga(nome, nodo, dim = nodo.tipo === "file" ? nodo.contenuto.length : 0) {
  const tipo = nodo.tipo === "dir" ? "d" : nodo.tipo === "link" ? "l" : "-";
  const etichetta = nodo.tipo === "link" && !nome.includes(" -> ") ? `${nome} -> ${nodo.destinazione}` : nome;
  // Proprietario e gruppo sono due colonne diverse, ed e' la seconda che decide
  // chi altro puo' leggere un file in una cartella condivisa.
  const chi = (nodo.proprietario ?? "tu").padEnd(6);
  const gruppo = (nodo.gruppo ?? nodo.proprietario ?? "tu").padEnd(9);
  return `${tipo}${V.permessiTesto(nodo)}  ${chi} ${gruppo} ${String(dim).padStart(6)}  ${etichetta}`;
}

export const POSIX = {
  pwd: (sh) => sh.fs.cwd,

  cd(sh, args) {
    const dove = args[0] ?? V.HOME;
    const abs = V.normalizza(sh.fs, dove);
    if (!sh.fs.nodi.has(abs)) throw new V.ErroreFs(`${dove}: directory non esistente`);
    if (!V.eDir(sh.fs, abs)) throw new V.ErroreFs(`${dove}: non e' una directory`);
    sh.fs.cwd = abs;
    return "";
  },

  ls(sh, args) {
    const { flag, resto } = opzioni(args);
    const bersagli = resto.length ? resto : ["."];
    const blocchi = bersagli.map((b) => {
      // ls -l su un collegamento mostra IL COLLEGAMENTO, non il contenuto di
      // dove punta: e' cosi' che si scopre dove va a finire, e se e' rotto.
      const diretto = sh.fs.nodi.get(V.normalizza(sh.fs, b));
      if (flag.has("l") && diretto?.tipo === "link") return rigaLunga(b, diretto);
      let nomi = V.elenca(sh.fs, b);
      if (!flag.has("a")) nomi = nomi.filter((n) => !n.startsWith("."));
      if (flag.has("l")) {
        // Su un collegamento, ls -l mostra il collegamento stesso: e' il modo
        // di vedere dove punta, e di accorgersi che e' rotto.
        const base = V.eDir(sh.fs, b) && V.tipo(sh.fs, b) !== "link"
          ? V.normalizza(sh.fs, b)
          : V.genitore(V.normalizza(sh.fs, b));
        return nomi
          .map((n) => {
            const p = base + (base === "/" ? "" : "/") + n;
            const nodo = sh.fs.nodi.get(V.normalizza(sh.fs, p));
            const dim = nodo.tipo === "file" ? nodo.contenuto.length : 0;
            const nome = nodo.tipo === "link" ? `${n} -> ${nodo.destinazione}` : n;
            // Proprietario e gruppo sono due colonne diverse, ed e' la seconda
            // che decide chi altro puo' leggere un file in una cartella condivisa.
            return rigaLunga(nome, nodo, dim);
          })
          .join("\n");
      }
      return nomi.join("\n");
    });
    return blocchi.filter((b) => b !== "").join("\n");
  },

  mkdir(sh, args) {
    const { flag, resto } = opzioni(args);
    if (!resto.length) throw new V.ErroreFs("manca il nome della directory");
    for (const d of resto) V.creaDir(sh.fs, d, flag.has("p"));
    return "";
  },

  touch(sh, args) {
    if (!args.length) throw new V.ErroreFs("manca il nome del file");
    for (const f of args) if (!V.esiste(sh.fs, f)) V.scrivi(sh.fs, f, "");
    return "";
  },

  cat(sh, args) {
    if (!args.length) throw new V.ErroreFs("manca il nome del file");
    return args.map((f) => V.leggi(sh.fs, f)).join("").replace(/\n$/, "");
  },

  echo: (sh, args) => args.join(" "),

  rm(sh, args) {
    const { flag, resto } = opzioni(args);
    if (!resto.length) throw new V.ErroreFs("manca il nome del file");
    for (const f of resto) {
      if (!V.esiste(sh.fs, f)) {
        if (flag.has("f")) continue;
        throw new V.ErroreFs(`${f}: file o directory non esistente`);
      }
      V.rimuovi(sh.fs, f, flag.has("r"));
    }
    return "";
  },

  cp(sh, args) {
    const { flag, resto } = opzioni(args);
    if (resto.length < 2) throw new V.ErroreFs("servono sorgente e destinazione");
    V.copia(sh.fs, resto[0], resto[1], flag.has("r"));
    return "";
  },

  mv(sh, args) {
    const { resto } = opzioni(args);
    if (resto.length < 2) throw new V.ErroreFs("servono sorgente e destinazione");
    V.sposta(sh.fs, resto[0], resto[1]);
    return "";
  },

  rmdir(sh, args) {
    if (!args.length) throw new V.ErroreFs("manca il nome della directory");
    for (const d of args) {
      if (!V.esiste(sh.fs, d)) throw new V.ErroreFs(`${d}: file o directory non esistente`);
      if (!V.eDir(sh.fs, d)) throw new V.ErroreFs(`${d}: non e' una directory`);
      if (V.elenca(sh.fs, d).length) throw new V.ErroreFs(`${d}: directory non vuota`);
      sh.fs.nodi.delete(V.normalizza(sh.fs, d));
    }
    return "";
  },

  ln(sh, args) {
    const simbolico = args[0] === "-s";
    const resto = simbolico ? args.slice(1) : args;
    if (resto.length !== 2) throw new V.ErroreFs("servono bersaglio e nome del link");
    if (simbolico) V.collegaSimbolico(sh.fs, resto[0], resto[1]);
    else V.collegaDuro(sh.fs, resto[0], resto[1]);
    return "";
  },

  head(sh, args) {
    const { resto } = opzioni(args);
    const n = args.includes("-n") ? Number(args[args.indexOf("-n") + 1]) : 10;
    const file = resto.filter((a) => !/^\d+$/.test(a)).at(-1);
    return righeDi(ingresso(sh, file)).slice(0, n).join("\n");
  },

  tail(sh, args) {
    const { resto } = opzioni(args);
    const n = args.includes("-n") ? Number(args[args.indexOf("-n") + 1]) : 10;
    const file = resto.filter((a) => !/^\d+$/.test(a)).at(-1);
    return righeDi(ingresso(sh, file)).slice(-n).join("\n");
  },

  wc(sh, args) {
    const { flag, resto } = opzioni(args);
    const testo = ingresso(sh, resto[0]);
    const righe = righeDi(testo);
    // Il nome del file compare in fondo solo se glielo hai dato: leggendo dalla
    // pipe, wc non sa da dove venga il testo, ed e' cosi' anche in una shell vera.
    const etichetta = resto[0] ? " " + resto[0] : "";
    if (flag.has("l")) return `${righe.length}${etichetta}`;
    const parole = righe.join(" ").split(/\s+/).filter(Boolean).length;
    return `${righe.length} ${parole} ${testo.length}${etichetta}`;
  },

  sort(sh, args) {
    const { flag, resto } = opzioni(args);
    let righe = righeDi(ingresso(sh, resto[0])).slice();
    // -n ordina per valore numerico: senza, "10" viene prima di "9" perche' il
    // confronto e' fra stringhe. E' l'errore piu' comune con sort, e non segnala
    // niente perche' un ordinamento sbagliato e' pur sempre un ordinamento.
    righe = flag.has("n") ? righe.sort((a, b) => parseFloat(a) - parseFloat(b)) : righe.sort();
    if (flag.has("r")) righe.reverse();
    return righe.join("\n");
  },

  uniq(sh, args) {
    const { flag, resto } = opzioni(args);
    const out = [];
    for (const r of righeDi(ingresso(sh, resto[0]))) {
      const ultimo = out[out.length - 1];
      // uniq confronta solo righe ADIACENTI: su dati non ordinati non toglie i
      // duplicati lontani, ed e' il motivo per cui si scrive sempre dopo sort.
      if (ultimo && ultimo.riga === r) ultimo.n++;
      else out.push({ riga: r, n: 1 });
    }
    return out.map((o) => (flag.has("c") ? `${o.n} ${o.riga}` : o.riga)).join("\n");
  },

  grep(sh, args) {
    const { flag, resto } = opzioni(args);
    const [motivo, ...file] = resto;
    if (!motivo) throw new V.ErroreFs("serve un motivo da cercare");

    const prova = espressione(motivo, flag.has("i"));
    // -A N stampa anche le N righe dopo ogni riga trovata, -B N quelle prima:
    // e' come si legge un log, dove la riga che spiega l'errore sta accanto e
    // non dentro. Il numero puo' stare attaccato (-A1) o staccato (-A 1).
    // Con -c si contano le righe trovate, non il contesto attorno.
    const dopo = flag.has("c") ? 0 : numeroDi(args, "A");
    const prima = flag.has("c") ? 0 : numeroDi(args, "B");

    const cerca = (righe, etichetta) => {
      const presa = new Set();
      righe.forEach((r, i) => {
        if (prova(r) === flag.has("v")) return;
        for (let k = i - prima; k <= i + dopo; k++) if (k >= 0 && k < righe.length) presa.add(k);
      });
      const scelte = [...presa].sort((a, b) => a - b);
      return scelte.map((i) => (etichetta ? `${etichetta}:${righe[i]}` : righe[i]));
    };

    let out;
    if (!file.length) {
      out = cerca(righeDi(ingresso(sh, undefined)), null);
    } else {
      out = [];
      for (const f of file) {
        out.push(...cerca(righeDi(V.leggi(sh.fs, f)), file.length > 1 ? f : null));
      }
    }
    // grep esce con 1 quando non trova niente: non e' un errore, e' la
    // risposta — ed e' esattamente quello che un "if" gli chiede.
    sh.esito = out.length ? 0 : 1;
    if (flag.has("c")) return String(out.length);
    return out.join("\n");
  },

  find(sh, args) {
    // Le radici vengono prima dei predicati: dopo il primo `-qualcosa`, un
    // argomento nudo e' un errore, come su find vero.
    const radici = [];
    let nome = null;
    let vistoPredicato = false;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "-name") {
        vistoPredicato = true;
        nome = args[++i];
        if (nome === undefined) throw new V.ErroreFs("manca l'argomento di '-name'");
      } else if (a.startsWith("-")) {
        throw new V.ErroreFs(`predicato sconosciuto '${a}'`);
      } else if (vistoPredicato) {
        throw new V.ErroreFs(`i percorsi vanno prima dell'espressione: '${a}'`);
      } else {
        radici.push(a);
      }
    }
    if (!radici.length) radici.push(".");

    let trovati = [];
    for (const radice of radici) {
      if (!V.esiste(sh.fs, radice)) throw new V.ErroreFs(`${radice}: file o cartella non esistente`);
      trovati = trovati.concat(V.sottoalbero(sh.fs, radice));
    }
    if (nome) {
      // Solo il glob con l'asterisco: gli altri caratteri speciali non servono
      // a nessuno degli esercizi previsti, e ognuno costerebbe un caso in piu'.
      const re = new RegExp("^" + nome.split("*").map(fuggi).join(".*") + "$");
      trovati = trovati.filter((p) => re.test(V.foglia(p)));
    }
    return trovati.join("\n");
  },

  env: (sh) => Object.entries(sh.env).map(([k, v]) => `${k}=${v}`).join("\n"),

  whoami: (sh) => sh.fs.utente ?? "tu",

  /**
   * Esegue le righe di un file, una per una, in **questa** shell.
   *
   * Una shell vera avvia un processo figlio, e per questo le variabili
   * assegnate dentro uno script non sopravvivono — a meno di lanciarlo con
   * `source`. Qui la distinzione non c'e', ed e' dichiarata nel modulo invece
   * che simulata: sarebbe l'unica differenza fra `bash` e `source`, e costerebbe
   * un secondo interprete per insegnare una riga di teoria.
   */
  bash(sh, args) {
    const { resto } = opzioni(args);
    const file = resto[0];
    if (!file) throw new V.ErroreFs("manca il nome dello script");
    if (!V.esiste(sh.fs, file)) throw new V.ErroreFs(`${file}: file non esistente`);

    // Gli argomenti dello script diventano $1, $2, ... e $# il loro numero.
    const argomenti = resto.slice(1);
    argomenti.forEach((a, i) => (sh.env[String(i + 1)] = a));
    sh.env["#"] = String(argomenti.length);
    sh.env["0"] = file;

    const severoPrima = sh.severo;
    const funzioniPrima = sh.funzioni;
    sh.funzioni = { ...(sh.funzioni || {}) };
    const stato = { fermaSuErrore: false, uscite: [], file, trap: null, uscito: false, codice: 0 };
    try {
      const righe = V.leggi(sh.fs, file).split("\n");
      eseguiBlocco(sh, righe, stato);
      // trap ... EXIT: la riga che si esegue comunque, anche uscendo per un
      // errore. E' il modo di cancellare i file temporanei senza dimenticarsene.
      if (stato.trap) esegiRigaScript(sh, stato.trap, stato);
    } finally {
      sh.severo = severoPrima;
      sh.funzioni = funzioniPrima;
      sh.env["?"] = String(stato.codice);
      // "bash script.sh" riporta il codice dello script: e' cosi' che uno
      // script sa com'e' andato quello che ha chiamato.
      sh.esito = stato.codice;
    }
    return stato.uscite.join("\n");
  },

  /** test / [ ... ] : la condizione di uno script. Restituisce testo vuoto e
   *  imposta $?, come fa il comando vero. */
  test(sh, args) {
    return valutaTest(sh, args);
  },
  "["(sh, args) {
    const chiuse = args.at(-1) === "]" ? args.slice(0, -1) : args;
    if (chiuse.length === args.length) throw new V.ErroreFs("manca la parentesi quadra di chiusura");
    return valutaTest(sh, chiuse);
  },

  /**
   * chmod accetta la forma numerica (755) e quella simbolica (+x, u+w, go-r).
   * Solo il proprietario puo' cambiare i permessi — o root, ed e' il motivo per
   * cui su un file di sistema serve sudo.
   */
  chmod(sh, args) {
    const { resto } = opzioni(args);
    const [spec, ...file] = resto;
    if (!spec || !file.length) throw new V.ErroreFs("servono i permessi e un file");
    for (const f of file) {
      const nodo = sh.fs.nodi.get(V.normalizza(sh.fs, f));
      if (!nodo) throw new V.ErroreFs(`${f}: file o directory non esistente`);
      const io = sh.fs.utente ?? "tu";
      if (io !== "root" && (nodo.proprietario ?? "tu") !== io)
        throw new V.ErroreFs(`${f}: operazione non permessa`);
      nodo.modo = nuovoModo(nodo.modo ?? (nodo.tipo === "dir" ? V.MODO_DIR : V.MODO_FILE), spec);
    }
    return "";
  },

  chown(sh, args) {
    const { resto } = opzioni(args);
    const [proprietario, ...file] = resto;
    if (!proprietario || !file.length) throw new V.ErroreFs("servono un utente e un file");
    // Cambiare proprietario richiede sempre root: se bastasse essere proprietari,
    // si potrebbe regalare un file per sfuggire a una quota disco.
    if ((sh.fs.utente ?? "tu") !== "root")
      throw new V.ErroreFs("operazione non permessa: serve sudo");
    for (const f of file) {
      const nodo = sh.fs.nodi.get(V.normalizza(sh.fs, f));
      if (!nodo) throw new V.ErroreFs(`${f}: file o directory non esistente`);
      nodo.proprietario = proprietario;
    }
    return "";
  },

  chgrp(sh, args) {
    const { resto } = opzioni(args);
    const [gruppo, ...file] = resto;
    if (!gruppo || !file.length) throw new V.ErroreFs("servono il gruppo e un file");
    if (sh.gruppi && !sh.gruppi[gruppo]) throw new V.ErroreFs(`gruppo non esistente: ${gruppo}`);
    const utente = sh.fs.utente ?? "tu";
    const appartiene = sh.fs.gruppiUtente?.[utente]?.includes(gruppo) ?? false;
    if (utente !== "root" && !appartiene)
      throw new V.ErroreFs("operazione non permessa: non fai parte di quel gruppo");
    for (const f of file) {
      const nodo = sh.fs.nodi.get(V.normalizza(sh.fs, f));
      if (!nodo) throw new V.ErroreFs(`${f}: file o directory non esistente`);
      if (utente !== "root" && (nodo.proprietario ?? "tu") !== utente)
        throw new V.ErroreFs(`${f}: operazione non permessa`);
      nodo.gruppo = gruppo;
    }
    return "";
  },

  /** sudo esegue il resto della riga come root, e solo quella riga. */
  sudo(sh, args) {
    if (!args.length) throw new V.ErroreFs("manca il comando da eseguire");
    const fn = sh.comandi[args[0]];
    if (!fn) throw new V.ErroreFs(`${args[0]}: comando non trovato`);
    const prima = sh.fs.utente ?? "tu";
    sh.fs.utente = "root";
    try {
      return fn(sh, args.slice(1));
    } finally {
      sh.fs.utente = prima;
    }
  },

  which(sh, args) {
    const { flag, resto } = opzioni(args);
    const nome = resto[0];
    if (!nome) throw new V.ErroreFs("manca il nome del comando");
    const trovati = [];
    for (const dir of sh.env.PATH.split(":")) {
      const p = dir + "/" + nome;
      if (V.esiste(sh.fs, p)) trovati.push(p);
    }
    // -a li elenca tutti invece del primo: e' il modo di vedere in un colpo
    // quante copie dello stesso comando hai, e in che ordine si contendono.
    return flag.has("a") ? trovati.join("\n") : trovati[0] ?? "";
  },
};

const fuggi = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Da un modo esistente e una specifica (755, +x, u+w, go-r) al modo nuovo. */
function nuovoModo(modo, spec) {
  if (/^[0-7]{3,4}$/.test(spec)) return parseInt(spec, 8);
  const m = spec.match(/^([ugoa]*)([+-=])([rwx]+)$/);
  if (!m) throw new V.ErroreFs(`permessi non validi: ${spec}`);
  const [, chi, segno, quali] = m;
  const bersagli = (chi === "" || chi.includes("a") ? "ugo" : chi).split("");
  const bit = quali.split("").reduce((a, c) => a | { r: 4, w: 2, x: 1 }[c], 0);
  let out = modo;
  for (const b of bersagli) {
    const scorri = { u: 6, g: 3, o: 0 }[b];
    if (segno === "+") out |= bit << scorri;
    else if (segno === "-") out &= ~(bit << scorri);
    else out = (out & ~(7 << scorri)) | (bit << scorri);
  }
  return out;
}

// ---------- verifica degli esercizi ----------

/**
 * Controlli dichiarativi invece di codice: un esercizio descrive lo stato finale
 * che si aspetta, e questa funzione lo confronta. Sono dati in un JSON, quindi
 * non c'e' niente da eseguire e il formato resta leggibile insieme al testo.
 *
 * { cwd, esiste: [...], nonEsiste: [...], contenuto: {percorso: testo},
 *   contiene: {percorso: pezzo}, dir: [...], usa: [...], stampa: "..." }
 */
export function verifica(sh, attesa, trascrizione = []) {
  const problemi = [];
  const p = (m) => problemi.push(m);

  if (attesa.cwd && sh.fs.cwd !== V.normalizza(sh.fs, attesa.cwd))
    p(`sei in ${sh.fs.cwd}, dovresti essere in ${attesa.cwd}`);

  for (const f of attesa.esiste || []) if (!V.esiste(sh.fs, f)) p(`manca ${f}`);
  for (const f of attesa.nonEsiste || []) if (V.esiste(sh.fs, f)) p(`${f} c'e' ancora`);
  for (const d of attesa.dir || []) if (!V.eDir(sh.fs, d)) p(`${d} non e' una directory`);

  for (const [f, testo] of Object.entries(attesa.contenuto || {})) {
    if (!V.esiste(sh.fs, f)) { p(`manca ${f}`); continue; }
    const letto = V.leggi(sh.fs, f).replace(/\n$/, "");
    if (letto !== String(testo).replace(/\n$/, "")) p(`il contenuto di ${f} non e' quello atteso`);
  }
  for (const [f, pezzo] of Object.entries(attesa.contiene || {})) {
    if (!V.esiste(sh.fs, f)) { p(`manca ${f}`); continue; }
    if (!V.leggi(sh.fs, f).includes(pezzo)) p(`${f} non contiene "${pezzo}"`);
  }

  // I permessi si controllano guardandoli, non fidandosi del comando digitato:
  // `chmod 451` e `chmod 444` lasciano il file leggibile e non scrivibile, e
  // senza questo un esercizio sui permessi passava con il modo sbagliato.
  for (const [f, modo] of Object.entries(attesa.modo || {})) {
    if (!V.esiste(sh.fs, f)) { p(`manca ${f}`); continue; }
    const nodo = sh.fs.nodi.get(V.normalizza(sh.fs, f));
    const suo = (nodo.modo ?? (nodo.tipo === "dir" ? V.MODO_DIR : V.MODO_FILE)).toString(8).padStart(4, "0");
    const atteso = String(modo).padStart(4, "0");
    if (suo !== atteso) p(`${f} ha i permessi ${suo.slice(-4)}, non ${atteso.slice(-4)}`);
  }

  // Un collegamento simbolico si giudica da dove punta: `ls` mostra il nome
  // uguale sia che punti alla cartella giusta sia che punti nel vuoto.
  for (const [nome, bersaglio] of Object.entries(attesa.punta || {})) {
    const nodo = sh.fs.nodi.get(V.normalizza(sh.fs, nome));
    if (!nodo) { p(`manca ${nome}`); continue; }
    if (nodo.tipo !== "link") p(`${nome} non e' un collegamento`);
    else if (nodo.destinazione !== V.normalizza(sh.fs, bersaglio)) p(`${nome} punta a ${nodo.destinazione}, non a ${bersaglio}`);
  }

  // "usa" guarda i comandi digitati, non lo stato: serve quando l'esercizio
  // insegna proprio quel comando e raggiungere il risultato in altro modo
  // significherebbe non aver fatto l'esercizio.
  // Una riga con le pipe contiene piu' comandi: vanno guardati tutti, altrimenti
  // "cat x | grep y" risulterebbe non aver usato grep.
  // Con sudo il comando vero e' la parola dopo, non "sudo": senza questa riga
  // "sudo chown ..." risulterebbe non aver usato chown.
  const usati = new Set(
    sh.storia.flatMap((r) =>
      spezzaSuPipe(r).flatMap((pezzo) => {
        const parole = dividi(pezzo).parole;
        return parole[0] === "sudo" ? [parole[0], parole[1]] : [parole[0]];
      })
    )
  );
  // Tenuti separati dagli altri problemi: se lo stato finale e' giusto ma il
  // comando dell'esercizio non e' stato usato, la risposta e' corretta ma
  // fuori consegna, e va detto in modo diverso da uno sbaglio.
  const fuori = [];
  for (const c of attesa.usa || []) if (!usati.has(c)) fuori.push(`non hai usato ${c}`);

  // Il contrario di "contiene": serve quando la prova che il lavoro e' fatto e'
  // una riga che deve SPARIRE — un modulo scaricato, un disco smontato.
  for (const [f, pezzo] of Object.entries(attesa.nonContiene || {})) {
    if (V.esiste(sh.fs, f) && V.leggi(sh.fs, f).includes(pezzo)) p(`${f} contiene ancora "${pezzo}"`);
  }

  if (attesa.nonStampa !== undefined) {
    const uscite = trascrizione.map((t) => t.out).filter(Boolean).join("\n");
    if (uscite.includes(attesa.nonStampa)) p(`l'output contiene ancora "${attesa.nonStampa}"`);
  }

  if (attesa.stampa !== undefined) {
    const uscite = trascrizione.map((t) => t.out).filter(Boolean).join("\n");
    // Una stringa o un elenco: certi esercizi si dimostrano solo con due righe
    // insieme — il prima e il dopo di un modulo tolto e rimesso.
    for (const pezzo of [].concat(attesa.stampa)) {
      if (!uscite.includes(pezzo)) p(`l'output non contiene "${pezzo}"`);
    }
  }

  // Alcuni esercizi chiedono di **riprodurre** un guasto: li' il risultato
  // giusto e' un errore preciso, e controllare i comandi digitati non basta.
  if (attesa.errore !== undefined) {
    const errori = trascrizione.map((t) => t.errore).filter(Boolean).join("\n");
    if (!errori.includes(attesa.errore)) p(`non hai riprodotto l'errore "${attesa.errore}"`);
  }

  return {
    ok: problemi.length === 0 && fuori.length === 0,
    fuoriConsegna: problemi.length === 0 && fuori.length > 0,
    problemi: [...problemi, ...fuori],
  };
}
