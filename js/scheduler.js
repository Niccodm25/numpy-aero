// Sistema Leitner: un esercizio è "padroneggiato" solo dopo box === MASTERED.
// Sbagliare azzera sempre. Gli hint non contano come sapere.

export const MASTERED = 3;

export function newState(id) {
  return { id, box: 0, errori: 0, tentativi: 0, ultimo: 0 };
}

/**
 * @param {object} s      stato precedente
 * @param {boolean} ok    risposta corretta?
 * @param {number} hint   quanti hint ha aperto prima di rispondere
 */
export function grade(s, ok, hint = 0) {
  const n = { ...s, tentativi: s.tentativi + 1, ultimo: Date.now() };
  if (!ok) {
    n.box = 0;
    n.errori = s.errori + 1;
  } else if (hint > 0) {
    n.box = 1; // aiutato: riparte quasi da capo, anche se era avanti
  } else if (s.tentativi === 0) {
    n.box = MASTERED; // giusto al primo colpo, senza aiuti: lo sai
  } else {
    n.box = Math.min(MASTERED, s.box + 1);
  }
  return n;
}

export const isMastered = (s) => s.box >= MASTERED;

/** Esercizi ancora da consolidare, i più deboli per primi.
 *  Le fasi dei cantieri restano fuori: sono progetti aperti, non esercizi
 *  meccanici, e ripeterli finche' non sono "perfetti" non insegna niente. */
export function reviewQueue(states) {
  return Object.values(states)
    .filter((s) => s.tentativi > 0 && !s.fuoriRipasso && !isMastered(s))
    .sort((a, b) => a.box - b.box || b.errori - a.errori || a.ultimo - b.ultimo);
}

/** Prossimo da servire, evitando di ripetere subito lo stesso. */
export function pickNext(states, escludi = null) {
  const q = reviewQueue(states);
  // ponytail: nessuna spaziatura temporale, solo "non due volte di fila".
  // Se servisse vera spaziatura, filtrare su (Date.now() - s.ultimo).
  return q.find((s) => s.id !== escludi) || q[0] || null;
}

/** errori >= LEECH: il problema è il concetto, non l'esercizio. */
export const LEECH = 4;
export const isLeech = (s) => s.errori >= LEECH;

export function progress(states, ids) {
  const done = ids.filter((id) => states[id] && isMastered(states[id])).length;
  return { done, tot: ids.length, pct: ids.length ? done / ids.length : 0 };
}
