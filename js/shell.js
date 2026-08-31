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
  const assegnazione = testo.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (assegnazione) {
    sh.env[assegnazione[1]] = espandi(sh, assegnazione[2].replace(/^["']|["']$/g, ""));
    return { out: "", errore: null };
  }

  const pezzi = spezzaSuPipe(testo);
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
      if (e instanceof V.ErroreFs) return { out: "", errore: `${nome}: ${e.message}` };
      throw e;
    } finally {
      sh.stdin = null;
    }
  }
  return ultimo;
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
  return testo.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$(#|[A-Za-z_0-9][A-Za-z0-9_]*)/g,
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
            const nodo = sh.fs.nodi.get(V.normalizza(sh.fs, p));
            const dir = nodo.tipo === "dir";
            const link = nodo.tipo === "link";
            const dim = dir || link ? 0 : nodo.contenuto.length;
            const nome = link ? `${n} -> ${nodo.destinazione}` : n;
            // Proprietario e gruppo sono due colonne diverse, ed e' la seconda
            // che decide chi altro puo' leggere un file in una cartella condivisa.
            const chi = (nodo.proprietario ?? "tu").padEnd(6);
            const gruppo = (nodo.gruppo ?? nodo.proprietario ?? "tu").padEnd(9);
            return `${dir ? "d" : link ? "l" : "-"}${V.permessiTesto(nodo)}  ${chi} ${gruppo} ${String(dim).padStart(6)}  ${nome}`;
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
    if (!file.length) {
      const soloTesto = flag.has("i") ? motivo.toLowerCase() : motivo;
      const trovate = righeDi(ingresso(sh, undefined)).filter((r) => {
        const c = flag.has("i") ? r.toLowerCase() : r;
        return c.includes(soloTesto) !== flag.has("v");
      });
      return flag.has("c") ? String(trovate.length) : trovate.join("\n");
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
    if (flag.has("c")) return String(out.length);
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
    const { flag, resto } = opzioni(args);
    const file = resto[0];
    if (!file) throw new V.ErroreFs("manca il nome dello script");
    if (!V.esiste(sh.fs, file)) throw new V.ErroreFs(`${file}: file non esistente`);
    // Gli argomenti dello script diventano $1, $2, ... e $# il loro numero.
    const argomenti = resto.slice(1);
    argomenti.forEach((a, i) => (sh.env[String(i + 1)] = a));
    sh.env["#"] = String(argomenti.length);
    sh.env["0"] = file;

    // Senza "set -e" uno script che fallisce a meta' PROSEGUE: l'errore si
    // stampa e la riga dopo viene eseguita lo stesso. E' il comportamento che
    // rovina i dati, ed e' la ragione per cui quelle due righe stanno in cima.
    const severoPrima = sh.severo;
    let fermaSuErrore = false;
    const uscite = [];
    try {
      for (const riga of V.leggi(sh.fs, file).split("\n")) {
        const pulita = riga.trim();
        if (!pulita || pulita.startsWith("#")) continue;
        if (pulita.startsWith("set ")) {
          const opz = pulita.slice(4).replace(/-/g, "");
          if (opz.includes("e")) fermaSuErrore = true;
          if (opz.includes("u")) sh.severo = true;
          continue;
        }
        const r = esegui(sh, pulita);
        if (r.errore) {
          if (fermaSuErrore) throw new V.ErroreFs(`${file}: ${r.errore}`);
          uscite.push(`${file}: ${r.errore}`);
        }
        if (r.out) uscite.push(r.out);
      }
    } finally {
      sh.severo = severoPrima;
    }
    return uscite.join("\n");
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

  return {
    ok: problemi.length === 0 && fuori.length === 0,
    fuoriConsegna: problemi.length === 0 && fuori.length > 0,
    problemi: [...problemi, ...fuori],
  };
}
