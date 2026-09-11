#!/usr/bin/env node
/*
 * Assemble l'application entière (page, styles, code, texte des 10 leçons) en UN seul
 * fichier HTML, destiné à être publié comme aperçu pour relecture.
 *
 * L'aperçu est construit à partir des vrais fichiers de `app/` : il ne peut donc pas
 * diverger de l'application réelle. Il ne remplace pas la mise en ligne ; il sert à
 * regarder et commenter l'application avant de la publier.
 *
 * Usage : node scripts/construire-apercu.mjs [fichier de sortie]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(racine, "app");
const sortie = process.argv[2] || join(racine, "apercu.html");

const lire = (...morceaux) => readFileSync(join(app, ...morceaux), "utf8");

// --- Contenu : index, à propos et les 10 leçons, sous les mêmes chemins que dans l'app ---

const contenu = {
  "contenu/index.json": JSON.parse(lire("contenu", "index.json")),
  "contenu/a-propos.json": JSON.parse(lire("contenu", "a-propos.json")),
  "contenu/versets.json": JSON.parse(lire("contenu", "versets.json")),
};
for (const fichier of readdirSync(join(app, "contenu", "lecons")).filter((f) => f.endsWith(".json"))) {
  contenu[`contenu/lecons/${fichier}`] = JSON.parse(lire("contenu", "lecons", fichier));
}

// --- Figures : embarquées en base64, l'aperçu devant tenir dans un seul fichier ---

function enBase64(chemin) {
  const type = chemin.endsWith(".svg") ? "image/svg+xml" : chemin.endsWith(".jpg") ? "image/jpeg" : "image/png";
  return `data:${type};base64,${readFileSync(join(app, chemin)).toString("base64")}`;
}

// Le logo de l'en-tête et le QR code sont posés par le code, pas écrits dans la page : il faut
// les embarquer aussi.
const figures = {
  "icones/logo-ebtm.png": enBase64("icones/logo-ebtm.png"),
  "icones/logo-ebtm-mot.png": enBase64("icones/logo-ebtm-mot.png"),
  "qr-cours-decouvertes.png": enBase64("qr-cours-decouvertes.png"),
};
const dossierFigures = join(app, "contenu", "figures");
if (existsSync(dossierFigures)) {
  for (const fichier of readdirSync(dossierFigures))
    figures[`contenu/figures/${fichier}`] = enBase64(join("contenu", "figures", fichier));
}

// --- Corps de la page, sans la balise qui chargeait app.js ---

const html = lire("index.html");
const corps = html
  .slice(html.indexOf("<body>") + "<body>".length, html.indexOf("</body>"))
  .replace(/\s*<script src="app\.js"><\/script>/, "")
  // Les images de la page elle-même (le logo de l'en-tête) sont embarquées comme les figures.
  .replace(/src="((?:icones|contenu)\/[^"]+)"/g, (entier, chemin) => {
    const fichier = join(app, chemin);
    if (!existsSync(fichier)) return entier;
    const type = chemin.endsWith(".svg") ? "image/svg+xml" : chemin.endsWith(".jpg") ? "image/jpeg" : "image/png";
    return `src="data:${type};base64,${readFileSync(fichier).toString("base64")}"`;
  })
  .trim();

// --- L'application est volontairement claire en toutes circonstances : rien à adapter,
// mais on neutralise le thème sombre que le lecteur d'aperçu pourrait imposer. ---

const css = lire("style.css");
const themeApercu = `
/* Aperçu : le lecteur peut imposer un thème sombre ; l'application reste claire. */
:root[data-theme="dark"],
:root[data-theme="dark"] body {
  color-scheme: light;
  background: var(--fond);
  color: var(--encre);
}
`;

const page = `<title>Cours découvertes</title>
<style>
${css}${themeApercu}</style>

${corps}

<script>
window.CONTENU_EMBARQUE = ${JSON.stringify(contenu)};
window.FIGURES_EMBARQUEES = ${JSON.stringify(figures)};
</script>
<script>
${lire("app.js")}
</script>
`;

writeFileSync(sortie, page);
const ko = Math.round(page.length / 1024);
console.log(
  `Aperçu écrit : ${sortie} (${ko} Ko, ${Object.keys(contenu).length - 3} leçons, ${Object.keys(figures).length - 1} figure(s)).`
);
