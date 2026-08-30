// Controllo del motore del terminale simulato.
//
//     node tools/test_shell.mjs
//
// Non e' un framework: e' una lista di casi e un assert. Il motore non ha altro
// modo di essere verificato — il controllo dei contenuti e' in Python e non sa
// niente del filesystem virtuale.

import assert from "node:assert";
import * as V from "../js/vfs.js";
import { creaShell, esegui, eseguiTutto, dividi, verifica } from "../js/shell.js";
import { AMBIENTI, AMBIENTI_CONDA, statoAmbienti } from "../js/ambienti.js";
import { comandiPowerShell } from "../js/powershell.js";
import { analizza, conTag, testoDi, verificaHtml } from "../js/html.js";

let fatti = 0;
const casi = [];
const caso = (nome, fn) => casi.push([nome, fn]);

// ---------- percorsi ----------

caso("normalizza risolve . e .. e toglie la barra finale", () => {
  const fs = V.crea();
  fs.cwd = "/home/tu";
  assert.equal(V.normalizza(fs, "dati/"), "/home/tu/dati");
  assert.equal(V.normalizza(fs, "./dati/./x"), "/home/tu/dati/x");
  assert.equal(V.normalizza(fs, "../.."), "/");
  assert.equal(V.normalizza(fs, "/a//b/"), "/a/b");
  assert.equal(V.normalizza(fs, "~"), "/home/tu");
  assert.equal(V.normalizza(fs, "~/note.txt"), "/home/tu/note.txt");
  assert.equal(V.normalizza(fs, ""), "/home/tu");
});

caso("risalire oltre la radice si ferma alla radice", () => {
  const fs = V.crea();
  fs.cwd = "/";
  assert.equal(V.normalizza(fs, "../../.."), "/");
});

// ---------- filesystem ----------

caso("scrivi crea il file e leggi lo rilegge", () => {
  const fs = V.crea();
  V.scrivi(fs, "/a.txt", "ciao\n");
  assert.equal(V.leggi(fs, "/a.txt"), "ciao\n");
  assert.equal(V.eFile(fs, "/a.txt"), true);
});

caso("scrivere in una cartella inesistente fallisce", () => {
  const fs = V.crea();
  assert.throws(() => V.scrivi(fs, "/manca/a.txt", "x"), V.ErroreFs);
});

caso("mkdir senza -p rifiuta i genitori mancanti, con -p li crea", () => {
  const fs = V.crea();
  assert.throws(() => V.creaDir(fs, "/a/b"), V.ErroreFs);
  V.creaDir(fs, "/a/b", true);
  assert.equal(V.eDir(fs, "/a"), true);
  assert.equal(V.eDir(fs, "/a/b"), true);
});

caso("elenca da' solo i figli diretti, ordinati", () => {
  const fs = V.crea({ "/a": null, "/a/uno.txt": "1", "/a/due.txt": "2", "/a/sub": null, "/a/sub/tre.txt": "3" });
  assert.deepEqual(V.elenca(fs, "/a"), ["due.txt", "sub", "uno.txt"]);
});

caso("rm su una directory serve -r", () => {
  const fs = V.crea({ "/a": null, "/a/x.txt": "1" });
  assert.throws(() => V.rimuovi(fs, "/a"), V.ErroreFs);
  V.rimuovi(fs, "/a", true);
  assert.equal(V.esiste(fs, "/a"), false);
  assert.equal(V.esiste(fs, "/a/x.txt"), false, "anche i figli spariscono");
});

caso("copiare su una directory esistente conserva il nome", () => {
  const fs = V.crea({ "/a.txt": "uno", "/dest": null });
  V.copia(fs, "/a.txt", "/dest");
  assert.equal(V.leggi(fs, "/dest/a.txt"), "uno");
});

caso("mv sposta un albero intero e lascia vuota la partenza", () => {
  const fs = V.crea({ "/a": null, "/a/x.txt": "1", "/b": null });
  V.sposta(fs, "/a", "/b");
  assert.equal(V.leggi(fs, "/b/a/x.txt"), "1");
  assert.equal(V.esiste(fs, "/a"), false);
});

// ---------- parser ----------

caso("dividi rispetta le virgolette e la stringa vuota", () => {
  assert.deepEqual(dividi('echo "ciao mondo"').parole, ["echo", "ciao mondo"]);
  assert.deepEqual(dividi("echo ''").parole, ["echo", ""]);
  assert.deepEqual(dividi("  ls   -l  ").parole, ["ls", "-l"]);
});

caso("dividi stacca la redirezione dagli argomenti", () => {
  const r = dividi("echo ciao > note.txt");
  assert.deepEqual(r.parole, ["echo", "ciao"]);
  assert.deepEqual(r.redirezione, { modo: ">", file: "note.txt" });
});

// ---------- comandi ----------

const shell = (iniziale, opzioni) => creaShell(iniziale, opzioni);

caso("pwd e cd si muovono e rifiutano i percorsi sbagliati", () => {
  const sh = shell({ "/home/tu/dati": null });
  assert.equal(esegui(sh, "pwd").out, "/home/tu");
  esegui(sh, "cd dati");
  assert.equal(esegui(sh, "pwd").out, "/home/tu/dati");
  esegui(sh, "cd ..");
  assert.equal(esegui(sh, "pwd").out, "/home/tu");
  assert.match(esegui(sh, "cd manca").errore, /non esistente/);
  assert.equal(sh.fs.cwd, "/home/tu", "un cd fallito non deve spostare nulla");
});

caso("cd senza argomenti torna a casa", () => {
  const sh = shell({ "/home/tu/dati": null });
  esegui(sh, "cd dati");
  esegui(sh, "cd");
  assert.equal(sh.fs.cwd, "/home/tu");
});

caso("ls nasconde i file nascosti senza -a", () => {
  const sh = shell({ "/home/tu/a.txt": "1", "/home/tu/.conf": "2" });
  assert.equal(esegui(sh, "ls").out, "a.txt");
  assert.equal(esegui(sh, "ls -a").out, ".conf\na.txt");
});

caso("mkdir, touch e cat costruiscono e rileggono", () => {
  const sh = shell();
  const t = eseguiTutto(sh, ["mkdir progetti", "cd progetti", "touch note.txt"]);
  assert.equal(t.every((r) => !r.errore), true, JSON.stringify(t));
  assert.equal(V.esiste(sh.fs, "/home/tu/progetti/note.txt"), true);
  assert.equal(esegui(sh, "cat note.txt").out, "");
});

caso("la redirezione scrive e quella doppia aggiunge", () => {
  const sh = shell();
  esegui(sh, "echo prima > note.txt");
  assert.equal(V.leggi(sh.fs, "/home/tu/note.txt"), "prima\n");
  esegui(sh, "echo seconda >> note.txt");
  assert.equal(V.leggi(sh.fs, "/home/tu/note.txt"), "prima\nseconda\n");
  assert.equal(esegui(sh, "cat note.txt").out, "prima\nseconda");
});

caso("un comando sconosciuto lo dice, invece di rompere", () => {
  const sh = shell();
  assert.match(esegui(sh, "sudo rm -rf /").errore, /comando non trovato/);
  assert.match(esegui(sh, "ls | ").errore, /attorno alla pipe/);
});

caso("la pipe passa l uscita di un comando al successivo", () => {
  const sh = shell({ "/home/tu/log.txt": "alfa\nbeta\nalfa2\n" });
  assert.equal(esegui(sh, "cat log.txt | grep alfa").out, "alfa\nalfa2");
  assert.equal(esegui(sh, "cat log.txt | grep alfa | wc -l").out, "2");
});

caso("la pipe si combina con la redirezione", () => {
  const sh = shell({ "/home/tu/log.txt": "alfa\nbeta\n" });
  esegui(sh, "cat log.txt | grep alfa > trovate.txt");
  assert.equal(V.leggi(sh.fs, "/home/tu/trovate.txt"), "alfa\n");
});

caso("sort ordina, e -n cambia il risultato", () => {
  const sh = shell({ "/home/tu/n.txt": "10\n9\n100\n" });
  assert.equal(esegui(sh, "sort n.txt").out, "10\n100\n9", "come stringhe");
  assert.equal(esegui(sh, "sort -n n.txt").out, "9\n10\n100", "come numeri");
  assert.equal(esegui(sh, "sort -n -r n.txt").out, "100\n10\n9");
});

caso("uniq toglie solo i duplicati adiacenti", () => {
  const sh = shell({ "/home/tu/c.txt": "a\nb\na\n" });
  assert.equal(esegui(sh, "uniq c.txt").out, "a\nb\na", "senza sort non trova il terzo");
  assert.equal(esegui(sh, "sort c.txt | uniq").out, "a\nb");
  assert.equal(esegui(sh, "sort c.txt | uniq -c").out, "2 a\n1 b");
});

caso("wc senza file non stampa il nome del file", () => {
  const sh = shell({ "/home/tu/log.txt": "a\nb\n" });
  assert.equal(esegui(sh, "wc -l log.txt").out, "2 log.txt");
  assert.equal(esegui(sh, "cat log.txt | wc -l").out, "2");
});

caso("rm -f tace sui file che non ci sono", () => {
  const sh = shell();
  assert.match(esegui(sh, "rm manca.txt").errore, /non esistente/);
  assert.equal(esegui(sh, "rm -f manca.txt").errore, null);
});

caso("grep filtra, -i ignora le maiuscole, -v inverte", () => {
  const sh = shell({ "/home/tu/log.txt": "Alfa\nbeta\nalfa2\n" });
  assert.equal(esegui(sh, "grep alfa log.txt").out, "alfa2");
  assert.equal(esegui(sh, "grep -i alfa log.txt").out, "Alfa\nalfa2");
  assert.equal(esegui(sh, "grep -v alfa log.txt").out, "Alfa\nbeta");
});

caso("wc -l conta le righe senza contare l'a capo finale", () => {
  const sh = shell({ "/home/tu/log.txt": "a\nb\nc\n" });
  assert.equal(esegui(sh, "wc -l log.txt").out, "3 log.txt");
});

caso("head e tail tagliano dalle due parti", () => {
  const sh = shell({ "/home/tu/log.txt": "1\n2\n3\n4\n5\n" });
  assert.equal(esegui(sh, "head -n 2 log.txt").out, "1\n2");
  assert.equal(esegui(sh, "tail -n 2 log.txt").out, "4\n5");
});

caso("find -name accetta l'asterisco", () => {
  const sh = shell({ "/home/tu/a.csv": "1", "/home/tu/b.txt": "2", "/home/tu/sub": null, "/home/tu/sub/c.csv": "3" });
  const out = esegui(sh, "find . -name *.csv").out.split("\n").sort();
  assert.deepEqual(out, ["/home/tu/a.csv", "/home/tu/sub/c.csv"]);
});

caso("which cerca lungo il PATH", () => {
  const sh = shell({ "/usr/bin": null, "/usr/bin/python": "" });
  assert.equal(esegui(sh, "which python").out, "/usr/bin/python");
  assert.equal(esegui(sh, "which inesistente").out, "");
});

// ---------- verifica degli esercizi ----------

caso("verifica promuove la soluzione giusta", () => {
  const sh = shell();
  const t = eseguiTutto(sh, ["mkdir progetti", "cd progetti", "touch note.txt"]);
  const esito = verifica(sh, { cwd: "/home/tu/progetti", esiste: ["/home/tu/progetti/note.txt"] }, t);
  assert.equal(esito.ok, true, JSON.stringify(esito.problemi));
});

caso("verifica boccia e dice cosa manca", () => {
  const sh = shell();
  const t = eseguiTutto(sh, ["mkdir progetti"]);
  const esito = verifica(sh, { cwd: "/home/tu/progetti", esiste: ["/home/tu/progetti/note.txt"] }, t);
  assert.equal(esito.ok, false);
  assert.equal(esito.problemi.length, 2, JSON.stringify(esito.problemi));
});

caso("verifica confronta il contenuto ignorando l'a capo finale", () => {
  const sh = shell();
  eseguiTutto(sh, ["echo ciao > note.txt"]);
  assert.equal(verifica(sh, { contenuto: { "note.txt": "ciao" } }).ok, true);
  assert.equal(verifica(sh, { contenuto: { "note.txt": "altro" } }).ok, false);
});

caso("usa controlla il comando digitato, non solo il risultato", () => {
  const sh = shell();
  const t = eseguiTutto(sh, ["echo ciao > note.txt"]);
  assert.equal(verifica(sh, { usa: ["touch"] }, t).ok, false, "touch non e' stato usato");
  assert.equal(verifica(sh, { usa: ["echo"] }, t).ok, true);
});

caso("stampa guarda l'uscita dei comandi", () => {
  const sh = shell({ "/home/tu/a.txt": "1" });
  const t = eseguiTutto(sh, ["ls"]);
  assert.equal(verifica(sh, { stampa: "a.txt" }, t).ok, true);
  assert.equal(verifica(sh, { stampa: "b.txt" }, t).ok, false);
});

// ---------- ambienti: python, pip, venv ----------

function shellPy() {
  const sh = creaShell({ "/usr/bin": null }, {
    env: { PATH: "/usr/bin:/bin" },
    comandi: AMBIENTI,
  });
  statoAmbienti(sh, {
    "/usr/bin/python": { versione: "3.12.0", pacchetti: { requests: "2.32.3" } },
  });
  V.scrivi(sh.fs, "/usr/bin/pip", "");
  return sh;
}

caso("python --version risponde con l'interprete del PATH", () => {
  const sh = shellPy();
  assert.equal(esegui(sh, "python --version").out, "Python 3.12.0");
});

caso("venv crea un ambiente vuoto, non una copia", () => {
  const sh = shellPy();
  esegui(sh, "python -m venv .venv");
  assert.equal(V.esiste(sh.fs, "/home/tu/.venv/bin/python"), true);
  assert.equal(esegui(sh, "pip list").out.includes("requests"), true, "fuori vede requests");
  esegui(sh, "source .venv/bin/activate");
  assert.equal(esegui(sh, "pip list").out.includes("requests"), false, "dentro l'ambiente e' vuoto");
});

caso("attivare mette il bin in testa al PATH e disattivare lo toglie", () => {
  const sh = shellPy();
  const primaPath = sh.env.PATH;
  esegui(sh, "python -m venv .venv");
  esegui(sh, "source .venv/bin/activate");
  assert.equal(sh.env.PATH.startsWith("/home/tu/.venv/bin:"), true);
  assert.equal(sh.env.VIRTUAL_ENV, "/home/tu/.venv");
  esegui(sh, "deactivate");
  assert.equal(sh.env.PATH, primaPath);
  assert.equal(sh.env.VIRTUAL_ENV, undefined);
});

caso("pip installa nell'ambiente attivo, non nell'altro", () => {
  const sh = shellPy();
  esegui(sh, "python -m venv .venv");
  esegui(sh, "source .venv/bin/activate");
  esegui(sh, "pip install numpy");
  assert.equal(esegui(sh, "pip list").out.includes("numpy"), true);
  esegui(sh, "deactivate");
  assert.equal(esegui(sh, "pip list").out.includes("numpy"), false, "fuori numpy non c'e'");
});

caso("il guasto vero: installato nell'ambiente sbagliato", () => {
  const sh = shellPy();
  esegui(sh, "python -m venv .venv");
  esegui(sh, "pip install numpy");            // installato FUORI dall'ambiente
  esegui(sh, "source .venv/bin/activate");    // e poi si attiva
  const r = esegui(sh, "python -c import numpy");
  assert.match(r.errore, /ModuleNotFoundError/);
});

caso("which python segue il PATH e cambia con l'attivazione", () => {
  const sh = shellPy();
  assert.equal(esegui(sh, "which python").out, "/usr/bin/python");
  esegui(sh, "python -m venv .venv");
  esegui(sh, "source .venv/bin/activate");
  assert.equal(esegui(sh, "which python").out, "/home/tu/.venv/bin/python");
});

caso("freeze e requirements ricostruiscono lo stesso ambiente", () => {
  const sh = shellPy();
  esegui(sh, "python -m venv .venv");
  esegui(sh, "source .venv/bin/activate");
  esegui(sh, "pip install numpy==2.2.5");
  esegui(sh, "pip freeze > requirements.txt");
  assert.equal(V.leggi(sh.fs, "/home/tu/requirements.txt").trim(), "numpy==2.2.5");
  esegui(sh, "deactivate");
  esegui(sh, "python -m venv altro");
  esegui(sh, "source altro/bin/activate");
  assert.equal(esegui(sh, "pip list").out.includes("numpy"), false);
  esegui(sh, "pip install -r requirements.txt");
  assert.equal(esegui(sh, "pip freeze").out.trim(), "numpy==2.2.5");
});

caso("export mette una cartella in testa al PATH senza cancellarlo", () => {
  const sh = shellPy();
  esegui(sh, "export PATH=/opt/bin:$PATH");
  assert.equal(sh.env.PATH, "/opt/bin:/usr/bin:/bin");
  assert.equal(esegui(sh, "echo $PATH").out, "/opt/bin:/usr/bin:/bin");
});

caso("pip uninstall toglie solo dall'ambiente attivo", () => {
  const sh = shellPy();
  esegui(sh, "pip install numpy");
  assert.match(esegui(sh, "pip uninstall numpy").out, /Successfully uninstalled/);
  assert.match(esegui(sh, "pip uninstall numpy").out, /Skipping/);
});

caso("which -a elenca tutte le copie, in ordine di PATH", () => {
  const sh = shell({ "/usr/bin/python": "", "/opt/py/bin/python": "" }, {
    env: { PATH: "/opt/py/bin:/usr/bin:/bin" },
  });
  assert.equal(esegui(sh, "which python").out, "/opt/py/bin/python");
  assert.equal(esegui(sh, "which -a python").out, "/opt/py/bin/python\n/usr/bin/python");
});

caso("python -c sa dire la versione e il percorso di un pacchetto", () => {
  const sh = shellPy();
  esegui(sh, "pip install numpy==2.2.5");
  assert.equal(esegui(sh, "python -c import numpy; print(numpy.__version__)").out, "2.2.5");
  assert.match(esegui(sh, "python -c import numpy; print(numpy.__file__)").out, /\/usr\/lib\/numpy/);
});

caso("reinstallare non aggiorna: serve --upgrade", () => {
  const sh = shellPy();
  esegui(sh, "pip install numpy==1.0.0");
  assert.match(esegui(sh, "pip install numpy").out, /already satisfied/);
  assert.equal(esegui(sh, "python -c import numpy; print(numpy.__version__)").out, "1.0.0");
  assert.match(esegui(sh, "pip install --upgrade numpy").out, /Successfully installed numpy-2.2.5/);
  assert.equal(esegui(sh, "python -c import numpy; print(numpy.__version__)").out, "2.2.5");
});

caso("pip e python disallineati: il guasto che pip -V rivela", () => {
  // pip di sistema davanti, python dell'ambiente dietro: due interpreti diversi
  const sh = shellPy();
  esegui(sh, "python -m venv .venv");
  sh.env.PATH = "/usr/bin:/home/tu/.venv/bin:/bin";
  assert.equal(esegui(sh, "which python").out, "/usr/bin/python");
  assert.equal(esegui(sh, "which pip").out, "/usr/bin/pip");
  esegui(sh, "pip install numpy");
  assert.equal(esegui(sh, "python -c import numpy").errore, null, "coerenti: l import riesce");
});

caso("un file locale con lo stesso nome oscura il pacchetto", () => {
  const sh = shellPy();
  esegui(sh, "pip install numpy");
  assert.equal(esegui(sh, "python -c import numpy; print(numpy.__version__)").out, "2.2.5");
  esegui(sh, "touch numpy.py");
  assert.match(
    esegui(sh, "python -c import numpy; print(numpy.__version__)").errore,
    /AttributeError/,
    "ora importa il file locale, che non ha __version__"
  );
  assert.equal(esegui(sh, "python -c import numpy; print(numpy.__file__)").out, "/home/tu/numpy.py");
  esegui(sh, "rm numpy.py");
  assert.equal(esegui(sh, "python -c import numpy; print(numpy.__version__)").out, "2.2.5");
});

// ---------- conda ----------

function shellConda() {
  const sh = creaShell({ "/usr/bin": null }, {
    env: { PATH: "/opt/conda/bin:/usr/bin:/bin", CONDA_DEFAULT_ENV: "base" },
    comandi: AMBIENTI_CONDA,
  });
  statoAmbienti(sh, {
    "/opt/conda/bin/python": { versione: "3.12.0", pacchetti: { numpy: "2.2.5" } },
  });
  V.scrivi(sh.fs, "/opt/conda/bin/pip", "");
  return sh;
}

caso("conda create fa un ambiente vuoto con la versione chiesta", () => {
  const sh = shellConda();
  esegui(sh, "conda create -n prove python=3.11");
  assert.equal(V.esiste(sh.fs, "/opt/conda/envs/prove/bin/python"), true);
  esegui(sh, "conda activate prove");
  assert.equal(esegui(sh, "python --version").out, "Python 3.11");
  assert.equal(esegui(sh, "conda list").out.includes("numpy"), false, "nasce vuoto");
});

caso("conda activate cambia il PATH, come fa venv", () => {
  const sh = shellConda();
  esegui(sh, "conda create -n prove");
  esegui(sh, "conda activate prove");
  assert.equal(esegui(sh, "which python").out, "/opt/conda/envs/prove/bin/python");
  assert.equal(sh.env.CONDA_DEFAULT_ENV, "prove");
  esegui(sh, "conda deactivate");
  assert.equal(sh.env.CONDA_DEFAULT_ENV, undefined);
});

caso("attivare un ambiente ne disattiva un altro invece di impilarli", () => {
  const sh = shellConda();
  esegui(sh, "conda create -n uno");
  esegui(sh, "conda create -n due");
  esegui(sh, "conda activate uno");
  esegui(sh, "conda activate due");
  assert.equal(esegui(sh, "which python").out, "/opt/conda/envs/due/bin/python");
  assert.equal(sh.env.PATH.includes("/opt/conda/envs/uno/bin"), false);
});

caso("conda list mostra da dove viene ogni pacchetto", () => {
  const sh = shellConda();
  esegui(sh, "conda create -n prove");
  esegui(sh, "conda activate prove");
  esegui(sh, "conda install numpy");
  esegui(sh, "pip install requests");
  const out = esegui(sh, "conda list").out;
  assert.match(out, /numpy.*conda-forge/, "numpy viene da conda");
  assert.match(out, /requests.*pypi/, "requests viene da pip");
});

caso("conda che sovrascrive un pacchetto di pip lo dice", () => {
  const sh = shellConda();
  esegui(sh, "conda create -n prove");
  esegui(sh, "conda activate prove");
  esegui(sh, "pip install numpy");
  assert.match(esegui(sh, "conda list").out, /numpy.*pypi/);
  const r = esegui(sh, "conda install numpy");
  assert.match(r.out, /ATTENZIONE/, "deve segnalare la sovrascrittura");
  assert.match(esegui(sh, "conda list").out, /numpy.*conda-forge/);
});

caso("conda env list segna l'ambiente attivo", () => {
  const sh = shellConda();
  esegui(sh, "conda create -n prove");
  esegui(sh, "conda activate prove");
  const out = esegui(sh, "conda env list").out;
  assert.match(out, /prove\s+\*/);
  assert.match(out, /base\s{2}/);
});

caso("attivare un ambiente che non esiste lo dice", () => {
  const sh = shellConda();
  assert.match(esegui(sh, "conda activate manca").errore, /non trovato/);
});

// ---------- PowerShell: la pipeline a oggetti ----------

const PROG = {
  "/home/tu/volo/note.txt": "campagna\n",
  "/home/tu/volo/dati/a.csv": "quota\n9000\n",
  "/home/tu/volo/dati/b.csv": "quota\n3000\n11000\n",
};
const shellPs = (fs = PROG, cwd) => creaShell(fs, { cwd, comandi: comandiPowerShell() });

caso("Get-ChildItem restituisce oggetti, non righe di testo", () => {
  const sh = shellPs();
  const r = esegui(sh, "Get-ChildItem volo");
  assert.match(r.out, /Mode/, "la tabella ha le intestazioni");
  assert.match(r.out, /note.txt/);
});

caso("gli alias fanno arrivare dov'e' abituato chi viene da bash", () => {
  const sh = shellPs();
  assert.equal(esegui(sh, "pwd").out, "/home/tu");
  assert.equal(esegui(sh, "cd volo").errore, null);
  assert.equal(esegui(sh, "Get-Location").out, "/home/tu/volo");
});

caso("Where-Object filtra su un CAMPO, senza ritagliare colonne", () => {
  const sh = shellPs();
  // a.csv sono 11 caratteri, b.csv 17: la soglia sta in mezzo.
  const r = esegui(sh, "Get-ChildItem volo/dati | Where-Object Length -gt 12");
  assert.match(r.out, /b\.csv/);
  assert.equal(/a\.csv/.test(r.out), false, "a.csv e' piu' corto e non passa");
});

caso("Sort-Object ordina i numeri come numeri", () => {
  const sh = shellPs();
  const r = esegui(sh, "Get-ChildItem volo/dati | Sort-Object Length | Select-Object Name");
  const righe = r.out.split("\n").slice(2);
  assert.match(righe[0], /a\.csv/, "il piu' corto per primo");
});

caso("Measure-Object conta e somma un campo", () => {
  const sh = shellPs();
  assert.match(esegui(sh, "Get-ChildItem volo/dati | Measure-Object").out, /Count/);
  assert.match(esegui(sh, "Get-ChildItem volo/dati | Measure-Object Length -Sum").out, /Sum/);
});

caso("Get-Content restituisce le righe, e Measure-Object le conta", () => {
  const sh = shellPs();
  const out = esegui(sh, "Get-Content volo/dati/b.csv | Measure-Object").out;
  assert.equal(out.split("\n").pop().trim(), "3");
});

caso("New-Item distingue file e directory con -ItemType", () => {
  const sh = shellPs();
  esegui(sh, "New-Item -Path volo/out -ItemType Directory");
  esegui(sh, "New-Item -Path volo/out/vuoto.txt");
  assert.equal(V.eDir(sh.fs, "/home/tu/volo/out"), true);
  assert.equal(V.eFile(sh.fs, "/home/tu/volo/out/vuoto.txt"), true);
});

caso("i percorsi con la barra rovesciata funzionano lo stesso", () => {
  const sh = shellPs();
  assert.equal(esegui(sh, "Set-Location volo\\dati").errore, null);
  assert.equal(sh.fs.cwd, "/home/tu/volo/dati");
});

caso("Select-String cerca dentro un file e ignora le maiuscole", () => {
  const sh = shellPs({ "/home/tu/log.txt": "Errore grave\nok\nerrore lieve\n" });
  const r = esegui(sh, "Select-String -Pattern errore -Path log.txt");
  assert.match(r.out, /LineNumber/);
  assert.match(r.out, /Errore grave/);
  assert.match(r.out, /errore lieve/);
});

caso("Select-Object prende piu' campi anche scritti con lo spazio dopo la virgola", () => {
  const sh = shellPs();
  const r = esegui(sh, "Get-ChildItem volo/dati | Select-Object Name, Length");
  assert.match(r.out, /Name +Length/, "servono entrambe le colonne");
});

caso("Remove-Item su una cartella vuole -Recurse", () => {
  const sh = shellPs();
  assert.match(esegui(sh, "Remove-Item volo").errore, /directory/);
  assert.equal(esegui(sh, "Remove-Item volo -Recurse").errore, null);
  assert.equal(V.esiste(sh.fs, "/home/tu/volo"), false);
});

// ---------- HTML: analizzatore e verifica ----------

caso("analizza riconosce tag, attributi e annidamento", () => {
  const a = analizza('<div class="box"><p>ciao</p></div>');
  const div = conTag(a, "div")[0];
  assert.equal(div.attributi.class, "box");
  assert.equal(conTag(a, "p").length, 1);
  assert.equal(testoDi(div).trim(), "ciao");
});

caso("gli elementi vuoti non aprono un livello", () => {
  const a = analizza("<p>prima<br>dopo</p><img src=x.png>");
  assert.equal(conTag(a, "br").length, 1);
  assert.equal(conTag(a, "img")[0].attributi.src, "x.png");
  assert.equal(testoDi(conTag(a, "p")[0]).replace(/\s+/g, ""), "primadopo");
});

caso("doctype e commenti non diventano elementi", () => {
  const a = analizza("<!doctype html><!-- nota --><p>x</p>");
  assert.equal(conTag(a, "!doctype").length, 1);
  assert.equal(conTag(a, "p").length, 1);
  assert.equal(testoDi(a).includes("nota"), false, "il commento non e' testo della pagina");
});

caso("una chiusura che non corrisponde a niente non fa crollare l'albero", () => {
  const a = analizza("<p>uno</span><p>due</p>");
  assert.equal(conTag(a, "p").length, 2);
});

caso("i nomi dei tag e degli attributi non distinguono le maiuscole", () => {
  const a = analizza('<DIV CLASS="x"><P>y</P></DIV>');
  assert.equal(conTag(a, "div").length, 1);
  assert.equal(conTag(a, "div")[0].attributi.class, "x");
});

caso("verificaHtml conta gli elementi", () => {
  const s = "<h1>t</h1><p>a</p><p>b</p>";
  assert.equal(verificaHtml(s, { elementi: { h1: 1, p: 2 } }).ok, true);
  assert.equal(verificaHtml(s, { elementi: { p: 3 } }).ok, false);
  assert.equal(verificaHtml(s, { elementi: { p: true } }).ok, true);
});

caso("verificaHtml controlla il testo di un elemento", () => {
  const s = "<h1>Campagna di agosto</h1>";
  assert.equal(verificaHtml(s, { contiene: [{ tag: "h1", testo: "campagna di AGOSTO" }] }).ok, true);
  assert.equal(verificaHtml(s, { contiene: [{ tag: "h1", testo: "altro" }] }).ok, false);
});

caso("verificaHtml controlla gli attributi", () => {
  const s = '<img src="ala.png" alt="l ala">';
  assert.equal(verificaHtml(s, { attributo: [{ tag: "img", nome: "alt" }] }).ok, true);
  assert.equal(verificaHtml(s, { attributo: [{ tag: "img", nome: "alt", valore: "l ala" }] }).ok, true);
  assert.equal(verificaHtml(s, { attributo: [{ tag: "img", nome: "title" }] }).ok, false);
});

caso("verificaHtml controlla l'annidamento e l'ordine", () => {
  const s = "<html><head><title>t</title></head><body><h1>x</h1></body></html>";
  assert.equal(verificaHtml(s, { dentro: [["head", "title"], ["body", "h1"]] }).ok, true);
  assert.equal(verificaHtml(s, { dentro: [["head", "h1"]] }).ok, false);
  assert.equal(verificaHtml(s, { ordine: ["head", "body"] }).ok, true);
  assert.equal(verificaHtml(s, { ordine: ["body", "head"] }).ok, false);
});

caso("verificaHtml dice cosa manca, non solo che manca", () => {
  const r = verificaHtml("<p>x</p>", { elementi: { h1: 1 }, dentro: [["body", "p"]] });
  assert.equal(r.ok, false);
  assert.equal(r.problemi.length, 2, JSON.stringify(r.problemi));
  assert.match(r.problemi.join(" "), /h1/);
});

// ---------- contenuti: ogni soluzione deve passare la propria verifica ----------
//
// E' l'equivalente di check_content.py per gli esercizi di terminale: la
// soluzione viene eseguita davvero sul filesystem virtuale, e il risultato
// passato alla stessa funzione di verifica che usa l'app.

import { readFileSync } from "node:fs";

const indice = JSON.parse(readFileSync(new URL("../content/index.json", import.meta.url)));
for (const meta of indice.moduli) {
  if (!meta.disponibile) continue;
  const mod = JSON.parse(readFileSync(new URL("../content/" + meta.file, import.meta.url)));
  const gruppi = mod.raccolte || [{ esercizi: mod.esercizi || [] }];
  for (const g of gruppi) {
    for (const es of g.esercizi) {
      if (es.tipo === "html") {
        caso(`${es.id}: la soluzione passa la verifica`, () => {
          const esito = verificaHtml(es.soluzione, es.verifica);
          assert.equal(esito.ok, true, esito.problemi.join("; "));
        });
        continue;
      }
      if (es.tipo !== "terminale") continue;
      caso(`${es.id}: la soluzione passa la verifica`, () => {
        const sh = creaShell(es.filesystem || {}, {
          cwd: es.cwd,
          env: es.env,
          comandi:
            es.shell === "powershell"
              ? comandiPowerShell()
              : es.shell === "conda"
                ? AMBIENTI_CONDA
                : es.interpreti
                  ? AMBIENTI
                  : undefined,
        });
        if (es.interpreti) statoAmbienti(sh, es.interpreti);
        const t = eseguiTutto(sh, es.soluzione);
        const esito = verifica(sh, es.verifica, t);
        assert.equal(
          esito.ok,
          true,
          `${esito.problemi.join("; ")} | trascrizione: ${JSON.stringify(t)}`
        );
      });
    }
  }
}

// ---------- esecuzione ----------

let falliti = 0;
for (const [nome, fn] of casi) {
  try {
    fn();
    fatti++;
  } catch (e) {
    falliti++;
    console.log(`FALLITO  ${nome}\n         ${e.message.split("\n")[0]}`);
  }
}
console.log(`${fatti} casi ok, ${falliti} falliti`);
process.exit(falliti ? 1 : 0);
