// Retire les commentaires de travail de la copie publiée de l'application (JavaScript, feuille
// de style, page HTML), sur place, dans le dossier donné. Jamais sur le dossier de travail :
// publier.sh l'appelle sur sa copie, juste avant l'envoi. Demandé par Sébastien le 27 novembre
// 2026 : le dépôt public montrait les notes de travail (prénom, dates, remarques).
//
//   node scripts/sans-commentaires.mjs <dossier>
//
// Le JavaScript est lu caractère par caractère, sans dépendance : chaînes, gabarits `…${…}…`,
// expressions régulières et commentaires sont reconnus, et seuls les commentaires sont retirés.
// Dans un gabarit, les commentaires HTML (<!-- … -->) le sont aussi : ce sont ceux des écrans.
// Un commentaire qui traversait une fin de ligne laisse une fin de ligne (insertion automatique
// des points-virgules). Le résultat est vérifié par « node --check », puis par l'outil de test
// complet lancé sur cette copie (publier.sh).

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const PRECEDE_UNE_REGEX = new Set([..."(,=:[!&|?{};+-*%<>~^"]);
const MOTS_AVANT_REGEX = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await"]);

export function javascriptSansCommentaires(source) {
  let sortie = "";
  let i = 0;
  const n = source.length;
  // Pile des contextes : un gabarit (« gabarit ») ou du code (« code », avec ses accolades
  // ouvertes, pour savoir quelle « } » ferme un ${…}).
  const pile = [{ mode: "code", accolades: 0 }];
  let precedent = ""; // dernier caractère significatif écrit en mode code
  let motPrecedent = ""; // dernier mot écrit en mode code

  const copierJusqua = (fin) => {
    sortie += source.slice(i, fin);
    i = fin;
  };

  while (i < n) {
    const cadre = pile[pile.length - 1];
    const c = source[i];
    const suivant = source[i + 1];

    if (cadre.mode === "gabarit") {
      if (c === "\\") {
        copierJusqua(i + 2);
      } else if (c === "`") {
        copierJusqua(i + 1);
        pile.pop();
        precedent = "`";
        motPrecedent = "";
      } else if (c === "$" && suivant === "{") {
        copierJusqua(i + 2);
        pile.push({ mode: "code", accolades: 0 });
        precedent = "{";
        motPrecedent = "";
      } else if (source.startsWith("<!--", i)) {
        const fin = source.indexOf("-->", i + 4);
        if (fin < 0) throw new Error("commentaire HTML non fermé dans un gabarit");
        // Une ligne qui ne contenait que le commentaire disparaît avec lui.
        const debutLigne = sortie.lastIndexOf("\n") + 1;
        const seul = /^[ \t]*$/.test(sortie.slice(debutLigne)) && /^[ \t]*\n/.test(source.slice(fin + 3));
        i = fin + 3;
        if (seul) {
          sortie = sortie.slice(0, debutLigne);
          i = source.indexOf("\n", i) + 1;
        }
      } else {
        copierJusqua(i + 1);
      }
      continue;
    }

    // Mode code.
    if (c === "/" && suivant === "/") {
      const fin = source.indexOf("\n", i);
      i = fin < 0 ? n : fin;
      continue;
    }
    if (c === "/" && suivant === "*") {
      const fin = source.indexOf("*/", i + 2);
      if (fin < 0) throw new Error("commentaire non fermé");
      sortie += source.slice(i, fin + 2).includes("\n") ? "\n" : " ";
      i = fin + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && source[j] !== c) {
        if (source[j] === "\\") j++;
        if (source[j] === "\n") throw new Error("chaîne non fermée");
        j++;
      }
      copierJusqua(j + 1);
      precedent = c;
      motPrecedent = "";
      continue;
    }
    if (c === "`") {
      copierJusqua(i + 1);
      pile.push({ mode: "gabarit" });
      continue;
    }
    if (c === "/") {
      const regex = precedent === "" || PRECEDE_UNE_REGEX.has(precedent) || (MOTS_AVANT_REGEX.has(motPrecedent) && /\w/.test(precedent));
      if (regex) {
        let j = i + 1;
        let classe = false;
        while (j < n) {
          const r = source[j];
          if (r === "\\") j += 2;
          else if (r === "\n") throw new Error("expression régulière non fermée");
          else if (classe) {
            if (r === "]") classe = false;
            j++;
          } else if (r === "[") {
            classe = true;
            j++;
          } else if (r === "/") break;
          else j++;
        }
        j++;
        while (j < n && /[a-z]/i.test(source[j])) j++;
        copierJusqua(j);
        precedent = "/";
        motPrecedent = "";
        continue;
      }
    }
    if (c === "{") cadre.accolades++;
    if (c === "}") {
      if (cadre.accolades === 0 && pile.length > 1) {
        pile.pop();
        copierJusqua(i + 1);
        continue;
      }
      cadre.accolades--;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$]/.test(source[j])) j++;
      motPrecedent = source.slice(i, j);
      precedent = source[j - 1];
      copierJusqua(j);
      continue;
    }
    if (!/\s/.test(c)) {
      precedent = c;
      motPrecedent = "";
    }
    copierJusqua(i + 1);
  }
  if (pile.length !== 1) throw new Error("gabarit non fermé");
  return nettoyerLignes(sortie);
}

export function cssSansCommentaires(source) {
  let sortie = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "*") {
      const fin = source.indexOf("*/", i + 2);
      if (fin < 0) throw new Error("commentaire CSS non fermé");
      i = fin + 2;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== c) j += source[j] === "\\" ? 2 : 1;
      sortie += source.slice(i, j + 1);
      i = j + 1;
    } else {
      sortie += c;
      i++;
    }
  }
  return nettoyerLignes(sortie);
}

export function htmlSansCommentaires(source) {
  return nettoyerLignes(source.replace(/<!--[\s\S]*?-->/g, ""));
}

// Espaces en fin de ligne retirés, lignes vides en série ramenées à une seule.
function nettoyerLignes(texte) {
  return texte
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "");
}

const TRAITEMENTS = { ".js": javascriptSansCommentaires, ".css": cssSansCommentaires, ".html": htmlSansCommentaires };

function parcourir(dossier, liste = []) {
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, entree.name);
    if (entree.isDirectory()) parcourir(chemin, liste);
    else if (TRAITEMENTS[path.extname(entree.name)]) liste.push(chemin);
  }
  return liste;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const dossier = process.argv[2];
  if (!dossier || !fs.existsSync(dossier)) {
    console.error("Usage : node scripts/sans-commentaires.mjs <dossier>");
    process.exit(2);
  }
  const racine = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  if (path.resolve(dossier) === path.join(racine, "app")) {
    console.error("Refusé : ce script ne s'applique qu'à une copie, jamais au dossier de travail app/.");
    process.exit(2);
  }
  for (const fichier of parcourir(dossier)) {
    const avant = fs.readFileSync(fichier, "utf8");
    const apres = TRAITEMENTS[path.extname(fichier)](avant);
    fs.writeFileSync(fichier, apres);
    if (fichier.endsWith(".js")) {
      const controle = spawnSync(process.execPath, ["--check", fichier], { encoding: "utf8" });
      if (controle.status !== 0) {
        console.error(`ARRÊT : ${fichier} n'est plus du JavaScript valide après retrait des commentaires.\n${controle.stderr}`);
        process.exit(1);
      }
    }
    console.log(`  ${path.relative(dossier, fichier)} : ${avant.length} → ${apres.length} caractères`);
  }
}
