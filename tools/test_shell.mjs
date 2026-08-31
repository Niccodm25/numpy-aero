// Controllo del motore del terminale simulato.
//
//     node tools/test_shell.mjs
//
// Non e' un framework: e' una lista di casi e un assert. Il motore non ha altro
// modo di essere verificato — il controllo dei contenuti e' in Python e non sa
// niente del filesystem virtuale.

import assert from "node:assert";
import * as V from "../js/vfs.js";
import { creaShell, esegui, eseguiTutto, dividi, verifica, POSIX } from "../js/shell.js";
import { AMBIENTI, AMBIENTI_CONDA, statoAmbienti } from "../js/ambienti.js";
import { comandiPowerShell } from "../js/powershell.js";
import { analizza, conTag, testoDi, verificaHtml } from "../js/html.js";
import { PROCESSI, PROCESSI_PS, statoProcessi } from "../js/processi.js";
import { SISTEMA, statoSistema } from "../js/sistema.js";
import { UTENTI, statoUtenti } from "../js/utenti.js";
import { TESTO } from "../js/testo.js";
import { RETE, statoRete } from "../js/rete.js";
import { REMOTO, statoRemoto } from "../js/remoto.js";
import { SERVIZI, statoServizi } from "../js/servizi.js";
import { HARDWARE, statoHardware } from "../js/hardware.js";
import { PRESTAZIONI, statoPrestazioni } from "../js/prestazioni.js";
import { STORAGE, statoStorage } from "../js/dischi.js";
import { CONTAINER, statoContainer } from "../js/container.js";
import { SICUREZZA, statoSicurezza } from "../js/sicurezza.js";
import { AUTOMAZIONE, statoAutomazione } from "../js/automazione.js";

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

caso("ln distingue hard link e collegamento simbolico", () => {
  const sh = shell({ "/home/tu/origine.txt": "uno\n" });
  assert.equal(esegui(sh, "ln origine.txt copia.txt").errore, null);
  esegui(sh, "echo due > copia.txt");
  assert.equal(V.leggi(sh.fs, "origine.txt"), "due\n", "un hard link condivide il contenuto");
  assert.equal(esegui(sh, "ln -s origine.txt scorciatoia.txt").errore, null);
  assert.equal(esegui(sh, "cat scorciatoia.txt").out, "due");
  assert.match(esegui(sh, "ls -l").out, /scorciatoia\.txt -> \/home\/tu\/origine\.txt/);
});

caso("rmdir rimuove solo una directory vuota", () => {
  const sh = shell({ "/home/tu/vuota": null, "/home/tu/piena/a.txt": "x" });
  assert.equal(esegui(sh, "rmdir vuota").errore, null);
  assert.equal(V.esiste(sh.fs, "vuota"), false);
  assert.match(esegui(sh, "rmdir piena").errore, /non vuota/);
});

caso("un comando sconosciuto lo dice, invece di rompere", () => {
  const sh = shell();
  assert.match(esegui(sh, "aptitude install x").errore, /comando non trovato/);
  assert.match(esegui(sh, "ls | ").errore, /attorno alla pipe/);
});

caso("stato giusto ma comando sbagliato: fuori consegna, non errore", () => {
  const sh = shell({ "/home/tu/a.txt": "x" });
  esegui(sh, "cp a.txt b.txt");
  const r = verifica(sh, { esiste: ["/home/tu/b.txt"], usa: ["mv"] }, []);
  assert.equal(r.ok, false);
  assert.equal(r.fuoriConsegna, true, "lo stato e' quello atteso, manca solo il comando");
  const r2 = verifica(sh, { esiste: ["/home/tu/c.txt"], usa: ["mv"] }, []);
  assert.equal(r2.fuoriConsegna, false, "se manca anche lo stato non e' fuori consegna");
});

// ---------- variabili e script ----------

caso("una variabile si assegna senza spazi e si legge col dollaro", () => {
  const sh = shell();
  esegui(sh, "NOME=galleria");
  assert.equal(esegui(sh, "echo $NOME").out, "galleria");
  assert.equal(esegui(sh, "echo ${NOME}").out, "galleria");
});

caso("gli spazi attorno all'uguale rompono l'assegnazione", () => {
  const sh = shell();
  const r = esegui(sh, "NOME = galleria");
  assert.match(r.errore, /comando non trovato/, "NOME diventa un comando");
  assert.equal(sh.env.NOME, undefined);
});

caso("una variabile che non esiste diventa la stringa vuota, senza errore", () => {
  const sh = shell();
  assert.equal(esegui(sh, "echo [$MANCA]").out, "[]");
  assert.equal(esegui(sh, "echo $MANCA").errore, null);
});

caso("la variabile si espande anche nella redirezione e negli argomenti", () => {
  const sh = shell();
  esegui(sh, "FILE=note.txt");
  esegui(sh, "echo ciao > $FILE");
  assert.equal(V.leggi(sh.fs, "/home/tu/note.txt"), "ciao\n");
  assert.equal(esegui(sh, "cat $FILE").out, "ciao");
});

caso("gli apici singoli tengono fuori dollaro, pipe e redirezione", () => {
  const sh = shell();
  esegui(sh, "NOME=fuori");
  assert.equal(esegui(sh, "echo '$NOME'").out, "$NOME", "apici singoli: niente espansione");
  assert.equal(esegui(sh, 'echo "$NOME"').out, "fuori", "doppi: si espande");
  esegui(sh, "echo 'grep x $1 | wc -l' > s.sh");
  assert.equal(V.leggi(sh.fs, "/home/tu/s.sh"), "grep x $1 | wc -l" + String.fromCharCode(10), "la pipe finisce nel file, non viene eseguita");
});

caso("bash esegue le righe di un file e salta i commenti", () => {
  const sh = shell({
    "/home/tu/prova.sh": "# un commento\nmkdir dati\necho fatto\n",
  });
  const r = esegui(sh, "bash prova.sh");
  assert.equal(r.out, "fatto");
  assert.equal(V.eDir(sh.fs, "/home/tu/dati"), true);
});

caso("gli argomenti dello script diventano $1 e $#", () => {
  const sh = shell({ "/home/tu/saluta.sh": "echo ciao $1\necho argomenti: $#\n" });
  const r = esegui(sh, "bash saluta.sh mondo");
  assert.match(r.out, /ciao mondo/);
  assert.match(r.out, /argomenti: 1/);
});

caso("senza set -e uno script che fallisce prosegue, con set -e si ferma", () => {
  const sh = shell({ "/home/tu/rotto.sh": "echo prima\ncat manca.txt\necho dopo\n" });
  const r = esegui(sh, "bash rotto.sh");
  assert.equal(r.errore, null, "l'errore di una riga non ferma lo script");
  assert.match(r.out, /rotto\.sh: cat: .*non esistente/, "ma viene stampato");
  assert.match(r.out, /dopo/, "e la riga successiva viene eseguita lo stesso");

  const sh2 = shell({ "/home/tu/fermo.sh": "set -e\necho prima\ncat manca.txt\necho dopo\n" });
  const r2 = esegui(sh2, "bash fermo.sh");
  assert.match(r2.errore, /fermo\.sh/);
  assert.equal(/dopo/.test(r2.out || ""), false, "con set -e la riga dopo non parte");
});

caso("set -u fa fallire la variabile non definita, senza resta muta", () => {
  const sh = shell({ "/home/tu/a.txt": "x" });
  esegui(sh, "echo 'cp a.txt $DEST' > muto.sh");
  assert.match(esegui(sh, "bash muto.sh").out, /sorgente e destinazione/, "l'errore parla di cp");

  const severo = shell({ "/home/tu/a.txt": "x" });
  esegui(severo, "echo 'set -eu' > severo.sh");
  esegui(severo, "echo 'cp a.txt $DEST' >> severo.sh");
  assert.match(esegui(severo, "bash severo.sh").errore, /DEST: variabile non definita/);
  assert.equal(severo.severo, undefined, "il set dello script non resta acceso fuori");
});

caso("una variabile vuota sparisce, non diventa un argomento vuoto", () => {
  const sh = shell();
  esegui(sh, "echo 'mkdir -p $1' > crea.sh");
  assert.match(esegui(sh, "bash crea.sh").out, /manca il nome della directory/);
  assert.match(esegui(sh, 'echo [""]').out, /\[\]/, "ma le virgolette vuote restano un argomento");
});

caso("il caso classico: la variabile vuota nel percorso", () => {
  const sh = shell({ "/home/tu/dati/a.txt": "x" });
  // CARTELLA non e' mai stata assegnata: "$CARTELLA/dati" diventa "/dati"
  assert.equal(esegui(sh, "ls $CARTELLA/dati").errore !== null, true);
  esegui(sh, "CARTELLA=/home/tu");
  assert.equal(esegui(sh, "ls $CARTELLA/dati").out, "a.txt");
});

// ---------- permessi ----------

caso("ls -l mostra permessi e proprietario veri", () => {
  const sh = shell({ "/home/tu/a.txt": "ciao", "/home/tu/dati": null });
  const out = esegui(sh, "ls -l").out;
  assert.match(out, /-rw-r--r--\s+tu\s+4\s+a\.txt/);
  assert.match(out, /drwxr-xr-x\s+tu/);
});

caso("chmod numerico cambia i permessi", () => {
  const sh = shell({ "/home/tu/a.sh": "echo ciao" });
  esegui(sh, "chmod 755 a.sh");
  assert.match(esegui(sh, "ls -l").out, /-rwxr-xr-x/);
  esegui(sh, "chmod 600 a.sh");
  assert.match(esegui(sh, "ls -l").out, /-rw-------/);
});

caso("chmod simbolico aggiunge e toglie un bit solo", () => {
  const sh = shell({ "/home/tu/a.sh": "echo ciao" });
  esegui(sh, "chmod +x a.sh");
  assert.match(esegui(sh, "ls -l").out, /-rwxr-xr-x/, "+x da' a tutti");
  esegui(sh, "chmod go-x a.sh");
  assert.match(esegui(sh, "ls -l").out, /-rwxr--r--/);
  esegui(sh, "chmod u-w a.sh");
  assert.match(esegui(sh, "ls -l").out, /-r-xr--r--/);
});

caso("senza permesso di lettura, cat fallisce", () => {
  const sh = shell({ "/home/tu/segreto.txt": "x" });
  assert.equal(esegui(sh, "cat segreto.txt").errore, null);
  esegui(sh, "chmod 000 segreto.txt");
  assert.match(esegui(sh, "cat segreto.txt").errore, /permesso negato/);
});

caso("senza permesso di scrittura, la redirezione fallisce", () => {
  const sh = shell({ "/home/tu/log.txt": "x\n" });
  esegui(sh, "chmod 444 log.txt");
  assert.match(esegui(sh, "echo nuovo > log.txt").errore, /permesso negato/);
  assert.equal(V.leggi(sh.fs, "/home/tu/log.txt"), "x\n", "il contenuto non e' cambiato");
});

caso("un file di root non si legge ne' si modifica, ma con sudo si'", () => {
  const sh = shell({ "/etc/conf": "chiave=1\n" });
  sh.fs.nodi.get("/etc/conf").proprietario = "root";
  sh.fs.nodi.get("/etc/conf").modo = 0o600;
  assert.match(esegui(sh, "cat /etc/conf").errore, /permesso negato/);
  assert.equal(esegui(sh, "sudo cat /etc/conf").out, "chiave=1");
});

caso("chmod su un file altrui serve sudo", () => {
  const sh = shell({ "/etc/conf": "x" });
  sh.fs.nodi.get("/etc/conf").proprietario = "root";
  assert.match(esegui(sh, "chmod 777 /etc/conf").errore, /non permessa/);
  assert.equal(esegui(sh, "sudo chmod 777 /etc/conf").errore, null);
});

caso("chown richiede sempre root, anche sui tuoi file", () => {
  const sh = shell({ "/home/tu/a.txt": "x" });
  assert.match(esegui(sh, "chown altro a.txt").errore, /serve sudo/);
  assert.equal(esegui(sh, "sudo chown altro a.txt").errore, null);
  assert.match(esegui(sh, "ls -l").out, /altro/);
});

caso("sudo vale per una riga sola", () => {
  const sh = shell({ "/etc/conf": "x" });
  sh.fs.nodi.get("/etc/conf").proprietario = "root";
  sh.fs.nodi.get("/etc/conf").modo = 0o600;
  esegui(sh, "sudo cat /etc/conf");
  assert.equal(esegui(sh, "whoami").out, "tu", "dopo sudo si torna se stessi");
  assert.match(esegui(sh, "cat /etc/conf").errore, /permesso negato/);
});

caso("riscrivere un file non ne azzera i permessi", () => {
  const sh = shell({ "/home/tu/a.sh": "uno" });
  esegui(sh, "chmod 755 a.sh");
  esegui(sh, "echo due > a.sh");
  assert.match(esegui(sh, "ls -l").out, /-rwxr-xr-x/, "resta eseguibile");
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

// ---------- processi e job control ----------

const shellProcessi = () => {
  const sh = creaShell({}, { comandi: { ...POSIX, ...PROCESSI } });
  statoProcessi(sh);
  return sh;
};

caso("la & avvia un job e jobs lo mostra", () => {
  const sh = shellProcessi();
  assert.equal(esegui(sh, "python lungo.py &").out, "[1] 1501");
  assert.match(esegui(sh, "jobs").out, /\[1\].*python lungo\.py &/);
});

caso("STOP, bg e fg conservano lo stato del job", () => {
  const sh = shellProcessi();
  esegui(sh, "python lungo.py &");
  assert.equal(esegui(sh, "kill -STOP 1501").errore, null);
  assert.match(esegui(sh, "jobs").out, /Fermato/);
  assert.equal(esegui(sh, "bg %1").out, "[1] python lungo.py &");
  esegui(sh, "kill -STOP 1501");
  assert.equal(esegui(sh, "fg %1").out, "python lungo.py");
  assert.equal(esegui(sh, "jobs").out, "");
});

caso("nohup sopravvive alla chiusura, anche lanciato con la &", () => {
  const sh = shellProcessi();
  assert.match(esegui(sh, "nohup python notte.py &").out, /nohup\.out/);
  esegui(sh, "python breve.py &");
  assert.match(esegui(sh, "esci").out, /1 processi terminati/);
  assert.match(esegui(sh, "ps aux").out, /notte\.py/);
  assert.doesNotMatch(esegui(sh, "ps aux").out, /breve\.py/);
});

caso("pkill rimuove anche i job che ha terminato", () => {
  const sh = shellProcessi();
  esegui(sh, "python lungo.py &");
  esegui(sh, "pkill python");
  assert.equal(esegui(sh, "jobs").out, "");
});

// ---------- archivi, pacchetti e risorse ----------

const shellSistema = (iniziale = {}, scenario) => {
  const sh = creaShell(iniziale, { comandi: { ...POSIX, ...SISTEMA } });
  statoSistema(sh, scenario);
  return sh;
};

caso("tar crea, elenca ed estrae un archivio senza perdere i file", () => {
  const sh = shellSistema({ "/home/tu/dati/a.csv": "quota,1000\n", "/home/tu/dati/b.csv": "quota,2000\n" });
  assert.equal(esegui(sh, "tar -czf dati.tar.gz dati").errore, null);
  assert.match(esegui(sh, "tar -tzf dati.tar.gz").out, /dati\/a\.csv/);
  esegui(sh, "rm -r dati");
  assert.equal(esegui(sh, "tar -xzf dati.tar.gz").errore, null);
  assert.equal(V.leggi(sh.fs, "dati/a.csv"), "quota,1000\n");
});

caso("gzip sostituisce il file e gunzip lo ripristina", () => {
  const sh = shellSistema({ "/home/tu/log.txt": "misura\n" });
  esegui(sh, "gzip log.txt");
  assert.equal(V.esiste(sh.fs, "log.txt"), false);
  assert.equal(V.esiste(sh.fs, "log.txt.gz"), true);
  esegui(sh, "gunzip log.txt.gz");
  assert.equal(V.leggi(sh.fs, "log.txt"), "misura\n");
});

caso("apt install e remove cambiano la lista dei pacchetti", () => {
  const sh = shellSistema();
  assert.match(esegui(sh, "apt install ripgrep").out, /Installato ripgrep/);
  assert.match(esegui(sh, "apt list --installed").out, /ripgrep/);
  assert.match(esegui(sh, "apt remove ripgrep").out, /Rimosso ripgrep/);
  assert.doesNotMatch(esegui(sh, "apt list --installed").out, /ripgrep/);
});

// ---------- utenti, gruppi e permessi speciali ----------

const shellUtenti = (iniziale = {}, scenario) => {
  const sh = creaShell(iniziale, { comandi: { ...POSIX, ...UTENTI } });
  statoUtenti(sh, scenario);
  return sh;
};

caso("useradd, usermod e groups aggiornano il modello degli account", () => {
  const sh = shellUtenti({}, { gruppi: { ricerca: [] } });
  assert.equal(esegui(sh, "sudo useradd -m anna").errore, null);
  assert.equal(V.eDir(sh.fs, "/home/anna"), true);
  assert.equal(esegui(sh, "sudo usermod -aG ricerca anna").errore, null);
  assert.match(esegui(sh, "groups anna").out, /anna ricerca/);
});

caso("chgrp e la terna di gruppo concedono lettura al gruppo giusto", () => {
  const sh = shellUtenti({ "/home/tu/dati.txt": { contenuto: "misura\n", modo: 0o640 } }, {
    utenti: { anna: { uid: 1001, gruppo: "ricerca" } },
    gruppi: { ricerca: ["anna", "tu"] },
  });
  assert.equal(esegui(sh, "chgrp ricerca dati.txt").errore, null);
  sh.fs.utente = "anna";
  assert.equal(esegui(sh, "cat /home/tu/dati.txt").out, "misura");
});

caso("chmod a quattro cifre mostra setuid, setgid e sticky bit", () => {
  const sh = shellUtenti({ "/home/tu/strumento": "x", "/home/tu/condivisa": null });
  esegui(sh, "chmod 4755 strumento");
  esegui(sh, "chmod 1777 condivisa");
  assert.match(esegui(sh, "ls -l").out, /-rwsr-xr-x/);
  assert.match(esegui(sh, "ls -l").out, /drwxrwxrwt/);
});

caso("cut, sed, tr e tee trasformano una pipeline", () => {
  const sh = creaShell({ "/home/tu/misure.csv": "t,quota\n0,1000\n" }, { comandi: { ...POSIX, ...TESTO } });
  assert.equal(esegui(sh, "cut -d , -f 2 misure.csv | sed 's/quota/ALT/g' | tr a-z A-Z | tee colonne.txt").out, "ALT\n1000");
  assert.equal(V.leggi(sh.fs, "colonne.txt"), "ALT\n1000\n");
});

caso("awk estrae campi e xargs applica un comando ai nomi", () => {
  const sh = creaShell({ "/home/tu/a.tmp": "x", "/home/tu/b.tmp": "y", "/home/tu/dati.txt": "uno due\n" }, { comandi: { ...POSIX, ...TESTO } });
  assert.equal(esegui(sh, "awk '{print $2, $1}' dati.txt").out, "due uno");
  esegui(sh, "echo a.tmp b.tmp | xargs rm");
  assert.equal(V.esiste(sh.fs, "a.tmp"), false);
});

caso("rete: DNS, ping, porte e route descrivono lo stesso scenario", () => {
  const sh = creaShell({}, { comandi: { ...POSIX, ...RETE } }); statoRete(sh);
  assert.match(esegui(sh, "ping cluster.univ.it").out, /10\.20\.0\.15/);
  assert.match(esegui(sh, "ss -tulpn").out, /sshd/);
  assert.match(esegui(sh, "ip route").out, /192\.168\.1\.1/);
});

function remota(files = {}) {
  const sh = creaShell({ "/home/tu/nota.txt": "ciao\n", ...files }, { comandi: { ...POSIX, ...REMOTO } });
  statoRemoto(sh, { autorizzata: true });
  esegui(sh, "ssh-keygen -t ed25519");
  return sh;
}

caso("il server accetta solo chiavi, e lo dice quando non ne hai", () => {
  const sh = creaShell({}, { comandi: { ...POSIX, ...REMOTO } });
  statoRemoto(sh);
  assert.match(esegui(sh, "ssh anna@cluster pwd").errore, /Permission denied \(publickey\)/);
  esegui(sh, "ssh-keygen -t ed25519");
  assert.match(esegui(sh, "ssh anna@cluster pwd").errore, /non e' autorizzata/, "chiave c'e', ma il server non la conosce");
  esegui(sh, "ssh-copy-id anna@cluster");
  assert.equal(esegui(sh, "ssh anna@cluster pwd").out, "/home/anna");
});

caso("una chiave privata leggibile da altri viene rifiutata", () => {
  const sh = remota();
  const chiave = V.normalizza(sh.fs, "/home/tu/.ssh/id_ed25519");
  sh.fs.nodi.get(chiave).modo = 0o644;
  assert.match(esegui(sh, "ssh anna@cluster pwd").errore, /UNPROTECTED PRIVATE KEY/);
  esegui(sh, "chmod 600 .ssh/id_ed25519");
  assert.equal(esegui(sh, "ssh anna@cluster pwd").out, "/home/anna");
});

caso("il comando remoto gira sul filesystem di la'", () => {
  const sh = remota();
  assert.match(esegui(sh, "ssh anna@cluster 'ls risultati'").out, /quota\.csv/);
  assert.equal(esegui(sh, "ssh anna@cluster 'wc -l risultati/quota.csv'").out, "3 risultati/quota.csv");
});

caso("~/.ssh/config porta utente e porta, e vale anche per scp", () => {
  const sh = creaShell({}, { comandi: { ...POSIX, ...REMOTO } });
  statoRemoto(sh, { autorizzata: true, porta: 2222 });
  esegui(sh, "ssh-keygen -t ed25519");
  assert.match(esegui(sh, "ssh cluster pwd").errore, /porta 22/, "senza config va sulla 22");
  esegui(sh, "echo 'Host cluster' > .ssh/config");
  esegui(sh, "echo '  User anna' >> .ssh/config");
  esegui(sh, "echo '  Port 2222' >> .ssh/config");
  assert.equal(esegui(sh, "ssh cluster pwd").out, "/home/anna");
});

caso("scp e rsync spostano dati fra filesystem locale e remoto", () => {
  const sh = remota();
  esegui(sh, "scp anna@cluster:risultati/quota.csv quota.csv");
  assert.match(V.leggi(sh.fs, "quota.csv"), /1000/);
  esegui(sh, "rsync -av nota.txt anna@cluster:nota.txt");
  assert.equal(V.leggi(sh.remoto.fs, "nota.txt"), "ciao\n");
});

caso("scp su una cartella vuole -r, rsync non rimanda quello che c'e' gia'", () => {
  const sh = remota();
  assert.match(esegui(sh, "scp anna@cluster:risultati .").errore, /serve -r/);
  esegui(sh, "scp -r anna@cluster:risultati .");
  assert.equal(V.esiste(sh.fs, "/home/tu/risultati/quota.csv"), true);
  assert.match(esegui(sh, "rsync -av anna@cluster:risultati .").out, /0 file/, "seconda volta: niente da mandare");
});

caso("una sessione tmux sopravvive e si ritrova per nome", () => {
  const sh = remota();
  esegui(sh, "tmux new -s notte");
  esegui(sh, "tmux send-keys -t notte 'python simula.py'");
  assert.match(esegui(sh, "tmux ls").out, /notte.*python simula\.py/);
  assert.match(esegui(sh, "tmux attach -t notte").out, /sta ancora girando/);
  esegui(sh, "tmux kill-session -t notte");
  assert.match(esegui(sh, "tmux ls").errore, /no server running/);
});

caso("systemctl e journalctl condividono lo stato del servizio", () => {
  const sh = creaShell({}, { comandi: { ...POSIX, ...SERVIZI } }); statoServizi(sh);
  esegui(sh, "systemctl start acquisizione.service");
  assert.match(esegui(sh, "systemctl status acquisizione.service").out, /active/);
  assert.match(esegui(sh, "journalctl -u acquisizione.service").out, /avviato/);
});

caso("hardware: modprobe e sysctl modificano lo stato osservabile", () => {
  const sh=creaShell({}, {comandi:{...POSIX,...HARDWARE}}); statoHardware(sh);
  esegui(sh,"modprobe sdr"); assert.match(esegui(sh,"lsmod").out,/sdr/);
  assert.match(esegui(sh,"sysctl -w vm.swappiness=10").out,/10/);
});
caso("prestazioni e storage mostrano uno stato interrogabile",()=>{const sh=creaShell({}, {comandi:{...POSIX,...PRESTAZIONI,...STORAGE}});statoPrestazioni(sh);statoStorage(sh);assert.match(esegui(sh,"iostat").out,/nvme/);esegui(sh,"mount /dev/sdb /dati");assert.match(esegui(sh,"mount").out,/\/dati/);});
caso("docker simulato costruisce e avvia immagini",()=>{const sh=creaShell({}, {comandi:{...POSIX,...CONTAINER}});statoContainer(sh);esegui(sh,"docker build -t analisi:1 .");assert.match(esegui(sh,"docker run analisi:1").out,/isolamento/);});
caso("ufw conserva una policy difensiva verificabile",()=>{const sh=creaShell({}, {comandi:{...POSIX,...SICUREZZA}});statoSicurezza(sh);esegui(sh,"ufw enable");esegui(sh,"ufw allow 443");assert.match(esegui(sh,"ufw status").out,/443\/tcp/);});
caso("playbook idempotente cambia solo alla prima esecuzione",()=>{const sh=creaShell({}, {comandi:{...POSIX,...AUTOMAZIONE}});statoAutomazione(sh);esegui(sh,"ansible-playbook sito.yml");assert.match(esegui(sh,"ansible-playbook sito.yml").out,/changed=0/);});

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
        let comandi =
          es.shell === "powershell"
            ? comandiPowerShell()
            : es.shell === "conda"
              ? AMBIENTI_CONDA
              : es.interpreti
                ? AMBIENTI
                : undefined;
        if (es.processi)
          comandi = {
            ...(comandi ?? POSIX),
            ...(es.shell === "powershell" ? PROCESSI_PS : PROCESSI),
          };
        if (es.sistema)
          comandi = {
            ...(comandi ?? POSIX),
            ...SISTEMA,
          };
        if (es.utenti)
          comandi = {
            ...(comandi ?? POSIX),
            ...UTENTI,
          };
        if (es.testoAvanzato)
          comandi = { ...(comandi ?? POSIX), ...TESTO };
        if (es.rete)
          comandi = { ...(comandi ?? POSIX), ...RETE };
        if (es.remoto)
          comandi = { ...(comandi ?? POSIX), ...REMOTO };
        if (es.servizi)
          comandi = { ...(comandi ?? POSIX), ...SERVIZI };
        if (es.hardware)
          comandi = { ...(comandi ?? POSIX), ...HARDWARE };
        if (es.prestazioni) comandi = { ...(comandi ?? POSIX), ...PRESTAZIONI };
        if (es.storage) comandi = { ...(comandi ?? POSIX), ...STORAGE };
        if (es.container) comandi = { ...(comandi ?? POSIX), ...CONTAINER };
        if (es.sicurezza) comandi = { ...(comandi ?? POSIX), ...SICUREZZA };
        if (es.automazione) comandi = { ...(comandi ?? POSIX), ...AUTOMAZIONE };
        const sh = creaShell(es.filesystem || {}, { cwd: es.cwd, env: es.env, comandi });
        if (es.interpreti) statoAmbienti(sh, es.interpreti);
        if (es.processi) statoProcessi(sh, es.processi === true ? undefined : es.processi);
        if (es.sistema) statoSistema(sh, es.sistema === true ? undefined : es.sistema);
        if (es.utenti) statoUtenti(sh, es.utenti === true ? undefined : es.utenti);
        if (es.rete) statoRete(sh, es.rete === true ? undefined : es.rete);
        if (es.remoto) statoRemoto(sh, es.remoto === true ? undefined : es.remoto);
        if (es.servizi) statoServizi(sh, es.servizi === true ? undefined : es.servizi);
        if (es.hardware) statoHardware(sh, es.hardware === true ? undefined : es.hardware);
        if (es.prestazioni) statoPrestazioni(sh, es.prestazioni === true ? undefined : es.prestazioni);
        if (es.storage) statoStorage(sh, es.storage === true ? undefined : es.storage);
        if (es.container) statoContainer(sh, es.container === true ? undefined : es.container);
        if (es.sicurezza) statoSicurezza(sh, es.sicurezza === true ? undefined : es.sicurezza);
        if (es.automazione) statoAutomazione(sh);
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
