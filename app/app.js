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
  function enrichir(texte) {
    const base = echapper(texte)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/\n/g, "<br>");
    return lierReferences(lierAdresses(base));
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

  // Neutralise l'arrière-plan quand une fenêtre est ouverte : le clavier n'en sort plus et les
  // lecteurs d'écran n'annoncent plus ce qui est derrière. « inert » fait les deux d'un coup.
  function neutraliserArrierePlan(actif) {
    for (const zone of [document.getElementById("barre"), document.getElementById("principal")]) {
      if (!zone) continue;
      zone.inert = actif;
      if (actif) zone.setAttribute("aria-hidden", "true");
      else zone.removeAttribute("aria-hidden");
    }
    document.body.style.overflow = actif ? "hidden" : "";
  }
  const barre = document.getElementById("barre");
  const zoneOnglets = document.getElementById("zone-onglets");
  const titreBarre = document.getElementById("titre-barre");
  const zoneNavigation = document.getElementById("zone-navigation");

  const LOGO = `<a class="marque__lien" href="#/" aria-label="Accueil, toutes les leçons">
    <img class="marque__logo" src="__SRC__" alt="EBTM" width="500" height="273" /></a>`;
  const RETOUR = `<a class="bouton-retour" href="#/" aria-label="Retour à toutes les leçons">←</a>`;

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

  let installationDifferee = null;

  function dejaInstallee() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function surIPhone() {
    const ua = navigator.userAgent;
    // iPadOS se présente comme un Mac : on le reconnaît à son écran tactile.
    return /iPhone|iPod|iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
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
        ? html`<ol class="invite__etapes orientation__etapes">
            <li>Touchez <span class="invite__icone">${PARTAGE_IOS}</span> en bas de l’écran. Si vous ne la voyez pas, touchez <strong>•••</strong> puis « Partager ».</li>
            <li>Faites défiler, puis touchez « Sur l’écran d’accueil ».</li>
            <li>Touchez « Ajouter ».</li>
          </ol>`
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
        <ol class="invite__etapes">
          <li>Touchez <span class="invite__icone">${PARTAGE_IOS}</span> en bas de l’écran. Si vous ne la voyez pas, touchez <strong>•••</strong> puis « Partager ».</li>
          <li>Faites défiler, puis touchez « Sur l’écran d’accueil ».</li>
          <li>Touchez « Ajouter ».</li>
        </ol>
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
      history.replaceState(null, "", location.pathname + "?installer" + location.hash);
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

  function ajusterHauteurBarre() {
    hauteurBarre = barre.offsetHeight;
    document.body.style.paddingTop = `${hauteurBarre}px`;
  }
  window.addEventListener("resize", ajusterHauteurBarre);

  // Le logo porte le nom de l'église, le titre celui du cours : les deux vont de pair.
  const NOM_APPLICATION = "Cours découvertes";

  function afficherDans(contenuHtml, titreDocument) {
    zoneOnglets.innerHTML = "";
    zoneNavigation.innerHTML = LOGO.replace("__SRC__", sourceLogo());
    titreBarre.textContent = NOM_APPLICATION;
    reposerBarre();
    principal.innerHTML = contenuHtml;
    document.title = titreDocument ? `${titreDocument} — Cours découvertes` : "Cours découvertes";
    window.scrollTo(0, 0);
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
  // La barre s'efface pendant la lecture
  // ---------------------------------------------------------------------------

  // La barre suit le doigt, elle ne bascule pas d'un état à l'autre. C'est ce que spécifie
  // Material Design pour une barre supérieure (« enterAlways ») : elle se rétracte dès que la
  // page descend, revient dès qu'elle remonte, proportionnellement au geste. Un seuil suivi
  // d'une animation, ce qu'on faisait avant, met un décalage entre le doigt et l'écran.
  //
  // Durées et courbes reprises des jetons Material 3 : 100 ms pour ce qui sort, 250 ms pour ce
  // qui entre, avec les courbes « emphasized ». Elles ne servent qu'à l'alignement final, une
  // fois le défilement arrêté : pendant le geste, aucune transition.
  const ALIGNEMENT_MS = 120; // au-delà, on considère que le doigt s'est arrêté
  const SEUIL_FLOTTANT = 4; // au premier pixel de lecture, la barre passe en translucide

  let derniereY = 0;
  let minuterieAlignement = null;
  // On efface la barre sur un écran de lecture, jamais sur un écran de navigation : dans une
  // leçon la place rendue au texte se ressent, sur l'accueil on perdrait le logo et l'accès aux
  // réglages sans rien gagner. Le fond translucide, lui, s'applique partout.
  let barreEffacable = false;

  // Sur iOS, le défilement est piloté par un processus séparé du script. Déplacer la barre à
  // chaque événement de défilement la laisse toujours en retard d'une image sur le contenu :
  // c'est la saccade que voyait Sébastien. On bascule donc entre deux états, et c'est une
  // transition CSS — confiée au compositeur, donc indépendante du script — qui fait le
  // mouvement. Le geste perd en fidélité ce qu'il gagne en fluidité, et sur un téléphone la
  // fluidité prime.
  const COURSE_MASQUER = 16; // descente franche avant d'effacer
  const COURSE_MONTRER = 10; // il en faut moins pour rappeler la barre

  let course = 0; // distance parcourue depuis le dernier changement de sens

  function montrerBarre() {
    barre.classList.remove("barre--masquee");
  }

  function reposerBarre() {
    montrerBarre();
    barre.classList.remove("barre--flottante");
    derniereY = 0;
    course = 0;
    barreEffacable = false;
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
    derniereY = Math.max(0, window.scrollY);
  }

  function surDefilement() {
    const y = Math.max(0, window.scrollY);
    barre.classList.toggle("barre--flottante", y > SEUIL_FLOTTANT);

    // Posé avant toute sortie : même quand la barre n'a plus à bouger, la lecture avance.
    clearTimeout(minuterieAlignement);
    minuterieAlignement = setTimeout(auRepos, ALIGNEMENT_MS);

    if (!barreEffacable) return;

    const delta = y - derniereY;
    derniereY = y;
    if (delta === 0) return;

    if (y <= 0) {
      course = 0;
      montrerBarre();
      return;
    }

    // Changer de sens remet le compteur à zéro : la barre répond aussitôt au geste inverse.
    if (delta > 0 !== course > 0) course = 0;
    course += delta;

    if (course > COURSE_MASQUER) {
      barre.classList.add("barre--masquee");
      course = 0;
    } else if (course < -COURSE_MONTRER) {
      montrerBarre();
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

  const zoneEffacement = reglages.querySelector("#zone-effacement");

  const BOUTON_EFFACER =
    '<button type="button" class="lien-danger" data-effacer="demander">' +
    "Effacer toutes mes réponses</button>";

  // En deux temps : un toucher malheureux ne doit pas pouvoir tout perdre.
  const CONFIRMATION_EFFACER =
    '<p class="reglage__avertissement">Êtes-vous sûr ? Toutes vos réponses, les versets cochés ' +
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
    reglages.hidden = false;
    neutraliserArrierePlan(true);
    reglages.querySelector(".feuille__fermer").focus();
  }

  function fermerReglages() {
    reglages.hidden = true;
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
    if (evenement.key === "Escape" && !reglages.hidden) fermerReglages();
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
    const total = liste.lecons.length;
    const terminees = liste.lecons.filter((l) => etat.terminees[l.numero]).length;
    const pourcentage = total ? Math.round((terminees / total) * 100) : 0;

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
                ><span class="carte-lecon__mot">Leçon</span
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
        <section class="progression" aria-label="Avancement">
          <p class="progression__titre">Ma progression</p>
          <p class="progression__detail">${terminees} / ${total} leçon${total > 1 ? "s" : ""}</p>
        </section>
        <ul class="liste-lecons">${cartes}</ul>
        <p class="pied">
          <a href="#/a-propos">À propos du cours</a>
        </p>
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

    afficherDans(
      html`
        ${enTete}

        <section id="panneau-lecture" class="panneau" role="tabpanel" aria-labelledby="onglet-lecture" ${onglet !== "lecture" ? "hidden" : ""}>
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
      `Leçon ${lecon.numero} · ${lecon.titre}`
    );

    barreEffacable = true;

    // Dans une leçon, la flèche de retour prend la place du logo, comme dans toute application.
    zoneNavigation.innerHTML = RETOUR;
    titreBarre.textContent = lecon.titre;

    // Un seul onglet disponible : autant ne pas afficher de barre d'onglets.
    zoneOnglets.innerHTML =
      disponibles.length > 1
        ? html`<div class="onglets" role="tablist" aria-label="Parties de la leçon"
              style="grid-template-columns: repeat(${disponibles.length}, 1fr)">
            ${boutonOnglet(numero, "lecture", "Lecture", "", onglet)}
            ${disponibles.includes("versets") ? boutonOnglet(numero, "versets", "Versets", `${lecon.versets_a_apprendre.length} à apprendre`, onglet) : ""}
            ${disponibles.includes("questions") ? boutonOnglet(numero, "questions", "Questions", `${nbReponses(lecon)} / ${lecon.questions.length}`, onglet) : ""}
          </div>`
        : "";
    ajusterHauteurBarre();

    brancherVersets(principal);
    brancherQuestions(principal, lecon, suivante);

    // Après les onglets et le calcul de la hauteur de barre : la position à restaurer se mesure
    // sous la barre complète, sinon elle est décalée de la hauteur des onglets.
    reprendreLecture(`${numero}/${onglet}`);
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
      onclick="location.hash = '#/lecon/${numero}/${id}'"
    >
      <span>${libelle}</span>
      ${compte ? html`<span class="onglet__compte">${compte}</span>` : ""}
    </button>`;
  }

  // --- Lecture ---------------------------------------------------------------

  function rendreLecture(lecon, numero, avecFinDeLecon, suivante) {
    // Un élément d'introduction est soit un paragraphe (chaîne), soit un bloc en marge.
    const intro = (lecon.introduction || [])
      .map((element) => (typeof element === "string" ? html`<p>${enrichir(element)}</p>` : rendreBloc(element)))
      .join("");
    const sections = (lecon.sections || [])
      .map((section) => html`<h2>${enrichir(section.titre)}</h2>${section.blocs.map(rendreBloc).join("")}`)
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

  function rendreBloc(bloc) {
    switch (bloc.type) {
      case "sous-titre":
        return html`<h3>${enrichir(bloc.texte)}</h3>`;
      case "paragraphe":
        return html`<p>${enrichir(bloc.texte)}</p>`;
      case "citation":
        return html`<aside class="encart encart--citation">
          <p>${enrichir(bloc.texte)}</p>
          ${bloc.auteur ? html`<span class="encart__source">${echapper(bloc.auteur)}</span>` : ""}
        </aside>`;
      case "verset":
        return html`<aside class="encart encart--verset">
          <p>${enrichir(bloc.texte)}</p>
          <span class="encart__source">${echapper(bloc.reference)}</span>
        </aside>`;
      case "encadre":
        return html`<aside class="encart encart--encadre">
          ${bloc.titre ? html`<p class="encart__titre">${enrichir(bloc.titre)}</p>` : ""}
          <p>${enrichir(bloc.texte)}</p>
        </aside>`;
      case "liste":
        return html`<ul>${bloc.elements.map((e) => html`<li>${enrichir(e)}</li>`).join("")}</ul>`;
      case "note":
        return html`<p class="note">${enrichir(bloc.texte)}</p>`;
      case "tableau":
        return html`<div class="tableau">
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
  // Page « À propos »
  // ---------------------------------------------------------------------------

  async function afficherAPropos() {
    const apropos = await chargerJson("contenu/a-propos.json");
    // Le lien partagé porte « ?installer », comme le QR code : qui le reçoit arrive sur
    // l'écran d'installation. L'adresse affichée reste sans ce marqueur, plus lisible.
    const adresse = location.origin + location.pathname;
    const lien = adresse + "?installer";
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
          Vos réponses, les versets cochés et les leçons terminées sont sauvegardés localement sur
          votre appareil. Ni l’église ni l’enseignant n’y ont accès. Si vous effacez les données de
          votre navigateur ou changez de téléphone, ils seront perdus.
        </p>
        <p>
          Installer le cours sur votre écran d’accueil les met à l’abri : sans installation, le
          navigateur peut faire le ménage de lui-même au bout de quelques jours sans visite.
        </p>
        <h2>Partager ce cours</h2>
        <img class="partage__qr" src="${sourceQrCode()}" alt="Code à scanner menant à ${echapper(adresse)}" width="240" height="240" />
        <p class="partage__adresse">${echapper(adresse)}</p>
        <button type="button" class="bouton-principal" data-partage="${echapper(lien)}">
          ${navigator.share ? "Partager le lien" : "Copier le lien"}
        </button>
        <p class="partage__etat" aria-live="polite"></p>
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
    const passages = (versets && versets.versets[cle]) || [];
    feuille.querySelector(".feuille__titre").textContent = cle;
    // Le numéro n'est utile que si le passage en compte plusieurs. Il éviterait surtout de
    // dérouter là où la numérotation de la Segond diffère de celle du livret (Psaume 22).
    const numeroter = passages.length > 1;
    feuille.querySelector(".feuille__corps").innerHTML = passages.length
      ? passages
          .map(
            (p) => html`<p class="passage">${
              numeroter ? html`<span class="passage__numero">${p.v}</span>` : ""
            }${echapper(p.t)}</p>`
          )
          .join("")
      : html`<p class="texte-doux">Le texte de ce passage n’est pas disponible dans l’application.</p>`;
    feuille.querySelector(".feuille__source").textContent = versets.traduction || "";
    feuille.hidden = false;
    neutraliserArrierePlan(true);
    feuille.querySelector(".feuille__fermer").focus();
  }

  function fermerVerset() {
    feuille.hidden = true;
    neutraliserArrierePlan(false);
    if (refDeclencheur) refDeclencheur.focus();
  }

  feuille.addEventListener("click", (evenement) => {
    if (evenement.target === feuille || evenement.target.closest(".feuille__fermer")) fermerVerset();
  });
  document.addEventListener("keydown", (evenement) => {
    if (evenement.key === "Escape" && !feuille.hidden) fermerVerset();
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
  // Navigation (adresse après le #)
  // ---------------------------------------------------------------------------

  async function router() {
    // Avant de reconstruire l'écran, dont les champs seront remplis depuis l'enregistrement.
    enregistrerReponseEnAttente();
    const chemin = location.hash.replace(/^#/, "") || "/";
    try {
      await chargerVersets();
      const lecon = chemin.match(/^\/lecon\/(\d+)(?:\/(lecture|versets|questions))?\/?$/);
      if (lecon) return await afficherLecon(Number(lecon[1]), lecon[2]);
      if (chemin === "/a-propos") return await afficherAPropos();
      return await afficherAccueil();
    } catch (erreur) {
      console.error(erreur);
      afficherErreur(erreur.message);
    }
  }

  // L'application replace elle-même la lecture en haut de page à chaque écran :
  // laisser le navigateur restaurer une ancienne position donnerait un départ au milieu du texte.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

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
