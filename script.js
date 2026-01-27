import { simulateRolling, simulateFixed } from './simulation.js';

const DEFAULTS = { maturity: 30, currentFFR: 4.5, midFFR: 3.0, endFFR: 2.5, current30y: 4.7, fixedUseFFR: true, fixedCompoundRate: 4.7, volatility: 0.15, rollPeriod: 10, initialInvestment: 10000 };
const NUM_INPUTS = ['maturity', 'currentFFR', 'midFFR', 'endFFR', 'current30y', 'fixedCompoundRate', 'volatility', 'rollPeriod', 'initialInvestment'];
const STORAGE_KEY = 'bondSimInputs';

const formatCurrency = v => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatPercent = v => `${v.toFixed(2)}%`;
const formatNum = v => v.toFixed(2);
const getInput = id => { const el = document.getElementById(id); return el ? +el.value : 0; };
const setInput = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
const getCheckbox = id => document.getElementById(id)?.checked ?? false;
const setCheckbox = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };

const updateFixedRateState = () => {
    const useFFR = getCheckbox('fixedUseFFR');
    const input = document.getElementById('fixedCompoundRate');
    if (input) {
        input.disabled = useFFR;
        // When switching to manual, default to current 30y rate
        if (!useFFR && input.value === '') {
            input.value = getInput('current30y');
        }
    }
};

const loadInputs = () => {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    NUM_INPUTS.forEach(id => setInput(id, saved[id] ?? DEFAULTS[id]));
    setCheckbox('fixedUseFFR', saved.fixedUseFFR ?? DEFAULTS.fixedUseFFR);
    // Default fixedCompoundRate to current30y if not saved
    if (!saved.fixedCompoundRate) {
        setInput('fixedCompoundRate', saved.current30y ?? DEFAULTS.current30y);
    }
    updateFixedRateState();
};

const saveInputs = () => {
    const values = Object.fromEntries(NUM_INPUTS.map(id => [id, getInput(id)]));
    values.fixedUseFFR = getCheckbox('fixedUseFFR');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
};

const resetInputs = () => {
    localStorage.removeItem(STORAGE_KEY);
    NUM_INPUTS.forEach(id => setInput(id, DEFAULTS[id]));
    setCheckbox('fixedUseFFR', DEFAULTS.fixedUseFFR);
    // Reset fixedCompoundRate to match current30y default
    setInput('fixedCompoundRate', DEFAULTS.current30y);
    updateFixedRateState();
    run();
};

const updateResults = (rolling, fixed, investment, mc = false, n = 0) => {
    document.getElementById('rollingValue').textContent = formatCurrency(rolling);
    document.getElementById('fixedValue').textContent = formatCurrency(fixed);
    const diff = rolling - fixed;
    document.getElementById('difference').textContent = `${formatCurrency(diff)} (${diff >= 0 ? '+' : ''}${formatPercent(diff / fixed * 100)})`;
    const suffix = mc ? ` (${n} sims)` : '';
    document.getElementById('rollingReturn').textContent = `Return: ${formatPercent((rolling / investment - 1) * 100)}${suffix}`;
    document.getElementById('fixedReturn').textContent = `Return: ${formatPercent((fixed / investment - 1) * 100)}${suffix}`;
    document.getElementById('results').style.display = 'grid';
};

const updateChart = (rolling, fixed) => {
    const canvas = document.getElementById('chart');
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();
    
    const years = rolling.values.map((_, i) => i);
    
    new Chart(canvas, {
        type: 'line',
        data: {
            labels: years,
            datasets: [
                { label: 'Rolling ($)', data: rolling.values, borderColor: '#3498db', borderWidth: 2, pointRadius: 0, tension: 0.3 },
                { label: 'Fixed ($)', data: fixed.values, borderColor: '#9b59b6', borderWidth: 2, pointRadius: 0, tension: 0.3 },
                { label: 'FFR (%)', data: rolling.ffr, borderColor: '#27ae60', borderWidth: 2, borderDash: [2, 2], yAxisID: 'y1', pointRadius: 0 },
                { label: '30y Rate (%)', data: rolling.rates, borderColor: '#e74c3c', borderWidth: 2, borderDash: [5, 5], yAxisID: 'y1', pointRadius: 0 },
                { label: 'Roll', data: years.map(y => rolling.transactions.find(t => t.year === y && t.sold)?.nav ?? null),
                  pointRadius: 6, pointBackgroundColor: '#f1c40f', showLine: false }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            interaction: { mode: 'index', intersect: false, axis: 'x' },
            plugins: {
                title: { display: true, text: 'Rolling vs Fixed Bond Strategy', font: { size: 18 } },
                tooltip: { animation: { duration: 0 } },
                crosshair: { line: { color: '#555', width: 1, dashPattern: [5, 5] }, zoom: { enabled: false } }
            },
            scales: {
                y: { title: { display: true, text: 'Value ($)' }, ticks: { callback: v => '$' + v.toLocaleString() } },
                y1: { position: 'right', title: { display: true, text: 'Rate (%)' }, grid: { drawOnChartArea: false }, ticks: { callback: v => v.toFixed(1) + '%' } },
                x: { title: { display: true, text: 'Years' } }
            }
        }
    });
};

const updateTable = (transactions) => {
    const tbody = document.getElementById('txTable');
    let html = '';
    for (const t of transactions) {
        const cls = t.sold ? 'roll-row' : '';
        const sold = t.sold ? `${formatNum(t.sold.units)} × ${t.sold.maturity}y @${formatPercent(t.sold.coupon)}` : '-';
        const saleVal = t.sold ? `${formatCurrency(t.sold.saleValue)} + ${formatCurrency(t.sold.couponReceived)} coupon` : '-';
        const bought = t.bought ? `${formatNum(t.bought.units)} × ${t.bought.maturity}y @${formatPercent(t.bought.coupon)}` : '-';
        html += `<tr class="${cls}"><td>${t.year}</td><td>${formatPercent(t.ffr)}</td><td>${formatPercent(t.rate)}</td><td>${sold}</td><td>${saleVal}</td><td>${bought}</td><td>${formatCurrency(t.nav)}</td></tr>`;
    }
    tbody.innerHTML = html;
};

const updateFixedTable = (couponDetails, compoundRates, investment) => {
    const tbody = document.getElementById('fixedTable');
    if (!tbody) return;
    let html = '';
    let total = investment; // face value
    const isConstant = typeof compoundRates === 'number';
    for (const c of couponDetails) {
        total += c.compounded;
        const rate = isConstant ? compoundRates : compoundRates[c.year];
        html += `<tr><td>${c.year}</td><td>${formatPercent(rate)}</td><td>${formatCurrency(c.coupon)}</td><td>${formatCurrency(c.compounded)}</td></tr>`;
    }
    html += `<tr class="total-row"><td colspan="3"><strong>Face Value + Total</strong></td><td><strong>${formatCurrency(total)}</strong></td></tr>`;
    tbody.innerHTML = html;
};

const run = () => {
    saveInputs();
    const [investment, startFFR, midFFR, endFFR, rate30y, fixedRate, vol, maxMat, range] = 
        ['initialInvestment', 'currentFFR', 'midFFR', 'endFFR', 'current30y', 'fixedCompoundRate', 'volatility', 'maturity', 'rollPeriod'].map(getInput);
    const useFFR = getCheckbox('fixedUseFFR');
    const minMat = maxMat - range;
    const rolling = simulateRolling(investment, startFFR, midFFR, endFFR, rate30y, vol, maxMat, maxMat, minMat);
    const compoundRates = useFFR ? rolling.ffr : fixedRate;
    const fixed = simulateFixed(investment, rate30y, maxMat, compoundRates);
    updateResults(rolling.values.at(-1), fixed.finalValue, investment);
    updateChart(rolling, fixed);
    updateTable(rolling.transactions);
    updateFixedTable(fixed.couponDetails, compoundRates, investment);
};

const runMonteCarlo = () => {
    saveInputs();
    const [investment, startFFR, midFFR, endFFR, rate30y, fixedRate, vol, maxMat, range] = 
        ['initialInvestment', 'currentFFR', 'midFFR', 'endFFR', 'current30y', 'fixedCompoundRate', 'volatility', 'maturity', 'rollPeriod'].map(getInput);
    const useFFR = getCheckbox('fixedUseFFR');
    const minMat = maxMat - range;
    const n = 100;
    const results = Array.from({ length: n }, () => {
        const r = simulateRolling(investment, startFFR, midFFR, endFFR, rate30y, vol, maxMat, maxMat, minMat);
        const compoundRates = useFFR ? r.ffr : fixedRate;
        const f = simulateFixed(investment, rate30y, maxMat, compoundRates);
        return { rolling: r.values.at(-1), fixed: f.finalValue };
    });
    const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    updateResults(avg(results.map(r => r.rolling)), avg(results.map(r => r.fixed)), investment, true, n);
    const rolling = simulateRolling(investment, startFFR, midFFR, endFFR, rate30y, vol, maxMat, maxMat, minMat);
    const compoundRates = useFFR ? rolling.ffr : fixedRate;
    const fixed = simulateFixed(investment, rate30y, maxMat, compoundRates);
    updateChart(rolling, fixed);
    updateTable(rolling.transactions);
    updateFixedTable(fixed.couponDetails, compoundRates, investment);
};

document.getElementById('runBtn').addEventListener('click', run);
document.getElementById('monteCarloBtn').addEventListener('click', runMonteCarlo);
document.getElementById('resetBtn').addEventListener('click', resetInputs);
document.getElementById('fixedUseFFR').addEventListener('change', updateFixedRateState);
window.addEventListener('load', () => { loadInputs(); run(); });
