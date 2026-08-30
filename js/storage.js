const KEY = "numpy-aero-v1";

const vuoto = () => ({ esercizi: {}, percorsi: {} });

export function load() {
  let raw;
  try {
    raw = JSON.parse(localStorage.getItem(KEY));
  } catch {
    return vuoto(); // private browsing, storage pieno, JSON corrotto: riparti pulito
  }
  if (!raw || typeof raw !== "object") return vuoto();
  // Il formato vecchio era la sola mappa degli stati per esercizio, senza
  // contenitore: si riconosce dall'assenza delle due chiavi note.
  if (!raw.esercizi && !raw.percorsi) return { esercizi: raw, percorsi: {} };
  return { esercizi: raw.esercizi || {}, percorsi: raw.percorsi || {} };
}

export function save(dati) {
  try {
    localStorage.setItem(KEY, JSON.stringify(dati));
  } catch {
    /* ponytail: se localStorage non c'è, l'app funziona lo stesso, senza memoria */
  }
}

export function esporta(dati) {
  const blob = new Blob([JSON.stringify(dati, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `numpy-aero-progressi-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function importa(file) {
  return file.text().then((t) => {
    const d = JSON.parse(t);
    if (typeof d !== "object" || d === null) throw new Error("File non valido");
    // Accetta anche gli export del formato vecchio.
    if (!d.esercizi && !d.percorsi) return { esercizi: d, percorsi: {} };
    return { esercizi: d.esercizi || {}, percorsi: d.percorsi || {} };
  });
}
