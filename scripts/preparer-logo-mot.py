#!/usr/bin/env python3
"""Prépare le logo « ebtm » pour l'en-tête de l'application.

Le logo officiel porte sous le mot la ligne « EGLISE BAPTISTE TOULOUSE MÉTROPOLE ». Dans une
barre de trente-quatre pixels, cette ligne ne fait plus qu'un pixel et demi de haut : elle
devient une tache grise. On l'efface donc, en gardant la croix, dont la hampe descend au
travers. On ne peut pas simplement rogner le bas de l'image : cela couperait la croix.

Usage : python3 scripts/preparer-logo-mot.py source.png destination.png
"""
import struct
import sys
import zlib

# Bande occupée par la ligne de texte, mesurée sur le fichier d'origine (500 x 316).
BANDE_TEXTE = (232, 253)


def lire_png(chemin):
    donnees = open(chemin, "rb").read()
    i, idat, largeur, hauteur, type_couleur = 8, b"", 0, 0, 0
    while i < len(donnees):
        (taille,) = struct.unpack(">I", donnees[i : i + 4])
        nom = donnees[i + 4 : i + 8]
        contenu = donnees[i + 8 : i + 8 + taille]
        if nom == b"IHDR":
            largeur, hauteur, _, type_couleur = struct.unpack(">IIBB", contenu[:10])
        if nom == b"IDAT":
            idat += contenu
        i += 12 + taille
    canaux = {0: 1, 2: 3, 4: 2, 6: 4}[type_couleur]
    brut = zlib.decompress(idat)
    pas = largeur * canaux
    precedente = bytearray(pas)
    lignes = []
    o = 0
    for _ in range(hauteur):
        filtre = brut[o]
        o += 1
        ligne = bytearray(brut[o : o + pas])
        o += pas
        for x in range(pas):
            a = ligne[x - canaux] if x >= canaux else 0
            b = precedente[x]
            c = precedente[x - canaux] if x >= canaux else 0
            if filtre == 1:
                ligne[x] = (ligne[x] + a) & 255
            elif filtre == 2:
                ligne[x] = (ligne[x] + b) & 255
            elif filtre == 3:
                ligne[x] = (ligne[x] + (a + b) // 2) & 255
            elif filtre == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                prediction = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                ligne[x] = (ligne[x] + prediction) & 255
        precedente = ligne
        lignes.append(ligne)
    return largeur, hauteur, canaux, lignes


def ecrire_png(chemin, largeur, hauteur, lignes):
    brut = b"".join(b"\x00" + bytes(ligne) for ligne in lignes)
    def morceau(nom, contenu):
        return struct.pack(">I", len(contenu)) + nom + contenu + struct.pack(
            ">I", zlib.crc32(nom + contenu) & 0xFFFFFFFF
        )
    entete = struct.pack(">IIBBBBB", largeur, hauteur, 8, 2, 0, 0, 0)
    open(chemin, "wb").write(
        b"\x89PNG\r\n\x1a\n"
        + morceau(b"IHDR", entete)
        + morceau(b"IDAT", zlib.compress(brut, 9))
        + morceau(b"IEND", b"")
    )


def est_croix(r, v, b):
    """La croix va du rouge au magenta : elle est nettement plus rouge que verte."""
    return r > v + 40 and r > 90


source, destination = sys.argv[1], sys.argv[2]
largeur, hauteur, canaux, lignes = lire_png(source)

# Le texte est imprimé par-dessus la croix : l'effacer y creuserait des lettres blanches, et
# les bords adoucis des lettres y laisseraient un fantôme. On reconstruit donc ce morceau de
# croix en interpolant, colonne par colonne, entre la ligne propre juste au-dessus de la bande
# et celle juste en dessous. La hampe y est quasi verticale : la reconstruction est fidèle.
HAUT, BAS = BANDE_TEXTE[0] - 1, BANDE_TEXTE[1] + 1

def couleur(y, x):
    i = x * canaux
    return lignes[y][i], lignes[y][i + 1], lignes[y][i + 2]

efface = reconstruit = 0
for x in range(largeur):
    haut, bas = couleur(HAUT, x), couleur(BAS, x)
    croix_haut, croix_bas = est_croix(*haut), est_croix(*bas)
    for y in range(BANDE_TEXTE[0], BANDE_TEXTE[1] + 1):
        i = x * canaux
        if croix_haut or croix_bas:
            depart = haut if croix_haut else bas
            arrivee = bas if croix_bas else haut
            t = (y - HAUT) / (BAS - HAUT)
            for c in range(3):
                lignes[y][i + c] = round(depart[c] + (arrivee[c] - depart[c]) * t)
            reconstruit += 1
        else:
            lignes[y][i] = lignes[y][i + 1] = lignes[y][i + 2] = 255
            efface += 1

# Recadrage sur l'encre restante, avec une petite marge.
def a_de_l_encre(ligne, x):
    i = x * canaux
    return not (ligne[i] > 240 and ligne[i + 1] > 240 and ligne[i + 2] > 240)

hauts = [y for y in range(hauteur) if any(a_de_l_encre(lignes[y], x) for x in range(largeur))]
colonnes = [x for x in range(largeur) if any(a_de_l_encre(lignes[y], x) for y in hauts)]
marge = 6
y0, y1 = max(0, hauts[0] - marge), min(hauteur - 1, hauts[-1] + marge)
x0, x1 = max(0, colonnes[0] - marge), min(largeur - 1, colonnes[-1] + marge)

recadrees = [ligne[x0 * canaux : (x1 + 1) * canaux] for ligne in lignes[y0 : y1 + 1]]
ecrire_png(destination, x1 - x0 + 1, y1 - y0 + 1, recadrees)
print(f"{efface} pixels effacés, {reconstruit} pixels de croix reconstruits ; logo recadré à {x1 - x0 + 1} x {y1 - y0 + 1}")
