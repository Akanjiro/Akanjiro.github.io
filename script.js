/* =========================================================
   Financity — script.js
   Toute la logique du site :
   1. Catégories et données
   2. Outils (dates, format €)
   3. Calculs (périodes, totaux, récurrents)
   4. Graphiques (canvas)
   5. Affichage
   6. Formulaire d'ajout / modification
   7. Spécial étudiant : reste à vivre, été sans bourse,
      objectifs, simulateur, coût en temps
   8. Événements (clics, clavier...)
   ========================================================= */


/* ---------- 1. Catégories et données ---------- */

const CATEGORIES = {
  // Revenus
  bourse:         { name: "Bourse",         emoji: "🎓", color: "#30d158", type: "income" },
  salaire:        { name: "Salaire / Job",  emoji: "💼", color: "#34c759", type: "income" },
  revenus:        { name: "Autres revenus", emoji: "💰", color: "#64d2ff", type: "income" },
  // Dépenses
  loyer:          { name: "Loyer",          emoji: "🏠", color: "#5e5ce6", type: "expense" },
  nourriture:     { name: "Nourriture",     emoji: "🍔", color: "#ff9f0a", type: "expense" },
  abonnements:    { name: "Abonnements",    emoji: "📺", color: "#bf5af2", type: "expense" },
  transports:     { name: "Transports",     emoji: "🚌", color: "#0a84ff", type: "expense" },
  investissement: { name: "Investissement", emoji: "📈", color: "#30b0c7", type: "expense" },
  etudes:         { name: "Études",         emoji: "📚", color: "#ffd60a", type: "expense" },
  sante:          { name: "Santé",          emoji: "💊", color: "#ff6482", type: "expense" },
  loisirs:        { name: "Loisirs",        emoji: "🎮", color: "#ff375f", type: "expense" },
  shopping:       { name: "Shopping",       emoji: "🛍️", color: "#ac8e68", type: "expense" },
  imprevus:       { name: "Imprévus",       emoji: "⚠️", color: "#ff453a", type: "expense" },
  autres:         { name: "Autres",         emoji: "📦", color: "#8e8e93", type: "expense" },
};

const STORAGE_KEY = "financity_tx";

// Liste de toutes les opérations, sauvegardée dans le localStorage du navigateur
let transactions = loadTransactions();

// État de l'interface (ce qui est affiché en ce moment)
const state = {
  view: "month",        // "day", "month" ou "year"
  cursor: new Date(),   // date de la période affichée
  filter: "all",        // filtre de catégorie dans la liste
  search: "",
  formType: "expense",
  formCat: "nourriture",
  editingId: null,      // id de l'opération modifiée (null = ajout)
};

// Objectifs d'épargne et réglages, eux aussi sauvegardés
let goals = loadJSON("financity_goals", []);
let settings = { hourly: 10, bourse10: true, ...loadJSON("financity_settings", {}) };

let lastDeleted = null; // pour le bouton "Annuler" après une suppression

function loadTransactions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function loadJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch (e) {
    return fallback;
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
  localStorage.setItem("financity_goals", JSON.stringify(goals));
  localStorage.setItem("financity_settings", JSON.stringify(settings));
  scheduleBackup(); // + copie dans le dossier de sauvegarde (voir plus bas)
}

// petit identifiant unique (date + aléatoire)
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}


/* ---------- 2. Outils ---------- */

const $ = (sel) => document.querySelector(sel);

const money = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const fmt = (n) => money.format(n);

const pad = (n) => String(n).padStart(2, "0");

// Date -> "2026-11-18" (on évite toISOString() qui décale à cause du fuseau horaire)
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// "2026-11-18" -> Date
function parseISO(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
const isSummer = (m) => m === 6 || m === 7; // juillet et août (les mois commencent à 0 en JS)
const DAY = 24 * 60 * 60 * 1000;            // un jour en millisecondes
const shortDate = (d) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// évite qu'un libellé contenant du HTML casse la page
function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}


/* ---------- 3. Calculs ---------- */

// Début et fin de la période (jour, mois ou année) qui contient "date"
function getRange(view, date) {
  const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
  if (view === "day")   return { start: new Date(y, m, d), end: new Date(y, m, d) };
  if (view === "month") return { start: new Date(y, m, 1), end: new Date(y, m + 1, 0) };
  return { start: new Date(y, 0, 1), end: new Date(y, 11, 31) };
}

// Avance ou recule de n périodes
function shift(date, view, n) {
  const d = new Date(date);
  if (view === "day") {
    d.setDate(d.getDate() + n);
  } else if (view === "month") {
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())));
  } else {
    d.setFullYear(d.getFullYear() + n);
  }
  return d;
}

/*
  Renvoie toutes les opérations entre start et end (inclus), de la plus récente à la plus ancienne.

  Les opérations récurrentes (abonnements, loyer, bourse...) ne sont enregistrées
  qu'UNE seule fois. Ici on fabrique une copie pour chaque mois concerné :
  ex. Netflix ajouté le 12/06 en "chaque mois" -> 12/07, 12/08, 12/09...
  S'il y a une date de fin (abonnement résilié), on s'arrête là.
  includeFuture = true pour voir aussi ce qui n'est pas encore passé
  (utile pour connaître les prélèvements à venir).

  Astuce : les dates au format "AAAA-MM-JJ" peuvent se comparer comme du texte,
  car l'ordre alphabétique est le même que l'ordre chronologique.
*/
function getTransactions(start, end, includeFuture = false) {
  const s = toISO(start), e = toISO(end);
  const today = toISO(new Date());
  const list = [];

  for (const t of transactions) {
    if (!t.recurring) {
      if (t.date >= s && t.date <= e) list.push(t);
      continue;
    }

    const day = parseISO(t.date).getDate();
    let y = start.getFullYear(), m = start.getMonth();

    // on parcourt chaque mois de la période
    while (new Date(y, m, 1) <= end) {
      // si le jour n'existe pas (ex : 31 février) on prend le dernier jour du mois
      const occ = toISO(new Date(y, m, Math.min(day, daysInMonth(y, m))));
      const stopped = t.endDate && occ > t.endDate;
      const future = occ > today && !includeFuture; // pas encore payé -> on ne le compte pas
      // bourse sur 10 mois : pas de versement en juillet (6) et août (7)
      const noBourse = t.category === "bourse" && settings.bourse10 && isSummer(m);
      if (occ >= t.date && occ >= s && occ <= e && !stopped && !future && !noBourse) {
        list.push({ ...t, date: occ });
      }
      m++;
      if (m > 11) { m = 0; y++; }
    }
  }
  return list.sort((a, b) => b.date.localeCompare(a.date));
}

// Additionne revenus / dépenses d'une liste
function totals(list) {
  let income = 0, expense = 0, invest = 0;
  for (const t of list) {
    if (t.type === "income") {
      income += t.amount;
    } else {
      expense += t.amount;
      if (t.category === "investissement") invest += t.amount;
    }
  }
  return { income, expense, invest, balance: income - expense };
}

// Variation en % entre deux valeurs (null si on ne peut pas comparer)
function percentChange(current, previous) {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}


/* ---------- 4. Graphiques ---------- */

// Prépare un canvas net sur les écrans Retina (on multiplie par devicePixelRatio)
function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: rect.width, h: rect.height };
}

/*
  Lance une animation : appelle draw(p) à chaque image avec p qui va de 0 à 1.
  On garde l'id de l'animation pour l'annuler si on redessine avant la fin.
*/
const runningAnims = {};
function animate(key, draw, duration = 800) {
  cancelAnimationFrame(runningAnims[key]);
  const t0 = performance.now();
  function frame(now) {
    const p = Math.min((now - t0) / duration, 1);
    draw(1 - Math.pow(1 - p, 3)); // "ease-out" : rapide au début, doux à la fin
    if (p < 1) runningAnims[key] = requestAnimationFrame(frame);
  }
  runningAnims[key] = requestAnimationFrame(frame);
}

// 1500 -> "1,5 k€", 300 -> "300 €"
const axisLabel = (v) => v >= 1000 ? (v / 1000).toFixed(1).replace(".", ",") + " k€" : Math.round(v) + " €";

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Infos du graphique gardées pour l'info-bulle au survol
let chartGeo = null;

// Calcule les données de la courbe : les 7 derniers jours / 6 derniers mois / 5 dernières années
function getSeries() {
  const count = { day: 7, month: 6, year: 5 }[state.view];
  const labels = [], income = [], expense = [];

  for (let i = count - 1; i >= 0; i--) {
    const d = shift(state.cursor, state.view, -i);
    const { start, end } = getRange(state.view, d);
    const t = totals(getTransactions(start, end));
    income.push(t.income);
    expense.push(t.expense);

    if (state.view === "day") labels.push(d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" }));
    else if (state.view === "month") labels.push(d.toLocaleDateString("fr-FR", { month: "short" }));
    else labels.push(String(d.getFullYear()));
  }
  return { labels, income, expense };
}

function drawLineChart(animated = true) {
  const canvas = $("#lineChart");
  const { ctx, w, h } = setupCanvas(canvas);
  const { labels, income, expense } = getSeries();

  const padL = 52, padR = 16, padT = 16, padB = 30;
  const max = Math.max(...income, ...expense, 50) * 1.15;
  const step = (w - padL - padR) / (labels.length - 1);
  const xs = labels.map((_, i) => padL + i * step);
  const yOf = (v) => h - padB - (v / max) * (h - padT - padB);

  chartGeo = { xs, labels, income, expense, padT, padB, h };
  const muted = cssVar("--muted");

  function draw(p) {
    ctx.clearRect(0, 0, w, h);

    // lignes horizontales + valeurs à gauche
    ctx.font = "11px -apple-system, Inter, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i;
      const y = yOf(v);
      ctx.strokeStyle = "rgba(120,120,128,.15)";
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillStyle = muted;
      ctx.fillText(axisLabel(v), padL - 8, y);
    }

    // étiquettes en bas
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    labels.forEach((l, i) => ctx.fillText(l, xs[i], h - padB + 10));

    // les 2 courbes (p fait "monter" la courbe pendant l'animation)
    drawCurve(income.map((v) => v * p), cssVar("--green"));
    drawCurve(expense.map((v) => v * p), cssVar("--red"));
  }

  function drawCurve(values, color) {
    const pts = values.map((v, i) => ({ x: xs[i], y: yOf(v) }));

    // Courbe lissée : entre deux points on trace une courbe de Bézier
    // dont les points de contrôle sont au milieu horizontalement.
    const path = new Path2D();
    path.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < pts.length - 1; i++) {
      const xc = (pts[i].x + pts[i + 1].x) / 2;
      path.bezierCurveTo(xc, pts[i].y, xc, pts[i + 1].y, pts[i + 1].x, pts[i + 1].y);
    }

    // remplissage en dégradé sous la courbe
    const fill = new Path2D(path);
    fill.lineTo(pts[pts.length - 1].x, h - padB);
    fill.lineTo(pts[0].x, h - padB);
    fill.closePath();
    const grad = ctx.createLinearGradient(0, padT, 0, h - padB);
    grad.addColorStop(0, color + "40");
    grad.addColorStop(1, color + "00");
    ctx.fillStyle = grad;
    ctx.fill(fill);

    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.stroke(path);

    // petits points
    pts.forEach((pt) => {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });
  }

  if (animated) animate("line", draw);
  else draw(1);
}

// Info-bulle quand la souris passe sur le graphique
function handleChartHover(e) {
  if (!chartGeo) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const x = e.clientX - rect.left;
  // on cherche le point le plus proche de la souris
  let idx = 0;
  chartGeo.xs.forEach((px, i) => {
    if (Math.abs(px - x) < Math.abs(chartGeo.xs[idx] - x)) idx = i;
  });
  const tip = $("#tooltip");
  tip.innerHTML = `<b>${chartGeo.labels[idx]}</b><br>
    <span style="color:var(--green)">●</span> ${fmt(chartGeo.income[idx])}<br>
    <span style="color:var(--red)">●</span> ${fmt(chartGeo.expense[idx])}`;
  const left = Math.min(Math.max(chartGeo.xs[idx] - tip.offsetWidth / 2, 0), rect.width - tip.offsetWidth);
  tip.style.transform = `translate(${left}px, 4px)`;
  tip.classList.add("show");
}

// Donut : répartition des dépenses par catégorie
function drawDonut(byCat, total, animated = true) {
  const canvas = $("#donutChart");
  const { ctx, w, h } = setupCanvas(canvas);
  const cx = w / 2, cy = h / 2;
  const thick = 22;
  const r = Math.min(w, h) / 2 - thick / 2 - 4;

  function draw(p) {
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = thick;

    // anneau gris de fond
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(120,120,128,.15)";
    ctx.stroke();
    if (total === 0) return;

    // chaque catégorie = un morceau d'arc proportionnel à son montant
    let angle = -Math.PI / 2; // on commence en haut
    const gap = byCat.length > 1 ? 0.03 : 0;
    for (const c of byCat) {
      const sweep = (c.value / total) * Math.PI * 2 * p;
      ctx.beginPath();
      ctx.arc(cx, cy, r, angle, angle + Math.max(sweep - gap, 0.001));
      ctx.strokeStyle = c.color;
      ctx.stroke();
      angle += sweep;
    }
  }

  if (animated) animate("donut", draw, 900);
  else draw(1);
}


/* ---------- 5. Affichage ---------- */

// Fait défiler un nombre jusqu'à sa nouvelle valeur (effet compteur)
function countUp(el, to) {
  const from = el._value || 0;
  el._value = to;
  animate(el.id, (p) => { el.textContent = fmt(from + (to - from) * p); }, 700);
}

// Badge "▲ 12 %" sous un chiffre clé. upIsGood = est-ce qu'une hausse est positive ?
// inEuros = afficher l'écart en € plutôt qu'en % (utile pour le solde qui peut être proche de 0)
function setDelta(el, current, previous, upIsGood, inEuros = false) {
  const pct = percentChange(current, previous);
  el.className = "delta";
  if (inEuros) {
    const diff = current - previous;
    if (Math.abs(diff) < 0.5) { el.textContent = "= stable"; return; }
    el.textContent = `${diff > 0 ? "▲ +" : "▼ −"}${fmt(Math.abs(diff))}`;
    el.classList.add(diff > 0 === upIsGood ? "good" : "bad");
    return;
  }
  if (pct === null) { el.textContent = "Nouveau"; return; }
  if (Math.abs(pct) < 0.5) { el.textContent = "= stable"; return; }
  const up = pct > 0;
  el.textContent = `${up ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)} %`;
  el.classList.add(up === upIsGood ? "good" : "bad");
}

function periodLabel() {
  const d = state.cursor;
  if (state.view === "day") {
    return capitalize(d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
  }
  if (state.view === "month") {
    return capitalize(d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }));
  }
  return String(d.getFullYear());
}

// Petite phrase qui résume si on a fait mieux ou moins bien que la période d'avant
function buildInsight(cur, prev) {
  const prevName = { day: "la veille", month: "le mois dernier", year: "l'an dernier" }[state.view];

  if (cur.income === 0 && cur.expense === 0) {
    return "Rien pour l'instant — ajoute une opération avec le bouton +";
  }
  if (prev.income === 0 && prev.expense === 0) {
    return `Solde de ${fmt(cur.balance)} sur cette période`;
  }

  const diff = cur.balance - prev.balance;
  const pct = percentChange(cur.expense, prev.expense);
  let text = diff >= 0
    ? `🎉 ${fmt(diff)} de mieux que ${prevName}`
    : `⚠️ ${fmt(Math.abs(diff))} de moins que ${prevName}`;
  if (pct !== null && Math.abs(pct) >= 1) {
    text += ` · dépenses ${pct > 0 ? "en hausse" : "en baisse"} de ${Math.abs(pct).toFixed(0)} %`;
  }
  return text;
}

function render(animated = true) {
  const { start, end } = getRange(state.view, state.cursor);
  const prevRange = getRange(state.view, shift(state.cursor, state.view, -1));

  const list = getTransactions(start, end);
  const cur = totals(list);
  const prev = totals(getTransactions(prevRange.start, prevRange.end));

  // Titre de la période
  const h1 = $("#periodLabel");
  h1.textContent = periodLabel();
  h1.classList.remove("swap");
  void h1.offsetWidth; // astuce pour relancer l'animation CSS
  h1.classList.add("swap");
  $("#insight").textContent = buildInsight(cur, prev);

  // Chiffres clés
  countUp($("#kpiBalance"), cur.balance);
  countUp($("#kpiIncome"), cur.income);
  countUp($("#kpiExpense"), cur.expense);
  countUp($("#kpiInvest"), cur.invest);
  setDelta($("#dBalance"), cur.balance, prev.balance, true, true);
  setDelta($("#dIncome"), cur.income, prev.income, true);
  setDelta($("#dExpense"), cur.expense, prev.expense, false);
  setDelta($("#dInvest"), cur.invest, prev.invest, true);

  // Répartition par catégorie (dépenses uniquement)
  const sums = {};
  list.filter((t) => t.type === "expense").forEach((t) => {
    sums[t.category] = (sums[t.category] || 0) + t.amount;
  });
  const byCat = Object.entries(sums)
    .map(([key, value]) => ({ key, value, ...CATEGORIES[key] }))
    .sort((a, b) => b.value - a.value);

  $("#donutTotal").textContent = fmt(cur.expense);
  drawDonut(byCat, cur.expense, animated);
  drawLineChart(animated);

  $("#catLegend").innerHTML = byCat.slice(0, 5).map((c) => {
    const pct = (c.value / cur.expense) * 100;
    return `<li>
      <span>${c.emoji}</span><span>${c.name}</span>
      <span class="val">${pct.toFixed(0)} %</span>
      <div class="bar"><i style="width:${pct}%;background:${c.color}"></i></div>
    </li>`;
  }).join("");

  const items = periodItems(); // la liste affichée = passées + mensuelles à venir
  renderFilterChips(items);
  renderList(items);
  renderSubscriptions();
  renderBudget();
  renderGoals();
  renderSimulator(false);
}

// Opérations de la période affichée + les mensuelles encore à venir.
// Les "à venir" sont seulement affichées (en grisé) : elles ne comptent pas dans les totaux.
function periodItems() {
  const { start, end } = getRange(state.view, state.cursor);
  const past = getTransactions(start, end);
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const from = start > tomorrow ? start : tomorrow;
  const upcoming = getTransactions(from, end, true)
    .filter((t) => t.recurring && t.date > toISO(now))
    .map((t) => ({ ...t, upcoming: true }));
  return [...upcoming, ...past].sort((a, b) => b.date.localeCompare(a.date));
}

// Le filtre peut être une catégorie, ou "income" / "expense" pour tous les revenus / dépenses
function matchFilter(t) {
  if (state.filter === "all") return true;
  if (state.filter === "income" || state.filter === "expense") return t.type === state.filter;
  return t.category === state.filter;
}

function renderFilterChips(list) {
  // on n'affiche que les catégories présentes sur la période
  const present = [...new Set(list.map((t) => t.category))];
  const fixed = ["all", "income", "expense"];
  if (!fixed.includes(state.filter) && !present.includes(state.filter)) state.filter = "all";

  const chips = [
    `<button class="chip ${state.filter === "all" ? "active" : ""}" data-filter="all">Tout</button>`,
    `<button class="chip ${state.filter === "income" ? "active" : ""}" data-filter="income">💰 Revenus</button>`,
    `<button class="chip ${state.filter === "expense" ? "active" : ""}" data-filter="expense">💸 Dépenses</button>`,
  ];
  present.forEach((key) => {
    const c = CATEGORIES[key];
    chips.push(`<button class="chip ${state.filter === key ? "active" : ""}" data-filter="${key}">${c.emoji} ${c.name}</button>`);
  });
  $("#filterChips").innerHTML = chips.join("");
}

function renderList(list) {
  const q = state.search.toLowerCase();
  const filtered = list.filter((t) =>
    matchFilter(t) &&
    (t.label.toLowerCase().includes(q) || CATEGORIES[t.category].name.toLowerCase().includes(q))
  );

  $("#emptyState").classList.toggle("show", filtered.length === 0);
  $("#demoBtn").style.display = transactions.length === 0 ? "" : "none";

  let html = "";
  let lastDate = "";
  filtered.forEach((t, i) => {
    // un titre à chaque nouveau jour
    if (t.date !== lastDate && state.view !== "day") {
      lastDate = t.date;
      html += `<li class="day-head">${parseISO(t.date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</li>`;
    }
    const c = CATEGORIES[t.category];
    const sign = t.type === "income" ? "+" : "−";
    html += `<li class="tx ${t.upcoming ? "upcoming" : ""}" data-id="${t.id}" style="--i:${Math.min(i, 15)}">
      <div class="tx-icon" style="background:${c.color}22">${c.emoji}</div>
      <div class="tx-info">
        <strong>${escapeHTML(t.label)}</strong>
        <span>${t.upcoming ? "⏳ à venir · " : ""}${c.name}${t.recurring ? " · 🔁 mensuel" : ""}${t.type === "expense" && settings.hourly > 0 ? " · ≈ " + jobTime(t.amount) + " de job" : ""}</span>
      </div>
      <div class="tx-amount ${t.type}">${sign}${fmt(t.amount)}</div>
      <button class="tx-del" title="Supprimer">✕</button>
    </li>`;
  });
  $("#txList").innerHTML = html;
}

// Liste des opérations récurrentes encore actives + prochaine date
function renderSubscriptions() {
  const today = toISO(new Date());
  const subs = transactions.filter((t) => t.recurring && (!t.endDate || t.endDate >= today));

  let monthly = 0;
  const items = subs.map((t, i) => {
    const c = CATEGORIES[t.category];
    if (t.type === "expense") monthly += t.amount;

    // prochaine échéance : ce mois-ci si pas encore passée, sinon le mois prochain
    const now = new Date();
    const day = parseISO(t.date).getDate();
    let next = new Date(now.getFullYear(), now.getMonth(), Math.min(day, daysInMonth(now.getFullYear(), now.getMonth())));
    if (toISO(next) < today) {
      next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      next.setDate(Math.min(day, daysInMonth(next.getFullYear(), next.getMonth())));
    }
    if (toISO(next) < t.date) next = parseISO(t.date);

    return `<li class="sub" data-id="${t.id}" style="--i:${i}" title="Cliquer pour modifier">
      <div class="tx-icon" style="background:${c.color}22">${c.emoji}</div>
      <div>${escapeHTML(t.label)}<small>le ${next.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</small></div>
      <div class="sub-right">${t.type === "income" ? "+" : "−"}${fmt(t.amount)}
        <button data-stop="${t.id}">Arrêter</button>
      </div>
    </li>`;
  });

  $("#subsList").innerHTML = items.join("") ||
    `<li class="muted" style="padding:8px">Coche « Chaque mois » en ajoutant une opération pour la voir ici.</li>`;
  $("#subsTotal").textContent = monthly ? `${fmt(monthly)} / mois` : "";
}

function toast(message, callback, buttonText = "Annuler", duration = 3500) {
  const el = $("#toast");
  el.innerHTML = `<span>${message}</span>${callback ? `<button>${buttonText}</button>` : ""}`;
  if (callback) el.querySelector("button").onclick = () => { callback(); el.classList.remove("show"); };
  el.classList.add("show");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("show"), duration);
}

// Place la "pilule" sous le bouton actif d'un contrôle segmenté
function movePill(segmented) {
  const active = segmented.querySelector("button.active");
  const pill = segmented.querySelector(".seg-pill");
  pill.style.width = active.offsetWidth + "px";
  pill.style.transform = `translateX(${active.offsetLeft}px)`;
}


/* ---------- 6. Formulaire ---------- */

function renderCatGrid() {
  const cats = Object.entries(CATEGORIES).filter(([, c]) => c.type === state.formType);
  $("#catGrid").innerHTML = cats.map(([key, c]) =>
    `<button type="button" class="cat-btn ${key === state.formCat ? "active" : ""}" data-cat="${key}" style="--c:${c.color}">
      <span>${c.emoji}</span>${c.name}
    </button>`
  ).join("");
}

function setFormType(type) {
  state.formType = type;
  // si la catégorie choisie ne correspond plus au type, on en met une par défaut
  if (CATEGORIES[state.formCat].type !== type) {
    state.formCat = type === "income" ? "bourse" : "nourriture";
  }
  document.querySelectorAll("#typeSwitch button").forEach((b) => b.classList.toggle("active", b.dataset.type === type));
  movePill($("#typeSwitch"));
  renderCatGrid();
  updateTimeCost();
}

function openForm(id = null) {
  state.editingId = id;
  const t = id ? transactions.find((x) => x.id === id) : null;

  $("#formTitle").textContent = t ? "Modifier l'opération" : "Nouvelle opération";
  $("#submitBtn").textContent = t ? "Enregistrer" : "Ajouter";
  $("#amount").value = t ? t.amount : "";
  $("#label").value = t ? t.label : "";
  $("#date").value = t ? t.date : toISO(state.view === "day" ? state.cursor : new Date());
  $("#recurring").checked = t ? !!t.recurring : false;
  $("#recurHint").classList.toggle("show", $("#recurring").checked);
  if (t) state.formCat = t.category;

  openSheet("#backdrop");
  setFormType(t ? t.type : state.formType);
  setTimeout(() => $("#amount").focus(), 300);
}

// Ouvre / ferme les fenêtres (ajout, objectif, réglages)
function openSheet(id) {
  $(id).classList.add("open");
}
function closeForm() {
  document.querySelectorAll(".backdrop.open").forEach((b) => b.classList.remove("open"));
}

function submitForm(e) {
  e.preventDefault();
  const amount = Math.round(parseFloat($("#amount").value) * 100) / 100;
  if (!amount || amount <= 0) return;

  const data = {
    type: state.formType,
    category: state.formCat,
    label: $("#label").value.trim() || CATEGORIES[state.formCat].name,
    amount,
    date: $("#date").value,
    recurring: $("#recurring").checked,
  };

  if (state.editingId) {
    const t = transactions.find((x) => x.id === state.editingId);
    Object.assign(t, data);
    toast("Opération modifiée ✓");
  } else {
    transactions.push({ id: uid(), ...data });
    toast("Opération ajoutée ✓");
  }

  save();
  closeForm();
  render();
}

function deleteTransaction(id, li) {
  const t = transactions.find((x) => x.id === id);
  if (t.recurring && !confirm("C'est une opération mensuelle : la supprimer efface aussi tout son historique.\nPour juste l'arrêter, utilise « Arrêter » dans Récurrents.\n\nSupprimer quand même ?")) return;

  li.classList.add("removing");
  // on attend la fin de l'animation avant de vraiment supprimer
  setTimeout(() => {
    lastDeleted = t;
    transactions = transactions.filter((x) => x.id !== id);
    save();
    render(false);
    toast("Opération supprimée", () => {
      transactions.push(lastDeleted);
      save();
      render(false);
    });
  }, 300);
}

function stopRecurring(id) {
  const t = transactions.find((x) => x.id === id);
  t.endDate = toISO(new Date()); // l'historique reste, mais plus rien après aujourd'hui
  save();
  render(false);
  toast(`« ${escapeHTML(t.label)} » arrêté`, () => {
    delete t.endDate;
    save();
    render(false);
  });
}


/* ---------- Données d'exemple ---------- */

function loadDemo() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const rnd = (a, b) => Math.round((a + Math.random() * (b - a)) * 100) / 100;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const list = [];
  const add = (type, category, label, amount, date, recurring = false) =>
    list.push({ id: uid(), type, category, label, amount, date: toISO(date), recurring });

  const y0 = start.getFullYear(), m0 = start.getMonth();
  add("income", "bourse", "Bourse CROUS", 578, new Date(y0, m0, 5), true);
  add("expense", "loyer", "Loyer studio", 380, new Date(y0, m0, 3), true);
  add("expense", "abonnements", "Netflix", 13.49, new Date(y0, m0, 12), true);
  add("expense", "abonnements", "Spotify Étudiant", 6.99, new Date(y0, m0, 15), true);
  add("expense", "abonnements", "Forfait mobile", 15.99, new Date(y0, m0, 8), true);
  add("expense", "investissement", "ETF World (PEA)", 100, new Date(y0, m0, 6), true);

  for (let i = 0; i < 6; i++) {
    const y = y0, m = m0 + i; // new Date() gère tout seul le passage à l'année suivante
    add("income", "salaire", "Job étudiant", rnd(320, 480), new Date(y, m, 12));
    for (let k = 0; k < 7; k++) {
      add("expense", "nourriture", pick(["Courses Super U", "Carrefour Market", "Resto U", "Snack", "Leader Price", "Boulangerie"]), rnd(6, 58), new Date(y, m, 1 + Math.floor(Math.random() * 27)));
    }
    add("expense", "transports", pick(["Essence", "Bus", "Taxi co"]), rnd(15, 45), new Date(y, m, 10));
    add("expense", "transports", pick(["Essence", "Bus"]), rnd(15, 40), new Date(y, m, 22));
    add("expense", "loisirs", pick(["Cinéma", "Sortie entre amis", "Jeu vidéo", "Concert"]), rnd(10, 60), new Date(y, m, 18));
    if (Math.random() < 0.6) add("expense", "shopping", pick(["Vêtements", "Chaussures", "Accessoire tel"]), rnd(15, 70), new Date(y, m, 14));
    if (Math.random() < 0.4) add("expense", "imprevus", pick(["Réparation scooter", "Amende", "Écran cassé"]), rnd(30, 120), new Date(y, m, 20));
    if (Math.random() < 0.4) add("expense", "sante", "Pharmacie", rnd(5, 25), new Date(y, m, 9));
    if (Math.random() < 0.5) add("expense", "etudes", pick(["Livre", "Impressions", "Fournitures"]), rnd(5, 35), new Date(y, m, 4));
  }

  // pas d'opérations dans le futur
  const today = toISO(now);
  transactions = list.filter((t) => t.recurring || t.date <= today);
  if (goals.length === 0) {
    goals = [
      { id: uid(), emoji: "✈️", name: "Billet Cayenne–Paris", target: 650, saved: 220, monthly: 50 },
      { id: uid(), emoji: "💻", name: "Nouvel ordi", target: 900, saved: 150, monthly: 40 },
    ];
  }
  save();
  render();
  toast("Données d'exemple chargées ✓");
}


/* ---------- 7. Spécial étudiant ---------- */

// La bourse = l'opération mensuelle de catégorie "bourse" encore active
function getBourse() {
  const today = toISO(new Date());
  return transactions.find((t) => t.recurring && t.category === "bourse" && (!t.endDate || t.endDate >= today));
}

// Date de versement un mois donné (si le jour n'existe pas, dernier jour du mois)
const payDate = (y, m, day) => new Date(y, m, Math.min(day, daysInMonth(y, m)));

/*
  RESTE À VIVRE
  On regarde le "cycle" entre le dernier versement de bourse et le prochain.
  reste = revenus du cycle - dépenses du cycle - prélèvements mensuels encore à venir
  puis on divise par le nombre de jours avant la prochaine bourse.
  Sans bourse enregistrée, le cycle = le mois en cours.
*/
function budgetInfo() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const bourse = getBourse();
  let start, next;

  if (bourse) {
    const day = parseISO(bourse.date).getDate();
    // prochain versement : on avance d'un mois tant que la date est passée
    // (ou tombe en été si la bourse est sur 10 mois)
    let m = today.getMonth();
    next = payDate(today.getFullYear(), m, day);
    while (next <= today || (settings.bourse10 && isSummer(next.getMonth()))) {
      m++;
      next = payDate(today.getFullYear(), m, day);
    }
    // versement précédent : on recule d'un mois depuis le prochain (en sautant l'été)
    let pm = m - 1;
    start = payDate(today.getFullYear(), pm, day);
    while (settings.bourse10 && isSummer(start.getMonth())) {
      pm--;
      start = payDate(today.getFullYear(), pm, day);
    }
  } else {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
    next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  }

  const done = totals(getTransactions(start, today));
  // les abonnements/loyer qui vont encore tomber avant la prochaine bourse
  const upcoming = getTransactions(new Date(today.getTime() + DAY), new Date(next.getTime() - DAY), true)
    .filter((t) => t.recurring && t.type === "expense");
  const upcomingSum = upcoming.reduce((sum, t) => sum + t.amount, 0);

  const left = done.income - done.expense - upcomingSum;
  const days = Math.max(Math.round((next - today) / DAY), 1);
  const progress = (today - start) / (next - start);

  return { bourse, start, next, left, days, perDay: left / days, progress, upcoming, upcomingSum };
}

/*
  ÉTÉ SANS BOURSE
  Bourse sur 10 mois = rien en juillet et août.
  Besoin estimé = 2 mois de dépenses habituelles (moyenne des 3 derniers mois),
  réparti sur les mois qui restent avant juillet.
*/
function summerAdvice() {
  if (!settings.bourse10 || !getBourse()) return null;
  const now = new Date();
  const m = now.getMonth();
  if (isSummer(m)) return { summer: true };

  const monthsLeft = m < 6 ? 6 - m : 12 - m + 6; // ex : novembre -> nov à juin = 8 mois
  const pastMonths = [1, 2, 3]
    .map((i) => {
      const r = getRange("month", shift(now, "month", -i));
      return totals(getTransactions(r.start, r.end)).expense;
    })
    .filter((v) => v > 0);
  if (pastMonths.length === 0) return null;

  const average = pastMonths.reduce((a, b) => a + b, 0) / pastMonths.length;
  const need = average * 2;
  return { summer: false, need, perMonth: need / monthsLeft, monthsLeft };
}

function renderBudget() {
  const b = budgetInfo();
  const value = $("#budgetPerDay");
  countUp(value, b.perDay);
  value.className = b.perDay >= 8 ? "ok" : b.perDay >= 0 ? "warn" : "bad";

  $("#budgetUntil").textContent = b.bourse ? "jusqu'à la prochaine bourse" : "jusqu'à la fin du mois";
  $("#budgetSub").textContent = b.left >= 0
    ? `${fmt(b.left)} jusqu'au ${shortDate(b.next)} · ${b.days} jour${b.days > 1 ? "s" : ""}`
    : `Tu dépasses de ${fmt(-b.left)} sur ce cycle · ${b.days} jour${b.days > 1 ? "s" : ""} à tenir`;

  $("#cycleFill").style.width = Math.min(Math.max(b.progress, 0), 1) * 100 + "%";
  $("#cycleStart").textContent = shortDate(b.start);
  $("#cycleEnd").textContent = shortDate(b.next);

  if (!b.bourse) {
    $("#budgetNote").textContent = "Ajoute ta bourse en opération « Chaque mois » (catégorie 🎓 Bourse) pour compter jusqu'au prochain versement.";
  } else if (b.upcomingSum > 0) {
    const names = [...new Set(b.upcoming.map((t) => t.label))];
    $("#budgetNote").textContent = `Déjà déduit : ${fmt(b.upcomingSum)} de prélèvements à venir (${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""}).`;
  } else {
    $("#budgetNote").textContent = "Aucun prélèvement mensuel avant la prochaine bourse.";
  }

  const s = summerAdvice();
  const box = $("#summerBox");
  box.classList.toggle("show", !!s);
  if (s && s.summer) {
    box.innerHTML = "☀️ C'est l'été : pas de bourse avant septembre, tiens bon !";
  } else if (s) {
    box.innerHTML = `☀️ <b>Pas de bourse en juillet-août.</b> Mets <b>${fmt(s.perMonth)}/mois</b> de côté
      pendant ${s.monthsLeft} mois pour tenir l'été (besoin estimé : ${fmt(s.need)}).`;
  }
}

/* ---- Objectifs d'épargne ---- */

const GOAL_EMOJIS = ["✈️", "💻", "🚗", "📱", "🎓", "🏝️", "🎁", "🏠"];
let editingGoal = null;
let goalEmoji = GOAL_EMOJIS[0];

function renderGoals() {
  if (goals.length === 0) {
    $("#goalsList").innerHTML = `<li class="muted" style="padding:8px">Un billet d'avion, un ordi, le permis… ajoute ton premier objectif.</li>`;
    return;
  }
  $("#goalsList").innerHTML = goals.map((g, i) => {
    const pct = Math.min((g.saved / g.target) * 100, 100);
    const remaining = Math.max(g.target - g.saved, 0);
    let info = `encore ${fmt(remaining)}`;
    if (remaining === 0) {
      info = "Objectif atteint 🎉";
    } else if (g.monthly > 0) {
      // date estimée = aujourd'hui + nombre de mois nécessaires
      const months = Math.ceil(remaining / g.monthly);
      const when = shift(new Date(), "month", months).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
      info += ` · vers ${when}`;
    }
    return `<li class="goal" data-goal="${g.id}" style="--i:${i}">
      <div class="goal-top">
        <div class="goal-emoji">${g.emoji}</div>
        <div class="goal-name">${escapeHTML(g.name)}<small>${info}</small></div>
        <div class="goal-amount"><b>${fmt(g.saved)}</b> / ${fmt(g.target)}
          ${g.monthly > 0 && remaining > 0 ? `<button data-deposit="${g.id}">+ ${fmt(g.monthly)}</button>` : ""}
        </div>
      </div>
      <div class="goal-bar"><i style="width:${pct}%"></i></div>
    </li>`;
  }).join("");
}

function openGoalForm(id = null) {
  editingGoal = id;
  const g = goals.find((x) => x.id === id);
  goalEmoji = g ? g.emoji : GOAL_EMOJIS[0];
  $("#goalTitle").textContent = g ? "Modifier l'objectif" : "Nouvel objectif";
  $("#goalName").value = g ? g.name : "";
  $("#goalTarget").value = g ? g.target : "";
  $("#goalSaved").value = g ? g.saved : "";
  $("#goalMonthly").value = g ? g.monthly : "";
  $("#goalDelete").style.display = g ? "" : "none";
  renderEmojiPick();
  openSheet("#goalBackdrop");
  setTimeout(() => $("#goalName").focus(), 300);
}

function renderEmojiPick() {
  $("#emojiPick").innerHTML = GOAL_EMOJIS.map((e) =>
    `<button type="button" class="${e === goalEmoji ? "active" : ""}" data-emoji="${e}">${e}</button>`
  ).join("");
}

function submitGoal(e) {
  e.preventDefault();
  const data = {
    emoji: goalEmoji,
    name: $("#goalName").value.trim(),
    target: parseFloat($("#goalTarget").value) || 0,
    saved: parseFloat($("#goalSaved").value) || 0,
    monthly: parseFloat($("#goalMonthly").value) || 0,
  };
  if (!data.name || data.target <= 0) return;
  if (editingGoal) Object.assign(goals.find((g) => g.id === editingGoal), data);
  else goals.push({ id: uid(), ...data });
  save();
  closeForm();
  renderGoals();
  toast(editingGoal ? "Objectif modifié ✓" : "Objectif ajouté ✓");
}

function depositGoal(id) {
  const g = goals.find((x) => x.id === id);
  const before = g.saved;
  g.saved = Math.min(g.saved + g.monthly, g.target);
  save();
  renderGoals();
  toast(g.saved >= g.target ? `🎉 « ${escapeHTML(g.name)} » atteint !` : `${fmt(g.saved - before)} mis de côté ✓`, () => {
    g.saved = before;
    save();
    renderGoals();
  });
}

/* ---- Simulateur d'investissement (intérêts composés) ---- */

/*
  Chaque mois : valeur = valeur × (1 + taux mensuel) + versement
  Les intérêts rapportent eux-mêmes des intérêts : c'est l'effet "boule de neige".
  On garde un point par année pour le graphique.
*/
function simulate(start, monthly, ratePct, years) {
  const r = ratePct / 100 / 12;
  let value = start, paid = start;
  const points = [{ year: 0, paid, value }];
  for (let month = 1; month <= years * 12; month++) {
    value = value * (1 + r) + monthly;
    paid += monthly;
    if (month % 12 === 0) points.push({ year: month / 12, paid, value });
  }
  return points;
}

function renderSimulator(animated = true) {
  const monthlyInput = $("#simMonthly");
  // par défaut : ce que tu investis déjà chaque mois (tant que tu n'as pas changé la valeur)
  if (!monthlyInput.dataset.touched) {
    const today = toISO(new Date());
    const auto = transactions
      .filter((t) => t.recurring && t.category === "investissement" && (!t.endDate || t.endDate >= today))
      .reduce((sum, t) => sum + t.amount, 0);
    monthlyInput.value = auto || 50;
  }

  const monthly = parseFloat(monthlyInput.value) || 0;
  const rate = parseFloat($("#simRate").value) || 0;
  const years = parseInt($("#simYears").value, 10);
  const start = totals(getTransactions(new Date(2000, 0, 1), new Date())).invest; // déjà investi

  const points = simulate(start, monthly, rate, years);
  const last = points[points.length - 1];
  const yearsTxt = `${years} an${years > 1 ? "s" : ""}`;

  $("#simYearsVal").textContent = yearsTxt;
  $("#simYearsTxt").textContent = yearsTxt;
  countUp($("#simValue"), last.value);
  $("#simPaid").textContent = fmt(last.paid);
  $("#simGain").textContent = fmt(last.value - last.paid);
  $("#simStart").textContent = fmt(start);
  drawSimChart(points, animated);
}

// Barres empilées : bleu = argent versé, vert = intérêts gagnés
function drawSimChart(points, animated) {
  const { ctx, w, h } = setupCanvas($("#simChart"));
  const padL = 56, padR = 8, padT = 10, padB = 26;
  const max = Math.max(...points.map((p) => p.value), 1) * 1.1;
  const n = points.length;
  const slot = (w - padL - padR) / n;
  const bw = Math.max(Math.min(slot * 0.6, 28), 3);
  const yOf = (v) => h - padB - (v / max) * (h - padT - padB);
  const muted = cssVar("--muted"), blue = cssVar("--blue"), green = cssVar("--green");

  function draw(p) {
    ctx.clearRect(0, 0, w, h);
    ctx.font = "11px -apple-system, Inter, sans-serif";

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i, y = yOf(v);
      ctx.strokeStyle = "rgba(120,120,128,.15)";
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillStyle = muted;
      ctx.fillText(axisLabel(v), padL - 8, y);
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    points.forEach((pt, i) => {
      const x = padL + slot * i + (slot - bw) / 2;
      // les barres apparaissent les unes après les autres
      const grow = Math.min(Math.max(p * 1.6 - (i / n) * 0.6, 0), 1);
      const paidH = (h - padB - yOf(pt.paid)) * grow;
      const gainH = (yOf(pt.paid) - yOf(pt.value)) * grow;
      ctx.fillStyle = blue;
      ctx.fillRect(x, h - padB - paidH, bw, paidH);
      ctx.fillStyle = green;
      ctx.fillRect(x, h - padB - paidH - gainH, bw, gainH);

      const step = n > 16 ? 5 : n > 8 ? 2 : 1; // pas toutes les étiquettes si beaucoup de barres
      if (i % step === 0 || i === n - 1) {
        ctx.fillStyle = muted;
        ctx.fillText(i === 0 ? "auj." : `${pt.year} a`, x + bw / 2, h - padB + 8);
      }
    });
  }

  if (animated) animate("sim", draw, 1000);
  else draw(1);
}

/* ---- Coût en temps : une dépense traduite en heures de job / jours de bourse ---- */

function jobTime(amount) {
  const hours = amount / settings.hourly;
  if (Math.round(hours * 60) < 60) return `${Math.max(Math.round(hours * 60), 1)} min`;
  let h = Math.floor(hours), min = Math.round((hours - h) * 60);
  if (min === 60) { h++; min = 0; }
  return min ? `${h} h ${pad(min)}` : `${h} h`;
}

function bourseDays(amount) {
  const b = getBourse();
  if (!b) return null;
  const days = amount / (b.amount / 30); // la bourse d'un mois couvre ~30 jours
  if (days < 1) return "moins d'1 jour de bourse";
  const txt = (Math.round(days * 10) / 10).toString().replace(".", ",");
  return `${txt} jour${days >= 2 ? "s" : ""} de bourse`;
}

function updateTimeCost() {
  const amount = parseFloat($("#amount").value);
  const el = $("#timeCost");
  if (state.formType !== "expense" || !amount || amount <= 0) {
    el.textContent = "";
    return;
  }
  const parts = [];
  if (settings.hourly > 0) parts.push(`${jobTime(amount)} de job`);
  const days = bourseDays(amount);
  if (days) parts.push(days);
  el.textContent = parts.length ? "≈ " + parts.join(" · ") : "";
}

/* ---- Réglages ---- */

function openSettings() {
  $("#setHourly").value = settings.hourly;
  $("#setBourse10").checked = settings.bourse10;
  openSheet("#settingsBackdrop");
}

function submitSettings(e) {
  e.preventDefault();
  settings.hourly = parseFloat($("#setHourly").value) || 0;
  settings.bourse10 = $("#setBourse10").checked;
  save();
  closeForm();
  render(false);
  toast("Réglages enregistrés ✓");
}


/* ---- Sauvegarde automatique dans un dossier ----

  On utilise la "File System Access API" (Chrome, Edge, Brave, Arc…) :
  1. l'utilisateur choisit UNE fois un dossier (ex : "sauvegarde")
  2. on garde l'accès à ce dossier dans IndexedDB (une petite base de données du navigateur,
     car localStorage ne sait stocker que du texte)
  3. à chaque modification, on écrit financity-AAAA-MM-JJ.json dans ce dossier
     -> un fichier par jour (réécrit dans la journée), on garde les 30 derniers.
  Pour des raisons de sécurité, le navigateur peut redemander l'autorisation
  quand on rouvre le site : il suffit de cliquer sur "Reconnecter".
*/

const canBackup = "showDirectoryPicker" in window;
let backupDir = null;   // le dossier choisi
let backupTimer = null;

function backupData() {
  return { transactions, goals, settings };
}

// Remplace toutes les données par celles d'une sauvegarde
function applyBackup(data) {
  if (Array.isArray(data)) {
    transactions = data; // ancienne sauvegarde (juste les opérations)
  } else if (data && Array.isArray(data.transactions)) {
    transactions = data.transactions;
    goals = data.goals || [];
    settings = { ...settings, ...data.settings };
  } else {
    throw new Error("Fichier invalide");
  }
  save();
  render();
}

// Mini outil IndexedDB : lire / enregistrer / effacer le dossier
function idb(action, value) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("financity", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("handles");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const store = open.result
        .transaction("handles", action === "get" ? "readonly" : "readwrite")
        .objectStore("handles");
      const req = action === "get" ? store.get("backupDir")
        : action === "put" ? store.put(value, "backupDir")
        : store.delete("backupDir");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
}

// A-t-on le droit d'écrire ? (ask = true : on le demande, il faut un clic de l'utilisateur)
async function hasPermission(ask = false) {
  if (!backupDir) return false;
  const opts = { mode: "readwrite" };
  if ((await backupDir.queryPermission(opts)) === "granted") return true;
  if (ask) return (await backupDir.requestPermission(opts)) === "granted";
  return false;
}

// Attend 2 secondes sans modification avant d'écrire (évite d'écrire 10 fois de suite)
function scheduleBackup() {
  if (!backupDir) return;
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => writeBackup(), 2000);
}

// Petite "empreinte" d'un texte : si deux textes ont la même, ils sont (presque sûrement) identiques
function hashText(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return String(h);
}

async function writeBackup(showToast = false) {
  try {
    if (!(await hasPermission())) return updateBackupUI();
    const name = `financity-${toISO(new Date())}.json`;
    const content = JSON.stringify(backupData(), null, 2);

    // Si rien n'a changé depuis la dernière copie du jour, on n'écrit pas.
    // (Important : avec Live Server, écrire un fichier dans le projet recharge la page,
    //  donc écrire à chaque chargement créait une boucle infinie de rechargements.)
    const fingerprint = name + hashText(content);
    if (!showToast && localStorage.getItem("financity_lastBackupHash") === fingerprint) return updateBackupUI();

    const fileHandle = await backupDir.getFileHandle(name, { create: true });
    const writer = await fileHandle.createWritable();
    await writer.write(content);
    await writer.close();
    localStorage.setItem("financity_lastBackupHash", fingerprint);
    localStorage.setItem("financity_lastBackup", new Date().toISOString());
    await cleanOldBackups();
    if (showToast) toast("Sauvegarde automatique ✓");
  } catch (err) {
    console.error(err);
    toast("Sauvegarde impossible ✕");
  }
  updateBackupUI();
}

// Liste les fichiers de sauvegarde du dossier, du plus ancien au plus récent
async function listBackups() {
  const names = [];
  for await (const entry of backupDir.values()) {
    if (entry.kind === "file" && /^financity-\d{4}-\d{2}-\d{2}\.json$/.test(entry.name)) names.push(entry.name);
  }
  return names.sort(); // le nom contient la date, donc trier = ranger par date
}

async function cleanOldBackups() {
  const names = await listBackups();
  for (const name of names.slice(0, Math.max(names.length - 30, 0))) {
    await backupDir.removeEntry(name);
  }
}

async function chooseBackupFolder() {
  try {
    backupDir = await window.showDirectoryPicker({ id: "financity", mode: "readwrite" });
  } catch {
    return; // l'utilisateur a annulé
  }
  await idb("put", backupDir);
  // si le dossier contient déjà des sauvegardes et que le site est vide, on propose de les récupérer
  const names = await listBackups();
  if (transactions.length === 0 && names.length > 0) {
    await restoreLatest();
  } else {
    await writeBackup(true);
  }
}

async function reconnectBackup() {
  if (await hasPermission(true)) await writeBackup(true);
  updateBackupUI();
}

async function restoreLatest() {
  if (!(await hasPermission(true))) return;
  const names = await listBackups();
  if (names.length === 0) return toast("Aucune sauvegarde dans ce dossier");
  const latest = names[names.length - 1];
  if (!confirm(`Remplacer les données actuelles par la sauvegarde « ${latest} » ?`)) return;
  const file = await (await backupDir.getFileHandle(latest)).getFile();
  applyBackup(JSON.parse(await file.text()));
  closeForm();
  toast(`Sauvegarde du ${latest.slice(10, 20).split("-").reverse().join("/")} restaurée ✓`);
}

async function forgetBackupFolder() {
  backupDir = null;
  await idb("delete");
  updateBackupUI();
  toast("Sauvegarde automatique désactivée");
}

// Met à jour le bloc "Sauvegarde automatique" dans les réglages
async function updateBackupUI() {
  const status = $("#backupStatus");
  const show = (id, visible) => { $(id).style.display = visible ? "" : "none"; };

  if (!canBackup) {
    status.textContent = "Ton navigateur ne permet pas d'écrire dans un dossier (ça marche sur Chrome, Edge, Brave, Arc…). Utilise le bouton Exporter en bas de la page.";
    ["#backupChoose", "#backupReconnect", "#backupRestore", "#backupForget"].forEach((id) => show(id, false));
    return;
  }

  const granted = await hasPermission();
  const last = localStorage.getItem("financity_lastBackup");
  if (!backupDir) {
    status.textContent = "Désactivée. Choisis un dossier : une copie y sera écrite chaque jour, toute seule.";
  } else if (!granted) {
    status.textContent = `Dossier « ${backupDir.name} » en pause : le navigateur redemande l'autorisation.`;
  } else {
    const when = last ? new Date(last).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "jamais";
    status.textContent = `✓ Active dans « ${backupDir.name} » · dernière copie : ${when}`;
  }
  show("#backupChoose", true);
  $("#backupChoose").textContent = backupDir ? "Changer de dossier" : "Choisir le dossier";
  show("#backupReconnect", backupDir && !granted);
  show("#backupRestore", !!backupDir);
  show("#backupForget", !!backupDir);
}

// Au démarrage : on récupère le dossier enregistré
async function initBackup() {
  if (!canBackup) return updateBackupUI();
  try {
    backupDir = (await idb("get")) || null;
  } catch {
    backupDir = null;
  }
  if (backupDir) {
    if (await hasPermission()) writeBackup();
    else toast("Sauvegarde auto en pause", reconnectBackup, "Reconnecter", 8000);
  }
  updateBackupUI();
}


/* ---------- 8. Événements ---------- */

function setView(view) {
  state.view = view;
  document.querySelectorAll("#viewSwitch button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  movePill($("#viewSwitch"));
  render();
}

$("#viewSwitch").addEventListener("click", (e) => {
  if (e.target.dataset.view) setView(e.target.dataset.view);
});

$("#prevBtn").onclick = () => { state.cursor = shift(state.cursor, state.view, -1); render(); };
$("#nextBtn").onclick = () => { state.cursor = shift(state.cursor, state.view, 1); render(); };
$("#todayBtn").onclick = () => { state.cursor = new Date(); render(); };

$("#addBtn").onclick = () => openForm();
$("#amount").addEventListener("input", updateTimeCost);

// Fermer une fenêtre : bouton "Annuler" ou clic à côté
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeForm));
document.querySelectorAll(".backdrop").forEach((b) =>
  b.addEventListener("click", (e) => { if (e.target === b) closeForm(); })
);

// Objectifs
$("#addGoalBtn").onclick = () => openGoalForm();
$("#goalForm").addEventListener("submit", submitGoal);
$("#goalsList").addEventListener("click", (e) => {
  if (e.target.dataset.deposit) return depositGoal(e.target.dataset.deposit);
  const li = e.target.closest(".goal");
  if (li) openGoalForm(li.dataset.goal);
});
$("#emojiPick").addEventListener("click", (e) => {
  if (!e.target.dataset.emoji) return;
  goalEmoji = e.target.dataset.emoji;
  renderEmojiPick();
});
$("#goalDelete").onclick = () => {
  goals = goals.filter((g) => g.id !== editingGoal);
  save();
  closeForm();
  renderGoals();
  toast("Objectif supprimé");
};

// Réglages
$("#settingsBtn").onclick = () => { openSettings(); updateBackupUI(); };
$("#backupChoose").onclick = chooseBackupFolder;
$("#backupReconnect").onclick = reconnectBackup;
$("#backupRestore").onclick = restoreLatest;
$("#backupForget").onclick = forgetBackupFolder;

// Astuce sous "Chaque mois" dans le formulaire
$("#recurring").addEventListener("change", (e) => $("#recurHint").classList.toggle("show", e.target.checked));
$("#settingsForm").addEventListener("submit", submitSettings);

// Simulateur : on recalcule à chaque changement
$("#simMonthly").addEventListener("input", (e) => {
  e.target.dataset.touched = "1"; // l'utilisateur a choisi sa valeur, on ne la remplace plus
  renderSimulator(false);
});
$("#simRate").addEventListener("input", () => renderSimulator(false));
$("#simYears").addEventListener("input", () => renderSimulator(false));

// Le graphique du simulateur s'anime quand on arrive dessus en scrollant
new IntersectionObserver((entries, observer) => {
  if (entries[0].isIntersecting) {
    renderSimulator(true);
    observer.disconnect();
  }
}, { threshold: 0.3 }).observe($(".sim-card"));

// Logo : on relance l'animation des immeubles au survol.
// (une animation CSS terminée ne se rejoue pas toute seule,
//  donc on l'enlève puis on la remet)
$(".brand").addEventListener("mouseenter", () => {
  document.querySelectorAll(".logo .bld, .logo .sun").forEach((el) => {
    el.style.animation = "none";
    el.getBoundingClientRect(); // force le navigateur à appliquer le "none"
    el.style.animation = "";
  });
});
$("#txForm").addEventListener("submit", submitForm);

$("#typeSwitch").addEventListener("click", (e) => {
  if (e.target.dataset.type) setFormType(e.target.dataset.type);
});
$("#catGrid").addEventListener("click", (e) => {
  const btn = e.target.closest(".cat-btn");
  if (!btn) return;
  state.formCat = btn.dataset.cat;
  renderCatGrid();
});

// Liste : clic sur la croix = supprimer, clic ailleurs = modifier
$("#txList").addEventListener("click", (e) => {
  const li = e.target.closest(".tx");
  if (!li) return;
  if (e.target.closest(".tx-del")) deleteTransaction(li.dataset.id, li);
  else openForm(li.dataset.id);
});

$("#filterChips").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  state.filter = chip.dataset.filter;
  render(false);
});

$("#search").addEventListener("input", (e) => {
  state.search = e.target.value;
  renderList(periodItems());
});

// Récurrents : "Arrêter" = stopper, clic ailleurs sur la ligne = modifier
$("#subsList").addEventListener("click", (e) => {
  if (e.target.dataset.stop) return stopRecurring(e.target.dataset.stop);
  const li = e.target.closest(".sub");
  if (li) openForm(li.dataset.id);
});

// Cartes du haut : un clic filtre la liste des opérations
$(".kpis").addEventListener("click", (e) => {
  const card = e.target.closest("[data-kpi]");
  if (!card) return;
  state.filter = card.dataset.kpi;
  render(false);
  $("#txList").closest(".card").scrollIntoView({ behavior: "smooth", block: "center" });
});

$("#demoBtn").onclick = loadDemo;

// Info-bulle du graphique
$("#lineChart").addEventListener("mousemove", handleChartHover);
$("#lineChart").addEventListener("mouseleave", () => $("#tooltip").classList.remove("show"));

// Thème clair / sombre (mémorisé)
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("#themeBtn").textContent = theme === "dark" ? "☀️" : "🌙";
  localStorage.setItem("financity_theme", theme);
}
$("#themeBtn").onclick = () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  render(false); // on redessine les graphiques avec les nouvelles couleurs
};

// Export / import d'une sauvegarde JSON
$("#exportBtn").onclick = () => {
  const blob = new Blob([JSON.stringify(backupData(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `financity-${toISO(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Sauvegarde téléchargée ✓");
};

$("#importInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      applyBackup(JSON.parse(reader.result));
      toast("Sauvegarde importée ✓");
    } catch {
      toast("Fichier invalide ✕");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

$("#resetBtn").onclick = () => {
  if (!confirm("Effacer toutes les opérations et les objectifs ? (pense à exporter avant)")) return;
  transactions = [];
  goals = [];
  save();
  render();
  toast("Tout a été effacé");
};

// Raccourcis clavier : ← → pour changer de période, Échap pour fermer
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeForm();
  if (e.target.tagName === "INPUT" || document.querySelector(".backdrop.open")) return;
  if (e.key === "ArrowLeft") $("#prevBtn").click();
  if (e.key === "ArrowRight") $("#nextBtn").click();
  if (e.key === "n" || e.key === "N") { e.preventDefault(); openForm(); } // N = nouvelle opération
});

// Lumière qui suit la souris sur les cartes (variables CSS --mx / --my)
document.addEventListener("pointermove", (e) => {
  const card = e.target.closest && e.target.closest(".card");
  if (!card) return;
  const r = card.getBoundingClientRect();
  card.style.setProperty("--mx", `${e.clientX - r.left}px`);
  card.style.setProperty("--my", `${e.clientY - r.top}px`);
});

// Quand on redimensionne la fenêtre, on redessine les graphiques (sans animation)
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    render(false);
    movePill($("#viewSwitch"));
  }, 150);
});


/* ---------- Démarrage ---------- */

// mode sombre par défaut (sauf si l'utilisateur a choisi le clair avant)
applyTheme(localStorage.getItem("financity_theme") || "dark");
movePill($("#viewSwitch"));
render();
initBackup();
