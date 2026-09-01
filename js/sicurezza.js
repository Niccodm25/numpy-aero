// Sicurezza difensiva: firewall, indurimento di ssh, controllo obbligatorio,
// capacita' al posto di setuid.
//
// Tutto quello che c'e' qui serve a chiudere una macchina tua o affidata a te.
// Non c'e' niente per entrare in macchine di altri, e non e' una dimenticanza.
//
// Il firewall e' osservabile: `prova-da-fuori PORTA` simula una connessione in
// arrivo da un'altra macchina, ed e' l'unico modo per far vedere che una regola
// ha davvero effetto invece di stampare un elenco.

import * as V from "./vfs.js";

const SSHD = "/etc/ssh/sshd_config";

export function statoSicurezza(sh, scenario = {}) {
  sh.sicurezza = {
    firewall: {
      attivo: scenario.attivo ?? false,
      // Il default che conta: in ingresso si nega, in uscita si permette.
      ingresso: scenario.ingresso ?? "allow",
      regole: scenario.regole ?? [],
    },
    // I servizi che ascoltano su questa macchina, per sapere cosa risponde
    // quando il firewall lascia passare.
    porteAperte: scenario.porteAperte ?? [22, 8000],
    selinux: scenario.selinux ?? "Enforcing",
    apparmor: scenario.apparmor ?? { "usr.sbin.sshd": "enforce", "usr.bin.acquisisci": "complain" },
    capacita: scenario.capacita ?? {},
    ...(scenario.extra || {}),
  };
  V.creaDir(sh.fs, "/etc/ssh", true);
  if (!V.esiste(sh.fs, SSHD))
    V.scrivi(
      sh.fs,
      SSHD,
      "Port 22\nPermitRootLogin yes\nPasswordAuthentication yes\nPubkeyAuthentication yes\n"
    );
  return sh;
}

const s = (sh) => sh.sicurezza;
const fw = (sh) => sh.sicurezza.firewall;

/** La regola che decide di una porta: l'ultima che la nomina, poi il default. */
function decisione(sh, porta) {
  if (!fw(sh).attivo) return { permesso: true, motivo: "firewall non attivo" };
  const regola = [...fw(sh).regole].reverse().find((r) => r.porta === porta);
  if (regola) return { permesso: regola.azione === "allow", motivo: `regola ${regola.azione} ${porta}`, regola };
  return { permesso: fw(sh).ingresso !== "deny", motivo: `politica di default: ${fw(sh).ingresso}` };
}

export const SICUREZZA = {
  ufw(sh, args) {
    const [azione, ...resto] = args;
    const f = fw(sh);

    if (azione === "enable") {
      // Il classico: attivare il firewall da una sessione ssh senza aver prima
      // permesso la 22 vuol dire chiudersi fuori dalla macchina.
      const ssh = decisione({ sicurezza: { firewall: { ...f, attivo: true } } }, 22);
      f.attivo = true;
      return ssh.permesso
        ? "Firewall attivo e abilitato all'avvio"
        : "Firewall attivo e abilitato all'avvio\nATTENZIONE: la porta 22 non e' permessa. Da una sessione remota ti saresti appena chiuso fuori.";
    }
    if (azione === "disable") {
      f.attivo = false;
      return "Firewall fermo";
    }

    if (azione === "default") {
      const [politica, direzione] = resto;
      if (!["allow", "deny", "reject"].includes(politica))
        throw new V.ErroreFs("usa ufw default deny incoming (o allow)");
      if ((direzione ?? "incoming") === "incoming") f.ingresso = politica;
      return `Politica di default aggiornata: ${politica} ${direzione ?? "incoming"}`;
    }

    if (azione === "allow" || azione === "deny") {
      // Le forme ammesse, e nient'altro:
      //   ufw allow 22
      //   ufw allow 22/tcp
      //   ufw allow from 192.168.1.0/24
      //   ufw allow from 192.168.1.0/24 to any port 5432
      // Prima si pescavano "from" e "port" con due espressioni regolari, e le
      // parole in mezzo non contavano: `ufw allow from 10.0.0.0/8 zibaldone any
      // port 5432` passava come se fosse scritto giusto.
      let da = null;
      let porta = null;
      let i = 0;
      if (/^\d+(\/(tcp|udp))?$/.test(resto[0] ?? "")) {
        porta = Number(resto[0].split("/")[0]);
        i = 1;
      }
      if (resto[i] === "from") {
        da = resto[i + 1];
        if (!da) throw new V.ErroreFs("manca l'indirizzo dopo from");
        i += 2;
        if (resto[i] === "to") {
          if (resto[i + 1] !== "any") throw new V.ErroreFs('dopo "to" ci va "any"');
          if (resto[i + 2] !== "port") throw new V.ErroreFs('dopo "to any" ci va "port"');
          porta = Number(resto[i + 3]);
          if (!porta) throw new V.ErroreFs("manca il numero di porta dopo port");
          i += 4;
        }
      }
      if (i < resto.length) throw new V.ErroreFs(`non capisco: ${resto.slice(i).join(" ")}`);
      // ufw vero accetta anche `allow from 10.0.0.0/8` senza porta; qui il
      // modello e' fatto di regole su porte, e dirlo e' meglio che fingere.
      if (!porta) throw new V.ErroreFs("qui una regola vuole sempre una porta");
      f.regole.push({ porta, azione, da });
      return `Regola aggiunta: ${azione} ${porta}${da ? ` da ${da}` : ""}`;
    }

    if (azione === "delete") {
      const numero = Number(resto[0]);
      if (numero) {
        const via = f.regole.splice(numero - 1, 1);
        if (!via.length) throw new V.ErroreFs(`non esiste la regola numero ${numero}`);
        return `Regola ${numero} rimossa`;
      }
      const porta = Number(resto.join(" ").match(/(\d+)/)?.[1]);
      const prima = f.regole.length;
      f.regole = f.regole.filter((r) => r.porta !== porta);
      if (f.regole.length === prima) throw new V.ErroreFs("nessuna regola corrispondente");
      return `Regola su ${porta} rimossa`;
    }

    if (azione === "status") {
      const numerato = resto.includes("numbered");
      const righe = f.regole.map(
        (r, i) =>
          `${numerato ? `[${i + 1}] ` : ""}${r.porta}/tcp${" ".repeat(4)}${r.azione.toUpperCase()}${r.da ? ` da ${r.da}` : " da chiunque"}`
      );
      return [
        `Stato: ${f.attivo ? "attivo" : "fermo"}`,
        `Default in ingresso: ${f.ingresso}`,
        ...(righe.length ? ["", "A                 AZIONE", ...righe] : ["", "(nessuna regola)"]),
      ].join("\n");
    }

    throw new V.ErroreFs("usa enable, disable, default, allow, deny, delete o status");
  },

  /** Comando del simulatore: prova a raggiungere una porta di questa macchina
   *  da un'altra. E' la verifica che manca a chi guarda solo "ufw status". */
  "prova-da-fuori"(sh, args) {
    const porta = Number(args.find((a) => !a.startsWith("-")));
    if (!porta) throw new V.ErroreFs("indica una porta, per esempio prova-da-fuori 22");
    const d = decisione(sh, porta);
    if (!d.permesso) throw new V.ErroreFs(`porta ${porta}: connessione bloccata dal firewall (${d.motivo})`);
    if (!s(sh).porteAperte.includes(porta))
      throw new V.ErroreFs(`porta ${porta}: connessione rifiutata (il firewall lascia passare, ma nessun servizio ascolta)`);
    return `porta ${porta}: connessione riuscita (${d.motivo})`;
  },

  /** Controlla la sintassi di sshd_config, come fa sshd -t: si lancia SEMPRE
   *  prima di riavviare, o si resta fuori dalla macchina. */
  sshd(sh, args) {
    if (!args.includes("-t")) throw new V.ErroreFs("qui sshd accetta solo -t, il controllo della configurazione");
    const testo = V.leggi(sh.fs, SSHD);
    const righe = testo.split("\n").filter((r) => r.trim() && !r.trim().startsWith("#"));
    for (const r of righe) {
      const [chiave, valore] = r.trim().split(/\s+/);
      const booleane = ["PermitRootLogin", "PasswordAuthentication", "PubkeyAuthentication"];
      if (booleane.includes(chiave) && !["yes", "no", "prohibit-password"].includes(valore))
        throw new V.ErroreFs(`${SSHD}: valore non valido per ${chiave}: ${valore ?? "(vuoto)"}`);
      if (chiave === "Port" && !Number(valore)) throw new V.ErroreFs(`${SSHD}: Port non e' un numero`);
    }
    return "";
  },

  getenforce(sh) {
    return s(sh).selinux;
  },

  setenforce(sh, args) {
    const v = args[0];
    if (!["0", "1", "Permissive", "Enforcing"].includes(v))
      throw new V.ErroreFs("usa setenforce 0 (permissive) oppure 1 (enforcing)");
    s(sh).selinux = v === "0" || v === "Permissive" ? "Permissive" : "Enforcing";
    return "";
  },

  "aa-status"(sh) {
    const p = Object.entries(s(sh).apparmor);
    return [
      `apparmor module is loaded.`,
      `${p.length} profiles are loaded.`,
      ...p.map(([nome, modo]) => `   ${nome} (${modo})`),
    ].join("\n");
  },

  /** Le capacita' sono setuid fatto per bene: un permesso solo invece di tutti. */
  getcap(sh, args) {
    const file = args.find((a) => !a.startsWith("-"));
    if (!file) return Object.entries(s(sh).capacita).map(([f, c]) => `${f} ${c}`).join("\n");
    const c = s(sh).capacita[V.normalizza(sh.fs, file)];
    return c ? `${file} ${c}` : "";
  },

  setcap(sh, args) {
    const [capacita, file] = args.filter((a) => !a.startsWith("-"));
    if (!capacita || !file) throw new V.ErroreFs("usa setcap cap_net_raw+ep /percorso/programma");
    if (!V.esiste(sh.fs, file)) throw new V.ErroreFs(`${file}: file non esistente`);
    s(sh).capacita[V.normalizza(sh.fs, file)] = capacita;
    return "";
  },
};
