// Percorso di apprendimento: cicli a rotazione sugli argomenti di un modulo.
// Un argomento e' un comando (np.arange, .shape, ...), non una lezione.
//
// Il percorso si chiude su DUE cicli puliti consecutivi, il secondo tutto di
// scrittura. Il ciclo in cui si riparano gli errori non conta come primo dei due.

export const TETTO_EXTRA = 2; // massimo 3 esercizi per argomento in un ciclo
export const PULITI_PER_RIDURRE = 5;
export const PASSO_MAX = 3; // al massimo 1 ciclo su 4

const somma = (o) => Object.values(o).reduce((a, b) => a + b, 0);

export function nuovo(argomenti) {
  const per = (v) => Object.fromEntries(argomenti.map((a) => [a, v]));
  const s = {
    argomenti,
    extra: per(0), // extra che compariranno nel PROSSIMO ciclo
    puliti: per(0), // cicli puliti consecutivi
    passo: per(0), // gradino di frequenza ridotta
    salta: per(0), // cicli ancora da saltare
    streak: 0, // cicli puliti validi verso la chiusura
    fatti: 0, // esercizi presentati
    ciclo: 0,
    coda: [],
    cicloPulito: true,
    cicloAvevaExtra: false,
    erroriCiclo: {},
    presenti: [], // argomenti interrogati nel ciclo corrente
    completo: false,
  };
  costruisciCiclo(s);
  return s;
}

/** Il prossimo slot da servire, o null se il percorso e' chiuso. */
export function prossimo(s) {
  return s.completo ? null : s.coda[0] || null;
}

/** Registra la risposta allo slot corrente e avanza. */
export function rispondi(s, ok) {
  if (s.completo || !s.coda.length) return s;
  const slot = s.coda.shift();
  s.fatti += 1;
  if (!ok) {
    s.erroriCiclo[slot.arg] = true;
    s.cicloPulito = false;
  }
  if (!s.coda.length) chiudiCiclo(s);
  return s;
}

function chiudiCiclo(s) {
  for (const a of s.presenti) {
    if (s.erroriCiclo[a]) {
      s.extra[a] = Math.min(s.extra[a] + 1, TETTO_EXTRA);
      s.puliti[a] = 0;
      s.passo[a] = 0;
      s.salta[a] = 0;
    } else {
      s.puliti[a] += 1;
      if (s.extra[a] > 0) s.extra[a] -= 1; // premio: un extra in meno per ciclo pulito
    }
  }

  // Un ciclo con extra e' di riparazione: non conta verso la coppia finale.
  s.streak = s.cicloPulito ? (s.cicloAvevaExtra ? 0 : s.streak + 1) : 0;
  if (s.streak >= 2) {
    s.completo = true;
    s.coda = [];
    return;
  }

  // Frequenza ridotta: chi risponde bene da PULITI_PER_RIDURRE cicli compare
  // sempre piu di rado, e il salto cresce a ogni ulteriore ciclo pulito.
  for (const a of s.presenti) {
    if (s.puliti[a] >= PULITI_PER_RIDURRE && s.extra[a] === 0) {
      s.passo[a] = Math.min(s.passo[a] + 1, PASSO_MAX);
      s.salta[a] = s.passo[a];
    }
  }

  costruisciCiclo(s);
}

function costruisciCiclo(s) {
  s.ciclo += 1;
  s.cicloPulito = true;
  s.erroriCiclo = {};

  // Il ciclo di chiusura interroga sempre tutti, anche chi e' in frequenza
  // ridotta: altrimenti la riduzione impedirebbe al percorso di chiudersi.
  const chiusura = s.streak === 1 && somma(s.extra) === 0;

  const attivi = chiusura
    ? s.argomenti.slice()
    : s.argomenti.filter((a) => s.salta[a] === 0);
  for (const a of s.argomenti) {
    if (!chiusura && s.salta[a] > 0) s.salta[a] -= 1;
  }

  const tipo = chiusura ? "write" : "libero";
  const base = attivi.map((a) => ({ arg: a, tipo }));

  // Gli extra vanno SEMPRE in coda al ciclo, mai affiancati allo slot normale.
  const extra = [];
  for (const a of attivi) {
    for (let i = 0; i < s.extra[a]; i++) extra.push({ arg: a, tipo });
  }

  s.cicloAvevaExtra = extra.length > 0;
  s.presenti = attivi;
  s.coda = base.concat(extra);
  s.chiusura = chiusura;
}

/**
 * Totale di esercizi previsto fino alla chiusura, assumendo che da qui in
 * avanti vada tutto bene. E' il denominatore della percentuale, e cresce a
 * ogni errore: per questo la barra puo scendere.
 */
export function proiezione(s) {
  if (s.completo) return s.fatti;
  let tot = s.fatti + s.coda.length; // finisce il ciclo corrente

  // Copia dello stato, fatta evolvere in avanti come se ogni risposta da qui
  // fosse corretta. Simulare invece di stimare e' l'unico modo di tenere conto
  // della frequenza ridotta: un argomento saltato non occupa uno slot, e
  // contarlo comunque gonfierebbe il denominatore.
  const extra = { ...s.extra };
  const puliti = { ...s.puliti };
  const passo = { ...s.passo };
  const salta = { ...s.salta };

  // s.extra sono gli extra GIA nella coda corrente, non in aggiunta: il ciclo
  // in corso va fatto evolvere una volta, altrimenti verrebbe contato due volte.
  maturaCiclo(s.presenti, s.erroriCiclo, { extra, puliti, passo, salta });
  let streak = s.cicloPulito ? (s.cicloAvevaExtra ? 0 : s.streak + 1) : 0;

  let guardia = 0;
  while (streak < 2 && guardia++ < 500) {
    const chiusura = streak === 1 && somma(extra) === 0;
    const attivi = chiusura ? s.argomenti : s.argomenti.filter((a) => salta[a] === 0);
    if (!chiusura) for (const a of s.argomenti) if (salta[a] > 0) salta[a] -= 1;

    let n = attivi.length;
    let avevaExtra = false;
    for (const a of attivi) {
      n += extra[a];
      if (extra[a] > 0) avevaExtra = true;
    }
    tot += n;

    maturaCiclo(attivi, {}, { extra, puliti, passo, salta });
    streak = avevaExtra ? 0 : streak + 1; // la riparazione non conta
  }

  return tot;
}

/** Applica a fine ciclo le stesse regole di chiudiCiclo, su uno stato copiato. */
function maturaCiclo(presenti, errori, st) {
  for (const a of presenti) {
    if (errori[a]) {
      st.extra[a] = Math.min(st.extra[a] + 1, TETTO_EXTRA);
      st.puliti[a] = 0;
      st.passo[a] = 0;
      st.salta[a] = 0;
    } else {
      st.puliti[a] += 1;
      if (st.extra[a] > 0) st.extra[a] -= 1;
    }
  }
  for (const a of presenti) {
    if (st.puliti[a] >= PULITI_PER_RIDURRE && st.extra[a] === 0) {
      st.passo[a] = Math.min(st.passo[a] + 1, PASSO_MAX);
      st.salta[a] = st.passo[a];
    }
  }
}

export function percentuale(s) {
  const tot = proiezione(s);
  return tot ? Math.round((s.fatti / tot) * 1000) / 10 : 0;
}
