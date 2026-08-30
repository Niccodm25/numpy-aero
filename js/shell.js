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
 * redirezioni > e >>. Non e' una shell vera: niente pipe, niente variabili,
 * niente glob. Coprono il 90% di quello che serve insegnare, e ognuna di quelle
 * tre aggiungerebbe piu' codice di tutto il resto messo insieme.
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

  // La pipe non e' supportata. Dirlo apertamente e' meglio che passarla come
  // argomento al comando: cosi' l'errore parla della shell e non di un file
  // chiamato "|" che non esiste.
  if (testo.includes("|"))
    return { out: "", errore: "questo terminale non supporta la pipe |" };

  const { parole, redirezione } = dividi(testo);
  const nome = parole[0];
  const fn = sh.comandi[nome];
  if (!fn) return { out: "", errore: `${nome}: comando non trovato` };

  try {
    const out = fn(sh, parole.slice(1)) ?? "";
    if (redirezione) {
      if (!redirezione.file) return { out: "", errore: "manca il nome del file dopo >" };
      const testoOut = out.endsWith("\n") || out === "" ? out : out + "\n";
      if (redirezione.modo === ">") V.scrivi(sh.fs, redirezione.file, testoOut);
      else V.aggiungi(sh.fs, redirezione.file, testoOut);
      return { out: "", errore: null };
    }
    return { out, errore: null };
  } catch (e) {
    if (e instanceof V.ErroreFs) return { out: "", errore: `${nome}: ${e.message}` };
    throw e;
  }
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
    return righeDi(V.leggi(sh.fs, file)).slice(0, n).join("\n");
  },

  tail(sh, args) {
    const { resto } = opzioni(args);
    const n = args.includes("-n") ? Number(args[args.indexOf("-n") + 1]) : 10;
    const file = resto.filter((a) => !/^\d+$/.test(a)).at(-1);
    return righeDi(V.leggi(sh.fs, file)).slice(-n).join("\n");
  },

  wc(sh, args) {
    const { flag, resto } = opzioni(args);
    const righe = righeDi(V.leggi(sh.fs, resto[0]));
    if (flag.has("l")) return `${righe.length} ${resto[0]}`;
    const parole = righe.join(" ").split(/\s+/).filter(Boolean).length;
    const caratteri = V.leggi(sh.fs, resto[0]).length;
    return `${righe.length} ${parole} ${caratteri} ${resto[0]}`;
  },

  grep(sh, args) {
    const { flag, resto } = opzioni(args);
    const [motivo, ...file] = resto;
    if (!motivo || !file.length) throw new V.ErroreFs("servono un motivo e un file");
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
  for (const c of attesa.usa || [])
    if (!sh.storia.some((r) => dividi(r).parole[0] === c)) p(`non hai usato ${c}`);

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
