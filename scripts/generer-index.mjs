#!/usr/bin/env node
// Régénère app/contenu/index.json (leçons, titres, nombre de questions, figures) à partir des
// fichiers app/contenu/lecons/*.json. À relancer après toute modification d'une leçon.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const dossier = join(racine, "app", "contenu", "lecons");
const figures = new Set();
const lecons = readdirSync(dossier)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((fichier) => {
    const lecon = JSON.parse(readFileSync(join(dossier, fichier), "utf8"));
    const blocs = [...(lecon.introduction || []).filter((e) => typeof e === "object")];
    for (const section of lecon.sections || []) blocs.push(...(section.blocs || []));
    for (const bloc of blocs) if (bloc.type === "figure") figures.add(bloc.fichier);
    return { numero: lecon.numero, titre: lecon.titre, fichier, nbQuestions: lecon.questions.length };
  })
  .sort((a, b) => a.numero - b.numero);

const cible = join(racine, "app", "contenu", "index.json");
writeFileSync(cible, JSON.stringify({ lecons, figures: [...figures].sort() }, null, 2) + "\n");
console.log(`app/contenu/index.json régénéré : ${lecons.length} leçon(s), ${figures.size} figure(s).`);
