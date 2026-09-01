// Comandi simulati per il ramo degli ambienti: python, pip, venv, export.
//
// Il modello e' volutamente stretto e fedele su un punto solo, che e' quello
// che conta: **quale python vince decide dove pip installa**. Tutto il resto —
// versioni, dipendenze, ruote, indici — e' scenografia e non viene simulato.
//
// Un interprete e' un percorso con dentro una versione e un elenco di
// pacchetti. Il PATH decide quale percorso risponde al nome "python", e pip
// installa nell'interprete che risponde in quel momento: e' letteralmente la
// causa di ogni ModuleNotFoundError su un pacchetto "gia' installato".

import * as V from "./vfs.js";

/** Aggiunge a una shell il mondo degli interpreti. Da passare a creaShell. */
export function statoAmbienti(sh, interpreti = {}) {
  // Lo interpreti arriva dal JSON dell'esercizio, che l'app carica una volta
  // sola: senza copiarlo, i comandi modificherebbero la dichiarazione
  // stessa e l'esercizio ripartirebbe dallo stato in cui l'hai lasciato.
  interpreti = structuredClone(interpreti);
  sh.interpreti = {};
  for (const [percorso, dati] of Object.entries(interpreti)) {
    sh.interpreti[percorso] = {
      versione: dati.versione ?? "3.12.0",
      pacchetti: { ...(dati.pacchetti || {}) },
      // Chi ha installato cosa: serve solo a conda, che deve poter dire quali
      // pacchetti sono arrivati da pip e quindi sfuggono al suo controllo.
      daPip: new Set(dati.daPip || []),
      base: dati.base ?? null, // per i venv: da quale interprete sono nati
    };
    if (!V.esiste(sh.fs, percorso)) {
      V.creaDir(sh.fs, V.genitore(percorso), true);
      V.scrivi(sh.fs, percorso, "");
    }
  }
  return sh;
}

/** Il primo percorso del PATH che contiene quel nome. Null se non c'e'. */
export function risolvi(sh, nome) {
  for (const dir of (sh.env.PATH || "").split(":")) {
    if (!dir) continue;
    const p = dir + "/" + nome;
    if (V.esiste(sh.fs, p)) return p;
  }
  return null;
}

/**
 * L'interprete attivo. pip e python devono risolvere allo stesso modo: un pip
 * che punta a un interprete diverso da quello di python e' esattamente il
 * guasto che questo ramo insegna a diagnosticare, e va riprodotto, non evitato.
 */
function interpreteAttivo(sh, nome = "python") {
  const percorso = risolvi(sh, nome);
  if (!percorso) return null;
  // pip vive accanto al python del suo ambiente: /x/bin/pip -> /x/bin/python
  const suo = nome === "python" ? percorso : V.genitore(percorso) + "/python";
  return sh.interpreti[suo] ? { percorso: suo, dati: sh.interpreti[suo] } : null;
}

const senzaPython = "python: comando non trovato";

export const AMBIENTI = {
  python(sh, args) {
    const attivo = interpreteAttivo(sh, "python");
    if (!attivo) throw new V.ErroreFs("comando non trovato");

    if (args[0] === "--version" || args[0] === "-V") return `Python ${attivo.dati.versione}`;

    if (args[0] === "-m" && args[1] === "venv") {
      const nome = args[2];
      if (!nome) throw new V.ErroreFs("manca il nome dell'ambiente");
      const radice = V.normalizza(sh.fs, nome);
      V.creaDir(sh.fs, radice + "/bin", true);
      V.scrivi(sh.fs, radice + "/bin/python", "");
      V.scrivi(sh.fs, radice + "/bin/pip", "");
      V.scrivi(sh.fs, radice + "/bin/activate", "");
      // Un ambiente nuovo nasce **vuoto**: e' il punto della lezione. Eredita
      // la versione dell'interprete che lo ha creato, non i suoi pacchetti.
      sh.interpreti[radice + "/bin/python"] = {
        versione: attivo.dati.versione,
        pacchetti: {},
        base: attivo.percorso,
      };
      return "";
    }

    if (args[0] === "-m" && args[1] === "pip") return AMBIENTI.pip(sh, args.slice(2));

    if (args[0] === "-c") {
      const codice = args.slice(1).join(" ");
      const m = codice.match(/import\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (!m) return "";
      const nome = m[1];

      // La cartella corrente viene prima dei pacchetti installati: un tuo file
      // chiamato numpy.py **e'** numpy per quel programma. L'import riesce, il
      // pacchetto vero non viene mai caricato, e il messaggio d'errore che
      // segue non nomina mai il tuo file.
      const locale = V.normalizza(sh.fs, nome + ".py");
      if (V.esiste(sh.fs, locale)) {
        if (/__file__/.test(codice)) return locale;
        if (/__version__/.test(codice))
          throw new V.ErroreFs(`AttributeError: module '${nome}' has no attribute '__version__'`);
        return "";
      }

      const versione = attivo.dati.pacchetti[nome];
      if (!versione) throw new V.ErroreFs(`ModuleNotFoundError: No module named '${nome}'`);
      // print(x.__version__) e print(x.__file__): le due domande che si fanno a un
      // pacchetto quando non si capisce quale copia sia stata importata.
      if (/__version__/.test(codice)) return versione;
      if (/__file__/.test(codice))
        return `${V.genitore(V.genitore(attivo.percorso))}/lib/${nome}/__init__.py`;
      return "";
    }

    return `Python ${attivo.dati.versione}`;
  },

  pip(sh, args) {
    const attivo = interpreteAttivo(sh, "pip") || interpreteAttivo(sh, "python");
    if (!attivo) throw new V.ErroreFs("comando non trovato");
    const p = attivo.dati.pacchetti;
    const [azione, ...resto] = args;

    if (azione === "--version" || azione === "-V")
      return `pip 24.0 from ${V.genitore(attivo.percorso)} (python ${attivo.dati.versione})`;

    if (azione === "install") {
      const nomi = resto.filter((a) => !a.startsWith("-"));
      if (!nomi.length) throw new V.ErroreFs("manca il nome del pacchetto");
      const righe = [];
      for (const spec of nomi) {
        // "-r requirements.txt" installa quello che c'e' scritto nel file
        if (spec === "requirements.txt" || resto.includes("-r")) {
          if (!V.esiste(sh.fs, spec)) continue;
          for (const riga of V.leggi(sh.fs, spec).split("\n")) {
            const pulita = riga.trim();
            if (!pulita || pulita.startsWith("#")) continue;
            const [n, v] = pulita.split("==");
            p[n] = v || "1.0.0";
            righe.push(`Successfully installed ${n}-${p[n]}`);
          }
          continue;
        }
        const [nome, versione] = spec.split("==");
        // --upgrade porta all'ultima versione nota: senza, un pacchetto gia'
        // presente non viene toccato, ed e' il motivo per cui "l'ho installato"
        // e "ho la versione giusta" sono due affermazioni diverse.
        if (p[nome] && !versione && !resto.includes("--upgrade") && !resto.includes("-U")) {
          righe.push(`Requirement already satisfied: ${nome} in ${V.genitore(attivo.percorso)}`);
          continue;
        }
        p[nome] = versione || VERSIONI[nome] || "1.0.0";
        righe.push(`Successfully installed ${nome}-${p[nome]}`);
      }
      return righe.join("\n");
    }

    if (azione === "uninstall") {
      const nome = resto.filter((a) => !a.startsWith("-"))[0];
      if (!p[nome]) return `WARNING: Skipping ${nome} as it is not installed.`;
      delete p[nome];
      return `Successfully uninstalled ${nome}`;
    }

    if (azione === "list") {
      const nomi = Object.keys(p).sort();
      if (!nomi.length) return "Package Version\n------- -------";
      return ["Package Version", "------- -------", ...nomi.map((n) => `${n} ${p[n]}`)].join("\n");
    }

    if (azione === "freeze")
      return Object.keys(p).sort().map((n) => `${n}==${p[n]}`).join("\n");

    if (azione === "show") {
      const nome = resto[0];
      if (!p[nome]) return `WARNING: Package(s) not found: ${nome}`;
      return `Name: ${nome}\nVersion: ${p[nome]}\nLocation: ${V.genitore(attivo.percorso)}`;
    }

    throw new V.ErroreFs(`azione sconosciuta: ${azione}`);
  },

  /**
   * L'attivazione non e' magia: mette la cartella dell'ambiente in testa al
   * PATH e ricorda dove sei. Tolta quella riga, non resta niente.
   */
  source(sh, args) {
    const percorso = args[0];
    if (!percorso || !percorso.endsWith("activate"))
      throw new V.ErroreFs("si attiva un ambiente con: source NOME/bin/activate");
    const abs = V.normalizza(sh.fs, percorso);
    if (!V.esiste(sh.fs, abs)) throw new V.ErroreFs(`${percorso}: file non esistente`);
    const bin = V.genitore(abs);
    sh.env.VIRTUAL_ENV = V.genitore(bin);
    sh.env.PATH = bin + ":" + sh.env.PATH;
    return "";
  },

  deactivate(sh) {
    if (!sh.env.VIRTUAL_ENV) return "";
    const bin = sh.env.VIRTUAL_ENV + "/bin";
    sh.env.PATH = sh.env.PATH.split(":").filter((d) => d !== bin).join(":");
    delete sh.env.VIRTUAL_ENV;
    return "";
  },

  export(sh, args) {
    const assegnazione = args.join(" ");
    const i = assegnazione.indexOf("=");
    if (i < 0) throw new V.ErroreFs("serve NOME=valore");
    const nome = assegnazione.slice(0, i);
    let valore = assegnazione.slice(i + 1);
    // $PATH dentro il valore: la sola espansione che serve, ed e' quella con
    // cui si aggiunge una cartella davanti senza cancellare il resto.
    valore = valore.replace(/\$PATH/g, sh.env.PATH || "");
    sh.env[nome] = valore;
    return "";
  },

  echo(sh, args) {
    return args
      .map((a) => (a.startsWith("$") ? sh.env[a.slice(1)] ?? "" : a))
      .join(" ");
  },
};

// ---------- conda ----------
//
// Stesso modello di interprete, con una cosa in piu': si tiene traccia di **chi**
// ha installato ogni pacchetto. E' l'unica informazione che serve per insegnare
// il guasto vero di conda — che conda non sa cosa ha fatto pip, e sovrascrivendo
// un pacchetto installato da pip lascia l'ambiente in uno stato che nessuno dei
// due strumenti sa piu' descrivere.

const RADICE_CONDA = "/opt/conda";

/** Il segno di chi ha installato: "pypi" per pip, il canale per conda. */
function canale(dati, nome) {
  return (dati.daPip && dati.daPip.has(nome)) ? "pypi" : "conda-forge";
}

function ambienteConda(sh) {
  const attivo = sh.env.CONDA_DEFAULT_ENV;
  const percorso = attivo === "base"
    ? RADICE_CONDA + "/bin/python"
    : `${RADICE_CONDA}/envs/${attivo}/bin/python`;
  const dati = sh.interpreti?.[percorso];
  if (!dati) throw new V.ErroreFs("nessun ambiente conda attivo");
  return { nome: attivo, percorso, dati };
}

export const CONDA = {
  conda(sh, args) {
    const [azione, ...resto] = args;
    const nomi = resto.filter((a) => !a.startsWith("-"));

    if (azione === "--version" || azione === "-V") return "conda 24.7.1";

    if (azione === "create") {
      const i = resto.indexOf("-n");
      const nome = i >= 0 ? resto[i + 1] : nomi[0];
      if (!nome) throw new V.ErroreFs("manca il nome dell'ambiente: conda create -n NOME");
      const radice = `${RADICE_CONDA}/envs/${nome}`;
      V.creaDir(sh.fs, radice + "/bin", true);
      V.scrivi(sh.fs, radice + "/bin/python", "");
      V.scrivi(sh.fs, radice + "/bin/pip", "");
      // "python=3.12" fra gli argomenti fissa la versione: e' la cosa che venv
      // NON sa fare, ed e' il motivo principale per cui conda esiste.
      const spec = resto.find((a) => a.startsWith("python="));
      sh.interpreti[radice + "/bin/python"] = {
        versione: spec ? spec.slice("python=".length) : "3.12.0",
        pacchetti: {},
        daPip: new Set(),
        base: null,
      };
      return `# To activate this environment, use\n#     $ conda activate ${nome}`;
    }

    if (azione === "activate") {
      const nome = nomi[0] ?? "base";
      const bin = nome === "base"
        ? RADICE_CONDA + "/bin"
        : `${RADICE_CONDA}/envs/${nome}/bin`;
      if (!V.esiste(sh.fs, bin + "/python"))
        throw new V.ErroreFs(`EnvironmentNameNotFound: ambiente '${nome}' non trovato`);
      if (sh.env.CONDA_DEFAULT_ENV) CONDA.conda(sh, ["deactivate"]);
      sh.env.PATH = bin + ":" + sh.env.PATH;
      sh.env.CONDA_DEFAULT_ENV = nome;
      return "";
    }

    if (azione === "deactivate") {
      if (!sh.env.CONDA_DEFAULT_ENV) return "";
      const nome = sh.env.CONDA_DEFAULT_ENV;
      const bin = nome === "base" ? RADICE_CONDA + "/bin" : `${RADICE_CONDA}/envs/${nome}/bin`;
      sh.env.PATH = sh.env.PATH.split(":").filter((d) => d !== bin).join(":");
      delete sh.env.CONDA_DEFAULT_ENV;
      return "";
    }

    if (azione === "install") {
      const amb = ambienteConda(sh);
      if (!nomi.length) throw new V.ErroreFs("manca il nome del pacchetto");
      const righe = [];
      for (const spec of nomi) {
        const [nome, versione] = spec.split("=").filter(Boolean);
        const eraDiPip = amb.dati.daPip?.has(nome);
        amb.dati.pacchetti[nome] = versione || VERSIONI[nome] || "1.0.0";
        amb.dati.daPip?.delete(nome);
        righe.push(
          eraDiPip
            ? `# ATTENZIONE: ${nome} era stato installato da pip ed e' stato sovrascritto`
            : `Preparing transaction: done\n# installato ${nome}-${amb.dati.pacchetti[nome]}`
        );
      }
      return righe.join("\n");
    }

    if (azione === "list") {
      const amb = ambienteConda(sh);
      const nomiP = Object.keys(amb.dati.pacchetti).sort();
      const intestazione = `# packages in environment at ${V.genitore(V.genitore(amb.percorso))}:\n#\n# Name  Version  Channel`;
      if (!nomiP.length) return intestazione;
      return [
        intestazione,
        ...nomiP.map((n) => `${n}  ${amb.dati.pacchetti[n]}  ${canale(amb.dati, n)}`),
      ].join("\n");
    }

    if (azione === "env" && resto[0] === "list") {
      const righe = ["# conda environments:", "#"];
      for (const p of Object.keys(sh.interpreti)) {
        if (!p.startsWith(RADICE_CONDA)) continue;
        const nome = p === RADICE_CONDA + "/bin/python"
          ? "base"
          : p.slice((RADICE_CONDA + "/envs/").length).split("/")[0];
        const segno = sh.env.CONDA_DEFAULT_ENV === nome ? "*" : " ";
        righe.push(`${nome.padEnd(12)}${segno}  ${V.genitore(V.genitore(p))}`);
      }
      return righe.join("\n");
    }

    throw new V.ErroreFs(`azione sconosciuta: ${azione}`);
  },

  // pip resta quello di prima, ma dentro un ambiente conda deve marcare cio' che
  // installa: e' l'informazione che conda list mostra come "pypi", e senza la
  // quale il guasto del mescolamento sarebbe invisibile.
  pip(sh, args) {
    const risultato = AMBIENTI.pip(sh, args);
    if (args[0] === "install" && sh.env.CONDA_DEFAULT_ENV) {
      const amb = ambienteConda(sh);
      amb.dati.daPip = amb.dati.daPip ?? new Set();
      for (const spec of args.slice(1).filter((a) => !a.startsWith("-")))
        amb.dati.daPip.add(spec.split("=")[0]);
    }
    return risultato;
  },
};

/** Il dizionario per gli esercizi su conda: comandi degli ambienti piu' conda. */
export const AMBIENTI_CONDA = { ...AMBIENTI, ...CONDA };

// Versioni plausibili per i pacchetti che compaiono negli esercizi. Non serve a
// niente di tecnico: serve perche' "numpy-1.0.0" a schermo distrae.
const VERSIONI = {
  numpy: "2.2.5",
  matplotlib: "3.9.2",
  scipy: "1.14.1",
  pandas: "2.2.3",
  requests: "2.32.3",
};
