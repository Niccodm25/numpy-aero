// Sottoinsieme dichiarato degli strumenti di trasformazione testo. Copre le
// operazioni ricorrenti su log e CSV senza fingere di essere awk o sed interi.

import * as V from "./vfs.js";

const righe = (s) => (s === "" ? [] : String(s).replace(/\n$/, "").split("\n"));
function ingresso(sh, file) {
  if (file) return V.leggi(sh.fs, file);
  if (sh.stdin === null || sh.stdin === undefined) throw new V.ErroreFs("manca il file o una pipe in ingresso");
  return typeof sh.stdin === "string" ? sh.stdin : String(sh.stdin);
}
const senzaOpzioni = (a) => a.filter((x) => !x.startsWith("-"));

export const TESTO = {
  cut(sh, args) {
    const d = args.indexOf("-d");
    const f = args.indexOf("-f");
    const separatore = d >= 0 ? args[d + 1] : "\t";
    const campi = (f >= 0 ? args[f + 1] : "").split(",").map(Number);
    if (!campi.every((n) => n >= 1)) throw new V.ErroreFs("cut: usa -f con campi da 1 in poi");
    const file = args.filter((a, i) => i !== d && i !== d + 1 && i !== f && i !== f + 1 && !a.startsWith("-")).at(-1);
    return righe(ingresso(sh, file)).map((r) => campi.map((n) => r.split(separatore)[n - 1] ?? "").join(separatore)).join("\n");
  },
  tr(sh, args) {
    if (args.length < 2) throw new V.ErroreFs("tr: servono sorgente e destinazione");
    const [da, a] = args;
    const espandi = (x) => x === "a-z" ? "abcdefghijklmnopqrstuvwxyz" : x === "A-Z" ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ" : x;
    const sorgente = espandi(da), destinazione = espandi(a);
    return ingresso(sh).split("").map((c) => {
      const i = sorgente.indexOf(c);
      return i < 0 ? c : destinazione[i] ?? destinazione.at(-1);
    }).join("");
  },
  tee(sh, args) {
    const file = senzaOpzioni(args)[0];
    if (!file) throw new V.ErroreFs("tee: manca il file");
    const testo = ingresso(sh);
    if (args.includes("-a")) V.aggiungi(sh.fs, file, testo.endsWith("\n") ? testo : testo + "\n");
    else V.scrivi(sh.fs, file, testo.endsWith("\n") ? testo : testo + "\n");
    return testo;
  },
  sed(sh, args) {
    const spec = args[0];
    const m = spec?.match(/^s(.)(.*?)\1(.*?)\1(g?)$/);
    if (!m) throw new V.ErroreFs("sed: qui e' supportata solo s/vecchio/nuovo/g");
    const [, , cerca, sostituisci, globale] = m;
    const file = args[1];
    return righe(ingresso(sh, file)).map((r) => globale ? r.split(cerca).join(sostituisci) : r.replace(cerca, sostituisci)).join("\n");
  },
  awk(sh, args) {
    const programma = args[0];
    const file = args[1];
    const stampa = programma?.match(/^\{print ((?:\$\d+|NR)(?:, ?(?:\$\d+|NR))*)\}$/);
    if (!stampa) throw new V.ErroreFs("awk: qui e' supportato {print $1, $2} oppure NR");
    return righe(ingresso(sh, file)).map((r, i) => stampa[1].split(/, ?/).map((c) => c === "NR" ? i + 1 : r.trim().split(/\s+/)[Number(c.slice(1)) - 1] ?? "").join(" ")).join("\n");
  },
  xargs(sh, args) {
    const comando = args[0];
    if (!comando || !sh.comandi[comando]) throw new V.ErroreFs("xargs: manca un comando conosciuto");
    const valori = ingresso(sh).trim().split(/\s+/).filter(Boolean);
    const uscite = valori.map((v) => sh.comandi[comando](sh, [...args.slice(1), v]) ?? "").filter(Boolean);
    return uscite.join("\n");
  },
};
