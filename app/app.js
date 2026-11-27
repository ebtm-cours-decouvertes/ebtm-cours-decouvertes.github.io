(() => {
  "use strict";

  const CLE_STOCKAGE = "cours-decouvertes";
  const ETAT_PAR_DEFAUT = () => ({
    version: 1,
    reponses: {},
    recitations: {},
    terminees: {},
    taillePolice: 0,
    apparence: "clair",
    lectures: {},

    notes: {},
  });

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
      return assainir(JSON.parse(brut));
    } catch {
      return ETAT_PAR_DEFAUT();
    }
  }

  function assainir(lu) {
    if (!estObjet(lu)) return ETAT_PAR_DEFAUT();
    const sain = { ...ETAT_PAR_DEFAUT(), ...lu };
    for (const rubrique of ["reponses", "recitations", "terminees", "lectures", "notes"])
      if (!estObjet(sain[rubrique])) sain[rubrique] = {};
    for (const [lecon, reponses] of Object.entries(sain.reponses)) {
      if (!estObjet(reponses)) {
        delete sain.reponses[lecon];
        continue;
      }
      for (const [question, texte] of Object.entries(reponses)) if (typeof texte !== "string") delete reponses[question];
    }
    for (const [id, note] of Object.entries(sain.notes)) if (!estObjet(note)) delete sain.notes[id];
    for (const [cle, rang] of Object.entries(sain.lectures)) if (typeof rang !== "number") delete sain.lectures[cle];
    if (![-1, 0, 1, 2].includes(sain.taillePolice)) sain.taillePolice = 0;
    if (!["clair", "sombre", "systeme"].includes(sain.apparence)) sain.apparence = "clair";
    return sain;
  }

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

  let index = null;
  const leconsChargees = new Map();

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

  function echapper(texte) {
    return String(texte)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function typographie(html) {
    return horsBalises(html, (texte) => texte.replace(/ (?=[?!:;»])/g, "\u00a0").replace(/« /g, "«\u00a0"));
  }

  function insecable(texte) {
    return String(texte).replace(/ /g, "\u00a0");
  }

  function enrichir(texte, { references = true } = {}) {
    const base = typographie(
      echapper(texte)
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/\n/g, "<br>")
    );
    return references ? lierReferences(lierAdresses(base)) : lierAdresses(base);
  }

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

  function sourceQrCode() {
    return (window.FIGURES_EMBARQUEES || {})["qr-cours-decouvertes.png"] || "qr-cours-decouvertes.png";
  }

  function sourceLogoSilhouette() {
    return (window.FIGURES_EMBARQUEES || {})["icones/logo-ebtm-silhouette.png"] || "icones/logo-ebtm-silhouette.png";
  }

  function sourceFigure(fichier) {
    const chemin = `contenu/figures/${fichier}`;
    return (window.FIGURES_EMBARQUEES || {})[chemin] || chemin;
  }

  function html(chaines, ...valeurs) {
    return chaines.reduce((acc, morceau, i) => acc + morceau + (i < valeurs.length ? valeurs[i] : ""), "");
  }

  const boutonEnDeuxTemps = (nom, libelle) =>
    `<button type="button" class="bouton-principal bouton-danger" data-${nom}="demander">${libelle}</button>`;
  const questionEnDeuxTemps = (nom, question, oui) =>
    `<p class="reglage__avertissement">${question}</p>` +
    '<div class="reglage__confirmation">' +
    `<button type="button" class="bouton-principal bouton-principal--secondaire" data-${nom}="annuler">Annuler</button>` +
    `<button type="button" class="bouton-principal bouton-danger" data-${nom}="confirmer">${oui}</button>` +
    "</div>";

  function choixEnDeuxTemps(zone, choix, nom, bouton, question) {
    if (choix === "demander") {
      zone.innerHTML = question;
      zone.querySelector(`[data-${nom}="annuler"]`).focus();
      return false;
    }
    if (choix === "annuler") {
      zone.innerHTML = bouton;
      zone.querySelector("button").focus();
      return false;
    }
    return true;
  }

  const principal = document.getElementById("principal");

  document.querySelector(".saut").addEventListener("click", (evenement) => {
    evenement.preventDefault();
    principal.focus();
  });

  const minuteriesFeuilles = new WeakMap();

  let autourDesFeuilles = null;
  const moinsDeMouvement = window.matchMedia("(prefers-reduced-motion: reduce)");

  const auDoigt = window.matchMedia("(pointer: coarse)");

  const dureeDuStyle = (nom) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(nom)) || 0;
  function dureeFermetureFeuille() {
    return moinsDeMouvement.matches ? 0 : dureeDuStyle("--feuille-fermeture");
  }
  function feuilleOuverte(fenetre) {
    return fenetre.classList.contains("feuille--ouverte");
  }

  function montrerFeuille(fenetre, { aussitot = false } = {}) {

    if (autourDesFeuilles) autourDesFeuilles.ouverture();
    clearTimeout(minuteriesFeuilles.get(fenetre));
    if (aussitot) fenetre.classList.add("feuille--aussitot");
    if (fenetre.hidden) {
      fenetre.hidden = false;
      void fenetre.offsetHeight;
    }
    fenetre.classList.add("feuille--ouverte");
    if (aussitot) {
      void fenetre.offsetHeight;

      requestAnimationFrame(() => requestAnimationFrame(() => fenetre.classList.remove("feuille--aussitot")));
    }
  }

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

    const zones = [
      document.getElementById("barre"),
      document.getElementById("principal"),
      document.getElementById("navigation"),
      document.querySelector(".saut"),
    ];
    for (const zone of zones) {
      if (!zone) continue;
      zone.inert = actif;
      if (actif) zone.setAttribute("aria-hidden", "true");
      else zone.removeAttribute("aria-hidden");
    }
    document.body.style.overflow = actif ? "hidden" : "";
  }

  function equiperBandeau(rangee) {
    const boutons = Array.from(rangee.querySelectorAll(":scope > button"));
    if (boutons.length < 2) return;
    const bulle = document.createElement("span");
    bulle.className = "bandeau-bulle";
    bulle.setAttribute("aria-hidden", "true");

    bulle.hidden = true;
    rangee.classList.add("bandeau--equipe");

    const cadreBulle = document.createElement("span");
    cadreBulle.className = "bandeau-cadre";
    cadreBulle.setAttribute("aria-hidden", "true");
    cadreBulle.append(bulle);

    rangee.prepend(cadreBulle);
    let place = -1;
    let cadre = null;
    let largeurConnue = rangee.offsetWidth;

    const choisi = () => boutons.findIndex((b) => b.matches('[aria-selected="true"], [aria-pressed="true"]'));

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

        const mesure = mesurer(index);
        const bouge = ["x", "y", "largeur", "hauteur"].some((cle) => mesure[cle] !== cadre[cle]);
        if (bouge) poser(index, false);
      }
    };

    suivre();

    if ("ResizeObserver" in window) {
      new ResizeObserver(() => {
        if (rangee.offsetWidth === largeurConnue) return;
        largeurConnue = rangee.offsetWidth;
        if (place >= 0) poser(place, false);
      }).observe(rangee);
    }

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

  const icone = (chemins, taille = 24, trait = 1.9) =>
    `<svg class="icone" viewBox="0 0 24 24" width="${taille}" height="${taille}" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" stroke-width="${trait}" stroke-linecap="round" stroke-linejoin="round">${chemins}</svg>`;
  const TRACES = {
    livre: '<path d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0"/><path d="M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0"/><path d="M3 6l0 13"/><path d="M12 6l0 13"/><path d="M21 6l0 13"/>',
    crayon: '<path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4"/><path d="M13.5 6.5l4 4"/>',
    personnes: '<path d="M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/><path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0 -3 -3.85"/>',
    roue: '<path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065"/><path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/>',
    chevronGauche: '<path d="M15 6l-6 6l6 6"/>',
    chevronDroite: '<path d="M9 6l6 6l-6 6"/>',
    envoi: '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"/><path d="M7 9l5 -5l5 5"/><path d="M12 4l0 12"/>',
    fichier: '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/><path d="M9 9l1 0"/><path d="M9 13l6 0"/><path d="M9 17l6 0"/>',
    telephone: '<path d="M5 4h4l2 5l-2.5 1.5a11 11 0 0 0 5 5l1.5 -2.5l5 2v4a2 2 0 0 1 -2 2a16 16 0 0 1 -15 -15a2 2 0 0 1 2 -2"/>',
    plan: '<path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/><path d="M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0z"/>',
    externe: '<path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6"/><path d="M11 13l9 -9"/><path d="M15 4h5v5"/>',
  };

  const barre = document.getElementById("barre");
  const zoneOnglets = document.getElementById("zone-onglets");
  const titreBarre = document.getElementById("titre-barre");
  const zoneNavigation = document.getElementById("zone-navigation");
  const boutonAffichage = document.getElementById("ouvrir-reglages");
  const navigationBas = document.getElementById("navigation");
  const ICONES_ONGLETS = { "/": "livre", "/notes": "crayon", "/eglise": "personnes", "/plus": "roue" };

  const lienRetour = (cle, nom, { retour = false } = {}) =>
    `<a class="bouton-retour" href="#${cle}" ${retour ? "data-retour" : ""}>${icone(TRACES.chevronGauche, 20, 2)}<span
      class="visuellement-cache">Retour à </span>${nom}</a>`;
  const RETOUR = lienRetour("/", "Leçons");
  const RETOUR_EGLISE = lienRetour("/eglise", "L’église");
  const nomEcranNotes = (cle) => {
    const lecon = cle.match(/^\/notes\/(\d+)/);
    return lecon ? `Leçon ${lecon[1]}` : "Notes";
  };
  const retourNotes = (cle) => lienRetour(cle, nomEcranNotes(cle), { retour: true });

  const CLE_INVITE = "cours-decouvertes-invite-installation";

  const PARTAGE_IOS = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
      focusable="false"><path d="M12 3.5 L12 15" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" /><path d="M8 7 L12 3.2 L16 7" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /><path
      d="M7.5 10.5 L5.5 10.5 L5.5 20.5 L18.5 20.5 L18.5 10.5 L16.5 10.5" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>`;

  const MENU_IOS = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
      focusable="false"><path d="M4 7 H20 M4 12 H20 M4 17 H14" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" /></svg>`;

  let installationDifferee = null;

  function dejaInstallee() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function surIPhone() {
    const ua = navigator.userAgent;

    return /iPhone|iPod|iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }

  function versionSafari() {
    const ua = navigator.userAgent;
    if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return 0;
    const trouve = /Version\/(\d+)/.exec(ua);
    return trouve ? Number(trouve[1]) : 0;
  }

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

    }
    const bloc = document.getElementById("invite-installation");
    if (bloc) bloc.remove();
  }

  window.addEventListener("beforeinstallprompt", (evenement) => {
    evenement.preventDefault();
    installationDifferee = evenement;
    if (location.hash === "#/" || location.hash === "") afficherAccueil();
  });

  window.addEventListener("appinstalled", () => {
    installationDifferee = null;
    refuserInvite();
  });

  const CLE_ORDINATEUR = "cours-decouvertes-ecran-ordinateur";

  function surOrdinateur() {
    return !auDoigt.matches && !dejaInstallee();
  }

  function derogationOrdinateur() {
    try {
      return localStorage.getItem(CLE_ORDINATEUR) === "accepte";
    } catch {
      return false;
    }
  }

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
        <button type="button" class="bouton-principal bouton-principal--secondaire" data-ordinateur="continuer">
          Continuer sur cet écran
        </button>
      </section>
    `;
  }

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
        <button type="button" class="bouton-principal bouton-principal--secondaire" data-invite="plus-tard">Plus tard</button>
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
        <button type="button" class="bouton-principal bouton-principal--secondaire" data-invite="plus-tard">Plus tard</button>
      </section>`;
    }

    if (!apiInstallationAttendue && auDoigt.matches) {
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
        <button type="button" class="bouton-principal bouton-principal--secondaire" data-invite="plus-tard">Plus tard</button>
      </section>`;
    }

    return "";
  }

  document.addEventListener("click", (evenement) => {
    if (!evenement.target.closest("[data-ordinateur]")) return;
    try {
      localStorage.setItem(CLE_ORDINATEUR, "accepte");
    } catch {

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

      }

      history.replaceState(history.state, "", location.pathname + "?installer" + location.hash);
      allerVersOnglet("/");
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

    installationDifferee = null;
    if (outcome === "accepted") refuserInvite();
  });

  const CROIX = `<svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"
      focusable="false"><path d="M5 5 L15 15 M15 5 L5 15" fill="none" stroke="currentColor"
      stroke-width="2.2" stroke-linecap="round" /></svg>`;

  const LOUPE = `<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"
      focusable="false"><circle cx="8.5" cy="8.5" r="5.4" fill="none" stroke="currentColor"
      stroke-width="2" /><path d="M12.7 12.7 L17 17" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" /></svg>`;

  let hauteurBarre = 0;

  function ajusterHauteurBarre() {
    hauteurBarre = barre.getBoundingClientRect().height;
    document.body.style.paddingTop = `${hauteurBarre}px`;
  }
  window.addEventListener("resize", ajusterHauteurBarre);

  if ("ResizeObserver" in window) new ResizeObserver(ajusterHauteurBarre).observe(barre);

  let retourVersListe = false;
  const ecransGardes = new Map();
  let ecranAffiche = null;
  function garderEcranQuitte() {
    if (!ecranAffiche || !estListe(ecranAffiche.cle)) return;
    const noeuds = document.createDocumentFragment();
    noeuds.append(...principal.childNodes);
    noeuds.querySelectorAll(".ligne--touchee, .ligne--revient").forEach((ligne) => {
      ligne.classList.remove("ligne--touchee", "ligne--revient");
    });

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

  function montrerNavigation(ecran) {
    const lecture = !ecran || /^\/(lecon|documents)\//.test(ecran.cle);
    navigationBas.hidden = lecture;
    document.body.classList.toggle("avec-navigation", !lecture);
    for (const lien of navigationBas.querySelectorAll("[data-onglet]")) {
      if (ecran && lien.dataset.onglet === ecran.onglet) lien.setAttribute("aria-current", "page");
      else lien.removeAttribute("aria-current");
    }

    if (!ecran) return;
    const rang = String(Object.keys(ICONES_ONGLETS).indexOf(ecran.onglet));
    const avant = navigationBas.style.getPropertyValue("--onglet");
    if (avant === rang) return;
    navigationBas.style.setProperty("--onglet", rang);
    const bulle = navigationBas.querySelector(".navigation__bulle");
    if (!bulle || avant === "") return;
    bulle.classList.remove("navigation__bulle--bouge");
    void bulle.offsetWidth;
    bulle.classList.add("navigation__bulle--bouge");
  }
  for (const lien of navigationBas.querySelectorAll("[data-onglet]")) {
    lien.insertAdjacentHTML("afterbegin", icone(TRACES[ICONES_ONGLETS[lien.dataset.onglet]]));
  }

  function afficherDans(contenuHtml, titreDocument, { garderOnglets = false } = {}) {
    if (!garderOnglets) zoneOnglets.innerHTML = "";

    zoneNavigation.replaceChildren();
    titreBarre.textContent = "";

    boutonAffichage.hidden = true;
    ligneOuverte = null;

    const modifier = document.getElementById("modifier-notes");
    modifier.hidden = true;
    modifier.setAttribute("aria-pressed", "false");
    modifier.textContent = "Modifier";
    reposerBarre();

    const actif = document.activeElement;
    const ongletGarde = garderOnglets && actif && actif.matches('[role="tab"]') ? actif : null;
    const cle = ecranCourant ? ecranCourant.cle : null;
    montrerNavigation(ecranCourant);
    garderEcranQuitte();
    const garde = ecransGardes.get(cle);
    ecransGardes.delete(cle);
    if (garde && garde.html === contenuHtml) principal.replaceChildren(garde.noeuds);
    else principal.innerHTML = contenuHtml;
    ecranAffiche = { cle, html: contenuHtml };
    document.title = titreDocument ? `${titreDocument} — Cours découvertes` : "Cours découvertes";
    if (!retourVersListe) window.scrollTo(0, 0);
    const titre = principal.querySelector("h1");
    if (titre) titre.setAttribute("tabindex", "-1");
    if (ongletGarde && ongletGarde.isConnected) ongletGarde.focus({ preventScroll: true });
    else if (titre) titre.focus({ preventScroll: true });

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

  const ALIGNEMENT_MS = 120;
  const SEUIL_OMBRE = 4;

  let minuterieAlignement = null;

  const COURSE_RANGER = 16;
  const COURSE_MONTRER = 10;
  let ongletsRangeables = false;
  let derniereY = 0;
  let course = 0;

  function montrerOnglets() {
    barre.classList.remove("barre--onglets-rangees");
  }

  function rendreOngletsRangeables() {
    ongletsRangeables = Boolean(zoneOnglets.querySelector(".onglets"));
    barre.classList.toggle("barre--onglets", ongletsRangeables);
    derniereY = Math.max(0, window.scrollY);
    course = 0;
  }

  zoneOnglets.addEventListener("focusin", montrerOnglets);

  function reposerBarre() {
    barre.classList.remove("barre--flottante", "barre--onglets", "barre--onglets-rangees");
    ongletsRangeables = false;
    derniereY = 0;
    course = 0;
    lectureEnCours = null;
  }

  function auRepos() {
    memoriserLecture();
  }

  const PREMIERS_BLOCS_IGNORES = 2;

  let lectureEnCours = null;
  let minuterieLecture = null;

  function blocsDuPanneau() {
    let conteneur = principal.querySelector(".panneau:not([hidden])");
    if (!conteneur) return [];

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
    if (!cible) return;

    ajusterHauteurBarre();
    const y = cible.getBoundingClientRect().top + window.scrollY - hauteurBarre - 8;
    window.scrollTo(0, Math.max(0, y));
  }

  function surDefilement() {

    if (pageFigee !== null) return;
    const y = Math.max(0, window.scrollY);
    barre.classList.toggle("barre--flottante", y > SEUIL_OMBRE);

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

  const ECHELLES = { "-1": 0.9, 0: 1, 1: 1.15, 2: 1.3 };

  function appliquerTaillePolice() {
    document.documentElement.style.setProperty("--echelle", ECHELLES[etat.taillePolice] || 1);
  }

  const SOMBRE_SYSTEME = window.matchMedia("(prefers-color-scheme: dark)");

  function appliquerApparence() {
    const choix = etat.apparence || "clair";
    const sombre = choix === "sombre" || (choix === "systeme" && SOMBRE_SYSTEME.matches);
    if (sombre) document.documentElement.dataset.apparence = "sombre";
    else delete document.documentElement.dataset.apparence;
  }

  SOMBRE_SYSTEME.addEventListener("change", () => {
    if ((etat.apparence || "clair") === "systeme") appliquerApparence();
  });

  function recalerSur(repere) {
    if (!repere || !repere.bloc.isConnected) return;
    const ecart = repere.bloc.getBoundingClientRect().top - repere.haut;
    if (Math.abs(ecart) < 1) return;
    window.scrollBy(0, ecart);
    derniereY = window.scrollY;
  }

  let repereAffichage = null;

  function changerTaillePolice(delta, repere) {
    etat.taillePolice = Math.max(-1, Math.min(2, (etat.taillePolice || 0) + delta));
    appliquerTaillePolice();
    enregistrerEtat();
    ajusterHauteurBarre();
    recalerSur(repere);
  }

  const repereSur = (bloc) => (bloc ? { bloc, haut: bloc.getBoundingClientRect().top } : null);

  function blocLu() {
    const blocs = blocsDuPanneau();
    const candidats = blocs.length ? blocs : [...principal.querySelectorAll("p, h2, h3, li, blockquote, figure, table")];
    const limite = hauteurBarre + 8;
    return candidats.find((bloc) => bloc.getBoundingClientRect().bottom > limite) || null;
  }

  const NOMS_TAILLES = { "-1": "Petit", 0: "Normal", 1: "Grand", 2: "Très grand" };

  const adresseDuCours = () => location.origin + location.pathname + "?installer";

  function htmlReglages({ complet }) {
    return html`
      ${complet ? html`<h2 class="titre-section">Affichage</h2>` : ""}
      <div class="reglage">
        <p class="reglage__libelle">Taille du texte</p>
        <div class="reglage__commandes">
          <button type="button" class="bouton-taille" data-reglage="moins" aria-label="Réduire la taille du texte">A−</button>
          <span class="reglage__valeur" data-reglage="taille" aria-live="polite"></span>
          <button type="button" class="bouton-taille bouton-taille--plus" data-reglage="plus" aria-label="Agrandir la taille du texte">A+</button>
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
      ${
        complet
          ? html`<h2 class="titre-section">Partager le cours</h2>
              <div class="reglage partage">
                <button type="button" class="partage__agrandir" data-reglage="agrandir-qr" aria-label="Agrandir le code QR">
                  <img class="partage__qr" src="${sourceQrCode()}" alt="Code QR du cours découvertes" width="120" height="120" />
                  <span class="partage__indice" aria-hidden="true">Toucher pour agrandir</span>
                </button>
                <div class="partage__texte">
                  <p class="reglage__note">À scanner avec l’appareil photo</p>
                  <button type="button" class="bouton-principal bouton-principal--secondaire" data-partage="${echapper(adresseDuCours())}">
                    Partager le lien
                  </button>
                  <p class="partage__etat" aria-live="polite"></p>
                </div>
              </div>
              <div data-reglage="installation" hidden>
                <h2 class="titre-section">Installation</h2>
                <div class="reglage">
                  <button type="button" class="bouton-principal bouton-principal--secondaire" data-invite="revoir">
                    Installer l’application
                  </button>
                  <p class="reglage__note">
                    Le cours reste sur votre appareil, fonctionne sans connexion, et vos réponses sont à
                    l’abri du ménage que fait le navigateur.
                  </p>
                </div>
              </div>
              <h2 class="titre-section">Mes réponses et mes notes</h2>
              <div class="reglage">
                <p class="reglage__note">Elles restent sur cet appareil : ni l’église ni l’enseignant n’y ont accès.</p>
                <div data-reglage="effacement"></div>
              </div>`
          : ""
      }`;
  }

  const BOUTON_EFFACER = boutonEnDeuxTemps("effacer", "Effacer toutes mes réponses");
  const CONFIRMATION_EFFACER = questionEnDeuxTemps(
    "effacer",
    "Êtes-vous sûr ? Toutes vos réponses, vos notes, les versets cochés " +
      "et les leçons terminées seront effacés de cet appareil. C’est définitif, et ils ne sont " +
      "enregistrés nulle part ailleurs.",
    "Oui, tout effacer"
  );

  function rafraichirReglages(racine) {
    racine.querySelector('[data-reglage="taille"]').textContent = NOMS_TAILLES[etat.taillePolice] || "Normal";
    racine.querySelector('[data-reglage="moins"]').disabled = etat.taillePolice <= -1;
    racine.querySelector('[data-reglage="plus"]').disabled = etat.taillePolice >= 2;
    for (const bouton of racine.querySelectorAll("button[data-apparence]"))
      bouton.setAttribute("aria-pressed", String(bouton.dataset.apparence === (etat.apparence || "clair")));
    const installation = racine.querySelector('[data-reglage="installation"]');
    if (installation) installation.hidden = dejaInstallee();
    const effacement = racine.querySelector('[data-reglage="effacement"]');
    if (effacement) effacement.innerHTML = BOUTON_EFFACER;
  }

  async function reglageTouche(racine, evenement) {
    const qr = evenement.target.closest('[data-reglage="agrandir-qr"]');
    if (qr) {
      declencheur = qr;
      ouvrirLoupe(qr.querySelector("img"));
      return true;
    }
    const taille = evenement.target.closest('[data-reglage="moins"], [data-reglage="plus"]');
    if (taille) {

      let repere = repereSur(taille);
      if (racine.closest(".feuille")) repere = repereAffichage = repereAffichage || repereSur(blocLu());
      changerTaillePolice(taille.dataset.reglage === "plus" ? 1 : -1, repere);
      rafraichirReglages(racine);
      return true;
    }

    const apparence = evenement.target.closest("button[data-apparence]");
    if (apparence) {
      etat.apparence = apparence.dataset.apparence;
      appliquerApparence();
      enregistrerEtat();
      rafraichirReglages(racine);
      return true;
    }
    const effacer = evenement.target.closest("[data-effacer]");
    if (!effacer) return false;
    const zone = racine.querySelector('[data-reglage="effacement"]');
    if (choixEnDeuxTemps(zone, effacer.dataset.effacer, "effacer", BOUTON_EFFACER, CONFIRMATION_EFFACER)) {

      const conserves = { taillePolice: etat.taillePolice, apparence: etat.apparence };
      etat = { ...ETAT_PAR_DEFAUT(), ...conserves };

      enregistrerEtat(true);
      zone.innerHTML = '<p class="reglage__note" role="status">Vos réponses ont été effacées.</p>';
    }
    return true;
  }

  const reglages = document.createElement("div");
  reglages.className = "feuille";
  reglages.hidden = true;
  reglages.innerHTML = `
    <div class="feuille__carte" role="dialog" aria-modal="true" aria-labelledby="reglages-titre">
      <div class="feuille__entete">
        <p class="feuille__titre" id="reglages-titre">Affichage</p>
        <button type="button" class="feuille__fermer" aria-label="Fermer">${CROIX}</button>
      </div>
      <div class="feuille__corps feuille__corps--reglages">${htmlReglages({ complet: false })}</div>
    </div>`;
  document.body.appendChild(reglages);
  equiperBandeau(reglages.querySelector(".groupe-boutons"));

  function ouvrirReglages({ aussitot = false, parHistorique = false } = {}) {
    rafraichirReglages(reglages);
    if (!parHistorique) entrerFenetre({ type: "reglages" });
    montrerFeuille(reglages, { aussitot });
    neutraliserArrierePlan(true);
    reglages.querySelector(".feuille__fermer").focus();
  }

  function fermerReglages({ aussitot = false, parHistorique = false } = {}) {
    cacherFeuille(reglages, { aussitot });
    neutraliserArrierePlan(false);
    document.getElementById("ouvrir-reglages").focus({ preventScroll: true });
    const repere = repereAffichage;
    repereAffichage = null;
    const suite = parHistorique ? Promise.resolve() : sortirFenetre();

    if (repere)
      suite.then(() => {
        const fin = performance.now() + 700;
        let abandon = false;
        const lacher = () => (abandon = true);
        window.addEventListener("touchstart", lacher, { once: true, passive: true });
        window.addEventListener("wheel", lacher, { once: true, passive: true });
        const veiller = () => {
          if (abandon) return;
          recalerSur(repere);
          if (performance.now() < fin) requestAnimationFrame(veiller);
          else {
            window.removeEventListener("touchstart", lacher);
            window.removeEventListener("wheel", lacher);
          }
        };
        veiller();
      });
    return suite;
  }

  document.getElementById("ouvrir-reglages").addEventListener("click", () => ouvrirReglages());

  reglages.addEventListener("click", (evenement) => {
    if (evenement.target === reglages || evenement.target.closest(".feuille__fermer")) {
      fermerReglages();
      return;
    }
    reglageTouche(reglages, evenement);
  });

  appliquerApparence();

  appliquerTaillePolice();

  const deuxChiffres = (n) => String(n).padStart(2, "0");

  const CHEVRON = icone(TRACES.chevronDroite, 18);

  async function afficherAccueil() {
    const liste = await chargerIndex();

    const lignes = liste.lecons
      .map((lecon) => {
        const statut = statutLecon(lecon);
        const etat =
          statut === "terminee"
            ? html`<span class="ligne-lecon__etat">Terminée</span>`
            : statut === "en-cours"
              ? html`<span class="ligne-lecon__etat ligne-lecon__etat--en-cours"><span class="point" aria-hidden="true"></span>En cours</span>`
              : "";
        return html`
          <li>
            <a class="ligne-lecon ligne-lecon--${statut}" href="#/lecon/${lecon.numero}">
              <span class="ligne-lecon__numero"><span class="visuellement-cache">Leçon </span>${deuxChiffres(lecon.numero)}</span>
              <span class="ligne-lecon__titre">${echapper(lecon.titre)}</span>
              ${etat}
            </a>
          </li>
        `;
      })
      .join("");

    if (surOrdinateur() && !derogationOrdinateur()) {
      afficherDans(ecranOrdinateur(), "");
      montrerNavigation(null);
      return;
    }
    if (arriveeParQrCode() && !dejaInstallee()) {
      afficherDans(ecranInstallation(), "Installer");
      montrerNavigation(null);
      return;
    }

    afficherDans(
      html`
        <div class="accueil-tete">
          <h1 class="titre-accueil"><span class="titre-accueil__petit">Cours</span> <span class="titre-accueil__grand">Découvertes</span></h1>
          <span class="logo-rond" role="img" aria-label="EBTM"><span class="logo-rond__dessin"
            style="-webkit-mask-image: url('${sourceLogoSilhouette()}'); mask-image: url('${sourceLogoSilhouette()}')"></span></span>
        </div>
        ${stockageIndisponible ? avertissementStockage() : ""}
        ${inviteInstallation()}
        <ul class="liste-lignes">${lignes}</ul>
        <ul class="liste-lignes liste-lignes--a-part">
          <li><a class="ligne-lecon" href="#/a-propos"><span class="ligne-lecon__titre">À propos du cours</span>${CHEVRON}</a></li>
        </ul>
      `,
      ""
    );
  }

  function avertissementStockage() {
    return html`<div class="message message--erreur" role="alert">
      L’enregistrement sur cet appareil est bloqué (navigation privée ou stockage plein).
      Vos réponses ne seront pas conservées après fermeture.
    </div>`;
  }

  const ONGLETS = ["lecture", "versets", "questions"];

  async function afficherLecon(numero, ongletDemande) {
    const liste = await chargerIndex();
    const lecon = await chargerLecon(numero);

    const disponibles = ONGLETS.filter(
      (nom) =>
        nom === "lecture" ||
        (nom === "versets" && lecon.versets_a_apprendre.length) ||
        (nom === "questions" && lecon.questions.length)
    );
    const onglet = disponibles.includes(ongletDemande) ? ongletDemande : "lecture";

    const dernier = disponibles[disponibles.length - 1];
    const suivante = liste.lecons.find((l) => l.numero === numero + 1);

    const NOMS_ONGLETS = { lecture: "Lecture", versets: "Versets", questions: "Questions" };
    const enTete =
      onglet === "lecture"
        ? html`<p class="lecon-numero" aria-hidden="true">${deuxChiffres(lecon.numero)}</p>
            <h1 class="lecon-titre"><span class="visuellement-cache">Leçon ${lecon.numero} · </span>${echapper(lecon.titre)}</h1>
            <p class="surtitre">Pages ${echapper(lecon.pages)} du livret</p>`
        : html`<h1 class="visuellement-cache">
            Leçon ${lecon.numero} · ${echapper(lecon.titre)} — ${NOMS_ONGLETS[onglet]}
          </h1>`;

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

    const precedent = pile[rangCourant - 1] || "";
    zoneNavigation.innerHTML = /^\/notes(\/|$)/.test(precedent) ? retourNotes(precedent) : RETOUR;
    titreBarre.textContent = onglet === "lecture" ? "" : lecon.titre;
    boutonAffichage.hidden = false;
    peindreNotes();

    if (rangeeEnPlace) {

      marquerOnglet(onglet);
      const compte = rangeeEnPlace.querySelector("#onglet-questions .onglet__compte");
      if (compte) compte.textContent = `${nbReponses(lecon)} / ${lecon.questions.length}`;
    } else {

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

    reprendreLecture(`${numero}/${onglet}`);
    rendreOngletsRangeables();

    if (noteAMontrer) {
      montrerNoteDansLecon(noteAMontrer);
      noteAMontrer = null;
    }
  }

  function boutonOnglet(numero, id, libelle, compte, actif) {

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

  function rendreLecture(lecon, numero, avecFinDeLecon, suivante) {

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
                <p><strong>Versets à apprendre par cœur&nbsp;:</strong> ${lecon.versets_a_apprendre.map((v) => insecable(echapper(v.reference))).join(" et ")}</p>
                <a class="bouton-principal bouton-principal--secondaire" href="#/lecon/${numero}/versets">S’entraîner aux versets</a>
              </div>`
            : ""
        }
      </article>
      ${avecFinDeLecon ? blocFinDeLecon(lecon, suivante) : ""}
    `;
  }

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

            zone.textContent = texteComplet;
            zone.classList.add("verset-carte__texte--cache");
            zone.setAttribute("aria-hidden", "true");
            remplacement.hidden = false;
          }
        });
      });
    });
  }

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
                <span class="etiquette">Question ${question.numero}</span>${enrichir(question.texte)}
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
              <span class="etiquette">Question ${question.numero}</span>${enrichir(question.texte)}
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
      <p class="pied">Vos réponses restent sur cet appareil.</p>
    `;
  }

  function blocFinDeLecon(lecon, suivante) {
    const terminee = Boolean(etat.terminees[lecon.numero]);
    return html`<div class="fin-lecon" id="fin-lecon">
      ${rendreFinLecon(terminee, suivante, lecon.questions.length > 0)}
    </div>`;
  }

  function rendreFinLecon(terminee, suivante, avecQuestions) {
    if (terminee) {

      return html`
        <p><strong>Leçon terminée.</strong></p>
        <a class="bouton-principal" href="#/">Toutes les leçons</a>
        <button class="bouton-principal bouton-principal--secondaire" data-action="basculer-terminee">Marquer comme non terminée</button>
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

      const etatZone = zone.parentElement.querySelector(".question__etat");
      let minuterie = null;
      const enregistrer = () => {
        clearTimeout(minuterie);
        if (reponseEnAttente === enregistrer) reponseEnAttente = null;
        const ok = definirReponse(numero, Number(zone.dataset.question), zone.value);
        etatZone.textContent = ok ? "" : "Attention : cet appareil refuse d’enregistrer. Votre réponse sera perdue.";
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

  const TITRE_DOCUMENTS = "La foi et les pratiques";

  async function afficherEglise() {
    const liste = await chargerIndex();
    const eglise = await chargerJson("contenu/eglise.json");
    const ligne = (adresse, trace, titre) => html`
      <li>
        <a class="ligne-lecon ligne-lecon--icone" href="#${adresse}">
          ${icone(trace, 20, 1.6)}
          <span class="ligne-lecon__titre">${titre}</span>
          ${CHEVRON}
        </a>
      </li>`;

    const ligneInfo = (l) => {
      if (l.type === "telephone") {
        return html`<li>
          <a class="ligne-lecon ligne-lecon--icone ligne-lecon--detail" href="tel:+33${echapper(l.numero.replace(/\s/g, "").slice(1))}">
            ${icone(TRACES.telephone, 20, 1.6)}
            <span class="ligne-lecon__titre">${echapper(l.nom)}</span>
            <span class="ligne-lecon__detail">${echapper(l.role)} · ${echapper(l.numero)}</span>
          </a>
        </li>`;
      }
      if (l.type === "lien") {
        return html`<li>
          <a class="ligne-lecon ligne-lecon--icone ligne-lecon--detail" href="${echapper(l.adresse)}" target="_blank" rel="noopener">
            ${icone(l.icone === "plan" ? TRACES.plan : TRACES.externe, 20, 1.6)}
            <span class="ligne-lecon__titre">${echapper(l.titre)}<span class="visuellement-cache"> (s’ouvre dans le navigateur)</span></span>
            ${l.detail ? html`<span class="ligne-lecon__detail">${echapper(l.detail)}</span>` : ""}
          </a>
        </li>`;
      }
      return html`<li class="ligne-info"><span class="ligne-info__debut">${echapper(l.debut)}</span
        ><span class="ligne-info__texte">${echapper(l.texte)}</span></li>`;
    };
    const documents = (liste.documents || [])
      .map((d) => ligne(`/documents/${d.slug}`, TRACES.fichier, echapper(d.titre)))
      .join("");
    const blocs = (eglise.blocs || [])
      .map(
        (b) => html`
          <h2 class="titre-section">${echapper(b.titre)}</h2>
          <ul class="liste-lignes">${b.lignes.map(ligneInfo).join("")}</ul>`
      )
      .join("");
    afficherDans(
      html`
        <h1 class="titre-page">L’église</h1>
        ${documents ? html`<h2 class="titre-section">${TITRE_DOCUMENTS}</h2><ul class="liste-lignes">${documents}</ul>` : ""}
        ${blocs}
      `,
      "L’église"
    );
  }

  function enrichirDocument(texte, reperes) {
    const simple = (t) => enrichir(t, { references: false });
    if (!reperes || !reperes.length) return simple(texte);
    let sortie = "";
    let curseur = 0;
    for (const [debut, fin, cle] of reperes) {

      if (debut < curseur || fin > texte.length) return simple(texte);

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

    zoneNavigation.innerHTML = RETOUR_EGLISE;
    boutonAffichage.hidden = false;
    reprendreLecture(`document/${slug}`);
  }

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
          Vos réponses, vos notes, les versets cochés et les leçons terminées restent sur cet appareil.
          Ni l’église ni l’enseignant n’y ont accès. Si vous effacez les données de
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

    zoneNavigation.innerHTML = RETOUR;
  }

  async function afficherPlus() {
    afficherDans(
      html`
        <h1 class="titre-page">Plus</h1>
        <section class="reglages-page">${htmlReglages({ complet: true })}</section>
      `,
      "Plus"
    );
    const page = principal.querySelector(".reglages-page");

    if (!navigator.share) page.querySelector("[data-partage]").textContent = "Copier le lien";
    rafraichirReglages(page);
    equiperBandeau(page.querySelector(".groupe-boutons"));
    page.addEventListener("click", (evenement) => reglageTouche(page, evenement));
  }

  document.addEventListener("click", async (evenement) => {
    const bouton = evenement.target.closest("[data-partage]");
    if (!bouton) return;
    const lien = bouton.dataset.partage;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Cours découvertes", url: lien });
      } catch {

      }
      return;
    }
    const etatPartage = document.querySelector(".partage__etat");
    try {
      await navigator.clipboard.writeText(lien);
      etatPartage.textContent = "Lien copié.";
    } catch {
      etatPartage.textContent = `Copie impossible. L’adresse : ${lien}`;
    }
  });

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

  function ouvrirLoupe(image, { parHistorique = false } = {}) {
    if (!parHistorique) entrerFenetre({ type: "loupe", src: image.src });
    const grande = loupe.querySelector("img");
    grande.src = image.src;
    grande.alt = image.alt;
    grande.classList.toggle("loupe__qr", image.classList.contains("partage__qr"));
    loupe.hidden = false;
    neutraliserArrierePlan(true);
    loupe.querySelector(".loupe__fermer").focus();
  }

  function fermerLoupe({ parHistorique = false } = {}) {
    loupe.hidden = true;
    neutraliserArrierePlan(false);
    if (declencheur) declencheur.focus();
    if (!parHistorique) sortirFenetre();
  }

  loupe.addEventListener("click", () => fermerLoupe());
  principal.addEventListener("click", (evenement) => {
    const bouton = evenement.target.closest(".figure__bouton");
    if (!bouton) return;
    declencheur = bouton;
    ouvrirLoupe(bouton.querySelector("img"));
  });

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

  function ouvrirVerset(reference, { aussitot = false, parHistorique = false } = {}) {

    const cle = reference.replace(/&amp;/g, "&");

    const passages =
      (versets && versets.versets[cle]) || (versetsDocuments && versetsDocuments.passages[cle]) || [];
    feuille.querySelector(".feuille__titre").textContent = cle;

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
    if (!parHistorique) entrerFenetre({ type: "verset", ref: reference });
    montrerFeuille(feuille, { aussitot });
    neutraliserArrierePlan(true);
    feuille.querySelector(".feuille__fermer").focus();
  }

  function fermerVerset({ aussitot = false, parHistorique = false } = {}) {
    cacherFeuille(feuille, { aussitot });
    neutraliserArrierePlan(false);
    if (refDeclencheur) refDeclencheur.focus();
    if (!parHistorique) sortirFenetre();
  }

  feuille.addEventListener("click", (evenement) => {
    if (evenement.target === feuille || evenement.target.closest(".feuille__fermer")) fermerVerset();
  });
  principal.addEventListener("click", (evenement) => {
    const bouton = evenement.target.closest(".ref");
    if (!bouton) return;

    evenement.preventDefault();
    refDeclencheur = bouton;
    ouvrirVerset(bouton.dataset.ref);
  });

  const ETIQUETTES = [
    { cle: "comprends", nom: "Pas compris", ecrire: false, invite: "Ce que je n’ai pas compris…" },
    { cle: "question", nom: "Ma question", ecrire: true, invite: "Ce que je veux demander…" },
    { cle: "vivre", nom: "À vivre", ecrire: true, invite: "Ce que je veux changer…" },
    { cle: "prier", nom: "Pour prier", ecrire: true, invite: "Ma prière…" },
    { cle: "encourage", nom: "Ça m’encourage", ecrire: false, invite: "Pourquoi ce passage m’encourage…" },
  ];
  const etiquetteDe = (cle) => ETIQUETTES.find((e) => e.cle === cle) || ETIQUETTES[1];

  function toutesLesNotes() {
    return Object.entries(etat.notes || {})
      .filter(([, n]) => n && typeof n.texte === "string" && n.texte && Number.isInteger(Number(n.lecon)))
      .map(([id, n]) => ({ ...n, id, lecon: Number(n.lecon), etiquette: etiquetteDe(n.etiquette).cle }))
      .filter((n) => !index || index.lecons.some((l) => l.numero === n.lecon));
  }

  const DUREE_CORBEILLE = 30 * 24 * 60 * 60 * 1000;

  const estRetiree = (n) => typeof n.retiree === "number" && Number.isFinite(n.retiree) && n.retiree > 0;
  function notesValides() {
    return toutesLesNotes().filter((n) => !estRetiree(n));
  }
  function notesRetirees() {
    return toutesLesNotes()
      .filter(estRetiree)
      .sort((a, b) => b.retiree - a.retiree);
  }

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

  const espacesSimples = (texte) => texte.replace(/\s+/g, " ").trim();

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
      .join("")
      .replace(/\u00a0/g, " ");
  }

  function positionDans(bloc, noeud, decalage) {
    const plage = document.createRange();
    plage.setStart(bloc, 0);
    plage.setEnd(noeud, decalage);
    const copie = plage.cloneContents();
    copie.querySelectorAll(".hors-texte").forEach((e) => e.remove());
    return copie.textContent.length;
  }

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

  function trouverPres(texte, cherche, pres) {
    let meilleure = -1;
    for (let i = texte.indexOf(cherche); i >= 0; i = texte.indexOf(cherche, i + 1)) {
      if (meilleure < 0 || Math.abs(i - pres) < Math.abs(meilleure - pres)) meilleure = i;
    }
    return meilleure;
  }

  function situerNote(article, note) {

    const bloc = [...article.querySelectorAll("[data-bloc]")].find((b) => b.dataset.bloc === note.bloc);
    note = { ...note, texte: String(note.texte).replace(/\u00a0/g, " ") };
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

  let choixEnCours = null;

  function montrerBarreNotes(plage) {
    barreNotes.hidden = false;

    const passage = plage.getBoundingClientRect();
    const hautBarre = barreNotes.getBoundingClientRect().top;
    if (passage.bottom > hautBarre - 16) window.scrollBy(0, passage.bottom - hautBarre + 32);
  }

  function cacherBarreNotes() {
    barreNotes.hidden = true;
    choixEnCours = null;
  }

  function examinerSelection() {

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

    const memePassage =
      choixEnCours && choixEnCours.adresse === choix.adresse && choixEnCours.debut === choix.debut && choixEnCours.fin === choix.fin;
    choixEnCours = choix;
    if (barreNotes.hidden || !memePassage) montrerBarreNotes(choix.plage);
  }

  autourDesFeuilles = {
    ouverture: cacherBarreNotes,

    fermeture: () => setTimeout(examinerSelection, 0),
  };

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

  const finDuDoigt = (evenement) => {
    if (evenement.pointerType !== "touch" || barreNotes.contains(evenement.target)) return;
    clearTimeout(attenteSelection);
    attenteSelection = setTimeout(examinerSelection, 10);
  };
  window.addEventListener("pointercancel", finDuDoigt, true);
  window.addEventListener(
    "pointerup",
    (evenement) => {
      if (evenement.pointerType === "touch") return finDuDoigt(evenement);
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

  let doigtSurChoix = null;
  let ignorerClicJusqua = 0;
  barreNotes.addEventListener("pointerdown", (evenement) => {
    const bouton = evenement.target.closest("button");
    if (!bouton) return;
    evenement.preventDefault();
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
    const REFUS = "Attention : cet appareil refuse d’enregistrer. Cette note sera perdue.";
    if (etiquette.ecrire) {
      ouvrirNote(id, { ecrire: true });

      if (!ok) fenetreNote.querySelector(".note-fenetre__etat").textContent = REFUS;
      return;
    }
    if (!ok) annoncer(REFUS);
    else annoncer(`Noté : ${etiquette.nom}`, { libelle: "Annuler", faire: () => retirerNote(id) });

    if (auClavier) rendreFocusAuPassage(id);
  }

  function rendreFocusAuPassage(id) {
    const marque = principal.querySelector(`mark.note-passage[tabindex="0"][data-note="${CSS.escape(id)}"]`);
    (marque || principal).focus({ preventScroll: true });
  }

  function retirerNote(id) {
    delete etat.notes[id];
    enregistrerEtat();
    peindreNotes();
  }

  const annonce = document.createElement("div");
  annonce.className = "annonce";
  annonce.setAttribute("role", "status");
  annonce.inert = true;
  annonce.innerHTML = '<span class="annonce__texte"></span><button type="button" class="annonce__bouton" hidden></button>';
  document.body.appendChild(annonce);
  let minuterieAnnonce = null;
  let actionAnnonce = null;

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

  const fenetreNote = document.createElement("div");
  fenetreNote.className = "feuille feuille--note";
  fenetreNote.hidden = true;
  fenetreNote.innerHTML = `
    <div class="feuille__carte" role="dialog" aria-modal="true" aria-labelledby="note-titre">
      <div class="feuille__entete">
        <p class="feuille__titre" id="note-titre"></p>
        <button type="button" class="feuille__fermer feuille__ok">OK</button>
      </div>
      <div class="feuille__corps feuille__corps--note">
        <p class="note-fenetre__lecon"></p>
        <blockquote class="note-fenetre__passage"></blockquote>
        <a class="note-fenetre__voir" href="#/" data-aller-note="" hidden>Voir dans la leçon</a>
        <label class="visuellement-cache" for="note-ecrit">Ce que j’écris</label>
        <textarea id="note-ecrit" class="note-fenetre__ecrit" rows="3" autocomplete="off" autocapitalize="sentences"></textarea>
        <p class="question__etat note-fenetre__etat" aria-live="polite"></p>
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
  const BOUTON_RETRAIT = boutonEnDeuxTemps("retirer", "Retirer cette note");
  const CONFIRMATION_RETRAIT = questionEnDeuxTemps("retirer", "Retirer cette note ? Le passage ne sera plus coloré.", "Oui, retirer");

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

  let pageFigee = null;
  function figerPage() {
    if (pageFigee !== null) return;
    pageFigee = window.scrollY;
    Object.assign(document.body.style, { position: "fixed", top: `-${pageFigee}px`, left: "0", right: "0" });
  }
  function libererPage() {
    if (pageFigee === null) return;
    const y = pageFigee;
    Object.assign(document.body.style, { position: "", top: "", left: "", right: "" });
    derniereY = y;
    window.scrollTo(0, y);
    pageFigee = null;
  }

  let noteOuverte = null;
  let noteAMontrer = null;

  function habillerFenetreNote(note) {
    const etiquette = etiquetteDe(note.etiquette);
    fenetreNote.querySelector(".feuille__titre").textContent = etiquette.nom;
    const passage = fenetreNote.querySelector(".note-fenetre__passage");
    passage.className = `note-fenetre__passage note-fenetre__passage--${etiquette.cle}`;
    for (const bouton of fenetreNote.querySelectorAll("[data-choix-etiquette]"))
      bouton.setAttribute("aria-pressed", String(bouton.dataset.choixEtiquette === etiquette.cle));
    zoneEcrit.placeholder = etiquette.invite;
  }

  let noteDepuisListe = null;
  function ouvrirNote(id, { ecrire = false, depuisListe = false, aussitot = false, parHistorique = false } = {}) {
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

    if (!parHistorique) entrerFenetre({ type: "note", id, depuisListe });
    figerPage();
    suivreZoneVisible(true);
    montrerFeuille(fenetreNote, { aussitot });
    neutraliserArrierePlan(true);
    ajusterHauteur(zoneEcrit);
    (ecrire ? zoneEcrit : fenetreNote.querySelector(".feuille__fermer")).focus({ preventScroll: true });
  }

  function fermerNote({ rendreFocus = true, aussitot = false, parHistorique = false } = {}) {
    enregistrerReponseEnAttente();
    if (!parHistorique) sortirFenetre();
    const id = noteOuverte;

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

    const y = window.scrollY;
    const changee = JSON.stringify(etat.notes[id]) !== depuisListe.avant;
    const lignes = () => [...principal.querySelectorAll("a.ligne-note[data-ouvrir-note]")];
    const rang = lignes().findIndex((a) => a.dataset.ouvrirNote === id);

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
      : "Attention : cet appareil refuse d’enregistrer. Votre note sera perdue.";
  }
  zoneEcrit.addEventListener("input", () => {
    ajusterHauteur(zoneEcrit);
    clearTimeout(minuterieEcrit);
    reponseEnAttente = enregistrerEcrit;
    minuterieEcrit = setTimeout(enregistrerEcrit, 400);
  });
  zoneEcrit.addEventListener("blur", enregistrerReponseEnAttente);

  const MARGE_CLAVIER = 16;

  function montrerAuDessusDuClavier(zone) {

    if (pageFigee !== null || !zoneVisible || document.activeElement !== zone) return;
    const cadre = zone.getBoundingClientRect();
    const basLibre = zoneVisible.offsetTop + zoneVisible.height - MARGE_CLAVIER;
    const hautLibre = barre.getBoundingClientRect().bottom + 8;

    const ecart = Math.min(cadre.bottom - basLibre, cadre.top - hautLibre);
    if (ecart > 0) window.scrollBy({ top: ecart, behavior: moinsDeMouvement.matches ? "auto" : "smooth" });
  }

  function apresClavier(action) {
    if (!zoneVisible || window.innerHeight - zoneVisible.height > 100) return action();
    let minuterie = null;
    const lancer = () => {
      zoneVisible.removeEventListener("resize", lancer);
      clearTimeout(minuterie);
      action();
    };
    zoneVisible.addEventListener("resize", lancer);
    minuterie = setTimeout(lancer, 600);
  }

  let toucherEcrit = null;
  document.addEventListener("touchstart", (evenement) => {
    const zone = evenement.target instanceof Element ? evenement.target.closest("textarea") : null;
    const doigt = evenement.touches[0];
    toucherEcrit = zone && document.activeElement !== zone && evenement.touches.length === 1
      ? { zone, x: doigt.clientX, y: doigt.clientY }
      : null;
  }, { passive: true, capture: true });
  document.addEventListener("touchend", (evenement) => {
    const toucher = toucherEcrit;
    toucherEcrit = null;
    if (!toucher || document.activeElement === toucher.zone) return;
    const doigt = evenement.changedTouches[0];
    if (Math.hypot(doigt.clientX - toucher.x, doigt.clientY - toucher.y) > 10) return;
    evenement.preventDefault();
    toucher.zone.focus({ preventScroll: true });
    const fin = toucher.zone.value.length;
    toucher.zone.setSelectionRange(fin, fin);
    apresClavier(() => montrerAuDessusDuClavier(toucher.zone));
  }, { capture: true });

  fenetreNote.addEventListener("click", (evenement) => {
    if (evenement.target === fenetreNote || evenement.target.closest(".feuille__fermer")) {
      fermerNote();
      return;
    }
    const voir = evenement.target.closest(".note-fenetre__voir");
    if (voir) {

      noteAMontrer = voir.dataset.allerNote;
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
    if (choixEnDeuxTemps(zoneRetrait, retrait.dataset.retirer, "retirer", BOUTON_RETRAIT, CONFIRMATION_RETRAIT)) {
      const id = noteOuverte;
      enregistrerReponseEnAttente();

      mettreDeCote(id);
      peindreNotes();
      fermerNote();
    }
  });

  document.addEventListener("keydown", (evenement) => {
    if (evenement.key !== "Escape") return;
    if (feuilleOuverte(reglages)) fermerReglages();
    if (!loupe.hidden) fermerLoupe();
    if (feuilleOuverte(feuille)) fermerVerset();
    if (!barreNotes.hidden) cacherBarreNotes();
    if (feuilleOuverte(fenetreNote)) fermerNote();
  });

  principal.addEventListener("click", (evenement) => {
    const marque = evenement.target.closest("mark.note-passage");
    if (!marque || evenement.target.closest(".ref, a, button")) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    ouvrirNote(marque.dataset.note);
  });

  principal.addEventListener("keydown", (evenement) => {
    const marque = evenement.target.closest && evenement.target.closest("mark.note-passage[tabindex]");
    if (!marque || (evenement.key !== "Enter" && evenement.key !== " ")) return;
    evenement.preventDefault();
    ouvrirNote(marque.dataset.note);
  });

  const nombreDeNotes = (n) => `${n} note${n > 1 ? "s" : ""}`;

  async function afficherNotes(numero, type) {
    const liste = await chargerIndex();
    const notes = notesValides();
    const lecon = numero && liste.lecons.find((l) => l.numero === numero);
    const etiquette = type && ETIQUETTES.find((e) => e.cle === type);

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
          <a class="ligne-lecon ligne-lecon--detail" href="#/notes/${n}">
            <span class="ligne-lecon__numero"><span class="visuellement-cache">Leçon </span>${deuxChiffres(n)}</span>
            <span class="ligne-lecon__titre">${echapper(l ? l.titre : "")}</span>
            ${CHEVRON}
            <span class="ligne-lecon__detail">
              ${nombreDeNotes(siennes.length)}<span class="notes-points" aria-hidden="true"
                >${types.map((e) => `<span class="pastille pastille--${e.cle}"></span>`).join("")}</span
              ><span class="visuellement-cache"> : ${types.map((e) => e.nom).join(", ")}</span>
            </span>
          </a>
        </li>`;
      })
      .join("");
    const retirees = notesRetirees();

    const aideNotes = () => {
      const barre = ETIQUETTES.map(
        (e) =>
          `<span class="barre-notes__choix${e.cle === "question" ? " notes-aide__appuye" : ""}">` +
          `<span class="pastille pastille--${e.cle}"></span>${e.nom}` +
          `${e.cle === "question" ? '<span class="notes-aide__repere notes-aide__repere--barre">2</span>' : ""}</span>`
      ).join("");
      const question = "<em>« Que faut-il que je fasse pour être sauvé ? »</em>";
      const debut = "Troublé, un geôlier au premier siècle a demandé un jour à deux responsables chrétiens : ";
      return typographie(html`
        <h2 class="titre-section notes-aide__titre">Prendre une note dans une leçon</h2>
        <ol class="notes-aide__etapes">
          <li>Appuyez longuement sur un mot, puis faites glisser les poignées bleues pour choisir un mot, plusieurs mots ou toute une phrase.</li>
          <li>Touchez un type de note : ${ETIQUETTES.map((e) => e.nom).join(", ").replace(/, ([^,]*)$/, " ou $1")}.</li>
        </ol>
        <div class="notes-aide__dessin" aria-hidden="true">
          <p class="notes-aide__phrase">${debut}<span class="notes-aide__choix"><span class="notes-aide__poignee notes-aide__poignee--debut"></span>${question}<span class="notes-aide__poignee notes-aide__poignee--fin"></span></span><span class="notes-aide__repere">1</span> (Actes 16.30) C’est en effet la question la plus importante qui soit.</p>
          <div class="barre-notes notes-aide__barre">${barre}</div>
        </div>
        <p class="notes-aide__suite">Le passage se colore et la note se range ici, par leçon. Pour écrire, touchez le passage coloré.</p>
        <div class="notes-aide__dessin" aria-hidden="true">
          <p class="notes-aide__etiquette">Dans la leçon</p>
          <p class="notes-aide__phrase">${debut}<mark class="note-passage note--question">${question}</mark> (Actes 16.30)</p>
          <p class="notes-aide__etiquette">Dans Notes</p>
          <div class="ligne-lecon ligne-lecon--detail">
            <span class="ligne-lecon__numero">01</span>
            <span class="ligne-lecon__titre">Le plan du salut</span>
            ${CHEVRON}
            <span class="ligne-lecon__detail">1 note<span class="notes-points"><span class="pastille pastille--question"></span></span></span>
          </div>
        </div>`);
    };
    const corps = notes.length
      ? html`<ul class="liste-lignes">${lignes}</ul>`
      : retirees.length
        ? html`<p class="notes-vide">Aucune note pour l’instant.</p>`
        : aideNotes();

    const corbeille = retirees.length
      ? html`<ul class="liste-lignes liste-lignes--a-part">
          <li>
            <a class="ligne-lecon ligne-lecon--detail" href="#/notes/supprimees">
              <span class="ligne-lecon__titre">Récemment supprimées</span>
              ${CHEVRON}
              <span class="ligne-lecon__detail">${nombreDeNotes(retirees.length)}</span>
            </a>
          </li>
        </ul>`
      : "";
    afficherDans(
      html`
        <h1 class="titre-page">Notes</h1>
        ${stockageIndisponible ? avertissementStockage() : ""}
        ${corps}
        ${corbeille}
      `,
      "Notes"
    );
  }

  const BOUTON_VIDER = boutonEnDeuxTemps("vider", "Tout supprimer");
  const confirmationVider = (nombre) =>
    questionEnDeuxTemps(
      "vider",
      nombre === 1
        ? "Supprimer définitivement cette note\u00a0? Elle ne pourra plus être récupérée."
        : `Supprimer définitivement ces ${nombre} notes\u00a0? Elles ne pourront plus être récupérées.`,
      "Oui, supprimer"
    );

  principal.addEventListener("click", (evenement) => {
    const bouton = evenement.target.closest("[data-vider]");
    if (!bouton) return;
    const zone = principal.querySelector("[data-corbeille]");
    if (!zone) return;
    if (!choixEnDeuxTemps(zone, bouton.dataset.vider, "vider", BOUTON_VIDER, confirmationVider(notesRetirees().length))) return;
    const retirees = notesRetirees();
    const gardees = retirees.map((n) => [n.id, etat.notes[n.id]]);
    for (const n of retirees) delete etat.notes[n.id];
    if (!enregistrerEtat()) {
      for (const [id, note] of gardees) etat.notes[id] = note;
      annoncer("Attention : cet appareil refuse d’enregistrer. Les notes restent ici.");
      return;
    }
    annoncer(retirees.length === 1 ? "Note supprimée." : "Notes supprimées.");
    rafraichirNotes();
  });

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

      html`
        <h1 class="titre-sous-page">Récemment supprimées</h1>
        ${lignes ? html`<ul class="liste-notes">${lignes}</ul><div class="corbeille-vider" data-corbeille>${BOUTON_VIDER}</div>` : html`<p class="notes-vide">Plus aucune note ici.</p>`}
      `,
      "Récemment supprimées"
    );
    zoneNavigation.innerHTML = retourNotes("/notes");
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

    const occupe = notesValides().some(
      (n) => n.lecon === Number(note.lecon) && n.bloc === note.bloc && n.debut < note.fin && n.fin > note.debut
    );
    if (occupe) {
      annoncer("Ce passage porte déjà une autre note : retirez-la d’abord.");
      return;
    }
    const date = note.retiree;
    delete note.retiree;
    if (!enregistrerEtat()) {
      note.retiree = date;
      annoncer("Attention : cet appareil refuse d’enregistrer. La note reste ici.");
      return;
    }

    const apres = etat.notes[id];
    if (!apres || !apres.texte) {
      delete etat.notes[id];
      enregistrerEtat();
      annoncer("Cette note n’existe plus.");
    } else annoncer("Note récupérée.");
    rafraichirNotes();
  });

  function afficherDossiersDeLecon(lecon, notes) {
    const siennes = notes.filter((n) => n.lecon === lecon.numero);
    const dossiers = ETIQUETTES.map((e) => ({ e, nombre: siennes.filter((n) => n.etiquette === e.cle).length }))
      .filter((d) => d.nombre)
      .map(
        ({ e, nombre }) => html`<li>
          <a class="ligne-lecon ligne-lecon--detail ligne-lecon--dossier" href="#/notes/${lecon.numero}/${e.cle}">
            <span class="ligne-lecon__numero"><span class="pastille pastille--${e.cle}" aria-hidden="true"></span></span>
            <span class="ligne-lecon__titre">${e.nom}</span>
            ${CHEVRON}
            <span class="ligne-lecon__detail">${nombreDeNotes(nombre)}</span>
          </a>
        </li>`
      )
      .join("");
    afficherDans(
      html`
        <p class="surtitre">Leçon ${lecon.numero}</p>
        <h1 class="titre-sous-page">${echapper(lecon.titre)}</h1>
        ${dossiers ? html`<ul class="liste-lignes">${dossiers}</ul>` : html`<p class="notes-vide">Plus aucune note dans cette leçon.</p>`}
      `,
      `Notes, leçon ${lecon.numero}`
    );
    zoneNavigation.innerHTML = retourNotes("/notes");
  }

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
            <span class="ligne-note__retirer-mot">Retirer<span class="visuellement-cache"> la note «\u00a0${passage}\u00a0»</span></span>
          </button>
        </li>`;
      })
      .join("");
    afficherDans(
      html`
        <p class="surtitre">Leçon ${lecon.numero} · ${echapper(lecon.titre)}</p>
        <h1 class="titre-sous-page">${etiquette.nom}</h1>
        ${lignes ? html`<ul class="liste-notes">${lignes}</ul>` : html`<p class="notes-vide">Plus aucune note ici.</p>`}
      `,
      `${etiquette.nom}, leçon ${lecon.numero}`
    );
    zoneNavigation.innerHTML = retourNotes(`/notes/${lecon.numero}`);
    boutonModifier.hidden = !lignes;
  }

  const LARGEUR_RETIRER = 88;
  const boutonModifier = document.getElementById("modifier-notes");
  let ligneOuverte = null;
  let clicIgnoreJusqua = 0;

  const enModification = () => boutonModifier.getAttribute("aria-pressed") === "true";

  function rendreRetirerAtteignable(cadre, oui) {
    const bouton = cadre.querySelector(".ligne-note__retirer");
    if (!bouton) return;
    bouton.tabIndex = oui ? 0 : -1;
    if (oui) bouton.removeAttribute("aria-hidden");
    else bouton.setAttribute("aria-hidden", "true");
  }

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

      if (ecranAffiche) ecranAffiche.html = null;
      await afficherChemin("/");
    } else peindreNotes();
  }

  const retraitsEnAttente = [];
  const oublierRetraits = () => {
    retraitsEnAttente.length = 0;
  };

  function retirerDepuisListe(cadre) {
    const id = cadre.querySelector("[data-retirer-note]").dataset.retirerNote;
    if (!etat.notes[id]) return;
    mettreDeCote(id);
    if (cadre === ligneOuverte) ligneOuverte = null;

    if (ecranAffiche) ecranAffiche.html = null;

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
    if (moinsDeMouvement.matches) finir();
    else {

      cadre.style.height = `${cadre.getBoundingClientRect().height}px`;
      void cadre.offsetHeight;
      cadre.classList.add("ligne-note-cadre--retiree");
      cadre.style.height = "0px";
      setTimeout(finir, 260);
    }
  }

  function mettreDeCote(id) {
    const avant = etat.notes[id];
    if (!avant) return;
    etat.notes[id] = { ...avant, retiree: Date.now() };
    if (!enregistrerEtat()) {
      annoncer("Attention : cet appareil refuse d’enregistrer. La note reviendra.");
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

        if (etaitEnModification && !boutonModifier.hidden) basculerModification(true);
      },
    });
  }

  principal.addEventListener("click", (evenement) => {
    const bouton = evenement.target.closest("[data-retirer-note]");
    if (bouton) retirerDepuisListe(bouton.closest(".ligne-note-cadre"));
  });

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

  let glisse = null;
  principal.addEventListener("pointerdown", (evenement) => {
    if (evenement.pointerType === "mouse" || enModification()) return;
    if (glisse) finirGlisse(true);
    const ligne = evenement.target.closest(".ligne-note-cadre a.ligne-note");
    if (!ligne) return;
    const cadre = ligne.parentElement;
    glisse = {
      cadre,
      ligne,
      x0: evenement.clientX,
      y0: evenement.clientY,
      depart: cadre === ligneOuverte ? -LARGEUR_RETIRER : 0,
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
        glisse = null;
        return;
      }

      if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy) * 2) return;
      glisse.actif = true;
      revelerRetirer(glisse.cadre);
      glisse.cadre.classList.add("ligne-note-cadre--glisse");
      eteindreAppui();
      if (ligneOuverte && ligneOuverte !== glisse.cadre) fermerLigne();
      try {
        glisse.ligne.setPointerCapture(evenement.pointerId);
      } catch {

      }
    }

    const largeur = glisse.cadre.getBoundingClientRect().width;
    glisse.x = Math.max(-largeur, Math.min(0, glisse.depart + dx));
    glisse.ligne.style.transition = "none";
    glisse.ligne.style.transform = `translateX(${glisse.x}px)`;

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

    if (retirer) retirer.style.width = retirer.style.transition = "";
    const largeur = cadre.getBoundingClientRect().width;
    if (!annule && x < -largeur * 0.6) {

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

  window.addEventListener("scroll", () => fermerLigne(), { passive: true });

  principal.addEventListener("click", (evenement) => {
    const ligne = evenement.target.closest("a.ligne-note[data-ouvrir-note]");
    if (!ligne || evenement.defaultPrevented) return;
    evenement.preventDefault();
    evenement.stopPropagation();
    ouvrirNote(ligne.dataset.ouvrirNote, { depuisListe: true });
  });

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

  const DUREE_ALLUMAGE = 90;
  let ligneDepart = null;

  const prochaineImage = () =>
    new Promise((suite) => {
      requestAnimationFrame(() => suite());
      setTimeout(suite, 50);
    });
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

    }
  }
  const attendre = (ms) => new Promise((suite) => setTimeout(suite, ms));
  const positionsQuittees = new Map();

  const lignesQuittees = new Map();

  const LISTES = new Set(["/", "/eglise"]);
  const estListe = (cle) => LISTES.has(cle) || /^\/notes(\/|$)/.test(cle);
  let ecranCourant = null;
  let rangCourant = 0;
  let navigation = 0;

  function situer(chemin) {
    const lecon = chemin.match(/^\/lecon\/(\d+)/);
    if (lecon) return { cle: `/lecon/${lecon[1]}`, niveau: 1, onglet: "/" };
    if (/^\/documents\/[a-z0-9-]+/.test(chemin))
      return { cle: chemin.replace(/\/$/, ""), niveau: 1, onglet: "/eglise" };
    if (/^\/(eglise|documents)\/?$/.test(chemin)) return { cle: "/eglise", niveau: 0, onglet: "/eglise" };
    if (chemin === "/a-propos") return { cle: "/a-propos", niveau: 1, onglet: "/" };
    if (chemin === "/plus") return { cle: "/plus", niveau: 0, onglet: "/plus" };
    if (/^\/notes\/supprimees\/?$/.test(chemin)) return { cle: "/notes/supprimees", niveau: 1, onglet: "/notes" };
    const notes = chemin.match(/^\/notes(?:\/(\d+)(?:\/([a-z]+))?)?\/?$/);
    if (notes) {
      const [, numero, type] = notes;
      if (type) return { cle: `/notes/${numero}/${type}`, niveau: 2, onglet: "/notes" };
      if (numero) return { cle: `/notes/${numero}`, niveau: 1, onglet: "/notes" };
      return { cle: "/notes", niveau: 0, onglet: "/notes" };
    }
    return { cle: "/", niveau: 0, onglet: "/" };
  }

  let remplacementEnCours = false;

  function corrigerAdresse(chemin) {
    history.replaceState(history.state, "", `#${chemin}`);
    cheminRoute = chemin;
    ecranCourant = situer(chemin);
    pile[rangCourant] = ecranCourant.cle;
    noterPile();
  }

  function remonterVers(cle) {
    for (let rang = rangCourant - 1; rang >= 0; rang--) {
      if (pile[rang] === cle) {
        history.go(rang - rangCourant);
        return true;
      }
    }
    return false;
  }

  let fenetreActive = null;
  let retourEnCours = null;

  function entrerFenetre(fenetre) {
    fenetreActive = fenetre;
    const poser = () => {
      const etape = { rang: rangCourant, fenetre, y: window.scrollY };

      if (history.state && history.state.fenetre) {
        history.replaceState(etape, "");
        return;
      }
      etape.rang = rangCourant + 1;
      history.pushState(etape, "");
      rangCourant = etape.rang;
      pile.length = rangCourant;
      pile[rangCourant] = ecranCourant ? ecranCourant.cle : "/";
      noterPile();
    };

    if (retourEnCours) retourEnCours.then(() => fenetreActive === fenetre && poser());
    else poser();
  }

  function sortirFenetre() {
    fenetreActive = null;
    if (retourEnCours) return retourEnCours;
    if (!(history.state && history.state.fenetre)) return Promise.resolve();
    retourEnCours = new Promise((suite) => {
      const fin = () => {
        window.removeEventListener("popstate", fin);
        clearTimeout(secours);
        retourEnCours = null;
        suite();
      };

      const secours = setTimeout(fin, 1000);
      window.addEventListener("popstate", fin);
    });
    history.back();
    return retourEnCours;
  }

  function fermerFenetreActive({ memeEcran = false } = {}) {
    const fenetre = fenetreActive;
    fenetreActive = null;
    if (!fenetre) return;
    const options = { aussitot: true, parHistorique: true };
    if (fenetre.type === "note") fermerNote({ ...options, rendreFocus: memeEcran });
    else if (fenetre.type === "reglages") fermerReglages(options);
    else if (fenetre.type === "verset") fermerVerset(options);
    else if (fenetre.type === "loupe") fermerLoupe(options);
  }

  function rouvrirFenetre(fenetre, y) {
    if (typeof y === "number" && Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
    const options = { aussitot: true, parHistorique: true };
    if (fenetre.type === "note") {
      const note = etat.notes[fenetre.id];
      if (!note || !note.texte || estRetiree(note)) return false;
      ouvrirNote(fenetre.id, { ...options, depuisListe: Boolean(fenetre.depuisListe) });
    } else if (fenetre.type === "reglages") {
      ouvrirReglages(options);
    } else if (fenetre.type === "verset") {
      refDeclencheur = [...principal.querySelectorAll(".ref")].find((b) => b.dataset.ref === fenetre.ref) || null;
      ouvrirVerset(fenetre.ref, options);
    } else if (fenetre.type === "loupe") {
      const bouton = [...principal.querySelectorAll('.figure__bouton, [data-reglage="agrandir-qr"]')].find(
        (b) => b.querySelector("img") && b.querySelector("img").src === fenetre.src
      );
      if (!bouton) return false;
      declencheur = bouton;
      ouvrirLoupe(bouton.querySelector("img"), options);
    } else {
      return false;
    }
    fenetreActive = fenetre;
    return true;
  }

  function suivreFenetreDeLEtape(sens) {
    const etape = history.state || {};
    const voulue = etape.fenetre || null;
    if (fenetreActive && (!voulue || JSON.stringify(voulue) !== JSON.stringify(fenetreActive))) {
      fermerFenetreActive({ memeEcran: true });
    }
    if (!voulue || fenetreActive) return;
    if (!rouvrirFenetre(voulue, etape.y)) {

      history.replaceState({ ...etape, fenetre: undefined }, "");
      if (sens) history.go(sens);
    }
  }

  document.addEventListener("click", (evenement) => {
    const lien = evenement.target.closest('a[href^="#/"]');
    if (!lien || !ecranCourant || evenement.button || evenement.metaKey || evenement.ctrlKey || evenement.shiftKey) return;
    const chemin = lien.getAttribute("href").replace(/^#/, "") || "/";
    if (lien.closest("#navigation")) {
      evenement.preventDefault();
      allerVersOnglet(chemin);
      return;
    }
    const cible = situer(chemin);
    if (cible.cle === ecranCourant.cle) {

      evenement.preventDefault();
      if (location.hash !== `#${chemin}`) {
        remplacementEnCours = true;
        location.replace(`#${chemin}`);
      }
      return;
    }

    if (
      (cible.niveau < ecranCourant.niveau || "retour" in lien.dataset) &&
      !("allerNote" in lien.dataset) &&
      remonterVers(cible.cle)
    ) {
      evenement.preventDefault();
      return;
    }

    ligneDepart = lien.closest("a.ligne-lecon, a.ligne-note");
    if (ligneDepart && ligneDepart === ligneAppuyee) {
      clearTimeout(extinctionAppui);
      ligneAppuyee = null;
    }
  });

  let changementDOnglet = false;
  function allerVersOnglet(chemin) {
    const cible = situer(chemin);
    if (!ecranCourant) return;
    if (cible.cle === ecranCourant.cle) {
      window.scrollTo({ top: 0, behavior: moinsDeMouvement.matches ? "auto" : "smooth" });
      return;
    }
    changementDOnglet = true;

    montrerNavigation(cible);
    if (remonterVers(cible.cle)) return;
    if (ecranCourant.onglet === "/" || cible.cle === "/") {
      location.hash = `#${chemin}`;
    } else {
      remplacementEnCours = true;
      location.replace(`#${chemin}`);
    }
  }

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

      if (precedent && !remplacementEnCours) rangCourant += 1;
      history.replaceState({ ...(etat || {}), rang: rangCourant }, "");
      if (precedent && precedent.cle !== ecran.cle) sens = ecran.niveau < precedent.niveau ? "arriere" : "avant";

      if (changementDOnglet) sens = null;
      pile.length = rangCourant;
    }
    remplacementEnCours = false;
    changementDOnglet = false;
    pile[rangCourant] = ecran.cle;
    noterPile();
    const autreEcran = Boolean(precedent) && precedent.cle !== ecran.cle;
    return { ecran, sens, retour: autreEcran && (revisitee || sens === "arriere") };
  }

  principal.addEventListener("click", (evenement) => {
    const ligne = evenement.target.closest("a.ligne-lecon, a.ligne-note");
    if (!ligne || evenement.button || evenement.metaKey || evenement.ctrlKey || evenement.shiftKey) return;
    if (!ecranCourant) return;

    positionsQuittees.set(ecranCourant.cle, pageFigee !== null ? pageFigee : window.scrollY);

    lignesQuittees.set(ecranCourant.cle, ligne.dataset.ouvrirNote || ligne.dataset.allerNote || ligne.getAttribute("href"));
  });

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
    const ligne = evenement.target.closest("a.ligne-lecon, a.ligne-note");
    if (!ligne || evenement.button) return;
    attenteAppui = setTimeout(() => {
      ligneAppuyee = ligne;
      ligne.classList.add("ligne--touchee");
    }, DELAI_APPUI);
  });
  window.addEventListener("pointerup", () => {
    clearTimeout(attenteAppui);

    clearTimeout(extinctionAppui);
    extinctionAppui = setTimeout(eteindreAppui, 300);
  });
  window.addEventListener("pointercancel", eteindreAppui);
  window.addEventListener("scroll", eteindreAppui, { passive: true });

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

    const marges = getComputedStyle(principal);
    calque.style.padding = `${marges.paddingTop} ${marges.paddingRight} 0 ${marges.paddingLeft}`;
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
      if (chemin === "/plus") return await afficherPlus();
      if (/^\/(eglise|documents)\/?$/.test(chemin)) {

        if (chemin !== "/eglise") corrigerAdresse("/eglise");
        return await afficherEglise();
      }
      const texte = chemin.match(/^\/documents\/([a-z0-9-]+)\/?$/);
      if (texte) return await afficherDocument(texte[1]);

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

    if (evenement && evenement.type === "popstate" && chemin === cheminRoute) {
      const etape = history.state || {};
      const avant = rangCourant;
      if (typeof etape.rang === "number") rangCourant = etape.rang;
      suivreFenetreDeLEtape(Math.sign(rangCourant - avant));
      return;
    }

    if (evenement && chemin === cheminRoute) return;
    cheminRoute = chemin;

    enregistrerReponseEnAttente();

    fermerFenetreActive();
    cacherBarreNotes();
    if (!annonceGardee) cacherAnnonce();
    const jeton = ++navigation;
    const rangAvant = rangCourant;
    const { ecran, sens, retour } = changementDEcran(chemin);
    const anime = sens === "avant" && !moinsDeMouvement.matches;

    principal.classList.remove(...CLASSES_ECRAN);
    principal.style.clipPath = "";
    retirerCalque();
    const ligne = ligneDepart;
    ligneDepart = null;
    if (sens === "avant" && ligne && principal.contains(ligne)) {
      if (!ligne.classList.contains("ligne--touchee")) {

        await prochaineImage();
        if (jeton !== navigation) return;
        ligne.classList.add("ligne--touchee");
      }
      await attendre(DUREE_ALLUMAGE);
      if (jeton !== navigation) return;
    }
    if (anime) {

      poserCalque();
      principal.classList.add("ecran--attente");
    }

    retourVersListe = retour && estListe(ecran.cle) && positionsQuittees.has(ecran.cle);
    await afficherChemin(chemin);
    retourVersListe = false;
    if (jeton !== navigation) return;

    principal.classList.remove(...CLASSES_ECRAN);
    if (retour && estListe(ecran.cle) && positionsQuittees.has(ecran.cle)) {
      const y = positionsQuittees.get(ecran.cle);
      if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);

      requestAnimationFrame(() => {
        if (jeton === navigation && pageFigee === null && Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
      });
    }

    suivreFenetreDeLEtape(evenement ? Math.sign(rangCourant - rangAvant) : 0);
    const rouverte = fenetreActive !== null;
    if (retour && lignesQuittees.has(ecran.cle)) {
      const adresse = lignesQuittees.get(ecran.cle);
      lignesQuittees.delete(ecran.cle);
      const ligne = [...principal.querySelectorAll("a.ligne-lecon, a.ligne-note")].find(
        (a) => (a.dataset.ouvrirNote || a.dataset.allerNote || a.getAttribute("href")) === adresse
      );

      if (ligne && !rouverte) {
        ligne.classList.add("ligne--revient");

        const retirer = () => ligne.classList.remove("ligne--revient");
        ligne.addEventListener("animationend", retirer, { once: true });
        setTimeout(retirer, 1000);
      }
    }
    if (anime) {

      const depasse = -principal.getBoundingClientRect().top;
      principal.style.clipPath = depasse > 0 ? `inset(${Math.ceil(depasse)}px 0 0 0)` : "";
      principal.classList.add("ecran--entre");
      if (calque) calque.classList.add("calque-quitte--part");
      await attendre(dureeDuStyle("--ecran-entree") + 40);
      if (jeton === navigation) {
        principal.classList.remove(...CLASSES_ECRAN);
        principal.style.clipPath = "";
        retirerCalque();
      }
    }
  }

  if ("scrollRestoration" in history) history.scrollRestoration = "auto";

  function marquerOnglet(nom) {
    for (const bouton of zoneOnglets.querySelectorAll('[role="tab"]')) {
      const choisi = bouton.id === `onglet-${nom}`;
      bouton.setAttribute("aria-selected", String(choisi));
      bouton.tabIndex = choisi ? 0 : -1;
    }
  }

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

  const SEUIL_FERMETURE = 0.25;
  const VITESSE_FERMETURE = 0.4;
  const DEPART_GESTE = 8;
  const grandEcran = window.matchMedia("(min-width: 600px)");

  function glisserPourFermer(fenetre, fermer) {
    const carte = fenetre.querySelector(".feuille__carte");
    let geste = null;
    const vider = (duree) => {

      carte.style.transition = fenetre.style.transition = "";
      carte.style.transitionDuration = fenetre.style.transitionDuration = `${duree}ms`;
      carte.style.transform = fenetre.style.backgroundColor = "";
      setTimeout(() => {
        carte.style.transitionDuration = fenetre.style.transitionDuration = "";
      }, duree + 50);
    };

    carte.addEventListener(
      "touchstart",
      (evenement) => {
        geste = null;
        if (grandEcran.matches || evenement.touches.length !== 1 || !feuilleOuverte(fenetre)) return;
        if (evenement.target.closest("textarea, input, select")) return;
        const corps = carte.querySelector(".feuille__corps");
        const toucher = evenement.touches[0];
        geste = {
          x: toucher.clientX,
          y: toucher.clientY,
          parLeHaut: !corps || !corps.contains(evenement.target),
          corps,
          etat: "attente",
          traces: [],
        };
      },
      { passive: true }
    );

    carte.addEventListener(
      "touchmove",
      (evenement) => {
        if (!geste || geste.etat === "abandon") return;
        const toucher = evenement.touches[0];
        if (geste.etat === "attente") {
          const dx = toucher.clientX - geste.x;
          const dy = toucher.clientY - geste.y;
          if (Math.abs(dx) < DEPART_GESTE && Math.abs(dy) < DEPART_GESTE) return;
          const versLeBas = dy > 0 && dy > Math.abs(dx);
          const enHaut = geste.parLeHaut || geste.corps.scrollTop <= 0;
          if (!versLeBas || !enHaut) {
            geste.etat = "abandon";
            return;
          }
          geste.etat = "glisse";
          geste.y = toucher.clientY;
          geste.hauteur = carte.offsetHeight;

          const voile = getComputedStyle(fenetre).backgroundColor.match(/[\d.]+/g) || [];
          geste.voile = voile.length >= 4 ? voile.slice(0, 3).join(", ") : null;
          geste.opacite = voile.length >= 4 ? Number(voile[3]) : 0;
          carte.style.transition = fenetre.style.transition = "none";
        }
        evenement.preventDefault();
        const decalage = Math.max(0, toucher.clientY - geste.y);
        geste.decalage = decalage;
        carte.style.transform = `translate3d(0, ${decalage}px, 0)`;
        if (geste.voile) {
          const part = 1 - Math.min(1, decalage / geste.hauteur);
          fenetre.style.backgroundColor = `rgba(${geste.voile}, ${(geste.opacite * part).toFixed(3)})`;
        }
        geste.traces.push({ y: toucher.clientY, t: evenement.timeStamp });
        if (geste.traces.length > 8) geste.traces.shift();
      },
      { passive: false }
    );

    const finir = (annule) => {
      const fin = geste;
      geste = null;
      if (!fin || fin.etat !== "glisse") return;

      const derniere = fin.traces[fin.traces.length - 1];
      const recentes = derniere ? fin.traces.filter((p) => derniere.t - p.t <= 100) : [];
      const premiere = recentes[0];
      const vitesse = premiere && derniere.t > premiere.t ? (derniere.y - premiere.y) / (derniere.t - premiere.t) : 0;
      const fermerLa =
        !annule && fin.decalage > 0 && (fin.decalage > fin.hauteur * SEUIL_FERMETURE || vitesse > VITESSE_FERMETURE);
      if (fermerLa) {

        const reste = fin.hauteur - fin.decalage;
        vider(Math.round(Math.min(400, Math.max(180, reste / Math.max(vitesse, 0.8)))));
        fermer();
      } else {
        vider(320);
      }
    };
    carte.addEventListener("touchend", () => finir(false));
    carte.addEventListener("touchcancel", () => finir(true));
  }

  glisserPourFermer(fenetreNote, () => fermerNote());
  glisserPourFermer(reglages, () => fermerReglages());
  glisserPourFermer(feuille, () => fermerVerset());

  window.addEventListener("popstate", router);
  window.addEventListener("hashchange", router);
  router();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") enregistrerReponseEnAttente();
  });
  window.addEventListener("pagehide", enregistrerReponseEnAttente);

  const surLeMac = ["localhost", "127.0.0.1"].includes(location.hostname);
  if ("serviceWorker" in navigator && surLeMac) {
    navigator.serviceWorker.getRegistrations().then((inscrits) => inscrits.forEach((s) => s.unregister()));
    if ("caches" in window) caches.keys().then((noms) => noms.forEach((nom) => caches.delete(nom)));

    const SUIVIS = ["index.html", "style.css", "app.js", "contenu/eglise.json"];
    let empreinte = null;
    setInterval(async () => {
      if (document.hidden) return;
      try {
        const dates = await Promise.all(
          SUIVIS.map((f) => fetch(f, { method: "HEAD", cache: "no-store" }).then((r) => r.headers.get("last-modified")))
        );
        const nouvelle = dates.join("|");
        if (empreinte && nouvelle !== empreinte) location.reload();
        empreinte = nouvelle;
      } catch {

      }
    }, 1000);
  } else if ("serviceWorker" in navigator && !contenuEmbarque) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch((erreur) => {
        console.warn("Mode hors connexion indisponible :", erreur);
      });
    });
  }
})();
