import {
  HORIZONS,
  REFERENCE_ROWS,
  biasHint,
  buildCurve,
  buildHitTimeCurve,
  buildTriggerDistribution,
  expectedTriggers,
  firstHitDensity,
  formatPct,
  touchProbability,
} from "./engine.js?v=6";

const STORAGE_KEY = "priceTargetSigma";
const MAX_K = 2.5;
const MAX_YEARS = 2;

const slider = document.getElementById("sigma-slider");
const sigmaOut = document.getElementById("sigma-value");
const refBody = document.getElementById("ref-body");
const probEls = Object.fromEntries(
  HORIZONS.map((h) => [h.id, document.getElementById(`prob-${h.id}`)])
);
const biasEl = document.getElementById("bias-hint");
const biasLabel = document.getElementById("bias-label");
const biasDetail = document.getElementById("bias-detail");
const triggerExpectedEl = document.getElementById("trigger-expected");

const TRIGGER_COLOR = "#3dd68c";
const TRIGGER_MAX_N = 12;

function loadSigma() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const v = parseFloat(raw);
  if (Number.isFinite(v) && v >= 0.05 && v <= MAX_K) return v;
  return 1;
}

function saveSigma(k) {
  localStorage.setItem(STORAGE_KEY, String(k));
}

function formatSigma(k) {
  return `${k.toFixed(2)}σ`;
}

function nearestRefIndex(k) {
  let best = 0;
  let bestDist = Infinity;
  REFERENCE_ROWS.forEach((row, i) => {
    const d = Math.abs(row.k - k);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return bestDist <= 0.06 ? best : -1;
}

function renderTable(activeK) {
  const activeIdx = nearestRefIndex(activeK);
  refBody.innerHTML = REFERENCE_ROWS.map((row, i) => {
    const cells = HORIZONS.map(
      (h) => `<td>${formatPct(touchProbability(row.k, h.years))}</td>`
    ).join("");
    const active = i === activeIdx ? ' class="pt-row-active"' : "";
    return `<tr${active}>
      <td><span class="pt-k">${row.k.toFixed(2)}σ</span><span class="pt-k-label">${row.label}</span></td>
      ${cells}
    </tr>`;
  }).join("");
}

function chartTextStyle() {
  return {
    legend: {
      display: false,
    },
  };
}

function timeAxis() {
  return {
    type: "linear",
    min: 0,
    max: MAX_YEARS,
    title: {
      display: true,
      text: "时间（年）",
      color: "#64748b",
      font: { size: 11 },
    },
    ticks: {
      color: "#64748b",
      callback: (v) => `${Number(v).toFixed(1)}`,
    },
    grid: { color: "rgba(148, 163, 184, 0.25)" },
  };
}

function horizonMarkerPlugin(getY) {
  return {
    id: "horizonMarkers",
    afterDatasetsDraw(chart) {
      const { ctx: c, chartArea, scales } = chart;
      if (!chartArea) return;
      const k = chart.$currentK;
      if (k == null) return;

      c.save();
      for (const h of HORIZONS) {
        const x = scales.x.getPixelForValue(h.years);
        const y = scales.y.getPixelForValue(getY(k, h.years));

        c.strokeStyle = h.color;
        c.globalAlpha = 0.45;
        c.lineWidth = 1.25;
        c.setLineDash([3, 3]);
        c.beginPath();
        c.moveTo(x, chartArea.top);
        c.lineTo(x, chartArea.bottom);
        c.stroke();
        c.setLineDash([]);

        c.globalAlpha = 1;
        c.beginPath();
        c.fillStyle = h.color;
        c.arc(x, y, 4.5, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = "#fff";
        c.lineWidth = 1.5;
        c.stroke();

        c.fillStyle = h.color;
        c.font = "10px system-ui, sans-serif";
        c.textAlign = "center";
        c.fillText(h.label, x, chartArea.top + 11);
      }
      c.restore();
    },
  };
}

function createCompareChart() {
  const curve = buildCurve(MAX_K, 120);
  const ctx = document.getElementById("prob-chart");

  return new Chart(ctx, {
    type: "line",
    data: {
      datasets: HORIZONS.map((h) => ({
        label: h.label,
        data: curve.map((p) => ({ x: p.k, y: p[h.id] * 100 })),
        borderColor: h.color,
        backgroundColor: h.color,
        fill: false,
        tension: 0.15,
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 2.25,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 },
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        legend: {
          labels: {
            color: "#334155",
            boxWidth: 12,
            boxHeight: 12,
            font: { size: 11 },
          },
        },
        tooltip: {
          callbacks: {
            title: (items) => {
              const k = items[0]?.parsed?.x;
              return Number.isFinite(k) ? `${k.toFixed(2)}σ` : "";
            },
            label: (item) =>
              ` ${item.dataset.label}: ${Number(item.parsed.y).toFixed(1)}%`,
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          min: 0,
          max: MAX_K,
          title: {
            display: true,
            text: "目标 kσ",
            color: "#64748b",
            font: { size: 11 },
          },
          ticks: {
            color: "#64748b",
            maxTicksLimit: 6,
            callback: (v) => `${Number(v).toFixed(1)}`,
          },
          grid: { color: "rgba(148, 163, 184, 0.25)" },
        },
        y: {
          min: 0,
          max: 100,
          title: {
            display: true,
            text: "触及概率 %",
            color: "#64748b",
            font: { size: 11 },
          },
          ticks: {
            color: "#64748b",
            callback: (v) => `${v}%`,
          },
          grid: { color: "rgba(148, 163, 184, 0.25)" },
        },
      },
    },
    plugins: [
      {
        id: "currentSigmaMarker",
        afterDatasetsDraw(chart) {
          const { ctx: c, chartArea, scales } = chart;
          const k = chart.$currentK;
          if (k == null || !chartArea) return;
          const x = scales.x.getPixelForValue(k);

          c.save();
          c.strokeStyle = "rgba(201, 123, 58, 0.85)";
          c.lineWidth = 1.5;
          c.setLineDash([4, 4]);
          c.beginPath();
          c.moveTo(x, chartArea.top);
          c.lineTo(x, chartArea.bottom);
          c.stroke();
          c.setLineDash([]);

          for (const h of HORIZONS) {
            const y = scales.y.getPixelForValue(
              touchProbability(k, h.years) * 100
            );
            c.beginPath();
            c.fillStyle = h.color;
            c.arc(x, y, 4.5, 0, Math.PI * 2);
            c.fill();
            c.strokeStyle = "#fff";
            c.lineWidth = 1.5;
            c.stroke();
          }
          c.restore();
        },
      },
    ],
  });
}

function createPdfChart() {
  return new Chart(document.getElementById("pdf-chart"), {
    type: "line",
    data: {
      datasets: [
        {
          label: "首次触及密度",
          data: [],
          borderColor: "#c97b3a",
          backgroundColor: "rgba(201, 123, 58, 0.18)",
          fill: true,
          tension: 0.2,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 },
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        ...chartTextStyle(),
        tooltip: {
          callbacks: {
            title: (items) => {
              const t = items[0]?.parsed?.x;
              return Number.isFinite(t) ? `t = ${t.toFixed(2)} 年` : "";
            },
            label: (item) => ` 密度: ${Number(item.parsed.y).toFixed(3)}`,
          },
        },
      },
      scales: {
        x: timeAxis(),
        y: {
          type: "linear",
          min: 0,
          max: 1,
          title: {
            display: true,
            text: "密度",
            color: "#c97b3a",
            font: { size: 11 },
          },
          ticks: { color: "#c97b3a" },
          grid: { color: "rgba(148, 163, 184, 0.25)" },
        },
      },
    },
    plugins: [horizonMarkerPlugin((k, t) => firstHitDensity(k, t))],
  });
}

function createCdfChart() {
  return new Chart(document.getElementById("cdf-chart"), {
    type: "line",
    data: {
      datasets: [
        {
          label: "累计触及概率",
          data: [],
          borderColor: "#3d8bfd",
          backgroundColor: "rgba(61, 139, 253, 0.16)",
          fill: true,
          tension: 0.2,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 2.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 },
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        ...chartTextStyle(),
        tooltip: {
          callbacks: {
            title: (items) => {
              const t = items[0]?.parsed?.x;
              return Number.isFinite(t) ? `t = ${t.toFixed(2)} 年` : "";
            },
            label: (item) => ` 累计: ${(Number(item.parsed.y) * 100).toFixed(1)}%`,
          },
        },
      },
      scales: {
        x: timeAxis(),
        y: {
          type: "linear",
          min: 0,
          max: 1,
          title: {
            display: true,
            text: "累计",
            color: "#3d8bfd",
            font: { size: 11 },
          },
          ticks: {
            color: "#3d8bfd",
            callback: (v) => Number(v).toFixed(1),
          },
          grid: { color: "rgba(148, 163, 184, 0.25)" },
        },
      },
    },
    plugins: [horizonMarkerPlugin((k, t) => touchProbability(k, t))],
  });
}

function triggerLabel(bar) {
  return bar.overflow ? `${bar.n - 1}+` : String(bar.n);
}

function createTriggerChart() {
  return new Chart(document.getElementById("trigger-chart"), {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "触发次数概率",
          data: [],
          borderColor: TRIGGER_COLOR,
          backgroundColor: "rgba(61, 214, 140, 0.18)",
          fill: true,
          tension: 0.25,
          pointRadius: 3.5,
          pointHoverRadius: 5,
          pointBackgroundColor: TRIGGER_COLOR,
          pointBorderColor: "#fff",
          pointBorderWidth: 1.5,
          borderWidth: 2.25,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        ...chartTextStyle(),
        tooltip: {
          callbacks: {
            title: (items) => `${items[0]?.label ?? ""} 次 / 年`,
            label: (item) => ` 概率: ${(Number(item.parsed.y)).toFixed(1)}%`,
          },
        },
      },
      scales: {
        x: {
          type: "category",
          title: {
            display: true,
            text: "全年触发次数 n",
            color: "#64748b",
            font: { size: 11 },
          },
          ticks: { color: "#64748b" },
          grid: { color: "rgba(148, 163, 184, 0.25)" },
        },
        y: {
          type: "linear",
          min: 0,
          title: {
            display: true,
            text: "概率 %",
            color: TRIGGER_COLOR,
            font: { size: 11 },
          },
          ticks: {
            color: TRIGGER_COLOR,
            callback: (v) => `${v}%`,
          },
          grid: { color: "rgba(148, 163, 184, 0.25)" },
        },
      },
    },
  });
}

function updateTriggerChart(k) {
  const bars = buildTriggerDistribution(k, 1, TRIGGER_MAX_N);
  triggerChart.data.labels = bars.map(triggerLabel);
  triggerChart.data.datasets[0].data = bars.map((b) => b.p * 100);
  const maxPct = Math.max(...bars.map((b) => b.p), 0) * 100;
  triggerChart.options.scales.y.max = Math.min(
    100,
    Math.max(10, Math.ceil((maxPct * 1.12) / 10) * 10)
  );
  triggerChart.update("none");

  const mean = expectedTriggers(k, 1);
  triggerExpectedEl.textContent = Number.isFinite(mean) ? mean.toFixed(2) : "—";
}

function updateHitCharts(k) {
  const curve = buildHitTimeCurve(k, MAX_YEARS, 160);
  const pdfSeries = curve.map((p) => ({ x: p.t, y: p.density }));
  const cdfSeries = curve.map((p) => ({ x: p.t, y: p.cdf }));
  const maxPdf = Math.max(...pdfSeries.map((p) => p.y), 0);

  // PDF is density (per year), not probability — can exceed 1; only CDF is in [0,1].
  pdfChart.options.scales.y.max = Math.max(1, maxPdf * 1.08);
  pdfChart.data.datasets[0].data = pdfSeries;
  pdfChart.$currentK = k;
  pdfChart.update("none");

  cdfChart.data.datasets[0].data = cdfSeries;
  cdfChart.$currentK = k;
  cdfChart.update("none");
}

const compareChart = createCompareChart();
const pdfChart = createPdfChart();
const cdfChart = createCdfChart();
const triggerChart = createTriggerChart();

function update(k) {
  slider.value = String(k);
  slider.setAttribute("aria-valuenow", String(k));
  sigmaOut.textContent = formatSigma(k);
  for (const h of HORIZONS) {
    probEls[h.id].textContent = formatPct(touchProbability(k, h.years));
  }
  const hint = biasHint(k);
  biasEl.dataset.lean = hint.lean;
  biasLabel.textContent = hint.label;
  biasDetail.textContent = hint.detail;
  renderTable(k);
  compareChart.$currentK = k;
  compareChart.update("none");
  updateTriggerChart(k);
  updateHitCharts(k);
  saveSigma(k);
}

slider.addEventListener("input", () => {
  update(parseFloat(slider.value));
});

update(loadSigma());
