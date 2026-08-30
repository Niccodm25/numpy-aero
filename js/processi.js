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

import { ErroreFs } from "./vfs.js";

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
  return sh;
}

const suoi = (sh) => sh.processi ?? [];

/**
 * I segnali che contano. TERM chiede di chiudere e il programma puo' salvare;
 * KILL non arriva al programma, lo toglie di mezzo il kernel — ed e' il motivo
 * per cui -9 va usato solo dopo che TERM ha fallito.
 */
const SEGNALI = { 15: "TERM", 9: "KILL", 2: "INT", TERM: "TERM", KILL: "KILL", INT: "INT" };

export const PROCESSI = {
  ps(sh, args) {
    const testo = args.join(" ");
    // "ps aux" mostra tutto, "ps" da solo mostra i processi di questa shell.
    const tutti = /a/.test(testo) || /-e/.test(testo) || /-A/.test(testo);
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
    if (prima === suoi(sh).length) throw new ErroreFs(`nessun processo di nome ${nome}`);
    return "";
  },

  jobs(sh) {
    const lavori = sh.lavori ?? [];
    if (!lavori.length) return "";
    return lavori
      .map((l, i) => `[${i + 1}]  ${l.stato === "T" ? "Fermato" : "In esecuzione"}  ${l.comando} &`)
      .join("\n");
  },

  /**
   * Avvia un processo in sottofondo. In una shell vera lo fa la & in fondo alla
   * riga; qui e' un comando esplicito, perche' la & andrebbe interpretata dal
   * parser e servirebbe solo a questo.
   */
  avvia(sh, args) {
    const comando = args.join(" ");
    if (!comando) throw new ErroreFs("manca il comando da avviare");
    const pid = sh.prossimoPid++;
    const p = {
      pid,
      nome: args[0],
      utente: sh.fs.utente ?? "tu",
      cpu: 0.0,
      comando,
      stato: "R",
    };
    sh.processi = [...suoi(sh), p];
    sh.lavori = [...(sh.lavori ?? []), p];
    return `[${sh.lavori.length}] ${pid}`;
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
    const sopravvissuti = suoi(sh).filter((p) => !(sh.lavori ?? []).includes(p) || p.nohup);
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
