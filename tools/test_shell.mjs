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
import { AMBIENTI, statoAmbienti } from "../js/ambienti.js";

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

caso("cio' che non e' supportato lo dice, invece di rompere", () => {
  const sh = shell();
  assert.match(esegui(sh, "ls -l | grep x").errore, /non supporta la pipe/);
  assert.match(esegui(sh, "sudo rm -rf /").errore, /comando non trovato/);
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
      if (es.tipo !== "terminale") continue;
      caso(`${es.id}: la soluzione passa la verifica`, () => {
        const sh = creaShell(es.filesystem || {}, {
          cwd: es.cwd,
          env: es.env,
          comandi: es.interpreti ? AMBIENTI : undefined,
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
