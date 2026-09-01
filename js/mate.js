// Formule: da LaTeX a MathML, senza librerie.
//
// Nelle lezioni di dinamica le equazioni stavano dentro blocchi di codice, in
// carattere fisso: `0.5 rho V^2 S C_L`. Si legge male e, soprattutto, non e' la
// notazione con cui e' scritto il libro — studiare su una trascrizione e poi
// trovarsi davanti la formula vera all'esame e' un passaggio in piu' che non
// serve a nessuno.
//
// Qui il LaTeX viene tradotto in MathML, che i browser sanno gia' disegnare:
// niente da scaricare, niente da installare, e funziona offline come tutto il
// resto dell'app.
//
// ponytail: si traduce il sottoinsieme di LaTeX che serve alle lezioni —
// frazioni, indici, radici, lettere greche, accenti, allineamenti — invece di
// portarsi dentro KaTeX (un megabyte fra codice e font) per avere anche
// \bordermatrix. Quello che manca si aggiunge qui, un comando alla volta.

const GRECHE = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ",
  tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π",
  Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  // ell: la elle corsiva del braccio di coda, che non e' una L qualunque.
  ell: "ℓ",
};

/** Simboli che si comportano da operatore: vanno in <mo>. */
const OPERATORI = {
  cdot: "⋅", times: "×", div: "÷", pm: "±", mp: "∓",
  approx: "≈", neq: "≠", ne: "≠", equiv: "≡", sim: "∼", propto: "∝",
  leq: "≤", le: "≤", geq: "≥", ge: "≥", ll: "≪", gg: "≫",
  to: "→", rightarrow: "→", Rightarrow: "⇒", leftarrow: "←", mapsto: "↦",
  iff: "⟺", Leftrightarrow: "⟺", leftrightarrow: "↔", implies: "⟹",
  infty: "∞", partial: "∂", nabla: "∇", sum: "∑", int: "∫", prod: "∏",
  in: "∈", notin: "∉", subset: "⊂", cup: "∪", cap: "∩",
  forall: "∀", exists: "∃", ldots: "…", cdots: "⋯", dots: "…",
  bullet: "•", bigl: "", bigr: "",
  perp: "⊥", parallel: "∥", angle: "∠", circ: "∘", ast: "∗", star: "⋆",
  langle: "⟨", rangle: "⟩", lVert: "‖", rVert: "‖", vert: "|",
};

/** Funzioni: si scrivono dritte, non in corsivo. E' la differenza fra il
 *  seno e il prodotto di s per e per n. */
const FUNZIONI = [
  "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan",
  "sinh", "cosh", "tanh", "log", "ln", "exp", "lim", "max", "min", "det",
  "arg", "deg", "gcd", "sup", "inf",
];

/** Accenti: il carattere combinante che va sopra il simbolo. */
const ACCENTI = {
  dot: "˙", ddot: "¨", bar: "¯", overline: "¯", hat: "^", widehat: "^",
  vec: "→", tilde: "~", check: "ˇ", breve: "˘",
};

const SPAZI = { ",": "0.17em", ";": "0.28em", "!": "-0.17em", " ": "0.25em", quad: "1em", qquad: "2em" };

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Divide il LaTeX in pezzi: comandi, gruppi, simboli, numeri. */
function pezzi(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "\\") {
      // \\ e' un a capo, non un comando.
      if (src[i + 1] === "\\") { out.push({ t: "capo" }); i += 2; continue; }
      let nome = "";
      i++;
      if (/[A-Za-z]/.test(src[i] ?? "")) {
        while (i < src.length && /[A-Za-z]/.test(src[i])) nome += src[i++];
      } else {
        nome = src[i++] ?? "";
      }
      out.push({ t: "cmd", v: nome });
      continue;
    }
    if (c === "{") { out.push({ t: "{" }); i++; continue; }
    if (c === "}") { out.push({ t: "}" }); i++; continue; }
    if (c === "^" || c === "_") { out.push({ t: c }); i++; continue; }
    if (c === "&") { out.push({ t: "&" }); i++; continue; }
    if (c === "'") { out.push({ t: "primo" }); i++; continue; }
    if (/[0-9]/.test(c)) {
      let n = "";
      while (i < src.length && /[0-9.]/.test(src[i])) n += src[i++];
      out.push({ t: "num", v: n });
      continue;
    }
    if (/[A-Za-z]/.test(c)) { out.push({ t: "id", v: c }); i++; continue; }
    out.push({ t: "sim", v: c });
    i++;
  }
  return out;
}

/** Da lista di pezzi a MathML. Restituisce una stringa di elementi. */
function costruisci(lista) {
  let i = 0;

  const mi = (s) => `<mi>${esc(s)}</mi>`;
  const mn = (s) => `<mn>${esc(s)}</mn>`;
  const mo = (s, extra = "") => `<mo${extra}>${esc(s)}</mo>`;
  const dritto = (s) => `<mi mathvariant="normal">${esc(s)}</mi>`;

  /** Un pezzo solo: quello che puo' stare sotto un indice o dentro una radice. */
  function atomo() {
    const p = lista[i];
    if (!p) return "";
    i++;

    if (p.t === "{") {
      const dentro = [];
      let profondita = 1;
      while (i < lista.length) {
        if (lista[i].t === "{") profondita++;
        if (lista[i].t === "}") { profondita--; if (!profondita) { i++; break; } }
        dentro.push(lista[i++]);
      }
      const html = costruisci(dentro);
      // Un gruppo con piu' di un elemento va tenuto insieme, altrimenti un
      // indice si prenderebbe solo l'ultimo pezzo.
      return `<mrow>${html}</mrow>`;
    }
    if (p.t === "num") return mn(p.v);
    if (p.t === "id") return mi(p.v);
    if (p.t === "sim") {
      if (p.v === "(" || p.v === ")" || p.v === "[" || p.v === "]" || p.v === "|") return mo(p.v, ' stretchy="true"');
      return mo(p.v);
    }
    if (p.t === "&" || p.t === "capo") return "";
    if (p.t === "primo") return mo("′");

    if (p.t === "cmd") {
      const n = p.v;
      if (n in GRECHE) return mi(GRECHE[n]);
      if (n in OPERATORI) return mo(OPERATORI[n]);
      if (FUNZIONI.includes(n)) return dritto(n);
      if (n in SPAZI) return `<mspace width="${SPAZI[n]}"></mspace>`;
      if (n in ACCENTI) return `<mover accent="true">${atomo()}${mo(ACCENTI[n])}</mover>`;
      if (n === "frac" || n === "dfrac" || n === "tfrac") {
        const sopra = atomo();
        const sotto = atomo();
        return `<mfrac>${sopra}${sotto}</mfrac>`;
      }
      if (n === "sqrt") {
        // \sqrt[3]{x}: l'indice sta fra parentesi quadre, prima del gruppo.
        if (lista[i] && lista[i].t === "sim" && lista[i].v === "[") {
          i++;
          const indice = [];
          while (lista[i] && !(lista[i].t === "sim" && lista[i].v === "]")) indice.push(lista[i++]);
          i++;
          return `<mroot>${atomo()}<mrow>${costruisci(indice)}</mrow></mroot>`;
        }
        return `<msqrt>${atomo()}</msqrt>`;
      }
      if (n === "mathcal" || n === "mathbb" || n === "mathfrak") {
        // I momenti aerodinamici del libro sono in calligrafico: L, M, N.
        const dentro = atomo().replace(/<[^>]+>/g, "");
        const variante = n === "mathcal" ? "script" : n === "mathbb" ? "double-struck" : "fraktur";
        return `<mi mathvariant="${variante}">${dentro}</mi>`;
      }
      if (n === "text" || n === "mathrm" || n === "mathbf" || n === "operatorname") {
        const dentro = atomo().replace(/<[^>]+>/g, "");
        const stile = n === "mathbf" ? ' mathvariant="bold"' : "";
        return n === "text" ? `<mtext>${dentro}</mtext>` : `<mi mathvariant="normal"${stile}>${dentro}</mi>`;
      }
      if (n === "left" || n === "right" || n === "big" || n === "Big") {
        const dopo = lista[i];
        if (dopo && (dopo.t === "sim" || dopo.t === "cmd")) {
          i++;
          const s = dopo.t === "sim" ? dopo.v : (OPERATORI[dopo.v] ?? "");
          return s === "." ? "" : mo(s, ' stretchy="true"');
        }
        return "";
      }
      if (n === "begin" || n === "end") {
        // L'ambiente lo gestisce chi chiama: qui si consuma solo il nome.
        atomo();
        return "";
      }
      // Un comando che non conosciamo si mostra com'e' scritto invece di
      // sparire: nascondere un pezzo di formula sarebbe la bugia peggiore.
      return `<mtext>\\${esc(n)}</mtext>`;
    }
    return "";
  }

  let fuori = "";
  while (i < lista.length) {
    const p = lista[i];
    if (p.t === "^" || p.t === "_") {
      i++;
      const su = p.t === "^";
      const base = fuori ? ultimoElemento(fuori) : "<mi></mi>";
      fuori = fuori.slice(0, fuori.length - base.length);
      const indice = atomo();
      // _a^b insieme: si guarda se subito dopo c'e' l'altro.
      const dopo = lista[i];
      if (dopo && (dopo.t === "^" || dopo.t === "_") && (dopo.t === "^") !== su) {
        i++;
        const altro = atomo();
        fuori += su ? `<msubsup>${base}${altro}${indice}</msubsup>` : `<msubsup>${base}${indice}${altro}</msubsup>`;
      } else {
        fuori += su ? `<msup>${base}${indice}</msup>` : `<msub>${base}${indice}</msub>`;
      }
      continue;
    }
    fuori += atomo();
  }
  return fuori;
}

/** L'ultimo elemento MathML di una stringa: serve per attaccarci un indice. */
function ultimoElemento(html) {
  const tag = html.match(/<(\/?)([a-z]+)[^>]*>$/);
  if (!tag) return html;
  const nome = tag[2];
  // Si risale fino all'apertura corrispondente, contando i tag annidati.
  let profondita = 0;
  const re = /<(\/?)([a-z]+)[^>]*>/g;
  const aperture = [];
  let m;
  while ((m = re.exec(html))) aperture.push({ chiudi: m[1] === "/", nome: m[2], da: m.index, a: re.lastIndex });
  for (let k = aperture.length - 1; k >= 0; k--) {
    const a = aperture[k];
    if (a.chiudi) profondita++;
    else profondita--;
    if (profondita === 0) return html.slice(a.da);
  }
  return html;
}

/** Ambienti allineati: aligned, cases, matrix. Diventano una tabella. */
function ambiente(nome, corpo) {
  const righe = [];
  let corrente = [[]];
  for (const p of pezzi(corpo)) {
    if (p.t === "capo") { righe.push(corrente); corrente = [[]]; continue; }
    if (p.t === "&") { corrente.push([]); continue; }
    corrente[corrente.length - 1].push(p);
  }
  righe.push(corrente);

  const celle = righe
    .filter((r) => r.some((c) => c.length))
    .map((r) => `<mtr>${r.map((c) => `<mtd>${costruisci(c)}</mtd>`).join("")}</mtr>`)
    .join("");

  const tabella = `<mtable columnalign="right left" columnspacing="0.3em">${celle}</mtable>`;
  if (nome === "cases") return `<mrow><mo stretchy="true">{</mo>${tabella}</mrow>`;
  if (nome === "bmatrix") return `<mrow><mo stretchy="true">[</mo>${tabella}<mo stretchy="true">]</mo></mrow>`;
  if (nome === "pmatrix") return `<mrow><mo stretchy="true">(</mo>${tabella}<mo stretchy="true">)</mo></mrow>`;
  return tabella;
}

/**
 * Da LaTeX a MathML. `display` distingue la formula in mezzo al testo da
 * quella su una riga sua.
 */
export function formula(src, display = false) {
  const testo = String(src ?? "").trim();
  const amb = testo.match(/^\\begin\{(aligned|align|cases|bmatrix|pmatrix|matrix)\}([\s\S]*?)\\end\{\1\}$/);
  const dentro = amb ? ambiente(amb[1], amb[2]) : costruisci(pezzi(testo));
  const attributi = display ? ' display="block"' : "";
  // Tutto dentro un <mrow>: senza, una formula a blocco con piu' elementi
  // finisce impilata in colonna invece che in riga.
  return `<math${attributi}><mrow>${dentro}</mrow></math>`;
}

/**
 * Sostituisce le formule dentro un testo: `$...$` in linea, `$$...$$` a blocco.
 *
 * Il dollaro singolo che capita in prosa (`$PATH`, `10$`) non e' una formula:
 * si apre solo se c'e' un altro dollaro sulla stessa riga, come in LaTeX.
 */
export function conFormule(testo, avvolgi = (html, display) => (display ? `<div class="formula">${html}</div>` : html)) {
  let fuori = String(testo ?? "");
  fuori = fuori.replace(/\$\$([\s\S]+?)\$\$/g, (_, f) => avvolgi(formula(f, true), true));
  fuori = fuori.replace(/\$([^$\n]+?)\$/g, (_, f) => avvolgi(formula(f, false), false));
  return fuori;
}
