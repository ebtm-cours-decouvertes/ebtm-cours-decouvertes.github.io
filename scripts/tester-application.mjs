#!/usr/bin/env node
// Teste l'application de A à Z dans un vrai navigateur, comme le ferait un participant, et
// écrit un rapport dans docs/tests/rapport.md (captures des défauts dans docs/tests/captures/).
//
//   node scripts/tester-application.mjs                    tout
//   node scripts/tester-application.mjs --seulement=notes  les tests dont la famille ou le nom
//                                                          contient ce mot
//   node scripts/tester-application.mjs --fenetre          navigateur visible (pour regarder)
//
// Rien n'est ajouté à l'application : l'outil pilote le Google Chrome du Mac avec Playwright,
// déjà installé avec la compétence « verifier-animations » (ou désigné par PLAYWRIGHT_CORE).
// Il sert lui-même le dossier app/ sur un port libre, dans un navigateur vierge : ni le serveur
// de travail (8080), ni le simulateur, ni les réponses de quiconque ne sont touchés. Il arrête
// tout ce qu'il a démarré, même en cas d'erreur.
//
// Ce qu'il ne voit pas : le vrai Safari d'iPhone (gestes de retour, zone de l'heure, application
// installée). Ces points restent à contrôler sur iPhone virtuel et sur l'appareil.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARGUMENTS = process.argv.slice(2);
// « --dossier=<chemin> » : tester une autre copie de l'application, par exemple la copie publiée
// sans commentaires (publier.sh). Par défaut, le dossier de travail app/.
const DOSSIER = (ARGUMENTS.find((a) => a.startsWith("--dossier=")) || "").slice("--dossier=".length);
const APP = DOSSIER ? path.resolve(DOSSIER) : path.join(RACINE, "app");
const SORTIE = path.join(RACINE, "docs", "tests");
const CAPTURES = path.join(SORTIE, "captures");
const SEULEMENT = ((ARGUMENTS.find((a) => a.startsWith("--seulement=")) || "").split("=")[1] || "").toLowerCase();
const FENETRE = ARGUMENTS.includes("--fenetre");

const CLE = "cours-decouvertes";
const UA_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const VIOLET = "rgb(110, 26, 110)";
const ROSE = "rgb(246, 237, 245)";

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Playwright et serveur
// ---------------------------------------------------------------------------

async function chargerPlaywright() {
  const candidats = [
    process.env.PLAYWRIGHT_CORE,
    path.join(os.homedir(), ".claude/skills/verifier-animations/node_modules/playwright-core/index.mjs"),
  ].filter(Boolean);
  for (const candidat of candidats) if (fs.existsSync(candidat)) return import(pathToFileURL(candidat).href);
  console.error(
    "Playwright introuvable. Il est fourni par la compétence « verifier-animations »\n" +
      "(~/.claude/skills/verifier-animations, « npm install » dans ce dossier), ou désigné par\n" +
      "la variable PLAYWRIGHT_CORE (chemin de playwright-core/index.mjs)."
  );
  process.exit(2);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function demarrerServeur() {
  return new Promise((resoudre) => {
    const serveur = http.createServer((requete, reponse) => {
      let chemin = decodeURIComponent(new URL(requete.url, "http://x").pathname);
      if (chemin.endsWith("/")) chemin += "index.html";
      const fichier = path.join(APP, chemin);
      if (!fichier.startsWith(APP + path.sep) || !fs.existsSync(fichier) || fs.statSync(fichier).isDirectory()) {
        reponse.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        reponse.end("introuvable");
        return;
      }
      reponse.writeHead(200, {
        "content-type": TYPES[path.extname(fichier)] || "application/octet-stream",
        "last-modified": fs.statSync(fichier).mtime.toUTCString(),
        "cache-control": "no-cache",
      });
      if (requete.method === "HEAD") reponse.end();
      else fs.createReadStream(fichier).pipe(reponse);
    });
    serveur.listen(0, "127.0.0.1", () => resoudre(serveur));
  });
}

// ---------------------------------------------------------------------------
// Petit cadre de test
// ---------------------------------------------------------------------------

const tests = [];
const requetes = []; // toutes les requêtes de tous les tests (famille Sécurité)
const selecteursTous = new Set(); // tous les sélecteurs de la feuille de style
const selecteursVus = new Set(); // ceux qui ont désigné au moins un élément pendant les tests
const fonctionsVues = new Map(); // « nom@place » → nombre d'exécutions, pour app.js
let navigateur = null;
let BASE = ""; // http://127.0.0.1:port/ — l'application s'y comporte comme sur le Mac (pas de copie hors connexion)
let BASE_HORS_LIGNE = ""; // http://essai.localhost:port/ — comme en ligne, avec la copie hors connexion

function test(famille, nom, fonction) {
  tests.push({ famille, nom, fonction });
}

class Essai {
  constructor(famille, nom) {
    this.famille = famille;
    this.nom = nom;
    this.defauts = [];
    this.notes = []; // remarques qui ne sont pas des défauts
    this.journal = [];
    this.contextes = [];
    this.pages = [];
    this.erreursAttendues = null; // RegExp : erreurs de console que ce test provoque exprès
    this.nonTeste = null;
  }
  defaut(message) {
    if (!this.defauts.includes(message)) this.defauts.push(message);
  }
  verifier(condition, message) {
    if (!condition) this.defaut(message);
    return Boolean(condition);
  }
  note(message) {
    this.notes.push(message);
  }

  // Un navigateur vierge, réglé comme un iPhone avec l'application installée (le cas courant).
  async page({
    largeur = 390,
    hauteur = 844,
    sombre = false,
    mouvement = true,
    installee = true,
    tactile = true,
    etat = null,
    base = BASE,
  } = {}) {
    const contexte = await navigateur.newContext({
      viewport: { width: largeur, height: hauteur },
      deviceScaleFactor: 2,
      hasTouch: tactile,
      isMobile: tactile,
      userAgent: tactile ? UA_IPHONE : undefined,
      locale: "fr-FR",
      colorScheme: sombre ? "dark" : "light",
      reducedMotion: mouvement ? "no-preference" : "reduce",
    });
    this.contextes.push(contexte);
    if (installee)
      await contexte.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, "standalone", { get: () => true, configurable: true });
      });
    if (etat !== null)
      await contexte.addInitScript(
        ([cle, brut]) => {
          try {
            if (!sessionStorage.getItem("__essai")) {
              localStorage.setItem(cle, brut);
              sessionStorage.setItem("__essai", "1");
            }
          } catch {}
        },
        [CLE, typeof etat === "string" ? etat : JSON.stringify(etat)]
      );
    const page = await contexte.newPage();
    page.__base = base;
    this.suivre(page);
    this.pages.push(page);
    await page.coverage.startJSCoverage({ resetOnNavigation: false }).catch(() => {});
    return page;
  }

  suivre(page) {
    page.on("pageerror", (e) => this.journal.push(`erreur JavaScript : ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") this.journal.push(`erreur en console : ${m.text()}`);
    });
    page.on("requestfailed", (r) => {
      const cause = (r.failure() && r.failure().errorText) || "";
      if (!cause.includes("ERR_ABORTED")) this.journal.push(`requête échouée : ${r.url()} (${cause})`);
    });
    page.on("response", (r) => {
      if (r.status() >= 400) this.journal.push(`réponse ${r.status()} : ${r.url()}`);
    });
    page.on("request", (r) => {
      const corps = r.postData();
      requetes.push({ url: r.url(), methode: r.method(), corps: corps ? corps.length : 0, test: this.nom });
    });
    page.on("websocket", (w) => requetes.push({ url: w.url(), methode: "WEBSOCKET", corps: 0, test: this.nom }));
  }

  async fermer() {
    for (const page of this.pages) {
      await releverSelecteurs(page);
      await recolterFonctions(page);
    }
    for (const contexte of this.contextes) await contexte.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Gestes et attentes
// ---------------------------------------------------------------------------

// Attend que l'écran soit rendu et que plus rien ne bouge (transitions et animations finies).
// Renvoie false si quelque chose bouge encore après « max » millisecondes.
async function repos(page, max = 4000) {
  const debut = Date.now();
  let calme = 0;
  let avant = null;
  while (Date.now() - debut < max) {
    const etat = await page.evaluate(() => {
      const principal = document.getElementById("principal");
      const animations = document.getAnimations().filter((a) => {
        if (a.playState !== "running") return false;
        const fin = a.effect && a.effect.getComputedTiming().endTime;
        return Number.isFinite(Number(fin));
      }).length;
      // Une fenêtre fermée n'est retirée de l'écran qu'à la fin de sa descente (minuterie).
      const transitoire = document.querySelector("#principal.ecran--attente, #principal.ecran--entre, .calque-quitte, .feuille:not([hidden]):not(.feuille--ouverte)") ? 1 : 0;
      return { bouge: animations + transitoire, taille: principal ? principal.innerHTML.length : 0, adresse: location.hash };
    });
    const pareil = avant && avant.taille === etat.taille && avant.adresse === etat.adresse;
    if (etat.bouge === 0 && etat.taille > 0 && pareil) {
      if (++calme >= 2) return true;
    } else calme = 0;
    avant = etat;
    await pause(70);
  }
  return false;
}

async function aller(page, chemin) {
  if (page.url() === "about:blank") await page.goto(`${page.__base}#${chemin}`, { waitUntil: "load" });
  else await page.evaluate((c) => (location.hash = c), chemin);
  await page.waitForFunction(() => document.getElementById("principal") && document.getElementById("principal").children.length > 0, null, {
    timeout: 8000,
  });
  const calme = await repos(page);
  await releverSelecteurs(page);
  return calme;
}

async function toucher(page, selecteur, { index = 0 } = {}) {
  const cible = typeof selecteur === "string" ? page.locator(selecteur).nth(index) : selecteur;
  await cible.scrollIntoViewIfNeeded({ timeout: 4000 });
  const tactile = await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
  if (tactile) await cible.tap({ timeout: 4000 });
  else await cible.click({ timeout: 4000 });
}

const retour = (page) => page.evaluate(() => history.back());
const etatEnregistre = (page) =>
  page.evaluate((cle) => {
    try {
      return JSON.parse(localStorage.getItem(cle) || "null");
    } catch {
      return "illisible";
    }
  }, CLE);

// Note quelles fonctions d'app.js ont été exécutées dans cette page depuis son chargement.
async function recolterFonctions(page) {
  const couverture = await page.coverage.stopJSCoverage().catch(() => []);
  for (const fichier of couverture) {
    if (!/\/app\.js$/.test(new URL(fichier.url).pathname)) continue;
    for (const f of fichier.functions || []) {
      const cle = `${f.functionName}@${f.ranges[0].startOffset}`;
      fonctionsVues.set(cle, (fonctionsVues.get(cle) || 0) + (f.ranges[0].count > 0 ? 1 : 0));
    }
  }
}

// Recharge la page. Le navigateur oublie ce qu'un script a exécuté dès que sa page est
// remplacée : le relevé des fonctions est donc récolté juste avant, puis relancé.
async function recharger(page) {
  await releverSelecteurs(page);
  await recolterFonctions(page);
  await page.coverage.startJSCoverage({ resetOnNavigation: false }).catch(() => {});
  return page.reload();
}

// Note quels sélecteurs de la feuille de style désignent quelque chose dans l'état présent de la
// page (les états passagers — survol, focus, coché — sont ignorés : on cherche l'élément visé).
async function releverSelecteurs(page) {
  const r = await page
    .evaluate(() => {
      const tous = [];
      const vus = [];
      const visiter = (regles) => {
        for (const regle of regles) {
          if (regle.selectorText) {
            for (const brut of regle.selectorText.split(/,(?![^(]*\))/)) {
              const selecteur = brut.trim();
              const nu =
                selecteur
                  .replace(/::[\w-]+(\([^)]*\))?/g, "")
                  .replace(/:(hover|active|focus-visible|focus-within|focus|disabled|checked|empty|placeholder-shown)\b/g, "")
                  .replace(/:not\(\s*\)/g, "")
                  .trim() || "*";
              tous.push(selecteur);
              try {
                if (document.querySelector(nu)) vus.push(selecteur);
              } catch {}
            }
          }
          if (regle.cssRules) visiter(regle.cssRules);
        }
      };
      for (const feuille of document.styleSheets) {
        try {
          visiter(feuille.cssRules);
        } catch {}
      }
      return { tous, vus };
    })
    .catch(() => ({ tous: [], vus: [] }));
  for (const s of r.tous) selecteursTous.add(s);
  for (const s of r.vus) selecteursVus.add(s);
}

// Ce qui ne doit jamais rester de travers une fois l'écran au repos.
function etatSain(page) {
  return page.evaluate(() => {
    const p = [];
    const ouvertes = [...document.querySelectorAll(".feuille.feuille--ouverte, .loupe:not([hidden])")];
    const affichees = [...document.querySelectorAll(".feuille:not([hidden])")];
    const principal = document.getElementById("principal");
    if (!ouvertes.length) {
      if (document.body.style.overflow === "hidden") p.push("la page reste figée (défilement bloqué) alors qu'aucune fenêtre n'est ouverte");
      for (const id of ["principal", "barre"])
        if (document.getElementById(id) && document.getElementById(id).inert) p.push(`« ${id} » reste neutralisé alors qu'aucune fenêtre n'est ouverte`);
      if (affichees.length) p.push(`${affichees.length} fenêtre(s) fermée(s) encore à l'écran`);
    }
    if (ouvertes.length > 1) p.push(`${ouvertes.length} fenêtres ouvertes en même temps`);
    if (!principal || !principal.children.length) p.push("écran vide");
    // La barre du haut est posée par-dessus la page : le haut de l'écran doit commencer sous
    // elle, sinon son titre y est caché (dossier de notes, 27 novembre 2026).
    const barre = document.getElementById("barre");
    if (principal && barre) {
      const hautPage = principal.getBoundingClientRect().top + window.scrollY;
      const hautBarre = barre.getBoundingClientRect().height;
      if (hautPage < hautBarre - 1) p.push(`le haut de la page est caché sous la barre du haut (${Math.round(hautBarre - hautPage)} px)`);
    }
    if (document.querySelector(".calque-quitte")) p.push("le calque de l'écran quitté est resté");
    if (principal && principal.classList.contains("ecran--attente")) p.push("l'écran est resté en attente");
    if (document.querySelector("#principal .message--erreur")) p.push(`message d'erreur affiché : ${document.querySelector("#principal .message--erreur").textContent.trim().slice(0, 80)}`);
    if (document.body.classList.contains("avec-navigation")) {
      const segment = (location.hash.replace(/^#/, "") || "/").split("/")[1] || "";
      const attendu = { "": "/", lecon: "/", notes: "/notes", eglise: "/eglise", documents: "/eglise", "a-propos": "/", plus: "/plus" }[segment];
      const courant = document.querySelector('#navigation [aria-current="page"]');
      if (attendu && (!courant || courant.dataset.onglet !== attendu))
        p.push(`barre du bas : onglet marqué « ${courant ? courant.dataset.onglet : "aucun"} » sur l'écran ${location.hash}`);
    }
    return p;
  });
}

async function controlerSante(t, page, moment) {
  const calme = await repos(page);
  await releverSelecteurs(page);
  if (!calme) t.defaut(`${moment} : quelque chose bouge encore après 4 secondes (animation ou écran non terminé)`);
  for (const probleme of await etatSain(page)) t.defaut(`${moment} : ${probleme}`);
}

// ---------------------------------------------------------------------------
// Inspection d'un écran (débordements, cibles tactiles, règles du graphisme…)
// ---------------------------------------------------------------------------

function inspecter(page) {
  return page.evaluate(
    ([VIOLET, ROSE]) => {
      const vw = document.documentElement.clientWidth;
      const visible = (e) => {
        const b = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        return b.width > 0 && b.height > 0 && s.visibility !== "hidden" && !e.closest("[hidden], [inert], .visuellement-cache");
      };
      const nom = (e) => {
        const classes = typeof e.className === "string" && e.className.trim() ? "." + e.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
        const texte = (e.textContent || e.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 36);
        return `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}${classes}${texte ? ` « ${texte} »` : ""}`;
      };
      const dansLeTexte = (e) =>
        e.matches(".ref") ||
        (e.matches("a") && !e.matches(".bouton-principal, .ligne-lecon, .bouton-retour") && getComputedStyle(e).display.startsWith("inline") && Boolean(e.closest("p, li, blockquote, td")));
      const zones = [...document.querySelectorAll("#barre, #principal, #navigation, .feuille.feuille--ouverte")];
      const tous = zones.flatMap((z) => [...z.querySelectorAll("*")]).filter(visible);
      const r = { debordements: [], tronques: [], cibles: [], images: [], soulignes: [], fleches: [], polices: [], traits: [], roses: [], poignees: [], h1: document.querySelectorAll("#principal h1").length };

      if (document.documentElement.scrollWidth > vw + 1) r.debordements.push(`la page défile de côté (${document.documentElement.scrollWidth - vw} px de trop)`);
      const signales = new Set();
      for (const e of tous) {
        const b = e.getBoundingClientRect();
        if (b.right <= vw + 1.5 && b.left >= -1.5) continue;
        if (e.closest(".navigation__bulle, .bandeau-cadre, .bandeau-bulle")) continue;
        let coupe = false;
        for (let a = e.parentElement; a && a !== document.body; a = a.parentElement)
          if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(a).overflowX)) coupe = true;
        if (coupe) continue;
        if (!signales.has(e.parentElement)) r.debordements.push(`${nom(e)} dépasse de ${Math.round(Math.max(b.right - vw, -b.left))} px`);
        signales.add(e);
      }
      for (const e of tous) {
        if (!e.matches("button, a, h1, h2, .ligne-lecon__titre, .feuille__titre")) continue;
        if (getComputedStyle(e).overflowX !== "visible" && e.scrollWidth > e.clientWidth + 1) r.tronques.push(`${nom(e)} : texte coupé (${e.scrollWidth - e.clientWidth} px cachés)`);
      }
      for (const e of tous) {
        if (!e.matches("a[href], button, input, textarea, select, [role=button], [role=tab]") || e.disabled || dansLeTexte(e)) continue;
        let b = e.getBoundingClientRect();
        if (e.matches("input[type=checkbox], input[type=radio]") && e.closest("label")) b = e.closest("label").getBoundingClientRect();
        if (b.width < 43.5 || b.height < 43.5) r.cibles.push(`${nom(e)} : ${Math.round(b.width)} × ${Math.round(b.height)} px`);
      }
      for (const image of zones.flatMap((z) => [...z.querySelectorAll("img")])) {
        if (!visible(image)) continue;
        if (!image.hasAttribute("alt") || !image.alt.trim()) r.images.push(`image sans description : ${image.getAttribute("src")}`);
        if (image.complete && image.naturalWidth === 0) r.images.push(`image cassée : ${image.getAttribute("src")}`);
      }
      for (const e of tous) {
        if (!e.matches("a, button")) continue;
        if (!dansLeTexte(e) && getComputedStyle(e).textDecorationLine.includes("underline")) r.soulignes.push(`${nom(e)} est souligné`);
        if (/[←→➔➜⟶]/.test(e.textContent)) r.fleches.push(`${nom(e)} : flèche tapée dans le texte`);
      }
      for (const e of tous) {
        if (!e.matches(".titre-accueil, .titre-page, .titre-sous-page, .page-titre, .lecon-titre, .feuille__titre")) continue;
        if (!/^"?Bricolage Grotesque/.test(getComputedStyle(e).fontFamily)) r.polices.push(`${nom(e)} n'est pas en Bricolage Grotesque (${getComputedStyle(e).fontFamily.split(",")[0]})`);
      }
      const clair = document.documentElement.dataset.apparence !== "sombre" && getComputedStyle(document.body).color !== "rgb(242, 238, 243)";
      for (const e of tous) {
        const s = getComputedStyle(e);
        if (clair)
          for (const cote of ["Top", "Right", "Bottom", "Left"])
            if (parseFloat(s[`border${cote}Width`]) > 0 && s[`border${cote}Style`] !== "none" && s[`border${cote}Color`] === VIOLET) {
              r.traits.push(`${nom(e)} : trait violet`);
              break;
            }
        if (s.backgroundColor === ROSE && !e.matches(".encart--encadre, .message")) r.roses.push(`${nom(e)} : fond rose`);
        if (e.matches("textarea") && s.resize !== "none") r.poignees.push(`${nom(e)} : poignée de redimensionnement`);
      }
      return r;
    },
    [VIOLET, ROSE]
  );
}

// ---------------------------------------------------------------------------
// Contenu connu (lu dans les fichiers, pas deviné)
// ---------------------------------------------------------------------------

const INDEX = JSON.parse(fs.readFileSync(path.join(APP, "contenu/index.json"), "utf8"));
const LECONS = INDEX.lecons.map((l) => l.numero);
const DOCUMENTS = (INDEX.documents || []).map((d) => d.slug);
const LECON_AVEC_FIGURE = INDEX.lecons.find((l) => fs.readFileSync(path.join(APP, "contenu/lecons", l.fichier), "utf8").includes('"type": "figure"'));

function tousLesEcrans() {
  const ecrans = ["/"];
  for (const n of LECONS) ecrans.push(`/lecon/${n}`, `/lecon/${n}/versets`, `/lecon/${n}/questions`);
  ecrans.push("/notes", "/notes/supprimees", "/eglise", ...DOCUMENTS.map((d) => `/documents/${d}`), "/a-propos", "/plus");
  return ecrans;
}

const ETAT_REMPLI = {
  reponses: { 1: { 2: "Il a créé le monde." }, 3: { 1: "Une réponse en cours." } },
  recitations: { 1: true },
  terminees: { 2: true },
};

const CHARGES = ['<img src=x onerror="window.__piege=1">', '"><script>window.__piege=1</script>', "<svg onload=window.__piege=1>", "javascript:window.__piege=1", "</textarea><img src=x onerror=window.__piege=1>", "${window.__piege=1}", "**<b onmouseover=window.__piege=1>gras</b>**"];
const piege = (page) => page.evaluate(() => Boolean(window.__piege) || Boolean(document.querySelector('img[src="x"], svg[onload], b[onmouseover], script:not([src]):not([type])')));

// ---------------------------------------------------------------------------
// Témoins — l'outil voit-il un défaut quand il y en a un ?
// ---------------------------------------------------------------------------
// Un contrôle qui ne signale rien ne prouve rien tant qu'on ne l'a pas vu signaler un défaut
// posé exprès (consigne du 23 novembre 2026, après un outil de mesure qui se trompait).

test("T · Témoins de l'outil", "chaque défaut posé exprès est repéré", async (t) => {
  t.erreursAttendues = /./;
  const page = await t.page({ mouvement: false });
  await aller(page, "/plus");
  const propre = await inspecter(page);
  for (const [famille, liste] of Object.entries(propre)) if (Array.isArray(liste) && liste.length) t.note(`avant d'abîmer la page, « ${famille} » signale déjà : ${liste[0]}`);
  await page.evaluate(() => {
    const p = document.getElementById("principal");
    p.insertAdjacentHTML(
      "beforeend",
      `<div id="temoin-large" style="width:130vw;height:10px">trop large</div>
       <button id="temoin-petit" style="width:20px;height:20px;padding:0">x</button>
       <button id="temoin-souligne" style="text-decoration:underline;min-height:44px;min-width:44px">action soulignée</button>
       <a id="temoin-fleche" href="#/" style="display:block;min-height:44px">Suite →</a>
       <img id="temoin-image" src="icones/icone-192.png" width="50" height="50">
       <img id="temoin-cassee" src="introuvable.png" alt="image cassée" width="50" height="50">
       <h1 class="titre-page" id="temoin-police" style="font-family:Georgia">Mauvaise police</h1>
       <div id="temoin-trait" style="border-top:2px solid rgb(110, 26, 110);height:10px">trait</div>
       <div id="temoin-rose" style="background:rgb(246, 237, 245);height:20px">rose</div>
       <textarea id="temoin-poignee" style="resize:vertical;min-height:44px"></textarea>
       <button id="temoin-coupe" style="width:60px;min-height:44px;overflow:hidden;white-space:nowrap">Texte bien trop long pour ce bouton</button>`
    );
  });
  await pause(600);
  const r = await inspecter(page);
  const attendus = { debordements: "temoin-large", cibles: "temoin-petit", soulignes: "temoin-souligne", fleches: "temoin-fleche", images: "introuvable.png", polices: "temoin-police", traits: "temoin-trait", roses: "temoin-rose", poignees: "temoin-poignee", tronques: "temoin-coupe" };
  for (const [famille, repere] of Object.entries(attendus)) t.verifier(r[famille].some((m) => m.includes(repere)), `l'outil ne repère pas le défaut posé exprès : ${famille} (${repere})`);
  t.verifier(r.images.some((m) => m.includes("sans description")), "l'outil ne repère pas une image sans description");
  t.verifier(r.h1 === 2, "l'outil ne compte pas un deuxième titre principal");

  // L'état de la page : figée, neutralisée, fenêtre restée affichée, onglet mal marqué.
  await page.evaluate(() => {
    document.body.style.overflow = "hidden";
    document.getElementById("principal").inert = true;
    document.querySelector(".feuille").hidden = false;
    document.querySelector('#navigation [aria-current="page"]').removeAttribute("aria-current");
    document.getElementById("principal").style.marginTop = "-60px";
  });
  const sante = (await etatSain(page)).join(" | ");
  for (const mot of ["figée", "neutralisé", "encore à l'écran", "barre du bas", "caché sous la barre"]) t.verifier(sante.includes(mot), `l'outil ne repère pas l'état abîmé exprès : ${mot}`);

  // L'injection : une balise posée par du texte saisi.
  await page.evaluate(() => document.getElementById("principal").insertAdjacentHTML("beforeend", '<img src="x" onerror="window.__piege=1">'));
  await pause(300);
  t.verifier(await piege(page), "l'outil ne repère pas une injection posée exprès");

  // Une erreur JavaScript et une requête vers l'extérieur sont relevées.
  const avant = t.journal.length;
  await page.evaluate(() => setTimeout(() => { throw new Error("erreur posée exprès"); }, 0));
  await page.evaluate(() => fetch("http://127.0.0.1:9/temoin-exterieur").catch(() => {}));
  await pause(400);
  t.verifier(t.journal.slice(avant).some((m) => m.includes("erreur posée exprès")), "l'outil ne relève pas une erreur JavaScript posée exprès");
  t.verifier(requetes.some((q) => q.url.includes("temoin-exterieur")), "l'outil ne relève pas une requête vers l'extérieur posée exprès");
  // Cette requête témoin ne doit pas compter dans le bilan de sécurité.
  for (let i = requetes.length - 1; i >= 0; i--) if (requetes[i].url.includes("temoin-exterieur")) requetes.splice(i, 1);
});

// ---------------------------------------------------------------------------
// Famille 0 — les contrôles existants du projet
// ---------------------------------------------------------------------------

for (const [script, attendu] of [
  ["verifier-contrastes.mjs", /Tous les contrastes atteignent le seuil/],
  ["verifier-contenu.mjs", /^OK/m],
  ["verifier-versets.mjs", /^OK/m],
  ["comparer-documents-au-pdf.mjs", /^OK/m],
])
  test("0 · Contrôles du projet", script, async (t) => {
    const r = spawnSync(process.execPath, [path.join(RACINE, "scripts", script)], { cwd: RACINE, encoding: "utf8" });
    const sortie = `${r.stdout || ""}${r.stderr || ""}`;
    t.verifier(r.status === 0 && attendu.test(sortie), `le contrôle échoue : ${sortie.trim().split("\n").slice(-3).join(" / ")}`);
  });

// ---------------------------------------------------------------------------
// Famille 1 — parcours de tous les écrans
// ---------------------------------------------------------------------------

const CONFIGURATIONS = [
  { nom: "grand téléphone, clair, texte normal", largeur: 390, sombre: false, taille: 0 },
  { nom: "petit téléphone, clair, plus grand texte", largeur: 320, sombre: false, taille: 2 },
  { nom: "grand téléphone, sombre, texte normal", largeur: 390, sombre: true, taille: 0 },
  { nom: "petit téléphone, sombre, plus grand texte", largeur: 320, sombre: true, taille: 2 },
];

for (const config of CONFIGURATIONS)
  test("1 · Parcours de A à Z", `tous les écrans — ${config.nom}`, async (t) => {
    const page = await t.page({
      largeur: config.largeur,
      hauteur: config.largeur === 320 ? 568 : 844,
      mouvement: false,
      etat: { ...ETAT_REMPLI, taillePolice: config.taille, apparence: config.sombre ? "sombre" : "clair" },
    });
    const releves = new Map(); // message → écrans
    const relever = (message, ecran) => releves.set(message, [...(releves.get(message) || []), ecran]);
    for (const ecran of tousLesEcrans()) {
      const avant = t.journal.length;
      if (!(await aller(page, ecran))) relever("l'écran ne se stabilise pas (4 s)", ecran);
      for (const probleme of await etatSain(page)) relever(probleme, ecran);
      const r = await inspecter(page);
      for (const famille of ["debordements", "tronques", "images"]) for (const m of r[famille]) relever(m, ecran);
      // Ces règles se vérifient une fois : inutile de les répéter quatre fois dans le rapport.
      if (config === CONFIGURATIONS[0]) {
        for (const famille of ["cibles", "soulignes", "fleches", "polices", "traits", "roses", "poignees"]) for (const m of r[famille]) relever(m, ecran);
        if (r.h1 !== 1) relever(`${r.h1} titre(s) principal(aux) (h1) au lieu d'un seul`, ecran);
      }
      for (const m of t.journal.splice(avant)) relever(m, ecran);
    }
    for (const [message, ecrans] of releves) {
      const ou = ecrans.length > 4 ? `${ecrans.slice(0, 4).join(", ")}… (${ecrans.length} écrans)` : ecrans.join(", ");
      t.defaut(`${message} — ${ou}`);
    }
    t.note(`${tousLesEcrans().length} écrans parcourus`);
  });

test("1 · Parcours de A à Z", "adresse inconnue ou abîmée", async (t) => {
  const page = await t.page({ mouvement: false });
  for (const chemin of ["/lecon/99", "/lecon/abc", "/documents/inconnu", "/nimporte/quoi", "/notes/99", "/notes/1/inconnu", "/lecon/1/inconnu"]) {
    await aller(page, chemin);
    const vide = await page.evaluate(() => !document.getElementById("principal").textContent.trim());
    t.verifier(!vide, `écran vide à l'adresse ${chemin}`);
    const fige = await page.evaluate(() => document.body.style.overflow === "hidden" || document.getElementById("principal").inert);
    t.verifier(!fige, `page figée à l'adresse ${chemin}`);
  }
  t.journal.length = 0; // un fichier introuvable est attendu ici ; seule compte la tenue de l'écran
  await aller(page, "/");
  t.verifier((await page.locator('a.ligne-lecon[href^="#/lecon/"]').count()) === LECONS.length, "après une adresse inconnue, l'accueil ne montre plus toutes les leçons");
});

test("1 · Parcours de A à Z", "sur un ordinateur : écran d'orientation puis poursuite", async (t) => {
  const page = await t.page({ tactile: false, installee: false, largeur: 1280, hauteur: 800, mouvement: false });
  await aller(page, "/");
  t.verifier((await page.locator(".orientation").count()) === 1, "l'écran « ce cours s'utilise sur téléphone » n'apparaît pas sur ordinateur");
  await toucher(page, '[data-ordinateur="continuer"]');
  await repos(page);
  t.verifier((await page.locator('a.ligne-lecon[href^="#/lecon/"]').count()) === LECONS.length, "« Continuer sur cet écran » ne mène pas à la liste des leçons");
  await recharger(page);
  await repos(page);
  t.verifier((await page.locator(".orientation").count()) === 0, "le choix de continuer sur ordinateur est oublié après rechargement");
});

test("1 · Parcours de A à Z", "dans Safari, pas encore installée : invitation à installer", async (t) => {
  const page = await t.page({ installee: false, mouvement: false });
  await aller(page, "/");
  if (!t.verifier((await page.locator("#invite-installation").count()) === 1, "l'invitation à installer n'apparaît pas dans Safari d'iPhone")) return;
  const r = await inspecter(page);
  for (const m of [...r.cibles, ...r.soulignes, ...r.roses, ...r.debordements]) t.defaut(`invitation : ${m}`);
  await toucher(page, '#invite-installation [data-invite="plus-tard"]');
  await repos(page);
  t.verifier((await page.locator("#invite-installation").count()) === 0, "« Plus tard » ne retire pas l'invitation");
  await recharger(page);
  await repos(page);
  t.verifier((await page.locator("#invite-installation").count()) === 0, "l'invitation refusée revient après rechargement");
});

// ---------------------------------------------------------------------------
// Famille 2 — navigation et transitions (animations actives)
// ---------------------------------------------------------------------------

// Au toucher d'une ligne, l'écran quitté est recopié dans un calque qui recule sous le nouveau.
// La copie doit se poser exactement sur l'écran : ses marges écrites à part l'en décalaient de
// 8 px vers le bas et la gauche (vu par Sébastien, mesuré le 27 novembre 2026).
function ecartDeLaCopie(page, selecteur) {
  return page.evaluate(
    (selecteur) =>
      new Promise((fin) => {
        const lien = document.querySelector(selecteur);
        if (!lien) return fin(null);
        lien.scrollIntoView({ block: "center" });
        const avant = document.querySelector("#principal h1").getBoundingClientRect();
        const veille = new MutationObserver(() => {
          const copie = document.querySelector(".calque-quitte h1");
          if (!copie) return;
          veille.disconnect();
          const r = copie.getBoundingClientRect();
          fin({ x: r.left - avant.left, y: r.top - avant.top });
        });
        veille.observe(document.body, { childList: true });
        setTimeout(() => (veille.disconnect(), fin(null)), 3000);
        lien.click();
      }),
    selecteur
  );
}

test("2 · Navigation et transitions", "l'écran quitté ne se décale pas au toucher", async (t) => {
  const page = await t.page();
  const passages = [
    ["/", 'a.ligne-lecon[href="#/lecon/1"]', "Cours → leçon 1"],
    ["/", 'a[href="#/a-propos"]', "Cours → À propos"],
    ["/eglise", 'a[href="#/documents/confession-de-foi"]', "L'église → Confession de foi"],
  ];
  for (const [depart, lien, nom] of passages) {
    await aller(page, depart);
    const e = await ecartDeLaCopie(page, lien);
    if (!e) { t.defaut(`${nom} : pas de copie de l'écran quitté`); continue; }
    t.verifier(Math.abs(e.x) < 0.5 && Math.abs(e.y) < 0.5, `${nom} : l'écran quitté saute de ${e.x.toFixed(1)} px à l'horizontale et ${e.y.toFixed(1)} px à la verticale`);
    await repos(page);
  }
  // Témoin : des marges forcées sur la copie doivent être repérées.
  await aller(page, "/");
  await page.addStyleTag({ content: ".calque-quitte { padding: 20px !important; }" });
  const temoin = await ecartDeLaCopie(page, 'a.ligne-lecon[href="#/lecon/2"]');
  t.verifier(temoin && (Math.abs(temoin.x) > 2 || Math.abs(temoin.y) > 2), "le contrôle ne repère pas une copie décalée exprès");
});

test("2 · Navigation et transitions", "barre du bas : les quatre onglets et le retour", async (t) => {
  const page = await t.page();
  await aller(page, "/");
  for (const [onglet, titre] of [["/notes", "Notes"], ["/eglise", "L’église"], ["/plus", "Plus"]]) {
    await toucher(page, `#navigation [data-onglet="${onglet}"]`);
    await controlerSante(t, page, `onglet ${titre}`);
    t.verifier((await page.evaluate(() => location.hash)) === `#${onglet}`, `toucher « ${titre} » ne mène pas à ${onglet}`);
    const h1 = await page.locator("#principal h1").first().textContent().catch(() => "");
    t.verifier(h1.trim() === titre, `l'écran ${onglet} a pour titre « ${h1.trim()} » au lieu de « ${titre} »`);
  }
  const rang = await page.evaluate(() => getComputedStyle(document.getElementById("navigation")).getPropertyValue("--onglet").trim());
  t.verifier(rang === "3", `la bulle de la barre du bas n'est pas sous « Plus » (rang ${rang || "absent"})`);
  await retour(page);
  await controlerSante(t, page, "retour depuis Plus");
  t.verifier((await page.evaluate(() => location.hash.replace(/^#\/?$/, ""))) === "", `depuis Plus, le retour mène à ${await page.evaluate(() => location.hash)} au lieu de l'accueil`);
});

test("2 · Navigation et transitions", "ouvrir une leçon, changer d'onglet, revenir à sa place", async (t) => {
  const page = await t.page({ hauteur: 600 });
  await aller(page, "/");
  await page.evaluate(() => window.scrollTo(0, 260));
  const avant = await page.evaluate(() => window.scrollY);
  await toucher(page, 'a.ligne-lecon[href="#/lecon/9"]');
  await controlerSante(t, page, "ouverture de la leçon 9");
  t.verifier((await page.evaluate(() => location.hash)) === "#/lecon/9", "toucher la leçon 9 ne l'ouvre pas");
  t.verifier((await page.evaluate(() => window.scrollY)) < 5, "la leçon ne s'ouvre pas en haut de page");
  for (const onglet of ["versets", "questions", "lecture"]) {
    if (!(await page.locator(`#onglet-${onglet}`).count())) continue;
    await toucher(page, `#onglet-${onglet}`);
    await controlerSante(t, page, `onglet ${onglet} de la leçon`);
    t.verifier(await page.evaluate((o) => !document.getElementById(`panneau-${o}`).hidden, onglet), `le panneau « ${onglet} » ne s'affiche pas`);
    t.verifier((await page.locator('[role="tab"][aria-selected="true"]').count()) === 1, `après « ${onglet} », il n'y a pas exactement un onglet choisi`);
  }
  await toucher(page, ".bouton-retour");
  await controlerSante(t, page, "retour à l'accueil");
  t.verifier((await page.evaluate(() => location.hash.replace(/^#\/?$/, ""))) === "", "la flèche de retour ne ramène pas à l'accueil");
  const apres = await page.evaluate(() => window.scrollY);
  t.verifier(Math.abs(apres - avant) < 40, `au retour, la liste n'est pas à la même hauteur (${Math.round(avant)} px avant, ${Math.round(apres)} px après)`);
  const longueur = await page.evaluate(() => history.length);
  t.note(`historique : ${longueur} étape(s) après aller-retour avec trois changements d'onglet`);
});

test("2 · Navigation et transitions", "onglets d'une leçon : un seul retour ramène à la liste", async (t) => {
  const page = await t.page({ mouvement: false });
  await aller(page, "/");
  await toucher(page, 'a.ligne-lecon[href="#/lecon/1"]');
  await repos(page);
  await toucher(page, "#onglet-versets");
  await repos(page);
  await toucher(page, "#onglet-questions");
  await repos(page);
  await retour(page);
  await repos(page);
  t.verifier((await page.evaluate(() => location.hash.replace(/^#\/?$/, ""))) === "", `après deux changements d'onglet, un retour mène à ${await page.evaluate(() => location.hash)} au lieu de la liste`);
});

// Les fenêtres du bas : chacune s'ouvre, neutralise l'arrière-plan, et se ferme de quatre façons.
const FENETRES = [
  {
    nom: "Affichage (Aa)",
    depart: "/lecon/1",
    feuille: ".feuille:has(#reglages-titre)",
    ouvrir: (page) => toucher(page, "#ouvrir-reglages"),
    declencheur: "#ouvrir-reglages",
  },
  {
    nom: "Verset",
    depart: "/lecon/1",
    feuille: ".feuille:has(#feuille-titre)",
    ouvrir: (page) => toucher(page, "#panneau-lecture .ref"),
    declencheur: "#panneau-lecture .ref",
  },
];
const FERMETURES = [
  ["le bouton de fermeture", (page, f) => toucher(page, `${f.feuille} .feuille__fermer`)],
  ["la touche Échap", (page) => page.keyboard.press("Escape")],
  ["un toucher sur le fond", (page) => page.touchscreen.tap(195, 30)],
  ["le retour en arrière", (page) => retour(page)],
];

for (const fenetre of FENETRES)
  for (const mouvement of [true, false])
    test("2 · Navigation et transitions", `fenêtre « ${fenetre.nom} »${mouvement ? "" : ", animations réduites"}`, async (t) => {
      const page = await t.page({ mouvement });
      await aller(page, "/");
      await aller(page, fenetre.depart);
      for (const [commentFermer, fermer] of FERMETURES) {
        const adresse = await page.evaluate(() => location.hash);
        await fenetre.ouvrir(page);
        const ouverte = await page
          .waitForFunction((s) => document.querySelector(s) && document.querySelector(s).classList.contains("feuille--ouverte"), fenetre.feuille, { timeout: 3000 })
          .then(() => true, () => false);
        if (!t.verifier(ouverte, `la fenêtre ne s'ouvre pas (avant fermeture par ${commentFermer})`)) return;
        await repos(page);
        const pendant = await page.evaluate((s) => {
          const feuille = document.querySelector(s);
          return {
            principal: document.getElementById("principal").inert,
            barre: document.getElementById("barre").inert,
            navigation: document.getElementById("navigation").inert || getComputedStyle(document.getElementById("navigation")).display === "none" || !document.body.classList.contains("avec-navigation"),
            fige: document.body.style.overflow === "hidden",
            focus: feuille.contains(document.activeElement),
            dialogue: Boolean(feuille.querySelector('[role="dialog"][aria-modal="true"]')),
          };
        }, fenetre.feuille);
        t.verifier(pendant.principal && pendant.barre, "fenêtre ouverte : le contenu derrière n'est pas neutralisé (inert)");
        t.verifier(pendant.navigation, "fenêtre ouverte : la barre du bas reste atteignable au clavier et au lecteur d'écran");
        t.verifier(pendant.fige, "fenêtre ouverte : la page derrière défile encore");
        t.verifier(pendant.focus, "fenêtre ouverte : le focus n'est pas dans la fenêtre");
        t.verifier(pendant.dialogue, "la fenêtre n'est pas annoncée comme une boîte de dialogue");
        if (commentFermer === "le bouton de fermeture") {
          const r = await inspecter(page);
          for (const m of [...r.cibles, ...r.soulignes, ...r.polices, ...r.roses, ...r.debordements, ...r.tronques]) t.defaut(`dans la fenêtre : ${m}`);
          // En tabulant, le focus reste dans la fenêtre. Entre le dernier et le premier élément,
          // il passe par la barre du navigateur (la page voit alors « body ») : c'est normal.
          const ailleurs = new Set();
          for (let i = 0; i < 12; i++) {
            await page.keyboard.press("Tab");
            const ou = await page.evaluate((s) => {
              const a = document.activeElement;
              if (!a || a === document.body || document.querySelector(s).contains(a)) return null;
              return `${a.tagName.toLowerCase()}${a.id ? "#" + a.id : ""} « ${(a.textContent || "").trim().slice(0, 24)} »`;
            }, fenetre.feuille);
            if (ou) ailleurs.add(ou);
          }
          t.verifier(ailleurs.size === 0, `en tabulant, le focus sort de la fenêtre ouverte vers : ${[...ailleurs].join(" ; ")}`);
        }
        await fermer(page, fenetre);
        const fermee = await page
          .waitForFunction((s) => document.querySelector(s).hidden, fenetre.feuille, { timeout: 3000 })
          .then(() => true, () => false);
        if (!t.verifier(fermee, `la fenêtre ne se ferme pas par ${commentFermer}`)) return;
        await controlerSante(t, page, `après fermeture par ${commentFermer}`);
        t.verifier((await page.evaluate(() => location.hash)) === adresse, `fermer par ${commentFermer} change d'écran (${adresse} → ${await page.evaluate(() => location.hash)})`);
        const focusRendu = await page.evaluate((s) => document.activeElement && document.activeElement.matches(s), fenetre.declencheur);
        t.verifier(focusRendu, `après fermeture par ${commentFermer}, le focus ne revient pas sur ce qui a ouvert la fenêtre`);
      }
      // Une fenêtre fermée ne doit pas laisser d'étape en trop : un retour quitte l'écran.
      await retour(page);
      await controlerSante(t, page, "retour après les quatre fermetures");
      const adresse = await page.evaluate(() => location.hash);
      t.verifier(!(await page.evaluate((s) => document.querySelector(s).classList.contains("feuille--ouverte"), fenetre.feuille)), "après les fermetures, un retour rouvre la fenêtre");
      t.verifier(adresse.replace(/^#\/?$/, "") === "", `après quatre ouvertures et fermetures, un seul retour devrait ramener à l'accueil ; il mène à ${adresse}`);
    });

test("2 · Navigation et transitions", "fenêtre restée ouverte au rechargement de la page", async (t) => {
  const page = await t.page();
  await aller(page, "/lecon/1");
  await toucher(page, "#ouvrir-reglages");
  await repos(page);
  await recharger(page);
  await controlerSante(t, page, "après rechargement, fenêtre Affichage ouverte");
  t.verifier((await page.locator("#panneau-lecture p").count()) > 3, "après rechargement avec une fenêtre ouverte, la leçon ne s'affiche plus");
  const ouverte = await page.evaluate(() => Boolean(document.querySelector(".feuille.feuille--ouverte")));
  t.note(`après rechargement, la fenêtre est ${ouverte ? "rouverte" : "fermée"}`);
  if (ouverte) {
    await page.keyboard.press("Escape");
    await controlerSante(t, page, "fermeture de la fenêtre rouverte au rechargement");
  }
});

if (LECON_AVEC_FIGURE)
  test("2 · Navigation et transitions", "agrandir une figure (loupe)", async (t) => {
    const page = await t.page();
    await aller(page, `/lecon/${LECON_AVEC_FIGURE.numero}`);
    if (!t.verifier((await page.locator(".figure__bouton").count()) > 0, "aucune figure à agrandir dans la leçon qui en contient")) return;
    for (const [commentFermer, fermer] of [["Échap", (p) => p.keyboard.press("Escape")], ["le retour en arrière", (p) => retour(p)], ["un toucher sur l'image", (p) => p.touchscreen.tap(195, 420)]]) {
      await toucher(page, ".figure__bouton");
      await pause(500);
      if (!t.verifier(await page.evaluate(() => !document.querySelector(".loupe").hidden), `la loupe ne s'ouvre pas (avant ${commentFermer})`)) return;
      const image = await page.evaluate(() => {
        const i = document.querySelector(".loupe img");
        return i ? { ok: i.complete && i.naturalWidth > 0, alt: i.alt } : null;
      });
      t.verifier(image && image.ok, "l'image agrandie ne se charge pas");
      t.verifier(image && image.alt.trim(), "l'image agrandie n'a pas de description");
      await fermer(page);
      await pause(700);
      t.verifier(await page.evaluate(() => document.querySelector(".loupe").hidden), `la loupe ne se ferme pas par ${commentFermer}`);
      await controlerSante(t, page, `loupe fermée par ${commentFermer}`);
    }
  });

// Onglet Plus, « Partager le cours » : le QR code est dans la page, un toucher l'agrandit
// (loupe, fond blanc), et le bouton partage l'adresse qui ouvre l'invitation à installer.
test("2 · Navigation et transitions", "Plus : le QR code s'agrandit, le lien se partage", async (t) => {
  const page = await t.page();
  await aller(page, "/plus");
  const qr = await page.evaluate(() => {
    const i = document.querySelector('[data-reglage="agrandir-qr"] img');
    return i ? { ok: i.complete && i.naturalWidth > 0, fond: getComputedStyle(i).backgroundColor } : null;
  });
  if (!t.verifier(qr && qr.ok, "le QR code n'est pas affiché dans l'onglet Plus")) return;
  t.verifier(qr.fond === "rgb(255, 255, 255)", `le QR code n'a pas de fond blanc (${qr.fond})`);
  const lien = await page.evaluate(() => (document.querySelector("[data-partage]") || {}).dataset?.partage || "");
  t.verifier(/\?installer$/.test(lien), `le bouton ne partage pas l'adresse du cours (${lien || "absent"})`);
  for (const [commentFermer, fermer] of [["Échap", (p) => p.keyboard.press("Escape")], ["le retour en arrière", (p) => retour(p)], ["un toucher", (p) => p.touchscreen.tap(195, 420)]]) {
    await toucher(page, '[data-reglage="agrandir-qr"]');
    await pause(500);
    if (!t.verifier(await page.evaluate(() => !document.querySelector(".loupe").hidden), `le QR code ne s'agrandit pas (avant ${commentFermer})`)) return;
    t.verifier(await page.evaluate(() => document.querySelector(".loupe img").classList.contains("loupe__qr")), "le QR agrandi n'a pas son réglage net");
    await fermer(page);
    await pause(700);
    t.verifier(await page.evaluate(() => document.querySelector(".loupe").hidden), `le QR agrandi ne se ferme pas par ${commentFermer}`);
    await controlerSante(t, page, `QR agrandi fermé par ${commentFermer}`);
  }
  t.verifier((await page.evaluate(() => location.hash)) === "#/plus", "après l'agrandissement du QR, on n'est plus dans l'onglet Plus");
});

test("2 · Navigation et transitions", "gestes rapides : onglets du bas enchaînés", async (t) => {
  const page = await t.page();
  await aller(page, "/");
  for (let tour = 0; tour < 3; tour++)
    for (const onglet of ["/notes", "/eglise", "/plus", "/", "/plus", "/notes"]) {
      await page.locator(`#navigation [data-onglet="${onglet}"]`).tap();
      await pause(40);
    }
  await controlerSante(t, page, "après 18 changements d'onglet rapides");
  t.verifier((await page.evaluate(() => location.hash)) === "#/notes", `après la rafale, l'écran est ${await page.evaluate(() => location.hash)} au lieu de #/notes`);
  t.verifier((await page.locator("#principal h1").first().textContent()).trim() === "Notes", "après la rafale, l'écran affiché n'est pas celui de l'adresse");
});

test("2 · Navigation et transitions", "gestes rapides : leçon ouverte et quittée aussitôt", async (t) => {
  const page = await t.page();
  await aller(page, "/");
  for (const n of [1, 4, 7]) {
    await page.locator(`a.ligne-lecon[href="#/lecon/${n}"]`).tap();
    await pause(80);
    await retour(page);
    await pause(60);
  }
  await controlerSante(t, page, "après trois ouvertures de leçon annulées aussitôt");
  t.verifier((await page.locator('a.ligne-lecon[href^="#/lecon/"]').count()) === LECONS.length, `après les allers-retours rapides, l'accueil n'est pas affiché (${await page.evaluate(() => location.hash)})`);
  t.verifier((await page.locator(".ligne--touchee").count()) === 0, "une ligne reste « touchée » après le retour");
  // Puis une leçon ouverte normalement fonctionne encore.
  await toucher(page, 'a.ligne-lecon[href="#/lecon/2"]');
  await controlerSante(t, page, "leçon ouverte après la rafale");
  t.verifier((await page.locator("#panneau-lecture p").count()) > 3, "après la rafale, une leçon ne s'ouvre plus correctement");
});

test("2 · Navigation et transitions", "gestes rapides : fenêtre ouverte et fermée aussitôt, onglets de leçon", async (t) => {
  const page = await t.page();
  await aller(page, "/");
  await aller(page, "/lecon/1");
  for (let i = 0; i < 4; i++) {
    await page.locator("#ouvrir-reglages").tap();
    await pause(60);
    await page.keyboard.press("Escape");
    await pause(60);
  }
  await controlerSante(t, page, "après quatre ouvertures de fenêtre annulées aussitôt");
  for (let i = 0; i < 4; i++)
    for (const onglet of ["versets", "questions", "lecture"]) {
      await page.locator(`#onglet-${onglet}`).tap();
      await pause(40);
    }
  await controlerSante(t, page, "après douze changements d'onglet de leçon rapides");
  t.verifier(await page.evaluate(() => !document.getElementById("panneau-lecture").hidden), "après la rafale, le panneau affiché n'est pas « Lecture »");
  // Une fenêtre ouverte pendant un changement d'écran.
  await page.locator("#ouvrir-reglages").tap();
  await pause(50);
  await retour(page);
  await pause(50);
  await retour(page);
  await controlerSante(t, page, "fenêtre ouverte puis deux retours rapides");
  t.verifier((await page.locator('a.ligne-lecon[href^="#/lecon/"]').count()) === LECONS.length, `fenêtre ouverte puis deux retours rapides : l'accueil n'est pas affiché (${await page.evaluate(() => location.hash)})`);
});

test("2 · Navigation et transitions", "durées : les fenêtres et les écrans finissent à l'heure", async (t) => {
  const page = await t.page();
  await aller(page, "/lecon/1");
  const durees = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return { ouverture: parseFloat(s.getPropertyValue("--feuille-ouverture")), fermeture: parseFloat(s.getPropertyValue("--feuille-fermeture")), ecran: parseFloat(s.getPropertyValue("--ecran-entree")) };
  });
  const chrono = async (action, fin) => {
    const debut = Date.now();
    await action();
    await page.waitForFunction(fin, null, { timeout: 5000, polling: 20 }).catch(() => {});
    await repos(page);
    return Date.now() - debut;
  };
  const ouverture = await chrono(() => page.locator("#ouvrir-reglages").tap(), () => document.querySelector(".feuille--ouverte"));
  const fermeture = await chrono(() => page.keyboard.press("Escape"), () => !document.querySelector(".feuille:not([hidden])"));
  t.note(`Affichage : ouverture ${ouverture} ms (réglée à ${durees.ouverture} ms), fermeture ${fermeture} ms (réglée à ${durees.fermeture} ms), entrée d'écran réglée à ${durees.ecran} ms`);
  t.verifier(ouverture < durees.ouverture + 700, `l'ouverture d'une fenêtre dure ${ouverture} ms pour ${durees.ouverture} ms prévues`);
  t.verifier(fermeture < durees.fermeture + 700, `la fermeture d'une fenêtre dure ${fermeture} ms pour ${durees.fermeture} ms prévues`);
});

// ---------------------------------------------------------------------------
// Famille 3 — réponses, progression, réglages
// ---------------------------------------------------------------------------

test("3 · Réponses et réglages", "une réponse saisie est gardée (pause, changement d'écran, rechargement)", async (t) => {
  const page = await t.page({ mouvement: false });
  await aller(page, "/lecon/1/questions");
  const champ = page.locator("#question-1-2");
  await champ.fill("Dieu crée, l’homme se rebelle.\nDeuxième ligne avec « guillemets » & <chevrons>.");
  await pause(1500);
  t.verifier(((await etatEnregistre(page)).reponses[1] || {})[2] === "Dieu crée, l’homme se rebelle.\nDeuxième ligne avec « guillemets » & <chevrons>.", "la réponse n'est pas enregistrée après une pause dans la frappe");
  await recharger(page);
  await repos(page);
  t.verifier((await page.locator("#question-1-2").inputValue()) === "Dieu crée, l’homme se rebelle.\nDeuxième ligne avec « guillemets » & <chevrons>.", "la réponse n'est plus là, ou a changé, après rechargement");
  t.verifier((await page.locator("#onglet-questions .onglet__compte").textContent()).trim().startsWith("1"), "le compteur de l'onglet Questions n'affiche pas 1 réponse");

  // Tapée puis écran quitté aussitôt : rien ne doit se perdre.
  await page.locator("#question-1-3").fill("Écrit juste avant de partir");
  await page.evaluate(() => (location.hash = "/"));
  await repos(page);
  t.verifier(((await etatEnregistre(page)).reponses[1] || {})[3] === "Écrit juste avant de partir", "une réponse tapée juste avant de changer d'écran est perdue");
  t.verifier((await page.locator('a.ligne-lecon[href="#/lecon/1"] .ligne-lecon__etat--en-cours').count()) === 1, "l'accueil ne montre pas la leçon 1 « En cours »");

  // Tapée puis page rechargée aussitôt.
  await aller(page, "/lecon/1/questions");
  await page.locator("#question-1-4").fill("Écrit juste avant de recharger");
  await recharger(page);
  await repos(page);
  t.verifier(((await etatEnregistre(page)).reponses[1] || {})[4] === "Écrit juste avant de recharger", "une réponse tapée juste avant de recharger ou de fermer la page est perdue");

  // Vidée : elle disparaît de l'enregistrement.
  await page.locator("#question-1-3").fill("");
  await pause(1500);
  t.verifier(!("3" in ((await etatEnregistre(page)).reponses[1] || {})), "une réponse vidée reste enregistrée");
});

test("3 · Réponses et réglages", "la zone d'écriture grandit avec le texte", async (t) => {
  const page = await t.page({ mouvement: false });
  await aller(page, "/lecon/1/questions");
  const champ = page.locator("#question-1-2");
  const avant = await champ.evaluate((e) => e.getBoundingClientRect().height);
  await champ.fill(Array.from({ length: 14 }, (_, i) => `Ligne ${i + 1} de ma réponse, assez longue pour passer à la ligne sur un téléphone.`).join("\n"));
  await pause(300);
  const m = await champ.evaluate((e) => ({ hauteur: e.getBoundingClientRect().height, cache: e.scrollHeight - e.clientHeight, poignee: getComputedStyle(e).resize }));
  t.verifier(m.hauteur > avant + 100, `la zone ne grandit pas (${Math.round(avant)} px puis ${Math.round(m.hauteur)} px)`);
  t.verifier(m.cache <= 2, `une partie de la réponse est cachée dans la zone (${m.cache} px à faire défiler)`);
  t.verifier(m.poignee === "none", "la poignée de redimensionnement est revenue");
  await recharger(page);
  await repos(page);
  const apres = await page.locator("#question-1-2").evaluate((e) => e.scrollHeight - e.clientHeight);
  t.verifier(apres <= 2, `après rechargement, la longue réponse est coupée (${apres} px cachés)`);
});

test("3 · Réponses et réglages", "case « Je sais les réciter » et leçon terminée", async (t) => {
  const page = await t.page({ mouvement: false });
  await aller(page, "/lecon/1/questions");
  const caseRecitation = page.locator('input[data-recitation="1"]');
  if (await caseRecitation.count()) {
    await toucher(page, "label.case");
    t.verifier(await caseRecitation.isChecked(), "toucher le libellé ne coche pas la case");
    t.verifier((await etatEnregistre(page)).recitations[1] === true, "la case cochée n'est pas enregistrée");
    await recharger(page);
    await repos(page);
    t.verifier(await page.locator('input[data-recitation="1"]').isChecked(), "la case n'est plus cochée après rechargement");
    await page.locator('input[data-recitation="1"]').focus();
    await page.keyboard.press("Space");
    t.verifier(!(await page.locator('input[data-recitation="1"]').isChecked()), "la barre d'espace ne décoche pas la case");
  }
  await toucher(page, '#fin-lecon [data-action="basculer-terminee"]');
  await repos(page);
  t.verifier((await etatEnregistre(page)).terminees[1] === true, "« Marquer la leçon comme terminée » n'enregistre rien");
  t.verifier((await page.locator("#fin-lecon").textContent()).includes("Leçon terminée"), "la fin de leçon n'affiche pas « Leçon terminée »");
  t.verifier(await page.evaluate(() => document.getElementById("fin-lecon").contains(document.activeElement)), "après avoir marqué la leçon, le focus est perdu");
  const r = await inspecter(page);
  for (const m of [...r.fleches, ...r.soulignes]) t.defaut(`fin de leçon : ${m}`);
  await toucher(page, '#fin-lecon a.bouton-principal');
  await repos(page);
  t.verifier((await page.locator('a.ligne-lecon--terminee[href="#/lecon/1"]').count()) === 1, "« Toutes les leçons » ne ramène pas à l'accueil avec la leçon 1 « Terminée »");
  await aller(page, "/lecon/1/questions");
  await toucher(page, '#fin-lecon [data-action="basculer-terminee"]');
  await repos(page);
  t.verifier(!(await etatEnregistre(page)).terminees[1], "« Marquer comme non terminée » ne retire pas la marque");
  // La fin de lecture mène aux versets.
  await aller(page, "/lecon/1");
  if (await page.locator(".lecture__fin a.bouton-principal").count()) {
    await toucher(page, ".lecture__fin a.bouton-principal");
    await repos(page);
    t.verifier(await page.evaluate(() => !document.getElementById("panneau-versets").hidden), "« S'entraîner aux versets » n'ouvre pas l'onglet Versets");
  } else t.defaut("pas de bouton « S'entraîner aux versets » en fin de lecture de la leçon 1");
});

test("3 · Réponses et réglages", "versets : texte complet, premières lettres, caché", async (t) => {
  const page = await t.page();
  await aller(page, "/lecon/1/versets");
  const carte = page.locator(".verset-carte").first();
  const complet = (await carte.locator(".verset-carte__texte").textContent()).trim();
  for (const mode of ["lettres", "cache", "complet"]) {
    await toucher(page, carte.locator(`[data-mode="${mode}"]`));
    await repos(page);
    t.verifier((await carte.locator(`[data-mode="${mode}"]`).getAttribute("aria-pressed")) === "true", `le mode « ${mode} » n'est pas marqué comme choisi`);
    const texte = (await carte.locator(".verset-carte__texte").textContent()).trim();
    if (mode === "complet") t.verifier(texte === complet, "revenir à « Texte complet » ne rend pas le verset entier");
    else if (mode === "lettres") t.verifier(texte !== complet && texte.length > 5, "« Premières lettres » montre encore le verset entier");
    else {
      const cache = await carte.locator(".verset-carte__texte").evaluate((e) => ({ couleur: getComputedStyle(e).color, muet: e.getAttribute("aria-hidden") }));
      t.verifier(/, 0\)$/.test(cache.couleur) || cache.couleur === "transparent", `« Caché » laisse le verset lisible (couleur ${cache.couleur})`);
      t.verifier(cache.muet === "true", "« Caché » laisse le verset lisible par un lecteur d'écran");
    }
  }
  await controlerSante(t, page, "après les trois modes");
});

test("3 · Réponses et réglages", "taille du texte et apparence, gardées après rechargement", async (t) => {
  const page = await t.page({ mouvement: false, sombre: true });
  await aller(page, "/plus");
  const echelle = () => page.evaluate(() => parseFloat(document.documentElement.style.getPropertyValue("--echelle")) || 1);
  for (let i = 0; i < 4; i++) if (await page.locator('#principal [data-reglage="plus"]').isEnabled()) await toucher(page, '#principal [data-reglage="plus"]');
  t.verifier((await echelle()) === 1.3, `au maximum, la taille du texte vaut ${await echelle()} au lieu de 1,3`);
  t.verifier(!(await page.locator('#principal [data-reglage="plus"]').isEnabled()), "au maximum, le bouton A+ reste actif");
  const r = await inspecter(page);
  for (const m of [...r.debordements, ...r.tronques]) t.defaut(`Plus, texte au maximum : ${m}`);
  for (let i = 0; i < 5; i++) if (await page.locator('#principal [data-reglage="moins"]').isEnabled()) await toucher(page, '#principal [data-reglage="moins"]');
  t.verifier((await echelle()) === 0.9, `au minimum, la taille du texte vaut ${await echelle()} au lieu de 0,9`);
  await recharger(page);
  await repos(page);
  t.verifier((await echelle()) === 0.9, "la taille du texte est oubliée après rechargement");

  const apparence = () => page.evaluate(() => document.documentElement.dataset.apparence || "clair");
  await toucher(page, '#principal [data-apparence="sombre"]');
  t.verifier((await apparence()) === "sombre", "« Sombre » ne passe pas l'application en sombre");
  await toucher(page, '#principal [data-apparence="systeme"]');
  t.verifier((await apparence()) === "sombre", "« Système » ne suit pas le téléphone réglé en sombre");
  await page.emulateMedia({ colorScheme: "light" });
  await pause(200);
  t.verifier((await apparence()) === "clair", "« Système » ne suit pas le téléphone quand il repasse en clair");
  await toucher(page, '#principal [data-apparence="clair"]');
  await page.emulateMedia({ colorScheme: "dark" });
  await recharger(page);
  await repos(page);
  t.verifier((await apparence()) === "clair", "le choix « Clair » est oublié après rechargement sur un téléphone en sombre");
  t.verifier((await page.locator('#principal [data-apparence][aria-pressed="true"]').count()) === 1, "il n'y a pas exactement une apparence marquée comme choisie");
});

// Défaut trouvé par l'agent de test le 26 novembre 2026 : le texte agrandi allongeait la page,
// et l'on se retrouvait trois paragraphes plus haut.
test("3 · Réponses et réglages", "changer la taille du texte en lisant : le passage lu reste en place", async (t) => {
  for (const lecon of [4, 7]) {
    const page = await t.page();
    await aller(page, "/");
    await aller(page, `/lecon/${lecon}`);
    await page.evaluate(() => window.scrollTo(0, 2500));
    await pause(600);
    // Le passage qu'on lit : le premier paragraphe sous la barre du haut. On suit ensuite ce
    // paragraphe-là (la barre change de hauteur quand ses onglets reviennent : la mesurer
    // fausserait le relevé).
    const repere = await page.evaluate(() => {
      const barre = document.getElementById("barre").getBoundingClientRect().bottom;
      const bloc = [...document.querySelectorAll("#panneau-lecture [data-bloc]")].find((b) => b.getBoundingClientRect().bottom > barre + 8);
      return { adresse: bloc.dataset.bloc, debut: bloc.textContent.trim().slice(0, 30) };
    });
    const place = () =>
      page.evaluate((adresse) => {
        const bloc = [...document.querySelectorAll("#panneau-lecture [data-bloc]")].find((b) => b.dataset.bloc === adresse);
        const r = bloc.getBoundingClientRect();
        return { haut: Math.round(r.top), bas: Math.round(r.bottom), ecran: window.innerHeight };
      }, repere.adresse);
    const avant = await place();
    await toucher(page, "#ouvrir-reglages");
    await repos(page);
    for (const sens of ["plus", "plus", "moins", "moins", "moins"]) {
      await page.locator(`.feuille--ouverte [data-reglage="${sens}"]`).tap();
      await pause(200);
      const pendant = await place();
      t.verifier(Math.abs(pendant.haut - avant.haut) <= 3, `leçon ${lecon}, après « ${sens === "plus" ? "A+" : "A−"} » : le passage lu (« ${repere.debut}… ») a bougé de ${pendant.haut - avant.haut} px`);
    }
    await page.keyboard.press("Escape");
    await controlerSante(t, page, `leçon ${lecon}, fenêtre Affichage refermée`);
    const apres = await place();
    t.verifier(Math.abs(apres.haut - avant.haut) <= 3, `leçon ${lecon} : à la fermeture de la fenêtre, le passage lu a bougé de ${apres.haut - avant.haut} px`);
    // La place gardée pour la reprise suit : on quitte, on revient, le passage est à l'écran.
    await retour(page);
    await repos(page);
    await toucher(page, `a.ligne-lecon[href="#/lecon/${lecon}"]`);
    await controlerSante(t, page, `leçon ${lecon} rouverte`);
    const reprise = await place();
    t.verifier(reprise.bas > 0 && reprise.haut < reprise.ecran, `leçon ${lecon} : à la reprise, le passage lu n'est pas à l'écran (haut à ${reprise.haut} px pour un écran de ${reprise.ecran} px)`);
  }
});

test("3 · Réponses et réglages", "changer la taille du texte dans Plus : le bouton reste sous le doigt", async (t) => {
  const page = await t.page({ hauteur: 600 });
  await aller(page, "/plus");
  const position = () => page.locator('#principal [data-reglage="plus"]').evaluate((b) => Math.round(b.getBoundingClientRect().top));
  const avant = await position();
  for (let i = 0; i < 2; i++) {
    await toucher(page, '#principal [data-reglage="plus"]');
    await pause(200);
    t.verifier(Math.abs((await position()) - avant) <= 3, `après A+, le bouton a bougé de ${(await position()) - avant} px sous le doigt`);
  }
  await controlerSante(t, page, "taille changée dans Plus");
});

test("3 · Réponses et réglages", "effacer toutes mes réponses : annuler, puis confirmer", async (t) => {
  const page = await t.page({ mouvement: false, etat: { ...ETAT_REMPLI, apparence: "sombre", taillePolice: 1 } });
  await aller(page, "/plus");
  await toucher(page, '[data-effacer="demander"]');
  t.verifier((await page.locator('[data-effacer="confirmer"]').count()) === 1, "« Effacer » ne demande pas de confirmation");
  t.verifier(Object.keys((await etatEnregistre(page)).reponses).length > 0, "les réponses sont effacées avant la confirmation");
  await toucher(page, '[data-effacer="annuler"]');
  t.verifier((await page.locator('[data-effacer="demander"]').count()) === 1 && Object.keys((await etatEnregistre(page)).reponses).length > 0, "« Annuler » n'annule pas l'effacement");
  await toucher(page, '[data-effacer="demander"]');
  await toucher(page, '[data-effacer="confirmer"]');
  await repos(page);
  const etat = await etatEnregistre(page);
  const reste = etat && etat !== "illisible" ? ["reponses", "recitations", "terminees", "notes"].filter((c) => etat[c] && Object.keys(etat[c]).length) : [];
  t.verifier(reste.length === 0, `après confirmation, il reste des données : ${reste.join(", ")}`);
  t.note(`après effacement, réglages gardés : apparence « ${etat && etat.apparence} », taille ${etat && etat.taillePolice}`);
  await aller(page, "/");
  t.verifier((await page.locator(".ligne-lecon__etat").count()) === 0, "après effacement, l'accueil montre encore des leçons commencées ou terminées");
});

test("3 · Réponses et réglages", "deux copies ouvertes : aucune n'efface le travail de l'autre", async (t) => {
  const a = await t.page({ mouvement: false });
  await aller(a, "/lecon/1/questions");
  const b = await a.context().newPage();
  b.__base = BASE;
  t.suivre(b);
  await aller(b, "/lecon/1/questions");
  await a.locator("#question-1-2").fill("Écrit dans la copie A");
  await pause(1400);
  await b.locator("#question-1-3").fill("Écrit dans la copie B");
  await pause(1400);
  await a.locator("#question-1-4").fill("Encore dans la copie A");
  await pause(1400);
  const reponses = (await etatEnregistre(a)).reponses[1] || {};
  t.verifier(reponses[2] === "Écrit dans la copie A" && reponses[3] === "Écrit dans la copie B" && reponses[4] === "Encore dans la copie A", `une copie a effacé le travail de l'autre : ${JSON.stringify(reponses)}`);
});

// ---------------------------------------------------------------------------
// Famille 4 — notes
// ---------------------------------------------------------------------------

// Sélectionne « mot » dans le premier paragraphe de la lecture qui le contient, comme au doigt.
async function selectionner(page, mot, { rang = 0 } = {}) {
  const trouve = await page.evaluate(
    ([mot, rang]) => {
      const blocs = [...document.querySelectorAll("#panneau-lecture [data-bloc]")];
      let vu = 0;
      for (const bloc of blocs) {
        const marcheur = document.createTreeWalker(bloc, NodeFilter.SHOW_TEXT);
        for (let noeud = marcheur.nextNode(); noeud; noeud = marcheur.nextNode()) {
          const i = noeud.data.indexOf(mot);
          if (i < 0 || noeud.parentElement.closest(".hors-texte, .visuellement-cache")) continue;
          if (vu++ < rang) continue;
          bloc.scrollIntoView({ block: "center" });
          const plage = document.createRange();
          plage.setStart(noeud, i);
          plage.setEnd(noeud, i + mot.length);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(plage);
          return bloc.dataset.bloc;
        }
      }
      return null;
    },
    [mot, rang]
  );
  if (!trouve) return null;
  await page.waitForFunction(() => !document.querySelector(".barre-notes").hidden, null, { timeout: 2500 }).catch(() => {});
  return trouve;
}

async function noter(page, mot, type, options) {
  const bloc = await selectionner(page, mot, options);
  if (!bloc) return { erreur: `passage « ${mot} » introuvable dans la leçon` };
  if (await page.evaluate(() => document.querySelector(".barre-notes").hidden)) return { erreur: `la barre des types de note n'apparaît pas après la sélection de « ${mot} »` };
  await page.locator(`.barre-notes [data-etiquette="${type}"]`).tap();
  await pause(250);
  return { bloc };
}

// Touche un passage coloré au milieu de son texte. Playwright viserait son premier enfant, le
// libellé réservé aux lecteurs d'écran, qui n'est pas à l'écran.
async function toucherPassage(page, rang = 0) {
  const point = await page.evaluate((rang) => {
    const marque = document.querySelectorAll("mark.note-passage")[rang];
    marque.scrollIntoView({ block: "center" });
    const b = marque.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, rang);
  await pause(250);
  await page.touchscreen.tap(point.x, point.y);
}

const notesEnregistrees = async (page) => Object.entries(((await etatEnregistre(page)) || {}).notes || {}).map(([id, n]) => ({ id, ...n }));
const fermerNoteOuverte = async (page) => {
  await page.locator(".feuille--note .feuille__ok").tap();
  await page.waitForFunction(() => document.querySelector(".feuille--note").hidden, null, { timeout: 3000 }).catch(() => {});
  await repos(page);
};

test("4 · Notes", "noter un passage sans écrire, puis annuler", async (t) => {
  const page = await t.page();
  await aller(page, "/lecon/1");
  const r = await noter(page, "geôlier", "comprends");
  if (!t.verifier(!r.erreur, r.erreur)) return;
  let notes = await notesEnregistrees(page);
  t.verifier(notes.length === 1 && notes[0].texte === "geôlier" && notes[0].etiquette === "comprends", `la note n'est pas enregistrée comme prévu : ${JSON.stringify(notes)}`);
  t.verifier((await page.locator("mark.note-passage").count()) === 1, "le passage noté n'est pas coloré");
  t.verifier(await page.evaluate(() => document.querySelector(".annonce").classList.contains("annonce--visible")), "le message « Noté » n'apparaît pas");
  t.verifier(await page.evaluate(() => window.getSelection().isCollapsed), "la sélection reste après avoir noté");
  const inspection = await inspecter(page);
  await page.locator(".annonce__bouton").tap();
  await pause(400);
  notes = await notesEnregistrees(page);
  t.verifier((await page.locator("mark.note-passage").count()) === 0, "« Annuler » ne retire pas la couleur du passage");
  t.note(`après « Annuler », l'enregistrement garde ${notes.length} note(s) : ${JSON.stringify(notes.map((n) => Object.keys(n).filter((c) => !["lecon", "bloc", "debut", "fin", "texte", "etiquette", "ecrit", "cree", "id"].includes(c))))}`);
  for (const m of inspection.debordements) t.defaut(`avec le message « Noté » : ${m}`);
  await controlerSante(t, page, "après noter puis annuler");
});

test("4 · Notes", "noter et écrire, rouvrir, changer de type, retirer puis récupérer", async (t) => {
  const page = await t.page();
  await aller(page, "/lecon/1");
  const r = await noter(page, "geôlier", "question");
  if (!t.verifier(!r.erreur, r.erreur)) return;
  const ouverte = await page.waitForFunction(() => document.querySelector(".feuille--note").classList.contains("feuille--ouverte"), null, { timeout: 3000 }).then(() => true, () => false);
  if (!t.verifier(ouverte, "la fenêtre de la note ne s'ouvre pas pour écrire")) return;
  await repos(page);
  t.verifier(await page.evaluate(() => document.activeElement && document.activeElement.id === "note-ecrit"), "à l'ouverture, le curseur n'est pas dans la zone d'écriture");
  t.verifier((await page.locator(".feuille--note .note-fenetre__passage").textContent()).includes("geôlier"), "la fenêtre ne rappelle pas le passage noté");
  t.verifier(await page.evaluate(() => document.querySelector(".note-fenetre__voir").hidden), "dans la leçon, la fenêtre propose « Voir dans la leçon »");
  const inspection = await inspecter(page);
  for (const m of [...inspection.cibles, ...inspection.soulignes, ...inspection.roses, ...inspection.debordements, ...inspection.poignees, ...inspection.polices]) t.defaut(`fenêtre d'une note : ${m}`);
  const texte = "Pourquoi était-il troublé ?\nDeuxième ligne.";
  await page.locator("#note-ecrit").fill(texte);
  await fermerNoteOuverte(page);
  let notes = await notesEnregistrees(page);
  t.verifier(notes.length === 1 && notes[0].ecrit === texte, `ce qui est écrit n'est pas enregistré à la fermeture : ${JSON.stringify(notes.map((n) => n.ecrit))}`);
  await controlerSante(t, page, "note écrite et fermée");

  await recharger(page);
  await repos(page);
  if (!t.verifier((await page.locator("mark.note-passage").count()) === 1, "après rechargement, le passage n'est plus coloré")) return;
  await toucherPassage(page);
  const rouverte = await page.waitForFunction(() => document.querySelector(".feuille--note").classList.contains("feuille--ouverte"), null, { timeout: 3000 }).then(() => true, () => false);
  if (!t.verifier(rouverte, "toucher un passage coloré ne rouvre pas sa note")) return;
  await repos(page);
  t.verifier((await page.locator("#note-ecrit").inputValue()) === texte, "la note rouverte ne montre pas ce qui avait été écrit");

  await page.locator('.feuille--note [data-choix-etiquette="prier"]').tap();
  await pause(300);
  notes = await notesEnregistrees(page);
  t.verifier(notes[0].etiquette === "prier", "changer de type dans la fenêtre n'est pas enregistré");
  t.verifier((await page.locator("#note-titre").textContent()).trim() === "Pour prier", "le titre de la fenêtre ne suit pas le nouveau type");
  t.verifier((await page.locator('.feuille--note [aria-pressed="true"]').count()) === 1, "il n'y a pas exactement un type marqué comme choisi");

  // Retirer : confirmation, annulation, puis retrait.
  await page.locator('.feuille--note [data-retirer="demander"]').tap();
  t.verifier((await page.locator('.feuille--note [data-retirer="confirmer"]').count()) === 1, "« Retirer cette note » ne demande pas de confirmation");
  await page.locator('.feuille--note [data-retirer="annuler"]').tap();
  t.verifier((await page.locator('.feuille--note [data-retirer="demander"]').count()) === 1, "« Annuler » ne revient pas au bouton « Retirer cette note »");
  await page.locator('.feuille--note [data-retirer="demander"]').tap();
  await page.locator('.feuille--note [data-retirer="confirmer"]').tap();
  await page.waitForFunction(() => document.querySelector(".feuille--note").hidden, null, { timeout: 3000 }).catch(() => {});
  await controlerSante(t, page, "note retirée");
  t.verifier((await page.locator("mark.note-passage").count()) === 0, "la note retirée laisse le passage coloré");

  // Récemment supprimées : elle s'y trouve et se récupère.
  await aller(page, "/notes/supprimees");
  if (t.verifier((await page.locator("[data-recuperer-note]").count()) === 1, "la note retirée n'apparaît pas dans les notes récemment supprimées")) {
    const liste = await inspecter(page);
    for (const m of [...liste.cibles, ...liste.debordements]) t.defaut(`notes supprimées : ${m}`);
    await page.locator("[data-recuperer-note]").tap();
    await repos(page);
    await aller(page, "/lecon/1");
    t.verifier((await page.locator("mark.note-passage").count()) === 1, "la note récupérée ne recolore pas son passage");
    notes = await notesEnregistrees(page);
    t.verifier(notes.some((n) => n.ecrit === texte), "la note récupérée a perdu ce qui était écrit");
  }
});

// « Tout supprimer » dans « Récemment supprimées » (27 novembre 2026) : en deux temps ; « Annuler »
// ne touche à rien ; confirmer efface les notes supprimées, et elles seules.
test("4 · Notes", "« Tout supprimer » vide les notes récemment supprimées, et elles seules", async (t) => {
  const page = await t.page();
  await aller(page, "/lecon/1");
  for (const [mot, type] of [["geôlier", "comprends"], ["responsables", "encourage"], ["importante", "comprends"]]) {
    const r = await noter(page, mot, type);
    if (!t.verifier(!r.erreur, r.erreur)) return;
    await pause(300);
  }
  // Deux notes passent dans la corbeille, la troisième reste active.
  await page.evaluate(() => {
    const etat = JSON.parse(localStorage.getItem("cours-decouvertes"));
    const ids = Object.keys(etat.notes);
    etat.notes[ids[0]].retiree = Date.now() - 1000;
    etat.notes[ids[1]].retiree = Date.now() - 2000;
    localStorage.setItem("cours-decouvertes", JSON.stringify(etat));
  });
  await recharger(page);
  await repos(page);
  await aller(page, "/notes/supprimees");
  const compter = async () => {
    const notes = await notesEnregistrees(page);
    return { retirees: notes.filter((n) => n.retiree).length, actives: notes.filter((n) => !n.retiree).length };
  };
  // L'écran se construit après le rechargement : on attend ses cartes avant de mesurer.
  await page.waitForSelector("[data-recuperer-note]", { timeout: 3000 }).catch(() => {});
  // Témoin : avant tout effacement, le contrôle voit bien les deux notes supprimées.
  const avant = await compter();
  if (!t.verifier(avant.retirees === 2 && avant.actives === 1, `le contrôle ne voit pas l'état posé exprès (${JSON.stringify(avant)})`)) return;
  if (!t.verifier((await page.locator('[data-vider="demander"]').count()) === 1, `« Tout supprimer » n'apparaît pas sous les notes supprimées (écran : ${await page.evaluate(() => location.hash + " · " + document.querySelector("#principal").innerText.slice(0, 200).replace(/\s+/g, " "))})`)) return;
  await page.locator('[data-vider="demander"]').tap();
  t.verifier((await page.locator('[data-vider="confirmer"]').count()) === 1, "« Tout supprimer » ne demande pas de confirmation");
  t.verifier((await page.locator(".reglage__avertissement").textContent()).includes("ces 2 notes"), "la confirmation ne dit pas combien de notes seront supprimées");
  await page.locator('[data-vider="annuler"]').tap();
  t.verifier((await page.locator('[data-vider="demander"]').count()) === 1, "« Annuler » ne revient pas au bouton « Tout supprimer »");
  t.verifier((await compter()).retirees === 2, "« Annuler » a supprimé des notes");
  await page.locator('[data-vider="demander"]').tap();
  await page.locator('[data-vider="confirmer"]').tap();
  await repos(page);
  const apres = await compter();
  t.verifier(apres.retirees === 0, `${apres.retirees} note(s) supprimée(s) restent après « Oui, supprimer »`);
  t.verifier(apres.actives === 1, `« Tout supprimer » a aussi effacé des notes actives (${apres.actives} restante(s) sur 1)`);
  t.verifier((await page.locator("[data-recuperer-note]").count()) === 0, "la page montre encore des notes à récupérer");
  t.verifier((await page.locator('[data-vider="demander"]').count()) === 0, "« Tout supprimer » reste affiché sur une corbeille vide");
  await controlerSante(t, page, "corbeille vidée");
  await aller(page, "/notes");
  t.verifier((await page.locator('a[href="#/notes/supprimees"]').count()) === 0, "l'onglet Notes propose encore « Récemment supprimées » une fois la corbeille vide");
});

// Les trois actions qui effacent en deux temps (« Effacer toutes mes réponses », « Retirer cette
// note », « Tout supprimer ») : la question posée, le focus passe à « Annuler » ; « Annuler »
// le rend au bouton du début. Sans cela, le clavier et le lecteur d'écran repartent du haut de
// la page. Ajouté le 27 novembre 2026 avant de réunir leur code (nettoyage) ; témoin : une copie
// où l'une d'elles ne déplace plus le focus doit être repérée.
test("4 · Notes", "confirmations en deux temps : le focus va à « Annuler », puis revient", async (t) => {
  const page = await t.page();
  const focusSur = (selecteur) => page.evaluate((s) => Boolean(document.activeElement && document.activeElement.matches(s)), selecteur);
  const essayer = async (nom, attribut, avant) => {
    if (avant) await avant();
    const demander = `[data-${attribut}="demander"]`;
    if (!t.verifier((await page.locator(demander).count()) === 1, `${nom} : bouton introuvable`)) return;
    await page.locator(demander).tap();
    t.verifier(await focusSur(`[data-${attribut}="annuler"]`), `${nom} : la question posée, le focus n'est pas sur « Annuler »`);
    await page.locator(`[data-${attribut}="annuler"]`).tap();
    t.verifier(await focusSur(demander), `${nom} : après « Annuler », le focus n'est pas revenu sur le bouton`);
  };
  await aller(page, "/plus");
  await essayer("« Effacer toutes mes réponses »", "effacer");
  await aller(page, "/lecon/1");
  const r = await noter(page, "geôlier", "question");
  if (!t.verifier(!r.erreur, r.erreur)) return;
  await page.waitForFunction(() => document.querySelector(".feuille--note").classList.contains("feuille--ouverte"), null, { timeout: 3000 }).catch(() => {});
  await repos(page);
  await essayer("« Retirer cette note »", "retirer");
  await fermerNoteOuverte(page);
  await page.evaluate(() => {
    const etat = JSON.parse(localStorage.getItem("cours-decouvertes"));
    for (const id of Object.keys(etat.notes)) etat.notes[id].retiree = Date.now() - 1000;
    localStorage.setItem("cours-decouvertes", JSON.stringify(etat));
  });
  await recharger(page);
  await repos(page);
  await aller(page, "/notes/supprimees");
  await page.waitForSelector('[data-vider="demander"]', { timeout: 3000 }).catch(() => {});
  await essayer("« Tout supprimer »", "vider");
  await controlerSante(t, page, "confirmations annulées");
});

test("4 · Notes", "les cinq types, puis l'onglet Notes et « Voir dans la leçon »", async (t) => {
  const page = await t.page();
  await aller(page, "/lecon/1");
  const passages = [["geôlier", "comprends"], ["responsables", "question"], ["importante", "vivre"], ["jugement", "prier"], ["délivré", "encourage"]];
  for (const [mot, type] of passages) {
    const r = await noter(page, mot, type);
    if (!t.verifier(!r.erreur, r.erreur)) continue;
    if (await page.evaluate(() => document.querySelector(".feuille--note").classList.contains("feuille--ouverte"))) {
      await repos(page);
      await page.locator("#note-ecrit").fill(`Écrit pour ${mot}`);
      await fermerNoteOuverte(page);
    } else await pause(300);
  }
  const notes = await notesEnregistrees(page);
  t.verifier(notes.length === passages.length, `${notes.length} note(s) enregistrée(s) pour ${passages.length} passages notés`);
  t.verifier((await page.locator("mark.note-passage").count()) === passages.length, `${await page.locator("mark.note-passage").count()} passage(s) coloré(s) pour ${passages.length} notes`);
  await controlerSante(t, page, "cinq notes posées");

  // Un passage déjà noté : la sélection rouvre la note, elle n'en crée pas une deuxième.
  await selectionner(page, "geôlier");
  await pause(600);
  t.verifier((await notesEnregistrees(page)).length === passages.length, "resélectionner un passage déjà noté crée une deuxième note");
  if (await page.evaluate(() => document.querySelector(".feuille--note").classList.contains("feuille--ouverte"))) await fermerNoteOuverte(page);

  await aller(page, "/notes");
  t.verifier((await page.locator('a.ligne-lecon[href="#/notes/1"]').count()) === 1, "l'onglet Notes ne liste pas la leçon 1");
  let r = await inspecter(page);
  for (const m of [...r.cibles, ...r.debordements, ...r.soulignes, ...r.roses]) t.defaut(`onglet Notes : ${m}`);
  await toucher(page, 'a.ligne-lecon[href="#/notes/1"]');
  await controlerSante(t, page, "notes de la leçon 1");
  t.verifier((await page.locator("a.ligne-lecon--dossier").count()) === 5, `${await page.locator("a.ligne-lecon--dossier").count()} dossier(s) affiché(s) pour cinq types de note`);
  await toucher(page, 'a.ligne-lecon--dossier[href="#/notes/1/question"]');
  await controlerSante(t, page, "dossier « Ma question »");
  if (!t.verifier((await page.locator(".ligne-note").count()) === 1, "le dossier « Ma question » ne montre pas sa note")) return;
  t.verifier((await page.locator(".ligne-note").textContent()).includes("Écrit pour responsables"), "la ligne de la note ne montre pas ce qui a été écrit");
  r = await inspecter(page);
  for (const m of [...r.cibles, ...r.debordements, ...r.soulignes, ...r.roses]) t.defaut(`dossier de notes : ${m}`);
  await toucher(page, ".ligne-note");
  const ouverte = await page.waitForFunction(() => document.querySelector(".feuille--note").classList.contains("feuille--ouverte"), null, { timeout: 3000 }).then(() => true, () => false);
  if (!t.verifier(ouverte, "toucher une note de la liste n'ouvre pas sa fenêtre")) return;
  await repos(page);
  t.verifier(await page.evaluate(() => !document.querySelector(".note-fenetre__voir").hidden), "depuis la liste, la fenêtre ne propose pas « Voir dans la leçon »");
  await page.locator(".note-fenetre__voir").tap();
  await controlerSante(t, page, "« Voir dans la leçon »");
  t.verifier((await page.evaluate(() => location.hash)).startsWith("#/lecon/1"), `« Voir dans la leçon » mène à ${await page.evaluate(() => location.hash)}`);
  const vue = await page.evaluate(() => {
    const marque = [...document.querySelectorAll("mark.note-passage")].find((m) => m.textContent.includes("responsables"));
    if (!marque) return null;
    const b = marque.getBoundingClientRect();
    return { haut: b.top, bas: b.bottom, ecran: window.innerHeight };
  });
  t.verifier(vue && vue.haut >= 0 && vue.bas <= vue.ecran, `le passage de la note n'est pas visible à l'écran après « Voir dans la leçon » (${JSON.stringify(vue)})`);
  // Le retour ramène à la liste des notes, pas ailleurs.
  await retour(page);
  await controlerSante(t, page, "retour après « Voir dans la leçon »");
  t.verifier((await page.evaluate(() => location.hash)).startsWith("#/notes"), `après « Voir dans la leçon », le retour mène à ${await page.evaluate(() => location.hash)} au lieu des notes`);
});

test("4 · Notes", "ponctuation : passages avec « ? » et guillemets, notes d'avant les espaces insécables", async (t) => {
  const page = await t.page({ mouvement: false });
  await aller(page, "/lecon/1");
  // Où se trouve, dans la leçon affichée, un passage qui enjambe une espace insécable ?
  const cible = await page.evaluate(() => {
    for (const bloc of document.querySelectorAll("#panneau-lecture [data-bloc]")) {
      const texte = [...(function* (b) { const m = document.createTreeWalker(b, NodeFilter.SHOW_TEXT); for (let n = m.nextNode(); n; n = m.nextNode()) yield n.data; })(bloc)].join("");
      const i = texte.search(/\p{L}{3,} [?!:;]/u);
      if (i >= 0) {
        const fin = texte.indexOf(" ", i) + 2;
        return { bloc: bloc.dataset.bloc, debut: i, fin, texte: texte.slice(i, fin) };
      }
    }
    return null;
  });
  if (!t.verifier(cible, "aucune espace insécable avant « ? ! : ; » dans la lecture de la leçon 1 : la typographie n'est pas appliquée")) return;
  // Une note enregistrée avant le changement : même passage, mais avec une espace ordinaire.
  const ancienne = { lecon: 1, bloc: cible.bloc, debut: cible.debut, fin: cible.fin, texte: cible.texte.replace(/ /g, " "), etiquette: "question", ecrit: "note d'avant", cree: Date.now() };
  await page.evaluate(([cle, note]) => localStorage.setItem(cle, JSON.stringify({ notes: { nancienne: note } })), [CLE, ancienne]);
  await recharger(page);
  await repos(page);
  const marque = await page.locator("mark.note-passage").count();
  t.verifier(marque === 1, `une note posée avant les espaces insécables (« ${ancienne.texte} ») ne retrouve plus son passage`);
  // Une note posée aujourd'hui sur un passage avec espace insécable, puis rechargement.
  await page.evaluate((cle) => localStorage.setItem(cle, "{}"), CLE);
  await recharger(page);
  await repos(page);
  const r = await noter(page, cible.texte, "comprends");
  if (!t.verifier(!r.erreur, r.erreur)) return;
  await recharger(page);
  await repos(page);
  t.verifier((await page.locator("mark.note-passage").count()) === 1, `une note posée sur « ${cible.texte.replace(/ /g, "␣")} » ne retrouve pas son passage après rechargement`);
  await aller(page, "/notes/1/comprends");
  t.verifier((await page.locator(".ligne-note").count()) === 1, "la note avec espace insécable n'apparaît pas dans l'onglet Notes");
});

const ENREGISTREMENTS_ABIMES = [
  ["texte qui n'est pas du JSON", "{"],
  ["null", "null"],
  ["un tableau", "[]"],
  ["un simple texte", '"bonjour"'],
  ["un nombre", "42"],
  ["rubriques à null", '{"reponses":null,"recitations":null,"terminees":null,"notes":null,"lectures":null}'],
  ["rubriques en tableaux", '{"reponses":[],"recitations":[],"terminees":[],"notes":[],"lectures":[]}'],
  ["rubriques en textes", '{"reponses":"x","recitations":"x","terminees":"x","notes":"x","lectures":"x","taillePolice":"grand","apparence":"fluo"}'],
  ["réponses mal formées", '{"reponses":{"1":"texte","2":null,"3":{"1":5,"2":null,"3":{"a":1}}}}'],
  ["notes mal formées", '{"notes":{"a":null,"b":"texte","c":{},"d":{"lecon":"un","bloc":5,"debut":"x","fin":-3,"texte":null,"etiquette":"inconnue"},"e":{"lecon":1,"bloc":"\\"]<b>","debut":99999,"fin":2,"texte":"zzz","etiquette":"question","ecrit":{"x":1}}}}'],
  ["taille et lecture hors bornes", '{"taillePolice":99,"lectures":{"1/lecture":"abc","x":null},"apparence":null}'],
];

for (const [nom, brut] of ENREGISTREMENTS_ABIMES)
  test("4 · Notes", `enregistrement abîmé : ${nom}`, async (t) => {
    const page = await t.page({ mouvement: false, etat: brut });
    for (const ecran of ["/", "/lecon/1", "/lecon/1/versets", "/lecon/1/questions", "/notes", "/notes/1", "/notes/supprimees", "/plus"]) {
      await aller(page, ecran).catch((e) => t.defaut(`${ecran} : l'écran ne s'affiche pas (${e.message.split("\n")[0]})`));
      const vide = await page.evaluate(() => !document.getElementById("principal") || !document.getElementById("principal").textContent.trim());
      t.verifier(!vide, `${ecran} : écran vide`);
    }
    // L'application reste utilisable : répondre, cocher, noter.
    await aller(page, "/lecon/1/questions");
    if (await page.locator("#question-1-2").count()) {
      await page.locator("#question-1-2").fill("Réponse après un enregistrement abîmé");
      await pause(1400);
      const etat = await etatEnregistre(page);
      t.verifier(etat && etat !== "illisible" && etat.reponses && etat.reponses[1] && etat.reponses[1][2] === "Réponse après un enregistrement abîmé", "impossible d'enregistrer une réponse après un enregistrement abîmé");
    } else t.defaut("les questions de la leçon 1 ne s'affichent pas");
    await aller(page, "/lecon/1");
    const r = await noter(page, "geôlier", "comprends");
    if (t.verifier(!r.erreur, `impossible de noter : ${r.erreur}`)) t.verifier((await page.locator("mark.note-passage").count()) >= 1, "la note posée après un enregistrement abîmé ne colore pas son passage");
  });

// ---------------------------------------------------------------------------
// Famille 5 — accessibilité (au-delà de ce que le parcours relève déjà)
// ---------------------------------------------------------------------------

test("5 · Accessibilité", "page : langue, zoom permis, lien d'évitement, titres d'onglet", async (t) => {
  const page = await t.page({ mouvement: false });
  await aller(page, "/");
  const m = await page.evaluate(() => ({
    langue: document.documentElement.lang,
    zoom: (document.querySelector('meta[name="viewport"]') || { content: "" }).content,
    saut: Boolean(document.querySelector(".saut")),
    nav: document.getElementById("navigation").getAttribute("aria-label"),
  }));
  t.verifier(m.langue === "fr", `la langue de la page est « ${m.langue} » au lieu de « fr »`);
  t.verifier(!/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/.test(m.zoom), `le zoom au doigt est bloqué (${m.zoom})`);
  t.verifier(m.saut, "pas de lien « Aller au contenu »");
  t.verifier(m.nav, "la barre du bas n'a pas de nom pour les lecteurs d'écran");
  const titres = new Set();
  for (const ecran of ["/", "/lecon/1", "/notes", "/eglise", "/plus", "/a-propos"]) {
    await aller(page, ecran);
    titres.add(await page.title());
  }
  t.verifier(titres.size >= 5, `le titre de l'onglet du navigateur ne change presque pas d'un écran à l'autre (${[...titres].join(" | ")})`);
});

test("5 · Accessibilité", "au clavier : onglets d'une leçon aux flèches, barre du bas, focus visible", async (t) => {
  const page = await t.page({ mouvement: false, tactile: false, installee: true, largeur: 500, hauteur: 800 });
  await page.addInitScript(() => localStorage.setItem("cours-decouvertes-ecran-ordinateur", "accepte"));
  await aller(page, "/lecon/1");
  await page.locator("#onglet-lecture").focus();
  await page.keyboard.press("ArrowRight");
  await repos(page);
  t.verifier(await page.evaluate(() => document.activeElement.id === "onglet-versets" && !document.getElementById("panneau-versets").hidden), "flèche droite : l'onglet Versets n'est pas choisi et affiché");
  await page.keyboard.press("End");
  await repos(page);
  t.verifier(await page.evaluate(() => document.activeElement.id === "onglet-questions"), "touche Fin : le dernier onglet n'est pas choisi");
  await page.keyboard.press("ArrowRight");
  await repos(page);
  t.verifier(await page.evaluate(() => document.activeElement.id === "onglet-lecture"), "flèche droite sur le dernier onglet : on ne revient pas au premier");
  t.verifier(await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].filter((o) => o.tabIndex === 0).length === 1), "plusieurs onglets de la leçon sont dans l'ordre de tabulation");
  // Un contour de focus visible sur les éléments atteints au clavier.
  await aller(page, "/plus");
  const sansContour = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    const e = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return null;
      const s = getComputedStyle(a);
      const contour = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none";
      return contour ? null : `${a.tagName.toLowerCase()}.${a.className} « ${a.textContent.trim().slice(0, 24)} »`;
    });
    if (e && !sansContour.includes(e)) sansContour.push(e);
  }
  t.verifier(sansContour.length === 0, `au clavier, pas de contour de focus visible sur : ${sansContour.join(" ; ")}`);
});

test("5 · Accessibilité", "références bibliques : nom lisible, fenêtre nommée, images décrites", async (t) => {
  const page = await t.page({ mouvement: false });
  await aller(page, "/lecon/1");
  const refs = await page.evaluate(() => [...document.querySelectorAll("#panneau-lecture .ref")].filter((r) => !r.getAttribute("aria-label") && !r.textContent.trim()).length);
  t.verifier(refs === 0, `${refs} référence(s) biblique(s) sans nom accessible`);
  await toucher(page, "#panneau-lecture .ref");
  await repos(page);
  const fenetre = await page.evaluate(() => {
    const d = document.querySelector('.feuille--ouverte [role="dialog"]');
    if (!d) return null;
    const titre = document.getElementById(d.getAttribute("aria-labelledby"));
    return { titre: titre ? titre.textContent.trim() : "", texte: d.textContent.trim().length };
  });
  t.verifier(fenetre && fenetre.titre, "la fenêtre d'un verset n'a pas de titre lu par les lecteurs d'écran");
  t.verifier(fenetre && fenetre.texte > 30, "la fenêtre d'un verset est vide");
  await page.keyboard.press("Escape");
  await repos(page);
  const boutons = await page.evaluate(() => [...document.querySelectorAll("button, a[href]")].filter((b) => !b.closest("[hidden]") && !(b.textContent.trim() || b.getAttribute("aria-label") || b.querySelector("img[alt]:not([alt=''])"))).map((b) => b.outerHTML.slice(0, 90)));
  t.verifier(boutons.length === 0, `boutons ou liens sans nom : ${boutons.join(" | ")}`);
});

// ---------------------------------------------------------------------------
// Famille 6 — sécurité
// ---------------------------------------------------------------------------


test("6 · Sécurité", "du code collé dans une réponse ou une note ne s'exécute pas", async (t) => {
  t.erreursAttendues = /./;
  const page = await t.page({ mouvement: false });
  await aller(page, "/lecon/1/questions");
  const texte = CHARGES.join("\n");
  await page.locator("#question-1-2").fill(texte);
  await pause(1400);
  await recharger(page);
  await repos(page);
  t.verifier((await page.locator("#question-1-2").inputValue()) === texte, "une réponse contenant du code n'est pas rendue telle quelle");
  t.verifier(!(await piege(page)), "le code collé dans une réponse s'exécute ou crée des balises");
  await aller(page, "/lecon/1");
  const r = await noter(page, "geôlier", "question");
  if (t.verifier(!r.erreur, r.erreur)) {
    await repos(page);
    await page.locator("#note-ecrit").fill(texte);
    await fermerNoteOuverte(page);
    for (const ecran of ["/notes", "/notes/1", "/notes/1/question", "/lecon/1", "/"]) {
      await aller(page, ecran);
      t.verifier(!(await piege(page)), `le code écrit dans une note s'exécute ou crée des balises à l'écran ${ecran}`);
    }
    await aller(page, "/notes/1/question");
    t.verifier((await page.locator(".ligne-note").textContent()).includes("<img src=x"), "le texte d'une note contenant du code n'est pas affiché tel quel");
    // Retirée, elle passe par les notes supprimées.
    await toucher(page, ".ligne-note");
    await repos(page);
    await page.locator('.feuille--note [data-retirer="demander"]').tap();
    await page.locator('.feuille--note [data-retirer="confirmer"]').tap();
    await pause(800);
    await aller(page, "/notes/supprimees");
    t.verifier(!(await piege(page)), "le code d'une note retirée s'exécute dans les notes supprimées");
  }
});

test("6 · Sécurité", "un enregistrement trafiqué ne peut rien injecter", async (t) => {
  t.erreursAttendues = /./;
  const c = CHARGES[0];
  const etat = {
    reponses: { 1: { 2: c, [c]: c }, [c]: { 1: c } },
    recitations: { [c]: true },
    terminees: { [c]: true },
    apparence: `sombre" onload="window.__piege=1`,
    taillePolice: `1;background:url(javascript:window.__piege=1)`,
    lectures: { [c]: c, "1/lecture": c },
    notes: {
      [c]: { lecon: 1, bloc: c, debut: 0, fin: 5, texte: c, etiquette: c, ecrit: c, cree: c },
      n2: { lecon: c, bloc: "1", debut: 0, fin: 5, texte: c, etiquette: "question", ecrit: c, cree: 1 },
      n3: { lecon: 1, bloc: `x"] , body`, debut: 0, fin: 5, texte: c, etiquette: `question" onclick="window.__piege=1`, ecrit: c, retiree: c, supprimee: c },
    },
  };
  const page = await t.page({ mouvement: false, etat });
  for (const ecran of ["/", "/lecon/1", "/lecon/1/versets", "/lecon/1/questions", "/notes", "/notes/1", "/notes/1/question", "/notes/supprimees", "/plus", "/eglise"]) {
    await aller(page, ecran).catch(() => {});
    t.verifier(!(await piege(page)), `un enregistrement trafiqué injecte du code à l'écran ${ecran}`);
    const attributs = await page.evaluate(() => [...document.querySelectorAll("*")].filter((e) => [...e.attributes].some((a) => /^on/i.test(a.name))).map((e) => e.outerHTML.slice(0, 80)));
    t.verifier(attributs.length === 0, `un enregistrement trafiqué pose un attribut « on… » à l'écran ${ecran} : ${attributs[0]}`);
  }
});

test("6 · Sécurité", "une adresse trafiquée ne peut rien injecter", async (t) => {
  t.erreursAttendues = /./;
  const page = await t.page({ mouvement: false });
  await aller(page, "/");
  for (const chemin of ['/lecon/1"><img src=x onerror=window.__piege=1>', "/documents/<script>window.__piege=1</script>", "/notes/1/<img src=x onerror=window.__piege=1>", "/<svg onload=window.__piege=1>", "/lecon/1/../../<img src=x onerror=window.__piege=1>", "javascript:window.__piege=1"]) {
    await page.evaluate((c) => (location.hash = c), chemin);
    await pause(400);
    await repos(page, 2500);
    t.verifier(!(await piege(page)), `l'adresse « #${chemin.slice(0, 40)}… » injecte du code`);
  }
});

test("6 · Sécurité", "liens vers l'extérieur protégés, pas de cookie, stockage limité à l'application", async (t) => {
  const page = await t.page({ mouvement: false, etat: ETAT_REMPLI });
  const fautifs = [];
  for (const ecran of ["/eglise", "/a-propos", "/plus", ...DOCUMENTS.map((d) => `/documents/${d}`), "/lecon/10"]) {
    await aller(page, ecran);
    fautifs.push(
      ...(await page.evaluate(() =>
        [...document.querySelectorAll("a[href]")]
          .filter((a) => /^https?:/.test(a.getAttribute("href")) && a.origin !== location.origin)
          .filter((a) => a.target === "_blank" && !/noopener/.test(a.rel))
          .map((a) => a.href)
      ))
    );
    const http = await page.evaluate(() => [...document.querySelectorAll("a[href^='http:']")].map((a) => a.href));
    for (const lien of http) t.defaut(`lien non chiffré (http) à l'écran ${ecran} : ${lien}`);
  }
  t.verifier(fautifs.length === 0, `liens ouverts dans un nouvel onglet sans « noopener » : ${[...new Set(fautifs)].join(", ")}`);
  const stockage = await page.evaluate(() => ({ cookies: document.cookie, cles: Object.keys(localStorage) }));
  t.verifier(stockage.cookies === "", `l'application pose un cookie : ${stockage.cookies}`);
  const etrangeres = stockage.cles.filter((c) => !c.startsWith("cours-decouvertes"));
  t.verifier(etrangeres.length === 0, `clés de stockage inattendues : ${etrangeres.join(", ")}`);
  t.note(`clés de stockage utilisées : ${stockage.cles.join(", ")}`);
});

test("6 · Sécurité", "fichiers : pas d'envoi réseau, pas de code dangereux, copie hors connexion complète", async (t) => {
  const lire = (f) => fs.readFileSync(path.join(APP, f), "utf8");
  const sources = { "app.js": lire("app.js"), "index.html": lire("index.html"), "service-worker.js": lire("service-worker.js") };
  for (const [fichier, code] of Object.entries(sources)) {
    const sansCommentaires = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const [motif, nom] of [[/\bXMLHttpRequest\b/, "XMLHttpRequest"], [/\bsendBeacon\b/, "sendBeacon"], [/\bWebSocket\b/, "WebSocket"], [/\bEventSource\b/, "EventSource"], [/\beval\s*\(/, "eval("], [/\bnew Function\b/, "new Function"], [/document\.write\b/, "document.write"], [/method\s*:\s*["'](POST|PUT|PATCH|DELETE)/i, "requête d'envoi (POST…)"]])
      t.verifier(!motif.test(sansCommentaires), `${fichier} contient « ${nom} »`);
    if (fichier !== "service-worker.js") {
      const externes = [...sansCommentaires.matchAll(/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)/g)].map((m) => m[1]).filter((u) => !/ebtm\.fr|maps\.apple\.com|youtube\.com|podcasts\.apple\.com/.test(u));
      t.verifier(externes.length === 0, `${fichier} charge une ressource extérieure : ${externes.join(", ")}`);
    }
  }
  t.verifier(!/\son[a-z]+\s*=\s*["']/i.test(sources["index.html"]), "index.html contient un gestionnaire d'événement en ligne (onclick…)");
  const csp = /http-equiv=["']Content-Security-Policy["']/i.test(sources["index.html"]);
  t.note(csp ? "une politique de sécurité du contenu (CSP) est déclarée" : "pas de politique de sécurité du contenu (CSP) déclarée dans index.html : une protection de plus possible contre l'injection");
  const appels = [...sources["app.js"].replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/\bfetch\(([^)]*)\)/g)].map((m) => m[1].trim().slice(0, 60));
  t.note(`appels réseau du code : ${appels.length} « fetch » (${[...new Set(appels)].join(" ; ")})`);

  // La copie hors connexion : tout fichier listé existe, tout fichier servi est listé.
  const liste = [...sources["service-worker.js"].matchAll(/["']\.\/([^"']*)["']/g)].map((m) => m[1]).filter((f) => f && !f.endsWith("/"));
  for (const fichier of liste) t.verifier(fs.existsSync(path.join(APP, fichier)), `la copie hors connexion liste un fichier qui n'existe pas : ${fichier} (l'installation de la copie échouerait)`);
  const presents = [];
  (function parcourir(dossier) {
    for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
      if (entree.name.startsWith(".")) continue;
      const chemin = path.join(dossier, entree.name);
      if (entree.isDirectory()) parcourir(chemin);
      else presents.push(path.relative(APP, chemin));
    }
  })(APP);
  const dynamique = /contenu\/(lecons|documents|figures)\//;
  const horsListe = presents.filter((f) => !liste.includes(f) && !["service-worker.js", "contenu/SCHEMA.md"].includes(f) && !/^(polices|icones)\/LICENCE/.test(f) && !f.startsWith("essai/"));
  const aSignaler = horsListe.filter((f) => !dynamique.test(f) || !/index\.json|lecons|documents|figures/.test(sources["service-worker.js"]));
  t.note(`copie hors connexion : ${liste.length} fichiers listés, ${presents.length} fichiers dans app/`);
  if (aSignaler.length) t.note(`fichiers de app/ absents de la liste fixe de la copie hors connexion (à vérifier : ils peuvent être mis en cache autrement) : ${aSignaler.slice(0, 12).join(", ")}${aSignaler.length > 12 ? "…" : ""}`);
  const publier = fs.readFileSync(path.join(RACINE, "scripts/publier.sh"), "utf8");
  for (const interdit of ["source", "docs", "CLAUDE.md"]) t.verifier(publier.includes(interdit), `scripts/publier.sh ne mentionne plus « ${interdit} » parmi ce qu'il refuse de publier`);
});

// Doit rester le dernier test qui ouvre des pages : il juge toutes les requêtes relevées.
test("6 · Sécurité", "aucune donnée ne quitte le téléphone (toutes les requêtes de tous les tests)", async (t) => {
  const origines = [new URL(BASE).origin, new URL(BASE_HORS_LIGNE).origin];
  const dehors = requetes.filter((r) => !r.url.startsWith("data:") && !r.url.startsWith("blob:") && !origines.includes(new URL(r.url).origin));
  const piegees = dehors.filter((r) => /\/x$/.test(r.url));
  const vraies = dehors.filter((r) => !piegees.includes(r));
  t.verifier(vraies.length === 0, `requêtes vers l'extérieur : ${[...new Set(vraies.map((r) => `${r.methode} ${r.url} (${r.test})`))].slice(0, 6).join(" ; ")}`);
  const envois = requetes.filter((r) => !["GET", "HEAD"].includes(r.methode) || r.corps > 0);
  t.verifier(envois.length === 0, `requêtes qui envoient quelque chose : ${[...new Set(envois.map((r) => `${r.methode} ${r.url} (${r.test})`))].slice(0, 6).join(" ; ")}`);
  const fuites = requetes.filter((r) => /Dieu%20cr|copie%20A|troubl%C3%A9|Pourquoi/i.test(r.url));
  t.verifier(fuites.length === 0, `du texte saisi apparaît dans une adresse demandée : ${fuites.slice(0, 3).map((r) => r.url).join(" ; ")}`);
  t.note(`${requetes.length} requêtes relevées pendant tous les tests, toutes vers l'application elle-même sauf ${dehors.length}`);
});

// ---------------------------------------------------------------------------
// Famille 7 — hors connexion (comme en ligne : avec la copie du service worker)
// ---------------------------------------------------------------------------

test("7 · Hors connexion", "l'application installée s'ouvre et se parcourt sans réseau", async (t) => {
  const page = await t.page({ mouvement: false, base: BASE_HORS_LIGNE });
  await page.goto(`${BASE_HORS_LIGNE}#/`, { waitUntil: "load" }).catch((e) => (t.nonTeste = `adresse locale spéciale inaccessible (${e.message.split("\n")[0]})`));
  if (t.nonTeste) return;
  const actif = await page
    .evaluate(async () => {
      if (!("serviceWorker" in navigator)) return "absent";
      const pret = await Promise.race([navigator.serviceWorker.ready.then(() => "ok"), new Promise((r) => setTimeout(() => r("delai"), 10000))]);
      return pret;
    })
    .catch((e) => `erreur : ${e.message}`);
  if (actif !== "ok") {
    t.nonTeste = `la copie hors connexion ne s'installe pas dans ce navigateur de test (${actif})`;
    return;
  }
  // Laisse la copie se remplir, puis recharge pour que la page soit servie par elle.
  let fichiers = 0;
  for (let i = 0; i < 40; i++) {
    const n = await page.evaluate(async () => {
      let total = 0;
      for (const cle of await caches.keys()) total += (await (await caches.open(cle)).keys()).length;
      return total;
    });
    if (n > 0 && n === fichiers) break;
    fichiers = n;
    await pause(300);
  }
  t.note(`${fichiers} fichiers dans la copie hors connexion`);
  await recharger(page);
  await repos(page);
  const pilote = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  t.verifier(pilote, "après rechargement, la page n'est pas servie par la copie hors connexion");
  await page.context().setOffline(true);
  t.journal.length = 0;
  await recharger(page).catch((e) => t.defaut(`sans réseau, l'application ne se recharge pas (${e.message.split("\n")[0]})`));
  await repos(page);
  t.verifier((await page.locator('a.ligne-lecon[href^="#/lecon/"]').count()) === LECONS.length, "sans réseau, l'accueil ne montre pas les leçons");
  const manquants = [];
  for (const ecran of tousLesEcrans()) {
    await aller(page, ecran).catch(() => {});
    const m = await page.evaluate(() => ({
      erreur: Boolean(document.querySelector("#principal .message--erreur")),
      vide: !document.getElementById("principal").textContent.trim(),
      images: [...document.querySelectorAll("#principal img")].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute("src")),
    }));
    if (m.erreur || m.vide) manquants.push(ecran);
    for (const image of m.images) t.defaut(`sans réseau, image absente à l'écran ${ecran} : ${image}`);
  }
  t.verifier(manquants.length === 0, `sans réseau, écrans qui ne s'affichent pas : ${manquants.join(", ")}`);
  const polices = await page.evaluate(() => ({ bricolage: document.fonts.check('600 20px "Bricolage Grotesque"'), inter: document.fonts.check('400 16px "Inter Tight"') }));
  t.verifier(polices.bricolage && polices.inter, `sans réseau, police manquante (Bricolage : ${polices.bricolage}, Inter Tight : ${polices.inter})`);
  // Une référence biblique se lit sans réseau.
  await aller(page, "/lecon/1");
  await toucher(page, "#panneau-lecture .ref");
  await repos(page);
  t.verifier(await page.evaluate(() => (document.querySelector(".feuille--ouverte .feuille__corps") || { textContent: "" }).textContent.trim().length > 30), "sans réseau, le texte d'une référence biblique ne s'affiche pas");
  const echecs = t.journal.filter((m) => /requête échouée|réponse [45]/.test(m));
  t.journal.length = 0;
  for (const e of [...new Set(echecs)].slice(0, 8)) t.defaut(`sans réseau : ${e}`);
});

// ---------------------------------------------------------------------------
// Famille 8 — ce que les tests n'ont jamais rencontré (pistes de code mort)
// ---------------------------------------------------------------------------
// Pas des défauts : des pistes. Un style ou une fonction jamais rencontrés sont soit du code
// mort, soit du code que ces tests n'exercent pas (geste au doigt, installation, panne de
// stockage…). Chaque piste se vérifie à la main avant suppression.

test("8 · Code jamais rencontré", "styles et fonctions que les tests n'ont pas utilisés", async (t) => {
  if (SEULEMENT) {
    t.nonTeste = "ce relevé n'a de sens que sur un passage complet";
    return;
  }
  const jamais = [...selecteursTous].filter((s) => !selecteursVus.has(s)).sort();
  t.note(`${selecteursTous.size} sélecteurs dans la feuille de style, ${jamais.length} jamais rencontrés`);
  for (const s of jamais) t.note(`style jamais rencontré : \`${s}\``);
  const parNom = new Map();
  for (const [cle, n] of fonctionsVues) {
    const nom = cle.split("@")[0];
    if (!nom) continue;
    parNom.set(nom, (parNom.get(nom) || 0) + n);
  }
  const muettes = [...parNom].filter(([, n]) => n === 0).map(([nom]) => nom).sort();
  t.note(`${parNom.size} fonctions nommées dans app.js, ${muettes.length} jamais exécutées pendant les tests : ${muettes.join(", ")}`);
});

// ---------------------------------------------------------------------------
// Lancement et rapport
// ---------------------------------------------------------------------------

async function lancer() {
  const { chromium } = await chargerPlaywright();
  const serveur = await demarrerServeur();
  const port = serveur.address().port;
  BASE = `http://127.0.0.1:${port}/`;
  BASE_HORS_LIGNE = `http://essai.localhost:${port}/`;
  fs.rmSync(CAPTURES, { recursive: true, force: true });
  fs.mkdirSync(CAPTURES, { recursive: true });
  const resultats = [];
  const debut = Date.now();
  try {
    navigateur = await chromium.launch({ channel: "chrome", headless: !FENETRE });
    const choisis = tests.filter((x) => !SEULEMENT || `${x.famille} ${x.nom}`.toLowerCase().includes(SEULEMENT));
    for (const [i, { famille, nom, fonction }] of choisis.entries()) {
      const t = new Essai(famille, nom);
      const depart = Date.now();
      let panne = null;
      let minuterie = null;
      try {
        await Promise.race([fonction(t), new Promise((_, rejeter) => (minuterie = setTimeout(() => rejeter(new Error("le test dépasse 3 minutes")), 180000)))]);
      } catch (erreur) {
        panne = (erreur && erreur.message ? erreur.message : String(erreur)).split("\n").slice(0, 3).join(" ");
      } finally {
        clearTimeout(minuterie); // sinon la minuterie retient l'outil trois minutes après la fin
      }
      const journal = t.erreursAttendues ? t.journal.filter((m) => !t.erreursAttendues.test(m)) : t.journal;
      for (const m of [...new Set(journal)].slice(0, 10)) t.defaut(m);
      let capture = null;
      if ((t.defauts.length || panne) && t.pages.length) {
        capture = `${String(i + 1).padStart(2, "0")}-${nom.replace(/[^a-zA-Z0-9À-ÿ]+/g, "-").slice(0, 60)}.png`;
        await t.pages[t.pages.length - 1].screenshot({ path: path.join(CAPTURES, capture) }).catch(() => (capture = null));
      }
      await t.fermer();
      const etat = t.nonTeste ? "non testé" : panne ? "test en panne" : t.defauts.length ? "défaut" : "réussi";
      resultats.push({ famille, nom, etat, defauts: t.defauts, notes: t.notes, panne, capture, nonTeste: t.nonTeste, duree: Date.now() - depart });
      const marque = { réussi: "✓", défaut: "✗", "test en panne": "!", "non testé": "–" }[etat];
      console.log(`${marque} ${famille} — ${nom} (${((Date.now() - depart) / 1000).toFixed(1)} s)`);
      for (const d of t.defauts) console.log(`    · ${d}`);
      if (panne) console.log(`    ! ${panne}`);
      if (t.nonTeste) console.log(`    – ${t.nonTeste}`);
    }
  } finally {
    if (navigateur) await navigateur.close().catch(() => {});
    await new Promise((r) => serveur.close(r));
  }
  ecrireRapport(resultats, Date.now() - debut);
  const compte = (etat) => resultats.filter((r) => r.etat === etat).length;
  console.log(`\n${compte("réussi")} réussi(s), ${compte("défaut")} avec défaut(s), ${compte("test en panne")} en panne, ${compte("non testé")} non testé(s) — rapport : docs/tests/rapport.md`);
  process.exitCode = compte("défaut") || compte("test en panne") ? 1 : 0;
}

function ecrireRapport(resultats, duree) {
  const compte = (etat) => resultats.filter((r) => r.etat === etat).length;
  const date = new Date().toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
  const lignes = [
    "# Rapport de test de l'application",
    "",
    `Produit par \`node scripts/tester-application.mjs${SEULEMENT ? ` --seulement=${SEULEMENT}` : ""}\` le ${date} (${Math.round(duree / 1000)} s).`,
    "",
    `**${compte("réussi")} test(s) réussi(s), ${compte("défaut")} avec défaut(s), ${compte("test en panne")} en panne, ${compte("non testé")} non testé(s).**`,
    "",
    "Un « défaut » est ce que l'outil a constaté : chacun se vérifie à la main avant correction (un test peut se tromper).",
    "Non couvert par cet outil : le vrai Safari d'iPhone (gestes, zone de l'heure, application installée).",
    "",
  ];
  let famille = null;
  for (const r of resultats) {
    if (r.famille !== famille) {
      famille = r.famille;
      lignes.push(`## ${famille}`, "");
    }
    lignes.push(`### ${{ réussi: "Réussi", défaut: "DÉFAUT", "test en panne": "TEST EN PANNE", "non testé": "Non testé" }[r.etat]} — ${r.nom}`, "");
    for (const d of r.defauts) lignes.push(`- ${d}`);
    if (r.panne) lignes.push(`- Le test s'est arrêté : ${r.panne}`);
    if (r.nonTeste) lignes.push(`- ${r.nonTeste}`);
    for (const n of r.notes) lignes.push(`- _Note :_ ${n}`);
    if (r.capture) lignes.push("", `![capture](captures/${encodeURI(r.capture)})`);
    if (r.defauts.length || r.panne || r.nonTeste || r.notes.length || r.capture) lignes.push("");
  }
  fs.mkdirSync(SORTIE, { recursive: true });
  fs.writeFileSync(path.join(SORTIE, "rapport.md"), lignes.join("\n"));
}

lancer().catch((erreur) => {
  console.error(erreur);
  process.exit(2);
});
