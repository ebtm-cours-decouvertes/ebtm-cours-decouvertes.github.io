#!/usr/bin/env node
// Assemble les lots de textes bibliques rapportés par les recherches en un seul fichier
// app/contenu/versets.json, et vérifie que toutes les références citées y figurent.
// Usage : node scripts/assembler-versets.mjs <dossier des lots>
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const dossierLots = process.argv[2];
if (!dossierLots || !existsSync(dossierLots)) {
  console.error("Usage : node scripts/assembler-versets.mjs <dossier contenant textes-*.json>");
  process.exit(1);
}

const attendues = JSON.parse(readFileSync(join(racine, "scripts", "references-a-resoudre.json"), "utf8"));
// La source écrit la ponctuation à l'anglaise (« sauvé? », « dit: »). Le reste de
// l'application suit l'usage français du livret : on ajoute l'espace manquante.
function typographieFrancaise(texte) {
  return texte
    .replace(/\s*([;:!?])/g, " $1")
    .replace(/«\s*/g, "« ")
    .replace(/\s*»/g, " »")
    .replace(/\s+/g, " ")
    .replace(/'/g, "’")
    .trim();
}

const versets = {};
const doublons = [];

for (const fichier of readdirSync(dossierLots).filter((f) => /^textes-\d+\.json$/.test(f)).sort()) {
  const lot = JSON.parse(readFileSync(join(dossierLots, fichier), "utf8"));
  for (const [reference, passages] of Object.entries(lot)) {
    if (versets[reference]) doublons.push(reference);
    versets[reference] = passages.map((p) => ({ v: p.v, t: typographieFrancaise(p.t) }));
  }
}

const manquantes = attendues.filter((r) => !versets[r.reference]).map((r) => r.reference);
const vides = Object.entries(versets).filter(([, p]) => !Array.isArray(p) || p.length === 0).map(([r]) => r);
const enTrop = Object.keys(versets).filter((r) => !attendues.some((a) => a.reference === r));

// Ordre stable, pour que le fichier ne bouge pas d'une régénération à l'autre.
const ordonnees = {};
for (const r of attendues.map((a) => a.reference).sort((a, b) => a.localeCompare(b, "fr")))
  if (versets[r]) ordonnees[r] = versets[r];

const sortie = join(racine, "app", "contenu", "versets.json");
writeFileSync(
  sortie,
  JSON.stringify({ traduction: "Bible Louis Segond 1910", versets: ordonnees }, null, 2) + "\n"
);

const total = Object.values(ordonnees).reduce((n, p) => n + p.length, 0);
console.log(`app/contenu/versets.json : ${Object.keys(ordonnees).length} référence(s), ${total} verset(s).`);
if (doublons.length) console.log(`  doublons entre lots : ${doublons.join(", ")}`);
if (enTrop.length) console.log(`  ignorées (hors liste) : ${enTrop.join(", ")}`);
if (vides.length) console.error(`  SANS TEXTE : ${vides.join(", ")}`);
if (manquantes.length) console.error(`  MANQUANTES : ${manquantes.join(", ")}`);
if (vides.length || manquantes.length) process.exit(1);
