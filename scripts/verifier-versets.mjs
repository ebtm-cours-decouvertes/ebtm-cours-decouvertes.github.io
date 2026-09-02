#!/usr/bin/env node
// Vérifie la cohérence de app/contenu/versets.json : pour chaque référence citée dans les
// leçons, le texte embarqué doit couvrir exactement les versets annoncés, dans l'ordre et
// sans trou. Un texte peut être juste et pourtant mal découpé : c'est ce que ce contrôle
// attrape, là où verifier-contenu.mjs se contente de vérifier qu'un texte existe.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const fichier = join(racine, "app", "contenu", "versets.json");
const { traduction, versets } = JSON.parse(readFileSync(fichier, "utf8"));

const erreurs = [];
const err = (reference, message) => erreurs.push(`${reference} : ${message}`);

// Formes rencontrées : « Jean 3.16 », « Romains 6.6 & 11 », « 1 Corinthiens 12.14-21 »,
// « Actes 2.38, 41 », « Exode 34:6 » (le livret mélange le point et les deux-points), et
// « Genèse 3 », un chapitre entier sans numéro de verset.
// Renvoie null si la forme n'est pas reconnue, "chapitre" pour un chapitre entier.
function versetsAttendus(reference) {
  const separateur = reference.search(/[.:]/);
  if (separateur === -1) return "chapitre";
  const apresChapitre = reference.slice(separateur + 1);
  const attendus = new Set();
  for (const morceau of apresChapitre.split(/\s*[,&]\s*/)) {
    const plage = morceau.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!plage) return null;
    const debut = Number(plage[1]);
    const fin = plage[2] ? Number(plage[2]) : debut;
    if (fin < debut) return null;
    for (let n = debut; n <= fin; n++) attendus.add(n);
  }
  return attendus;
}

// La Louis Segond compte le titre d'un psaume comme premier verset, là où le livret suit la
// numérotation courante : le cri du Psaume 22 y est au verset 2. Le texte affiché est le bon,
// seul son numéro diffère, et l'application n'affiche pas les numéros. Écart connu, pas un
// défaut : toute autre référence décalée doit en revanche ressortir.
const DECALAGES_CONNUS = { "Psaume 22.1": [2] };

let controlees = 0;
let chapitres = 0;
for (const [reference, passage] of Object.entries(versets)) {
  if (!Array.isArray(passage) || passage.length === 0) {
    err(reference, "passage vide");
    continue;
  }
  for (const { v, t } of passage) {
    if (typeof v !== "number") err(reference, `numéro de verset absent ou non numérique : ${JSON.stringify(v)}`);
    if (typeof t !== "string" || !t.trim()) err(reference, `verset ${v} : texte vide`);
    else if (/'/.test(t)) err(reference, `verset ${v} : apostrophe droite ' (utiliser ’)`);
    else if (/^\s|\s$/.test(t)) err(reference, `verset ${v} : espace en début ou fin`);
  }

  const attendus = versetsAttendus(reference);
  if (!attendus) {
    err(reference, "forme de référence non reconnue par le contrôle — à vérifier à la main");
    continue;
  }

  const presents = passage.map((p) => p.v);

  if (attendus === "chapitre") {
    // Un chapitre entier doit commencer au verset 1 et se suivre sans trou.
    chapitres++;
    if (presents[0] !== 1) err(reference, `chapitre entier commençant au verset ${presents[0]}`);
    const attendu = presents.map((_, i) => i + 1);
    if (presents.join() !== attendu.join()) err(reference, "chapitre entier : versets non consécutifs");
    continue;
  }

  if (DECALAGES_CONNUS[reference]) {
    if (presents.join() !== DECALAGES_CONNUS[reference].join())
      err(reference, `décalage connu attendu ${DECALAGES_CONNUS[reference].join(", ")}, trouvé ${presents.join(", ")}`);
    continue;
  }

  controlees++;
  const manquants = [...attendus].filter((n) => !presents.includes(n));
  const superflus = presents.filter((n) => !attendus.has(n));
  if (manquants.length) err(reference, `verset(s) manquant(s) : ${manquants.join(", ")}`);
  if (superflus.length) err(reference, `verset(s) en trop : ${superflus.join(", ")}`);

  const ordonnes = [...presents].sort((a, b) => a - b);
  if (presents.join() !== ordonnes.join()) err(reference, `versets dans le désordre : ${presents.join(", ")}`);
  if (new Set(presents).size !== presents.length) err(reference, "un même verset apparaît deux fois");
}

if (erreurs.length) {
  console.error(erreurs.join("\n"));
  console.error(`\n${erreurs.length} problème(s) sur ${Object.keys(versets).length} référence(s).`);
  process.exit(1);
}
console.log(
  `OK — ${Object.keys(versets).length} référence(s) : ${controlees} plage(s) de versets, ${chapitres} chapitre(s) entier(s), ` +
    `${Object.keys(DECALAGES_CONNUS).length} décalage(s) connu(s). Traduction : ${traduction}.`
);
