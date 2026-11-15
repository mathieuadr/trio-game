// Textes du jeu : libellés des modes et règles. Tout l'habillage se change ici.

export const MODE_LABEL = { normal: 'Normal', spicy: 'Picante' };
export const MODE_GOAL = { normal: '3 trios, ou le trio de 7', spicy: '2 trios liés, ou le trio de 7' };
export const MODE_HELP = {
  normal: 'Le premier qui gagne **3 trios**, n’importe lesquels, remporte la partie. Le **trio de 7** fait gagner tout de suite.',
  spicy: 'Il faut **2 trios liés** : les numéros liés sont rappelés en bas de chaque carte. Deux trios quelconques ne suffisent pas. Le **trio de 7** fait toujours gagner tout de suite.',
};
export const REASON_LABEL = { seven: 'Trio de 7', three: '3 trios', linked: '2 trios liés' };

export const RULES = [
  {
    title: 'Le but',
    body: [
      'Triplette se joue avec **36 cartes** : les numéros de **1 à 12**, chacun en **trois exemplaires**. Réunir les trois cartes d’un même numéro, c’est gagner un **trio**.',
      'Tout est affaire de mémoire et de déduction : retiens ce qui a été retourné, et où.',
    ],
  },
  {
    title: 'Mise en place',
    body: [
      'Un joueur **crée la partie** et devient l’hôte ; les autres la **rejoignent** avec le code à 5 caractères ou le lien d’invitation. L’hôte range les joueurs dans l’ordre du tour, choisit le mode, puis lance la partie.',
      'Les cartes sont mélangées et distribuées : **9 chacun** à 3 joueurs (9 au centre), **7 chacun** à 4 (8 au centre), **6 chacun** à 5 (6 au centre), **5 chacun** à 6 (6 au centre).',
      'Ta main est **triée du plus petit au plus grand** et n’apparaît que sur ton téléphone. Les cartes du centre sont face cachée.',
    ],
  },
  {
    title: 'À ton tour',
    body: [
      'Tu révèles des cartes **une par une**. Pour chaque carte, tu choisis :',
      '• une **carte du centre**, n’importe laquelle ;',
      '• ou la **plus petite** ou la **plus grande** carte de la main d’un joueur — la tienne comprise. Jamais une carte du milieu.',
      'Chaque carte révélée est visible de tous jusqu’à la fin du tour.',
    ],
  },
  {
    title: 'Pareil… ou pas',
    body: [
      '**Même numéro** que la carte précédente : tu continues.',
      '**Numéro différent** : ton tour s’arrête aussitôt. Toutes les cartes révélées retournent à leur place — face cachée au centre, ou dans la main de leur propriétaire — et c’est au joueur suivant.',
      '**Trois cartes identiques** : tu gagnes le trio ! Il quitte le jeu et rejoint ta collection. Ton tour s’arrête là : gagner un trio ne fait pas rejouer.',
    ],
  },
  {
    title: 'Bon à savoir',
    body: [
      'Tu peux demander plusieurs fois la même extrémité d’une même main : si un joueur a deux 2, sa plus petite carte est un 2… puis encore un 2.',
      'Tu peux enchaîner ta main, celle d’un adversaire et le centre dans le même tour.',
      'Un joueur qui n’a plus de carte en main continue de jouer normalement.',
      'On peut gagner un trio sans en posséder une seule carte, et dans n’importe quel ordre.',
    ],
  },
  {
    title: 'Gagner la partie',
    body: [
      '**Mode Normal** : le premier joueur qui possède **3 trios** gagne.',
      '**Mode Picante** : il faut **2 trios liés**. Deux trios sont liés quand leur somme ou leur différence vaut 7 ; les pastilles en bas d’une carte rappellent ses numéros liés.',
      'Dans les deux modes, le **trio de 7** fait gagner immédiatement.',
    ],
  },
  {
    title: 'Chacun son téléphone',
    body: [
      'Il faut une connexion Internet : les téléphones communiquent par un relais public. Ta main est **chiffrée pour ton seul téléphone** ; les autres joueurs ne reçoivent que le nombre de tes cartes.',
      'Le téléphone de l’hôte fait l’arbitre. S’il se ferme, la partie se met en pause et reprend dès qu’il revient. Si tu perds la connexion, rouvre simplement l’appli : tu retrouves ta main et la partie.',
      'Aucun compte : ton prénom et la partie en cours restent sur ton téléphone.',
    ],
  },
];

/** Petit balisage : **gras** uniquement. Renvoie des nœuds DOM (jamais d'innerHTML). */
export function rich(text) {
  return text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((part) => {
    if (part.startsWith('**')) {
      const b = document.createElement('strong');
      b.textContent = part.slice(2, -2);
      return b;
    }
    return document.createTextNode(part);
  });
}
