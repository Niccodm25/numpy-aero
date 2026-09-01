// Dischi, filesystem, volumi: montare, formattare, far crescere, proteggere.
//
// Il pezzo che rende questo modello utile e' che **ogni dispositivo ha il suo
// contenuto**. Montare non e' accendere una spia: fa comparire quei file sotto
// il punto di mount, e nasconde quelli che c'erano prima. Smontare li rimette
// com'erano. Da qui vengono i due guasti veri dello storage:
//   - hai scritto in /dati mentre il disco NON era montato: i file sono finiti
//     sul disco di sistema, e dopo il mount sembrano spariti
//   - il disco e' pieno perche' i dati stanno dove non credi
//
// Cosa NON c'e', per scelta: partizionamento interattivo (fdisk e parted sono
// dialoghi, non comandi), settori, inode, tempi di sincronizzazione.

import * as V from "./vfs.js";

const FSTAB = "/etc/fstab";

export function statoDischi(sh, scenario = {}) {
  sh.dischi = {
    dispositivi: scenario.dispositivi ?? {
      "/dev/nvme0n1p1": { size: 200, fs: "ext4", usatoGB: 40, etichetta: "sistema" },
      // Il disco nuovo arriva senza filesystem: e' lo stato in cui te lo trovi.
      "/dev/sdb1": { size: 1000, fs: null, usatoGB: 0, etichetta: "dati" },
    },
    montati: scenario.montati ?? { "/dev/nvme0n1p1": "/" },
    contenuti: scenario.contenuti ?? { "/dev/sdb1": {} },
    nascosti: {},
    vg: scenario.vg ?? {},
    raid: scenario.raid ?? {},
    luks: scenario.luks ?? {},
    ...(scenario.extra || {}),
  };
  V.creaDir(sh.fs, "/etc", true);
  if (!V.esiste(sh.fs, FSTAB))
    V.scrivi(sh.fs, FSTAB, "/dev/nvme0n1p1  /  ext4  defaults  0 1\n");
  return sh;
}

const d = (sh) => sh.dischi;
// Il nome puo' mancare del tutto — `resize2fs` da solo, `cryptsetup luksFormat`
// senza dispositivo: si risponde come il comando vero, non con un crash.
const nomeDispositivo = (x) => {
  if (!x) throw new V.ErroreFs("manca il dispositivo");
  return x.startsWith("/dev/") ? x : `/dev/${x}`;
};

function dispositivo(sh, nome) {
  const dev = d(sh).dispositivi[nomeDispositivo(nome)];
  if (!dev) throw new V.ErroreFs(`${nome}: dispositivo non trovato`);
  return dev;
}

/** Tutti i file sotto un punto, come mappa relativa: e' il "contenuto" di un disco. */
function raccogli(sh, punto) {
  const base = V.normalizza(sh.fs, punto);
  const out = {};
  for (const p of V.sottoalbero(sh.fs, base)) {
    if (p === base || V.eDir(sh.fs, p)) continue;
    out[p.slice(base.length + 1)] = V.leggi(sh.fs, p);
  }
  return out;
}

function svuota(sh, punto) {
  const base = V.normalizza(sh.fs, punto);
  for (const p of V.sottoalbero(sh.fs, base)) if (p !== base) sh.fs.nodi.delete(p);
}

function versa(sh, punto, contenuto) {
  for (const [rel, testo] of Object.entries(contenuto || {})) {
    const percorso = `${V.normalizza(sh.fs, punto)}/${rel}`;
    V.creaDir(sh.fs, V.genitore(percorso), true);
    V.scrivi(sh.fs, percorso, testo);
  }
}

const puntoDi = (sh, dev) => d(sh).montati[nomeDispositivo(dev)];
const devDi = (sh, punto) =>
  Object.keys(d(sh).montati).find((x) => d(sh).montati[x] === V.normalizza(sh.fs, punto));

export const DISCHI = {
  lsblk(sh, args) {
    const conFs = args.includes("-f");
    const righe = Object.entries(d(sh).dispositivi).map(([nome, dev]) => {
      const punto = puntoDi(sh, nome) ?? "";
      return conFs
        ? `${nome.padEnd(20)} ${(dev.fs ?? "").padEnd(8)} ${(dev.etichetta ?? "").padEnd(10)} ${punto}`
        : `${nome.padEnd(20)} ${String(dev.size + "G").padEnd(6)} part ${punto}`;
    });
    return [conFs ? "NAME                 FSTYPE   LABEL      MOUNTPOINT" : "NAME                 SIZE   TYPE MOUNTPOINT", ...righe].join("\n");
  },

  mount(sh, args) {
    if (!args.length)
      return Object.entries(d(sh).montati)
        .map(([dev, punto]) => `${dev} on ${punto} type ${dispositivo(sh, dev).fs} (rw)`)
        .join("\n");

    // mount -a monta tutto quello che sta in /etc/fstab: e' quello che fa la
    // macchina all'avvio, ed e' il modo di provare fstab senza riavviare.
    if (args.includes("-a")) {
      if (!V.esiste(sh.fs, FSTAB)) throw new V.ErroreFs("/etc/fstab non esiste");
      let montati = 0;
      for (const riga of V.leggi(sh.fs, FSTAB).split("\n")) {
        const [dev, punto] = riga.trim().split(/\s+/);
        if (!dev || dev.startsWith("#") || puntoDi(sh, dev)) continue;
        DISCHI.mount(sh, [dev, punto]);
        montati++;
      }
      return montati ? `montati ${montati} filesystem da ${FSTAB}` : "";
    }

    const [nome, punto] = args.filter((a) => !a.startsWith("-"));
    if (!punto) throw new V.ErroreFs("servono dispositivo e punto di mount");
    const dev = dispositivo(sh, nome);
    // I controlli nell'ordine in cui li fa mount: prima dove, poi cosa.
    if (!V.esiste(sh.fs, punto))
      throw new V.ErroreFs(`${punto}: il punto di mount non esiste (crealo con mkdir)`);
    // Un volume LUKS chiuso, per il sistema, e' rumore: stesso messaggio di un
    // disco non formattato, ed e' la ragione per cui la prima volta sconcerta.
    if (!dev.fs || dev.fs === "crypto_LUKS")
      throw new V.ErroreFs(
        `${nome}: tipo di filesystem sconosciuto (${dev.fs === "crypto_LUKS" ? "il volume LUKS non e' aperto" : "il disco non e' formattato"})`
      );
    if (puntoDi(sh, nome)) throw new V.ErroreFs(`${nome}: gia' montato su ${puntoDi(sh, nome)}`);

    // Quello che c'era nella cartella non sparisce: viene coperto, e torna
    // quando smonti. E' la spiegazione dei file "spariti" dopo un mount.
    d(sh).nascosti[nomeDispositivo(nome)] = raccogli(sh, punto);
    svuota(sh, punto);
    versa(sh, punto, d(sh).contenuti[nomeDispositivo(nome)]);
    d(sh).montati[nomeDispositivo(nome)] = V.normalizza(sh.fs, punto);
    return "";
  },

  umount(sh, args) {
    const bersaglio = args.filter((a) => !a.startsWith("-"))[0];
    if (!bersaglio) throw new V.ErroreFs("manca il dispositivo o il punto di mount");
    const dev = d(sh).montati[nomeDispositivo(bersaglio)] ? nomeDispositivo(bersaglio) : devDi(sh, bersaglio);
    if (!dev) throw new V.ErroreFs(`${bersaglio}: non montato`);
    const punto = d(sh).montati[dev];
    // Non si smonta il filesystem in cui sei dentro: e' il "target is busy" che
    // sconcerta la prima volta, e si risolve con un cd fuori.
    if (sh.fs.cwd === punto || sh.fs.cwd.startsWith(punto + "/"))
      throw new V.ErroreFs(`${punto}: target is busy (sei dentro quella cartella)`);

    d(sh).contenuti[dev] = raccogli(sh, punto);
    svuota(sh, punto);
    versa(sh, punto, d(sh).nascosti[dev]);
    delete d(sh).nascosti[dev];
    delete d(sh).montati[dev];
    return "";
  },

  /** mkfs formatta: quello che c'era sul dispositivo non c'e' piu'. */
  "mkfs.ext4"(sh, args) {
    return formatta(sh, args, "ext4");
  },
  "mkfs.xfs"(sh, args) {
    return formatta(sh, args, "xfs");
  },
  mkfs(sh, args) {
    const i = args.indexOf("-t");
    const tipo = i >= 0 ? args[i + 1] : "ext4";
    return formatta(sh, args.filter((a, n) => n !== i && n !== i + 1), tipo);
  },

  df(sh, args) {
    const umano = args.includes("-h");
    const righe = Object.entries(d(sh).montati).map(([dev, punto]) => {
      const disco = dispositivo(sh, dev);
      const usato = disco.usatoGB;
      const pct = Math.round((usato / disco.size) * 100);
      return umano
        ? `${dev.padEnd(20)} ${(disco.size + "G").padEnd(6)} ${(usato + "G").padEnd(6)} ${(disco.size - usato + "G").padEnd(6)} ${String(pct + "%").padEnd(5)} ${punto}`
        : `${dev.padEnd(20)} ${String(disco.size * 1024 * 1024).padEnd(12)} ${String(usato * 1024 * 1024).padEnd(12)} ${punto}`;
    });
    return ["Filesystem           Size   Used   Avail  Use%  Mounted on", ...righe].join("\n");
  },

  // ---------- LVM: far crescere un volume senza spegnere niente ----------
  pvcreate(sh, args) {
    const nome = nomeDispositivo(args.filter((a) => !a.startsWith("-"))[0] ?? "");
    dispositivo(sh, nome);
    return `Physical volume "${nome}" successfully created.`;
  },

  vgcreate(sh, args) {
    const [gruppo, ...dev] = args.filter((a) => !a.startsWith("-"));
    if (!gruppo || !dev.length) throw new V.ErroreFs("servono il nome del gruppo e almeno un dispositivo");
    const libero = dev.reduce((t, x) => t + dispositivo(sh, x).size, 0);
    d(sh).vg[gruppo] = { libero, lv: {} };
    return `Volume group "${gruppo}" successfully created`;
  },

  lvcreate(sh, args) {
    const L = args.indexOf("-L");
    const n = args.indexOf("-n");
    const dimensione = L >= 0 ? parseInt(args[L + 1]) : null;
    const nome = n >= 0 ? args[n + 1] : null;
    const gruppo = args.filter((a) => !a.startsWith("-")).at(-1);
    const vg = d(sh).vg[gruppo];
    if (!vg) throw new V.ErroreFs(`gruppo ${gruppo} non trovato`);
    if (!dimensione || !nome) throw new V.ErroreFs("usa -L dimensione -n nome gruppo");
    if (dimensione > vg.libero) throw new V.ErroreFs(`spazio insufficiente: liberi ${vg.libero}G`);
    vg.libero -= dimensione;
    vg.lv[nome] = { size: dimensione };
    const dev = `/dev/${gruppo}/${nome}`;
    d(sh).dispositivi[dev] = { size: dimensione, fs: null, usatoGB: 0, etichetta: nome };
    d(sh).contenuti[dev] = {};
    return `Logical volume "${nome}" created.`;
  },

  lvextend(sh, args) {
    const L = args.indexOf("-L");
    const quanto = L >= 0 ? args[L + 1] : null;
    const dev = args.filter((a) => !a.startsWith("-")).at(-1);
    const m = String(dev).match(/^\/dev\/([^/]+)\/(.+)$/);
    if (!m || !quanto) throw new V.ErroreFs("usa lvextend -L +100G /dev/gruppo/volume");
    const vg = d(sh).vg[m[1]];
    const lv = vg?.lv[m[2]];
    if (!lv) throw new V.ErroreFs(`volume ${dev} non trovato`);
    const aggiunta = parseInt(quanto.replace("+", ""));
    if (aggiunta > vg.libero) throw new V.ErroreFs(`spazio insufficiente nel gruppo: liberi ${vg.libero}G`);
    vg.libero -= aggiunta;
    lv.size += aggiunta;
    // Il volume e' piu' grande, il filesystem ancora no: e' il passo che manca
    // a meta' delle guide, e il motivo per cui df non cambia.
    d(sh).dispositivi[dev].size += aggiunta;
    d(sh).dispositivi[dev].daEspandere = true;
    return `Size of logical volume ${m[1]}/${m[2]} changed to ${lv.size}G.`;
  },

  resize2fs(sh, args) {
    const dev = args.filter((a) => !a.startsWith("-"))[0];
    const disco = dispositivo(sh, dev);
    disco.daEspandere = false;
    return `Il filesystem su ${dev} ora e' di ${disco.size}G.`;
  },

  vgs(sh) {
    const righe = Object.entries(d(sh).vg).map(([n, vg]) => `${n.padEnd(12)} ${String(vg.libero + "G").padEnd(8)} liberi`);
    return ["VG           VFree", ...righe].join("\n");
  },

  // ---------- RAID: ridondanza, che non e' un backup ----------
  mdadm(sh, args) {
    const testo = args.join(" ");
    if (args.includes("--create")) {
      const nome = args.find((a) => a.startsWith("/dev/md")) ?? "/dev/md0";
      const livello = (testo.match(/--level[= ](\S+)/) ?? [])[1] ?? "1";
      const dischi = args.filter((a) => a.startsWith("/dev/") && !a.startsWith("/dev/md"));
      d(sh).raid[nome] = { livello, dischi, guasti: [] };
      d(sh).dispositivi[nome] = { size: dispositivo(sh, dischi[0]).size, fs: null, usatoGB: 0, etichetta: "raid" };
      d(sh).contenuti[nome] = {};
      return `mdadm: array ${nome} started.`;
    }
    const nome = args.find((a) => a.startsWith("/dev/md"));
    const array = d(sh).raid[nome];
    if (!array) throw new V.ErroreFs(`${nome ?? "array"}: non trovato`);

    if (args.includes("--fail")) {
      const rotto = args.filter((a) => a.startsWith("/dev/") && !a.startsWith("/dev/md")).at(-1);
      array.guasti.push(rotto);
      return `mdadm: set ${rotto} faulty in ${nome}`;
    }
    if (args.includes("--detail")) {
      const vivi = array.dischi.filter((x) => !array.guasti.includes(x));
      return [
        `${nome}:`,
        `        Raid Level : raid${array.livello}`,
        `             State : ${array.guasti.length ? "clean, degraded" : "clean"}`,
        `    Active Devices : ${vivi.length}`,
        `    Failed Devices : ${array.guasti.length}`,
        ...array.dischi.map((x) => `       ${x}  ${array.guasti.includes(x) ? "faulty" : "active sync"}`),
      ].join("\n");
    }
    throw new V.ErroreFs("usa --create, --detail o --fail");
  },

  // ---------- LUKS: il disco che esce dal laboratorio ----------
  cryptsetup(sh, args) {
    const azione = args.find((a) => !a.startsWith("-") && !a.startsWith("/dev/"));
    const dev = args.find((a) => a.startsWith("/dev/"));
    if (azione === "luksFormat") {
      dispositivo(sh, dev);
      d(sh).luks[dev] = { aperto: false };
      d(sh).dispositivi[dev].fs = "crypto_LUKS";
      d(sh).contenuti[dev] = {};
      return `${dev} formattato con LUKS. La passphrase non si recupera: se la perdi, i dati sono persi.`;
    }
    if (azione === "luksOpen" || azione === "open") {
      const nome = args.at(-1);
      if (!d(sh).luks[dev]) throw new V.ErroreFs(`${dev}: non e' un volume LUKS`);
      d(sh).luks[dev].aperto = true;
      const mappato = `/dev/mapper/${nome}`;
      d(sh).dispositivi[mappato] = { size: dispositivo(sh, dev).size, fs: null, usatoGB: 0, etichetta: nome };
      d(sh).contenuti[mappato] = d(sh).contenuti[dev] ?? {};
      return `${mappato} aperto.`;
    }
    if (azione === "luksClose" || azione === "close") {
      const nome = args.at(-1);
      const mappato = `/dev/mapper/${nome}`;
      if (puntoDi(sh, mappato)) throw new V.ErroreFs(`${mappato}: e' ancora montato`);
      delete d(sh).dispositivi[mappato];
      return `${mappato} chiuso.`;
    }
    throw new V.ErroreFs("usa luksFormat, luksOpen o luksClose");
  },
};

function formatta(sh, args, tipo) {
  const nome = nomeDispositivo(args.filter((a) => !a.startsWith("-"))[0] ?? "");
  const dev = dispositivo(sh, nome);
  if (puntoDi(sh, nome)) throw new V.ErroreFs(`${nome}: e' montato, smontalo prima`);
  dev.fs = tipo;
  dev.usatoGB = 0;
  d(sh).contenuti[nome] = {};
  return `mke2fs: creato filesystem ${tipo} su ${nome}. Tutto quello che c'era sopra non c'e' piu'.`;
}
