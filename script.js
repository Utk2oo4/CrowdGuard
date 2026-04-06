// --- Math & Utilities ---
class Vector2 {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
    add(v) { this.x += v.x; this.y += v.y; return this; }
    sub(v) { this.x -= v.x; this.y -= v.y; return this; }
    mult(n) { this.x *= n; this.y *= n; return this; }
    div(n) { this.x /= n; this.y /= n; return this; }
    mag() { return Math.sqrt(this.x * this.x + this.y * this.y); }
    magSq() { return this.x * this.x + this.y * this.y; }
    normalize() {
        let m = this.mag();
        if (m !== 0) this.div(m);
        return this;
    }
    limit(max) {
        if (this.magSq() > max * max) {
            this.normalize();
            this.mult(max);
        }
        return this;
    }
    dist(v) {
        let dx = this.x - v.x;
        let dy = this.y - v.y;
        return Math.sqrt(dx * dx + dy * dy);
    }
    copy() { return new Vector2(this.x, this.y); }
    static sub(v1, v2) { return new Vector2(v1.x - v2.x, v1.y - v2.y); }
    static dist(v1, v2) { return v1.dist(v2); }
}

function constrain(n, low, high) { return Math.max(Math.min(n, high), low); }
function map(n, start1, stop1, start2, stop2) {
    return ((n - start1) / (stop1 - start1)) * (stop2 - start2) + start2;
}

// --- Simulation Entities ---
class Agent {
    constructor(x, y) {
        this.pos = new Vector2(x, y);
        this.vel = new Vector2(Math.random() * 2 - 1, Math.random() * 2 - 1);
        this.acc = new Vector2(0, 0);
        this.radius = 4;
        this.maxSpeed = 2.5;
        this.maxForce = 0.1;
        this.isPanicking = false;
        this.color = '#3b82f6';
        this.id = Math.random().toString(36).substr(2, 9);
        this.localDensity = 0;
    }

    update() {
        this.vel.add(this.acc);
        this.vel.limit(this.maxSpeed * (this.isPanicking ? 1.5 : 1));
        this.pos.add(this.vel);
        this.acc.mult(0); // reset acceleration each frame

        // Visual update based on state
        if (this.isPanicking) {
            this.color = '#ef4444'; // Red
        } else if (this.localDensity > 5) {
            this.color = '#f59e0b'; // Warning Orange
        } else {
            this.color = '#3b82f6'; // Safe Blue
        }
    }

    applyForce(force) {
        this.acc.add(force);
    }

    // Steering Behaviors
    seek(target) {
        let desired = Vector2.sub(target, this.pos);
        desired.normalize();
        desired.mult(this.maxSpeed * (this.isPanicking ? 1.5 : 1));
        let steer = Vector2.sub(desired, this.vel);
        steer.limit(this.maxForce);
        return steer;
    }

    separate(agents) {
        let desiredSeparation = this.radius * 2.5;
        let steer = new Vector2(0, 0);
        let count = 0;
        this.localDensity = 0;

        for (let i = 0; i < agents.length; i++) {
            let other = agents[i];
            let d = Vector2.dist(this.pos, other.pos);
            if (d > 0 && d < desiredSeparation * 2) {
                this.localDensity++;
            }
            if ((d > 0) && (d < desiredSeparation)) {
                let diff = Vector2.sub(this.pos, other.pos);
                diff.normalize();
                diff.div(d); // Weight by distance
                steer.add(diff);
                count++;
            }
        }
        if (count > 0) {
            steer.div(count);
        }
        if (steer.mag() > 0) {
            steer.normalize();
            steer.mult(this.maxSpeed);
            steer.sub(this.vel);
            steer.limit(this.maxForce * 1.5);
        }

        // Trigger panic based on density and global panic setting
        if (this.localDensity > 8 + Math.random() * 5 - (simEnv.panicLevel / 10)) {
            this.isPanicking = true;
        } else {
            this.isPanicking = false;
        }

        return steer;
    }

    avoidWalls(walls) {
        let steer = new Vector2(0, 0);
        let lookAhead = 30; // distance to look ahead

        // Simple bounding box avoidance for lines
        for (let wall of walls) {
            // Find closest point on wall segment to agent
            let lineVec = Vector2.sub(wall.end, wall.start);
            let agentVec = Vector2.sub(this.pos, wall.start);
            let t = (agentVec.x * lineVec.x + agentVec.y * lineVec.y) / lineVec.magSq();
            t = Math.max(0, Math.min(1, t)); // clamp

            let closestPt = new Vector2(wall.start.x + t * lineVec.x, wall.start.y + t * lineVec.y);
            let dist = Vector2.dist(this.pos, closestPt);

            if (dist < this.radius + 15) {
                let diff = Vector2.sub(this.pos, closestPt);
                diff.normalize();
                diff.mult(this.maxSpeed);
                let avoidForce = Vector2.sub(diff, this.vel);
                avoidForce.limit(this.maxForce * 3);
                steer.add(avoidForce);
            }
        }
        return steer;
    }

    avoidObstacles(obstacles) {
        let steer = new Vector2(0, 0);

        for (let obs of obstacles) {
            let closestX = constrain(this.pos.x, obs.pos.x, obs.pos.x + obs.w);
            let closestY = constrain(this.pos.y, obs.pos.y, obs.pos.y + obs.h);

            let closestPt = new Vector2(closestX, closestY);
            let dist = Vector2.dist(this.pos, closestPt);

            if (dist < this.radius + 15) {
                let diff = Vector2.sub(this.pos, closestPt);
                if (diff.magSq() === 0) {
                    diff = new Vector2(Math.random() - 0.5, Math.random() - 0.5);
                }
                diff.normalize();
                diff.mult(this.maxSpeed);
                let avoidForce = Vector2.sub(diff, this.vel);
                avoidForce.limit(this.maxForce * 3);
                steer.add(avoidForce);
            }
        }
        return steer;
    }

    draw(ctx) {
        ctx.beginPath();
        ctx.arc(this.pos.x, this.pos.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.closePath();
    }
}

class Obstacle {
    constructor(x, y, w, h) {
        this.pos = new Vector2(x, y);
        this.w = w;
        this.h = h;
    }
    draw(ctx) {
        ctx.fillStyle = 'rgba(100, 100, 100, 0.5)';
        ctx.fillRect(this.pos.x, this.pos.y, this.w, this.h);
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 2;
        ctx.strokeRect(this.pos.x, this.pos.y, this.w, this.h);
    }
}

class Shop {
    constructor(x, y, w, h) {
        this.pos = new Vector2(x, y);
        this.w = w;
        this.h = h;
        this.center = new Vector2(x + w / 2, y + h / 2);
    }
    draw(ctx) {
        ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
        ctx.fillRect(this.pos.x, this.pos.y, this.w, this.h);
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.strokeRect(this.pos.x, this.pos.y, this.w, this.h);

        ctx.fillStyle = '#fff';
        ctx.font = '12px Inter';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('SHOP', this.center.x, this.center.y);
    }
}

class Stage {
    constructor(x, y, w, h) {
        this.pos = new Vector2(x, y);
        this.w = w;
        this.h = h;
        this.center = new Vector2(x + w / 2, y + h / 2);
    }
    draw(ctx) {
        ctx.fillStyle = 'rgba(168, 85, 247, 0.2)';
        ctx.fillRect(this.pos.x, this.pos.y, this.w, this.h);
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 2;
        ctx.strokeRect(this.pos.x, this.pos.y, this.w, this.h);

        ctx.fillStyle = '#fff';
        ctx.font = '12px Inter';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('STAGE', this.center.x, this.center.y);
    }
}

class Washroom {
    constructor(x, y, w, h) {
        this.pos = new Vector2(x, y);
        this.w = w;
        this.h = h;
        this.center = new Vector2(x + w / 2, y + h / 2);
    }
    draw(ctx) {
        ctx.fillStyle = 'rgba(20, 184, 166, 0.2)';
        ctx.fillRect(this.pos.x, this.pos.y, this.w, this.h);
        ctx.strokeStyle = '#14b8a6';
        ctx.lineWidth = 2;
        ctx.strokeRect(this.pos.x, this.pos.y, this.w, this.h);

        ctx.fillStyle = '#fff';
        ctx.font = '12px Inter';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('RESTROOM', this.center.x, this.center.y);
    }
}

class Entry {
    constructor(x, y, w, h) {
        this.pos = new Vector2(x, y);
        this.w = w;
        this.h = h;
        this.center = new Vector2(x + w / 2, y + h / 2);
        this.spawnTimer = 0;
    }
    update(simEnv) {
        if (simEnv.isPlaying && !simEnv.isEntryPaused) {
            this.spawnTimer++;
            if (this.spawnTimer > 30) {
                this.spawnTimer = 0;
                let ax = this.pos.x + Math.random() * this.w;
                let ay = this.pos.y + Math.random() * this.h;
                simEnv.agents.push(new Agent(ax, ay));
            }
        }
    }
    draw(ctx) {
        ctx.fillStyle = 'rgba(234, 179, 8, 0.2)';
        ctx.fillRect(this.pos.x, this.pos.y, this.w, this.h);
        ctx.strokeStyle = '#eab308';
        ctx.lineWidth = 2;
        ctx.strokeRect(this.pos.x, this.pos.y, this.w, this.h);

        ctx.fillStyle = '#fff';
        ctx.font = '12px Inter';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('ENTRY', this.center.x, this.center.y);
    }
}

class Wall {
    constructor(x1, y1, x2, y2) {
        this.start = new Vector2(x1, y1);
        this.end = new Vector2(x2, y2);
    }
    draw(ctx) {
        ctx.beginPath();
        ctx.moveTo(this.start.x, this.start.y);
        ctx.lineTo(this.end.x, this.end.y);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.closePath();
    }
}

class Exit {
    constructor(x, y, radius = 30) {
        this.pos = new Vector2(x, y);
        this.radius = radius;
    }
    draw(ctx) {
        ctx.beginPath();
        ctx.arc(this.pos.x, this.pos.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(34, 197, 94, 0.2)';
        ctx.fill();
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.closePath();
    }
}

// --- Main Simulation Engine ---
const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d', { alpha: false });

let simEnv = {
    agents: [],
    walls: [],
    obstacles: [],
    shops: [],
    stages: [],
    washrooms: [],
    entries: [],
    exits: [],
    evacuatedCount: 0,
    isPlaying: true,
    isEvacuating: false,
    isEntryPaused: false,
    panicLevel: 0,
    baseMaxSpeed: 2.5,
    showHeatmap: false,

    // Tools
    currentTool: 'spawn', // spawn, exit, wall, remove
    isDrawing: false,
    drawStart: null,

    // Dimensions
    width: 0,
    height: 0
};

function resize() {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
    simEnv.width = canvas.width;
    simEnv.height = canvas.height;
}
window.addEventListener('resize', resize);
resize();

// Default setup
// Initial elements
function initSim() {
    // Start with a completely blank canvas layout
}

function spawnBlock(x, y, width, height, count) {
    for (let i = 0; i < count; i++) {
        let ax = x + Math.random() * width;
        let ay = y + Math.random() * height;
        simEnv.agents.push(new Agent(ax, ay));
    }
    updateStats();
}

// Initial elements on start
initSim();

// Main Loop
function loop() {
    if (simEnv.isPlaying) {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Grid background
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < canvas.width; i += 50) { ctx.moveTo(i, 0); ctx.lineTo(i, canvas.height); }
        for (let i = 0; i < canvas.height; i += 50) { ctx.moveTo(0, i); ctx.lineTo(canvas.width, i); }
        ctx.stroke();

        simEnv.exits.forEach(e => e.draw(ctx));
        simEnv.walls.forEach(w => w.draw(ctx));
        simEnv.obstacles.forEach(o => o.draw(ctx));
        simEnv.shops.forEach(s => s.draw(ctx));
        simEnv.stages.forEach(s => s.draw(ctx));
        simEnv.washrooms.forEach(w => w.draw(ctx));
        simEnv.entries.forEach(e => { e.update(simEnv); e.draw(ctx); });

        let heatMapData = []; // simplified heatmap

        for (let i = simEnv.agents.length - 1; i >= 0; i--) {
            let a = simEnv.agents[i];

            // Set dynamic properties
            a.maxSpeed = simEnv.baseMaxSpeed;

            // Find closest exit
            let closestExit = null;
            let minDist = Infinity;
            for (let e of simEnv.exits) {
                let d = Vector2.dist(a.pos, e.pos);
                if (d < minDist) {
                    minDist = d;
                    closestExit = e;
                }
            }

            // Evacuation check
            if (simEnv.isEvacuating && closestExit && minDist < closestExit.radius) {
                simEnv.agents.splice(i, 1);
                simEnv.evacuatedCount++;
                updateStats();
                continue;
            }

            // Behaviors
            let sep = a.separate(simEnv.agents);
            let avoid = a.avoidWalls(simEnv.walls);
            let avoidObs = a.avoidObstacles(simEnv.obstacles);
            let avoidShops = a.avoidObstacles(simEnv.shops);
            let avoidStages = a.avoidObstacles(simEnv.stages);
            let avoidWashrooms = a.avoidObstacles(simEnv.washrooms);

            // Boundaries
            if (a.pos.x < 0) avoid.add(new Vector2(1, 0));
            if (a.pos.x > canvas.width) avoid.add(new Vector2(-1, 0));
            if (a.pos.y < 0) avoid.add(new Vector2(0, 1));
            if (a.pos.y > canvas.height) avoid.add(new Vector2(0, -1));

            // Weight behaviors
            sep.mult(1.5);
            avoid.mult(2.5);
            avoidObs.mult(2.5);
            avoidShops.mult(1.5);
            avoidStages.mult(2.5);
            avoidWashrooms.mult(2.0);

            a.applyForce(sep);
            a.applyForce(avoid);
            a.applyForce(avoidObs);
            a.applyForce(avoidShops);
            a.applyForce(avoidStages);
            a.applyForce(avoidWashrooms);

            if (simEnv.isEvacuating && closestExit) {
                let seek = a.seek(closestExit.pos);
                seek.mult(1.0);
                a.applyForce(seek);
            } else if (!simEnv.isEvacuating) {
                // Gentle wander when not evacuating
                let wander = new Vector2(Math.random() - 0.5, Math.random() - 0.5);
                wander.normalize();
                wander.mult(a.maxForce * 0.4);
                a.applyForce(wander);
            }

            a.update();
            a.draw(ctx);

            if (simEnv.showHeatmap) {
                heatMapData.push({ x: a.pos.x, y: a.pos.y });
            }
        }

        // Draw Heatmap Overlay
        if (simEnv.showHeatmap && heatMapData.length > 0) {
            ctx.globalCompositeOperation = 'screen';
            for (let point of heatMapData) {
                let rad = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, 40);
                rad.addColorStop(0, 'rgba(239, 68, 68, 0.05)');
                rad.addColorStop(1, 'rgba(239, 68, 68, 0)');
                ctx.fillStyle = rad;
                ctx.beginPath();
                ctx.arc(point.x, point.y, 40, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalCompositeOperation = 'source-over';
        }

        // Draw drawing interaction
        if (simEnv.isDrawing && simEnv.drawStart) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            if (simEnv.currentTool === 'wall') {
                ctx.moveTo(simEnv.drawStart.x, simEnv.drawStart.y);
                ctx.lineTo(simEnv.mouseX, simEnv.mouseY);
            } else if (simEnv.currentTool === 'square' || simEnv.currentTool === 'shop' || simEnv.currentTool === 'stage' || simEnv.currentTool === 'washroom' || simEnv.currentTool === 'entry') {
                let x = Math.min(simEnv.drawStart.x, simEnv.mouseX);
                let y = Math.min(simEnv.drawStart.y, simEnv.mouseY);
                let w = Math.abs(simEnv.mouseX - simEnv.drawStart.x);
                let h = Math.abs(simEnv.mouseY - simEnv.drawStart.y);
                ctx.strokeRect(x, y, w, h);
            } else if (simEnv.currentTool === 'spawn') {
                ctx.strokeRect(simEnv.drawStart.x, simEnv.drawStart.y, simEnv.mouseX - simEnv.drawStart.x, simEnv.mouseY - simEnv.drawStart.y);
            } else if (simEnv.currentTool === 'exit') {
                let r = Vector2.dist(simEnv.drawStart, new Vector2(simEnv.mouseX, simEnv.mouseY));
                ctx.arc(simEnv.drawStart.x, simEnv.drawStart.y, r, 0, Math.PI * 2);
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }

        updateRiskStatus();
    }
    requestAnimationFrame(loop);
}

// --- UI & Interactions ---

function updateStats() {
    document.getElementById('statActive').innerText = simEnv.agents.length;
    document.getElementById('statEvacuated').innerText = simEnv.evacuatedCount;
}

function updateRiskStatus() {
    let panickingCount = simEnv.agents.filter(a => a.isPanicking).length;
    let riskEl = document.getElementById('statRisk');
    if (panickingCount > simEnv.agents.length * 0.3) {
        riskEl.innerText = 'HIGH';
        riskEl.className = 'stat-value text-danger';
    } else if (panickingCount > simEnv.agents.length * 0.1) {
        riskEl.innerText = 'MEDIUM';
        riskEl.className = 'stat-value text-warning';
    } else {
        riskEl.innerText = 'LOW';
        riskEl.className = 'stat-value text-safe';
    }
}

function showNotification(msg) {
    let container = document.getElementById('notification-area');
    let notif = document.createElement('div');
    notif.className = 'notification';
    notif.innerText = msg;
    container.appendChild(notif);
    setTimeout(() => {
        notif.style.opacity = '0';
        setTimeout(() => notif.remove(), 300);
    }, 3000);
}

// Tool Selection
const tools = document.querySelectorAll('.tool');
const helperText = document.getElementById('helperText');
const toolHelpers = {
    'spawn': 'Click and drag to add a group of agents.',
    'exit': 'Click and drag to size an exit zone.',
    'wall': 'Click and drag to draw a wall line.',
    'square': 'Click and drag to build a solid square obstacle.',
    'shop': 'Click and drag to build a shop zone.',
    'stage': 'Click and drag to build a stage.',
    'washroom': 'Click and drag to add a restroom.',
    'entry': 'Click and drag to add an active entry point.',
    'remove': 'Click near objects to remove them.'
};

tools.forEach(btn => {
    btn.addEventListener('click', (e) => {
        tools.forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        simEnv.currentTool = e.target.dataset.tool;
        helperText.innerText = toolHelpers[simEnv.currentTool];
    });
});

// Canvas Interactions
canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (simEnv.currentTool === 'remove') {
        // Try removing exits
        let exitIndex = simEnv.exits.findIndex(ex => Vector2.dist(ex.pos, new Vector2(x, y)) < ex.radius);
        if (exitIndex > -1) { simEnv.exits.splice(exitIndex, 1); return; }

        // Try removing walls
        let m = new Vector2(x, y);
        let wallIndex = simEnv.walls.findIndex(w => {
            let lineVec = Vector2.sub(w.end, w.start);
            let agentVec = Vector2.sub(m, w.start);
            let t = (agentVec.x * lineVec.x + agentVec.y * lineVec.y) / lineVec.magSq();
            if (t < 0 || t > 1) return false;
            let proj = new Vector2(w.start.x + t * lineVec.x, w.start.y + t * lineVec.y);
            return Vector2.dist(m, proj) < 10;
        });
        if (wallIndex > -1) { simEnv.walls.splice(wallIndex, 1); return; }

        // Try removing obstacles
        let obsIndex = simEnv.obstacles.findIndex(obs =>
            x >= obs.pos.x && x <= obs.pos.x + obs.w && y >= obs.pos.y && y <= obs.pos.y + obs.h
        );
        if (obsIndex > -1) { simEnv.obstacles.splice(obsIndex, 1); return; }

        // Try removing shops
        let shopIndex = simEnv.shops.findIndex(s =>
            x >= s.pos.x && x <= s.pos.x + s.w && y >= s.pos.y && y <= s.pos.y + s.h
        );
        if (shopIndex > -1) { simEnv.shops.splice(shopIndex, 1); return; }

        let stageIndex = simEnv.stages.findIndex(s =>
            x >= s.pos.x && x <= s.pos.x + s.w && y >= s.pos.y && y <= s.pos.y + s.h
        );
        if (stageIndex > -1) { simEnv.stages.splice(stageIndex, 1); return; }

        let washroomIndex = simEnv.washrooms.findIndex(s =>
            x >= s.pos.x && x <= s.pos.x + s.w && y >= s.pos.y && y <= s.pos.y + s.h
        );
        if (washroomIndex > -1) { simEnv.washrooms.splice(washroomIndex, 1); return; }

        let entryIndex = simEnv.entries.findIndex(s =>
            x >= s.pos.x && x <= s.pos.x + s.w && y >= s.pos.y && y <= s.pos.y + s.h
        );
        if (entryIndex > -1) { simEnv.entries.splice(entryIndex, 1); return; }

    } else {
        simEnv.isDrawing = true;
        simEnv.drawStart = new Vector2(x, y);
        simEnv.mouseX = x;
        simEnv.mouseY = y;
    }
});

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    simEnv.mouseX = e.clientX - rect.left;
    simEnv.mouseY = e.clientY - rect.top;
});

canvas.addEventListener('mouseup', (e) => {
    if (!simEnv.isDrawing) return;
    simEnv.isDrawing = false;

    const rect = canvas.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const endY = e.clientY - rect.top;

    if (simEnv.currentTool === 'spawn') {
        let width = Math.abs(endX - simEnv.drawStart.x);
        let height = Math.abs(endY - simEnv.drawStart.y);
        let x = Math.min(simEnv.drawStart.x, endX);
        let y = Math.min(simEnv.drawStart.y, endY);
        if (width > 10 && height > 10) {
            let area = width * height;
            let count = Math.min(200, Math.floor(area / 100)); // Dynamic count based on area
            spawnBlock(x, y, width, height, count);
            showNotification(`Spawned ${count} agents.`);
        }
    } else if (simEnv.currentTool === 'square' || simEnv.currentTool === 'shop' || simEnv.currentTool === 'stage' || simEnv.currentTool === 'washroom' || simEnv.currentTool === 'entry') {
        let width = Math.abs(endX - simEnv.drawStart.x);
        let height = Math.abs(endY - simEnv.drawStart.y);
        let x = Math.min(simEnv.drawStart.x, endX);
        let y = Math.min(simEnv.drawStart.y, endY);

        if (width > 5 && height > 5) {
            if (simEnv.currentTool === 'square') {
                simEnv.obstacles.push(new Obstacle(x, y, width, height));
            } else if (simEnv.currentTool === 'shop') {
                simEnv.shops.push(new Shop(x, y, width, height));
            } else if (simEnv.currentTool === 'stage') {
                simEnv.stages.push(new Stage(x, y, width, height));
            } else if (simEnv.currentTool === 'washroom') {
                simEnv.washrooms.push(new Washroom(x, y, width, height));
            } else if (simEnv.currentTool === 'entry') {
                simEnv.entries.push(new Entry(x, y, width, height));
            }
        }
    } else if (simEnv.currentTool === 'wall') {
        if (Vector2.dist(simEnv.drawStart, new Vector2(endX, endY)) > 10) {
            simEnv.walls.push(new Wall(simEnv.drawStart.x, simEnv.drawStart.y, endX, endY));
        }
    } else if (simEnv.currentTool === 'exit') {
        let radius = Vector2.dist(simEnv.drawStart, new Vector2(endX, endY));
        if (radius > 10) {
            simEnv.exits.push(new Exit(simEnv.drawStart.x, simEnv.drawStart.y, radius));
        }
    }
});

// Transport Controls
document.getElementById('btnPlay').addEventListener('click', (e) => {
    simEnv.isPlaying = true;
    e.target.classList.add('active');
    document.getElementById('btnPause').classList.remove('active');
});
document.getElementById('btnPause').addEventListener('click', (e) => {
    simEnv.isPlaying = false;
    e.target.classList.add('active');
    document.getElementById('btnPlay').classList.remove('active');
});
document.getElementById('btnClear').addEventListener('click', () => {
    simEnv.agents = [];
    simEnv.evacuatedCount = 0;
    simEnv.isEvacuating = false;
    let btnEvacuate = document.getElementById('btnEvacuate');
    btnEvacuate.innerText = "Evacuate";
    if (btnEvacuate.classList.contains('btn-primary')) {
        btnEvacuate.classList.replace('btn-primary', 'btn-danger');
        btnEvacuate.style.background = '#ef4444';
    }
    updateStats();
    showNotification('All agents cleared.');
});

document.getElementById('btnEvacuate').addEventListener('click', (e) => {
    simEnv.isEvacuating = !simEnv.isEvacuating;
    let btn = e.target;
    if (simEnv.isEvacuating) {
        btn.innerText = "Cancel Evacuation";
        btn.classList.replace('btn-danger', 'btn-primary');
        btn.style.background = '';
        showNotification('Evacuation initiated!');
    } else {
        btn.innerText = "Evacuate";
        btn.classList.replace('btn-primary', 'btn-danger');
        btn.style.background = '#ef4444';
        showNotification('Evacuation cancelled.');
    }
});

document.getElementById('btnToggleEntry').addEventListener('click', (e) => {
    simEnv.isEntryPaused = !simEnv.isEntryPaused;
    let btn = e.target;
    if (simEnv.isEntryPaused) {
        btn.innerText = "Resume Entry Points";
        btn.classList.replace('btn-secondary', 'btn-primary');
        showNotification('Entry points paused.');
    } else {
        btn.innerText = "Pause Entry Points";
        btn.classList.replace('btn-primary', 'btn-secondary');
        showNotification('Entry points resumed.');
    }
});

// Settings
const speedSlider = document.getElementById('speedSlider');
const speedVal = document.getElementById('speedVal');
speedSlider.addEventListener('input', (e) => {
    simEnv.baseMaxSpeed = parseFloat(e.target.value);
    speedVal.innerText = simEnv.baseMaxSpeed.toFixed(1);
});

const panicSlider = document.getElementById('panicSlider');
const panicVal = document.getElementById('panicVal');
panicSlider.addEventListener('input', (e) => {
    simEnv.panicLevel = parseInt(e.target.value);
    panicVal.innerText = simEnv.panicLevel + '%';
});

const heatmapToggle = document.getElementById('heatmapToggle');
heatmapToggle.addEventListener('change', (e) => {
    simEnv.showHeatmap = e.target.checked;
});

// --- OpenStreetMap Integration ---
const btnImportMap = document.getElementById('btnImportMap');
const mapModal = document.getElementById('mapModal');
const btnCloseMap = document.getElementById('btnCloseMap');
const mapSearchInput = document.getElementById('mapSearchInput');
const btnMapSearch = document.getElementById('btnMapSearch');
const btnClearMap = document.getElementById('btnClearMap');
const btnImportBoundary = document.getElementById('btnImportBoundary');

let osmMap = null;
let venuePoints = [];
let venuePolygon = null;
let venueMarkers = [];

function initOsmMap() {
    if (osmMap) {
        osmMap.invalidateSize();
        return;
    }
    osmMap = L.map('osm-map').setView([51.505, -0.09], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(osmMap);

    osmMap.on('click', (e) => {
        let latlng = e.latlng;
        venuePoints.push(latlng);
        let marker = L.circleMarker(latlng, { radius: 5, color: '#ef4444', fillOpacity: 1 }).addTo(osmMap);
        venueMarkers.push(marker);

        if (venuePolygon) {
            osmMap.removeLayer(venuePolygon);
        }
        if (venuePoints.length > 1) {
            // Automatically close the polygon back to the first point visually
            venuePolygon = L.polygon([...venuePoints, venuePoints[0]], { color: '#3b82f6', fillOpacity: 0.2 }).addTo(osmMap);
        }
    });
}

btnImportMap.addEventListener('click', () => {
    mapModal.classList.remove('hidden');
    setTimeout(initOsmMap, 100);
});

btnCloseMap.addEventListener('click', () => {
    mapModal.classList.add('hidden');
});

btnMapSearch.addEventListener('click', async () => {
    let query = mapSearchInput.value;
    if (!query) return;
    try {
        let res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
        let data = await res.json();
        if (data && data.length > 0) {
            let item = data[0];
            osmMap.flyTo([item.lat, item.lon], 16);
            mapSearchInput.value = '';
        } else {
            alert('Location not found');
        }
    } catch (e) {
        alert('Error searching for location');
    }
});

btnClearMap.addEventListener('click', () => {
    venuePoints = [];
    venueMarkers.forEach(m => osmMap.removeLayer(m));
    venueMarkers = [];
    if (venuePolygon) osmMap.removeLayer(venuePolygon);
    venuePolygon = null;
});

btnImportBoundary.addEventListener('click', () => {
    if (venuePoints.length < 3) {
        alert('Please drop at least 3 pins to form a venue boundary.');
        return;
    }

    // Project geographic coordinates to web mercator pixels at fixed zoom
    let projectedPoints = venuePoints.map(latlng => osmMap.project(latlng, 18));

    // Find geographical bounding box in projected space
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    projectedPoints.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    });

    let w = maxX - minX;
    let h = maxY - minY;
    let centerX = minX + w / 2;
    let centerY = minY + h / 2;

    // Fit boundary inside a safe margin of the canvas (80%)
    let targetW = canvas.width * 0.8;
    let targetH = canvas.height * 0.8;
    let scale = Math.min(targetW / w, targetH / h);

    // Transform coordinates
    let canvasPoints = projectedPoints.map(p => {
        return new Vector2(
            canvas.width / 2 + (p.x - centerX) * scale,
            canvas.height / 2 + (p.y - centerY) * scale
        );
    });

    // Create walls from continuous loop
    for (let i = 0; i < canvasPoints.length; i++) {
        let p1 = canvasPoints[i];
        let p2 = canvasPoints[(i + 1) % canvasPoints.length];
        simEnv.walls.push(new Wall(p1.x, p1.y, p2.x, p2.y));
    }

    showNotification('Map boundary generated on canvas!');
    mapModal.classList.add('hidden');
});

// Start simulation
requestAnimationFrame(loop);
updateStats();
