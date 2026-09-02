# Format d'une leçon (`app/contenu/lecons/NN-slug.json`)

Une leçon par fichier JSON, en français, clés en minuscules. Le texte reproduit le livret
sans reformulation ; seules la structure et les coupures de ligne changent.

```json
{
  "numero": 1,
  "slug": "plan-du-salut",
  "titre": "Le plan du salut",
  "pages": "3-6",
  "introduction": ["Paragraphe d'ouverture…", { "type": "verset", "texte": "…", "reference": "…" }],
  "sections": [
    {
      "titre": "Quatre grandes étapes",
      "blocs": [
        { "type": "sous-titre", "texte": "Création" },
        { "type": "paragraphe", "texte": "Texte du paragraphe…" },
        { "type": "citation", "texte": "Texte cité…", "auteur": "C.S. Lewis" },
        { "type": "verset", "texte": "Texte du verset…", "reference": "Jean 3.16" },
        { "type": "encadre", "titre": "Titre facultatif", "texte": "Texte de l'encadré…" },
        { "type": "liste", "elements": ["premier point", "second point"] },
        { "type": "note", "texte": "Note de bas de page…" },
        { "type": "figure", "fichier": "trinite.png", "texte": "Description de l'image", "legende": "Légende du livret" },
        {
          "type": "tableau",
          "titre": "Titre du tableau",
          "colonnes": ["En-tête de gauche", "En-tête de droite"],
          "lignes": [["cellule gauche", "cellule droite"]]
        }
      ]
    }
  ],
  "versets_a_apprendre": [
    { "reference": "Romains 6.23", "texte": "Car le salaire du péché…", "source": "livret" }
  ],
  "questions": [
    { "numero": 1, "texte": "Récitez les versets…", "recitation": true },
    { "numero": 2, "texte": "Question ordinaire…" }
  ]
}
```

## Règles

- `introduction` : ce qui précède le premier intertitre (tableau, éventuellement vide). Chaque
  élément est soit une chaîne (un paragraphe), soit un bloc de même forme que ceux des sections.
  Cela permet de garder à leur place les versets et encadrés que le livret imprime en marge de
  l'introduction, au lieu de les repousser dans la première section.
- `sections` : un intertitre principal du livret (petites capitales dans le PDF) devient une
  section. Sa première lettre est mise en majuscule (« quatre grandes étapes » →
  « Quatre grandes étapes »).
- `sous-titre` : les titres de rang inférieur (en gras/couleur dans le livret).
- `citation` : les citations en marge (auteur non biblique). `auteur` facultatif.
- `verset` : les versets en marge ou en exergue ; `reference` obligatoire.
- `encadre` : les compléments en marge qui ne sont ni citation ni verset (définitions,
  chronologies, « Pour aller plus loin »…). Titre facultatif. Les retours à la ligne internes
  s'écrivent `\n`.
- `figure` : les schémas, dessins et illustrations du livret qui portent du sens. Le fichier
  image est extrait du PDF et rangé dans `app/contenu/figures/`. `fichier` en donne le nom,
  sans chemin. `texte` décrit l'image pour qui ne la voit pas (lecture d'écran, image non
  chargée) : il est obligatoire. `legende` ne se met que si le livret imprime une légende.
  Les éléments purement décoratifs du livret (photos d'ambiance, motifs de points, filets,
  logo en tête de leçon) ne sont pas repris.
- `tableau` : les tableaux comparatifs du livret, dont le sens tient à la lecture ligne à ligne.
  `colonnes` donne les en-têtes, `lignes` les rangées, chacune ayant autant de cellules que de
  colonnes. Sur un écran étroit, chaque rangée s'affiche en deux blocs superposés, en gardant le
  vis-à-vis. `titre` est facultatif.
- Les blocs en marge sont placés juste après le paragraphe auquel ils se rattachent.
- **Références bibliques** : écrites normalement dans le texte (« (Genèse 1.27-28) »), elles
  deviennent automatiquement cliquables si leur texte figure dans `app/contenu/versets.json`.
  Rien de spécial à écrire. Après avoir ajouté ou modifié une référence dans une leçon,
  relancer la chaîne décrite dans le CLAUDE.md du projet, sinon la vérification échoue.
- **Adresses de sites** : écrites normalement (« www.exemple.org »), elles deviennent des liens.
- Mise en forme dans le texte : `*italique*` et `**gras**` uniquement. Les mots-clés
  en petites capitales qui ouvrent un paragraphe (« ENTIÈREMENT DIEU. ») sont mis en gras.
- Un paragraphe = un élément. Les listes à puces deviennent un bloc `liste`.
- Les en-têtes et pieds de page répétés du livret (« cours découvertes », « EGLISE BAPTISTE
  TOULOUSE MÉTROPOLE », numéros de page) ne sont pas repris.
- Les mots coupés en fin de ligne dans le PDF sont recollés ; attention aux vrais tirets
  (« peut-on », « vice-rois », « elles-mêmes ») que l'extraction automatique a supprimés.
- Les coquilles manifestes du livret sont corrigées et listées dans `docs/suivi.md`.
- `versets_a_apprendre` : `source` vaut `"livret"` si le texte du verset figure dans la leçon,
  sinon `"Segond 1910"` (texte pris dans la traduction Louis Segond 1910, libre de droits).
- `questions` : numérotées comme dans le livret ; `recitation: true` pour la question
  « Récitez les versets… ». Les blancs à compléter s'écrivent `____________`.
