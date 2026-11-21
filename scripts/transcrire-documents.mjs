#!/usr/bin/env node
// Transcrit les quatre documents de « La foi et les pratiques » (source/foi-et-pratiques-ebtm.pdf)
// vers app/contenu/documents/*.json, sans retaper un mot à la main.
//
// Le texte est repris tel qu'imprimé, fautes comprises : c'est une demande de Sébastien
// (21 novembre 2026, « ne rien modifier surtout »). Le script ne touche qu'à la structure :
// il reconnaît les titres à leur police, recolle les lignes d'un paragraphe et les mots coupés
// en fin de ligne. Les deux tables ci-dessous sont les seules décisions prises à la main ;
// elles ont été arrêtées en relisant les 28 pages en image.
//
// Demande l'outil « pdftohtml » (Poppler). Après l'avoir lancé :
//   node scripts/generer-index.mjs && node scripts/comparer-documents-au-pdf.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const pdf = join(racine, "source", "foi-et-pratiques-ebtm.pdf");
const sortie = join(racine, "app", "contenu", "documents");
const bavard = process.argv.includes("--details");

// Titres repris de la couverture (page 1) et de la tête de chaque document. La couverture les
// imprime en capitales ; ici seule la première lettre en garde une, comme pour les leçons.
const DOCUMENTS = [
  {
    numero: 1,
    slug: "confession-de-foi",
    titre: "Confession de foi",
    soustitre: "affirmée et enseignée par le conseil d’anciens de l’EBTM",
    pages: [2, 16],
  },
  { numero: 2, slug: "statuts-de-l-association", titre: "Statuts de l’association", pages: [17, 20] },
  { numero: 3, slug: "reglement-interieur", titre: "Règlement intérieur", pages: [21, 25] },
  {
    numero: 4,
    slug: "principes-ecclesiastiques",
    titre: "Principes ecclésiastiques",
    soustitre: "de notre union d’églises, l’Association Baptiste",
    pages: [26, 28],
  },
];

// Pages dont le premier paragraphe est la suite du dernier de la page précédente.
// Relevé page par page sur les images : la seule largeur de la dernière ligne ne suffit pas
// à le dire (page 10, le paragraphe se termine sur une ligne pleine).
const PAGES_QUI_CONTINUENT = new Set([3, 6, 8, 9, 12, 16, 19, 20, 24, 25]);

// Mots coupés en fin de ligne dont le trait d'union est un vrai trait d'union, à garder.
// Écrits « fin de ligne|début de la suivante ». Les plages de versets coupées entre deux
// chiffres (« 2Ti 3.15-|17 ») gardent toujours le leur, sans passer par cette table.
const VRAIS_TRAITS_D_UNION = new Set(["Saint-|Esprit", "Jésus-|Christ", "eux-|mêmes", "au-|delà"]);

// Polices de l'extraction : numéros de page, titres de document et leurs sous-titres.
const POLICES_IGNOREES = new Set(["4", "5", "6", "17", "11", "18", "13"]);
const POLICE_CHAPITRE_GRANDE = "7"; // la capitale d'un titre en petites capitales
const POLICE_CHAPITRE_PETITE = "8";
const POLICE_SOUS_TITRE = "12";

// Les sept chapitres de la confession sont imprimés en petites capitales : une grande police
// pour les capitales, une petite pour le reste. L'extraction en sort une casse et des espaces
// de fantaisie (« Le saLut », « L’eg Lise »). Les titres sont donc écrits ici tels que la page
// les montre, et le script vérifie seulement que les lettres extraites sont bien celles-là.
const CHAPITRES = [
  "Les Saintes Écritures",
  "Dieu",
  "L’homme",
  "Le salut",
  "L’Eglise",
  "Les anges",
  "Les derniers temps",
];
const lettres = (texte) => texte.toLowerCase().replace(/\s+/g, "");

function titreDeChapitre(extrait) {
  const titre = CHAPITRES.find((c) => lettres(c) === lettres(extrait));
  if (!titre) throw new Error(`Titre de chapitre inattendu dans le PDF : « ${extrait} »`);
  return titre;
}

function decoder(texte) {
  return texte
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/ﬁ/g, "fi")
    .replace(/ﬂ/g, "fl");
}

function lirePages() {
  const dossier = mkdtempSync(join(tmpdir(), "documents-"));
  try {
    execFileSync("pdftohtml", ["-xml", "-i", "-q", "-hidden", pdf, join(dossier, "doc")]);
    const xml = readFileSync(join(dossier, "doc.xml"), "utf8");
    const pages = new Map();
    let courante = null;
    for (const ligne of xml.split("\n")) {
      const page = ligne.match(/^<page number="(\d+)"/);
      if (page) {
        courante = [];
        pages.set(Number(page[1]), courante);
        continue;
      }
      const t = ligne.match(/^<text top="(\d+)" left="(\d+)" width="(\d+)" height="(\d+)" font="(\d+)">(.*)<\/text>$/);
      if (!t || !courante) continue;
      const brut = t[6];
      courante.push({
        haut: Number(t[1]),
        gauche: Number(t[2]),
        largeur: Number(t[3]),
        police: t[5],
        gras: /<b>/.test(brut),
        italique: /<i>/.test(brut),
        texte: decoder(brut.replace(/<[^>]+>/g, "")),
      });
    }
    return pages;
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
}

// Regroupe les morceaux d'une page en lignes, de haut en bas.
function lignesDeLaPage(morceaux) {
  const utiles = morceaux
    .filter((m) => !POLICES_IGNOREES.has(m.police))
    .sort((a, b) => a.haut - b.haut || a.gauche - b.gauche);
  const lignes = [];
  for (const m of utiles) {
    const derniere = lignes[lignes.length - 1];
    if (derniere && Math.abs(m.haut - derniere.haut) <= 8) derniere.morceaux.push(m);
    else lignes.push({ haut: m.haut, morceaux: [m] });
  }
  return lignes.map((ligne) => {
    const morceaux = ligne.morceaux.sort((a, b) => a.gauche - b.gauche);
    const polices = new Set(morceaux.map((m) => m.police));
    const chapitre = polices.has(POLICE_CHAPITRE_GRANDE) || polices.has(POLICE_CHAPITRE_PETITE);
    const brut = morceaux.map((m) => m.texte).join("");
    const texte = chapitre ? titreDeChapitre(brut) : brut;
    const corps = morceaux.filter((m) => m.texte.trim());
    return {
      haut: Math.max(...morceaux.map((m) => m.haut)),
      gauche: Math.min(...morceaux.map((m) => m.gauche)),
      droite: Math.max(...morceaux.map((m) => m.gauche + m.largeur)),
      texte: texte.replace(/[ \t ]+/g, " ").trim(),
      genre: chapitre
        ? "chapitre"
        : polices.has(POLICE_SOUS_TITRE)
          ? "sous-titre"
          : corps.length && corps.every((m) => m.gras)
            ? "gras"
            : "corps",
      italique: corps.length > 0 && corps.every((m) => m.italique),
    };
  }).filter((l) => l.texte);
}

const coupures = []; // pour relecture : chaque mot recollé en fin de ligne

// Recolle deux lignes d'un même paragraphe.
function joindre(avant, apres) {
  if (!avant) return apres;
  if (avant.endsWith("-")) {
    const fin = avant.split(" ").pop();
    const debut = apres.split(" ")[0];
    const garde =
      (/\d-$/.test(fin) && /^\d/.test(debut)) ||
      VRAIS_TRAITS_D_UNION.has(`${fin}|${debut.replace(/[.,;:!?)»]+$/, "")}`);
    coupures.push(`${fin}|${debut}${garde ? "   (trait d’union gardé)" : ""}`);
    return garde ? avant + apres : avant.slice(0, -1) + apres;
  }
  return `${avant} ${apres}`;
}

function transcrire(document, pages) {
  const sections = [];
  let section = null;
  let bloc = null; // paragraphe ou élément de liste en cours
  let precedente = null;

  const fermer = () => (bloc = null);
  const blocs = () => {
    if (!section) throw new Error(`${document.slug} : du texte avant le premier titre`);
    return section.blocs;
  };

  for (let page = document.pages[0]; page <= document.pages[1]; page++) {
    const lignes = lignesDeLaPage(pages.get(page));
    let premiereDeLaPage = true;
    for (const ligne of lignes) {
      const ecart = precedente && !premiereDeLaPage ? ligne.haut - precedente.haut : null;
      const titre =
        ligne.genre === "chapitre"
          ? "section"
          : ligne.genre === "sous-titre"
            ? "sous-titre"
            : ligne.genre === "gras"
              ? niveauDuGras(document, ligne.texte)
              : null;

      if (titre === "section") {
        section = { titre: ligne.texte, blocs: [] };
        sections.push(section);
        fermer();
      } else if (titre === "sous-titre") {
        blocs().push({ type: "sous-titre", texte: ligne.texte });
        fermer();
      } else {
        const puce = /^•\s*/.test(ligne.texte);
        const texte = ligne.texte.replace(/^•\s*/, "");
        const suiteDePage = premiereDeLaPage && PAGES_QUI_CONTINUENT.has(page);
        const memeBloc =
          bloc &&
          !puce &&
          (suiteDePage ||
            (!premiereDeLaPage && ecart <= 30 && !(bloc.liste && ligne.gauche < 70)));
        if (memeBloc) {
          bloc.texte = joindre(bloc.texte, texte);
          bloc.poser();
        } else if (puce) {
          const dernier = blocs()[blocs().length - 1];
          const liste = dernier && dernier.type === "liste" && bloc && bloc.liste ? dernier : { type: "liste", elements: [] };
          if (liste !== dernier) blocs().push(liste);
          const rang = liste.elements.length;
          bloc = { liste: true, texte, poser: () => (liste.elements[rang] = bloc.texte) };
          bloc.poser();
        } else {
          const paragraphe = { type: "paragraphe", texte: "" };
          blocs().push(paragraphe);
          const italique = ligne.italique;
          bloc = {
            liste: false,
            texte,
            poser: () => (paragraphe.texte = italique ? `*${bloc.texte}*` : bloc.texte),
          };
          bloc.poser();
        }
      }
      precedente = ligne;
      premiereDeLaPage = false;
    }
  }

  const resultat = { numero: document.numero, slug: document.slug, titre: document.titre };
  if (document.soustitre) resultat.soustitre = document.soustitre;
  resultat.pages = `${document.pages[0]}-${document.pages[1]}`;
  resultat.sections = sections;
  return resultat;
}

// Les statuts et les principes n'ont qu'un rang de titres en gras. Le règlement en a deux :
// les grands titres sont en capitales, les autres en casse ordinaire.
function niveauDuGras(document, texte) {
  if (document.slug !== "reglement-interieur") return "section";
  return texte === texte.toUpperCase() ? "section" : "sous-titre";
}

const pages = lirePages();
mkdirSync(sortie, { recursive: true });
for (const document of DOCUMENTS) {
  const transcrit = transcrire(document, pages);
  const fichier = `${String(document.numero).padStart(2, "0")}-${document.slug}.json`;
  writeFileSync(join(sortie, fichier), JSON.stringify(transcrit, null, 2) + "\n");
  const nbBlocs = transcrit.sections.reduce((n, s) => n + s.blocs.length, 0);
  console.log(`${fichier} : ${transcrit.sections.length} titre(s), ${nbBlocs} bloc(s).`);
}
if (bavard) {
  console.log(`\n${coupures.length} mots recollés en fin de ligne :`);
  for (const c of coupures) console.log(`  ${c}`);
}
