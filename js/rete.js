// Rete simulata: interfacce, rotte, DNS, porte in ascolto e host remoti.
//
// La prima versione descriveva una macchina che funzionava sempre: ogni comando
// stampava la stessa riga, e un esercizio poteva solo chiedere di digitarlo. Ma
// la rete si impara quando **non** funziona, e le cinque cause vanno separate:
// interfaccia giu', indirizzo mancante, rotta assente, nome non risolto, porta
// chiusa. Qui lo stato e' esplicito e i comandi lo leggono e lo cambiano
// davvero, cosi' `ping` fallisce per il motivo giusto e il messaggio lo dice.
//
// Cosa NON c'e', per scelta: pacchetti, latenza vera, TCP, NAT. Un modello piu'
// fine non aggiungerebbe una domanda a cui rispondere.

import { ErroreFs, creaDir, esiste, leggi, scrivi } from "./vfs.js";

const RESOLV = "/etc/resolv.conf";

export function statoRete(sh, scenario = {}) {
  sh.rete = {
    interfacce: {
      lo: { stato: "up", indirizzo: "127.0.0.1/8", link: null },
      enp0s3: { stato: "up", indirizzo: "192.168.1.42/24", link: "1000Mb/s" },
    },
    gateway: "192.168.1.1",
    dnsServer: "1.1.1.1",
    // Il DNS che il server sa risolvere. Quello che la macchina risolve davvero
    // dipende anche da /etc/hosts e dal fatto che il DNS sia raggiungibile.
    dns: { "cluster.univ.it": "10.20.0.15", "api.meteo.it": "203.0.113.8" },
    dnsRaggiungibile: true,
    // Chi c'e' dall'altra parte: indirizzo -> porte aperte. Un host che non e'
    // qui non risponde, ed e' la differenza fra "non esiste" e "non risponde".
    esterni: {
      "10.20.0.15": { nome: "cluster", porte: [22] },
      "203.0.113.8": { nome: "api", porte: [80, 443] },
      "192.168.1.1": { nome: "gateway", porte: [80] },
    },
    porte: [
      { proto: "tcp", porta: 22, processo: "sshd", bind: "0.0.0.0" },
      // Il caso classico: il servizio ascolta solo su localhost, e da fuori
      // sembra che il firewall stia bloccando.
      { proto: "tcp", porta: 8000, processo: "acquisizione", bind: "127.0.0.1" },
    ],
    ...(scenario || {}),
  };
  // resolv.conf deve esistere come file vero: gli esercizi lo leggono con cat e
  // lo cambiano con una redirezione, come si fa sulla macchina.
  if (!esiste(sh.fs, RESOLV)) {
    creaDir(sh.fs, "/etc", true);
    scrivi(sh.fs, RESOLV, `nameserver ${sh.rete.dnsServer}\n`);
  }
  if (!esiste(sh.fs, "/etc/hosts")) {
    creaDir(sh.fs, "/etc", true);
    scrivi(sh.fs, "/etc/hosts", "127.0.0.1 localhost\n");
  }
  return sh;
}

const rete = (sh) => sh.rete;
const eIp = (s) => /^\d+\.\d+\.\d+\.\d+$/.test(s);
const solaRete = (cidr) => cidr.split("/")[0].split(".").slice(0, 3).join(".");

/** L'interfaccia con cui si esce: la prima su' che non sia il loopback. */
function uscita(sh) {
  return Object.entries(rete(sh).interfacce).find(
    ([nome, i]) => nome !== "lo" && i.stato === "up" && i.indirizzo
  );
}

/** Il nameserver in uso lo dice /etc/resolv.conf, non la memoria del simulatore:
 *  e' un file, e gli esercizi devono poterlo modificare come si fa davvero. */
function nameserver(sh) {
  if (!esiste(sh.fs, RESOLV)) return null;
  const m = leggi(sh.fs, RESOLV).match(/^\s*nameserver\s+(\S+)/m);
  return m ? m[1] : null;
}

/** hosts vince sempre sul DNS: e' la ragione per cui una riga dimenticata in
 *  /etc/hosts manda in confusione per ore. */
function daHosts(sh, nome) {
  if (!esiste(sh.fs, "/etc/hosts")) return null;
  for (const riga of leggi(sh.fs, "/etc/hosts").split("\n")) {
    const [ip, ...nomi] = riga.replace(/#.*/, "").trim().split(/\s+/);
    if (ip && nomi.includes(nome)) return ip;
  }
  return null;
}

/** Quello che risponde il DNS, e basta: e' cosa fa dig, che NON guarda
 *  /etc/hosts. La differenza sembra un dettaglio, ed e' invece la ragione per
 *  cui dig puo' dire un indirizzo e ping usarne un altro. */
function risolviDns(sh, nome) {
  if (eIp(nome)) return { ip: nome };
  const ns = nameserver(sh);
  if (!ns) return { errore: "nessun nameserver configurato" };
  if (ns !== rete(sh).dnsServer || !rete(sh).dnsRaggiungibile)
    return { errore: `nessuna risposta dal nameserver ${ns}` };
  const ip = rete(sh).dns[nome];
  return ip ? { ip, via: "dns" } : { errore: "NXDOMAIN" };
}

/** Quello che usa il sistema quando si collega: prima /etc/hosts, poi il DNS.
 *  E' il percorso di ping, nc e di qualunque programma. */
function risolvi(sh, nome) {
  if (eIp(nome)) return { ip: nome };
  const locale = daHosts(sh, nome);
  if (locale) return { ip: locale, via: "hosts" };
  return risolviDns(sh, nome);
}

/** Perche' un indirizzo non e' raggiungibile. null = ci si arriva. */
function perchePerso(sh, ip) {
  const r = rete(sh);
  if (ip.startsWith("127.")) return null;
  const iface = uscita(sh);
  if (!iface) return "rete non raggiungibile";
  const mia = solaRete(iface[1].indirizzo);
  if (solaRete(ip) !== mia && !r.gateway) return "rete non raggiungibile";
  return r.esterni[ip] ? null : "100% packet loss";
}

export const RETE = {
  ip(sh, args) {
    const r = rete(sh);
    const [che, ...resto] = args;

    if (che === "addr" || che === "a" || che === "address") {
      if (resto[0] === "add" || resto[0] === "del") {
        const [azione, cidr, , nome] = resto;
        const i = r.interfacce[nome];
        if (!i) throw new ErroreFs(`interfaccia ${nome} sconosciuta`);
        i.indirizzo = azione === "add" ? cidr : null;
        return "";
      }
      return Object.entries(r.interfacce)
        .map(([nome, i], n) =>
          `${n + 1}: ${nome}: <BROADCAST,MULTICAST${i.stato === "up" ? ",UP,LOWER_UP" : ""}> state ${i.stato.toUpperCase()}` +
          (i.indirizzo ? `\n    inet ${i.indirizzo} scope global ${nome}` : "")
        )
        .join("\n");
    }

    if (che === "link") {
      if (resto[0] === "set") {
        const nome = resto[1];
        const stato = resto[2];
        const i = r.interfacce[nome];
        if (!i) throw new ErroreFs(`interfaccia ${nome} sconosciuta`);
        if (stato !== "up" && stato !== "down") throw new ErroreFs("usa up oppure down");
        i.stato = stato;
        return "";
      }
      return Object.entries(r.interfacce)
        .map(([nome, i], n) => `${n + 1}: ${nome}: state ${i.stato.toUpperCase()}`)
        .join("\n");
    }

    if (che === "route" || che === "r") {
      if (resto[0] === "add" || resto[0] === "del") {
        if (resto[1] !== "default") throw new ErroreFs("qui si gestisce solo la rotta default");
        r.gateway = resto[0] === "add" ? resto[3] : null;
        return "";
      }
      const iface = uscita(sh);
      const righe = [];
      if (r.gateway) righe.push(`default via ${r.gateway} dev ${iface ? iface[0] : "enp0s3"}`);
      if (iface) righe.push(`${solaRete(iface[1].indirizzo)}.0/24 dev ${iface[0]} proto kernel scope link`);
      return righe.join("\n") || "";
    }

    throw new ErroreFs("usa addr, link o route");
  },

  ifconfig(sh) {
    return Object.entries(rete(sh).interfacce)
      .map(([nome, i]) =>
        `${nome}: flags=<${i.stato === "up" ? "UP,RUNNING" : "DOWN"}>` +
        (i.indirizzo ? `\n        inet ${i.indirizzo.split("/")[0]}  netmask 255.255.255.0` : "")
      )
      .join("\n");
  },

  ping(sh, args) {
    const nome = args.find((a) => !a.startsWith("-"));
    if (!nome) throw new ErroreFs("manca la destinazione");
    const ris = risolvi(sh, nome);
    if (ris.errore) throw new ErroreFs(`${nome}: nome o servizio non noto`);
    const perso = perchePerso(sh, ris.ip);
    const testa = `PING ${nome} (${ris.ip}) 56(84) bytes of data.`;
    if (perso === "rete non raggiungibile") throw new ErroreFs(`connect: rete non raggiungibile`);
    if (perso) return `${testa}\n--- ${nome} ping statistics ---\n3 packets transmitted, 0 received, 100% packet loss`;
    return `${testa}\n64 bytes from ${ris.ip}: icmp_seq=1 ttl=58 time=12.4 ms\n--- ${nome} ping statistics ---\n3 packets transmitted, 3 received, 0% packet loss`;
  },

  traceroute(sh, args) {
    const nome = args.find((a) => !a.startsWith("-"));
    const ris = risolvi(sh, nome);
    if (ris.errore) throw new ErroreFs(`${nome}: nome o servizio non noto`);
    const r = rete(sh);
    const salti = [];
    if (r.gateway) salti.push(`1  ${r.gateway}  0.4 ms`);
    if (!perchePerso(sh, ris.ip)) salti.push(`2  ${ris.ip}  12.4 ms`);
    else salti.push("2  * * *", "3  * * *");
    return `traceroute to ${nome} (${ris.ip}), 30 hops max\n${salti.join("\n")}`;
  },

  // Le porte in ascolto, con l'indirizzo su cui ascoltano: 127.0.0.1 vuol dire
  // che da un'altra macchina quel servizio non esiste.
  ss(sh, args) {
    const p = rete(sh).porte;
    const cerca = args.includes("sport") ? args[args.indexOf("sport") + 2] : null;
    const righe = p
      .filter((x) => !cerca || String(x.porta) === String(cerca).replace(":", ""))
      .map((x) => `${x.proto}    LISTEN 0      128    ${x.bind}:${x.porta}    users:(("${x.processo}"))`);
    return ["Netid State  Recv-Q Send-Q Local Address:Port  Process", ...righe].join("\n");
  },
  netstat(sh, args) {
    return RETE.ss(sh, args);
  },

  // nc -z prova una porta: e' il modo di distinguere "il server e' vivo" da
  // "il servizio ascolta" da "la porta e' raggiungibile da qui".
  nc(sh, args) {
    const resto = args.filter((a) => !a.startsWith("-"));
    const [nome, porta] = resto;
    if (!porta) throw new ErroreFs("servono host e porta");
    const ris = risolvi(sh, nome);
    if (ris.errore) throw new ErroreFs(`${nome}: nome o servizio non noto`);
    const locale = ris.ip.startsWith("127.");
    const aperte = locale
      ? rete(sh).porte.map((x) => x.porta)
      : (rete(sh).esterni[ris.ip]?.porte ?? []);
    if (perchePerso(sh, ris.ip)) throw new ErroreFs(`connect to ${nome} port ${porta} failed: host irraggiungibile`);
    if (!aperte.includes(Number(porta)))
      throw new ErroreFs(`connect to ${nome} port ${porta} failed: connessione rifiutata`);
    return `Connection to ${nome} ${porta} port [tcp] succeeded!`;
  },

  dig(sh, args) {
    const nome = args.find((a) => !a.startsWith("+") && !a.startsWith("@"));
    const ris = risolviDns(sh, nome);
    const ns = nameserver(sh) ?? "(nessuno)";
    if (ris.errore)
      return `;; SERVER: ${ns}\n;; ->>HEADER<<- status: ${ris.errore === "NXDOMAIN" ? "NXDOMAIN" : "SERVFAIL"}\n;; ${ris.errore}\n;; QUESTION SECTION:\n;${nome}. IN A`;
    return `;; SERVER: ${ns}\n;; ANSWER SECTION:\n${nome}. 300 IN A ${ris.ip}`;
  },

  nslookup(sh, args) {
    const nome = args[0];
    const ris = risolviDns(sh, nome);
    if (ris.errore) throw new ErroreFs(`** server can't find ${nome}: ${ris.errore}`);
    return `Server: ${nameserver(sh)}\nName: ${nome}\nAddress: ${ris.ip}`;
  },

  resolvectl(sh, args) {
    if (args[0] && args[0] !== "status") throw new ErroreFs("usa status");
    const iface = uscita(sh);
    return `Global\n    Current DNS Server: ${nameserver(sh) ?? "nessuno"}\nLink 2 (${iface ? iface[0] : "enp0s3"})\n    DNS Servers: ${nameserver(sh) ?? "nessuno"}`;
  },

  nmcli(sh, args) {
    const r = rete(sh);
    if (args.join(" ").startsWith("device status") || !args.length)
      return ["DEVICE  TYPE      STATE         CONNECTION",
        ...Object.entries(r.interfacce)
          .filter(([nome]) => nome !== "lo")
          .map(([nome, i]) => `${nome}  ethernet  ${i.stato === "up" && i.indirizzo ? "connected    rete-laboratorio" : "disconnected  --"}`)]
        .join("\n");
    throw new ErroreFs("qui e' supportato solo device status");
  },

  ethtool(sh, args) {
    const nome = args[0] ?? "enp0s3";
    const i = rete(sh).interfacce[nome];
    if (!i) throw new ErroreFs(`interfaccia ${nome} sconosciuta`);
    // Il link fisico e' una cosa diversa dallo stato amministrativo: un cavo
    // staccato da "Link detected: no" anche con l'interfaccia up.
    return `Settings for ${nome}:\n    Speed: ${i.link ?? "sconosciuta"}\n    Link detected: ${i.link ? "yes" : "no"}`;
  },
};
