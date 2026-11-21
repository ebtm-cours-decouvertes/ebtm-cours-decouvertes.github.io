// Lit les références bibliques des documents de l'église (app/contenu/documents/*.json).
//
// Elles ne s'écrivent pas comme dans les leçons : le livre est abrégé (« 1Cor », « Jn »,
// « Ap »), et il n'est donné qu'une fois pour toute une suite :
//   « (Mt 5.18, 24.35, Jn 10.35, 16.12-13, 17.17) » → Matthieu 5.18, Matthieu 24.35,
//   Jean 10.35, Jean 16.12-13, Jean 17.17.
// Une référence isolée (« 24.35 ») ne dit donc rien sans ce qui la précède : c'est ce module
// qui le retrouve. Il ne change rien au texte, il indique seulement où se trouve chaque
// référence et quel passage elle désigne.
//
// Utilisé par construire-versets-documents.mjs et verifier-versets-documents.mjs.

// Abréviations rencontrées dans le PDF, nom affiché en tête de la fenêtre de lecture, code du
// livre dans le texte source (USFM). « unChapitre » : livre d'un seul chapitre, où le premier
// nombre est déjà un verset (« Jud.24 »).
const LIVRES = [
  [["Ge", "Gen"], "Genèse", "GEN"],
  [["Ex"], "Exode", "EXO"],
  [["De"], "Deutéronome", "DEU"],
  [["2Sa"], "2 Samuel", "2SA"],
  [["2R"], "2 Rois", "2KI"],
  [["1Ch"], "1 Chroniques", "1CH"],
  [["Ps"], "Psaume", "PSA"],
  [["Eccl"], "Ecclésiaste", "ECC"],
  [["Es"], "Ésaïe", "ISA"],
  [["Jé", "Jér"], "Jérémie", "JER"],
  [["Ez"], "Ézéchiel", "EZK"],
  [["Da", "Dan"], "Daniel", "DAN"],
  [["Mi"], "Michée", "MIC"],
  [["Ha"], "Habacuc", "HAB"],
  [["Za"], "Zacharie", "ZEC"],
  [["Mt", "Mat"], "Matthieu", "MAT"],
  [["Lu", "Luc"], "Luc", "LUK"],
  [["Jn"], "Jean", "JHN"],
  [["Ac", "Act", "Actes"], "Actes", "ACT"],
  [["Ro"], "Romains", "ROM"],
  [["1Cor", "1 Cor", "1Co"], "1 Corinthiens", "1CO"],
  [["2Cor"], "2 Corinthiens", "2CO"],
  [["Ga", "Gal"], "Galates", "GAL"],
  [["Ep", "Eph", "Éphésiens"], "Éphésiens", "EPH"],
  [["Ph", "Phil"], "Philippiens", "PHP"],
  [["Col"], "Colossiens", "COL"],
  [["1Th"], "1 Thessaloniciens", "1TH"],
  [["2Th", "2Thes", "2Thess"], "2 Thessaloniciens", "2TH"],
  [["1Ti", "1Tim", "1 Timothée"], "1 Timothée", "1TI"],
  [["2Ti"], "2 Timothée", "2TI"],
  [["Tit", "Tite"], "Tite", "TIT"],
  [["Hé", "Héb"], "Hébreux", "HEB"],
  [["Ja", "Jac"], "Jacques", "JAS"],
  [["1Pi"], "1 Pierre", "1PE"],
  [["2Pi"], "2 Pierre", "2PE"],
  [["1Jn"], "1 Jean", "1JN"],
  [["2Jn"], "2 Jean", "2JN", true],
  [["Jud"], "Jude", "JUD", true],
  [["Ap", "Apo"], "Apocalypse", "REV"],
].map(([abreviations, nom, code, unChapitre]) => ({ abreviations, nom, code, unChapitre: Boolean(unChapitre) }));

const parAbreviation = new Map();
for (const livre of LIVRES) for (const a of livre.abreviations) parAbreviation.set(a, livre);
const parNom = new Map(LIVRES.map((l) => [l.nom, l]));

const motifLivres = [...parAbreviation.keys()]
  .sort((a, b) => b.length - a.length)
  .map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

// Références que la règle générale lirait mal, ou qu'on ne peut pas lire sans interpréter.
// Chaque entrée est le texte exact du PDF. « passages » : la lecture retenue, morceau par
// morceau ; « raison » seule : la référence reste du texte simple, et la raison est donnée
// dans le compte rendu de construire-versets-documents.mjs.
const CAS_PARTICULIERS = [
  {
    // La virgule tient ici lieu de point, avec une espace : Apocalypse 19.10 et 22.8-9 sont
    // les deux passages où l'ange refuse d'être adoré, ce dont parle la phrase.
    texte: "Apo.19, 10 ; 22,8-9",
    passages: [
      ["Apo.19, 10", "Apocalypse", [{ c1: 19, v1: 10, c2: 19, v2: 10 }]],
      ["22,8-9", "Apocalypse", [{ c1: 22, v1: 8, c2: 22, v2: 9 }]],
    ],
  },
  {
    // Même écriture : Apocalypse 21.8 est le verset de « la seconde mort », que la phrase cite.
    texte: "Apo.21, 8",
    passages: [["Apo.21, 8", "Apocalypse", [{ c1: 21, v1: 8, c2: 21, v2: 8 }]]],
  },
  { texte: "Jn 10.15/18", raison: "« 15/18 » peut vouloir dire les versets 15 et 18, ou 15 à 18" },
  { texte: "1Cor.10-16-22", raison: "référence mal écrite dans le PDF (10.16-22 ?)" },
];

const chiffres = (texte, i) => {
  const m = /^\d+/.exec(texte.slice(i, i + 4));
  return m ? m[0] : null;
};

// Une suite de versets d'un même chapitre, à partir de la position i : « 18 », « 16-17 »,
// « 7, 15-25 », « 20,23 », ou un passage à cheval sur deux chapitres, « 14-7.1 ».
function lireVersets(texte, i, chapitre, separateur) {
  const parties = [];
  let incomplet = false;
  let j = i;
  for (;;) {
    const v1 = chiffres(texte, j);
    if (!v1) return null;
    j += v1.length;
    let partie = { c1: chapitre, v1: Number(v1), c2: chapitre, v2: Number(v1) };
    if (texte[j] === "-") {
      const suite = /^-(\d+)(?:[.:](\d+))?/.exec(texte.slice(j, j + 9));
      if (!suite) return null;
      // « 6.14-7.1 » : la fin donne un chapitre et un verset.
      if (suite[2]) partie = { ...partie, c2: Number(suite[1]), v2: Number(suite[2]) };
      else partie.v2 = Number(suite[1]);
      j += suite[0].length;
    }
    // « 2.12b » : la seconde moitié du verset. La lettre fait partie de la référence ; le
    // passage affiché est le verset entier.
    if (/^[ab](?![\p{L}\d])/u.test(texte.slice(j, j + 2))) j += 1;
    parties.push(partie);
    // « 11ss » : et suivants. La fin du passage n'est pas donnée.
    if (/^ss(?![\p{L}\d])/u.test(texte.slice(j, j + 3))) {
      incomplet = true;
      j += 2;
      break;
    }
    if (partie.c2 !== chapitre) break;
    // D'autres versets du même chapitre ? Un nombre seul après une virgule en est un, à
    // condition de ne pas ouvrir une nouvelle référence (« , 24.35 ») ni un nom de livre
    // (« , 1Cor », « , 2 Timothée »).
    const autre = /^,\s?(\d+)(?:-(\d+))?/.exec(texte.slice(j, j + 12));
    if (!autre) break;
    const apres = texte.slice(j + autre[0].length, j + autre[0].length + 3);
    if (/^[.:\d-]/.test(apres) || /^\s?\p{L}/u.test(apres)) break;
    if (separateur === "virgule") break;
    j += autre[0].indexOf(autre[1]);
  }
  return { fin: j, parties, incomplet };
}

// Une référence dont le livre est connu, à partir de la position i (sur le premier nombre).
// « premiere » : elle suit directement le nom du livre.
function lireReference(texte, i, livre, premiere) {
  const n1 = chiffres(texte, i);
  if (!n1) return null;
  const j = i + n1.length;
  const suite = texte.slice(j, j + 8);
  if (livre.unChapitre) return lireVersets(texte, i, 1, "point");
  if (/^[.:]\d/.test(suite)) return lireVersets(texte, j + 1, Number(n1), "point");
  // Le règlement intérieur écrit « 1Tim.4/14 », et plusieurs références « Luc 1,34-35 ».
  if (premiere && /^\/\d/.test(suite)) return lireVersets(texte, j + 1, Number(n1), "barre");
  if (premiere && /^,\d/.test(suite) && !/^,\d+[.:]\d/.test(suite))
    return lireVersets(texte, j + 1, Number(n1), "virgule");
  if (!premiere) return null;
  return { fin: j, parties: [{ chapitre: Number(n1) }], incomplet: false };
}

// Le nom complet du passage, tel qu'il s'affiche en tête de la fenêtre de lecture, et qui
// sert de clé dans versets-documents.json.
export function cleDuPassage(livre, parties) {
  if (parties[0].chapitre) return `${livre.nom} ${parties[0].chapitre}`;
  const versets = parties.map((p) => (p.v1 === p.v2 ? `${p.v1}` : `${p.v1}-${p.v2}`));
  if (livre.unChapitre) return `${livre.nom} ${versets.join(", ")}`;
  const p = parties[0];
  if (p.c1 !== p.c2) return `${livre.nom} ${p.c1}.${p.v1}-${p.c2}.${p.v2}`;
  return `${livre.nom} ${p.c1}.${versets.join(", ")}`;
}

// Repère les références d'un texte.
// Renvoie { references: [{ debut, fin, source, cle, livre, parties }], ecartees: [{ source, raison }] }.
export function reperer(texte) {
  const references = [];
  const ecartees = [];
  const ajouter = (debut, fin, livre, lue) => {
    const source = texte.slice(debut, fin);
    if (lue.incomplet) ecartees.push({ source, raison: "« ss » (et suivants) : la fin du passage n’est pas donnée" });
    else references.push({ debut, fin, source, cle: cleDuPassage(livre, lue.parties), livre, parties: lue.parties });
  };

  // Les cas particuliers d'abord : leurs zones sont ensuite sautées par la règle générale.
  const zones = [];
  for (const cas of CAS_PARTICULIERS) {
    let depuis = 0;
    for (;;) {
      const debut = texte.indexOf(cas.texte, depuis);
      if (debut < 0) break;
      depuis = debut + cas.texte.length;
      zones.push([debut, depuis]);
      if (!cas.passages) {
        ecartees.push({ source: cas.texte, raison: cas.raison });
        continue;
      }
      let curseur = debut;
      for (const [morceau, nom, parties] of cas.passages) {
        const d = texte.indexOf(morceau, curseur);
        curseur = d + morceau.length;
        ajouter(d, curseur, parNom.get(nom), { parties, incomplet: false });
      }
    }
  }
  const zoneA = (i) => zones.find(([d, f]) => i >= d && i < f);

  const debutDeLivre = new RegExp(`(?<![\\p{L}\\d])(${motifLivres})(?:\\.\\s?|\\s)?(?=\\d)`, "gu");
  let m;
  while ((m = debutDeLivre.exec(texte))) {
    const zone = zoneA(m.index);
    if (zone) {
      debutDeLivre.lastIndex = zone[1];
      continue;
    }
    const livre = parAbreviation.get(m[1]);
    let lue = lireReference(texte, m.index + m[0].length, livre, true);
    if (!lue) continue;
    ajouter(m.index, lue.fin, livre, lue);
    let fin = lue.fin;

    // Les références suivantes du même livre : « , 24.35 », « ; 5.10-12 », « et 22 ».
    for (;;) {
      const reste = texte.slice(fin, fin + 12);
      const separateur = /^\s*[,;]\s*|^\s+et\s+/.exec(reste);
      if (!separateur) break;
      const debut = fin + separateur[0].length;
      if (zoneA(debut)) break;
      // Après un chapitre entier, « et 22 » désigne le chapitre suivant (« Ap.21 et 22 »).
      const autreChapitre =
        lue.parties[0].chapitre && /^\s+et\s+$/.test(separateur[0]) ? /^(\d+)(?![.:\d]|\s?\p{L})/u.exec(texte.slice(debut, debut + 8)) : null;
      if (autreChapitre) {
        lue = { fin: debut + autreChapitre[1].length, parties: [{ chapitre: Number(autreChapitre[1]) }], incomplet: false };
      } else {
        if (livre.unChapitre || !/^\d+[.:]\d/.test(texte.slice(debut, debut + 6))) break;
        lue = lireReference(texte, debut, livre, false);
        if (!lue) break;
      }
      ajouter(debut, lue.fin, livre, lue);
      fin = lue.fin;
    }
    debutDeLivre.lastIndex = fin;
  }

  references.sort((a, b) => a.debut - b.debut);

  // Ce qui ressemble à une référence et n'a pas été lu : « (6.23, 1Cor.2.14) », où le livre
  // manque. Signalé, pour ne rien laisser passer en silence.
  for (const reste of texte.matchAll(/(?<![\d.])\d{1,3}[.:]\d{1,3}(?:-\d+)?(?![\d.]*\d)/g)) {
    const i = reste.index;
    if (references.some((r) => i >= r.debut && i < r.fin) || zoneA(i)) continue;
    if (ecartees.some((e) => e.source.includes(reste[0]))) continue;
    ecartees.push({ source: reste[0], raison: "aucun livre devant cette référence" });
  }
  return { references, ecartees };
}

// Les textes d'un document, avec l'adresse de chacun : « section/bloc » ou « section/bloc/élément ».
export function textesDuDocument(document) {
  const textes = [];
  document.sections.forEach((section, s) =>
    section.blocs.forEach((bloc, b) => {
      if (bloc.type === "liste") bloc.elements.forEach((e, k) => textes.push([`${s}/${b}/${k}`, e]));
      else if (bloc.type === "paragraphe") textes.push([`${s}/${b}`, bloc.texte]);
    })
  );
  return textes;
}
