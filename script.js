const { Engine, World, Bodies, Composite, Runner, Body } = Matter;

// DOM elements
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const actionBtn = document.getElementById("actionBtn");
const resetBtn = document.getElementById("resetBtn");
const curveBtn = document.getElementById("curveBtn");
const ballSlider = document.getElementById("ballSlider");
const ballCountTxt = document.getElementById("ballCountTxt");
const tabLiveBtn = document.getElementById("tabLiveBtn");
const tabGuideBtn = document.getElementById("tabGuideBtn");
const pageControls = document.getElementById("pageControls");
const pageGuide = document.getElementById("pageGuide");
const panelHeader = document.getElementById("panelHeader");
const uiLayer = document.getElementById("ui-layer");

// ========== CONFIGURATION ==========
const PEG_ROWS = 14;
const PEG_RADIUS = 2.5;
const BALL_RADIUS = 4;
const SPACING_X = 20;
const SPACING_Y = 22;
const START_Y = 280;
const WALL_THICKNESS = 8;
const HOPPER_WIDTH = 130;
const RELEASE_DELAY_MS = 100;

let engine, runner;
let cx, cy;
let targetBallCount = parseInt(ballSlider.value);
let isRunning = false;
let showCurve = false;
let ballQueue = [];
let releaseInterval = null;
let activeBalls = 0;
let releasedCount = 0;
let leftBoundaryPts = [], rightBoundaryPts = [];

// ---------- UI handling (unchanged) ----------
ballSlider.addEventListener("input", (e) => {
    ballCountTxt.textContent = `${e.target.value} BALLS`;
});
ballSlider.addEventListener("change", (e) => {
    targetBallCount = parseInt(e.target.value);
    resetSimulation();
});
actionBtn.addEventListener("click", () => {
    if (!isRunning && ballQueue.length) releaseBalls();
});
resetBtn.addEventListener("click", resetSimulation);
curveBtn.addEventListener("click", () => {
    showCurve = !showCurve;
    curveBtn.innerText = showCurve ? "Curve Overlay: ON" : "Curve Overlay: OFF";
    curveBtn.classList.toggle("active", showCurve);
});
window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if (key === " ") { e.preventDefault(); actionBtn.click(); }
    if (key === "c") { e.preventDefault(); curveBtn.click(); }
    if (key === "r") { e.preventDefault(); resetBtn.click(); }
});
window.addEventListener("resize", () => { resizeViewport(); resetSimulation(); });

panelHeader.addEventListener("click", () => uiLayer.classList.toggle("collapsed"));
tabLiveBtn.addEventListener("click", () => {
    tabLiveBtn.classList.add("active");
    tabGuideBtn.classList.remove("active");
    pageControls.style.display = "block";
    pageGuide.style.display = "none";
});
tabGuideBtn.addEventListener("click", () => {
    tabGuideBtn.classList.add("active");
    tabLiveBtn.classList.remove("active");
    pageControls.style.display = "none";
    pageGuide.style.display = "block";
});

// ---------- Helper: sealed walls ----------
function createSealedWall(p1, p2, label) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const midX = p1.x + dx / 2, midY = p1.y + dy / 2;
    return Bodies.rectangle(midX, midY, length + 12, WALL_THICKNESS, {
        isStatic: true, angle: angle,
        friction: 0, restitution: 0.05,
        label: label
    });
}

// ---------- Build the board (always creates a fresh gate) ----------
function buildMatrix() {
    if (!engine) return;
    const all = Composite.allBodies(engine.world);
    const toRemove = all.filter(b => !b.isStatic);
    World.remove(engine.world, toRemove);

    // Pegs
    for (let r = 0; r < PEG_ROWS; r++) {
        const pegs = r + 1;
        const rowW = (pegs - 1) * SPACING_X;
        const startX = cx - rowW / 2;
        for (let c = 0; c < pegs; c++) {
            const px = startX + c * SPACING_X;
            const py = START_Y + r * SPACING_Y;
            const peg = Bodies.circle(px, py, PEG_RADIUS, {
                isStatic: true, restitution: 0.45, friction: 0.01, label: "peg"
            });
            World.add(engine.world, peg);
        }
    }

    const bottomRowW = (PEG_ROWS - 1) * SPACING_X;
    const halfW = bottomRowW / 2;
    const outerBin = halfW + SPACING_X + 15;
    const bottomPegY = START_Y + (PEG_ROWS - 1) * SPACING_Y;
    const neckW = BALL_RADIUS * 4.8;

    // Outer boundaries
    leftBoundaryPts = [
        { x: cx - HOPPER_WIDTH, y: -300 },
        { x: cx - HOPPER_WIDTH, y: START_Y - 180 },
        { x: cx - neckW, y: START_Y - 50 },
        { x: cx - neckW, y: START_Y - 20 },
        { x: cx - outerBin, y: bottomPegY + 5 },
        { x: cx - outerBin, y: canvas.height + 150 }
    ];
    rightBoundaryPts = leftBoundaryPts.map(p => ({ x: cx + (cx - p.x), y: p.y }));

    for (let i = 0; i < leftBoundaryPts.length - 1; i++) {
        World.add(engine.world, createSealedWall(leftBoundaryPts[i], leftBoundaryPts[i+1], "bound"));
        World.add(engine.world, createSealedWall(rightBoundaryPts[i], rightBoundaryPts[i+1], "bound"));
    }

    // Gate (fresh body)
    const gate = Bodies.rectangle(cx, START_Y - 35, neckW * 2 + 10, WALL_THICKNESS, {
        isStatic: true, friction: 0, restitution: 0, label: "gate"
    });
    World.add(engine.world, gate);

    // Bin dividers
    const binStartY = bottomPegY + 20;
    const binHeight = canvas.height - binStartY + 150;
    for (let c = 0; c <= PEG_ROWS; c++) {
        const x = cx - halfW + (c - 0.5) * SPACING_X;
        const divider = Bodies.rectangle(x, binStartY + binHeight/2, WALL_THICKNESS/1.5, binHeight, {
            isStatic: true, friction: 0.01, restitution: 0.1, label: "divider"
        });
        World.add(engine.world, divider);
    }

    // Floor
    const ground = Bodies.rectangle(cx, canvas.height + 50, canvas.width, 100, {
        isStatic: true, restitution: 0.2, label: "floor"
    });
    World.add(engine.world, ground);
}

// ---------- Prepare ball queue ----------
function populateHopper() {
    ballQueue = [];
    activeBalls = 0;
    releasedCount = 0;

    const usableW = (HOPPER_WIDTH * 2) - 30;
    const spacing = BALL_RADIUS * 2.2;
    const cols = Math.floor(usableW / spacing);
    const startX = cx - (cols * spacing) / 2 + spacing/2;
    const startY = START_Y - 200;
    const limit = Math.min(targetBallCount, 500);

    for (let i = 0; i < limit; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const ball = Bodies.circle(startX + col * spacing, startY - row * spacing, BALL_RADIUS, {
            restitution: 0.38,
            friction: 0.006,
            frictionAir: 0.002,
            density: 0.07,
            label: "ball",
            sleepThreshold: 50
        });
        ball.lastMove = Date.now();
        ball.lastY = ball.position.y;
        ballQueue.push(ball);
    }
}

// ---------- FIXED RELEASE GATE SECTION ----------
function releaseBalls() {
    if (isRunning || ballQueue.length === 0) return;
    isRunning = true;

    const allBodies = Composite.allBodies(engine.world);
    
    // Core Fix: Find all elements labeled "gate" and remove using standardized Composite.remove
    const gateBodies = allBodies.filter(b => b.label === "gate");
    if (gateBodies.length > 0) {
        Composite.remove(engine.world, gateBodies);
        console.log("Gate removed by standard label criteria.");
    } else {
        // Fallback Fix: Target static rectangles sitting near the bottleneck height coordinate
        const positionFallback = allBodies.filter(b => b.isStatic && Math.abs(b.position.y - (START_Y - 35)) < 12);
        if (positionFallback.length > 0) {
            Composite.remove(engine.world, positionFallback);
            console.log("Gate wiped via layout position backup configuration.");
        }
    }

    actionBtn.classList.add("running");
    ballSlider.disabled = true;

    if (releaseInterval) clearInterval(releaseInterval);
    releaseInterval = setInterval(releaseNextBall, RELEASE_DELAY_MS);
}

function releaseNextBall() {
    if (!isRunning) return;
    if (ballQueue.length === 0) {
        if (releaseInterval) {
            clearInterval(releaseInterval);
            releaseInterval = null;
            actionBtn.innerText = "✅ SIMULATION COMPLETE";
            actionBtn.classList.remove("running");
        }
        return;
    }

    const ball = ballQueue.shift();
    World.add(engine.world, ball);
    activeBalls++;
    releasedCount++;
    actionBtn.innerText = `🎯 RELEASING... ${releasedCount}/${targetBallCount}`;
}

// ---------- Stuck prevention & cleanup ----------
let unstuckInterval = null;
let cleanupInterval = null;

function unstuckBalls() {
    if (!engine || !isRunning) return;
    const bodies = Composite.allBodies(engine.world);
    const now = Date.now();
    for (let b of bodies) {
        if (b.label !== "ball") continue;

        const speed = Math.abs(b.velocity.x) + Math.abs(b.velocity.y);
        const nearBottom = b.position.y > canvas.height - 90;

        if (speed > 0.15) {
            b.lastMove = now;
            b.lastY = b.position.y;
        }

        if (!nearBottom && speed < 0.3) {
            const angle = Math.random() * Math.PI * 2;
            Body.applyForce(b, b.position, {
                x: Math.cos(angle) * 0.0006,
                y: Math.sin(angle) * 0.0006
            });
            if (b.isSleeping) Body.setAwake(b, true);
        }

        if (now - b.lastMove > 5000 && !nearBottom) {
            World.remove(engine.world, b);
            activeBalls--;
        }
    }
}

function cleanupSettledBalls() {
    if (!engine || !isRunning) return;
    const bodies = Composite.allBodies(engine.world);
    const toRemove = [];
    for (let b of bodies) {
        if (b.label === "ball") {
            const atBottom = b.position.y > canvas.height - 70;
            const verySlow = Math.abs(b.velocity.y) < 0.2 && Math.abs(b.velocity.x) < 0.2;
            if (atBottom && verySlow) toRemove.push(b);
        }
    }
    if (toRemove.length) {
        World.remove(engine.world, toRemove);
        activeBalls -= toRemove.length;
    }
}

// ---------- Resize & reset ----------
function resizeViewport() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    cx = canvas.width / 2;
    cy = canvas.height / 2;
}

function resetSimulation() {
    if (releaseInterval) clearInterval(releaseInterval);
    if (unstuckInterval) clearInterval(unstuckInterval);
    if (cleanupInterval) clearInterval(cleanupInterval);
    releaseInterval = null;
    isRunning = false;
    activeBalls = 0;
    releasedCount = 0;
    ballQueue = [];
    actionBtn.innerText = "🚀 RELEASE BALLS";
    actionBtn.classList.remove("running");
    ballSlider.disabled = false;

    if (engine) {
        buildMatrix();
        populateHopper();
    }

    unstuckInterval = setInterval(unstuckBalls, 1500);
    cleanupInterval = setInterval(cleanupSettledBalls, 2000);
}

// ---------- Render ----------
function draw() {
    if (!engine) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (leftBoundaryPts.length) {
        ctx.beginPath();
        ctx.moveTo(leftBoundaryPts[0].x, leftBoundaryPts[0].y);
        for (let i = 1; i < leftBoundaryPts.length; i++) ctx.lineTo(leftBoundaryPts[i].x, leftBoundaryPts[i].y);
        ctx.moveTo(rightBoundaryPts[0].x, rightBoundaryPts[0].y);
        for (let i = 1; i < rightBoundaryPts.length; i++) ctx.lineTo(rightBoundaryPts[i].x, rightBoundaryPts[i].y);
        ctx.strokeStyle = "#00e5ff88";
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    const bodies = Composite.allBodies(engine.world);

    // Dividers
    ctx.fillStyle = "rgba(0, 229, 255, 0.08)";
    ctx.strokeStyle = "#00e5ff44";
    ctx.lineWidth = 1;
    for (let b of bodies) {
        if (b.label === "divider" && b.vertices) {
            ctx.beginPath();
            ctx.moveTo(b.vertices[0].x, b.vertices[0].y);
            for (let i = 1; i < b.vertices.length; i++) ctx.lineTo(b.vertices[i].x, b.vertices[i].y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
    }

    // Pegs
    ctx.fillStyle = "#ffffff";
    ctx.shadowBlur = 0;
    for (let b of bodies) {
        if (b.label === "peg") {
            ctx.beginPath();
            ctx.arc(b.position.x, b.position.y, PEG_RADIUS, 0, Math.PI*2);
            ctx.fill();
        }
    }

    // Gate (only if still present)
    for (let b of bodies) {
        if (b.label === "gate" && b.vertices) {
            ctx.beginPath();
            ctx.moveTo(b.vertices[0].x, b.vertices[0].y);
            for (let i = 1; i < b.vertices.length; i++) ctx.lineTo(b.vertices[i].x, b.vertices[i].y);
            ctx.closePath();
            ctx.fillStyle = "#ff3366";
            ctx.fill();
        }
    }

    // Balls
    ctx.shadowColor = "#00e5ff";
    ctx.shadowBlur = 6;
    for (let b of bodies) {
        if (b.label === "ball") {
            ctx.beginPath();
            ctx.arc(b.position.x, b.position.y, BALL_RADIUS, 0, Math.PI*2);
            ctx.fillStyle = "#00e5ff";
            ctx.fill();
        }
    }
    ctx.shadowBlur = 0;

    // Bell curve
    if (showCurve) {
        ctx.save();
        ctx.strokeStyle = "#ff3366";
        ctx.lineWidth = 2.5;
        ctx.shadowBlur = 0;
        ctx.beginPath();

        const bottomY = canvas.height - 55;
        const n = PEG_ROWS;
        const maxW = (n - 1) * SPACING_X;
        const startX = cx - maxW / 2;

        let row = [1];
        for (let i = 1; i <= n; i++) {
            row[i] = 0;
            for (let j = i; j > 0; j--) row[j] = (row[j] || 0) + (row[j-1] || 0);
        }
        const total = Math.pow(2, n);
        let first = true;
        for (let k = 0; k <= n; k++) {
            const prob = (row[k] || 0) / total;
            const height = prob * targetBallCount * (BALL_RADIUS * 1.6);
            const x = startX + k * SPACING_X;
            const y = bottomY - Math.min(height, 240);
            if (first) { ctx.moveTo(x, y); first = false; }
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
    }
}

let lastFrame = 0;
function animate(now) {
    requestAnimationFrame(animate);
    if (now - lastFrame < 16) return;
    lastFrame = now;
    draw();
}

function init() {
    engine = Engine.create({
        gravity: { x: 0, y: 0.8 },
        positionIterations: 12,
        velocityIterations: 8,
        enableSleeping: true
    });
    resizeViewport();
    buildMatrix();
    populateHopper();
    runner = Runner.create();
    Runner.run(runner, engine);

    unstuckInterval = setInterval(unstuckBalls, 1500);
    cleanupInterval = setInterval(cleanupSettledBalls, 2000);
    requestAnimationFrame(animate);
}

init();