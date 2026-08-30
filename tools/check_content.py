"""Ogni soluzione deve passare il proprio test nascosto.

    .venv/Scripts/python tools/check_content.py     (Windows)
    .venv/bin/python tools/check_content.py         (Linux, macOS)

Deve girare con lo stesso NumPy che Pyodide carica nel browser, altrimenti il
controllo non dice niente sul comportamento reale dell'app: fra 1.x e 2.x
cambiano nomi (trapz -> trapezoid) e spariscono funzioni (lookfor). Se la
versione non corrisponde, lo script si ferma e spiega come allineare.
"""
import json
import os
import sys

import numpy as np

ROOT = os.path.join(os.path.dirname(__file__), "..")

# La versione che Pyodide 0.28.3 carica nel browser. Se cambi la versione di
# Pyodide in js/runner.js, aggiorna anche questa e ricrea il venv.
NUMPY_PYODIDE = "2.2.5"

if np.__version__ != NUMPY_PYODIDE:
    sys.exit(
        f"NumPy {np.__version__}, ma l'app gira su {NUMPY_PYODIDE}.\n"
        f"Un controllo su una versione diversa non dice niente sull'app.\n\n"
        f"  python -m venv .venv\n"
        f"  .venv/Scripts/pip install numpy=={NUMPY_PYODIDE}\n"
        f"  .venv/Scripts/python tools/check_content.py"
    )

errori = 0

# L'elenco viene dall'indice, non da un glob: cosi il controllo copre esattamente
# i moduli che l'app carica, e un file nuovo non puo restare fuori per un pattern
# che non lo cattura.
indice = json.load(open(os.path.join(ROOT, "content", "index.json"), encoding="utf-8"))
attivi = [m for m in indice["moduli"] if m["disponibile"]]
print(f"moduli attivi nell'indice: {len(attivi)}\n")

for meta in attivi:
    f = os.path.join(ROOT, "content", meta["file"])
    if not os.path.exists(f):
        print(f"{meta['id']}: FALLITO — file mancante: {meta['file']}")
        errori += 1
        continue
    modulo = json.load(open(f, encoding="utf-8"))
    print(f"{modulo['id']} — {modulo['titolo']}")

    # Due formati: i moduli nuovi raggruppano per comando in "raccolte", i
    # vecchi hanno una lista piatta. Qui si appiattisce e si controlla tutto.
    if "raccolte" in modulo:
        esercizi = []
        for r in modulo["raccolte"]:
            print(f"  [{r['comando']}] {len(r['esercizi'])} esercizi")
            esercizi += r["esercizi"]
    else:
        esercizi = modulo["esercizi"]

    visti = set()
    for e in esercizi:
        if e["id"] in visti:
            print(f"  {e['id']}: FALLITO — id duplicato")
            errori += 1
        visti.add(e["id"])
        if e["tipo"] == "predict":
            if e["risposta"] not in e["opzioni"]:
                print(f"  {e['id']}: FALLITO — la risposta non e' fra le opzioni")
                errori += 1
            else:
                print(f"  {e['id']}: ok (predict, risposta verificata a mano)")
            continue
        if e["tipo"] in ("terminale", "html"):
            # Terminale e HTML girano su motori scritti in JavaScript: qui si
            # controlla solo che siano ben formati, e ogni soluzione viene
            # eseguita davvero da tools/test_shell.mjs.
            mancanti = [c for c in ("soluzione", "verifica") if c not in e]
            if mancanti:
                print(f"  {e['id']}: FALLITO — mancano {', '.join(mancanti)}")
                errori += 1
            else:
                print(f"  {e['id']}: ok ({e['tipo']}, verificato da test_shell.mjs)")
            continue
        ns = {"np": np}
        try:
            # Stesso ordine dell'app: prima i dati forniti, poi il codice scritto.
            exec(e.get("setup", ""), ns)
            exec(e["soluzione"], ns)
            exec(e["test"], ns)
            print(f"  {e['id']}: ok")
        except Exception as ex:
            print(f"  {e['id']}: FALLITO — {type(ex).__name__}: {ex}")
            errori += 1

print()
print("tutto ok" if not errori else f"{errori} esercizi rotti")
sys.exit(1 if errori else 0)
