#!/usr/bin/env node
// Écrit la liste des références bibliques à résoudre, analysée en livre/chapitre/versets.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { expressionReference, analyser } from "./livres-bibliques.mjs";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const dossier = join(racine, "app", "contenu", "lecons");

function textes(lecon) {
  const out = [];
  const blocs = [];
  for (const e of lecon.introduction || []) (typeof e === "string" ? out : blocs).push(e);
  for (const s of lecon.sections || []) {
    out.push(s.titre);
    blocs.push(...(s.blocs || []));
  }
  for (const b of blocs) {
    if (b.type === "liste") out.push(...b.elements);
    else if (b.type === "tableau") out.push(b.titre || "", ...b.colonnes, ...b.lignes.flat());
    else if (b.type === "figure") out.push(b.legende || "");
    else out.push(b.texte || "", b.titre || "", b.reference || "");
  }
  for (const q of lecon.questions || []) out.push(q.texte);
  for (const v of lecon.versets_a_apprendre || []) out.push(v.reference);
  return out.filter(Boolean);
}

// Certaines numérotations du livret ne coïncident pas avec celles de la Segond 1910, qui
// compte le titre d'un psaume comme premier verset. Le livret suit la numérotation courante,
// où le cri « Mon Dieu, pourquoi m'as-tu abandonné ? » est le verset 1 du Psaume 22.
const CORRECTIONS = new Map([["Psaume 22.1", [[2, 2]]]]);

const vues = new Set();
for (const fichier of readdirSync(dossier).filter((f) => f.endsWith(".json")).sort()) {
  const lecon = JSON.parse(readFileSync(join(dossier, fichier), "utf8"));
  for (const texte of textes(lecon)) for (const m of texte.matchAll(expressionReference())) vues.add(m[0].trim());
}

const analysees = [...vues]
  .sort((a, b) => a.localeCompare(b, "fr"))
  .map(analyser)
  .filter(Boolean)
  .map((r) => (CORRECTIONS.has(r.reference) ? { ...r, intervalles: CORRECTIONS.get(r.reference) } : r));
const sortie = join(racine, "scripts", "references-a-resoudre.json");
writeFileSync(sortie, JSON.stringify(analysees, null, 2) + "\n");
const chapitres = analysees.filter((r) => r.intervalles.length === 0).length;
console.log(`${analysees.length} référence(s) écrites dans scripts/references-a-resoudre.json`);
console.log(`  dont ${chapitres} chapitre(s) entier(s) sans numéro de verset`);
