// Filesystem virtuale in memoria. Nessun accesso al disco vero: e' una mappa
// da percorso assoluto a nodo, e basta a far girare i comandi di tre rami.
//
// La mappa piatta invece dell'albero: i comandi lavorano quasi sempre su
// percorsi assoluti gia' normalizzati, e con l'albero ogni operazione
// ricomincerebbe a scendere di nodo in nodo. L'unico prezzo e' che elencare una
// cartella scorre tutte le chiavi, che su un filesystem didattico non si nota.

export function crea(iniziale = {}) {
  const nodi = new Map([["/", { tipo: "dir" }]]);
  const fs = { nodi, cwd: "/" };
  // Lo stato iniziale crea da se' le cartelle mancanti: descriverlo dovendo
  // elencare ogni genitore renderebbe illeggibile il setup di ogni esercizio.
  for (const [percorso, contenuto] of Object.entries(iniziale)) {
    if (contenuto === null) creaDir(fs, percorso, true);
    else {
      creaDir(fs, genitore(normalizza(fs, percorso)), true);
      scrivi(fs, percorso, contenuto);
    }
  }
  return fs;
}

/**
 * Da un percorso qualsiasi a uno assoluto normalizzato.
 * Gestisce ~, . e .., e la barra finale sparisce sempre: "/a/" e "/a" devono
 * essere la stessa chiave, altrimenti "cd dati/" crea un secondo nodo fantasma.
 */
export function normalizza(fs, percorso) {
  if (percorso === "" || percorso === undefined) return fs.cwd;
  let p = String(percorso);
  if (p === "~" || p.startsWith("~/")) p = HOME + p.slice(1);
  const assoluto = p.startsWith("/");
  const pezzi = (assoluto ? p : fs.cwd + "/" + p).split("/");
  const out = [];
  for (const pezzo of pezzi) {
    if (pezzo === "" || pezzo === ".") continue;
    if (pezzo === "..") out.pop();
    else out.push(pezzo);
  }
  return "/" + out.join("/");
}

export const HOME = "/home/tu";

export const genitore = (p) => (p === "/" ? "/" : p.slice(0, p.lastIndexOf("/")) || "/");
export const foglia = (p) => (p === "/" ? "/" : p.slice(p.lastIndexOf("/") + 1));

export const esiste = (fs, p) => fs.nodi.has(normalizza(fs, p));
export const tipo = (fs, p) => fs.nodi.get(normalizza(fs, p))?.tipo ?? null;
export const eDir = (fs, p) => tipo(fs, p) === "dir";
export const eFile = (fs, p) => tipo(fs, p) === "file";

export function leggi(fs, p) {
  const n = fs.nodi.get(normalizza(fs, p));
  if (!n) throw new ErroreFs(`${p}: file o directory non esistente`);
  if (n.tipo === "dir") throw new ErroreFs(`${p}: e' una directory`);
  return n.contenuto;
}

export function scrivi(fs, p, contenuto) {
  const abs = normalizza(fs, p);
  const dir = genitore(abs);
  if (!fs.nodi.has(dir)) throw new ErroreFs(`${dir}: directory non esistente`);
  if (fs.nodi.get(abs)?.tipo === "dir") throw new ErroreFs(`${p}: e' una directory`);
  fs.nodi.set(abs, { tipo: "file", contenuto: String(contenuto) });
}

export function aggiungi(fs, p, contenuto) {
  const abs = normalizza(fs, p);
  const vecchio = fs.nodi.get(abs);
  if (vecchio?.tipo === "dir") throw new ErroreFs(`${p}: e' una directory`);
  scrivi(fs, abs, (vecchio?.contenuto ?? "") + contenuto);
}

/** Con ricorsivo crea anche i genitori mancanti, come `mkdir -p`. */
export function creaDir(fs, p, ricorsivo = false) {
  const abs = normalizza(fs, p);
  if (fs.nodi.has(abs)) {
    if (ricorsivo) return;
    throw new ErroreFs(`${p}: esiste gia'`);
  }
  const dir = genitore(abs);
  if (!fs.nodi.has(dir)) {
    if (!ricorsivo) throw new ErroreFs(`${dir}: directory non esistente`);
    creaDir(fs, dir, true);
  }
  fs.nodi.set(abs, { tipo: "dir" });
}

/** I figli diretti di una cartella, ordinati. Solo i nomi, non i percorsi. */
export function elenca(fs, p = ".") {
  const abs = normalizza(fs, p);
  const n = fs.nodi.get(abs);
  if (!n) throw new ErroreFs(`${p}: file o directory non esistente`);
  if (n.tipo === "file") return [foglia(abs)];
  const prefisso = abs === "/" ? "/" : abs + "/";
  const nomi = [];
  for (const chiave of fs.nodi.keys()) {
    if (chiave === abs || !chiave.startsWith(prefisso)) continue;
    const resto = chiave.slice(prefisso.length);
    if (!resto.includes("/")) nomi.push(resto);
  }
  return nomi.sort();
}

/** Tutti i discendenti, compreso il nodo stesso. Serve a rm -r, cp -r e mv. */
export function sottoalbero(fs, p) {
  const abs = normalizza(fs, p);
  const prefisso = abs === "/" ? "/" : abs + "/";
  const out = [];
  for (const chiave of fs.nodi.keys()) {
    if (chiave === abs || chiave.startsWith(prefisso)) out.push(chiave);
  }
  return out.sort();
}

export function rimuovi(fs, p, ricorsivo = false) {
  const abs = normalizza(fs, p);
  const n = fs.nodi.get(abs);
  if (!n) throw new ErroreFs(`${p}: file o directory non esistente`);
  if (n.tipo === "dir") {
    if (!ricorsivo) throw new ErroreFs(`${p}: e' una directory`);
    for (const c of sottoalbero(fs, abs)) fs.nodi.delete(c);
    return;
  }
  fs.nodi.delete(abs);
}

/**
 * Destinazione: se e' una cartella esistente, ci si copia dentro conservando il
 * nome. E' la regola di cp e mv veri, e cambiarla renderebbe l'esercizio una
 * lezione su questo simulatore invece che sulla shell.
 */
function destinazione(fs, sorgente, dest) {
  const absS = normalizza(fs, sorgente);
  const absD = normalizza(fs, dest);
  return eDir(fs, absD) ? absD + (absD === "/" ? "" : "/") + foglia(absS) : absD;
}

export function copia(fs, sorgente, dest, ricorsivo = false) {
  const absS = normalizza(fs, sorgente);
  const n = fs.nodi.get(absS);
  if (!n) throw new ErroreFs(`${sorgente}: file o directory non esistente`);
  const absD = destinazione(fs, absS, dest);
  if (n.tipo === "file") return scrivi(fs, absD, n.contenuto);
  if (!ricorsivo) throw new ErroreFs(`${sorgente}: e' una directory`);
  for (const c of sottoalbero(fs, absS)) {
    const nuovo = absD + c.slice(absS.length);
    const nodo = fs.nodi.get(c);
    fs.nodi.set(nuovo, nodo.tipo === "dir" ? { tipo: "dir" } : { tipo: "file", contenuto: nodo.contenuto });
  }
}

export function sposta(fs, sorgente, dest) {
  const absS = normalizza(fs, sorgente);
  if (!fs.nodi.has(absS)) throw new ErroreFs(`${sorgente}: file o directory non esistente`);
  const absD = destinazione(fs, absS, dest);
  copia(fs, absS, absD, true);
  rimuovi(fs, absS, true);
}

/** Errore previsto di un comando: il messaggio va a schermo, non in console. */
export class ErroreFs extends Error {}
