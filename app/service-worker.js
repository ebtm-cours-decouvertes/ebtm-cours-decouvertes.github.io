/*
 * Service worker : permet d'utiliser l'application sans connexion.
 *
 * À l'installation, tous les fichiers de l'application et des leçons sont mis en cache.
 * Ensuite, chaque demande est servie depuis le cache immédiatement, puis rafraîchie en
 * arrière-plan quand le réseau est disponible (« stale-while-revalidate »). Changer VERSION
 * ci-dessous force le renouvellement complet du cache à la prochaine visite.
 */

const VERSION = "2026-09-11-1";
const CACHE = `cours-decouvertes-${VERSION}`;

const FICHIERS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icones/logo-ebtm.png",
  "./icones/logo-ebtm-mot.png",
  "./icones/icone.svg",
  "./icones/icone-192.png",
  "./icones/icone-512.png",
  "./icones/icone-maskable-512.png",
  "./icones/icone-180.png",
  "./qr-cours-decouvertes.png",
  "./contenu/index.json",
  "./contenu/a-propos.json",
  "./contenu/versets.json",
];

self.addEventListener("install", (evenement) => {
  evenement.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(FICHIERS);
      // Les leçons listées dans l'index sont ajoutées à leur tour.
      try {
        const reponse = await cache.match("./contenu/index.json");
        const index = await reponse.json();
        // Un par un : un fichier manquant ne doit pas empêcher les autres d'être mis en cache.
        await Promise.allSettled([
          ...index.lecons.map((l) => cache.add(`./contenu/lecons/${l.fichier}`)),
          ...(index.figures || []).map((f) => cache.add(`./contenu/figures/${f}`)),
        ]);
      } catch (erreur) {
        console.warn("Leçons non mises en cache à l'installation :", erreur);
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (evenement) => {
  evenement.waitUntil(
    (async () => {
      const noms = await caches.keys();
      await Promise.all(noms.filter((nom) => nom !== CACHE).map((nom) => caches.delete(nom)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (evenement) => {
  const requete = evenement.request;
  if (requete.method !== "GET" || new URL(requete.url).origin !== self.location.origin) return;

  evenement.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const enCache = await cache.match(requete, { ignoreSearch: true });
      const depuisReseau = fetch(requete)
        .then((reponse) => {
          if (reponse && reponse.ok) cache.put(requete, reponse.clone());
          return reponse;
        })
        .catch(() => null);

      if (enCache) {
        evenement.waitUntil(depuisReseau);
        return enCache;
      }
      const reponse = await depuisReseau;
      if (reponse) return reponse;
      // Hors connexion et jamais visité : on renvoie la page d'accueil pour une navigation.
      if (requete.mode === "navigate") return cache.match("./index.html");
      return new Response("Hors connexion", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    })()
  );
});
