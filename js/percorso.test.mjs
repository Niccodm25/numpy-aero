// node js/percorso.test.mjs
// Riproduce gli esempi concordati: se questi passano, il motore fa quello che
// ci siamo detti.
import assert from "node:assert/strict";
import { nuovo, prossimo, rispondi, percentuale, proiezione, TETTO_EXTRA } from "./percorso.js";

const ARG = ["a", "b", "c", "d", "e"];
const ciclo = (s) => s.coda.map((x) => x.arg).join(" ");

// ---------- Esempio 1: percorso pulito, 2 cicli da 5 ----------
{
  const s = nuovo(ARG);
  assert.equal(ciclo(s), "a b c d e");
  assert.equal(proiezione(s), 10, "piano iniziale: 10 esercizi");
  assert.equal(percentuale(s), 0);

  for (let i = 0; i < 5; i++) rispondi(s, true);
  assert.equal(percentuale(s), 50, "meta percorso dopo il primo ciclo pulito");
  assert.equal(s.streak, 1);
  assert.ok(s.chiusura, "il secondo ciclo e' quello di chiusura");
  assert.ok(s.coda.every((x) => x.tipo === "write"), "chiusura tutta di scrittura");

  for (let i = 0; i < 5; i++) rispondi(s, true);
  assert.ok(s.completo);
  assert.equal(percentuale(s), 100);
  assert.equal(s.fatti, 10);
  assert.equal(prossimo(s), null);
}

// ---------- Esempio 2: un errore, la traiettoria esatta della barra ----------
{
  const s = nuovo(ARG);
  const attesa = [];

  rispondi(s, true);                       // a
  attesa.push(percentuale(s));             // 10.0  -> piano ancora 10
  rispondi(s, false);                      // b sbagliato
  attesa.push(percentuale(s));             // 9.5   -> piano salta a 21
  assert.equal(proiezione(s), 21, "5 + 6 + 5 + 5");
  rispondi(s, true); attesa.push(percentuale(s));   // c
  rispondi(s, true); attesa.push(percentuale(s));   // d
  rispondi(s, true); attesa.push(percentuale(s));   // e

  assert.deepEqual(attesa, [10, 9.5, 14.3, 19, 23.8], "traiettoria del primo ciclo");

  // ciclo 2: rotazione completa + l'extra di b IN CODA
  assert.equal(ciclo(s), "a b c d e b", "gli extra vanno in fondo, non affiancati");
  assert.equal(s.coda.length, 6);
  for (let i = 0; i < 6; i++) rispondi(s, true);
  assert.equal(percentuale(s), 52.4);
  assert.equal(s.streak, 0, "la riparazione non conta come strike");
  assert.equal(s.extra.b, 0, "premio: un extra tolto dopo il ciclo pulito");

  // ciclo 3: strike 1
  assert.equal(ciclo(s), "a b c d e");
  for (let i = 0; i < 5; i++) rispondi(s, true);
  assert.equal(percentuale(s), 76.2);
  assert.equal(s.streak, 1);

  // ciclo 4: strike 2, tutta scrittura
  assert.ok(s.coda.every((x) => x.tipo === "write"));
  for (let i = 0; i < 5; i++) rispondi(s, true);
  assert.ok(s.completo);
  assert.equal(s.fatti, 21, "quattro cicli: 5 + 6 + 5 + 5");
  assert.equal(percentuale(s), 100);
}

// ---------- Esempio 3: errore ostinato su un argomento ----------
{
  const s = nuovo(ARG);
  const rispondiCiclo = (esiti) => esiti.forEach((ok) => rispondi(s, ok));

  // ciclo 1: sbaglia c
  rispondiCiclo([true, true, false, true, true]);
  assert.equal(s.extra.c, 1);
  assert.equal(ciclo(s), "a b c d e c");

  // ciclo 2: sbaglia c allo slot normale, giusto l'extra -> non e' pulito
  rispondiCiclo([true, true, false, true, true, true]);
  assert.equal(s.extra.c, TETTO_EXTRA, "un secondo errore porta c al tetto");
  assert.equal(ciclo(s), "a b c d e c c", "tre esercizi di c, i due extra in coda");

  // ciclo 3: sbaglia ancora
  rispondiCiclo([true, true, true, true, true, true, false]);
  assert.equal(s.extra.c, TETTO_EXTRA, "resta al tetto, non cresce oltre");

  // ciclo 4: tutto giusto -> riparazione, un extra in meno
  rispondiCiclo([true, true, true, true, true, true, true]);
  assert.equal(s.streak, 0, "riparazione: non conta");
  assert.equal(s.extra.c, 1);
  assert.equal(ciclo(s), "a b c d e c");

  // ciclo 5: tutto giusto -> ancora riparazione (restava un extra)
  rispondiCiclo([true, true, true, true, true, true]);
  assert.equal(s.extra.c, 0);
  assert.equal(s.streak, 0);

  // a b d e hanno ora 5 cicli puliti di fila: scatta la frequenza ridotta
  assert.equal(s.puliti.a, 5);
  assert.equal(s.passo.a, 1, "primo gradino: 1 ciclo su 2");
  assert.ok(!ciclo(s).includes("a"), "a salta questo ciclo");
  assert.ok(ciclo(s).includes("c"), "c invece c'e', non ha ancora 5 cicli puliti");

  // ciclo 6: strike 1 (senza a b d e)
  const n6 = s.coda.length;
  for (let i = 0; i < n6; i++) rispondi(s, true);
  assert.equal(s.streak, 1);

  // ciclo 7: chiusura -> interroga TUTTI, anche chi era in frequenza ridotta
  assert.equal(s.coda.length, 5, "il ciclo di chiusura ignora la frequenza ridotta");
  assert.ok(s.coda.every((x) => x.tipo === "write"));
  for (let i = 0; i < 5; i++) rispondi(s, true);
  assert.ok(s.completo);
}

// ---------- La barra scende davvero quando si sbaglia ----------
{
  const s = nuovo(ARG);
  rispondi(s, true);
  rispondi(s, true);
  const prima = percentuale(s);
  rispondi(s, false);
  const dopo = percentuale(s);
  assert.ok(dopo < prima, `la barra deve scendere: ${prima} -> ${dopo}`);
}

// ---------- Un modulo vero: 10 argomenti ----------
{
  const dieci = "abcdefghij".split("");
  const s = nuovo(dieci);
  assert.equal(proiezione(s), 20, "percorso perfetto di M1: 20 esercizi");
  for (let i = 0; i < 20; i++) rispondi(s, true);
  assert.ok(s.completo);
  assert.equal(percentuale(s), 100);
}

// ---------- La proiezione deve essere esatta, non una stima ----------
// Il controllo piu forte possibile: si clona lo stato, si gioca davvero fino
// alla chiusura rispondendo sempre bene, e si confronta con quanto previsto.
function verificaProiezione(s, dove) {
  if (s.completo) return;
  const previsto = proiezione(s);
  const c = structuredClone(s);
  let g = 0;
  while (!c.completo && g++ < 500) rispondi(c, true);
  assert.ok(c.completo, `${dove}: il percorso non si chiude`);
  assert.equal(c.fatti, previsto, `${dove}: previsti ${previsto}, giocati ${c.fatti}`);
}

{
  // Sequenza deterministica di errori, pensata per portare alcuni argomenti in
  // frequenza ridotta mentre uno resta in riparazione: e' il caso che la
  // proiezione sbagliava, contando anche gli argomenti saltati.
  const s = nuovo(ARG);
  let n = 0;
  let visti = 0;
  while (!s.completo && n++ < 400) {
    verificaProiezione(s, `passo ${n}`);
    const slot = prossimo(s);
    // sbaglia "c" per i primi sei incontri, poi sempre giusto
    const sbaglia = slot.arg === "c" && visti < 6;
    if (slot.arg === "c") visti++;
    rispondi(s, !sbaglia);
  }
  assert.ok(s.completo, "il percorso si chiude anche dopo molti errori");
  assert.ok(Object.values(s.passo).some((p) => p > 0), "qualche argomento ha ridotto la frequenza");
}

console.log("percorso ok");
