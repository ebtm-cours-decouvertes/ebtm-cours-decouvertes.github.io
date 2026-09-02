#!/usr/bin/env node
// Compare le vocabulaire de chaque leçon JSON avec le texte extrait du PDF (pdftotext requis).
// Signale les mots du PDF absents du JSON (oublis) et les mots du JSON absents du PDF (ajouts / coquilles).
// Usage : node scripts/comparer-au-pdf.mjs [numéro de leçon]
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const pdf = join(racine, "source", "cours-decouvertes-2025.pdf");
const dossier = join(racine, "app", "contenu", "lecons");
const filtre = process.argv[2] ? Number(process.argv[2]) : null;

if (spawnSync("pdftotext", ["-v"]).error) {
  console.error("pdftotext introuvable (brew install poppler) : comparaison impossible.");
  process.exit(2);
}

// Mots des en-têtes/pieds de page du livret, ignorés dans la comparaison.
const IGNORES = new Set(["cours", "découvertes", "eglise", "baptiste", "toulouse", "métropole", "leçon"]);

function mots(texte) {
  const nettoye = texte
    .toLowerCase()
    .replace(/\*\*?/g, "")
    .replace(/[’‘']/g, "'")
    .replace(/-/g, "") // « peut-on » et « peuton » (extraction) deviennent identiques
    .replace(/[^a-z0-9àâäéèêëîïôöùûüÿçœæ' ]+/gi, " ");
  const compte = new Map();
  for (const m of nettoye.split(/\s+/)) {
    const mot = m.replace(/^'+|'+$/g, "");
    if (!mot || /^\d+$/.test(mot) || IGNORES.has(mot)) continue;
    compte.set(mot, (compte.get(mot) || 0) + 1);
  }
  return compte;
}

function difference(a, b) {
  const res = [];
  for (const [mot, n] of a) {
    const manque = n - (b.get(mot) || 0);
    if (manque > 0) res.push(manque > 1 ? `${mot}×${manque}` : mot);
  }
  return res;
}

// `avecFigures` inclut la description des figures. Elle sert à vérifier qu'aucun mot du livret
// ne manque (le texte gravé dans un dessin est repris dans sa description), mais pas à repérer
// les ajouts : une description n'est pas du texte du livret et ferait du bruit.
function textesDuJson(lecon, avecFigures) {
  const out = [lecon.titre];
  const blocs = [];
  for (const element of lecon.introduction || [])
    if (typeof element === "string") out.push(element);
    else blocs.push(element);
  for (const s of lecon.sections || []) {
    out.push(s.titre);
    blocs.push(...(s.blocs || []));
  }
  {
    for (const b of blocs) {
      if (b.type === "liste") out.push(...b.elements);
      else if (b.type === "figure") out.push(b.legende || "", avecFigures ? b.texte : "");
      else if (b.type === "tableau") out.push(b.titre || "", ...b.colonnes, ...b.lignes.flat());
      else out.push(b.texte, b.titre || "", b.auteur || "", b.reference || "");
    }
  }
  // Les versets à apprendre reprennent un texte déjà présent dans la leçon : non comptés.
  for (const q of lecon.questions || []) out.push(q.texte);
  return out.join("\n");
}

let alerte = false;
for (const fichier of readdirSync(dossier).filter((f) => f.endsWith(".json")).sort()) {
  const lecon = JSON.parse(readFileSync(join(dossier, fichier), "utf8"));
  if (filtre && lecon.numero !== filtre) continue;
  const [debut, fin] = lecon.pages.split("-");
  const brut = spawnSync("pdftotext", ["-f", debut, "-l", fin, pdf, "-"], { encoding: "utf8" }).stdout;
  // Retire les en-têtes répétés (titre courant, « Leçon N ») et les libellés de structure.
  const titreCourant = new RegExp(`^\\s*(${lecon.titre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|Leçon ${lecon.numero})\\s*$`, "gim");
  const extraction = brut
    .replace(titreCourant, "")
    .replace(/Versets? à apprendre par cœur\s*:?/gi, "")
    .replace(/Questions de révision/gi, "");
  const motsPdf = mots(extraction);
  const motsJson = mots(textesDuJson(lecon, false));
  const oublis = difference(motsPdf, mots(textesDuJson(lecon, true)));
  const ajouts = difference(motsJson, motsPdf);
  console.log(`\nLeçon ${lecon.numero} — ${lecon.titre} (p. ${lecon.pages})`);
  console.log(`  mots PDF : ${[...motsPdf.values()].reduce((a, b) => a + b, 0)}, mots JSON : ${[...motsJson.values()].reduce((a, b) => a + b, 0)}`);
  console.log(`  oublis (dans le PDF, pas dans le JSON) : ${oublis.length}${oublis.length ? "\n    " + oublis.join(", ") : ""}`);
  console.log(`  ajouts (dans le JSON, pas dans le PDF) : ${ajouts.length}${ajouts.length ? "\n    " + ajouts.join(", ") : ""}`);
  if (oublis.length > 8) alerte = true;
}
if (alerte) {
  console.error("\nAu moins une leçon a plus de 8 oublis : à relire.");
  process.exit(1);
}
