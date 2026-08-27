// Markdown minimo: blocchi di codice, titoli, liste, inline code, grassetto.
// ponytail: basta per il testo delle lezioni. Se un giorno serve altro -> marked.js.

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function md(src = "") {
  const code = [];
  // I blocchi ``` vengono estratti prima di tutto, così il loro contenuto
  // non viene toccato dalle regole inline. Sentinella improbabile in prosa.
  let t = esc(src).replace(/```(?:\w+)?\n([\s\S]*?)```/g, (_, c) => {
    code.push(c.replace(/\n+$/, ""));
    return `@@CODE${code.length - 1}@@`;
  });

  t = t
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");

  const html = t
    .split(/\n{2,}/)
    .map((b) => {
      b = b.trim();
      if (!b) return "";
      if (/^@@CODE\d+@@$/.test(b)) return b;
      if (b.startsWith("### ")) return `<h4>${b.slice(4)}</h4>`;
      if (b.startsWith("## ")) return `<h3>${b.slice(3)}</h3>`;
      if (tabella(b)) return tabella(b);
      if (b.split("\n").every((l) => /^[-*] /.test(l.trim())))
        return `<ul>${b.split("\n").map((l) => `<li>${l.trim().slice(2)}</li>`).join("")}</ul>`;
      return `<p>${b.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");

  return html.replace(/@@CODE(\d+)@@/g, (_, i) => `<pre><code>${code[i]}</code></pre>`);
}

// Tabella pipe: intestazione, riga di separatori, righe. Restituisce null se il
// blocco non lo e'. Avvolta in un div che scorre: su telefono una tabella larga
// non deve far scorrere tutta la pagina in orizzontale.
function tabella(b) {
  const righe = b.split("\n").map((r) => r.trim());
  if (righe.length < 3 || !righe.every((r) => r.startsWith("|"))) return null;
  if (!/^\|[\s:|-]+\|$/.test(righe[1])) return null;

  const celle = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  const intest = celle(righe[0]);
  const corpo = righe.slice(2).map(celle);

  return (
    `<div class="scroll"><table><thead><tr>` +
    intest.map((c) => `<th>${c}</th>`).join("") +
    `</tr></thead><tbody>` +
    corpo.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") +
    `</tbody></table></div>`
  );
}
