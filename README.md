# 🃏 Triplette — trois cartes identiques, et le trio est à toi

Un jeu de cartes de mémoire et de déduction pour **3 à 6 joueurs**, **chacun sur son propre téléphone**, autour d'une table ou à distance.
36 cartes, les numéros de 1 à 12 en trois exemplaires : à ton tour, tu retournes des cartes une par une — au centre, ou la plus petite / la plus grande de la main de n'importe qui — en espérant en réunir trois identiques.

👉 **Jouer : https://mathieuadr.github.io/trio-game/**

- 📱 **PWA** installable sur l'écran d'accueil (iOS : Partager → « Sur l'écran d'accueil » ; Android : « Installer l'application »)
- 🔗 **Invitation en un geste** : code à 5 caractères ou lien partagé (`…/trio-game/?room=ABCDE`)
- 🔒 **Mains chiffrées de bout en bout** : tes cartes ne sont lisibles que sur ton téléphone
- ☁️ **Sans serveur ni compte** : hébergé sur GitHub Pages, les téléphones communiquent par un relais MQTT public
- 🔄 **Reprise** : un joueur ou l'hôte qui recharge l'appli retrouve la partie là où elle en était
- 🔇 Sons et animations désactivables

Le nom, l'habillage et toutes les illustrations (SVG) de Triplette ont été créés pour ce projet.

## Règles en bref

- Un joueur crée la partie (l'**hôte**), les autres la rejoignent. L'hôte range les joueurs dans l'ordre du tour, choisit le mode et qui commence.
- Les 36 cartes sont mélangées et distribuées ; le reste va au centre, face cachée. Chaque main est **triée du plus petit au plus grand** et n'apparaît que sur le téléphone de son propriétaire.

  | Joueurs | Cartes par joueur | Cartes au centre |
  |---|---|---|
  | 3 | 9 | 9 |
  | 4 | 7 | 8 |
  | 5 | 6 | 6 |
  | 6 | 5 | 6 |

- **À ton tour**, tu révèles des cartes une par une : une **carte du centre**, ou la **plus petite** ou la **plus grande** carte de la main d'un joueur (la tienne comprise). Jamais une carte du milieu.
  - **Même numéro** que la précédente : tu continues.
  - **Numéro différent** : ton tour s'arrête, toutes les cartes retournent à leur place, au joueur suivant.
  - **Trois cartes identiques** : tu gagnes le **trio**, qui quitte le jeu. Ton tour s'arrête là.
- Un joueur sans carte continue de jouer. On peut gagner un trio sans en posséder une seule carte.

### Deux modes

| Mode | Pour gagner |
|---|---|
| **Normal** | 3 trios, n'importe lesquels — ou le trio de 7 |
| **Picante** | 2 trios **liés** — ou le trio de 7 |

Deux trios sont liés quand leur somme ou leur différence vaut 7 : `1–6`, `1–8`, `2–5`, `2–9`, `3–4`, `3–10`, `4–11`, `5–12`.
En mode Picante, des pastilles en bas de chaque carte rappellent ses numéros liés. Le **trio de 7** fait gagner immédiatement dans les deux modes.

La table des liaisons est un simple objet, `LINKS`, dans [`public/engine/rules.js`](public/engine/rules.js) : c'est le seul endroit à modifier pour la changer (un test vérifie qu'elle reste symétrique).

## Comment c'est fait

```
public/engine/   moteur de règles pur (rules.js, game.js) — testable sans interface
public/state/    cloisonnement des informations (privacy.js) et préférences de l'appareil (store.js)
public/net/      partie à plusieurs : relais MQTT, salon, chiffrement de bout en bout (room.js, crypto.js)
public/ui/       illustrations SVG, sons synthétisés, composants et écrans (HTML/CSS/JS sans framework)
public/vendor/   client MQTT.js (licence MIT)
test/            tests du moteur et du réseau, simulation de parties, parties complètes en téléphones émulés
```

Il n'y a pas de serveur à lancer : le téléphone de l'**hôte** exécute le moteur de règles et garde l'état complet (les 36 cartes), sans jamais l'afficher. C'est lui qui mélange, distribue, trouve la carte demandée, vérifie que c'est bien le tour du joueur, détecte les trios et la victoire. Sur le relais circulent :

| Sujet | Contenu | Visibilité |
|---|---|---|
| `…/state` | la table : noms, **nombre** de cartes de chaque main, cartes révélées, trios, joueur actif | en clair, sans aucune valeur cachée |
| `…/p/<joueur>` | la main de ce joueur | chiffré pour ce seul joueur (ECDH P-256 + AES-GCM) |
| `…/c/<joueur>` | ses actions : « tel emplacement du centre », « la plus petite carte de tel joueur » | chiffré pour l'hôte |

- Un joueur n'envoie **jamais** la valeur d'une carte, seulement un emplacement ou une extrémité de main.
- Les autres joueurs, comme toute personne qui écouterait le relais, ne voient que l'état public et des messages chiffrés **de taille constante** (la longueur d'un message ne trahit pas les cartes qu'il contient).
- Chaque action porte un numéro d'étape : un double appui ou un message en retard est ignoré, une seule action est acceptée par étape.
- L'hôte détient forcément toutes les cartes (c'est lui l'arbitre) ; son appli ne les affiche jamais.

**Connexions.** Si l'hôte ferme l'appli, la partie se met en pause et reprend à son retour : son téléphone a tout sauvegardé. Un joueur qui perd la connexion retrouve sa main en rouvrant l'appli ; pendant son absence les autres continuent, sa main reste en jeu. Si c'est le **joueur actif** qui disparaît, son tour est mis en pause ; au bout d'une minute l'hôte choisit d'attendre encore ou d'interrompre la partie — le tour ne passe jamais tout seul.

Pour utiliser un autre relais MQTT en WebSocket : ajoute `?broker=wss://…` à l'adresse (tous les joueurs doivent utiliser le même).

## Déploiement

Chaque push sur `main` lance `.github/workflows/pages.yml` : tests du moteur et du réseau, simulation, puis publication de `public/` sur GitHub Pages.
Si le premier déploiement échoue sur « configure-pages » : **Settings → Pages → Source : GitHub Actions**, puis relance le workflow.

## Développement

```bash
npm install
npm run dev          # appli + relais local : ouvre l'adresse affichée dans plusieurs onglets (un par joueur)
npm test             # moteur, réseau (relais local + « espion ») et 2 400 parties simulées
npm run e2e          # parties complètes avec un navigateur par joueur (Playwright requis)
```

Sur un téléphone, le chiffrement des mains exige une adresse `https` : on y joue depuis l'adresse publiée, pas depuis le serveur de développement.

Les tests couvrent la distribution à 3, 4, 5 et 6 joueurs, les révélations (centre, plus petite, plus grande, doublons aux extrémités, main vide), la restitution des cartes après un tour raté, les conditions de victoire des deux modes, la confidentialité (vue publique, trafic du relais, taille des messages chiffrés), le jeu hors tour, les actions simultanées, les rechargements et les déconnexions.
