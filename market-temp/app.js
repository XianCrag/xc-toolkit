import {
  DEGREE_MAX,
  DEGREE_MIN,
  DEGREE_STEP,
  FACTORS,
  degreeLabel,
  degreeLean,
  groupedFactors,
  normalizeDegree,
  pendulumAngle,
  scoreAssessment,
} from "./engine.js";

const STORAGE_KEY = "xc-market-temp-v2";
const LEGACY_KEY = "xc-market-temp-v1";

/** @type {Record<string, number>} */
let answers = loadAnswers();

/** @type {Map<string, { row: HTMLElement, input: HTMLInputElement, out: HTMLOutputElement }>} */
const rowRefs = new Map();

let saveTimer = 0;
let gaugeRaf = 0;
let dragging = false;

const formRoot = document.getElementById("form-root");
const gaugeCard = document.getElementById("mt-result");
const arm = document.getElementById("pendulum-arm");
const tempValue = document.getElementById("temp-value");
const tempZone = document.getElementById("temp-zone");
const tempPosture = document.getElementById("temp-posture");
const metaEl = document.getElementById("mt-meta");
const btnReset = document.getElementById("btn-reset");

/**
 * Native LTR range: left = min (−2), right = max (+2).
 * Marks wants hot on the left, so slider value is inverted vs stored degree.
 * @param {number} degree
 */
function degreeToSlider(degree) {
  return -degree;
}

/** @param {number} slider */
function sliderToDegree(slider) {
  return -slider;
}

function loadAnswers() {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    /** @type {Record<string, number>} */
    const out = {};
    for (const f of FACTORS) {
      const d = normalizeDegree(parsed[f.id]);
      if (d != null) out[f.id] = d;
    }
    return out;
  } catch {
    return {};
  }
}

function saveAnswersSoon() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(answers));
    } catch {
      /* ignore */
    }
  }, 200);
}

function saveAnswersNow() {
  window.clearTimeout(saveTimer);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(answers));
  } catch {
    /* ignore */
  }
}

function formatTemp(t) {
  if (t == null) return "—";
  const sign = t > 0 ? "+" : "";
  return `${sign}${t}`;
}

function renderForm() {
  rowRefs.clear();
  const groups = groupedFactors();
  const frag = document.createDocumentFragment();

  for (const g of groups) {
    const section = document.createElement("section");
    section.className = "xc-card mt-group";
    section.setAttribute("aria-labelledby", `g-${slug(g.group)}`);

    const h2 = document.createElement("h2");
    h2.id = `g-${slug(g.group)}`;
    h2.textContent = g.group;
    section.appendChild(h2);

    const rows = document.createElement("div");
    rows.className = "mt-rows";

    for (const f of g.factors) {
      rows.appendChild(buildRow(f));
    }

    section.appendChild(rows);
    frag.appendChild(section);
  }

  formRoot.replaceChildren(frag);
}

/**
 * @param {import('./engine.js').Factor} f
 */
function buildRow(f) {
  const degree = answers[f.id] ?? null;
  const lean = degreeLean(degree);
  const row = document.createElement("div");
  row.className = "mt-row";
  row.dataset.id = f.id;
  if (lean) row.dataset.lean = lean;
  if (degree == null) row.dataset.unset = "true";

  const ask = document.createElement("div");
  ask.className = "mt-ask";
  ask.id = `label-${f.id}`;
  ask.textContent = f.ask;

  const control = document.createElement("div");
  control.className = "mt-slider";

  const ends = document.createElement("div");
  ends.className = "mt-slider-ends";

  const endHot = document.createElement("span");
  endHot.className = "mt-end mt-end--hot";
  endHot.textContent = f.left;

  const out = document.createElement("output");
  out.className = "mt-degree";
  out.id = `deg-${f.id}`;
  out.htmlFor = `slider-${f.id}`;
  out.textContent = degreeLabel(degree);

  const endCold = document.createElement("span");
  endCold.className = "mt-end mt-end--cold";
  endCold.textContent = f.right;

  ends.append(endHot, out, endCold);

  const input = document.createElement("input");
  input.type = "range";
  input.id = `slider-${f.id}`;
  input.className = "mt-range";
  input.min = String(DEGREE_MIN);
  input.max = String(DEGREE_MAX);
  input.step = String(DEGREE_STEP);
  input.value = String(degreeToSlider(degree ?? 0));
  input.setAttribute("aria-labelledby", `label-${f.id}`);
  input.setAttribute("aria-valuetext", degreeLabel(degree));

  input.addEventListener("pointerdown", () => {
    dragging = true;
    gaugeCard.classList.add("is-dragging");
  });
  input.addEventListener("pointerup", endDrag);
  input.addEventListener("pointercancel", endDrag);
  input.addEventListener("change", () => {
    endDrag();
    saveAnswersNow();
  });
  input.addEventListener("input", () => {
    const d = normalizeDegree(sliderToDegree(Number(input.value)));
    if (d == null) return;
    answers[f.id] = d;
    delete row.dataset.unset;
    const nextLean = degreeLean(d);
    if (nextLean) row.dataset.lean = nextLean;
    out.textContent = degreeLabel(d);
    input.setAttribute("aria-valuetext", degreeLabel(d));
    saveAnswersSoon();
    scheduleGauge();
  });

  control.append(ends, input);
  row.append(ask, control);
  rowRefs.set(f.id, { row, input, out });
  return row;
}

function endDrag() {
  if (!dragging) return;
  dragging = false;
  gaugeCard.classList.remove("is-dragging");
  scheduleGauge();
}

function scheduleGauge() {
  if (gaugeRaf) return;
  gaugeRaf = requestAnimationFrame(() => {
    gaugeRaf = 0;
    updateGauge();
  });
}

/**
 * @param {string} id
 */
function syncRow(id) {
  const ref = rowRefs.get(id);
  if (!ref) return;
  const { row, input, out } = ref;
  const degree = answers[id] ?? null;
  const lean = degreeLean(degree);
  if (lean) row.dataset.lean = lean;
  else delete row.dataset.lean;
  if (degree == null) row.dataset.unset = "true";
  else delete row.dataset.unset;

  if (!dragging) {
    input.value = String(degreeToSlider(degree ?? 0));
  }
  input.setAttribute("aria-valuetext", degreeLabel(degree));
  out.textContent = degreeLabel(degree);
}

function updateGauge() {
  const result = scoreAssessment(answers);
  const { zone } = result;

  gaugeCard.dataset.lean = zone.lean;
  tempValue.textContent = formatTemp(result.temperature);
  tempZone.textContent = zone.label;
  tempPosture.textContent = zone.posture;

  metaEl.textContent =
    result.answered === 0
      ? `0 of ${result.total} answered`
      : `${result.answered} of ${result.total} answered · ${result.left} left · ${result.neutral} mid · ${result.right} right`;

  const angle = pendulumAngle(result.temperature);
  arm.style.transform = `rotate(${-angle}deg)`;
}

function resetAll() {
  answers = {};
  saveAnswersNow();
  renderForm();
  updateGauge();
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

btnReset.addEventListener("click", () => {
  if (Object.keys(answers).length === 0) return;
  if (window.confirm("Clear all scores?")) resetAll();
});

renderForm();
updateGauge();
