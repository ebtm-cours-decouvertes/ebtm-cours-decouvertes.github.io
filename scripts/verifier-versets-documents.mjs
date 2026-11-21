#!/usr/bin/env node
// Vérifie app/contenu/versets-documents.json, le fichier qui rend cliquables les références
// bibliques des documents de l'église. Sans dépendance, et sans le texte biblique d'origine :
// ce contrôle peut tourner partout. Il s'assure que
//   - les références repérées dans le fichier sont exactement celles que le texte actuel des
//     documents contient, aux mêmes endroits (un document modifié sans relancer
//     construire-versets-documents.mjs serait cliquable au mauvais endroit) ;
//   - chaque référence a son passage, et aucun passage ne traîne sans référence ;
//   - chaque passage couvre exactement les versets annoncés, dans l'ordre et sans trou.
// Lancé seul, il affiche « OK » ou la liste des erreurs. verifier-contenu.mjs l'appelle aussi.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { reperer, textesDuDocument } from "./references-documents.mjs";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");

// Numérotations connues où le texte affiché ne porte pas le numéro annoncé (voir
// construire-versets-documents.mjs) : la référence dit 13.14, la Segond numérote 13.13.
const NUMEROTATIONS_CONNUES = { "2 Corinthiens 13.14": ["13"] };

export function verifierVersetsDocuments() {
  const erreurs = [];
  const fichier = join(racine, "app", "contenu", "versets-documents.json");
  if (!existsSync(fichier)) return { erreurs: ["versets-documents.json : fichier absent"], references: 0, passages: 0 };
  const { traduction, reperes, passages } = JSON.parse(readFileSync(fichier, "utf8"));
  if (!traduction) erreurs.push("versets-documents.json : traduction non indiquée");

  const dossier = join(racine, "app", "contenu", "documents");
  const attendus = {};
  const parties = new Map();
  let references = 0;
  for (const nom of readdirSync(dossier).filter((f) => f.endsWith(".json")).sort()) {
    const document = JSON.parse(readFileSync(join(dossier, nom), "utf8"));
    for (const [adresse, texte] of textesDuDocument(document)) {
      const lues = reperer(texte).references;
      if (!lues.length) continue;
      (attendus[document.slug] ??= {})[adresse] = lues.map((r) => [r.debut, r.fin, r.cle]);
      references += lues.length;
      for (const r of lues) parties.set(r.cle, r.parties);
    }
  }
  if (JSON.stringify(reperes) !== JSON.stringify(attendus))
    erreurs.push(
      "versets-documents.json : les références ne correspondent plus au texte des documents — lancer node scripts/construire-versets-documents.mjs"
    );

  for (const cle of parties.keys()) if (!passages[cle]) erreurs.push(`${cle} : référence sans passage`);
  for (const [cle, passage] of Object.entries(passages)) {
    if (!parties.has(cle)) {
      erreurs.push(`${cle} : passage que plus aucun document ne cite`);
      continue;
    }
    if (!Array.isArray(passage) || passage.length === 0) {
      erreurs.push(`${cle} : passage vide`);
      continue;
    }
    for (const { v, t } of passage) {
      if (typeof t !== "string" || !t.trim()) erreurs.push(`${cle} : verset ${v} vide`);
      else if (/'/.test(t)) erreurs.push(`${cle} : verset ${v}, apostrophe droite`);
      else if (/\s{2,}|^\s|\s$/.test(t)) erreurs.push(`${cle} : verset ${v}, espaces en trop`);
    }
    const presents = passage.map((p) => (p.c ? `${p.c}.${p.v}` : `${p.v}`));
    if (NUMEROTATIONS_CONNUES[cle]) {
      if (presents.join() !== NUMEROTATIONS_CONNUES[cle].join())
        erreurs.push(`${cle} : numérotation connue attendue ${NUMEROTATIONS_CONNUES[cle]}, trouvé ${presents}`);
      continue;
    }
    const attendu = [];
    let controlable = true;
    for (const partie of parties.get(cle)) {
      if (partie.chapitre) {
        // Chapitre entier : du verset 1 au dernier, sans trou.
        passage.forEach((_, i) => attendu.push(`${i + 1}`));
      } else if (partie.c1 === partie.c2) {
        for (let v = partie.v1; v <= partie.v2; v++) attendu.push(`${v}`);
      } else {
        // À cheval sur deux chapitres : la longueur du premier n'est pas connue ici. On vérifie
        // le début, la fin, et que les versets se suivent, le chapitre suivant repartant de 1.
        controlable = false;
        const premier = passage[0];
        const dernier = passage[passage.length - 1];
        if (premier.c !== partie.c1 || premier.v !== partie.v1) erreurs.push(`${cle} : ne commence pas au bon verset`);
        if (dernier.c !== partie.c2 || dernier.v !== partie.v2) erreurs.push(`${cle} : ne finit pas au bon verset`);
        passage.forEach((p, i) => {
          if (i === 0) return;
          const avant = passage[i - 1];
          const suit = (p.c === avant.c && p.v === avant.v + 1) || (p.c === avant.c + 1 && p.v === 1);
          if (!suit) erreurs.push(`${cle} : trou entre ${avant.c}.${avant.v} et ${p.c}.${p.v}`);
        });
      }
    }
    if (controlable && presents.join() !== attendu.join())
      erreurs.push(`${cle} : versets attendus ${attendu.join(", ")} — trouvés ${presents.join(", ")}`);
  }
  return { erreurs, references, passages: Object.keys(passages).length, traduction };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { erreurs, references, passages, traduction } = verifierVersetsDocuments();
  if (erreurs.length) {
    console.error(erreurs.join("\n"));
    console.error(`\n${erreurs.length} problème(s) dans les références des documents.`);
    process.exit(1);
  }
  console.log(`OK — ${references} référence(s) cliquable(s) dans les documents, ${passages} passage(s). Traduction : ${traduction}.`);
}
