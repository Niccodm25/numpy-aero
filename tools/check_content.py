"""Ogni soluzione deve passare il proprio test nascosto.

Gira con il NumPy locale, non con quello di Pyodide: cattura errori di contenuto
(test sbagliati, soluzioni che non risolvono), non differenze fra versioni.

    python tools/check_content.py
"""
import glob
import json
import os
import sys

import numpy as np

ROOT = os.path.join(os.path.dirname(__file__), "..")
errori = 0

for f in sorted(glob.glob(os.path.join(ROOT, "content", "m*.json"))):
    modulo = json.load(open(f, encoding="utf-8"))
    print(f"{modulo['id']} — {modulo['titolo']}")
    for e in modulo["esercizi"]:
        if e["tipo"] == "predict":
            if e["risposta"] not in e["opzioni"]:
                print(f"  {e['id']}: FALLITO — la risposta non e' fra le opzioni")
                errori += 1
            else:
                print(f"  {e['id']}: ok (predict, risposta verificata a mano)")
            continue
        ns = {"np": np}
        try:
            exec(e["soluzione"], ns)
            exec(e["test"], ns)
            print(f"  {e['id']}: ok")
        except Exception as ex:
            print(f"  {e['id']}: FALLITO — {type(ex).__name__}: {ex}")
            errori += 1

print()
print("tutto ok" if not errori else f"{errori} esercizi rotti")
sys.exit(1 if errori else 0)
