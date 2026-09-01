// Controllo del motore di fisica e dei moduli che lo usano.
//
//     node tools/test_fisica.mjs
//
// Due parti, come per la shell: una lista di casi sul valutatore, e la
// riesecuzione di **ogni soluzione** dichiarata nei moduli contro la sua stessa
// verifica. Se una soluzione non passa, e' sbagliata la soluzione — o il
// numero atteso — non il test.
//
// C'e' un controllo in piu' che la shell non puo' fare: per ogni esercizio di
// formula si prova anche una risposta *storta* (la stessa formula con un segno
// cambiato) e si pretende che venga rifiutata. Una verifica che accetta tutto
// e' peggio che nessuna verifica.

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { compila, valuta, equivalenti, simboliDi, verificaFisica, ErroreFormula } from "../js/fisica.js";

let fatti = 0;
const casi = [];
const caso = (nome, fn) => casi.push([nome, fn]);

// ---------- il valutatore ----------

caso("le quattro operazioni e la precedenza", () => {
  assert.equal(valuta("2 + 3*4"), 14);
  assert.equal(valuta("(2 + 3)*4"), 20);
  assert.equal(valuta("2^3^2"), 512, "la potenza si associa a destra");
  assert.equal(valuta("2**3"), 8, "anche la forma di Python");
  assert.equal(valuta("-3 + 1"), -2);
  assert.equal(valuta("1e-3"), 0.001);
});

caso("simboli, costanti e funzioni", () => {
  assert.equal(valuta("alpha + gamma", { alpha: 2, gamma: 3 }), 5);
  assert.equal(valuta("C_L*2", { C_L: 1.5 }), 3);
  assert.ok(Math.abs(valuta("sin(pi/2)") - 1) < 1e-12);
  assert.ok(Math.abs(valuta("m*g", { m: 2 }) - 19.62) < 1e-9, "g vale 9.81 se non lo dichiari");
  assert.throws(() => valuta("zibaldone + 1"), ErroreFormula);
  assert.throws(() => valuta("sen(0.2)"), ErroreFormula, "una funzione inventata non passa");
});

caso("una formula rotta lo dice, non risponde a caso", () => {
  assert.throws(() => compila("C_L*sin("), ErroreFormula);
  assert.throws(() => compila("2 +"), ErroreFormula);
  assert.throws(() => compila(""), ErroreFormula);
  assert.throws(() => compila("2 $ 3"), ErroreFormula);
  assert.throws(() => compila("2 3"), ErroreFormula, "due numeri attaccati non sono un prodotto");
});

caso("simboliDi vede i nomi e non le funzioni", () => {
  assert.deepEqual(simboliDi("C_L*sin(alpha) - C_D*cos(alpha)").sort(), ["C_D", "C_L", "alpha"]);
});

caso("l'equivalenza guarda i valori, non il testo", () => {
  assert.equal(equivalenti("a + b", "b + a").ok, true);
  assert.equal(equivalenti("-C_D*cos(x) + C_L*sin(x)", "C_L*sin(x) - C_D*cos(x)").ok, true);
  assert.equal(equivalenti("a + b", "a - b").ok, false);
  assert.equal(equivalenti("sin(x)^2 + cos(x)^2", "1").ok, true, "vale un'identita' trigonometrica");
});

caso("il dominio conta: due formule uguali solo in mezzo campo", () => {
  const d = { u: [50, 200], w: [1, 20] };
  assert.equal(equivalenti("sqrt(u^2 + w^2)", "u/cos(atan(w/u))", d).ok, true);
  // Con u negativo la seconda cambia segno: fuori dal dominio dichiarato non
  // sono la stessa funzione, ed e' giusto che l'esercizio dichiari il dominio.
  assert.equal(equivalenti("sqrt(u^2 + w^2)", "u/cos(atan(w/u))", { u: [-200, -50], w: [1, 20] }).ok, false);
});

caso("insieme e ordina non guardano la punteggiatura", () => {
  assert.equal(verificaFisica("insieme", "q, p ,r", { insieme: ["p", "q", "r"] }).ok, true);
  assert.equal(verificaFisica("insieme", "p q", { insieme: ["p", "q", "r"] }).ok, false);
  assert.equal(verificaFisica("insieme", "p q r s", { insieme: ["p", "q", "r"] }).ok, false);
  assert.equal(verificaFisica("ordina", "ST RE", { ordine: ["ST", "RE"] }).ok, true);
  assert.equal(verificaFisica("ordina", "RE ST", { ordine: ["ST", "RE"] }).ok, false);
});

caso("usa e senza chiudono le scorciatoie", () => {
  const attesa = { equivale: "atan(w/u)", usa: ["u", "w"], senza: ["V"], dominio: { u: [50, 200], w: [1, 20] } };
  assert.equal(verificaFisica("formula", "atan(w/u)", attesa).ok, true);
  assert.equal(verificaFisica("formula", "asin(w/V)", { ...attesa, senza: ["V"] }).ok, false);
});

// ---------- le soluzioni dei moduli ----------

const TIPI = ["formula", "numerico", "ordina", "insieme"];

/** Una risposta storta, per verificare che la verifica non accetti tutto. */
function storta(es) {
  if (es.tipo === "formula") return `-(${es.soluzione})`;
  // Meta' in piu': deve cadere fuori tolleranza qualunque sia la scala del numero.
  if (es.tipo === "numerico") return `(${es.soluzione}) * 1.5 + 1`;
  if (es.tipo === "ordina") return es.verifica.ordine.slice().reverse().join(" ");
  return es.verifica.insieme.slice(0, -1).join(" ");
}

const indice = JSON.parse(readFileSync(new URL("../content/index.json", import.meta.url)));
for (const meta of indice.moduli) {
  if (!meta.disponibile) continue;
  const mod = JSON.parse(readFileSync(new URL("../content/" + meta.file, import.meta.url)));
  for (const g of mod.raccolte || [{ esercizi: mod.esercizi || [] }]) {
    for (const es of g.esercizi) {
      if (!TIPI.includes(es.tipo)) continue;

      caso(`${es.id}: la soluzione passa la verifica`, () => {
        const esito = verificaFisica(es.tipo, es.soluzione, es.verifica);
        assert.equal(esito.ok, true, esito.problemi.join("; "));
      });

      caso(`${es.id}: una risposta sbagliata viene rifiutata`, () => {
        const esito = verificaFisica(es.tipo, storta(es), es.verifica);
        assert.equal(esito.ok, false, `accetta anche «${storta(es)}»`);
      });
    }
  }
}

// ---------- esecuzione ----------

let falliti = 0;
for (const [nome, fn] of casi) {
  try {
    fn();
    fatti++;
  } catch (e) {
    falliti++;
    console.log("FALLITO  " + nome);
    console.log("         " + (e.message || e));
  }
}
console.log(`${fatti} casi ok, ${falliti} falliti`);
process.exit(falliti ? 1 : 0);
