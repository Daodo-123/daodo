// ============================================================
// Supabase 配置（请替换成你自己的值）
// ============================================================
export const SUPABASE_URL = 'https://agpznniqfxdeudwvimbb.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_0TcgungxkhJpKIJf2bHdLA_X14JILIp';

// ============================================================
// 工具函数
// ============================================================
export function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function getToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export function getWeekday(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];
}

export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

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

export function launchConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const particles = [];
    const colors = ['#6c8cff','#a77cff','#ff7eb3','#ffd76c','#6cffb0','#ff6c6c'];
    for (let i=0; i<160; i++) {
        particles.push({
            x: Math.random()*canvas.width,
            y: Math.random()*canvas.height - canvas.height,
            w: Math.random()*8+4,
            h: Math.random()*5+3,
            color: colors[Math.floor(Math.random()*colors.length)],
            vx: (Math.random()-0.5)*3,
            vy: Math.random()*4+2,
            rotation: Math.random()*360,
            rotSpeed: (Math.random()-0.5)*6
        });
    }
    let frameId = null, startTime = Date.now();
    function draw() {
        ctx.clearRect(0,0,canvas.width,canvas.height);
        let alive = false;
        particles.forEach(p => {
            p.x += p.vx; p.y += p.vy; p.vy += 0.06;
            p.rotation += p.rotSpeed;
            if (p.y < canvas.height+30) alive = true;
            ctx.save();
            ctx.translate(p.x,p.y);
            ctx.rotate((p.rotation*Math.PI)/180);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = 0.8;
            ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);
            ctx.restore();
        });
        if (alive && Date.now()-startTime < 4500) {
            frameId = requestAnimationFrame(draw);
        } else {
            ctx.clearRect(0,0,canvas.width,canvas.height);
            if (frameId) cancelAnimationFrame(frameId);
        }
    }
    if (frameId) cancelAnimationFrame(frameId);
    draw();
}

export function initStarfield() {
    const canvas = document.getElementById('starfield');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let stars = [];
    const NUM_STARS = 200;
    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        stars = [];
        for (let i=0; i<NUM_STARS; i++) {
            stars.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                r: Math.random() * 1.5 + 0.5,
                a: Math.random() * 0.8 + 0.2,
                speed: Math.random() * 0.005 + 0.002
            });
        }
    }
    window.addEventListener('resize', resize);
    resize();
    function drawStars() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        stars.forEach(s => {
            s.a += s.speed * 0.1;
            if (s.a > 1 || s.a < 0.2) s.speed = -s.speed;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI*2);
            ctx.fillStyle = `rgba(255,255,255,${s.a})`;
            ctx.fill();
        });
        requestAnimationFrame(drawStars);
    }
    drawStars();
}

export function initGlow() {
    const glow = document.getElementById('glow');
    if (!glow) return;
    document.addEventListener('mousemove', (e) => {
        glow.style.left = e.clientX + 'px';
        glow.style.top = e.clientY + 'px';
    });
}

export function applyTheme(themeName) {
    if (themeName === 'custom') {
        const custom = JSON.parse(localStorage.getItem('sundial_custom_theme') || '{"primary":"#6c8cff","background":"#0b0a1a","text":"#f0edff"}');
        document.documentElement.style.setProperty('--bg-start', custom.background);
        document.documentElement.style.setProperty('--bg-end', custom.background);
        document.documentElement.style.setProperty('--text-primary', custom.text);
        document.documentElement.style.setProperty('--accent-blue', custom.primary);
        document.documentElement.style.setProperty('--accent-purple', custom.primary);
    } else {
        document.documentElement.setAttribute('data-theme', themeName || 'dark');
        document.documentElement.style.removeProperty('--bg-start');
        document.documentElement.style.removeProperty('--bg-end');
        document.documentElement.style.removeProperty('--text-primary');
        document.documentElement.style.removeProperty('--accent-blue');
        document.documentElement.style.removeProperty('--accent-purple');
    }
}

export function getDaysSinceFirst() {
    const stored = localStorage.getItem('sundial_first_use');
    if (!stored) {
        localStorage.setItem('sundial_first_use', getToday());
        return 1;
    }
    const first = new Date(stored + 'T00:00:00');
    const today = new Date(getToday() + 'T00:00:00');
    return Math.floor((today - first) / (1000*60*60*24)) + 1;
}

// ============================================================
// 初始化 Supabase 客户端（加在底部）
// ============================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/module/index.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        storage: localStorage,
        storageKey: 'sundial-auth'
    }
});
