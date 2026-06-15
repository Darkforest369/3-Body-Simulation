const { Engine, World, Bodies, Composite, Runner } = Matter;

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const ballSlider = document.getElementById("ballSlider");
const ballCountTxt = document.getElementById("ballCountTxt");
const actionBtn = document.getElementById("actionBtn");
const resetBtn = document.getElementById("resetBtn");
const curveBtn = document.getElementById("curveBtn");

// UI Mapping
const tabLiveBtn = document.getElementById("tabLiveBtn");
const tabGuideBtn = document.getElementById("tabGuideBtn");
const pageControls = document.getElementById("pageControls");
const pageGuide = document.getElementById("pageGuide");
const panelHeader = document.getElementById("panelHeader");
const uiLayer = document.getElementById("ui-layer");

let engine, runner;
let cx, cy;

// ==========================================
// SCALED BINOMIAL CONFIGURATION
// ==========================================
const PEG_ROWS = 15;        
const PEG_RADIUS = 2.5;     
const BALL_RADIUS = 3.5;    
const SPACING_X = 20;       
const SPACING_Y = 20;       
const START_Y = 300;        
const WALL_THICKNESS = 8;
const HOPPER_WIDTH = 160;   

let targetBallCount = parseInt(ballSlider.value);
let isRunning = false;
let showCurveOverlay = false;
let gate = null; 

// Geometric Arrays
let leftBoundaryPts = [];
let rightBoundaryPts = [];

// UI Logic
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

// Update Text instantly while dragging
ballSlider.addEventListener("input", (e) => {
    ballCountTxt.textContent = `${e.target.value} BALLS`;
});

// Re-render the balls ONLY when the user finishes dragging the slider
ballSlider.addEventListener("change", (e) => {
    targetBallCount = parseInt(e.target.value);
    resetSimulation();
});

function resizeViewport() {
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const viewportWidth = window.visualViewport?.width || window.innerWidth;
    
    document.documentElement.style.setProperty("--app-height", `${viewportHeight}px`);
    canvas.width = viewportWidth;
    canvas.height = viewportHeight;
    cx = canvas.width / 2;
    cy = canvas.height / 2;
}

// Helper: Line segments for continuous casing
function createWallBetweenPoints(p1, p2, labelStr = "bound") {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    const midX = p1.x + dx / 2;
    const midY = p1.y + dy / 2;
    
    return Bodies.rectangle(midX, midY, length + 8, WALL_THICKNESS * 1.4, {
        isStatic: true,
        angle: angle,
        friction: 0.18,
        restitution: 0.08,
        label: labelStr
    });
}

function buildMatrix() {
    if (engine) World.clear(engine.world);

    // 1. Triangular Peg Matrix
    for (let r = 0; r < PEG_ROWS; r++) {
        let pegsInRow = r + 1; 
        let rowWidth = (pegsInRow - 1) * SPACING_X;
        let startX = cx - rowWidth / 2;

        for (let c = 0; c < pegsInRow; c++) {
            let px = startX + c * SPACING_X;
            let py = START_Y + r * SPACING_Y;
            let peg = Bodies.circle(px, py, PEG_RADIUS, {
                isStatic: true, restitution: 0.18, friction: 0.06, label: "peg"
            });
            World.add(engine.world, peg);
        }
    }

    const bottomRowWidth = (PEG_ROWS - 1) * SPACING_X;
    const halfWidth = bottomRowWidth / 2;
    const binOuterEdge = halfWidth + SPACING_X;
    const bottomPegY = START_Y + (PEG_ROWS - 1) * SPACING_Y;

    const neckHalfWidth = BALL_RADIUS * 6.5;
    const topWallY = START_Y - 280;
    const funnelMidY = START_Y - 110;
    const funnelMidX = cx - neckHalfWidth * 2.8;
    const funnelShoulderY = START_Y - 52;
    const funnelShoulderX = cx - neckHalfWidth * 1.8;

    leftBoundaryPts = [
        { x: cx - HOPPER_WIDTH, y: topWallY },
        { x: cx - HOPPER_WIDTH, y: START_Y - 170 },
        { x: funnelMidX, y: funnelMidY },
        { x: funnelShoulderX, y: funnelShoulderY },
        { x: cx - neckHalfWidth, y: START_Y - 18 },
        { x: cx - binOuterEdge, y: bottomPegY },
        { x: cx - binOuterEdge, y: canvas.height + 50 }
    ];

    rightBoundaryPts = leftBoundaryPts.map(pt => ({
        x: cx + (cx - pt.x),
        y: pt.y
    }));

    for (let i = 0; i < leftBoundaryPts.length - 1; i++) {
        World.add(engine.world, createWallBetweenPoints(leftBoundaryPts[i], leftBoundaryPts[i+1]));
        World.add(engine.world, createWallBetweenPoints(rightBoundaryPts[i], rightBoundaryPts[i+1]));
    }

    const topWall = Bodies.rectangle(cx, topWallY - WALL_THICKNESS / 2, HOPPER_WIDTH * 2 + 40, WALL_THICKNESS * 1.2, {
        isStatic: true,
        friction: 0.18,
        restitution: 0.08,
        label: "bound"
    });
    World.add(engine.world, topWall);

    const hopperLeftWall = Bodies.rectangle(cx - HOPPER_WIDTH + 9, START_Y - 170, WALL_THICKNESS * 1.4, 300, {
        isStatic: true,
        friction: 0.18,
        restitution: 0.06,
        label: "bound"
    });
    const hopperRightWall = Bodies.rectangle(cx + HOPPER_WIDTH - 9, START_Y - 170, WALL_THICKNESS * 1.4, 300, {
        isStatic: true,
        friction: 0.18,
        restitution: 0.06,
        label: "bound"
    });
    const hopperFloor = Bodies.rectangle(cx, START_Y - 120, HOPPER_WIDTH * 2 - 28, WALL_THICKNESS / 1.5, {
        isStatic: true,
        friction: 0.22,
        restitution: 0.05,
        label: "bound"
    });

    World.add(engine.world, [hopperLeftWall, hopperRightWall, hopperFloor]);

    gate = Bodies.rectangle(cx, START_Y - 45, neckHalfWidth * 2 + 36, WALL_THICKNESS * 1.1, {
        isStatic: true,
        friction: 0.08,
        restitution: 0.06,
        label: "gate"
    });
    World.add(engine.world, gate);

    // 5. Vertical Bin Dividers
    const binStartY = bottomPegY + 15;
    const binHeight = canvas.height - binStartY + 100; 
    
    for (let c = 0; c < PEG_ROWS; c++) {
        let wallX = cx - halfWidth + c * SPACING_X; 
        let wallY = binStartY + binHeight / 2;
        let divider = Bodies.rectangle(wallX, wallY, WALL_THICKNESS / 2, binHeight, {
            isStatic: true, friction: 0, label: "bound"
        });
        World.add(engine.world, divider);
    }

    // 6. Floor
    const ground = Bodies.rectangle(cx, canvas.height + 25, canvas.width, 50, { isStatic: true, label: "bound" });
    World.add(engine.world, ground);
}

// Instantly preload the entire rectangular hopper uniformly
function populateHopper() {
    const sidePadding = BALL_RADIUS * 6 + 14;
    const leftBound = cx - HOPPER_WIDTH + sidePadding;
    const rightBound = cx + HOPPER_WIDTH - sidePadding;
    const spacing = BALL_RADIUS * 2.15;
    const cols = Math.max(1, Math.floor((rightBound - leftBound) / spacing));
    const startX = leftBound + BALL_RADIUS;
    const startY = START_Y - 140;

    const hopperTopY = START_Y - 280 + BALL_RADIUS + 2;
    const maxRows = Math.max(1, Math.floor((startY - hopperTopY) / spacing) + 1);
    const rows = Math.min(Math.ceil(targetBallCount / cols), maxRows);
    const ballCount = Math.min(targetBallCount, rows * cols);

    let newBalls = [];
    for (let i = 0; i < ballCount; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const xOffset = (Math.random() * 2 - 1) * 1.2;
        const yOffset = (Math.random() * 1.4) - 0.7;

        const ball = Bodies.circle(startX + col * spacing + xOffset, startY - row * spacing + yOffset, BALL_RADIUS, {
            restitution: 0.14,
            friction: 0.03,
            frictionAir: 0.0018,
            density: 0.008,
            label: "ball"
        });

        newBalls.push(ball);
    }
    World.add(engine.world, newBalls);
}

function releaseBalls() {
    if (!isRunning && gate) {
        isRunning = true;
        
        Composite.remove(engine.world, gate);
        gate = null;
        
        actionBtn.innerText = "🔄 SIMULATION RUNNING";
        actionBtn.classList.add("running");
        ballSlider.disabled = true;
    }
}

function resetSimulation() {
    isRunning = false;
    ballSlider.disabled = false;
    actionBtn.innerText = "🚀 RELEASE BALLS";
    actionBtn.classList.remove("running");
    
    buildMatrix();
    populateHopper();
}

// UI Triggers
actionBtn.addEventListener("click", () => {
    if (!isRunning) releaseBalls();
});

resetBtn.addEventListener("click", resetSimulation);

curveBtn.addEventListener("click", () => {
    showCurveOverlay = !showCurveOverlay;
    if (showCurveOverlay) {
        curveBtn.innerText = "Curve Overlay: ON";
        curveBtn.classList.add("active");
    } else {
        curveBtn.innerText = "Curve Overlay: OFF";
        curveBtn.classList.remove("active");
    }
});

window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if (key === " ") { e.preventDefault(); actionBtn.click(); }
    if (key === "c") { e.preventDefault(); curveBtn.click(); }
    if (key === "r") { e.preventDefault(); resetBtn.click(); }
});

window.addEventListener("resize", () => {
    resizeViewport();
    resetSimulation();
});

// Render Loop
function renderLoop() {
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 1. Draw outer neon boundaries
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(leftBoundaryPts[0].x, leftBoundaryPts[0].y);
    for(let i=1; i<leftBoundaryPts.length; i++) ctx.lineTo(leftBoundaryPts[i].x, leftBoundaryPts[i].y);
    
    ctx.moveTo(rightBoundaryPts[0].x, rightBoundaryPts[0].y);
    for(let i=1; i<rightBoundaryPts.length; i++) ctx.lineTo(rightBoundaryPts[i].x, rightBoundaryPts[i].y);
    
    ctx.strokeStyle = "rgba(0, 229, 255, 0.7)";
    ctx.lineWidth = 2.5;
    ctx.shadowColor = "rgba(0, 229, 255, 0.5)";
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.restore();

    const bodies = Composite.allBodies(engine.world);

    ctx.save();
    ctx.strokeStyle = "rgba(0, 229, 255, 0.9)";
    ctx.lineWidth = 3;
    ctx.shadowColor = "rgba(0, 229, 255, 0.35)";
    ctx.shadowBlur = 8;
    for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        if (b.isStatic && b.label === "bound" && b.vertices.length > 0) {
            ctx.beginPath();
            ctx.moveTo(b.vertices[0].x, b.vertices[0].y);
            for (let j = 1; j < b.vertices.length; j++) ctx.lineTo(b.vertices[j].x, b.vertices[j].y);
            ctx.closePath();
            ctx.stroke();
        }
    }
    ctx.restore();

    ctx.save();
    for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        
        if (b.label === "peg") {
            ctx.beginPath();
            ctx.arc(b.position.x, b.position.y, PEG_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = "#ffffff";
            ctx.fill();
        } else if (b.label === "ball") {
            ctx.beginPath();
            ctx.arc(b.position.x, b.position.y, BALL_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = "#00e5ff";
            ctx.fill();
        } else if (b.label === "gate") {
            ctx.beginPath();
            ctx.moveTo(b.vertices[0].x, b.vertices[0].y);
            for (let j = 1; j < b.vertices.length; j++) ctx.lineTo(b.vertices[j].x, b.vertices[j].y);
            ctx.closePath();
            ctx.fillStyle = "#ff3366";
            ctx.shadowColor = "#ff3366";
            ctx.shadowBlur = 10;
            ctx.fill();
        }
    }
    ctx.restore();

    // Draw static boundary bodies clearly so the funnel and hopper are visible.
    ctx.save();
    ctx.strokeStyle = "rgba(0, 229, 255, 0.55)";
    ctx.lineWidth = 2.5;
    ctx.shadowColor = "rgba(0, 229, 255, 0.35)";
    ctx.shadowBlur = 8;
    for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        if (b.isStatic && b.label === "bound" && b.vertices.length > 0) {
            ctx.beginPath();
            ctx.moveTo(b.vertices[0].x, b.vertices[0].y);
            for (let j = 1; j < b.vertices.length; j++) ctx.lineTo(b.vertices[j].x, b.vertices[j].y);
            ctx.closePath();
            ctx.stroke();
        }
    }
    ctx.restore();

    const bottomRowWidth = (PEG_ROWS - 1) * SPACING_X;
    const halfWidth = bottomRowWidth / 2;
    const binOuterEdge = halfWidth + SPACING_X;
    const binStartY = START_Y + (PEG_ROWS - 1) * SPACING_Y + 15;
    const bins = new Array(PEG_ROWS + 1).fill(0);

    for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        if (b.label === "ball" && b.position.y > binStartY) {
            const idx = Math.floor((b.position.x - (cx - binOuterEdge)) / SPACING_X);
            if (idx >= 0 && idx < bins.length) bins[idx]++;
        }
    }

    const maxBin = Math.max(...bins, 1);
    ctx.save();
    ctx.fillStyle = "rgba(255, 51, 102, 0.16)";
    for (let i = 0; i < bins.length; i++) {
        const x = cx - binOuterEdge + i * SPACING_X;
        const barHeight = (bins[i] / maxBin) * 90;
        ctx.fillRect(x + 1, canvas.height - barHeight - 2, SPACING_X - 2, barHeight);
    }
    ctx.restore();

    if (showCurveOverlay) {
        ctx.save();
        ctx.strokeStyle = "#ff3366";
        ctx.lineWidth = 3.5;
        ctx.shadowColor = "rgba(255, 51, 102, 0.8)";
        ctx.shadowBlur = 10;
        ctx.beginPath();

        const baseLine = canvas.height - 2;
        const n = PEG_ROWS;
        const sigma = (Math.sqrt(n) / 2) * SPACING_X;
        const centerProb = SPACING_X / (sigma * Math.sqrt(2 * Math.PI));
        const expectedMaxBallsInCenter = targetBallCount * centerProb;
        const ballVisualStackingHeight = BALL_RADIUS * 1.95;
        const curveAmplitude = expectedMaxBallsInCenter * ballVisualStackingHeight;

        let started = false;
        for (let x = cx - 450; x <= cx + 450; x += 5) {
            const exponent = -Math.pow(x - cx, 2) / (2 * Math.pow(sigma, 2));
            const y = baseLine - (curveAmplitude * Math.exp(exponent));

            if (!started) {
                ctx.moveTo(x, y);
                started = true;
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
        ctx.restore();
    }

    requestAnimationFrame(renderLoop);
}

// Initializer
(function init() {
    engine = Engine.create({ 
        gravity: { y: 1.0 }, 
        positionIterations: 12, 
        velocityIterations: 12  
    }); 
    
    resizeViewport();
    buildMatrix();
    populateHopper();

    runner = Runner.create();
    Runner.run(runner, engine);
    
    requestAnimationFrame(renderLoop);
})();