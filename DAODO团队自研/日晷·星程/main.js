// js/main.js

import { supabase, ensureProfile, initAuth, handleAuth, switchAuthMode, resetPassword, logout, getUser } from './auth.js';
import { getToday, getWeekday, initGlow, initStarfield, getDaysSinceFirst } from './config.js';
import { initTodos, loadTodos, addTodo, toggleTodo, deleteTodo, clearDone, focusTask as focusTodo } from './todos.js';
import { initTimer, startTimer, pauseTimer, resetTimerExternal, focusTask as focusTimerTask, getTimerState } from './timer.js';
import { initCompanions, loadCompanions, addCompanion, syncCompanion, deleteCompanion, getShareCode } from './companions.js';
import { initStats, loadHistory, loadSummary, saveSummary, renderStats, updateHistory } from './stats.js';
import { initSettings, loadAllSettings, initThemeSettings, updateProfile, exportData, importData, saveSettings } from './settings.js';

// ============================================================
//  应用入口
// ============================================================

let currentUser = null;
let todos = [];

// ---- DOM 引用 ----
const authOverlay = document.getElementById('authOverlay');
const mainApp = document.getElementById('mainApp');

// ---- 初始化 ----
async function init() {
    // 初始化星空和光晕
    initStarfield();
    initGlow();
    
    // 检查登录状态
    const session = await supabase.auth.getSession();
    if (session.data.session) {
        currentUser = session.data.session.user;
        await startApp();
    } else {
        showAuth();
    }
    
    // 绑定认证事件
    bindAuthEvents();
}

// ---- 启动应用 ----
async function startApp() {
    authOverlay.style.display = 'none';
    mainApp.classList.remove('hidden');
    
    // 确保用户有profile
    await ensureProfile();
    
    // 初始化各模块
    initTodos({
        todoList: document.getElementById('todoList'),
        doneCount: document.getElementById('doneCount'),
        totalCount: document.getElementById('totalCount'),
        focusCount: document.getElementById('focusCount'),
        progressCircle: document.getElementById('progressCircle'),
        progressText: document.getElementById('progressText')
    }, currentUser);
    
    initTimer({
        timerDisplay: document.getElementById('timerDisplay'),
        timerStatus: document.getElementById('timerStatus'),
        timerTaskName: document.getElementById('timerTaskName'),
        loopProgress: document.getElementById('loopProgress'),
        watcherFeedback: document.getElementById('watcherFeedback'),
        focusDuration: document.getElementById('focusDuration'),
        breakDuration: document.getElementById('breakDuration'),
        loopEnable: document.getElementById('loopEnable'),
        loopCount: document.getElementById('loopCount'),
        soundSelect: document.getElementById('soundSelect'),
        watcherModeSelect: document.getElementById('watcherModeSelect'),
        timerStartBtn: document.getElementById('timerStartBtn'),
        timerPauseBtn: document.getElementById('timerPauseBtn'),
        timerResetBtn: document.getElementById('timerResetBtn')
    }, currentUser);
    
    initCompanions(currentUser);
    initStats(currentUser);
    initSettings(currentUser);
    
    // 加载数据
    await loadAllSettings();
    await loadTodos();
    await loadHistory();
    await loadCompanions();
    await loadSummary();
    
    // 更新日期
    updateDateDisplay();
    
    // 加载个人资料
    await loadProfile();
    
    // 绑定主事件
    bindMainEvents();
    
    // 绑定模态框事件
    bindModalEvents();
}

// ---- 显示登录 ----
function showAuth() {
    authOverlay.style.display = 'flex';
    mainApp.classList.add('hidden');
}

// ---- 更新日期显示 ----
function updateDateDisplay() {
    const today = getToday();
    document.getElementById('dateDisplay').textContent = today;
    document.getElementById('weekdayDisplay').textContent = getWeekday(today);
    const days = getDaysSinceFirst();
    document.getElementById('dayCount').textContent = `第 ${days} 天`;
}

// ---- 加载个人资料 ----
async function loadProfile() {
    const { data, error } = await supabase
        .from('profiles')
        .select('nickname, share_code')
        .eq('id', currentUser.id)
        .single();
    if (error) return;
    if (data) {
        const name = data.nickname || '用户';
        document.getElementById('userDisplayName').textContent = name;
        document.getElementById('userAvatar').textContent = name.charAt(0).toUpperCase();
        document.getElementById('profileAvatar').textContent = name.charAt(0).toUpperCase();
        document.getElementById('profileNickname').value = name;
        document.getElementById('myShareCode').textContent = data.share_code || '#XXXXXX';
    }
}

// ---- 刷新所有数据 ----
export async function refreshAllData() {
    await loadTodos();
    await loadHistory();
    await loadCompanions();
    await loadSummary();
    updateDateDisplay();
    await loadProfile();
}

// ---- 认证事件绑定 ----
function bindAuthEvents() {
    document.getElementById('authSubmitBtn').addEventListener('click', async () => {
        const email = document.getElementById('authEmail').value.trim();
        const password = document.getElementById('authPassword').value.trim();
        const result = await handleAuth(email, password);
        if (result.success) {
            currentUser = result.user;
            await startApp();
        } else {
            document.getElementById('authError').textContent = result.msg;
        }
    });
    
    document.getElementById('authSwitch').addEventListener('click', () => {
        const isLogin = switchAuthMode();
        document.getElementById('authTitle').textContent = isLogin ? '🌙 日晷·星程' : '🌟 注册新账号';
        document.getElementById('authSubmitBtn').textContent = isLogin ? '登 录' : '注 册';
        document.getElementById('authSwitch').textContent = isLogin ? '注册' : '登录';
        document.getElementById('authError').textContent = '';
    });
    
    document.getElementById('resetPwdLink').addEventListener('click', async () => {
        const email = document.getElementById('authEmail').value.trim();
        const result = await resetPassword(email);
        document.getElementById('authError').textContent = result.msg;
        document.getElementById('authError').style.color = result.success ? 'var(--accent-blue)' : 'var(--high-priority)';
        setTimeout(() => {
            document.getElementById('authError').style.color = 'var(--high-priority)';
        }, 5000);
    });
    
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        if (confirm('确定要退出吗？')) {
            await logout();
            currentUser = null;
            showAuth();
        }
    });
}

// ---- 主事件绑定 ----
function bindMainEvents() {
    // 待办
    document.getElementById('addTodoBtn').addEventListener('click', async () => {
        const text = document.getElementById('todoInput').value.trim();
        if (!text) {
            document.getElementById('todoInput').focus();
            document.getElementById('todoInput').style.borderColor = 'var(--high-priority)';
            setTimeout(() => {
                document.getElementById('todoInput').style.borderColor = '';
            }, 800);
            return;
        }
        const priority = document.getElementById('prioritySelect').value;
        const repeat_type = document.getElementById('repeatSelect').value;
        const deadline = document.getElementById('deadlineInput').value || null;
        await addTodo(text, priority, repeat_type, deadline);
        document.getElementById('todoInput').value = '';
        document.getElementById('deadlineInput').value = '';
        document.getElementById('todoInput').focus();
    });
    
    document.getElementById('todoInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('addTodoBtn').click();
    });
    
    document.getElementById('clearDoneBtn').addEventListener('click', clearDone);
    
    document.getElementById('todoList').addEventListener('click', async (e) => {
        const target = e.target.closest('button, .checkbox');
        if (!target) return;
        const action = target.dataset.action;
        const id = target.dataset.id;
        if (!id) return;
        if (action === 'toggle') {
            await toggleTodo(id);
        } else if (action === 'delete') {
            await deleteTodo(id);
        } else if (action === 'focus') {
            focusTodo(id);
            focusTimerTask(id);
        }
    });
    
    // 计时器
    document.getElementById('timerStartBtn').addEventListener('click', startTimer);
    document.getElementById('timerPauseBtn').addEventListener('click', pauseTimer);
    document.getElementById('timerResetBtn').addEventListener('click', resetTimerExternal);
    
    // 设置变化保存
    document.getElementById('focusDuration').addEventListener('change', async () => {
        const val = parseInt(document.getElementById('focusDuration').value) || 25;
        await saveSettings({ focus_duration: val });
    });
    document.getElementById('breakDuration').addEventListener('change', async () => {
        const val = parseInt(document.getElementById('breakDuration').value) || 5;
        await saveSettings({ break_duration: val });
    });
    document.getElementById('loopEnable').addEventListener('change', async () => {
        await saveSettings({ loop_enabled: document.getElementById('loopEnable').checked });
    });
    document.getElementById('loopCount').addEventListener('change', async () => {
        const val = parseInt(document.getElementById('loopCount').value) || 3;
        await saveSettings({ loop_count: val });
    });
    document.getElementById('soundSelect').addEventListener('change', async () => {
        await saveSettings({ sound_effect: document.getElementById('soundSelect').value });
    });
    
    // 弹出迷你窗口
    document.getElementById('popoutBtn').addEventListener('click', () => {
        const url = window.location.href.split('?')[0] + '?mini=true';
        const features = 'width=380,height=320,menubar=no,toolbar=no,location=no,status=no,scrollbars=no,resizable=yes';
        const win = window.open(url, 'TimerMini', features);
        if (!win) alert('请允许弹出窗口，或手动打开：' + url);
        else win.focus();
    });
    
    // 音乐
    let musicLoaded = false;
    const audio = document.getElementById('bgMusic');
    const musicPlayBtn = document.getElementById('musicPlayBtn');
    const musicPlayText = document.getElementById('musicPlayText');
    const musicLoopBtn = document.getElementById('musicLoopBtn');
    const loopStatus = document.getElementById('loopStatus');
    const musicState = document.getElementById('musicState');
    const trackName = document.getElementById('trackName');
    const musicFileInput = document.getElementById('musicFileInput');
    
    function updateMusicUI() {
        if (audio.paused) {
            musicPlayText.textContent = '播放';
            musicPlayBtn.querySelector('i').className = 'fas fa-play';
            musicState.textContent = '已暂停';
        } else {
            musicPlayText.textContent = '暂停';
            musicPlayBtn.querySelector('i').className = 'fas fa-pause';
            musicState.textContent = '播放中 ♪';
        }
        loopStatus.textContent = audio.loop ? '开' : '关';
        musicLoopBtn.classList.toggle('active-loop', audio.loop);
    }
    
    musicPlayBtn.addEventListener('click', () => {
        if (!musicLoaded || !audio.src) {
            musicState.textContent = '请先选择音乐文件';
            return;
        }
        if (audio.paused) {
            audio.play().then(updateMusicUI).catch(() => {
                musicState.textContent = '播放失败';
            });
        } else {
            audio.pause();
            updateMusicUI();
        }
    });
    
    musicLoopBtn.addEventListener('click', () => {
        audio.loop = !audio.loop;
        updateMusicUI();
    });
    
    musicFileInput.addEventListener('change', (e) => {
        if (this.files && this.files[0]) {
            const url = URL.createObjectURL(this.files[0]);
            audio.src = url;
            audio.load();
            trackName.textContent = this.files[0].name;
            musicLoaded = true;
            musicState.textContent = '已加载，点击播放';
            musicPlayText.textContent = '播放';
            musicPlayBtn.querySelector('i').className = 'fas fa-play';
        }
    });
    
    audio.addEventListener('ended', () => {
        if (!audio.loop) {
            musicState.textContent = '已结束';
            musicPlayText.textContent = '播放';
            musicPlayBtn.querySelector('i').className = 'fas fa-play';
        }
    });
    
    // 小结
    document.getElementById('saveSummaryBtn').addEventListener('click', async () => {
        const text = document.getElementById('summaryInput').value.trim();
        await saveSummary(text);
    });
    document.getElementById('clearSummaryBtn').addEventListener('click', () => {
        if (confirm('清除今日小结？')) {
            document.getElementById('summaryInput').value = '';
            document.getElementById('savedSummary').classList.remove('show');
            saveSummary('');
        }
    });
    document.getElementById('summaryInput').addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('saveSummaryBtn').click();
        }
    });
    
    // 数据导入导出
    document.getElementById('exportDataBtn').addEventListener('click', () => {
        const { getTodos } = require('./todos.js');
        const { getHistory } = require('./stats.js');
        const { getCompanions } = require('./companions.js');
        const { getSettings } = require('./settings.js');
        // 简化：直接从全局获取
        exportData(window.__todos || [], window.__history || {}, window.__companions || {}, {});
    });
    
    document.getElementById('importDataBtn').addEventListener('click', () => {
        document.getElementById('importFileInput').click();
    });
    
    document.getElementById('importFileInput').addEventListener('change', (e) => {
        if (this.files && this.files[0]) {
            importData(this.files[0], refreshAllData);
            this.value = '';
        }
    });
    
    // 个人中心
    document.getElementById('userArea').addEventListener('click', () => {
        document.getElementById('profileModal').classList.add('active');
        document.getElementById('profileNickname').value = document.getElementById('userDisplayName').textContent;
        document.getElementById('profileAvatar').textContent = document.getElementById('userAvatar').textContent;
        document.getElementById('profileNewPassword').value = '';
    });
    
    document.getElementById('profileSaveBtn').addEventListener('click', async () => {
        const nickname = document.getElementById('profileNickname').value.trim() || '用户';
        const newPassword = document.getElementById('profileNewPassword').value.trim();
        const result = await updateProfile(nickname, newPassword);
        if (result.success) {
            alert('保存成功！');
            document.getElementById('profileModal').classList.remove('active');
        } else {
            alert(result.msg);
        }
    });
    
    // 星伴
    document.getElementById('companionBtn').addEventListener('click', () => {
        document.getElementById('companionModal').classList.add('active');
        renderCompanions();
        document.getElementById('myShareCode').textContent = getShareCode() || '#XXXXXX';
    });
    
    document.getElementById('addCompanionBtn').addEventListener('click', async () => {
        const name = document.getElementById('companionNameInput').value.trim();
        const code = document.getElementById('companionCodeInput').value.trim();
        const result = await addCompanion(name, code);
        alert(result.msg);
        if (result.success) {
            document.getElementById('companionNameInput').value = '';
            document.getElementById('companionCodeInput').value = '';
            await loadCompanions();
            renderCompanions();
        }
    });
    
    document.getElementById('companionListModal').addEventListener('click', async (e) => {
        const target = e.target.closest('button');
        if (!target) return;
        const id = target.dataset.id;
        if (!id) return;
        if (target.classList.contains('companion-sync')) {
            const result = await syncCompanion(id);
            if (result.success) alert('已同步星伴状态！');
        } else if (target.classList.contains('companion-delete')) {
            await deleteCompanion(id);
            renderCompanions();
        }
    });
    
    // 统计
    document.getElementById('statsBtn').addEventListener('click', () => {
        document.getElementById('statsModal').classList.add('active');
        renderStats();
    });
    
    // 主题设置
    document.getElementById('settingsBtn').addEventListener('click', () => {
        document.getElementById('settingsModal').classList.add('active');
        initThemeSettings();
    });
}

// ---- 模态框事件绑定 ----
function bindModalEvents() {
    // 星伴
    document.getElementById('companionClose').addEventListener('click', () => {
        document.getElementById('companionModal').classList.remove('active');
    });
    document.getElementById('companionModal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
            document.getElementById('companionModal').classList.remove('active');
        }
    });
    
    // 统计
    document.getElementById('statsClose').addEventListener('click', () => {
        document.getElementById('statsModal').classList.remove('active');
    });
    document.getElementById('statsModal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
            document.getElementById('statsModal').classList.remove('active');
        }
    });
    
    // 个人中心
    document.getElementById('profileClose').addEventListener('click', () => {
        document.getElementById('profileModal').classList.remove('active');
    });
    document.getElementById('profileModal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
            document.getElementById('profileModal').classList.remove('active');
        }
    });
    
    // 主题设置
    document.getElementById('settingsClose').addEventListener('click', () => {
        document.getElementById('settingsModal').classList.remove('active');
    });
    document.getElementById('settingsModal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
            document.getElementById('settingsModal').classList.remove('active');
        }
    });
}

// ---- 迷你窗口模式 ----
if (new URLSearchParams(window.location.search).get('mini') === 'true') {
    // 迷你模式：只显示计时器，但需要已登录状态
    document.querySelector('.app').classList.add('hidden');
    document.getElementById('miniApp').classList.remove('hidden');
    document.getElementById('authOverlay').style.display = 'none';
    
    document.getElementById('miniStartBtn').addEventListener('click', startTimer);
    document.getElementById('miniPauseBtn').addEventListener('click', pauseTimer);
    document.getElementById('miniResetBtn').addEventListener('click', resetTimerExternal);
    document.getElementById('miniReturnBtn').addEventListener('click', () => window.close());
}

// ---- 启动应用 ----
init();

// ---- 暴露到全局供调试 ----
window.__refreshData = refreshAllData;