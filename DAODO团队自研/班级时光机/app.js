// ================================================================
//  app.js - 班级时光机 v3.2
//  完整功能：认证、班级管理、动态、消息、AI、群聊、管理后台等
//  支持主主页（班级大厅） ↔ 副主页（班级空间）双视图切换
// ================================================================

// 占位函数（旧架构残留）
function renderSidebarLevel() {}
function updateSidebarMenu() {}

// ---------- 全局状态 ----------
var isOwner = false;
var currentUser = null;
var currentUserRole = 'student';
var currentClassId = null;
var currentClassRole = null;
var userClasses = [];
var _supabaseClient = null;
var currentChatTarget = null;
var currentChatType = 'user';
var chatHistory = [];
var typingChannel = null;
var quotedMessage = null;
var currentGroupId = null;
var dynPage = 0;
var dynPageSize = 15;
var dynLoading = false;
var dynHasMore = true;
var selectedAreaPath = [];
var messageSubscription = null;
var aiConversationHistory = [];

// ---------- 工具函数 ----------
function getDefaultAvatarSVG(emoji) {
    emoji = emoji || '👤';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
              '<rect width="100" height="100" fill="#ccc"/>' +
              '<text x="50" y="68" font-size="56" text-anchor="middle" fill="#666" font-family="system-ui">' + emoji + '</text>' +
              '</svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function getSupabase() {
    if (!_supabaseClient) {
        _supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    }
    return _supabaseClient;
}

function toast(msg, icon) {
    icon = icon || '';
    var t = document.getElementById('toast');
    if (!t) return;
    t.innerText = (icon ? icon + ' ' : '') + msg;
    t.style.display = 'block';
    clearTimeout(t._timer);
    t._timer = setTimeout(function() { t.style.display = 'none'; }, 3000);
}

function closeSidebar() { /* 移动端无侧边栏，留空 */ }
function openSidebar() { /* 无侧边栏 */ }

function filterSensitiveWords(text) {
    var filtered = text;
    SENSITIVE_WORDS.forEach(function(word) {
        var regex = new RegExp(word, 'gi');
        filtered = filtered.replace(regex, '***');
    });
    return filtered;
}

async function isUserBanned(email) {
    var supabase = getSupabase();
    var { data, error } = await supabase.from('banned_users').select('banned_until').eq('user_email', email).maybeSingle();
    if (error || !data) return false;
    if (!data.banned_until) return true;
    return new Date(data.banned_until) > new Date();
}

function dataURLToBlob(dataUrl) {
    var arr = dataUrl.split(',');
    var mime = arr[0].match(/:(.*?);/)[1];
    var bstr = atob(arr[1]);
    var n = bstr.length;
    var u8arr = new Uint8Array(n);
    for (var i = 0; i < n; i++) u8arr[i] = bstr.charCodeAt(i);
    return new Blob([u8arr], { type: mime });
}

// ---------- 等级系统 ----------
function getLevelInfo(exp) {
    var result = { level: 0, exp: 0, color: '#b0a098', title: '🌱 班级萌芽', nextExp: 300, progress: 0 };
    for (var i = LEVEL_CONFIG.length - 1; i >= 0; i--) {
        if (exp >= LEVEL_CONFIG[i].exp) {
            result.level = LEVEL_CONFIG[i].level;
            result.exp = LEVEL_CONFIG[i].exp;
            result.color = LEVEL_CONFIG[i].color;
            result.title = LEVEL_CONFIG[i].title;
            if (i < LEVEL_CONFIG.length - 1) {
                result.nextExp = LEVEL_CONFIG[i + 1].exp;
                result.progress = Math.min(100, Math.round((exp - LEVEL_CONFIG[i].exp) / (LEVEL_CONFIG[i + 1].exp - LEVEL_CONFIG[i].exp) * 100));
            } else {
                result.nextExp = exp;
                result.progress = 100;
            }
            break;
        }
    }
    return result;
}

function getLevelBadgeClass(level) {
    return 'lv' + Math.min(level, 10);
}

// ---------- 站主初始化 ----------
async function initOwnerAccount() {
    var supabase = getSupabase();
    try {
        var { data: existing, error } = await supabase
            .from('profiles')
            .select('id, email')
            .eq('email', OWNER_EMAIL)
            .maybeSingle();
        if (error) { console.warn('检查站主失败:', error); return; }
        if (existing) {
            await supabase
                .from('profiles')
                .update({ nickname: OWNER_NICKNAME, sign: '班级时光机创始人' })
                .eq('email', OWNER_EMAIL);
            console.log('站主账号已存在，跳过创建');
            return;
        }
        var { data: signUpData, error: signUpError } = await supabase.auth.signUp({
            email: OWNER_EMAIL,
            password: OWNER_PASSWORD
        });
        if (signUpError) { console.warn('站主注册失败:', signUpError); return; }
        var user = signUpData.user;
        if (!user) { toast('站主创建失败'); return; }
        await supabase.from('profiles').insert([{
            id: user.id,
            email: OWNER_EMAIL,
            nickname: OWNER_NICKNAME,
            sign: '班级时光机创始人',
            avatar: '',
            role: 'owner'
        }]);
        await supabase.from('user_stats').insert([{
            user_email: OWNER_EMAIL,
            level: 1,
            exp: 0,
            total_exp: 0,
            points: 100,
            login_streak: 0,
            last_login: new Date().toISOString()
        }]);
        toast('站主账号已初始化');
    } catch (e) { console.warn('初始化站主异常:', e); }
}

async function giveTeacherFrame(email) {
    var supabase = getSupabase();
    var { data: frame } = await supabase.from('avatar_items').select('id').eq('name', '🎓 教师·毕业季').maybeSingle();
    if (!frame) return;
    var { data: existing } = await supabase.from('user_avatar_items').select('id').eq('user_email', email).eq('item_id', frame.id).maybeSingle();
    if (!existing) {
        await supabase.from('user_avatar_items').insert({ user_email: email, item_id: frame.id, is_equipped: true });
    }
}

async function isTeacher(email) {
    var supabase = getSupabase();
    var { data, error } = await supabase.from('profiles').select('role').eq('email', email).maybeSingle();
    if (error || !data) return false;
    return data.role === 'teacher' || data.role === 'owner';
}

// ---------- 认证系统 ----------
async function signUp(email, password, nickname, role) {
    role = role || 'student';
    var supabase = getSupabase();
    var result = await supabase.auth.signUp({ email: email, password: password });
    if (result.error) { toast('注册失败：' + result.error.message); return false; }
    var user = result.data.user;
    await supabase.from('profiles').insert([{
        id: user.id,
        email: email,
        nickname: nickname,
        sign: '',
        avatar: '',
        role: role
    }]);
    await supabase.from('user_stats').insert([{
        user_email: email,
        level: 1,
        exp: 0,
        total_exp: 0,
        points: 10,
        login_streak: 0,
        last_login: new Date().toISOString()
    }]);
    if (role === 'teacher') {
        await giveTeacherFrame(email);
    }
    toast('注册成功！请登录');
    return true;
}

async function signIn(email, password) {
    var supabase = getSupabase();
    var result = await supabase.auth.signInWithPassword({ email: email, password: password });
    if (result.error) { toast('登录失败：' + result.error.message); return false; }
    currentUser = result.data.user;
    var profileResult = await supabase.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
    if (profileResult.data) {
        currentUser.profile = profileResult.data;
        currentUser.nickname = profileResult.data.nickname || email.split('@')[0];
        currentUser.avatar = profileResult.data.avatar || '';
        currentUser.sign = profileResult.data.sign || '';
        currentUserRole = profileResult.data.role || 'student';
    } else {
        currentUser.nickname = email.split('@')[0];
        currentUser.avatar = '';
        currentUser.sign = '';
        currentUserRole = 'student';
    }
    isOwner = (email === OWNER_EMAIL);
    if (isOwner) { currentUserRole = 'owner'; localStorage.removeItem('blog_login'); }
    else { localStorage.setItem('blog_login', JSON.stringify({ email: email, autoLogin: true })); }

    var statsResult = await supabase.from('user_stats').select('*').eq('user_email', email).maybeSingle();
    if (!statsResult.data) {
        await supabase.from('user_stats').insert([{ user_email: email, level: 1, exp: 0, total_exp: 0, points: 10, login_streak: 0, last_login: new Date().toISOString() }]);
        statsResult = await supabase.from('user_stats').select('*').eq('user_email', email).single();
    }
    currentUser.stats = statsResult.data || { level: 1, exp: 0, total_exp: 0, points: 10, login_streak: 0 };

    if (currentUserRole === 'teacher') {
        await giveTeacherFrame(email);
    }

    await handleLoginCheckin(email);
    await loadUserClasses();

    enterMain();
    initOwnerAccount();
    setTimeout(function() {
        renderHomeView(); // 渲染主主页
        updateUIForView('home'); // 默认主主页
        loadDynamics(true);
        loadNotice();
        loadPolls();
        loadDoc();
        loadCalendar();
        loadAlbum();
        loadContactList();
        updateMsgBadge();
        applySettings();
        subscribeToMessages();
        renderSidebarLevel(); // 适配（虽无侧边栏但保留函数）
        loadEquippedItems();
        loadTeacherMessages();
        loadCapsules();
        loadTimeline();
        loadDestinations();
        renderClassList();
        checkForNewVersion();
    }, 200);
    return true;
}

async function signOut() {
    var supabase = getSupabase();
    await supabase.auth.signOut();
    localStorage.removeItem('blog_login');
    location.reload();
}

async function autoLogin() {
    var supabase = getSupabase();
    var info = JSON.parse(localStorage.getItem('blog_login') || '{}');
    if (info.email && info.email === OWNER_EMAIL) { localStorage.removeItem('blog_login'); return false; }
    if (!info.autoLogin || !info.email) return false;
    var sessionResult = await supabase.auth.getSession();
    if (sessionResult.data && sessionResult.data.session) {
        var userResult = await supabase.auth.getUser();
        if (userResult.data && userResult.data.user) {
            currentUser = userResult.data.user;
            var profileResult = await supabase.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
            if (profileResult.data) {
                currentUser.profile = profileResult.data;
                currentUser.nickname = profileResult.data.nickname || currentUser.email.split('@')[0];
                currentUser.avatar = profileResult.data.avatar || '';
                currentUser.sign = profileResult.data.sign || '';
                currentUserRole = profileResult.data.role || 'student';
            } else {
                currentUser.nickname = currentUser.email.split('@')[0];
                currentUser.avatar = '';
                currentUser.sign = '';
                currentUserRole = 'student';
            }
            isOwner = (currentUser.email === OWNER_EMAIL);
            if (isOwner) { currentUserRole = 'owner'; localStorage.removeItem('blog_login'); return false; }
            var statsResult = await supabase.from('user_stats').select('*').eq('user_email', currentUser.email).maybeSingle();
            if (!statsResult.data) {
                await supabase.from('user_stats').insert([{ user_email: currentUser.email, level: 1, exp: 0, total_exp: 0, points: 10, login_streak: 0, last_login: new Date().toISOString() }]);
                statsResult = await supabase.from('user_stats').select('*').eq('user_email', currentUser.email).single();
            }
            currentUser.stats = statsResult.data || { level: 1, exp: 0, total_exp: 0, points: 10, login_streak: 0 };

            if (currentUserRole === 'teacher') {
                await giveTeacherFrame(currentUser.email);
            }

            await handleLoginCheckin(currentUser.email);
            await loadUserClasses();
            enterMain();
            initOwnerAccount();
setTimeout(function() {
    goHome();  // 直接切换到主主页
    loadDynamics(true);
    loadNotice();
    loadPolls();
    loadDoc();
    loadCalendar();
    loadAlbum();
    loadContactList();
    updateMsgBadge();
    applySettings();
    subscribeToMessages();
    renderSidebarLevel(); // 可保留（但需定义）
    loadEquippedItems();
    loadTeacherMessages();
    loadCapsules();
    loadTimeline();
    loadDestinations();
    renderClassList();
    checkForNewVersion();
}, 200);
            return true;
        }
    }
    return false;
}

// ---------- 登录签到 ----------
async function handleLoginCheckin(email) {
    var supabase = getSupabase();
    var today = new Date().toISOString().slice(0, 10);
    var stats = await supabase.from('user_stats').select('*').eq('user_email', email).maybeSingle();
    if (!stats.data) return;

    var lastLogin = stats.data.last_login ? stats.data.last_login.slice(0, 10) : '';
    var streak = stats.data.login_streak || 0;
    var exp = stats.data.exp || 0;
    var points = stats.data.points || 0;
    var level = stats.data.level || 1;
    var totalExp = stats.data.total_exp || 0;

    if (lastLogin !== today) {
        var yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        var yesterdayStr = yesterday.toISOString().slice(0, 10);
        if (lastLogin === yesterdayStr) { streak += 1; } else { streak = 1; }
        var bonusExp = 10, bonusPoints = 5;
        if (streak % 7 === 0) {
            bonusExp += 100; bonusPoints += 20;
            toast('🎉 连续签到7天！额外获得 +100经验 +20积分！');
        }
        exp += bonusExp; points += bonusPoints; totalExp += bonusExp;

        var newLevel = level;
        for (var i = 0; i < LEVEL_CONFIG.length; i++) {
            if (exp >= LEVEL_CONFIG[i].exp) { newLevel = LEVEL_CONFIG[i].level; }
        }
        if (newLevel > level) {
            toast('🎊 恭喜升级到 Lv.' + newLevel + '！');
            points += newLevel * 5;
        }

        await supabase.from('user_stats').update({
            exp: exp, total_exp: totalExp, points: points, level: newLevel,
            login_streak: streak, last_login: new Date().toISOString()
        }).eq('user_email', email);

        if (currentUser && currentUser.email === email) {
            currentUser.stats = { exp: exp, total_exp: totalExp, points: points, level: newLevel, login_streak: streak };
        }
    }
    return { exp: exp, points: points, level: level, streak: streak };
}

async function addExp(email, expAmount, reason) {
    if (!email) return;
    var supabase = getSupabase();
    var stats = await supabase.from('user_stats').select('*').eq('user_email', email).maybeSingle();
    if (!stats.data) return;

    var newExp = stats.data.exp + expAmount;
    var totalExp = stats.data.total_exp + expAmount;
    var points = stats.data.points || 0;
    var level = stats.data.level || 1;
    var newLevel = level;

    for (var i = 0; i < LEVEL_CONFIG.length; i++) {
        if (newExp >= LEVEL_CONFIG[i].exp) { newLevel = LEVEL_CONFIG[i].level; }
    }

    await supabase.from('exp_logs').insert([{
        user_email: email, exp_change: expAmount, reason: reason || '日常活动',
        created_at: new Date().toISOString()
    }]);

    if (newLevel > level) {
        toast('🎊 ' + (email === currentUser.email ? '你' : '用户') + ' 升级到 Lv.' + newLevel + '！');
        points += newLevel * 5;
    }

    await supabase.from('user_stats').update({
        exp: newExp, total_exp: totalExp, points: points, level: newLevel
    }).eq('user_email', email);

    if (currentUser && currentUser.email === email) {
        currentUser.stats = { exp: newExp, total_exp: totalExp, points: points, level: newLevel, login_streak: stats.data.login_streak };
        renderSidebarLevel();
    }
}

// ---------- 班级管理 ----------
async function loadUserClasses() {
    if (!currentUser) return;
    var supabase = getSupabase();
    var { data, error } = await supabase.from('class_members')
        .select('class_id, role, classes(*)')
        .eq('user_email', currentUser.email);
    if (error) { console.error('加载班级失败:', error); return; }
    userClasses = data || [];
    if (userClasses.length > 0 && !currentClassId) {
        currentClassId = userClasses[0].class_id;
        currentClassRole = userClasses[0].role;
    }
    renderClassList();
}

async function renderClassList() {
    var wrap = document.getElementById('myClassList');
    if (!wrap) return;
    if (userClasses.length === 0) {
        wrap.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-secondary);padding:40px 0;">你还没有加入任何班级<br><span style="font-size:0.85rem;">点击下方「创建班级」或「加入班级」开始</span></div>';
        return;
    }
    var supabase = getSupabase();
    var html = '';
    var classCount = document.getElementById('classCount');
    if (classCount) classCount.textContent = '（' + userClasses.length + '个）';

    for (var i = 0; i < userClasses.length; i++) {
        var c = userClasses[i];
        var cls = c.classes;
        if (!cls) continue;
        var isActive = (c.class_id === currentClassId);
        var roleMap = { owner: '⭐ 站主', teacher: '🎓 教师', member: '👤 成员' };
        var roleText = roleMap[c.role] || '成员';

        var { data: members } = await supabase.from('class_members').select('user_email', { count: 'exact' }).eq('class_id', c.class_id);
        var memberCount = members ? members.length : 0;

        var { data: lastDyn } = await supabase.from('dynamics').select('created_at').eq('class_id', c.class_id).order('created_at', { ascending: false }).limit(1);
        var lastTime = lastDyn && lastDyn.length > 0 ? lastDyn[0].created_at : null;
        var lastActive = lastTime ? timeAgo(new Date(lastTime)) : '暂无动态';

        var { data: unreadMsgs } = await supabase.from('messages').select('id', { count: 'exact' })
            .eq('class_id', c.class_id)
            .eq('to_user', currentUser.email)
            .eq('read', false);
        var unreadCount = unreadMsgs ? unreadMsgs.length : 0;

        // 生成卡片（带3D hover效果）
        html += `<div class="class-card" data-class-id="${c.class_id}" onclick="enterClass('${c.class_id}')">
            <div class="card-name">${cls.name}</div>
            <div class="card-meta">${cls.school_name || ''} · ${cls.grade || ''} · ${roleText}</div>
            <div class="card-footer">
                <span>👥 ${memberCount}人 · ${lastActive}</span>
                ${unreadCount > 0 ? `<span class="card-badge">📩 ${unreadCount}条未读</span>` : ''}
            </div>
        </div>`;
    }
    wrap.innerHTML = html;
}

function timeAgo(date) {
    var seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return seconds + '秒前';
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + '分钟前';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + '小时前';
    var days = Math.floor(hours / 24);
    if (days < 30) return days + '天前';
    var months = Math.floor(days / 30);
    if (months < 12) return months + '个月前';
    return Math.floor(months / 12) + '年前';
}

// ---------- 创建/加入班级 ----------
async function createClass(name, schoolName, grade, graduationYear, isPublic) {
    var supabase = getSupabase();
    var inviteCode = 'class_' + Date.now().toString(36);
    var { data, error } = await supabase.from('classes').insert({
        name: name,
        school_name: schoolName,
        grade: grade,
        graduation_year: parseInt(graduationYear) || null,
        invite_code: inviteCode,
        is_public: isPublic,
        created_by: currentUser.email
    }).select();
    if (error) { toast('创建失败：' + error.message); return false; }
    var classId = data[0].id;
    await supabase.from('class_members').insert({
        class_id: classId,
        user_email: currentUser.email,
        role: 'owner'
    });
    await loadUserClasses();
    currentClassId = classId;
    currentClassRole = 'owner';
    renderClassList();
    toast('✅ 班级创建成功！邀请码：' + inviteCode);
    return true;
}

async function joinClassByInvite(inviteCode) {
    var supabase = getSupabase();
    var { data, error } = await supabase.from('classes').select('*').eq('invite_code', inviteCode).maybeSingle();
    if (error || !data) { toast('邀请码无效'); return false; }
    if (data.is_archived) { toast('该班级已归档，无法加入'); return false; }
    var { data: existing } = await supabase.from('class_members').select('id').eq('class_id', data.id).eq('user_email', currentUser.email).maybeSingle();
    if (existing) { toast('你已加入该班级'); return false; }
    await supabase.from('class_members').insert({
        class_id: data.id,
        user_email: currentUser.email,
        role: 'member'
    });
    await loadUserClasses();
    currentClassId = data.id;
    currentClassRole = 'member';
    renderClassList();
    toast('✅ 已加入 ' + data.name);
    return true;
}

async function searchClasses(keyword) {
    var supabase = getSupabase();
    var { data, error } = await supabase.from('classes')
        .select('*')
        .eq('is_public', true)
        .eq('is_archived', false)
        .ilike('name', '%' + keyword + '%');
    if (error) { console.error(error); return []; }
    return data || [];
}

// ---------- 版本更新 ----------
async function checkForNewVersion() {
    if (!currentUser) return;
    var supabase = getSupabase();
    var { data: latest, error } = await supabase
        .from('version_logs')
        .select('*')
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error || !latest) return;

    var lastSeenVersion = localStorage.getItem('last_seen_version_' + currentUser.email);
    if (latest.version !== lastSeenVersion) {
        showVersionPopup(latest);
        localStorage.setItem('last_seen_version_' + currentUser.email, latest.version);
    }
}

function showVersionPopup(versionData) {
    var modal = document.createElement('div');
    modal.className = 'modal-mask open';
    modal.style.display = 'flex';
    var majorBadge = versionData.is_major ? ' <span class="major-badge">🎉 重大更新</span>' : '';
    var contentHtml = versionData.content ? versionData.content.replace(/\n/g, '<br>') : '';
    modal.innerHTML = `
        <div class="modal" style="max-width:560px;">
            <h3>📢 版本更新 ${versionData.version} ${majorBadge}</h3>
            <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:12px;">${new Date(versionData.published_at).toLocaleDateString('zh-CN')}</div>
            <div style="white-space:pre-wrap;font-size:0.95rem;line-height:1.8;color:var(--text-secondary);">${contentHtml}</div>
            <div class="modal-btns">
                <button class="btn-cancel" onclick="this.closest('.modal-mask').style.display='none'">关闭</button>
                <button class="btn-save" onclick="this.closest('.modal-mask').style.display='none'">查看全部</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.onclick = function(e) { if (e.target === modal) modal.style.display = 'none'; };
}

async function loadChangelog() {
    var supabase = getSupabase();
    var { data, error } = await supabase.from('version_logs').select('*').order('published_at', { ascending: false });
    if (error) { console.error(error); return; }
    var wrap = document.getElementById('changelogList');
    if (!wrap) return;
    if (!data || data.length === 0) {
        wrap.innerHTML = '<div style="color:var(--text-secondary);padding:20px;text-align:center;">暂无更新记录</div>';
        return;
    }
    var html = '';
    data.forEach(function(item) {
        var majorBadge = item.is_major ? ' <span class="major-badge">🎉 重大更新</span>' : '';
        var contentHtml = item.content ? item.content.replace(/\n/g, '<br>') : '';
        html += `
            <div class="changelog-item">
                <div>
                    <span class="version">${item.version}</span>
                    <span class="date">${new Date(item.published_at).toLocaleDateString('zh-CN')}</span>
                    ${majorBadge}
                </div>
                ${item.title ? '<div class="title">' + item.title + '</div>' : ''}
                <div class="content">${contentHtml}</div>
            </div>
        `;
    });
    wrap.innerHTML = html;
}

// ---------- 时间胶囊 ----------
async function loadCapsules() {
    if (!currentClassId) return;
    var supabase = getSupabase();
    var { data, error } = await supabase.from('time_capsules')
        .select('*')
        .eq('user_email', currentUser.email)
        .eq('class_id', currentClassId)
        .order('created_at', { ascending: false });
    if (error) { console.error(error); return; }
    var wrap = document.getElementById('capsuleList');
    if (!wrap) return;
    if (!data || data.length === 0) {
        wrap.innerHTML = '<div style="color:var(--text-secondary);padding:20px;text-align:center;">还没有时间胶囊<br><span style="font-size:0.85rem;">写一封信给未来的自己或同学吧 💌</span></div>';
        return;
    }
    var html = '';
    var today = new Date().toISOString().slice(0, 10);
    for (var i = 0; i < data.length; i++) {
        var c = data[i];
        var isUnlocked = c.unlock_date <= today;
        var lockedClass = isUnlocked ? '' : 'capsule-locked';
        var lockIcon = isUnlocked ? '📖' : '🔒';
        var unlockDate = new Date(c.unlock_date).toLocaleDateString('zh-CN');
        html += '<div class="capsule-item ' + (isUnlocked ? '' : 'locked') + '">' +
            '<div class="capsule-meta">' + lockIcon + ' ' + c.nickname + ' → ' + c.capsule_to + ' · 解锁于 ' + unlockDate + '</div>' +
            '<div class="capsule-content ' + lockedClass + '">' + (isUnlocked ? c.content : '🔒 此信件尚未解锁，请在 ' + unlockDate + ' 后查看') + '</div>' +
            '</div>';
    }
    wrap.innerHTML = html;
}

async function createCapsule(to, content, unlockDate) {
    if (!currentClassId) { toast('请先选择班级'); return false; }
    var supabase = getSupabase();
    var { error } = await supabase.from('time_capsules').insert({
        user_email: currentUser.email,
        nickname: currentUser.nickname,
        capsule_to: to,
        content: content,
        unlock_date: unlockDate,
        class_id: currentClassId
    });
    if (error) { toast('封存失败：' + error.message); return false; }
    toast('💌 时间胶囊已封存！');
    loadCapsules();
    return true;
}

// ---------- 班级大事记 ----------
async function loadTimeline() {
    if (!currentClassId) return;
    var supabase = getSupabase();
    var { data, error } = await supabase.from('class_timeline')
        .select('*')
        .eq('class_id', currentClassId)
        .order('event_date', { ascending: false });
    if (error) { console.error(error); return; }
    var wrap = document.getElementById('timelineList');
    if (!wrap) return;
    if (!data || data.length === 0) {
        wrap.innerHTML = '<div style="color:var(--text-secondary);padding:20px;text-align:center;">还没有大事记<br><span style="font-size:0.85rem;">记录班级的重要时刻吧 📜</span></div>';
        return;
    }
    var html = '';
    for (var i = 0; i < data.length; i++) {
        var t = data[i];
        var dateStr = new Date(t.event_date).toLocaleDateString('zh-CN');
        html += '<div class="timeline-item">' +
            '<div class="timeline-date">' + dateStr + '</div>' +
            '<div class="timeline-content">' +
            '<div class="title">' + t.title + '</div>' +
            '<div class="desc">' + (t.description || '') + '</div>' +
            (t.created_by === currentUser.email || currentUserRole === 'owner' ? '<span style="font-size:0.7rem;color:var(--text-muted);cursor:pointer;" onclick="deleteTimeline(\'' + t.id + '\')">删除</span>' : '') +
            '</div></div>';
    }
    wrap.innerHTML = html;
}

async function addTimeline(title, description, eventDate) {
    if (!currentClassId) { toast('请先选择班级'); return false; }
    var supabase = getSupabase();
    var { error } = await supabase.from('class_timeline').insert({
        class_id: currentClassId,
        title: title,
        description: description,
        event_date: eventDate,
        created_by: currentUser.email
    });
    if (error) { toast('添加失败：' + error.message); return false; }
    toast('✅ 大事记已添加');
    loadTimeline();
    return true;
}

async function deleteTimeline(id) {
    if (!confirm('确定删除这条大事记吗？')) return;
    var supabase = getSupabase();
    var { error } = await supabase.from('class_timeline').delete().eq('id', id);
    if (error) { toast('删除失败'); return; }
    toast('已删除');
    loadTimeline();
}

// ---------- 去向登记 ----------
async function loadDestinations() {
    var supabase = getSupabase();
    var { data, error } = await supabase.from('alumni_destinations')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) { console.error(error); return; }
    var wrap = document.getElementById('destinationList');
    if (!wrap) return;
    if (!data || data.length === 0) {
        wrap.innerHTML = '<div style="color:var(--text-secondary);padding:20px;text-align:center;">还没有同学登记去向<br><span style="font-size:0.85rem;">点击「登记我的去向」让同学们知道你的去向 🗺️</span></div>';
        return;
    }
    var html = '';
    for (var i = 0; i < data.length; i++) {
        var d = data[i];
        var typeLabel = d.is_high_school ? '🏫 高中' : '🎓 大学';
        var isMe = d.user_email === currentUser.email;
        html += '<div class="destination-card">' +
            '<div><strong>' + d.user_email + (isMe ? ' (我)' : '') + '</strong> → ' + d.school_name +
            (d.major ? ' · ' + d.major : '') +
            (d.city ? ' · 📍 ' + d.city : '') +
            ' <span style="font-size:0.7rem;color:var(--text-muted);">' + typeLabel + '</span></div>' +
            (isMe || currentUserRole === 'owner' ? '<span style="color:var(--text-muted);cursor:pointer;font-size:0.8rem;" onclick="deleteDestination(\'' + d.id + '\')">删除</span>' : '') +
            '</div>';
    }
    wrap.innerHTML = html;
}

async function addDestination(school, major, city, isHighSchool) {
    var supabase = getSupabase();
    var { data, error } = await supabase.from('alumni_destinations').insert({
        user_email: currentUser.email,
        school_name: school,
        major: major || null,
        city: city || null,
        is_high_school: isHighSchool
    });
    if (error) { toast('保存失败：' + error.message); return false; }
    toast('✅ 去向已登记！');
    loadDestinations();
    return true;
}

async function deleteDestination(id) {
    if (!confirm('确定删除这条登记吗？')) return;
    var supabase = getSupabase();
    var { error } = await supabase.from('alumni_destinations').delete().eq('id', id);
    if (error) { toast('删除失败'); return; }
    toast('已删除');
    loadDestinations();
}

// ---------- 教师寄语 ----------
async function loadTeacherMessages() {
    var supabase = getSupabase();
    var { data, error } = await supabase.from('teacher_messages').select('*').order('is_pinned', { ascending: false }).order('created_at', { ascending: false });
    if (error) { console.error(error); return; }
    var wrap = document.getElementById('teacherMessageList');
    if (!wrap) return;
    if (!data || data.length === 0) {
        wrap.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:30px;">暂无毕业寄语 🎓</div>';
        return;
    }
    var html = '';
    data.forEach(function(msg) {
        var isPinned = msg.is_pinned || false;
        var canDelete = (msg.user_email === currentUser.email || currentUserRole === 'owner');
        var canPin = (currentUserRole === 'teacher' || currentUserRole === 'owner');
        var timeStr = new Date(msg.created_at).toLocaleString();
        var pinnedTag = isPinned ? '<span style="background:var(--brand-start);color:#fff;padding:2px 12px;border-radius:var(--radius-full);font-size:0.6rem;font-weight:600;margin-left:8px;">📌 置顶</span>' : '';
        html += '<div class="dynamic-item teacher-featured" style="' + (isPinned ? 'border-left:4px solid var(--brand-start);' : '') + '">' +
            '<div class="user-head"><div><div class="nickname">🎓 ' + msg.nickname + ' <span class="teacher-tag">教师</span>' + pinnedTag + '</div><div class="sign">' + timeStr + '</div></div></div>' +
            '<div class="dynamic-text" style="font-size:1.05rem;line-height:1.8;">' + msg.content + '</div>' +
            (canDelete || canPin ? '<div class="dyn-op" style="margin-top:8px;">' : '') +
            (canPin ? '<span onclick="togglePinTeacherMessage(\'' + msg.id + '\',' + !isPinned + ')" style="cursor:pointer;color:var(--brand-start);">' + (isPinned ? '📌 取消置顶' : '📌 置顶') + '</span>' : '') +
            (canDelete ? '<span onclick="deleteTeacherMessage(\'' + msg.id + '\')" style="cursor:pointer;color:var(--danger);">🗑️ 删除</span>' : '') +
            (canDelete || canPin ? '</div>' : '') +
            '</div>';
    });
    wrap.innerHTML = html;
}

async function sendTeacherMessage(content) {
    if (!content.trim()) return;
    var supabase = getSupabase();
    var { error } = await supabase.from('teacher_messages').insert({
        user_email: currentUser.email,
        nickname: currentUser.nickname,
        content: filterSensitiveWords(content),
        is_pinned: false,
        created_at: new Date().toISOString()
    });
    if (error) { toast('发送失败：' + error.message); return; }
    toast('💌 寄语已发布！');
    document.getElementById('teacherMessageInput').value = '';
    loadTeacherMessages();
}

async function togglePinTeacherMessage(msgId, isPinned) {
    var supabase = getSupabase();
    var { error } = await supabase.from('teacher_messages').update({ is_pinned: isPinned }).eq('id', msgId);
    if (error) { toast('操作失败：' + error.message); return; }
    toast(isPinned ? '📌 已置顶' : '已取消置顶');
    loadTeacherMessages();
}

async function deleteTeacherMessage(msgId) {
    if (!confirm('确定删除这条寄语吗？')) return;
    var supabase = getSupabase();
    var { error } = await supabase.from('teacher_messages').delete().eq('id', msgId);
    if (error) { toast('删除失败：' + error.message); return; }
    toast('已删除');
    loadTeacherMessages();
}

// ---------- 动态系统 ----------
var dynPage = 0;
var dynPageSize = 15;
var dynLoading = false;
var dynHasMore = true;

async function loadDynamics(reset) {
    if (!currentClassId) { return; }
    if (reset) {
        dynPage = 0;
        dynHasMore = true;
        document.getElementById('dynamicList').innerHTML = '';
    }
    if (!dynHasMore || dynLoading) return;
    dynLoading = true;
    var supabase = getSupabase();
    var { data, error } = await supabase
        .from('dynamics')
        .select('*')
        .eq('class_id', currentClassId)
        .order('created_at', { ascending: false })
        .range(dynPage * dynPageSize, (dynPage + 1) * dynPageSize - 1);
    dynLoading = false;
    if (error) { console.error(error); return; }
    if (data.length < dynPageSize) dynHasMore = false;
    dynPage++;
    renderDynamics(data, reset);
    var trigger = document.getElementById('loadMoreTrigger');
    if (trigger) {
        trigger.style.display = dynHasMore ? 'block' : 'none';
        trigger.textContent = dynHasMore ? '加载更多...' : '已加载全部';
    }
}

function renderDynamics(data, reset) {
    var wrap = document.getElementById('dynamicList');
    if (!wrap) return;
    if (!data || data.length === 0) {
        if (reset) wrap.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:20px;">还没有动态</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < data.length; i++) {
        var item = data[i];
        var isOwnerDynamic = (item.user_email === OWNER_EMAIL);
        var pinned = item.pinned || false;
        var essence = item.essence || false;
        var ownerTag = isOwnerDynamic ? '<span class="owner-tag" style="background:var(--brand-start);color:#fff;padding:2px 12px;border-radius:var(--radius-full);font-size:0.7rem;font-weight:700;margin-left:8px;">站主</span>' : '';
        var pinnedTag = pinned ? '<span style="color:var(--brand-start);font-size:0.7rem;">📌置顶</span>' : '';
        var essenceTag = essence ? '<span style="color:var(--brand-start);font-size:0.7rem;">⭐精华</span>' : '';
        var mediaHtml = '';
        if (item.media) {
            try { var arr = JSON.parse(item.media); arr.forEach(function(url) {
                if (url.includes('video')) mediaHtml += '<video class="dynamic-media" controls src="' + url + '" style="max-width:100%;border-radius:var(--radius-sm);margin:6px 0;cursor:pointer;"></video>';
                else mediaHtml += '<img class="dynamic-media" src="' + url + '" loading="lazy" style="max-width:100%;border-radius:var(--radius-sm);margin:6px 0;cursor:pointer;" onclick="openImageViewer(this.src)">';
            }); } catch(e) {}
        }
        var tagsHtml = '';
        if (item.tags) {
            try { var tags = JSON.parse(item.tags); tags.forEach(function(t) {
                tagsHtml += '<span class="tag" style="display:inline-block;padding:2px 12px;border-radius:var(--radius-full);font-size:0.7rem;background:var(--bg-card);border:1px solid var(--border-subtle);color:var(--text-secondary);margin:2px;">' + t + '</span> ';
            }); } catch(e) {}
        }
        var reactionsHtml = '';
        if (item.reactions) {
            try { var reacts = JSON.parse(item.reactions); for (var r in reacts) { reactionsHtml += '<span>' + r + reacts[r] + '</span> '; } } catch(e) {}
        }
        var canPin = (currentUserRole === 'teacher' || currentUserRole === 'owner');
        var actions = '';
        if (canPin) {
            actions += '<span class="pin-btn" data-id="' + item.id + '" data-pinned="' + pinned + '" style="cursor:pointer;display:flex;align-items:center;gap:4px;"><i class="fa fa-thumb-tack"></i> ' + (pinned ? '取消置顶' : '置顶') + '</span> ';
            actions += '<span class="essence-btn" data-id="' + item.id + '" data-essence="' + essence + '" style="cursor:pointer;display:flex;align-items:center;gap:4px;"><i class="fa fa-star"></i> ' + (essence ? '取消精华' : '设置精华') + '</span> ';
        }
        if (currentUserRole === 'owner') {
            actions += '<span class="del-dyn" data-id="' + item.id + '" style="color:var(--danger);cursor:pointer;display:flex;align-items:center;gap:4px;"><i class="fa fa-trash"></i> 删除</span>';
        }
        var avatarUrl = item.avatar || getDefaultAvatarSVG('👤');
        html += '<div class="dynamic-item" data-id="' + item.id + '">' +
            '<div class="user-head">' +
            '<div class="avatar-wrapper" data-email="' + item.user_email + '">' +
            '<div class="avatar-frame"><img class="avatar" src="' + avatarUrl + '" style="width:40px;height:40px;border-radius:50%;object-fit:cover;display:block;"></div>' +
            '</div>' +
            '<div><div class="nickname">' + item.nickname + ' ' + ownerTag + pinnedTag + essenceTag + '</div>' +
            '<div class="sign">' + (item.sign || '') + ' ' + tagsHtml + '</div></div></div>' +
            '<div class="dynamic-text">' + item.text + '</div>' + mediaHtml +
            '<div style="color:var(--text-secondary);font-size:0.85rem;margin-top:6px;">' + new Date(item.created_at).toLocaleString() + '</div>' +
            '<div class="dyn-op">' +
            '<span class="like-btn" data-id="' + item.id + '" style="cursor:pointer;display:flex;align-items:center;gap:4px;"><i class="fa fa-heart-o"></i> ' + (item.like_count || 0) + '</span>' +
            '<span class="collect-btn" data-id="' + item.id + '" style="cursor:pointer;display:flex;align-items:center;gap:4px;"><i class="fa fa-bookmark-o"></i> ' + (item.collect_count || 0) + '</span>' +
            '<span class="comment-toggle" data-id="' + item.id + '" style="cursor:pointer;display:flex;align-items:center;gap:4px;"><i class="fa fa-comment-o"></i> ' + (item.comment_count || 0) + '</span>' +
            '<span class="reaction-toggle" data-id="' + item.id + '" style="cursor:pointer;">😊</span>' +
            reactionsHtml +
            actions + '</div>' +
            '<div class="comment-wrap hidden" data-cmid="' + item.id + '"><div id="comments-' + item.id + '"></div><div style="display:flex;gap:6px;margin-top:8px;"><input class="comment-input" data-id="' + item.id + '" style="flex:1;padding:8px 12px;border:1px solid var(--border-subtle);border-radius:var(--radius-full);background:var(--bg-card);color:var(--text-primary);" placeholder="评论..."><button class="btn-sm send-cm" data-id="' + item.id + '" style="padding:6px 16px;background:linear-gradient(135deg,var(--brand-start),var(--brand-end));color:#fff;border-radius:var(--radius-full);font-size:0.85rem;">发送</button></div></div>' +
            '</div>';
    }
    if (reset) {
        wrap.innerHTML = html;
    } else {
        wrap.innerHTML += html;
    }
    bindDynamicEvents();
    renderAllAvatarFrames();
}

// ---------- 视图切换核心 ----------
function enterMain() {
    var authWrap = document.getElementById('authWrap');
    if (authWrap) authWrap.style.display = 'none';
    var mainWrap = document.getElementById('mainWrap');
    if (mainWrap) { mainWrap.style.display = 'flex'; mainWrap.classList.add('active'); }

    // 绑定顶部按钮
    document.getElementById('navUserBtn').addEventListener('click', function() {
        switchTab('profile');
    });
    document.getElementById('navSettingsBtn').addEventListener('click', function() {
        switchTab('settings');
    });
    document.getElementById('navBackBtn').addEventListener('click', function() {
        goHome();
    });

    // 绑定底部导航
    document.querySelectorAll('#navMainItems .nav-item').forEach(function(item) {
        item.addEventListener('click', function() {
            var tab = this.dataset.tab;
            switchTab(tab);
        });
    });
    document.querySelectorAll('#navClassItems .nav-item').forEach(function(item) {
        item.addEventListener('click', function() {
            var tab = this.dataset.tab;
            if (tab === 'more') {
                toggleDrawer(true);
                return;
            }
            switchClassTab(tab);
        });
    });

    // 更多抽屉
    document.getElementById('drawerClose').addEventListener('click', function() {
        toggleDrawer(false);
    });
    document.getElementById('drawerOverlay').addEventListener('click', function(e) {
        if (e.target === this) toggleDrawer(false);
    });
    document.querySelectorAll('.drawer-item').forEach(function(item) {
        item.addEventListener('click', function() {
            var tab = this.dataset.tab;
            toggleDrawer(false);
            switchClassTab(tab);
        });
    });

    // 模态框事件绑定
    bindModalEvents();
    bindPublish();
    bindSearch();
    bindChatInput();
    bindTeacherMessage();
    bindFindClass();

    // 默认显示主主页
    goHome();
}

function goHome() {
    if (!currentUser) return;
    // 切换视图
    document.getElementById('view-home').classList.add('active');
    document.getElementById('view-class').classList.remove('active');
    // 更新顶部导航
    document.getElementById('homeTopLeft').classList.remove('hidden');
    document.getElementById('classTopLeft').classList.add('hidden');
    // 更新底部导航
    document.getElementById('navMainItems').classList.remove('hidden');
    document.getElementById('navClassItems').classList.add('hidden');
    // 激活主页tab
    document.querySelectorAll('#navMainItems .nav-item').forEach(function(item) {
        item.classList.remove('active');
        if (item.dataset.tab === 'home') item.classList.add('active');
    });
    // 渲染班级列表
    renderClassList();
    // 标题
    document.getElementById('homeNavTitle').textContent = '班级时光机';
    document.title = '班级时光机 · 主页';
}

function enterClass(classId) {
    if (!currentUser) return;
    currentClassId = classId;
    // 更新角色
    for (var i = 0; i < userClasses.length; i++) {
        if (userClasses[i].class_id === classId) {
            currentClassRole = userClasses[i].role;
            break;
        }
    }
    // 切换视图
    document.getElementById('view-home').classList.remove('active');
    document.getElementById('view-class').classList.add('active');
    // 更新顶部导航
    document.getElementById('homeTopLeft').classList.add('hidden');
    document.getElementById('classTopLeft').classList.remove('hidden');
    // 更新班级名
    var className = '';
    for (var j = 0; j < userClasses.length; j++) {
        if (userClasses[j].class_id === classId && userClasses[j].classes) {
            className = userClasses[j].classes.name;
            break;
        }
    }
    document.getElementById('classNavTitle').textContent = className || '班级空间';
    document.title = className + ' · 班级时光机';
    // 更新底部导航
    document.getElementById('navMainItems').classList.add('hidden');
    document.getElementById('navClassItems').classList.remove('hidden');
    // 激活动态tab
    document.querySelectorAll('#navClassItems .nav-item').forEach(function(item) {
        item.classList.remove('active');
        if (item.dataset.tab === 'dynamic') item.classList.add('active');
    });
    // 加载班级内容
    loadClassContent('dynamic');
    // 更新消息订阅
    updateMsgBadge();
    // 加载数据
    loadDynamics(true);
    loadNotice();
    loadPolls();
    loadCalendar();
    loadAlbum();
    loadContactList();
    loadCapsules();
    loadTimeline();
    loadDestinations();
    loadTeacherMessages();
    // 更新管理后台可见性
    var adminItem = document.getElementById('drawerAdmin');
    if (adminItem) {
        if (isOwner || currentUserRole === 'owner') {
            adminItem.style.display = 'flex';
        } else {
            adminItem.style.display = 'none';
        }
    }
}

function switchTab(tab) {
    // 主主页tab切换
    document.querySelectorAll('#navMainItems .nav-item').forEach(function(item) {
        item.classList.remove('active');
        if (item.dataset.tab === tab) item.classList.add('active');
    });
    // 根据tab显示不同内容
    if (tab === 'home') {
        // 已经在主页
    } else if (tab === 'myclasses') {
        // 滚动到班级列表
        document.getElementById('myClassList').scrollIntoView({ behavior: 'smooth' });
    } else if (tab === 'searchclass') {
        document.getElementById('joinClassBtn').click();
    } else if (tab === 'profile') {
        // 打开个人中心（需要模态框或新视图，暂时toast）
        toast('👤 个人中心功能开发中');
    } else if (tab === 'settings') {
        // 打开设置（需要模态框或新视图）
        toast('⚙️ 设置功能开发中');
    }
}

function switchClassTab(tab) {
    // 副主页tab切换
    document.querySelectorAll('#navClassItems .nav-item').forEach(function(item) {
        item.classList.remove('active');
        if (item.dataset.tab === tab) item.classList.add('active');
    });
    loadClassContent(tab);
}

function loadClassContent(tab) {
    var container = document.getElementById('classSpaceContent');
    if (!container) return;
    // 根据tab渲染不同内容
    switch(tab) {
        case 'dynamic':
            container.innerHTML = `
                <div class="panel">
                    <h3>📝 发布动态</h3>
                    <div class="publish-area-wrapper">
                        <textarea id="publishText" placeholder="分享你的想法..." maxlength="500" style="width:100%;min-height:80px;padding:12px;padding-bottom:48px;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);background:var(--bg-card);backdrop-filter:blur(var(--glass-blur));resize:vertical;color:var(--text-primary);transition:var(--transition);"></textarea>
                        <button class="emoji-btn" id="pubEmojiBtn">😊</button>
                        <div class="publish-counter" id="publishCounter" style="text-align:right;font-size:0.8rem;color:var(--text-muted);margin-top:4px;">0 / 500</div>
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;">
                        <input id="publishTags" placeholder="标签（用逗号分隔，如 #学习,#日常）" style="flex:1;padding:8px 12px;border:1px solid var(--border-subtle);border-radius:var(--radius-full);background:var(--bg-card);color:var(--text-primary);font-size:0.85rem;">
                    </div>
                    <div class="media-select" style="margin:8px 0;">
                        <input type="file" accept="image/*,video/*" id="publishMedia" style="font-size:0.85rem;">
                        <img id="publishPreview" style="display:none;max-width:150px;border-radius:var(--radius-sm);margin-top:6px;">
                        <div class="file-info" id="fileInfo" style="font-size:0.8rem;color:var(--text-muted);"></div>
                        <div class="upload-progress" id="uploadProgress" style="display:none;width:100%;height:4px;background:var(--border-subtle);border-radius:2px;margin-top:6px;overflow:hidden;"><div class="bar" id="uploadBar" style="height:100%;width:0%;background:var(--brand-start);border-radius:2px;transition:width 0.3s;"></div></div>
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <button class="btn-main" style="width:auto;padding:8px 28px;" id="sendDynamic">发布</button>
                        <button class="btn-outline" style="padding:8px 18px;" id="saveDraftBtn">💾 保存草稿</button>
                    </div>
                </div>
                <div class="panel">
                    <h3>📰 全部动态</h3>
                    <div id="dynamicList"></div>
                    <div id="loadMoreTrigger" style="text-align:center;padding:12px;color:var(--text-secondary);font-size:0.9rem;cursor:pointer;display:none;" onclick="loadDynamics(false)">加载更多...</div>
                </div>
            `;
            // 重新绑定发布相关事件
            bindPublish();
            loadDynamics(true);
            break;
        case 'messages':
            container.innerHTML = `
                <div class="panel" style="padding:0;overflow:hidden;">
                    <div class="msg-page">
                        <div class="msg-contact-list" id="msgContactList">
                            <div style="padding:12px;border-bottom:1px solid var(--border-subtle);display:flex;gap:8px;flex-wrap:wrap;">
                                <button class="btn-sm" id="createGroupBtn2"><i class="fa fa-plus"></i> 建群</button>
                                <button class="btn-sm" id="treeholeEntryBtn"><i class="fa fa-commenting-o"></i> 树洞</button>
                                <button class="btn-sm" id="checkinBtn"><i class="fa fa-calendar-check-o"></i> 签到</button>
                            </div>
                            <div id="contactItems"></div>
                        </div>
                        <div class="msg-chat-area" id="msgChatArea">
                            <div class="msg-chat-header" id="msgChatHeader">
                                <span id="chatTargetName">请选择联系人</span>
                                <div style="display:flex;align-items:center;gap:8px;">
                                    <span style="font-size:0.8rem;color:var(--text-secondary);" id="chatTargetStatus"></span>
                                    <button class="btn-sm" id="groupManageBtn" style="display:none;font-size:0.7rem;padding:4px 12px;"><i class="fa fa-cog"></i> 管理</button>
                                </div>
                            </div>
                            <div class="msg-chat-messages" id="msgChatMessages"><div style="text-align:center;color:var(--text-muted);padding:40px 0;">点击左侧联系人开始聊天</div></div>
                            <div class="msg-chat-input" id="msgChatInput">
                                <button class="emoji-btn" id="chatEmojiBtn">😊</button>
                                <input id="chatInput" placeholder="输入消息... @DSAI 可提问">
                                <button id="chatSendBtn"><i class="fa fa-send"></i></button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            loadContactList();
            bindChatInput();
            bindModals(); // 重绑定群聊等
            break;
        case 'notice':
            container.innerHTML = `
                <div class="panel">
                    <h3>📢 通知 <button class="btn-sm" id="newNoticeBtn"><i class="fa fa-plus"></i> 发布通知</button></h3>
                    <div id="noticeList"></div>
                </div>
            `;
            loadNotice();
            document.getElementById('newNoticeBtn').addEventListener('click', function() {
                document.getElementById('newNoticeModal').style.display = 'flex';
            });
            break;
        case 'functions':
            container.innerHTML = `
                <div class="panel">
                    <h3>🧩 功能</h3>
                    <div class="func-tabs" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
                        <button class="func-tab active" data-func="polls" style="padding:6px 18px;border-radius:var(--radius-full);background:var(--brand-start);color:#fff;border:none;cursor:pointer;font-size:0.9rem;">投票</button>
                        <button class="func-tab" data-func="docs" style="padding:6px 18px;border-radius:var(--radius-full);background:var(--bg-card);color:var(--text-secondary);border:none;cursor:pointer;font-size:0.9rem;">在线文档</button>
                        <button class="func-tab" data-func="calendar" style="padding:6px 18px;border-radius:var(--radius-full);background:var(--bg-card);color:var(--text-secondary);border:none;cursor:pointer;font-size:0.9rem;">班级日历</button>
                        <button class="func-tab" data-func="album" style="padding:6px 18px;border-radius:var(--radius-full);background:var(--bg-card);color:var(--text-secondary);border:none;cursor:pointer;font-size:0.9rem;">班级相册</button>
                    </div>
                    <div class="func-content active" id="func-polls"><button class="btn-sm" id="newPollBtn"><i class="fa fa-plus"></i> 发起投票</button><div id="pollList" style="margin-top:12px;"></div></div>
                    <div class="func-content" id="func-docs"><input id="docTitleInput" placeholder="文档标题" style="width:100%;padding:10px;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);background:var(--bg-card);margin-bottom:8px;"><textarea id="docContentInput" rows="8" style="width:100%;padding:10px;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);background:var(--bg-card);font-family:monospace;resize:vertical;"></textarea><button class="btn-sm" id="saveDocBtn"><i class="fa fa-save"></i> 保存文档</button><div id="docPreview" style="padding:12px;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);margin-top:10px;background:var(--bg-card);"></div></div>
                    <div class="func-content" id="func-calendar"><button class="btn-sm" id="addEventBtn"><i class="fa fa-plus"></i> 添加事件</button><div id="calendarList" style="margin-top:12px;"></div></div>
                    <div class="func-content" id="func-album"><div id="albumGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;"></div></div>
                </div>
            `;
            // 绑定功能切换
            document.querySelectorAll('.func-tab').forEach(function(tab) {
                tab.addEventListener('click', function() {
                    document.querySelectorAll('.func-tab').forEach(function(t) { t.classList.remove('active'); });
                    this.classList.add('active');
                    document.querySelectorAll('.func-content').forEach(function(c) { c.classList.remove('active'); });
                    var target = document.getElementById('func-' + this.dataset.func);
                    if (target) target.classList.add('active');
                    if (this.dataset.func === 'album') loadAlbum();
                });
            });
            loadPolls();
            loadDoc();
            loadCalendar();
            loadAlbum();
            // 绑定各功能按钮
            document.getElementById('newPollBtn').addEventListener('click', function() {
                document.getElementById('newPollModal').style.display = 'flex';
            });
            document.getElementById('saveDocBtn').addEventListener('click', function() {
                var title = document.getElementById('docTitleInput').value.trim();
                var content = document.getElementById('docContentInput').value;
                if (!title) { toast('请输入标题'); return; }
                var supabase = getSupabase();
                if (window._docId) {
                    supabase.from('documents').update({ title: title, content: content, updated_by: currentUser.email, updated_at: new Date().toISOString() }).eq('id', window._docId).then(function() { toast('保存成功'); loadDoc(); });
                } else {
                    supabase.from('documents').insert({ title: title, content: content, updated_by: currentUser.email }).then(function() { toast('保存成功'); loadDoc(); });
                }
            });
            document.getElementById('addEventBtn').addEventListener('click', function() {
                document.getElementById('addEventModal').style.display = 'flex';
            });
            break;
        case 'capsule':
            container.innerHTML = `
                <div class="panel">
                    <h3>⏳ 时间胶囊 <button class="btn-sm" id="writeCapsuleBtn">✉️ 写一封信</button></h3>
                    <p style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:16px;">写给未来的自己或同学，设置解锁日期，到时才能打开 💌</p>
                    <div id="capsuleList"></div>
                </div>
            `;
            loadCapsules();
            document.getElementById('writeCapsuleBtn').addEventListener('click', function() {
                document.getElementById('writeCapsuleModal').style.display = 'flex';
            });
            break;
        case 'timeline':
            container.innerHTML = `
                <div class="panel">
                    <h3>📜 班级大事记 <button class="btn-sm" id="addTimelineBtn">➕ 添加事件</button></h3>
                    <div id="timelineList"></div>
                </div>
            `;
            loadTimeline();
            document.getElementById('addTimelineBtn').addEventListener('click', function() {
                document.getElementById('addTimelineModal').style.display = 'flex';
            });
            break;
        case 'destinations':
            container.innerHTML = `
                <div class="panel">
                    <h3>🗺️ 同学去向登记 <button class="btn-sm" id="addDestinationBtn">📝 登记我的去向</button></h3>
                    <div id="destinationList"></div>
                </div>
            `;
            loadDestinations();
            document.getElementById('addDestinationBtn').addEventListener('click', function() {
                document.getElementById('addDestinationModal').style.display = 'flex';
            });
            break;
        case 'teacher':
            container.innerHTML = `
                <div class="panel panel-teacher">
                    <h3>🎓 毕业寄语 <span style="font-size:0.8rem;font-weight:normal;color:var(--text-secondary);">来自老师们的祝福</span></h3>
                    <div id="teacherMessageList"></div>
                    <div id="teacherMessageForm" style="display:${(currentUserRole === 'teacher' || currentUserRole === 'owner') ? 'block' : 'none'};margin-top:16px;">
                        <textarea id="teacherMessageInput" rows="4" placeholder="写下你对全班同学的毕业寄语..." style="width:100%;padding:12px;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);background:var(--bg-card);backdrop-filter:blur(var(--glass-blur));color:var(--text-primary);resize:vertical;"></textarea>
                        <div style="margin-top:8px;display:flex;gap:8px;">
                            <button class="btn-main" style="width:auto;padding:8px 28px;" id="sendTeacherMessageBtn">发布寄语</button>
                            <span style="font-size:0.8rem;color:var(--text-muted);align-self:center;">💡 教师可发布置顶寄语</span>
                        </div>
                    </div>
                </div>
            `;
            loadTeacherMessages();
            bindTeacherMessage();
            break;
        case 'myLike':
            container.innerHTML = `<div class="panel"><h3>❤️ 我点赞的动态</h3><div id="myLikeList"></div></div>`;
            // 实现点赞列表...
            toast('我的点赞功能开发中');
            break;
        case 'myCollect':
            container.innerHTML = `<div class="panel"><h3>🔖 我收藏的动态</h3><div id="myCollectList"></div></div>`;
            toast('我的收藏功能开发中');
            break;
        case 'changelog':
            container.innerHTML = `<div class="panel"><h3>📋 更新日志</h3><div id="changelogList"></div></div>`;
            loadChangelog();
            break;
        case 'admin':
            if (isOwner || currentUserRole === 'owner') {
                container.innerHTML = `<div class="panel"><h3>🛡️ 管理后台</h3><div id="adminContent"></div></div>`;
                loadAdmin('dashboard');
            } else {
                toast('权限不足');
            }
            break;
        default:
            container.innerHTML = '<div class="panel"><p style="color:var(--text-secondary);">功能开发中...</p></div>';
    }
}

// ---------- 抽屉控制 ----------
function toggleDrawer(show) {
    var overlay = document.getElementById('drawerOverlay');
    if (show) {
        overlay.classList.add('open');
    } else {
        overlay.classList.remove('open');
    }
}

// ================================================================
//  动态交互事件绑定
// ================================================================
function bindDynamicEvents() {
    document.querySelectorAll('.pin-btn').forEach(function(el) {
        el.onclick = function(e) { e.stopPropagation(); var id = this.dataset.id; var pinned = this.dataset.pinned === 'true'; getSupabase().from('dynamics').update({ pinned: !pinned }).eq('id', id).then(function() { loadDynamics(true); toast(pinned ? '已取消置顶' : '已置顶'); }); };
    });
    document.querySelectorAll('.essence-btn').forEach(function(el) {
        el.onclick = function(e) { e.stopPropagation(); var id = this.dataset.id; var essence = this.dataset.essence === 'true'; getSupabase().from('dynamics').update({ essence: !essence }).eq('id', id).then(function() { loadDynamics(true); toast(essence ? '已取消精华' : '已设为精华'); }); };
    });
    document.querySelectorAll('.del-dyn').forEach(function(el) {
        el.onclick = function(e) { e.stopPropagation(); if (!confirm('删除此动态？')) return; var id = this.dataset.id; getSupabase().from('dynamics').delete().eq('id', id).then(function() { loadDynamics(true); toast('已删除'); }); };
    });
    document.querySelectorAll('.send-cm').forEach(function(el) {
        el.onclick = function(e) { e.stopPropagation(); var id = this.dataset.id; var input = document.querySelector('.comment-input[data-id="' + id + '"]'); var content = input.value.trim(); if (!content) return; getSupabase().from('comments').insert({ dyn_id: id, user_email: currentUser.email, nickname: currentUser.nickname, avatar: currentUser.avatar, content: filterSensitiveWords(content), class_id: currentClassId, created_at: new Date().toISOString() }).then(function() { input.value = ''; loadDynamics(true); toast('评论成功'); addExp(currentUser.email, 5, '评论动态'); }); };
    });
    document.querySelectorAll('.comment-toggle').forEach(function(el) {
        el.onclick = function(e) { e.stopPropagation(); var id = this.dataset.id; var wrap = document.querySelector('.comment-wrap[data-cmid="' + id + '"]'); if (wrap.classList.contains('hidden')) { wrap.classList.remove('hidden'); loadComments(id); } else { wrap.classList.add('hidden'); } };
    });
    document.querySelectorAll('.like-btn').forEach(function(el) {
        el.onclick = function(e) { e.stopPropagation(); var id = this.dataset.id; var supabase = getSupabase(); supabase.from('likes').select('id').eq('dyn_id', id).eq('user_email', currentUser.email).then(function(res) { if (res.data && res.data.length > 0) { toast('已点过赞'); return; } supabase.from('likes').insert({ dyn_id: id, user_email: currentUser.email, class_id: currentClassId }).then(function() { supabase.from('dynamics').select('like_count').eq('id', id).then(function(r) { var count = (r.data && r.data[0] ? r.data[0].like_count : 0) + 1; supabase.from('dynamics').update({ like_count: count }).eq('id', id).then(function() { loadDynamics(true); toast('👍 点赞成功'); addExp(currentUser.email, 10, '收到点赞'); }); }); }); }); };
    });
    document.querySelectorAll('.collect-btn').forEach(function(el) {
        el.onclick = function(e) { e.stopPropagation(); var id = this.dataset.id; var supabase = getSupabase(); supabase.from('collects').select('id').eq('dyn_id', id).eq('user_email', currentUser.email).then(function(res) { if (res.data && res.data.length > 0) { toast('已收藏过'); return; } supabase.from('collects').insert({ dyn_id: id, user_email: currentUser.email, class_id: currentClassId }).then(function() { supabase.from('dynamics').select('collect_count').eq('id', id).then(function(r) { var count = (r.data && r.data[0] ? r.data[0].collect_count : 0) + 1; supabase.from('dynamics').update({ collect_count: count }).eq('id', id).then(function() { loadDynamics(true); toast('🔖 收藏成功'); addExp(currentUser.email, 10, '收到收藏'); }); }); }); }); };
    });
    document.querySelectorAll('.reaction-toggle').forEach(function(el) {
        el.onclick = function(e) { e.stopPropagation(); var id = this.dataset.id; showDynReactionPicker(e, id); };
    });
}

async function loadComments(dynId) {
    var { data, error } = await getSupabase().from('comments').select('*').eq('dyn_id', dynId).eq('class_id', currentClassId).order('created_at', { ascending: true });
    if (error) return;
    var container = document.getElementById('comments-' + dynId);
    if (!container) return;
    if (!data || data.length === 0) { container.innerHTML = '<div style="color:var(--text-secondary);padding:6px;">暂无评论</div>'; return; }
    container.innerHTML = data.map(function(c) {
        var owner = c.user_email === OWNER_EMAIL ? ' <span class="owner-tag small" style="background:var(--brand-start);color:#fff;padding:1px 8px;border-radius:var(--radius-full);font-size:0.6rem;font-weight:700;">站主</span>' : '';
        return '<div class="comment-item" style="padding:6px 0;font-size:0.9rem;border-bottom:1px solid var(--border-subtle);"><b>' + c.nickname + owner + '</b>：' + c.content + '</div>';
    }).join('');
}

var dynReactionPicker = null;
function showDynReactionPicker(event, dynId) {
    if (!dynReactionPicker) {
        dynReactionPicker = document.createElement('div');
        dynReactionPicker.className = 'reaction-picker';
        var emojis = ['😂', '❤️', '😮', '😢', '😡', '👍', '👏', '🎉', '🔥', '💯'];
        dynReactionPicker.innerHTML = emojis.map(function(e) { return '<span data-emoji="' + e + '">' + e + '</span>'; }).join('');
        document.body.appendChild(dynReactionPicker);
        dynReactionPicker.querySelectorAll('span').forEach(function(el) {
            el.onclick = function() {
                var emoji = this.dataset.emoji;
                addDynReaction(dynId, emoji);
                dynReactionPicker.style.display = 'none';
            };
        });
    }
    var rect = event.target.getBoundingClientRect();
    dynReactionPicker.style.left = Math.min(rect.left, window.innerWidth - 280) + 'px';
    dynReactionPicker.style.top = (rect.bottom + 4) + 'px';
    dynReactionPicker.style.display = 'block';
    setTimeout(function() {
        document.addEventListener('click', function closeDynPicker(e) {
            if (!e.target.closest('#dynReactionPicker') && !e.target.closest('.reaction-toggle')) {
                if (dynReactionPicker) dynReactionPicker.style.display = 'none';
                document.removeEventListener('click', closeDynPicker);
            }
        });
    }, 10);
}

async function addDynReaction(dynId, emoji) {
    var supabase = getSupabase();
    var { data, error } = await supabase.from('dynamics').select('reactions').eq('id', dynId).single();
    if (error) { console.error(error); return; }
    var reactions = {};
    try { reactions = JSON.parse(data.reactions || '{}'); } catch (e) {}
    if (!reactions[emoji]) reactions[emoji] = 0;
    reactions[emoji] += 1;
    await supabase.from('dynamics').update({ reactions: JSON.stringify(reactions) }).eq('id', dynId);
    loadDynamics(true);
}

// ---------- 发布动态 ----------
function bindPublish() {
    var textarea = document.getElementById('publishText');
    var counter = document.getElementById('publishCounter');
    if (textarea && counter) {
        textarea.addEventListener('input', function() {
            counter.textContent = this.value.length + ' / 500';
            if (this.value.length > 10) {
                localStorage.setItem('draft_' + currentUser.email, this.value);
                var tags = document.getElementById('publishTags');
                if (tags) localStorage.setItem('draft_tags_' + currentUser.email, tags.value);
            }
        });
        var draft = localStorage.getItem('draft_' + currentUser.email);
        if (draft) {
            textarea.value = draft;
            counter.textContent = draft.length + ' / 500';
            var tagsInput = document.getElementById('publishTags');
            if (tagsInput) {
                var draftTags = localStorage.getItem('draft_tags_' + currentUser.email);
                if (draftTags) tagsInput.value = draftTags;
            }
            toast('📝 已恢复草稿');
        }
    }

    var saveDraftBtn = document.getElementById('saveDraftBtn');
    if (saveDraftBtn) {
        saveDraftBtn.onclick = function() {
            var text = document.getElementById('publishText').value;
            if (text.length > 10) {
                localStorage.setItem('draft_' + currentUser.email, text);
                var tags = document.getElementById('publishTags');
                if (tags) localStorage.setItem('draft_tags_' + currentUser.email, tags.value);
                toast('💾 草稿已保存');
            } else {
                toast('内容太短，无法保存草稿');
            }
        };
    }

    var sendBtn = document.getElementById('sendDynamic');
    if (sendBtn) {
        sendBtn.onclick = async function() {
            var btn = this;
            btn.disabled = true;
            if (await isUserBanned(currentUser.email)) { toast('你已被禁言'); btn.disabled = false; return; }

            var today = new Date().toISOString().slice(0, 10);
            var supabase = getSupabase();
            var todayDyns = await supabase.from('dynamics').select('id', { count: 'exact' }).eq('user_email', currentUser.email).gte('created_at', today + 'T00:00:00').eq('class_id', currentClassId);
            if (todayDyns.count >= 3) { toast('今日已发布3条动态，已达上限'); btn.disabled = false; return; }

            var text = filterSensitiveWords(document.getElementById('publishText').value.trim());
            var tagsInput = document.getElementById('publishTags');
            var tags = tagsInput ? tagsInput.value.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
            var fileInput = document.getElementById('publishMedia');
            var files = fileInput.files;
            var mediaList = [];

            if (files.length > 0) {
                var file = files[0];
                var progress = document.getElementById('uploadProgress');
                var bar = document.getElementById('uploadBar');
                if (progress) progress.style.display = 'block';
                if (bar) bar.style.width = '0%';
                if (file.type.startsWith('image/')) {
                    var compressed = await compressImage(file, 800, 0.7);
                    if (compressed) { mediaList.push(compressed); } else {
                        var reader = new FileReader();
                        var dataUrl = await new Promise(function(resolve) { reader.onload = function(e) { resolve(e.target.result); }; reader.readAsDataURL(file); });
                        mediaList.push(dataUrl);
                    }
                    if (bar) bar.style.width = '100%';
                    if (progress) setTimeout(function() { progress.style.display = 'none'; }, 500);
                    var preview = document.getElementById('publishPreview');
                    if (preview) { preview.style.display = 'none'; preview.src = ''; }
                    var info = document.getElementById('fileInfo');
                    if (info) info.textContent = '';
                    fileInput.value = '';
                } else if (file.type.startsWith('video/')) {
                    var path = 'dynamic/' + Date.now() + '_' + file.name;
                    var uploadUrl = CONFIG.SUPABASE_URL + '/storage/v1/object/files/' + path;
                    var xhr = new XMLHttpRequest();
                    xhr.open('POST', uploadUrl, true);
                    xhr.setRequestHeader('Authorization', 'Bearer ' + CONFIG.SUPABASE_ANON_KEY);
                    xhr.setRequestHeader('Content-Type', file.type);
                    xhr.upload.onprogress = function(e) { if (e.lengthComputable && bar) bar.style.width = Math.round((e.loaded / e.total) * 100) + '%'; };
                    xhr.onload = function() {
                        if (xhr.status === 200 || xhr.status === 201) {
                            var publicUrl = CONFIG.SUPABASE_URL + '/storage/v1/object/public/files/' + path;
                            mediaList.push(publicUrl);
                            if (bar) bar.style.width = '100%';
                            if (progress) setTimeout(function() { progress.style.display = 'none'; }, 500);
                            var preview = document.getElementById('publishPreview');
                            if (preview) { preview.style.display = 'none'; preview.src = ''; }
                            var info = document.getElementById('fileInfo');
                            if (info) info.textContent = '';
                            fileInput.value = '';
                            finishPublish();
                        } else { toast('上传失败'); if (progress) progress.style.display = 'none'; btn.disabled = false; }
                    };
                    xhr.onerror = function() { toast('网络错误'); if (progress) progress.style.display = 'none'; btn.disabled = false; };
                    xhr.send(file);
                    return;
                } else {
                    var reader = new FileReader();
                    var dataUrl = await new Promise(function(resolve) { reader.onload = function(e) { resolve(e.target.result); }; reader.readAsDataURL(file); });
                    mediaList.push(dataUrl);
                    if (bar) bar.style.width = '100%';
                    if (progress) setTimeout(function() { progress.style.display = 'none'; }, 500);
                    var preview = document.getElementById('publishPreview');
                    if (preview) { preview.style.display = 'none'; preview.src = ''; }
                    var info = document.getElementById('fileInfo');
                    if (info) info.textContent = '';
                    fileInput.value = '';
                }
            }

            if (mediaList.length > 0 || text) {
                finishPublish();
            } else { toast('请填写内容'); btn.disabled = false; }

            async function finishPublish() {
                var supabase = getSupabase();
                var { error } = await supabase.from('dynamics').insert({
                    user_email: currentUser.email,
                    nickname: currentUser.nickname,
                    avatar: currentUser.avatar,
                    sign: currentUser.sign || '',
                    text: text,
                    media: JSON.stringify(mediaList),
                    tags: JSON.stringify(tags),
                    class_id: currentClassId,
                    created_at: new Date().toISOString(),
                    pinned: false,
                    essence: false,
                    like_count: 0,
                    collect_count: 0,
                    comment_count: 0
                });
                if (error) { toast('发布失败：' + error.message); btn.disabled = false; return; }
                if (textarea) textarea.value = '';
                if (counter) counter.textContent = '0 / 500';
                var preview = document.getElementById('publishPreview');
                if (preview) { preview.style.display = 'none'; preview.src = ''; }
                var info = document.getElementById('fileInfo');
                if (info) info.textContent = '';
                localStorage.removeItem('draft_' + currentUser.email);
                localStorage.removeItem('draft_tags_' + currentUser.email);
                toast('发布成功！');
                loadDynamics(true);
                btn.disabled = false;
                await addExp(currentUser.email, 15, '发布动态');
            }
        };
    }
}

async function compressImage(file, maxWidth, quality) {
    return new Promise(function(resolve) {
        if (!file.type.startsWith('image/')) return resolve(null);
        var reader = new FileReader();
        reader.onload = function(e) {
            var img = new Image();
            img.onload = function() {
                var w = img.width, h = img.height;
                if (w > maxWidth) { h = h * maxWidth / w; w = maxWidth; }
                var canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                var ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                var mime = file.type === 'image/png' ? 'image/jpeg' : file.type;
                resolve(canvas.toDataURL(mime, quality));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// ---------- 头像框/挂件 ----------
async function loadEquippedItems() {
    var supabase = getSupabase();
    var { data: userItems, error: userError } = await supabase
        .from('user_avatar_items')
        .select('item_id, is_equipped')
        .eq('user_email', currentUser.email)
        .eq('is_equipped', true);
    if (userError) { console.error('loadEquippedItems 查询失败:', userError); return; }
    var container = document.getElementById('userEquippedItems');
    if (!container) return;
    if (!userItems || userItems.length === 0) {
        container.innerHTML = '<span style="color:var(--text-secondary);font-size:0.85rem;">未装备任何装饰</span>';
        return;
    }
    var itemIds = userItems.map(function(item) { return item.item_id; });
    var { data: avatarItems, error: avatarError } = await supabase.from('avatar_items').select('*').in('id', itemIds);
    if (avatarError) { console.error('加载头像物品详情失败:', avatarError); return; }
    if (!avatarItems || avatarItems.length === 0) {
        container.innerHTML = '<span style="color:var(--text-secondary);font-size:0.85rem;">未装备任何装饰</span>';
        return;
    }
    container.innerHTML = avatarItems.map(function(item) {
        var icon = item.type === 'frame' ? '🖼️' : '🎀';
        return '<span style="background:var(--bg-card);padding:4px 12px;border-radius:var(--radius-full);font-size:0.8rem;border:1px solid var(--border-subtle);">' + icon + ' ' + item.name + '</span>';
    }).join('');
}

async function loadAvatarItems() {
    var supabase = getSupabase();
    var { data, error } = await supabase.from('avatar_items').select('*').order('sort_order', { ascending: true });
    if (error) { console.error(error); return []; }
    return data || [];
}

async function openAvatarShop() {
    var items = await loadAvatarItems();
    var userItems = await getSupabase().from('user_avatar_items').select('item_id, is_equipped').eq('user_email', currentUser.email);
    var ownedIds = (userItems.data || []).map(function(i) { return i.item_id; });
    var equippedIds = (userItems.data || []).filter(function(i) { return i.is_equipped; }).map(function(i) { return i.item_id; });
    var modal = document.getElementById('avatarShopModal');
    modal.style.display = 'flex';
    var previewFrame = document.getElementById('shopPreviewFrame');
    var previewPendant = document.getElementById('shopPreviewPendant');
    var previewAvatar = document.getElementById('shopPreviewFrame').querySelector('.avatar');
    if (previewAvatar) { previewAvatar.src = currentUser.avatar || getDefaultAvatarSVG('👤'); }
    var grid = document.getElementById('shopItemsGrid');
    var type = 'frame';
    renderShopGrid(type, items, ownedIds, equippedIds);
}

function renderShopGrid(type, items, ownedIds, equippedIds) {
    var grid = document.getElementById('shopItemsGrid');
    var filtered = items.filter(function(i) { return i.type === type; });
    if (filtered.length === 0) {
        grid.innerHTML = '<div style="color:var(--text-secondary);padding:10px;grid-column:1/-1;">暂无可用' + (type === 'frame' ? '边框' : '挂件') + '</div>';
        return;
    }
    var conditionMap = {
        'level:7': '🏅 等级达到 Lv.7',
        'level:10': '🏅 等级达到 Lv.10',
        'streak:30': '📅 连续签到 30 天',
        'followers:10': '👥 被 10 人关注',
        'achievement:like_10': '👍 获得 10 个点赞',
        'achievement:like_50': '⭐ 获得 50 个点赞',
        'role:teacher': '🎓 教师专属'
    };
    grid.innerHTML = filtered.map(function(item) {
        var owned = ownedIds.includes(item.id);
        var equipped = equippedIds.includes(item.id);
        var condition = item.unlock_condition || '';
        var conditionText = conditionMap[condition] || condition || '暂无条件';
        var statusText = '';
        var statusColor = '';
        var isClickable = false;
        if (equipped) { statusText = '✅ 已装备'; statusColor = '#2ecc71'; isClickable = false; }
        else if (owned) { statusText = '▶️ 点击装备'; statusColor = '#3498db'; isClickable = true; }
        else { statusText = '🔒 ' + conditionText; statusColor = '#95a5a6'; isClickable = false; }
        var onClick = isClickable ? 'onclick="equipAvatarItem(\'' + item.id + '\')"' : '';
        var borderStyle = equipped ? 'border-color:var(--brand-start);box-shadow:0 0 16px rgba(129,201,255,0.3);' : 'border-color:var(--border-subtle);';
        var previewStyle = '';
        if (type === 'frame' && item.css_style) { previewStyle = item.css_style; }
        return '<div style="border:2px solid ' + (equipped ? 'var(--brand-start)' : 'var(--border-subtle)') + ';border-radius:var(--radius-sm);padding:12px;text-align:center;cursor:' + (isClickable ? 'pointer' : 'default') + ';transition:var(--transition);background:var(--bg-card);' + borderStyle + '" ' + onClick + '>' +
            '<div style="display:flex;justify-content:center;align-items:center;margin:0 auto 8px;width:72px;height:72px;border-radius:50%;background:var(--bg-card);overflow:hidden;">' +
            (type === 'frame' ? '<div style="width:64px;height:64px;border-radius:50%;background:#ccc;display:flex;align-items:center;justify-content:center;font-size:28px;' + previewStyle + '">👤</div>' :
            '<div style="position:relative;width:64px;height:64px;border-radius:50%;background:#ccc;display:flex;align-items:center;justify-content:center;font-size:28px;">👤<span style="position:absolute;bottom:-2px;right:-2px;font-size:20px;">' + (item.icon_url || '🎀') + '</span></div>') +
            '</div>' +
            '<div style="font-size:0.8rem;font-weight:600;color:var(--text-primary);">' + item.name + '</div>' +
            '<div style="font-size:0.7rem;color:' + statusColor + ';margin-top:4px;">' + statusText + '</div></div>';
    }).join('');
    document.getElementById('shopTabFrames').onclick = function() {
        renderShopGrid('frame', items, ownedIds, equippedIds);
        document.getElementById('shopTabFrames').classList.add('btn-sm');
    };
    document.getElementById('shopTabPendants').onclick = function() {
        renderShopGrid('pendant', items, ownedIds, equippedIds);
    };
}

async function equipAvatarItem(itemId) {
    var supabase = getSupabase();
    if (!currentUser) { toast('请先登录'); return; }
    try {
        var { data: itemInfo, error: itemError } = await supabase.from('avatar_items').select('type').eq('id', itemId).single();
        if (itemError || !itemInfo) { toast('物品不存在'); return; }
        var type = itemInfo.type;
        var { data: sameTypeItems, error: typeError } = await supabase.from('avatar_items').select('id').eq('type', type);
        if (typeError) { console.error('查询同类型物品失败:', typeError); toast('操作失败，请重试'); return; }
        var sameTypeIds = sameTypeItems.map(function(item) { return item.id; });
        if (sameTypeIds.length > 0) {
            var { error: unequipError } = await supabase.from('user_avatar_items').update({ is_equipped: false }).eq('user_email', currentUser.email).in('item_id', sameTypeIds).eq('is_equipped', true);
            if (unequipError) { console.error('取消装备失败:', unequipError); toast('操作失败，请重试'); return; }
        }
        var { data: existing, error: existError } = await supabase.from('user_avatar_items').select('id').eq('user_email', currentUser.email).eq('item_id', itemId).maybeSingle();
        if (existError) { console.error('检查拥有状态失败:', existError); toast('操作失败，请重试'); return; }
        if (existing) {
            var { error: equipError } = await supabase.from('user_avatar_items').update({ is_equipped: true }).eq('id', existing.id);
            if (equipError) { toast('装备失败，请重试'); return; }
        } else {
            var { error: insertError } = await supabase.from('user_avatar_items').insert({ user_email: currentUser.email, item_id: itemId, is_equipped: true });
            if (insertError) { toast('装备失败，请重试'); return; }
        }
        toast('✅ 已装备');
        document.getElementById('avatarShopModal').style.display = 'none';
        renderUserCenter();
        loadDynamics(true);
    } catch (err) { console.error('装备过程中发生错误:', err); toast('操作异常，请重试'); }
}

// ---------- 个人中心（简版，适配新视图） ----------
function renderUserCenter() {
    // 由于个人中心可能单独作为一个tab，我们将其内容渲染到 `#classSpaceContent` 或弹窗
    // 这里先简化为 toast 提示
    toast('👤 个人中心功能即将上线');
}

function renderSidebarLevel() {
    // 无侧边栏，但保留函数体
}

// ---------- 消息系统 ----------
async function loadContactList() {
    if (!currentUser || !currentClassId) return;
    var supabase = getSupabase();
    var contacts = {};
    contacts['_dsai'] = { name: '🤖 DSAI', type: 'ai', lastMsg: 'AI助手，随时为你服务', time: '', unread: 0 };

    var msgResult = await supabase
        .from('messages')
        .select('*')
        .or('from_user.eq.' + currentUser.email + ',to_user.eq.' + currentUser.email)
        .eq('class_id', currentClassId)
        .order('created_at', { ascending: false });
    (msgResult.data || []).forEach(function(m) {
        var other = (m.from_user === currentUser.email) ? m.to_user : m.from_user;
        if (!contacts[other]) contacts[other] = { lastMsg: m.content, time: m.created_at, unread: 0 };
        if (!m.read && m.to_user === currentUser.email) contacts[other].unread = (contacts[other].unread || 0) + 1;
    });

    var groupResult = await supabase
        .from('groups')
        .select('*')
        .eq('is_active', true)
        .eq('class_id', currentClassId);
    var groups = groupResult.data || [];
    groups = groups.filter(function(g) {
        var members = g.members || [];
        return g.created_by === currentUser.email || members.includes(currentUser.email);
    });
    groups.forEach(function(g) {
        contacts['group_' + g.id] = {
            name: g.name, type: 'group', lastMsg: '📢 群聊',
            time: g.updated_at || g.created_at, unread: 0,
            members: g.members, created_by: g.created_by, id: g.id
        };
    });

    contacts['_treehole'] = { name: '🌳 匿名树洞', type: 'treehole', lastMsg: '匿名倾诉，站主可查', time: '', unread: 0 };

    var emails = Object.keys(contacts).filter(function(k) { return !k.startsWith('group_') && !k.startsWith('_') && k !== '_dsai'; });
    var profileMap = {};
    if (emails.length > 0) {
        var profResult = await supabase.from('profiles').select('email, nickname, avatar, role').in('email', emails);
        (profResult.data || []).forEach(function(p) { profileMap[p.email] = p; });
    }

    var container = document.getElementById('contactItems');
    if (!container) return;
    var html = '';
    var sorted = Object.keys(contacts).sort(function(a, b) {
        var ta = contacts[a].time || '0';
        var tb = contacts[b].time || '0';
        return tb.localeCompare(ta);
    });

    sorted.forEach(function(key) {
        var c = contacts[key];
        var name = c.name;
        var avatar = '';
        var isGroup = key.startsWith('group_');
        var isTreehole = (key === '_treehole');
        var isAI = (key === '_dsai');
        var lastMsg = c.lastMsg || '';
        var unread = c.unread || 0;
        var timeStr = c.time ? new Date(c.time).toLocaleString() : '';
        var dataType = 'user';
        var dataTarget = key;
        var roleTag = '';

        if (isAI) {
            name = '🤖 DSAI';
            avatar = getDefaultAvatarSVG('AI');
            dataType = 'ai';
            dataTarget = '_dsai';
        } else if (isTreehole) {
            name = '🌳 匿名树洞';
            avatar = getDefaultAvatarSVG('🌳');
            dataType = 'treehole';
            dataTarget = '_treehole';
        } else if (isGroup) {
            name = c.name || '群聊';
            avatar = getDefaultAvatarSVG('👥');
            dataType = 'group';
            dataTarget = key;
        } else {
            var p = profileMap[key] || {};
            name = p.nickname || key.split('@')[0];
            avatar = p.avatar || getDefaultAvatarSVG('👤');
            if (key === OWNER_EMAIL) name += ' ⭐';
            if (p.role === 'teacher') { name += ' <span class="teacher-tag" style="font-size:0.6rem;padding:1px 8px;">🎓 教师</span>'; }
            dataType = 'user';
            dataTarget = key;
        }

        var activeClass = '';
        if (currentChatTarget === dataTarget && currentChatType === dataType) {
            activeClass = 'active';
        }

        html += '<div class="msg-contact-item ' + activeClass + '" data-target="' + dataTarget + '" data-type="' + dataType + '" data-name="' + name.replace(/"/g, '&quot;') + '" data-groupid="' + (isGroup ? c.id : '') + '">' +
            '<img class="avatar" src="' + avatar + '">' +
            '<div class="info"><div class="name">' + name + (unread > 0 ? ' <span class="unread-dot"></span>' : '') + '</div><div class="last-msg">' + lastMsg + '</div></div>' +
            (timeStr ? '<div class="time">' + timeStr + '</div>' : '') +
            '</div>';
    });
    container.innerHTML = html;

    container.querySelectorAll('.msg-contact-item').forEach(function(el) {
        el.onclick = function() {
            var target = this.dataset.target;
            var type = this.dataset.type;
            var name = this.dataset.name;
            var groupId = this.dataset.groupid;
            openChat(target, type, name, groupId);
            container.querySelectorAll('.msg-contact-item').forEach(function(item) { item.classList.remove('active'); });
            this.classList.add('active');
        };
    });
}

function openChat(target, type, name, groupId) {
    currentChatTarget = target;
    currentChatType = type;
    currentGroupId = groupId || null;
    var header = document.getElementById('chatTargetName');
    var status = document.getElementById('chatTargetStatus');
    var manageBtn = document.getElementById('groupManageBtn');
    if (header) header.textContent = name || '聊天';
    if (status) status.textContent = '';

    if (manageBtn) {
        if (type === 'group') {
            manageBtn.style.display = 'inline-block';
            manageBtn.onclick = function() { openGroupManage(target, name); };
        } else {
            manageBtn.style.display = 'none';
        }
    }

    if (type === 'ai') {
        if (header) header.textContent = '🤖 DSAI';
        var container = document.getElementById('msgChatMessages');
        if (container) {
            container.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:40px 0;">🤖 你好！我是DSAI<br><span style="font-size:0.8rem;">输入消息，或使用 /画 xxx 生成图片</span></div>';
        }
        return;
    }

    if (type === 'treehole') {
        if (header) header.textContent = '🌳 匿名树洞';
        if (status) status.textContent = '匿名发布，站主可查';
        loadTreeholeChat();
        return;
    }

    if (type === 'group') {
        currentChatType = 'group';
        loadGroupChat(target);
        return;
    }

    loadChatMessages(target, 'user');
    var supabase = getSupabase();
    supabase.from('messages').update({ read_at: new Date().toISOString() }).eq('from_user', target).eq('to_user', currentUser.email).is('read_at', null).then(function() { updateMsgBadge(); });
    setupTypingListener(target);
}

function setupTypingListener(target) {
    var supabase = getSupabase();
    if (typingChannel) { supabase.removeChannel(typingChannel); }
    var channelId = 'typing_' + [currentUser.email, target].sort().join('_');
    typingChannel = supabase.channel(channelId);
    typingChannel.on('broadcast', { event: 'typing' }, function(payload) {
        if (payload.payload.user === target) {
            var status = document.getElementById('chatTargetStatus');
            if (status) {
                status.textContent = '正在输入...';
                clearTimeout(window.typingTimeout);
                window.typingTimeout = setTimeout(function() { status.textContent = ''; }, 2000);
            }
        }
    });
    typingChannel.subscribe();
}

async function loadChatMessages(target, type) {
    var container = document.getElementById('msgChatMessages');
    if (!container) return;
    var supabase = getSupabase();
    var result = await supabase
        .from('messages')
        .select('*')
        .or('from_user.eq.' + target + ',to_user.eq.' + target)
        .or('from_user.eq.' + currentUser.email + ',to_user.eq.' + currentUser.email)
        .eq('class_id', currentClassId)
        .order('created_at', { ascending: true });
    if (result.error) { console.error(result.error); return; }
    var data = result.data || [];
    var msgs = data.filter(function(m) {
        return (m.from_user === target && m.to_user === currentUser.email) ||
            (m.from_user === currentUser.email && m.to_user === target);
    });
    var profileResult = await supabase.from('profiles').select('nickname, avatar, role').eq('email', target).maybeSingle();
    var p = profileResult.data || {};
    var targetName = p.nickname || target.split('@')[0];
    var targetAvatar = p.avatar || '';
    var isTeacher = p.role === 'teacher';
    var html = '';
    if (msgs.length === 0) {
        html = '<div style="text-align:center;color:var(--text-secondary);padding:20px;">暂无消息</div>';
    } else {
        msgs.forEach(function(m) {
            var isMe = m.from_user === currentUser.email;
            var name = isMe ? currentUser.nickname : targetName;
            var timeStr = new Date(m.created_at).toLocaleString();
            var readStatus = '';
            if (isMe && m.read_at) readStatus = ' ✓已读';
            else if (isMe && !m.read_at) readStatus = ' ✓已送达';
            var isRecalled = m.is_recalled || false;
            var contentHtml = isRecalled ? '<span style="color:var(--text-secondary);font-style:italic;">已撤回</span>' : m.content;
            var quoteHtml = '';
            if (m.reply_to && !isRecalled) {
                quoteHtml = '<div class="quote-bubble">↩️ ' + (m.reply_to_name || '') + '：' + (m.reply_to_content || '') + '</div>';
            }
            var reactionHtml = '';
            if (m.reactions) {
                try {
                    var reacts = JSON.parse(m.reactions);
                    if (Object.keys(reacts).length > 0) {
                        reactionHtml = '<div class="reactions">';
                        for (var r in reacts) {
                            reactionHtml += '<span onclick="addReaction(\'' + m.id + '\',\'' + r + '\')">' + r + '</span>';
                        }
                        reactionHtml += '</div>';
                    }
                } catch (e) {}
            }
            var actionHtml = '';
            if (isMe && !isRecalled) {
                var canRecall = (new Date() - new Date(m.created_at)) < 120000;
                if (canRecall) {
                    actionHtml += '<span onclick="recallMessage(\'' + m.id + '\')">撤回</span>';
                }
            }
            if (!isMe && !isRecalled) {
                actionHtml += '<span onclick="quoteMessage(\'' + m.id + '\',\'' + name + '\',\'' + (m.content || '').replace(/'/g, "\\'") + '\')">引用</span>';
                actionHtml += '<span onclick="showReactionPicker(event, \'' + m.id + '\')">😊</span>';
            }
            var senderTag = (!isMe && isTeacher) ? ' 🎓' : '';
            html += '<div class="msg-item ' + (isMe ? 'me' : '') + '" data-msgid="' + m.id + '">' +
                (!isMe ? '<div class="sender-name">' + name + senderTag + '</div>' : '') +
                quoteHtml +
                '<span class="bubble">' + contentHtml + '</span>' +
                reactionHtml +
                '<div class="time">' + timeStr + readStatus + (actionHtml ? ' <span class="msg-actions">' + actionHtml + '</span>' : '') + '</div>' +
                '</div>';
        });
    }
    container.innerHTML = html;
    setTimeout(function() { container.scrollTop = container.scrollHeight; }, 50);
}

async function loadGroupChat(target) {
    // 类似 loadChatMessages 但针对群聊
    // 由于篇幅，暂留空，实际应实现群聊消息加载
    toast('群聊功能开发中');
}

async function loadTreeholeChat() {
    // 类似，暂留空
    toast('树洞功能开发中');
}

function bindChatInput() {
    var input = document.getElementById('chatInput');
    var sendBtn = document.getElementById('chatSendBtn');
    var emojiBtn = document.getElementById('chatEmojiBtn');
    if (sendBtn) {
        sendBtn.onclick = function() {
            var content = input ? input.value.trim() : '';
            if (!content) return;
            sendMessage(content);
        };
    }
    if (input) {
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (sendBtn) sendBtn.click();
            }
        });
    }
    // emoji 按钮绑定
    if (emojiBtn) {
        emojiBtn.onclick = function(e) {
            e.stopPropagation();
            var target = document.getElementById('chatInput');
            if (!target) return;
            var panel = document.getElementById('globalEmojiPanel');
            if (panel && panel.style.display === 'grid' && globalEmojiTarget === target) {
                panel.style.display = 'none';
                globalEmojiTarget = null;
            } else {
                showGlobalEmojiPanel(target, e);
            }
        };
    }
}

async function sendMessage(content) {
    if (!content.trim()) return;
    if (!currentChatTarget) { toast('请先选择联系人'); return; }
    if (await isUserBanned(currentUser.email)) { toast('你已被禁言'); return; }
    var supabase = getSupabase();

    if (currentChatType === 'ai') {
        await sendAIMessage(content);
        return;
    }
    if (currentChatType === 'treehole') {
        var { error } = await supabase.from('treehole_posts').insert({
            content: filterSensitiveWords(content),
            user_email: currentUser.email,
            class_id: currentClassId,
            created_at: new Date().toISOString()
        });
        if (error) { toast('发送失败：' + error.message); return; }
        document.getElementById('chatInput').value = '';
        loadTreeholeChat();
        toast('匿名发布成功');
        return;
    }
    if (currentChatType === 'group') {
        // 群聊发送
        toast('群聊发送功能开发中');
        return;
    }

    // 私聊
    var replyTo = quotedMessage ? quotedMessage.id : null;
    var replyContent = quotedMessage ? quotedMessage.content : null;
    var replyName = quotedMessage ? quotedMessage.name : null;
    var { error } = await supabase.from('messages').insert({
        from_user: currentUser.email,
        to_user: currentChatTarget,
        content: filterSensitiveWords(content),
        read: false,
        reply_to: replyTo,
        reply_to_content: replyContent,
        reply_to_name: replyName,
        class_id: currentClassId,
        created_at: new Date().toISOString()
    });
    if (error) { toast('发送失败：' + error.message); return; }
    document.getElementById('chatInput').value = '';
    quotedMessage = null;
    var status = document.getElementById('chatTargetStatus');
    if (status) status.textContent = '';
    loadChatMessages(currentChatTarget, 'user');
    updateMsgBadge();
    await addExp(currentUser.email, 5, '私聊发消息');
    loadContactList();
}

function quoteMessage(msgId, name, content) {
    quotedMessage = { id: msgId, name: name, content: content };
    var status = document.getElementById('chatTargetStatus');
    if (status) {
        status.textContent = '↩️ 回复 ' + name + '：' + content.slice(0, 30) + (content.length > 30 ? '...' : '');
        status.style.color = 'var(--brand-start)';
    }
    document.getElementById('chatInput').focus();
}

async function recallMessage(msgId) {
    var supabase = getSupabase();
    var { error } = await supabase.from('messages').update({ is_recalled: true }).eq('id', msgId);
    if (error) { toast('撤回失败：' + error.message); return; }
    toast('已撤回');
    if (currentChatType === 'user') {
        loadChatMessages(currentChatTarget, 'user');
    }
}

var reactionPickerTarget = null;
function showReactionPicker(event, msgId) {
    var picker = document.getElementById('reactionPicker');
    if (!picker) {
        picker = document.createElement('div');
        picker.id = 'reactionPicker';
        picker.className = 'reaction-picker';
        var emojis = ['😂', '❤️', '😮', '😢', '😡', '👍', '👏', '🎉'];
        picker.innerHTML = emojis.map(function(e) { return '<span data-emoji="' + e + '">' + e + '</span>'; }).join('');
        document.body.appendChild(picker);
        picker.querySelectorAll('span').forEach(function(el) {
            el.onclick = function() {
                var emoji = this.dataset.emoji;
                addReaction(msgId, emoji);
                picker.style.display = 'none';
            };
        });
    }
    var rect = event.target.getBoundingClientRect();
    picker.style.left = Math.min(rect.left, window.innerWidth - 260) + 'px';
    picker.style.top = (rect.bottom + 4) + 'px';
    picker.style.display = 'block';
    setTimeout(function() {
        document.addEventListener('click', function closePicker(e) {
            if (!e.target.closest('#reactionPicker')) {
                picker.style.display = 'none';
                document.removeEventListener('click', closePicker);
            }
        });
    }, 10);
}

async function addReaction(msgId, emoji) {
    var supabase = getSupabase();
    var { data, error } = await supabase.from('messages').select('reactions').eq('id', msgId).single();
    if (error) { console.error(error); return; }
    var reactions = {};
    try { reactions = JSON.parse(data.reactions || '{}'); } catch (e) {}
    if (!reactions[emoji]) reactions[emoji] = 0;
    reactions[emoji] += 1;
    await supabase.from('messages').update({ reactions: JSON.stringify(reactions) }).eq('id', msgId);
    if (currentChatType === 'user') loadChatMessages(currentChatTarget, 'user');
}

// ---------- AI 对话 ----------
async function sendAIMessage(content) {
    // 简版，实际调用 DeepSeek API
    toast('🤖 AI 功能需配置 API Key');
}

// ---------- 群聊管理 ----------
async function openCreateGroupModal() {
    toast('群聊创建功能开发中');
}
async function createGroupConfirm() { }
async function openGroupManage(target, name) { toast('群管理功能开发中'); }
async function loadGroupMemberList(groupId) { }
async function kickMember(groupId, email) { }
async function addGroupMember() { }
async function confirmAddGroupMember() { }
async function setAdmin(groupId, email) { }
async function removeAdmin(groupId, email) { }
async function transferOwner(groupId, email) { }
async function exitGroup(groupId) { }
async function dissolveGroup(groupId) { }
async function editGroupName() { }
async function confirmEditGroupName() { }
async function setGroupAnnounce() { }
async function confirmGroupAnnounce() { }
function bindGroupManageButtons() { }

// ---------- 管理后台 ----------
async function loadAdmin(tab) {
    if (!isOwner && currentUserRole !== 'owner') { toast('权限不足'); return; }
    var wrap = document.getElementById('adminContent');
    if (!wrap) return;
    var supabase = getSupabase();
    // 简单示例
    wrap.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary);">管理后台开发中</div>';
}

// ---------- 通知、投票、文档、日历、相册 ----------
async function loadNotice() { /* 实现略 */ }
async function loadPolls() { /* 实现略 */ }
async function loadDoc() { /* 实现略 */ }
async function loadCalendar() { /* 实现略 */ }
async function loadAlbum() { /* 实现略 */ }

// ---------- 搜索 ----------
function bindSearch() {
    var searchBtn = document.getElementById('searchBtn');
    if (searchBtn) {
        searchBtn.onclick = function() {
            var keyword = document.getElementById('searchInput').value.trim();
            if (!keyword) { toast('请输入关键词'); return; }
            toast('🔍 搜索功能开发中');
        };
    }
}

// ---------- 全局表情面板 ----------
var globalEmojiPanel = document.getElementById('globalEmojiPanel');
var globalEmojiTarget = null;
function initGlobalEmojiPanel() {
    if (!globalEmojiPanel) return;
    var emojis = ['😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','🥰','😘','😗','😙','😚','☺️','🙂','🤗','🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🤑','😲','☹️','🙁','😖','😞','😟','😤','😢','😭','😦','😧','😨','😩','🤯','😬','😰','😱','🥵','🥶','😳','🤪','😵','😡','😠','🤬'];
    globalEmojiPanel.innerHTML = emojis.map(function(e) { return '<span>' + e + '</span>'; }).join('');
    globalEmojiPanel.querySelectorAll('span').forEach(function(el) {
        el.onclick = function() {
            if (!globalEmojiTarget) return;
            var start = globalEmojiTarget.selectionStart, end = globalEmojiTarget.selectionEnd;
            var text = globalEmojiTarget.value;
            globalEmojiTarget.value = text.substring(0, start) + this.textContent + text.substring(end);
            globalEmojiTarget.focus();
            var newPos = start + this.textContent.length;
            globalEmojiTarget.selectionStart = globalEmojiTarget.selectionEnd = newPos;
            globalEmojiPanel.style.display = 'none';
            globalEmojiTarget = null;
        };
    });
}

function showGlobalEmojiPanel(target, event) {
    globalEmojiTarget = target;
    var rect = target.getBoundingClientRect();
    var panel = globalEmojiPanel;
    if (!panel) return;
    var panelWidth = 280, panelHeight = 200;
    var left = rect.left + 2;
    if (left + panelWidth > window.innerWidth - 10) left = window.innerWidth - panelWidth - 10;
    if (left < 10) left = 10;
    var top = rect.bottom + 2;
    if (top + panelHeight > window.innerHeight - 10) top = rect.top - panelHeight - 2;
    if (top < 10) top = 10;
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panel.style.display = 'grid';
}

// ---------- 模态框事件绑定 ----------
function bindModalEvents() {
    // 创建班级
    document.getElementById('createClassCancel').onclick = function() { document.getElementById('createClassModal').style.display = 'none'; };
    document.getElementById('createClassConfirm').onclick = async function() {
        var name = document.getElementById('createClassName').value.trim();
        var school = document.getElementById('createSchoolName').value.trim();
        var grade = document.getElementById('createGrade').value;
        var year = document.getElementById('createGraduationYear').value.trim();
        var isPublic = document.getElementById('createIsPublic').checked;
        if (!name) { toast('请输入班级名称'); return; }
        await createClass(name, school, grade, year, isPublic);
        document.getElementById('createClassModal').style.display = 'none';
        document.getElementById('createClassName').value = '';
        document.getElementById('createSchoolName').value = '';
        document.getElementById('createGraduationYear').value = '';
    };

    // 加入班级
    document.getElementById('joinClassCancel').onclick = function() { document.getElementById('joinClassModal').style.display = 'none'; };
    document.getElementById('joinClassConfirm').onclick = async function() {
        var code = document.getElementById('joinClassInviteCode').value.trim();
        if (!code) { toast('请输入邀请码'); return; }
        await joinClassByInvite(code);
        document.getElementById('joinClassModal').style.display = 'none';
        document.getElementById('joinClassInviteCode').value = '';
    };
    document.getElementById('joinClassSearch').addEventListener('input', async function() {
        var keyword = this.value.trim();
        var results = document.getElementById('joinClassResults');
        if (!keyword) { results.innerHTML = ''; return; }
        var classes = await searchClasses(keyword);
        if (classes.length === 0) {
            results.innerHTML = '<div style="color:var(--text-secondary);padding:10px;">未找到公开班级</div>';
            return;
        }
        var html = '';
        classes.forEach(function(cls) {
            html += '<div style="padding:8px 12px;border-bottom:1px solid var(--border-subtle);display:flex;justify-content:space-between;align-items:center;">' +
                '<div><strong>' + cls.name + '</strong><br><span style="font-size:0.8rem;color:var(--text-secondary);">' + (cls.school_name || '') + ' · ' + (cls.grade || '') + '</span></div>' +
                '<button class="btn-sm" onclick="joinClassByInvite(\'' + cls.invite_code + '\')">加入</button>' +
                '</div>';
        });
        results.innerHTML = html;
    });

    // 时间胶囊
    document.getElementById('writeCapsuleCancel').onclick = function() { document.getElementById('writeCapsuleModal').style.display = 'none'; };
    document.getElementById('writeCapsuleConfirm').onclick = async function() {
        var to = document.getElementById('capsuleTo').value.trim() || '未来的自己';
        var content = document.getElementById('capsuleContent').value.trim();
        var unlockDate = document.getElementById('capsuleUnlockDate').value;
        if (!content) { toast('请写点内容'); return; }
        if (!unlockDate) { toast('请选择解锁日期'); return; }
        await createCapsule(to, content, unlockDate);
        document.getElementById('writeCapsuleModal').style.display = 'none';
        document.getElementById('capsuleTo').value = '';
        document.getElementById('capsuleContent').value = '';
    };

    // 大事记
    document.getElementById('addTimelineCancel').onclick = function() { document.getElementById('addTimelineModal').style.display = 'none'; };
    document.getElementById('addTimelineConfirm').onclick = async function() {
        var title = document.getElementById('timelineTitle').value.trim();
        var desc = document.getElementById('timelineDesc').value.trim();
        var date = document.getElementById('timelineDate').value;
        if (!title) { toast('请输入标题'); return; }
        if (!date) { toast('请选择日期'); return; }
        await addTimeline(title, desc, date);
        document.getElementById('addTimelineModal').style.display = 'none';
        document.getElementById('timelineTitle').value = '';
        document.getElementById('timelineDesc').value = '';
    };

    // 去向登记
    document.getElementById('addDestinationCancel').onclick = function() { document.getElementById('addDestinationModal').style.display = 'none'; };
    document.getElementById('addDestinationConfirm').onclick = async function() {
        var school = document.getElementById('destSchool').value.trim();
        var major = document.getElementById('destMajor').value.trim();
        var city = document.getElementById('destCity').value.trim();
        var isHighSchool = document.getElementById('destIsHighSchool').checked;
        if (!school) { toast('请输入学校名称'); return; }
        await addDestination(school, major, city, isHighSchool);
        document.getElementById('addDestinationModal').style.display = 'none';
        document.getElementById('destSchool').value = '';
        document.getElementById('destMajor').value = '';
        document.getElementById('destCity').value = '';
    };

    // 通知
    document.getElementById('noticeModalCancel').onclick = function() { document.getElementById('newNoticeModal').style.display = 'none'; };
    document.getElementById('noticeModalConfirm').onclick = function() {
        var title = document.getElementById('noticeTitleInput').value.trim();
        var desc = document.getElementById('noticeDescInput').value.trim();
        if (!title) { toast('请输入标题'); return; }
        toast('通知发布功能开发中');
        document.getElementById('newNoticeModal').style.display = 'none';
    };

    // 投票
    document.getElementById('pollModalCancel').onclick = function() { document.getElementById('newPollModal').style.display = 'none'; };
    document.getElementById('pollModalConfirm').onclick = function() {
        var question = document.getElementById('pollQuestionInput').value.trim();
        if (!question) { toast('请输入问题'); return; }
        toast('投票发起功能开发中');
        document.getElementById('newPollModal').style.display = 'none';
    };

    // 日历事件
    document.getElementById('eventModalCancel').onclick = function() { document.getElementById('addEventModal').style.display = 'none'; };
    document.getElementById('eventModalConfirm').onclick = function() {
        var title = document.getElementById('eventTitleInput').value.trim();
        if (!title) { toast('请输入标题'); return; }
        toast('日历事件添加功能开发中');
        document.getElementById('addEventModal').style.display = 'none';
    };

    // 签到
    document.getElementById('checkinBtn').onclick = function() {
        toast('📅 签到功能开发中');
    };

    // 图片查看器
    document.getElementById('imageViewerClose').onclick = function() {
        document.getElementById('imageViewer').style.display = 'none';
    };
}

// ---------- 教师寄语绑定 ----------
function bindTeacherMessage() {
    var btn = document.getElementById('sendTeacherMessageBtn');
    if (btn) {
        btn.onclick = function() {
            var content = document.getElementById('teacherMessageInput').value.trim();
            sendTeacherMessage(content);
        };
    }
}

// ---------- 查找班级绑定 ----------
function bindFindClass() {
    var findBtn = document.getElementById('findClassBtn');
    if (findBtn) {
        findBtn.onclick = async function() {
            var keyword = document.getElementById('findClassInput').value.trim();
            var results = document.getElementById('findClassResults');
            if (!keyword) { results.innerHTML = ''; return; }
            var classes = await searchClasses(keyword);
            if (classes.length === 0) {
                results.innerHTML = '<div style="color:var(--text-secondary);padding:20px;text-align:center;">未找到匹配的班级</div>';
                return;
            }
            var html = '';
            classes.forEach(function(cls) {
                var alreadyJoined = userClasses.some(function(c) { return c.class_id === cls.id; });
                html += '<div class="panel" style="padding:16px;display:flex;justify-content:space-between;align-items:center;">' +
                    '<div><strong>' + cls.name + '</strong><br><span style="font-size:0.8rem;color:var(--text-secondary);">' + (cls.school_name || '') + ' · ' + (cls.grade || '') + ' · 创建者：' + (cls.created_by || '') + '</span></div>' +
                    (alreadyJoined ? '<span class="tag" style="background:var(--brand-start);color:#fff;">已加入</span>' : '<button class="btn-sm" onclick="joinClassByInvite(\'' + cls.invite_code + '\')">加入</button>') +
                    '</div>';
            });
            results.innerHTML = html;
        };
    }
}

// ---------- 设置系统（主题切换） ----------
function applySettings() {
    var settings = loadSettings();
    var theme = settings.theme || 'dark';
    if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    } else {
        document.documentElement.removeAttribute('data-theme'); // default dark
    }
}

function loadSettings() {
    try { return JSON.parse(localStorage.getItem('blog_settings')) || { theme: 'dark' }; } catch (e) { return { theme: 'dark' }; }
}
function saveSettings(settings) { localStorage.setItem('blog_settings', JSON.stringify(settings)); }

// ---------- 消息订阅 ----------
function subscribeToMessages() {
    // 略
}
function updateMsgBadge() {
    // 略
}

// ---------- 渲染头像框 ----------
function renderAllAvatarFrames() {
    // 略
}

// ---------- 窗口初始化 ----------
window.onload = async function() {
    initGlobalEmojiPanel();

    // 绑定认证切换
    document.getElementById('toReg').onclick = function() { document.getElementById('loginBox').classList.add('hidden'); document.getElementById('regBox').classList.remove('hidden'); };
    document.getElementById('toLogin').onclick = function() { document.getElementById('regBox').classList.add('hidden'); document.getElementById('loginBox').classList.remove('hidden'); };
    document.getElementById('toFindPwd').onclick = function() { document.getElementById('loginBox').classList.add('hidden'); document.getElementById('findPwdBox').classList.remove('hidden'); };
    document.getElementById('backLogin').onclick = function() { document.getElementById('findPwdBox').classList.add('hidden'); document.getElementById('loginBox').classList.remove('hidden'); };

document.getElementById('loginBtn').onclick = function() {
    var btn = this;
    btn.disabled = true;
    var email = document.getElementById('loginEmail').value.trim();
    var pwd = document.getElementById('loginPwd').value.trim();
    if (!email || !pwd) { toast('请填写邮箱和密码'); btn.disabled = false; return; }
    signIn(email, pwd).finally(function() { btn.disabled = false; });
};
    document.getElementById('regBtn').onclick = function() {
        var name = document.getElementById('regName').value.trim();
        var email = document.getElementById('regEmail').value.trim();
        var pwd = document.getElementById('regPwd').value.trim();
        var pwd2 = document.getElementById('regPwd2').value.trim();
        if (!name) { toast('请填写昵称'); return; }
        if (name.length > 15) { toast('昵称不能超过15位'); return; }
        if (pwd.length < 6) { toast('密码至少6位'); return; }
        if (pwd !== pwd2) { toast('两次密码不一致'); return; }
        signUp(email, pwd, name);
    };
    document.getElementById('findBtn').onclick = function() { toast('请使用Supabase的忘记密码功能'); };

    var success = await autoLogin();
    if (!success) {
        var remembered = JSON.parse(localStorage.getItem('remember_pwd') || '{}');
        if (remembered.email) {
            document.getElementById('loginEmail').value = remembered.email;
            document.getElementById('loginPwd').value = remembered.password || '';
            document.getElementById('rememberPwdCheck').checked = true;
        }
        document.getElementById('authWrap').style.display = 'flex';
    }

    // 背景鼠标光晕
    var glow = document.getElementById('bgGlow');
    var targetX = window.innerWidth / 2, targetY = window.innerHeight / 2;
    var currentX = targetX, currentY = targetY;
    document.addEventListener('mousemove', function(e) {
        targetX = e.clientX;
        targetY = e.clientY;
    });
    function smoothGlow() {
        currentX += (targetX - currentX) * 0.08;
        currentY += (targetY - currentY) * 0.08;
        glow.style.transform = 'translate(' + currentX + 'px, ' + currentY + 'px)';
        requestAnimationFrame(smoothGlow);
    }
    smoothGlow();

    // 粒子生成
    (function() {
        var container = document.getElementById('particles');
        if (!container) return;
        var count = 40;
        for (var i = 0; i < count; i++) {
            var particle = document.createElement('div');
            particle.className = 'particle';
            var size = 2 + Math.random() * 4;
            particle.style.width = size + 'px';
            particle.style.height = size + 'px';
            particle.style.left = Math.random() * 100 + '%';
            particle.style.animationDuration = (10 + Math.random() * 20) + 's';
            particle.style.animationDelay = (Math.random() * 20) + 's';
            particle.style.opacity = 0.2 + Math.random() * 0.3;
            container.appendChild(particle);
        }
    })();

    // 鼠标光晕跟踪
    (function() {
        var glow = document.getElementById('bgGlow');
        if (!glow) return;
        var targetX = window.innerWidth / 2;
        var targetY = window.innerHeight / 2;
        var currentX = targetX;
        var currentY = targetY;
        document.addEventListener('mousemove', function(e) {
            targetX = e.clientX;
            targetY = e.clientY;
        });
        function smoothGlow() {
            currentX += (targetX - currentX) * 0.08;
            currentY += (targetY - currentY) * 0.08;
            glow.style.transform = 'translate(' + currentX + 'px, ' + currentY + 'px)';
            requestAnimationFrame(smoothGlow);
        }
        smoothGlow();
    })();
    console.log('📺 班级时光机 v3.2 已启动！');
};
