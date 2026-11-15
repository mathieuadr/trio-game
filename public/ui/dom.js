// Petits outils DOM. Aucun framework.

/**
 * Crée un élément. Les enfants de type chaîne deviennent des nœuds texte (jamais du HTML) :
 * un prénom saisi par un joueur ne peut donc pas injecter de balise.
 * `html` est réservé aux illustrations SVG statiques de l'application.
 */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style') for (const [prop, val] of Object.entries(v)) { if (prop.startsWith('--')) el.style.setProperty(prop, val); else el.style[prop] = val; }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'attrs') for (const [a, val] of Object.entries(v)) el.setAttribute(a, val);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k.startsWith('aria-') || k === 'role' || !(k in el)) el.setAttribute(k, v === true ? '' : v);
      else el[k] = v;
    }
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const kid of kids) {
    if (kid == null || kid === false) continue;
    if (Array.isArray(kid)) append(el, kid);
    else el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
}

/** Illustration SVG (chaîne statique) dans un conteneur. */
export const art = (svg, cls = '') => h('span', { class: `art ${cls}`.trim(), html: svg, 'aria-hidden': 'true' });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Animations réduites : réglage de l'appli (classe sur <html>). */
export const reduced = () => document.documentElement.classList.contains('reduced');

/** Durée d'animation, raccourcie si les animations sont réduites. */
export const dur = (ms) => (reduced() ? Math.min(ms, 120) : ms);

export const plural = (n, one, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
