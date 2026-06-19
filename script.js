const { Engine, World, Bodies, Composite, Runner, Body, Events } = Matter;

// ========== DOM ELEMENTS ==========
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

// ========== CONFIGURATION & GLOBAL VARIABLES ==========
const PEG_ROWS = 12;             
const PEG_RADIUS = 7.5;          
const BALL_RADIUS = 2.5;         // Ball diameter is 5
const SPACING_X = 17.5;            
const SPACING_Y = 16;            
const START_Y = 260;
const WALL_THICKNESS = 8;
const HOPPER_WIDTH = 130;
const NECK_WIDTH = 8; 

let engine, runner;
let cx, cy;
let balls = [], pegs = [], dividersArr = [], gates = [];
let targetBallCount = parseInt(ballSlider.value);
let isRunning = false;
let releaseComplete = false;
let showCurve = false;
let activeBalls = 0;
let leftBoundaryPts = [], rightBoundaryPts = [];
let lowestPegY = 0; 
let bottomRowStartX = 0;
let overlapInterval = null;
let unstuckInterval = null;
let allSettledAt = null;
let lastFrame = 0;
let dynamicFrameInterval = 16;

// ---------- UI handling ----------
ballSlider.addEventListener("input", (e) => {
    ballCountTxt.textContent = `${e.target.value} BALLS`;
});
ballSlider.addEventListener("change", (e) => {
    targetBallCount = parseInt(e.target.value);
    resetSimulation();
});
actionBtn.addEventListener("click", () => {
    if (!isRunning && !releaseComplete) releaseBalls();
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

// ---------- Helper: Sealed walls (Capsules) ----------
function createSealedWall(p1, p2, label) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const midX = p1.x + dx / 2, midY = p1.y + dy / 2;
    
    return Bodies.rectangle(midX, midY, length + WALL_THICKNESS, WALL_THICKNESS, {
        isStatic: true, 
        angle: angle,
        chamfer: { radius: WALL_THICKNESS * 0.45 }, 
        friction: 0, 
        restitution: 0,
        label: label
    });
}

// ---------- Build the board ----------
function buildMatrix() {
    if (!engine) return;
    World.clear(engine.world);
    Engine.clear(engine);

    balls.length = 0;
    pegs.length = 0;
    dividersArr.length = 0;
    gates.length = 0;

    const PEG_OFFSET_Y = 15; 

    // Generate Hexagonal Pegs
    for (let r = 0; r < PEG_ROWS; r++) {
        const blocks = r + 1;
        const rowW = (blocks - 1) * SPACING_X;
        const startX = cx - rowW / 2;
        
        if (r === PEG_ROWS - 1) {
            bottomRowStartX = startX; 
        }

        for (let c = 0; c < blocks; c++) {
            const px = startX + c * SPACING_X;
            const py = START_Y + r * SPACING_Y + PEG_OFFSET_Y;
            
            const block = Bodies.polygon(px, py, 6, PEG_RADIUS, {
                isStatic: true, 
                angle: Math.PI / 3, 
                chamfer: { radius: 2.2 }, // INCREASED CHAMFER: Rounds the tips perfectly to scatter balls more evenly
                restitution: 0.05,        // DEADENED BOUNCE: Prevents horizontal skipping
                friction: 0.01,            // INCREASED FRICTION: Forces balls to roll/trickle rather than slide fast
                label: "peg"
            });
            World.add(engine.world, block);
            pegs.push(block);
        }
    }

    lowestPegY = START_Y + (PEG_ROWS - 1) * SPACING_Y + PEG_OFFSET_Y; 

    leftBoundaryPts = [];

    // 1. Top Hopper Reservoir 
    leftBoundaryPts.push({ x: cx - HOPPER_WIDTH, y: START_Y - 260 });

    // 2. Sharp "V" Funnel down to the neck
    leftBoundaryPts.push({ x: cx - NECK_WIDTH, y: START_Y - 45 });

    // 3. Neck Exit
    leftBoundaryPts.push({ x: cx - NECK_WIDTH, y: START_Y + 1 });

    // 4. The Dynamic "Staircase" Profile
    const pegHalfWidth = PEG_RADIUS * 0.866; 
    const gapWidth = 10; 
    const SHIFT_X = pegHalfWidth + gapWidth; 
    
    for (let r = 0; r < PEG_ROWS; r++) {
        let px = cx - (r * SPACING_X) / 2 + 1;
        let py = START_Y + r * SPACING_Y + PEG_OFFSET_Y - 3;
        
        // Match the vertical flat face of the hexagon
        let p1x = px - SHIFT_X;
        let p1y = py - (PEG_RADIUS * 0.5);
        let p2x = px - SHIFT_X;
        let p2y = py + (PEG_RADIUS * 0.5) + 1;
        
        leftBoundaryPts.push({ x: p1x, y: p1y });
        leftBoundaryPts.push({ x: p2x, y: p2y });
    }

    // 5. Final transition down to uniform outer bin
    let last_p2 = leftBoundaryPts[leftBoundaryPts.length - 1];
    let binWallX = bottomRowStartX - SPACING_X; 
    
    leftBoundaryPts.push({ x: binWallX, y: last_p2.y + 10 });
    leftBoundaryPts.push({ x: binWallX, y: canvas.height + 150 });

    rightBoundaryPts = leftBoundaryPts.map(p => ({ x: cx + (cx - p.x), y: p.y }));

    for (let i = 0; i < leftBoundaryPts.length - 1; i++) {
        const lw = createSealedWall(leftBoundaryPts[i], leftBoundaryPts[i+1], "bound");
        const rw = createSealedWall(rightBoundaryPts[i], rightBoundaryPts[i+1], "bound");
        World.add(engine.world, lw);
        World.add(engine.world, rw);
        dividersArr.push(lw, rw);
    }

    // Gate
    const gate = Bodies.rectangle(cx, START_Y - 30, NECK_WIDTH * 2 + 10, WALL_THICKNESS, {
        isStatic: true, friction: 0, restitution: 0, label: "gate"
    });
    World.add(engine.world, gate);
    gates.push(gate);

    // Bin dividers
    const binHeight = canvas.height - (START_Y + 175);
    const dividerStartY = lowestPegY;
    for (let c = 0; c < PEG_ROWS; c++) {
        const x = bottomRowStartX + c * SPACING_X;
        const divider = Bodies.rectangle(x, dividerStartY + binHeight/2, WALL_THICKNESS/1.5, binHeight, {
            isStatic: true, friction: 0.1, restitution: 0, label: "divider"
        });
        World.add(engine.world, divider);
        dividersArr.push(divider);
    }

    // Floor
    const ground = Bodies.rectangle(cx, canvas.height + 50, canvas.width, 100, {
        isStatic: true, restitution: 0, friction: 0.1, label: "floor"
    });
    World.add(engine.world, ground);
    dividersArr.push(ground);
}

// ---------- Prepare ball queue ----------
function populateHopper() {
    activeBalls = 0;
    balls.length = 0;

    const limit = targetBallCount;
    const spacing = BALL_RADIUS * (targetBallCount > 600 ? 3.6 : targetBallCount > 300 ? 3.2 : 2.8);
    const hopperClipW = (HOPPER_WIDTH * 2) - 30; 
    const cols = Math.floor(hopperClipW / spacing);
    const startX = cx - (cols * spacing) / 2 + spacing / 2;
    const startY = START_Y - 245; 

    for (let i = 0; i < limit; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        
        const ball = Bodies.circle(startX + col * spacing, startY - row * spacing, BALL_RADIUS, {
            isStatic: false, 
            restitution: 0.05,      // DEADENED BOUNCE
            friction: 0.05,         // FRICTION ADDED
            frictionAir: 0.025,     // THICKER AIR restricts flying horizontally
            density: 0.005,
            label: "ball"
        });
        ball.lastMove = Date.now();
        
        World.add(engine.world, ball);
        balls.push(ball);
        activeBalls++;
    }
}

// ---------- Release balls ----------
function releaseBalls() {
    if (isRunning || releaseComplete) return;
    isRunning = true;
    actionBtn.classList.add("running");
    actionBtn.innerText = "🎯 SIMULATING...";
    ballSlider.disabled = true;

    if (gates.length) {
        for (let g of gates) Composite.remove(engine.world, g);
        gates.length = 0;
    }
    releaseComplete = true;
}

// ---------- Stuck prevention & End-state checking ----------
function unstuckBalls() {
    if (!engine) return; 
    const now = Date.now();

    let allSettled = true;
    let ballCount = balls.length;

    const binLeftEdge = bottomRowStartX - SPACING_X;
    const binRightEdge = bottomRowStartX + (PEG_ROWS * SPACING_X);

    for (let b of balls) {
        if (!b || !b.position) continue;

        if (!isRunning && !releaseComplete) {
            if (b.position.y > START_Y - 30) {
                Body.setPosition(b, {
                    x: cx + (Math.random() - 0.5) * 30,
                    y: START_Y - 250
                });
                Body.setVelocity(b, { x: 0, y: 0 });
                Body.setAngularVelocity(b, 0);
                b.lastMove = now;
            }
            continue;
        }

        let needsTeleport = false;

        const margin = 150;
        if (b.position.x < -margin || b.position.x > canvas.width + margin ||
            b.position.y > canvas.height + margin || b.position.y < START_Y - 400) {
            needsTeleport = true;
        }

        const binLeftEdgeAdj = binLeftEdge - SPACING_X * 3;
        const binRightEdgeAdj = binRightEdge + SPACING_X * 3;
        if (b.position.y > lowestPegY && (b.position.x < binLeftEdgeAdj || b.position.x > binRightEdgeAdj)) {
            needsTeleport = true;
        }

        if (needsTeleport) {
            Body.setPosition(b, {
                x: cx + (Math.random() - 0.5) * 30,
                y: START_Y - 250
            });
            Body.setVelocity(b, { x: 0, y: 0 });
            Body.setAngularVelocity(b, 0);
            b.lastMove = now;
            allSettled = false;
            continue;
        }

        if (b.position.y > lowestPegY + 5) continue;
        
        if (b.position.y < START_Y - 15) {
            b.lastMove = now;
            allSettled = false;
            continue;
        }

        const speed = Math.abs(b.velocity.x) + Math.abs(b.velocity.y);
        if (speed > 0.08) b.lastMove = now;
        if (b.position.y < lowestPegY || speed > 0.08) allSettled = false;

        if (speed < 0.25) {
            Body.applyForce(b, b.position, {
                x: 0,                           
                y: -0.0001 * Math.random() // Further reduced purely vertical vibration     
            });
        }

        if (now - b.lastMove > 3000) {
            Body.setPosition(b, {
                x: cx + (Math.random() - 0.5) * 30,
                y: START_Y - 250
            });
            Body.setVelocity(b, { x: 0, y: 0 });
            Body.setAngularVelocity(b, 0);
            b.lastMove = now;
            allSettled = false;
        }
    }

    if (!releaseComplete) allSettled = false;

    if (isRunning && releaseComplete && allSettled && ballCount > 0) {
        if (!allSettledAt) allSettledAt = now;

        if (now - allSettledAt > 1800) {
            actionBtn.innerText = "✅ SIMULATION COMPLETE";
            actionBtn.classList.remove("running");
            isRunning = false;
            allSettledAt = null;

            for (let b of balls) {
                if (b && !b.isStatic) Body.setStatic(b, true);
            }

            if (overlapInterval) {
                clearInterval(overlapInterval);
                overlapInterval = null;
            }
            if (unstuckInterval) {
                clearInterval(unstuckInterval);
                unstuckInterval = null;
            }
        }
    } else {
        allSettledAt = null;
    }
}

// ---------- Lightweight spatial-hash overlap resolver ----------
function resolveOverlaps() {
    if (!engine || !balls || balls.length === 0 || !isRunning) return;
    const cellSize = Math.max(12, BALL_RADIUS * 6);
    const grid = new Map();

    for (let i = 0; i < balls.length; i++) {
        const b = balls[i];
        if (!b || !b.position) continue;
        const cxCell = Math.floor(b.position.x / cellSize);
        const cyCell = Math.floor(b.position.y / cellSize);
        const key = `${cxCell},${cyCell}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(i);
    }

    const minDist = BALL_RADIUS * 2 - 0.2;

    for (let [key, idxs] of grid.entries()) {
        const parts = key.split(",").map(n => parseInt(n, 10));
        const sx = parts[0], sy = parts[1];
        for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
                const neighborKey = `${sx + ox},${sy + oy}`;
                const list = grid.get(neighborKey);
                if (!list) continue;
                for (let i of idxs) {
                    const bi = balls[i];
                    if (!bi || !bi.position || bi.position.y > START_Y - 80) continue;
                    
                    for (let j of list) {
                        if (j <= i) continue;
                        const bj = balls[j];
                        if (!bj || !bj.position || bj.position.y > START_Y - 80) continue;
                        
                        const dx = bj.position.x - bi.position.x;
                        const dy = bj.position.y - bi.position.y;
                        const dist = Math.hypot(dx, dy);
                        if (dist === 0) {
                            const ang = Math.random() * Math.PI * 2;
                            const ax = Math.cos(ang) * 0.6;
                            const ay = Math.sin(ang) * 0.6;
                            Body.setPosition(bi, { x: bi.position.x - ax, y: bi.position.y - ay });
                            Body.setPosition(bj, { x: bj.position.x + ax, y: bj.position.y + ay });
                            continue;
                        }
                        if (dist < minDist) {
                            const overlap = (minDist - dist) / 2;
                            const nx = dx / dist;
                            const ny = dy / dist;
                            Body.setPosition(bi, { x: bi.position.x - nx * overlap, y: bi.position.y - ny * overlap });
                            Body.setPosition(bj, { x: bj.position.x + nx * overlap, y: bj.position.y + ny * overlap });
                            Body.setVelocity(bi, { x: bi.velocity.x * 0.6 - nx * 0.02, y: bi.velocity.y * 0.6 - ny * 0.02 });
                            Body.setVelocity(bj, { x: bj.velocity.x * 0.6 + nx * 0.02, y: bj.velocity.y * 0.6 + ny * 0.02 });
                        }
                    }
                }
            }
        }
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
    if (unstuckInterval) clearInterval(unstuckInterval);
    if (overlapInterval) clearInterval(overlapInterval);
    isRunning = false;
    releaseComplete = false;
    allSettledAt = null;
    activeBalls = 0;
    actionBtn.innerText = "🚀 RELEASE BALLS";
    actionBtn.classList.remove("running");
    ballSlider.disabled = false;

    if (engine) {
        buildMatrix();
        populateHopper();
    }

    unstuckInterval = setInterval(unstuckBalls, 250);
    overlapInterval = setInterval(resolveOverlaps, 450);
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

    // Dividers
    ctx.fillStyle = "rgba(0, 229, 255, 0.08)";
    ctx.strokeStyle = "#00e5ff44";
    ctx.lineWidth = 1;
    for (let b of dividersArr) {
        if (!b || !b.vertices || !b.vertices.length) continue;
        ctx.beginPath();
        ctx.moveTo(b.vertices[0].x, b.vertices[0].y);
        for (let i = 1; i < b.vertices.length; i++) ctx.lineTo(b.vertices[i].x, b.vertices[i].y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }

    // Hexagon Peg rendering
    ctx.fillStyle = "#d4af37"; 
    ctx.shadowBlur = 0;
    for (let b of pegs) {
        if (!b || !b.vertices || !b.vertices.length) continue;
        ctx.beginPath();
        ctx.moveTo(b.vertices[0].x, b.vertices[0].y);
        for (let i = 1; i < b.vertices.length; i++) ctx.lineTo(b.vertices[i].x, b.vertices[i].y);
        ctx.closePath();
        ctx.fill();
    }

    // Gate
    for (let b of gates) {
        if (!b || !b.vertices || !b.vertices.length) continue;
        ctx.beginPath();
        ctx.moveTo(b.vertices[0].x, b.vertices[0].y);
        for (let i = 1; i < b.vertices.length; i++) ctx.lineTo(b.vertices[i].x, b.vertices[i].y);
        ctx.closePath();
        ctx.fillStyle = "#ff3366";
        ctx.fill();
    }

    // Balls
    const heavy = balls.length > 400;
    if (!heavy) {
        ctx.shadowColor = "#00e5ff";
        ctx.shadowBlur = 4;
    } else {
        ctx.shadowBlur = 0;
    }
    for (let b of balls) {
        if (!b || !b.position) continue;
        ctx.beginPath();
        ctx.arc(b.position.x, b.position.y, BALL_RADIUS, 0, Math.PI*2);
        ctx.fillStyle = "#00e5ff";
        ctx.fill();
    }
    ctx.shadowBlur = 0;

    // --- Continuous Bell Curve Overlay ---
    if (showCurve) {
        ctx.save();
        ctx.strokeStyle = "#ff3366";
        ctx.lineWidth = 2.5;
        ctx.beginPath();

        const bottomY = canvas.height;
        const maxCurveHeight = Math.sqrt(targetBallCount * 15); 
        
        const sigma = SPACING_X * Math.sqrt(PEG_ROWS * 0.25) * 1.5;
        
        let first = true;
        for (let x = 0; x <= canvas.width; x += 2) {
            const exponent = -Math.pow(x - cx, 2) / (2 * Math.pow(sigma, 2));
            const y = bottomY - (maxCurveHeight * Math.exp(exponent));
            
            if (first) {
                ctx.moveTo(x, y);
                first = false;
            } else {
                ctx.lineTo(x, y);
            }
        }
        
        ctx.stroke();
        ctx.restore();
    }
}

function animate(now) {
    requestAnimationFrame(animate);
    const count = balls.length || 0;
    if (count > 700) dynamicFrameInterval = 40; 
    else if (count > 400) dynamicFrameInterval = 28; 
    else dynamicFrameInterval = 16; 

    if (now - lastFrame < dynamicFrameInterval) return;
    lastFrame = now;
    draw();
}

function init() {
    engine = Engine.create({
        gravity: { x: 0, y: 2 },        
        positionIterations: 32,
        velocityIterations: 16,
        enableSleeping: false
    });

    // Sub-pixel thermal noise injected right at the apex drop zone.
    Events.on(engine, 'beforeUpdate', function() {
        if (!isRunning) return;
        for (let i = 0; i < balls.length; i++) {
            const b = balls[i];
            if (!b || b.isStatic) continue;
            
            if (b.position.y > START_Y - 10 && b.position.y < START_Y + 20) {
                Body.applyForce(b, b.position, {
                    x: (Math.random() - 0.5) * 0.000005, // Significantly reduced lateral nudge!
                    y: 0
                });
            }
        }
    });

    resizeViewport();
    buildMatrix();
    populateHopper();
    runner = Runner.create();
    Runner.run(runner, engine);

    unstuckInterval = setInterval(unstuckBalls, 250);
    overlapInterval = setInterval(resolveOverlaps, 450);
    requestAnimationFrame(animate);
}

init();
