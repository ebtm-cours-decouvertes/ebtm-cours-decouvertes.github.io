// Les seules différences admises entre les documents de l'église affichés par l'application
// et le PDF d'origine (source/foi-et-pratiques-ebtm.pdf).
//
// Règle de Sébastien (21 novembre 2026) : le document doit rester identique, on ne corrige que
// les fautes d'orthographe, et rien qui le dénature. Chaque ligne ci-dessous est une faute
// relevée en relisant les quatre textes en entier, et dont la correction ne change pas le sens.
// Ne sont pas corrigés, parce que ce serait réécrire : les majuscules sans accent (« Eglise »,
// « Ecriture »), les espaces autour des deux-points et des guillemets des statuts, la
// ponctuation des références bibliques (« Jn.1,18 »), les tournures discutables.
//
// scripts/transcrire-documents.mjs applique cette liste ; scripts/comparer-documents-au-pdf.mjs
// la défait avant de comparer au PDF lettre par lettre. Tout autre écart reste donc refusé.
// Chaque passage doit se trouver une fois et une seule dans son document : sinon les deux
// scripts s'arrêtent, plutôt que de corriger au mauvais endroit.
export const CORRECTIONS = [
  // Confession de foi
  { document: "confession-de-foi", avant: "qu’il n’y qu’un seul vrai Dieu", apres: "qu’il n’y a qu’un seul vrai Dieu" },
  { document: "confession-de-foi", avant: "en trois personnes– le Père", apres: "en trois personnes – le Père" },
  { document: "confession-de-foi", avant: "ils n’ont jamais été destiné à devenir", apres: "ils n’ont jamais été destinés à devenir" },
  { document: "confession-de-foi", avant: "le Saint Esprit distribue", apres: "le Saint-Esprit distribue" },
  { document: "confession-de-foi", avant: "qu’il y aussi une sanctification", apres: "qu’il y a aussi une sanctification" },
  { document: "confession-de-foi", avant: "devraient cependant êtres les seules juges", apres: "devraient cependant être les seules juges" },
  { document: "confession-de-foi", avant: "Ap. 22.12).Nous croyons", apres: "Ap. 22.12). Nous croyons" },
  // Statuts de l'association
  { document: "statuts-de-l-association", avant: "une durée de 3ans", apres: "une durée de 3 ans" },
  { document: "statuts-de-l-association", avant: "la radiation éventuelle d‘un diacre", apres: "la radiation éventuelle d’un diacre" },
  { document: "statuts-de-l-association", avant: "avant 1’élection", apres: "avant l’élection" },
  // Règlement intérieur
  { document: "reglement-interieur", avant: "de sontémoignage", apres: "de son témoignage" },
  { document: "reglement-interieur", avant: "en en lieu éloigné", apres: "en un lieu éloigné" },
  { document: "reglement-interieur", avant: "dont dépendent la qualité", apres: "dont dépend la qualité" },
  // Principes ecclésiastiques
  { document: "principes-ecclesiastiques", avant: "une interdépen- dance", apres: "une interdépendance" },
  { document: "principes-ecclesiastiques", avant: "se soumet- tent", apres: "se soumettent" },
];

// Chaque texte d'un document, avec de quoi le lire et le réécrire.
function champs(document) {
  const liste = [];
  for (const section of document.sections) {
    for (const bloc of section.blocs) {
      if (bloc.type === "liste") {
        bloc.elements.forEach((_, i) =>
          liste.push({ lire: () => bloc.elements[i], ecrire: (texte) => (bloc.elements[i] = texte) })
        );
      } else {
        liste.push({ lire: () => bloc.texte, ecrire: (texte) => (bloc.texte = texte) });
      }
    }
  }
  return liste;
}

function remplacer(document, de, vers) {
  const lieux = champs(document).filter((champ) => champ.lire().includes(de));
  const nombre = lieux.reduce((n, champ) => n + champ.lire().split(de).length - 1, 0);
  if (nombre !== 1)
    throw new Error(`${document.slug} : « ${de} » trouvé ${nombre} fois, attendu une seule fois.`);
  lieux[0].ecrire(lieux[0].lire().replace(de, vers));
}

const pour = (document) => CORRECTIONS.filter((c) => c.document === document.slug);

// Applique les corrections à un document tout juste recopié du PDF.
export function corriger(document) {
  for (const c of pour(document)) remplacer(document, c.avant, c.apres);
  return document;
}

// Rend à un document corrigé le texte exact du PDF, pour le comparer à celui-ci.
export function retablir(document) {
  for (const c of pour(document).reverse()) remplacer(document, c.apres, c.avant);
  return document;
}
