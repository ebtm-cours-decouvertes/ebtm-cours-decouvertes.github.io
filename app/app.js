/*
 * Cours découvertes — application sans dépendance.
 *
 * Tout ce que le participant saisit (réponses, versets connus, leçons terminées) est
 * enregistré dans le navigateur de son téléphone (localStorage) et n'en sort jamais.
 * Ne jamais ajouter d'envoi réseau de ces données.
 */

(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // Enregistrement local
  // ---------------------------------------------------------------------------

  const CLE_STOCKAGE = "cours-decouvertes";
  const ETAT_PAR_DEFAUT = () => ({
    version: 1,
    reponses: {}, // { "1": { "2": "texte de la réponse" } }
    recitations: {}, // { "1": true } — le participant sait réciter les versets
    terminees: {}, // { "1": true }
    taillePolice: 0, // -1, 0, 1, 2
    apparence: "clair", // « clair », « sombre » ou « systeme »
    lectures: {}, // { "6/lecture": 12 } — le bloc qui était en haut de l'écran
    // Passages notés dans les leçons, rangés par identifiant (voir « Mes notes ») :
    // { "n…": { lecon, bloc, debut, fin, texte, etiquette, ecrit, cree } }
    notes: {},
  });

  // L'enregistrement tel que cette copie de l'application l'a lu ou écrit en dernier.
  let enregistrementConnu = lireEnregistrement();
  let etat = etatDepuis(enregistrementConnu);
  let stockageIndisponible = false;

  function lireEnregistrement() {
    try {
      return localStorage.getItem(CLE_STOCKAGE);
    } catch {
      return null;
    }
  }

  function etatDepuis(brut) {
    try {
      if (!brut) return ETAT_PAR_DEFAUT();
      return { ...ETAT_PAR_DEFAUT(), ...JSON.parse(brut) };
    } catch {
      return ETAT_PAR_DEFAUT();
    }
  }

  // Deux copies de l'application peuvent être ouvertes en même temps sur un téléphone, par
  // exemple un onglet du navigateur resté ouvert à côté de l'application installée. Chacune garde
  // l'état en mémoire : réécrire le sien en entier effacerait ce que l'autre a enregistré
  // entre-temps. On relit donc le stockage juste avant d'écrire, et on n'y reporte que ce que
  // cette copie a changé depuis sa dernière lecture ou écriture.
  function enregistrerEtat(toutRemplacer) {
    try {
      const actuel = localStorage.getItem(CLE_STOCKAGE);
      const aEcrire =
        toutRemplacer === true || actuel === enregistrementConnu
          ? etat
          : reporterChangements(etatDepuis(actuel), etatDepuis(enregistrementConnu), etat);
      const brut = JSON.stringify(aEcrire);
      localStorage.setItem(CLE_STOCKAGE, brut);
      etat = aEcrire;
      enregistrementConnu = brut;
      stockageIndisponible = false;
      return true;
    } catch {
      stockageIndisponible = true;
      return false;
    }
  }

  // Reporte sur « base » ce qui diffère entre « avant » et « apres », clé par clé et à chaque
  // niveau : une réponse modifiée ou vidée ici remplace celle de base, les autres restent.
  function reporterChangements(base, avant, apres) {
    const cles = new Set([...Object.keys(avant), ...Object.keys(apres)]);
    for (const cle of cles) {
      const a = avant[cle];
      const b = apres[cle];
      if (estObjet(a) || estObjet(b)) {
        base[cle] = reporterChangements(
          estObjet(base[cle]) ? base[cle] : {},
          estObjet(a) ? a : {},
          estObjet(b) ? b : {}
        );
      } else if (a !== b) {
        if (b === undefined) delete base[cle];
        else base[cle] = b;
      }
    }
    return base;
  }

  function estObjet(valeur) {
    return valeur !== null && typeof valeur === "object" && !Array.isArray(valeur);
  }

  function reponse(numLecon, numQuestion) {
    return (etat.reponses[numLecon] || {})[numQuestion] || "";
  }

  function definirReponse(numLecon, numQuestion, texte) {
    if (!etat.reponses[numLecon]) etat.reponses[numLecon] = {};
    if (texte.trim()) etat.reponses[numLecon][numQuestion] = texte;
    else delete etat.reponses[numLecon][numQuestion];
    return enregistrerEtat();
  }

  // Réponse tapée mais pas encore enregistrée : l'enregistrement attend une courte pause dans la
  // frappe. On l'enregistre sans attendre quand on quitte le champ, change d'écran ou passe en
  // arrière-plan, car le téléphone peut alors fermer l'application à tout moment.
  let reponseEnAttente = null;

  function enregistrerReponseEnAttente() {
    const enregistrer = reponseEnAttente;
    reponseEnAttente = null;
    if (enregistrer) enregistrer();
  }

  function nbReponses(lecon) {
    const saisies = etat.reponses[lecon.numero] || {};
    let n = Object.values(saisies).filter((t) => t && t.trim()).length;
    if (etat.recitations[lecon.numero]) n += 1;
    return n;
  }

  function statutLecon(lecon) {
    if (etat.terminees[lecon.numero]) return "terminee";
    if (nbReponses(lecon) > 0) return "en-cours";
    return "a-commencer";
  }

  // ---------------------------------------------------------------------------
  // Chargement du contenu
  // ---------------------------------------------------------------------------

  let index = null; // liste des leçons (contenu/index.json)
  const leconsChargees = new Map();

  // Version « aperçu » : tout le contenu est embarqué dans une page unique
  // (voir scripts/construire-apercu.mjs). Sinon, les fichiers sont chargés normalement.
  const contenuEmbarque = window.CONTENU_EMBARQUE || null;

  async function chargerJson(chemin) {
    if (contenuEmbarque) {
      if (!contenuEmbarque[chemin]) throw new Error(`Contenu absent de l’aperçu : ${chemin}`);
      return contenuEmbarque[chemin];
    }
    const reponseHttp = await fetch(chemin);
    if (!reponseHttp.ok) throw new Error(`Chargement impossible : ${chemin} (${reponseHttp.status})`);
    return reponseHttp.json();
  }

  async function chargerIndex() {
    if (!index) index = await chargerJson("contenu/index.json");
    return index;
  }

  // Table des versets cités : { traduction, versets: { "Genèse 1.1, 27": [{ v, t }] } }
  let versets = null;
  let motifReferences = null;

  async function chargerVersets() {
    if (versets) return versets;
    try {
      versets = await chargerJson("contenu/versets.json");
    } catch (erreur) {
      console.warn("Versets indisponibles :", erreur);
      versets = { traduction: "", versets: {} };
    }
    // Les références les plus longues d'abord, pour que « Jean 3.16 » l'emporte sur « Jean 3 ».
    // Le motif s'applique à du texte déjà échappé : « Romains 6.6 & 11 » y est écrit
    // « Romains 6.6 &amp; 11 ». Sans cela, ces références resteraient muettes.
    const cles = Object.keys(versets.versets).sort((a, b) => b.length - a.length);
    motifReferences = cles.length
      ? new RegExp(
          `(?:${cles
            .map((c) => echapper(c).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("|")})`,
          "g"
        )
      : null;
    return versets;
  }

  async function chargerLecon(numero) {
    if (leconsChargees.has(numero)) return leconsChargees.get(numero);
    const liste = await chargerIndex();
    const entree = liste.lecons.find((l) => l.numero === numero);
    if (!entree) throw new Error(`La leçon ${numero} n’existe pas.`);
    const lecon = await chargerJson(`contenu/lecons/${entree.fichier}`);
    leconsChargees.set(numero, lecon);
    return lecon;
  }

  // Les documents de l'église : confession de foi, statuts, règlement intérieur, principes.
  const documentsCharges = new Map();

  async function chargerDocument(slug) {
    if (documentsCharges.has(slug)) return documentsCharges.get(slug);
    const liste = await chargerIndex();
    const entree = (liste.documents || []).find((d) => d.slug === slug);
    if (!entree) throw new Error("Ce document n’existe pas.");
    const texte = await chargerJson(`contenu/documents/${entree.fichier}`);
    documentsCharges.set(slug, texte);
    return texte;
  }

  // Les références bibliques des documents : où elles se trouvent dans chaque texte, et le
  // passage de chacune (scripts/construire-versets-documents.mjs). Chargé à la première
  // ouverture d'un document seulement. S'il manque, les références restent du texte simple.
  let versetsDocuments = null;

  async function chargerVersetsDocuments() {
    if (versetsDocuments) return versetsDocuments;
    try {
      versetsDocuments = await chargerJson("contenu/versets-documents.json");
    } catch (erreur) {
      console.warn("Passages des documents indisponibles :", erreur);
      versetsDocuments = { traduction: "", reperes: {}, passages: {} };
    }
    return versetsDocuments;
  }

  // ---------------------------------------------------------------------------
  // Outils d'affichage
  // ---------------------------------------------------------------------------

  function echapper(texte) {
    return String(texte)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Convertit la mise en forme légère du contenu (**gras**, *italique*, retours à la ligne),
  // puis rend cliquables les adresses de sites et les références bibliques.
  function enrichir(texte, { references = true } = {}) {
    const base = echapper(texte)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/\n/g, "<br>");
    return references ? lierReferences(lierAdresses(base)) : lierAdresses(base);
  }

  // N'applique une transformation qu'au texte, jamais à l'intérieur d'une balise déjà posée.
  function horsBalises(html, transformation) {
    return html
      .split(/(<[^>]*>)/)
      .map((morceau) => (morceau.startsWith("<") ? morceau : transformation(morceau)))
      .join("");
  }

  const ADRESSES = /\b(?:https?:\/\/|www\.)[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+(?:\/[^\s,;)»<]*)?/g;

  function lierAdresses(html) {
    return horsBalises(html, (texte) =>
      texte.replace(ADRESSES, (adresse) => {
        const url = adresse.startsWith("http") ? adresse : `https://${adresse}`;
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">${adresse}</a>`;
      })
    );
  }

  function lierReferences(html) {
    if (!motifReferences) return html;
    // La ponctuation collée à la référence entre dans le même groupe, avant comme après :
    // la référence est un bouton, donc une boîte insécable, et une parenthèse laissée dehors
    // tombe seule en fin de ligne.
    const avecPonctuation = new RegExp(`([(\\[]?)(${motifReferences.source})([.,;:!?»)\\]]*)`, "g");
    return horsBalises(html, (texte) =>
      texte.replace(
        avecPonctuation,
        (tout, ouvrante, ref, ponctuation) =>
          `<span class="ref-groupe">${ouvrante}<button type="button" class="ref" data-ref="${ref}" ` +
          `aria-label="Lire le passage ${ref}">${ref}</button>${ponctuation}</span>`
      )
    );
  }

  function sourceLogo() {
    return (window.FIGURES_EMBARQUEES || {})["icones/logo-ebtm-mot.png"] || "icones/logo-ebtm-mot.png";
  }

  function sourceLogoSombre() {
    return (
      (window.FIGURES_EMBARQUEES || {})["icones/logo-ebtm-mot-sombre.png"] || "icones/logo-ebtm-mot-sombre.png"
    );
  }

  function sourceQrCode() {
    return (window.FIGURES_EMBARQUEES || {})["qr-cours-decouvertes.png"] || "qr-cours-decouvertes.png";
  }

  // En aperçu, les images sont embarquées dans la page ; sinon ce sont de vrais fichiers.
  function sourceFigure(fichier) {
    const chemin = `contenu/figures/${fichier}`;
    return (window.FIGURES_EMBARQUEES || {})[chemin] || chemin;
  }

  function html(chaines, ...valeurs) {
    return chaines.reduce((acc, morceau, i) => acc + morceau + (i < valeurs.length ? valeurs[i] : ""), "");
  }

  const principal = document.getElementById("principal");
  // « Aller au contenu » (index.html) : l'adresse « #principal » passait par le routeur, qui ne
  // la connaît pas, et ramenait à l'accueil au lieu du texte de la page (agent de
  // contre-vérification, 25 novembre 2026). Le lien donne donc le focus lui-même, sans
  // toucher à l'adresse.
  document.querySelector(".saut").addEventListener("click", (evenement) => {
    evenement.preventDefault();
    principal.focus();
  });

  // Neutralise l'arrière-plan quand une fenêtre est ouverte : le clavier n'en sort plus et les
  // lecteurs d'écran n'annoncent plus ce qui est derrière. « inert » fait les deux d'un coup.
  // Fenêtres du bas : montée et descente animées par la feuille de style. On rend la fenêtre
  // visible, puis on pose « feuille--ouverte » une image plus tard pour que la montée parte
  // d'en bas ; à la fermeture, on retire la classe et on ne cache la fenêtre qu'une fois la
  // descente finie. Rouverte pendant sa descente, elle remonte depuis là où elle est.
  const minuteriesFeuilles = new WeakMap();
  // Branché plus bas par « Mes notes » (la barre des choix), défini plus loin dans ce fichier.
  let autourDesFeuilles = null;
  const moinsDeMouvement = window.matchMedia("(prefers-reduced-motion: reduce)");
  function dureeFermetureFeuille() {
    if (moinsDeMouvement.matches) return 0;
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--feuille-fermeture")) || 0;
  }
  function feuilleOuverte(fenetre) {
    return fenetre.classList.contains("feuille--ouverte");
  }
  // « aussitot » : la fenêtre est déjà en place, sans monter (une note rouverte au retour).
  function montrerFeuille(fenetre, { aussitot = false } = {}) {
    // Une fenêtre (verset, réglages) passe devant la barre des choix d'une note : la barre se
    // retire, elle reviendra à la fermeture si le passage est encore sélectionné.
    if (autourDesFeuilles) autourDesFeuilles.ouverture();
    clearTimeout(minuteriesFeuilles.get(fenetre));
    if (aussitot) fenetre.classList.add("feuille--aussitot");
    if (fenetre.hidden) {
      fenetre.hidden = false;
      void fenetre.offsetHeight; // la position de départ (en bas) est posée avant la montée
    }
    fenetre.classList.add("feuille--ouverte");
    if (aussitot) {
      void fenetre.offsetHeight;
      // La descente, à la fermeture, reste animée.
      requestAnimationFrame(() => requestAnimationFrame(() => fenetre.classList.remove("feuille--aussitot")));
    }
  }
  // « aussitot » : la fenêtre disparaît sans descendre, quand l'écran change juste après.
  function cacherFeuille(fenetre, { aussitot = false } = {}) {
    if (autourDesFeuilles) autourDesFeuilles.fermeture();
    fenetre.classList.remove("feuille--ouverte");
    clearTimeout(minuteriesFeuilles.get(fenetre));
    if (aussitot) {
      fenetre.hidden = true;
      return;
    }
    minuteriesFeuilles.set(
      fenetre,
      setTimeout(() => {
        if (!feuilleOuverte(fenetre)) fenetre.hidden = true;
      }, dureeFermetureFeuille())
    );
  }

  function neutraliserArrierePlan(actif) {
    // Le lien « Aller au contenu » aussi : sans lui, la tabulation sortait de la fenêtre.
    const zones = [document.getElementById("barre"), document.getElementById("principal"), document.querySelector(".saut")];
    for (const zone of zones) {
      if (!zone) continue;
      zone.inert = actif;
      if (actif) zone.setAttribute("aria-hidden", "true");
      else zone.removeAttribute("aria-hidden");
    }
    document.body.style.overflow = actif ? "hidden" : "";
  }
  // ---------------------------------------------------------------------------
  // Bandeaux : la bulle du choix actif
  // ---------------------------------------------------------------------------
  //
  // Un bandeau (onglets d'une leçon, modes d'un verset, apparence) montre son choix par une
  // bulle violette qui glisse vers sa nouvelle place et s'étire un instant en chemin. C'est la
  // mécanique de la barre d'onglets de l'application du groupe de jeunes, reprise telle quelle
  // (voir la feuille de style) : un seul élément, glissé sous les libellés. Les vrais boutons
  // restent au-dessus, seuls à être lus et touchés.
  //
  // La bulle suit les attributs des boutons : il suffit de changer « aria-selected » ou
  // « aria-pressed » pour qu'elle parte. Elle ne voyage que si la rangée reste en place : une
  // rangée reconstruite repart de zéro, bulle posée sans mouvement.
  function equiperBandeau(rangee) {
    const boutons = Array.from(rangee.querySelectorAll(":scope > button"));
    if (boutons.length < 2) return;
    const bulle = document.createElement("span");
    bulle.className = "bandeau-bulle";
    bulle.setAttribute("aria-hidden", "true");
    // Cachée tant qu'aucun choix n'est posé.
    bulle.hidden = true;
    rangee.classList.add("bandeau--equipe");
    // La bulle vit dans un cadre. Il couvre toute la rangée, sauf là où la feuille de style le
    // resserre pour retenir le rebond de la bulle dans son bandeau (onglets d'une leçon).
    const cadreBulle = document.createElement("span");
    cadreBulle.className = "bandeau-cadre";
    cadreBulle.setAttribute("aria-hidden", "true");
    cadreBulle.append(bulle);
    // En tête de rangée : elle se dessine ainsi sous les boutons, sans réglage de plan.
    rangee.prepend(cadreBulle);
    let place = -1;
    let cadre = null;
    let largeurConnue = rangee.offsetWidth;

    const choisi = () => boutons.findIndex((b) => b.matches('[aria-selected="true"], [aria-pressed="true"]'));
    // La place est mesurée sur le vrai bouton, et non déduite par tiers de la largeur : en
    // texte très grand sur un écran étroit, les colonnes n'ont plus la même largeur. Positions
    // lues avec leurs décimales : arrondies, la bulle déborderait d'un filet.
    const mesurer = (index) => {
      const bouton = boutons[index].getBoundingClientRect();
      const bandeau = cadreBulle.getBoundingClientRect();
      return {
        x: bouton.left - bandeau.left,
        y: bouton.top - bandeau.top,
        largeur: bouton.width,
        hauteur: bouton.height,
      };
    };
    const poser = (index, voyage) => {
      bulle.classList.toggle("bandeau-bulle--posee", !voyage);
      cadre = mesurer(index);
      bulle.style.top = `${cadre.y}px`;
      bulle.style.width = `${cadre.largeur}px`;
      bulle.style.height = `${cadre.hauteur}px`;
      bulle.style.setProperty("--bulle-x", `${cadre.x}px`);
      bulle.classList.remove("bandeau-bulle--bouge");
      // Lire une mesure applique la pose tout de suite, et relance l'étirement à chaque trajet.
      void bulle.offsetWidth;
      if (voyage) bulle.classList.add("bandeau-bulle--bouge");
      else bulle.classList.remove("bandeau-bulle--posee");
      place = index;
    };
    const suivre = () => {
      const index = choisi();
      bulle.hidden = index < 0;
      if (index < 0) place = -1;
      else if (index !== place) poser(index, place >= 0);
      else {
        // Même choix, mais un libellé a pu changer de largeur (compte d'un onglet). On ne recale
        // que si la place a réellement bougé : sinon on couperait un trajet en cours.
        const mesure = mesurer(index);
        const bouge = ["x", "y", "largeur", "hauteur"].some((cle) => mesure[cle] !== cadre[cle]);
        if (bouge) poser(index, false);
      }
    };

    suivre();

    // La rangée change de largeur (téléphone tourné, taille du texte, fenêtre qui s'ouvre) :
    // la bulle est reposée à sa place, sans voyage.
    if ("ResizeObserver" in window) {
      new ResizeObserver(() => {
        if (rangee.offsetWidth === largeurConnue) return;
        largeurConnue = rangee.offsetWidth;
        if (place >= 0) poser(place, false);
      }).observe(rangee);
    }

    // Le choix change, ou un compte est mis à jour dans un onglet : la bulle suit.
    const veille = new MutationObserver(suivre);
    for (const bouton of boutons) {
      veille.observe(bouton, {
        attributes: true,
        attributeFilter: ["aria-selected", "aria-pressed"],
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
  }

  const barre = document.getElementById("barre");
  const zoneOnglets = document.getElementById("zone-onglets");
  const titreBarre = document.getElementById("titre-barre");
  const zoneNavigation = document.getElementById("zone-navigation");
  const boutonPartage = document.getElementById("ouvrir-partage");

  // Deux images, une par apparence : la feuille de style n'en montre jamais qu'une. La version
  // sombre est le même logo, détouré, aux lettres éclaircies (scripts/preparer-logo-sombre.py).
  const LOGO = `<a class="marque__lien" href="#/" aria-label="Accueil, toutes les leçons">
    <img class="marque__logo marque__logo--clair" src="__SRC__" alt="EBTM" width="500" height="273" />
    <img class="marque__logo marque__logo--sombre" src="__SRC_SOMBRE__" alt="EBTM" width="500" height="273" /></a>`;
  const RETOUR = `<a class="bouton-retour" href="#/" aria-label="Retour à toutes les leçons">←</a>`;
  const RETOUR_DOCUMENTS = `<a class="bouton-retour" href="#/documents" aria-label="Retour aux documents">←</a>`;
  // « data-retour » : la flèche remonte dans l'historique si l'écran de « Mes notes » visé y
  // est juste avant, comme le geste de retour de l'iPhone (voir « Une seule règle pour revenir »).
  const retourNotes = (cle, nom = "mes notes") =>
    `<a class="bouton-retour" href="#${cle}" data-retour aria-label="Retour à ${nom}">←</a>`;

  // ---------------------------------------------------------------------------
  // Proposer l'installation sur l'écran d'accueil
  // ---------------------------------------------------------------------------
  //
  // Installer ne relève pas du confort. Sur iPhone, Safari efface les données d'un site resté
  // sept jours sans visite ; une application ajoutée à l'écran d'accueil y échappe. Comme le
  // cours se suit à raison d'une leçon par semaine, un participant qui ne l'installe pas est
  // exactement à la limite, et peut retrouver ses réponses effacées.
  //
  // Android sait déclencher une vraie installation ; iPhone n'offre aucune commande, seulement
  // un geste à montrer. On n'affiche donc que ce qui sert sur l'appareil qui regarde.

  const CLE_INVITE = "cours-decouvertes-invite-installation";

  // L'icône « Partager » d'iOS : un carré ouvert vers le haut, traversé par une flèche.
  const PARTAGE_IOS = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
      focusable="false"><path d="M12 3.5 L12 15" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" /><path d="M8 7 L12 3.2 L16 7" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /><path
      d="M7.5 10.5 L5.5 10.5 L5.5 20.5 L18.5 20.5 L18.5 10.5 L16.5 10.5" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>`;

  // Le bouton de partage de la liste des leçons porte ce même dessin.
  boutonPartage.innerHTML = PARTAGE_IOS;

  // Le bouton de menu de Safari depuis iOS 27, dans la barre d'adresse : trois traits alignés à
  // gauche, le dernier plus court. C'est lui qui mène à « Partager ».
  const MENU_IOS = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
      focusable="false"><path d="M4 7 H20 M4 12 H20 M4 17 H14" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" /></svg>`;

  let installationDifferee = null;

  function dejaInstallee() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function surIPhone() {
    const ua = navigator.userAgent;
    // iPadOS se présente comme un Mac : on le reconnaît à son écran tactile.
    return /iPhone|iPod|iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }

  // Version de Safari (« Version/27.0 » dans l'identité du navigateur), 0 pour un autre navigateur
  // ou une identité illisible. Le numéro d'iOS qui y figure est figé (18_7 sous iOS 26 comme sous
  // iOS 27) : seule la version de Safari suit le système.
  function versionSafari() {
    const ua = navigator.userAgent;
    if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return 0;
    const trouve = /Version\/(\d+)/.exec(ua);
    return trouve ? Number(trouve[1]) : 0;
  }

  // Les gestes d'installation sur iPhone, tels que Safari les présente, vérifiés le 18 septembre
  // 2026 dans les simulateurs d'iOS 26.5 et 27 :
  // - iOS 26 : « ••• » en bas à droite, puis « Partager » ; iOS 27 : le bouton de menu dans la
  //   barre d'adresse, puis « Partager ». Avant iOS 26, l'icône Partager est dans la barre du bas.
  // - Depuis iOS 26, « Sur l'écran d'accueil » n'apparaît qu'après « En voir plus ».
  // Autres navigateurs et versions plus anciennes : les indications d'origine.
  // Espaces insécables dans les guillemets : un « seul en fin de ligne gênait la lecture.
  function etapesIPhone(classe) {
    const version = versionSafari();
    const partager = `<span class="invite__icone">${PARTAGE_IOS}<span class="visuellement-cache">Partager</span></span>`;
    const premiere = version >= 27
      ? html`Touchez <span class="invite__icone">${MENU_IOS}<span class="visuellement-cache">le bouton de menu</span></span> dans la barre d’adresse, puis « Partager ».`
      : html`Touchez ${partager} en bas de l’écran. Si vous ne la voyez pas, touchez <strong>•••</strong> puis « Partager ».`;
    const deuxieme = version >= 26
      ? html`Touchez « En voir plus », puis « Sur l’écran d’accueil ».`
      : html`Faites défiler, puis touchez « Sur l’écran d’accueil ».`;
    return html`<ol class="${classe}">
            <li>${premiere}</li>
            <li>${deuxieme}</li>
            <li>Touchez « Ajouter ».</li>
          </ol>`;
  }

  // Un appareil qu'on touche : sur un ordinateur sans installation possible, mieux vaut ne
  // rien dire du tout.
  function appareilTactile() {
    return window.matchMedia("(pointer: coarse)").matches;
  }

  // Firefox Android et quelques autres n'émettent pas « beforeinstallprompt » : on ne peut pas
  // savoir tout de suite qu'il ne viendra pas. On laisse un instant à l'événement, puis on
  // se rabat sur une explication générale.
  let apiInstallationAttendue = true;
  setTimeout(() => {
    apiInstallationAttendue = false;
    if (!installationDifferee && (location.hash === "#/" || location.hash === "")) afficherAccueil();
  }, 1500);

  function inviteRefusee() {
    try {
      return localStorage.getItem(CLE_INVITE) === "refusee";
    } catch {
      return false;
    }
  }

  function refuserInvite() {
    try {
      localStorage.setItem(CLE_INVITE, "refusee");
    } catch {
      /* navigation privée : l'invite reviendra, c'est sans gravité */
    }
    const bloc = document.getElementById("invite-installation");
    if (bloc) bloc.remove();
  }

  window.addEventListener("beforeinstallprompt", (evenement) => {
    evenement.preventDefault(); // on choisit le moment, plutôt que de laisser le navigateur décider
    installationDifferee = evenement;
    if (location.hash === "#/" || location.hash === "") afficherAccueil();
  });

  window.addEventListener("appinstalled", () => {
    installationDifferee = null;
    refuserInvite();
  });

  const CLE_ORDINATEUR = "cours-decouvertes-ecran-ordinateur";

  // Le cours est fait pour être installé sur un téléphone, pas consulté sur un ordinateur.
  // On ne peut pas l'y interdire — une adresse reste une adresse — mais on peut ne pas l'y
  // proposer, et renvoyer vers le téléphone. La porte de sortie reste ouverte : beaucoup de
  // personnes malvoyantes lisent sur grand écran avec un lecteur d'écran, et l'application
  // doit leur rester utilisable.
  function surOrdinateur() {
    return !appareilTactile() && !dejaInstallee();
  }

  function derogationOrdinateur() {
    try {
      return localStorage.getItem(CLE_ORDINATEUR) === "accepte";
    } catch {
      return false;
    }
  }

  // Le QR code est produit par « sh scripts/generer-qr.sh <adresse> app/qr-cours-decouvertes.png ».
  // Tant qu'il n'existe pas, l'adresse écrite en toutes lettres suffit à se dépanner.
  function ecranOrdinateur() {
    const adresse = location.origin + location.pathname;
    return html`
      <section class="orientation">
        <h1 class="page-titre">Cours découvertes</h1>
        <p class="orientation__texte">
          Ce cours s’utilise sur téléphone ou sur tablette. Scannez ce code avec l’appareil
          photo de l’un ou de l’autre.
        </p>
        <img class="orientation__qr" src="qr-cours-decouvertes.png" alt="Code à scanner menant à ${echapper(adresse)}" width="320" height="320" />
        <p class="orientation__adresse">${echapper(adresse)}</p>
        <button type="button" class="invite__plus-tard" data-ordinateur="continuer">
          Continuer sur cet écran
        </button>
      </section>
    `;
  }

  // Arrivée par le QR code : l'adresse porte « ?installer ». L'installation occupe alors tout
  // l'écran, puisque c'est la seule chose à faire à ce moment-là.
  function arriveeParQrCode() {
    return location.search.includes("installer");
  }

  function ecranInstallation() {
    const etapes = installationDifferee
      ? html`<button type="button" class="bouton-principal orientation__bouton" data-invite="installer">Installer</button>`
      : surIPhone()
        ? etapesIPhone("invite__etapes orientation__etapes")
        : html`<ol class="invite__etapes orientation__etapes">
            <li>Ouvrez le menu de votre navigateur.</li>
            <li>Touchez « Installer » ou « Ajouter à l’écran d’accueil ».</li>
          </ol>`;
    return html`
      <section class="orientation">
        <h1 class="page-titre">Cours découvertes</h1>
        <p class="orientation__texte">
          Installez l’application sur votre téléphone : vous l’aurez toujours sur vous, même sans
          connexion, et vos réponses y seront conservées.
        </p>
        ${etapes}
      </section>
    `;
  }

  // Rendue seulement si elle sert : ni sur une application déjà installée, ni après un refus,
  // ni sur un appareil où l'on n'aurait rien d'utile à dire.
  function inviteInstallation() {
    if (dejaInstallee() || inviteRefusee()) return "";

    if (installationDifferee) {
      return html`<section class="invite" id="invite-installation">
        <p class="invite__titre">Installer le cours sur votre téléphone</p>
        <p class="invite__texte">
          Vous le retrouverez avec vos autres applications, il fonctionnera sans connexion, et vos
          réponses seront conservées.
        </p>
        <button type="button" class="bouton-principal" data-invite="installer">Installer</button>
        <button type="button" class="invite__plus-tard" data-invite="plus-tard">Plus tard</button>
      </section>`;
    }

    if (surIPhone()) {
      return html`<section class="invite" id="invite-installation">
        <p class="invite__titre">Installer le cours sur votre iPhone</p>
        <p class="invite__texte">
          Vous le retrouverez avec vos autres applications, il fonctionnera sans connexion, et vos
          réponses seront conservées.
        </p>
        ${etapesIPhone("invite__etapes")}
        <button type="button" class="invite__plus-tard" data-invite="plus-tard">Plus tard</button>
      </section>`;
    }

    // Firefox Android, et tout navigateur tactile qui sait installer sans le dire à la page.
    if (!apiInstallationAttendue && appareilTactile()) {
      return html`<section class="invite" id="invite-installation">
        <p class="invite__titre">Installer le cours sur votre téléphone</p>
        <p class="invite__texte">
          Vous le retrouverez avec vos autres applications, il fonctionnera sans connexion, et vos
          réponses seront conservées.
        </p>
        <ol class="invite__etapes">
          <li>Ouvrez le menu de votre navigateur.</li>
          <li>Touchez « Installer » ou « Ajouter à l’écran d’accueil ».</li>
        </ol>
        <button type="button" class="invite__plus-tard" data-invite="plus-tard">Plus tard</button>
      </section>`;
    }

    return "";
  }

  document.addEventListener("click", (evenement) => {
    if (!evenement.target.closest("[data-ordinateur]")) return;
    try {
      localStorage.setItem(CLE_ORDINATEUR, "accepte");
    } catch {
      /* sans stockage, l'écran reviendra à la prochaine visite */
    }
    afficherAccueil();
  });

  document.addEventListener("click", async (evenement) => {
    const bouton = evenement.target.closest("[data-invite]");
    if (!bouton) return;
    if (bouton.dataset.invite === "revoir") {
      try {
        localStorage.removeItem(CLE_INVITE);
      } catch {
        /* sans stockage, rien à effacer */
      }
      fermerReglages();
      history.replaceState(history.state, "", location.pathname + "?installer" + location.hash);
      afficherAccueil();
      return;
    }
    if (bouton.dataset.invite === "plus-tard") {
      refuserInvite();
      if (arriveeParQrCode()) afficherAccueil();
      return;
    }
    if (!installationDifferee) return;
    installationDifferee.prompt();
    const { outcome } = await installationDifferee.userChoice;
    // prompt() ne se rappelle pas sur le même événement : le navigateur en émettra un nouveau.
    installationDifferee = null;
    if (outcome === "accepted") refuserInvite();
  });

  // Icônes dessinées à la main, sans dépendance : une croix pour fermer une fenêtre, une loupe
  // pour dire qu'une image s'agrandit.
  const CROIX = `<svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"
      focusable="false"><path d="M5 5 L15 15 M15 5 L5 15" fill="none" stroke="currentColor"
      stroke-width="2.2" stroke-linecap="round" /></svg>`;

  const LOUPE = `<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"
      focusable="false"><circle cx="8.5" cy="8.5" r="5.4" fill="none" stroke="currentColor"
      stroke-width="2" /><path d="M12.7 12.7 L17 17" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" /></svg>`;

  // La barre est fixée en haut : le contenu doit commencer juste en dessous.
  // Mesurer un élément force le navigateur à recalculer la mise en page. Fait à chaque pixel
  // de défilement, cela suffit à hacher le mouvement : la hauteur est donc retenue ici, et
  // recalculée seulement quand la barre change vraiment.
  let hauteurBarre = 0;

  // Hauteur exacte, décimales comprises : « offsetHeight » l'arrondit au point entier (MDN,
  // « Determining the dimensions of elements »). Arrondie, elle laissait une fente de moins d'un
  // point entre la barre et la page (147,61 contre 148, mesuré le 23 novembre 2026).
  function ajusterHauteurBarre() {
    hauteurBarre = barre.getBoundingClientRect().height;
    document.body.style.paddingTop = `${hauteurBarre}px`;
  }
  window.addEventListener("resize", ajusterHauteurBarre);

  // Le logo porte le nom de l'église, le titre celui du cours : les deux vont de pair.
  const NOM_APPLICATION = "Cours découvertes";

  // « garderOnglets » laisse la barre d'onglets en place : d'un onglet à l'autre de la même
  // leçon, c'est la même rangée, et sa pastille peut donc glisser sans interruption.
  // Au geste de retour, l'iPhone montre une photo de l'écran précédent puis la retire dès que la
  // page a redessiné : un écran reconstruit de zéro à cet instant apparaissait blanc une ou deux
  // images, logo absent (vidéo de Sébastien sur son iPhone, 21 novembre 2026, 23 h 17 ; même
  // cause décrite chez Next.js : nielsreijnders.nl/blog/ios-back-swipe-image-flicker). Le logo
  // est donc créé une seule fois, et un écran de liste quitté est gardé tel quel : au retour,
  // si son contenu n'a pas changé, ce sont les mêmes éléments qui reviennent.
  let retourVersListe = false; // posé par le routeur : voir « Retour vers une liste »
  let logo = null;
  function elementLogo() {
    if (!logo) {
      const modele = document.createElement("template");
      modele.innerHTML = LOGO.replace("__SRC__", sourceLogo()).replace("__SRC_SOMBRE__", sourceLogoSombre());
      logo = modele.content.firstElementChild;
    }
    return logo;
  }
  const ecransGardes = new Map(); // clé d'écran → { html, noeuds }
  let ecranAffiche = null; // { cle, html } de l'écran présent dans « principal »
  function garderEcranQuitte() {
    if (!ecranAffiche || !estListe(ecranAffiche.cle)) return;
    const noeuds = document.createDocumentFragment();
    noeuds.append(...principal.childNodes);
    noeuds.querySelectorAll(".ligne--touchee, .ligne--revient").forEach((ligne) => {
      ligne.classList.remove("ligne--touchee", "ligne--revient");
    });
    // « Mes notes » : une ligne glissée ou le mode « Modifier » ne restent pas figés au retour.
    noeuds.querySelectorAll(".ligne-note-cadre").forEach((cadre) => {
      cadre.classList.remove(
        "ligne-note-cadre--ouverte",
        "ligne-note-cadre--glisse",
        "ligne-note-cadre--loin",
        "ligne-note-cadre--revele"
      );
      const ligne = cadre.querySelector(".ligne-note");
      if (ligne) ligne.style.transform = ligne.style.transition = "";
      const retirer = cadre.querySelector(".ligne-note__retirer");
      if (retirer) {
        retirer.tabIndex = -1;
        retirer.setAttribute("aria-hidden", "true");
      }
    });
    noeuds.querySelectorAll(".liste-notes--modification").forEach((liste) => {
      liste.classList.remove("liste-notes--modification");
    });
    ecransGardes.set(ecranAffiche.cle, { html: ecranAffiche.html, noeuds });
  }

  function afficherDans(contenuHtml, titreDocument, { garderOnglets = false } = {}) {
    if (!garderOnglets) zoneOnglets.innerHTML = "";
    zoneNavigation.replaceChildren(elementLogo());
    titreBarre.textContent = NOM_APPLICATION;
    // Le partage n'appartient qu'à la liste des leçons : chaque écran l'éteint, elle le rallume.
    boutonPartage.hidden = true;
    ligneOuverte = null;
    // « Modifier » n'appartient qu'à un dossier de « Mes notes » (afficherDossier le rallume).
    const modifier = document.getElementById("modifier-notes");
    modifier.hidden = true;
    modifier.setAttribute("aria-pressed", "false");
    modifier.textContent = "Modifier";
    barre.classList.remove("barre--accueil");
    reposerBarre();
    const cle = ecranCourant ? ecranCourant.cle : null;
    garderEcranQuitte();
    const garde = ecransGardes.get(cle);
    ecransGardes.delete(cle);
    if (garde && garde.html === contenuHtml) principal.replaceChildren(garde.noeuds);
    else principal.innerHTML = contenuHtml;
    ecranAffiche = { cle, html: contenuHtml };
    document.title = titreDocument ? `${titreDocument} — Cours découvertes` : "Cours découvertes";
    if (!retourVersListe) window.scrollTo(0, 0);
    const titre = principal.querySelector("h1");
    if (titre) {
      titre.setAttribute("tabindex", "-1");
      titre.focus({ preventScroll: true });
    }
    ajusterHauteurBarre();
  }

  function afficherErreur(message) {
    afficherDans(
      html`
        <div class="message message--erreur" role="alert">
          <strong>Un problème est survenu.</strong><br />
          ${echapper(message)}<br />
          La première ouverture demande une connexion internet ; ensuite l’application fonctionne hors ligne.
        </div>
      `,
      "Erreur"
    );
  }

  // ---------------------------------------------------------------------------
  // La barre du haut pendant la lecture
  // ---------------------------------------------------------------------------

  // La barre reste en place et opaque : on ne voit rien passer derrière le bandeau violet
  // (demande de Sébastien, 21 novembre 2026). Elle s'effaçait pendant la lecture ; le texte
  // passait alors sous l'heure, où iOS 27 le montrait flouté. Une ombre seule dit qu'elle
  // passe au-dessus du texte, dès le premier pixel de défilement.
  const ALIGNEMENT_MS = 120; // au-delà, on considère que le doigt s'est arrêté
  const SEUIL_OMBRE = 4;

  let minuterieAlignement = null;

  // Dans une leçon, seule la rangée des onglets se range sous le bandeau quand on descend, et
  // revient quand on remonte (style.css, « .barre--onglets »). On bascule entre deux états et
  // c'est une transition CSS qui fait le mouvement : sur iOS, suivre le doigt depuis le script
  // laissait la rangée en retard d'une image sur le texte.
  const COURSE_RANGER = 16; // descente franche avant de ranger la rangée
  const COURSE_MONTRER = 10; // il en faut moins pour la rappeler
  let ongletsRangeables = false;
  let derniereY = 0;
  let course = 0; // distance parcourue depuis le dernier changement de sens

  function montrerOnglets() {
    barre.classList.remove("barre--onglets-rangees");
  }

  // Appelé par l'écran d'une leçon, une fois sa rangée d'onglets en place.
  function rendreOngletsRangeables() {
    ongletsRangeables = Boolean(zoneOnglets.querySelector(".onglets"));
    barre.classList.toggle("barre--onglets", ongletsRangeables);
    derniereY = Math.max(0, window.scrollY);
    course = 0;
  }

  // Le clavier ou un lecteur d'écran qui arrive sur un onglet le trouve toujours visible.
  zoneOnglets.addEventListener("focusin", montrerOnglets);

  function reposerBarre() {
    barre.classList.remove("barre--flottante", "barre--onglets", "barre--onglets-rangees");
    ongletsRangeables = false;
    derniereY = 0;
    course = 0;
    lectureEnCours = null;
  }

  // Appelé une fois que le doigt s'est arrêté : c'est là qu'on a le droit de mesurer.
  function auRepos() {
    memoriserLecture();
  }

  // ---------------------------------------------------------------------------
  // Reprendre la lecture où on s'est arrêté
  // ---------------------------------------------------------------------------

  // On ne retient pas une position en pixels : elle se décale dès que le lecteur change la
  // taille du texte, tourne son téléphone, ou qu'une ligne du contenu est corrigée. On retient
  // quel bloc était en haut de l'écran, et on le remet à cette place.
  const PREMIERS_BLOCS_IGNORES = 2; // ouvrir puis refermer une leçon ne crée pas de reprise

  let lectureEnCours = null; // { cle, blocs } — la leçon actuellement à l'écran
  let minuterieLecture = null;

  function blocsDuPanneau() {
    let conteneur = principal.querySelector(".panneau:not([hidden])");
    if (!conteneur) return [];
    // L'onglet Lecture enveloppe tout dans un seul <article> : il faut descendre jusqu'au
    // niveau où les blocs se suivent vraiment, sinon le repère ne bouge jamais.
    while (conteneur.children.length === 1 && conteneur.firstElementChild.children.length > 1) {
      conteneur = conteneur.firstElementChild;
    }
    return [...conteneur.children];
  }

  function blocEnHautDeLEcran(blocs) {
    const limite = hauteurBarre + 8;
    for (let i = 0; i < blocs.length; i++) {
      if (blocs[i].getBoundingClientRect().bottom > limite) return i;
    }
    return blocs.length - 1;
  }

  function memoriserLecture() {
    if (!lectureEnCours) return;
    const blocs = blocsDuPanneau();
    if (blocs.length === 0) return;

    // Arrivé au bas de la leçon, on oublie : la prochaine ouverture repart du début, ce qui
    // est le comportement attendu quand on a fini de lire.
    const finAtteinte = window.scrollY + window.innerHeight >= document.body.scrollHeight - 24;
    const index = blocEnHautDeLEcran(blocs);

    if (finAtteinte || index < PREMIERS_BLOCS_IGNORES) delete etat.lectures[lectureEnCours];
    else etat.lectures[lectureEnCours] = index;

    clearTimeout(minuterieLecture);
    minuterieLecture = setTimeout(enregistrerEtat, 500);
  }

  function reprendreLecture(cle) {
    lectureEnCours = cle;
    const index = etat.lectures[cle];
    if (typeof index !== "number") return;
    const blocs = blocsDuPanneau();
    const cible = blocs[index];
    if (!cible) return; // le contenu a changé depuis : on repart du haut, sans bruit
    const y = cible.getBoundingClientRect().top + window.scrollY - hauteurBarre - 8;
    window.scrollTo(0, Math.max(0, y));
  }

  function surDefilement() {
    // Page immobilisée sous la fenêtre d'une note : ce n'est pas le lecteur qui défile.
    if (pageFigee !== null) return;
    const y = Math.max(0, window.scrollY);
    barre.classList.toggle("barre--flottante", y > SEUIL_OMBRE);
    // La lecture avance : on retient où l'on en est une fois le doigt arrêté.
    clearTimeout(minuterieAlignement);
    minuterieAlignement = setTimeout(auRepos, ALIGNEMENT_MS);

    if (!ongletsRangeables) return;
    const delta = y - derniereY;
    derniereY = y;
    if (delta === 0) return;
    if (y <= 0) {
      course = 0;
      montrerOnglets();
      return;
    }
    // Changer de sens remet le compteur à zéro : la rangée répond aussitôt au geste inverse.
    if (delta > 0 !== course > 0) course = 0;
    course += delta;
    if (course > COURSE_RANGER) {
      barre.classList.add("barre--onglets-rangees");
      course = 0;
    } else if (course < -COURSE_MONTRER) {
      montrerOnglets();
      course = 0;
    }
  }

  window.addEventListener("scroll", surDefilement, { passive: true });

  // ---------------------------------------------------------------------------
  // Taille du texte
  // ---------------------------------------------------------------------------

  const ECHELLES = { "-1": 0.9, 0: 1, 1: 1.15, 2: 1.3 };

  function appliquerTaillePolice() {
    document.documentElement.style.setProperty("--echelle", ECHELLES[etat.taillePolice] || 1);
  }

  const SOMBRE_SYSTEME = window.matchMedia("(prefers-color-scheme: dark)");

  // « systeme » est résolu ici en clair ou sombre : la feuille de style n'a ainsi qu'une seule
  // palette sombre à décrire, et le réglage du téléphone n'agit que si le lecteur l'a demandé.
  function appliquerApparence() {
    const choix = etat.apparence || "clair";
    const sombre = choix === "sombre" || (choix === "systeme" && SOMBRE_SYSTEME.matches);
    if (sombre) document.documentElement.dataset.apparence = "sombre";
    else delete document.documentElement.dataset.apparence;
  }

  SOMBRE_SYSTEME.addEventListener("change", () => {
    if ((etat.apparence || "clair") === "systeme") appliquerApparence();
  });

  function changerTaillePolice(delta) {
    etat.taillePolice = Math.max(-1, Math.min(2, (etat.taillePolice || 0) + delta));
    appliquerTaillePolice();
    enregistrerEtat();
    ajusterHauteurBarre();
  }

  const NOMS_TAILLES = { "-1": "Petit", 0: "Normal", 1: "Grand", 2: "Très grand" };

  const reglages = document.createElement("div");
  reglages.className = "feuille";
  reglages.hidden = true;
  reglages.innerHTML = `
    <div class="feuille__carte" role="dialog" aria-modal="true" aria-labelledby="reglages-titre">
      <div class="feuille__entete">
        <p class="feuille__titre" id="reglages-titre">Réglages</p>
        <button type="button" class="feuille__fermer" aria-label="Fermer">${CROIX}</button>
      </div>
      <div class="feuille__corps feuille__corps--reglages">
        <div class="reglage">
          <p class="reglage__libelle">Taille du texte</p>
          <div class="reglage__commandes">
            <button type="button" class="bouton-taille" id="police-moins" aria-label="Réduire la taille du texte">A−</button>
            <span class="reglage__valeur" id="taille-actuelle" aria-live="polite"></span>
            <button type="button" class="bouton-taille" id="police-plus" aria-label="Agrandir la taille du texte">A+</button>
          </div>
        </div>
        <div class="reglage">
          <p class="reglage__libelle">Apparence</p>
          <div class="groupe-boutons" role="group" aria-label="Apparence">
            <button type="button" class="bouton-choix" data-apparence="systeme">Système</button>
            <button type="button" class="bouton-choix" data-apparence="clair">Clair</button>
            <button type="button" class="bouton-choix" data-apparence="sombre">Sombre</button>
          </div>
        </div>
        <div class="reglage" id="reglage-installation" hidden>
          <p class="reglage__libelle">Installation</p>
          <button type="button" class="bouton-principal bouton-principal--secondaire" data-invite="revoir">
            Installer l’application
          </button>
          <p class="reglage__note">
            Le cours reste sur votre appareil, fonctionne sans connexion, et vos réponses sont à
            l’abri du ménage que fait le navigateur.
          </p>
        </div>
        <div class="reglage">
          <p class="reglage__libelle">Mes réponses</p>
          <div id="zone-effacement"></div>
          <p class="reglage__note">
            Vos réponses sont sauvegardées localement sur votre appareil.
          </p>
        </div>
      </div>
    </div>`;
  document.body.appendChild(reglages);
  equiperBandeau(reglages.querySelector(".groupe-boutons"));

  const zoneEffacement = reglages.querySelector("#zone-effacement");

  const BOUTON_EFFACER =
    '<button type="button" class="lien-danger" data-effacer="demander">' +
    "Effacer toutes mes réponses</button>";

  // En deux temps : un toucher malheureux ne doit pas pouvoir tout perdre.
  const CONFIRMATION_EFFACER =
    '<p class="reglage__avertissement">Êtes-vous sûr ? Toutes vos réponses, vos notes, les versets cochés ' +
    "et les leçons terminées seront effacés de cet appareil. C’est définitif, et ils ne sont " +
    "enregistrés nulle part ailleurs.</p>" +
    '<div class="reglage__confirmation">' +
    '<button type="button" class="bouton-principal bouton-principal--secondaire" data-effacer="annuler">Annuler</button>' +
    '<button type="button" class="bouton-principal bouton-danger" data-effacer="confirmer">Oui, tout effacer</button>' +
    "</div>";

  function rafraichirReglages() {
    reglages.querySelector("#taille-actuelle").textContent = NOMS_TAILLES[etat.taillePolice] || "Normal";
    reglages.querySelector("#police-moins").disabled = etat.taillePolice <= -1;
    reglages.querySelector("#police-plus").disabled = etat.taillePolice >= 2;
    for (const bouton of reglages.querySelectorAll("button[data-apparence]"))
      bouton.setAttribute("aria-pressed", String(bouton.dataset.apparence === (etat.apparence || "clair")));
    zoneEffacement.innerHTML = BOUTON_EFFACER;
  }

  function ouvrirReglages() {
    const bloc = reglages.querySelector("#reglage-installation");
    if (bloc) bloc.hidden = dejaInstallee();
    rafraichirReglages();
    montrerFeuille(reglages);
    neutraliserArrierePlan(true);
    reglages.querySelector(".feuille__fermer").focus();
  }

  function fermerReglages() {
    cacherFeuille(reglages);
    neutraliserArrierePlan(false);
    document.getElementById("ouvrir-reglages").focus();
  }

  document.getElementById("ouvrir-reglages").addEventListener("click", ouvrirReglages);

  reglages.addEventListener("click", (evenement) => {
    if (evenement.target === reglages || evenement.target.closest(".feuille__fermer")) {
      fermerReglages();
      return;
    }

    const taille = evenement.target.closest("#police-moins, #police-plus");
    if (taille) {
      changerTaillePolice(taille.id === "police-plus" ? 1 : -1);
      rafraichirReglages();
      return;
    }

    // « button » est indispensable : l'attribut data-apparence est aussi posé sur la racine
    // du document, et closest() remonterait jusqu'à elle pour n'importe quel clic.
    const apparence = evenement.target.closest("button[data-apparence]");
    if (apparence) {
      etat.apparence = apparence.dataset.apparence;
      appliquerApparence();
      enregistrerEtat();
      rafraichirReglages();
      return;
    }

    const effacer = evenement.target.closest("[data-effacer]");
    if (!effacer) return;
    if (effacer.dataset.effacer === "demander") {
      zoneEffacement.innerHTML = CONFIRMATION_EFFACER;
      zoneEffacement.querySelector('[data-effacer="annuler"]').focus();
    } else if (effacer.dataset.effacer === "annuler") {
      zoneEffacement.innerHTML = BOUTON_EFFACER;
      zoneEffacement.querySelector("button").focus();
    } else {
      // Les réglages d'affichage ne sont pas des réponses : ils survivent à l'effacement.
      const conserves = { taillePolice: etat.taillePolice, apparence: etat.apparence };
      etat = { ...ETAT_PAR_DEFAUT(), ...conserves };
      // Tout remplacer : l'effacement vaut aussi pour ce qu'une autre copie ouverte aurait écrit.
      enregistrerEtat(true);
      fermerReglages();
      location.hash = "#/";
      router();
    }
  });

  document.addEventListener("keydown", (evenement) => {
    if (evenement.key === "Escape" && feuilleOuverte(reglages)) fermerReglages();
  });

  appliquerApparence();

  appliquerTaillePolice();

  // ---------------------------------------------------------------------------
  // Page d'accueil
  // ---------------------------------------------------------------------------

  // Une leçon non commencée n'affiche rien : le disait sur neuf cartes sur dix ne distinguait
  // rien et mangeait la largeur du titre. « En cours » doublait la ligne « 2 / 9 questions
  // complétées », qui est plus précise. Reste la coche de ce qui est fait, et le chevron qui
  // dit que la carte mène quelque part.
  const COCHE = `<svg class="carte-lecon__coche" viewBox="0 0 20 20" width="19" height="19"
      role="img" aria-label="Terminée"><path d="M3.5 10.5 L8 15 L16.5 5.5" fill="none"
      stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>`;

  const CHEVRON = `<svg class="carte-lecon__chevron" viewBox="0 0 20 20" width="17" height="17"
      aria-hidden="true" focusable="false"><path d="M7.5 4 L13.5 10 L7.5 16" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>`;

  async function afficherAccueil() {
    const liste = await chargerIndex();

    const cartes = liste.lecons
      .map((lecon) => {
        const statut = statutLecon(lecon);
        const nb = nbReponses(lecon);
        // Le nombre de questions ne dit rien d'utile tant qu'on n'a pas ouvert la leçon.
        // On n'affiche que l'avancement, quand il y en a un à montrer.
        // L'accord suit le nombre de questions complétées, pas le total.
        const detail =
          nb > 0 && lecon.nbQuestions
            ? `${nb} / ${lecon.nbQuestions} question${nb > 1 ? "s" : ""} complétée${nb > 1 ? "s" : ""}`
            : "";
        return html`
          <li>
            <a class="carte-lecon carte-lecon--${statut}" href="#/lecon/${lecon.numero}">
              <span class="carte-lecon__numero"
                ><span class="carte-lecon__mot visuellement-cache">Leçon</span
                ><span class="carte-lecon__chiffre">${lecon.numero}</span></span
              >
              <p class="carte-lecon__titre">${echapper(lecon.titre)}</p>
              <span class="carte-lecon__marque">
                ${statut === "terminee" ? COCHE : CHEVRON}
              </span>
              ${detail ? html`<p class="carte-lecon__detail">${detail}</p>` : ""}
            </a>
          </li>
        `;
      })
      .join("");

    // Pas de ligne « Ma progression » au-dessus de la liste : la coche de chaque leçon terminée
    // et le compte de questions sous chaque leçon disent déjà où l'on en est (retirée le
    // 21 novembre 2026, décision prise sur l'application elle-même).
    //
    // Trois écrans possibles, dans cet ordre : l'ordinateur est renvoyé vers le téléphone,
    // l'arrivée par QR code montre l'installation, sinon c'est la liste des leçons.
    if (surOrdinateur() && !derogationOrdinateur()) {
      afficherDans(ecranOrdinateur(), "");
      titreBarre.textContent = "";
      return;
    }
    if (arriveeParQrCode() && !dejaInstallee()) {
      afficherDans(ecranInstallation(), "Installer");
      titreBarre.textContent = "";
      return;
    }

    afficherDans(
      html`
        <h1 class="visuellement-cache">Cours découvertes</h1>
        ${stockageIndisponible ? avertissementStockage() : ""}
        ${inviteInstallation()}
        <ul class="liste-lecons">${cartes}</ul>
        <div class="annexes">
          <a class="annexe" href="#/notes">
            <p class="annexe__titre">Mes notes</p>
            <span class="annexe__marque">${CHEVRON}</span>
            <p class="annexe__detail">${resumeNotes(liste)}</p>
          </a>
          ${
            (liste.documents || []).length
              ? html`<a class="annexe" href="#/documents">
                  <p class="annexe__titre">${TITRE_DOCUMENTS}</p>
                  <span class="annexe__marque">${CHEVRON}</span>
                  <p class="annexe__detail">${liste.documents.map((d) => echapper(d.titre)).join(" · ")}</p>
                </a>`
              : ""
          }
          <a class="annexe" href="#/a-propos">
            <p class="annexe__titre">À propos du cours</p>
            <span class="annexe__marque">${CHEVRON}</span>
          </a>
        </div>
      `,
      ""
    );
    boutonPartage.hidden = false;
    barre.classList.add("barre--accueil");
  }

  function avertissementStockage() {
    return html`<div class="message message--erreur" role="alert">
      L’enregistrement sur cet appareil est bloqué (navigation privée ou stockage plein).
      Vos réponses ne seront pas conservées après fermeture.
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // Page d'une leçon
  // ---------------------------------------------------------------------------

  const ONGLETS = ["lecture", "versets", "questions"];

  async function afficherLecon(numero, ongletDemande) {
    const liste = await chargerIndex();
    const lecon = await chargerLecon(numero);
    // Une leçon sans verset à apprendre ni question de révision n'a pas d'onglet du tout.
    const disponibles = ONGLETS.filter(
      (nom) =>
        nom === "lecture" ||
        (nom === "versets" && lecon.versets_a_apprendre.length) ||
        (nom === "questions" && lecon.questions.length)
    );
    const onglet = disponibles.includes(ongletDemande) ? ongletDemande : "lecture";
    // Le bouton « leçon terminée » se place à la fin du dernier onglet, quel qu'il soit.
    const dernier = disponibles[disponibles.length - 1];
    const suivante = liste.lecons.find((l) => l.numero === numero + 1);

    // Sur Versets et Questions, le nom de la leçon est déjà dans la barre : on ne le répète
    // pas en grand. Un titre pour la lecture d'écran reste présent, sans occuper de place.
    const NOMS_ONGLETS = { lecture: "Lecture", versets: "Versets", questions: "Questions" };
    const enTete =
      onglet === "lecture"
        ? html`<p class="surtitre">Leçon ${lecon.numero} · pages ${echapper(lecon.pages)} du livret</p>
            <h1 class="page-titre">${echapper(lecon.titre)}</h1>`
        : html`<h1 class="visuellement-cache">
            Leçon ${lecon.numero} · ${echapper(lecon.titre)} — ${NOMS_ONGLETS[onglet]}
          </h1>`;

    // La barre d'onglets de cette leçon est-elle déjà à l'écran ? Alors on la garde.
    const rangeeEnPlace = zoneOnglets.querySelector(`.onglets[data-lecon="${numero}"]`);

    afficherDans(
      html`
        ${enTete}

        <section id="panneau-lecture" class="panneau" role="tabpanel" aria-labelledby="onglet-lecture" data-lecon="${numero}" ${onglet !== "lecture" ? "hidden" : ""}>
          ${rendreLecture(lecon, numero, dernier === "lecture", suivante)}
        </section>
        ${
          disponibles.includes("versets")
            ? html`<section id="panneau-versets" class="panneau" role="tabpanel" aria-labelledby="onglet-versets" ${onglet !== "versets" ? "hidden" : ""}>
                ${rendreVersets(lecon)}
              </section>`
            : ""
        }
        ${
          disponibles.includes("questions")
            ? html`<section id="panneau-questions" class="panneau" role="tabpanel" aria-labelledby="onglet-questions" ${onglet !== "questions" ? "hidden" : ""}>
                ${rendreQuestions(lecon, suivante)}
              </section>`
            : ""
        }
      `,
      `Leçon ${lecon.numero} · ${lecon.titre}`,
      { garderOnglets: Boolean(rangeeEnPlace) }
    );

    // Dans une leçon, la flèche de retour prend la place du logo, comme dans toute application.
    // Ouverte depuis « Mes notes », la leçon y ramène : c'est là qu'on était pendant le cours.
    const precedent = pile[rangCourant - 1] || "";
    zoneNavigation.innerHTML = /^\/notes(\/|$)/.test(precedent) ? retourNotes(precedent) : RETOUR;
    titreBarre.textContent = lecon.titre;
    peindreNotes();

    if (rangeeEnPlace) {
      // Même leçon : la rangée reste, seuls le choix et le compte des questions sont mis à jour.
      marquerOnglet(onglet);
      const compte = rangeeEnPlace.querySelector("#onglet-questions .onglet__compte");
      if (compte) compte.textContent = `${nbReponses(lecon)} / ${lecon.questions.length}`;
    } else {
      // Un seul onglet disponible : autant ne pas afficher de barre d'onglets.
      zoneOnglets.innerHTML =
        disponibles.length > 1
          ? html`<div class="onglets" role="tablist" aria-label="Parties de la leçon" data-lecon="${numero}"
                style="grid-template-columns: repeat(${disponibles.length}, 1fr)">
              ${boutonOnglet(numero, "lecture", "Lecture", "", onglet)}
              ${disponibles.includes("versets") ? boutonOnglet(numero, "versets", "Versets", `${lecon.versets_a_apprendre.length} à apprendre`, onglet) : ""}
              ${disponibles.includes("questions") ? boutonOnglet(numero, "questions", "Questions", `${nbReponses(lecon)} / ${lecon.questions.length}`, onglet) : ""}
            </div>`
          : "";
      const rangeeOnglets = zoneOnglets.querySelector(".onglets");
      if (rangeeOnglets) equiperBandeau(rangeeOnglets);
    }
    ajusterHauteurBarre();

    brancherVersets(principal);
    brancherQuestions(principal, lecon, suivante);

    // Après les onglets et le calcul de la hauteur de barre : la position à restaurer se mesure
    // sous la barre complète, sinon elle est décalée de la hauteur des onglets.
    reprendreLecture(`${numero}/${onglet}`);
    rendreOngletsRangeables();
    // Arrivée par « Voir dans la leçon » : le passage noté passe avant la reprise de lecture.
    if (noteAMontrer) {
      montrerNoteDansLecon(noteAMontrer);
      noteAMontrer = null;
    }
  }

  function boutonOnglet(numero, id, libelle, compte, actif) {
    // Un seul onglet est atteignable par tabulation : les flèches passent de l'un à l'autre,
    // comme l'attend un lecteur d'écran devant une barre d'onglets.
    return html`<button
      class="onglet"
      role="tab"
      id="onglet-${id}"
      aria-selected="${actif === id}"
      aria-controls="panneau-${id}"
      tabindex="${actif === id ? 0 : -1}"
      data-adresse="#/lecon/${numero}/${id}"
    >
      <span>${libelle}</span>
      ${compte ? html`<span class="onglet__compte">${compte}</span>` : ""}
    </button>`;
  }

  // --- Lecture ---------------------------------------------------------------

  function rendreLecture(lecon, numero, avecFinDeLecon, suivante) {
    // Un élément d'introduction est soit un paragraphe (chaîne), soit un bloc en marge.
    // Chaque bloc de texte porte son adresse (« i3 » : 4e élément de l'introduction ; « s2-5 » :
    // 6e bloc de la 3e partie). C'est à elle qu'une note rattache son passage (« Mes notes »).
    const intro = (lecon.introduction || [])
      .map((element, i) =>
        typeof element === "string" ? html`<p data-bloc="i${i}">${enrichir(element)}</p>` : rendreBloc(element, `i${i}`)
      )
      .join("");
    const sections = (lecon.sections || [])
      .map(
        (section, k) =>
          html`<h2>${enrichir(section.titre)}</h2>${section.blocs.map((bloc, j) => rendreBloc(bloc, `s${k}-${j}`)).join("")}`
      )
      .join("");
    return html`
      <article class="lecture">
        ${intro}
        ${sections}
        ${
          lecon.versets_a_apprendre.length
            ? html`<div class="lecture__fin">
                <p><strong>Versets à apprendre par cœur :</strong> ${lecon.versets_a_apprendre.map((v) => echapper(v.reference)).join(" et ")}</p>
                <a href="#/lecon/${numero}/versets">S’entraîner aux versets →</a>
              </div>`
            : ""
        }
      </article>
      ${avecFinDeLecon ? blocFinDeLecon(lecon, suivante) : ""}
    `;
  }

  // « adresse » : voir rendreLecture. Les titres et les figures n'en ont pas : on n'y note rien.
  function rendreBloc(bloc, adresse) {
    const a = adresse ? ` data-bloc="${adresse}"` : "";
    switch (bloc.type) {
      case "sous-titre":
        return html`<h3>${enrichir(bloc.texte)}</h3>`;
      case "paragraphe":
        return html`<p${a}>${enrichir(bloc.texte)}</p>`;
      case "citation":
        return html`<aside class="encart encart--citation"${a}>
          <p>${enrichir(bloc.texte)}</p>
          ${bloc.auteur ? html`<span class="encart__source">${echapper(bloc.auteur)}</span>` : ""}
        </aside>`;
      case "verset":
        return html`<aside class="encart encart--verset"${a}>
          <p>${enrichir(bloc.texte)}</p>
          <span class="encart__source">${echapper(bloc.reference)}</span>
        </aside>`;
      case "encadre":
        return html`<aside class="encart encart--encadre"${a}>
          ${bloc.titre ? html`<p class="encart__titre">${enrichir(bloc.titre)}</p>` : ""}
          <p>${enrichir(bloc.texte)}</p>
        </aside>`;
      case "liste":
        return html`<ul${a}>${bloc.elements.map((e) => html`<li>${enrichir(e)}</li>`).join("")}</ul>`;
      case "note":
        return html`<p class="note"${a}>${enrichir(bloc.texte)}</p>`;
      case "tableau":
        return html`<div class="tableau"${a}>
          ${bloc.titre ? html`<p class="tableau__titre">${enrichir(bloc.titre)}</p>` : ""}
          ${bloc.lignes
            .map(
              (ligne) => html`<div class="tableau__ligne">
                ${ligne
                  .map(
                    (cellule, i) => html`<div class="tableau__cellule">
                      <p class="tableau__entete">${enrichir(bloc.colonnes[i] || "")}</p>
                      <p>${enrichir(cellule)}</p>
                    </div>`
                  )
                  .join("")}
              </div>`
            )
            .join("")}
        </div>`;
      case "figure":
        return html`<figure class="figure">
          <button type="button" class="figure__bouton" aria-label="Agrandir l’image">
            <img src="${echapper(sourceFigure(bloc.fichier))}" alt="${echapper(bloc.texte)}" loading="lazy"
              ${bloc.largeur ? `width="${bloc.largeur}" height="${bloc.hauteur}"` : ""} />
            <span class="figure__loupe">${LOUPE}</span>
          </button>
          ${bloc.legende ? html`<figcaption>${enrichir(bloc.legende)}</figcaption>` : ""}
        </figure>`;
      default:
        return "";
    }
  }

  // --- Versets ---------------------------------------------------------------

  function premieresLettres(texte) {
    return texte.replace(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu, (mot) => mot[0]);
  }

  function rendreVersets(lecon) {
    const cartes = lecon.versets_a_apprendre
      .map(
        (verset, i) => html`
          <article class="verset-carte" data-texte="${echapper(verset.texte)}">
            <p class="verset-carte__reference">${echapper(verset.reference)}</p>
            <p class="verset-carte__texte" id="verset-texte-${i}">${echapper(verset.texte)}</p>
            ${verset.source === "Segond 1910" ? html`<p class="verset-carte__source">Texte : Bible Louis Segond 1910</p>` : ""}
            <div class="groupe-boutons" role="group" aria-label="Mode d’affichage du verset">
              <button class="bouton-choix" data-mode="complet" aria-pressed="true">Texte complet</button>
              <button class="bouton-choix" data-mode="lettres" aria-pressed="false">Premières lettres</button>
              <button class="bouton-choix" data-mode="cache" aria-pressed="false">Caché</button>
            </div>
          </article>
        `
      )
      .join("");
    return cartes;
  }

  function brancherVersets(racine) {
    racine.querySelectorAll(".verset-carte .groupe-boutons").forEach((groupe) => equiperBandeau(groupe));
    racine.querySelectorAll(".verset-carte").forEach((carte) => {
      const texteComplet = carte.dataset.texte;
      const zone = carte.querySelector(".verset-carte__texte");
      // Ce que le lecteur d'écran annonce à la place du verset, quand il est masqué.
      const remplacement = document.createElement("p");
      remplacement.className = "visuellement-cache";
      remplacement.textContent = "Verset masqué.";
      remplacement.hidden = true;
      zone.insertAdjacentElement("afterend", remplacement);
      carte.querySelectorAll(".bouton-choix").forEach((bouton) => {
        bouton.addEventListener("click", () => {
          carte.querySelectorAll(".bouton-choix").forEach((b) => b.setAttribute("aria-pressed", String(b === bouton)));
          zone.classList.remove("verset-carte__texte--cache", "verset-carte__texte--lettres");
          const mode = bouton.dataset.mode;
          if (mode === "complet") {
            zone.textContent = texteComplet;
            zone.removeAttribute("aria-hidden");
            remplacement.hidden = true;
          } else if (mode === "lettres") {
            zone.textContent = premieresLettres(texteComplet);
            zone.classList.add("verset-carte__texte--lettres");
            zone.removeAttribute("aria-hidden");
            remplacement.hidden = true;
          } else {
            // Le mode caché ne fait que flouter le texte : sans cela, un lecteur d'écran
            // lirait le verset entier et le mode ne cacherait rien à qui ne voit pas.
            zone.textContent = texteComplet;
            zone.classList.add("verset-carte__texte--cache");
            zone.setAttribute("aria-hidden", "true");
            remplacement.hidden = false;
          }
        });
      });
    });
  }

  // --- Questions -------------------------------------------------------------

  function rendreQuestions(lecon, suivante) {
    const numero = lecon.numero;
    const blocs = lecon.questions
      .map((question) => {
        const id = `question-${numero}-${question.numero}`;
        if (question.recitation) {
          const coche = etat.recitations[numero] ? "checked" : "";
          return html`
            <div class="question">
              <p class="question__intitule">
                <span class="question__numero" aria-hidden="true">${question.numero}</span>${enrichir(question.texte)}
              </p>
              <label class="case">
                <input type="checkbox" id="${id}" data-recitation="${numero}" ${coche} />
                <span>Je sais les réciter par cœur</span>
              </label>
            </div>
          `;
        }
        return html`
          <div class="question">
            <label class="question__intitule" for="${id}">
              <span class="question__numero" aria-hidden="true">${question.numero}</span>${enrichir(question.texte)}
            </label>
            <textarea id="${id}" data-lecon="${numero}" data-question="${question.numero}" rows="3"
              placeholder="Votre réponse…" autocomplete="off" autocapitalize="sentences">${echapper(reponse(numero, question.numero))}</textarea>
            <p class="question__etat" aria-live="polite"></p>
          </div>
        `;
      })
      .join("");

    return html`
      ${stockageIndisponible ? avertissementStockage() : ""}
      ${blocs}
      ${blocFinDeLecon(lecon, suivante)}
      <p class="pied">Vos réponses sont sauvegardées localement sur votre appareil.</p>
    `;
  }

  function blocFinDeLecon(lecon, suivante) {
    const terminee = Boolean(etat.terminees[lecon.numero]);
    return html`<div class="fin-lecon ${terminee ? "fin-lecon--terminee" : ""}" id="fin-lecon">
      ${rendreFinLecon(terminee, suivante, lecon.questions.length > 0)}
    </div>`;
  }

  function rendreFinLecon(terminee, suivante, avecQuestions) {
    if (terminee) {
      // Pas de lien vers la leçon suivante : le cours se suit à raison d'une leçon par semaine,
      // l'application n'a pas à pousser à enchaîner.
      return html`
        <p><strong>Leçon terminée.</strong></p>
        <button class="bouton-principal bouton-principal--secondaire" data-action="basculer-terminee">Marquer comme non terminée</button>
        <a class="lien-suivant" href="#/">← Toutes les leçons</a>
      `;
    }
    return html`
      <p>Quand vous avez lu la leçon${avecQuestions ? " et répondu aux questions" : ""}, marquez-la comme terminée.</p>
      <button class="bouton-principal" data-action="basculer-terminee">Marquer la leçon comme terminée</button>
    `;
  }

  function brancherQuestions(racine, lecon, suivante) {
    const numero = lecon.numero;

    racine.querySelectorAll("textarea[data-question]").forEach((zone) => {
      // L'enregistrement est silencieux : il est permanent et déjà expliqué ailleurs.
      // Seul un échec mérite d'être signalé, sinon les réponses seraient perdues sans le dire.
      const etatZone = zone.parentElement.querySelector(".question__etat");
      let minuterie = null;
      const enregistrer = () => {
        clearTimeout(minuterie);
        if (reponseEnAttente === enregistrer) reponseEnAttente = null;
        const ok = definirReponse(numero, Number(zone.dataset.question), zone.value);
        etatZone.textContent = ok ? "" : "Attention : cet appareil refuse d’enregistrer. Votre réponse sera perdue.";
        mettreAJourCompteur(lecon);
      };
      ajusterHauteur(zone);
      zone.addEventListener("input", () => {
        ajusterHauteur(zone);
        clearTimeout(minuterie);
        reponseEnAttente = enregistrer;
        minuterie = setTimeout(enregistrer, 400);
      });
      zone.addEventListener("blur", enregistrerReponseEnAttente);
    });

    const caseRecitation = racine.querySelector("input[data-recitation]");
    if (caseRecitation) {
      caseRecitation.addEventListener("change", () => {
        if (caseRecitation.checked) etat.recitations[numero] = true;
        else delete etat.recitations[numero];
        enregistrerEtat();
        mettreAJourCompteur(lecon);
      });
    }

    const zoneFin = racine.querySelector("#fin-lecon");
    zoneFin.addEventListener("click", (evenement) => {
      const bouton = evenement.target.closest("[data-action='basculer-terminee']");
      if (!bouton) return;
      if (etat.terminees[numero]) delete etat.terminees[numero];
      else etat.terminees[numero] = true;
      enregistrerEtat();
      const terminee = Boolean(etat.terminees[numero]);
      zoneFin.classList.toggle("fin-lecon--terminee", terminee);
      zoneFin.innerHTML = rendreFinLecon(terminee, suivante, lecon.questions.length > 0);
      zoneFin.querySelector("button").focus();
    });
  }

  function ajusterHauteur(zone) {
    zone.style.height = "auto";
    zone.style.height = `${Math.max(zone.scrollHeight, 88)}px`;
  }

  function mettreAJourCompteur(lecon) {
    const compteur = document.querySelector("#onglet-questions .onglet__compte");
    if (compteur) compteur.textContent = `${nbReponses(lecon)} / ${lecon.questions.length}`;
  }

  // ---------------------------------------------------------------------------
  // Documents de l'église : « La foi et les pratiques »
  // ---------------------------------------------------------------------------

  // Les mots de la couverture du PDF : « Documents définissant la foi et les pratiques de
  // l'Église Baptiste Toulouse Métropole », suivis de la liste des quatre documents.
  const TITRE_DOCUMENTS = "La foi et les pratiques";

  async function afficherDocuments() {
    const liste = await chargerIndex();
    const cartes = (liste.documents || [])
      .map(
        (d) => html`
          <li>
            <a class="carte-lecon carte-lecon--document" href="#/documents/${d.slug}">
              <span class="carte-lecon__numero"><span class="carte-lecon__chiffre">${d.numero}</span></span>
              <p class="carte-lecon__titre">${echapper(d.titre)}</p>
              <span class="carte-lecon__marque">${CHEVRON}</span>
            </a>
          </li>
        `
      )
      .join("");
    afficherDans(
      html`
        <p class="surtitre">Documents définissant</p>
        <h1 class="page-titre">${TITRE_DOCUMENTS}</h1>
        <p class="texte-doux documents__eglise">de l’Église Baptiste Toulouse Métropole</p>
        <ul class="liste-lecons">${cartes}</ul>
      `,
      TITRE_DOCUMENTS
    );
    zoneNavigation.innerHTML = RETOUR;
    titreBarre.textContent = TITRE_DOCUMENTS;
  }

  // Le texte d'un document est repris du PDF tel qu'imprimé. Ses références bibliques sont
  // abrégées, et le livre n'est donné qu'une fois pour toute une suite (« Mt 5.18, 24.35 ») :
  // le motif des leçons ne peut pas les reconnaître. Leur place dans le texte et leur passage
  // viennent donc d'un fichier préparé d'avance : « reperes » liste, pour ce texte,
  // [début, fin, nom du passage].
  function enrichirDocument(texte, reperes) {
    const simple = (t) => enrichir(t, { references: false });
    if (!reperes || !reperes.length) return simple(texte);
    let sortie = "";
    let curseur = 0;
    for (const [debut, fin, cle] of reperes) {
      // Le repère doit tomber dans le texte, à la suite du précédent : sinon le fichier ne
      // correspond plus à ce document, et mieux vaut un texte simple qu'un bouton mal placé.
      if (debut < curseur || fin > texte.length) return simple(texte);
      // La ponctuation collée à la référence l'accompagne, avant comme après, pour ne pas
      // tomber seule en bout de ligne (même règle que dans les leçons).
      let avant = texte.slice(curseur, debut);
      const ouvrante = /[(\[]$/.test(avant) ? avant.slice(-1) : "";
      if (ouvrante) avant = avant.slice(0, -1);
      const fermante = /^[.,;:!?»)\]]*/.exec(texte.slice(fin))[0];
      sortie +=
        simple(avant) +
        `<span class="ref-groupe">${echapper(ouvrante)}<button type="button" class="ref" data-ref="${echapper(cle)}" ` +
        `aria-label="Lire le passage ${echapper(cle)}">${echapper(texte.slice(debut, fin))}</button>${echapper(fermante)}</span>`;
      curseur = fin + fermante.length;
    }
    return sortie + simple(texte.slice(curseur));
  }

  function rendreBlocDocument(bloc, reperes, adresse) {
    switch (bloc.type) {
      case "sous-titre":
        return html`<h3>${enrichir(bloc.texte, { references: false })}</h3>`;
      case "paragraphe":
        return html`<p>${enrichirDocument(bloc.texte, reperes[adresse])}</p>`;
      case "liste":
        return html`<ul>${bloc.elements
          .map((e, k) => html`<li>${enrichirDocument(e, reperes[`${adresse}/${k}`])}</li>`)
          .join("")}</ul>`;
      default:
        return "";
    }
  }

  async function afficherDocument(slug) {
    const texte = await chargerDocument(slug);
    const reperes = (await chargerVersetsDocuments()).reperes[slug] || {};
    const sections = texte.sections
      .map(
        (section, s) =>
          html`<h2>${echapper(section.titre)}</h2>${section.blocs
            .map((b, i) => rendreBlocDocument(b, reperes, `${s}/${i}`))
            .join("")}`
      )
      .join("");
    afficherDans(
      html`
        <h1 class="page-titre">${echapper(texte.titre)}</h1>
        ${texte.soustitre ? html`<p class="texte-doux document__soustitre"><em>${echapper(texte.soustitre)}</em></p>` : ""}
        <section class="panneau">
          <article class="lecture lecture--document">${sections}</article>
        </section>
      `,
      texte.titre
    );

    // Un document est un écran de lecture, comme une leçon : l'application retient où l'on
    // s'est arrêté.
    zoneNavigation.innerHTML = RETOUR_DOCUMENTS;
    titreBarre.textContent = texte.titre;
    reprendreLecture(`document/${slug}`);
  }

  // ---------------------------------------------------------------------------
  // Page « À propos »
  // ---------------------------------------------------------------------------

  async function afficherAPropos() {
    const apropos = await chargerJson("contenu/a-propos.json");
    const paragraphes = apropos.paragraphes
      .map((element) => (typeof element === "string" ? html`<p>${enrichir(element)}</p>` : rendreBloc(element)))
      .join("");
    afficherDans(
      html`
        <h1 class="page-titre">À propos du cours</h1>
        <div class="a-propos">
          ${paragraphes}
          <p class="texte-doux">${echapper(apropos.edition)}</p>
        </div>
        <h2>Vos données</h2>
        <p>
          Vos réponses, vos notes, les versets cochés et les leçons terminées sont sauvegardés localement sur
          votre appareil. Ni l’église ni l’enseignant n’y ont accès. Si vous effacez les données de
          votre navigateur ou changez de téléphone, ils seront perdus.
        </p>
        <p>
          Installer le cours sur votre écran d’accueil les met à l’abri : sans installation, le
          navigateur peut faire le ménage de lui-même au bout de quelques jours sans visite.
        </p>
        <p class="pied">
          Version ${echapper(apropos.versionApplication)}<br />
          ${echapper(apropos.droits)}
        </p>
      `,
      "À propos"
    );

    // Comme une leçon, « À propos » est une sous-page : la flèche remplace le logo.
    zoneNavigation.innerHTML = RETOUR;
    titreBarre.textContent = "À propos du cours";

  }

  // ---------------------------------------------------------------------------
  // Partager le cours
  // ---------------------------------------------------------------------------

  // L'icône de la liste des leçons ouvre une fenêtre : le QR code pour le voisin de table,
  // l'adresse en toutes lettres, et un bouton pour l'envoyer. La section vivait au bas de
  // « À propos », après tout le texte de la préface : il fallait la chercher.
  const fenetrePartage = document.createElement("div");
  fenetrePartage.className = "feuille";
  fenetrePartage.hidden = true;
  fenetrePartage.innerHTML = `
    <div class="feuille__carte" role="dialog" aria-modal="true" aria-labelledby="partage-titre">
      <div class="feuille__entete">
        <p class="feuille__titre" id="partage-titre">Partager ce cours</p>
        <button type="button" class="feuille__fermer" aria-label="Fermer">${CROIX}</button>
      </div>
      <div class="feuille__corps feuille__corps--partage">
        <img class="partage__qr" alt="" width="240" height="240" />
        <p class="partage__adresse"></p>
        <button type="button" class="bouton-principal" data-partage=""></button>
        <p class="partage__etat" aria-live="polite"></p>
      </div>
    </div>`;
  document.body.appendChild(fenetrePartage);

  function ouvrirPartage() {
    // Le lien partagé porte « ?installer », comme le QR code : qui le reçoit arrive sur
    // l'écran d'installation. L'adresse affichée reste sans ce marqueur, plus lisible.
    const adresse = location.origin + location.pathname;
    const code = fenetrePartage.querySelector(".partage__qr");
    code.src = sourceQrCode();
    code.alt = `Code à scanner menant à ${adresse}`;
    fenetrePartage.querySelector(".partage__adresse").textContent = adresse;
    const bouton = fenetrePartage.querySelector("[data-partage]");
    bouton.dataset.partage = adresse + "?installer";
    bouton.textContent = navigator.share ? "Partager le lien" : "Copier le lien";
    fenetrePartage.querySelector(".partage__etat").textContent = "";
    montrerFeuille(fenetrePartage);
    neutraliserArrierePlan(true);
    fenetrePartage.querySelector(".feuille__fermer").focus();
  }

  function fermerPartage() {
    cacherFeuille(fenetrePartage);
    neutraliserArrierePlan(false);
    boutonPartage.focus();
  }

  boutonPartage.addEventListener("click", ouvrirPartage);
  fenetrePartage.addEventListener("click", (evenement) => {
    if (evenement.target === fenetrePartage || evenement.target.closest(".feuille__fermer")) fermerPartage();
  });
  document.addEventListener("keydown", (evenement) => {
    if (evenement.key === "Escape" && feuilleOuverte(fenetrePartage)) fermerPartage();
  });

  // Seule l'adresse du cours est partagée, jamais les réponses. Le menu de partage du téléphone
  // s'ouvre là où il existe ; ailleurs, le lien est copié.
  document.addEventListener("click", async (evenement) => {
    const bouton = evenement.target.closest("[data-partage]");
    if (!bouton) return;
    const lien = bouton.dataset.partage;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Cours découvertes", url: lien });
      } catch {
        /* partage annulé par la personne : rien à signaler */
      }
      return;
    }
    const etatPartage = document.querySelector(".partage__etat");
    try {
      await navigator.clipboard.writeText(lien);
      etatPartage.textContent = "Lien copié.";
    } catch {
      etatPartage.textContent = "Copie impossible : recopiez l’adresse ci-dessus.";
    }
  });

  // ---------------------------------------------------------------------------
  // Agrandissement des figures
  // ---------------------------------------------------------------------------

  const loupe = document.createElement("div");
  loupe.className = "loupe";
  loupe.hidden = true;
  loupe.setAttribute("role", "dialog");
  loupe.setAttribute("aria-modal", "true");
  loupe.setAttribute("aria-label", "Image agrandie");
  loupe.innerHTML =
    '<button type="button" class="loupe__fermer" aria-label="Fermer l’image agrandie">' + CROIX + '</button><img alt="" />';
  document.body.appendChild(loupe);
  let declencheur = null;

  function ouvrirLoupe(image) {
    const grande = loupe.querySelector("img");
    grande.src = image.src;
    grande.alt = image.alt;
    loupe.hidden = false;
    neutraliserArrierePlan(true);
    loupe.querySelector(".loupe__fermer").focus();
  }

  function fermerLoupe() {
    loupe.hidden = true;
    neutraliserArrierePlan(false);
    if (declencheur) declencheur.focus();
  }

  loupe.addEventListener("click", fermerLoupe);
  document.addEventListener("keydown", (evenement) => {
    if (evenement.key === "Escape" && !loupe.hidden) fermerLoupe();
  });
  principal.addEventListener("click", (evenement) => {
    const bouton = evenement.target.closest(".figure__bouton");
    if (!bouton) return;
    declencheur = bouton;
    ouvrirLoupe(bouton.querySelector("img"));
  });

  // ---------------------------------------------------------------------------
  // Lecture d'un verset sans quitter la leçon
  // ---------------------------------------------------------------------------

  const feuille = document.createElement("div");
  feuille.className = "feuille";
  feuille.hidden = true;
  feuille.innerHTML =
    '<div class="feuille__carte" role="dialog" aria-modal="true" aria-labelledby="feuille-titre">' +
    '<div class="feuille__entete"><p class="feuille__titre" id="feuille-titre"></p>' +
    '<button type="button" class="feuille__fermer" aria-label="Fermer">' + CROIX + '</button></div>' +
    '<div class="feuille__corps"></div>' +
    '<p class="feuille__source"></p></div>';
  document.body.appendChild(feuille);
  let refDeclencheur = null;

  function ouvrirVerset(reference) {
    // L'attribut porte la forme échappée : on la ramène à la clé du fichier des versets.
    const cle = reference.replace(/&amp;/g, "&");
    // Les passages des leçons d'abord, puis ceux des documents de l'église.
    const passages =
      (versets && versets.versets[cle]) || (versetsDocuments && versetsDocuments.passages[cle]) || [];
    feuille.querySelector(".feuille__titre").textContent = cle;
    // Le numéro n'est utile que si le passage en compte plusieurs. Il éviterait surtout de
    // dérouter là où la numérotation de la Segond diffère de celle du livret (Psaume 22).
    // Un passage à cheval sur deux chapitres (« 2 Corinthiens 6.14-7.1 ») porte aussi le
    // chapitre de chaque verset.
    const numeroter = passages.length > 1;
    feuille.querySelector(".feuille__corps").innerHTML = passages.length
      ? passages
          .map(
            (p) => html`<p class="passage">${
              numeroter ? html`<span class="passage__numero">${p.c ? `${p.c}.${p.v}` : p.v}</span>` : ""
            }${echapper(p.t)}</p>`
          )
          .join("")
      : html`<p class="texte-doux">Le texte de ce passage n’est pas disponible dans l’application.</p>`;
    feuille.querySelector(".feuille__source").textContent =
      (versets && versets.traduction) || (versetsDocuments && versetsDocuments.traduction) || "";
    montrerFeuille(feuille);
    neutraliserArrierePlan(true);
    feuille.querySelector(".feuille__fermer").focus();
  }

  function fermerVerset() {
    cacherFeuille(feuille);
    neutraliserArrierePlan(false);
    if (refDeclencheur) refDeclencheur.focus();
  }

  feuille.addEventListener("click", (evenement) => {
    if (evenement.target === feuille || evenement.target.closest(".feuille__fermer")) fermerVerset();
  });
  document.addEventListener("keydown", (evenement) => {
    if (evenement.key === "Escape" && feuilleOuverte(feuille)) fermerVerset();
  });
  principal.addEventListener("click", (evenement) => {
    const bouton = evenement.target.closest(".ref");
    if (!bouton) return;
    // Une référence peut se trouver dans l'intitulé d'une question, qui est un label :
    // sans cela, le clic ouvrirait la fenêtre et donnerait aussi le focus à la zone de saisie.
    evenement.preventDefault();
    refDeclencheur = bouton;
    ouvrirVerset(bouton.dataset.ref);
  });

  // ---------------------------------------------------------------------------
  // Mes notes : noter un passage d'une leçon
  // ---------------------------------------------------------------------------
  //
  // Demandé par Sébastien le 23 novembre 2026, sur le modèle du surligneur de Plateforme
  // Théologie, mais tourné vers l'étude et la rencontre du samedi. Dans l'onglet Lecture, le
  // participant sélectionne un passage ; une barre lui propose cinq choix, tous tirés du livret :
  //   - « Pas compris » : leçon 6, encadré « Je bute sur tel ou tel passage » ;
  //   - « Ma question » : à poser à la rencontre ;
  //   - « À vivre » : leçon 3, « Qu'est-ce que le Seigneur veut encore changer dans ma vie ? »,
  //     et leçon 6, « Qu'est-ce que je devrais changer dans ma vie ? » ;
  //   - « Pour prier » : leçon 6, « exprimer ce que j'ai lu en sujet de prière », et leçon 7 ;
  //   - « Ça m'encourage » : leçon 5, la foi des débutants ébranlée par l'épreuve.
  // Le passage se colore. « Mes notes » (accueil) range tout par leçon et ramène au passage.
  //
  // Un passage est retenu par son bloc (data-bloc, voir rendreLecture), sa place dans le texte
  // de ce bloc et son texte. Si le livret est corrigé et que la place bouge, le passage est
  // retrouvé par son texte. Comme tout le reste, les notes ne quittent jamais le téléphone.

  const ETIQUETTES = [
    { cle: "comprends", nom: "Pas compris", ecrire: false, invite: "Ce que je n’ai pas compris…" },
    { cle: "question", nom: "Ma question", ecrire: true, invite: "Ce que je veux demander…" },
    { cle: "vivre", nom: "À vivre", ecrire: true, invite: "Ce que je veux changer…" },
    { cle: "prier", nom: "Pour prier", ecrire: true, invite: "Ma prière…" },
    { cle: "encourage", nom: "Ça m’encourage", ecrire: false, invite: "Pourquoi ce passage m’encourage…" },
  ];
  const etiquetteDe = (cle) => ETIQUETTES.find((e) => e.cle === cle) || ETIQUETTES[1];

  // Une note retirée dans une autre copie ouverte de l'application peut laisser un objet vide
  // après la fusion des enregistrements (reporterChangements) : seules les notes complètes comptent.
  // Un enregistrement abîmé (type inconnu, leçon écrite en lettres ou qui n'existe pas) ne doit
  // pas fausser les compteurs : chaque note compte là où « Mes notes » peut la montrer.
  function toutesLesNotes() {
    return Object.entries(etat.notes || {})
      .filter(([, n]) => n && typeof n.texte === "string" && n.texte && Number.isInteger(Number(n.lecon)))
      .map(([id, n]) => ({ ...n, id, lecon: Number(n.lecon), etiquette: etiquetteDe(n.etiquette).cle }))
      .filter((n) => !index || index.lecons.some((l) => l.numero === n.lecon));
  }
  // Une note retirée n'est pas effacée : elle porte la date de son retrait (« retiree ») et passe
  // dans « Récemment supprimées » pendant 30 jours, comme dans Notes d'Apple (support Apple,
  // PH21257 : « up to 30 days before they're permanently removed »). Demandé par Sébastien le
  // 25 novembre 2026. Partout ailleurs, elle n'existe plus.
  const DUREE_CORBEILLE = 30 * 24 * 60 * 60 * 1000;
  // Seule une vraie date compte : une valeur abîmée laisse la note parmi les notes actives.
  const estRetiree = (n) => typeof n.retiree === "number" && Number.isFinite(n.retiree) && n.retiree > 0;
  function notesValides() {
    return toutesLesNotes().filter((n) => !estRetiree(n));
  }
  function notesRetirees() {
    return toutesLesNotes()
      .filter(estRetiree)
      .sort((a, b) => b.retiree - a.retiree);
  }
  // À l'ouverture : les notes retirées depuis plus de 30 jours sont effacées pour de bon.
  function viderCorbeilleAncienne() {
    const limite = Date.now() - DUREE_CORBEILLE;
    let change = false;
    for (const [id, n] of Object.entries(etat.notes || {})) {
      if (n && estRetiree(n) && n.retiree < limite) {
        delete etat.notes[id];
        change = true;
      }
    }
    if (change) enregistrerEtat();
  }
  viderCorbeilleAncienne();

  // Place d'un bloc dans la leçon : l'introduction, puis les parties dans l'ordre.
  function rangDuBloc(adresse) {
    const intro = /^i(\d+)$/.exec(adresse || "");
    if (intro) return [0, Number(intro[1]), 0];
    const partie = /^s(\d+)-(\d+)$/.exec(adresse || "");
    return partie ? [1, Number(partie[1]), Number(partie[2])] : [2, 0, 0];
  }

  function comparerPlaces(a, b) {
    const x = rangDuBloc(a.bloc);
    const y = rangDuBloc(b.bloc);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return a.debut - b.debut;
  }

  // La ligne « Mes notes » de l'accueil : ce qu'il y a dedans, ou comment commencer.
  function resumeNotes() {
    const notes = notesValides();
    if (!notes.length) return "Sélectionnez un passage dans une leçon pour le noter.";
    const lecons = [...new Set(notes.map((n) => n.lecon))].sort((a, b) => a - b);
    const nombre = `${notes.length} note${notes.length > 1 ? "s" : ""}`;
    const ou =
      lecons.length > 1
        ? `leçons ${lecons.slice(0, -1).join(", ")} et ${lecons[lecons.length - 1]}`
        : `leçon ${lecons[0]}`;
    return `${nombre} · ${ou}`;
  }

  const espacesSimples = (texte) => texte.replace(/\s+/g, " ").trim();

  // --- Le texte d'un bloc, et une place dans ce texte ------------------------
  // Le nom d'une note, lu aux lecteurs d'écran au début du passage coloré, n'appartient pas au
  // texte de la leçon : marqué « hors-texte », il est ignoré de tous ces calculs.

  function noeudsTexte(bloc) {
    const marcheur = document.createTreeWalker(bloc, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.parentElement && n.parentElement.closest(".hors-texte") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const noeuds = [];
    while (marcheur.nextNode()) noeuds.push(marcheur.currentNode);
    return noeuds;
  }

  function texteDuBloc(bloc) {
    return noeudsTexte(bloc)
      .map((n) => n.data)
      .join("");
  }

  // Nombre de caractères du bloc avant le point (noeud, décalage) d'une sélection.
  function positionDans(bloc, noeud, decalage) {
    const plage = document.createRange();
    plage.setStart(bloc, 0);
    plage.setEnd(noeud, decalage);
    const copie = plage.cloneContents();
    copie.querySelectorAll(".hors-texte").forEach((e) => e.remove());
    return copie.textContent.length;
  }

  // Colore les caractères [debut, fin) du bloc, morceau par morceau : un passage peut traverser
  // un mot en italique ou une référence biblique.
  function envelopper(bloc, debut, fin, note) {
    const marques = [];
    let cumul = 0;
    for (const noeud of noeudsTexte(bloc)) {
      const d = cumul;
      const f = cumul + noeud.data.length;
      cumul = f;
      if (f <= debut || d >= fin) continue;
      let morceau = noeud;
      const a = Math.max(debut, d) - d;
      const b = Math.min(fin, f) - d;
      if (b < morceau.data.length) morceau.splitText(b);
      if (a > 0) morceau = morceau.splitText(a);
      // Le blanc de mise en page entre deux paragraphes d'un encadré (un retour à la ligne) ne se
      // colore pas : enveloppé, il ajouterait une ligne vide. L'espace entre deux mots, si.
      if (!morceau.data.trim() && morceau.data.includes("\n")) continue;
      const marque = document.createElement("mark");
      marque.className = `note-passage note--${note.etiquette}`;
      marque.dataset.note = note.id;
      morceau.replaceWith(marque);
      marque.append(morceau);
      marques.push(marque);
    }
    if (marques.length) {
      const nom = document.createElement("span");
      nom.className = "visuellement-cache hors-texte";
      nom.textContent = `Note « ${etiquetteDe(note.etiquette).nom} » : `;
      marques[0].prepend(nom);
      // Le premier morceau du passage s'atteint au clavier et se lit comme un bouton : sans
      // cela, au clavier ou avec un lecteur d'écran, on ne pouvait ni modifier ni retirer une
      // note (agent de test, 25 novembre 2026). Entrée ou Espace l'ouvrent (voir plus bas).
      marques[0].tabIndex = 0;
      marques[0].setAttribute("role", "button");
    }
  }

  function effacerMarques(racine) {
    racine.querySelectorAll("mark.note-passage").forEach((marque) => {
      marque.querySelectorAll(".hors-texte").forEach((e) => e.remove());
      marque.replaceWith(...marque.childNodes);
    });
    racine.querySelectorAll("[data-bloc]").forEach((bloc) => bloc.normalize());
  }

  // L'occurrence du passage la plus proche de sa place d'origine, ou -1.
  function trouverPres(texte, cherche, pres) {
    let meilleure = -1;
    for (let i = texte.indexOf(cherche); i >= 0; i = texte.indexOf(cherche, i + 1)) {
      if (meilleure < 0 || Math.abs(i - pres) < Math.abs(meilleure - pres)) meilleure = i;
    }
    return meilleure;
  }

  function situerNote(article, note) {
    // Comparé un à un plutôt que glissé dans un sélecteur : une valeur abîmée dans
    // l'enregistrement (un guillemet) faisait planter toute la leçon (agent de test).
    const bloc = [...article.querySelectorAll("[data-bloc]")].find((b) => b.dataset.bloc === note.bloc);
    if (bloc) {
      const texte = texteDuBloc(bloc);
      if (texte.slice(note.debut, note.fin) === note.texte) return { bloc, debut: note.debut, fin: note.fin };
      const i = trouverPres(texte, note.texte, note.debut);
      if (i >= 0) return { bloc, debut: i, fin: i + note.texte.length };
    }
    for (const autre of article.querySelectorAll("[data-bloc]")) {
      const i = texteDuBloc(autre).indexOf(note.texte);
      if (i >= 0) return { bloc: autre, debut: i, fin: i + note.texte.length };
    }
    return null;
  }

  function articleDeLecture() {
    return principal.querySelector("#panneau-lecture .lecture");
  }

  // Colore dans la leçon affichée tous les passages notés.
  function peindreNotes() {
    const article = articleDeLecture();
    if (!article) return;
    const numero = Number(article.closest("[data-lecon]").dataset.lecon);
    effacerMarques(article);
    for (const note of notesValides()) {
      if (note.lecon !== numero) continue;
      const place = situerNote(article, note);
      if (place) envelopper(place.bloc, place.debut, place.fin, note);
    }
  }

  // --- La sélection d'un passage ---------------------------------------------
  // Trois règles, reprises du surligneur de Plateforme Théologie (24 octobre 2026) : un seul
  // bloc (la sélection s'arrête à la fin de celui où elle commence), des mots entiers, et jamais
  // deux notes l'une sur l'autre : un passage qui en touche un autre ouvre celui-là.
  function lireSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const plage = selection.getRangeAt(0);
    const article = articleDeLecture();
    if (!article || article.closest("[hidden]")) return null;
    const elementDe = (n) => (n.nodeType === 1 ? n : n.parentElement);
    const bloc = elementDe(plage.startContainer) && elementDe(plage.startContainer).closest("[data-bloc]");
    if (!bloc || !article.contains(bloc)) return null;

    const texte = texteDuBloc(bloc);
    let debut = positionDans(bloc, plage.startContainer, plage.startOffset);
    let fin = bloc.contains(plage.endContainer) ? positionDans(bloc, plage.endContainer, plage.endOffset) : texte.length;
    while (debut < fin && /\s/.test(texte[debut])) debut++;
    while (fin > debut && /\s/.test(texte[fin - 1])) fin--;
    const lettre = (c) => c !== undefined && /[\p{L}\p{N}’'-]/u.test(c);
    while (debut > 0 && lettre(texte[debut - 1]) && lettre(texte[debut])) debut--;
    while (fin < texte.length && lettre(texte[fin]) && lettre(texte[fin - 1])) fin++;
    if (fin - debut < 2) return null;

    for (const marque of bloc.querySelectorAll("mark.note-passage")) {
      const md = positionDans(bloc, marque, 0);
      const mf = md + texteDuBloc(marque).length;
      if (md < fin && mf > debut) return { existante: marque.dataset.note };
    }
    return {
      lecon: Number(article.closest("[data-lecon]").dataset.lecon),
      adresse: bloc.dataset.bloc,
      debut,
      fin,
      texte: texte.slice(debut, fin),
      plage,
    };
  }

  // --- La barre des cinq choix -----------------------------------------------
  // En bas de l'écran, comme sur Plateforme Théologie : au-dessus du passage, le menu de l'iPhone
  // (« Copier », « Rechercher ») la recouvrait quand le passage était bas dans l'écran (mesuré
  // sur iPhone virtuel, iOS 27 et 26.5, le 23 novembre 2026).
  const barreNotes = document.createElement("div");
  barreNotes.className = "barre-notes";
  barreNotes.setAttribute("role", "toolbar");
  barreNotes.setAttribute("aria-label", "Noter ce passage");
  barreNotes.hidden = true;
  barreNotes.innerHTML = ETIQUETTES.map(
    (e) =>
      `<button type="button" class="barre-notes__choix" data-etiquette="${e.cle}">` +
      `<span class="pastille pastille--${e.cle}" aria-hidden="true"></span>${e.nom}</button>`
  ).join("");
  document.body.appendChild(barreNotes);

  let choixEnCours = null; // la sélection que la barre propose de noter

  function montrerBarreNotes(plage) {
    barreNotes.hidden = false;
    // Le passage ne doit pas finir caché sous la barre : la page remonte juste ce qu'il faut.
    const passage = plage.getBoundingClientRect();
    const hautBarre = barreNotes.getBoundingClientRect().top;
    if (passage.bottom > hautBarre - 16) window.scrollBy(0, passage.bottom - hautBarre + 32);
  }

  function cacherBarreNotes() {
    barreNotes.hidden = true;
    choixEnCours = null;
  }

  function examinerSelection() {
    // Une fenêtre est ouverte (sa zone de saisie a sa propre sélection) : rien à proposer.
    if (document.body.style.overflow === "hidden") return;
    const choix = lireSelection();
    if (!choix) {
      cacherBarreNotes();
      return;
    }
    if (choix.existante) {
      window.getSelection().removeAllRanges();
      cacherBarreNotes();
      ouvrirNote(choix.existante);
      return;
    }
    choixEnCours = choix;
    montrerBarreNotes(choix.plage);
  }

  autourDesFeuilles = {
    ouverture: cacherBarreNotes,
    // Après que l'arrière-plan est rendu (neutraliserArrierePlan suit cacherFeuille).
    fermeture: () => setTimeout(examinerSelection, 0),
  };

  // À la souris, la barre attend qu'on relâche le bouton ; au doigt et au clavier, qu'elle ne
  // bouge plus (Plateforme Théologie, 24 octobre 2026 : elle suivait la sélection en cours).
  const auDoigt = window.matchMedia("(pointer: coarse)");
  let attenteSelection = null;
  let sourisEnfoncee = false;
  document.addEventListener(
    "pointerdown",
    (evenement) => {
      if (evenement.pointerType === "mouse" && evenement.button === 0 && !barreNotes.contains(evenement.target))
        sourisEnfoncee = true;
    },
    true
  );
  window.addEventListener(
    "pointerup",
    (evenement) => {
      if (evenement.pointerType !== "mouse" || !sourisEnfoncee) return;
      sourisEnfoncee = false;
      clearTimeout(attenteSelection);
      attenteSelection = setTimeout(examinerSelection, 10);
    },
    true
  );
  document.addEventListener("selectionchange", () => {
    clearTimeout(attenteSelection);
    if (sourisEnfoncee) {
      if (!barreNotes.hidden) cacherBarreNotes();
      return;
    }
    attenteSelection = setTimeout(examinerSelection, auDoigt.matches ? 350 : 120);
  });

  // Sur iPhone, avec une sélection et le menu d'Apple ouverts, le premier toucher d'un bouton se
  // perdait (Plateforme Théologie, 21 octobre 2026) : le choix agit dès que le doigt se lève, et
  // le clic que l'iPhone envoie ensuite, tombé là où la barre était, est ignoré.
  let doigtSurChoix = null;
  let ignorerClicJusqua = 0;
  barreNotes.addEventListener("pointerdown", (evenement) => {
    const bouton = evenement.target.closest("button");
    if (!bouton) return;
    evenement.preventDefault(); // garde la sélection : sans cela, elle disparaît avant le choix
    doigtSurChoix = evenement.pointerType === "touch" ? bouton : null;
  });
  barreNotes.addEventListener("pointerup", (evenement) => {
    const bouton = evenement.target.closest("button");
    if (doigtSurChoix && bouton === doigtSurChoix) {
      evenement.preventDefault();
      ignorerClicJusqua = performance.now() + 700;
      noter(bouton.dataset.etiquette);
    }
    doigtSurChoix = null;
  });
  barreNotes.addEventListener("click", (evenement) => {
    const bouton = evenement.target.closest("button");
    if (!bouton || performance.now() < ignorerClicJusqua) return;
    noter(bouton.dataset.etiquette);
  });
  document.addEventListener(
    "click",
    (evenement) => {
      if (performance.now() >= ignorerClicJusqua || barreNotes.contains(evenement.target)) return;
      ignorerClicJusqua = 0;
      evenement.stopPropagation();
      evenement.preventDefault();
    },
    true
  );

  function noter(cle) {
    const choix = choixEnCours;
    if (!choix) return;
    const id = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    if (!estObjet(etat.notes)) etat.notes = {};
    etat.notes[id] = {
      lecon: choix.lecon,
      bloc: choix.adresse,
      debut: choix.debut,
      fin: choix.fin,
      texte: choix.texte,
      etiquette: cle,
      ecrit: "",
      cree: Date.now(),
    };
    const ok = enregistrerEtat();
    const auClavier = barreNotes.contains(document.activeElement);
    const selection = window.getSelection();
    if (selection) selection.removeAllRanges();
    cacherBarreNotes();
    peindreNotes();
    const etiquette = etiquetteDe(cle);
    const REFUS = "Attention : cet appareil refuse d’enregistrer. Cette note sera perdue.";
    if (etiquette.ecrire) {
      ouvrirNote(id, { ecrire: true });
      // Dans la fenêtre, et après son ouverture : le message du bas, lui, s'effaçait aussitôt.
      if (!ok) fenetreNote.querySelector(".note-fenetre__etat").textContent = REFUS;
      return;
    }
    if (!ok) annoncer(REFUS);
    else annoncer(`Noté : ${etiquette.nom}`, { libelle: "Annuler", faire: () => retirerNote(id) });
    // Au clavier, la barre disparue, on reste sur le passage qu'on vient de noter.
    if (auClavier) rendreFocusAuPassage(id);
  }

  // Le passage coloré d'une note reprend le focus ; s'il n'existe plus, le texte de la leçon.
  function rendreFocusAuPassage(id) {
    const marque = principal.querySelector(`mark.note-passage[tabindex="0"][data-note="${CSS.escape(id)}"]`);
    (marque || principal).focus({ preventScroll: true });
  }

  function retirerNote(id) {
    delete etat.notes[id];
    enregistrerEtat();
    peindreNotes();
  }

  document.addEventListener("keydown", (evenement) => {
    if (evenement.key === "Escape" && !barreNotes.hidden) cacherBarreNotes();
  });

  // --- Le petit message du bas -----------------------------------------------
  // Dit ce qui vient d'être fait, avec « Annuler » quand c'est possible. Il reste dans la page,
  // vide, pour que les lecteurs d'écran annoncent chaque nouveau message (role="status").
  const annonce = document.createElement("div");
  annonce.className = "annonce";
  annonce.setAttribute("role", "status");
  annonce.inert = true;
  annonce.innerHTML = '<span class="annonce__texte"></span><button type="button" class="annonce__bouton" hidden></button>';
  document.body.appendChild(annonce);
  let minuterieAnnonce = null;
  let actionAnnonce = null;

  // action : { libelle, faire, fin?, garder? }. « fin » est appelée quand le message s'en va
  // sans avoir servi ; « garder » le laisse en place quand on change d'écran (un retrait de
  // note doit rester annulable même si l'on quitte la liste : agent de test, 25 novembre 2026).
  let finAnnonce = null;
  let annonceGardee = false;
  function annoncer(texte, action) {
    clearTimeout(minuterieAnnonce);
    if (finAnnonce && (!action || action.fin !== finAnnonce)) finAnnonce();
    finAnnonce = action && action.fin ? action.fin : null;
    annonceGardee = Boolean(action && action.garder);
    annonce.querySelector(".annonce__texte").textContent = texte;
    const bouton = annonce.querySelector(".annonce__bouton");
    actionAnnonce = action ? action.faire : null;
    bouton.hidden = !action;
    if (action) bouton.textContent = action.libelle;
    annonce.inert = false;
    annonce.classList.add("annonce--visible");
    // Avec une action (« Annuler ») : 4 s, choisies par Sébastien le 25 novembre 2026 parmi 4, 6
    // et 8 s ; rien n'est perdu s'il disparaît (« Récemment supprimées »).
    minuterieAnnonce = setTimeout(cacherAnnonce, action ? 4000 : 3500);
  }

  function cacherAnnonce({ sansFin = false } = {}) {
    clearTimeout(minuterieAnnonce);
    annonce.classList.remove("annonce--visible");
    annonce.inert = true;
    actionAnnonce = null;
    annonceGardee = false;
    const fin = finAnnonce;
    finAnnonce = null;
    if (fin && !sansFin) fin();
  }

  annonce.querySelector(".annonce__bouton").addEventListener("click", () => {
    const faire = actionAnnonce;
    cacherAnnonce({ sansFin: true });
    if (faire) faire();
  });

  // --- La fenêtre d'une note -------------------------------------------------
  // Ouverte en notant « Ma question », « À vivre » ou « Pour prier », en touchant un passage
  // coloré, ou par « Modifier » dans « Mes notes ». On y change le choix, on y écrit, on y
  // retire la note.
  const fenetreNote = document.createElement("div");
  fenetreNote.className = "feuille feuille--note";
  fenetreNote.hidden = true;
  fenetreNote.innerHTML = `
    <div class="feuille__carte" role="dialog" aria-modal="true" aria-labelledby="note-titre">
      <div class="feuille__entete">
        <p class="feuille__titre" id="note-titre"></p>
        <!-- « OK » en haut à droite, comme les fenêtres de l'iPhone (Apple, Human Interface
             Guidelines, « Sheets ») : ce qu'on écrit est enregistré pendant la frappe, comme dans
             Notes ou Google Keep, et « OK » ferme. Il remplace la croix, qui laissait croire
             qu'il fallait encore enregistrer (Sébastien, 25 novembre 2026). -->
        <button type="button" class="feuille__fermer feuille__ok">OK</button>
      </div>
      <div class="feuille__corps feuille__corps--note">
        <p class="note-fenetre__lecon"></p>
        <blockquote class="note-fenetre__passage"></blockquote>
        <!-- Seulement quand la note est ouverte depuis « Mes notes » : dans la leçon, on y est. -->
        <a class="note-fenetre__voir" href="#/" data-aller-note="" hidden>Voir dans la leçon</a>
        <!-- La zone d'écriture d'abord : plus bas, le clavier du téléphone la recouvrirait. -->
        <label class="visuellement-cache" for="note-ecrit">Ce que j’écris</label>
        <textarea id="note-ecrit" class="note-fenetre__ecrit" rows="3" autocomplete="off" autocapitalize="sentences"></textarea>
        <p class="question__etat note-fenetre__etat" aria-live="polite"></p>
        <!-- Lu par les lecteurs d'écran seulement : à l'écran, le titre de la fenêtre dit déjà le
             type, et les pastilles se comprennent seules (Sébastien, 25 novembre 2026). -->
        <p class="visuellement-cache" id="note-choix-titre">Type de note</p>
        <div class="note-fenetre__choix" role="group" aria-labelledby="note-choix-titre">
          ${ETIQUETTES.map(
            (e) =>
              `<button type="button" class="choix-note" data-choix-etiquette="${e.cle}" aria-pressed="false">` +
              `<span class="pastille pastille--${e.cle}" aria-hidden="true"></span>${e.nom}</button>`
          ).join("")}
        </div>
        <div class="note-fenetre__retrait"></div>
      </div>
    </div>`;
  document.body.appendChild(fenetreNote);

  const zoneEcrit = fenetreNote.querySelector(".note-fenetre__ecrit");
  const zoneRetrait = fenetreNote.querySelector(".note-fenetre__retrait");
  const BOUTON_RETRAIT = '<button type="button" class="lien-danger" data-retirer="demander">Retirer cette note</button>';
  const CONFIRMATION_RETRAIT =
    '<p class="reglage__avertissement">Retirer cette note ? Le passage ne sera plus coloré.</p>' +
    '<div class="reglage__confirmation">' +
    '<button type="button" class="bouton-principal bouton-principal--secondaire" data-retirer="annuler">Annuler</button>' +
    '<button type="button" class="bouton-principal bouton-danger" data-retirer="confirmer">Oui, retirer</button>' +
    "</div>";

  // Le clavier du téléphone réduit la partie visible de l'écran sans changer la mise en page :
  // calée sur la page entière, la fenêtre était poussée vers le haut, titre et passage hors de
  // l'écran, un bout de leçon visible dessous (iPhone virtuel, iOS 27, 23 novembre 2026). Elle
  // suit donc la partie visible, comme le recommande MDN (« VisualViewport » : « positioning
  // elements relative to what's shown on-screen »).
  const zoneVisible = window.visualViewport || null;
  function calerSurZoneVisible() {
    if (!zoneVisible) return;
    fenetreNote.style.top = `${zoneVisible.offsetTop}px`;
    fenetreNote.style.height = `${zoneVisible.height}px`;
    fenetreNote.style.bottom = "auto";
  }
  function suivreZoneVisible(actif) {
    if (!zoneVisible) return;
    const geste = actif ? "addEventListener" : "removeEventListener";
    zoneVisible[geste]("resize", calerSurZoneVisible);
    zoneVisible[geste]("scroll", calerSurZoneVisible);
    if (actif) calerSurZoneVisible();
    else fenetreNote.style.top = fenetreNote.style.height = fenetreNote.style.bottom = "";
  }

  // Pendant que la fenêtre est ouverte, la page dessous est immobilisée à sa place. Sans cela,
  // l'iPhone la faisait défiler à l'arrivée du clavier pour montrer la zone de saisie : toute
  // la page sautait à l'ouverture, puis revenait d'un coup à la fermeture (vidéo du 25 novembre
  // 2026, relevé par Sébastien : « j'aime pas trop quand ça s'ouvre »). « overflow: hidden »
  // ne suffit pas sur iPhone : le corps de la page est fixé, décalé de sa hauteur de
  // défilement, puis rendu à sa place en refermant (pratique relevée sur les forums
  // développeurs d'Apple et les rapports WebKit 176896 et 153224).
  let pageFigee = null; // hauteur de défilement de la page immobilisée, ou null
  function figerPage() {
    if (pageFigee !== null) return;
    pageFigee = window.scrollY;
    Object.assign(document.body.style, { position: "fixed", top: `-${pageFigee}px`, left: "0", right: "0" });
  }
  function libererPage() {
    if (pageFigee === null) return;
    const y = pageFigee;
    Object.assign(document.body.style, { position: "", top: "", left: "", right: "" });
    derniereY = y; // la barre du haut ne prend pas ce retour pour un défilement
    window.scrollTo(0, y);
    pageFigee = null;
  }

  let noteOuverte = null;
  let noteAMontrer = null; // posée par « Voir dans la leçon », lue par afficherLecon

  // Titre, couleur du passage, choix enfoncé et invitation suivent le choix de la note.
  function habillerFenetreNote(note) {
    const etiquette = etiquetteDe(note.etiquette);
    fenetreNote.querySelector(".feuille__titre").textContent = etiquette.nom;
    const passage = fenetreNote.querySelector(".note-fenetre__passage");
    passage.className = `note-fenetre__passage note-fenetre__passage--${etiquette.cle}`;
    for (const bouton of fenetreNote.querySelectorAll("[data-choix-etiquette]"))
      bouton.setAttribute("aria-pressed", String(bouton.dataset.choixEtiquette === etiquette.cle));
    zoneEcrit.placeholder = etiquette.invite;
  }

  // Ouverte depuis « Mes notes » (toucher une ligne, comme dans Notes ou YouVersion, demandé par
  // Sébastien le 25 novembre 2026) : la fenêtre propose « Voir dans la leçon », et la liste est
  // remise à jour en la fermant si la note a changé (texte, type, retrait).
  let noteDepuisListe = null; // { id, avant } ou null
  function ouvrirNote(id, { ecrire = false, depuisListe = false, aussitot = false } = {}) {
    const note = etat.notes[id];
    if (!note || !note.texte) return;
    cacherAnnonce();
    noteOuverte = id;
    noteDepuisListe = depuisListe ? { id, avant: JSON.stringify(note) } : null;
    const voir = fenetreNote.querySelector(".note-fenetre__voir");
    voir.hidden = !depuisListe;
    voir.href = `#/lecon/${Number(note.lecon)}/lecture`;
    voir.dataset.allerNote = id;
    const lecon = index && index.lecons.find((l) => l.numero === Number(note.lecon));
    fenetreNote.querySelector(".note-fenetre__lecon").textContent = lecon
      ? `Leçon ${lecon.numero} · ${lecon.titre}`
      : `Leçon ${note.lecon}`;
    fenetreNote.querySelector(".note-fenetre__passage").textContent = espacesSimples(note.texte);
    zoneEcrit.value = note.ecrit || "";
    fenetreNote.querySelector(".note-fenetre__etat").textContent = "";
    zoneRetrait.innerHTML = BOUTON_RETRAIT;
    habillerFenetreNote(note);
    figerPage();
    suivreZoneVisible(true);
    montrerFeuille(fenetreNote, { aussitot });
    neutraliserArrierePlan(true);
    ajusterHauteur(zoneEcrit);
    (ecrire ? zoneEcrit : fenetreNote.querySelector(".feuille__fermer")).focus({ preventScroll: true });
  }

  function fermerNote({ rendreFocus = true, aussitot = false } = {}) {
    enregistrerReponseEnAttente();
    const id = noteOuverte;
    // La zone d'écriture quitte le focus avant que la fenêtre se cache : cachée avec le clavier
    // encore ouvert, elle le gardait, et le toucher suivant servait à le fermer (perdu).
    if (document.activeElement === zoneEcrit) zoneEcrit.blur();
    suivreZoneVisible(false);
    cacherFeuille(fenetreNote, { aussitot });
    neutraliserArrierePlan(false);
    libererPage();
    noteOuverte = null;
    const depuisListe = noteDepuisListe;
    noteDepuisListe = null;
    if (!rendreFocus) return;
    if (!depuisListe) {
      rendreFocusAuPassage(id);
      return;
    }
    // Retour à la liste : reconstruite seulement si la note a changé, à la même hauteur ;
    // le focus revient sur sa ligne (ou sur le titre si elle a quitté ce dossier).
    const y = window.scrollY;
    const changee = JSON.stringify(etat.notes[id]) !== depuisListe.avant;
    const lignes = () => [...principal.querySelectorAll("a.ligne-note[data-ouvrir-note]")];
    const rang = lignes().findIndex((a) => a.dataset.ouvrirNote === id);
    // La ligne de la note ; si elle a quitté le dossier, celle qui a pris sa place.
    const remettreFocus = () => {
      const toutes = lignes();
      const ligne = toutes.find((a) => a.dataset.ouvrirNote === id) || toutes[Math.min(Math.max(rang, 0), toutes.length - 1)];
      if (ligne) ligne.focus({ preventScroll: true });
    };
    if (!changee) {
      remettreFocus();
      return;
    }
    rafraichirNotes().then(() => {
      window.scrollTo(0, Math.min(y, document.documentElement.scrollHeight - window.innerHeight));
      remettreFocus();
    });
  }

  // Ce qu'on écrit est enregistré pendant la frappe, comme les réponses aux questions.
  let minuterieEcrit = null;
  function enregistrerEcrit() {
    clearTimeout(minuterieEcrit);
    if (reponseEnAttente === enregistrerEcrit) reponseEnAttente = null;
    const note = noteOuverte && etat.notes[noteOuverte];
    if (!note) return;
    note.ecrit = zoneEcrit.value;
    const ok = enregistrerEtat();
    fenetreNote.querySelector(".note-fenetre__etat").textContent = ok
      ? ""
      : "Attention : cet appareil refuse d’enregistrer. Votre note sera perdue.";
  }
  zoneEcrit.addEventListener("input", () => {
    ajusterHauteur(zoneEcrit);
    clearTimeout(minuterieEcrit);
    reponseEnAttente = enregistrerEcrit;
    minuterieEcrit = setTimeout(enregistrerEcrit, 400);
  });
  zoneEcrit.addEventListener("blur", enregistrerReponseEnAttente);

  fenetreNote.addEventListener("click", (evenement) => {
    if (evenement.target === fenetreNote || evenement.target.closest(".feuille__fermer")) {
      fermerNote();
      return;
    }
    const voir = evenement.target.closest(".note-fenetre__voir");
    if (voir) {
      // La leçon s'ouvre au passage, qui s'allume (montrerNoteDansLecon). Au retour (flèche ou
      // geste de l'iPhone), on retrouve la note ouverte, là où on l'avait laissée : elle est
      // notée dans l'entrée d'historique de la liste, et le routeur la rouvre (demande de
      // Sébastien, 25 novembre 2026). La fenêtre disparaît sans descendre : la leçon arrive
      // aussitôt, sans fenêtre qui glisse par-dessus.
      evenement.preventDefault();
      const id = voir.dataset.allerNote;
      noteAMontrer = id;
      history.replaceState({ ...(history.state || {}), noteARouvrir: id }, "");
      fermerNote({ rendreFocus: false, aussitot: true });
      location.hash = voir.getAttribute("href");
      return;
    }
    const choix = evenement.target.closest("[data-choix-etiquette]");
    if (choix) {
      const note = noteOuverte && etat.notes[noteOuverte];
      if (!note) return;
      note.etiquette = choix.dataset.choixEtiquette;
      enregistrerEtat();
      habillerFenetreNote(note);
      peindreNotes();
      return;
    }
    const retrait = evenement.target.closest("[data-retirer]");
    if (!retrait) return;
    if (retrait.dataset.retirer === "demander") {
      zoneRetrait.innerHTML = CONFIRMATION_RETRAIT;
      zoneRetrait.querySelector('[data-retirer="annuler"]').focus();
    } else if (retrait.dataset.retirer === "annuler") {
      zoneRetrait.innerHTML = BOUTON_RETRAIT;
      zoneRetrait.querySelector("button").focus();
    } else {
      const id = noteOuverte;
      enregistrerReponseEnAttente();
      // Retirée avant la fermeture : le focus, qui ne trouve plus le passage, va au texte de la leçon.
      mettreDeCote(id);
      peindreNotes();
      fermerNote();
    }
  });
  document.addEventListener("keydown", (evenement) => {
    if (evenement.key === "Escape" && feuilleOuverte(fenetreNote)) fermerNote();
  });

  // Toucher un passage coloré ouvre sa note. « cursor: pointer » (style.css) est ce qui fait
  // que Safari d'iPhone envoie un clic sur du simple texte.
  principal.addEventListener("click", (evenement) => {
    const marque = evenement.target.closest("mark.note-passage");
    if (!marque || evenement.target.closest(".ref, a, button")) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    ouvrirNote(marque.dataset.note);
  });
  // Au clavier : Entrée ou Espace sur le passage, comme sur un bouton.
  principal.addEventListener("keydown", (evenement) => {
    const marque = evenement.target.closest && evenement.target.closest("mark.note-passage[tabindex]");
    if (!marque || (evenement.key !== "Enter" && evenement.key !== " ")) return;
    evenement.preventDefault();
    ouvrirNote(marque.dataset.note);
  });

  // --- Les écrans de « Mes notes » ---------------------------------------------
  // Rangés comme Sébastien l'a choisi sur maquettes le 25 novembre 2026 (« Leçon d'abord »,
  // puis « Lignes fines ») : les leçons qui ont des notes, puis un dossier par type de note
  // dans une leçon, puis les notes d'un dossier, dans l'ordre du texte. Chaque écran ne montre
  // qu'une chose, et se présente comme la liste des leçons de l'accueil.

  const nombreDeNotes = (n) => `${n} note${n > 1 ? "s" : ""}`;

  async function afficherNotes(numero, type) {
    const liste = await chargerIndex();
    const notes = notesValides();
    const lecon = numero && liste.lecons.find((l) => l.numero === numero);
    const etiquette = type && ETIQUETTES.find((e) => e.cle === type);
    // Une adresse qui n'existe pas (« #/notes/99 ») montre l'écran le plus proche, et l'adresse
    // le dit aussi.
    if (numero && !lecon) return corrigerAdresse("/notes"), afficherNotes(null, null);
    if (type && !etiquette) return corrigerAdresse(`/notes/${numero}`), afficherNotes(numero, null);
    if (etiquette) return afficherDossier(lecon, etiquette, notes);
    if (lecon) return afficherDossiersDeLecon(lecon, notes);

    const numeros = [...new Set(notes.map((n) => n.lecon))].sort((a, b) => a - b);
    const lignes = numeros
      .map((n) => {
        const l = liste.lecons.find((x) => x.numero === n);
        const siennes = notes.filter((x) => x.lecon === n);
        const types = ETIQUETTES.filter((e) => siennes.some((x) => x.etiquette === e.cle));
        return html`<li>
          <a class="carte-lecon" href="#/notes/${n}">
            <span class="carte-lecon__numero"
              ><span class="carte-lecon__mot visuellement-cache">Leçon</span
              ><span class="carte-lecon__chiffre">${n}</span></span
            >
            <p class="carte-lecon__titre">${echapper(l ? l.titre : "")}</p>
            <span class="carte-lecon__marque">${CHEVRON}</span>
            <p class="carte-lecon__detail">
              ${nombreDeNotes(siennes.length)}<span class="notes-points" aria-hidden="true"
                >${types.map((e) => `<span class="pastille pastille--${e.cle}"></span>`).join("")}</span
              ><span class="visuellement-cache"> : ${types.map((e) => e.nom).join(", ")}</span>
            </p>
          </a>
        </li>`;
      })
      .join("");
    const retirees = notesRetirees();
    const corps = notes.length
      ? html`<ul class="liste-lecons">${lignes}</ul>`
      : retirees.length
        ? html`<p class="notes-vide">Aucune note pour l’instant.</p>`
        : html`<p class="notes-vide">
            Vous n’avez encore rien noté. Sélectionnez un passage dans une leçon pour le noter.
          </p>`;
    // En bas, comme le dossier de Notes d'Apple ; seulement s'il contient quelque chose.
    const corbeille = retirees.length
      ? html`<div class="annexes">
          <a class="annexe" href="#/notes/supprimees">
            <p class="annexe__titre">Récemment supprimées</p>
            <span class="annexe__marque">${CHEVRON}</span>
            <p class="annexe__detail">${nombreDeNotes(retirees.length)}</p>
          </a>
        </div>`
      : "";
    afficherDans(
      html`
        <!-- Dans « Mes notes », le nom de l'écran n'est écrit qu'une fois, dans la barre violette
             (choix de Sébastien, 25 novembre 2026) ; le titre reste pour les lecteurs d'écran. -->
        <h1 class="visuellement-cache">Mes notes</h1>
        ${stockageIndisponible ? avertissementStockage() : ""}
        ${corps}
        ${corbeille}
      `,
      "Mes notes"
    );
    zoneNavigation.innerHTML = RETOUR;
    titreBarre.textContent = "Mes notes";
  }

  // « Récemment supprimées » : les notes retirées depuis moins de 30 jours, la plus récente en
  // haut. On ne les modifie pas ici (comme dans Notes) : « Récupérer » les remet à leur place.
  async function afficherSupprimees() {
    const liste = await chargerIndex();
    const retirees = notesRetirees().filter((n) => liste.lecons.some((l) => l.numero === Number(n.lecon)));
    const lignes = retirees
      .map((note) => {
        const etiquette = etiquetteDe(note.etiquette);
        const ecrit = (note.ecrit || "").trim();
        const passage = echapper(espacesSimples(note.texte));
        return html`<li class="ligne-supprimee">
          <span class="ligne-note__texte">
            <span class="ligne-supprimee__origine"
              ><span class="pastille pastille--${etiquette.cle}" aria-hidden="true"></span>Leçon ${Number(note.lecon)} ·
              ${etiquette.nom}</span
            >
            <span class="ligne-note__passage">«\u00a0${passage}\u00a0»</span>
            ${ecrit ? html`<span class="ligne-note__ecrit">${echapper(ecrit).replace(/\n/g, "<br>")}</span>` : ""}
          </span>
          <button type="button" class="bouton-recuperer" data-recuperer-note="${note.id}">
            Récupérer<span class="visuellement-cache"> la note «\u00a0${passage}\u00a0»</span>
          </button>
        </li>`;
      })
      .join("");
    afficherDans(
      // L'essentiel seulement (Sébastien, 25 novembre 2026 : « trop d'informations qui se
      // répètent ») : ni surtitre, ni phrase d'explication.
      html`
        <h1 class="visuellement-cache">Récemment supprimées</h1>
        ${lignes ? html`<ul class="liste-notes">${lignes}</ul>` : html`<p class="notes-vide">Plus aucune note ici.</p>`}
      `,
      "Récemment supprimées"
    );
    zoneNavigation.innerHTML = retourNotes("/notes");
    titreBarre.textContent = "Récemment supprimées";
  }

  principal.addEventListener("click", (evenement) => {
    const bouton = evenement.target.closest("[data-recuperer-note]");
    if (!bouton) return;
    const id = bouton.dataset.recupererNote;
    const note = etat.notes[id];
    if (!note || !note.texte || !estRetiree(note)) {
      annoncer("Cette note n’existe plus.");
      rafraichirNotes();
      return;
    }
    // Jamais deux notes sur le même passage : s'il a été noté à nouveau entre-temps, on le dit
    // (agent de test, 25 novembre 2026 : les deux se mêlaient dans la leçon).
    const occupe = notesValides().some(
      (n) => n.lecon === Number(note.lecon) && n.bloc === note.bloc && n.debut < note.fin && n.fin > note.debut
    );
    if (occupe) {
      annoncer("Ce passage porte déjà une autre note : retirez-la d’abord.");
      return;
    }
    const date = note.retiree;
    delete note.retiree;
    if (!enregistrerEtat()) {
      note.retiree = date;
      annoncer("Attention : cet appareil refuse d’enregistrer. La note reste ici.");
      return;
    }
    // Une autre page ouverte a pu l'effacer entre-temps (fin des 30 jours) : la fusion des
    // enregistrements ne laisse alors qu'un objet vide, qu'on enlève.
    const apres = etat.notes[id];
    if (!apres || !apres.texte) {
      delete etat.notes[id];
      enregistrerEtat();
      annoncer("Cette note n’existe plus.");
    } else annoncer("Note récupérée.");
    rafraichirNotes();
  });

  // Une leçon : un dossier par type de note qu'elle contient. Les types vides n'apparaissent pas.
  function afficherDossiersDeLecon(lecon, notes) {
    const siennes = notes.filter((n) => n.lecon === lecon.numero);
    const dossiers = ETIQUETTES.map((e) => ({ e, nombre: siennes.filter((n) => n.etiquette === e.cle).length }))
      .filter((d) => d.nombre)
      .map(
        ({ e, nombre }) => html`<li>
          <a class="carte-lecon carte-lecon--dossier" href="#/notes/${lecon.numero}/${e.cle}">
            <span class="carte-lecon__numero"><span class="pastille pastille--${e.cle}" aria-hidden="true"></span></span>
            <p class="carte-lecon__titre">${e.nom}</p>
            <span class="carte-lecon__marque">${CHEVRON}</span>
            <p class="carte-lecon__detail">${nombreDeNotes(nombre)}</p>
          </a>
        </li>`
      )
      .join("");
    afficherDans(
      html`
        <p class="surtitre">Mes notes · leçon ${lecon.numero}</p>
        <h1 class="visuellement-cache">${echapper(lecon.titre)}</h1>
        ${dossiers ? html`<ul class="liste-lecons">${dossiers}</ul>` : html`<p class="notes-vide">Plus aucune note dans cette leçon.</p>`}
      `,
      `Mes notes, leçon ${lecon.numero}`
    );
    zoneNavigation.innerHTML = retourNotes("/notes");
    titreBarre.textContent = lecon.titre;
  }

  // Un dossier : ses notes dans l'ordre du texte. Toucher une ligne ouvre la note (on la modifie
  // ou la retire), d'où « Voir dans la leçon » mène au passage.
  function afficherDossier(lecon, etiquette, notes) {
    const siennes = notes
      .filter((n) => n.lecon === lecon.numero && n.etiquette === etiquette.cle)
      .sort(comparerPlaces);
    const lignes = siennes
      .map((note) => {
        const ecrit = (note.ecrit || "").trim();
        const passage = echapper(espacesSimples(note.texte));
        return html`<li class="ligne-note-cadre">
          <a class="ligne-note" href="#/lecon/${lecon.numero}/lecture" data-ouvrir-note="${note.id}" aria-haspopup="dialog">
            <span class="ligne-note__texte">
              <span class="ligne-note__passage">«\u00a0${passage}\u00a0»</span>
              ${ecrit ? html`<span class="ligne-note__ecrit">${echapper(ecrit).replace(/\n/g, "<br>")}</span>` : ""}
            </span>
            ${CHEVRON}
          </a>
          <button type="button" class="ligne-note__retirer" data-retirer-note="${note.id}" tabindex="-1" aria-hidden="true">
            Retirer<span class="visuellement-cache"> la note «\u00a0${passage}\u00a0»</span>
          </button>
        </li>`;
      })
      .join("");
    afficherDans(
      html`
        <p class="surtitre">Leçon ${lecon.numero} · ${echapper(lecon.titre)}</p>
        <h1 class="visuellement-cache">${etiquette.nom}</h1>
        ${lignes ? html`<ul class="liste-notes">${lignes}</ul>` : html`<p class="notes-vide">Plus aucune note ici.</p>`}
      `,
      `${etiquette.nom}, leçon ${lecon.numero}`
    );
    zoneNavigation.innerHTML = retourNotes(`/notes/${lecon.numero}`, `la leçon ${lecon.numero}`);
    titreBarre.textContent = etiquette.nom;
    boutonModifier.hidden = !lignes;
  }

  // --- Retirer une note depuis « Mes notes » ------------------------------------
  // Les gestes des grandes applications (Mail, Notes, Gmail), demandés par Sébastien le 25 novembre
  // 2026 : glisser une ligne vers la gauche découvre « Retirer » ; un glissement jusqu'au bout
  // retire tout de suite ; « Modifier », dans la barre, découvre « Retirer » sur toutes les lignes.
  // C'est aussi le chemin du clavier et des lecteurs d'écran : un geste de glissement doit
  // toujours avoir un équivalent d'un seul toucher (W3C, WCAG 2.5.1 « Pointer Gestures »).
  // Pas de question « Êtes-vous sûr ? » : le message du bas propose « Annuler », comme Gmail.
  const LARGEUR_RETIRER = 88;
  const boutonModifier = document.getElementById("modifier-notes");
  let ligneOuverte = null; // le cadre dont « Retirer » est découvert par un glissement
  let clicIgnoreJusqua = 0; // le clic qui suit un glissement ne doit pas ouvrir la leçon

  const enModification = () => boutonModifier.getAttribute("aria-pressed") === "true";

  function rendreRetirerAtteignable(cadre, oui) {
    const bouton = cadre.querySelector(".ligne-note__retirer");
    if (!bouton) return;
    bouton.tabIndex = oui ? 0 : -1;
    if (oui) bouton.removeAttribute("aria-hidden");
    else bouton.setAttribute("aria-hidden", "true");
  }

  // Le bouton rouge n'est visible que si la ligne est ouverte ou en train de glisser ; il reste
  // le temps que la ligne revienne (260 ms, style.css), puis se cache.
  const minuteriesRetirer = new WeakMap();
  function revelerRetirer(cadre) {
    clearTimeout(minuteriesRetirer.get(cadre));
    cadre.classList.add("ligne-note-cadre--revele");
  }
  function cacherRetirerApresRetour(cadre) {
    clearTimeout(minuteriesRetirer.get(cadre));
    minuteriesRetirer.set(
      cadre,
      setTimeout(() => {
        if (!cadre.classList.contains("ligne-note-cadre--ouverte") && !cadre.classList.contains("ligne-note-cadre--glisse"))
          cadre.classList.remove("ligne-note-cadre--revele");
      }, 300)
    );
  }

  function fermerLigne() {
    if (!ligneOuverte) return;
    ligneOuverte.classList.remove("ligne-note-cadre--ouverte");
    rendreRetirerAtteignable(ligneOuverte, false);
    cacherRetirerApresRetour(ligneOuverte);
    ligneOuverte = null;
  }

  function ouvrirLigne(cadre) {
    if (ligneOuverte && ligneOuverte !== cadre) fermerLigne();
    revelerRetirer(cadre);
    cadre.classList.add("ligne-note-cadre--ouverte");
    rendreRetirerAtteignable(cadre, true);
    ligneOuverte = cadre;
  }

  function basculerModification(oui) {
    boutonModifier.setAttribute("aria-pressed", String(oui));
    boutonModifier.textContent = oui ? "OK" : "Modifier";
    fermerLigne();
    const liste = principal.querySelector(".liste-notes");
    if (!liste) return;
    liste.classList.toggle("liste-notes--modification", oui);
    liste.querySelectorAll(".ligne-note-cadre").forEach((cadre) => rendreRetirerAtteignable(cadre, oui));
  }
  boutonModifier.addEventListener("click", () => basculerModification(!enModification()));

  // L'écran de « Mes notes » affiché, reconstruit (après « Annuler »), ou les passages de la leçon.
  async function rafraichirNotes() {
    const chemin = location.hash.replace(/^#/, "") || "/";
    if (chemin === "/notes/supprimees") {
      if (ecranAffiche) ecranAffiche.html = null;
      await afficherSupprimees();
      return;
    }
    const m = chemin.match(/^\/notes(?:\/(\d+)(?:\/([a-z]+))?)?\/?$/);
    if (m) {
      if (ecranAffiche) ecranAffiche.html = null;
      await afficherNotes(m[1] ? Number(m[1]) : null, m[2] || null);
    } else if (chemin === "/") {
      // L'accueil compte les notes (« Mes notes, 3 notes · leçon 2 »).
      if (ecranAffiche) ecranAffiche.html = null;
      await afficherChemin("/");
    } else peindreNotes();
  }

  // Les retraits faits pendant que « Annuler » est affiché s'additionnent : un seul « Annuler »
  // les remet tous. Sinon le premier était perdu sans recours (agent de test, 25 novembre 2026).
  const retraitsEnAttente = [];
  const oublierRetraits = () => {
    retraitsEnAttente.length = 0;
  };

  function retirerDepuisListe(cadre) {
    const id = cadre.querySelector("[data-retirer-note]").dataset.retirerNote;
    if (!etat.notes[id]) return;
    mettreDeCote(id);
    if (cadre === ligneOuverte) ligneOuverte = null;
    // La page affichée ne correspond plus à son texte d'origine : elle ne doit pas être reprise
    // telle quelle (garderEcranQuitte) quand on la reconstruit, après « Annuler » par exemple.
    if (ecranAffiche) ecranAffiche.html = null;
    // Le focus passe à la ligne suivante (ou précédente) : il ne doit pas tomber au début de la page.
    const voisin = cadre.nextElementSibling || cadre.previousElementSibling;
    const finir = () => {
      cadre.remove();
      const liste = principal.querySelector(".liste-notes");
      if (liste && !liste.children.length) {
        basculerModification(false);
        rafraichirNotes();
      } else if (voisin && voisin.isConnected) {
        const cible = enModification() ? voisin.querySelector(".ligne-note__retirer") : voisin.querySelector(".ligne-note");
        if (cible) cible.focus({ preventScroll: true });
      }
    };
    if (mouvementReduit.matches) finir();
    else {
      // La ligne se replie, comme dans Mail : la suivante remonte à sa place.
      cadre.style.height = `${cadre.getBoundingClientRect().height}px`;
      void cadre.offsetHeight;
      cadre.classList.add("ligne-note-cadre--retiree");
      cadre.style.height = "0px";
      setTimeout(finir, 260);
    }
  }

  // Retire une note (glissement, « Modifier » ou fenêtre de la note) : elle passe dans
  // « Récemment supprimées », et « Annuler » la remet tout de suite.
  function mettreDeCote(id) {
    const avant = etat.notes[id];
    if (!avant) return;
    etat.notes[id] = { ...avant, retiree: Date.now() };
    if (!enregistrerEtat()) {
      annoncer("Attention : cet appareil refuse d’enregistrer. La note reviendra.");
      return;
    }
    retraitsEnAttente.push({ id, note: avant });
    const nombre = retraitsEnAttente.length;
    annoncer(nombre > 1 ? `${nombre} notes retirées.` : "Note retirée.", {
      libelle: "Annuler",
      fin: oublierRetraits,
      garder: true,
      faire: async () => {
        const etaitEnModification = enModification();
        if (!estObjet(etat.notes)) etat.notes = {};
        for (const retrait of retraitsEnAttente) etat.notes[retrait.id] = retrait.note;
        oublierRetraits();
        enregistrerEtat();
        await rafraichirNotes();
        // « Annuler » en mode « Modifier » : on y reste, pour continuer à retirer.
        if (etaitEnModification && !boutonModifier.hidden) basculerModification(true);
      },
    });
  }

  principal.addEventListener("click", (evenement) => {
    const bouton = evenement.target.closest("[data-retirer-note]");
    if (bouton) retirerDepuisListe(bouton.closest(".ligne-note-cadre"));
  });

  // Après un glissement, ou ligne ouverte : le toucher referme au lieu d'ouvrir la leçon.
  principal.addEventListener(
    "click",
    (evenement) => {
      if (evenement.target.closest("[data-retirer-note]")) return;
      const ligne = evenement.target.closest(".ligne-note-cadre a.ligne-note");
      if (performance.now() < clicIgnoreJusqua || (ligneOuverte && ligne) || (ligne && enModification())) {
        evenement.preventDefault();
        evenement.stopPropagation();
        if (!enModification()) fermerLigne();
      }
    },
    true
  );

  // Le glissement lui-même. Il ne démarre que si le doigt part nettement à l'horizontale :
  // sinon c'est un défilement de la page, laissé au navigateur (« touch-action: pan-y »).
  let glisse = null;
  principal.addEventListener("pointerdown", (evenement) => {
    if (evenement.pointerType === "mouse" || enModification()) return;
    if (glisse) finirGlisse(true); // un glissement dont la fin s'est perdue : on le referme
    const ligne = evenement.target.closest(".ligne-note-cadre a.ligne-note");
    if (!ligne) return;
    const cadre = ligne.parentElement;
    glisse = {
      cadre,
      ligne,
      x0: evenement.clientX,
      y0: evenement.clientY,
      depart: cadre === ligneOuverte ? -LARGEUR_RETIRER : 0, // ouverte : décalée du bouton
      actif: false,
      x: 0,
      id: evenement.pointerId,
    };
  });
  principal.addEventListener("pointermove", (evenement) => {
    if (!glisse || evenement.pointerId !== glisse.id) return;
    const dx = evenement.clientX - glisse.x0;
    const dy = evenement.clientY - glisse.y0;
    if (!glisse.actif) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        glisse = null; // défilement vertical
        return;
      }
      // Nettement horizontal (deux fois plus que vertical) : un défilement un peu oblique
      // n'ouvre pas la ligne.
      if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy) * 2) return;
      glisse.actif = true;
      revelerRetirer(glisse.cadre);
      glisse.cadre.classList.add("ligne-note-cadre--glisse");
      eteindreAppui();
      if (ligneOuverte && ligneOuverte !== glisse.cadre) fermerLigne();
      try {
        glisse.ligne.setPointerCapture(evenement.pointerId);
      } catch {
        /* sans capture, le glissement continue tant que le doigt reste sur la ligne */
      }
    }
    // Vers la droite, la ligne ne dépasse pas sa place ; vers la gauche, jusqu'au bord.
    const largeur = glisse.cadre.getBoundingClientRect().width;
    glisse.x = Math.max(-largeur, Math.min(0, glisse.depart + dx));
    glisse.ligne.style.transition = "none";
    glisse.ligne.style.transform = `translateX(${glisse.x}px)`;
    // Le rouge suit le doigt : il remplit tout l'espace découvert, sans blanc entre la ligne et
    // lui (vidéo de Sébastien, 25 novembre 2026), comme dans Mail.
    const retirer = glisse.cadre.querySelector(".ligne-note__retirer");
    if (retirer) {
      retirer.style.transition = "none";
      retirer.style.width = `${Math.max(LARGEUR_RETIRER, -glisse.x)}px`;
    }
    glisse.cadre.classList.toggle("ligne-note-cadre--loin", glisse.x < -largeur * 0.6);
  });
  function finirGlisse(annule) {
    if (!glisse) return;
    const { cadre, ligne, x, actif } = glisse;
    glisse = null;
    if (!actif) return;
    clicIgnoreJusqua = performance.now() + 400;
    ligne.style.transition = "";
    const retirer = cadre.querySelector(".ligne-note__retirer");
    // Le rouge revient à sa largeur au même rythme que la ligne (style.css).
    if (retirer) retirer.style.width = retirer.style.transition = "";
    const largeur = cadre.getBoundingClientRect().width;
    if (!annule && x < -largeur * 0.6) {
      // Glissée jusqu'au bout : retirée sans autre geste, comme dans Mail. Le rouge reste
      // étalé sous elle pendant qu'elle se replie.
      ligne.style.transform = `translateX(${-largeur}px)`;
      retirerDepuisListe(cadre);
      return;
    }
    cadre.classList.remove("ligne-note-cadre--glisse", "ligne-note-cadre--loin");
    ligne.style.transform = "";
    if (!annule && x < -LARGEUR_RETIRER / 2) ouvrirLigne(cadre);
    else if (cadre === ligneOuverte) fermerLigne();
    else cacherRetirerApresRetour(cadre);
  }
  principal.addEventListener("pointerup", () => finirGlisse(false));
  principal.addEventListener("pointercancel", () => finirGlisse(true));
  // Comme dans Mail : faire défiler la page referme la ligne ouverte.
  window.addEventListener("scroll", () => fermerLigne(), { passive: true });

  // Toucher une ligne d'un dossier ouvre la note sur place ; « Voir dans la leçon », dans la
  // fenêtre, mène au passage. Le lien garde son adresse pour qui l'ouvrirait autrement.
  principal.addEventListener("click", (evenement) => {
    const ligne = evenement.target.closest("a.ligne-note[data-ouvrir-note]");
    if (!ligne || evenement.defaultPrevented) return;
    evenement.preventDefault();
    evenement.stopPropagation();
    ouvrirNote(ligne.dataset.ouvrirNote, { depuisListe: true });
  });

  // Le passage noté vient au premier tiers de l'écran et s'allume un instant.
  function montrerNoteDansLecon(id) {
    const marques = principal.querySelectorAll(`mark.note-passage[data-note="${id}"]`);
    if (!marques.length) {
      annoncer("Ce passage n’a pas été retrouvé dans la leçon.");
      return;
    }
    const y = marques[0].getBoundingClientRect().top + window.scrollY - hauteurBarre - window.innerHeight * 0.2;
    window.scrollTo(0, Math.max(0, y));
    marques.forEach((marque) => {
      marque.classList.add("note-passage--montre");
      const eteindre = () => marque.classList.remove("note-passage--montre");
      marque.addEventListener("animationend", eteindre, { once: true });
      setTimeout(eteindre, 2500);
    });
  }

  // ---------------------------------------------------------------------------
  // Navigation (adresse après le #)
  // ---------------------------------------------------------------------------

  // --- Toucher et changement d'écran (21 novembre 2026, demande de Sébastien) ---------------
  // Depuis que les leçons sont des lignes sans boîte, rien ne répondait au doigt et l'écran
  // changeait d'un coup. Trois gestes simples, sans la fonction « View Transitions » des
  // navigateurs (trop jeune, et coûteuse à régler : voir les fondus de Plateforme Théologie) :
  //   1. la ligne touchée se teinte et le reste pendant le départ ;
  //   2. en avançant (leçon, document, liste des documents, à propos), le nouvel écran
  //      remplace aussitôt l'ancien et se pose en glissant de quelques pixels : jamais de blanc ;
  //   3. en revenant, aucun mouvement : l'écran précédent réapparaît aussitôt, à l'endroit où
  //      on l'avait laissé, et la ligne d'où l'on venait s'éteint doucement.
  //
  // Une seule règle pour revenir, quel que soit le geste (demande de Sébastien, 21 novembre
  // 2026 : « peu importe ce que j'ouvre, pas de hasard ») :
  //   - la flèche, le logo et « Toutes les leçons » remontent dans l'historique quand l'écran
  //     visé y est déjà, exactement comme le geste de l'iPhone ; sinon seulement ils ajoutent
  //     une entrée (application ouverte directement sur une leçon, par exemple) ;
  //   - les onglets d'une leçon remplacent l'entrée au lieu d'en ajouter : un seul geste de
  //     retour ramène à la liste, depuis n'importe quel onglet.
  // L'application tient la liste des écrans de l'historique (`pile`, indexée par le rang que
  // chaque entrée porte), gardée pour la séance dans sessionStorage.
  // Durée de l'arrivée d'un écran : lue dans la feuille de style (--ecran-entree).
  function dureeEntree() {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ecran-entree")) || 0;
  }
  // Au toucher d'une ligne, dans cet ordre :
  //   1. l'adresse change tout de suite (le lien suit son cours normal) ; Safari photographie
  //      la liste à cet instant, avant tout allumage (WebKit prend sa photo « juste avant que
  //      l'entrée d'historique change », bug WebKit 135058), et montre cette photo pendant le
  //      geste de retour : elle est donc propre ;
  //   2. la ligne s'allume brièvement sur l'écran encore affiché (Apple : surbrillance brève) ;
  //   3. le nouvel écran le remplace directement, ligne allumée comprise : il n'y a jamais
  //      d'étape où la liste réapparaît éteinte.
  // Historique : allumer puis éteindre avant de changer d'adresse donnait un double
  // clignotement, filmé deux fois par Sébastien sur son iPhone (21 novembre 2026).
  const DUREE_ALLUMAGE = 90;
  let ligneDepart = null;
  // L'image suivante, ou 50 ms au plus : une page cachée ne dessine plus d'images, et le
  // changement d'écran ne doit jamais rester en attente.
  const prochaineImage = () =>
    new Promise((suite) => {
      requestAnimationFrame(() => suite());
      setTimeout(suite, 50);
    });
  const mouvementReduit = window.matchMedia("(prefers-reduced-motion: reduce)");
  const CLASSES_ECRAN = ["ecran--attente", "ecran--entre"];
  const CLE_PILE = "cours-decouvertes-pile";
  let pile = [];
  try {
    pile = JSON.parse(sessionStorage.getItem(CLE_PILE)) || [];
  } catch {
    pile = [];
  }
  function noterPile() {
    try {
      sessionStorage.setItem(CLE_PILE, JSON.stringify(pile));
    } catch {
      /* sans stockage, la pile vit le temps de la page */
    }
  }
  const attendre = (ms) => new Promise((suite) => setTimeout(suite, ms));
  const positionsQuittees = new Map(); // écran → hauteur de défilement au moment de le quitter
  // écran → adresse de la ligne par laquelle on l'a quitté. Au retour, cette ligne s'allume
  // puis s'éteint doucement, pour montrer d'où l'on vient (remise à la demande de Sébastien,
  // 21 novembre 2026 : « j'aimais bien »). Elle n'est jamais allumée sur la photo que Safari
  // montre pendant le geste : seulement à l'arrivée.
  const lignesQuittees = new Map();
  // Les écrans de liste retrouvent leur place au retour ; les leçons et les documents ont la
  // leur (reprendreLecture).
  // « Mes notes » compte trois niveaux de listes : les leçons, les dossiers d'une leçon
  // (« /notes/2 »), les notes d'un dossier (« /notes/2/question »).
  const LISTES = new Set(["/", "/documents"]);
  const estListe = (cle) => LISTES.has(cle) || /^\/notes(\/|$)/.test(cle);
  let ecranCourant = null;
  let rangCourant = 0;
  let navigation = 0;

  // L'écran auquel une adresse appartient, et sa profondeur. Les trois onglets d'une leçon
  // sont un seul écran : passer de l'un à l'autre n'est pas un changement d'écran.
  function situer(chemin) {
    const lecon = chemin.match(/^\/lecon\/(\d+)/);
    if (lecon) return { cle: `/lecon/${lecon[1]}`, niveau: 1 };
    if (/^\/documents\/[a-z0-9-]+/.test(chemin)) return { cle: chemin.replace(/\/$/, ""), niveau: 2 };
    if (/^\/documents\/?$/.test(chemin)) return { cle: "/documents", niveau: 1 };
    if (chemin === "/a-propos") return { cle: "/a-propos", niveau: 1 };
    if (/^\/notes\/supprimees\/?$/.test(chemin)) return { cle: "/notes/supprimees", niveau: 2 };
    const notes = chemin.match(/^\/notes(?:\/(\d+)(?:\/([a-z]+))?)?\/?$/);
    if (notes) {
      const [, numero, type] = notes;
      if (type) return { cle: `/notes/${numero}/${type}`, niveau: 3 };
      if (numero) return { cle: `/notes/${numero}`, niveau: 2 };
      return { cle: "/notes", niveau: 1 };
    }
    return { cle: "/", niveau: 0 };
  }

  let remplacementEnCours = false;

  // Remplace l'adresse affichée sans changer d'écran ni d'entrée d'historique.
  function corrigerAdresse(chemin) {
    history.replaceState(history.state, "", `#${chemin}`);
    cheminRoute = chemin;
    ecranCourant = situer(chemin);
    pile[rangCourant] = ecranCourant.cle;
    noterPile();
  }

  // Remonte dans l'historique jusqu'à l'écran visé s'il s'y trouve, plus haut que l'écran
  // actuel. Renvoie vrai si c'est le cas.
  function remonterVers(cle) {
    for (let rang = rangCourant - 1; rang >= 0; rang--) {
      if (pile[rang] === cle) {
        history.go(rang - rangCourant);
        return true;
      }
    }
    return false;
  }

  // Tous les liens internes de l'application passent par ici.
  document.addEventListener("click", (evenement) => {
    const lien = evenement.target.closest('a[href^="#/"]');
    if (!lien || !ecranCourant || evenement.button || evenement.metaKey || evenement.ctrlKey || evenement.shiftKey) return;
    const chemin = lien.getAttribute("href").replace(/^#/, "") || "/";
    const cible = situer(chemin);
    if (cible.cle === ecranCourant.cle) {
      // Même écran (un onglet, « S'entraîner aux versets ») : on remplace, on n'empile pas.
      evenement.preventDefault();
      if (location.hash !== `#${chemin}`) {
        remplacementEnCours = true;
        location.replace(`#${chemin}`);
      }
      return;
    }
    // Une ligne de « Mes notes » avance toujours vers son passage, même si la leçon est plus bas
    // dans l'historique : y remonter rendait la leçon telle qu'on l'avait laissée (autre onglet,
    // autre endroit), sans le passage (agent de test, 25 novembre 2026).
    if (
      (cible.niveau < ecranCourant.niveau || "retour" in lien.dataset) &&
      !("allerNote" in lien.dataset) &&
      remonterVers(cible.cle)
    ) {
      evenement.preventDefault();
      return;
    }
    // Avancer : le lien suit son cours. La ligne touchée est notée ; allumée sous le doigt,
    // elle le reste jusqu'à l'arrivée du nouvel écran (le routeur la reprend en main).
    ligneDepart = lien.closest("a.carte-lecon, a.annexe, a.ligne-note");
    if (ligneDepart && ligneDepart === ligneAppuyee) {
      clearTimeout(extinctionAppui);
      ligneAppuyee = null;
    }
  });

  function changementDEcran(chemin) {
    const ecran = situer(chemin);
    const precedent = ecranCourant;
    ecranCourant = ecran;
    const etat = history.state;
    const revisitee = Boolean(etat) && typeof etat.rang === "number";
    let sens = null;
    if (revisitee) {
      rangCourant = etat.rang;
    } else {
      // Une entrée remplacée (onglet d'une leçon) garde le rang de celle qu'elle remplace.
      if (precedent && !remplacementEnCours) rangCourant += 1;
      history.replaceState({ ...(etat || {}), rang: rangCourant }, "");
      if (precedent && precedent.cle !== ecran.cle) sens = ecran.niveau < precedent.niveau ? "arriere" : "avant";
      pile.length = rangCourant; // les écrans « suivants » d'un ancien parcours sont oubliés
    }
    remplacementEnCours = false;
    pile[rangCourant] = ecran.cle;
    noterPile();
    const autreEcran = Boolean(precedent) && precedent.cle !== ecran.cle;
    return { ecran, sens, retour: autreEcran && (revisitee || sens === "arriere") };
  }

  principal.addEventListener("click", (evenement) => {
    const ligne = evenement.target.closest("a.carte-lecon, a.annexe, a.ligne-note");
    if (!ligne || evenement.button || evenement.metaKey || evenement.ctrlKey || evenement.shiftKey) return;
    if (!ecranCourant) return;
    // La position se note ici, au toucher, et non au changement d'adresse : filmé sur iPhone
    // virtuel, Safari avait déjà ramené la page en haut quand l'adresse changeait.
    // Une ligne de note ouvre d'abord sa fenêtre, qui immobilise la page (figerPage) : la
    // hauteur à retenir est celle d'avant (agent de test, 25 novembre 2026).
    positionsQuittees.set(ecranCourant.cle, pageFigee !== null ? pageFigee : window.scrollY);
    // Les lignes d'un dossier de notes mènent toutes à la même leçon : elles se reconnaissent
    // à leur note.
    lignesQuittees.set(ecranCourant.cle, ligne.dataset.ouvrirNote || ligne.dataset.allerNote || ligne.getAttribute("href"));
  });

  // Sous le doigt, la ligne s'allume (teinte, et elle s'enfonce à peine) et reste allumée
  // jusqu'à l'arrivée de l'écran ouvert : jamais éteinte puis rallumée entre les deux, ce qui
  // donnait le double clignotement filmé par Sébastien (21 novembre 2026). Elle attend 70 ms,
  // le temps de savoir si le doigt glisse, et s'éteint dès que le navigateur fait défiler
  // (pointercancel, scroll) : rien ne reste allumé pendant un défilement. Un toucher plus bref
  // est allumé par le routeur. Doigt levé sans ouvrir de lien : elle s'éteint.
  const DELAI_APPUI = 70;
  let attenteAppui = null;
  let extinctionAppui = null;
  let ligneAppuyee = null;
  function eteindreAppui() {
    clearTimeout(attenteAppui);
    clearTimeout(extinctionAppui);
    if (ligneAppuyee) ligneAppuyee.classList.remove("ligne--touchee");
    ligneAppuyee = null;
  }
  principal.addEventListener("pointerdown", (evenement) => {
    eteindreAppui();
    const ligne = evenement.target.closest("a.carte-lecon, a.annexe, a.ligne-note");
    if (!ligne || evenement.button) return;
    attenteAppui = setTimeout(() => {
      ligneAppuyee = ligne;
      ligne.classList.add("ligne--touchee");
    }, DELAI_APPUI);
  });
  window.addEventListener("pointerup", () => {
    clearTimeout(attenteAppui);
    // Le clic suit le lever du doigt de quelques millisecondes et garde la ligne allumée.
    clearTimeout(extinctionAppui);
    extinctionAppui = setTimeout(eteindreAppui, 300);
  });
  window.addEventListener("pointercancel", eteindreAppui);
  window.addEventListener("scroll", eteindreAppui, { passive: true });

  // Pendant l'arrivée d'un écran, une copie de l'écran quitté reste dessous et recule un peu
  // pendant que le nouveau glisse par-dessus (style.css, « Changement d'écran »), sans jamais
  // passer par une page blanche (relevé par Sébastien le 21 novembre 2026). La copie est
  // décorative : cachée aux lecteurs d'écran, inerte, sans identifiants.
  let calque = null;
  function retirerCalque() {
    if (calque) calque.remove();
    calque = null;
  }
  function poserCalque() {
    retirerCalque();
    calque = document.createElement("div");
    calque.className = "calque-quitte";
    calque.setAttribute("aria-hidden", "true");
    calque.inert = true;
    calque.style.top = `${principal.getBoundingClientRect().top}px`;
    for (const enfant of principal.children) calque.append(enfant.cloneNode(true));
    calque.querySelectorAll("[id]").forEach((noeud) => noeud.removeAttribute("id"));
    principal.before(calque);
  }

  async function afficherChemin(chemin) {
    try {
      await chargerVersets();
      const lecon = chemin.match(/^\/lecon\/(\d+)(?:\/(lecture|versets|questions))?\/?$/);
      if (lecon) return await afficherLecon(Number(lecon[1]), lecon[2]);
      if (chemin === "/a-propos") return await afficherAPropos();
      if (/^\/notes\/supprimees\/?$/.test(chemin)) return await afficherSupprimees();
      const notes = chemin.match(/^\/notes(?:\/(\d+)(?:\/([a-z]+))?)?\/?$/);
      if (notes) return await afficherNotes(notes[1] ? Number(notes[1]) : null, notes[2] || null);
      if (chemin === "/documents" || chemin === "/documents/") return await afficherDocuments();
      const texte = chemin.match(/^\/documents\/([a-z0-9-]+)\/?$/);
      if (texte) return await afficherDocument(texte[1]);
      // Une adresse inconnue montre l'accueil, et l'adresse le dit aussi.
      if (chemin !== "/") corrigerAdresse("/");
      return await afficherAccueil();
    } catch (erreur) {
      console.error(erreur);
      afficherErreur(erreur.message);
    }
  }

  let cheminRoute = null;
  async function router(evenement) {
    const chemin = location.hash.replace(/^#/, "") || "/";
    // « popstate » et « hashchange » annoncent le même changement : le premier arrivé le traite.
    if (evenement && chemin === cheminRoute) return;
    cheminRoute = chemin;
    // Avant de reconstruire l'écran, dont les champs seront remplis depuis l'enregistrement.
    enregistrerReponseEnAttente();
    // Le retour du navigateur, fenêtre d'une note ouverte : elle se ferme (son texte est
    // enregistré) au lieu de rester par-dessus le nouvel écran (agent de test, 25 novembre 2026).
    if (feuilleOuverte(fenetreNote)) fermerNote({ rendreFocus: false });
    // Même chose pour les autres fenêtres (réglages, verset, partage, image agrandie) : elles
    // restaient ouvertes par-dessus l'écran suivant (agent de contre-vérification).
    if (feuilleOuverte(reglages)) fermerReglages();
    if (feuilleOuverte(feuille)) fermerVerset();
    if (feuilleOuverte(fenetrePartage)) fermerPartage();
    if (!loupe.hidden) fermerLoupe();
    cacherBarreNotes();
    if (!annonceGardee) cacherAnnonce();
    const jeton = ++navigation;
    const { ecran, sens, retour } = changementDEcran(chemin);
    const anime = sens === "avant" && !mouvementReduit.matches;

    principal.classList.remove(...CLASSES_ECRAN);
    principal.style.clipPath = "";
    retirerCalque();
    const ligne = ligneDepart;
    ligneDepart = null;
    if (sens === "avant" && ligne && principal.contains(ligne)) {
      if (!ligne.classList.contains("ligne--touchee")) {
        // Toucher trop bref pour avoir allumé la ligne sous le doigt : on l'allume ici.
        await prochaineImage();
        if (jeton !== navigation) return;
        ligne.classList.add("ligne--touchee");
      }
      await attendre(DUREE_ALLUMAGE);
      if (jeton !== navigation) return;
    }
    if (anime) {
      // L'écran quitté, copié dessous ; le vrai reste invisible le temps d'être reconstruit.
      poserCalque();
      principal.classList.add("ecran--attente");
    }
    // Retour vers une liste : l'iPhone remet lui-même la page à sa place. La faire défiler en
    // plus (en haut, puis à sa place) faisait voir, après le geste de retour, une image blanche
    // ou une liste à moitié dessinée (vidéo de Sébastien, 21 novembre 2026, 23 h 17). WebKit
    // attend que la position soit rétablie pour retirer sa photo de l'écran précédent
    // (ViewGestureController, « ScrollPositionRestoration ») : un défilement de plus arrive
    // après. On ne replace donc la page que si elle n'est pas à sa place.
    retourVersListe = retour && estListe(ecran.cle) && positionsQuittees.has(ecran.cle);
    await afficherChemin(chemin);
    retourVersListe = false;
    if (jeton !== navigation) return;

    principal.classList.remove(...CLASSES_ECRAN);
    if (retour && estListe(ecran.cle) && positionsQuittees.has(ecran.cle)) {
      const y = positionsQuittees.get(ecran.cle);
      if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
      // Une seconde fois à l'image suivante, au cas où le navigateur replacerait la page
      // après nous ; sans effet si elle est déjà à sa place.
      requestAnimationFrame(() => {
        if (jeton === navigation && pageFigee === null && Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
      });
    }
    // Retour d'une leçon ouverte par « Voir dans la leçon » : la note d'où l'on était parti se
    // rouvre, déjà ouverte, si elle est encore dans ce dossier.
    let rouverte = false;
    const marque = retour && estListe(ecran.cle) && history.state && history.state.noteARouvrir;
    if (marque) {
      const { noteARouvrir, ...reste } = history.state;
      history.replaceState(reste, "");
      const note = etat.notes[noteARouvrir];
      const ligneNote = [...principal.querySelectorAll("a.ligne-note[data-ouvrir-note]")].some(
        (a) => a.dataset.ouvrirNote === noteARouvrir
      );
      if (note && note.texte && !estRetiree(note) && ligneNote) {
        ouvrirNote(noteARouvrir, { depuisListe: true, aussitot: true });
        rouverte = true;
      }
    }
    if (retour && lignesQuittees.has(ecran.cle)) {
      const adresse = lignesQuittees.get(ecran.cle);
      lignesQuittees.delete(ecran.cle);
      const ligne = [...principal.querySelectorAll("a.carte-lecon, a.annexe, a.ligne-note")].find(
        (a) => (a.dataset.ouvrirNote || a.dataset.allerNote || a.getAttribute("href")) === adresse
      );
      // La note rouverte par-dessus : sa ligne ne s'allume pas.
      if (ligne && !rouverte) {
        ligne.classList.add("ligne--revient");
        // Retirée une fois éteinte : sinon, toucher aussitôt la même ligne ne l'allumerait pas
        // (l'animation finie garde la main sur la teinte).
        const retirer = () => ligne.classList.remove("ligne--revient");
        ligne.addEventListener("animationend", retirer, { once: true });
        setTimeout(retirer, 1000);
      }
    }
    if (anime) {
      // Une leçon rouverte là où on s'était arrêté de lire a déjà du texte au-dessus de l'écran.
      // Pendant la glissade, l'écran forme un bloc à part, et iOS 27 en affichait cette partie
      // floutée sous l'heure (vidéo de Sébastien sur son iPhone, 21 novembre 2026, 22 h 44 ;
      // reproduit sur le simulateur). On la coupe le temps de la glissade.
      const depasse = -principal.getBoundingClientRect().top;
      principal.style.clipPath = depasse > 0 ? `inset(${Math.ceil(depasse)}px 0 0 0)` : "";
      principal.classList.add("ecran--entre");
      if (calque) calque.classList.add("calque-quitte--part");
      await attendre(dureeEntree() + 40);
      if (jeton === navigation) {
        principal.classList.remove(...CLASSES_ECRAN);
        principal.style.clipPath = "";
        retirerCalque();
      }
    }
  }

  // Le défilement reste confié au navigateur (« auto », la valeur par défaut). L'application
  // replace elle-même chaque écran (haut de page, liste à sa place, reprise de la lecture),
  // mais ne passe plus le réglage en « manual » : avec « manual », Safari d'iPhone n'a plus
  // d'image de la page précédente à montrer pendant le geste de retour et montre une page
  // blanche (relevé par Sébastien le 21 novembre 2026 sur certaines leçons ; même cause
  // rapportée chez Gatsby, vue-router et Next.js, où retirer « manual » a supprimé le blanc).
  if ("scrollRestoration" in history) history.scrollRestoration = "auto";

  // Le choix d'un onglet est noté dès le toucher : la bulle part tout de suite, sans attendre
  // que la page soit reconstruite.
  function marquerOnglet(nom) {
    for (const bouton of zoneOnglets.querySelectorAll('[role="tab"]')) {
      const choisi = bouton.id === `onglet-${nom}`;
      bouton.setAttribute("aria-selected", String(choisi));
      bouton.tabIndex = choisi ? 0 : -1;
    }
  }

  // Un onglet remplace l'entrée de l'historique au lieu d'en ajouter une : voir « Une seule
  // règle pour revenir », plus haut.
  zoneOnglets.addEventListener("click", (evenement) => {
    const bouton = evenement.target.closest('[role="tab"]');
    if (!bouton) return;
    marquerOnglet(bouton.id.replace("onglet-", ""));
    const adresse = bouton.dataset.adresse;
    if (adresse && location.hash !== adresse) {
      remplacementEnCours = true;
      location.replace(adresse);
    }
  });

  // Navigation au clavier dans la barre d'onglets.
  zoneOnglets.addEventListener("keydown", (evenement) => {
    const onglets = [...zoneOnglets.querySelectorAll('[role="tab"]')];
    if (!onglets.length) return;
    const courant = onglets.indexOf(document.activeElement);
    if (courant < 0) return;
    const deplacements = {
      ArrowRight: courant + 1,
      ArrowLeft: courant - 1,
      Home: 0,
      End: onglets.length - 1,
    };
    if (!(evenement.key in deplacements)) return;
    evenement.preventDefault();
    const cible = onglets[(deplacements[evenement.key] + onglets.length) % onglets.length];
    cible.focus();
    cible.click();
  });

  // Au retour en arrière, « popstate » arrive avant « hashchange » : l'écran est reconstruit au
  // plus tôt. Vérifié avec le logo unique, les listes gardées et le défilement laissé à l'iPhone
  // (« Retour vers une liste ») : ensemble, plus d'image blanche après le geste de retour.
  window.addEventListener("popstate", router);
  window.addEventListener("hashchange", router);
  router();

  // Passer en arrière-plan est le dernier moment que la page peut observer de façon fiable
  // (MDN, « visibilitychange ») : le téléphone peut ensuite fermer l'application sans prévenir.
  // « pagehide » double la précaution quand la page se ferme.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") enregistrerReponseEnAttente();
  });
  window.addEventListener("pagehide", enregistrerReponseEnAttente);

  // ---------------------------------------------------------------------------
  // Fonctionnement hors connexion
  // ---------------------------------------------------------------------------

  if ("serviceWorker" in navigator && !contenuEmbarque) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch((erreur) => {
        console.warn("Mode hors connexion indisponible :", erreur);
      });
    });
  }
})();
