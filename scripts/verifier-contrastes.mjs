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
  // Le bandeau des onglets et des choix est en teinte : le compte d'un onglet non choisi s'y
  // lit en texte adouci, et l'onglet choisi (violet plein) doit s'en détacher à 3 pour 1.
  ["compte d’un onglet sur bandeau", "texte-doux", "teinte", 4.5],
  ["onglet choisi sur bandeau", "violet", "teinte", 3],
  ["pastille terminée", "ok", "ok-fond", 4.5],
  ["coche d’une leçon faite", "ok", "carte", 3],
  ["avertissement d’effacement", "danger", "carte", 4.5],
  ["avertissement sur fond", "danger", "fond", 4.5],
  ["bordure d’un champ", "bord-actif", "carte", 3],
  ["bordure d’un champ sur fond", "bord-actif", "fond", 3],
  // Mes notes : le texte d'un passage noté, sur le fond de son choix.
  ["passage noté « Pas compris »", "encre", "note-comprends", 4.5],
  ["passage noté « Ma question »", "encre", "note-question", 4.5],
  ["passage noté « À vivre »", "encre", "note-vivre", 4.5],
  ["passage noté « Pour prier »", "encre", "note-prier", 4.5],
  ["passage noté « Ça m’encourage »", "encre", "note-encourage", 4.5],
  // « Retirer » sous une ligne de « Mes notes » (texte à la couleur du fond, sur le rouge), et
  // « OK » de la fenêtre d'une note (violet sur la carte).
  ["bouton « Retirer »", "fond", "danger", 4.5],
  ["« OK » de la fenêtre d’une note", "violet", "carte", 4.5],
  // Les pastilles de couleur des notes (barre des choix, fenêtre, « Mes notes ») : éléments
  // graphiques, 3 pour 1 sur la page, sur le choix enfoncé et sur le fond de leur passage.
  ["pastille « Pas compris » sur page", "point-comprends", "fond", 3],
  ["pastille « Pas compris » choix enfoncé", "point-comprends", "teinte", 3],
  ["pastille « Pas compris » sur passage", "point-comprends", "note-comprends", 3],
  ["pastille « Ma question » sur page", "point-question", "fond", 3],
  ["pastille « Ma question » choix enfoncé", "point-question", "teinte", 3],
  ["pastille « Ma question » sur passage", "point-question", "note-question", 3],
  ["pastille « À vivre » sur page", "point-vivre", "fond", 3],
  ["pastille « À vivre » choix enfoncé", "point-vivre", "teinte", 3],
  ["pastille « À vivre » sur passage", "point-vivre", "note-vivre", 3],
  ["pastille « Pour prier » sur page", "point-prier", "fond", 3],
  ["pastille « Pour prier » choix enfoncé", "point-prier", "teinte", 3],
  ["pastille « Pour prier » sur passage", "point-prier", "note-prier", 3],
  ["pastille « Ça m’encourage » sur page", "point-encourage", "fond", 3],
  ["pastille « Ça m’encourage » choix enfoncé", "point-encourage", "teinte", 3],
  ["pastille « Ça m’encourage » sur passage", "point-encourage", "note-encourage", 3],
  // Le petit message du bas : couleurs du texte et du fond inversées.
  ["message du bas", "fond", "encre", 4.5],
  // Bandeau de l'accueil : le nom et les icônes en blanc, mesurés aux trois points du dégradé.
  ["nom sur bandeau, à gauche", "sur-bandeau", "bandeau-debut", 4.5],
  ["nom sur bandeau, au milieu", "sur-bandeau", "bandeau-milieu", 4.5],
  ["icônes sur bandeau, à droite", "sur-bandeau", "bandeau-fin", 4.5],
];

let echecs = 0;
for (const [nom, avant, arriere, seuil] of PAIRES) {
  for (const [theme, table] of [["clair", clair], ["sombre", sombre]]) {
    const rapport = contraste(table[avant], table[arriere]);
    const ok = rapport >= seuil;
    if (!ok) echecs++;
    const marque = ok ? "  " : "✗ ";
    console.log(`${marque}${theme.padEnd(7)} ${nom.padEnd(42)} ${rapport.toFixed(2)} (min ${seuil})`);
  }
}

console.log(
  echecs
    ? `\n${echecs} contraste(s) sous le seuil.`
    : "\nTous les contrastes atteignent le seuil WCAG AA."
);
if (echecs) process.exit(1);
