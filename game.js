// game.js - Tank Battle Engine con Spawns limpios, Nameplates, HP Bars, Daño y Explosiones

// ==========================================
// 1. CONFIGURACIÓN Y CONSTANTES DEL JUEGO
// ==========================================
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const TILE_SIZE = 40;
const TANK_SIZE = 32;
const BULLET_SPEED = 7;
const TANK_SPEED = 3;
const MAX_HP = 100;

const MQTT_BROKER = "wss://broker.emqx.io:8084/mqtt";
let client = null;
let roomCode = "";

// Mapa de Bloques (1 = Pared/Bloque, 0 = Espacio Libre)
const MAP_GRID = [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,1],
    [1,0,1,1,0,0,1,0,1,1,1,1,0,1,0,0,1,1,0,1],
    [1,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,1],
    [1,0,0,0,1,1,0,1,1,0,0,1,1,0,1,1,0,0,0,1],
    [1,0,1,0,1,0,0,1,0,0,0,0,1,0,0,1,0,1,0,1],
    [1,0,1,0,1,0,0,1,0,0,0,0,1,0,0,1,0,1,0,1],
    [1,0,0,0,1,1,0,1,1,0,0,1,1,0,1,1,0,0,0,1],
    [1,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,1],
    [1,0,1,1,0,0,1,0,1,1,1,1,0,1,0,0,1,1,0,1],
    [1,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]
];

// Lista de Puntos de Spawn Candidatos (Coordenadas en celdas de la cuadrícula)
const SPAWN_CANDIDATES = [
    { gridX: 1, gridY: 1 },
    { gridX: 18, gridY: 1 },
    { gridX: 1, gridY: 10 },
    { gridX: 18, gridY: 10 },
    { gridX: 9, gridY: 3 },
    { gridX: 10, gridY: 8 }
];

// Estado del Jugador Local
let localPlayer = {
    id: "p_" + Math.random().toString(36).substr(2, 6),
    name: "TANK",
    x: 0,
    y: 0,
    angle: 0, // Radianes o Dirección (0: Arriba, 1: Derecha, 2: Abajo, 3: Izquierda)
    dirX: 0,
    dirY: -1,
    hp: MAX_HP,
    state: "ALIVE", // "ALIVE", "EXPLODING", "DEAD"
    respawnTimer: 0,
    hitFlashTimer: 0,
    color: "#38B000"
};

let players = {}; // Diccionario de tanques en la sala
let bullets = []; // Proyectiles en pantalla
let particles = []; // Sistema de partículas (daño / explosiones)

// Colores disponibles para tanques de otros jugadores
const PLAYER_COLORS = ["#38B000", "#E52521", "#4EA8DE", "#FFD166", "#F72585", "#7209B7"];

// ==========================================
// 2. SISTEMA DE SPAWN LIBRE DE COLISIONES
// ==========================================
function getValidSpawnPoint() {
    // Filtramos solo los puntos candidatos que estén completamente libres de bloques
    const validSpawns = SPAWN_CANDIDATES.filter(sp => {
        return MAP_GRID[sp.gridY][sp.gridX] === 0;
    });

    // Si por alguna razón no hay candidatos válidos, busca cualquier celda libre
    if (validSpawns.length === 0) {
        for (let r = 1; r < MAP_GRID.length - 1; r++) {
            for (let c = 1; c < MAP_GRID[r].length - 1; c++) {
                if (MAP_GRID[r][c] === 0) {
                    return { x: c * TILE_SIZE + TILE_SIZE / 2, y: r * TILE_SIZE + TILE_SIZE / 2 };
                }
            }
        }
    }

    // Elegir un punto aleatorio dentro de los válidos para evitar amontonamiento
    const chosen = validSpawns[Math.floor(Math.random() * validSpawns.length)];
    return {
        x: chosen.gridX * TILE_SIZE + TILE_SIZE / 2,
        y: chosen.gridY * TILE_SIZE + TILE_SIZE / 2
    };
}

function spawnLocalPlayer() {
    const spawn = getValidSpawnPoint();
    localPlayer.x = spawn.x;
    localPlayer.y = spawn.y;
    localPlayer.hp = MAX_HP;
    localPlayer.state = "ALIVE";
    localPlayer.respawnTimer = 0;
    localPlayer.hitFlashTimer = 0;
    localPlayer.dirX = 0;
    localPlayer.dirY = -1;
}

// ==========================================
// 3. INICIALIZACIÓN DE INTERFAZ Y CONEXIÓN
// ==========================================
const lobbyScreen = document.getElementById("lobby-screen");
const gameScreen = document.getElementById("game-screen");
const lobbyStatus = document.getElementById("lobby-status");
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;

document.getElementById("btn-start").addEventListener("click", () => {
    const nameVal = document.getElementById("player-name").value.trim();
    const roomVal = document.getElementById("room-code").value.trim().toUpperCase();

    if (!nameVal) {
        lobbyStatus.innerText = "¡Ingresa tu Nickname!";
        return;
    }
    if (!roomVal || roomVal.length < 3) {
        lobbyStatus.innerText = "¡Código de sala inválido!";
        return;
    }

    localPlayer.name = nameVal.toUpperCase();
    roomCode = roomVal;

    connectMQTT();
});

function connectMQTT() {
    lobbyStatus.innerText = "Conectando al servidor MQTT...";

    client = mqtt.connect(MQTT_BROKER, {
        clientId: localPlayer.id,
        keepalive: 30,
        clean: true
    });

    client.on("connect", () => {
        lobbyStatus.innerText = "¡Conectado! Entrando a la batalla...";

        const topicRoom = `tankgame/${roomCode}/#`;
        client.subscribe(topicRoom, () => {
            spawnLocalPlayer();
            initGameSession();
        });
    });

    client.on("message", (topic, message) => {
        try {
            const payload = JSON.parse(message.toString());
            handleNetworkMessage(topic, payload);
        } catch (e) {
            console.error("Error al procesar mensaje MQTT:", e);
        }
    });

    client.on("error", () => {
        lobbyStatus.innerText = "Error de conexión con el Broker MQTT.";
    });
}

function initGameSession() {
    lobbyScreen.classList.add("hidden");
    gameScreen.classList.remove("hidden");

    document.getElementById("hud-room").innerText = roomCode;

    // Asignar color según ID
    const colorIndex = Math.abs(hashCode(localPlayer.id)) % PLAYER_COLORS.length;
    localPlayer.color = PLAYER_COLORS[colorIndex];
    players[localPlayer.id] = localPlayer;

    // Publicar entrada
    client.publish(`tankgame/${roomCode}/join`, JSON.stringify({
        id: localPlayer.id,
        name: localPlayer.name,
        color: localPlayer.color
    }));

    // Bucle de sincronización de red (10Hz)
    setInterval(broadcastPlayerState, 100);

    // Bucle principal de Renderizado y Física
    setupInputListeners();
    requestAnimationFrame(gameLoop);
}

function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return hash;
}

function broadcastPlayerState() {
    if (client && client.connected) {
        client.publish(`tankgame/${roomCode}/state`, JSON.stringify({
            id: localPlayer.id,
            name: localPlayer.name,
            x: localPlayer.x,
            y: localPlayer.y,
            dirX: localPlayer.dirX,
            dirY: localPlayer.dirY,
            hp: localPlayer.hp,
            state: localPlayer.state,
            color: localPlayer.color
        }), { qos: 0 });
    }
}

function handleNetworkMessage(topic, data) {
    const subTopic = topic.split("/").pop();

    if (subTopic === "join") {
        if (data.id !== localPlayer.id && !players[data.id]) {
            players[data.id] = {
                id: data.id,
                name: data.name,
                x: 0,
                y: 0,
                dirX: 0,
                dirY: -1,
                hp: MAX_HP,
                state: "ALIVE",
                color: data.color || "#4EA8DE"
            };
        }
    } else if (subTopic === "state") {
        if (data.id !== localPlayer.id) {
            players[data.id] = data;
        }
    } else if (subTopic === "shoot") {
        if (data.ownerId !== localPlayer.id) {
            bullets.push({
                x: data.x,
                y: data.y,
                dirX: data.dirX,
                dirY: data.dirY,
                ownerId: data.ownerId
            });
        }
    } else if (subTopic === "hit") {
        // Recibir impacto
        if (data.targetId === localPlayer.id && localPlayer.state === "ALIVE") {
            applyDamage(localPlayer, data.damage);
        }
    }
}

// ==========================================
// 4. CONTROLES E INPUTS (TECLADO Y TÁCTIL)
// ==========================================
const keys = { Up: false, Down: false, Left: false, Right: false };

function setupInputListeners() {
    window.addEventListener("keydown", (e) => {
        if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") keys.Up = true;
        if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") keys.Down = true;
        if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.Left = true;
        if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.Right = true;
        if (e.key === " " || e.key === "Enter") shootBullet();
    });

    window.addEventListener("keyup", (e) => {
        if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") keys.Up = false;
        if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") keys.Down = false;
        if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.Left = false;
        if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.Right = false;
    });

    // Botones táctiles
    bindTouchBtn("btn-up", "Up");
    bindTouchBtn("btn-down", "Down");
    bindTouchBtn("btn-left", "Left");
    bindTouchBtn("btn-right", "Right");

    document.getElementById("btn-fire").addEventListener("touchstart", (e) => {
        e.preventDefault();
        shootBullet();
    });
    document.getElementById("btn-fire").addEventListener("click", () => shootBullet());
}

function bindTouchBtn(id, keyName) {
    const btn = document.getElementById(id);
    btn.addEventListener("touchstart", (e) => { e.preventDefault(); keys[keyName] = true; });
    btn.addEventListener("touchend", (e) => { e.preventDefault(); keys[keyName] = false; });
}

function shootBullet() {
    if (localPlayer.state !== "ALIVE") return;

    const bX = localPlayer.x + localPlayer.dirX * (TANK_SIZE / 2 + 5);
    const bY = localPlayer.y + localPlayer.dirY * (TANK_SIZE / 2 + 5);

    bullets.push({
        x: bX,
        y: bY,
        dirX: localPlayer.dirX,
        dirY: localPlayer.dirY,
        ownerId: localPlayer.id
    });

    client.publish(`tankgame/${roomCode}/shoot`, JSON.stringify({
        ownerId: localPlayer.id,
        x: bX,
        y: bY,
        dirX: localPlayer.dirX,
        dirY: localPlayer.dirY
    }));
}

// ==========================================
// 5. FÍSICA, MOVIMIENTO Y COLISIONES
// ==========================================
function updateGame(dt) {
    // 1. Manejo del Tanque Local
    if (localPlayer.state === "ALIVE") {
        let moveX = 0;
        let moveY = 0;

        if (keys.Up) moveY -= 1;
        if (keys.Down) moveY += 1;
        if (keys.Left) moveX -= 1;
        if (keys.Right) moveX += 1;

        if (moveX !== 0 || moveY !== 0) {
            // Normalizar dirección
            if (moveX !== 0 && moveY !== 0) {
                moveX *= 0.7071;
                moveY *= 0.7071;
            }

            localPlayer.dirX = moveX > 0 ? 1 : (moveX < 0 ? -1 : 0);
            localPlayer.dirY = moveY > 0 ? 1 : (moveY < 0 ? -1 : 0);

            const newX = localPlayer.x + moveX * TANK_SPEED;
            const newY = localPlayer.y + moveY * TANK_SPEED;

            // Verificar colisión con paredes/bloques del mapa
            if (!checkMapCollision(newX, localPlayer.y)) {
                localPlayer.x = newX;
            }
            if (!checkMapCollision(localPlayer.x, newY)) {
                localPlayer.y = newY;
            }
        }

        // Temporizador de Destello por Daño
        if (localPlayer.hitFlashTimer > 0) {
            localPlayer.hitFlashTimer -= dt;
        }
    } else if (localPlayer.state === "EXPLODING") {
        // En estado de explosión se procesa animación y pasa a DEAD
        localPlayer.respawnTimer -= dt;
        if (localPlayer.respawnTimer <= 2.0) {
            localPlayer.state = "DEAD";
        }
    } else if (localPlayer.state === "DEAD") {
        // Temporizador para Respawn
        localPlayer.respawnTimer -= dt;
        if (localPlayer.respawnTimer <= 0) {
            spawnLocalPlayer();
        }
    }

    // 2. Actualizar Proyectiles
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.dirX * BULLET_SPEED;
        b.y += b.dirY * BULLET_SPEED;

        // Colisión Proyectil vs Pared
        if (checkMapCollision(b.x, b.y)) {
            createHitParticles(b.x, b.y, "#F0A830", 5);
            bullets.splice(i, 1);
            continue;
        }

        // Colisión Proyectil vs Tanque Local (daño recibido)
        if (b.ownerId !== localPlayer.id && localPlayer.state === "ALIVE") {
            const dist = Math.hypot(b.x - localPlayer.x, b.y - localPlayer.y);
            if (dist < TANK_SIZE / 2) {
                applyDamage(localPlayer, 25);
                createHitParticles(b.x, b.y, "#E52521", 8);
                bullets.splice(i, 1);

                // Notificar impacto al servidor
                client.publish(`tankgame/${roomCode}/hit`, JSON.stringify({
                    targetId: localPlayer.id,
                    damage: 25
                }));
                continue;
            }
        }
    }

    // 3. Actualizar Partículas
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= dt * p.decay;
        p.size = Math.max(0, p.size - dt * 2);

        if (p.alpha <= 0 || p.size <= 0) {
            particles.splice(i, 1);
        }
    }

    // Actualizar HUD HP
    document.getElementById("hud-hp").innerText = `${Math.max(0, Math.ceil(localPlayer.hp))}%`;
    document.getElementById("hud-count").innerText = Object.keys(players).length;
}

function checkMapCollision(x, y) {
    const margin = TANK_SIZE / 2 - 2;
    const points = [
        { x: x - margin, y: y - margin },
        { x: x + margin, y: y - margin },
        { x: x - margin, y: y + margin },
        { x: x + margin, y: y + margin }
    ];

    for (let pt of points) {
        const gridX = Math.floor(pt.x / TILE_SIZE);
        const gridY = Math.floor(pt.y / TILE_SIZE);

        if (gridY >= 0 && gridY < MAP_GRID.length && gridX >= 0 && gridX < MAP_GRID[0].length) {
            if (MAP_GRID[gridY][gridX] === 1) {
                return true; // Hay colisión con bloque
            }
        } else {
            return true; // Fuera de límites
        }
    }
    return false;
}

// ==========================================
// 6. SISTEMA DE DAÑO Y ANIMACIONES / EXPLOSIÓN
// ==========================================
function applyDamage(tank, amount) {
    if (tank.state !== "ALIVE") return;

    tank.hp -= amount;
    tank.hitFlashTimer = 0.2; // 200ms de parpadeo de daño

    // Chispas de daño
    createHitParticles(tank.x, tank.y, "#FF6B6B", 10);

    if (tank.hp <= 0) {
        tank.hp = 0;
        tank.state = "EXPLODING";
        tank.respawnTimer = 3.0; // 3 segundos para reaparecer

        // Crear Explosión Espectacular al morir
        createExplosion(tank.x, tank.y);
    }
}

function createHitParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 3 + 1;
        particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            color: color,
            alpha: 1.0,
            decay: 2.5,
            size: Math.random() * 4 + 2
        });
    }
}

function createExplosion(x, y) {
    // Partículas de Fuego y Escombros
    for (let i = 0; i < 35; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 5 + 1.5;
        const colors = ["#E52521", "#F0A830", "#FFD166", "#555555"];
        particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            color: colors[Math.floor(Math.random() * colors.length)],
            alpha: 1.0,
            decay: 1.2,
            size: Math.random() * 8 + 4
        });
    }
}

// ==========================================
// 7. RENDERIZADO (NAMEPLATES, BARRA HP, CANVAS)
// ==========================================
let lastFrameTime = performance.now();

function gameLoop(currentTime) {
    const dt = (currentTime - lastFrameTime) / 1000;
    lastFrameTime = currentTime;

    updateGame(dt);
    renderGame();

    requestAnimationFrame(gameLoop);
}

function renderGame() {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // 1. Dibujar Mapa de Bloques
    for (let r = 0; r < MAP_GRID.length; r++) {
        for (let c = 0; c < MAP_GRID[r].length; c++) {
            if (MAP_GRID[r][c] === 1) {
                ctx.fillStyle = "#3A3D52";
                ctx.fillRect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE);

                // Borde retro 3D
                ctx.strokeStyle = "#5A5E7B";
                ctx.lineWidth = 2;
                ctx.strokeRect(c * TILE_SIZE + 2, r * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4);
            }
        }
    }

    // 2. Dibujar Proyectiles
    ctx.fillStyle = "#FFD166";
    bullets.forEach(b => {
        ctx.beginPath();
        ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
        ctx.fill();
    });

    // 3. Dibujar Tanques (Jugador local y remoto)
    Object.values(players).forEach(p => {
        if (p.state === "ALIVE") {
            renderTank(p);
            renderNameplateAndHPBar(p);
        } else if (p.state === "EXPLODING") {
            renderNameplateAndHPBar(p); // Mostrar la barra en 0% durante la explosión
        }
    });

    // 4. Dibujar Partículas
    particles.forEach(p => {
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        ctx.restore();
    });

    // 5. Banner de Respawn si estamos muertos
    if (localPlayer.state === "DEAD" || localPlayer.state === "EXPLODING") {
        ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
        ctx.fillRect(0, CANVAS_HEIGHT / 2 - 40, CANVAS_WIDTH, 80);

        ctx.fillStyle = "#E52521";
        ctx.font = "14px 'Press Start 2P'";
        ctx.textAlign = "center";
        ctx.fillText("¡TANQUE DESTRUIDO!", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 10);

        ctx.fillStyle = "#FFF";
        ctx.font = "10px 'Press Start 2P'";
        ctx.fillText(`REAPARECIENDO EN ${Math.ceil(localPlayer.respawnTimer)}s...`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 20);
    }
}

// Dibujado del Tanque
function renderTank(tank) {
    ctx.save();
    ctx.translate(tank.x, tank.y);

    // Animación de parpadeo si recibió daño
    if (tank.hitFlashTimer > 0) {
        ctx.fillStyle = "#FFF"; // Destello blanco
    } else {
        ctx.fillStyle = tank.color;
    }

    // Cuerpo principal
    ctx.fillRect(-TANK_SIZE / 2, -TANK_SIZE / 2, TANK_SIZE, TANK_SIZE);

    // Orugas
    ctx.fillStyle = "#111";
    ctx.fillRect(-TANK_SIZE / 2 - 3, -TANK_SIZE / 2, 4, TANK_SIZE);
    ctx.fillRect(TANK_SIZE / 2 - 1, -TANK_SIZE / 2, 4, TANK_SIZE);

    // Cañón del Tanque según dirección
    ctx.fillStyle = "#222";
    let canonX = 0;
    let canonY = 0;
    let canonW = 6;
    let canonH = 16;

    if (tank.dirX === 1) { canonX = 6; canonY = -3; canonW = 16; canonH = 6; }
    else if (tank.dirX === -1) { canonX = -22; canonY = -3; canonW = 16; canonH = 6; }
    else if (tank.dirY === 1) { canonX = -3; canonY = 6; canonW = 6; canonH = 16; }
    else if (tank.dirY === -1) { canonX = -3; canonY = -22; canonW = 6; canonH = 16; }

    ctx.fillRect(canonX, canonY, canonW, canonH);

    ctx.restore();
}

// Dibujado de Nameplate y Barra de Vida (HP) flotante sobre cada tanque
function renderNameplateAndHPBar(tank) {
    const barWidth = 40;
    const barHeight = 6;
    const offsetX = tank.x - barWidth / 2;
    const offsetY = tank.y - TANK_SIZE / 2 - 22;

    // 1. Nameplate (Nombre del Jugador)
    ctx.fillStyle = "#FFF";
    ctx.font = "8px 'Press Start 2P'";
    ctx.textAlign = "center";
    ctx.fillText(tank.name, tank.x, offsetY - 4);

    // 2. Fondo de la Barra de HP (Rojo / Negro)
    ctx.fillStyle = "#000";
    ctx.fillRect(offsetX - 1, offsetY - 1, barWidth + 2, barHeight + 2);
    ctx.fillStyle = "#D00000";
    ctx.fillRect(offsetX, offsetY, barWidth, barHeight);

    // 3. Relleno de HP Restante (Verde)
    const currentHpWidth = Math.max(0, (tank.hp / MAX_HP) * barWidth);
    ctx.fillStyle = "#38B000";
    ctx.fillRect(offsetX, offsetY, currentHpWidth, barHeight);

    // Borde de la barra
    ctx.strokeStyle = "#FFF";
    ctx.lineWidth = 1;
    ctx.strokeRect(offsetX, offsetY, barWidth, barHeight);
}
