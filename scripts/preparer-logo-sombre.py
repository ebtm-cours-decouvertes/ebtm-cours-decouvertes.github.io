#!/usr/bin/env python3
"""Prépare le logo « ebtm » de l'en-tête pour l'apparence sombre.

Le logo de l'en-tête est imprimé sur blanc. En apparence sombre, il était posé sur un rectangle
blanc, comme un autocollant. Cette version le détoure, le blanc devenant transparent, et
éclaircit ce qui ne se verrait plus sur un fond sombre :

- les lettres passent au violet clair des titres de l'apparence sombre ;
- le trait sous le mot passe au gris clair du texte adouci ;
- la croix garde ses couleurs, déjà vives.

Version choisie le 16 novembre 2026, sur trois montrées en image. C'est le logo de
l'église : seule la couleur des lettres et du trait change, pas le dessin.

À relancer si le logo de l'en-tête change, ou si ces deux couleurs changent dans style.css :

    python3 scripts/preparer-logo-sombre.py app/icones/logo-ebtm-mot.png app/icones/logo-ebtm-mot-sombre.png
"""
import struct
import sys
import zlib

# Reprises du bloc « sombre » de app/style.css : --violet et --texte-doux.
VIOLET_CLAIR = (0xC5, 0x6C, 0xC5)
GRIS_CLAIR = (0xB9, 0xAD, 0xBC)

# En dessous de cet écart avec le blanc, un point est tenu pour plein. Le trait gris, le plus
# clair des trois éléments, est à environ 145 du blanc : c'est lui qui fixe le seuil.
PLEIN = 145


def lire_png(chemin):
    """Même lecture que preparer-logo-mot.py : PNG 8 bits, sans entrelacement."""
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


def ecrire_png_transparent(chemin, largeur, hauteur, lignes):
    """Écrit des lignes rouge, vert, bleu, opacité (PNG de type 6)."""
    brut = b"".join(b"\x00" + bytes(ligne) for ligne in lignes)

    def morceau(nom, contenu):
        return struct.pack(">I", len(contenu)) + nom + contenu + struct.pack(
            ">I", zlib.crc32(nom + contenu) & 0xFFFFFFFF
        )

    entete = struct.pack(">IIBBBBB", largeur, hauteur, 8, 6, 0, 0, 0)
    open(chemin, "wb").write(
        b"\x89PNG\r\n\x1a\n"
        + morceau(b"IHDR", entete)
        + morceau(b"IDAT", zlib.compress(brut, 9))
        + morceau(b"IEND", b"")
    )


source, destination = sys.argv[1], sys.argv[2]
largeur, hauteur, canaux, lignes = lire_png(source)
if canaux < 3:
    sys.exit("Le logo source doit être en couleurs.")

compte = {"lettres": 0, "croix": 0, "trait": 0, "vide": 0}
sortie = []
for ligne in lignes:
    nouvelle = bytearray(largeur * 4)
    for x in range(largeur):
        i = x * canaux
        r, v, b = ligne[i], ligne[i + 1], ligne[i + 2]
        # Un logo source déjà transparent est d'abord reposé sur blanc.
        if canaux == 4:
            a0 = ligne[i + 3] / 255
            r, v, b = (c * a0 + 255 * (1 - a0) for c in (r, v, b))
        # L'opacité vient de l'écart avec le blanc : pleine dans l'encre, dégradée sur les bords.
        opacite = min(1.0, (255 - min(r, v, b)) / PLEIN)
        if opacite <= 0.03:
            compte["vide"] += 1
            continue  # reste transparent
        # La couleur d'origine du point, une fois retiré le blanc qui s'y mêlait sur les bords.
        r, v, b = (max(0.0, min(255.0, (c - 255 * (1 - opacite)) / opacite)) for c in (r, v, b))
        if max(r, v, b) - min(r, v, b) < 70:
            nature = "trait"  # presque gris
        elif r - b > 60:
            nature = "croix"  # du rouge au magenta : nettement plus rouge que bleue
        else:
            nature = "lettres"  # violet : autant de rouge que de bleu
        compte[nature] += 1
        if nature == "lettres":
            r, v, b = VIOLET_CLAIR
        elif nature == "trait":
            r, v, b = GRIS_CLAIR
        o = x * 4
        nouvelle[o], nouvelle[o + 1], nouvelle[o + 2], nouvelle[o + 3] = round(r), round(v), round(b), round(opacite * 255)
    sortie.append(nouvelle)

ecrire_png_transparent(destination, largeur, hauteur, sortie)
print(
    f"Logo sombre écrit : {largeur} x {hauteur} ; "
    f"{compte['lettres']} points de lettres éclaircis, {compte['trait']} points de trait, "
    f"{compte['croix']} points de croix gardés, {compte['vide']} points rendus transparents."
)
