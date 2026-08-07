// ================================================================
//  universe.js - 班级时光机 宇宙模式引擎
//  职责：渲染像素地图、控制角色、处理交互
//  独立于 app.js，通过事件总线通信
//  版本：v1.0 (2026-08-07)
// ================================================================

(function() {
    'use strict';

    // ---------- 配置 ----------
    const CONFIG = {
        tileSize: 32,
        moveSpeed: 2.5,        // 每帧移动像素数
        smoothFactor: 0.18,    // 平滑跟随系数
        canvasWidth: 640,
        canvasHeight: 640,
        fps: 60
    };

    // ---------- 状态 ----------
    let mapData = null;
    let map = [];
    let tiles = {};
    let terrainNames = {};
    let tileSize = CONFIG.tileSize;
    let cols = 0, rows = 0;

    // 玩家
    const player = {
        x: 5, y: 5,          // 格子坐标
        px: 0, py: 0,        // 像素坐标 (中心)
        targetX: 0, targetY: 0,
        dir: 0,              // 0=下, 1=左, 2=右, 3=上
        moving: false,
        speed: CONFIG.moveSpeed
    };

    // DOM 元素
    let canvas, ctx;
    let container = null;
    let isActive = false;
    let animFrameId = null;

    // 键盘状态
    const keys = {};

    // 粒子系统
    let particles = [];

    // 交互回调
    let onInteract = null;

    // ---------- 初始化 ----------
    function init(containerEl, mapDataObj, callbacks) {
        container = containerEl;
        mapData = mapDataObj;
        onInteract = callbacks?.onInteract || null;

        // 解析地图
        loadMap(mapData);

        // 创建 Canvas
        canvas = document.createElement('canvas');
        canvas.width = CONFIG.canvasWidth;
        canvas.height = CONFIG.canvasHeight;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.imageRendering = 'pixelated';
        canvas.style.display = 'block';
        canvas.style.borderRadius = '12px';
        canvas.style.backgroundColor = '#1a2a1a';
        container.appendChild(canvas);
        ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;

        // 设置玩家初始位置
        const spawnX = mapData.spawnX || 9;
        const spawnY = mapData.spawnY || 9;
        player.x = spawnX;
        player.y = spawnY;
        player.px = spawnX * tileSize + tileSize / 2;
        player.py = spawnY * tileSize + tileSize / 2;
        player.targetX = player.px;
        player.targetY = player.py;

        // 初始化粒子
        initParticles();

        // 绑定事件
        bindEvents();

        // 启动循环
        isActive = true;
        gameLoop();

        // 调整 Canvas 尺寸适应容器
        resizeCanvas();

        console.log('🌌 宇宙模式已启动');
        return true;
    }

    // ---------- 地图加载 ----------
    function loadMap(data) {
        map = data.map || [];
        tiles = data.tiles || {};
        terrainNames = data.terrainNames || {};
        tileSize = data.tileSize || CONFIG.tileSize;
        cols = map[0]?.length || 0;
        rows = map.length || 0;

        // 初始化粒子
        if (isActive) initParticles();
    }

    // 从 JSON 加载地图
    function loadMapFromJSON(jsonUrl) {
        return fetch(jsonUrl)
            .then(r => r.json())
            .then(data => {
                mapData = data;
                loadMap(data);
                return data;
            });
    }

    // ---------- 粒子系统 ----------
    function initParticles() {
        particles = [];
        const count = Math.min(40, Math.floor((cols * rows) / 10));
        for (let i = 0; i < count; i++) {
            particles.push({
                x: Math.random() * cols * tileSize,
                y: Math.random() * rows * tileSize,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3 - 0.08,
                size: 1 + Math.random() * 2.5,
                alpha: 0.15 + Math.random() * 0.4,
                phase: Math.random() * Math.PI * 2
            });
        }
    }

    // ---------- 事件绑定 ----------
    function bindEvents() {
        // 键盘
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup', onKeyUp);

        // 窗口大小变化
        window.addEventListener('resize', resizeCanvas);

        // 触摸事件 (移动端)
        setupTouchControls();

        // 容器失焦时释放按键
        container?.addEventListener('mouseleave', () => {
            for (let k in keys) keys[k] = false;
        });
    }

    function onKeyDown(e) {
        const k = e.key.toLowerCase();
        keys[k] = true;
        if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
            e.preventDefault();
        }
        if (k === 'e') {
            handleInteract();
        }
    }

    function onKeyUp(e) {
        keys[e.key.toLowerCase()] = false;
    }

    // ---------- 触摸控制 (虚拟摇杆) ----------
    let touchId = null;
    let touchStartX = 0, touchStartY = 0;

    function setupTouchControls() {
        if (!canvas) return;

        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.changedTouches[0];
            const rect = canvas.getBoundingClientRect();
            touchStartX = (touch.clientX - rect.left) / rect.width * canvas.width;
            touchStartY = (touch.clientY - rect.top) / rect.height * canvas.height;
            touchId = touch.identifier;

            // 如果触摸在 Canvas 右下角区域，触发交互
            if (touchStartX > canvas.width * 0.8 && touchStartY > canvas.height * 0.8) {
                handleInteract();
            }
        });

        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = Array.from(e.changedTouches).find(t => t.identifier === touchId);
            if (!touch) return;
            const rect = canvas.getBoundingClientRect();
            const x = (touch.clientX - rect.left) / rect.width * canvas.width;
            const y = (touch.clientY - rect.top) / rect.height * canvas.height;

            const dx = x - touchStartX;
            const dy = y - touchStartY;

            // 死区
            if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;

            // 映射到方向键
            const angle = Math.atan2(dy, dx);
            const threshold = Math.PI / 4;
            // 重置所有方向
            keys['w'] = false; keys['a'] = false; keys['s'] = false; keys['d'] = false;
            if (angle > -threshold && angle < threshold) keys['d'] = true;
            else if (angle > threshold && angle < Math.PI - threshold) keys['s'] = true;
            else if (angle < -threshold && angle > -Math.PI + threshold) keys['w'] = true;
            else keys['a'] = true;
        });

        canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            touchId = null;
            keys['w'] = false; keys['a'] = false; keys['s'] = false; keys['d'] = false;
        });

        canvas.addEventListener('touchcancel', (e) => {
            touchId = null;
            keys['w'] = false; keys['a'] = false; keys['s'] = false; keys['d'] = false;
        });
    }

    // ---------- 交互处理 ----------
    function handleInteract() {
        const dirs = [[0,1], [-1,0], [1,0], [0,-1]];
        const dx = dirs[player.dir][0];
        const dy = dirs[player.dir][1];
        const cx = player.x + dx;
        const cy = player.y + dy;

        if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) return;

        const val = map[cy][cx];
        const tileInfo = tiles[String(val)];
        if (tileInfo?.action && onInteract) {
            onInteract(tileInfo.action, tileInfo.name);
        }
    }

    // ---------- 更新逻辑 ----------
    function update() {
        let dx = 0, dy = 0;
        if (keys['w'] || keys['arrowup']) { dy = -1; player.dir = 3; }
        if (keys['s'] || keys['arrowdown']) { dy = 1; player.dir = 0; }
        if (keys['a'] || keys['arrowleft']) { dx = -1; player.dir = 1; }
        if (keys['d'] || keys['arrowright']) { dx = 1; player.dir = 2; }

        if (dx !== 0 || dy !== 0) {
            const newX = player.x + dx;
            const newY = player.y + dy;
            if (newX >= 0 && newX < cols && newY >= 0 && newY < rows) {
                const tileInfo = tiles[String(map[newY][newX])];
                if (tileInfo?.walkable !== false) {
                    player.x = newX;
                    player.y = newY;
                    player.targetX = player.x * tileSize + tileSize / 2;
                    player.targetY = player.y * tileSize + tileSize / 2;
                    player.moving = true;
                } else {
                    player.moving = false;
                }
            } else {
                player.moving = false;
            }
        } else {
            player.moving = false;
        }

        // 平滑移动
        player.px += (player.targetX - player.px) * CONFIG.smoothFactor;
        player.py += (player.targetY - player.py) * CONFIG.smoothFactor;
        if (Math.abs(player.px - player.targetX) < 0.5) player.px = player.targetX;
        if (Math.abs(player.py - player.targetY) < 0.5) player.py = player.targetY;

        // 更新粒子
        const time = Date.now() / 1000;
        for (let p of particles) {
            p.x += p.vx + Math.sin(time + p.phase) * 0.08;
            p.y += p.vy + Math.cos(time * 0.8 + p.phase) * 0.08;
            if (p.x < 0) p.x = cols * tileSize;
            if (p.x > cols * tileSize) p.x = 0;
            if (p.y < 0) p.y = rows * tileSize;
            if (p.y > rows * tileSize) p.y = 0;
        }
    }

    // ---------- 渲染 ----------
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const offsetX = canvas.width / 2 - player.px;
        const offsetY = canvas.height / 2 - player.py;

        // 绘制粒子 (底层)
        for (let p of particles) {
            const px = p.x + offsetX;
            const py = p.y + offsetY;
            if (px < -10 || px > canvas.width + 10 || py < -10 || py > canvas.height + 10) continue;
            ctx.fillStyle = `rgba(255, 255, 230, ${p.alpha * 0.25})`;
            ctx.beginPath();
            ctx.arc(px, py, p.size, 0, Math.PI * 2);
            ctx.fill();
        }

        // 绘制地图
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const x = col * tileSize + offsetX;
                const y = row * tileSize + offsetY;
                if (x < -tileSize || x > canvas.width + tileSize ||
                    y < -tileSize || y > canvas.height + tileSize) continue;

                const val = map[row][col];
                const tileInfo = tiles[String(val)];
                if (!tileInfo) continue;

                // 绘制底色
                ctx.fillStyle = tileInfo.color || '#3a5a3a';
                ctx.fillRect(x, y, tileSize, tileSize);

                // 特殊地形额外绘制
                drawTerrainDetail(col, row, x, y, val);
            }
        }

        // 绘制玩家
        drawPlayer(offsetX, offsetY);

        // 绘制交互提示 (玩家前方高亮)
        drawInteractionHint(offsetX, offsetY);

        // 顶部 HUD
        drawHUD();
    }

    function drawTerrainDetail(col, row, x, y, val) {
        const valStr = String(val);
        if (valStr === '2') { // 星语森林 - 树
            ctx.fillStyle = '#2d7d2d';
            ctx.beginPath();
            ctx.arc(x + tileSize/2, y + tileSize/2 - 4, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#3d9d3d';
            ctx.beginPath();
            ctx.arc(x + tileSize/2 - 5, y + tileSize/2 - 8, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.arc(x + tileSize/2 + 6, y + tileSize/2 - 6, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#6b4a2a';
            ctx.fillRect(x + tileSize/2 - 2, y + tileSize/2 + 4, 4, 8);
        } else if (valStr === '3') { // 回声峡谷 - 小屋
            ctx.fillStyle = '#8a7a6a';
            ctx.fillRect(x + 2, y + 2, tileSize - 4, tileSize - 4);
            ctx.fillStyle = '#6a5a4a';
            ctx.fillRect(x + 4, y + 4, tileSize - 8, tileSize - 12);
            ctx.fillStyle = '#6a3a2a';
            ctx.beginPath();
            ctx.moveTo(x, y + 2);
            ctx.lineTo(x + tileSize/2, y - 8);
            ctx.lineTo(x + tileSize, y + 2);
            ctx.fill();
            ctx.fillStyle = '#4a3a2a';
            ctx.fillRect(x + tileSize/2 - 4, y + tileSize - 10, 8, 8);
            // 光波
            const time = Date.now() / 1000;
            ctx.strokeStyle = `rgba(129, 201, 255, ${0.08 + Math.sin(time + col + row) * 0.05})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(x + tileSize/2, y + tileSize/2, 14 + Math.sin(time * 0.8 + row) * 3, 0, Math.PI * 2);
            ctx.stroke();
        } else if (valStr === '4') { // 暗影沼泽
            const grad = ctx.createRadialGradient(x + tileSize/2, y + tileSize/2, 2, x + tileSize/2, y + tileSize/2, 16);
            grad.addColorStop(0, 'rgba(160, 120, 200, 0.2)');
            grad.addColorStop(1, 'rgba(160, 120, 200, 0)');
            ctx.fillStyle = grad;
            ctx.fillRect(x, y, tileSize, tileSize);
            // 萤火虫
            const seed = (row * 7 + col * 13) % 100;
            const time = Date.now() / 1000;
            for (let i = 0; i < 3; i++) {
                const fx = x + 4 + ((seed + i * 31) % 24);
                const fy = y + 4 + ((seed * 3 + i * 47) % 24);
                ctx.fillStyle = `rgba(200, 180, 255, ${0.1 + Math.sin(time + row + col + i * 2) * 0.08})`;
                ctx.beginPath();
                ctx.arc(fx, fy, 1.5 + Math.sin(time + i) * 0.5, 0, Math.PI * 2);
                ctx.fill();
            }
        } else if (valStr === '5') { // 星核祭坛
            const time = Date.now() / 1000;
            const grad = ctx.createRadialGradient(x + tileSize/2, y + tileSize/2, 2, x + tileSize/2, y + tileSize/2, 18);
            grad.addColorStop(0, `rgba(255, 215, 0, ${0.15 + Math.sin(time * 0.5) * 0.05})`);
            grad.addColorStop(0.5, 'rgba(255, 215, 0, 0.05)');
            grad.addColorStop(1, 'rgba(255, 215, 0, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x + tileSize/2, y + tileSize/2, 18, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = `rgba(255, 215, 0, ${0.3 + Math.sin(time * 0.7) * 0.1})`;
            ctx.beginPath();
            ctx.arc(x + tileSize/2, y + tileSize/2 - 2, 5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function drawPlayer(offsetX, offsetY) {
        const px = canvas.width / 2;
        const py = canvas.height / 2 + 4;
        const bob = player.moving ? Math.sin(Date.now() / 180) * 1.5 : 0;

        // 阴影
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.beginPath();
        ctx.ellipse(px, py + 16 + bob, 12, 4, 0, 0, Math.PI * 2);
        ctx.fill();

        // 像素角色 (简单版 - 等待精灵数据)
        drawSimpleCharacter(px, py + bob);

        // 名字标签
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath();
        ctx.roundRect(px - 32, py - 28 + bob, 64, 16, 8);
        ctx.fill();
        ctx.fillStyle = '#aaccff';
        ctx.font = '10px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('⭐ 星灵', px, py - 16 + bob);
    }

    function drawSimpleCharacter(px, py) {
        // 临时角色 - 等待精灵数据
        const colors = {
            body: '#4a7a9a',
            skin: '#f5d0b8',
            hair: '#4a3a2a',
            eye: '#1a1a2a',
            leg: '#2a3a4a'
        };

        // 身体
        ctx.fillStyle = colors.body;
        ctx.fillRect(px - 6, py - 2, 12, 14);
        // 衣服
        ctx.fillStyle = '#3a8a6a';
        ctx.fillRect(px - 5, py + 2, 10, 8);
        // 头
        ctx.fillStyle = colors.skin;
        ctx.beginPath();
        ctx.arc(px, py - 6, 9, 0, Math.PI * 2);
        ctx.fill();
        // 头发
        ctx.fillStyle = colors.hair;
        ctx.fillRect(px - 9, py - 14, 18, 5);
        ctx.fillRect(px - 10, py - 11, 4, 5);
        ctx.fillRect(px + 6, py - 11, 4, 5);
        // 眼睛
        ctx.fillStyle = colors.eye;
        ctx.fillRect(px - 5, py - 8, 3, 3);
        ctx.fillRect(px + 2, py - 8, 3, 3);
        // 腿
        ctx.fillStyle = colors.leg;
        const legOffset = player.moving ? Math.sin(Date.now() / 150) * 3 : 0;
        ctx.fillRect(px - 5, py + 12, 4, 6 + legOffset);
        ctx.fillRect(px + 1, py + 12, 4, 6 - legOffset);
    }

    function drawInteractionHint(offsetX, offsetY) {
        const dirs = [[0,1], [-1,0], [1,0], [0,-1]];
        const dx = dirs[player.dir][0];
        const dy = dirs[player.dir][1];
        const cx = player.x + dx;
        const cy = player.y + dy;

        if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) return;
        const val = map[cy][cx];
        const tileInfo = tiles[String(val)];
        if (tileInfo?.action) {
            const x = cx * tileSize + offsetX;
            const y = cy * tileSize + offsetY;
            ctx.strokeStyle = 'rgba(129, 201, 255, 0.35)';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 6]);
            ctx.strokeRect(x + 2, y + 2, tileSize - 4, tileSize - 4);
            ctx.setLineDash([]);

            // 交互提示文字
            ctx.fillStyle = 'rgba(0,0,0,0.4)';
            ctx.beginPath();
            ctx.roundRect(x + 2, y - 18, 60, 16, 6);
            ctx.fill();
            ctx.fillStyle = '#81C9FF';
            ctx.font = '9px "Courier New", monospace';
            ctx.textAlign = 'center';
            const name = terrainNames[tileInfo.action] || tileInfo.name || '交互';
            ctx.fillText(name, x + tileSize/2, y - 6);
        }
    }

    function drawHUD() {
        // 左上角：地图名称
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.roundRect(8, 8, 120, 24, 8);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '11px "Courier New", monospace';
        ctx.textAlign = 'left';
        ctx.fillText('🌌 ' + (mapData.name || '星语森林'), 16, 24);

        // 右下角：操作提示
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.roundRect(canvas.width - 120, canvas.height - 28, 112, 20, 6);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '9px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('WASD 移动 · E 交互', canvas.width - 64, canvas.height - 14);

        // 右上角：返回经典模式按钮 (用 Canvas 绘制)
        const btnX = canvas.width - 90;
        const btnY = 8;
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.beginPath();
        ctx.roundRect(btnX, btnY, 82, 26, 8);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(btnX, btnY, 82, 26, 8);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '10px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('📋 经典模式', btnX + 41, btnY + 17);
    }

    // ---------- Canvas 自适应 ----------
    function resizeCanvas() {
        if (!container || !canvas) return;
        const rect = container.getBoundingClientRect();
        const w = rect.width || CONFIG.canvasWidth;
        const h = rect.height || CONFIG.canvasHeight;
        // Canvas 逻辑尺寸不变，只改变 CSS 尺寸
        const ratio = Math.min(w / CONFIG.canvasWidth, h / CONFIG.canvasHeight);
        canvas.style.width = (CONFIG.canvasWidth * ratio) + 'px';
        canvas.style.height = (CONFIG.canvasHeight * ratio) + 'px';
    }

    // ---------- 游戏循环 ----------
    function gameLoop() {
        if (!isActive) return;
        update();
        draw();
        animFrameId = requestAnimationFrame(gameLoop);
    }

    // ---------- 销毁 ----------
    function destroy() {
        isActive = false;
        if (animFrameId) {
            cancelAnimationFrame(animFrameId);
            animFrameId = null;
        }
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('resize', resizeCanvas);
        if (canvas && canvas.parentNode) {
            canvas.parentNode.removeChild(canvas);
        }
        console.log('🌌 宇宙模式已销毁');
    }

    // ---------- 公开 API ----------
    window.__UNIVERSE = {
        init: init,
        destroy: destroy,
        loadMap: loadMap,
        loadMapFromJSON: loadMapFromJSON,
        isActive: () => isActive,
        getPlayer: () => ({ x: player.x, y: player.y })
    };

    // ---------- roundRect polyfill ----------
    if (!CanvasRenderingContext2D.prototype.roundRect) {
        CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
            if (r > w/2) r = w/2;
            if (r > h/2) r = h/2;
            this.moveTo(x + r, y);
            this.arcTo(x + w, y, x + w, y + h, r);
            this.arcTo(x + w, y + h, x, y + h, r);
            this.arcTo(x, y + h, x, y, r);
            this.arcTo(x, y, x + w, y, r);
            return this;
        };
    }

    console.log('📦 universe.js 已加载，使用 __UNIVERSE.init() 启动');
})();