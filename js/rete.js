// Rete locale simulata: interfaccia, rotta, DNS e porte. Nessun pacchetto esce
// dal browser; gli esercizi leggono uno stato coerente invece di una finta rete.

import { ErroreFs } from "./vfs.js";

export function statoRete(sh, scenario = {}) {
  sh.rete = {
    interfaccia: "enp0s3", indirizzo: "192.168.1.42/24", gateway: "192.168.1.1",
    dnsServer: "1.1.1.1", dns: { "cluster.univ.it": "10.20.0.15", "api.meteo.it": "203.0.113.8" },
    porte: [{ proto: "tcp", porta: 22, processo: "sshd" }, { proto: "tcp", porta: 8000, processo: "acquisizione" }],
    link: "1000Mb/s", ...(scenario || {}),
  };
  return sh;
}
const rete = (sh) => sh.rete;
const risolvi = (sh, nome) => rete(sh).dns[nome] ?? (/^\d+\.\d+\.\d+\.\d+$/.test(nome) ? nome : null);
export const RETE = {
  ip(sh, args) {
    const r = rete(sh);
    if (args[0] === "route") return `default via ${r.gateway} dev ${r.interfaccia}\n${r.indirizzo.replace(/\/\d+$/, ".0/24")} dev ${r.interfaccia} proto kernel`;
    if (args[0] === "addr" || args[0] === "a") return `2: ${r.interfaccia}: <BROADCAST,MULTICAST,UP,LOWER_UP>\n    inet ${r.indirizzo} brd 192.168.1.255 scope global ${r.interfaccia}`;
    throw new ErroreFs("ip: usa addr o route");
  },
  ifconfig(sh) { const r = rete(sh); return `${r.interfaccia}: flags=4163<UP,BROADCAST,RUNNING>\n        inet ${r.indirizzo.split("/")[0]}  netmask 255.255.255.0`; },
  ping(sh, args) { const nome = args.find((a) => !a.startsWith("-")); const ip = nome && risolvi(sh, nome); if (!ip) throw new ErroreFs(`${nome}: nome o servizio sconosciuto`); return `PING ${nome} (${ip}) 56(84) bytes of data.\n64 bytes from ${ip}: icmp_seq=1 ttl=58 time=12.4 ms\n--- ${nome} ping statistics ---\n1 packets transmitted, 1 received, 0% packet loss`; },
  ss(sh) { const p = rete(sh).porte; return ["Netid State  Local Address:Port  Process", ...p.map((x) => `${x.proto}   LISTEN 0.0.0.0:${x.porta}       users:((\"${x.processo}\"))`)].join("\n"); },
  netstat(sh, args) { return RETE.ss(sh, args); },
  dig(sh, args) { const nome = args.find((a) => !a.startsWith("+")); const ip = nome && risolvi(sh, nome); if (!ip) return `;; ->>HEADER<<- status: NXDOMAIN\n;; QUESTION SECTION:\n;${nome}. IN A`; return `;; SERVER: ${rete(sh).dnsServer}\n;; ANSWER SECTION:\n${nome}. 300 IN A ${ip}`; },
  nslookup(sh, args) { const nome = args[0]; const ip = nome && risolvi(sh, nome); if (!ip) throw new ErroreFs(`** server can't find ${nome}: NXDOMAIN`); return `Server: ${rete(sh).dnsServer}\nName: ${nome}\nAddress: ${ip}`; },
  resolvectl(sh, args) { if (args[0] !== "status") throw new ErroreFs("resolvectl: usa status"); const r = rete(sh); return `Link 2 (${r.interfaccia})\n    Current DNS Server: ${r.dnsServer}\n    DNS Domain: ~.`; },
  nmcli(sh, args) { if (args.join(" ") !== "device status") throw new ErroreFs("nmcli: usa device status"); const r = rete(sh); return `DEVICE  TYPE      STATE      CONNECTION\n${r.interfaccia}  ethernet  connected  rete-laboratorio`; },
  ethtool(sh, args) { const i = args[0] ?? rete(sh).interfaccia; return `Settings for ${i}:\n    Speed: ${rete(sh).link}\n    Link detected: yes`; },
};
