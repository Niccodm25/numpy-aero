// Modello piccolo del sistema Linux: archivi, pacchetti e risorse.
//
// Non finge di comprimere byte veri o di installare software: conserva invece
// gli elementi che starebbero dentro un archivio e lo stato di un catalogo
// pacchetti. Sono le due relazioni che servono a fare pratica senza dare a un
// esercizio il potere di toccare il computer di chi studia.

import * as V from "./vfs.js";

const CATALOGO = {
  curl: { versione: "8.5.0", descrizione: "strumento per trasferire dati" },
  htop: { versione: "3.3.0", descrizione: "monitor interattivo dei processi" },
  ripgrep: { versione: "14.1.0", descrizione: "ricerca veloce nel testo" },
  rsync: { versione: "3.2.7", descrizione: "copia incrementale di file" },
  tmux: { versione: "3.4", descrizione: "multiplexer del terminale" },
  tree: { versione: "2.1.1", descrizione: "vista ad albero delle cartelle" },
};

export function statoSistema(sh, scenario = {}) {
  sh.archivi = {};
  sh.gzip = {};
  sh.pacchetti = {};
  const dichiarati = scenario.pacchetti ?? {};
  for (const [nome, dati] of Object.entries(CATALOGO)) {
    const specifico = dichiarati[nome];
    sh.pacchetti[nome] = {
      ...dati,
      installato: specifico === true || specifico?.installato === true,
      ...(typeof specifico === "object" ? specifico : {}),
    };
  }
  for (const [nome, dati] of Object.entries(dichiarati)) {
    if (!sh.pacchetti[nome])
      sh.pacchetti[nome] = {
        versione: dati?.versione ?? "1.0.0",
        descrizione: dati?.descrizione ?? "pacchetto del repository",
        installato: dati === true || dati?.installato === true,
      };
  }
  sh.risorse = {
    discoTotale: 20,
    discoUsato: 14,
    memoriaTotale: 8192,
    memoriaUsata: 6144,
    swapTotale: 2048,
    swapUsata: 0,
    ...(scenario.risorse || {}),
  };
  return sh;
}

const errore = (messaggio) => { throw new V.ErroreFs(messaggio); };
const opzione = (args, lettera) => args.some((a) => a.startsWith("-") && a.slice(1).includes(lettera));
const argomenti = (args) => args.filter((a) => !a.startsWith("-"));

function dimensione(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.ceil(n / 1024)}K`;
  return `${(n / (1024 * 1024)).toFixed(1)}M`;
}

function peso(sh, percorso) {
  const abs = V.normalizza(sh.fs, percorso);
  if (!V.esiste(sh.fs, abs)) errore(`${percorso}: file o directory non esistente`);
  return V.sottoalbero(sh.fs, abs).reduce((totale, p) => {
    const n = sh.fs.nodi.get(p);
    return totale + (n?.tipo === "file" ? n.contenuto.length : 0);
  }, 0);
}

function nomeNellArchivio(sh, assoluto) {
  const cwd = sh.fs.cwd === "/" ? "/" : sh.fs.cwd + "/";
  if (assoluto.startsWith(cwd)) return assoluto.slice(cwd.length);
  return assoluto.replace(/^\//, "");
}

function creaArchivio(sh, archivio, bersagli) {
  if (!bersagli.length) errore("tar: manca cosa archiviare");
  const elementi = [];
  for (const bersaglio of bersagli) {
    const radice = V.normalizza(sh.fs, bersaglio);
    if (!V.esiste(sh.fs, radice)) errore(`${bersaglio}: file o directory non esistente`);
    for (const p of V.sottoalbero(sh.fs, radice)) {
      const n = sh.fs.nodi.get(p);
      elementi.push({
        nome: nomeNellArchivio(sh, p) + (n.tipo === "dir" ? "/" : ""),
        tipo: n.tipo,
        contenuto: n.contenuto ?? "",
      });
    }
  }
  const abs = V.normalizza(sh.fs, archivio);
  sh.archivi[abs] = elementi;
  V.scrivi(sh.fs, abs, `archivio tar: ${elementi.length} elementi\n`);
}

function leggiArchivio(sh, archivio) {
  const abs = V.normalizza(sh.fs, archivio);
  const elementi = sh.archivi?.[abs];
  if (!elementi) errore(`${archivio}: non e' un archivio creato in questo scenario`);
  return elementi;
}

function estraeArchivio(sh, archivio) {
  for (const elemento of leggiArchivio(sh, archivio)) {
    const nome = elemento.nome.replace(/\/$/, "");
    if (!nome) continue;
    if (elemento.tipo === "dir") V.creaDir(sh.fs, nome, true);
    else {
      V.creaDir(sh.fs, V.genitore(V.normalizza(sh.fs, nome)), true);
      V.scrivi(sh.fs, nome, elemento.contenuto);
    }
  }
}

function pacchetto(sh, nome) {
  const p = sh.pacchetti?.[nome];
  if (!p) errore(`impossibile trovare il pacchetto ${nome}`);
  return p;
}

export const SISTEMA = {
  tar(sh, args) {
    const flags = args.find((a) => a.startsWith("-")) ?? "";
    const lettere = flags.replace(/^-/, "");
    const azione = ["c", "t", "x"].find((l) => lettere.includes(l));
    if (!azione || !lettere.includes("f")) errore("usa tar -cf, -tf o -xf con il nome dell'archivio");
    const iFlags = args.indexOf(flags);
    const archivio = args[iFlags + 1];
    if (!archivio) errore("tar: manca il nome dell'archivio");
    const resto = args.slice(iFlags + 2);
    if (azione === "c") creaArchivio(sh, archivio, resto);
    if (azione === "t") return leggiArchivio(sh, archivio).map((e) => e.nome).join("\n");
    if (azione === "x") estraeArchivio(sh, archivio);
    return "";
  },

  gzip(sh, args) {
    const file = argomenti(args)[0];
    if (!file) errore("gzip: manca il file");
    const abs = V.normalizza(sh.fs, file);
    const contenuto = V.leggi(sh.fs, abs);
    const compresso = abs + ".gz";
    sh.gzip[compresso] = contenuto;
    V.scrivi(sh.fs, compresso, `gzip: ${contenuto.length} byte compressi\n`);
    V.rimuovi(sh.fs, abs);
    return "";
  },

  gunzip(sh, args) {
    const file = argomenti(args)[0];
    if (!file) errore("gunzip: manca il file .gz");
    const abs = V.normalizza(sh.fs, file);
    if (!abs.endsWith(".gz") || sh.gzip?.[abs] === undefined)
      errore(`${file}: non e' un gzip creato in questo scenario`);
    const originale = abs.slice(0, -3);
    V.scrivi(sh.fs, originale, sh.gzip[abs]);
    V.rimuovi(sh.fs, abs);
    delete sh.gzip[abs];
    return "";
  },

  apt(sh, args) {
    const [azione, ...resto] = args;
    if (azione === "update") return "Elenco pacchetti aggiornato.";
    if (azione === "install") {
      if (!resto.length) errore("apt install: manca il pacchetto");
      return resto.map((nome) => {
        const p = pacchetto(sh, nome);
        if (p.installato) return `${nome} e' gia' alla versione piu' recente (${p.versione})`;
        p.installato = true;
        return `Installato ${nome} (${p.versione})`;
      }).join("\n");
    }
    if (azione === "remove") {
      if (!resto.length) errore("apt remove: manca il pacchetto");
      return resto.map((nome) => {
        const p = pacchetto(sh, nome);
        if (!p.installato) return `${nome} non e' installato`;
        p.installato = false;
        return `Rimosso ${nome}`;
      }).join("\n");
    }
    if (azione === "list" && resto.includes("--installed")) {
      return Object.entries(sh.pacchetti ?? {})
        .filter(([, p]) => p.installato)
        .map(([nome, p]) => `${nome}/simulato ${p.versione} installato`)
        .sort()
        .join("\n");
    }
    errore("apt: usa update, install, remove o list --installed");
  },

  df(sh, args) {
    const r = sh.risorse;
    const disponibile = Math.max(0, r.discoTotale - r.discoUsato);
    const percento = Math.round((r.discoUsato / r.discoTotale) * 100);
    return [
      "Filesystem     Size  Used Avail Use% Mounted on",
      `/dev/vda1      ${r.discoTotale}G   ${r.discoUsato}G   ${disponibile}G  ${percento}% /`,
    ].join("\n");
  },

  du(sh, args) {
    const bersagli = argomenti(args);
    const lista = bersagli.length ? bersagli : ["."];
    const umano = opzione(args, "h");
    return lista.map((p) => {
      const byte = peso(sh, p);
      return `${umano ? dimensione(byte) : Math.ceil(byte / 1024)}\t${p}`;
    }).join("\n");
  },

  free(sh) {
    const r = sh.risorse;
    return [
      "               total        used        free",
      `Mem:            ${r.memoriaTotale}        ${r.memoriaUsata}        ${r.memoriaTotale - r.memoriaUsata}`,
      `Swap:           ${r.swapTotale}        ${r.swapUsata}        ${r.swapTotale - r.swapUsata}`,
    ].join("\n");
  },

  uname(sh, args) {
    if (args.includes("-a")) return "Linux stazione 6.8.0-simulato #1 SMP x86_64 GNU/Linux";
    return "Linux";
  },
};
