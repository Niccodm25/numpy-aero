// Controllo del traduttore LaTeX -> MathML.
//
//     node tools/test_mate.mjs
//
// Si controlla il MathML prodotto, non il disegno: quello lo fa il browser.
// Ogni caso e' un pezzo di formula che compare davvero nelle lezioni.

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { formula, conFormule } from "../js/mate.js";

let fatti = 0;
let falliti = 0;
const casi = [];
const caso = (nome, fn) => casi.push([nome, fn]);

caso("indici e apici", () => {
  assert.equal(formula("C_L"), "<math><mrow><msub><mi>C</mi><mi>L</mi></msub></mrow></math>");
  assert.match(formula("V^2"), /<msup><mi>V<\/mi><mn>2<\/mn><\/msup>/);
  assert.match(formula("x_{eq}"), /<msub><mi>x<\/mi><mrow><mi>e<\/mi><mi>q<\/mi><\/mrow><\/msub>/);
  assert.match(formula("C_{m_\\alpha}"), /<msub><mi>m<\/mi><mi>α<\/mi><\/msub>/, "indice dentro indice");
  assert.match(formula("I_{xz}"), /<mrow><mi>x<\/mi><mi>z<\/mi><\/mrow>/);
});

caso("apice e pedice insieme, in qualunque ordine", () => {
  assert.match(formula("x_a^b"), /<msubsup><mi>x<\/mi><mi>a<\/mi><mi>b<\/mi><\/msubsup>/);
  assert.match(formula("x^b_a"), /<msubsup><mi>x<\/mi><mi>a<\/mi><mi>b<\/mi><\/msubsup>/);
});

caso("l'indice si attacca a tutto il gruppo, non all'ultima lettera", () => {
  // (a+b)^2: l'esponente prende la parentesi chiusa se non si guarda il gruppo.
  assert.match(formula("{a+b}^2"), /<msup><mrow><mi>a<\/mi><mo>\+<\/mo><mi>b<\/mi><\/mrow><mn>2<\/mn><\/msup>/);
});

caso("lettere greche e operatori", () => {
  assert.match(formula("\\alpha + \\gamma"), /<mi>α<\/mi><mo>\+<\/mo><mi>γ<\/mi>/);
  assert.match(formula("E \\gg 1"), /<mo>≫<\/mo>/);
  assert.match(formula("a \\approx b"), /<mo>≈<\/mo>/);
  assert.match(formula("\\Delta"), /<mi>Δ<\/mi>/);
});

caso("frazioni, radici, accenti", () => {
  assert.match(formula("\\frac{1}{2}"), /<mfrac><mrow><mn>1<\/mn><\/mrow><mrow><mn>2<\/mn><\/mrow><\/mfrac>/);
  assert.match(formula("\\sqrt{u^2+w^2}"), /<msqrt>/);
  assert.match(formula("\\sqrt[3]{x}"), /<mroot>/);
  assert.match(formula("\\dot{u}"), /<mover accent="true"><mrow><mi>u<\/mi><\/mrow><mo>˙<\/mo><\/mover>/);
  assert.match(formula("\\bar{c}"), /<mo>¯<\/mo>/);
});

caso("le funzioni si scrivono dritte", () => {
  assert.match(formula("\\sin\\alpha"), /<mi mathvariant="normal">sin<\/mi><mi>α<\/mi>/);
  assert.match(formula("\\cos(\\alpha)"), /<mi mathvariant="normal">cos<\/mi>/);
});

caso("una formula intera di lezione", () => {
  const out = formula("\\tfrac{1}{2}\\rho V^2 S\\, C_L + T\\sin(\\alpha+\\eta_T) - mg\\cos\\gamma = 0", true);
  assert.match(out, /^<math display="block">/);
  assert.match(out, /<mi>ρ<\/mi>/);
  assert.match(out, /<mspace/);
  assert.match(out, /<msub><mi>η<\/mi><mi>T<\/mi><\/msub>/);
});

caso("gli ambienti allineati diventano una tabella", () => {
  const out = formula("\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}", true);
  assert.match(out, /<mtable/);
  assert.equal((out.match(/<mtr>/g) || []).length, 2);
  assert.equal((out.match(/<mtd>/g) || []).length, 4);
});

caso("un comando sconosciuto si vede, non sparisce", () => {
  assert.match(formula("\\bordermatrix"), /<mtext>\\bordermatrix<\/mtext>/);
});

caso("il minore e la e commerciale non rompono l'HTML", () => {
  assert.ok(!formula("a < b").includes("<mo><</mo>"), "il minore va scritto come entita'");
  assert.match(formula("a < b"), /&lt;/);
});

caso("conFormule riconosce in linea e a blocco", () => {
  const t = conFormule("prima $x^2$ dopo\n\n$$a+b$$");
  assert.match(t, /prima <math><mrow><msup>/);
  assert.match(t, /<div class="formula"><math display="block">/);
});

caso("un dollaro solo in prosa resta un dollaro", () => {
  assert.equal(conFormule("costa 10$ e basta"), "costa 10$ e basta");
  assert.equal(conFormule("la variabile $PATH\ne il resto"), "la variabile $PATH\ne il resto");
});

// ---------- le lezioni dei moduli ----------
//
// Ogni formula scritta nelle lezioni deve tradursi senza lasciare comandi
// sconosciuti in giro: un `\qualcosa` a schermo e' un errore che si vede.

const indice = JSON.parse(readFileSync(new URL("../content/index.json", import.meta.url)));
for (const meta of indice.moduli) {
  if (!meta.disponibile) continue;
  const mod = JSON.parse(readFileSync(new URL("../content/" + meta.file, import.meta.url)));
  for (const lez of mod.lezioni || []) {
    const formule = [...(lez.md || "").matchAll(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g)];
    if (!formule.length) continue;
    caso(`${lez.id}: le ${formule.length} formule si traducono`, () => {
      for (const m of formule) {
        const testo = m[1] ?? m[2];
        const out = formula(testo, !!m[1]);
        const rimasti = out.match(/<mtext>\\[A-Za-z]+<\/mtext>/g);
        assert.equal(rimasti, null, `comando non tradotto in «${testo}»: ${rimasti}`);
      }
    });
  }
}

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
