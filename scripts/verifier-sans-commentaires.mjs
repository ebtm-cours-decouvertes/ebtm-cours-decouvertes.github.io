// Contrôle de scripts/sans-commentaires.mjs sur un fichier piège : adresses, chaînes contenant
// « /* », expressions régulières, gabarits imbriqués, divisions. Lancé par publier.sh avant le
// retrait des commentaires ; le dernier cas est un témoin (un défaut posé exprès, qui doit être vu).
import { javascriptSansCommentaires as js, cssSansCommentaires as css } from "./sans-commentaires.mjs";
let echecs = 0;
const verifier = (nom, ok) => { console.log(ok ? "✓" : "✗", nom); if (!ok) echecs++; };
const source = `// tout en haut
const adresse = "https://ebtm.fr/a"; // fin de ligne
const etoile = '/* pas un commentaire */';
const r = /\\/\\/[a-z]+\\/*/g; /* bloc */ const d = 10 / 2 / 5;
const g = \`<p>\${ \`imbriqué \${ 1 + 2 } // pas un commentaire\` }</p>
  <!-- commentaire html -->
  <b>gras</b> https://x.y\`;
function f(a) { return /x\\/y/.test(a) ? a /* milieu */ : { b: \`\${a}\` }; }
const e = a
/* plusieurs
   lignes */
b;
const k = [1, 2].map((x) => x / 2) // division
`;
const resultat = js(source);
verifier("adresse intacte", resultat.includes('"https://ebtm.fr/a"'));
verifier("chaîne avec /* intacte", resultat.includes("'/* pas un commentaire */'"));
verifier("expression régulière intacte", resultat.includes("/\\/\\/[a-z]+\\/*/g"));
verifier("divisions intactes", resultat.includes("10 / 2 / 5") && resultat.includes("x / 2"));
verifier("gabarit imbriqué intact", resultat.includes("imbriqué ${ 1 + 2 } // pas un commentaire"));
verifier("commentaire HTML retiré", !resultat.includes("commentaire html") && resultat.includes("<b>gras</b> https://x.y"));
verifier("regex après return intacte", resultat.includes("return /x\\/y/.test(a)"));
verifier("commentaires retirés", !/tout en haut|fin de ligne|bloc|milieu|plusieurs|division/.test(resultat));
verifier("fin de ligne gardée pour un bloc multiligne", /a\n\s*\nb;|a\n\nb;|a\n+b;/.test(resultat));
// Témoin inverse : un défaut posé exprès doit être vu (une chaîne coupée par l'outil).
verifier("témoin : une chaîne non fermée est refusée", (() => { try { js('const x = "abc\n'); return false; } catch { return true; } })());
const c = css(`a { content: "/* garde */"; /* retire */ color: red; }`);
verifier("CSS : chaîne gardée, commentaire retiré", c.includes('"/* garde */"') && !c.includes("retire"));
process.exit(echecs ? 1 : 0);
