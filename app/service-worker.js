const VERSION = "2026-11-27-1";
const CACHE = `cours-decouvertes-${VERSION}`;

const FICHIERS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./polices/inter-tight.woff2",
  "./polices/bricolage-grotesque.woff2",
  "./manifest.webmanifest",
  "./icones/icone.svg",
  "./icones/icone-192.png",
  "./icones/icone-512.png",
  "./icones/icone-maskable-512.png",
  "./icones/icone-180.png",
  "./icones/logo-ebtm-silhouette.png",
  "./qr-cours-decouvertes.png",
  "./contenu/index.json",
  "./contenu/a-propos.json",
  "./contenu/eglise.json",
  "./contenu/versets.json",
  "./contenu/versets-documents.json",
];

const depuisServeur = (adresse) => new Request(adresse, { cache: "reload" });

self.addEventListener("install", (evenement) => {
  evenement.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(FICHIERS.map(depuisServeur));

      try {
        const reponse = await cache.match("./contenu/index.json");
        const index = await reponse.json();

        const ajouter = (adresse) => cache.add(depuisServeur(adresse));
        await Promise.allSettled([
          ...index.lecons.map((l) => ajouter(`./contenu/lecons/${l.fichier}`)),
          ...(index.figures || []).map((f) => ajouter(`./contenu/figures/${f}`)),
          ...(index.documents || []).map((d) => ajouter(`./contenu/documents/${d.fichier}`)),
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

      const depuisReseau = fetch(requete.url, { cache: "no-cache" })
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

      if (requete.mode === "navigate") return cache.match("./index.html");
      return new Response("Hors connexion", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    })()
  );
});
