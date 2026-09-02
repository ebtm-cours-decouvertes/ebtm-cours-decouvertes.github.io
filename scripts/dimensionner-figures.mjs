#!/usr/bin/env node
// Inscrit dans les leçons la taille réelle de chaque figure, lue dans l'en-tête du PNG.
// Sans ces dimensions, le navigateur ne réserve aucune place à l'image : la page saute
// quand elle arrive, ce qui décale la lecture en cours et la position mémorisée.
// À relancer si une figure est remplacée.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const dossierLecons = join(racine, "app", "contenu", "lecons");
const dossierFigures = join(racine, "app", "contenu", "figures");

// En-tête PNG : signature (8 octets), longueur (4), type « IHDR » (4), largeur (4), hauteur (4).
function taillePng(chemin) {
  const octets = readFileSync(chemin);
  if (octets.toString("ascii", 12, 16) !== "IHDR") throw new Error(`${chemin} : ce n’est pas un PNG`);
  return { largeur: octets.readUInt32BE(16), hauteur: octets.readUInt32BE(20) };
}

let modifies = 0;
let figures = 0;
for (const nom of readdirSync(dossierLecons).filter((f) => f.endsWith(".json")).sort()) {
  const chemin = join(dossierLecons, nom);
  const brut = readFileSync(chemin, "utf8");
  const lecon = JSON.parse(brut);
  let touche = false;

  const parcourir = (valeur) => {
    if (Array.isArray(valeur)) return valeur.forEach(parcourir);
    if (!valeur || typeof valeur !== "object") return;
    if (valeur.type === "figure" && valeur.fichier) {
      const { largeur, hauteur } = taillePng(join(dossierFigures, valeur.fichier));
      figures++;
      if (valeur.largeur !== largeur || valeur.hauteur !== hauteur) {
        valeur.largeur = largeur;
        valeur.hauteur = hauteur;
        touche = true;
      }
    }
    Object.values(valeur).forEach(parcourir);
  };
  parcourir(lecon);

  if (touche) {
    writeFileSync(chemin, JSON.stringify(lecon, null, 2) + "\n");
    modifies++;
    console.log(`  ${nom} : dimensions inscrites`);
  }
}
console.log(`${figures} figure(s) contrôlée(s), ${modifies} leçon(s) modifiée(s).`);
