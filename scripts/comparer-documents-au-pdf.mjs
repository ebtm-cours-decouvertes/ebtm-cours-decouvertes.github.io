#!/usr/bin/env node
// Compare, caractère par caractère, les documents de app/contenu/documents/*.json au PDF
// d'origine (source/foi-et-pratiques-ebtm.pdf). Ces textes doivent rester tels qu'imprimés :
// une lettre, un chiffre ou un signe de ponctuation qui diffère arrête le contrôle.
//
// Ne sont pas comparés, parce qu'ils relèvent de la mise en page et non du texte : les
// espaces et retours à la ligne, les numéros de page, les puces des listes, et le trait
// d'union d'un mot coupé en fin de ligne (le script accepte qu'il soit gardé ou retiré ;
// scripts/transcrire-documents.mjs --details donne la liste de ces mots pour relecture).
// Les titres de document et de chapitre, imprimés en capitales ou en petites capitales,
// sont comparés sans tenir compte de la casse.
//
// Demande l'outil « pdftotext » (Poppler). Le PDF n'est pas publié : ce contrôle se lance
// sur le dépôt de travail, pas depuis publier.sh.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const pdf = join(racine, "source", "foi-et-pratiques-ebtm.pdf");
const dossier = join(racine, "app", "contenu", "documents");
const COUPURE = "\u0001"; // trait d'union de fin de ligne : peut-être un vrai, peut-être pas

if (!existsSync(pdf)) {
  console.error(`PDF introuvable : ${pdf}`);
  process.exit(1);
}

const sansEspaces = (texte) => texte.replace(/[\s ]+/g, "");

// Le texte du PDF pour une plage de pages, débarrassé de ce qui n'est pas du texte courant.
function textePdf(premiere, derniere) {
  let tout = "";
  for (let page = premiere; page <= derniere; page++) {
    const brut = execFileSync("pdftotext", ["-layout", "-f", String(page), "-l", String(page), pdf, "-"], {
      encoding: "utf8",
    });
    const lignes = brut.replace(/\f/g, "").split("\n");
    // Le numéro de page : une ligne à lui seul, ou en tête de la ligne du pied de page quand
    // celui-ci porte aussi du texte (page 20 : « 20   Fait à Toulouse, le 28 août 2022 »).
    let rang = lignes.findIndex((l) => l.trim() === String(page));
    if (rang >= 0) lignes.splice(rang, 1);
    else {
      rang = lignes.findLastIndex((l) => l.trim());
      const debut = new RegExp(`^\\s*${page}\\s+`);
      if (rang < 0 || !debut.test(lignes[rang]))
        throw new Error(`Page ${page} : numéro de page introuvable dans l’extraction.`);
      lignes[rang] = lignes[rang].replace(debut, "");
    }
    tout += lignes.join("\n") + "\n";
  }
  return sansEspaces(
    tout
      .replace(/ﬁ/g, "fi")
      .replace(/ﬂ/g, "fl")
      .replace(/•/g, "")
      .replace(/-[ \t]*\n/g, COUPURE)
  );
}

// Le texte d'un document tel que l'application le porte, morceau par morceau.
function morceauxDuDocument(document) {
  const morceaux = [{ texte: document.titre, souple: true, ou: "titre" }];
  if (document.soustitre) morceaux.push({ texte: document.soustitre, ou: "sous-titre du document" });
  document.sections.forEach((section, s) => {
    morceaux.push({ texte: section.titre, souple: true, ou: `titre « ${section.titre} »` });
    section.blocs.forEach((bloc, b) => {
      const ou = `« ${section.titre} », bloc ${b + 1}`;
      if (bloc.type === "liste") bloc.elements.forEach((e) => morceaux.push({ texte: e, ou }));
      else morceaux.push({ texte: bloc.texte.replace(/^\*(.*)\*$/, "$1"), ou });
    });
  });
  return morceaux;
}

let erreurs = 0;
let total = 0;

for (const fichier of readdirSync(dossier).filter((f) => f.endsWith(".json")).sort()) {
  const document = JSON.parse(readFileSync(join(dossier, fichier), "utf8"));
  const [premiere, derniere] = document.pages.split("-").map(Number);
  const source = textePdf(premiere, derniere);
  let i = 0;
  let ecart = null;

  boucle: for (const morceau of morceauxDuDocument(document)) {
    for (const c of sansEspaces(morceau.texte)) {
      while (source[i] === COUPURE && c !== "-") i++;
      const attendu = source[i] === COUPURE ? "-" : source[i];
      const pareil = morceau.souple
        ? attendu !== undefined && attendu.toLowerCase() === c.toLowerCase()
        : attendu === c;
      if (!pareil) {
        ecart =
          `${morceau.ou}\n    application : …${sansEspaces(morceau.texte).slice(0, 60)}\n` +
          `    PDF, à cet endroit : …${source.slice(Math.max(0, i - 30), i + 30).replaceAll(COUPURE, "-")}`;
        break boucle;
      }
      i++;
    }
  }
  const reste = source.slice(i).replaceAll(COUPURE, "");
  if (!ecart && reste) ecart = `texte du PDF absent de l’application : ${reste.slice(0, 80)}…`;

  if (ecart) {
    erreurs++;
    console.error(`ÉCART  ${fichier}\n  ${ecart}`);
  } else {
    total += i;
    console.log(`identique  ${fichier} (pages ${document.pages}, ${i} caractères comparés)`);
  }
}

if (erreurs) {
  console.error(`\n${erreurs} document(s) différent(s) du PDF.`);
  process.exit(1);
}
console.log(`\nOK — les documents sont identiques au PDF (${total} caractères).`);
