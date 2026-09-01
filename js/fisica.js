// Motore degli esercizi di fisica: espressioni, non stringhe.
//
// Nel ramo Linux un esercizio si verifica guardando lo stato del filesystem.
// Qui lo stato e' una formula, e il problema e' lo stesso: confrontare quello
// che hai scritto con la risposta *come testo* insegnerebbe a ricopiare la
// lezione — `C_L*sin(alpha) - C_D*cos(alpha)` e `-C_D*cos(alpha) +
// C_L*sin(alpha)` sono la stessa cosa e devono valere uguale.
//
// Quindi si valuta. La tua espressione e quella di riferimento vengono
// calcolate su decine di punti casuali nel dominio dichiarato dall'esercizio:
// se coincidono ovunque sono la stessa funzione, comunque tu l'abbia scritta.
// E' lo stesso principio del terminale — si guarda il risultato, non il testo.
//
// ponytail: niente algebra simbolica. Un CAS costerebbe piu' di tutto il resto
// dell'app e servirebbe a distinguere casi che a lezione non esistono; il
// campionamento casuale sbaglia solo se due funzioni diverse coincidono su
// venti punti a caso, che non capita con le formule di un corso.

/** Errore di formula: il messaggio arriva allo studente cosi' com'e'. */
export class ErroreFormula extends Error {}

const FUNZIONI = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sqrt: Math.sqrt, exp: Math.exp, log: Math.log, abs: Math.abs,
};

const COSTANTI = { pi: Math.PI, e: Math.E, g: 9.81 };

/**
 * Da testo a lista di pezzi. I nomi possono contenere underscore e cifre —
 * C_L, C_m_alpha, x_N — perche' sono i simboli con cui e' scritto il corso.
 */
function pezzi(testo) {
  const fuori = [];
  let i = 0;
  while (i < testo.length) {
    const c = testo[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let n = "";
      while (i < testo.length && /[0-9.eE]/.test(testo[i])) {
        // La e di 1e-3 si porta dietro il segno; la e da sola e' la costante.
        if (/[eE]/.test(testo[i]) && !/[0-9]/.test(testo[i + 1] ?? "") && !"+-".includes(testo[i + 1] ?? "")) break;
        n += testo[i++];
        if (/[eE]/.test(n.at(-1)) && "+-".includes(testo[i] ?? "")) n += testo[i++];
      }
      if (!Number.isFinite(Number(n))) throw new ErroreFormula(`numero non valido: ${n}`);
      fuori.push({ tipo: "num", valore: Number(n) });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let n = "";
      while (i < testo.length && /[A-Za-z0-9_]/.test(testo[i])) n += testo[i++];
      fuori.push({ tipo: "nome", valore: n });
      continue;
    }
    if ("+-*/^(),".includes(c)) {
      // ** vale come ^: chi arriva da Python lo scrive cosi'.
      if (c === "*" && testo[i + 1] === "*") { fuori.push({ tipo: "op", valore: "^" }); i += 2; continue; }
      fuori.push({ tipo: c === "(" || c === ")" || c === "," ? c : "op", valore: c });
      i++;
      continue;
    }
    throw new ErroreFormula(`carattere non ammesso: ${c}`);
  }
  return fuori;
}

/**
 * Analisi ricorsiva discendente: somma -> prodotto -> potenza -> unario ->
 * atomo. E' la grammatica delle quattro operazioni, scritta come si legge.
 */
function analizza(lista) {
  let i = 0;
  const guarda = () => lista[i];
  const mangia = (v) => {
    const t = lista[i];
    if (!t || (t.valore !== v && t.tipo !== v)) throw new ErroreFormula(`manca ${v}`);
    i++;
    return t;
  };

  function somma() {
    let a = prodotto();
    while (guarda() && guarda().tipo === "op" && "+-".includes(guarda().valore)) {
      const op = lista[i++].valore;
      const b = prodotto();
      const sx = a;
      a = op === "+" ? (v) => sx(v) + b(v) : (v) => sx(v) - b(v);
    }
    return a;
  }

  function prodotto() {
    let a = potenza();
    while (guarda() && guarda().tipo === "op" && "*/".includes(guarda().valore)) {
      const op = lista[i++].valore;
      const b = potenza();
      const sx = a;
      a = op === "*" ? (v) => sx(v) * b(v) : (v) => sx(v) / b(v);
    }
    return a;
  }

  function potenza() {
    const a = unario();
    if (guarda() && guarda().valore === "^") {
      i++;
      const b = potenza(); // a destra: 2^3^2 = 2^(3^2)
      return (v) => Math.pow(a(v), b(v));
    }
    return a;
  }

  function unario() {
    if (guarda() && guarda().tipo === "op" && "+-".includes(guarda().valore)) {
      const op = lista[i++].valore;
      const a = unario();
      return op === "-" ? (v) => -a(v) : a;
    }
    return atomo();
  }

  function atomo() {
    const t = guarda();
    if (!t) throw new ErroreFormula("espressione incompleta");
    if (t.tipo === "num") { i++; return () => t.valore; }
    if (t.tipo === "(") {
      i++;
      const dentro = somma();
      mangia(")");
      return dentro;
    }
    if (t.tipo === "nome") {
      i++;
      const nome = t.valore;
      if (guarda() && guarda().tipo === "(") {
        const f = FUNZIONI[nome];
        if (!f) throw new ErroreFormula(`funzione sconosciuta: ${nome}`);
        i++;
        const argomenti = [somma()];
        while (guarda() && guarda().tipo === ",") { i++; argomenti.push(somma()); }
        mangia(")");
        return (v) => f(...argomenti.map((a) => a(v)));
      }
      return (v) => {
        if (nome in v) return v[nome];
        if (nome in COSTANTI) return COSTANTI[nome];
        throw new ErroreFormula(`simbolo sconosciuto: ${nome}`);
      };
    }
    throw new ErroreFormula(`non mi aspettavo ${t.valore}`);
  }

  const f = somma();
  if (i < lista.length) throw new ErroreFormula(`avanza qualcosa dopo la formula: ${lista[i].valore}`);
  return f;
}

/** Compila un'espressione: restituisce una funzione dei simboli. */
export function compila(testo) {
  if (!String(testo ?? "").trim()) throw new ErroreFormula("non hai scritto niente");
  return analizza(pezzi(String(testo)));
}

/** Il valore dell'espressione con i simboli dati. */
export function valuta(testo, simboli = {}) {
  return compila(testo)(simboli);
}

/** I nomi che compaiono in un'espressione (funzioni escluse). */
export function simboliDi(testo) {
  const dentro = new Set();
  const lista = pezzi(String(testo ?? ""));
  lista.forEach((t, k) => {
    if (t.tipo === "nome" && (lista[k + 1] || {}).tipo !== "(") dentro.add(t.valore);
  });
  return [...dentro];
}

/** Numero pseudo-casuale ripetibile: lo stesso esercizio prova sempre gli
 *  stessi punti, cosi' un esito non dipende dalla fortuna. */
function dado(seme) {
  let s = seme >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const DOMINIO_DEFAULT = [0.2, 1.2];

/**
 * Due espressioni sono la stessa funzione? Si guarda in `punti` posti a caso
 * dentro il dominio dichiarato.
 *
 * Il dominio non e' un dettaglio: `sqrt(u^2+w^2)` e `u/cos(atan(w/u))` sono
 * uguali per u > 0 e diverse per u < 0, e a lezione u e' la velocita' in avanti.
 */
export function equivalenti(a, b, dominio = {}, punti = 24) {
  const fa = compila(a);
  const fb = compila(b);
  const nomi = [...new Set([...simboliDi(a), ...simboliDi(b)])].filter((n) => !(n in COSTANTI) || n in dominio);
  const rnd = dado(1234567);
  let confronti = 0;
  for (let k = 0; k < punti; k++) {
    const v = {};
    for (const n of nomi) {
      const [min, max] = dominio[n] ?? DOMINIO_DEFAULT;
      v[n] = min + (max - min) * rnd();
    }
    let x, y;
    try {
      x = fa(v);
      y = fb(v);
    } catch (e) {
      if (e instanceof ErroreFormula) throw e;
      throw e;
    }
    // Un punto dove il riferimento non e' definito non dice niente su nessuno.
    if (!Number.isFinite(y)) continue;
    if (!Number.isFinite(x)) return { ok: false, dove: v, tuo: x, atteso: y };
    if (Math.abs(x - y) > 1e-6 * (1 + Math.abs(y))) return { ok: false, dove: v, tuo: x, atteso: y };
    confronti++;
  }
  if (!confronti) throw new ErroreFormula("il dominio dell'esercizio non produce punti validi");
  return { ok: true };
}

/** Il testo di un punto di prova, per dire *dove* la formula sbaglia. */
const mostraPunto = (v) =>
  Object.entries(v)
    .map(([k, x]) => `${k}=${Number(x).toFixed(3)}`)
    .join(", ");

/** Normalizza una risposta a elenco: "p, q, r" e "p q r" sono la stessa cosa. */
const elenco = (testo) =>
  String(testo ?? "")
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Verifica una risposta di fisica. Restituisce la stessa forma di
 * `verifica()` della shell: { ok, problemi }.
 *
 * I tipi:
 * - `formula`   la risposta e' un'espressione, valutata contro `equivale`
 * - `numerico`  la risposta e' un numero (o un conto), confrontato con `valore`
 * - `ordina`    la risposta e' la sequenza dei passi, confrontata con `ordine`
 * - `insieme`   la risposta e' un elenco senza ordine, confrontato con `insieme`
 */
export function verificaFisica(tipo, risposta, attesa = {}) {
  const problemi = [];
  const p = (m) => problemi.push(m);
  const testo = String(risposta ?? "").trim();
  if (!testo) return { ok: false, problemi: ["non hai scritto niente"] };

  if (tipo === "ordina") {
    const dato = elenco(testo);
    const giusto = attesa.ordine.map(String);
    if (dato.length !== giusto.length) p(`servono ${giusto.length} passi, ne hai messi ${dato.length}`);
    else if (dato.join(" ") !== giusto.join(" ")) {
      const primo = dato.findIndex((x, k) => x !== giusto[k]);
      p(primo === 0
        ? `il primo passo non e' quello: ${dato[0]} viene dopo`
        : `i primi ${primo} passi sono al posto giusto, poi no: ${dato[primo]} non va in posizione ${primo + 1}`);
    }
    return { ok: !problemi.length, problemi };
  }

  if (tipo === "insieme") {
    const dato = new Set(elenco(testo));
    const giusto = new Set(attesa.insieme.map(String));
    const mancanti = [...giusto].filter((x) => !dato.has(x));
    const troppi = [...dato].filter((x) => !giusto.has(x));
    if (mancanti.length) p(`manca ${mancanti.join(", ")}`);
    if (troppi.length) p(`non ci va ${troppi.join(", ")}`);
    return { ok: !problemi.length, problemi };
  }

  // Da qui in poi la risposta e' un'espressione: se non si compila, il
  // messaggio del parser e' gia' il problema.
  let nomi;
  try {
    nomi = simboliDi(testo);
  } catch (e) {
    return { ok: false, problemi: [e.message] };
  }

  // Simboli obbligatori e vietati: servono a impedire la risposta che gira
  // attorno alla domanda — riscrivere il nome della grandezza cercata, o
  // lasciare dentro una variabile che l'esercizio chiede di eliminare.
  for (const s of attesa.usa || []) if (!nomi.includes(s)) p(`la risposta deve contenere ${s}`);
  for (const s of attesa.senza || []) if (nomi.includes(s)) p(`la risposta non puo' contenere ${s}`);
  if (problemi.length) return { ok: false, problemi };

  if (tipo === "numerico") {
    let valore;
    try {
      valore = valuta(testo, attesa.dati || {});
    } catch (e) {
      return { ok: false, problemi: [e.message] };
    }
    if (!Number.isFinite(valore)) return { ok: false, problemi: ["il conto non da' un numero"] };
    const entro = attesa.entro ?? Math.abs(attesa.valore) * 0.01;
    if (Math.abs(valore - attesa.valore) > entro) {
      p(`hai ottenuto ${valore.toPrecision(5)}, il valore atteso e' un altro`);
    }
    return { ok: !problemi.length, problemi };
  }

  // formula
  let esito;
  try {
    esito = equivalenti(testo, attesa.equivale, attesa.dominio || {});
  } catch (e) {
    return { ok: false, problemi: [e.message] };
  }
  if (!esito.ok) {
    p(`con ${mostraPunto(esito.dove)} la tua formula da' ${Number(esito.tuo).toPrecision(5)}, ` +
      `mentre il valore giusto e' ${Number(esito.atteso).toPrecision(5)}`);
  }
  return { ok: !problemi.length, problemi };
}

/** I tipi di esercizio gestiti qui: serve all'app per sapere chi li disegna. */
export const TIPI_FISICA = ["formula", "numerico", "ordina", "insieme"];
