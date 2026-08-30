// Analizzatore di HTML e verifica dichiarativa degli esercizi del ramo HTML.
//
// Perche' non il DOM del browser: l'app gira nel browser, ma il controllo dei
// contenuti gira in node, dove `DOMParser` non esiste. Un analizzatore scritto
// qui e' l'unico modo di avere **la stessa** verifica nei due posti — e la
// verifica di un esercizio deve dare lo stesso verdetto ovunque giri.
//
// Non e' un parser conforme: non ricostruisce i tag impliciti, non gestisce
// tabelle malformate, non applica le regole di annidamento del vero HTML.
// Riconosce tag, attributi, testo e annidamento, che e' quello su cui si
// possono porre domande sensate a chi sta imparando.

// Elementi che non hanno un tag di chiusura. Sono un elenco chiuso: chi ne
// scrive uno con la chiusura sta commettendo un errore che il browser perdona,
// ed e' una delle cose che questo ramo insegna.
const VUOTI = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** Da sorgente HTML ad albero di nodi {tag, attributi, figli, testo}. */
export function analizza(sorgente) {
  const radice = { tag: "#radice", attributi: {}, figli: [] };
  const pila = [radice];
  let i = 0;
  const testo = String(sorgente ?? "");

  const aggiungi = (nodo) => pila[pila.length - 1].figli.push(nodo);

  while (i < testo.length) {
    const apertura = testo.indexOf("<", i);
    if (apertura === -1) {
      aggiungiTesto(pila, testo.slice(i));
      break;
    }
    if (apertura > i) aggiungiTesto(pila, testo.slice(i, apertura));

    // Commenti e doctype: si riconoscono e si saltano, ma il doctype va
    // registrato perche' l'esercizio sul file minimo chiede proprio quello.
    if (testo.startsWith("<!--", apertura)) {
      const fine = testo.indexOf("-->", apertura);
      i = fine === -1 ? testo.length : fine + 3;
      continue;
    }
    if (testo.startsWith("<!", apertura)) {
      const fine = testo.indexOf(">", apertura);
      const dichiarazione = testo.slice(apertura + 2, fine === -1 ? testo.length : fine).trim();
      aggiungi({ tag: "!" + dichiarazione.split(/\s+/)[0].toLowerCase(), attributi: {}, figli: [] });
      i = fine === -1 ? testo.length : fine + 1;
      continue;
    }

    const chiusura = testo.indexOf(">", apertura);
    if (chiusura === -1) {
      aggiungiTesto(pila, testo.slice(apertura));
      break;
    }
    const dentro = testo.slice(apertura + 1, chiusura).trim();
    i = chiusura + 1;

    if (dentro.startsWith("/")) {
      const nome = dentro.slice(1).trim().toLowerCase();
      // Si chiude il nodo corrispondente piu' vicino: una chiusura che non
      // corrisponde a niente viene ignorata invece di far crollare l'albero.
      for (let k = pila.length - 1; k > 0; k--) {
        if (pila[k].tag === nome) {
          pila.length = k;
          break;
        }
      }
      continue;
    }

    const autochiuso = dentro.endsWith("/");
    const corpo = autochiuso ? dentro.slice(0, -1).trim() : dentro;
    const spazio = corpo.search(/\s/);
    const nome = (spazio === -1 ? corpo : corpo.slice(0, spazio)).toLowerCase();
    const nodo = {
      tag: nome,
      attributi: leggiAttributi(spazio === -1 ? "" : corpo.slice(spazio)),
      figli: [],
    };
    aggiungi(nodo);
    if (!autochiuso && !VUOTI.has(nome)) pila.push(nodo);
  }
  return radice;
}

function aggiungiTesto(pila, pezzo) {
  if (!pezzo.trim()) return;
  pila[pila.length - 1].figli.push({ tag: "#testo", attributi: {}, figli: [], testo: pezzo });
}

function leggiAttributi(pezzo) {
  const attributi = {};
  const re = /([A-Za-z_:][-A-Za-z0-9_:.]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
  let m;
  while ((m = re.exec(pezzo))) {
    const valore = m[2] === undefined ? "" : m[2].replace(/^["']|["']$/g, "");
    attributi[m[1].toLowerCase()] = valore;
  }
  return attributi;
}

/** Tutti i nodi dell'albero, radice esclusa, in ordine di comparsa. */
export function tutti(nodo, out = []) {
  for (const f of nodo.figli) {
    out.push(f);
    tutti(f, out);
  }
  return out;
}

export const conTag = (nodo, tag) => tutti(nodo).filter((n) => n.tag === tag.toLowerCase());

/** Il testo di un nodo e di tutti i suoi discendenti, normalizzato. */
export function testoDi(nodo) {
  if (nodo.tag === "#testo") return nodo.testo;
  return nodo.figli.map(testoDi).join("");
}

const normalizza = (s) => String(s).replace(/\s+/g, " ").trim().toLowerCase();

/** Il nodo `a` contiene `b` a qualunque profondita'? */
const contiene = (a, b) => tutti(a).includes(b);

/**
 * Verifica dichiarativa, come per il terminale: l'esercizio descrive la pagina
 * attesa e questa funzione la confronta.
 *
 * { elementi: {h1: 1, p: 2}, contiene: [{tag, testo}], attributo: [{tag, nome, valore}],
 *   dentro: [[padre, figlio]], ordine: [tag, tag], nonContiene: [tag], testo: [...] }
 */
export function verificaHtml(sorgente, attesa = {}) {
  const albero = analizza(sorgente);
  const nodi = tutti(albero);
  const problemi = [];
  const p = (m) => problemi.push(m);

  for (const [tag, quanti] of Object.entries(attesa.elementi || {})) {
    const trovati = conTag(albero, tag).length;
    // Un numero e' esatto, true significa "almeno uno": la seconda forma serve
    // dove il conto non e' il punto dell'esercizio.
    if (quanti === true) {
      if (trovati === 0) p(`manca <${tag}>`);
    } else if (trovati !== quanti) {
      p(`attesi ${quanti} <${tag}>, ne ho trovati ${trovati}`);
    }
  }

  for (const tag of attesa.nonContiene || [])
    if (conTag(albero, tag).length) p(`<${tag}> non ci dovrebbe essere`);

  for (const atteso of attesa.contiene || []) {
    const candidati = conTag(albero, atteso.tag);
    if (!candidati.length) { p(`manca <${atteso.tag}>`); continue; }
    if (atteso.testo !== undefined &&
        !candidati.some((n) => normalizza(testoDi(n)) === normalizza(atteso.testo)))
      p(`nessun <${atteso.tag}> contiene esattamente "${atteso.testo}"`);
  }

  for (const atteso of attesa.attributo || []) {
    const candidati = conTag(albero, atteso.tag);
    if (!candidati.length) { p(`manca <${atteso.tag}>`); continue; }
    const ok = candidati.some((n) => {
      const v = n.attributi[atteso.nome.toLowerCase()];
      if (v === undefined) return false;
      return atteso.valore === undefined || normalizza(v) === normalizza(atteso.valore);
    });
    if (!ok)
      p(atteso.valore === undefined
        ? `a <${atteso.tag}> manca l'attributo ${atteso.nome}`
        : `nessun <${atteso.tag}> ha ${atteso.nome}="${atteso.valore}"`);
  }

  for (const [padre, figlio] of attesa.dentro || []) {
    const padri = conTag(albero, padre);
    const figli = conTag(albero, figlio);
    if (!padri.length) { p(`manca <${padre}>`); continue; }
    if (!figli.length) { p(`manca <${figlio}>`); continue; }
    if (!padri.some((a) => figli.some((b) => contiene(a, b))))
      p(`<${figlio}> deve stare dentro <${padre}>`);
  }

  if (attesa.ordine) {
    const posizioni = attesa.ordine.map((t) => nodi.findIndex((n) => n.tag === t.toLowerCase()));
    for (let k = 0; k < posizioni.length; k++) {
      if (posizioni[k] === -1) { p(`manca <${attesa.ordine[k]}>`); continue; }
      if (k && posizioni[k - 1] !== -1 && posizioni[k] < posizioni[k - 1])
        p(`<${attesa.ordine[k]}> deve venire dopo <${attesa.ordine[k - 1]}>`);
    }
  }

  for (const pezzo of attesa.testo || [])
    if (!normalizza(testoDi(albero)).includes(normalizza(pezzo)))
      p(`la pagina non contiene il testo "${pezzo}"`);

  return { ok: problemi.length === 0, problemi };
}
