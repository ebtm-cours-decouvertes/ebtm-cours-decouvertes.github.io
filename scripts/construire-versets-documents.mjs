#!/usr/bin/env node
// Construit app/contenu/versets-documents.json : pour chaque référence biblique des documents
// de l'église, où elle se trouve dans le texte et le passage qu'elle désigne, en Louis Segond
// 1910. C'est ce fichier qui rend ces références cliquables, sans toucher au texte des documents.
//
// Le texte biblique n'est pas dans le dépôt. Le script le lit dans ~/.bible_fr_cache (ou le
// dossier donné par BIBLE_FR_CACHE), où la compétence « bible-francaise » le range :
//   - vref.txt et fra-fraLSG.txt, du corpus eBible (github.com/BibleNLP/ebible) : la source.
//     Elle garde la numérotation de la Segond imprimée, celle que suit la confession de foi
//     (Michée 5.1, Ésaïe 9.5, Ecclésiaste 12.9, Psaume 8.6).
//   - ford_lsg_*.json (github.com/FordhamRamFan/public-domain-bible-translations) : le second
//     témoin. Sa numérotation est celle des Bibles anglaises, il ne peut donc pas servir de
//     source ; mais son texte, comparé verset à verset, confirme celui d'eBible et rend les
//     espaces qu'eBible perd parfois à un retour à la ligne (« moi-même;j'ai »).
//
// À relancer si le texte d'un document change, puis : node scripts/verifier-versets-documents.mjs
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { reperer, textesDuDocument } from "./references-documents.mjs";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const dossier = join(racine, "app", "contenu", "documents");
const cache = process.env.BIBLE_FR_CACHE || join(homedir(), ".bible_fr_cache");
const bavard = process.argv.includes("--details");

for (const fichier of ["vref.txt", "fra-fraLSG.txt"])
  if (!existsSync(join(cache, fichier))) {
    console.error(`Texte biblique introuvable : ${join(cache, fichier)}\nVoir l’en-tête de ce script.`);
    process.exit(1);
  }

// --- La Segond 1910 d'eBible : { "MAT": { 5: { 18: "texte" } } } ---
const bible = {};
{
  const adresses = readFileSync(join(cache, "vref.txt"), "utf8").split("\n");
  const textes = readFileSync(join(cache, "fra-fraLSG.txt"), "utf8").split("\n");
  adresses.forEach((adresse, i) => {
    const m = /^(\w+) (\d+):(\d+)$/.exec(adresse);
    const texte = (textes[i] || "").trim();
    if (!m || !texte) return;
    ((bible[m[1]] ??= {})[Number(m[2])] ??= {})[Number(m[3])] = texte;
  });
}

// --- Le second témoin : pour un livre, ses versets retrouvés par leur texte ---
const FICHIERS_FORDHAM =
  "GEN:01-Gen EXO:02-Exod DEU:05-Deut 2SA:10-2Sam 2KI:12-2Kgs 1CH:13-1Chr PSA:19-Ps ECC:21-Eccl ISA:23-Isa JER:24-Jer EZK:26-Ezek DAN:27-Dan MIC:33-Mic HAB:35-Hab ZEC:38-Zech MAT:40-Matt LUK:42-Luke JHN:43-John ACT:44-Acts ROM:45-Rom 1CO:46-1Cor 2CO:47-2Cor GAL:48-Gal EPH:49-Eph PHP:50-Phil COL:51-Col 1TH:52-1Thess 2TH:53-2Thess 1TI:54-1Tim 2TI:55-2Tim TIT:56-Titus HEB:58-Heb JAS:59-Jas 1PE:60-1Pet 2PE:61-2Pet 1JN:62-1John 2JN:63-2John JUD:65-Jude REV:66-Rev";
const fichierFordham = new Map(FICHIERS_FORDHAM.split(" ").map((e) => e.split(":")));
const sansEspaces = (texte) => texte.replace(/[’']/g, "'").replace(/\s+/g, "");
const mots = (texte) =>
  texte
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/œ/g, "oe")
    .split(/[^\p{L}'-]+/u)
    .filter(Boolean);
const temoins = new Map();
function temoin(code) {
  if (temoins.has(code)) return temoins.get(code);
  // versets : retrouvés par leur texte ; vocabulaire et suites : tous les mots du livre, et
  // toutes les paires de mots qui s'y suivent, pour reconnaître deux mots collés.
  const livre = { versets: new Map(), vocabulaire: new Set(), suites: new Set() };
  const chemin = join(cache, `ford_lsg_${fichierFordham.get(code)}.json`);
  if (existsSync(chemin))
    for (const chapitre of JSON.parse(readFileSync(chemin, "utf8")).chapters) {
      let precedent = null;
      for (const verset of chapitre.verses) {
        livre.versets.set(sansEspaces(verset.text), verset.text);
        for (const mot of mots(verset.text)) {
          livre.vocabulaire.add(mot);
          if (precedent) livre.suites.add(`${precedent} ${mot}`);
          precedent = mot;
        }
      }
    }
  temoins.set(code, livre);
  return livre;
}

// eBible perd parfois l'espace d'un retour à la ligne : « l'heure vientoù », « le
// prophèteDaniel ». Un mot inconnu du second témoin, qui se coupe en deux mots que ce témoin
// fait se suivre dans le même livre, est recoupé. Un mot inconnu qui ne se coupe pas ainsi
// est signalé, pour relecture.
function decoller(texte, code) {
  const { vocabulaire, suites } = temoin(code);
  if (!vocabulaire.size) return texte;
  return texte.replace(/[\p{L}’'-]+/gu, (mot) => {
    const cle = mots(mot)[0];
    if (!cle || vocabulaire.has(cle)) return mot;
    for (let i = 2; i <= mot.length - 1; i++) {
      const [gauche, droite] = [mots(mot.slice(0, i))[0], mots(mot.slice(i))[0]];
      if (gauche && droite && suites.has(`${gauche} ${droite}`)) {
        statistiques.decolles.push(`${mot} → ${mot.slice(0, i)} ${mot.slice(i)}`);
        return `${mot.slice(0, i)} ${mot.slice(i)}`;
      }
    }
    statistiques.inconnus.add(mot);
    return mot;
  });
}

// La source écrit la ponctuation à l'anglaise (« sauvé? », « dit: ») : on ajoute l'espace
// manquante, comme scripts/assembler-versets.mjs le fait pour les passages des leçons.
function typographieFrancaise(texte) {
  return texte
    .replace(/\s*([;:!?])/g, " $1")
    .replace(/«\s*/g, "« ")
    .replace(/\s*»/g, " »")
    .replace(/\s+/g, " ")
    .replace(/'/g, "’")
    .trim();
}

// La confession suit presque partout la numérotation de la Segond. Exception relevée : elle
// cite une fois « 2Cor 13.14 », numéro des Bibles anglaises, pour le verset que la Segond
// numérote 13.13 (et qu'elle cite ailleurs sous ce numéro). Le texte affiché est le bon.
const NUMEROTATIONS = new Map([["2 Corinthiens 13.14", [{ c1: 13, v1: 13, c2: 13, v2: 13 }]]]);

const statistiques = { confirmes: 0, nonConfirmes: [], decolles: [], inconnus: new Set() };

function texteDuVerset(code, chapitre, verset) {
  const brut = bible[code]?.[chapitre]?.[verset];
  if (!brut) return null;
  const jumeau = temoin(code).versets.get(sansEspaces(brut));
  if (jumeau) statistiques.confirmes++;
  else statistiques.nonConfirmes.push(`${code} ${chapitre}:${verset}`);
  // Confirmé : on prend la composition du témoin, espaces comprises. Sinon, le texte d'eBible,
  // après avoir remis les espaces perdues (ponctuation collée, puis mots collés).
  const texte = jumeau || decoller(brut.replace(/([\p{Ll}][,;:.!?])(?=[\p{L}])/gu, "$1 "), code);
  return typographieFrancaise(texte);
}

function versetsDuPassage(reference, erreurs) {
  const code = reference.livre.code;
  const parties = NUMEROTATIONS.get(reference.cle) || reference.parties;
  const versets = [];
  const plusieursChapitres = parties.some((p) => p.c1 !== p.c2);
  for (const partie of parties) {
    if (partie.chapitre) {
      const chapitre = bible[code]?.[partie.chapitre];
      if (!chapitre) {
        erreurs.push(`${reference.cle} : chapitre introuvable`);
        continue;
      }
      for (const v of Object.keys(chapitre).map(Number).sort((a, b) => a - b))
        versets.push({ v, t: texteDuVerset(code, partie.chapitre, v) });
      continue;
    }
    for (let c = partie.c1; c <= partie.c2; c++) {
      const chapitre = bible[code]?.[c] || {};
      const dernier = Math.max(0, ...Object.keys(chapitre).map(Number));
      const debut = c === partie.c1 ? partie.v1 : 1;
      const fin = c === partie.c2 ? partie.v2 : dernier;
      if (fin < debut || fin > dernier) erreurs.push(`${reference.cle} : le chapitre ${c} s’arrête au verset ${dernier}`);
      for (let v = debut; v <= Math.min(fin, dernier); v++) {
        const t = texteDuVerset(code, c, v);
        if (!t) erreurs.push(`${reference.cle} : verset ${c}.${v} introuvable`);
        else versets.push(plusieursChapitres ? { c, v, t } : { v, t });
      }
    }
  }
  return versets;
}

const reperes = {};
const passages = {};
const erreurs = [];
const ecartees = [];
let nbReferences = 0;

for (const fichier of readdirSync(dossier).filter((f) => f.endsWith(".json")).sort()) {
  const document = JSON.parse(readFileSync(join(dossier, fichier), "utf8"));
  for (const [adresse, texte] of textesDuDocument(document)) {
    const lu = reperer(texte);
    for (const e of lu.ecartees) ecartees.push(`${document.titre} : « ${e.source} » — ${e.raison}`);
    if (!lu.references.length) continue;
    (reperes[document.slug] ??= {})[adresse] = lu.references.map((r) => [r.debut, r.fin, r.cle]);
    nbReferences += lu.references.length;
    for (const reference of lu.references)
      if (!passages[reference.cle]) passages[reference.cle] = versetsDuPassage(reference, erreurs);
  }
}

if (erreurs.length) {
  console.error(erreurs.join("\n"));
  console.error(`\n${erreurs.length} référence(s) sans texte : rien n’a été écrit.`);
  process.exit(1);
}

const ordonnes = {};
for (const cle of Object.keys(passages).sort((a, b) => a.localeCompare(b, "fr", { numeric: true }))) ordonnes[cle] = passages[cle];

const sortie = join(racine, "app", "contenu", "versets-documents.json");
const contenu = JSON.stringify({ traduction: "Bible Louis Segond 1910", reperes, passages: ordonnes });
writeFileSync(sortie, contenu + "\n");

const nbVersets = Object.values(ordonnes).reduce((n, p) => n + p.length, 0);
console.log(
  `app/contenu/versets-documents.json : ${nbReferences} référence(s) cliquable(s), ${Object.keys(ordonnes).length} passage(s), ` +
    `${nbVersets} verset(s), ${Math.round(contenu.length / 1024)} Ko.`
);
console.log(
  `  second témoin : ${statistiques.confirmes} verset(s) confirmés mot pour mot, ${statistiques.nonConfirmes.length} sans jumeau.`
);
if (bavard && statistiques.nonConfirmes.length) console.log(`    ${[...new Set(statistiques.nonConfirmes)].join(", ")}`);
const decolles = [...new Set(statistiques.decolles)];
console.log(`  ${decolles.length} mot(s) collé(s) recoupé(s)${decolles.length ? " : " + decolles.join(" ; ") : ""}`);
if (statistiques.inconnus.size)
  console.log(`  mots absents du second témoin, à relire : ${[...statistiques.inconnus].join(", ")}`);
console.log(`  ${ecartees.length} référence(s) laissée(s) en texte simple :`);
for (const e of ecartees) console.log(`    ${e}`);
