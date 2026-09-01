// Ansible: la configurazione scritta una volta e applicata a molte macchine.
//
// Il playbook e' un file YAML che scrivi tu, e viene **letto ed eseguito**: i
// task cambiano davvero il filesystem virtuale e lo stato dei servizi. Da qui
// viene l'unica cosa che conta di Ansible, e che un finto riepilogo non
// potrebbe insegnare: **l'idempotenza**. Applicare due volte lo stesso
// playbook non cambia niente la seconda, e il recap lo dice con changed=0.
//
// Coperto: hosts, tasks, e i moduli file, copy, lineinfile, service, package.
// Con --check si vede cosa cambierebbe senza cambiare niente.
//
// Non coperto, per scelta: variabili, template Jinja, handler, ruoli, loop.
// Sono la meta' di Ansible, e un simulatore che ne accettasse una parte
// insegnerebbe una sintassi che poi non funziona.

import * as V from "./vfs.js";

export function statoAutomazione(sh, scenario = {}) {
  // Lo scenario arriva dal JSON dell'esercizio, che l'app carica una volta
  // sola: senza copiarlo, i comandi modificherebbero la dichiarazione
  // stessa e l'esercizio ripartirebbe dallo stato in cui l'hai lasciato.
  scenario = structuredClone(scenario);
  sh.automazione = {
    inventario: scenario.inventario ?? { banco: ["banco01"], stazioni: ["meteo01", "meteo02"] },
    pacchetti: scenario.pacchetti ?? { rsync: true, tmux: false, htop: false },
    ...(scenario.extra || {}),
  };
  return sh;
}

const a = (sh) => sh.automazione;

/** Legge l'inventario in formato ini: [gruppo] seguito dagli host. */
function leggiInventario(sh, file) {
  if (!file) return a(sh).inventario;
  if (!V.esiste(sh.fs, file)) throw new V.ErroreFs(`${file}: inventario non trovato`);
  const gruppi = {};
  let corrente = "ungrouped";
  for (const riga of V.leggi(sh.fs, file).split("\n")) {
    const pulita = riga.trim();
    if (!pulita || pulita.startsWith("#")) continue;
    const gruppo = pulita.match(/^\[(.+)\]$/);
    if (gruppo) {
      corrente = gruppo[1];
      gruppi[corrente] = gruppi[corrente] ?? [];
      continue;
    }
    (gruppi[corrente] ??= []).push(pulita.split(/\s+/)[0]);
  }
  return gruppi;
}

/**
 * Parser YAML ridotto alla forma dei playbook: una lista di play, ognuno con
 * `hosts` e `tasks`, e ogni task con un nome e un modulo con i suoi parametri.
 * Fuori da questa forma si ferma e lo dice, invece di indovinare.
 */
function leggiPlaybook(testo) {
  const righe = testo.split("\n").filter((r) => r.trim() && !r.trim().startsWith("#") && r.trim() !== "---");
  const play = { hosts: null, tasks: [] };
  let task = null;
  let modulo = null;

  const indentazione = (r) => r.length - r.trimStart().length;

  for (const riga of righe) {
    const pulita = riga.trim();
    const dentro = indentazione(riga);

    if (pulita.startsWith("- hosts:")) {
      play.hosts = pulita.slice("- hosts:".length).trim();
      continue;
    }
    if (pulita === "tasks:") continue;

    if (pulita.startsWith("- name:")) {
      task = { nome: pulita.slice("- name:".length).trim(), modulo: null, parametri: {} };
      play.tasks.push(task);
      modulo = null;
      continue;
    }

    const coppia = pulita.replace(/^-\s*/, "").match(/^([\w.]+):\s*(.*)$/);
    if (!coppia) throw new V.ErroreFs(`riga non riconosciuta nel playbook: ${pulita}`);
    const [, chiave, valore] = coppia;

    if (!task) throw new V.ErroreFs("un task deve cominciare con - name:");
    // Un modulo e' una chiave senza valore: sotto ci stanno i suoi parametri.
    if (valore === "") {
      task.modulo = chiave;
      modulo = { dentro };
      continue;
    }
    if (modulo && dentro > modulo.dentro) task.parametri[chiave] = spoglia(valore);
    else if (!task.modulo) {
      task.modulo = chiave;
      task.parametri = Object.fromEntries(
        valore.split(/\s+/).map((x) => x.split("=")).filter((x) => x.length === 2)
      );
    } else task.parametri[chiave] = spoglia(valore);
  }

  if (!play.hosts) throw new V.ErroreFs("il playbook deve dichiarare - hosts:");
  return play;
}

const spoglia = (v) => v.replace(/^["']|["']$/g, "");

/** Esegue un task. Restituisce true se ha cambiato qualcosa: e' tutta la
 *  differenza fra ok e changed nel riepilogo, e quindi fra un playbook
 *  idempotente e uno che non lo e'. */
function applica(sh, task, prova) {
  const p = task.parametri;
  switch (task.modulo) {
    case "file": {
      const percorso = p.path;
      if (!percorso) throw new V.ErroreFs("il modulo file vuole path");
      const esiste = V.esiste(sh.fs, percorso);
      if (p.state === "directory") {
        if (esiste) return false;
        if (!prova) V.creaDir(sh.fs, percorso, true);
        return true;
      }
      if (p.state === "absent") {
        if (!esiste) return false;
        if (!prova) V.rimuovi(sh.fs, percorso, true);
        return true;
      }
      if (esiste) return false;
      if (!prova) V.scrivi(sh.fs, percorso, "");
      return true;
    }

    case "copy": {
      const dest = p.dest;
      if (!dest) throw new V.ErroreFs("il modulo copy vuole dest");
      const contenuto = p.content !== undefined ? p.content + "\n" : V.leggi(sh.fs, p.src);
      if (V.esiste(sh.fs, dest) && V.leggi(sh.fs, dest) === contenuto) return false;
      if (!prova) {
        V.creaDir(sh.fs, V.genitore(V.normalizza(sh.fs, dest)), true);
        V.scrivi(sh.fs, dest, contenuto);
      }
      return true;
    }

    case "lineinfile": {
      const percorso = p.path;
      const riga = p.line;
      if (!percorso || riga === undefined) throw new V.ErroreFs("lineinfile vuole path e line");
      const testo = V.esiste(sh.fs, percorso) ? V.leggi(sh.fs, percorso) : "";
      if (testo.split("\n").includes(riga)) return false;
      if (!prova) V.scrivi(sh.fs, percorso, testo + (testo.endsWith("\n") || !testo ? "" : "\n") + riga + "\n");
      return true;
    }

    case "service": {
      const nome = p.name?.includes(".") ? p.name : `${p.name}.service`;
      const unita = sh.servizi?.unita?.[nome];
      if (!unita) throw new V.ErroreFs(`servizio ${nome} sconosciuto su questa macchina`);
      let cambiato = false;
      if (p.state === "started" && unita.stato !== "active") {
        if (!prova) {
          unita.attivo = true;
          unita.stato = "active";
          unita.log.push("ansible: servizio avviato");
        }
        cambiato = true;
      }
      if (p.state === "stopped" && unita.stato === "active") {
        if (!prova) {
          unita.attivo = false;
          unita.stato = "inactive";
        }
        cambiato = true;
      }
      if (p.enabled === "yes" && !unita.abilitato) {
        if (!prova) unita.abilitato = true;
        cambiato = true;
      }
      return cambiato;
    }

    case "package": {
      const nome = p.name;
      const stato = a(sh).pacchetti[nome];
      if (p.state === "absent") {
        if (!stato) return false;
        if (!prova) a(sh).pacchetti[nome] = false;
        return true;
      }
      if (stato) return false;
      if (!prova) a(sh).pacchetti[nome] = true;
      return true;
    }

    default:
      throw new V.ErroreFs(
        `modulo ${task.modulo ?? "(nessuno)"} non supportato qui: usa file, copy, lineinfile, service o package`
      );
  }
}

export const AUTOMAZIONE = {
  "ansible-playbook"(sh, args) {
    const prova = args.includes("--check") || args.includes("-C");
    const i = args.indexOf("-i");
    const inventarioFile = i >= 0 ? args[i + 1] : null;
    const file = args.filter((x, n) => !x.startsWith("-") && n !== i + 1)[0];
    if (!file) throw new V.ErroreFs("manca il playbook");
    if (!V.esiste(sh.fs, file)) throw new V.ErroreFs(`${file}: playbook non trovato`);

    const gruppi = leggiInventario(sh, inventarioFile);
    const play = leggiPlaybook(V.leggi(sh.fs, file));
    const host =
      play.hosts === "all"
        ? Object.values(gruppi).flat()
        : gruppi[play.hosts] ?? (Object.values(gruppi).flat().includes(play.hosts) ? [play.hosts] : null);
    if (!host || !host.length) throw new V.ErroreFs(`nessun host per "${play.hosts}" nell'inventario`);

    const righe = [`PLAY [${play.hosts}] ${"*".repeat(30)}`, ""];
    let cambiati = 0;
    for (const task of play.tasks) {
      // I task si applicano una volta sola: il filesystem simulato e' uno, e
      // fingere n macchine identiche non aggiungerebbe niente da imparare.
      const cambiato = applica(sh, task, prova);
      if (cambiato) cambiati++;
      righe.push(`TASK [${task.nome}] ${"*".repeat(20)}`);
      righe.push(`${cambiato ? "changed" : "ok"}: [${host[0]}]`);
      righe.push("");
    }
    righe.push("PLAY RECAP " + "*".repeat(30));
    for (const h of host)
      righe.push(
        `${h.padEnd(12)} : ok=${play.tasks.length} changed=${cambiati} unreachable=0 failed=0`
      );
    if (prova) righe.push("", "(--check: nessuna modifica applicata)");
    return righe.join("\n");
  },

  /** Comandi al volo: utili per una verifica, non per configurare. */
  ansible(sh, args) {
    const bersaglio = args.find((x) => !x.startsWith("-")) ?? "all";
    const m = args.indexOf("-m");
    const modulo = m >= 0 ? args[m + 1] : "ping";
    const i = args.indexOf("-i");
    const gruppi = leggiInventario(sh, i >= 0 ? args[i + 1] : null);
    const host = bersaglio === "all" ? Object.values(gruppi).flat() : gruppi[bersaglio] ?? [bersaglio];
    if (!host.length) throw new V.ErroreFs(`nessun host per "${bersaglio}"`);
    if (modulo === "ping")
      return host.map((h) => `${h} | SUCCESS => {"ping": "pong"}`).join("\n");
    if (modulo === "setup")
      return host.map((h) => `${h} | SUCCESS => {"ansible_distribution": "Ubuntu", "ansible_kernel": "6.8.0"}`).join("\n");
    throw new V.ErroreFs(`qui ansible supporta -m ping e -m setup`);
  },

  "ansible-inventory"(sh, args) {
    const i = args.indexOf("-i");
    const gruppi = leggiInventario(sh, i >= 0 ? args[i + 1] : null);
    return Object.entries(gruppi)
      .map(([g, host]) => `${g}:\n${host.map((h) => `  - ${h}`).join("\n")}`)
      .join("\n");
  },
};
