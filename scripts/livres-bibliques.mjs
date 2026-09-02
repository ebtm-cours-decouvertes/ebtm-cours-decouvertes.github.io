// Correspondance entre les noms français des livres bibliques, tels qu'ils apparaissent dans
// le livret, et les noms anglais attendus par la source des textes (Louis Segond 1910).
export const LIVRES = new Map(Object.entries({
  "Genèse": "Genesis", "Exode": "Exodus", "Lévitique": "Leviticus", "Nombres": "Numbers",
  "Deutéronome": "Deuteronomy", "Josué": "Joshua", "Juges": "Judges", "Ruth": "Ruth",
  "1 Samuel": "1 Samuel", "2 Samuel": "2 Samuel", "1 Rois": "1 Kings", "2 Rois": "2 Kings",
  "1 Chroniques": "1 Chronicles", "2 Chroniques": "2 Chronicles", "Esdras": "Ezra",
  "Néhémie": "Nehemiah", "Esther": "Esther", "Job": "Job", "Psaume": "Psalms",
  "Psaumes": "Psalms", "Proverbes": "Proverbs", "Ecclésiaste": "Ecclesiastes",
  "Cantique des cantiques": "Song of Solomon", "Ésaïe": "Isaiah", "Esaïe": "Isaiah",
  "Jérémie": "Jeremiah", "Lamentations": "Lamentations", "Ézéchiel": "Ezekiel",
  "Ezéchiel": "Ezekiel", "Daniel": "Daniel", "Osée": "Hosea", "Joël": "Joel", "Amos": "Amos",
  "Abdias": "Obadiah", "Jonas": "Jonah", "Michée": "Micah", "Nahum": "Nahum",
  "Habacuc": "Habakkuk", "Sophonie": "Zephaniah", "Aggée": "Haggai", "Zacharie": "Zechariah",
  "Malachie": "Malachi", "Matthieu": "Matthew", "Marc": "Mark", "Luc": "Luke", "Jean": "John",
  "Actes": "Acts", "Romains": "Romans", "1 Corinthiens": "1 Corinthians",
  "2 Corinthiens": "2 Corinthians", "Galates": "Galatians", "Éphésiens": "Ephesians",
  "Ephésiens": "Ephesians", "Philippiens": "Philippians", "Colossiens": "Colossians",
  "1 Thessaloniciens": "1 Thessalonians", "2 Thessaloniciens": "2 Thessalonians",
  "1 Timothée": "1 Timothy", "2 Timothée": "2 Timothy", "Tite": "Titus", "Philémon": "Philemon",
  "Hébreux": "Hebrews", "Jacques": "James", "1 Pierre": "1 Peter", "2 Pierre": "2 Peter",
  "1 Jean": "1 John", "2 Jean": "2 John", "3 Jean": "3 John", "Jude": "Jude",
  "Apocalypse": "Revelation",
}));

// Les noms les plus longs d'abord, pour que « 1 Corinthiens » l'emporte sur « Corinthiens ».
const noms = [...LIVRES.keys()].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

// Une référence : un livre, un chapitre, puis éventuellement des versets séparés par . ou :
// avec des suites (« 1.1, 27 »), des intervalles (« 2.1-4 ») et des « & » (« 6.6 & 11 »).
// Le « (?!\\s+livre) » évite d'avaler le numéro d'un livre suivant, comme dans
// « 1 Pierre 2.2 & 2 Timothée 3.16 », où « & 2 » ouvre en fait la référence suivante.
export function expressionReference() {
  const livres = noms.join("|");
  // « 1 Pierre 2.2 & 2 Timothée » : le « 2 » avalé est en fait le numéro du livre suivant.
  // On le repère en regardant si un nom de livre le suit, numéro d'ordre retiré.
  const sansNumero = [...new Set(noms.map((n) => n.replace(/^\d\s+/, "")))]
    .sort((a, b) => b.length - a.length)
    .join("|");
  const suite = `\\s*(?:,|&|et)\\s*\\d+(?!\\s+(?:${livres}|${sansNumero}))(?:\\s*-\\s*\\d+)?`;
  return new RegExp(`\\b(?:${livres})\\s+\\d+(?:\\s*[.:]\\s*\\d+(?:\\s*-\\s*\\d+)?(?:${suite})*)?`, "g");
}

// Découpe une référence en livre anglais, chapitre et intervalles de versets.
// « Genèse 1.1, 27 » → { livre: "Genesis", chapitre: 1, intervalles: [[1,1],[27,27]] }
// « Tite 1 » → chapitre entier, intervalles vide.
export function analyser(reference) {
  const m = reference.match(new RegExp(`^(${noms.join("|")})\\s+(\\d+)(?:\\s*[.:]\\s*(.+))?$`));
  if (!m) return null;
  const [, nomFr, chapitre, reste] = m;
  const intervalles = [];
  if (reste)
    for (const part of reste.split(/\s*(?:,|&|et)\s*/)) {
      const bornes = part.split(/\s*-\s*/).map(Number);
      if (bornes.some(Number.isNaN)) continue;
      intervalles.push([bornes[0], bornes.length > 1 ? bornes[1] : bornes[0]]);
    }
  return { reference, livre: LIVRES.get(nomFr), chapitre: Number(chapitre), intervalles };
}
