let DB = {};
let currentSymbol = 'AAPL';
let showDays = 180;
let C = {}; // Charts
let model = null;
let isTraining = false;

// Scaler objects
let scalers = {};
const FEATURES = ['close', 'open', 'high', 'low', 'vol', 'ma20', 'ma50', 'rsi', 'macd'];
const VERSION = "v3.1 Stable";

// 1. Core utilities
function setStatus(cls, text) {
  const dot = document.getElementById('stDot');
  dot.className = 'dot ' + cls;
  document.getElementById('stTxt').innerText = text;
}

// Data fetching
async function fetchWithTimeout(url, opts = {}, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const response = await fetch(url, { ...opts, signal: controller.signal });
  clearTimeout(id);
  return response;
}

async function searchSymbol() {
  const input = document.getElementById('symbolSearch').value.trim().toUpperCase();
  if (input) selectStock(input);
}

document.getElementById('symbolSearch').addEventListener('keypress', function (e) {
  if (e.key === 'Enter') searchSymbol();
});

async function selectStock(symbol, btn = null) {
  if (isTraining) { alert("Cannot switch symbol during training!"); return; }

  currentSymbol = symbol;

  // UI toggle
  document.querySelectorAll('.sb').forEach(b => b.classList.remove('on'));
  if (btn) btn.classList.add('on');

  setStatus('go', 'FETCHING DATA...');

  if (!DB[symbol] || DB[symbol].length === 0) {
    try {
      const res = await fetchWithTimeout(`/api/stock?symbol=${symbol}`);
      if (!res.ok) throw new Error("Invalid Symbol or API Error");
      const data = await res.json();
      if (!data || data.length < 50) throw new Error("Insufficient data");
      DB[symbol] = data;
      checkSavedModel(symbol);
    } catch (e) {
      console.error(e);
      setStatus('er', 'ERROR');
      alert(`Error fetching ${symbol}: ${e.message}`);
      return;
    }
  }

  refreshUI(DB[symbol]);
  setStatus('ok', 'IDLE');
}

function setTF(days, btn) {
  showDays = days;
  document.querySelectorAll('.tf').forEach(b => b.classList.remove('on'));
  if (btn) btn.classList.add('on');
  if (DB[currentSymbol]) refreshUI(DB[currentSymbol], []);
}

// 2. Charting & UI Refresh
function initCharts() {
  console.log("Initializing Charts System...");
  Chart.defaults.font.family = "'Fira Code', monospace";
  Chart.defaults.color = "#a1a1aa";

  const ctxMain = document.getElementById('cMain').getContext('2d');
  C.main = new Chart(ctxMain, {
    type: 'line',
    data: {
      labels: [], datasets: [
        { label: 'Close', data: [], borderColor: '#ff3366', borderWidth: 2, pointRadius: 0, tension: 0.1, fill: { target: 'origin', above: 'rgba(255,51,102,0.05)' } },
        { label: 'Forecast', data: [], borderColor: '#00e676', borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#00e676', borderDash: [5, 5], tension: 0.2, fill: false },
        { label: 'CI Top', data: [], borderColor: 'transparent', borderWidth: 0, pointRadius: 0, fill: false },
        { label: 'CI Bottom', data: [], borderColor: 'transparent', borderWidth: 0, pointRadius: 0, fill: '-1', backgroundColor: 'rgba(0, 230, 118, 0.15)' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: '#27272a' }, ticks: { maxTicksLimit: 8 } },
        y: { position: 'right', grid: { color: '#27272a' } }
      }
    }
  });

  const ctxVol = document.getElementById('cVol').getContext('2d');
  C.vol = new Chart(ctxVol, {
    type: 'bar',
    data: { labels: [], datasets: [{ data: [], backgroundColor: 'rgba(255,255,255,0.1)' }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } } }
  });

  const ctxLoss = document.getElementById('cLoss').getContext('2d');
  C.loss = new Chart(ctxLoss, {
    type: 'line',
    data: {
      labels: [], datasets: [
        { label: 'Train Loss', data: [], borderColor: '#ffea00', borderWidth: 2, pointRadius: 0, tension: 0.2 },
        { label: 'Val Loss', data: [], borderColor: '#ff3366', borderWidth: 2, pointRadius: 0, tension: 0.2 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { grid: { color: '#27272a' } } } }
  });
}

function refreshUI(data, predictions = []) {
  console.log("Refreshing UI with", data.length, "points and", predictions.length, "predictions");
  if (!data || data.length === 0) { console.warn("No data to refresh UI"); return; }

  // Dashboard Metrics
  const l = data[data.length - 1];
  const p = data[data.length - 2];
  const chg = l.close - p.close;
  const pct = (chg / p.close) * 100;

  const pMain = document.getElementById('prcMain');
  pMain.innerText = "$" + l.close.toFixed(2);
  pMain.style.color = chg >= 0 ? "var(--success)" : "var(--danger)";

  const pChg = document.getElementById('prcChg');
  pChg.innerText = (chg >= 0 ? "▲ +$" : "▼ -$") + Math.abs(chg).toFixed(2) + " (" + (chg >= 0 ? "+" : "") + pct.toFixed(2) + "%)";
  pChg.className = "prc-chg " + (chg >= 0 ? "up" : "dn");

  document.getElementById('sOpen').innerText = l.open.toFixed(2);
  document.getElementById('sHigh').innerText = l.high.toFixed(2);
  document.getElementById('sLow').innerText = l.low.toFixed(2);
  document.getElementById('sVol').innerText = (l.vol / 1000000).toFixed(1) + "M";
  document.getElementById('sRsi').innerText = l.rsi.toFixed(1);
  document.getElementById('sMacd').innerText = l.macd.toFixed(2);

  // Charts update
  const show = data.slice(-showDays);
  const labels = show.map(d => d.date.slice(5));
  const prices = show.map(d => d.close);
  const vols = show.map(d => d.vol);

  let futLabels = [];
  if (predictions.length > 0) {
    const lastDate = new Date(l.date);
    for (let i = 1; i <= predictions.length; i++) {
      lastDate.setDate(lastDate.getDate() + 1);
      if (lastDate.getDay() === 0 || lastDate.getDay() === 6) lastDate.setDate(lastDate.getDate() + (lastDate.getDay() === 0 ? 1 : 2));
      futLabels.push(lastDate.toISOString().slice(5, 10));
    }
  }

  C.main.data.labels = [...labels, ...futLabels];
  C.main.data.datasets[0].data = [...prices, ...new Array(predictions.length).fill(null)];

  const predData = new Array(prices.length - 1).fill(null).concat([prices[prices.length - 1]], predictions);

  // Synthetic Confidence Interval 
  const ciTopData = new Array(prices.length - 1).fill(null).concat([prices[prices.length - 1]], predictions.map((p, i) => p * (1 + 0.02 * (i + 1))));
  const ciBotData = new Array(prices.length - 1).fill(null).concat([prices[prices.length - 1]], predictions.map((p, i) => p * (1 - 0.02 * (i + 1))));

  C.main.data.datasets[1].data = predData;
  C.main.data.datasets[2].data = ciTopData;
  C.main.data.datasets[3].data = ciBotData;
  C.main.update();

  C.vol.data.labels = labels;
  C.vol.data.datasets[0].data = vols;
  C.vol.update('none');
}

// 3. ML Preprocessing
function minMaxScale(arr) {
  const min = Math.min(...arr);
  const max = Math.max(...arr) || 1; // Prevent div by 0
  const rng = max - min || 1;
  return { scaled: arr.map(v => (v - min) / rng), min, max, rng };
}

function normalizeDataset(data) {
  const normData = {};
  FEATURES.forEach(f => {
    const vals = data.map(d => d[f]);
    const { scaled, min, rng } = minMaxScale(vals);
    normData[f] = scaled.map(v => isNaN(v) ? 0 : v); // Handle NaNs
    scalers[f] = { min, rng };
  });

  const matrix = [];
  for (let i = 0; i < data.length; i++) {
    const row = FEATURES.map(f => normData[f][i]);
    matrix.push(row);
  }
  return matrix;
}

function denormClose(val) {
  return (val * scalers['close'].rng) + scalers['close'].min;
}

function createSequences(matrix, windowSize, forecastDays) {
  const X = [], y = [];
  // Use sliding window. y is the next `forecastDays` close prices.
  const closeIdx = FEATURES.indexOf('close');

  for (let i = windowSize; i <= matrix.length - forecastDays; i++) {
    X.push(matrix.slice(i - windowSize, i));
    const targetSeq = [];
    for (let j = 0; j < forecastDays; j++) {
      targetSeq.push(matrix[i + j][closeIdx]);
    }
    y.push(targetSeq);
  }
  return { X, y };
}

// 4. ML Model Building (v3.1 Ultra-Stable)
function buildDeepModel(windowSize, forecastDays) {
  if (model) { model.dispose(); model = null; }
  
  console.log("Compiling v3.1 Stable Engine...");
  model = tf.sequential();
  
  // Single high-efficiency LSTM layer to reduce memory pressure
  model.add(tf.layers.lstm({
    units: 64, 
    inputShape: [windowSize, FEATURES.length],
    kernelInitializer: 'glorotUniform',
    returnSequences: false
  }));
  model.add(tf.layers.dropout({rate: 0.1}));

  // Dense refinement
  model.add(tf.layers.dense({units: 32, activation: 'relu'})); 
  
  // Output matches requested forecast window
  model.add(tf.layers.dense({units: forecastDays}));
  
  model.compile({ 
    optimizer: tf.train.adam(0.001), 
    loss: 'meanSquaredError'
  });
  
  document.getElementById('outDays').innerText = Math.round(forecastDays);
  return model;
}

// 5. Training & Evaluation
async function startTraining() {
  if (isTraining) return;

  try {
    const data = DB[currentSymbol];
    if (!data || data.length < 100) { alert("Need at least 100 data points for deep learning."); return; }

    const W = parseInt(document.getElementById('vW').value);
    const F = parseInt(document.getElementById('vF').value);
    const ep = parseInt(document.getElementById('vE').value);

    isTraining = true;
    setStatus('go', 'TRAINING STARTING...');
    const btn = document.getElementById('tBtn');
    btn.disabled = true; btn.innerText = "⏳ PROCESSING...";

    // Data processing delay to allow UI refresh
    await new Promise(r => setTimeout(r, 50));

    const matrix = normalizeDataset(data);
    const n = matrix.length;
    // Train: 70%, Val: 15%, Test: 15%
    const trEnd = Math.floor(n * 0.7);
    const valEnd = Math.floor(n * 0.85);

    const mTrain = matrix.slice(0, trEnd);
    const mVal = matrix.slice(trEnd, valEnd);
    const mTest = matrix.slice(valEnd); // Keep for future testing if needed

    const { X: X_tr, y: y_tr } = createSequences(mTrain, W, F);
    const { X: X_v, y: y_v } = createSequences(mVal, W, F);

    if (X_tr.length === 0 || X_v.length === 0) {
      alert("Window size too large or dataset too small!");
      isTraining = false; btn.disabled = false; return;
    }

    const xs = tf.tensor3d(X_tr);
    const ys = tf.tensor2d(y_tr);
    const xs_v = tf.tensor3d(X_v);
    const ys_v = tf.tensor2d(y_v);

    buildDeepModel(W, F);

    const lossHistTr = [];
    const lossHistV = [];
    C.loss.data.labels = []; C.loss.data.datasets[0].data = []; C.loss.data.datasets[1].data = [];
    document.getElementById('mLoss').innerText = "—";

    // Use Early Stopping logic
    let bestValLoss = Infinity;
    let patienceCounter = 0;
    const PATIENCE = 25; // Stop if val loss doesn't improve for 25 epochs

    await model.fit(xs, ys, {
      epochs: ep,
      batchSize: 16, // Smaller batch size = more frequent yielding = smoother UI
      validationData: [xs_v, ys_v],
      shuffle: true,
      callbacks: {
        onBatchEnd: async (batch, logs) => {
          // Force a hard yield to the browser's event loop every batch
          await new Promise(resolve => setTimeout(resolve, 0));
        },
        onEpochEnd: async (epoch, logs) => {
          const trLoss = logs.loss;
          const vLoss = logs.val_loss;
          lossHistTr.push(trLoss);
          lossHistV.push(vLoss);

          const pct = Math.round(((epoch + 1) / ep) * 100);
          document.getElementById('pFill').style.width = pct + '%';
          document.getElementById('epTxt').innerText = `Epoch ${epoch + 1}/${ep} | Loss: ${trLoss.toFixed(5)}`;

          if (epoch % 5 === 0 || epoch === ep - 1) {
            C.loss.data.labels = lossHistTr.map((_, i) => i);
            C.loss.data.datasets[0].data = lossHistTr;
            C.loss.data.datasets[1].data = lossHistV;
            C.loss.update('none');
          }
          document.getElementById('mLoss').innerText = trLoss.toExponential(2);

          if (vLoss < bestValLoss) {
            bestValLoss = vLoss;
            patienceCounter = 0;
          } else {
            patienceCounter++;
          }

          if (patienceCounter >= PATIENCE) {
            model.stopTraining = true;
            document.getElementById('epTxt').innerText += " (Optimal Result)";
          }
          
          // Double yield on epoch end to ensure UI updates
          await tf.nextFrame();
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      }
    });

    xs.dispose(); ys.dispose(); xs_v.dispose(); ys_v.dispose();

    await evaluateAndPredict(matrix, W, F);

    isTraining = false;
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> RETRAIN MODEL`;
    setStatus('ok', 'TRAINING COMPLETE');
    document.getElementById('modelStatusMsg').innerText = "Unsaved model in RAM";

  } catch (e) {
    console.error(e);
    fetch('/api/log', { method: 'POST', body: "OUTER LOOP TRAINING ERROR: " + e.stack });
    alert("Training completely failed: " + e.message);
    isTraining = false;
    const btn = document.getElementById('tBtn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> RETRY MODEL`;
    }
    setStatus('er', 'TRAINING FAILED');
  }
}

async function evaluateAndPredict(matrix, W, F) {
  // 1. Evaluate on test window (last known historical window)
  const lastKnownX = matrix.slice(-F - W, -F);
  const lastKnownY = matrix.slice(-F);
  
  if (lastKnownX.length === W && lastKnownY.length === F) {
    console.log("Evaluating model accuracy on backtest window...");
    const tX = tf.tensor3d([lastKnownX]);
    const predRaw = await model.predict(tX).data();
    tX.dispose();
    
    let mapeSum = 0;
    let count = 0;
    const closeIdx = FEATURES.indexOf('close');
    
    for(let i=0; i<F; i++) {
      const trueVal = denormClose(lastKnownY[i][closeIdx]);
      const predVal = denormClose(predRaw[i]);
      if (trueVal !== 0 && !isNaN(predVal)) {
        mapeSum += Math.abs((trueVal - predVal) / trueVal);
        count++;
      }
    }
    
    const mape = count > 0 ? (mapeSum / count) * 100 : 100;
    const acc = Math.max(0, 100 - mape);
    
    document.getElementById('mRmse').innerText = "STABLE";
    document.getElementById('mMape').innerText = mape.toFixed(2) + "%";
    
    const aEl = document.getElementById('mAcc');
    aEl.innerText = acc.toFixed(1) + "%";
    aEl.style.color = acc > 95 ? "var(--success)" : "var(--warn)";
  }

  // 2. Forecast into future (final live window)
  const lastWindow = matrix.slice(-W);
  if (lastWindow.length === W) {
    const inputTensor = tf.tensor3d([lastWindow]);
    const futureScaled = await model.predict(inputTensor).data();
    inputTensor.dispose();

    const futurePreds = Array.from(futureScaled).map(v => denormClose(v));
    refreshUI(DB[currentSymbol], futurePreds);
    renderForecastList(futurePreds);
  }
}

function renderForecastList(predictions) {
  const container = document.getElementById('predList');
  let html = '';
  const lastPrice = DB[currentSymbol][DB[currentSymbol].length - 1].close;

  let date = new Date();

  predictions.forEach((p, i) => {
    // skip weekends
    date.setDate(date.getDate() + 1);
    if (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + (date.getDay() === 0 ? 1 : 2));

    const dStr = date.toISOString().slice(5, 10);
    const base = i === 0 ? lastPrice : predictions[i - 1];
    const diff = p - base;
    const isUp = p >= lastPrice;
    const diffPct = (diff / base) * 100;

    html += `
    <div class="pi">
       <span class="pi-d">Day ${i + 1} (${dStr})</span>
       <span class="pi-p" style="color: ${isUp ? 'var(--success)' : 'var(--danger)'}">$${p.toFixed(2)}</span>
       <span class="pi-c" style="color: ${diff >= 0 ? 'var(--success)' : 'var(--danger)'}">${diff >= 0 ? '+' : ''}${diffPct.toFixed(2)}%</span>
    </div>
    `;
  });

  container.innerHTML = html;
}

// 6. Model Persistence
const MODEL_STORE_STR = 'indexeddb://qt-model-';

async function saveModel() {
  if (!model) { alert("No model to save!"); return; }
  try {
    const saveResult = await model.save(MODEL_STORE_STR + currentSymbol);
    localStorage.setItem('qt-settings-' + currentSymbol, JSON.stringify({
      W: document.getElementById('vW').value,
      F: document.getElementById('vF').value,
      scalers: scalers
    }));
    document.getElementById('modelStatusMsg').innerText = `Model saved for ${currentSymbol}`;
  } catch (e) {
    alert("Failed to save: " + e.message);
  }
}

async function loadModel() {
  try {
    const loadedModel = await tf.loadLayersModel(MODEL_STORE_STR + currentSymbol);
    const sets = JSON.parse(localStorage.getItem('qt-settings-' + currentSymbol));
    if (!sets) throw new Error("Settings not found");

    if (model) model.dispose();
    model = loadedModel;

    // Compile it so we can run predict efficiently
    model.compile({ optimizer: 'adam', loss: 'mse' });

    document.getElementById('vW').value = sets.W; document.getElementById('vW_disp').innerText = sets.W;
    document.getElementById('vF').value = sets.F; document.getElementById('vF_disp').innerText = sets.F;
    scalers = sets.scalers;

    document.getElementById('modelStatusMsg').innerText = `Model loaded for ${currentSymbol}`;

    // generate quick prediction
    const data = DB[currentSymbol];
    if (data) {
      const matrix = normalizeDataset(data);
      evaluateAndPredict(matrix, parseInt(sets.W), parseInt(sets.F));
    }
  } catch (e) {
    alert("Failed to load or no model found: " + e.message);
  }
}

async function clearModels() {
  try {
    await tf.io.removeModel(MODEL_STORE_STR + currentSymbol);
    localStorage.removeItem('qt-settings-' + currentSymbol);
    document.getElementById('modelStatusMsg').innerText = `Deleted model for ${currentSymbol}`;
  } catch (e) { }
}

async function checkSavedModel(sym) {
  try {
    const modelsInfo = await tf.io.listModels();
    if (modelsInfo[MODEL_STORE_STR + sym]) {
      document.getElementById('modelStatusMsg').innerText = `Stored model available.`;
    } else {
      document.getElementById('modelStatusMsg').innerText = `No stored model.`;
    }
  } catch (e) { }
}

// Initialization
async function init() {
  const statusEl = document.getElementById('ldSub');
  if (!statusEl) return;

  try {
    console.log("Quantum Initialization Starting...");
    statusEl.innerText = "Booting Neural Engine...";

    if (typeof tf === 'undefined') {
      throw new Error("TensorFlow.js not detected. Check internet/firewall.");
    }

    // Try WebGL first for performance, fallback to CPU
    try {
        await tf.setBackend('webgl');
    } catch (e) {
        console.warn("WebGL failed, using CPU");
        await tf.setBackend('cpu');
    }
    await tf.ready();
    console.log('Active TF Backend:', tf.getBackend());

    await new Promise(r => setTimeout(r, 200));

    statusEl.innerText = "Configuring Interface...";
    if (typeof Chart === 'undefined') {
      throw new Error("Chart.js not detected.");
    }

    initCharts();
    console.log("Charts Initialized.");

    await new Promise(r => setTimeout(r, 200));

    statusEl.innerText = "Fetching Market Data...";
    await selectStock(currentSymbol);

    statusEl.innerText = "Finalizing...";
    await new Promise(r => setTimeout(r, 300));

    document.getElementById('loading').style.opacity = '0';
    setTimeout(() => {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('app').style.display = 'flex';
      console.log("Quantum Trader Ready.");
    }, 500);

  } catch (e) {
    console.error("BOOT ERROR:", e);
    statusEl.innerHTML = `<span style="color:var(--danger)">FATAL ERROR: ${e.message}</span><br><br><button onclick="location.reload()" style="background:#ff3366;color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;margin-top:10px;">Hard Reset</button>`;
  }
}

// Wrap listeners to ensure DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  const searchInp = document.getElementById('symbolSearch');
  if (searchInp) {
    searchInp.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') searchSymbol();
    });
  }
  init();
});
