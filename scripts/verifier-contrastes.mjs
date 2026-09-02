#!/usr/bin/env node
// Contrôle les contrastes de l'application selon le critère WCAG AA : 4,5 pour du texte
// ordinaire, 3 pour du grand texte et pour les bordures d'éléments interactifs.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(racine, "app", "style.css"), "utf8");

function jetons(bloc) {
  const table = {};
  for (const [, nom, valeur] of bloc.matchAll(/--([a-z-]+):\s*([^;]+);/g)) table[nom] = valeur.trim();
  return table;
}

const clair = jetons(css.match(/^:root \{([\s\S]*?)\n\}/m)[1]);
const sombre = { ...clair, ...jetons(css.match(/:root\[data-apparence="sombre"\] \{([\s\S]*?)\n\}/)[1]) };

function canal(v) {
  v /= 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

const contraste = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const PAIRES = [
  ["texte courant", "encre", "fond", 4.5],
  ["texte courant sur carte", "encre", "carte", 4.5],
  ["texte adouci", "texte-doux", "fond", 4.5],
  ["texte adouci sur carte", "texte-doux", "carte", 4.5],
  ["titres et liens", "violet", "fond", 4.5],
  ["titres et liens sur carte", "violet", "carte", 4.5],
  ["sous-titres magenta", "magenta", "fond", 4.5],
  ["sous-titres magenta sur carte", "magenta", "carte", 4.5],
  ["texte sur teinte", "encre", "teinte", 4.5],
  ["violet sur teinte", "violet", "teinte", 4.5],
  ["pastille terminée", "ok", "ok-fond", 4.5],
  ["coche d’une leçon faite", "ok", "carte", 3],
  ["avertissement d’effacement", "danger", "carte", 4.5],
  ["avertissement sur fond", "danger", "fond", 4.5],
  ["bordure d’un champ", "bord-actif", "carte", 3],
  ["bordure d’un champ sur fond", "bord-actif", "fond", 3],
];

let echecs = 0;
for (const [nom, avant, arriere, seuil] of PAIRES) {
  for (const [theme, table] of [["clair", clair], ["sombre", sombre]]) {
    const rapport = contraste(table[avant], table[arriere]);
    const ok = rapport >= seuil;
    if (!ok) echecs++;
    const marque = ok ? "  " : "✗ ";
    console.log(`${marque}${theme.padEnd(7)} ${nom.padEnd(32)} ${rapport.toFixed(2)} (min ${seuil})`);
  }
}

// La barre devient translucide dès que la lecture commence : le texte défile dessous. On la
// compose donc avec ce qui peut passer derrière — le texte courant, le pire cas — avant de
// mesurer ses propres couleurs. Le flou n'entre pas dans le calcul : il n'apporte aucune
// garantie, seule l'opacité en donne une.
function melange(hexAvant, hexArriere, alpha) {
  const canaux = (hex) => {
    const n = hex.replace("#", "");
    return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
  };
  const [a, b] = [canaux(hexAvant), canaux(hexArriere)];
  return "#" + a.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, "0")).join("");
}

const TEXTES_BARRE = [
  ["titre de la barre", "violet"],
  ["texte adouci de la barre", "texte-doux"],
  ["texte courant de la barre", "encre"],
];

for (const [theme, table] of [["clair", clair], ["sombre", sombre]]) {
  const parts = table["barre-flottante"].match(/rgba?\(([^)]+)\)/);
  if (!parts) {
    echecs++;
    console.log(`✗ ${theme.padEnd(7)} --barre-flottante illisible`);
    continue;
  }
  const [r, v, b, alpha] = parts[1].split(",").map((n) => parseFloat(n));
  const teinte = "#" + [r, v, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("");
  const compose = melange(teinte, table.encre, alpha);
  for (const [nom, jeton] of TEXTES_BARRE) {
    const rapport = contraste(table[jeton], compose);
    const ok = rapport >= 4.5;
    if (!ok) echecs++;
    console.log(`${ok ? "  " : "✗ "}${theme.padEnd(7)} ${nom.padEnd(32)} ${rapport.toFixed(2)} (min 4.5)`);
  }
}

console.log(
  echecs
    ? `\n${echecs} contraste(s) sous le seuil.`
    : "\nTous les contrastes atteignent le seuil WCAG AA."
);
if (echecs) process.exit(1);
