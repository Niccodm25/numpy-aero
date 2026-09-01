// Servizi, log e lavori periodici: unit systemd, journal, cron, rotazione.
//
// Lo stato e' vero perche' le domande vere sono tre, e nessuna si risponde
// stampando una riga fissa:
//   - il servizio e' attivo adesso?          -> attivo
//   - riparte dopo un riavvio?               -> abilitato
//   - perche' non e' partito?                -> il journal, e il file di unit
//
// La unit e' un file in /etc/systemd/system: si scrive con echo, si carica con
// daemon-reload, e se ExecStart punta a un file che non esiste o non e'
// eseguibile il servizio fallisce come sulla macchina vera.

import * as V from "./vfs.js";

const DIR_UNIT = "/etc/systemd/system";

export function statoServizi(sh, scenario = {}) {
  // Lo scenario arriva dal JSON dell'esercizio, che l'app carica una volta
  // sola: senza copiarlo, i comandi modificherebbero la dichiarazione
  // stessa e l'esercizio ripartirebbe dallo stato in cui l'hai lasciato.
  scenario = structuredClone(scenario);
  sh.servizi = {
    unita: scenario.unita ?? {
      "acquisizione.service": {
        descrizione: "Acquisizione banco prova",
        exec: "/opt/acq/acquisisci.sh",
        attivo: false,
        abilitato: false,
        stato: "inactive",
        log: ["systemd[1]: unit caricata"],
      },
      "sshd.service": {
        descrizione: "OpenSSH server",
        exec: "/usr/sbin/sshd",
        attivo: true,
        abilitato: true,
        stato: "active",
        log: ["sshd[812]: in ascolto sulla porta 22"],
      },
    },
    timers: scenario.timers ?? {},
    // Il kernel non lo scrivi tu: qui e' un elenco fisso, ed e' onesto dirlo.
    dmesg: scenario.dmesg ?? [
      "[    0.000000] Linux version 6.8.0",
      "[    1.204511] enp0s3: link becomes ready",
      "[    2.001233] systemd[1]: avvio completato",
    ],
    ...(scenario.extra || {}),
  };
  // Gli eseguibili dei servizi di sistema ci sono gia': quelli tuoi li crei tu,
  // ed e' li' che nascono i guasti interessanti.
  if (!V.esiste(sh.fs, "/usr/sbin/sshd")) {
    V.creaDir(sh.fs, "/usr/sbin", true);
    V.scrivi(sh.fs, "/usr/sbin/sshd", "binario\n");
    sh.fs.nodi.get(V.normalizza(sh.fs, "/usr/sbin/sshd")).modo = 0o755;
  }
  V.creaDir(sh.fs, DIR_UNIT, true);
  // /opt esiste su qualunque macchina: senza, il primo "echo > /opt/mio.sh" di
  // un esercizio fallirebbe per un motivo che non c'entra niente con i servizi.
  V.creaDir(sh.fs, "/opt", true);
  return sh;
}

const unita = (sh, nome) => {
  const chiave = nome?.includes(".") ? nome : `${nome}.service`;
  const u = sh.servizi.unita[chiave];
  if (!u) throw new V.ErroreFs(`Unit ${chiave} non trovata`);
  return [chiave, u];
};

function ora() {
  return new Date().toISOString().slice(11, 19);
}

/** Perche' il servizio non parte. null = parte. */
function fallimento(sh, u) {
  if (!u.exec) return null;
  if (!V.esiste(sh.fs, u.exec)) return `status=203/EXEC (${u.exec}: non esiste)`;
  // Nemmeno root esegue un file senza bit di esecuzione: qui la scorciatoia
  // "root puo' tutto" darebbe la risposta sbagliata.
  const nodo = sh.fs.nodi.get(V.normalizza(sh.fs, u.exec));
  if (!((nodo.modo ?? V.MODO_FILE) & 0o111)) return `status=203/EXEC (${u.exec}: non e' eseguibile)`;
  return null;
}

function avvia(sh, chiave, u, azione) {
  const guasto = fallimento(sh, u);
  if (guasto) {
    u.attivo = false;
    u.stato = "failed";
    u.log.push(`systemd[1]: ${chiave}: Failed to execute command: ${guasto}`);
    u.log.push(`systemd[1]: ${chiave}: Failed with result 'exit-code'`);
    throw new V.ErroreFs(`Job for ${chiave} failed. Guarda "systemctl status ${chiave}" e "journalctl -xeu ${chiave}"`);
  }
  u.attivo = true;
  u.stato = "active";
  u.log.push(`systemd[1]: ${azione}: ${chiave} avviato`);
  return "";
}

/** Legge i file .service scritti a mano e li registra: e' quello che fa
 *  daemon-reload, ed e' il passo che tutti dimenticano dopo aver scritto la unit. */
function ricarica(sh) {
  let nuove = 0;
  for (const p of V.sottoalbero(sh.fs, DIR_UNIT)) {
    if (!p.endsWith(".service")) continue;
    const nome = V.foglia(p);
    const testo = V.leggi(sh.fs, p);
    const exec = testo.match(/^\s*ExecStart\s*=\s*(\S+)/m)?.[1] ?? null;
    const descrizione = testo.match(/^\s*Description\s*=\s*(.+)$/m)?.[1] ?? nome;
    const gia = sh.servizi.unita[nome];
    sh.servizi.unita[nome] = {
      descrizione,
      exec,
      attivo: gia?.attivo ?? false,
      abilitato: gia?.abilitato ?? /WantedBy/.test(testo) ? gia?.abilitato ?? false : false,
      stato: gia?.stato ?? "inactive",
      log: gia?.log ?? ["systemd[1]: unit caricata"],
    };
    if (!gia) nuove++;
  }
  return nuove;
}

export const SERVIZI = {
  systemctl(sh, args) {
    const [azione, nome] = args;

    if (azione === "daemon-reload") {
      ricarica(sh);
      return "";
    }

    if (azione === "list-units" || azione === "list-unit-files") {
      const soloFalliti = args.includes("--failed");
      return Object.entries(sh.servizi.unita)
        .filter(([, u]) => !soloFalliti || u.stato === "failed")
        .map(([n, u]) => `${n.padEnd(24)} loaded ${u.stato.padEnd(9)} ${u.abilitato ? "enabled" : "disabled"}`)
        .join("\n");
    }

    if (azione === "list-timers") {
      const t = Object.entries(sh.servizi.timers);
      if (!t.length) return "0 timers listed.";
      return ["NEXT       UNIT                 ACTIVATES",
        ...t.map(([n, x]) => `${(x.quando ?? "domani").padEnd(10)} ${n.padEnd(20)} ${x.attiva ?? n.replace(".timer", ".service")}`)]
        .join("\n");
    }

    const [chiave, u] = unita(sh, nome);

    if (azione === "status") {
      const attivo = u.stato === "active" ? "active (running)" : u.stato === "failed" ? "failed (Result: exit-code)" : "inactive (dead)";
      return [
        `● ${chiave} - ${u.descrizione}`,
        `     Loaded: loaded (${DIR_UNIT}/${chiave}; ${u.abilitato ? "enabled" : "disabled"})`,
        `     Active: ${attivo}`,
        u.exec ? `   ExecStart: ${u.exec}` : "",
        "",
        ...u.log.slice(-3).map((r) => `${ora()} banco ${r}`),
      ].filter(Boolean).join("\n");
    }

    if (azione === "start") return avvia(sh, chiave, u, "start");
    if (azione === "restart") {
      u.log.push(`systemd[1]: ${chiave} fermato`);
      return avvia(sh, chiave, u, "restart");
    }
    if (azione === "stop") {
      u.attivo = false;
      u.stato = "inactive";
      u.log.push(`systemd[1]: ${chiave} fermato`);
      return "";
    }
    // enable non avvia niente adesso: decide solo cosa succede al prossimo
    // riavvio. Confonderlo con start e' il malinteso numero uno di systemd.
    if (azione === "enable") {
      u.abilitato = true;
      return `Created symlink ${DIR_UNIT}/multi-user.target.wants/${chiave} → ${DIR_UNIT}/${chiave}.`;
    }
    if (azione === "disable") {
      u.abilitato = false;
      return `Removed ${DIR_UNIT}/multi-user.target.wants/${chiave}.`;
    }
    if (azione === "is-enabled") return u.abilitato ? "enabled" : "disabled";
    if (azione === "is-active") return u.stato === "active" ? "active" : u.stato;

    throw new V.ErroreFs("usa status, start, stop, restart, enable, disable, is-enabled, is-active, daemon-reload, list-units o list-timers");
  },

  journalctl(sh, args) {
    const i = args.indexOf("-u");
    const nome = i >= 0 ? args[i + 1] : args.find((a) => a.endsWith(".service"));
    const n = args.includes("-n") ? Number(args[args.indexOf("-n") + 1]) : null;
    if (!nome) {
      const tutte = Object.entries(sh.servizi.unita).flatMap(([k, u]) => u.log.map((r) => `${ora()} banco ${k}: ${r}`));
      return (n ? tutte.slice(-n) : tutte).join("\n");
    }
    const [, u] = unita(sh, nome);
    const righe = u.log.map((r) => `${ora()} banco ${r}`);
    return (n ? righe.slice(-n) : righe).join("\n");
  },

  dmesg(sh) {
    return sh.servizi.dmesg.join("\n");
  },

  /** crontab -l elenca, crontab FILE installa: l'editor interattivo qui non c'e'. */
  crontab(sh, args) {
    const f = "/home/tu/.crontab";
    if (args.includes("-l")) {
      if (!V.esiste(sh.fs, f)) throw new V.ErroreFs("no crontab for tu");
      return V.leggi(sh.fs, f).replace(/\n$/, "");
    }
    if (args.includes("-r")) {
      if (V.esiste(sh.fs, f)) V.rimuovi(sh.fs, f);
      return "";
    }
    const file = args.find((a) => !a.startsWith("-"));
    if (!file) throw new V.ErroreFs("usa crontab -l, crontab -r oppure crontab FILE");
    V.scrivi(sh.fs, f, V.leggi(sh.fs, file));
    return "";
  },

  /** Ruota un log: log.txt diventa log.txt.1 e ricomincia vuoto. */
  logrotate(sh, args) {
    const file = args.filter((a) => !a.startsWith("-")).at(-1);
    if (!file) throw new V.ErroreFs("manca il file di configurazione o il log");
    const bersaglio = file.endsWith(".conf") ? V.leggi(sh.fs, file).trim().split(/\s+/)[0] : file;
    if (!V.esiste(sh.fs, bersaglio)) throw new V.ErroreFs(`${bersaglio}: file non esistente`);
    V.scrivi(sh.fs, `${bersaglio}.1`, V.leggi(sh.fs, bersaglio));
    V.scrivi(sh.fs, bersaglio, "");
    return `ruotato ${bersaglio} -> ${bersaglio}.1`;
  },

  /** Comando del simulatore: riavvia la macchina. Tornano su solo i servizi
   *  abilitati — che e' l'unico modo di far vedere la differenza con start. */
  riavvia(sh) {
    const tornati = [];
    for (const [nome, u] of Object.entries(sh.servizi.unita)) {
      if (u.abilitato && !fallimento(sh, u)) {
        u.attivo = true;
        u.stato = "active";
        u.log.push("systemd[1]: avviato al boot");
        tornati.push(nome);
      } else {
        u.attivo = false;
        u.stato = "inactive";
      }
    }
    return `[la macchina si e' riavviata]\nservizi ripartiti: ${tornati.join(", ") || "nessuno"}`;
  },
};
