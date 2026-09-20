const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const fedEl = document.getElementById('fedCount');
const startScreen = document.getElementById('startScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const finalScoreEl = document.getElementById('finalScore');

const CANVAS_W = canvas.width;
const CANVAS_H = canvas.height;

/* ============================
   SIMPLE AUDIO ENGINE
   ============================ */
const AudioEngine = (() => {
    let ctxAudio = null;

    function getCtx() {
        if (!ctxAudio) {
            ctxAudio = new(window.AudioContext || window.webkitAudioContext)();
        }
        if (ctxAudio.state === 'suspended') ctxAudio.resume();
        return ctxAudio;
    }

    function tone(freq, duration, type = 'sine', startGain = 0.15, glideTo = null) {
        const ac = getCtx();
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ac.currentTime);
        if (glideTo) {
            osc.frequency.exponentialRampToValueAtTime(glideTo, ac.currentTime + duration);
        }
        gain.gain.setValueAtTime(startGain, ac.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.start();
        osc.stop(ac.currentTime + duration);
    }

    return {
        flap: () => tone(400, 0.08, 'square', 0.12, 550),
        eatGrow: () => tone(300, 0.12, 'triangle', 0.15, 500),
        eatShrink: () => tone(500, 0.12, 'triangle', 0.15, 280),
        eatSuper: () => {
            tone(300, 0.15, 'sawtooth', 0.15, 700);
            setTimeout(() => tone(500, 0.15, 'sawtooth', 0.12, 900), 90);
            setTimeout(() => tone(700, 0.2, 'sawtooth', 0.1, 1100), 180);
        },
        score: () => tone(700, 0.1, 'sine', 0.1, 900),
        hit: () => tone(120, 0.3, 'sawtooth', 0.2, 60),
        bounce: () => tone(200, 0.1, 'sine', 0.12, 150),
        start: () => tone(440, 0.15, 'sine', 0.12, 660)
    };
})();

/* ============================
   GAME STATE
   ============================ */
let gameState = 'start';
let score = 0;
let bestScore = 0;
let fedCount = 0;

const bird = {
    x: 80,
    y: CANVAS_H / 2,
    baseSize: 24,
    size: 24,
    velocity: 0,
    gravity: 0.5,
    jumpStrength: -8.5,
    rotation: 0,
    squashX: 1,
    squashY: 1,
    invincible: false,
    invincibleTimer: 0
};

const MIN_BIRD_SIZE = 14;
const MAX_BIRD_SIZE = 52;
const GROW_AMOUNT = 3;
const SHRINK_AMOUNT = 3;
const SUPER_GROW_AMOUNT = 9; // multiplier effect (3x normal)
const INVINCIBLE_DURATION = 300; // frames (~5s at 60fps)
const MOVING_BUILDING_SCORE_MIN = 30;
const MOVING_BUILDING_SCORE_MAX = 50;

const FOOD_TYPES = [
    { emoji: '🍕', effect: 'grow' },
    { emoji: '🍔', effect: 'grow' },
    { emoji: '🍩', effect: 'grow' },
    { emoji: '🍗', effect: 'grow' },
    { emoji: '🧁', effect: 'grow' },
    { emoji: '🌭', effect: 'grow' },
    { emoji: '🍪', effect: 'grow' },
    { emoji: '🍎', effect: 'shrink' },
    { emoji: '🥦', effect: 'shrink' },
    { emoji: '🥕', effect: 'shrink' },
    { emoji: '🍇', effect: 'shrink' },
    { emoji: '🥬', effect: 'shrink' },
    { emoji: '🍋', effect: 'shrink' }


];

const SUPER_FOOD_CHANCE = 0.12; // 12% chance a spawned food is "super"
const SUPER_FOOD = [{ emoji: '🌟', effect: 'super' }, { emoji: '⚡', effect: 'super' }];


let pipes = [];
const pipeWidth = 60;
const pipeGap = 150;
const pipeSpeed = 2.5;
let pipeSpawnTimer = 0;
const pipeSpawnInterval = 90;

const BUILDING_PALETTES = [
    { body: '#3a3a52', trim: '#2c2c44', window: '#ffd97d' },
    { body: '#4a3f5c', trim: '#372e47', window: '#ffb84d' },
    { body: '#2f4858', trim: '#22343f', window: '#ffe08a' },
    { body: '#523f5c', trim: '#3e2f47', window: '#ffcf6b' },
    { body: '#3d3d5c', trim: '#2b2b45', window: '#ffdb8a' }
];

const skyline = [];

function generateSkyline() {
    skyline.length = 0;
    let x = 0;
    while (x < CANVAS_W) {
        const w = 30 + Math.random() * 40;
        const h = 60 + Math.random() * 120;
        skyline.push({ x, w, h });
        x += w + 5;
    }
}
generateSkyline();

// Rainbow hue for invincibility aura
let rainbowHue = 0;

function resetGame() {
    bird.y = CANVAS_H / 2;
    bird.size = bird.baseSize;
    bird.velocity = 0;
    bird.rotation = 0;
    bird.squashX = 1;
    bird.squashY = 1;
    bird.invincible = false;
    bird.invincibleTimer = 0;
    pipes = [];
    score = 0;
    fedCount = 0;
    pipeSpawnTimer = 0;
    scoreEl.textContent = score;
    fedEl.textContent = `Fed: ${fedCount}`;
}

function triggerBounce(intensity = 1) {
    // Squash effect: flatten then spring back
    bird.squashX = 1 + 0.35 * intensity;
    bird.squashY = 1 - 0.35 * intensity;
}

function flap() {
    if (gameState === 'start') {
        gameState = 'playing';
        startScreen.classList.add('hidden');
        resetGame();
        bird.velocity = bird.jumpStrength;
        AudioEngine.start();
    } else if (gameState === 'playing') {
        bird.velocity = bird.jumpStrength;
        bird.squashX = 0.85;
        bird.squashY = 1.15;
        AudioEngine.flap();
    } else if (gameState === 'gameover') {
        gameState = 'playing';
        gameOverScreen.classList.add('hidden');
        resetGame();
        bird.velocity = bird.jumpStrength;
        AudioEngine.start();
    }
}

document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        flap();
    }
});
canvas.addEventListener('click', flap);
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    flap();
});

function spawnPipe() {
    const minTop = 50;
    const maxTop = CANVAS_H - pipeGap - 50;
    const topHeight = Math.floor(Math.random() * (maxTop - minTop + 1)) + minTop;
    const palette = BUILDING_PALETTES[Math.floor(Math.random() * BUILDING_PALETTES.length)];

    let foodDef;
    if (Math.random() < SUPER_FOOD_CHANCE) {
        foodDef = SUPER_FOOD[Math.floor(Math.random() * SUPER_FOOD.length)];
    } else {
        foodDef = FOOD_TYPES[Math.floor(Math.random() * FOOD_TYPES.length)];
    }

    // Decide if this building pair moves vertically (only once score is high enough)
    const canMove = score >= MOVING_BUILDING_SCORE_MIN && Math.random() < 0.35;
    const moveRange = 40 + Math.random() * 30;
    const moveSpeed = 0.02 + Math.random() * 0.02;

    pipes.push({
        x: CANVAS_W,
        baseTopHeight: topHeight,
        topHeight: topHeight,
        bottomY: topHeight + pipeGap,
        passed: false,
        palette: palette,
        moving: canMove,
        moveRange: moveRange,
        moveSpeed: moveSpeed,
        movePhase: Math.random() * Math.PI * 2,
        food: {
            emoji: foodDef.emoji,
            effect: foodDef.effect,
            eaten: false,
            radius: foodDef.effect === 'super' ? 18 : 14
        }
    });
}

function updateBird() {
    bird.velocity += bird.gravity;
    bird.y += bird.velocity;
    bird.rotation = Math.min(Math.max(bird.velocity * 3, -25), 90);

    // Ease squash/stretch back to normal
    bird.squashX += (1 - bird.squashX) * 0.2;
    bird.squashY += (1 - bird.squashY) * 0.2;

    if (bird.invincible) {
        bird.invincibleTimer--;
        if (bird.invincibleTimer <= 0) {
            bird.invincible = false;
        }
    }

    if (bird.y + bird.size / 2 > CANVAS_H) {
        bird.y = CANVAS_H - bird.size / 2;
        triggerBounce(1.5);
        AudioEngine.bounce();
        endGame();
    }
    if (bird.y - bird.size / 2 < 0) {
        bird.y = bird.size / 2;
        bird.velocity = 0;
        triggerBounce(0.8);
        AudioEngine.bounce();
    }
}

function updatePipes() {
    pipeSpawnTimer++;
    if (pipeSpawnTimer >= pipeSpawnInterval) {
        spawnPipe();
        pipeSpawnTimer = 0;
    }

    for (let i = pipes.length - 1; i >= 0; i--) {
        const pipe = pipes[i];
        pipe.x -= pipeSpeed;

        // Vertical movement for special buildings
        if (pipe.moving) {
            pipe.movePhase += pipe.moveSpeed;
            const offset = Math.sin(pipe.movePhase) * pipe.moveRange;
            pipe.topHeight = pipe.baseTopHeight + offset;
            pipe.bottomY = pipe.topHeight + pipeGap;
        }

        if (!pipe.passed && pipe.x + pipeWidth < bird.x) {
            pipe.passed = true;
            score++;
            scoreEl.textContent = score;
            AudioEngine.score();
        }

        const birdLeft = bird.x - bird.size / 2;
        const birdRight = bird.x + bird.size / 2;
        const birdTop = bird.y - bird.size / 2;
        const birdBottom = bird.y + bird.size / 2;

        const pipeLeft = pipe.x;
        const pipeRight = pipe.x + pipeWidth;

        if (!bird.invincible && birdRight > pipeLeft && birdLeft < pipeRight) {
            if (birdTop < pipe.topHeight || birdBottom > pipe.bottomY) {
                triggerBounce(1.5);
                AudioEngine.hit();
                endGame();
            }
        }

        if (!pipe.food.eaten) {
            const foodX = pipe.x + pipeWidth / 2;
            const foodY = pipe.topHeight + pipeGap / 2;
            const dx = bird.x - foodX;
            const dy = bird.y - foodY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < bird.size / 2 + pipe.food.radius) {
                pipe.food.eaten = true;
                fedCount++;
                fedEl.textContent = `Fed: ${fedCount}`;
                triggerBounce(0.6);

                if (pipe.food.effect === 'grow') {
                    bird.size = Math.min(MAX_BIRD_SIZE, bird.size + GROW_AMOUNT);
                    AudioEngine.eatGrow();
                } else if (pipe.food.effect === 'shrink') {
                    bird.size = Math.max(MIN_BIRD_SIZE, bird.size - SHRINK_AMOUNT);
                    AudioEngine.eatShrink();
                } else if (pipe.food.effect === 'super') {
                    bird.size = Math.min(MAX_BIRD_SIZE, bird.size + SUPER_GROW_AMOUNT);
                    bird.invincible = true;
                    bird.invincibleTimer = INVINCIBLE_DURATION;
                    AudioEngine.eatSuper();
                }
            }
        }

        if (pipe.x + pipeWidth < 0) {
            pipes.splice(i, 1);
        }
    }
}

function endGame() {
    if (gameState !== 'playing') return;
    // Invincibility protects from building collisions, but not from ground/ceiling in this version
    gameState = 'gameover';
    bestScore = Math.max(bestScore, score);
    finalScoreEl.textContent = `Score: ${score}  |  Best: ${bestScore}  |  Fed: ${fedCount}`;
    gameOverScreen.classList.remove('hidden');
}

function drawBird() {
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate((bird.rotation * Math.PI) / 180);
    ctx.scale(bird.squashX, bird.squashY);

    // Rainbow invincibility aura
    if (bird.invincible) {
        rainbowHue = (rainbowHue + 4) % 360;
        const auraRadius = bird.size / 2 + 10;
        const grad = ctx.createRadialGradient(0, 0, bird.size / 4, 0, 0, auraRadius);
        grad.addColorStop(0, `hsla(${rainbowHue}, 100%, 60%, 0.6)`);
        grad.addColorStop(0.5, `hsla(${(rainbowHue + 120) % 360}, 100%, 60%, 0.4)`);
        grad.addColorStop(1, `hsla(${(rainbowHue + 240) % 360}, 100%, 60%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, auraRadius, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.ellipse(0, 0, bird.size / 2, bird.size / 2 - 2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f5a623';
    ctx.beginPath();
    ctx.ellipse(-bird.size * 0.17, bird.size * 0.17, bird.size * 0.33, bird.size * 0.2, 0.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(bird.size * 0.25, -bird.size * 0.17, bird.size * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(bird.size * 0.33, -bird.size * 0.17, bird.size * 0.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ff6b35';
    ctx.beginPath();
    ctx.moveTo(bird.size / 2 - 2, -2);
    ctx.lineTo(bird.size / 2 + 8, 2);
    ctx.lineTo(bird.size / 2 - 2, 6);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}

function drawBuilding(x, y, w, h, palette, isMoving) {
    ctx.fillStyle = palette.body;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = isMoving ? '#ff6b9d' : palette.trim;
    ctx.lineWidth = isMoving ? 3 : 2;
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = isMoving ? '#ff6b9d' : palette.trim;
    ctx.fillRect(x - 4, y, w + 8, 8);

    const winW = 8,
        winH = 10,
        padX = 6,
        padY = 12;
    const cols = Math.floor((w - padX) / (winW + padX));
    const rows = Math.floor((h - padY - 10) / (winH + padY));
    ctx.fillStyle = palette.window;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if ((r * 7 + c * 13 + Math.floor(x)) % 5 === 0) continue;
            const wx = x + padX + c * (winW + padX);
            const wy = y + 10 + padY + r * (winH + padY);
            ctx.fillRect(wx, wy, winW, winH);
        }
    }
}

function drawPipes() {
    pipes.forEach(pipe => {
        drawBuilding(pipe.x, 0, pipeWidth, pipe.topHeight, pipe.palette, pipe.moving);
        const bottomHeight = CANVAS_H - pipe.bottomY;
        drawBuilding(pipe.x, pipe.bottomY, pipeWidth, bottomHeight, pipe.palette, pipe.moving);

        if (!pipe.food.eaten) {
            const foodX = pipe.x + pipeWidth / 2;
            const foodY = pipe.topHeight + pipeGap / 2;

            if (pipe.food.effect === 'super') {
                // Pulsing glow ring behind super food
                const pulse = 18 + Math.sin(Date.now() / 120) * 4;
                rainbowHue = (rainbowHue + 2) % 360;
                const glow = ctx.createRadialGradient(foodX, foodY, 4, foodX, foodY, pulse);
                glow.addColorStop(0, `hsla(${rainbowHue}, 100%, 65%, 0.7)`);
                glow.addColorStop(1, `hsla(${rainbowHue}, 100%, 65%, 0)`);
                ctx.fillStyle = glow;
                ctx.beginPath();
                ctx.arc(foodX, foodY, pulse, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.font = pipe.food.effect === 'super' ? '24px Arial' : '28px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(pipe.food.emoji, foodX, foodY);
        }
    });
}

function drawSunsetSky() {
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, '#3b2f5e');
    grad.addColorStop(0.35, '#7a4a6f');
    grad.addColorStop(0.6, '#e0685a');
    grad.addColorStop(0.8, '#f4a259');
    grad.addColorStop(1, '#f7d68a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const sunY = CANVAS_H * 0.42;
    const sunGrad = ctx.createRadialGradient(CANVAS_W / 2, sunY, 5, CANVAS_W / 2, sunY, 60);
    sunGrad.addColorStop(0, '#fff6d5');
    sunGrad.addColorStop(1, 'rgba(255,214,138,0)');
    ctx.fillStyle = sunGrad;
    ctx.beginPath();
    ctx.arc(CANVAS_W / 2, sunY, 60, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffe6a7';
    ctx.beginPath();
    ctx.arc(CANVAS_W / 2, sunY, 32, 0, Math.PI * 2);
    ctx.fill();
}

function drawSkyline() {
    ctx.fillStyle = 'rgba(30, 20, 45, 0.55)';
    skyline.forEach(b => {
        ctx.fillRect(b.x, CANVAS_H - b.h - 10, b.w, b.h);
    });
}

function draw() {
    drawSunsetSky();
    drawSkyline();
    drawPipes();
    drawBird();

    ctx.fillStyle = '#26232f';
    ctx.fillRect(0, CANVAS_H - 10, CANVAS_W, 10);

    // Invincibility timer indicator
    if (bird.invincible) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('⭐ INVINCIBLE ⭐', CANVAS_W / 2, CANVAS_H - 25);
    }
}

function gameLoop() {
    if (gameState === 'playing') {
        updateBird();
        updatePipes();
    }
    draw();
    requestAnimationFrame(gameLoop);
}

gameLoop();