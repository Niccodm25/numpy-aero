// Seconda macchina finta per il ramo Linux: accesso SSH e trasferimenti senza
// alcuna connessione reale. Il filesystem remoto resta separato da quello locale.
import * as V from "./vfs.js";

export function statoRemoto(sh, scenario = {}) {
  const fs = V.crea(scenario.files || { "/home/anna/risultati/quota.csv": "t,quota\n0,1000\n" });
  fs.utente = scenario.utente ?? "anna";
  fs.cwd = `/home/${fs.utente}`;
  sh.remoto = { nome: scenario.nome ?? "cluster", utente: scenario.utente ?? "anna", fs };
  return sh;
}
function separa(sh, spec) {
  const m = spec.match(/^(?:([^@]+)@)?([^:]+):(.*)$/);
  if (!m || m[2] !== sh.remoto.nome) throw new V.ErroreFs("indirizzo remoto atteso: utente@cluster:percorso");
  return { remoto: true, percorso: m[3] || "." };
}
export const REMOTO = {
  ssh(sh, args) {
    const host = args.find((a) => a.includes("@") || a === sh.remoto.nome);
    if (!host) throw new V.ErroreFs("ssh: manca utente@cluster");
    const nome = host.split("@").at(-1);
    if (nome !== sh.remoto.nome) throw new V.ErroreFs(`${nome}: host non raggiungibile`);
    const comando = args.slice(args.indexOf(host) + 1).join(" ");
    if (comando === "pwd") return `/home/${sh.remoto.utente}`;
    if (comando === "ls") return V.elenca(sh.remoto.fs, ".").join("\n");
    return `Connesso a ${sh.remoto.nome} come ${sh.remoto.utente}`;
  },
  scp(sh, args) {
    if (args.length !== 2) throw new V.ErroreFs("scp: servono sorgente e destinazione");
    const [s, d] = args; const sr = s.includes(":"); const dr = d.includes(":");
    if (sr === dr) throw new V.ErroreFs("scp: una sola estremita' deve essere remota");
    if (sr) V.scrivi(sh.fs, d, V.leggi(sh.remoto.fs, separa(sh, s).percorso));
    else V.scrivi(sh.remoto.fs, separa(sh, d).percorso, V.leggi(sh.fs, s));
    return "";
  },
  rsync(sh, args) {
    const estremi = args.filter((a) => !a.startsWith("-"));
    if (estremi.length !== 2) throw new V.ErroreFs("rsync: servono sorgente e destinazione");
    return REMOTO.scp(sh, estremi);
  },
};
