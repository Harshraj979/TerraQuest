document.addEventListener('DOMContentLoaded', () => {

  const st = {
    stream: null, cameraOn: false, metrics: null,
    quest: null, objectives: [],
    timerSecs: 900, timerRef: null, audioIdx: 0,
    stats: { count: 0, xp: 0, badges: ['off-grid'] },
    log: []
  };

  const SAMPLES = {
    pinecone: 'assets/samples/pinecone.jpg',
    acorn:    'assets/samples/acorn.jpg',
    redleaf:  'assets/samples/redleaf.jpg'
  };

  const BADGES = [
    { id: 'off-grid',    em: '🌐', name: 'Off-Grid',       desc: 'Used local browser vision engine.' },
    { id: 'woodland',    em: '🌲', name: 'Woodland Scout', desc: 'Completed a forest texture quest.' },
    { id: 'botanist',    em: '🌿', name: 'Botanist',       desc: 'Detected botanical foliage patterns.' },
    { id: 'riverbed',    em: '🌊', name: 'Riverbed Nomad', desc: 'Unlocked a mineral stone trail.' },
    { id: 'ears-free',   em: '🎧', name: 'Eyes-Free',      desc: 'Used hands-free audio guidance.' },
    { id: 'trailblazer', em: '🥇', name: 'Trailblazer',   desc: 'Completed 3 outdoor quests.' }
  ];

  const $ = id => document.getElementById(id);
  const navBtns   = [...document.querySelectorAll('.nav-btn')];
  const tabPanes  = [...document.querySelectorAll('.tab')];
  const navQuest  = $('navQuest');
  
  const webcam    = $('webcam');
  const canvas    = $('canvas');
  const ctx       = canvas.getContext('2d');
  const crosshair = $('crosshair');
  const scanBar   = $('scanBar');
  const vfEmpty   = $('vfEmpty');
  
  const btnCam    = $('btnStartCamera');
  const btnSnap   = $('btnCapture');
  const fileIn    = $('fileInput');
  
  const aIdle     = $('analysisIdle');
  const aResults  = $('analysisResults');
  const paletteEl = $('palette');
  const rFill     = $('roughnessFill');
  const rNum      = $('roughnessNum');
  const matList   = $('materialList');
  const scanText  = $('scanLabel');
  const scanDot   = $('scanDot');
  
  const btnQuest  = $('btnQuest');
  const qCat      = $('qCat');
  const qTitle    = $('qTitle');
  const qLore     = $('qLore');
  const qXP       = $('qXP');
  const qTime     = $('qTime');
  const objList   = $('objectives');
  const btnAudio  = $('btnAudio');
  const btnDone   = $('btnDone');
  
  const sCnt      = $('sCompleted');
  const sXP       = $('sXP');
  const sBdg      = $('sBadges');
  const badgeGrid = $('badgeGrid');
  const historyEl = $('history');
  
  const audioModal   = $('audioOverlay');
  const closeAudio   = $('closeAudio');
  const timerDisplay = $('timerDisplay');
  const audioTask    = $('overlayTask');
  const btnPlay      = $('btnSpeak');
  const btnNextObj   = $('btnNextObj');

  loadData();
  renderJournal();

  // ── Tab Navigation ─────────────────────────────────────────────
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      navBtns.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`pane-${btn.dataset.target}`).classList.add('active');
    });
  });

  // ── Camera ─────────────────────────────────────────────────────
  if (btnCam) {
    btnCam.addEventListener('click', async () => {
      try {
        st.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        webcam.srcObject = st.stream;
        webcam.style.display = 'block';
        canvas.style.display = 'none';
        vfEmpty.style.display = 'none';
        crosshair.style.display = 'block';
        st.cameraOn = true;
        btnCam.style.display = 'none';
        btnSnap.style.display = 'inline-flex';
      } catch {
        alert('Camera unavailable — upload a photo or try a sample.');
      }
    });
  }

  if (btnSnap) {
    btnSnap.addEventListener('click', () => {
      canvas.width  = webcam.videoWidth  || 800;
      canvas.height = webcam.videoHeight || 600;
      ctx.drawImage(webcam, 0, 0, canvas.width, canvas.height);
      st.stream?.getTracks().forEach(t => t.stop());
      webcam.style.display  = 'none';
      canvas.style.display  = 'block';
      st.cameraOn = false;
      btnSnap.style.display = 'none';
      btnCam.style.display  = 'inline-flex';
      analyzeImage();
    });
  }

  if (fileIn) {
    fileIn.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
          canvas.width = img.width; canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          vfEmpty.style.display = 'none';
          webcam.style.display  = 'none';
          canvas.style.display  = 'block';
          crosshair.style.display = 'block';
          analyzeImage();
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  document.querySelectorAll('.sample-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width; canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        vfEmpty.style.display   = 'none';
        webcam.style.display    = 'none';
        canvas.style.display    = 'block';
        crosshair.style.display = 'block';
        analyzeImage();
      };
      img.src = SAMPLES[btn.dataset.sample];
    });
  });

  // ── AI Classifier Initialization ────────────────────────────────
  let classifierPipeline = null;

  async function initClassifier() {
    if (!classifierPipeline) {
      if (typeof window.pipeline !== 'function') {
        console.warn('Transformers.js pipeline not available. Falling back to simple metrics.');
        return null;
      }
      try {
        if(scanText) scanText.textContent = 'Loading local AI model...';
        classifierPipeline = await window.pipeline('image-classification', 'Xenova/mobilenet_v2_1.0_224');
      } catch (e) {
        console.warn('Model load failed, using on-device heuristic analysis.', e);
        if (scanText) scanText.textContent = 'Model unavailable — using terrain heuristics.';
        return null;
      }
    }
    return classifierPipeline;
  }

  // ── Computer Vision Pipeline ────────────────────────────────────
  async function analyzeImage() {
    aIdle.style.display    = 'none';
    aResults.style.display = 'flex';
    if(btnQuest) btnQuest.style.display = 'none';
    if(scanBar) scanBar.classList.add('active');
    if(scanDot) scanDot.className = 'scan-dot running';

    rFill.style.width  = '0%';
    rNum.textContent   = '—';
    paletteEl.innerHTML = '';
    matList.innerHTML   = '';

    scanText.textContent = 'Extracting pixel metrics…';

    const baseMetrics = runBaseCV();
    if (!baseMetrics) {
      if(scanBar) scanBar.classList.remove('active');
      if(scanDot) scanDot.className = 'scan-dot done';
      if(scanText) scanText.textContent = 'No image data available';
      return;
    }

    scanText.textContent = 'Running neural classification…';

    try {
      const classifier = await initClassifier();
      if (classifier) {
        const dataUrl = canvas.toDataURL('image/jpeg');
        const results = await classifier(dataUrl, { topk: 3 });

        baseMetrics.materials = results.map(r => {
          const name = r.label.split(',')[0]
            .split(' ')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
          const pct = Math.round(r.score * 100);
          return { name, pct };
        });
      }
    } catch (e) {
      console.warn('Classification error, using local fallback instead.', e);
    }

    if (!baseMetrics.materials || baseMetrics.materials.length === 0) {
      baseMetrics.materials = deriveFallbackMaterials(baseMetrics);
    }

    st.metrics = baseMetrics;
    if(scanBar) scanBar.classList.remove('active');
    if(scanDot) scanDot.className = 'scan-dot done';
    scanText.textContent = 'Analysis complete';

    renderResults(baseMetrics);
    if(btnQuest) btnQuest.style.display = 'block';
  }

  // ── Real pixel extraction — basic multi-signal CV ─────────────
  function runBaseCV() {
    const w = canvas.width, h = canvas.height;
    if (!w || !h) return null;

    const imgData = ctx.getImageData(0, 0, w, h);
    const data    = imgData.data;
    const step    = Math.max(4, Math.floor((w * h) / 9000)) * 4;
    const bucket  = {};

    let wGreen = 0, wEarth = 0, wMineral = 0, wAutumn = 0;
    let totalWeight = 0, lumSum = 0, satSum = 0, sampCount = 0;

    for (let i = 0; i < data.length; i += step) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const { h: hue, s: sat, v } = toHSV(r, g, b);
      const weight = sat * v + 0.05;

      sampCount++;
      lumSum += v;
      satSum += sat;
      totalWeight += weight;

      if (sat > 0.1 && v > 0.07) {
        if (hue >= 75 && hue <= 155) wGreen += weight;
        else if (hue >= 18 && hue < 75) wEarth += weight;
        else if (hue < 18 || hue > 330) wAutumn += weight;
        else wMineral += weight * 0.4;
      } else {
        wMineral += weight * 0.6;
      }

      const qR = Math.round(r / 32) * 32;
      const qG = Math.round(g / 32) * 32;
      const qB = Math.round(b / 32) * 32;
      const hex = '#' + [qR, qG, qB].map(c => c.toString(16).padStart(2, '0')).join('');
      bucket[hex] = (bucket[hex] || 0) + 1;
    }

    const topColors = Object.entries(bucket)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([c]) => c);

    const stride = Math.max(2, Math.floor(w / 100));
    let edgeSum = 0, edgeCt = 0;
    for (let y = 1; y < h - 1; y += stride) {
      for (let x = 1; x < w - 1; x += stride) {
        const i = (y * w + x) * 4;
        const gx = luma(data, i + 4) - luma(data, i - 4);
        const gy = luma(data, i + w * 4) - luma(data, i - w * 4);
        edgeSum += Math.hypot(gx, gy);
        edgeCt++;
      }
    }
    const roughness = Math.min(99, Math.max(5, Math.round((edgeSum / edgeCt) / 55 * 100)));

    const tw = totalWeight || 1;
    const weights = {
      green: wGreen / tw,
      earth: wEarth / tw,
      mineral: wMineral / tw,
      autumn: wAutumn / tw
    };

    const avgLum = lumSum / sampCount;
    const avgSat = satSum / sampCount;
    const density = Math.round(weights.green * 100);
    const warmth = Math.round(weights.autumn * 100);

    return { topColors, roughness, weights, avgLum, avgSat, density, warmth, materials: [] };
  }

  function deriveFallbackMaterials(metrics) {
    const entries = [
      { name: 'Canopy', value: metrics.weights.green },
      { name: 'Earth', value: metrics.weights.earth },
      { name: 'Stone', value: metrics.weights.mineral },
      { name: 'Autumn', value: metrics.weights.autumn }
    ];

    return entries
      .sort((a, b) => b.value - a.value)
      .filter(item => item.value > 0.08)
      .slice(0, 3)
      .map(item => ({ name: item.name, pct: Math.max(18, Math.round(item.value * 100)) }));
  }

  function luma(d, i) {
    return 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
  }

  function toHSV(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    const s = max === 0 ? 0 : d / max;
    const v = max;
    if (d) {
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h = (h / 6) * 360;
    }
    return { h, s, v };
  }

  function renderResults(r) {
    paletteEl.innerHTML = r.topColors.map(c =>
      `<div class="swatch" style="background:${c}" title="${c}"></div>`
    ).join('');
    rFill.style.width = `${r.roughness}%`;
    rNum.textContent = `${r.roughness}%`;

    matList.innerHTML = r.materials.map(m =>
      `<span class="mat-tag">${m.name} <span class="mat-pct" style="opacity:0.6; font-size:0.9em; margin-left:4px;">${m.pct}%</span></span>`
    ).join('');
  }

  // ── Scoring Matrix Quest Synthesiser ───────────────────────────
  if (btnQuest) {
    btnQuest.addEventListener('click', () => {
      if (!st.metrics) return;
      const q = synthesiseQuest(st.metrics);
      st.quest = q;
      st.objectives = q.steps.map(s => ({ ...s, done: false }));
      qCat.textContent = q.category;
      qTitle.textContent = q.title;
      qLore.textContent = q.lore;
      qXP.textContent = `+${q.xp} XP`;
      qTime.textContent = `${q.duration}`;
      renderObjectives();
      navQuest.disabled = false;
      navQuest.click();
    });
  }

  function synthesiseQuest(m) {
    const { weights: w, roughness, avgLum, avgSat, density, warmth, materials } = m;
    const topMaterial = materials[0]?.name || 'Wild Terrain';
    const terrainBias = [
      w.green > w.earth ? 'canopy' : 'ground',
      w.autumn > 0.18 ? 'autumn' : 'stone',
      roughness > 60 ? 'textured' : 'smooth'
    ];

    const sceneMap = {
      canopy: {
        category: '🌿 Canopy Trace',
        titles: [
          `The ${density > 42 ? 'Dense' : 'Open'} Green Survey`,
          `Rooted Light Scan — ${roughness}% Far-Field Texture`,
          'Living Canopy Sweep'
        ],
        flavor: `The scene reads as ${topMaterial.toLowerCase()} with ${pct(w.green)} green-weight dominance. The visual stack suggests ${roughness > 55 ? 'bark, woody stems, and layered undergrowth' : 'leaf surfaces, moss, and smooth cover'} working together.`
      },
      autumn: {
        category: '🍂 Autumn Drift',
        titles: [
          `Warmth Map — ${warmth}% Colour Signal`,
          `${warmth > 30 ? 'Peak' : 'Early'} Hawthorn Walk`,
          'Foliage Signal Path'
        ],
        flavor: `The terrain carries ${pct(w.autumn)} warm-toned energy, a ${Math.round(avgLum * 100)}% luminance spread, and enough contrast to suggest ${avgLum > 0.5 ? 'bright sunlit leaves' : 'dappled woodland shade'}.`
      },
      stone: {
        category: '🪨 Mineral Trace',
        titles: [
          `Stone Echo — ${roughness}% Grain Index`,
          `${roughness > 65 ? 'High-Contrast' : 'Smooth'} River Survey`,
          'Mineral Trail Reading'
        ],
        flavor: `Mineral weight sits at ${pct(w.mineral)} with saturation around ${Math.round(avgSat * 100)}%. This pattern leans toward ${roughness > 60 ? 'rock, shale, and textured ground' : 'river-smoothed stone or packed earth'} rather than lush canopy.`
      },
      ground: {
        category: '🌲 Woodland Floor',
        titles: [
          `Earth Signal — ${pct(w.earth)} Soil Bias`,
          `${roughness > 50 ? 'Coarse' : 'Fine'} Forest Ground Study`,
          'Organic Baseline Circuit'
        ],
        flavor: `Recent spectral data points to ${pct(w.earth)} earth-toned material and ${roughness}% texture, which reads like a ground layer of bark, seed husks, or packed woodland soil.`
      }
    };

    const region = sceneMap[terrainBias.find(key => sceneMap[key]) || 'ground'];
    const baseSteps = [
      { h: 'Read the dominant texture from eye level', d: `Use the ${roughness}% roughness signal to compare the surface to nearby bark, moss, or stone.` },
      { h: 'Follow the strongest colour pattern', d: `Anchor on ${topMaterial.toLowerCase()} and hunt for the next matching patch in the same light band.` },
      { h: 'Record the terrain edge', d: `Mark where the ground transitions into canopy, stone, or shadow to close the loop.` }
    ];

    const narrativeTitle = region.titles[Math.floor((roughness / 100) * region.titles.length) % region.titles.length];
    const xp = 120 + Math.round((w.green + w.earth + w.autumn + w.mineral) * 180) + roughness;
    const duration = `${10 + Math.round((roughness + density) / 12)} min`;

    return {
      category: region.category,
      title: narrativeTitle,
      lore: region.flavor,
      duration,
      xp,
      steps: baseSteps
    };
  }

  function pct(v) { return `${Math.round(v * 100)}%`; }

  function renderObjectives() {
    objList.innerHTML = st.objectives.map((o, i) => `
      <div class="obj-item${o.done ? ' done' : ''}" data-i="${i}">
        <div class="obj-check">${o.done ? '✓' : ''}</div>
        <div class="obj-content">
          <h4>${o.h}</h4>
          <p>${o.d}</p>
        </div>
      </div>
    `).join('');
    objList.querySelectorAll('.obj-item').forEach(el => {
      el.addEventListener('click', () => {
        const i = +el.dataset.i;
        st.objectives[i].done = !st.objectives[i].done;
        renderObjectives();
      });
    });
  }

  if (btnDone) {
    btnDone.addEventListener('click', () => {
      if (!st.quest) return;
      st.stats.count++;
      st.stats.xp += st.quest.xp;
      if (!st.stats.badges.includes('woodland'))    st.stats.badges.push('woodland');
      if (st.metrics?.weights.green > 0.1  && !st.stats.badges.includes('botanist'))  st.stats.badges.push('botanist');
      if (st.metrics?.weights.mineral > 0.1 && !st.stats.badges.includes('riverbed')) st.stats.badges.push('riverbed');
      if (st.stats.count >= 3 && !st.stats.badges.includes('trailblazer')) st.stats.badges.push('trailblazer');
      st.log.unshift({ title: st.quest.title, cat: st.quest.category, xp: st.quest.xp, date: new Date().toLocaleDateString() });
      saveData();
      renderJournal();
      document.querySelector('.nav-btn[data-target="journal"]').click();
    });
  }

  // ── Audio overlay ───────────────────────────────────────────────
  if (btnAudio) {
    btnAudio.addEventListener('click', () => {
      if (!st.stats.badges.includes('ears-free')) { st.stats.badges.push('ears-free'); saveData(); renderJournal(); }
      st.timerSecs = 900;
      st.audioIdx  = 0;
      audioModal.style.display = 'flex';
      startTimer();
      speak();
    });
  }

  if (closeAudio) closeAudio.addEventListener('click', stopAudio);
  
  function stopAudio() {
    if (audioModal) audioModal.style.display = 'none';
    clearInterval(st.timerRef);
    speechSynthesis.cancel();
  }

  function startTimer() {
    clearInterval(st.timerRef);
    st.timerRef = setInterval(() => {
      if (--st.timerSecs <= 0) clearInterval(st.timerRef);
      const m = String(Math.floor(st.timerSecs / 60)).padStart(2, '0');
      const s = String(st.timerSecs % 60).padStart(2, '0');
      if (timerDisplay) timerDisplay.textContent = `${m}:${s}`;
    }, 1000);
  }

  function speak() {
    const obj = st.objectives[st.audioIdx];
    if (!obj) return;
    if (audioTask) audioTask.textContent = `${obj.h}. ${obj.d}`;
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(`${obj.h}. ${obj.d}`);
      u.rate = 0.92;
      speechSynthesis.speak(u);
    }
  }

  if (btnPlay) btnPlay.addEventListener('click', speak);
  if (btnNextObj) btnNextObj.addEventListener('click', () => {
    st.audioIdx = (st.audioIdx + 1) % (st.objectives.length || 1);
    speak();
  });

  // ── Journal ─────────────────────────────────────────────────────
  function renderJournal() {
    if(sCnt) sCnt.textContent = st.stats.count;
    if(sXP) sXP.textContent  = st.stats.xp;
    if(sBdg) sBdg.textContent = `${st.stats.badges.length}/${BADGES.length}`;
    if(badgeGrid) {
      badgeGrid.innerHTML = BADGES.map(b => {
        const u = st.stats.badges.includes(b.id);
        return `<div class="badge-card${u ? '' : ' locked'}">
          <div class="badge-em">${b.em}</div>
          <div class="badge-info">
            <h4>${b.name}${u ? ' ✓' : ''}</h4>
            <p>${b.desc}</p>
          </div>
        </div>`;
      }).join('');
    }
    if(historyEl) {
      historyEl.innerHTML = st.log.length
        ? st.log.map(l => `<div class="history-item">
            <div>
              <strong>${l.title}</strong>
              <span>${l.cat} · ${l.date}</span>
            </div>
            <span class="history-xp">+${l.xp} XP</span>
          </div>`).join('')
        : '<div class="empty-note">No quests yet. Scan a nature photo to begin.</div>';
    }
  }

  function saveData() {
    localStorage.setItem('tq_stats', JSON.stringify(st.stats));
    localStorage.setItem('tq_log',   JSON.stringify(st.log));
  }
  function loadData() {
    try {
      const s = localStorage.getItem('tq_stats');
      const l = localStorage.getItem('tq_log');
      if (s) st.stats = JSON.parse(s);
      if (l) st.log   = JSON.parse(l);
    } catch {}
  }
});
