/**
 * Le opzioni che ogni comando riconosce davvero.
 *
 * Prima di questa tabella il simulatore accettava qualunque trattino e faceva
 * finta di niente: `ls -Zq` elencava, `ps zibaldone` rispondeva come `ps aux`,
 * `journalctl -X` stampava il log intero. Un'opzione ignorata in silenzio
 * insegna che le opzioni non contano, che e' esattamente il contrario di come
 * si lavora su una macchina vera.
 *
 * Il controllo sta in un punto solo — la chiamata del comando in `shell.js` —
 * e legge questa tabella. Ogni voce elenca le opzioni **che il simulatore
 * implementa**: quello che non c'e' viene rifiutato, con un messaggio che non
 * mente sul perche' (non e' detto che l'opzione non esista su Linux; qui non
 * e' simulata).
 *
 * ponytail: una tabella e un controllo, invece di un parser di opzioni in ogni
 * comando. Se un giorno servisse distinguere "opzione inesistente" da "vera ma
 * non simulata", la distinzione va aggiunta qui, non in centoquaranta punti.
 */

/**
 * comando -> { c: lettere corte ammesse, l: [opzioni lunghe], num: -3 ammesso }
 *
 * Un comando che non compare non ammette nessuna opzione: `pwd -l` e' un
 * errore, come su una shell vera.
 */
export const OPZIONI = {
  sh: { wrap: true, c: "c", v: "c" },
  watch: { wrap: true },
  time: { wrap: true },
  "sudo-u": { wrap: true },
  "prova-da-fuori": { wrap: true },
  "prova-come": { wrap: true },
  avvia: { wrap: true },
  nohup: { wrap: true },
  // Comandi che ne avvolgono un altro: le loro opzioni finiscono dove comincia
  // il comando interno, che verra' controllato per conto suo.
  // --- file e cartelle ---
  ls: { c: "alh" },
  cp: { c: "rR" },
  rm: { c: "rRf" },
  mkdir: { c: "p" },
  ln: { c: "s" },
  du: { c: "sh" },
  df: { c: "h" },
  tar: { c: "cxtzvf" },
  gzip: { c: "k" },
  gunzip: { c: "k" },
  chmod: { c: "R" },
  chown: { c: "R" },
  chgrp: { c: "R" },

  // --- testo ---
  grep: { c: "icvnAB", v: "AB", num: true },
  head: { c: "n", v: "n", num: true },
  tail: { c: "nf", v: "n", num: true },
  sort: { c: "nru" },
  uniq: { c: "c" },
  wc: { c: "lwc" },
  cut: { c: "dfc", v: "df" },
  tr: { c: "ds" },
  sed: { c: "in", v: "i" },
  awk: { c: "Fv", v: "Fv" },
  tee: { c: "a" },
  xargs: { wrap: true, c: "nI", v: "nI" },
  // echo smette di leggere opzioni al primo argomento: `echo mkdir -p x`
  // stampa la riga, non protesta.
  echo: { wrap: true, c: "ne" },

  // --- processi ---
  kill: { c: "", segnali: true, num: true },
  pkill: { c: "f" },
  ps: { bsd: "aux", c: "efA" },
  top: { c: "n", v: "n", num: true },
  jobs: { c: "l" },

  // --- sistema ---
  uname: { c: "arsnmv" },
  free: { c: "hm" },
  uptime: { c: "p" },
  id: { c: "un" },
  groups: {},
  which: { c: "a" },
  env: {},
  export: {},
  sysctl: { c: "apw" },
  dmesg: {},
  journalctl: { c: "nufb", v: "nu", num: true },
  systemctl: { c: "", l: ["failed", "now", "all"] },
  "systemd-run": { wrap: true, c: "p", v: "p", l: ["scope"] },
  crontab: { c: "lre" },
  logrotate: { c: "f", l: ["force"] },

  // --- utenti ---
  useradd: { c: "m" },
  usermod: { c: "aG", v: "G" },
  passwd: { c: "l" },
  groupadd: {},
  sudo: { wrap: true, c: "u", v: "u" },

  // --- rete ---
  ping: { c: "c", v: "c", num: true },
  ss: { c: "tulpna" },
  netstat: { c: "tulpna" },
  ip: { c: "" },
  ifconfig: {},
  dig: { c: "x" },
  nslookup: {},
  traceroute: { c: "n" },
  nc: { c: "zvl" },
  ethtool: { c: "i", v: "i" },
  nmcli: {},
  resolvectl: {},

  // --- remoto ---
  ssh: { wrap: true, c: "pil", v: "pil", num: true },
  scp: { c: "rp", v: "p" },
  rsync: { c: "avzn", l: ["delete", "dry-run"] },
  "ssh-keygen": { c: "tflR", v: "tfR" },
  "ssh-copy-id": { c: "i", v: "i" },
  sshd: { c: "t" },
  tmux: { wrap: true, c: "st", v: "st", l: ["new-session"] },

  // --- pacchetti e ambienti ---
  apt: { c: "y", l: ["installed", "upgradable"] },
  pip: { c: "UVr", v: "r", l: ["upgrade", "version", "user"] },
  python: { wrap: true, c: "Vcm", v: "cm", l: ["version"] },
  conda: { c: "Vn", v: "n", l: ["version", "name"] },
  bash: { wrap: true, c: "exu" },
  source: {},

  // --- prestazioni ---
  strace: { wrap: true, c: "cfe", v: "e" },
  perf: { wrap: true, c: "e", v: "e" },
  vmstat: { num: true },
  iostat: { c: "xd", num: true },
  hdparm: { c: "tT" },

  // --- dischi ---
  lsblk: { c: "f" },
  mount: { c: "at", v: "t", l: ["bind"] },
  umount: { c: "l" },
  mkfs: { c: "t", v: "t" },
  "mkfs.ext4": { c: "L", v: "L" },
  "mkfs.xfs": { c: "Lf", v: "L" },
  pvcreate: {},
  vgcreate: {},
  vgs: {},
  lvcreate: { c: "Ln", v: "Ln" },
  lvextend: { c: "Lrl", v: "Ll" },
  resize2fs: { c: "p" },
  cryptsetup: { c: "", l: ["type"] },
  mdadm: { c: "", l: ["create", "detail", "fail", "level", "raid-devices", "assemble", "stop"] },

  // --- hardware ---
  lspci: { c: "k" },
  lsusb: { c: "t" },
  lsmod: {},
  lshw: { c: "C", v: "C" },
  dmidecode: { c: "t", v: "t" },
  modprobe: { c: "r", l: ["remove"] },

  // --- container ---
  docker: { wrap: true, c: "adtvfi", v: "tvf", l: ["rm", "name", "format"] },
  apptainer: { wrap: true, c: "c" },

  // --- sicurezza ---
  ufw: {},
  getcap: {},
  setcap: {},
  getenforce: {},
  setenforce: {},
  "aa-status": {},

  // --- automazione ---
  ansible: { wrap: true, c: "im", v: "im" },
  "ansible-inventory": { c: "i", v: "i", l: ["list", "graph"] },
  "ansible-playbook": { wrap: true, c: "iC", v: "i", l: ["check"] },
};

/**
 * I comandi che si controllano da soli: gli argomenti col trattino non sono
 * opzioni ma pezzi della loro grammatica.
 *
 * - `test` e `[` — `-f`, `-z`, `-gt` sono operatori del test
 * - `find` — `-name` e' un predicato, e find ha gia' il suo parser che protesta
 */
const PROPRI = new Set(["test", "[", "find"]);

/** I nomi dei segnali che kill accetta, senza il prefisso SIG. */
const SEGNALI = new Set([
  "HUP", "INT", "QUIT", "KILL", "TERM", "STOP", "CONT", "USR1", "USR2", "ABRT", "ALRM",
]);

/**
 * Il problema, se c'e': la stringa dell'errore da mostrare, altrimenti null.
 *
 * Non si controlla niente per i cmdlet di PowerShell (nome con la maiuscola):
 * hanno una grammatica di parametri tutta loro, e la tabella qui e' POSIX.
 */
export function opzioneIgnota(nome, args) {
  if (PROPRI.has(nome) || /^[A-Z]/.test(nome)) return null;
  const spec = OPZIONI[nome];
  const corte = (spec && spec.c) || "";
  const lunghe = new Set((spec && spec.l) || []);
  const valori = (spec && spec.v) || "";

  const avvolge = !!(spec && spec.wrap);
  let valoreAtteso = false;
  for (const a of args) {
    if (a === "-" || a === "--") continue;
    if (!a.startsWith("-")) {
      // `sudo useradd -m anna`: da qui in poi le opzioni sono del comando
      // interno, e le controllera' lui quando tocchera' a lui.
      if (avvolge && !valoreAtteso) return null;
      valoreAtteso = false;
      continue;
    }
    valoreAtteso = false;

    if (a.startsWith("--")) {
      const chiave = a.slice(2).split("=")[0];
      if (!lunghe.has(chiave)) return `${nome}: opzione non riconosciuta -- '${chiave}'`;
      continue;
    }

    const corpo = a.slice(1);
    // -3 su head, -9 su kill: un numero e' un argomento, non un'opzione.
    if (/^\d+$/.test(corpo)) {
      if (spec && spec.num) continue;
      return `${nome}: opzione non riconosciuta -- '${corpo}'`;
    }
    // kill -TERM, kill -STOP
    if (spec && spec.segnali && SEGNALI.has(corpo.toUpperCase())) continue;

    for (const ch of corpo) {
      // Le opzioni con valore attaccato — `-n5`, `-d,`, `-f1,3` — si fermano
      // alla lettera: quello che segue e' il valore, non un'altra opzione.
      if (!/[A-Za-z]/.test(ch)) break;
      if (!corte.includes(ch)) {
        return `${nome}: opzione non supportata dal simulatore -- '${ch}'`;
      }
      // Un'opzione che prende un valore se lo mangia attaccato: in `-n5` il 5
      // e' il valore, in `-d,` la virgola e' il separatore.
      if (valori.includes(ch)) {
        if (corpo.indexOf(ch) < corpo.length - 1) break;
        valoreAtteso = true; // il valore arriva staccato: `-u anna`, `-n 3`
      }
    }
  }
  return null;
}
