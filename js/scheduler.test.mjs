// node js/scheduler.test.mjs
import assert from "node:assert/strict";
import { newState, grade, isMastered, reviewQueue, pickNext, MASTERED } from "./scheduler.js";

// giusto al primo colpo, senza aiuti -> padroneggiato subito
let s = grade(newState("a"), true);
assert.equal(s.box, MASTERED);
assert.ok(isMastered(s));

// sbagliare azzera sempre, anche da padroneggiato
s = grade(s, false);
assert.equal(s.box, 0);
assert.equal(s.errori, 1);
assert.ok(!isMastered(s));

// dopo un errore servono MASTERED risposte corrette pulite
for (let i = 0; i < MASTERED; i++) {
  assert.ok(!isMastered(s), `non deve essere chiuso dopo ${i} successi`);
  s = grade(s, true);
}
assert.ok(isMastered(s));

// un hint riporta quasi da capo, anche se era avanti
assert.equal(grade(s, true, 1).box, 1);

// gli errori non si perdono: contano per l'ordinamento e per il leech
assert.equal(s.errori, 1);

// la coda mette per primi i box bassi, poi chi ha piu errori
const stati = {
  a: { id: "a", box: 2, errori: 0, tentativi: 3, ultimo: 1 },
  b: { id: "b", box: 0, errori: 1, tentativi: 1, ultimo: 2 },
  c: { id: "c", box: 0, errori: 5, tentativi: 6, ultimo: 3 },
  d: { id: "d", box: MASTERED, errori: 0, tentativi: 1, ultimo: 4 },
  e: { id: "e", box: 0, errori: 9, tentativi: 0, ultimo: 0 },
};
assert.deepEqual(reviewQueue(stati).map((x) => x.id), ["c", "b", "a"]);
assert.equal(pickNext(stati).id, "c");
assert.equal(pickNext(stati, "c").id, "b", "non deve riproporre subito lo stesso");

console.log("scheduler ok");
