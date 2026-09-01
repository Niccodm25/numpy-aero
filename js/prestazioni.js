// Prestazioni: quale delle cinque risorse e' satura, e come si dimostra.
//
// Lo scenario decide i numeri, e i numeri sono coerenti fra tutti i comandi:
// se il collo di bottiglia e' il disco, `vmstat` mostra `wa` alto E `iostat`
// mostra il disco al 99% E `top` mostra il processo in stato D. Un simulatore
// che stampasse numeri fissi renderebbe impossibile l'unica cosa che conta qui:
// **concludere quale risorsa e' satura guardando i dati**.
//
// I cinque casi: cpu, memoria (swap), disco, rete, ozio. Si dichiarano
// nell'esercizio con `prestazioni: { caso: "disco" }`.

import * as V from "./vfs.js";

const CASI = {
  cpu: {
    descrizione: "un calcolo che occupa tutti i core",
    cpu: { utente: 96, sistema: 3, attesaIo: 0, inattivo: 1 },
    carico: [7.8, 7.4, 6.9],
    memoria: { totaleMB: 16000, usataMB: 4200, cacheMB: 6100, swapUsataMB: 0 },
    disco: { tps: 12, letturaKB: 180, scritturaKB: 40, utilizzo: 3 },
    processi: [
      { pid: 2411, nome: "python simula.py", cpu: 780, mem: 12, stato: "R" },
      { pid: 812, nome: "sshd", cpu: 0, mem: 0, stato: "S" },
    ],
    syscall: [["clock_gettime", 4210], ["futex", 88], ["write", 12]],
  },
  memoria: {
    descrizione: "la memoria e' finita e il sistema sta usando lo swap",
    cpu: { utente: 22, sistema: 31, attesaIo: 40, inattivo: 7 },
    carico: [9.1, 8.8, 7.2],
    memoria: { totaleMB: 16000, usataMB: 15600, cacheMB: 180, swapUsataMB: 1900 },
    disco: { tps: 640, letturaKB: 22000, scritturaKB: 31000, utilizzo: 88 },
    processi: [
      { pid: 3120, nome: "python monte_carlo.py", cpu: 45, mem: 91, stato: "D" },
      { pid: 812, nome: "sshd", cpu: 0, mem: 0, stato: "S" },
    ],
    syscall: [["mmap", 1840], ["munmap", 1790], ["read", 220]],
  },
  disco: {
    descrizione: "il programma aspetta il disco piu' di quanto calcoli",
    cpu: { utente: 9, sistema: 6, attesaIo: 71, inattivo: 14 },
    carico: [4.2, 4.0, 3.6],
    memoria: { totaleMB: 16000, usataMB: 5100, cacheMB: 8800, swapUsataMB: 0 },
    disco: { tps: 1240, letturaKB: 96000, scritturaKB: 12000, utilizzo: 99 },
    processi: [
      { pid: 2755, nome: "python riduci.py", cpu: 14, mem: 8, stato: "D" },
      { pid: 812, nome: "sshd", cpu: 0, mem: 0, stato: "S" },
    ],
    // Il sintomo classico: milioni di letture minuscole invece di poche grandi.
    syscall: [["read", 51200], ["lseek", 51200], ["openat", 3]],
  },
  ozio: {
    descrizione: "la macchina non sta facendo niente di pesante",
    cpu: { utente: 4, sistema: 2, attesaIo: 1, inattivo: 93 },
    carico: [0.12, 0.20, 0.31],
    memoria: { totaleMB: 16000, usataMB: 3100, cacheMB: 4200, swapUsataMB: 0 },
    disco: { tps: 8, letturaKB: 60, scritturaKB: 20, utilizzo: 1 },
    processi: [{ pid: 812, nome: "sshd", cpu: 0, mem: 0, stato: "S" }],
    syscall: [["epoll_wait", 42], ["read", 12]],
  },
};

export function statoPrestazioni(sh, scenario = {}) {
  const nome = scenario.caso ?? "cpu";
  const base = CASI[nome] ?? CASI.cpu;
  sh.prestazioni = {
    caso: nome,
    ...structuredClone(base),
    profilo: scenario.profilo ?? "balanced",
    limiti: {},
    ...(scenario.extra || {}),
  };
  return sh;
}

const p = (sh) => sh.prestazioni;

/**
 * Il programma da misurare deve esistere. `strace -c python manca.py` su una
 * macchina vera si ferma subito; senza questo controllo il simulatore
 * rispondeva con le stesse statistiche anche per un file inventato, e cosi'
 * insegnava che strace misura qualcosa che non c'e'.
 *
 * ponytail: i numeri restano quelli dichiarati dallo scenario dell'esercizio.
 * Modellare le syscall di un programma qualunque costerebbe un interprete e
 * non insegnerebbe niente in piu' — la lezione dice che sono i numeri di
 * questo banco, non una misura fatta adesso.
 */
function bersaglio(sh, args) {
  const liberi = args.filter((a) => !a.startsWith("-"));
  if (!liberi.length) throw new V.ErroreFs("manca il comando da misurare");
  const script = liberi.find((a) => a.includes("."));
  if (script && !V.esiste(sh.fs, script)) {
    throw new V.ErroreFs(`${script}: file o directory non esistente`);
  }
}

export const PRESTAZIONI = {
  /** Il riassunto in cima a top e' la prima cosa da leggere: carico, stato
   *  della CPU divisa per tipo, memoria. I processi vengono dopo. */
  top(sh) {
    const s = p(sh);
    const m = s.memoria;
    return [
      `top - carico medio: ${s.carico.join(", ")}`,
      `%Cpu(s): ${s.cpu.utente} us, ${s.cpu.sistema} sy, ${s.cpu.attesaIo} wa, ${s.cpu.inattivo} id`,
      `MiB Mem : ${m.totaleMB} totali, ${m.totaleMB - m.usataMB} liberi, ${m.usataMB} usati, ${m.cacheMB} cache`,
      `MiB Swap: 2048 totali, ${2048 - m.swapUsataMB} liberi, ${m.swapUsataMB} usati`,
      "",
      "  PID  %CPU  %MEM S COMMAND",
      ...s.processi.map((x) => `${String(x.pid).padStart(5)} ${String(x.cpu).padStart(5)} ${String(x.mem).padStart(5)} ${x.stato} ${x.nome}`),
    ].join("\n");
  },

  uptime(sh) {
    return `su da 2 giorni, 3 utenti, carico medio: ${p(sh).carico.join(", ")}`;
  },

  vmstat(sh) {
    const s = p(sh);
    const m = s.memoria;
    // si/so sono lo swap in entrata e in uscita: se non sono zero, la memoria
    // e' finita, e tutto il resto e' conseguenza.
    const si = m.swapUsataMB ? 320 : 0;
    const so = m.swapUsataMB ? 410 : 0;
    return [
      "procs -----------memory---------- ---swap-- -----io---- -----cpu-----",
      " r  b   swpd    free   buff  cache   si   so    bi    bo  us sy id wa",
      ` ${s.cpu.utente > 80 ? 8 : 1}  ${s.cpu.attesaIo > 30 ? 3 : 0} ${String(m.swapUsataMB).padStart(6)} ${String(m.totaleMB - m.usataMB).padStart(7)} ${String(400).padStart(6)} ${String(m.cacheMB).padStart(6)} ${String(si).padStart(4)} ${String(so).padStart(4)} ${String(s.disco.letturaKB).padStart(5)} ${String(s.disco.scritturaKB).padStart(5)} ${String(s.cpu.utente).padStart(3)} ${String(s.cpu.sistema).padStart(2)} ${String(s.cpu.inattivo).padStart(2)} ${String(s.cpu.attesaIo).padStart(2)}`,
    ].join("\n");
  },

  iostat(sh) {
    const d = p(sh).disco;
    return [
      "Device            tps    kB_read/s    kB_wrtn/s   %util",
      `nvme0n1      ${String(d.tps).padStart(9)} ${String(d.letturaKB.toFixed ? d.letturaKB : d.letturaKB).padStart(12)} ${String(d.scritturaKB).padStart(12)} ${String(d.utilizzo).padStart(7)}`,
    ].join("\n");
  },

  free(sh, args) {
    const m = p(sh).memoria;
    const u = args.includes("-h") ? (n) => `${(n / 1024).toFixed(1)}Gi` : (n) => String(n);
    return [
      "               total        used        free      buff/cache   available",
      `Mem:    ${u(m.totaleMB).padStart(12)}${u(m.usataMB).padStart(12)}${u(m.totaleMB - m.usataMB - m.cacheMB).padStart(12)}${u(m.cacheMB).padStart(14)}${u(m.totaleMB - m.usataMB).padStart(12)}`,
      `Swap:   ${u(2048).padStart(12)}${u(m.swapUsataMB).padStart(12)}${u(2048 - m.swapUsataMB).padStart(12)}`,
    ].join("\n");
  },

  /** strace -c e' quello che si usa davvero: il riassunto per chiamata dice
   *  subito se un programma sta facendo un milione di letture da 4 KB. */
  strace(sh, args) {
    const s = p(sh);
    bersaglio(sh, args);
    if (args.includes("-c")) {
      const totale = s.syscall.reduce((t, [, n]) => t + n, 0);
      return [
        "% time     calls  syscall",
        "------ --------- ----------------",
        ...s.syscall.map(([nome, n]) => `${String(Math.round((n / totale) * 100)).padStart(6)} ${String(n).padStart(9)}  ${nome}`),
        "------ --------- ----------------",
        `100.00 ${String(totale).padStart(9)}  totale`,
      ].join("\n");
    }
    return s.syscall
      .flatMap(([nome, n]) => Array.from({ length: Math.min(n, 3) }, () => `${nome}(...) = 0`))
      .join("\n");
  },

  perf(sh, args) {
    if (!args.includes("stat")) throw new V.ErroreFs("qui perf capisce solo: perf stat COMANDO");
    const s = p(sh);
    bersaglio(sh, args.slice(args.indexOf("stat") + 1));
    return [
      " Performance counter stats:",
      `        ${s.cpu.utente * 21}0,000,000      cycles`,
      `        ${s.cpu.utente * 14}0,000,000      instructions   #  ${(s.cpu.utente / 100 + 0.4).toFixed(2)} insn per cycle`,
      `             ${s.disco.tps * 3}      cache-misses`,
    ].join("\n");
  },

  /** Un limite di memoria su un processo: e' quello che fanno i cgroups, ed e'
   *  anche il pavimento su cui stanno i container. */
  "systemd-run"(sh, args) {
    const testo = args.join(" ");
    const limite = testo.match(/MemoryMax=(\S+)/)?.[1];
    const comando = args.filter((a) => !a.startsWith("-") && !a.includes("=")).join(" ");
    if (!limite) throw new V.ErroreFs("usa systemd-run --scope -p MemoryMax=2G COMANDO");
    if (!comando) throw new V.ErroreFs("manca il comando da eseguire");
    p(sh).limiti[comando] = limite;
    return `Running scope as unit: run-r${Math.floor(Math.random() * 900 + 100)}.scope\n${comando}: limitato a ${limite} di memoria`;
  },

  tuned(sh, args) {
    if (args.includes("active")) return `Current active profile: ${p(sh).profilo}`;
    const i = args.indexOf("profile");
    if (i >= 0 && args[i + 1]) {
      p(sh).profilo = args[i + 1];
      return "";
    }
    throw new V.ErroreFs("usa tuned-adm active oppure tuned-adm profile NOME");
  },
  "tuned-adm"(sh, args) {
    return PRESTAZIONI.tuned(sh, args);
  },

  hdparm(sh, args) {
    if (!args.includes("-t")) throw new V.ErroreFs("qui hdparm capisce solo -t (prova di lettura)");
    const d = p(sh).disco;
    return ` Timing buffered disk reads: ${Math.round(d.letturaKB / 100)} MB/s`;
  },
};
