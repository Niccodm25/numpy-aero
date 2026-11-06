// Git simulato: commit veri, area di staging vera, conflitti veri.
//
// Il working tree **e' il filesystem dell'app**. Non c'e' una copia dei file
// dentro a questo modulo: `echo riga >> nota.txt` cambia il file, e `git
// status` se ne accorge perche' confronta tre cose — l'ultimo commit, l'area
// di staging e il filesystem — esattamente come git vero. E' l'unico modo per
// insegnare l'area di staging: se i file fossero finti, `git add` sarebbe una
// parola magica invece di un'operazione con un effetto osservabile.
//
// Gli hash sono brevi (7 caratteri) e derivati dal contenuto del commit:
// cambiano se cambia il messaggio, l'albero o il genitore, e restano identici
// fra una sessione e l'altra. Le date avanzano di un minuto per commit, cosi'
// `git log` e' leggibile e i test sono ripetibili.
//
// Quello che NON c'e', dichiarato: niente pack file, niente oggetti su disco
// (la cartella .git esiste nel filesystem ma e' vuota, serve a far vedere che
// c'e'), niente rebase interattivo, niente submodule. Il merge e' a tre vie
// ma con granularita' di file: se entrambi i rami toccano lo stesso file in
// modo diverso, il file va in conflitto tutto intero.
//
// ponytail: scritto a mano invece di portarsi dentro isomorphic-git (un
// megabyte, e comunque push/fetch vogliono un server HTTP vero) o il motore di
// learnGitBranching (modella solo il grafo dei commit, senza file ne' staging).

import * as V from "./vfs.js";

const AUTORE_DEFAULT = { nome: "Tu", email: "tu@esempio.it" };
const T0 = Date.UTC(2026, 2, 9, 9, 0, 0); // lunedi' 9 marzo 2026, 09:00

export function statoGit(sh, scenario = {}) {
  // Lo scenario arriva dal JSON dell'esercizio, che l'app carica una volta
  // sola: senza copiarlo, i comandi modificherebbero la dichiarazione stessa.
  scenario = structuredClone(scenario);
  sh.git = {
    conf: {
      "user.name": scenario.utente ?? AUTORE_DEFAULT.nome,
      "user.email": scenario.email ?? AUTORE_DEFAULT.email,
      ...(scenario.conf || {}),
    },
    locale: null,
    remoti: {},
    minuti: 0,
    // Il conto dei comandi serve solo a far vedere qualcosa di diverso quando
    // un esercizio chiede di ripetere: non e' stato di git.
    scenario,
  };
  if (scenario.repo) sh.git.locale = repoDaScenario(sh, scenario.repo);
  for (const [nome, r] of Object.entries(scenario.remoti || {})) {
    sh.git.remoti[nome] = { url: r.url ?? urlDi(nome, r.nome ?? "progetto"), repo: repoNudo(sh, r) };
  }
  return sh;
}

const remotoUrl = (sh, nome) => (sh.git.remoti[nome]?.url ?? "").replace(/\.git$/, "");

const urlDi = (remoto, nome) => `https://github.com/${remoto === "upstream" ? "laboratorio" : "tu"}/${nome}.git`;

// ---------- hash e date ----------

/** FNV-1a a 32 bit, in esadecimale: corto, stabile, e abbastanza diverso da
 *  far vedere che due commit diversi hanno hash diversi. */
function impronta(testo) {
  let h = 0x811c9dc5;
  for (let i = 0; i < testo.length; i++) {
    h ^= testo.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Sette caratteri come l'abbreviazione che git mostra di default.
  return (h.toString(16) + "0000000").slice(0, 7);
}

function dataDi(sh) {
  const d = new Date(T0 + sh.git.minuti * 60000);
  sh.git.minuti += 7; // sette minuti fra un commit e l'altro
  const g = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const due = (n) => String(n).padStart(2, "0");
  return `${g} ${m} ${due(d.getUTCDate())} ${due(d.getUTCHours())}:${due(d.getUTCMinutes())}:00 2026 +0100`;
}

// ---------- repository ----------

function repoVuoto(radice) {
  return {
    radice,
    commit: {},
    rami: { main: null },
    HEAD: { ramo: "main" },
    indice: {},
    remoti: {}, // "origin/main" -> id
    tracking: {}, // "main" -> "origin/main"
    tag: {},
    unione: null, // merge in corso non risolto
  };
}

/** Un repository descritto dallo scenario: una lista di commit gia' fatti. */
function repoDaScenario(sh, spec) {
  const radice = V.normalizza(sh.fs, spec.radice ?? ".");
  const repo = repoVuoto(radice);
  V.creaDir(sh.fs, radice, true);
  V.creaDir(sh.fs, radice + "/.git", true);
  let albero = {};
  for (const c of spec.commit || []) {
    albero = { ...albero, ...(c.file || {}) };
    for (const via of c.rimuove || []) delete albero[via];
    creaCommit(sh, repo, c.messaggio, { ...albero }, c.autore);
  }
  // I file dell'ultimo commit compaiono nel working tree, come dopo un clone.
  scriviAlbero(sh, repo, albero);
  repo.indice = { ...albero };
  for (const [nome, id] of Object.entries(spec.rami || {})) repo.rami[nome] = id ?? repo.rami.main;
  if (spec.ramo) {
    repo.rami[spec.ramo] ??= repo.rami.main;
    repo.HEAD = { ramo: spec.ramo };
  }
  for (const [via, contenuto] of Object.entries(spec.lavoro || {})) {
    scriviFile(sh, repo, via, contenuto);
  }
  // File gia' in area di staging all'inizio dell'esercizio: servono quando si
  // vuole partire dal passo dopo, senza far rifare ogni volta il git add.
  for (const [via, contenuto] of Object.entries(spec.staged || {})) {
    scriviFile(sh, repo, via, contenuto);
    repo.indice[via] = contenuto;
  }
  return repo;
}

/** Un repository senza working tree: quello che sta "su GitHub". */
function repoNudo(sh, spec) {
  const repo = repoVuoto("(remoto)");
  repo.nudo = true;
  let albero = {};
  for (const c of spec.commit || []) {
    albero = { ...albero, ...(c.file || {}) };
    for (const via of c.rimuove || []) delete albero[via];
    creaCommit(sh, repo, c.messaggio, { ...albero }, c.autore ?? "anna");
  }
  for (const [nome, id] of Object.entries(spec.rami || {})) repo.rami[nome] = id ?? repo.rami.main;
  repo.ramoPrincipale = spec.ramoPrincipale ?? "main";
  return repo;
}

const g = (sh) => {
  if (!sh.git) throw new V.ErroreFs("git non e' disponibile in questo esercizio");
  return sh.git;
};

/** Il repository che contiene la cartella corrente, oppure l'errore di git. */
function repo(sh) {
  const r = g(sh).locale;
  const dentro = r && (sh.fs.cwd === r.radice || sh.fs.cwd.startsWith(r.radice + "/"));
  if (!dentro) {
    throw new V.ErroreFs("fatal: not a git repository (or any of the parent directories): .git");
  }
  return r;
}

// ---------- working tree ----------

const relDi = (repo, abs) => (abs === repo.radice ? "" : abs.slice(repo.radice.length + 1));
const absDi = (repo, rel) => `${repo.radice}/${rel}`;

function scriviFile(sh, repo, rel, contenuto) {
  const abs = absDi(repo, rel);
  V.creaDir(sh.fs, abs.slice(0, abs.lastIndexOf("/")), true);
  V.scrivi(sh.fs, abs, contenuto);
}

function scriviAlbero(sh, repo, albero) {
  for (const [rel, contenuto] of Object.entries(albero)) scriviFile(sh, repo, rel, contenuto);
}

/** I file del working tree, esclusa .git: percorso relativo -> contenuto. */
function lavoro(sh, repo) {
  const fuori = {};
  for (const abs of V.sottoalbero(sh.fs, repo.radice)) {
    if (!V.eFile(sh.fs, abs)) continue;
    const rel = relDi(repo, abs);
    if (rel === "" || rel === ".git" || rel.startsWith(".git/")) continue;
    fuori[rel] = V.leggi(sh.fs, abs);
  }
  return fuori;
}

/**
 * .gitignore: si leggono i motivi riga per riga, e si tengono le due forme che
 * si usano davvero — `*.log` e `cartella/`. Le negazioni con `!` e i motivi
 * annidati non servono a nessun esercizio e direbbero di saper fare piu' di
 * quello che sanno fare.
 */
function ignorati(sh, repo) {
  const file = absDi(repo, ".gitignore");
  if (!V.esiste(sh.fs, file)) return () => false;
  const motivi = V.leggi(sh.fs, file)
    .split("\n")
    .map((r) => r.trim())
    .filter((r) => r && !r.startsWith("#"));
  return (rel) =>
    motivi.some((m) => {
      if (m.endsWith("/")) return rel === m.slice(0, -1) || rel.startsWith(m);
      const re = new RegExp("^" + m.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*") + "$");
      return re.test(rel) || re.test(rel.slice(rel.lastIndexOf("/") + 1));
    });
}

// ---------- commit ----------

function creaCommit(sh, repo, messaggio, albero, autore) {
  const genitori = repo.HEAD.ramo ? [repo.rami[repo.HEAD.ramo]].filter(Boolean) : [repo.HEAD.commit].filter(Boolean);
  return creaCommitCon(sh, repo, messaggio, albero, genitori, autore);
}

function creaCommitCon(sh, repo, messaggio, albero, genitori, autore) {
  const chi = autore ?? g(sh).conf["user.name"];
  const chiavi = Object.keys(albero).sort();
  const id = impronta(messaggio + "|" + genitori.join(",") + "|" + chiavi.map((k) => k + ":" + albero[k]).join("|"));
  repo.commit[id] = { id, messaggio, genitori, albero: { ...albero }, autore: chi, data: dataDi(sh) };
  if (repo.HEAD.ramo) repo.rami[repo.HEAD.ramo] = id;
  else repo.HEAD = { commit: id };
  return id;
}

const testaId = (repo) => (repo.HEAD.ramo ? repo.rami[repo.HEAD.ramo] : repo.HEAD.commit);
const alberoDi = (repo, id) => (id ? repo.commit[id].albero : {});

/** Tutti gli antenati di un commit, se stesso compreso. */
function antenati(repo, id, visti = new Set()) {
  if (!id || visti.has(id)) return visti;
  visti.add(id);
  for (const p of repo.commit[id].genitori) antenati(repo, p, visti);
  return visti;
}

/** La base comune piu' vicina fra due commit: il punto in cui i rami si sono
 *  separati. Serve al merge a tre vie per sapere chi ha cambiato cosa. */
function baseComune(repo, a, b) {
  const daA = antenati(repo, a);
  const coda = [b];
  const visti = new Set();
  while (coda.length) {
    const id = coda.shift();
    if (!id || visti.has(id)) continue;
    visti.add(id);
    if (daA.has(id)) return id;
    coda.push(...repo.commit[id].genitori);
  }
  return null;
}

/** La cronologia a partire da un commit, dal piu' recente al piu' vecchio. */
function cronologia(repo, id) {
  const fuori = [];
  const visti = new Set();
  const coda = [id].filter(Boolean);
  while (coda.length) {
    const c = coda.shift();
    if (!c || visti.has(c)) continue;
    visti.add(c);
    fuori.push(repo.commit[c]);
    coda.push(...repo.commit[c].genitori);
  }
  return fuori;
}

// ---------- confronti ----------

/** Che cosa cambia fra due alberi: aggiunti, modificati, tolti. */
function differenze(prima, dopo) {
  const aggiunti = [];
  const modificati = [];
  const tolti = [];
  for (const k of Object.keys(dopo).sort()) {
    if (!(k in prima)) aggiunti.push(k);
    else if (prima[k] !== dopo[k]) modificati.push(k);
  }
  for (const k of Object.keys(prima).sort()) if (!(k in dopo)) tolti.push(k);
  return { aggiunti, modificati, tolti };
}

const righe = (t) => (t === "" || t === undefined ? [] : t.replace(/\n$/, "").split("\n"));

/**
 * Un diff onesto ma semplice: si tolgono le righe uguali in testa e in coda, e
 * quello che resta si stampa come tolto e poi aggiunto.
 *
 * ponytail: non e' l'algoritmo di git (Myers), e su una modifica in mezzo a un
 * file lungo mostra un blocco piu' grande di quello che mostrerebbe git. Serve
 * a far vedere **che cosa** e' cambiato, non a essere byte per byte identico;
 * un vero diff costerebbe piu' di tutto il resto del modulo.
 */
function blocco(prima, dopo) {
  const a = righe(prima);
  const b = righe(dopo);
  let testa = 0;
  while (testa < a.length && testa < b.length && a[testa] === b[testa]) testa++;
  let coda = 0;
  while (coda < a.length - testa && coda < b.length - testa && a[a.length - 1 - coda] === b[b.length - 1 - coda]) coda++;
  return { a, b, testa, coda, giu: a.length - testa - coda, su: b.length - testa - coda };
}

function diffFile(via, prima, dopo) {
  const { a, b, testa, coda } = blocco(prima, dopo);
  const viaA = prima === undefined ? "/dev/null" : `a/${via}`;
  const viaB = dopo === undefined ? "/dev/null" : `b/${via}`;
  const fuori = [`diff --git a/${via} b/${via}`, `--- ${viaA}`, `+++ ${viaB}`];
  fuori.push(`@@ -${testa + 1},${a.length - testa - coda} +${testa + 1},${b.length - testa - coda} @@`);
  for (const r of a.slice(testa, a.length - coda)) fuori.push(`-${r}`);
  for (const r of b.slice(testa, b.length - coda)) fuori.push(`+${r}`);
  return fuori.join("\n");
}

function diffAlberi(prima, dopo) {
  const d = differenze(prima, dopo);
  const pezzi = [];
  for (const k of d.aggiunti) pezzi.push(diffFile(k, undefined, dopo[k]));
  for (const k of d.modificati) pezzi.push(diffFile(k, prima[k], dopo[k]));
  for (const k of d.tolti) pezzi.push(diffFile(k, prima[k], undefined));
  return pezzi.join("\n");
}

/** Il riassunto che git stampa dopo un commit o un merge. */
function riassunto(prima, dopo) {
  const d = differenze(prima, dopo);
  const tocchi = [...d.aggiunti, ...d.modificati, ...d.tolti];
  let piu = 0;
  let meno = 0;
  const righeFile = [];
  for (const k of tocchi) {
    const { su, giu } = blocco(prima[k], dopo[k]);
    piu += su;
    meno += giu;
    const segni = "+".repeat(Math.min(su, 20)) + "-".repeat(Math.min(giu, 20));
    righeFile.push(` ${k} | ${su + giu} ${segni}`);
  }
  const parti = [];
  if (piu) parti.push(`${piu} insertion${piu === 1 ? "" : "s"}(+)`);
  if (meno) parti.push(`${meno} deletion${meno === 1 ? "" : "s"}(-)`);
  const capo = ` ${tocchi.length} file${tocchi.length === 1 ? "" : "s"} changed${parti.length ? ", " + parti.join(", ") : ""}`;
  return { righeFile, capo, tocchi };
}

// ---------- stato ----------

function statoDi(sh, r) {
  const testa = alberoDi(r, testaId(r));
  const ind = r.indice;
  const lav = lavoro(sh, r);
  const ignoraBase = ignorati(sh, r);
  // Un file in conflitto non e' in area di staging ma non e' nemmeno
  // sconosciuto a git: ha una riga sua, "both modified". Senza questo
  // comparirebbe fra i file non tracciati, che sarebbe una bugia.
  const inConflitto = new Set(r.unione ? r.unione.conflitti : []);
  const ignora = (k) => inConflitto.has(k) || ignoraBase(k);
  const inStaging = differenze(testa, ind);
  const daAggiungere = [];
  const nonTracciati = [];
  for (const k of Object.keys(lav).sort()) {
    if (k in ind) {
      if (lav[k] !== ind[k]) daAggiungere.push({ via: k, come: "modified" });
    } else if (!ignora(k)) nonTracciati.push(k);
  }
  for (const k of Object.keys(ind).sort()) if (!(k in lav)) daAggiungere.push({ via: k, come: "deleted" });
  return { testa, ind, lav, inStaging, daAggiungere, nonTracciati };
}

const etichetta = (s) => `${(s.come + ":").padEnd(12)}${s.via}`;

// ---------- i comandi ----------

const SOTTOCOMANDI = [
  "init", "status", "add", "commit", "log", "diff", "show", "branch", "switch",
  "checkout", "merge", "restore", "reset", "revert", "rm", "mv", "tag", "remote",
  "clone", "fetch", "pull", "push", "config",
];

export const VERSIONI = {
  git(sh, args) {
    const [sotto, ...resto] = args;
    if (!sotto) return AIUTO;
    const fn = COMANDI[sotto];
    if (!fn) throw new V.ErroreFs(`'${sotto}' is not a git command. See 'git --help'.`);
    return fn(sh, resto);
  },
};

const AIUTO = [
  "usage: git <command> [<args>]",
  "",
  "I comandi disponibili in questo simulatore:",
  "   " + SOTTOCOMANDI.join(" "),
].join("\n");

const COMANDI = {
  config(sh, args) {
    const liberi = args.filter((a) => !a.startsWith("-"));
    const [chiave, valore] = liberi;
    if (!chiave) throw new V.ErroreFs("usage: git config [--global] <chiave> [<valore>]");
    if (valore === undefined) {
      const v = g(sh).conf[chiave];
      if (v === undefined) {
        sh.esito = 1;
        return "";
      }
      return v;
    }
    g(sh).conf[chiave] = valore;
    return "";
  },

  init(sh, args) {
    const nome = args.find((a) => !a.startsWith("-"));
    const radice = V.normalizza(sh.fs, nome ?? ".");
    if (g(sh).locale && g(sh).locale.radice === radice) {
      return `Reinitialized existing Git repository in ${radice}/.git/`;
    }
    V.creaDir(sh.fs, radice, true);
    V.creaDir(sh.fs, radice + "/.git", true);
    g(sh).locale = repoVuoto(radice);
    return `Initialized empty Git repository in ${radice}/.git/`;
  },

  status(sh, args) {
    const r = repo(sh);
    const s = statoDi(sh, r);
    const corto = args.includes("-s") || args.includes("--short");
    if (corto) {
      const fuori = [];
      for (const k of s.inStaging.aggiunti) fuori.push(`A  ${k}`);
      for (const k of s.inStaging.modificati) fuori.push(`M  ${k}`);
      for (const k of s.inStaging.tolti) fuori.push(`D  ${k}`);
      for (const x of s.daAggiungere) fuori.push(`${x.come === "deleted" ? " D" : " M"} ${x.via}`);
      for (const k of s.nonTracciati) fuori.push(`?? ${k}`);
      return fuori.join("\n");
    }

    const fuori = [r.HEAD.ramo ? `On branch ${r.HEAD.ramo}` : `HEAD detached at ${r.HEAD.commit}`];
    if (!testaId(r)) fuori.push("", "No commits yet");
    if (r.unione) {
      fuori.push("", "You have unmerged paths.", '  (fix conflicts and run "git commit")');
      if (r.unione.conflitti.length) {
        fuori.push("", "Unmerged paths:", '  (use "git add <file>..." to mark resolution)');
        for (const k of r.unione.conflitti) fuori.push(`\tboth modified:   ${k}`);
      }
    }
    const inS = [
      ...s.inStaging.aggiunti.map((k) => ({ via: k, come: "new file" })),
      ...s.inStaging.modificati.map((k) => ({ via: k, come: "modified" })),
      ...s.inStaging.tolti.map((k) => ({ via: k, come: "deleted" })),
    ].filter((x) => !(r.unione && r.unione.conflitti.includes(x.via)));
    if (inS.length) {
      fuori.push("", "Changes to be committed:", '  (use "git restore --staged <file>..." to unstage)');
      for (const x of inS) fuori.push(`\t${etichetta(x)}`);
    }
    if (s.daAggiungere.length) {
      fuori.push(
        "",
        "Changes not staged for commit:",
        '  (use "git add <file>..." to update what will be committed)',
        '  (use "git restore <file>..." to discard changes in working directory)'
      );
      for (const x of s.daAggiungere) fuori.push(`\t${etichetta(x)}`);
    }
    if (s.nonTracciati.length) {
      fuori.push("", "Untracked files:", '  (use "git add <file>..." to include in what will be committed)');
      for (const k of s.nonTracciati) fuori.push(`\t${k}`);
    }
    if (!inS.length && !s.daAggiungere.length && !s.nonTracciati.length && !r.unione) {
      fuori.push("", "nothing to commit, working tree clean");
    } else if (!inS.length && !s.daAggiungere.length && s.nonTracciati.length && !r.unione) {
      fuori.push("", 'nothing added to commit but untracked files present (use "git add" to track)');
    }
    return fuori.join("\n");
  },

  add(sh, args) {
    const r = repo(sh);
    const liberi = args.filter((a) => !a.startsWith("-"));
    if (!liberi.length) throw new V.ErroreFs("Nothing specified, nothing added.");
    const lav = lavoro(sh, r);
    const ignora = ignorati(sh, r);
    for (const spec of liberi) {
      if (spec === "." || spec === "-A" || spec === "*") {
        for (const [k, c] of Object.entries(lav)) if (!ignora(k) || k in r.indice) r.indice[k] = c;
        // `git add .` registra anche le cancellazioni.
        for (const k of Object.keys(r.indice)) if (!(k in lav)) delete r.indice[k];
        continue;
      }
      const abs = V.normalizza(sh.fs, spec);
      const rel = relDi(r, abs);
      const dentro = Object.keys(lav).filter((k) => k === rel || k.startsWith(rel + "/"));
      if (!dentro.length) {
        if (r.indice[rel] !== undefined && !V.esiste(sh.fs, abs)) {
          delete r.indice[rel];
          continue;
        }
        throw new V.ErroreFs(`pathspec '${spec}' did not match any files`);
      }
      for (const k of dentro) r.indice[k] = lav[k];
      if (r.unione) r.unione.conflitti = r.unione.conflitti.filter((k) => !dentro.includes(k));
    }
    return "";
  },

  commit(sh, args) {
    const r = repo(sh);
    const i = args.findIndex((a) => a === "-m" || a === "--message");
    let messaggio = i >= 0 ? args[i + 1] : null;
    const correggi = args.includes("--amend");
    if (args.includes("-am") || (args.includes("-a") && i >= 0)) {
      // -a mette in staging i file gia' tracciati, non i nuovi.
      const lav = lavoro(sh, r);
      for (const k of Object.keys(r.indice)) r.indice[k] = lav[k] ?? r.indice[k];
      for (const k of Object.keys(r.indice)) if (!(k in lav)) delete r.indice[k];
      if (args.includes("-am")) messaggio = args[args.indexOf("-am") + 1];
    }
    if (!messaggio) throw new V.ErroreFs('manca il messaggio: usa git commit -m "che cosa hai fatto"');

    if (r.unione && r.unione.conflitti.length) {
      throw new V.ErroreFs("error: Committing is not possible because you have unmerged files.");
    }

    const testa = testaId(r);
    if (correggi) {
      if (!testa) throw new V.ErroreFs("fatal: You have nothing to amend.");
      const vecchio = r.commit[testa];
      const genitori = vecchio.genitori;
      // Si riscrive il commit: nuovo hash, stesso posto nella catena. E' il
      // motivo per cui un amend dopo un push fa divergere le storie.
      if (r.HEAD.ramo) r.rami[r.HEAD.ramo] = genitori[0] ?? null;
      else r.HEAD = { commit: genitori[0] ?? null };
      const id = creaCommitCon(sh, r, messaggio, { ...r.indice }, genitori, vecchio.autore);
      const s = riassunto(alberoDi(r, genitori[0]), r.indice);
      return [`[${r.HEAD.ramo ?? "HEAD detached"} ${id}] ${messaggio}`, s.capo].join("\n");
    }

    const prima = alberoDi(r, testa);
    const d = differenze(prima, r.indice);
    if (!d.aggiunti.length && !d.modificati.length && !d.tolti.length && !r.unione) {
      sh.esito = 1;
      const s = statoDi(sh, r);
      return [
        `On branch ${r.HEAD.ramo}`,
        s.daAggiungere.length
          ? 'no changes added to commit (use "git add" and/or "git commit -a")'
          : "nothing to commit, working tree clean",
      ].join("\n");
    }

    const genitori = r.unione
      ? [testa, r.unione.altro].filter(Boolean)
      : [testa].filter(Boolean);
    const id = creaCommitCon(sh, r, messaggio, { ...r.indice }, genitori);
    const unione = r.unione;
    r.unione = null;
    const s = riassunto(prima, r.indice);
    const radice = genitori.length === 0 ? " (root-commit)" : "";
    return [`[${r.HEAD.ramo}${radice} ${id}] ${messaggio}`, ...(unione ? [] : [s.capo, ...s.righeFile])].join("\n");
  },

  log(sh, args) {
    const r = repo(sh);
    const testa = testaId(r);
    if (!testa) throw new V.ErroreFs(`fatal: your current branch '${r.HEAD.ramo}' does not have any commits yet`);
    const quanti = Number((args.find((a) => /^-\d+$/.test(a)) ?? "0").slice(1)) || Infinity;
    const lista = cronologia(r, testa).slice(0, quanti);
    const perRamo = (id) =>
      Object.entries(r.rami)
        .filter(([, v]) => v === id)
        .map(([k]) => (r.HEAD.ramo === k ? `HEAD -> ${k}` : k))
        .concat(
          Object.entries(r.remoti)
            .filter(([, v]) => v === id)
            .map(([k]) => k)
        );
    if (args.includes("--oneline")) {
      const righe = lista.map((c) => {
        const rif = perRamo(c.id);
        return `${c.id}${rif.length ? ` (${rif.join(", ")})` : ""} ${c.messaggio}`;
      });
      // --graph disegna a sinistra la forma della storia: un asterisco per
      // commit, una barra per la linea che prosegue, e la coppia davanti a un
      // commit di unione. E' una versione piu' semplice di quella di git — una
      // colonna sola — ma racconta la stessa cosa: dove la storia si e'
      // divisa e dove si e' richiusa.
      if (args.includes("--graph")) {
        const fuori = [];
        lista.forEach((c, i) => {
          const unione = c.genitori.length > 1;
          fuori.push((unione ? "*   " : "* ") + righe[i]);
          if (i < lista.length - 1) fuori.push(unione ? "|\\  " : "| ");
        });
        return fuori.join("\n");
      }
      return righe.join("\n");
    }
    return lista
      .map((c) => {
        const rif = perRamo(c.id);
        return [
          `commit ${c.id}${rif.length ? ` (${rif.join(", ")})` : ""}`,
          ...(c.genitori.length > 1 ? [`Merge: ${c.genitori.map((x) => x.slice(0, 7)).join(" ")}`] : []),
          `Author: ${c.autore} <${g(sh).conf["user.email"]}>`,
          `Date:   ${c.data}`,
          "",
          `    ${c.messaggio}`,
          "",
        ].join("\n");
      })
      .join("\n")
      .replace(/\n+$/, "");
  },

  show(sh, args) {
    const r = repo(sh);
    const id = risolvi(sh, r, args.find((a) => !a.startsWith("-")) ?? "HEAD");
    const c = r.commit[id];
    const prima = alberoDi(r, c.genitori[0]);
    return [
      `commit ${c.id}`,
      `Author: ${c.autore} <${g(sh).conf["user.email"]}>`,
      `Date:   ${c.data}`,
      "",
      `    ${c.messaggio}`,
      "",
      diffAlberi(prima, c.albero),
    ].join("\n");
  },

  diff(sh, args) {
    const r = repo(sh);
    const s = statoDi(sh, r);
    if (args.includes("--staged") || args.includes("--cached")) return diffAlberi(s.testa, s.ind);
    // Senza opzioni git confronta l'area di staging con il working tree, e
    // guarda **solo i file tracciati**: un file che git non conosce ancora non
    // ha niente da cui differire, e infatti compare in status, non in diff.
    const tracciati = {};
    for (const k of Object.keys(s.ind)) if (k in s.lav) tracciati[k] = s.lav[k];
    return diffAlberi(s.ind, tracciati);
  },

  branch(sh, args) {
    const r = repo(sh);
    const cancella = args.includes("-d") || args.includes("-D");
    const liberi = args.filter((a) => !a.startsWith("-"));
    if (cancella) {
      const nome = liberi[0];
      if (!(nome in r.rami)) throw new V.ErroreFs(`error: branch '${nome}' not found.`);
      if (r.HEAD.ramo === nome) throw new V.ErroreFs(`error: Cannot delete branch '${nome}' checked out at '${r.radice}'`);
      // Un ramo non ancora unito si perde: git lo impedisce, se non con -D.
      const unito = antenati(r, testaId(r)).has(r.rami[nome]);
      if (!unito && !args.includes("-D")) {
        throw new V.ErroreFs(
          `error: The branch '${nome}' is not fully merged.\nIf you are sure you want to delete it, run 'git branch -D ${nome}'.`
        );
      }
      const id = r.rami[nome];
      delete r.rami[nome];
      return `Deleted branch ${nome} (was ${id ?? "niente"}).`;
    }
    if (!liberi.length) {
      const tutti = args.includes("-a");
      const locali = Object.keys(r.rami)
        .sort()
        .map((n) => `${n === r.HEAD.ramo ? "*" : " "} ${n}`);
      const remoti = tutti ? Object.keys(r.remoti).sort().map((n) => `  remotes/${n}`) : [];
      return [...locali, ...remoti].join("\n");
    }
    const nome = liberi[0];
    if (nome in r.rami) throw new V.ErroreFs(`fatal: a branch named '${nome}' already exists`);
    r.rami[nome] = testaId(r);
    return "";
  },

  switch(sh, args) {
    const r = repo(sh);
    const crea = args.includes("-c") || args.includes("-C");
    const nome = args.filter((a) => !a.startsWith("-"))[0];
    if (!nome) throw new V.ErroreFs("fatal: missing branch name");
    if (crea) {
      if (nome in r.rami) throw new V.ErroreFs(`fatal: a branch named '${nome}' already exists`);
      r.rami[nome] = testaId(r);
      r.HEAD = { ramo: nome };
      return `Switched to a new branch '${nome}'`;
    }
    return vaiA(sh, r, nome);
  },

  checkout(sh, args) {
    const r = repo(sh);
    if (args.includes("-b")) return COMANDI.switch(sh, ["-c", ...args.filter((a) => a !== "-b")]);
    const nome = args.filter((a) => !a.startsWith("-"))[0];
    if (!nome) throw new V.ErroreFs("fatal: missing branch name");
    // `git checkout -- file` ripristina un file: e' la forma vecchia di restore.
    if (args.includes("--") || (!(nome in r.rami) && relDi(r, V.normalizza(sh.fs, nome)) in r.indice)) {
      return COMANDI.restore(sh, [nome]);
    }
    return vaiA(sh, r, nome);
  },

  restore(sh, args) {
    const r = repo(sh);
    const staged = args.includes("--staged");
    const liberi = args.filter((a) => !a.startsWith("-"));
    if (!liberi.length) throw new V.ErroreFs("fatal: you must specify path(s) to restore");
    for (const spec of liberi) {
      const rel = relDi(r, V.normalizza(sh.fs, spec));
      if (staged) {
        const testa = alberoDi(r, testaId(r));
        if (rel in testa) r.indice[rel] = testa[rel];
        else delete r.indice[rel];
      } else {
        if (!(rel in r.indice)) throw new V.ErroreFs(`error: pathspec '${spec}' did not match any file(s) known to git`);
        scriviFile(sh, r, rel, r.indice[rel]);
      }
    }
    return "";
  },

  reset(sh, args) {
    const r = repo(sh);
    const modo = args.includes("--hard") ? "hard" : args.includes("--soft") ? "soft" : "mixed";
    const rif = args.filter((a) => !a.startsWith("-"))[0];
    // `git reset file` senza ref toglie un file dallo staging.
    if (rif && !(rif in r.rami) && !r.commit[rif] && !/^HEAD/.test(rif)) {
      return COMANDI.restore(sh, ["--staged", rif]);
    }
    const id = risolvi(sh, r, rif ?? "HEAD");
    if (r.HEAD.ramo) r.rami[r.HEAD.ramo] = id;
    else r.HEAD = { commit: id };
    const albero = alberoDi(r, id);
    if (modo !== "soft") r.indice = { ...albero };
    if (modo === "hard") {
      for (const k of Object.keys(lavoro(sh, r))) {
        if (!(k in albero)) V.rimuovi(sh.fs, absDi(r, k));
      }
      scriviAlbero(sh, r, albero);
      return `HEAD is now at ${id} ${r.commit[id].messaggio}`;
    }
    const s = statoDi(sh, r);
    if (modo === "mixed" && s.daAggiungere.length) {
      return ["Unstaged changes after reset:", ...s.daAggiungere.map((x) => `M\t${x.via}`)].join("\n");
    }
    return "";
  },

  revert(sh, args) {
    const r = repo(sh);
    const id = risolvi(sh, r, args.filter((a) => !a.startsWith("-"))[0] ?? "HEAD");
    const c = r.commit[id];
    const prima = alberoDi(r, c.genitori[0]);
    // Si rimette l'albero com'era prima di quel commit, limitatamente ai file
    // che quel commit aveva toccato: gli altri restano come sono adesso.
    const albero = { ...alberoDi(r, testaId(r)) };
    const d = differenze(prima, c.albero);
    for (const k of d.aggiunti) delete albero[k];
    for (const k of [...d.modificati, ...d.tolti]) albero[k] = prima[k];
    const messaggio = `Revert "${c.messaggio}"`;
    const nuovo = creaCommitCon(sh, r, messaggio, albero, [testaId(r)]);
    r.indice = { ...albero };
    for (const k of Object.keys(lavoro(sh, r))) if (!(k in albero)) V.rimuovi(sh.fs, absDi(r, k));
    scriviAlbero(sh, r, albero);
    const s = riassunto(alberoDi(r, c.genitori[0] ? testaId(r) : null), albero);
    return [`[${r.HEAD.ramo} ${nuovo}] ${messaggio}`, s.capo].join("\n");
  },

  rm(sh, args) {
    const r = repo(sh);
    const soloIndice = args.includes("--cached");
    for (const spec of args.filter((a) => !a.startsWith("-"))) {
      const rel = relDi(r, V.normalizza(sh.fs, spec));
      if (!(rel in r.indice)) throw new V.ErroreFs(`fatal: pathspec '${spec}' did not match any files`);
      delete r.indice[rel];
      if (!soloIndice) V.rimuovi(sh.fs, absDi(r, rel));
    }
    return "";
  },

  mv(sh, args) {
    const r = repo(sh);
    const [da, a] = args.filter((x) => !x.startsWith("-"));
    const relDa = relDi(r, V.normalizza(sh.fs, da));
    const relA = relDi(r, V.normalizza(sh.fs, a));
    if (!(relDa in r.indice)) throw new V.ErroreFs(`fatal: not under version control, source=${da}, destination=${a}`);
    V.sposta(sh.fs, absDi(r, relDa), absDi(r, relA));
    r.indice[relA] = r.indice[relDa];
    delete r.indice[relDa];
    return "";
  },

  tag(sh, args) {
    const r = repo(sh);
    const liberi = args.filter((a) => !a.startsWith("-"));
    if (!liberi.length) return Object.keys(r.tag).sort().join("\n");
    r.tag[liberi[0]] = testaId(r);
    return "";
  },

  merge(sh, args) {
    const r = repo(sh);
    if (args.includes("--abort")) {
      if (!r.unione) throw new V.ErroreFs("fatal: There is no merge to abort (MERGE_HEAD missing).");
      const albero = alberoDi(r, testaId(r));
      r.indice = { ...albero };
      scriviAlbero(sh, r, albero);
      r.unione = null;
      return "";
    }
    const i = args.indexOf("--nome-umano");
    // Il nome che compare nel messaggio del merge: dopo un pull git scrive
    // "Merge branch 'main' of https://github.com/...", non il nome interno.
    const etichettaRamo = i >= 0 ? args[i + 1] : null;
    const nome = args.slice(0, i >= 0 ? i : undefined).filter((a) => !a.startsWith("-"))[0];
    if (!nome) throw new V.ErroreFs("fatal: No commit specified and merge.defaultToUpstream not set.");
    const altro = risolvi(sh, r, nome);
    const mio = testaId(r);
    if (!altro) throw new V.ErroreFs(`merge: ${nome} - not something we can merge`);

    if (antenati(r, mio).has(altro)) return "Already up to date.";

    // Avanti veloce: non c'e' niente da unire, basta spostare l'etichetta.
    if (antenati(r, altro).has(mio)) {
      if (r.HEAD.ramo) r.rami[r.HEAD.ramo] = altro;
      const albero = alberoDi(r, altro);
      const prima = alberoDi(r, mio);
      for (const k of Object.keys(lavoro(sh, r))) if (!(k in albero)) V.rimuovi(sh.fs, absDi(r, k));
      scriviAlbero(sh, r, albero);
      r.indice = { ...albero };
      const s = riassunto(prima, albero);
      return [`Updating ${mio.slice(0, 7)}..${altro.slice(0, 7)}`, "Fast-forward", ...s.righeFile, s.capo].join("\n");
    }

    // Unione a tre vie: si guarda chi ha cambiato cosa rispetto alla base.
    const base = baseComune(r, mio, altro);
    const aBase = alberoDi(r, base);
    const aMio = alberoDi(r, mio);
    const aAltro = alberoDi(r, altro);
    const unito = { ...aMio };
    const conflitti = [];
    const fuori = [];
    for (const k of new Set([...Object.keys(aMio), ...Object.keys(aAltro)])) {
      const b = aBase[k];
      const m = aMio[k];
      const a = aAltro[k];
      if (m === a) continue;
      if (m === b) {
        if (a === undefined) delete unito[k];
        else unito[k] = a;
        fuori.push(`Auto-merging ${k}`);
        continue;
      }
      if (a === b) continue; // l'ho cambiato solo io
      // Toccato da entrambi in modo diverso: conflitto.
      fuori.push(`Auto-merging ${k}`, `CONFLICT (content): Merge conflict in ${k}`);
      conflitti.push(k);
      unito[k] =
        `<<<<<<< HEAD\n${(m ?? "").replace(/\n$/, "")}\n=======\n${(a ?? "").replace(/\n$/, "")}\n>>>>>>> ${nome}\n`;
    }
    scriviAlbero(sh, r, unito);
    for (const k of Object.keys(lavoro(sh, r))) if (!(k in unito)) V.rimuovi(sh.fs, absDi(r, k));
    r.indice = { ...unito };
    for (const k of conflitti) delete r.indice[k]; // un conflitto non e' in staging

    if (conflitti.length) {
      r.unione = { nome, altro, conflitti };
      sh.esito = 1;
      return [...fuori, "Automatic merge failed; fix conflicts and then commit the result."].join("\n");
    }
    const messaggio = etichettaRamo
      ? `Merge branch '${etichettaRamo.split("|")[0]}' of ${etichettaRamo.split("|")[1]}`
      : `Merge branch '${nome}'`;
    creaCommitCon(sh, r, messaggio, unito, [mio, altro]);
    return [...fuori, "Merge made by the 'ort' strategy.", ...riassunto(aMio, unito).righeFile, riassunto(aMio, unito).capo].join("\n");
  },

  remote(sh, args) {
    const r = repo(sh);
    const [azione, nome, url] = args.filter((a) => !a.startsWith("-"));
    if (!azione || args.includes("-v")) {
      return Object.entries(g(sh).remoti)
        .flatMap(([n, x]) => [`${n}\t${x.url} (fetch)`, `${n}\t${x.url} (push)`])
        .join("\n");
    }
    if (azione === "add") {
      if (!nome || !url) throw new V.ErroreFs("usage: git remote add <nome> <url>");
      if (g(sh).remoti[nome]) throw new V.ErroreFs(`error: remote ${nome} already exists.`);
      g(sh).remoti[nome] = { url, repo: repoNudo(sh, {}) };
      return "";
    }
    if (azione === "remove" || azione === "rm") {
      delete g(sh).remoti[nome];
      for (const k of Object.keys(r.remoti)) if (k.startsWith(nome + "/")) delete r.remoti[k];
      return "";
    }
    throw new V.ErroreFs("usage: git remote [-v] | add <nome> <url> | remove <nome>");
  },

  clone(sh, args) {
    const liberi = args.filter((a) => !a.startsWith("-"));
    const url = liberi[0];
    if (!url) throw new V.ErroreFs("fatal: You must specify a repository to clone.");
    const sorgente = Object.entries(g(sh).remoti).find(([, x]) => x.url === url);
    if (!sorgente) throw new V.ErroreFs(`fatal: repository '${url}' does not exist`);
    const nome = liberi[1] ?? (url.split("/").pop() || "progetto").replace(/\.git$/, "");
    const radice = V.normalizza(sh.fs, nome);
    if (V.esiste(sh.fs, radice)) throw new V.ErroreFs(`fatal: destination path '${nome}' already exists and is not an empty directory.`);
    const remoto = sorgente[1].repo;
    const locale = repoVuoto(radice);
    V.creaDir(sh.fs, radice, true);
    V.creaDir(sh.fs, radice + "/.git", true);
    locale.commit = structuredClone(remoto.commit);
    const principale = remoto.ramoPrincipale ?? "main";
    locale.rami = { [principale]: remoto.rami[principale] ?? null };
    locale.HEAD = { ramo: principale };
    for (const [n, id] of Object.entries(remoto.rami)) locale.remoti[`${sorgente[0]}/${n}`] = id;
    locale.tracking[principale] = `${sorgente[0]}/${principale}`;
    const albero = alberoDi(locale, locale.rami[principale]);
    scriviAlbero(sh, locale, albero);
    locale.indice = { ...albero };
    g(sh).locale = locale;
    const n = Object.keys(locale.commit).length;
    return [
      `Cloning into '${nome}'...`,
      `remote: Enumerating objects: ${n * 3}, done.`,
      `remote: Total ${n * 3} (delta 0), reused 0 (delta 0)`,
      `Receiving objects: 100% (${n * 3}/${n * 3}), done.`,
    ].join("\n");
  },

  fetch(sh, args) {
    const r = repo(sh);
    const nome = args.filter((a) => !a.startsWith("-"))[0] ?? "origin";
    const remoto = g(sh).remoti[nome];
    if (!remoto) throw new V.ErroreFs(`fatal: '${nome}' does not appear to be a git repository`);
    const nuovi = [];
    for (const [ramo, id] of Object.entries(remoto.repo.rami)) {
      const chiave = `${nome}/${ramo}`;
      if (r.remoti[chiave] !== id) {
        const prima = r.remoti[chiave];
        nuovi.push(
          prima
            ? `   ${String(prima).slice(0, 7)}..${String(id).slice(0, 7)}  ${ramo}     -> ${chiave}`
            : ` * [new branch]      ${ramo}     -> ${chiave}`
        );
      }
      r.remoti[chiave] = id;
    }
    // I commit del remoto entrano nel repository locale: e' quello che fetch fa
    // davvero, ed e' il motivo per cui dopo un fetch sei ancora dove eri.
    Object.assign(r.commit, structuredClone(remoto.repo.commit));
    if (!nuovi.length) return "";
    return [`From ${remoto.url.replace(/\.git$/, "")}`, ...nuovi].join("\n");
  },

  pull(sh, args) {
    const r = repo(sh);
    const liberi = args.filter((a) => !a.startsWith("-"));
    const nome = liberi[0] ?? "origin";
    const ramo = liberi[1] ?? r.HEAD.ramo;
    const testoFetch = COMANDI.fetch(sh, [nome]);
    const chiave = `${nome}/${ramo}`;
    if (!(chiave in r.remoti)) throw new V.ErroreFs(`fatal: couldn't find remote ref ${ramo}`);
    const testoMerge = COMANDI.merge(sh, [chiave, "--nome-umano", `${ramo}|${remotoUrl(sh, nome)}`]);
    return [testoFetch, testoMerge].filter(Boolean).join("\n");
  },

  push(sh, args) {
    const r = repo(sh);
    const liberi = args.filter((a) => !a.startsWith("-"));
    const imposta = args.includes("-u") || args.includes("--set-upstream");
    const forza = args.includes("-f") || args.includes("--force");
    const nome = liberi[0] ?? (r.tracking[r.HEAD.ramo] ?? "origin/x").split("/")[0];
    const ramo = liberi[1] ?? r.HEAD.ramo;
    const remoto = g(sh).remoti[nome];
    if (!remoto) {
      throw new V.ErroreFs(
        `fatal: '${nome}' does not appear to be a git repository\nfatal: Could not read from remote repository.`
      );
    }
    const mio = r.rami[ramo];
    if (!mio) throw new V.ErroreFs(`error: src refspec ${ramo} does not match any`);
    const suo = remoto.repo.rami[ramo];
    const dominio = remoto.url.replace(/\.git$/, "");

    // Il push e' rifiutato se il remoto ha commit che tu non hai: e' la
    // situazione piu' comune del lavoro in due, e va vista.
    if (suo && !antenati(r, mio).has(suo) && !forza) {
      sh.esito = 1;
      return [
        `To ${dominio}.git`,
        ` ! [rejected]        ${ramo} -> ${ramo} (fetch first)`,
        `error: failed to push some refs to '${dominio}.git'`,
        "hint: Updates were rejected because the remote contains work that you do not",
        "hint: have locally. This is usually caused by another repository pushing to",
        "hint: the same ref. If you want to integrate the remote changes, use",
        "hint: 'git pull' before pushing again.",
      ].join("\n");
    }

    Object.assign(remoto.repo.commit, structuredClone(r.commit));
    remoto.repo.rami[ramo] = mio;
    remoto.repo.ramoPrincipale ??= ramo;
    r.remoti[`${nome}/${ramo}`] = mio;
    if (imposta) r.tracking[ramo] = `${nome}/${ramo}`;
    const nuovi = cronologia(r, mio).length;
    return [
      `Enumerating objects: ${nuovi * 3}, done.`,
      `To ${dominio}.git`,
      suo ? `   ${suo.slice(0, 7)}..${mio.slice(0, 7)}  ${ramo} -> ${ramo}` : ` * [new branch]      ${ramo} -> ${ramo}`,
      ...(imposta ? [`branch '${ramo}' set up to track '${nome}/${ramo}'.`] : []),
    ].join("\n");
  },
};

/** Da un riferimento (ramo, hash, HEAD, HEAD~2, origin/main) al suo commit. */
function risolvi(sh, r, rif) {
  if (!rif) return testaId(r);
  const m = rif.match(/^(.*?)(?:~(\d+)|\^)?$/);
  const base = m[1] || "HEAD";
  const quanti = m[2] ? Number(m[2]) : /\^$/.test(rif) ? 1 : 0;
  let id =
    base === "HEAD"
      ? testaId(r)
      : r.rami[base] ?? r.remoti[base] ?? r.tag[base] ?? (r.commit[base] ? base : null);
  if (!id) throw new V.ErroreFs(`fatal: ambiguous argument '${rif}': unknown revision`);
  for (let i = 0; i < quanti; i++) {
    const c = r.commit[id];
    if (!c || !c.genitori.length) throw new V.ErroreFs(`fatal: ambiguous argument '${rif}': unknown revision`);
    id = c.genitori[0];
  }
  return id;
}

/** Sposta HEAD su un ramo (o su un commit) e aggiorna il working tree. */
function vaiA(sh, r, nome) {
  const eRamo = nome in r.rami;
  const id = eRamo ? r.rami[nome] : risolvi(sh, r, nome);
  const s = statoDi(sh, r);
  const alberoNuovo = alberoDi(r, id);
  const alberoOra = s.testa;
  // Le modifiche non committate si perderebbero solo se il file cambia fra i
  // due rami: altrimenti git le porta con se', ed e' comodissimo.
  const aRischio = [...s.daAggiungere.map((x) => x.via), ...s.inStaging.modificati].filter(
    (k) => alberoNuovo[k] !== alberoOra[k]
  );
  if (aRischio.length) {
    throw new V.ErroreFs(
      ["error: Your local changes to the following files would be overwritten by checkout:",
        ...aRischio.map((k) => `\t${k}`),
        "Please commit your changes or stash them before you switch branches.",
        "Aborting"].join("\n")
    );
  }
  const modificheDaPortare = {};
  for (const x of s.daAggiungere) if (x.come === "modified") modificheDaPortare[x.via] = s.lav[x.via];

  for (const k of Object.keys(lavoro(sh, r))) if (!(k in alberoNuovo) && k in alberoOra) V.rimuovi(sh.fs, absDi(r, k));
  scriviAlbero(sh, r, alberoNuovo);
  scriviAlbero(sh, r, modificheDaPortare);
  r.indice = { ...alberoNuovo };
  r.HEAD = eRamo ? { ramo: nome } : { commit: id };
  if (!eRamo) {
    return [
      `Note: switching to '${nome}'.`,
      "",
      "You are in 'detached HEAD' state.",
      `HEAD is now at ${id} ${r.commit[id].messaggio}`,
    ].join("\n");
  }
  const tracciato = r.tracking[nome];
  const avanti = tracciato && r.remoti[tracciato] !== r.rami[nome];
  return [`Switched to branch '${nome}'`, ...(avanti ? ["Your branch is ahead of '" + tracciato + "'."] : [])].join("\n");
}

// ---------- verifica ----------

/**
 * Le chiavi di verifica per gli esercizi di git. Stanno qui e non in shell.js
 * perche' parlano di questo modello: shell.js ne chiama una sola.
 *
 *   git: {
 *     ramo: "main",                 il ramo su cui sei
 *     commit: 3,                    quanti commit ha il ramo corrente
 *     messaggio: "aggiunge il log", l'ultimo messaggio (sottostringa)
 *     tracciato: ["nota.txt"],      file presenti nell'ultimo commit
 *     nonTracciato: ["segreto.env"],
 *     staged: ["nota.txt"],         file in area di staging ma non committati
 *     pulito: true,                 niente da committare
 *     rami: ["main", "grafico"],    rami che devono esistere
 *     remoto: { origin: { main: 3 } },  commit sul ramo del remoto
 *     conflitto: false,             merge in corso non risolto
 *     contiene: { "nota.txt": "riga" }  contenuto dell'ultimo commit
 *   }
 */
export function verificaGit(sh, attesa) {
  const problemi = [];
  const p = (m) => problemi.push(m);
  const r = sh.git && sh.git.locale;
  if (!r) {
    return ["non hai un repository: manca git init (o il clone non e' riuscito)"];
  }
  const testa = testaId(r);
  const albero = alberoDi(r, testa);

  if (attesa.ramo !== undefined && r.HEAD.ramo !== attesa.ramo) {
    p(`sei sul ramo ${r.HEAD.ramo ?? "(nessuno)"}, dovresti essere su ${attesa.ramo}`);
  }
  if (attesa.commit !== undefined) {
    const n = testa ? cronologia(r, testa).length : 0;
    if (n !== attesa.commit) p(`il ramo ha ${n} commit, ne servono ${attesa.commit}`);
  }
  if (attesa.messaggio !== undefined) {
    const m = testa ? r.commit[testa].messaggio : "";
    if (!m.includes(attesa.messaggio)) p(`l'ultimo commit dice «${m}», non parla di «${attesa.messaggio}»`);
  }
  for (const f of attesa.tracciato || []) if (!(f in albero)) p(`${f} non e' nell'ultimo commit`);
  for (const f of attesa.nonTracciato || []) if (f in albero) p(`${f} e' finito nel commit, non doveva`);
  for (const [f, pezzo] of Object.entries(attesa.contiene || {})) {
    if (!(f in albero)) p(`${f} non e' nell'ultimo commit`);
    else if (!albero[f].includes(pezzo)) p(`${f} nel commit non contiene «${pezzo}»`);
  }
  if (attesa.staged) {
    const d = differenze(albero, r.indice);
    const inS = [...d.aggiunti, ...d.modificati];
    for (const f of attesa.staged) if (!inS.includes(f)) p(`${f} non e' in area di staging`);
  }
  if (attesa.pulito !== undefined) {
    const s = statoDi(sh, r);
    const pulito =
      !s.daAggiungere.length &&
      !s.nonTracciati.length &&
      !differenze(albero, r.indice).aggiunti.length &&
      !differenze(albero, r.indice).modificati.length &&
      !differenze(albero, r.indice).tolti.length;
    if (pulito !== attesa.pulito) p(attesa.pulito ? "il working tree non e' pulito" : "il working tree e' gia' pulito");
  }
  for (const nome of attesa.rami || []) if (!(nome in r.rami)) p(`manca il ramo ${nome}`);
  for (const nome of attesa.nonRami || []) if (nome in r.rami) p(`il ramo ${nome} c'e' ancora`);
  if (attesa.conflitto !== undefined) {
    const c = !!(r.unione && r.unione.conflitti.length);
    if (c !== attesa.conflitto) p(attesa.conflitto ? "non c'e' nessun conflitto aperto" : "c'e' ancora un conflitto da risolvere");
  }
  for (const [nome, rami] of Object.entries(attesa.remoto || {})) {
    const rem = sh.git.remoti[nome];
    if (!rem) {
      p(`manca il remoto ${nome}`);
      continue;
    }
    for (const [ramo, quanti] of Object.entries(rami)) {
      const id = rem.repo.rami[ramo];
      const n = id ? cronologia(rem.repo, id).length : 0;
      if (n !== quanti) p(`su ${nome}/${ramo} ci sono ${n} commit, ne servono ${quanti}`);
    }
  }
  return problemi;
}

/** Serve agli altri moduli (github.js) che lavorano sullo stesso modello. */
export const interno = { repo, testaId, alberoDi, cronologia, antenati, repoNudo, impronta, relDi };
