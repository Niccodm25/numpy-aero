// Tabella dei processi finta, condivisa dal ramo Linux e da quello PowerShell.
//
// Non c'e' nessuna esecuzione vera dietro: un processo e' una riga con un
// numero, un nome, un utente e un po' di CPU. Basta a insegnare le uniche tre
// cose che contano davvero — trovare quello che ti serve fra cento righe,
// distinguere un segnale gentile da uno brutale, e capire perche' un programma
// lanciato dal terminale muore quando chiudi il terminale.
//
// Gli errori riusano ErroreFs del filesystem: non e' il nome piu' preciso, ma e'
// l'eccezione che la shell sa gia' trasformare in un messaggio invece che in un
// crash, e inventarne una seconda identica non serve a niente.

import { ErroreFs, esiste } from "./vfs.js";

/** Processi presenti all'avvio, se l'esercizio non ne dichiara altri. */
export const PROCESSI_BASE = [
  { pid: 1, nome: "systemd", utente: "root", cpu: 0.0, comando: "/sbin/init" },
  { pid: 412, nome: "sshd", utente: "root", cpu: 0.1, comando: "/usr/sbin/sshd" },
  { pid: 980, nome: "bash", utente: "tu", cpu: 0.0, comando: "-bash" },
  { pid: 1204, nome: "python", utente: "tu", cpu: 98.4, comando: "python simula.py" },
  { pid: 1310, nome: "python", utente: "tu", cpu: 2.1, comando: "python raccogli.py" },
  { pid: 1455, nome: "firefox", utente: "tu", cpu: 12.7, comando: "/usr/lib/firefox" },
];

export function statoProcessi(sh, processi = PROCESSI_BASE) {
  sh.processi = processi.map((p) => ({ ...p, stato: p.stato ?? "R" }));
  sh.prossimoPid = Math.max(1500, ...sh.processi.map((p) => p.pid)) + 1;
  sh.lavori = []; // i processi avviati in sottofondo da questa shell
  sh.prossimoLavoro = 1;
  return sh;
}

const suoi = (sh) => sh.processi ?? [];

/**
 * I segnali che contano. TERM chiede di chiudere e il programma puo' salvare;
 * KILL non arriva al programma, lo toglie di mezzo il kernel — ed e' il motivo
 * per cui -9 va usato solo dopo che TERM ha fallito.
 */
const SEGNALI = {
  15: "TERM",
  9: "KILL",
  2: "INT",
  19: "STOP",
  18: "CONT",
  TERM: "TERM",
  KILL: "KILL",
  INT: "INT",
  STOP: "STOP",
  CONT: "CONT",
};

/** Riconosce %1 e 1, mantenendo il numero anche dopo un passaggio in fg. */
function trovaLavoro(sh, args) {
  const testo = args[0]?.replace(/^%/, "");
  const numero = testo === undefined ? null : Number(testo);
  if (testo !== undefined && (!Number.isInteger(numero) || numero < 1))
    throw new ErroreFs(`job non valido: ${args[0]}`);
  const lavori = sh.lavori ?? [];
  const lavoro = numero === null
    ? lavori.filter((l) => l.inSottofondo !== false).at(-1)
    : lavori.find((l, i) => (l.numeroLavoro ?? i + 1) === numero);
  if (!lavoro) throw new ErroreFs(numero === null ? "nessun job" : `nessun job: %${numero}`);
  return lavoro;
}

export const PROCESSI = {
  ps(sh, args) {
    // "ps aux" mostra tutto, "ps" da solo mostra i processi di questa shell.
    // Le sigle si controllano una per una: prima bastava una "a" in mezzo a
    // qualunque parola, e `ps zibaldone` rispondeva come `ps aux`.
    const BSD = new Set(["a", "u", "x", "ax", "aux", "auxw", "ux"]);
    let tutti = false;
    for (const a of args) {
      if (a.startsWith("-")) {
        if (/[eA]/.test(a)) tutti = true;
        continue;
      }
      if (!BSD.has(a)) throw new ErroreFs(`sigla non riconosciuta: ${a}`);
      if (a.includes("a") || a.includes("x")) tutti = true;
    }
    const righe = tutti ? suoi(sh) : suoi(sh).filter((p) => p.utente === (sh.fs.utente ?? "tu"));
    return [
      "UTENTE      PID  %CPU  S  COMANDO",
      ...righe.map(
        (p) =>
          `${p.utente.padEnd(10)}${String(p.pid).padStart(5)}  ${String(p.cpu).padStart(4)}  ${p.stato}  ${p.comando}`
      ),
    ].join("\n");
  },

  kill(sh, args) {
    const segnale = args.find((a) => a.startsWith("-"));
    const nome = segnale ? SEGNALI[segnale.replace(/^-(SIG)?/, "")] ?? null : "TERM";
    if (segnale && !nome) throw new ErroreFs(`segnale sconosciuto: ${segnale}`);
    const pid = Number(args.find((a) => !a.startsWith("-")));
    if (!pid) throw new ErroreFs("manca il PID");
    const p = suoi(sh).find((x) => x.pid === pid);
    if (!p) throw new ErroreFs(`(${pid}) - processo non esistente`);
    if (p.utente !== (sh.fs.utente ?? "tu") && (sh.fs.utente ?? "tu") !== "root")
      throw new ErroreFs(`(${pid}) - operazione non permessa`);
    // STOP e CONT non terminano niente: sono i segnali dietro Ctrl-Z e bg/fg.
    // Nel simulatore STOP permette di riprodurre lo stato "Fermato" senza
    // dover intercettare una combinazione di tasti nell'interfaccia web.
    if (nome === "STOP") {
      p.stato = "T";
      return "";
    }
    if (nome === "CONT") {
      p.stato = "R";
      return "";
    }
    // Un processo bloccato ignora TERM e muore solo con KILL: e' il caso in cui
    // -9 serve davvero, e l'unico in cui si giustifica.
    if (p.bloccato && nome !== "KILL") return "";
    sh.processi = suoi(sh).filter((x) => x.pid !== pid);
    sh.lavori = (sh.lavori ?? []).filter((l) => l.pid !== pid);
    return "";
  },

  pkill(sh, args) {
    const nome = args.find((a) => !a.startsWith("-"));
    if (!nome) throw new ErroreFs("manca il nome");
    const prima = suoi(sh).length;
    sh.processi = suoi(sh).filter(
      (p) => !(p.nome === nome && (p.utente === (sh.fs.utente ?? "tu") || (sh.fs.utente ?? "tu") === "root"))
    );
    sh.lavori = (sh.lavori ?? []).filter((l) => sh.processi.includes(l));
    if (prima === suoi(sh).length) throw new ErroreFs(`nessun processo di nome ${nome}`);
    return "";
  },

  jobs(sh) {
    const lavori = (sh.lavori ?? []).filter((l) => l.inSottofondo !== false);
    if (!lavori.length) return "";
    return lavori
      .map((l, i) => `[${l.numeroLavoro ?? i + 1}]  ${l.stato === "T" ? "Fermato" : "In esecuzione"}  ${l.comando} &`)
      .join("\n");
  },

  /**
   * Avvia un processo in sottofondo. La shell richiama questa funzione quando
   * trova una & in fondo alla riga; resta anche il comando esplicito `avvia`
   * per gli esercizi iniziali che lo usavano prima del job control completo.
   */
  avvia(sh, args) {
    const comando = args.join(" ");
    if (!comando) throw new ErroreFs("manca il comando da avviare");
    // Anche in sottofondo il file da eseguire deve esistere: `python manca.py &`
    // su una macchina vera stampa il numero di lavoro e muore subito, non resta
    // in esecuzione a farsi trovare da ps.
    //
    // ponytail: si controlla il file, non il programma. In questo modulo
    // `python` e' un segnaposto — l'interprete vero sta nel ramo Python — e
    // pretenderlo qui vorrebbe dire montare mezzo ramo per il job control.
    const script = args.slice(1).find((a) => !a.startsWith("-") && a.includes("."));
    if (script && !esiste(sh.fs, script)) {
      throw new ErroreFs(`${script}: file o directory non esistente`);
    }
    const pid = sh.prossimoPid++;
    const p = {
      pid,
      nome: args[0],
      utente: sh.fs.utente ?? "tu",
      cpu: 0.0,
      comando,
      stato: "R",
      figlio: true,
      inSottofondo: true,
      numeroLavoro: sh.prossimoLavoro ?? (sh.lavori?.length ?? 0) + 1,
    };
    sh.prossimoLavoro = p.numeroLavoro + 1;
    sh.processi = [...suoi(sh), p];
    sh.lavori = [...(sh.lavori ?? []), p];
    return `[${p.numeroLavoro}] ${pid}`;
  },

  /** Riprende un job fermato e lo lascia in sottofondo. */
  bg(sh, args) {
    const lavoro = trovaLavoro(sh, args);
    if (lavoro.stato !== "T") throw new ErroreFs(`il job %${lavoro.numeroLavoro} non e' fermato`);
    lavoro.stato = "R";
    lavoro.inSottofondo = true;
    return `[${lavoro.numeroLavoro}] ${lavoro.comando} &`;
  },

  /** Porta un job davanti al prompt. Non blocca la UI, ma lo toglie da jobs. */
  fg(sh, args) {
    const lavoro = trovaLavoro(sh, args);
    lavoro.stato = "R";
    lavoro.inSottofondo = false;
    return lavoro.comando;
  },

  /** nohup: il processo sopravvive alla chiusura del terminale. */
  nohup(sh, args) {
    const out = PROCESSI.avvia(sh, args);
    const ultimo = sh.processi[sh.processi.length - 1];
    ultimo.nohup = true;
    return out + "\nnohup: l'output va in nohup.out";
  },

  /** Chiude il terminale: i figli muoiono, quelli con nohup no. */
  esci(sh) {
    const sopravvissuti = suoi(sh).filter((p) => !p.figlio || p.nohup);
    const morti = suoi(sh).length - sopravvissuti.length;
    sh.processi = sopravvissuti;
    sh.lavori = (sh.lavori ?? []).filter((l) => l.nohup);
    return morti ? `terminale chiuso: ${morti} processi terminati con lui` : "terminale chiuso";
  },

  top(sh) {
    const ordinati = [...suoi(sh)].sort((a, b) => b.cpu - a.cpu).slice(0, 5);
    return [
      "  PID  %CPU  COMANDO",
      ...ordinati.map((p) => `${String(p.pid).padStart(5)}  ${String(p.cpu).padStart(4)}  ${p.comando}`),
    ].join("\n");
  },
};

/** Stesso modello, nomi di PowerShell. */
export const PROCESSI_PS = {
  "Get-Process": (sh, args) => {
    const nome = args.find((a) => !a.startsWith("-"));
    const righe = suoi(sh).filter((p) => !nome || p.nome === nome);
    return righe.map((p) => ({ Id: p.pid, ProcessName: p.nome, CPU: p.cpu, UserName: p.utente }));
  },

  "Stop-Process": (sh, args) => {
    const i = args.findIndex((a) => /^-(Id|Name)$/i.test(a));
    const per = i >= 0 ? args[i].toLowerCase() : "-id";
    const valore = i >= 0 ? args[i + 1] : args.find((a) => !a.startsWith("-"));
    if (!valore) throw new ErroreFs("manca -Id o -Name");
    const prima = suoi(sh).length;
    sh.processi = suoi(sh).filter((p) =>
      per === "-name" ? p.nome !== valore : p.pid !== Number(valore)
    );
    if (prima === suoi(sh).length) throw new ErroreFs(`processo non trovato: ${valore}`);
    return "";
  },
};
