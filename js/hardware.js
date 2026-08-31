// Hardware e kernel: dispositivi, moduli, /proc e /sys, parametri.
//
// Due cose sono modellate sul serio, perche' sono quelle che si toccano:
//
//   - un dispositivo puo' esserci SENZA driver. E' il caso della scheda di
//     acquisizione o dell'SDR che "non viene visto": compare in lspci o lsusb,
//     ma nessun modulo lo gestisce e in /dev non c'e' niente. `modprobe` carica
//     il modulo, il driver si lega, e il file di dispositivo compare.
//
//   - /proc e /sys sono FILE. Non e' una metafora: si leggono con cat e alcuni
//     si scrivono con una redirezione, ed e' li' che si capisce cosa vuol dire
//     "in Unix tutto e' un file". sysctl e' un'interfaccia piu' comoda sopra
//     /proc/sys, e i due mostrano sempre lo stesso valore.
//
// Cosa NON c'e': interrupt, DMA, firmware, tempi di inizializzazione.

import * as V from "./vfs.js";

const PROC_SYS = "/proc/sys";

export function statoHardware(sh, scenario = {}) {
  sh.hardware = {
    pci: scenario.pci ?? [
      { slot: "00:02.0", classe: "VGA compatible controller", nome: "GPU integrata", modulo: "i915" },
      { slot: "00:14.0", classe: "USB controller", nome: "Controller USB 3.0", modulo: "xhci_hcd" },
      { slot: "01:00.0", classe: "Ethernet controller", nome: "Scheda di rete Gigabit", modulo: "e1000e" },
    ],
    usb: scenario.usb ?? [
      { bus: "001", dispositivo: "004", nome: "RTL2838 DVB-T (ricevitore SDR)", modulo: "dvb_usb_rtl28xxu", dev: "/dev/swradio0" },
    ],
    moduli: scenario.moduli ?? {
      i915: { dimensione: 3211264, usato: 1 },
      xhci_hcd: { dimensione: 327680, usato: 0 },
      e1000e: { dimensione: 286720, usato: 0 },
      nvme: { dimensione: 61440, usato: 2 },
    },
    parametri: {
      "vm.swappiness": "60",
      "net.ipv4.ip_forward": "0",
      "kernel.hostname": "banco",
      "fs.file-max": "9223372036854775807",
      ...(scenario.parametri || {}),
    },
    kernel: scenario.kernel ?? "6.8.0-45-generic",
    log: scenario.log ?? [
      "[    0.000000] Linux version 6.8.0-45-generic",
      "[    1.204511] e1000e 0000:01:00.0 enp0s3: link is up",
      "[    3.882014] usb 1-4: new high-speed USB device number 4",
      "[    3.914227] usb 1-4: Product: RTL2838UHIDIR",
    ],
    ...(scenario.extra || {}),
  };
  scriviProc(sh);
  return sh;
}

const h = (sh) => sh.hardware;
const caricato = (sh, m) => Object.hasOwn(h(sh).moduli, m);

/** I file di /proc e /sys esistono davvero nel filesystem virtuale: e' il punto
 *  dell'intera faccenda, e senza non si potrebbe fare `cat /proc/cpuinfo`. */
function scriviProc(sh) {
  const prima = sh.fs.utente;
  sh.fs.utente = "root";
  const scrivi = (p, testo) => {
    V.creaDir(sh.fs, V.genitore(p), true);
    V.scrivi(sh.fs, p, testo);
  };
  V.creaDir(sh.fs, "/etc", true);
  V.creaDir(sh.fs, "/dev", true);
  scrivi("/proc/version", `Linux version ${h(sh).kernel}\n`);
  scrivi("/proc/cpuinfo", "processor\t: 0\nmodel name\t: CPU del banco, 4 core\ncpu MHz\t\t: 2400.000\n");
  scrivi("/proc/meminfo", "MemTotal:       16302040 kB\nMemAvailable:    9128412 kB\nSwapTotal:       2097148 kB\n");
  scrivi("/proc/uptime", "184523.11 730914.55\n");
  scrivi("/proc/modules", Object.entries(h(sh).moduli).map(([m, d]) => `${m} ${d.dimensione} ${d.usato}`).join("\n") + "\n");
  for (const [chiave, valore] of Object.entries(h(sh).parametri))
    scrivi(`${PROC_SYS}/${chiave.replaceAll(".", "/")}`, `${valore}\n`);
  // I dispositivi con un driver caricato hanno il loro file in /dev; senza
  // driver, in /dev non c'e' niente — ed e' esattamente il sintomo.
  for (const u of h(sh).usb)
    if (u.dev && caricato(sh, u.modulo)) scrivi(u.dev, "dispositivo a caratteri\n");
  sh.fs.utente = prima;
}

/** Il valore letto da /proc/sys vince su quello in memoria: se un esercizio lo
 *  ha cambiato con una redirezione, sysctl deve vedere la stessa cosa. */
function leggiParametro(sh, chiave) {
  const file = `${PROC_SYS}/${chiave.replaceAll(".", "/")}`;
  if (V.esiste(sh.fs, file)) return V.leggi(sh.fs, file).trim();
  return h(sh).parametri[chiave];
}

function impostaParametro(sh, chiave, valore) {
  h(sh).parametri[chiave] = valore;
  const prima = sh.fs.utente;
  sh.fs.utente = "root";
  const file = `${PROC_SYS}/${chiave.replaceAll(".", "/")}`;
  V.creaDir(sh.fs, V.genitore(file), true);
  V.scrivi(sh.fs, file, `${valore}\n`);
  sh.fs.utente = prima;
}

export const HARDWARE = {
  lspci(sh, args) {
    const conModulo = args.includes("-k");
    return h(sh).pci
      .map((d) => {
        const riga = `${d.slot} ${d.classe}: ${d.nome}`;
        if (!conModulo) return riga;
        return `${riga}\n\tKernel driver in use: ${caricato(sh, d.modulo) ? d.modulo : "none"}`;
      })
      .join("\n");
  },

  lsusb(sh, args) {
    const conModulo = args.includes("-t");
    return h(sh).usb
      .map((d) => {
        const riga = `Bus ${d.bus} Device ${d.dispositivo}: ${d.nome}`;
        if (!conModulo) return riga;
        return `${riga}\n    Driver=${caricato(sh, d.modulo) ? d.modulo : "(nessuno)"}`;
      })
      .join("\n");
  },

  lshw(sh) {
    return [
      "*-cpu",
      "     product: CPU del banco, 4 core",
      "*-memory",
      "     size: 16GiB",
      "*-network",
      "     logical name: enp0s3",
      `     configuration: driver=e1000e link=${caricato(sh, "e1000e") ? "yes" : "no"}`,
    ].join("\n");
  },

  dmidecode(sh) {
    return "System Information\n    Manufacturer: Laboratorio\n    Product Name: Banco prova\nMemory Device\n    Size: 16 GB";
  },

  lsmod(sh) {
    return [
      "Module                  Size  Used by",
      ...Object.entries(h(sh).moduli).map(([m, d]) => `${m.padEnd(22)} ${String(d.dimensione).padStart(7)}  ${d.usato}`),
    ].join("\n");
  },

  modprobe(sh, args) {
    const rimuovi = args.includes("-r") || args.includes("--remove");
    const nome = args.find((a) => !a.startsWith("-"));
    if (!nome) throw new V.ErroreFs("manca il nome del modulo");

    if (rimuovi) {
      const m = h(sh).moduli[nome];
      if (!m) throw new V.ErroreFs(`${nome}: modulo non caricato`);
      // Un modulo in uso non si toglie: il contatore "Used by" e' li' per questo.
      if (m.usato > 0) throw new V.ErroreFs(`${nome}: modulo in uso (${m.usato}), non posso rimuoverlo`);
      delete h(sh).moduli[nome];
      const usb = h(sh).usb.find((u) => u.modulo === nome);
      if (usb?.dev && V.esiste(sh.fs, usb.dev)) V.rimuovi(sh.fs, usb.dev);
      h(sh).log.push(`[ 9999.0] ${nome}: modulo rimosso`);
      scriviProc(sh);
      return "";
    }

    const conosciuti = new Set([
      ...h(sh).pci.map((d) => d.modulo),
      ...h(sh).usb.map((d) => d.modulo),
      "nvme", "loop", "vboxdrv",
    ]);
    if (!conosciuti.has(nome)) throw new V.ErroreFs(`modulo ${nome} non trovato in /lib/modules/${h(sh).kernel}`);
    if (caricato(sh, nome)) return "";
    h(sh).moduli[nome] = { dimensione: 45056, usato: 0 };
    const usb = h(sh).usb.find((u) => u.modulo === nome);
    if (usb) h(sh).log.push(`[ 9999.1] ${nome}: driver legato a ${usb.nome}, creato ${usb.dev}`);
    scriviProc(sh);
    return "";
  },

  sysctl(sh, args) {
    if (args.includes("-a"))
      return Object.keys(h(sh).parametri).sort().map((k) => `${k} = ${leggiParametro(sh, k)}`).join("\n");

    // sysctl -p rilegge il file: e' il modo di applicare la configurazione
    // permanente senza riavviare, e di scoprire subito se hai scritto male.
    if (args.includes("-p")) {
      const file = args.find((a) => !a.startsWith("-")) ?? "/etc/sysctl.conf";
      if (!V.esiste(sh.fs, file)) throw new V.ErroreFs(`${file}: file non esistente`);
      const applicati = [];
      for (const riga of V.leggi(sh.fs, file).split("\n")) {
        const pulita = riga.trim();
        if (!pulita || pulita.startsWith("#")) continue;
        const [k, v] = pulita.split("=").map((x) => x.trim());
        if (!k || v === undefined) throw new V.ErroreFs(`${file}: riga non valida: ${pulita}`);
        impostaParametro(sh, k, v);
        applicati.push(`${k} = ${v}`);
      }
      return applicati.join("\n");
    }

    const scrittura = args.includes("-w");
    const voce = args.filter((a) => !a.startsWith("-"))[0];
    if (!voce) throw new V.ErroreFs("manca il parametro");
    const [chiave, valore] = voce.split("=");
    if (scrittura || valore !== undefined) {
      if (valore === undefined) throw new V.ErroreFs("con -w serve nome=valore");
      if (leggiParametro(sh, chiave) === undefined) throw new V.ErroreFs(`parametro sconosciuto: ${chiave}`);
      impostaParametro(sh, chiave, valore);
      return `${chiave} = ${valore}`;
    }
    const letto = leggiParametro(sh, chiave);
    if (letto === undefined) throw new V.ErroreFs(`parametro sconosciuto: ${chiave}`);
    return `${chiave} = ${letto}`;
  },

  dmesg(sh, args) {
    const righe = h(sh).log;
    const n = args.includes("-n") ? Number(args[args.indexOf("-n") + 1]) : null;
    return (n ? righe.slice(-n) : righe).join("\n");
  },

  uname(sh, args) {
    if (args.includes("-r")) return h(sh).kernel;
    if (args.includes("-a")) return `Linux banco ${h(sh).kernel} x86_64 GNU/Linux`;
    return "Linux";
  },
};
