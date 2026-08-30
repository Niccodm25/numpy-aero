// Interprete di comandi sopra il filesystem virtuale.
//
// Un dizionario nome -> funzione, cosi' i rami che verranno (POSIX, PowerShell,
// pip e venv) aggiungono comandi senza toccare il parser. La funzione riceve gli
// argomenti gia' separati e restituisce il testo da stampare.

import * as V from "./vfs.js";

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
  let corrente = "";
  let virgoletta = null;
  let aperta = false;
  for (const c of riga) {
    if (virgoletta) {
      if (c === virgoletta) virgoletta = null;
      else corrente += c;
      continue;
    }
    if (c === '"' || c === "'") {
      virgoletta = c;
      aperta = true;
      continue;
    }
    if (c === " " || c === "\t") {
      if (corrente || aperta) parole.push(corrente);
      corrente = "";
      aperta = false;
      continue;
    }
    corrente += c;
  }
  if (corrente || aperta) parole.push(corrente);

  // La redirezione si stacca qui: i comandi non devono saperne niente.
  let redirezione = null;
  for (let i = 0; i < parole.length; i++) {
    if (parole[i] === ">" || parole[i] === ">>") {
      redirezione = { modo: parole[i], file: parole[i + 1] };
      parole.splice(i, 2);
      break;
    }
  }
  return { parole, redirezione };
}

/** Esegue una riga. Restituisce sempre un oggetto: gli errori non si sollevano. */
export function esegui(sh, riga) {
  const testo = riga.trim();
  if (!testo || testo.startsWith("#")) return { out: "", errore: null };
  sh.storia.push(testo);

  // La pipe si risolve qui: ogni pezzo riceve come ingresso l'uscita del
  // precedente. I comandi non ne sanno niente — leggono da sh.stdin quando non
  // ricevono un nome di file, ed e' l'unica cosa che devono sapere.
  const pezzi = spezzaSuPipe(testo);
  let ingresso = null;
  let ultimo = { out: "", errore: null };

  for (let i = 0; i < pezzi.length; i++) {
    const { parole, redirezione } = dividi(pezzi[i]);
    const nome = parole[0];
    if (!nome) return { out: "", errore: "manca un comando attorno alla pipe" };
    const fn = sh.comandi[nome];
    if (!fn) return { out: "", errore: `${nome}: comando non trovato` };

    sh.stdin = ingresso;
    try {
      const out = fn(sh, parole.slice(1)) ?? "";
      if (redirezione) {
        if (!redirezione.file) return { out: "", errore: "manca il nome del file dopo >" };
        const testoOut = out.endsWith("\n") || out === "" ? out : out + "\n";
        if (redirezione.modo === ">") V.scrivi(sh.fs, redirezione.file, testoOut);
        else V.aggiungi(sh.fs, redirezione.file, testoOut);
        ultimo = { out: "", errore: null };
      } else {
        ultimo = { out, errore: null };
      }
      ingresso = out;
    } catch (e) {
      if (e instanceof V.ErroreFs) return { out: "", errore: `${nome}: ${e.message}` };
      throw e;
    } finally {
      sh.stdin = null;
    }
  }
  return ultimo;
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
  return sh.stdin;
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
      let nomi = V.elenca(sh.fs, b);
      if (!flag.has("a")) nomi = nomi.filter((n) => !n.startsWith("."));
      if (flag.has("l")) {
        const base = V.eDir(sh.fs, b) ? V.normalizza(sh.fs, b) : V.genitore(V.normalizza(sh.fs, b));
        return nomi
          .map((n) => {
            const p = base + (base === "/" ? "" : "/") + n;
            const dir = V.eDir(sh.fs, p);
            const dim = dir ? 0 : V.leggi(sh.fs, p).length;
            return `${dir ? "d" : "-"}rw-r--r--  ${String(dim).padStart(6)}  ${n}`;
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
    if (!file.length) {
      const soloTesto = flag.has("i") ? motivo.toLowerCase() : motivo;
      return righeDi(ingresso(sh, undefined))
        .filter((r) => {
          const c = flag.has("i") ? r.toLowerCase() : r;
          return c.includes(soloTesto) !== flag.has("v");
        })
        .join("\n");
    }
    const cerca = flag.has("i") ? motivo.toLowerCase() : motivo;
    const out = [];
    for (const f of file) {
      for (const riga of righeDi(V.leggi(sh.fs, f))) {
        const confronto = flag.has("i") ? riga.toLowerCase() : riga;
        const dentro = confronto.includes(cerca);
        if (dentro !== flag.has("v")) out.push(file.length > 1 ? `${f}:${riga}` : riga);
      }
    }
    return out.join("\n");
  },

  find(sh, args) {
    const radice = args[0] ?? ".";
    const nome = args.includes("-name") ? args[args.indexOf("-name") + 1] : null;
    let trovati = V.sottoalbero(sh.fs, radice);
    if (nome) {
      // Solo il glob con l'asterisco: gli altri caratteri speciali non servono
      // a nessuno degli esercizi previsti, e ognuno costerebbe un caso in piu'.
      const re = new RegExp("^" + nome.split("*").map(fuggi).join(".*") + "$");
      trovati = trovati.filter((p) => re.test(V.foglia(p)));
    }
    return trovati.join("\n");
  },

  env: (sh) => Object.entries(sh.env).map(([k, v]) => `${k}=${v}`).join("\n"),

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

  // "usa" guarda i comandi digitati, non lo stato: serve quando l'esercizio
  // insegna proprio quel comando e raggiungere il risultato in altro modo
  // significherebbe non aver fatto l'esercizio.
  // Una riga con le pipe contiene piu' comandi: vanno guardati tutti, altrimenti
  // "cat x | grep y" risulterebbe non aver usato grep.
  const usati = new Set(
    sh.storia.flatMap((r) => spezzaSuPipe(r).map((pezzo) => dividi(pezzo).parole[0]))
  );
  for (const c of attesa.usa || []) if (!usati.has(c)) p(`non hai usato ${c}`);

  if (attesa.stampa !== undefined) {
    const uscite = trascrizione.map((t) => t.out).filter(Boolean).join("\n");
    if (!uscite.includes(attesa.stampa)) p(`l'output non contiene "${attesa.stampa}"`);
  }

  // Alcuni esercizi chiedono di **riprodurre** un guasto: li' il risultato
  // giusto e' un errore preciso, e controllare i comandi digitati non basta.
  if (attesa.errore !== undefined) {
    const errori = trascrizione.map((t) => t.errore).filter(Boolean).join("\n");
    if (!errori.includes(attesa.errore)) p(`non hai riprodotto l'errore "${attesa.errore}"`);
  }

  return { ok: problemi.length === 0, problemi };
}
