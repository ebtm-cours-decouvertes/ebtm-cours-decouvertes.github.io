#!/usr/bin/env node
// Contrôle la qualité des textes bibliques embarqués : la source utilisée colle parfois un
// titre de section ou un renvoi d'appareil critique devant un verset, et certains appels
// renvoient plusieurs versets collés. Ce script signale ce qui a l'air anormal.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const table = JSON.parse(readFileSync(join(racine, "app", "contenu", "versets.json"), "utf8"));

const SUSPECTS = [
  [/\bcf\.|V\.\s*\d+-\d+\s*:|\(\s*(?:Ac|Mt|Mc|Lu|Jn|Ro|1 Co|2 Co|Ga|Ep|Ph|Col|Hé|Ja|1 Pi|2 Pi|Ap)\s+\d+:\d+/, "renvoi d’appareil critique"],
  [/[a-zéèêàùç][:;][A-ZÉÈÀ]/, "espace manquante après un deux-points ou un point-virgule"],
  [/^\s|\s$/, "espace en début ou fin"],
  [/'/, "apostrophe droite"],
  [/\s{2,}/, "espaces multiples"],
];

let alertes = 0;
const longueurs = [];
for (const [reference, passages] of Object.entries(table.versets)) {
  if (!Array.isArray(passages) || passages.length === 0) {
    console.error(`  ${reference} : aucun texte`);
    alertes++;
    continue;
  }
  const numeros = passages.map((p) => p.v);
  if (numeros.some((n, i) => i > 0 && n <= numeros[i - 1]))
    console.error(`  ${reference} : numéros de versets non croissants (${numeros.join(", ")})`), alertes++;
  for (const p of passages) {
    longueurs.push([p.t.length, `${reference} v.${p.v}`]);
    if (!p.t || typeof p.t !== "string") {
      console.error(`  ${reference} v.${p.v} : texte vide`);
      alertes++;
      continue;
    }
    for (const [motif, raison] of SUSPECTS)
      if (motif.test(p.t)) {
        console.error(`  ${reference} v.${p.v} : ${raison}\n      ${p.t.slice(0, 120)}`);
        alertes++;
      }
  }
}

// Un verset beaucoup plus long que les autres cache souvent plusieurs versets collés.
longueurs.sort((a, b) => b[0] - a[0]);
const median = longueurs.length ? longueurs[Math.floor(longueurs.length / 2)][0] : 0;
const tresLongs = longueurs.filter(([n]) => n > Math.max(420, median * 4));
if (tresLongs.length) {
  console.error(`\n  ${tresLongs.length} verset(s) anormalement longs (médiane ${median} caractères) :`);
  for (const [n, ou] of tresLongs.slice(0, 10)) console.error(`      ${ou} — ${n} caractères`);
  alertes += tresLongs.length;
}

const total = Object.values(table.versets).reduce((n, p) => n + p.length, 0);
if (alertes === 0) console.log(`OK — ${Object.keys(table.versets).length} référence(s), ${total} verset(s), rien de suspect.`);
else {
  console.error(`\n${alertes} point(s) à vérifier sur ${total} verset(s).`);
  process.exit(1);
}
