// Esegue NumPy vero nel browser via Pyodide (WebAssembly). Nessun backend.
const CDN = "https://cdn.jsdelivr.net/pyodide/v0.28.3/full/";

let py = null;
let avvio = null;

export function boot(onStatus) {
  if (avvio) return avvio;
  avvio = (async () => {
    onStatus?.("Scarico Python… (~12 MB, solo la prima volta)");
    const { loadPyodide } = await import(CDN + "pyodide.mjs");
    py = await loadPyodide({ indexURL: CDN });
    onStatus?.("Carico NumPy…");
    await py.loadPackage("numpy");
    const v = py.runPython("import numpy as np; np.__version__");
    onStatus?.(null);
    return v;
  })();
  return avvio;
}

export const pronto = () => py !== null;

/**
 * Esegue il codice dell'utente, poi le asserzioni nascoste, nello stesso namespace.
 * @returns {{ok:boolean, out:string, err:string|null, fase:'codice'|'test'|null}}
 */
export async function run(code, test = "") {
  await boot();
  let out = "";
  const cattura = { batched: (t) => (out += t + "\n") };
  py.setStdout(cattura);
  py.setStderr(cattura);

  const ns = py.globals.get("dict")(); // namespace pulito: gli esercizi non si contaminano
  try {
    py.runPython("import numpy as np", { globals: ns });
    try {
      py.runPython(code, { globals: ns });
    } catch (e) {
      return { ok: false, out, err: ultimaRiga(e.message), fase: "codice" };
    }
    if (!test) return { ok: true, out, err: null, fase: null };
    try {
      py.runPython(test, { globals: ns });
    } catch (e) {
      return { ok: false, out, err: ultimaRiga(e.message), fase: "test" };
    }
    return { ok: true, out, err: null, fase: null };
  } finally {
    ns.destroy();
  }
}

// Il traceback di Pyodide è lungo; all'utente serve solo l'ultima riga.
function ultimaRiga(msg = "") {
  const righe = msg.trim().split("\n").filter((r) => r.trim());
  return righe[righe.length - 1] || msg;
}
