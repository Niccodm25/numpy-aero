// Stato minimale ma coerente di unit systemd e log di sistema.
import { ErroreFs } from "./vfs.js";
export function statoServizi(sh, scenario = {}) {
  sh.servizi = { "acquisizione.service": { attivo: false, abilitato: false, log: ["boot: unit caricata"] }, "sshd.service": { attivo: true, abilitato: true, log: ["server: in ascolto sulla porta 22"] }, ...(scenario || {}) };
  return sh;
}
const unita = (sh, n) => { const u = sh.servizi?.[n]; if (!u) throw new ErroreFs(`unit non trovata: ${n}`); return u; };
export const SERVIZI = {
  systemctl(sh, args) {
    const [azione, nome] = args;
    if (azione === "list-units") return Object.entries(sh.servizi).map(([n,u]) => `${n} loaded ${u.attivo ? "active running" : "inactive dead"}`).join("\n");
    const u = unita(sh, nome);
    if (azione === "status") return `${nome} - simulato\n   Active: ${u.attivo ? "active (running)" : "inactive (dead)"}`;
    if (azione === "start" || azione === "restart") { u.attivo = true; u.log.push(`${azione}: servizio avviato`); return ""; }
    if (azione === "stop") { u.attivo = false; u.log.push("stop: servizio fermato"); return ""; }
    if (azione === "enable") { u.abilitato = true; return ""; }
    throw new ErroreFs("systemctl: usa status, start, stop, restart, enable o list-units");
  },
  journalctl(sh, args) { const i = args.indexOf("-u"); const nome = i >= 0 ? args[i+1] : null; if (!nome) throw new ErroreFs("journalctl: usa -u unita"); return unita(sh,nome).log.join("\n"); },
  dmesg() { return "[    0.0] Linux avviato\n[    1.2] enp0s3: link up\n[    2.0] systemd: avvio completato"; },
};
