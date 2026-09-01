// Container: immagini, volumi, e la riproducibilita' che ne e' il motivo.
//
// Un container qui e' tre cose vere:
//   - un'IMMAGINE, costruita leggendo un Dockerfile che scrivi tu (FROM, RUN
//     pip install, COPY, WORKDIR, CMD): se il Dockerfile non c'e' o la base e'
//     sconosciuta, la build fallisce come sulla macchina;
//   - un FILESYSTEM proprio, che nasce dall'immagine e muore con il container:
//     quello che scrivi dentro e' perso, ed e' la lezione centrale;
//   - i VOLUMI, che collegano una cartella tua a una del container e sono
//     l'unico modo perche' un risultato sopravviva.
//
// Il comando dentro il container gira sullo stesso motore di shell degli altri
// moduli: cambia il filesystem, non i comandi.

import * as V from "./vfs.js";
import { POSIX, creaShell, esegui } from "./shell.js";

const BASI = {
  "python:3.12": { pacchetti: ["pip", "setuptools"], descrizione: "Python 3.12 ufficiale" },
  "python:3.12-slim": { pacchetti: ["pip"], descrizione: "Python 3.12 senza gli extra" },
  "ubuntu:24.04": { pacchetti: [], descrizione: "Ubuntu 24.04 di base" },
};

export function statoContainer(sh, scenario = {}) {
  // Lo scenario arriva dal JSON dell'esercizio, che l'app carica una volta
  // sola: senza copiarlo, i comandi modificherebbero la dichiarazione
  // stessa e l'esercizio ripartirebbe dallo stato in cui l'hai lasciato.
  scenario = structuredClone(scenario);
  sh.container = {
    immagini: {
      ...Object.fromEntries(
        Object.entries(BASI).map(([n, b]) => [n, { base: null, pacchetti: [...b.pacchetti], file: {}, cmd: null, workdir: "/" }])
      ),
      ...(scenario.immagini || {}),
    },
    attivi: scenario.attivi ?? {},
    contatore: 0,
    sif: scenario.sif ?? {},
    ...(scenario.extra || {}),
  };
  return sh;
}

const c = (sh) => sh.container;

function immagine(sh, nome) {
  const img = c(sh).immagini[nome];
  if (!img) throw new V.ErroreFs(`Unable to find image '${nome}' locally`);
  return img;
}

/** Il filesystem che il container si trova davanti: quello dell'immagine. */
function fsDaImmagine(sh, img) {
  const fs = V.crea({});
  V.creaDir(fs, "/lavoro", true);
  for (const [percorso, testo] of Object.entries(img.file)) V.scrivi(fs, percorso, testo);
  fs.cwd = img.workdir || "/";
  return fs;
}

function opzioniRun(args) {
  const volumi = [];
  let workdir = null;
  let staccato = false;
  let rimuovi = false;
  const resto = [];
  // Le opzioni sono quelle PRIMA del nome dell'immagine: da li' in poi e' tutto
  // comando del container, trattini compresi — altrimenti "sh -c ..." perde il -c.
  let immagineVista = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (immagineVista) {
      resto.push(a);
      continue;
    }
    if (a === "-v" || a === "--volume") volumi.push(args[++i]);
    else if (a === "-w" || a === "--workdir") workdir = args[++i];
    else if (a === "-d" || a === "--detach") staccato = true;
    else if (a === "--rm") rimuovi = true;
    else if (a === "--name") args[++i];
    else if (!a.startsWith("-")) {
      resto.push(a);
      immagineVista = true;
    }
  }
  return { volumi, workdir, staccato, rimuovi, resto };
}

/** Copia una cartella dell'host dentro il container (e viceversa al ritorno):
 *  e' il modello piu' semplice di un volume, e basta a far vedere cosa resta. */
function versa(origine, destino, da, a) {
  const base = V.normalizza(origine, da);
  if (!V.esiste(origine, base)) return;
  for (const p of V.sottoalbero(origine, base)) {
    if (V.eDir(origine, p)) continue;
    const arrivo = `${a}${p.slice(base.length)}`;
    V.creaDir(destino, V.genitore(V.normalizza(destino, arrivo)), true);
    V.scrivi(destino, arrivo, V.leggi(origine, p));
  }
}

export const CONTAINER = {
  docker(sh, args) {
    const [azione, ...resto] = args;

    if (azione === "images")
      return ["REPOSITORY:TAG            PACCHETTI",
        ...Object.entries(c(sh).immagini).map(([n, i]) => `${n.padEnd(25)} ${i.pacchetti.join(", ") || "-"}`)]
        .join("\n");

    if (azione === "pull") {
      const nome = resto.find((a) => !a.startsWith("-"));
      if (!BASI[nome]) throw new V.ErroreFs(`${nome}: immagine non trovata nel registro`);
      c(sh).immagini[nome] = { base: null, pacchetti: [...BASI[nome].pacchetti], file: {}, cmd: null, workdir: "/" };
      return `${nome} scaricata.`;
    }

    if (azione === "build") return build(sh, resto);

    if (azione === "run") {
      const { volumi, workdir, staccato, rimuovi, resto: liberi } = opzioniRun(resto);
      const nomeImg = liberi[0];
      const img = immagine(sh, nomeImg);
      const comando = liberi.slice(1).join(" ") || img.cmd;

      const fs = fsDaImmagine(sh, img);
      // I volumi si montano prima: il container vede la TUA cartella.
      for (const v of volumi) {
        const [host, dentro] = v.split(":");
        V.creaDir(fs, dentro, true);
        versa(sh.fs, fs, host, dentro);
      }
      if (workdir) fs.cwd = workdir;

      let uscita = "";
      if (comando) {
        const dentro = creaShell({}, { comandi: comandiContainer(img) });
        dentro.fs = fs;
        const r = esegui(dentro, comando.replace(/^["']|["']$/g, ""));
        if (r.errore) uscita = r.errore;
        else uscita = r.out;
      }

      // ...e si smontano dopo: quello che il container ha scritto nel volume
      // torna da te. Tutto il resto muore con lui.
      for (const v of volumi) {
        const [host, dentro] = v.split(":");
        versa(fs, sh.fs, dentro, host);
      }

      const id = `c${++c(sh).contatore}`;
      if (!rimuovi)
        c(sh).attivi[id] = { immagine: nomeImg, stato: staccato ? "running" : "exited", log: uscita, comando };
      return staccato ? id : uscita;
    }

    if (azione === "ps") {
      const tutti = resto.includes("-a");
      const righe = Object.entries(c(sh).attivi)
        .filter(([, x]) => tutti || x.stato === "running")
        .map(([id, x]) => `${id.padEnd(6)} ${x.immagine.padEnd(20)} ${x.stato.padEnd(8)} ${x.comando ?? ""}`);
      return ["CONTAINER  IMAGE                STATUS   COMMAND", ...righe].join("\n");
    }

    if (azione === "logs") {
      const id = resto.find((a) => !a.startsWith("-"));
      const x = c(sh).attivi[id];
      if (!x) throw new V.ErroreFs(`${id}: nessun container con questo id`);
      return x.log;
    }

    if (azione === "rm") {
      for (const id of resto.filter((a) => !a.startsWith("-"))) {
        if (!c(sh).attivi[id]) throw new V.ErroreFs(`${id}: nessun container con questo id`);
        if (c(sh).attivi[id].stato === "running")
          throw new V.ErroreFs(`${id}: e' in esecuzione, fermalo prima (docker stop)`);
        delete c(sh).attivi[id];
      }
      return "";
    }

    if (azione === "stop") {
      const id = resto.find((a) => !a.startsWith("-"));
      const x = c(sh).attivi[id];
      if (!x) throw new V.ErroreFs(`${id}: nessun container con questo id`);
      x.stato = "exited";
      return id;
    }

    throw new V.ErroreFs("usa images, pull, build, run, ps, logs, stop o rm");
  },

  /** Apptainer (ex Singularity): il formato dei cluster. Nessun demone, un file
   *  solo, e la tua home montata di default — che e' la differenza pratica. */
  apptainer(sh, args) {
    const [azione, ...resto] = args;
    if (azione === "build") {
      const [file, sorgente] = resto.filter((a) => !a.startsWith("-"));
      const nome = String(sorgente ?? "").replace(/^docker:\/\//, "");
      if (!c(sh).immagini[nome]) throw new V.ErroreFs(`${sorgente}: immagine non disponibile`);
      c(sh).sif[file] = nome;
      V.scrivi(sh.fs, file, `immagine Apptainer di ${nome}\n`);
      return `INFO:    Build complete: ${file}`;
    }
    if (azione === "exec" || azione === "run") {
      const file = resto.find((a) => !a.startsWith("-"));
      const nome = c(sh).sif[file];
      if (!nome) throw new V.ErroreFs(`${file}: non e' un'immagine Apptainer`);
      const img = immagine(sh, nome);
      // Dopo il nome dell'immagine tutto e' comando, opzioni comprese: filtrare
      // i trattini qui vorrebbe dire mangiarsi il -l di "wc -l".
      const comando = resto.slice(resto.indexOf(file) + 1).join(" ");
      const fs = fsDaImmagine(sh, img);
      // La home e' montata di default: e' il motivo per cui su un cluster i
      // dati non si copiano dentro l'immagine.
      V.creaDir(fs, "/home/tu", true);
      versa(sh.fs, fs, "/home/tu", "/home/tu");
      fs.cwd = "/home/tu";
      const dentro = creaShell({}, { comandi: comandiContainer(img) });
      dentro.fs = fs;
      const r = esegui(dentro, comando);
      versa(fs, sh.fs, "/home/tu", "/home/tu");
      if (r.errore) throw new V.ErroreFs(r.errore);
      return r.out;
    }
    throw new V.ErroreFs("usa build oppure exec");
  },
};

/** Dentro un container ci sono i comandi di sempre, piu' due che li' hanno un
 *  senso particolare: pip legge i pacchetti dell'immagine, e sh -c permette di
 *  passare una riga intera come fa Docker. */
function comandiContainer(img) {
  const comandi = {
    ...POSIX,
    pip: (s, a) => pip(img, a),
    sh(s, a) {
      const i = a.indexOf("-c");
      if (i < 0) throw new V.ErroreFs("qui sh vuole -c seguito dal comando");
      const riga = a.slice(i + 1).join(" ").replace(/^["']|["']$/g, "");
      const r = esegui(s, riga);
      if (r.errore) throw new V.ErroreFs(r.errore);
      return r.out;
    },
  };
  return comandi;
}

function pip(img, args) {
  if (args[0] === "list") return img.pacchetti.map((p) => `${p} (installato nell'immagine)`).join("\n");
  if (args[0] === "install")
    throw new V.ErroreFs("dentro un container si installa nel Dockerfile, non a mano: la modifica morirebbe con il container");
  throw new V.ErroreFs("qui pip capisce solo list");
}

function build(sh, args) {
  const t = args.indexOf("-t");
  const tag = t >= 0 ? args[t + 1] : null;
  const contesto = args.filter((a) => !a.startsWith("-") && a !== tag).at(-1) ?? ".";
  if (!tag) throw new V.ErroreFs("serve -t nome:tag");

  const dockerfile = `${contesto === "." ? sh.fs.cwd : contesto}/Dockerfile`;
  if (!V.esiste(sh.fs, dockerfile))
    throw new V.ErroreFs(`${dockerfile}: non trovato (serve un Dockerfile nel contesto di build)`);

  const righe = V.leggi(sh.fs, dockerfile).split("\n").map((r) => r.trim()).filter((r) => r && !r.startsWith("#"));
  const passi = [];
  let img = null;

  for (const riga of righe) {
    const [istruzione, ...pezzi] = riga.split(/\s+/);
    const valore = pezzi.join(" ");
    switch (istruzione.toUpperCase()) {
      case "FROM": {
        const base = c(sh).immagini[valore];
        if (!base) throw new V.ErroreFs(`FROM ${valore}: immagine di base sconosciuta`);
        img = { base: valore, pacchetti: [...base.pacchetti], file: { ...base.file }, cmd: base.cmd, workdir: base.workdir };
        passi.push(`Step FROM ${valore}`);
        break;
      }
      case "RUN": {
        if (!img) throw new V.ErroreFs("il Dockerfile deve cominciare con FROM");
        const pacchetti = valore.match(/pip install\s+(.+)$/);
        if (pacchetti) img.pacchetti.push(...pacchetti[1].split(/\s+/).filter((x) => !x.startsWith("-")));
        passi.push(`Step RUN ${valore}`);
        break;
      }
      case "COPY": {
        if (!img) throw new V.ErroreFs("il Dockerfile deve cominciare con FROM");
        const [da, a] = valore.split(/\s+/);
        // Il contesto di build e' la cartella: un file fuori non si copia, ed e'
        // la prima sorpresa di chi scrive COPY ../qualcosa.
        if (da.startsWith("..")) throw new V.ErroreFs(`COPY ${da}: fuori dal contesto di build`);
        if (!V.esiste(sh.fs, da)) throw new V.ErroreFs(`COPY ${da}: non esiste nel contesto di build`);
        const dentro = a.endsWith("/") ? `${a}${V.foglia(V.normalizza(sh.fs, da))}` : a;
        img.file[dentro] = V.leggi(sh.fs, da);
        passi.push(`Step COPY ${da} ${a}`);
        break;
      }
      case "WORKDIR":
        img.workdir = valore;
        passi.push(`Step WORKDIR ${valore}`);
        break;
      case "CMD":
        img.cmd = valore.replace(/^\[|\]$/g, "").replace(/"/g, "").replace(/,\s*/g, " ");
        passi.push(`Step CMD ${valore}`);
        break;
      default:
        passi.push(`Step ${istruzione} (ignorato qui)`);
    }
  }
  if (!img) throw new V.ErroreFs("Dockerfile vuoto o senza FROM");
  c(sh).immagini[tag] = img;
  return [...passi, `Successfully tagged ${tag}`].join("\n");
}
