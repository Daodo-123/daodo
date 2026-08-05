// js/timer.js

import { supabase } from './auth.js';
import { playSound, formatTime, getToday } from './config.js';
import { getTodos, updateTodoTimer } from './todos.js';

let currentUser = null;
let timerDisplay, timerStatus, timerTaskName, loopProgress, watcherFeedback;
let focusDurationInput, breakDurationInput, loopEnable, loopCount, soundSelect, watcherModeSelect;
let timerStartBtn, timerPauseBtn, timerResetBtn;

// 计时器状态
let timerSeconds = 25 * 60;
let timerRunning = false;
let timerPaused = false;
let timerInterval = null;
let timerTaskId = null;
let currentSessionMinutes = 25;
let loopActive = false;
let loopRemaining = 0;
let loopTotal = 0;
let loopPhase = 'focus'; // 'focus' | 'break'

// 观星者状态
let watcherActive = false;
let watcherCheckInterval = null;
let lastActivityTime = Date.now();
let watcherMode = 'mild'; // 'free' | 'mild' | 'strict' | 'mutual'

// 初始化计时器模块
export function initTimer(elements, user) {
    currentUser = user;
    timerDisplay = elements.timerDisplay;
    timerStatus = elements.timerStatus;
    timerTaskName = elements.timerTaskName;
    loopProgress = elements.loopProgress;
    watcherFeedback = elements.watcherFeedback;
    focusDurationInput = elements.focusDuration;
    breakDurationInput = elements.breakDuration;
    loopEnable = elements.loopEnable;
    loopCount = elements.loopCount;
    soundSelect = elements.soundSelect;
    watcherModeSelect = elements.watcherModeSelect;
    timerStartBtn = elements.timerStartBtn;
    timerPauseBtn = elements.timerPauseBtn;
    timerResetBtn = elements.timerResetBtn;
    
    // 加载设置
    loadTimerSettings();
}

// 加载计时器设置
async function loadTimerSettings() {
    const { data, error } = await supabase
        .from('sundial_settings')
        .select('focus_duration, break_duration, loop_enabled, loop_count, sound_effect')
        .eq('user_id', currentUser.id)
        .maybeSingle();
    if (error) return;
    if (data) {
        focusDurationInput.value = data.focus_duration || 25;
        breakDurationInput.value = data.break_duration || 5;
        loopEnable.checked = data.loop_enabled || false;
        loopCount.value = data.loop_count || 3;
        soundSelect.value = data.sound_effect || 'bell';
        timerSeconds = (data.focus_duration || 25) * 60;
        currentSessionMinutes = data.focus_duration || 25;
        updateTimerDisplay();
    }
}

// 更新时间显示
function updateTimerDisplay() {
    const str = formatTime(timerSeconds);
    timerDisplay.textContent = str;
    document.getElementById('miniTime').textContent = str;
    updateLoopProgress();
}

// 更新循环进度
function updateLoopProgress() {
    if (loopActive && loopTotal > 0) {
        const done = loopTotal - loopRemaining;
        loopProgress.textContent = `第 ${done}/${loopTotal} 轮 (${loopPhase === 'focus' ? '专注' : '休息'})`;
    } else {
        loopProgress.textContent = '第 0/0 轮';
    }
}

// 更新UI按钮状态
function updateUIButtons() {
    const isRunning = timerRunning && !timerPaused;
    const startText = isRunning ? '暂停' : '开始';
    const startIcon = isRunning ? 'pause' : 'play';
    timerStartBtn.innerHTML = `<i class="fas fa-${startIcon}"></i> ${startText}`;
    document.getElementById('miniStartBtn').innerHTML = `<i class="fas fa-${startIcon}"></i> ${startText}`;
    
    let statusMsg = '';
    if (timerRunning && !timerPaused) statusMsg = '专注中...';
    else if (timerPaused) statusMsg = '已暂停';
    else statusMsg = '就绪';
    timerStatus.innerHTML = `<i class="fas fa-info-circle"></i> ${statusMsg}`;
    document.getElementById('miniStatus').textContent = statusMsg;
    
    // 更新观星者反馈
    if (timerRunning && !timerPaused) {
        updateWatcherFeedback('🌟 我在看着你哦', 'active');
    } else if (timerPaused) {
        updateWatcherFeedback('⏸️ 休息一下', 'pause');
    } else {
        updateWatcherFeedback('🌟 准备好了吗？', 'idle');
    }
}

// 更新观星者反馈
function updateWatcherFeedback(message, state) {
    const icon = document.querySelector('.watcher-icon');
    const msg = document.querySelector('.watcher-message');
    if (icon && msg) {
        if (state === 'active') {
            icon.textContent = '🌟';
            msg.textContent = message || '我在看着你哦';
        } else if (state === 'pause') {
            icon.textContent = '🌙';
            msg.textContent = message || '休息一下，我等你';
        } else {
            icon.textContent = '✨';
            msg.textContent = message || '准备好了吗？';
        }
    }
}

// 获取观星者模式
function getWatcherMode() {
    return watcherModeSelect ? watcherModeSelect.value : 'mild';
}

// ---- 计时器核心 ----
export function startTimer() {
    if (timerRunning && !timerPaused) return;
    if (timerPaused) {
        timerPaused = false;
        timerRunning = true;
        timerInterval = setInterval(tick, 1000);
        updateUIButtons();
        startWatcher();
        return;
    }
    if (timerSeconds <= 0) {
        timerSeconds = currentSessionMinutes * 60;
    }
    timerRunning = true;
    timerPaused = false;
    timerInterval = setInterval(tick, 1000);
    updateUIButtons();
    startWatcher();
}

export function pauseTimer() {
    if (!timerRunning || timerPaused) return;
    timerPaused = true;
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    updateUIButtons();
    stopWatcher();
}

export function resetTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    timerRunning = false;
    timerPaused = false;
    timerSeconds = currentSessionMinutes * 60;
    updateTimerDisplay();
    updateUIButtons();
    loopActive = false;
    loopRemaining = 0;
    loopTotal = 0;
    loopPhase = 'focus';
    updateLoopProgress();
    stopWatcher();
    timerStatus.innerHTML = '<i class="fas fa-info-circle"></i> 已重置';
    document.getElementById('miniStatus').textContent = '已重置';
}

function tick() {
    if (timerSeconds <= 0) {
        // 计时结束
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        timerRunning = false;
        timerPaused = false;
        timerSeconds = 0;
        updateTimerDisplay();
        updateUIButtons();
        stopWatcher();
        
        // 播放音效
        const sound = soundSelect ? soundSelect.value : 'bell';
        playSound(sound);
        
        // 记录专注时长
        if (timerTaskId) {
            const todos = getTodos();
            const todo = todos.find(t => t.id === timerTaskId);
            if (todo) {
                updateTodoTimer(timerTaskId, currentSessionMinutes);
            }
        }
        
        // 循环模式处理
        if (loopActive && loopTotal > 0) {
            if (loopPhase === 'focus') {
                // 专注结束，进入休息
                loopPhase = 'break';
                timerSeconds = (parseInt(breakDurationInput.value) || 5) * 60;
                currentSessionMinutes = parseInt(breakDurationInput.value) || 5;
                timerRunning = true;
                timerPaused = false;
                timerInterval = setInterval(tick, 1000);
                updateTimerDisplay();
                updateUIButtons();
                timerStatus.innerHTML = '<i class="fas fa-coffee"></i> 休息中...';
                document.getElementById('miniStatus').textContent = '休息中...';
                updateWatcherFeedback('☕ 休息一下，我等你', 'pause');
                return;
            } else {
                // 休息结束，进入下一轮
                loopRemaining--;
                if (loopRemaining <= 0) {
                    loopActive = false;
                    loopTotal = 0;
                    timerSeconds = (parseInt(focusDurationInput.value) || 25) * 60;
                    currentSessionMinutes = parseInt(focusDurationInput.value) || 25;
                    updateTimerDisplay();
                    updateUIButtons();
                    timerStatus.innerHTML = '<i class="fas fa-check-circle" style="color:var(--accent-blue);"></i> 🎉 全部循环完成！';
                    document.getElementById('miniStatus').textContent = '🎉 全部完成！';
                    updateWatcherFeedback('🎉 全部完成了！太棒了！', 'idle');
                    // 触发彩带
                    const { launchConfetti } = await import('./config.js');
                    launchConfetti();
                    return;
                } else {
                    loopPhase = 'focus';
                    timerSeconds = (parseInt(focusDurationInput.value) || 25) * 60;
                    currentSessionMinutes = parseInt(focusDurationInput.value) || 25;
                    timerRunning = true;
                    timerPaused = false;
                    timerInterval = setInterval(tick, 1000);
                    updateTimerDisplay();
                    updateUIButtons();
                    const done = loopTotal - loopRemaining;
                    timerStatus.innerHTML = `<i class="fas fa-bullseye"></i> 第 ${done + 1} 轮专注`;
                    document.getElementById('miniStatus').textContent = `第 ${done + 1} 轮专注`;
                    updateWatcherFeedback(`🌟 第 ${done + 1} 轮专注，加油！`, 'active');
                    return;
                }
            }
        }
        
        // 非循环模式
        timerStatus.innerHTML = '<i class="fas fa-check-circle" style="color:var(--accent-blue);"></i> 🎉 完成！';
        document.getElementById('miniStatus').textContent = '🎉 完成！';
        updateWatcherFeedback('🎉 专注完成！你真棒！', 'idle');
        timerTaskId = null;
        updateTimerTaskName();
        // 触发彩带
        const { launchConfetti } = await import('./config.js');
        launchConfetti();
        return;
    }
    timerSeconds--;
    updateTimerDisplay();
}

// ---- 观星者模式 ----
function startWatcher() {
    watcherActive = true;
    const mode = getWatcherMode();
    watcherMode = mode;
    lastActivityTime = Date.now();
    
    if (mode === 'free') {
        // 自由模式：只显示陪伴，不监测
        updateWatcherFeedback('✨ 自由飞翔，我陪着你', 'active');
        return;
    }
    
    // 注册活动监测
    document.addEventListener('mousemove', updateActivity);
    document.addEventListener('keydown', updateActivity);
    document.addEventListener('click', updateActivity);
    
    if (mode === 'strict' || mode === 'mutual') {
        // 重度守望：定期检查
        watcherCheckInterval = setInterval(checkWatcher, 30000); // 每30秒检查一次
        updateWatcherFeedback('🌟 我会时不时看看你哦', 'active');
    } else {
        // 轻度守望：长时间无操作才提醒
        watcherCheckInterval = setInterval(checkWatcher, 60000); // 每60秒检查一次
        updateWatcherFeedback('🌙 安心专注，我在这里', 'active');
    }
}

function stopWatcher() {
    watcherActive = false;
    if (watcherCheckInterval) {
        clearInterval(watcherCheckInterval);
        watcherCheckInterval = null;
    }
    document.removeEventListener('mousemove', updateActivity);
    document.removeEventListener('keydown', updateActivity);
    document.removeEventListener('click', updateActivity);
}

function updateActivity() {
    lastActivityTime = Date.now();
}

function checkWatcher() {
    if (!watcherActive || !timerRunning || timerPaused) return;
    const now = Date.now();
    const inactiveTime = (now - lastActivityTime) / 1000; // 秒
    
    const mode = getWatcherMode();
    let threshold = 180; // 默认3分钟
    
    if (mode === 'mild') threshold = 300; // 5分钟
    else if (mode === 'strict') threshold = 120; // 2分钟
    else if (mode === 'mutual') threshold = 180; // 3分钟
    
    if (inactiveTime > threshold) {
        // 用户可能走神了
        updateWatcherFeedback('🌙 你还在吗？我等你回来', 'pause');
        timerStatus.innerHTML = `<i class="fas fa-moon"></i> 你走开了一会儿，我在等你`;
        
        // 如果是重度模式，记录一次"走神"
        if (mode === 'strict') {
            // 记录走神次数（可存数据库，这里暂不实现）
            console.log('走神检测:', new Date().toISOString());
        }
        
        // 30秒后恢复提示
        setTimeout(() => {
            if (watcherActive && timerRunning && !timerPaused) {
                updateWatcherFeedback('🌟 欢迎回来！继续专注吧', 'active');
                timerStatus.innerHTML = `<i class="fas fa-info-circle"></i> 专注继续...`;
            }
        }, 5000);
    } else if (inactiveTime > 60 && inactiveTime < threshold) {
        // 轻度提醒
        const remaining = Math.round((threshold - inactiveTime) / 60);
        if (remaining > 0 && remaining % 1 === 0) {
            updateWatcherFeedback(`⏳ 你还在吗？还有 ${remaining} 分钟`, 'active');
        }
    } else {
        updateWatcherFeedback('🌟 专注中...', 'active');
    }
}

// 关联任务
export function focusTask(id) {
    const todos = getTodos();
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    if (timerInterval) resetTimer();
    timerTaskId = id;
    const minutes = parseInt(focusDurationInput.value) || 25;
    currentSessionMinutes = minutes;
    timerSeconds = minutes * 60;
    timerRunning = false;
    timerPaused = false;
    updateTimerDisplay();
    updateUIButtons();
    timerStatus.innerHTML = `<i class="fas fa-bullseye"></i> 准备专注：<span class="highlight">${todo.text}</span> (${minutes}min)`;
    document.getElementById('miniStatus').textContent = '准备专注';
    updateTimerTaskName();
    updateWatcherFeedback(`🌟 准备专注：${todo.text}`, 'idle');
    
    // 循环设置
    loopActive = loopEnable.checked;
    if (loopActive) {
        loopTotal = parseInt(loopCount.value) || 3;
        loopRemaining = loopTotal;
        loopPhase = 'focus';
    } else {
        loopTotal = 0;
        loopRemaining = 0;
        loopPhase = 'focus';
    }
    updateLoopProgress();
}

function updateTimerTaskName() {
    if (timerTaskId) {
        const todos = getTodos();
        const todo = todos.find(t => t.id === timerTaskId);
        if (todo) {
            timerTaskName.textContent = todo.text.length > 12 ? todo.text.slice(0, 12) + '…' : todo.text;
            return;
        }
    }
    timerTaskName.textContent = '未关联';
}

// 重置计时器（外部调用）
export function resetTimerExternal() {
    resetTimer();
}

// 获取计时器状态（供mini窗口使用）
export function getTimerState() {
    return {
        seconds: timerSeconds,
        running: timerRunning,
        paused: timerPaused,
        taskId: timerTaskId,
        sessionMinutes: currentSessionMinutes,
        loopActive,
        loopRemaining,
        loopTotal,
        loopPhase
    };
}

// 设置计时器状态（从mini窗口同步）
export function setTimerState(state) {
    timerSeconds = state.seconds || 25 * 60;
    timerRunning = state.running || false;
    timerPaused = state.paused || false;
    timerTaskId = state.taskId || null;
    currentSessionMinutes = state.sessionMinutes || 25;
    loopActive = state.loopActive || false;
    loopRemaining = state.loopRemaining || 0;
    loopTotal = state.loopTotal || 0;
    loopPhase = state.loopPhase || 'focus';
    updateTimerDisplay();
    updateUIButtons();
    updateLoopProgress();
}