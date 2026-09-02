#!/usr/bin/env node
// Repère toutes les références bibliques citées dans les leçons, pour savoir lesquelles
// il faut embarquer dans l'application. N'écrit rien : affiche la liste.
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LIVRES, expressionReference } from "./livres-bibliques.mjs";

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

const compte = new Map();
for (const fichier of readdirSync(dossier).filter((f) => f.endsWith(".json")).sort()) {
  const lecon = JSON.parse(readFileSync(join(dossier, fichier), "utf8"));
  for (const texte of textes(lecon))
    for (const m of texte.matchAll(expressionReference())) {
      const ref = m[0].trim();
      if (!compte.has(ref)) compte.set(ref, new Set());
      compte.get(ref).add(lecon.numero);
    }
}

const refs = [...compte.entries()].sort((a, b) => a[0].localeCompare(b[0], "fr"));
console.log(`${refs.length} référence(s) distincte(s) dans ${LIVRES.size} livres reconnus :\n`);
for (const [ref, lecons] of refs) console.log(`  ${ref.padEnd(34)} leçons ${[...lecons].sort((a, b) => a - b).join(", ")}`);
