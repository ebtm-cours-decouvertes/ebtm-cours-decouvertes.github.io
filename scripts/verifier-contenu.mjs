#!/usr/bin/env node
// Vérifie la structure des leçons dans app/contenu/lecons/*.json (voir contenu/SCHEMA.md).
// Sans dépendance. Affiche « OK » ou la liste des erreurs, code de sortie 1 en cas d'erreur.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const dossier = join(racine, "app", "contenu", "lecons");
const TYPES = {
  "sous-titre": ["texte"],
  paragraphe: ["texte"],
  citation: ["texte"],
  verset: ["texte", "reference"],
  encadre: ["texte"],
  liste: ["elements"],
  note: ["texte"],
  figure: ["fichier", "texte", "largeur", "hauteur"],
  tableau: ["colonnes", "lignes"],
};
const dossierFigures = join(racine, "app", "contenu", "figures");
const erreurs = [];
const err = (fichier, message) => erreurs.push(`${fichier} : ${message}`);

function verifierTexte(fichier, ou, texte) {
  if (typeof texte !== "string" || !texte.trim()) return err(fichier, `${ou} : texte vide`);
  const gras = (texte.match(/\*\*/g) || []).length;
  if (gras % 2) err(fichier, `${ou} : marqueur ** non fermé`);
  const italique = (texte.replace(/\*\*/g, "").match(/\*/g) || []).length;
  if (italique % 2) err(fichier, `${ou} : marqueur * non fermé`);
  if (/  /.test(texte)) err(fichier, `${ou} : double espace`);
  if (/'/.test(texte)) err(fichier, `${ou} : apostrophe droite ' (utiliser ’)`);
  // L'en-tête répété du livret associe toujours ces deux mentions ; seule leur présence conjointe est suspecte
  // (la chronologie de la leçon 10 cite légitimement « Eglise Baptiste Toulouse Métropole »).
  if (/cours découvertes/i.test(texte) && /EGLISE BAPTISTE TOULOUSE MÉTROPOLE/i.test(texte))
    err(fichier, `${ou} : en-tête du livret resté dans le texte`);
  if (/^\s|\s$/.test(texte)) err(fichier, `${ou} : espace en début ou fin`);
}

function verifierBloc(fichier, ouB, b) {
  const champs = TYPES[b.type];
  if (!champs) return err(fichier, `${ouB} : type inconnu « ${b.type} »`);
  for (const c of champs) if (b[c] === undefined) err(fichier, `${ouB} : champ « ${c} » manquant pour ${b.type}`);
  if (b.type === "liste") {
    if (!Array.isArray(b.elements) || b.elements.length === 0) err(fichier, `${ouB} : elements vide`);
    else b.elements.forEach((e, k) => verifierTexte(fichier, `${ouB}.elements[${k}]`, e));
  } else if (b.type === "tableau") {
    if (!Array.isArray(b.colonnes) || b.colonnes.length < 2) err(fichier, `${ouB} : au moins deux colonnes attendues`);
    else b.colonnes.forEach((c, k) => verifierTexte(fichier, `${ouB}.colonnes[${k}]`, c));
    if (!Array.isArray(b.lignes) || b.lignes.length === 0) err(fichier, `${ouB} : lignes vides`);
    else
      b.lignes.forEach((ligne, k) => {
        if (!Array.isArray(ligne) || ligne.length !== (b.colonnes || []).length)
          return err(fichier, `${ouB}.lignes[${k}] : ${(b.colonnes || []).length} cellules attendues`);
        ligne.forEach((cellule, c) => verifierTexte(fichier, `${ouB}.lignes[${k}][${c}]`, cellule));
      });
    if (b.titre !== undefined) verifierTexte(fichier, `${ouB}.titre`, b.titre);
  } else if (typeof b.texte === "string") verifierTexte(fichier, ouB, b.texte);
  if (b.type === "figure") {
    if (typeof b.fichier === "string" && !existsSync(join(dossierFigures, b.fichier)))
      err(fichier, `${ouB} : image introuvable — app/contenu/figures/${b.fichier}`);
    if (/[\\/]/.test(b.fichier || "")) err(fichier, `${ouB} : fichier doit être un simple nom, sans chemin`);
    if (b.legende !== undefined) verifierTexte(fichier, `${ouB}.legende`, b.legende);
  }
  if (b.type === "encadre" && b.titre !== undefined) verifierTexte(fichier, `${ouB}.titre`, b.titre);
  if (b.type === "citation" && b.auteur !== undefined) verifierTexte(fichier, `${ouB}.auteur`, b.auteur);
}

const fichiers = readdirSync(dossier).filter((f) => f.endsWith(".json")).sort();
if (fichiers.length === 0) err("app/contenu/lecons", "aucun fichier de leçon");
const numeros = new Set();

for (const fichier of fichiers) {
  let lecon;
  try {
    lecon = JSON.parse(readFileSync(join(dossier, fichier), "utf8"));
  } catch (e) {
    err(fichier, `JSON invalide : ${e.message}`);
    continue;
  }
  const { numero, slug, titre, pages, introduction, sections, versets_a_apprendre, questions } = lecon;
  if (!Number.isInteger(numero) || numero < 1) err(fichier, "numero manquant ou invalide");
  if (numeros.has(numero)) err(fichier, `numero ${numero} en double`);
  numeros.add(numero);
  if (!fichier.startsWith(String(numero).padStart(2, "0") + "-")) err(fichier, "le nom du fichier ne commence pas par le numéro");
  if (!/^[a-z0-9-]+$/.test(slug || "")) err(fichier, "slug manquant ou invalide (minuscules, chiffres, tirets)");
  if (typeof titre !== "string" || !titre.trim()) err(fichier, "titre manquant");
  if (!/^\d+-\d+$/.test(pages || "")) err(fichier, "pages attendu sous la forme « 3-6 »");
  if (!Array.isArray(introduction)) err(fichier, "introduction doit être un tableau");
  else
    introduction.forEach((element, i) => {
      if (typeof element === "string") verifierTexte(fichier, `introduction[${i}]`, element);
      else if (element && typeof element === "object") verifierBloc(fichier, `introduction[${i}]`, element);
      else err(fichier, `introduction[${i}] : ni texte ni bloc`);
    });

  if (!Array.isArray(sections) || sections.length === 0) err(fichier, "sections manquantes");
  else
    sections.forEach((s, i) => {
      const ou = `sections[${i}]`;
      if (typeof s.titre !== "string" || !s.titre.trim()) err(fichier, `${ou} : titre manquant`);
      else if (s.titre[0] !== s.titre[0].toUpperCase()) err(fichier, `${ou} : le titre doit commencer par une majuscule`);
      if (!Array.isArray(s.blocs) || s.blocs.length === 0) return err(fichier, `${ou} : blocs manquants`);
      s.blocs.forEach((b, j) => verifierBloc(fichier, `${ou}.blocs[${j}]`, b));
    });

  // Tableau vide accepté : la leçon 10 n'a ni versets à apprendre ni questions.
  if (!Array.isArray(versets_a_apprendre)) err(fichier, "versets_a_apprendre doit être un tableau");
  else
    versets_a_apprendre.forEach((v, i) => {
      const ou = `versets_a_apprendre[${i}]`;
      if (!v.reference) err(fichier, `${ou} : reference manquante`);
      verifierTexte(fichier, ou, v.texte);
      if (!["livret", "Segond 1910"].includes(v.source)) err(fichier, `${ou} : source doit valoir « livret » ou « Segond 1910 »`);
    });

  if (!Array.isArray(questions)) err(fichier, "questions doit être un tableau");
  else {
    questions.forEach((q, i) => {
      const ou = `questions[${i}]`;
      if (q.numero !== i + 1) err(fichier, `${ou} : numero attendu ${i + 1}, trouvé ${q.numero}`);
      verifierTexte(fichier, ou, q.texte);
      if (i === 0 && q.recitation !== true) err(fichier, `${ou} : la première question doit avoir recitation: true`);
    });
  }
}

// L'index doit correspondre exactement aux fichiers de leçons (voir scripts/generer-index.mjs).
try {
  const index = JSON.parse(readFileSync(join(racine, "app", "contenu", "index.json"), "utf8"));
  const attendu = fichiers.map((fichier) => {
    const l = JSON.parse(readFileSync(join(dossier, fichier), "utf8"));
    return { numero: l.numero, titre: l.titre, fichier, nbQuestions: (l.questions || []).length };
  });
  const figuresAttendues = new Set();
  for (const f of fichiers) {
    const l = JSON.parse(readFileSync(join(dossier, f), "utf8"));
    const blocs = [...(l.introduction || []).filter((e) => typeof e === "object")];
    for (const section of l.sections || []) blocs.push(...(section.blocs || []));
    for (const bloc of blocs) if (bloc.type === "figure") figuresAttendues.add(bloc.fichier);
  }
  if (
    JSON.stringify(index.lecons) !== JSON.stringify(attendu) ||
    JSON.stringify(index.figures || []) !== JSON.stringify([...figuresAttendues].sort())
  )
    err("app/contenu/index.json", "ne correspond pas aux leçons : lancer node scripts/generer-index.mjs");
} catch (e) {
  err("app/contenu/index.json", `illisible : ${e.message}`);
}

// Chaque référence biblique citée dans une leçon doit avoir son texte dans versets.json,
// sinon elle serait cliquable pour rien.
try {
  const table = JSON.parse(readFileSync(join(racine, "app", "contenu", "versets.json"), "utf8"));
  const attendues = JSON.parse(readFileSync(join(racine, "scripts", "references-a-resoudre.json"), "utf8"));
  const absentes = attendues.filter((r) => !(table.versets || {})[r.reference]).map((r) => r.reference);
  if (absentes.length)
    err("app/contenu/versets.json", `${absentes.length} référence(s) sans texte : ${absentes.slice(0, 5).join(", ")}${absentes.length > 5 ? "…" : ""}`);
} catch (e) {
  err("app/contenu/versets.json", `illisible : ${e.message}`);
}

if (erreurs.length) {
  console.error(erreurs.join("\n"));
  console.error(`\n${erreurs.length} erreur(s) dans ${fichiers.length} leçon(s).`);
  process.exit(1);
}
console.log(`OK — ${fichiers.length} leçon(s) valide(s) : ${[...numeros].sort((a, b) => a - b).join(", ")}`);
