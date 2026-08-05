// js/config.js

// ============================================================
// Supabase 配置（请替换成你自己的值）
// ============================================================
export const SUPABASE_URL = 'https://agpznniqfxdeudwvimbb.supabase.co';
export const SUPABASE_ANON_KEY = '你的anon key';

// ============================================================
// 工具函数
// ============================================================
export function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function getToday() {
    return new Date().toISOString().slice(0, 10);
}

export function getWeekday(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
}

export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// 音效播放（使用 Web Audio）
export function playSound(type) {
    if (type === 'none') return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = 0.3;
    let duration = 0.5;
    if (type === 'bell') { osc.frequency.value = 800; osc.type = 'sine'; duration = 0.6; }
    else if (type === 'ding') { osc.frequency.value = 1200; osc.type = 'sine'; duration = 0.3; }
    else if (type === 'chime') { osc.frequency.value = 600; osc.type = 'triangle'; duration = 0.8; }
    osc.start();
    osc.stop(ctx.currentTime + duration);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
}

// 彩带庆祝
export function launchConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const particles = [];
    const colors = ['#6c8cff', '#a77cff', '#ff7eb3', '#ffd76c', '#6cffb0', '#ff6c6c'];
    for (let i = 0; i < 160; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height - canvas.height,
            w: Math.random() * 8 + 4,
            h: Math.random() * 5 + 3,
            color: colors[Math.floor(Math.random() * colors.length)],
            vx: (Math.random() - 0.5) * 3,
            vy: Math.random() * 4 + 2,
            rotation: Math.random() * 360,
            rotSpeed: (Math.random() - 0.5) * 6
        });
    }
    let frameId = null, startTime = Date.now();
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let alive = false;
        particles.forEach(p => {
            p.x += p.vx; p.y += p.vy; p.vy += 0.06;
            p.rotation += p.rotSpeed;
            if (p.y < canvas.height + 30) alive = true;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate((p.rotation * Math.PI) / 180);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = 0.8;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
        });
        if (alive && Date.now() - startTime < 4500) {
            frameId = requestAnimationFrame(draw);
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (frameId) cancelAnimationFrame(frameId);
        }
    }
    if (frameId) cancelAnimationFrame(frameId);
    draw();
}