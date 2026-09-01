// La seconda macchina: accesso ssh, chiavi, trasferimenti e sessioni tmux.
// Nessuna connessione vera esce dal browser — c'e' un secondo filesystem, e le
// regole che decidono se ti fa entrare.
//
// Perche' tutto questo stato: "ssh non funziona" ha cinque cause diverse (host
// sbagliato, porta sbagliata, chiave assente, chiave non autorizzata, chiave con
// i permessi troppo aperti) e ognuna ha un messaggio suo. Un simulatore che
// risponde sempre "Connesso" insegna a digitare, non a diagnosticare.

import * as V from "./vfs.js";
import { POSIX, creaShell, esegui } from "./shell.js";

const PUBBLICA = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 tu@banco";

export function statoRemoto(sh, scenario = {}) {
  // Lo scenario arriva dal JSON dell'esercizio, che l'app carica una volta
  // sola: senza copiarlo, i comandi modificherebbero la dichiarazione
  // stessa e l'esercizio ripartirebbe dallo stato in cui l'hai lasciato.
  scenario = structuredClone(scenario);
  const utente = scenario.utente ?? "anna";
  const fs = V.crea(
    scenario.files || {
      [`/home/${utente}/risultati/quota.csv`]: "t,quota\n0,1000\n120,8400\n",
      [`/home/${utente}/risultati/log.txt`]: "INFO avvio\nERROR sensore quota\nINFO fine\n",
      [`/home/${utente}/simula.py`]: "print('simulazione')\n",
    }
  );
  fs.utente = utente;
  fs.cwd = `/home/${utente}`;
  sh.remoto = {
    nome: scenario.nome ?? "cluster",
    utente,
    porta: scenario.porta ?? 22,
    // Un server serio non accetta password: e' il motivo per cui le chiavi non
    // sono una comodita' ma il modo normale di entrare.
    soloChiavi: scenario.soloChiavi !== false,
    fs,
    sessioni: scenario.sessioni ?? {},
    ...(scenario.remoto || {}),
  };
  if (scenario.autorizzata) autorizza(sh, PUBBLICA);
  return sh;
}

function autorizza(sh, chiave) {
  const f = `/home/${sh.remoto.utente}/.ssh/authorized_keys`;
  V.creaDir(sh.remoto.fs, `/home/${sh.remoto.utente}/.ssh`, true);
  const gia = V.esiste(sh.remoto.fs, f) ? V.leggi(sh.remoto.fs, f) : "";
  if (!gia.includes(chiave)) V.scrivi(sh.remoto.fs, f, gia + chiave + "\n");
}

/** L'alias scritto in ~/.ssh/config: Host, HostName, User, Port.
 *  E' il file che trasforma "ssh -p 2222 anna@cluster.univ.it" in "ssh cluster". */
function daConfig(sh, alias) {
  const f = "/home/tu/.ssh/config";
  if (!V.esiste(sh.fs, f)) return null;
  let dentro = false;
  const out = {};
  for (const riga of V.leggi(sh.fs, f).split("\n")) {
    const [chiave, valore] = riga.trim().split(/\s+/);
    if (!chiave) continue;
    if (chiave.toLowerCase() === "host") {
      dentro = valore === alias;
      continue;
    }
    if (!dentro) continue;
    if (chiave.toLowerCase() === "hostname") out.host = valore;
    if (chiave.toLowerCase() === "user") out.utente = valore;
    if (chiave.toLowerCase() === "port") out.porta = Number(valore);
  }
  return Object.keys(out).length ? out : null;
}

/** La chiave privata che c'e', qualunque tipo abbia scelto chi l'ha generata. */
const NOMI_CHIAVE = ["id_ed25519", "id_rsa", "id_ecdsa"];
const chiavePrivata = (fs) =>
  NOMI_CHIAVE.map((n) => `/home/tu/.ssh/${n}`).find((p) => V.esiste(fs, p)) ?? null;

/** Perche' il server non ti fa entrare. null = ti fa entrare. */
function rifiuto(sh, dest) {
  const r = sh.remoto;
  const nomiValidi = [r.nome, `${r.nome}.univ.it`];
  if (!nomiValidi.includes(dest.host)) return `${dest.host}: host non raggiungibile`;
  if (dest.porta !== r.porta) return `connessione rifiutata sulla porta ${dest.porta}`;

  const priv = chiavePrivata(sh.fs);
  if (!priv)
    return r.soloChiavi
      ? `${dest.utente}@${dest.host}: Permission denied (publickey) — non hai una chiave`
      : null;

  // Una chiave privata leggibile dagli altri e' una chiave da buttare: ssh si
  // rifiuta di usarla, e il messaggio e' lo stesso da vent'anni.
  const nodo = sh.fs.nodi.get(V.normalizza(sh.fs, priv));
  if ((nodo.modo ?? V.MODO_FILE) & 0o077)
    return `WARNING: UNPROTECTED PRIVATE KEY FILE! ${priv} ha permessi troppo aperti`;

  const auth = `/home/${r.utente}/.ssh/authorized_keys`;
  const autorizzate = V.esiste(r.fs, auth) ? V.leggi(r.fs, auth) : "";
  if (!autorizzate.includes(PUBBLICA))
    return `${dest.utente}@${dest.host}: Permission denied (publickey) — la tua chiave non e' autorizzata`;
  return null;
}

/** Da "anna@cluster" o "cluster" alla destinazione completa, passando dal config. */
function destinazione(sh, spec, portaEsplicita) {
  const [utente, host] = spec.includes("@") ? spec.split("@") : [null, spec];
  const cfg = daConfig(sh, host) || {};
  return {
    host: cfg.host ?? host,
    utente: utente ?? cfg.utente ?? "tu",
    porta: portaEsplicita ?? cfg.porta ?? 22,
  };
}

/** Un comando eseguito di la': stessa shell, altro filesystem. */
function eseguiRemoto(sh, comando) {
  const remota = creaShell({}, { comandi: POSIX });
  remota.fs = sh.remoto.fs;
  const r = esegui(remota, comando);
  if (r.errore) throw new V.ErroreFs(r.errore);
  return r.out;
}

function separa(sh, spec) {
  const m = spec.match(/^(?:([^@]+)@)?([^:]+):(.*)$/);
  if (!m) return null;
  const dest = destinazione(sh, m[1] ? `${m[1]}@${m[2]}` : m[2], null);
  return { dest, percorso: m[3] || "." };
}

export const REMOTO = {
  ssh(sh, args) {
    const porta = args.includes("-p") ? Number(args[args.indexOf("-p") + 1]) : null;
    const resto = args.filter((a, i) => a !== "-p" && args[i - 1] !== "-p");
    const spec = resto[0];
    if (!spec) throw new V.ErroreFs("manca utente@host");
    const dest = destinazione(sh, spec, porta);
    const no = rifiuto(sh, dest);
    if (no) throw new V.ErroreFs(no);

    const comando = resto.slice(1).join(" ");
    if (!comando) {
      sh.remoto.connesso = true;
      return `Connesso a ${dest.host} come ${dest.utente}. (Qui la sessione interattiva non c'e': passa il comando sulla stessa riga.)`;
    }
    return eseguiRemoto(sh, comando.replace(/^["']|["']$/g, ""));
  },

  "ssh-keygen"(sh, args = []) {
    // Il tipo decide il nome dei file, ed e' il motivo per cui su una macchina
    // vecchia trovi id_rsa e su una nuova id_ed25519. Prima veniva ignorato:
    // `ssh-keygen -t zibaldone` generava una chiave ed25519 come niente fosse.
    const TIPI = { ed25519: "id_ed25519", rsa: "id_rsa", ecdsa: "id_ecdsa" };
    const t = args.indexOf("-t");
    const tipo = t >= 0 ? args[t + 1] : "rsa";
    if (t >= 0 && !tipo) throw new V.ErroreFs("manca il tipo dopo -t");
    if (!TIPI[tipo]) throw new V.ErroreFs(`unknown key type ${tipo}`);
    const nome = TIPI[tipo];

    const dir = "/home/tu/.ssh";
    V.creaDir(sh.fs, dir, true);
    V.scrivi(sh.fs, `${dir}/${nome}`, "PRIVATE KEY — non esce mai da questa macchina\n");
    sh.fs.nodi.get(V.normalizza(sh.fs, `${dir}/${nome}`)).modo = 0o600;
    V.scrivi(sh.fs, `${dir}/${nome}.pub`, PUBBLICA + "\n");
    return `Generata la coppia in ${dir}/${nome} e ${dir}/${nome}.pub`;
  },

  "ssh-copy-id"(sh, args) {
    const spec = args.filter((a) => !a.startsWith("-")).at(-1);
    if (!spec) throw new V.ErroreFs("manca utente@host");
    if (!chiavePrivata(sh.fs))
      throw new V.ErroreFs("nessuna chiave pubblica da copiare: prima ssh-keygen");
    const dest = destinazione(sh, spec, null);
    if (![sh.remoto.nome, `${sh.remoto.nome}.univ.it`].includes(dest.host))
      throw new V.ErroreFs(`${dest.host}: host non raggiungibile`);
    autorizza(sh, V.leggi(sh.fs, chiavePrivata(sh.fs) + ".pub").trim());
    return "1 chiave aggiunta. Ora prova a entrare senza password.";
  },

  scp(sh, args) {
    const { flag, resto } = opzioni(args);
    if (resto.length !== 2) throw new V.ErroreFs("servono sorgente e destinazione");
    const [s, d] = resto;
    const sr = separa(sh, s);
    const dr = separa(sh, d);
    if (!!sr === !!dr) throw new V.ErroreFs("una sola estremita' deve essere remota");
    const no = rifiuto(sh, (sr || dr).dest);
    if (no) throw new V.ErroreFs(no);

    const [origine, destino] = sr ? [sh.remoto.fs, sh.fs] : [sh.fs, sh.remoto.fs];
    const dentro = sr ? sr.percorso : s;
    const fuori = sr ? d : dr.percorso;
    if (V.eDir(origine, dentro)) {
      if (!flag.has("r")) throw new V.ErroreFs(`${dentro}: e' una directory (serve -r)`);
      return copiaAlbero(origine, destino, dentro, fuori).length + " file copiati";
    }
    V.scrivi(destino, fuori, V.leggi(origine, dentro));
    return "";
  },

  // rsync non ricopia quello che c'e' gia' uguale: e' la differenza con scp, e
  // si vede solo lanciandolo due volte.
  rsync(sh, args) {
    const { resto } = opzioni(args);
    if (resto.length !== 2) throw new V.ErroreFs("servono sorgente e destinazione");
    const [s, d] = resto;
    const sr = separa(sh, s);
    const dr = separa(sh, d);
    if (!!sr === !!dr) throw new V.ErroreFs("una sola estremita' deve essere remota");
    const no = rifiuto(sh, (sr || dr).dest);
    if (no) throw new V.ErroreFs(no);

    const [origine, destino] = sr ? [sh.remoto.fs, sh.fs] : [sh.fs, sh.remoto.fs];
    const dentro = sr ? sr.percorso : s;
    const fuori = sr ? d : dr.percorso;
    const copiati = V.eDir(origine, dentro)
      ? copiaAlbero(origine, destino, dentro, fuori, true)
      : copiaSeDiverso(origine, destino, dentro, fuori);
    return copiati.length
      ? `${copiati.join("\n")}\ninviati ${copiati.length} file`
      : "inviati 0 file (tutto gia' aggiornato)";
  },

  // Una sessione tmux sopravvive alla disconnessione: e' l'unica difesa contro
  // "ho chiuso il portatile e il calcolo di sei ore e' morto".
  tmux(sh, args) {
    const s = sh.remoto.sessioni;
    const [che, ...resto] = args;
    const nome = resto.includes("-s") ? resto[resto.indexOf("-s") + 1] : resto.includes("-t") ? resto[resto.indexOf("-t") + 1] : null;

    if (che === "new" || che === "new-session") {
      if (!nome) throw new V.ErroreFs("serve un nome: tmux new -s NOME");
      s[nome] = { creata: true, comando: null };
      return `[sessione ${nome} creata]`;
    }
    if (che === "ls" || che === "list-sessions") {
      const nomi = Object.keys(s);
      if (!nomi.length) throw new V.ErroreFs("no server running");
      return nomi.map((n) => `${n}: 1 windows${s[n].comando ? ` (${s[n].comando})` : ""}`).join("\n");
    }
    if (che === "attach" || che === "a" || che === "attach-session") {
      if (!nome || !s[nome]) throw new V.ErroreFs(`sessione ${nome ?? ""} non trovata`);
      return `[ripresa la sessione ${nome}]${s[nome].comando ? `\n${s[nome].comando} sta ancora girando` : ""}`;
    }
    if (che === "send-keys") {
      const testo = resto.filter((a) => !a.startsWith("-") && a !== nome).join(" ");
      if (!nome || !s[nome]) throw new V.ErroreFs(`sessione ${nome ?? ""} non trovata`);
      s[nome].comando = testo;
      return "";
    }
    if (che === "kill-session") {
      if (!nome || !s[nome]) throw new V.ErroreFs(`sessione ${nome ?? ""} non trovata`);
      delete s[nome];
      return "";
    }
    throw new V.ErroreFs("usa new, ls, attach, send-keys o kill-session");
  },
};

function opzioni(args) {
  const flag = new Set();
  const resto = [];
  for (const a of args) {
    if (a.startsWith("-") && a.length > 1) for (const c of a.slice(1)) flag.add(c);
    else resto.push(a);
  }
  return { flag, resto };
}

function copiaAlbero(origine, destino, dentro, fuori, soloDiversi = false) {
  const base = V.normalizza(origine, dentro);
  const copiati = [];
  for (const p of V.sottoalbero(origine, base)) {
    if (V.eDir(origine, p)) continue;
    const relativo = p.slice(base.length).replace(/^\//, "");
    const arrivo = `${fuori}/${V.foglia(base)}${relativo ? "/" + relativo : ""}`;
    V.creaDir(destino, V.genitore(V.normalizza(destino, arrivo)), true);
    if (soloDiversi && V.esiste(destino, arrivo) && V.leggi(destino, arrivo) === V.leggi(origine, p)) continue;
    V.scrivi(destino, arrivo, V.leggi(origine, p));
    copiati.push(relativo || V.foglia(base));
  }
  return copiati;
}

function copiaSeDiverso(origine, destino, dentro, fuori) {
  const testo = V.leggi(origine, dentro);
  if (V.esiste(destino, fuori) && V.leggi(destino, fuori) === testo) return [];
  V.scrivi(destino, fuori, testo);
  return [V.foglia(V.normalizza(origine, dentro))];
}
