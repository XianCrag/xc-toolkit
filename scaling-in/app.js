import {
  buildContinuousSchedule,
  buildFitBuyMarkers,
  buildCompareTooltipHtml,
  dropPctFromPrice,
  formatAvg,
  formatMoney,
  formatShares,
  recommendBuyFromSchedule,
  recommendBuyShareCatchUpFromSchedule,
  rowMeta,
  validateStrategy,
} from "./engine.js";

const DEFAULT_STEPS = [
  { weightPct: 25, dropPct: 0 },
  { weightPct: 25, dropPct: 5 },
  { weightPct: 25, dropPct: 10 },
  { weightPct: 25, dropPct: 15 },
];

const STORAGE_KEY = "scalingInInputs";
const BUY_MARKER_RADIUS = 5;
const BUY_MARKER_HOVER_RADIUS = 6;
const MARKER_NEUTRAL_COLOR = "#3498db";

function readCurrentPriceFromDom() {
  const initialPrice = parseFloat(document.getElementById("initial-price").value) || 100;
  const raw = parseFloat(document.getElementById("current-price-input").value);
  if (!Number.isFinite(raw) || raw <= 0) {
    return { currentPrice: initialPrice, dropPct: 0 };
  }
  return { currentPrice: raw, dropPct: dropPctFromPrice(initialPrice, raw) };
}

function formatRelativeInitialDrop(dropPct) {
  const sign = dropPct >= 0 ? "-" : "+";
  return `相对初始 ${sign}${Math.abs(dropPct).toFixed(1)}%`;
}

function formatFitSlope(absBeta) {
  const two = absBeta.toFixed(2);
  if (Math.abs(parseFloat(two) - absBeta) <= 0.005) return two;
  for (const d of [3, 4]) {
    const s = absBeta.toFixed(d);
    if (Math.abs(parseFloat(s) - absBeta) < 10 ** -(d + 1)) return parseFloat(s).toString();
  }
  return parseFloat(absBeta.toFixed(4)).toString();
}

function formatAvgCurveNote(avgCurve) {
  const { alpha = 0, beta = 0 } = avgCurve;
  const intercept = alpha.toFixed(2);
  if (Math.abs(beta) < 1e-12) return `均价 ≈ ${intercept}`;
  const op = beta >= 0 ? "+" : "−";
  return `均价 ≈ ${intercept} ${op} ${formatFitSlope(Math.abs(beta))} × 跌幅%`;
}

function ensureCompareTooltipEl(chartWrap) {
  let el = chartWrap.querySelector(".si-chart-tooltip");
  if (!el) {
    el = document.createElement("div");
    el.className = "si-chart-tooltip";
    el.setAttribute("role", "tooltip");
    chartWrap.appendChild(el);
  }
  return el;
}

function externalAvgChartTooltipHandler(schedule, initialPrice) {
  return function externalTooltipHandler(context) {
    const { chart, tooltip } = context;
    const chartWrap = chart.canvas.closest(".si-chart-wrap");
    if (!chartWrap) return;
    const el = ensureCompareTooltipEl(chartWrap);

    if (tooltip.opacity === 0) {
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
      return;
    }

    const dropPct = dropPctAtTooltipCaret(chart);
    if (dropPct == null) {
      el.style.opacity = "0";
      return;
    }

    el.innerHTML = buildCompareTooltipHtml(schedule, initialPrice, dropPct);
    el.style.opacity = "1";
    el.style.pointerEvents = "none";

    const wrapRect = chartWrap.getBoundingClientRect();
    const canvasRect = chart.canvas.getBoundingClientRect();
    const x = canvasRect.left - wrapRect.left + tooltip.caretX;
    const y = canvasRect.top - wrapRect.top + tooltip.caretY;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;

    const wrapW = chartWrap.clientWidth;
    const elW = el.offsetWidth;
    if (elW > 0) {
      const pad = 4;
      let anchorX = x;
      if (anchorX - elW / 2 < pad) anchorX = elW / 2 + pad;
      if (anchorX + elW / 2 > wrapW - pad) anchorX = wrapW - elW / 2 - pad;
      el.style.left = `${anchorX}px`;
    }
  };
}

function readPositionFromDom() {
  const sharesHeld = parseFloat(document.getElementById("shares-held").value) || 0;
  const avgCostHeld =
    sharesHeld > 0 ? parseFloat(document.getElementById("avg-cost-held").value) || 0 : 0;
  return { sharesHeld, avgCostHeld };
}

function syncAvgCostHeldField() {
  const avgEl = document.getElementById("avg-cost-held");
  const shares = parseFloat(document.getElementById("shares-held").value) || 0;
  if (shares <= 0) {
    avgEl.value = "";
    avgEl.disabled = true;
    avgEl.placeholder = "—";
  } else {
    avgEl.disabled = false;
    avgEl.placeholder = "";
  }
}

function readStepsFromTable() {
  const rows = document.querySelectorAll("#steps-body tr");
  return Array.from(rows).map((tr) => ({
    weightPct: parseFloat(tr.querySelector(".step-weight").value) || 0,
    dropPct: parseFloat(tr.querySelector(".step-drop").value) || 0,
  }));
}

function readInputs() {
  const { sharesHeld, avgCostHeld } = readPositionFromDom();
  return {
    initialPrice: parseFloat(document.getElementById("initial-price").value) || 100,
    totalBudget: parseFloat(document.getElementById("total-budget").value) || 100000,
    steps: readStepsFromTable(),
    currentPrice: readCurrentPriceFromDom().currentPrice,
    sharesHeld,
    avgCostHeld,
  };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(readInputs()));
  } catch (_) {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved.initialPrice != null) document.getElementById("initial-price").value = saved.initialPrice;
    if (saved.totalBudget != null) document.getElementById("total-budget").value = saved.totalBudget;
    if (saved.currentPrice != null) {
      document.getElementById("current-price-input").value = saved.currentPrice;
    }
    if (saved.sharesHeld != null) document.getElementById("shares-held").value = saved.sharesHeld;
    const shares = saved.sharesHeld != null ? saved.sharesHeld : 0;
    if (saved.avgCostHeld != null) {
      document.getElementById("avg-cost-held").value = shares > 0 ? saved.avgCostHeld : "";
    }
    syncAvgCostHeldField();
    return Array.isArray(saved.steps) && saved.steps.length ? saved.steps : null;
  } catch (_) {
    return null;
  }
}

function renderError(msg) {
  const el = document.getElementById("error");
  el.textContent = msg || "";
  el.hidden = !msg;
}

function formatPlCell(pl, cumulativeSpent) {
  const pct = cumulativeSpent > 0 ? (pl / cumulativeSpent) * 100 : 0;
  const sign = pl >= 0 ? "+" : "";
  const cls = pl >= 0 ? "si-pl-pos" : "si-pl-neg";
  return `<span class="si-pl ${cls}">${sign}${formatMoney(pl)}</span><span class="si-cell-sub">${sign}${pct.toFixed(2)}%</span>`;
}

function referenceRowHtml(r) {
  const m = rowMeta(r);
  return `<tr>
    <td>${m.dropPct}%</td>
    <td>${m.price.toFixed(4)}</td>
    <td>${formatMoney(m.incrementalSpent)}</td>
    <td>${formatShares(m.incrementalShares)}</td>
    <td>${formatMoney(m.cumulativeSpent)}</td>
    <td>${formatShares(m.cumulativeShares)}</td>
    <td>${formatAvg(m.avgCost)}</td>
    <td class="si-pl-cell">${formatPlCell(m.pl, m.cumulativeSpent)}</td>
  </tr>`;
}

function dropPctAtTooltipCaret(chart) {
  const xScale = chart?.scales?.x;
  const caretX = chart?.tooltip?.caretX;
  if (!xScale || caretX == null) return null;
  const dropPct = xScale.getValueForPixel(caretX);
  return Number.isFinite(dropPct) ? dropPct : null;
}

function registerCrosshairCaretPositioner() {
  const positioners = Chart.Tooltip.positioners;
  if (positioners.crosshairCaret) return;
  positioners.crosshairCaret = (_items, eventPos) => ({
    x: eventPos.x,
    y: eventPos.y,
  });
}

function renderChartLegend() {
  const el = document.getElementById("chart-legend");
  if (!el) return;
  el.innerHTML =
    `<span class="si-legend-item">` +
    `<span class="si-legend-icon si-legend-icon-ref" aria-hidden="true"></span>` +
    `<span>参考策略</span></span>` +
    `<span class="si-legend-item">` +
    `<span class="si-legend-icon si-legend-icon-fit" aria-hidden="true"></span>` +
    `<span>拟合均价</span></span>` +
    `<span class="si-legend-item">` +
    `<span class="si-legend-split-dot" aria-hidden="true"></span>` +
    `<span>买点</span></span>`;
}

function renderAvgChart(schedule) {
  registerCrosshairCaretPositioner();
  const canvas = document.getElementById("avg-chart");
  Chart.getChart(canvas)?.destroy();
  const fitNote = document.getElementById("fit-line-note");
  if (fitNote && schedule.avgCurve) fitNote.textContent = formatAvgCurveNote(schedule.avgCurve);

  const { initialPrice } = readInputs();
  const toRefPoint = (r) => {
    const meta = rowMeta(r);
    return { x: meta.dropPct, y: meta.avgCost, meta };
  };
  const maxDrop = schedule.rows.at(-1)?.dropPct ?? 0;
  const grid = { color: "rgba(100, 116, 139, 0.2)" };
  const ds = (label, data, extra) => ({ label, data, tension: 0, ...extra });

  new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        ds(
          "参考策略",
          schedule.discrete.stepDetails.map((d) =>
            toRefPoint({
              dropPct: d.dropPct,
              price: d.price,
              incrementalSpent: d.spent,
              incrementalShares: d.shares,
              cumulativeSpent: d.cumulativeSpent,
              cumulativeShares: d.cumulativeShares,
            })
          ),
          {
            borderColor: "#3498db",
            backgroundColor: "rgba(52, 152, 219, 0.08)",
            borderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointStyle: "rect",
            stepped: true,
          }
        ),
        ds("拟合均价", schedule.avgCurve.sampleTargetCurve(maxDrop, 0.1), {
          borderColor: "#3498db",
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 0,
          pointStyle: "line",
        }),
        (() => {
          const buyMarkers = buildFitBuyMarkers(schedule, initialPrice);
          const markerColors = buyMarkers.map((p) => p.pointColor);
          return ds("买点", buyMarkers, {
            backgroundColor: MARKER_NEUTRAL_COLOR,
            borderColor: MARKER_NEUTRAL_COLOR,
            borderWidth: 0,
            pointBackgroundColor: markerColors,
            pointBorderColor: markerColors,
            pointRadius: BUY_MARKER_RADIUS,
            pointHoverRadius: BUY_MARKER_HOVER_RADIUS,
            pointStyle: "circle",
            showLine: false,
          });
        })(),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false, axis: "x" },
      plugins: {
        legend: { display: false },
        crosshair: {
          line: { color: "rgba(71, 85, 105, 0.55)", width: 1, dashPattern: [4, 4] },
          zoom: { enabled: false },
        },
        tooltip: {
          enabled: false,
          displayColors: false,
          caretPadding: 2,
          intersect: false,
          mode: "index",
          axis: "x",
          position: "crosshairCaret",
          external: externalAvgChartTooltipHandler(schedule, initialPrice),
        },
      },
      scales: {
        x: {
          type: "linear",
          title: { display: true, text: "跌幅 %", color: "#475569" },
          ticks: { color: "#64748b", callback: (v) => `${v}%` },
          grid,
        },
        y: { title: { display: true, text: "均价", color: "#475569" }, ticks: { color: "#64748b" }, grid },
      },
    },
  });
  renderChartLegend();
}

function renderTableSummary(bodyId, summaryId, rows, summaryPrefix = "") {
  document.getElementById(bodyId).innerHTML = rows.map(referenceRowHtml).join("");
  const last = rows[rows.length - 1];
  if (!last) {
    document.getElementById(summaryId).innerHTML = "";
    return;
  }
  const m = rowMeta(last);
  document.getElementById(summaryId).innerHTML =
    `${summaryPrefix}${formatShares(m.cumulativeShares)} 股 · 均价 <strong>${m.avgCost.toFixed(4)}</strong> · 累计 ${formatMoney(m.cumulativeSpent)} · 盈亏 ${formatPlCell(m.pl, m.cumulativeSpent)}`;
}

function renderDiscrete(discrete) {
  renderTableSummary(
    "discrete-body",
    "discrete-summary",
    discrete.stepDetails.map((d) => ({
      dropPct: d.dropPct,
      price: d.price,
      incrementalSpent: d.spent,
      incrementalShares: d.shares,
      cumulativeSpent: d.cumulativeSpent,
      cumulativeShares: d.cumulativeShares,
    }))
  );
}

function renderContinuous(schedule) {
  renderTableSummary("continuous-body", "continuous-summary", schedule.rows, "满仓：");
}

function renderFitBuyPrimary(rec) {
  const el = document.getElementById("buy-action");
  if (!el) return;
  const { line = {}, sharesHeldBefore: Q0 = 0, costBasisBefore: S0 = 0, fitTargetAvg: A } = rec;

  if (line.feasible && line.sharesToBuy > 1e-9) {
    el.innerHTML =
      `<strong>${formatShares(line.sharesToBuy)}</strong> 股 · <strong>${formatMoney(line.cashNeeded)}</strong>`;
    return;
  }
  const msgs = {
    zero_target_above_price: `<p class="si-buy-msg">高于拟合 <strong>${formatAvg(A)}</strong></p>`,
    zero_target_below_price: `<p class="si-buy-msg">低于拟合 <strong>${formatAvg(A)}</strong></p>`,
    zero_price_matches_target: `<span class="xc-muted">现价≈拟合</span>`,
    already_at_or_better: `<span class="xc-muted">均价已≤拟合</span>`,
    aligned: `<span class="xc-muted">已对齐</span>`,
  };
  if (msgs[line.reason]) {
    el.innerHTML = msgs[line.reason];
    return;
  }
  if (Q0 === 0 && S0 === 0 && A > rec.currentPrice + 1e-6) el.innerHTML = msgs.zero_target_above_price;
  else if (Q0 === 0 && S0 === 0 && A < rec.currentPrice - 1e-6) el.innerHTML = msgs.zero_target_below_price;
  else el.innerHTML = `<span class="xc-muted">无法补仓</span>`;
}

function renderShareCatchUpLine(shareRec) {
  const el = document.getElementById("buy-action-shares");
  if (!el) return;
  if (shareRec.sharesToBuy <= 1e-9) {
    el.innerHTML =
      shareRec.targetCumulativeShares > 0
        ? `<span class="xc-muted">已达 ${formatShares(shareRec.targetCumulativeShares)} 股</span>`
        : `<span class="xc-muted">已达累计</span>`;
    return;
  }
  el.innerHTML =
    `<span class="xc-muted">${formatShares(shareRec.sharesToBuy)} 股 · ${formatMoney(shareRec.cashNeeded)}` +
    ` · 目标 ${formatShares(shareRec.targetCumulativeShares)} 股</span>`;
}

function renderBuy(rec, shareRec) {
  document.getElementById("buy-current-avg").textContent = rec.sharesHeldBefore > 0 ? rec.currentAvg.toFixed(4) : "—";
  document.getElementById("buy-plan-avg").textContent = formatAvg(rec.fitTargetAvg);
  renderFitBuyPrimary(rec);
  if (shareRec) renderShareCatchUpLine(shareRec);
}

function addStepRow(weight = 25, drop = 0) {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td><input type="number" class="step-weight" min="0" max="100" step="0.1" value="${weight}" /></td><td><input type="number" class="step-drop" min="0" max="99" step="0.1" value="${drop}" /></td><td><button type="button" class="xc-btn-icon remove-step" title="Remove">×</button></td>`;
  document.getElementById("steps-body").appendChild(tr);
  tr.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", recalculate));
  tr.querySelector(".remove-step").addEventListener("click", () => {
    tr.remove();
    recalculate();
  });
}

function init() {
  (loadState() || DEFAULT_STEPS).forEach((s) => addStepRow(s.weightPct, s.dropPct));
  document.getElementById("add-step").addEventListener("click", () => addStepRow(25, 15));
  document.getElementById("reset-position").addEventListener("click", () => {
    document.getElementById("shares-held").value = 0;
    document.getElementById("avg-cost-held").value = "";
    syncAvgCostHeldField();
    recalculate();
  });
  ["initial-price", "total-budget", "current-price-input", "shares-held", "avg-cost-held"].forEach((id) => {
    document.getElementById(id).addEventListener("input", recalculate);
  });
  recalculate();
}

function recalculate() {
  try {
    renderError("");
    syncAvgCostHeldField();
    const { initialPrice, totalBudget, steps } = readInputs();
    validateStrategy(steps);
    const schedule = buildContinuousSchedule(initialPrice, totalBudget, steps);
    renderAvgChart(schedule);
    renderDiscrete(schedule.discrete);
    renderContinuous(schedule);
    const { currentPrice, dropPct } = readCurrentPriceFromDom();
    const position = readPositionFromDom();
    renderBuy(
      recommendBuyFromSchedule(schedule, dropPct, position, currentPrice),
      recommendBuyShareCatchUpFromSchedule(schedule, dropPct, position)
    );
    saveState();
  } catch (e) {
    renderError(e.message);
  }
}

document.addEventListener("DOMContentLoaded", init);
