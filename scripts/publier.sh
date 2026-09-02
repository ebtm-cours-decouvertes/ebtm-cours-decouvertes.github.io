#!/bin/sh
# Met en ligne l'application, sans jamais publier ce qui doit rester privé.
#
# Le dépôt de travail contient le PDF du livret et le journal de projet ; le dépôt public,
# lui, ne reçoit que l'application, ses contrôles et le fichier de mise en ligne. Passer par
# ce script plutôt que par un « git push » direct est ce qui garantit cette séparation.
set -e

depot="https://github.com/ebtm-cours-decouvertes/ebtm-cours-decouvertes.github.io.git"
racine=$(cd "$(dirname "$0")/.." && pwd)
travail="$racine/.publication"

message="${1:-Mise à jour de l’application}"

# Les contrôles d'abord : rien ne part en ligne sur un contenu qui ne passe pas.
node "$racine/scripts/verifier-contenu.mjs"
node "$racine/scripts/verifier-versets.mjs"
node "$racine/scripts/verifier-contrastes.mjs" > /dev/null

if [ ! -d "$travail/.git" ]; then
  git clone "$depot" "$travail"
fi
git -C "$travail" fetch --quiet origin
git -C "$travail" checkout --quiet -B main origin/main 2>/dev/null || git -C "$travail" checkout --quiet -B main

# --delete retire du dépôt public ce qui a été supprimé ici ; les fichiers non listés
# n'y arrivent jamais.
rsync -a --delete "$racine/app/" "$travail/app/"
rsync -a --delete "$racine/scripts/" "$travail/scripts/"
mkdir -p "$travail/.github/workflows"
rsync -a --delete "$racine/.github/workflows/" "$travail/.github/workflows/"
cp "$racine/README.md" "$travail/README.md"

# Ceintures et bretelles : on refuse de publier si l'un de ces chemins s'est glissé là.
for interdit in source docs CLAUDE.md .publication; do
  if [ -e "$travail/$interdit" ]; then
    echo "ARRÊT : « $interdit » ne doit jamais être publié." >&2
    exit 1
  fi
done

cd "$travail"
if git diff --quiet && git diff --cached --quiet && [ -z "$(git status --porcelain)" ]; then
  echo "Rien de nouveau à mettre en ligne."
  exit 0
fi
git add -A
git commit -q -m "$message"
git push --quiet origin main
echo "Mis en ligne : https://ebtm-cours-decouvertes.github.io/"
