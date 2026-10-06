const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const fedEl = document.getElementById('fedCount');
const multiplierEl = document.getElementById('multiplier');
const rebirthEl = document.getElementById('rebirthCount');
const startScreen = document.getElementById('startScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const finalScoreEl = document.getElementById('finalScore');
const playerNameInput = document.getElementById('playerNameInput');
const leaderboardListEl = document.getElementById('leaderboardList');

const CANVAS_W = canvas.width;
const CANVAS_H = canvas.height;

function setText(el, text) {
    if (el) el.textContent = text;
}

/* ============================
   LEADERBOARD (localStorage — persists per browser/device, not shared online)
   ============================ */
const LEADERBOARD_KEY = 'flaffyBirdLeaderboard';
const LAST_NAME_KEY = 'flaffyBirdLastName';
const LEADERBOARD_MAX_ENTRIES = 10;

function loadLeaderboard() {
    try {
        const raw = localStorage.getItem(LEADERBOARD_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return []; // storage blocked/corrupted — fail gracefully, never crash the game over this
    }
}

function saveLeaderboard(entries) {
    try {
        localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(entries));
    } catch (e) {
        // storage full or disabled (e.g. private browsing) — ignore, not critical to gameplay
    }
}

// Minimal HTML-escaping so a player name can never inject markup into the list.
function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch]));
}

// Each name keeps only ITS OWN best score — an independent personal record,
// not a running history of every attempt (per your "independent record" ask).
function updateLeaderboard(name, finalScore, rebirths) {
    const cleanName = (name || '').trim() || 'Anonymous';
    const entries = loadLeaderboard();
    const key = cleanName.toLowerCase();
    const existingIndex = entries.findIndex(e => e.name.trim().toLowerCase() === key);

    if (existingIndex >= 0) {
        if (finalScore > entries[existingIndex].score) {
            entries[existingIndex].score = finalScore;
            entries[existingIndex].rebirths = rebirths;
        }
    } else {
        entries.push({ name: cleanName, score: finalScore, rebirths });
    }

    entries.sort((a, b) => b.score - a.score);
    const trimmed = entries.slice(0, LEADERBOARD_MAX_ENTRIES);
    saveLeaderboard(trimmed);
    return trimmed;
}

function renderLeaderboard() {
    if (!leaderboardListEl) return;
    const entries = loadLeaderboard();
    if (entries.length === 0) {
        leaderboardListEl.innerHTML = '<li class="leaderboard-empty">No scores yet — be the first!</li>';
        return;
    }
    leaderboardListEl.innerHTML = entries
        .map((e, i) => `<li><span class="lb-rank">#${i + 1}</span><span class="lb-name">${escapeHtml(e.name)}</span><span class="lb-score">${e.score}</span></li>`)
        .join('');
}

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
        eatSuper: () => {
            tone(300, 0.15, 'sawtooth', 0.15, 700);
            setTimeout(() => tone(500, 0.15, 'sawtooth', 0.12, 900), 90);
            setTimeout(() => tone(700, 0.2, 'sawtooth', 0.1, 1100), 180);
        },
        eatLightning: () => {
            tone(600, 0.05, 'square', 0.15, 900);
            setTimeout(() => tone(900, 0.05, 'square', 0.12, 1200), 40);
            setTimeout(() => tone(1200, 0.08, 'square', 0.1, 1500), 80);
        },
        rebirth: () => {
            tone(440, 0.1, 'sine', 0.15, 660);
            setTimeout(() => tone(660, 0.1, 'sine', 0.13, 880), 80);
            setTimeout(() => tone(880, 0.15, 'sine', 0.12, 1320), 160);
            setTimeout(() => tone(1320, 0.2, 'triangle', 0.1, 1760), 240);
        },
        score: () => tone(700, 0.1, 'sine', 0.1, 900),
        dieBuilding: () => {
            tone(180, 0.1, 'square', 0.2, 60);
            setTimeout(() => tone(140, 0.15, 'sawtooth', 0.18, 50), 60);
            setTimeout(() => tone(90, 0.25, 'sawtooth', 0.16, 40), 130);
        },
        dieGround: () => {
            tone(100, 0.08, 'sine', 0.2, 70);
            setTimeout(() => tone(70, 0.3, 'triangle', 0.22, 35), 50);
            setTimeout(() => tone(45, 0.35, 'sine', 0.18, 25), 150);
        },
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
let rebirthCount = 0;
let multiplier = 1.0;
let currentPlayerName = 'Anonymous';
const MULTIPLIER_STEP = 0.1;

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
    invincibleTimer: 0,
    superType: null,
    lightningPipesRemaining: 0
};

const MAX_BIRD_SIZE = 52;
// Growth slowed down (was 3 / 9) so Flaffy takes roughly twice as much junk
// food to reach max size — he won't balloon in the first few bites anymore.
const GROW_AMOUNT = 1.5;
const SUPER_GROW_AMOUNT = 2.5; // kept at 3x normal, same ratio as before
const INVINCIBLE_DURATION = 300;
const MOVING_BUILDING_SCORE_MIN = 50;
const MOVING_BUILDING_SCORE_MAX = 500;

const SPEED_BOOST_MULTIPLIER = 2.2;
const LIGHTNING_SPAWN_INTERVAL = 45;
const LIGHTNING_GUARANTEED_PIPES = 5;
const LIGHTNING_BONUS_POINTS = 5;
const FOOD_BASE_POINTS = 1;

const REBIRTH_SCORE_INTERVAL = 30;
const REBIRTH_BONUS_POINTS = 15; // must stay < REBIRTH_SCORE_INTERVAL — see checkRebirth() note
const REBIRTH_SAFETY_CAP = 20;
let rebirthThreshold = REBIRTH_SCORE_INTERVAL;

const FOOD_TYPES = [
    { emoji: '🍕', effect: 'grow' },
    { emoji: '🍔', effect: 'grow' },
    { emoji: '🍩', effect: 'grow' },
    { emoji: '🍗', effect: 'grow' },
    { emoji: '🧁', effect: 'grow' },
    { emoji: '🌭', effect: 'grow' },
    { emoji: '🍪', effect: 'grow' }
];

const SUPER_FOOD_CHANCE = 0.12;
const LIGHTNING_CHANCE_WITHIN_SUPER = 0.35;

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
const SKYLINE_PARALLAX = 0.35;
let bgOffsetX = 0;
let skylineTileWidth = 0;

function generateSkyline() {
    skyline.length = 0;
    let x = 0;
    while (x < CANVAS_W) {
        const w = 30 + Math.random() * 40;
        const h = 60 + Math.random() * 120;
        skyline.push({ x, w, h });
        x += w + 5;
    }
    skylineTileWidth = x;
}
generateSkyline();

let rainbowHue = 0;

/* ============================
   SCORE POPUPS
   ============================ */
let scorePopups = [];
const POPUP_LIFETIME = 50;
const POPUP_RISE_DISTANCE = 40;

const POPUP_LABEL_COLORS = {
    Junk: '#ffb84d',
    Lightning: '#fff066',
    Rebirth: '#ffffff',
    Star: null
};

function spawnScorePopup(x, y, value, label, multiplierDelta) {
    scorePopups.push({
        x,
        y,
        value: Math.round(value),
        label,
        multiplierDelta,
        age: 0
    });
}

function updateScorePopups(delta) {
    for (let i = scorePopups.length - 1; i >= 0; i--) {
        const p = scorePopups[i];
        p.age += delta;
        if (p.age >= POPUP_LIFETIME) {
            scorePopups.splice(i, 1);
        }
    }
}

function drawScorePopups() {
    scorePopups.forEach(p => {
        const progress = Math.min(1, p.age / POPUP_LIFETIME);
        const alpha = 1 - progress;
        const riseY = p.y - progress * POPUP_RISE_DISTANCE;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';

        const valueColor = p.value > 0 ? '#7CFC00' : (p.value < 0 ? '#ff5c5c' : '#ffffff');
        const sign = p.value > 0 ? '+' : '';
        ctx.fillStyle = valueColor;
        ctx.font = 'bold 18px Arial';
        ctx.fillText(`${sign}${p.value}`, p.x, riseY - 18);

        let labelColor = POPUP_LABEL_COLORS[p.label];
        if (p.label === 'Star') {
            labelColor = `hsl(${rainbowHue}, 100%, 70%)`;
        }
        ctx.fillStyle = labelColor || '#ffffff';
        ctx.font = 'bold 12px Arial';
        ctx.fillText(p.label, p.x, riseY - 4);

        if (p.multiplierDelta) {
            const mSign = p.multiplierDelta > 0 ? '+' : '-';
            ctx.fillStyle = p.multiplierDelta > 0 ? '#7CFC00' : '#ff5c5c';
            ctx.font = 'bold 11px Arial';
            ctx.fillText(`${mSign}x${Math.abs(p.multiplierDelta).toFixed(2)}`, p.x, riseY + 11);
        }

        ctx.restore();
    });
}

function applyMultiplierChange(effect) {
    if (effect === 'grow') {
        multiplier += MULTIPLIER_STEP;
    }
    multiplier = Math.round(multiplier / MULTIPLIER_STEP) * MULTIPLIER_STEP;
    multiplier = Math.round(multiplier * 100) / 100;
    setText(multiplierEl, `Food Multiplier: x${multiplier.toFixed(2)}`);
}

function awardScore(amount) {
    score += amount;
    setText(scoreEl, Math.round(score));
    checkRebirth();
}

function checkRebirth() {
    let safety = 0;
    while (score >= rebirthThreshold) {
        triggerRebirth(bird.x, bird.y - bird.size / 2 - 10);
        rebirthThreshold += REBIRTH_SCORE_INTERVAL;
        safety++;
        if (safety >= REBIRTH_SAFETY_CAP) break;
    }
}

function triggerRebirth(x, y) {
    bird.size = bird.baseSize;
    multiplier = 1.0;
    rebirthCount++;
    setText(multiplierEl, `Food Multiplier: x${multiplier.toFixed(2)}`);
    setText(rebirthEl, `Rebirths: ${rebirthCount}`);

    const bonus = REBIRTH_BONUS_POINTS * multiplier;
    score += bonus;
    setText(scoreEl, Math.round(score));
    spawnScorePopup(x, y, bonus, 'Rebirth', 0);
    AudioEngine.rebirth();
    triggerBounce(1.2);
}

function resetGame() {
    bird.y = CANVAS_H / 2;
    bird.size = bird.baseSize;
    bird.velocity = 0;
    bird.rotation = 0;
    bird.squashX = 1;
    bird.squashY = 1;
    bird.invincible = false;
    bird.invincibleTimer = 0;
    bird.superType = null;
    bird.lightningPipesRemaining = 0;
    pipes = [];
    scorePopups = [];
    score = 0;
    fedCount = 0;
    rebirthCount = 0;
    rebirthThreshold = REBIRTH_SCORE_INTERVAL;
    multiplier = 1.0;
    pipeSpawnTimer = 0;
    bgOffsetX = 0;
    setText(scoreEl, score);
    setText(fedEl, `Food Eaten: ${fedCount}`);
    setText(multiplierEl, `Food Multiplier: x${multiplier.toFixed(2)}`);
    setText(rebirthEl, `Rebirths: ${rebirthCount}`);
}

function triggerBounce(intensity = 1) {
    bird.squashX = 1 + 0.35 * intensity;
    bird.squashY = 1 - 0.35 * intensity;
}

function flap() {
    if (gameState === 'start') {
        currentPlayerName = (playerNameInput && playerNameInput.value.trim()) || 'Anonymous';
        try {
            localStorage.setItem(LAST_NAME_KEY, currentPlayerName);
        } catch (e) {
            // ignore — not critical
        }
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
        // Return to the intro screen (with the just-updated leaderboard) first,
        // rather than restarting instantly — a second tap/space then begins
        // the next run. See the message above this code for the tradeoff.
        gameState = 'start';
        gameOverScreen.classList.add('hidden');
        renderLeaderboard();
        startScreen.classList.remove('hidden');
    }
}

document.addEventListener('keydown', (e) => {
    if (document.activeElement === playerNameInput) return; // let typing (incl. spaces) work normally
    if (e.code === 'Space') {
        e.preventDefault();
        flap();
    }
});

document.addEventListener('pointerdown', (e) => {
    if (e.target === playerNameInput) return; // let the player tap/focus the name field
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
        if (Math.random() < LIGHTNING_CHANCE_WITHIN_SUPER) {
            foodDef = { emoji: '⚡', effect: 'super', superType: 'lightning' };
        } else {
            foodDef = { emoji: '🌟', effect: 'super', superType: 'star' };
        }
    } else {
        foodDef = FOOD_TYPES[Math.floor(Math.random() * FOOD_TYPES.length)];
    }

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
            superType: foodDef.superType || null,
            eaten: false,
            radius: foodDef.effect === 'super' ? 18 : 14
        }
    });
}

function updateBird(delta) {
    bird.velocity += bird.gravity * delta;
    bird.y += bird.velocity * delta;
    bird.rotation = Math.min(Math.max(bird.velocity * 3, -25), 90);

    bird.squashX += (1 - bird.squashX) * 0.2;
    bird.squashY += (1 - bird.squashY) * 0.2;

    if (bird.invincible) {
        bird.invincibleTimer -= delta;
        if (bird.invincibleTimer <= 0) {
            bird.invincible = false;
            bird.superType = null;
            bird.lightningPipesRemaining = 0;
        }
    }

    if (bird.y + bird.size / 2 > CANVAS_H) {
        bird.y = CANVAS_H - bird.size / 2;
        triggerBounce(1.5);
        AudioEngine.dieGround();
        endGame();
    }
    if (bird.y - bird.size / 2 < 0) {
        bird.y = bird.size / 2;
        bird.velocity = 0;
        triggerBounce(0.8);
        AudioEngine.bounce();
    }
}

function updatePipes(delta) {
    const lightningBoost = bird.invincible && bird.superType === 'lightning';
    const effectiveSpawnInterval = lightningBoost ? LIGHTNING_SPAWN_INTERVAL : pipeSpawnInterval;
    const effectiveSpeed = lightningBoost ? pipeSpeed * SPEED_BOOST_MULTIPLIER : pipeSpeed;
    bgOffsetX += effectiveSpeed * delta;

    pipeSpawnTimer += delta;
    if (pipeSpawnTimer >= effectiveSpawnInterval) {
        spawnPipe();
        pipeSpawnTimer = 0;
    }

    for (let i = pipes.length - 1; i >= 0; i--) {
        const pipe = pipes[i];
        pipe.x -= effectiveSpeed * delta;

        if (pipe.moving) {
            pipe.movePhase += pipe.moveSpeed * delta;
            const offset = Math.sin(pipe.movePhase) * pipe.moveRange;
            pipe.topHeight = pipe.baseTopHeight + offset;
            pipe.bottomY = pipe.topHeight + pipeGap;
        }

        if (!pipe.passed && pipe.x + pipeWidth < bird.x) {
            pipe.passed = true;
            awardScore(1 * multiplier);
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
                AudioEngine.dieBuilding();
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
                setText(fedEl, `Food Eaten: ${fedCount}`);
                triggerBounce(0.6);

                const multiplierAtHit = multiplier;
                let rawPoints = FOOD_BASE_POINTS;
                let popupLabel = '';
                let multiplierDelta = 0;

                if (bird.invincible && bird.superType === 'lightning' && bird.lightningPipesRemaining > 0) {
                    rawPoints += LIGHTNING_BONUS_POINTS;
                    bird.lightningPipesRemaining--;
                }

                if (pipe.food.effect === 'grow') {
                    bird.size = Math.min(MAX_BIRD_SIZE, bird.size + GROW_AMOUNT);
                    const before = multiplier;
                    applyMultiplierChange('grow');
                    multiplierDelta = Math.round((multiplier - before) * 100) / 100;
                    popupLabel = 'Junk';
                    AudioEngine.eatGrow();
                } else if (pipe.food.effect === 'super') {
                    bird.invincible = true;
                    bird.invincibleTimer = INVINCIBLE_DURATION;
                    if (pipe.food.superType === 'lightning') {
                        bird.superType = 'lightning';
                        bird.lightningPipesRemaining = LIGHTNING_GUARANTEED_PIPES;
                        popupLabel = 'Lightning';
                        AudioEngine.eatLightning();
                    } else {
                        bird.superType = 'star';
                        bird.size = Math.min(MAX_BIRD_SIZE, bird.size + SUPER_GROW_AMOUNT);
                        const before = multiplier;
                        applyMultiplierChange('grow');
                        multiplierDelta = Math.round((multiplier - before) * 100) / 100;
                        popupLabel = 'Star';
                        AudioEngine.eatSuper();
                    }
                }

                const pointsAwarded = rawPoints * multiplierAtHit;
                awardScore(pointsAwarded);
                spawnScorePopup(foodX, foodY, pointsAwarded, popupLabel, multiplierDelta);
            }
        }

        if (pipe.x + pipeWidth < 0) {
            pipes.splice(i, 1);
        }
    }
}

function endGame() {
    if (gameState !== 'playing') return;
    gameState = 'gameover';
    const finalScoreValue = Math.round(score);
    bestScore = Math.max(bestScore, finalScoreValue);
    updateLeaderboard(currentPlayerName, finalScoreValue, rebirthCount);
    setText(finalScoreEl, `Building Score: ${finalScoreValue} | Best: ${bestScore} | Food Eaten: ${fedCount} | Rebirths: ${rebirthCount}`);
    gameOverScreen.classList.remove('hidden');
}

function getBirdBodyStyle() {
    if (bird.invincible && bird.superType === 'lightning') {
        const t = Date.now() / 300;
        const grad = ctx.createLinearGradient(-bird.size / 2, -bird.size / 2, bird.size / 2, bird.size / 2);
        grad.addColorStop(0, '#9a9a9a');
        grad.addColorStop(Math.max(0, Math.min(1, 0.35 + 0.05 * Math.sin(t))), '#e8e8e8');
        grad.addColorStop(Math.max(0, Math.min(1, 0.6 + 0.05 * Math.sin(t))), '#ffe066');
        grad.addColorStop(1, '#c9962b');
        return grad;
    }
    return '#ffd700';
}

function drawBird() {
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate((bird.rotation * Math.PI) / 180);
    ctx.scale(bird.squashX, bird.squashY);

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

    ctx.fillStyle = getBirdBodyStyle();
    ctx.beginPath();
    ctx.ellipse(0, 0, bird.size / 2, bird.size / 2 - 2, 0, 0, Math.PI * 2);
    ctx.fill();

    if (bird.invincible && bird.superType === 'lightning') {
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(0, 0, bird.size / 2, bird.size / 2 - 2, 0, 0, Math.PI * 2);
        ctx.clip();
        const shineX = ((Date.now() / 6) % (bird.size * 3)) - bird.size * 1.5;
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath();
        ctx.moveTo(shineX, -bird.size);
        ctx.lineTo(shineX + 6, -bird.size);
        ctx.lineTo(shineX - 10, bird.size);
        ctx.lineTo(shineX - 16, bird.size);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

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

    const glassesR = bird.size * 0.22;
    const glassesX = bird.size * 0.3;
    const glassesY = -bird.size * 0.17;
    ctx.strokeStyle = '#2b2b2b';
    ctx.lineWidth = Math.max(1.5, bird.size * 0.045);
    ctx.beginPath();
    ctx.arc(glassesX, glassesY, glassesR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(glassesX - glassesR, glassesY);
    ctx.lineTo(glassesX - glassesR - bird.size * 0.14, glassesY - bird.size * 0.03);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.arc(glassesX + glassesR * 0.3, glassesY - glassesR * 0.3, glassesR * 0.28, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#5a3824';
    ctx.lineWidth = Math.max(1.5, bird.size * 0.09);
    ctx.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
        const hx = -bird.size * 0.12 - k * bird.size * 0.14;
        const hy = -bird.size * 0.42 - Math.sin(k * 1.4) * bird.size * 0.04;
        ctx.beginPath();
        ctx.arc(hx, hy, bird.size * 0.1, Math.PI * 0.15, Math.PI * 1.85);
        ctx.stroke();
    }

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
                const pulse = 18 + Math.sin(Date.now() / 120) * 4;
                let glow;
                if (pipe.food.superType === 'lightning') {
                    glow = ctx.createRadialGradient(foodX, foodY, 4, foodX, foodY, pulse);
                    glow.addColorStop(0, 'rgba(255, 240, 120, 0.85)');
                    glow.addColorStop(1, 'rgba(255, 240, 120, 0)');
                } else {
                    rainbowHue = (rainbowHue + 2) % 360;
                    glow = ctx.createRadialGradient(foodX, foodY, 4, foodX, foodY, pulse);
                    glow.addColorStop(0, `hsla(${rainbowHue}, 100%, 65%, 0.7)`);
                    glow.addColorStop(1, `hsla(${rainbowHue}, 100%, 65%, 0)`);
                }
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
    const scrollX = ((bgOffsetX * SKYLINE_PARALLAX) % skylineTileWidth + skylineTileWidth) % skylineTileWidth;
    ctx.fillStyle = 'rgba(30, 20, 45, 0.55)';
    for (let pass = -1; pass <= 1; pass++) {
        const baseX = pass * skylineTileWidth - scrollX;
        skyline.forEach(b => {
            const bx = b.x + baseX;
            if (bx + b.w < 0 || bx > CANVAS_W) return;
            ctx.fillRect(bx, CANVAS_H - b.h - 10, b.w, b.h);
        });
    }
}

function draw() {
    drawSunsetSky();
    drawSkyline();
    drawPipes();
    drawBird();

    ctx.fillStyle = '#26232f';
    ctx.fillRect(0, CANVAS_H - 10, CANVAS_W, 10);

    if (bird.invincible) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        if (bird.superType === 'lightning') {
            ctx.fillText('⚡ LIGHTNING BOOST ⚡', CANVAS_W / 2, CANVAS_H - 25);
        } else {
            ctx.fillText('⭐ INVINCIBLE ⭐', CANVAS_W / 2, CANVAS_H - 25);
        }
    }

    drawScorePopups();
}

let lastFrameTime = performance.now();

function gameLoop(currentTime) {
    const rawDelta = (currentTime - lastFrameTime) / (1000 / 60);
    lastFrameTime = currentTime;
    const delta = Math.min(rawDelta, 3);

    if (gameState === 'playing') {
        updateBird(delta);
        updatePipes(delta);
        updateScorePopups(delta);
    }
    draw();
    requestAnimationFrame(gameLoop);
}

// Initial setup — prefill the last-used name and show whatever's already saved
try {
    const lastName = localStorage.getItem(LAST_NAME_KEY);
    if (lastName && playerNameInput) playerNameInput.value = lastName;
} catch (e) {
    // ignore
}
renderLeaderboard();

requestAnimationFrame(gameLoop);