const KEY = "numpy-aero-v1";

export function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {}; // private browsing, storage pieno, JSON corrotto: riparti pulito
  }
}

export function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* ponytail: se localStorage non c'è, l'app funziona lo stesso, senza memoria */
  }
}

export function esporta(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
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
    return d;
  });
}
