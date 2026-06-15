// Global Constants & State Control
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

let isRunning = false;
let currentPreset = "figure8";
let zoomLevel = 1.0;
let panX = 0, panY = 0;

let showTrails = true;
let showGrid = true;
let showVectors = true;
let showEnergy = true;
let showCom = true;
let showFps = true;

let G = 10.0;
let softening = 15.0; // Essential softening factor protecting close-proximity approaches
let substeps = 10;
let numBodies = 3;

let bodies = [];
let energyHistory = [];
const maxEnergyPoints = 250;

// Benchmarking Variables
let lastFrameTime = performance.now();
let fps = 60;

// Pointer Drag Tracking
let isDraggingBody = false;
let isDraggingVector = false;
let selectedBodyIndex = -1;

const universeColors = ["#00e5ff", "#ff9900", "#ff00ff", "#00ff7f", "#ffff00"];

// --- Setup Default Physics Templates ---
function loadPreset(presetName) {
  currentPreset = presetName;
  bodies = [];
  energyHistory = [];
  
  const midX = 0;
  const midY = 0;

  if (presetName === "figure8") {
    numBodies = 3;
    // Classic Newtonian Choreographed Orbit Coordinates (Scaled for Display)
    const px = 180, py = 50;
    const vx = 4.3, vy = 3.9;
    
    bodies.push({ x: -px, y: py, vx: vx, vy: vy, mass: 100, color: universeColors[0], trail: [] });
    bodies.push({ x: px, y: -py, vx: vx, vy: vy, mass: 100, color: universeColors[1], trail: [] });
    bodies.push({ x: 0, y: 0, vx: -2 * vx, vy: -2 * vy, mass: 100, color: universeColors[2], trail: [] });
  } 
  else if (presetName === "chaotic") {
    numBodies = 3;
    bodies.push({ x: -120, y: -80, vx: 2, vy: -4, mass: 120, color: universeColors[0], trail: [] });
    bodies.push({ x: 140, y: 40, vx: -3, vy: 3, mass: 80, color: universeColors[1], trail: [] });
    bodies.push({ x: -20, y: 100, vx: 1, vy: 1, mass: 150, color: universeColors[2], trail: [] });
  } 
  else if (presetName === "lagrange") {
    numBodies = 3;
    // Central Star
    bodies.push({ x: 0, y: 0, vx: 0, vy: -0.3, mass: 400, color: universeColors[0], trail: [] });
    // Heavy Planet
    bodies.push({ x: 180, y: 0, vx: 0, vy: 5.0, mass: 15, color: universeColors[1], trail: [] });
    // Trojan Asteroid sitting perfectly at L4 Equilateral Point
    const l4x = 180 * Math.cos(Math.PI / 3);
    const l4y = 180 * Math.sin(Math.PI / 3);
    bodies.push({ x: l4x, y: l4y, vx: -5.0 * Math.sin(Math.PI / 3), vy: 5.0 * Math.cos(Math.PI / 3), mass: 0.01, color: universeColors[2], trail: [] });
  } 
  else if (presetName === "binary") {
    numBodies = 4;
    bodies.push({ x: -100, y: 0, vx: 0, vy: -3.5, mass: 200, color: universeColors[0], trail: [] });
    bodies.push({ x: 100, y: 0, vx: 0, vy: 3.5, mass: 200, color: universeColors[1], trail: [] });
    bodies.push({ x: -250, y: 0, vx: 0, vy: -6.0, mass: 5, color: universeColors[2], trail: [] });
    bodies.push({ x: 250, y: 0, vx: 0, vy: 6.0, mass: 5, color: universeColors[3], trail: [] });
  }

  document.getElementById("bodyCountSlider").value = numBodies;
  document.getElementById("bodyCountTxt").innerText = `${numBodies} BODIES`;
  
  syncDynamicSliders();
}

// Rebuild Parameter Control list items inside UI
function syncDynamicSliders() {
  const container = document.getElementById("bodyControlContainer");
  container.innerHTML = "";

  bodies.forEach((body, idx) => {
    const card = document.createElement("div");
    card.className = "body-config-card";
    card.innerHTML = `
      <div class="body-config-title" style="color: ${body.color}">
        <span style="display:inline-block; width:10px; height:10px; background:${body.color}; border-radius:50%"></span>
        Object Particle ${idx + 1}
      </div>
      <div class="slider-row">
        <span>Mass</span>
        <div class="slider-container">
          <input type="range" id="mass-${idx}" min="0.1" max="500" step="1" value="${body.mass}">
        </div>
      </div>
    `;
    container.appendChild(card);

    document.getElementById(`mass-${idx}`).addEventListener("input", (e) => {
      body.mass = parseFloat(e.target.value);
    });
  });
}

// Adjust UI population counts up/down dynamically
function updateBodyCount(targetCount) {
  numBodies = targetCount;
  if (bodies.length < numBodies) {
    while (bodies.length < numBodies) {
      const idx = bodies.length;
      const angle = (idx * Math.PI * 2) / numBodies;
      const radius = 150;
      bodies.push({
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
        vx: -3 * Math.sin(angle),
        vy: 3 * Math.cos(angle),
        mass: 100,
        color: universeColors[idx % universeColors.length],
        trail: []
      });
    }
  } else {
    bodies = bodies.slice(0, numBodies);
  }
  energyHistory = [];
  syncDynamicSliders();
}

// --- High-Performance Runge-Kutta 4th Order Integrator Engine ---
function getDerivatives(state) {
  const n = state.length / 4;
  const derivs = new Array(state.length).fill(0);

  // Unpack positions and velocities
  for (let i = 0; i < n; i++) {
    derivs[i * 4] = state[i * 4 + 2];     // dx/dt = vx
    derivs[i * 4 + 1] = state[i * 4 + 3]; // dy/dt = vy

    let ax = 0, ay = 0;
    const xi = state[i * 4];
    const yi = state[i * 4 + 1];
    const mi = bodies[i].mass;

    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const xj = state[j * 4];
      const yj = state[j * 4 + 1];
      const mj = bodies[j].mass;

      const dx = xj - xi;
      const dy = yj - yi;
      const distSq = dx * dx + dy * dy + softening * softening;
      const dist = Math.sqrt(distSq);

      if (dist > 0) {
        const forceMagnitude = (G * mj) / (distSq * dist);
        ax += forceMagnitude * dx;
        ay += forceMagnitude * dy;
      }
    }
    derivs[i * 4 + 2] = ax; // dvx/dt = ax
    derivs[i * 4 + 3] = ay; // dvy/dt = ay
  }
  return derivs;
}

function stepRK4(dt) {
  const n = bodies.length;
  let state = [];

  for (let i = 0; i < n; i++) {
    state.push(bodies[i].x, bodies[i].y, bodies[i].vx, bodies[i].vy);
  }

  const k1 = getDerivatives(state);

  let state2 = state.map((val, i) => val + 0.5 * dt * k1[i]);
  const k2 = getDerivatives(state2);

  let state3 = state.map((val, i) => val + 0.5 * dt * k2[i]);
  const k3 = getDerivatives(state3);

  let state4 = state.map((val, i) => val + dt * k3[i]);
  const k4 = getDerivatives(state4);

  for (let i = 0; i < n; i++) {
    bodies[i].x += (dt / 6) * (k1[i * 4] + 2 * k2[i * 4] + 2 * k3[i * 4] + k4[i * 4]);
    bodies[i].y += (dt / 6) * (k1[i * 4 + 1] + 2 * k2[i * 4 + 1] + 2 * k3[i * 4 + 1] + k4[i * 4 + 1]);
    bodies[i].vx += (dt / 6) * (k1[i * 4 + 2] + 2 * k2[i * 4 + 2] + 2 * k3[i * 4 + 2] + k4[i * 4 + 2]);
    bodies[i].vy += (dt / 6) * (k1[i * 4 + 3] + 2 * k2[i * 4 + 3] + 2 * k3[i * 4 + 3] + k4[i * 4 + 3]);
  }
}

// Calculate Net Mechanical System Metrics
function computeSystemEnergy() {
  let ke = 0;
  let pe = 0;

  for (let i = 0; i < bodies.length; i++) {
    const bi = bodies[i];
    const speedSq = bi.vx * bi.vx + bi.vy * bi.vy;
    ke += 0.5 * bi.mass * speedSq;

    for (let j = i + 1; j < bodies.length; j++) {
      const bj = bodies[j];
      const dx = bj.x - bi.x;
      const dy = bj.y - bi.y;
      const dist = Math.sqrt(dx * dx + dy * dy + softening * softening);
      pe -= (G * bi.mass * bj.mass) / dist;
    }
  }
  return { ke, pe, total: ke + pe };
}

// --- Coordinate Projection Helper Functions ---
function toScreen(x, y) {
  return {
    x: canvas.width / 2 + panX + x * zoomLevel,
    y: canvas.height / 2 + panY + y * zoomLevel
  };
}

function toWorld(screenX, screenY) {
  return {
    x: (screenX - canvas.width / 2 - panX) / zoomLevel,
    y: (screenY - canvas.height / 2 - panY) / zoomLevel
  };
}

// --- Core Render Engine Canvas Drawing Loop ---
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const centerScreen = toScreen(0, 0);

  // 1. Draw Geometric Background Alignment Guides
  if (showGrid) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
    ctx.lineWidth = 1;
    const step = 50 * zoomLevel;

    const startX = (canvas.width / 2 + panX) % step;
    for (let x = startX; x < canvas.width; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    const startY = (canvas.height / 2 + panY) % step;
    for (let y = startY; y < canvas.height; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
  }

  // 2. Draw Trails paths
  if (showTrails) {
    bodies.forEach((body) => {
      if (body.trail.length < 2) return;
      ctx.beginPath();
      const firstPt = toScreen(body.trail[0].x, body.trail[0].y);
      ctx.moveTo(firstPt.x, firstPt.y);

      for (let i = 1; i < body.trail.length; i++) {
        const pt = toScreen(body.trail[i].x, body.trail[i].y);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.strokeStyle = body.color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.4;
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    });
  }

  // 3. Draw Kinetic Mass Nodes and Velocity Modifiers
  bodies.forEach((body, idx) => {
    const pos = toScreen(body.x, body.y);
    const radius = Math.max(4, Math.sqrt(body.mass) * 1.2) * zoomLevel;

    // Draw Vector arrow overlays
    if (showVectors) {
      const arrowScale = 12;
      const endPos = toScreen(body.x + body.vx * arrowScale, body.y + body.vy * arrowScale);
      
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.lineTo(endPos.x, endPos.y);
      ctx.strokeStyle = "#ffff00";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Vector Arrowhead tip
      const angle = Math.atan2(endPos.y - pos.y, endPos.x - pos.x);
      ctx.beginPath();
      ctx.moveTo(endPos.x, endPos.y);
      ctx.lineTo(endPos.x - 7 * Math.cos(angle - Math.PI / 6), endPos.y - 7 * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(endPos.x - 7 * Math.cos(angle + Math.PI / 6), endPos.y - 7 * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fillStyle = "#ffff00";
      ctx.fill();
    }

    // Outer Glow if dragged
    if (!isRunning && selectedBodyIndex === idx) {
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius + 6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = body.color;
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  // 4. Calculate Net Center of Mass (COM) Crosshair
  if (showCom && bodies.length > 0) {
    let totalM = 0, sumX = 0, sumY = 0;
    bodies.forEach(b => {
      totalM += b.mass;
      sumX += b.x * b.mass;
      sumY += b.y * b.mass;
    });
    const com = toScreen(sumX / totalM, sumY / totalM);
    ctx.strokeStyle = "rgba(255, 51, 102, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(com.x - 10, com.com); ctx.moveTo(com.x - 8, com.y); ctx.lineTo(com.x + 8, com.y);
    ctx.moveTo(com.x, com.y - 8); ctx.lineTo(com.x, com.y + 8);
    ctx.stroke();
  }

  // 5. Draw Dynamic Dashboard Graphic Layout Overlays
  if (showEnergy && energyHistory.length > 1) {
    drawEnergyDashboard();
  }
  
  if (showFps) {
    ctx.fillStyle = "#888";
    ctx.font = "11px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`ENGINE STATE: ${fps} FPS`, 25, canvas.height - 25);
  }
}

function drawEnergyDashboard() {
  const gw = 280, gh = 90;
  const gx = canvas.width - gw - 25;
  const gy = canvas.height - gh - 25 - (showFps ? 20 : 0);

  ctx.fillStyle = "rgba(20, 20, 20, 0.85)";
  ctx.fillRect(gx, gy, gw, gh);
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;
  ctx.strokeRect(gx, gy, gw, gh);

  ctx.fillStyle = "#aaa";
  ctx.font = "9px monospace";
  ctx.textAlign = "left";
  ctx.fillText("NET ENERGY TELEMETRY TRACK", gx + 8, gy + 12);

  let maxE = 0.1;
  energyHistory.forEach(e => {
    maxE = Math.max(maxE, Math.abs(e.ke), Math.abs(e.pe), Math.abs(e.total));
  });

  const plotTop = gy + 20, plotBottom = gy + gh - 10;
  const xDenom = Math.max(energyHistory.length - 1, 1);

  // Render separate trace lines
  const traces = [
    { key: "ke", color: "#00ff7f" },
    { key: "pe", color: "#ff3366" },
    { key: "total", color: "#ffffff" }
  ];

  traces.forEach(trace => {
    ctx.beginPath();
    for (let i = 0; i < energyHistory.length; i++) {
      const x = gx + (i / xDenom) * gw;
      // Center energy charts symmetrically across midline profiles
      const normY = (energyHistory[i][trace.key] / maxE) * (gh * 0.35);
      const y = (plotTop + plotBottom) / 2 - normY;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = trace.color;
    ctx.lineWidth = trace.key === "total" ? 1.5 : 1;
    ctx.stroke();
  });
}

// --- Physics Thread Stepper Callback Loop ---
function update() {
  const now = performance.now();
  const dtReal = (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  fps = Math.round(1 / (dtReal || 0.016));

  if (isRunning) {
    // Standard normalized timestamp window mapping steps
    const dt = 0.05; 
    for (let step = 0; step < substeps; step++) {
      stepRK4(dt);
    }

    // Append trace tracking positions
    bodies.forEach(b => {
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 800) b.trail.shift();
    });

    // Save history energy logs
    energyHistory.push(computeSystemEnergy());
    if (energyHistory.length > maxEnergyPoints) energyHistory.shift();
  }

  draw();
  requestAnimationFrame(update);
}

// --- Workspace Layout Resizing Event Responders ---
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  draw();
}

// --- DOM Event Mapping Framework Hooks ---
function init() {
  window.addEventListener("resize", resize);

  // UI Drawer Toggles
  document.getElementById("panelHeader").addEventListener("click", () => {
    document.getElementById("ui-layer").classList.toggle("collapsed");
  });

  // Tab Menu Handling Setup [cite: 218]
  const tabs = ["tabLiveBtn", "tabBodiesBtn", "tabEnvBtn", "tabGuideBtn"];
  const pages = ["pageControls", "pageBodies", "pageEnv", "pageGuide"];
  
  tabs.forEach((tabId, idx) => {
    document.getElementById(tabId).addEventListener("click", () => {
      tabs.forEach(t => document.getElementById(t).classList.remove("active"));
      pages.forEach(p => document.getElementById(p).style.display = "none");
      
      document.getElementById(tabId).classList.add("active");
      document.getElementById(pages[idx]).style.display = "block";
    });
  });

  // Controls Interface Wire-Up
  const actionBtn = document.getElementById("actionBtn");
  actionBtn.addEventListener("click", () => {
    isRunning = !isRunning;
    actionBtn.innerText = isRunning ? "⏸️ PAUSE ENGINE" : "🚀 RELEASE ORBITS";
    actionBtn.classList.toggle("running", isRunning);
  });

  document.querySelectorAll(".preset-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      document.querySelectorAll(".preset-btn").forEach(b => b.classList.remove("active"));
      e.target.classList.add("active");
      loadPreset(e.target.getAttribute("data-preset"));
    });
  });

  // Toggle Accessory Modifiers
  const toggleBtnHelper = (id, targetVarSetter) => {
    const btn = document.getElementById(id);
    btn.addEventListener("click", () => {
      const state = targetVarSetter();
      btn.innerText = `${btn.innerText.split(":")[0]}: ${state ? "ON" : "OFF"}`;
      btn.classList.toggle("active", state);
    });
  };

  toggleBtnHelper("trailsBtn", () => showTrails = !showTrails);
  toggleBtnHelper("gridBtn", () => showGrid = !showGrid);
  toggleBtnHelper("vectorsBtn", () => showVectors = !showVectors);

  // Population Configuration Sliders
  document.getElementById("bodyCountSlider").addEventListener("input", (e) => {
    const val = parseInt(e.target.value);
    document.getElementById("bodyCountTxt").innerText = `${val} BODIES`;
    updateBodyCount(val);
  });

  // Constant Factor Controls
  const linkSliderText = (sliderId, textId, unit, callback) => {
    const slider = document.getElementById(sliderId);
    slider.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      document.getElementById(textId).innerText = `${val.toFixed(1)}${unit}`;
      callback(val);
    });
  };

  linkSliderText("gSlider", "gTxt", "", (val) => G = val);
  linkSliderText("softeningSlider", "softeningTxt", " px", (val) => softening = val);
  linkSliderText("substepsSlider", "substepsTxt", " steps/frame", (val) => substeps = val);

  // Bottom Telemetry Drawer Functions
  const telemBtn = document.getElementById("telemetryBtn");
  const telemDrop = document.getElementById("telemetry-dropdown");
  telemBtn.addEventListener("click", () => {
    const isOpen = telemDrop.style.display === "block";
    telemDrop.style.display = isOpen ? "none" : "block";
    telemBtn.innerText = isOpen ? "TELEMETRY ▲" : "TELEMETRY ▼";
  });

  const wirePipToggle = (rowId, pipId, stateGetterSetter) => {
    document.getElementById(rowId).addEventListener("click", () => {
      const state = stateGetterSetter();
      document.getElementById(pipId).classList.toggle("on", state);
    });
  };

  wirePipToggle("rowEnergy", "pipEnergy", () => showEnergy = !showEnergy);
  wirePipToggle("rowCom", "pipCom", () => showCom = !showCom);
  wirePipToggle("rowFps", "pipFps", () => showFps = !showFps);

  // Keyboard Shortcuts Bindings Map [cite: 215]
  window.addEventListener("keydown", (e) => {
    if (e.key === " ") {
      e.preventDefault();
      actionBtn.click();
    } else if (e.key.toLowerCase() === "r") {
      loadPreset(currentPreset);
    } else if (e.key.toLowerCase() === "t") {
      document.getElementById("trailsBtn").click();
    } else if (e.key.toLowerCase() === "g") {
      document.getElementById("gridBtn").click();
    }
  });

  // --- Pointer Click and Drag Tracking Mechanics ---
  canvas.addEventListener("mousedown", (e) => {
    if (isRunning) return; // Allow node modification only during active pause phases
    
    const mouseWorld = toWorld(e.clientX, e.clientY);
    selectedBodyIndex = -1;
    isDraggingBody = false;
    isDraggingVector = false;

    // Check interaction with endpoints or vector nodes
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      const radius = Math.max(4, Math.sqrt(b.mass) * 1.2);
      const distToBody = Math.hypot(mouseWorld.x - b.x, mouseWorld.y - b.y);

      // Verify click on Vector handle
      if (showVectors) {
        const arrowScale = 12;
        const tipX = b.x + b.vx * arrowScale;
        const tipY = b.y + b.vy * arrowScale;
        const distToTip = Math.hypot(mouseWorld.x - tipX, mouseWorld.y - tipY);

        if (distToTip < 15 / zoomLevel) {
          selectedBodyIndex = i;
          isDraggingVector = true;
          return;
        }
      }

      // Verify click on center node body
      if (distToBody < (radius + 5) / zoomLevel) {
        selectedBodyIndex = i;
        isDraggingBody = true;
        return;
      }
    }
  });

  canvas.addEventListener("mousemove", (e) => {
    if (selectedBodyIndex === -1) return;
    const mouseWorld = toWorld(e.clientX, e.clientY);
    const b = bodies[selectedBodyIndex];

    if (isDraggingBody) {
      b.x = mouseWorld.x;
      b.y = mouseWorld.y;
      b.trail = []; // Flush old alignment trail coordinates
    } 
    else if (isDraggingVector) {
      const arrowScale = 12;
      b.vx = (mouseWorld.x - b.x) / arrowScale;
      b.vy = (mouseWorld.y - b.y) / arrowScale;
    }
  });

  window.addEventListener("mouseup", () => {
    isDraggingBody = false;
    isDraggingVector = false;
  });

  // Viewpan Scrollwheel Zoom Operations [cite: 214]
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const zoomFactor = 1.1;
    if (e.deltaY < 0) {
      zoomLevel = Math.min(5.0, zoomLevel * zoomFactor);
    } else {
      zoomLevel = Math.max(0.2, zoomLevel / zoomFactor);
    }
  }, { passive: false });

  // Load Initial Configuration State Default
  resize();
  loadPreset("figure8");
  requestAnimationFrame(update);
}

// Fire application launch threads upon DOM assembly completion
window.addEventListener("DOMContentLoaded", init);