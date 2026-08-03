// ================================================================
//  app.js - 班级时光机 核心逻辑
//  依赖：config.js (必须先加载)
// ================================================================

// ---------- 声明全局变量（原代码中未声明，现在显式定义） ----------
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
var selectedAreaPath = []; // 地区选择路径
var messageSubscription = null;

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

function closeSidebar() {
    var s = document.getElementById('sidebar');
    var o = document.getElementById('sidebarOverlay');
    if (s) s.classList.remove('open');
    if (o) o.classList.remove('active');
}
function openSidebar() {
    var s = document.getElementById('sidebar');
    var o = document.getElementById('sidebarOverlay');
    if (s) s.classList.add('open');
    if (o) o.classList.add('active');
}

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

// ---------- 教师辅助 ----------
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
        renderUserCenter();
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
        renderSidebarLevel();
        loadEquippedItems();
        renderTeacherUI();
        loadTeacherMessages();
        loadCapsules();
        loadTimeline();
        loadDestinations();
        renderClassList();
        updatePageTitle();
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
                renderUserCenter();
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
                renderSidebarLevel();
                loadEquippedItems();
                renderTeacherUI();
                loadTeacherMessages();
                loadCapsules();
                loadTimeline();
                loadDestinations();
                renderClassList();
                updatePageTitle();
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

// ---------- 经验添加 ----------
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
        renderUserCenter();
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
    renderClassSwitcher();
    renderClassList();
    updatePageTitle();
    updateSidebarMenu();
}

async function renderClassSwitcher() {
    var container = document.getElementById('classDropdown');
    var btn = document.getElementById('classSwitcherBtn');
    var nameSpan = document.getElementById('currentClassName');
    if (!container) return;

    if (userClasses.length === 0) {
        if (nameSpan) nameSpan.textContent = '未加入班级';
        container.innerHTML = '<div class="class-item" style="color:var(--text-secondary);">暂无班级，请先加入</div>';
        return;
    }

    var currentName = '未选择';
    var html = '';
    for (var i = 0; i < userClasses.length; i++) {
        var c = userClasses[i];
        var cls = c.classes;
        var name = cls ? cls.name : '未知班级';
        var isActive = (c.class_id === currentClassId);
        if (isActive) currentName = name;
        var roleTag = '';
        if (c.role === 'owner') roleTag = ' ⭐';
        else if (c.role === 'teacher') roleTag = ' 🎓';
        html += '<div class="class-item ' + (isActive ? 'active' : '') + '" data-class-id="' + c.class_id + '" onclick="switchClass(\'' + c.class_id + '\')">' +
            '<span>' + name + roleTag + '</span>' +
            (isActive ? '<span class="check">✓</span>' : '') +
            '</div>';
    }
    if (nameSpan) nameSpan.textContent = currentName || '选择班级';
    container.innerHTML = html;
}

async function switchClass(classId) {
    if (classId === currentClassId) {
        document.getElementById('classDropdown').classList.remove('open');
        return;
    }
    currentClassId = classId;
    for (var i = 0; i < userClasses.length; i++) {
        if (userClasses[i].class_id === classId) {
            currentClassRole = userClasses[i].role;
            break;
        }
    }
    renderClassSwitcher();
    updatePageTitle();
    document.getElementById('classDropdown').classList.remove('open');
    loadDynamics(true);
    loadContactList();
    loadNotice();
    loadPolls();
    loadCalendar();
    loadAlbum();
    loadCapsules();
    loadTimeline();
    loadDestinations();
    renderClassList();
    updateSidebarMenu();
    toast('已切换到当前班级');
}

function updatePageTitle() {
    var titleEl = document.getElementById('pageTitle');
    var isHome = document.getElementById('page-home') && !document.getElementById('page-home').classList.contains('hidden');
    if (!currentUser) {
        document.title = '班级时光机 · 登录';
        if (titleEl) titleEl.textContent = '班级时光机';
        return;
    }
    if (isHome || !currentClassId) {
        document.title = '班级时光机 · 主页';
        if (titleEl) titleEl.textContent = '班级时光机';
        return;
    }
    var name = '';
    for (var i = 0; i < userClasses.length; i++) {
        if (userClasses[i].class_id === currentClassId && userClasses[i].classes) {
            name = userClasses[i].classes.name;
            break;
        }
    }
    if (name) {
        document.title = name + ' · 班级时光机';
        if (titleEl) titleEl.textContent = name + ' · 博客';
    } else {
        document.title = '班级时光机 · 博客';
        if (titleEl) titleEl.textContent = '班级时光机';
    }
}

function updateSidebarMenu() {
    var isInClass = (currentClassId !== null);
    var dynamicItem = document.querySelector('[data-page="dynamic"]');
    var msgItem = document.querySelector('[data-page="messages"]');
    var noticeItem = document.querySelector('[data-page="notice"]');
    var funcItem = document.querySelector('[data-page="functions"]');
    var capsuleItem = document.querySelector('[data-page="capsule"]');
    var timelineItem = document.querySelector('[data-page="timeline"]');
    var destItem = document.querySelector('[data-page="destinations"]');
    var teacherItem = document.getElementById('teacherMenu');
    var adminItem = document.getElementById('adminMenu');
    var findItem = document.querySelector('[data-page="findclass"]');

    if (isInClass) {
        if (dynamicItem) dynamicItem.style.display = 'block';
        if (msgItem) msgItem.style.display = 'block';
        if (noticeItem) noticeItem.style.display = 'block';
        if (funcItem) funcItem.style.display = 'block';
        if (capsuleItem) capsuleItem.style.display = 'block';
        if (timelineItem) timelineItem.style.display = 'block';
        if (destItem) destItem.style.display = 'block';
        if (teacherItem && (currentUserRole === 'teacher' || currentUserRole === 'owner')) {
            teacherItem.style.display = 'block';
        } else if (teacherItem) {
            teacherItem.style.display = 'none';
        }
        if (adminItem && (isOwner || currentUserRole === 'owner')) {
            adminItem.style.display = 'block';
        } else if (adminItem) {
            adminItem.style.display = 'none';
        }
        if (findItem) findItem.style.display = 'none';
    } else {
        if (dynamicItem) dynamicItem.style.display = 'none';
        if (msgItem) msgItem.style.display = 'none';
        if (noticeItem) noticeItem.style.display = 'none';
        if (funcItem) funcItem.style.display = 'none';
        if (capsuleItem) capsuleItem.style.display = 'none';
        if (timelineItem) timelineItem.style.display = 'none';
        if (destItem) destItem.style.display = 'none';
        if (teacherItem) teacherItem.style.display = 'none';
        if (adminItem && (isOwner || currentUserRole === 'owner')) {
            adminItem.style.display = 'block';
        } else if (adminItem) {
            adminItem.style.display = 'none';
        }
        if (findItem) findItem.style.display = 'block';
    }
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

        var cardClass = isActive ? 'panel glass-card' : 'panel';
        html += '<div class="' + cardClass + '" style="cursor:pointer;' + (isActive ? 'border-left:4px solid var(--primary);' : '') + '" onclick="switchClass(\'' + c.class_id + '\')">' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
            '<div><div style="font-weight:700;font-size:1.1rem;">' + cls.name + '</div>' +
            '<div style="font-size:0.85rem;color:var(--text-secondary);">' + (cls.school_name || '') + ' · ' + (cls.grade || '') + ' · ' + roleText + '</div>' +
            '<div style="font-size:0.85rem;color:var(--text-secondary);margin-top:4px;">👥 ' + memberCount + '位成员 · 最后活跃 ' + lastActive + '</div>' +
            '</div>' +
            '<div style="text-align:right;">' +
            (unreadCount > 0 ? '<span style="background:var(--danger);color:#fff;padding:2px 10px;border-radius:var(--radius-full);font-size:0.7rem;">📩 ' + unreadCount + '条未读</span>' : '<span style="color:var(--text-light);font-size:0.7rem;">✅ 全部已读</span>') +
            (isActive ? '<div style="font-size:0.7rem;color:var(--primary);margin-top:4px;">当前</div>' : '') +
            '</div></div>' +
            '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">' +
            '<button class="btn-sm" onclick="event.stopPropagation();switchClass(\'' + c.class_id + '\')">进入班级 →</button>' +
            '</div>' +
            '</div>';
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
    renderClassSwitcher();
    renderClassList();
    updatePageTitle();
    updateSidebarMenu();
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
    renderClassSwitcher();
    renderClassList();
    updatePageTitle();
    updateSidebarMenu();
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

// ---------- 版本更新功能 ----------
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
    modal.className = 'modal-mask changelog-popup';
    modal.style.display = 'flex';
    var majorBadge = versionData.is_major ? ' <span class="major-badge">🎉 重大更新</span>' : '';
    var contentHtml = versionData.content ? versionData.content.replace(/\n/g, '<br>') : '';
    modal.innerHTML = `
        <div class="modal" style="max-width:560px;">
            <h3>📢 版本更新 ${versionData.version} ${majorBadge}</h3>
            <div style="font-size:0.8rem;color:var(--text-light);margin-bottom:12px;">${new Date(versionData.published_at).toLocaleDateString('zh-CN')}</div>
            <div style="white-space:pre-wrap;font-size:0.95rem;line-height:1.8;color:var(--text-secondary);">${contentHtml}</div>
            <div class="modal-btns">
                <button class="btn-cancel" onclick="this.closest('.modal-mask').style.display='none'">关闭</button>
                <button class="btn-save" onclick="this.closest('.modal-mask').style.display='none';document.querySelector('[data-page=\\'changelog\\']').click();">查看全部</button>
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
            (t.created_by === currentUser.email || currentUserRole === 'owner' ? '<span style="font-size:0.7rem;color:var(--text-light);cursor:pointer;" onclick="deleteTimeline(\'' + t.id + '\')">删除</span>' : '') +
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
            ' <span style="font-size:0.7rem;color:var(--text-light);">' + typeLabel + '</span></div>' +
            (isMe || currentUserRole === 'owner' ? '<span style="color:var(--text-light);cursor:pointer;font-size:0.8rem;" onclick="deleteDestination(\'' + d.id + '\')">删除</span>' : '') +
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
        var pinnedTag = isPinned ? '<span style="background:var(--gold);color:#fff;padding:2px 12px;border-radius:var(--radius-full);font-size:0.6rem;font-weight:600;margin-left:8px;">📌 置顶</span>' : '';
        html += '<div class="dynamic-item teacher-featured" style="' + (isPinned ? 'border-left:4px solid var(--gold);' : '') + '">' +
            '<div class="user-head"><div><div class="nickname">🎓 ' + msg.nickname + ' <span class="teacher-tag">教师</span>' + pinnedTag + '</div><div class="sign">' + timeStr + '</div></div></div>' +
            '<div class="dynamic-text" style="font-size:1.05rem;line-height:1.8;">' + msg.content + '</div>' +
            (canDelete || canPin ? '<div class="dyn-op" style="margin-top:8px;">' : '') +
            (canPin ? '<span onclick="togglePinTeacherMessage(\'' + msg.id + '\',' + !isPinned + ')" style="cursor:pointer;color:var(--gold);">' + (isPinned ? '📌 取消置顶' : '📌 置顶') + '</span>' : '') +
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
    var supabase = getSupabase();
    for (var i = 0; i < data.length; i++) {
        var item = data[i];
        var isOwnerDynamic = (item.user_email === OWNER_EMAIL);
        var pinned = item.pinned || false;
        var essence = item.essence || false;
        var ownerTag = isOwnerDynamic ? '<span class="owner-tag" style="background:var(--gold);color:#222;padding:2px 12px;border-radius:var(--radius-full);font-size:0.7rem;font-weight:700;margin-left:8px;">站主</span>' : '';
        var pinnedTag = pinned ? '<span style="color:var(--gold);font-size:0.7rem;">📌置顶</span>' : '';
        var essenceTag = essence ? '<span style="color:var(--gold);font-size:0.7rem;">⭐精华</span>' : '';
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
                tagsHtml += '<span class="tag" style="display:inline-block;padding:2px 12px;border-radius:var(--radius-full);font-size:0.7rem;background:rgba(255,255,255,0.15);border:1px solid var(--border-color);color:var(--text-secondary);margin:2px;">' + t + '</span> ';
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
            '<div class="avatar-wrapper" id="dynAvatar_' + item.id + '" data-email="' + item.user_email + '">' +
            '<div class="avatar-frame" id="dynFrame_' + item.id + '">' +
            '<img class="avatar" src="' + avatarUrl + '" style="width:40px;height:40px;border-radius:50%;object-fit:cover;display:block;">' +
            '</div></div>' +
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
            '<div class="comment-wrap hidden" data-cmid="' + item.id + '"><div id="comments-' + item.id + '"></div><div style="display:flex;gap:6px;margin-top:8px;"><input class="comment-input" data-id="' + item.id + '" style="flex:1;padding:8px 12px;border:1px solid var(--border-color);border-radius:var(--radius-full);background:rgba(255,255,255,0.4);color:var(--text-primary);" placeholder="评论..."><button class="btn-sm send-cm" data-id="' + item.id + '" style="padding:6px 16px;background:var(--primary);color:#fff;border-radius:var(--radius-full);font-size:0.85rem;">发送</button></div></div>' +
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

// ---------- 主框架 ----------
function enterMain() {
    var authWrap = document.getElementById('authWrap');
    if (authWrap) authWrap.style.display = 'none';
    var mainWrap = document.getElementById('mainWrap');
    if (mainWrap) { mainWrap.style.display = 'flex'; requestAnimationFrame(function() { mainWrap.classList.add('active'); }); }
    var usernameEl = document.getElementById('sidebarUsername');
    if (usernameEl) usernameEl.textContent = (isOwner ? '⭐ ' : '') + (currentUser.nickname || '用户');
    var adminMenu = document.getElementById('adminMenu');
    var teacherMenu = document.getElementById('teacherMenu');
    var roleTag = document.getElementById('sidebarRoleTag');

    if (adminMenu) {
        if (isOwner || currentUserRole === 'owner') adminMenu.style.display = 'block';
        else adminMenu.style.display = 'none';
    }
    if (teacherMenu) {
        if (currentUserRole === 'teacher' || currentUserRole === 'owner') teacherMenu.style.display = 'block';
        else teacherMenu.style.display = 'none';
    }
    if (roleTag) {
        if (currentUserRole === 'teacher' || currentUserRole === 'owner') {
            roleTag.style.display = 'inline-block';
            roleTag.textContent = currentUserRole === 'owner' ? '⭐ 站主' : '🎓 教师';
        } else {
            roleTag.style.display = 'none';
        }
    }

    bindSidebar();
    bindUserCenter();
    renderSidebarLevel();
    renderTeacherUI();
    updateSidebarMenu();

    document.querySelectorAll('.setting-nav-item').forEach(function(item) {
        var tab = item.dataset.tab;
        if (!isOwner && (tab === 'ai' || tab === 'cloud' || tab === 'security')) {
            item.style.display = 'none';
        } else {
            item.style.display = '';
        }
    });

    document.querySelectorAll('.func-tab').forEach(function(tab) {
        tab.onclick = function() {
            document.querySelectorAll('.func-tab').forEach(function(t) { t.classList.remove('active'); });
            this.classList.add('active');
            document.querySelectorAll('.func-content').forEach(function(c) { c.classList.remove('active'); });
            var target = document.getElementById('func-' + this.dataset.func);
            if (target) target.classList.add('active');
            if (this.dataset.func === 'album') loadAlbum();
        };
    });

    bindPublish();
    bindSearch();
    bindModals();
    bindChatInput();
    bindTeacherMessage();
    bindClassEvents();
    bindFindClass();
}

function renderSidebarLevel() {
    if (!currentUser || !currentUser.stats) return;
    var info = getLevelInfo(currentUser.stats.exp || 0);
    var badge = document.getElementById('sidebarLevelBadge');
    if (badge) {
        badge.textContent = 'Lv.' + info.level;
        badge.style.display = 'inline-block';
        badge.className = 'level-badge-mini level-badge ' + getLevelBadgeClass(info.level);
    }
}

function renderTeacherUI() {
    var isTeacher = (currentUserRole === 'teacher' || currentUserRole === 'owner');
    var form = document.getElementById('teacherMessageForm');
    if (form) { form.style.display = isTeacher ? 'block' : 'none'; }
}

function bindSidebar() {
    var menus = document.querySelectorAll('.sidebar-menu > div[data-page]');
    menus.forEach(function(menu) {
        menu.onclick = function() {
            menus.forEach(function(m) { m.classList.remove('active'); });
            this.classList.add('active');
            var page = this.dataset.page;
            document.querySelectorAll('.page-box').forEach(function(p) { p.classList.add('hidden'); });
            var target = document.getElementById('page-' + page);
            if (target) target.classList.remove('hidden');
            if (page === 'usercenter') renderUserCenter();
            if (page === 'myLike') loadMyLikes();
            if (page === 'myCollect') loadMyCollects();
            if (page === 'messages') { loadContactList(); updateMsgBadge(); }
            if (page === 'notice') loadNotice();
            if (page === 'functions') { loadPolls(); loadDoc(); loadCalendar(); loadAlbum(); }
            if (page === 'dynamic') loadDynamics(true);
            if (page === 'search') { var sr = document.getElementById('searchResult'); if (sr) sr.innerHTML = ''; }
            if (page === 'capsule') loadCapsules();
            if (page === 'timeline') loadTimeline();
            if (page === 'destinations') loadDestinations();
            if (page === 'teacher') loadTeacherMessages();
            if (page === 'admin') loadAdmin('dashboard');
            if (page === 'home') { renderClassList(); }
            if (page === 'changelog') loadChangelog();
            if (page === 'findclass') { document.getElementById('findClassResults').innerHTML = ''; }
            updatePageTitle();
            closeSidebar();
        };
    });
}

// ---------- 绑定模态框事件 ----------
function bindClassEvents() {
    document.getElementById('createClassBtn').onclick = function() {
        document.getElementById('createClassModal').style.display = 'flex';
    };
    document.getElementById('createClassCancel').onclick = function() {
        document.getElementById('createClassModal').style.display = 'none';
    };
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

    document.getElementById('joinClassBtn').onclick = function() {
        document.getElementById('joinClassModal').style.display = 'flex';
    };
    document.getElementById('joinClassCancel').onclick = function() {
        document.getElementById('joinClassModal').style.display = 'none';
    };
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
            html += '<div style="padding:8px 12px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;">' +
                '<div><strong>' + cls.name + '</strong><br><span style="font-size:0.8rem;color:var(--text-secondary);">' + (cls.school_name || '') + ' · ' + (cls.grade || '') + '</span></div>' +
                '<button class="btn-sm" onclick="joinClassByInvite(\'' + cls.invite_code + '\')">加入</button>' +
                '</div>';
        });
        results.innerHTML = html;
    });

    document.getElementById('writeCapsuleBtn').onclick = function() {
        document.getElementById('writeCapsuleModal').style.display = 'flex';
        var d = new Date();
        d.setFullYear(d.getFullYear() + 1);
        document.getElementById('capsuleUnlockDate').value = d.toISOString().slice(0, 10);
    };
    document.getElementById('writeCapsuleCancel').onclick = function() {
        document.getElementById('writeCapsuleModal').style.display = 'none';
    };
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

    document.getElementById('addTimelineBtn').onclick = function() {
        document.getElementById('addTimelineModal').style.display = 'flex';
        document.getElementById('timelineDate').value = new Date().toISOString().slice(0, 10);
    };
    document.getElementById('addTimelineCancel').onclick = function() {
        document.getElementById('addTimelineModal').style.display = 'none';
    };
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

    document.getElementById('addDestinationBtn').onclick = function() {
        document.getElementById('addDestinationModal').style.display = 'flex';
    };
    document.getElementById('addDestinationCancel').onclick = function() {
        document.getElementById('addDestinationModal').style.display = 'none';
    };
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

    document.getElementById('classSwitcherBtn').onclick = function(e) {
        e.stopPropagation();
        var dropdown = document.getElementById('classDropdown');
        var arrow = document.getElementById('classArrow');
        dropdown.classList.toggle('open');
        if (arrow) arrow.classList.toggle('open');
    };
    document.addEventListener('click', function(e) {
        var dropdown = document.getElementById('classDropdown');
        var btn = document.getElementById('classSwitcherBtn');
        if (dropdown && btn && !dropdown.contains(e.target) && !btn.contains(e.target)) {
            dropdown.classList.remove('open');
            var arrow = document.getElementById('classArrow');
            if (arrow) arrow.classList.remove('open');
        }
    });
}

function bindFindClass() {
    document.getElementById('findClassBtn').onclick = async function() {
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
                (alreadyJoined ? '<span class="tag" style="background:var(--success);color:#fff;">已加入</span>' : '<button class="btn-sm" onclick="joinClassByInvite(\'' + cls.invite_code + '\')">加入</button>') +
                '</div>';
        });
        results.innerHTML = html;
    };
}

// ---------- 消息订阅 ----------
function subscribeToMessages() {
    if (messageSubscription) return;
    var supabase = getSupabase();
    messageSubscription = supabase
        .channel('messages-channel')
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: 'to_user=eq.' + currentUser.email
        }, function(payload) {
            updateMsgBadge();
            if (!document.getElementById('page-messages').classList.contains('hidden')) {
                loadContactList();
                if (currentChatTarget && currentChatType === 'user' &&
                    (payload.new.from_user === currentChatTarget || payload.new.to_user === currentChatTarget)) {
                    loadChatMessages(currentChatTarget, 'user');
                }
            }
            toast('📩 新消息');
        })
        .subscribe();
}

function updateMsgBadge() {
    if (!currentUser) return;
    var supabase = getSupabase();
    supabase.from('messages').select('id', { count: 'exact' }).eq('to_user', currentUser.email).eq('read', false).then(function(res) {
        var count = res.data ? res.data.length : 0;
        var badge = document.getElementById('msgBadge');
        var bottomBadge = document.getElementById('bottomMsgBadge');
        if (count > 0 && badge) { badge.textContent = count > 99 ? '99+' : count; badge.classList.remove('hidden'); } else if (badge) { badge.classList.add('hidden'); }
        if (count > 0 && bottomBadge) { bottomBadge.textContent = count > 99 ? '99+' : count; bottomBadge.classList.remove('hidden'); } else if (bottomBadge) { bottomBadge.classList.add('hidden'); }
    });
}

// ---------- 签到 ----------
async function showCheckinModal() {
    var supabase = getSupabase();
    var today = new Date().toISOString().slice(0, 10);
    var stats = await supabase.from('user_stats').select('*').eq('user_email', currentUser.email).maybeSingle();
    if (!stats.data) return;
    var lastCheckin = stats.data.last_checkin || '';
    var streak = stats.data.login_streak || 0;
    var alreadyChecked = (lastCheckin === today);
    var modal = document.getElementById('checkinModal');
    var content = document.getElementById('checkinContent');
    if (alreadyChecked) {
        content.innerHTML = '<div class="checkin-done"><div class="icon">✅</div><div class="info">今日已签到</div><div style="color:var(--text-secondary);font-size:0.9rem;">连续签到 ' + streak + ' 天</div><button class="btn-sm" onclick="document.getElementById(\'checkinModal\').style.display=\'none\'" style="margin-top:12px;">确定</button></div>';
    } else {
        var bonus = (streak + 1) % 7 === 0 ? 100 : 10;
        var bonusPoints = (streak + 1) % 7 === 0 ? 20 : 5;
        content.innerHTML = '<div style="text-align:center;padding:10px 0;">' +
            '<div style="font-size:3rem;">📅</div>' +
            '<div style="font-size:1.2rem;font-weight:600;margin:8px 0;">签到</div>' +
            '<div style="color:var(--text-secondary);">连续签到 ' + (streak + 1) + ' 天</div>' +
            '<div style="margin:12px 0;padding:12px;background:rgba(255,255,255,0.15);border-radius:var(--radius-sm);">' +
            '<span style="color:var(--gold);font-weight:700;">+' + bonus + ' 经验</span>  ' +
            '<span style="color:var(--success);font-weight:700;">+' + bonusPoints + ' 积分</span>' +
            ((streak + 1) % 7 === 0 ? '<br><span style="color:var(--danger);">🎉 连续7天！额外奖励！</span>' : '') +
            '</div>' +
            '<div style="display:flex;gap:12px;justify-content:center;">' +
            '<button class="btn-main" style="width:auto;padding:8px 32px;" id="doCheckinBtn">签到</button>' +
            '<button class="btn-cancel" onclick="document.getElementById(\'checkinModal\').style.display=\'none\'">取消</button>' +
            '</div></div>';
        document.getElementById('doCheckinBtn').onclick = function() { doCheckin(); };
    }
    modal.style.display = 'flex';
}

async function doCheckin() {
    var supabase = getSupabase();
    var today = new Date().toISOString().slice(0, 10);
    var stats = await supabase.from('user_stats').select('*').eq('user_email', currentUser.email).maybeSingle();
    if (!stats.data) return;
    if (stats.data.last_checkin === today) { toast('今日已签到'); return; }
    var streak = stats.data.login_streak || 0;
    var exp = stats.data.exp || 0;
    var points = stats.data.points || 0;
    var totalExp = stats.data.total_exp || 0;
    var level = stats.data.level || 1;
    var bonus = (streak + 1) % 7 === 0 ? 100 : 10;
    var bonusPoints = (streak + 1) % 7 === 0 ? 20 : 5;
    var newStreak = streak + 1;
    exp += bonus; points += bonusPoints; totalExp += bonus;
    var newLevel = level;
    for (var i = 0; i < LEVEL_CONFIG.length; i++) {
        if (exp >= LEVEL_CONFIG[i].exp) newLevel = LEVEL_CONFIG[i].level;
    }
    if (newLevel > level) {
        toast('🎊 签到升级到 Lv.' + newLevel + '！');
        points += newLevel * 5;
    }
    await supabase.from('user_stats').update({
        exp: exp, total_exp: totalExp, points: points, level: newLevel,
        login_streak: newStreak, last_checkin: today, last_login: new Date().toISOString()
    }).eq('user_email', currentUser.email);
    if (currentUser) {
        currentUser.stats = { exp: exp, total_exp: totalExp, points: points, level: newLevel, login_streak: newStreak };
    }
    document.getElementById('checkinModal').style.display = 'none';
    toast('✅ 签到成功！+' + bonus + '经验 +' + bonusPoints + '积分');
    renderSidebarLevel();
    renderUserCenter();
}

// ---------- 底部导航 ----------
function bindBottomNav() {
    var navItems = document.querySelectorAll('.bottom-nav .nav-item');
    navItems.forEach(function(item) {
        item.onclick = function() {
            var page = this.dataset.page;
            var menuItem = document.querySelector('.sidebar-menu > div[data-page="' + page + '"]');
            if (menuItem) menuItem.click();
            navItems.forEach(function(n) { n.classList.remove('active'); });
            this.classList.add('active');
            document.getElementById('mainContent').scrollTop = 0;
        };
    });
}

// ---------- 设置系统 ----------
function saveSettings(settings) { localStorage.setItem('blog_settings', JSON.stringify(settings)); }
function loadSettings() { try { return JSON.parse(localStorage.getItem('blog_settings')) || {}; } catch (e) { return {}; } }

function applySettings() {
    var settings = loadSettings();
    var root = document.documentElement;
    var theme = settings.theme || 'light';
    var color = settings.color || '#81C9FF';
    if (!settings.theme || settings.theme === 'auto') {
        var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        theme = prefersDark ? 'dark' : 'light';
        settings.theme = theme;
        saveSettings(settings);
    }
    root.style.setProperty('--primary', color);
    var lightness = (parseInt(color.slice(1, 3), 16) * 0.299 + parseInt(color.slice(3, 5), 16) * 0.587 + parseInt(color.slice(5, 7), 16) * 0.114);
    if (lightness > 160) {
        root.style.setProperty('--primary-dark', '#5BA8E0');
    } else {
        root.style.setProperty('--primary-dark', '#2588DE');
    }
    if (theme === 'dark') {
        root.style.setProperty('--bg-page', '#1a1a2e');
        root.style.setProperty('--glass-bg', 'rgba(30,30,50,0.65)');
        root.style.setProperty('--glass-border', 'rgba(255,255,255,0.08)');
        root.style.setProperty('--text-primary', '#e8e8e8');
        root.style.setProperty('--text-secondary', '#a0a0b0');
        root.style.setProperty('--text-light', '#6b6b80');
        root.style.setProperty('--border-color', 'rgba(255,255,255,0.06)');
    } else {
        root.style.setProperty('--bg-page', '#f0f4fa');
        root.style.setProperty('--glass-bg', 'rgba(255,255,255,0.55)');
        root.style.setProperty('--glass-border', 'rgba(255,255,255,0.25)');
        root.style.setProperty('--text-primary', '#1a2a3a');
        root.style.setProperty('--text-secondary', '#4a5a6a');
        root.style.setProperty('--text-light', '#8a9aaa');
        root.style.setProperty('--border-color', 'rgba(0,0,0,0.06)');
    }
    var font = settings.font || 'system-ui, -apple-system, sans-serif';
    root.style.setProperty('--font', font);
    var size = settings.fontSize || 16;
    root.style.setProperty('--font-size', size + 'px');
}

function renderSettingsContent(tab) {
    var container = document.getElementById('settingsContent');
    if (!container) return;
    var settings = loadSettings();
    var html = '';
    switch (tab) {
        case 'system':
            html = '<h3>系统</h3><div class="setting-group" style="margin-bottom:16px;"><label style="display:block;font-weight:500;color:var(--text-secondary);margin-bottom:6px;">主题</label><div class="theme-toggle" style="display:flex;gap:10px;"><button data-theme="light" class="' + (settings.theme === 'light' ? 'active' : '') + '" style="flex:1;padding:8px;border-radius:var(--radius-full);background:' + (settings.theme === 'light' ? 'var(--primary)' : 'rgba(255,255,255,0.10)') + ';color:' + (settings.theme === 'light' ? '#fff' : 'var(--text-secondary)') + ';border:none;cursor:pointer;font-weight:500;">☀️ 浅色</button><button data-theme="dark" class="' + (settings.theme === 'dark' ? 'active' : '') + '" style="flex:1;padding:8px;border-radius:var(--radius-full);background:' + (settings.theme === 'dark' ? 'var(--primary)' : 'rgba(255,255,255,0.10)') + ';color:' + (settings.theme === 'dark' ? '#fff' : 'var(--text-secondary)') + ';border:none;cursor:pointer;font-weight:500;">🌙 深色</button><button data-theme="auto" class="' + (settings.theme === 'auto' ? 'active' : '') + '" style="flex:1;padding:8px;border-radius:var(--radius-full);background:' + (settings.theme === 'auto' ? 'var(--primary)' : 'rgba(255,255,255,0.10)') + ';color:' + (settings.theme === 'auto' ? '#fff' : 'var(--text-secondary)') + ';border:none;cursor:pointer;font-weight:500;">🔄 跟随系统</button></div></div>' +
                '<div class="setting-group" style="margin-bottom:16px;"><label style="display:block;font-weight:500;color:var(--text-secondary);margin-bottom:6px;">辅助色</label><div class="color-options" id="colorOptions" style="display:flex;gap:12px;flex-wrap:wrap;"><button data-color="#81C9FF" style="background:#81C9FF;width:36px;height:36px;border-radius:50%;border:2px solid transparent;' + (settings.color === '#81C9FF' ? 'border-color:var(--text-primary);transform:scale(1.1);' : '') + '"></button><button data-color="#2c6b9e" style="background:#2c6b9e;width:36px;height:36px;border-radius:50%;border:2px solid transparent;' + (settings.color === '#2c6b9e' ? 'border-color:var(--text-primary);transform:scale(1.1);' : '') + '"></button><button data-color="#7b4b9a" style="background:#7b4b9a;width:36px;height:36px;border-radius:50%;border:2px solid transparent;' + (settings.color === '#7b4b9a' ? 'border-color:var(--text-primary);transform:scale(1.1);' : '') + '"></button><button data-color="#c97d2b" style="background:#c97d2b;width:36px;height:36px;border-radius:50%;border:2px solid transparent;' + (settings.color === '#c97d2b' ? 'border-color:var(--text-primary);transform:scale(1.1);' : '') + '"></button></div></div>' +
                '<div class="setting-group" style="margin-bottom:16px;"><label style="display:block;font-weight:500;color:var(--text-secondary);margin-bottom:6px;">字体</label><select id="fontSelect" style="width:100%;padding:10px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:rgba(255,255,255,0.4);color:var(--text-primary);"><option value="system-ui, -apple-system, sans-serif" ' + (settings.font === 'system-ui, -apple-system, sans-serif' ? 'selected' : '') + '>系统</option><option value="\'宋体\', SimSun, serif" ' + (settings.font === "'宋体', SimSun, serif" ? 'selected' : '') + '>宋体</option><option value="\'黑体\', SimHei, sans-serif" ' + (settings.font === "'黑体', SimHei, sans-serif" ? 'selected' : '') + '>黑体</option></select></div>' +
                '<div class="setting-group" style="margin-bottom:16px;"><label style="display:block;font-weight:500;color:var(--text-secondary);margin-bottom:6px;">文字大小：<span id="fontSizeLabel">' + (settings.fontSize || 16) + '</span>px</label><input type="range" id="fontSizeRange" min="14" max="24" value="' + (settings.fontSize || 16) + '" step="1" style="width:100%;"></div>';
            break;
        case 'personal':
            html = '<h3>个性化</h3><div class="setting-group" style="margin-bottom:16px;"><label style="display:block;font-weight:500;color:var(--text-secondary);margin-bottom:6px;">自定义背景图（URL）</label><input type="text" id="customBgInput" value="' + (settings.customBg || '') + '" placeholder="https://example.com/bg.jpg" style="width:100%;padding:10px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:rgba(255,255,255,0.4);color:var(--text-primary);"><button class="btn-sm" id="applyBgBtn" style="margin-top:6px;padding:6px 18px;background:var(--primary);color:#fff;border-radius:var(--radius-full);">应用</button></div>' +
                '<div class="setting-group" style="margin-bottom:16px;"><label style="display:block;font-weight:500;color:var(--text-secondary);margin-bottom:6px;">自定义主题色</label><input type="color" id="customColorPicker" value="' + (settings.color || '#81C9FF') + '" style="width:100%;padding:6px;border:1px solid var(--border-color);border-radius:var(--radius-sm);"><button class="btn-sm" id="applyColorBtn" style="margin-top:6px;padding:6px 18px;background:var(--primary);color:#fff;border-radius:var(--radius-full);">应用</button></div>';
            break;
        case 'ai':
            var hasKey = !!settings.deepseekKey;
            html = '<h3>AI助手</h3><div class="setting-group" style="margin-bottom:16px;"><label style="display:block;font-weight:500;color:var(--text-secondary);margin-bottom:6px;">DeepSeek API Key</label><div><span class="status-dot ' + (hasKey ? 'set' : 'unset') + '" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + (hasKey ? 'var(--success)' : 'var(--danger)') + ';margin-right:8px;"></span> ' + (hasKey ? '已设置' : '未设置') + '</div><input type="password" id="deepseekKeyInput" value="' + (settings.deepseekKey || '') + '" style="width:100%;padding:10px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:rgba(255,255,255,0.4);color:var(--text-primary);margin-top:4px;"><button class="btn-secondary" id="saveDeepseekKey" style="margin-top:6px;padding:6px 18px;background:rgba(255,255,255,0.10);color:var(--text-secondary);border-radius:var(--radius-full);">保存</button></div>' +
                '<div class="setting-group" style="margin-bottom:16px;"><label style="display:block;font-weight:500;color:var(--text-secondary);margin-bottom:6px;">系统提示词</label><textarea id="aiSystemPromptInput" rows="3" style="width:100%;padding:10px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:rgba(255,255,255,0.4);color:var(--text-primary);resize:vertical;">' + (settings.aiSystemPrompt || '你是DSAI，班级博客的AI助手。') + '</textarea></div>' +
                '<div class="setting-group" style="margin-bottom:16px;"><label style="display:block;font-weight:500;color:var(--text-secondary);margin-bottom:6px;">模式</label><div class="mode-toggle" style="display:flex;gap:10px;"><button class="' + (settings.aiDeepThink ? '' : 'active') + '" id="aiNormalMode" style="flex:1;padding:8px;border-radius:var(--radius-full);background:' + (settings.aiDeepThink ? 'rgba(255,255,255,0.10)' : 'var(--primary)') + ';color:' + (settings.aiDeepThink ? 'var(--text-secondary)' : '#fff') + ';border:none;cursor:pointer;font-weight:500;">普通</button><button class="' + (settings.aiDeepThink ? 'active' : '') + '" id="aiDeepMode" style="flex:1;padding:8px;border-radius:var(--radius-full);background:' + (settings.aiDeepThink ? 'var(--primary)' : 'rgba(255,255,255,0.10)') + ';color:' + (settings.aiDeepThink ? '#fff' : 'var(--text-secondary)') + ';border:none;cursor:pointer;font-weight:500;">深度思考</button></div></div>';
            break;
        case 'cloud':
            html = '<h3>云配置</h3><div class="setting-group" style="margin-bottom:16px;"><label style="display:block;font-weight:500;color:var(--text-secondary);margin-bottom:6px;">Supabase URL</label><input type="text" id="supabaseUrlInput" value="' + (settings.supabaseUrl || CONFIG.SUPABASE_URL) + '" style="width:100%;padding:10px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:rgba(255,255,255,0.4);color:var(--text-primary);"></div>' +
                '<div class="setting-group" style="margin-bottom:16px;"><label style="display:block;font-weight:500;color:var(--text-secondary);margin-bottom:6px;">Anon Key</label><input type="password" id="supabaseKeyInput" value="' + (settings.supabaseKey || '') + '" style="width:100%;padding:10px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:rgba(255,255,255,0.4);color:var(--text-primary);"></div>' +
                '<button class="btn-main" id="saveCloudConfig" style="padding:8px 24px;background:var(--primary);color:#fff;border-radius:var(--radius-full);font-weight:600;">保存并重启</button>';
            break;
        case 'account':
            html = '<h3>账户</h3><p style="margin:4px 0;"><strong>用户：</strong>' + (currentUser ? currentUser.nickname : '未登录') + '</p><p style="margin:4px 0;"><strong>邮箱：</strong>' + (currentUser ? currentUser.email : '') + '</p><p style="margin:4px 0;"><strong>等级：</strong>Lv.' + (currentUser && currentUser.stats ? currentUser.stats.level : '') + '</p><p style="margin:4px 0;"><strong>积分：</strong>' + (currentUser && currentUser.stats ? currentUser.stats.points : '') + '</p><p style="margin:4px 0;"><strong>角色：</strong>' + (currentUserRole === 'owner' ? '⭐ 站主' : currentUserRole === 'teacher' ? '🎓 教师' : '👤 学生') + '</p><button class="btn-danger" id="logoutFromSettings" style="padding:8px 20px;background:var(--danger);color:#fff;border-radius:var(--radius-full);margin-top:8px;">退出登录</button><br><br><button class="btn-danger" id="deleteAccountFromSettings" style="padding:8px 20px;background:var(--danger);color:#fff;border-radius:var(--radius-full);">注销账号</button>';
            break;
        case 'data':
            html = '<h3>数据管理</h3><button class="btn-main" id="backupBtn" style="padding:8px 24px;background:var(--primary);color:#fff;border-radius:var(--radius-full);font-weight:600;">导出数据</button><br><br><button class="btn-secondary" id="restoreBtn" style="padding:8px 24px;background:rgba(255,255,255,0.10);color:var(--text-secondary);border-radius:var(--radius-full);">导入数据</button><input type="file" id="restoreFileInput" accept=".json" style="display:none;"><br><br><button class="btn-secondary" id="clearCacheBtn" style="padding:8px 24px;background:rgba(255,255,255,0.10);color:var(--text-secondary);border-radius:var(--radius-full);">一键清理本地缓存</button>';
            break;
        case 'security':
            html = '<h3>设备管理</h3><p style="margin:4px 0;">当前设备：<strong>' + (localStorage.getItem('device_id') || 'device_' + Date.now()) + '</strong></p><button class="btn-danger" id="logoutAllDevices" style="padding:8px 20px;background:var(--danger);color:#fff;border-radius:var(--radius-full);">退出其他设备</button><br><br><button class="btn-secondary" id="viewLoginLogBtn" style="padding:8px 20px;background:rgba(255,255,255,0.10);color:var(--text-secondary);border-radius:var(--radius-full);">查看登录日志</button><div id="loginLogContent" style="margin-top:8px;font-size:0.85rem;color:var(--text-secondary);"></div>';
            break;
        case 'privacy':
            html = '<h3>隐私设置</h3><div class="setting-group" style="margin-bottom:12px;"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" id="privacyProfile" ' + (settings.privacyProfile === 'private' ? '' : 'checked') + ' style="width:18px;height:18px;accent-color:var(--primary);"> 个人资料对所有人可见</label></div><div class="setting-group" style="margin-bottom:12px;"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" id="privacyDyn" ' + (settings.privacyDyn === 'friends' ? '' : 'checked') + ' style="width:18px;height:18px;accent-color:var(--primary);"> 动态公开</label></div><button class="btn-sm" id="savePrivacyBtn" style="padding:6px 18px;background:var(--primary);color:#fff;border-radius:var(--radius-full);">保存隐私设置</button>';
            break;
        default: html = '<h3>设置</h3>';
    }
    container.innerHTML = html;
    bindSettingsControls(tab);
}

function bindSettingsControls(tab) {
    document.querySelectorAll('.theme-toggle button').forEach(function(btn) {
        btn.onclick = function() { var s = loadSettings(); s.theme = this.dataset.theme; saveSettings(s); applySettings(); renderSettingsContent(tab); };
    });
    document.querySelectorAll('#colorOptions button').forEach(function(btn) {
        btn.onclick = function() { var s = loadSettings(); s.color = this.dataset.color; saveSettings(s); applySettings(); renderSettingsContent(tab); };
    });
    var fontSelect = document.getElementById('fontSelect');
    if (fontSelect) fontSelect.onchange = function() { var s = loadSettings(); s.font = this.value; saveSettings(s); applySettings(); };
    var fontSizeRange = document.getElementById('fontSizeRange');
    if (fontSizeRange) {
        fontSizeRange.oninput = function() { var s = loadSettings(); s.fontSize = parseInt(this.value); var label = document.getElementById('fontSizeLabel'); if (label) label.textContent = s.fontSize; saveSettings(s); applySettings(); };
    }
    var saveKeyBtn = document.getElementById('saveDeepseekKey');
    if (saveKeyBtn) saveKeyBtn.onclick = function() { var s = loadSettings(); s.deepseekKey = document.getElementById('deepseekKeyInput').value.trim(); saveSettings(s); toast('已保存'); renderSettingsContent('ai'); };
    var promptInput = document.getElementById('aiSystemPromptInput');
    if (promptInput) promptInput.onchange = function() { var s = loadSettings(); s.aiSystemPrompt = this.value.trim(); saveSettings(s); toast('提示词已保存'); };
    var aiNormal = document.getElementById('aiNormalMode'); if (aiNormal) aiNormal.onclick = function() { var s = loadSettings(); s.aiDeepThink = false; saveSettings(s); renderSettingsContent('ai'); };
    var aiDeep = document.getElementById('aiDeepMode'); if (aiDeep) aiDeep.onclick = function() { var s = loadSettings(); s.aiDeepThink = true; saveSettings(s); renderSettingsContent('ai'); };
    var logoutBtn = document.getElementById('logoutFromSettings'); if (logoutBtn) logoutBtn.onclick = signOut;
    var deleteBtn = document.getElementById('deleteAccountFromSettings');
    if (deleteBtn) {
        deleteBtn.onclick = function() { if (!confirm('确认注销？')) return; var supabase = getSupabase(); supabase.from('profiles').delete().eq('id', currentUser.id).then(function() { supabase.auth.admin.deleteUser(currentUser.id).then(function() { toast('已注销'); signOut(); }); }); };
    }
    var saveCloudBtn = document.getElementById('saveCloudConfig');
    if (saveCloudBtn) {
        saveCloudBtn.onclick = function() { var s = loadSettings(); s.supabaseUrl = document.getElementById('supabaseUrlInput').value.trim(); s.supabaseKey = document.getElementById('supabaseKeyInput').value.trim(); saveSettings(s); toast('已保存，刷新'); setTimeout(function() { location.reload(); }, 1000); };
    }
    var backupBtn = document.getElementById('backupBtn'); if (backupBtn) backupBtn.onclick = backupData;
    var restoreBtn = document.getElementById('restoreBtn'); if (restoreBtn) restoreBtn.onclick = function() { var input = document.getElementById('restoreFileInput'); if (input) input.click(); };
    var restoreInput = document.getElementById('restoreFileInput');
    if (restoreInput) restoreInput.onchange = function(e) { if (e.target.files.length > 0) { restoreData(e.target.files[0]); this.value = ''; } };
    var logoutAllBtn = document.getElementById('logoutAllDevices');
    if (logoutAllBtn) {
        logoutAllBtn.onclick = function() { if (confirm('退出其他设备？')) { localStorage.clear(); toast('已清除会话，请重新登录'); setTimeout(function() { location.reload(); }, 1500); } };
    }
    var clearCacheBtn = document.getElementById('clearCacheBtn');
    if (clearCacheBtn) {
        clearCacheBtn.onclick = function() { if (confirm('清理本地缓存？')) { localStorage.clear(); toast('缓存已清理'); location.reload(); } };
    }
    var applyBgBtn = document.getElementById('applyBgBtn');
    if (applyBgBtn) {
        applyBgBtn.onclick = function() { var url = document.getElementById('customBgInput').value.trim(); var s = loadSettings(); s.customBg = url; saveSettings(s); document.body.style.backgroundImage = url ? 'url(' + url + ')' : ''; document.body.style.backgroundSize = 'cover'; document.body.style.backgroundAttachment = 'fixed'; toast('背景已应用'); };
    }
    var applyColorBtn = document.getElementById('applyColorBtn');
    if (applyColorBtn) {
        applyColorBtn.onclick = function() {
            var color = document.getElementById('customColorPicker').value;
            if (color) {
                var s = loadSettings(); s.color = color; saveSettings(s); applySettings();
                toast('主题色已应用');
            }
        };
    }
    var savePrivacyBtn = document.getElementById('savePrivacyBtn');
    if (savePrivacyBtn) {
        savePrivacyBtn.onclick = function() { var s = loadSettings(); s.privacyProfile = document.getElementById('privacyProfile').checked ? 'public' : 'private'; s.privacyDyn = document.getElementById('privacyDyn').checked ? 'public' : 'friends'; saveSettings(s); toast('隐私设置已保存'); };
    }
}

function bindSettings() {
    var overlay = document.getElementById('settingsOverlay');
    if (!overlay) return;
    var settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
        settingsBtn.onclick = function() { overlay.classList.add('open'); renderSettingsContent('system'); document.querySelectorAll('.setting-nav-item').forEach(function(i) { i.classList.remove('active'); }); var first = document.querySelector('.setting-nav-item[data-tab="system"]'); if (first) first.classList.add('active'); };
    }
    var closeBtn = document.getElementById('settingsClose');
    if (closeBtn) closeBtn.onclick = function() { overlay.classList.remove('open'); };
    overlay.onclick = function(e) { if (e.target === overlay) overlay.classList.remove('open'); };
    document.querySelectorAll('.setting-nav-item').forEach(function(item) {
        item.onclick = function() { document.querySelectorAll('.setting-nav-item').forEach(function(i) { i.classList.remove('active'); }); this.classList.add('active'); renderSettingsContent(this.dataset.tab); };
    });
}

// ---------- 数据备份 ----------
async function backupData() {
    var supabase = getSupabase();
    var tables = ['profiles','dynamics','comments','likes','collects','follows','messages','groups','group_messages','assignments','assignment_receipts','polls','poll_votes','documents','treehole_posts','calendar_events','banned_users','user_stats','exp_logs','user_avatar_items','avatar_items','group_roles','group_nicknames','teacher_messages','classes','class_members','time_capsules','class_timeline','alumni_destinations','version_logs'];
    var data = {};
    for (var i = 0; i < tables.length; i++) { var r = await supabase.from(tables[i]).select('*'); data[tables[i]] = r.data || []; }
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = 'class_timemachine_backup_' + new Date().toISOString().slice(0, 10) + '.json'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    toast('导出成功');
}

async function restoreData(file) {
    var supabase = getSupabase();
    var reader = new FileReader();
    reader.onload = async function(e) {
        try { var data = JSON.parse(e.target.result); if (!confirm('覆盖所有数据？')) return; for (var table in data) { if (data[table].length > 0) { await supabase.from(table).delete().neq('id', 0); await supabase.from(table).insert(data[table]); } } toast('恢复成功，刷新'); setTimeout(function() { location.reload(); }, 1500); } catch (err) { toast('解析失败：' + err.message); }
    };
    reader.readAsText(file);
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

// ---------- 绑定所有模态框 ----------
function bindModals() {
    var createGroupBtn = document.getElementById('createGroupBtn2');
    if (createGroupBtn) createGroupBtn.onclick = openCreateGroupModal;
    var cancelGroup = document.getElementById('createGroupCancel');
    if (cancelGroup) cancelGroup.onclick = function() { document.getElementById('createGroupModal').style.display = 'none'; };
    var groupModal = document.getElementById('createGroupModal');
    if (groupModal) groupModal.onclick = function(e) { if (e.target === this) this.style.display = 'none'; };
    var confirmGroup = document.getElementById('createGroupConfirm');
    if (confirmGroup) confirmGroup.onclick = createGroupConfirm;

    var newNoticeBtn = document.getElementById('newNoticeBtn');
    if (newNoticeBtn) newNoticeBtn.onclick = function() { document.getElementById('newNoticeModal').style.display = 'flex'; };
    var noticeCancel = document.getElementById('noticeModalCancel');
    if (noticeCancel) noticeCancel.onclick = function() { document.getElementById('newNoticeModal').style.display = 'none'; };
    var noticeConfirm = document.getElementById('noticeModalConfirm');
    if (noticeConfirm) {
        noticeConfirm.onclick = async function() {
            var title = document.getElementById('noticeTitleInput').value.trim();
            var desc = document.getElementById('noticeDescInput').value.trim();
            var deadline = document.getElementById('noticeDeadlineInput').value;
            if (!title) { toast('请输入标题'); return; }
            var supabase = getSupabase();
            var { error } = await supabase.from('assignments').insert({ title: title, description: desc, deadline: deadline || null, created_by: currentUser.email, class_id: currentClassId });
            if (error) { toast('发布失败：' + error.message); return; }
            toast('发布成功！');
            document.getElementById('newNoticeModal').style.display = 'none';
            document.getElementById('noticeTitleInput').value = '';
            document.getElementById('noticeDescInput').value = '';
            document.getElementById('noticeDeadlineInput').value = '';
            loadNotice();
            await addExp(currentUser.email, 100, '发布通知');
        };
    }

    var newPollBtn = document.getElementById('newPollBtn');
    if (newPollBtn) newPollBtn.onclick = function() { document.getElementById('newPollModal').style.display = 'flex'; };
    var pollCancel = document.getElementById('pollModalCancel');
    if (pollCancel) pollCancel.onclick = function() { document.getElementById('newPollModal').style.display = 'none'; };
    var pollConfirm = document.getElementById('pollModalConfirm');
    if (pollConfirm) {
        pollConfirm.onclick = async function() {
            var question = document.getElementById('pollQuestionInput').value.trim();
            var optionsText = document.getElementById('pollOptionsInput').value;
            var options = optionsText.split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
            var anonymous = document.getElementById('pollAnonymousCheck').checked;
            if (!question || options.length < 2) { toast('请填写问题和至少2个选项'); return; }
            var supabase = getSupabase();
            var { error } = await supabase.from('polls').insert({ question: question, options: options, anonymous: anonymous, created_by: currentUser.email, class_id: currentClassId });
            if (error) { toast('发起失败：' + error.message); return; }
            toast('发起成功！');
            document.getElementById('newPollModal').style.display = 'none';
            document.getElementById('pollQuestionInput').value = '';
            document.getElementById('pollOptionsInput').value = '';
            document.getElementById('pollAnonymousCheck').checked = false;
            loadPolls();
            await addExp(currentUser.email, 100, '发起投票');
        };
    }

    var saveDocBtn = document.getElementById('saveDocBtn');
    if (saveDocBtn) {
        saveDocBtn.onclick = async function() {
            var title = document.getElementById('docTitleInput').value.trim();
            var content = document.getElementById('docContentInput').value;
            if (!title) { toast('请输入标题'); return; }
            var supabase = getSupabase();
            if (window._docId) {
                var { error } = await supabase.from('documents').update({ title: title, content: content, updated_by: currentUser.email, updated_at: new Date().toISOString() }).eq('id', window._docId);
            } else {
                var { error } = await supabase.from('documents').insert({ title: title, content: content, updated_by: currentUser.email });
            }
            if (error) { toast('保存失败：' + error.message); return; }
            toast('保存成功！');
            loadDoc();
            await addExp(currentUser.email, 20, '编辑文档');
        };
    }

    var addEventBtn = document.getElementById('addEventBtn');
    if (addEventBtn) addEventBtn.onclick = function() { document.getElementById('addEventModal').style.display = 'flex'; };
    var eventCancel = document.getElementById('eventModalCancel');
    if (eventCancel) eventCancel.onclick = function() { document.getElementById('addEventModal').style.display = 'none'; };
    var eventConfirm = document.getElementById('eventModalConfirm');
    if (eventConfirm) {
        eventConfirm.onclick = async function() {
            var title = document.getElementById('eventTitleInput').value.trim();
            var desc = document.getElementById('eventDescInput').value.trim();
            var date = document.getElementById('eventDateInput').value;
            var type = document.getElementById('eventTypeInput').value;
            if (!title || !date) { toast('请填写标题和日期'); return; }
            var supabase = getSupabase();
            var { error } = await supabase.from('calendar_events').insert({ title: title, description: desc, event_date: date, event_type: type, created_by: currentUser.email, class_id: currentClassId });
            if (error) { toast('添加失败：' + error.message); return; }
            toast('添加成功！');
            document.getElementById('addEventModal').style.display = 'none';
            document.getElementById('eventTitleInput').value = '';
            document.getElementById('eventDescInput').value = '';
            document.getElementById('eventDateInput').value = '';
            loadCalendar();
            await addExp(currentUser.email, 20, '添加日历事件');
        };
    }

    var treeholeBtn = document.getElementById('treeholeEntryBtn');
    if (treeholeBtn) {
        treeholeBtn.onclick = function() {
            var item = document.querySelector('#contactItems .msg-contact-item[data-target="_treehole"]');
            if (item) item.click();
            else toast('刷新后重试');
        };
    }

    var checkinBtn = document.getElementById('checkinBtn');
    if (checkinBtn) checkinBtn.onclick = function() { showCheckinModal(); };

    var shopClose = document.getElementById('avatarShopClose');
    if (shopClose) shopClose.onclick = function() { document.getElementById('avatarShopModal').style.display = 'none'; };
    var shopModal = document.getElementById('avatarShopModal');
    if (shopModal) shopModal.onclick = function(e) { if (e.target === this) this.style.display = 'none'; };

    bindGroupManageButtons();

    var pubEmojiBtn = document.getElementById('pubEmojiBtn');
    if (pubEmojiBtn) {
        pubEmojiBtn.onclick = function(e) {
            e.stopPropagation();
            var target = document.getElementById('publishText');
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

function requestNotificationPermission() {
    if ('Notification' in window) {
        Notification.requestPermission();
    }
}

// ---------- 消息系统 ----------
async function loadContactList() {
    if (!currentUser) return;
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
    var container = document.getElementById('msgChatMessages');
    if (!container) return;
    var supabase = getSupabase();
    var groupId = target.replace('group_', '');
    var { data: groupInfo } = await supabase
        .from('groups')
        .select('created_by, members, name, announcement')
        .eq('id', groupId)
        .maybeSingle();
    if (!groupInfo) {
        container.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:20px;">群聊不存在</div>';
        return;
    }
    var ownerEmail = groupInfo.created_by || '';
    var memberEmails = groupInfo.members || [];
    var memberNames = {};
    if (memberEmails.length > 0) {
        var profResult = await supabase.from('profiles').select('email, nickname, role').in('email', memberEmails);
        (profResult.data || []).forEach(function(p) {
            var name = p.nickname;
            if (p.role === 'teacher') name += ' 🎓';
            memberNames[p.email] = name;
        });
        var nickResult = await supabase.from('group_nicknames').select('user_email, nickname').eq('group_id', groupId);
        (nickResult.data || []).forEach(function(n) { memberNames[n.user_email] = n.nickname; });
    }

    var result = await supabase
        .from('group_messages')
        .select('*')
        .eq('group_id', groupId)
        .eq('is_recalled', false)
        .eq('class_id', currentClassId)
        .order('created_at', { ascending: true });
    if (result.error) { console.error(result.error); return; }
    var data = result.data || [];
    var html = '';
    if (data.length === 0) {
        html = '<div style="text-align:center;color:var(--text-secondary);padding:20px;">暂无群聊消息</div>';
    } else {
        if (groupInfo.announcement) {
            html += '<div style="background:rgba(255,255,255,0.10);padding:8px 12px;border-radius:var(--radius-sm);margin-bottom:10px;font-size:0.85rem;color:var(--text-secondary);border-left:3px solid var(--gold);">📢 ' + groupInfo.announcement + '</div>';
        }
        for (var i = 0; i < data.length; i++) {
            var m = data[i];
            var isMe = m.from_user === currentUser.email;
            var displayName = isMe ? currentUser.nickname : (memberNames[m.from_user] || m.from_user.split('@')[0]);
            var isOwnerMsg = (m.from_user === ownerEmail);
            var badge = isOwnerMsg ? ' <span class="level-badge gold" style="font-size:0.5rem;width:16px;height:16px;line-height:16px;">群主</span>' : '';
            var isAdmin = false;
            if (!isMe && m.from_user !== ownerEmail) {
                var roleResult = await supabase.from('group_roles').select('role').eq('group_id', groupId).eq('user_email', m.from_user).maybeSingle();
                if (roleResult.data && roleResult.data.role === 'admin') isAdmin = true;
            }
            if (isAdmin) badge += ' <span style="font-size:0.5rem;background:var(--success);color:white;padding:1px 6px;border-radius:var(--radius-full);">管</span>';
            var timeStr = new Date(m.created_at).toLocaleString();
            var contentHtml = m.is_recalled ? '<span style="color:var(--text-secondary);font-style:italic;">已撤回</span>' : m.content;
            html += '<div class="msg-item ' + (isMe ? 'me' : '') + '" data-msgid="' + m.id + '">' +
                (!isMe ? '<div class="sender-name">' + displayName + badge + '</div>' : '') +
                '<span class="bubble">' + contentHtml + '</span>' +
                '<div class="time">' + timeStr + '</div>' +
                '</div>';
        }
    }
    container.innerHTML = html;
    setTimeout(function() { container.scrollTop = container.scrollHeight; }, 50);
}

async function loadTreeholeChat() {
    var container = document.getElementById('msgChatMessages');
    if (!container) return;
    var supabase = getSupabase();
    var { data, error } = await supabase.from('treehole_posts').select('*').eq('is_deleted', false).eq('class_id', currentClassId).order('created_at', { ascending: true });
    if (error) { console.error(error); return; }
    var html = '';
    if (!data || data.length === 0) {
        html = '<div style="text-align:center;color:var(--text-secondary);padding:20px;">树洞还空着</div>';
    } else {
        data.forEach(function(p) {
            var isMe = p.user_email === currentUser.email;
            var displayName = isMe ? '我' : '匿名同学';
            if (isOwner && !isMe) displayName += ' (' + p.user_email + ')';
            var timeStr = new Date(p.created_at).toLocaleString();
            html += '<div class="msg-item ' + (isMe ? 'me' : '') + '">' +
                (!isMe ? '<div class="sender-name">' + displayName + ' 🌳</div>' : '') +
                '<span class="bubble">' + p.content + '</span>' +
                '<div class="time">' + timeStr + '</div>' +
                '</div>';
        });
    }
    container.innerHTML = html;
    setTimeout(function() { container.scrollTop = container.scrollHeight; }, 50);
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
        var groupId = currentChatTarget.replace('group_', '');
        var groupInfo = await supabase.from('groups').select('members').eq('id', groupId).single();
        if (groupInfo.data && !groupInfo.data.members.includes(currentUser.email)) {
            toast('你已被移出该群');
            return;
        }
        var { error } = await supabase.from('group_messages').insert({
            group_id: groupId,
            from_user: currentUser.email,
            content: filterSensitiveWords(content),
            class_id: currentClassId,
            created_at: new Date().toISOString()
        });
        if (error) { toast('发送失败：' + error.message); return; }
        document.getElementById('chatInput').value = '';
        await supabase.from('groups').update({ updated_at: new Date().toISOString() }).eq('id', groupId);
        loadGroupChat(currentChatTarget);
        await addExp(currentUser.email, 5, '群聊发言');
        if (content.includes('@所有人') || content.includes('@all')) {
            toast('📢 已@全体成员');
        }
        return;
    }

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

    var channelId = 'typing_' + [currentUser.email, currentChatTarget].sort().join('_');
    supabase.channel(channelId).send({ type: 'broadcast', event: 'typing', payload: { user: currentUser.email, isTyping: true } }).catch(function() {});
    loadContactList();
}

function quoteMessage(msgId, name, content) {
    quotedMessage = { id: msgId, name: name, content: content };
    var status = document.getElementById('chatTargetStatus');
    if (status) {
        status.textContent = '↩️ 回复 ' + name + '：' + content.slice(0, 30) + (content.length > 30 ? '...' : '');
        status.style.color = 'var(--gold)';
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
    reactionPickerTarget = msgId;
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
var aiConversationHistory = [];

async function sendAIMessage(content) {
    if (!content.trim()) return;
    var container = document.getElementById('msgChatMessages');
    if (!container) return;

    var userDiv = document.createElement('div');
    userDiv.className = 'msg-item me';
    userDiv.innerHTML = '<span class="bubble">' + content + '</span><div class="time">' + new Date().toLocaleString() + '</div>';
    container.appendChild(userDiv);
    container.scrollTop = container.scrollHeight;
    document.getElementById('chatInput').value = '';

    if (content.trim().startsWith('/画 ') || content.trim().startsWith('/draw ')) {
        var prompt = content.replace(/^\/画\s*/, '').replace(/^\/draw\s*/, '');
        if (prompt) {
            var thinkDiv = document.createElement('div');
            thinkDiv.className = 'msg-item';
            thinkDiv.id = 'ai-thinking';
            thinkDiv.innerHTML = '<span class="bubble" style="background:rgba(255,255,255,0.2);color:var(--text-secondary);">🎨 生成图片中...</span>';
            container.appendChild(thinkDiv);
            container.scrollTop = container.scrollHeight;
            try {
                var imgUrl = await callImageAPI(prompt);
                var el = document.getElementById('ai-thinking');
                if (el) el.remove();
                var aiDiv = document.createElement('div');
                aiDiv.className = 'msg-item';
                aiDiv.innerHTML = '<span class="bubble" style="background:rgba(255,255,255,0.2);">🎨 ' + (imgUrl ? '<br><img src="' + imgUrl + '" style="max-width:200px;border-radius:var(--radius-sm);margin-top:6px;cursor:pointer;" onclick="openImageViewer(this.src)">' : '生成失败') + '</span><div class="time">' + new Date().toLocaleString() + '</div>';
                container.appendChild(aiDiv);
                container.scrollTop = container.scrollHeight;
            } catch (e) {
                var el = document.getElementById('ai-thinking');
                if (el) el.remove();
                toast('绘画失败');
            }
            return;
        }
    }

    var thinkDiv = document.createElement('div');
    thinkDiv.className = 'msg-item';
    thinkDiv.id = 'ai-thinking';
    thinkDiv.innerHTML = '<span class="bubble" style="background:rgba(255,255,255,0.2);color:var(--text-secondary);">🤖 思考中...</span>';
    container.appendChild(thinkDiv);
    container.scrollTop = container.scrollHeight;

    var settings = loadSettings();
    var deepThink = settings.aiDeepThink || false;
    var searchMode = settings.aiSearch || false;
    var systemPrompt = settings.aiSystemPrompt || '你是DSAI，班级博客的AI助手，友好幽默，回答简洁。';
    var messages = [{ role: 'system', content: systemPrompt }];
    var history = aiConversationHistory.slice(-10);
    for (var i = 0; i < history.length; i++) messages.push(history[i]);
    messages.push({ role: 'user', content: content });

    try {
        var response = await callDeepSeekAPI(messages, deepThink, searchMode);
        aiConversationHistory.push({ role: 'user', content: content });
        aiConversationHistory.push({ role: 'assistant', content: response });
        var el = document.getElementById('ai-thinking');
        if (el) el.remove();
        var aiDiv = document.createElement('div');
        aiDiv.className = 'msg-item';
        var bubble = document.createElement('span');
        bubble.className = 'bubble';
        bubble.style.background = 'rgba(255,255,255,0.2)';
        aiDiv.appendChild(bubble);
        container.appendChild(aiDiv);
        var chars = response.split('');
        var idx = 0;
        var timer = setInterval(function() {
            if (idx < chars.length) {
                bubble.textContent += chars[idx];
                idx++;
                container.scrollTop = container.scrollHeight;
            } else {
                clearInterval(timer);
                var timeDiv = document.createElement('div');
                timeDiv.className = 'time';
                timeDiv.textContent = new Date().toLocaleString();
                aiDiv.appendChild(timeDiv);
                container.scrollTop = container.scrollHeight;
                addExp(currentUser.email, 2, 'AI对话');
            }
        }, 15);
        if (aiConversationHistory.length > 20) aiConversationHistory = aiConversationHistory.slice(-20);
    } catch (e) {
        var el = document.getElementById('ai-thinking');
        if (el) el.remove();
        toast('AI回复失败：' + e.message);
    }
}

async function callDeepSeekAPI(messages, deepThink, search) {
    var settings = loadSettings();
    var apiKey = settings.deepseekKey;
    if (!apiKey) throw new Error('请设置API Key');
    var model = deepThink ? 'deepseek-reasoner' : 'deepseek-chat';
    var url = search ? 'https://api.deepseek.com/v1/chat/completions?search=true' : 'https://api.deepseek.com/v1/chat/completions';
    var resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ model: model, messages: messages, stream: false, max_tokens: 2000, temperature: 0.7 })
    });
    if (!resp.ok) { var err = await resp.json(); throw new Error(err.error?.message || 'API请求失败'); }
    var data = await resp.json();
    return data.choices[0].message.content;
}

async function callImageAPI(prompt) {
    return 'https://picsum.photos/seed/' + encodeURIComponent(prompt) + '/512/512';
}

// ---------- 群聊管理 ----------
async function openCreateGroupModal() {
    var supabase = getSupabase();
    var { data, error } = await supabase.from('profiles').select('email, nickname, avatar, role').neq('email', currentUser.email);
    if (error) { toast('加载成员失败'); return; }
    var container = document.getElementById('memberCheckList');
    if (!container) return;
    var html = '';
    if (!data || data.length === 0) {
        html = '<div style="color:var(--text-secondary);padding:10px;">暂无其他成员</div>';
    } else {
        data.forEach(function(u) {
            var name = u.nickname || u.email.split('@')[0];
            if (u.role === 'teacher') name += ' 🎓';
            var avatar = u.avatar || getDefaultAvatarSVG('👤');
            html += '<label class="member-check-item" style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:var(--radius-sm);cursor:pointer;"><input type="checkbox" value="' + u.email + '" style="width:16px;height:16px;accent-color:var(--gold);"> <img src="' + avatar + '" style="width:24px;height:24px;border-radius:50%;"> ' + name + '</label>';
        });
    }
    container.innerHTML = html;
    document.getElementById('createGroupModal').style.display = 'flex';
}

async function createGroupConfirm() {
    var name = document.getElementById('groupNameInput').value.trim();
    if (!name) { toast('请输入群名称'); return; }
    var checked = document.querySelectorAll('#memberCheckList input[type="checkbox"]:checked');
    var members = [];
    checked.forEach(function(cb) { members.push(cb.value); });
    if (members.length === 0) { toast('请至少选择1位成员'); return; }

    var supabase = getSupabase();
    var { data, error } = await supabase.from('groups').insert({
        name: name,
        created_by: currentUser.email,
        members: [currentUser.email].concat(members),
        class_id: currentClassId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_active: true
    }).select();
    if (error) { toast('创建失败：' + error.message); return; }
    var group = data[0];
    var allMembers = [currentUser.email].concat(members);
    for (var i = 0; i < allMembers.length; i++) {
        await supabase.from('group_member_stats').insert({
            group_id: group.id,
            user_email: allMembers[i],
            exp: 0,
            level: 0,
            last_msg_date: new Date().toISOString().slice(0, 10)
        });
        if (allMembers[i] === currentUser.email) {
            await supabase.from('group_roles').insert({
                group_id: group.id,
                user_email: currentUser.email,
                role: 'owner'
            });
        } else {
            await supabase.from('group_roles').insert({
                group_id: group.id,
                user_email: allMembers[i],
                role: 'member'
            });
        }
    }
    toast('群聊创建成功！');
    document.getElementById('createGroupModal').style.display = 'none';
    document.getElementById('groupNameInput').value = '';
    loadContactList();
}

var currentManageGroupId = null;

async function openGroupManage(target, name) {
    var groupId = target.replace('group_', '');
    currentManageGroupId = groupId;
    document.getElementById('groupManageName').textContent = name || '';
    await loadGroupMemberList(groupId);
    document.getElementById('groupManageModal').style.display = 'flex';
}

async function loadGroupMemberList(groupId) {
    var supabase = getSupabase();
    var { data: group, error } = await supabase.from('groups').select('*').eq('id', groupId).single();
    if (error || !group) { toast('群聊不存在'); return; }

    var isOwner = (group.created_by === currentUser.email);
    var isAdmin = false;
    if (!isOwner) {
        var roleResult = await supabase.from('group_roles').select('role').eq('group_id', groupId).eq('user_email', currentUser.email).maybeSingle();
        if (roleResult.data && roleResult.data.role === 'admin') isAdmin = true;
    }
    var canManage = isOwner || isAdmin;

    var members = group.members || [];
    var memberNames = {};
    if (members.length > 0) {
        var profResult = await supabase.from('profiles').select('email, nickname, role').in('email', members);
        (profResult.data || []).forEach(function(p) {
            var name = p.nickname;
            if (p.role === 'teacher') name += ' 🎓';
            memberNames[p.email] = name;
        });
        var nickResult = await supabase.from('group_nicknames').select('user_email, nickname').eq('group_id', groupId);
        (nickResult.data || []).forEach(function(n) { memberNames[n.user_email] = n.nickname; });
    }

    var roles = {};
    var roleResult = await supabase.from('group_roles').select('user_email, role').eq('group_id', groupId);
    (roleResult.data || []).forEach(function(r) { roles[r.user_email] = r.role; });

    var container = document.getElementById('groupMemberListContainer');
    var html = '<div style="font-weight:600;margin:8px 0;">成员（' + members.length + '人）</div><div class="group-member-list">';
    members.forEach(function(email) {
        var name = memberNames[email] || email.split('@')[0];
        var role = roles[email] || 'member';
        var roleTag = '';
        if (role === 'owner') roleTag = '<span class="admin-tag">群主</span>';
        else if (role === 'admin') roleTag = '<span class="admin-tag" style="background:var(--success);color:white;">管理员</span>';
        var isMe = (email === currentUser.email);
        var removeBtn = '';
        if (canManage && role !== 'owner' && !isMe) {
            removeBtn = '<span class="remove-btn" onclick="kickMember(\'' + groupId + '\',\'' + email + '\')">✕</span>';
        }
        var setAdminBtn = '';
        if (isOwner && role === 'member' && !isMe) {
            setAdminBtn = '<span style="font-size:0.65rem;cursor:pointer;color:var(--gold);margin-left:4px;" onclick="setAdmin(\'' + groupId + '\',\'' + email + '\')">设为管理</span>';
        } else if (isOwner && role === 'admin') {
            setAdminBtn = '<span style="font-size:0.65rem;cursor:pointer;color:var(--danger);margin-left:4px;" onclick="removeAdmin(\'' + groupId + '\',\'' + email + '\')">取消管理</span>';
        }
        var transferBtn = '';
        if (isOwner && !isMe) {
            transferBtn = '<span style="font-size:0.65rem;cursor:pointer;color:var(--warning);margin-left:4px;" onclick="transferOwner(\'' + groupId + '\',\'' + email + '\')">转让</span>';
        }
        var exitBtn = '';
        if (!isOwner && isMe) {
            exitBtn = '<span style="font-size:0.65rem;cursor:pointer;color:var(--danger);margin-left:4px;" onclick="exitGroup(\'' + groupId + '\')">退出</span>';
        }
        html += '<div class="group-member-item">' +
            '<span>' + (isMe ? '⭐ ' : '') + name + roleTag + '</span>' +
            removeBtn + setAdminBtn + transferBtn + exitBtn +
            '</div>';
    });
    html += '</div>';
    if (isOwner) {
        html += '<div style="margin-top:10px;"><button class="btn-danger" onclick="dissolveGroup(\'' + groupId + '\')" style="font-size:0.8rem;">🗑️ 解散群聊</button></div>';
    }
    container.innerHTML = html;
}

async function kickMember(groupId, email) {
    if (!confirm('确定要移除 ' + email + ' 吗？')) return;
    var supabase = getSupabase();
    var { data: group } = await supabase.from('groups').select('members').eq('id', groupId).single();
    if (!group) { toast('群不存在'); return; }
    var newMembers = group.members.filter(function(e) { return e !== email; });
    await supabase.from('groups').update({ members: newMembers }).eq('id', groupId);
    await supabase.from('group_roles').delete().eq('group_id', groupId).eq('user_email', email);
    toast('已移除');
    loadGroupMemberList(groupId);
    loadContactList();
}

async function addGroupMember() {
    if (!currentManageGroupId) return;
    var supabase = getSupabase();
    var { data: group } = await supabase.from('groups').select('members').eq('id', currentManageGroupId).single();
    if (!group) { toast('群不存在'); return; }
    var existingMembers = group.members || [];
    var { data: allUsers } = await supabase.from('profiles').select('email, nickname, avatar, role').not('email', 'in', '(' + existingMembers.map(function(e) { return "'" + e + "'"; }).join(',') + ')');
    var container = document.getElementById('groupAddMemberList');
    var html = '';
    if (!allUsers || allUsers.length === 0) {
        html = '<div style="color:var(--text-secondary);padding:10px;">没有可添加的成员</div>';
    } else {
        allUsers.forEach(function(u) {
            var name = u.nickname || u.email.split('@')[0];
            if (u.role === 'teacher') name += ' 🎓';
            html += '<label class="member-check-item" style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:var(--radius-sm);cursor:pointer;"><input type="checkbox" value="' + u.email + '" style="width:16px;height:16px;accent-color:var(--gold);"> ' + name + '</label>';
        });
    }
    container.innerHTML = html;
    document.getElementById('groupAddMemberModal').style.display = 'flex';
}

async function confirmAddGroupMember() {
    if (!currentManageGroupId) return;
    var checked = document.querySelectorAll('#groupAddMemberList input[type="checkbox"]:checked');
    var newMembers = [];
    checked.forEach(function(cb) { newMembers.push(cb.value); });
    if (newMembers.length === 0) { toast('请选择成员'); return; }
    var supabase = getSupabase();
    var { data: group } = await supabase.from('groups').select('members').eq('id', currentManageGroupId).single();
    var allMembers = (group.members || []).concat(newMembers);
    await supabase.from('groups').update({ members: allMembers }).eq('id', currentManageGroupId);
    for (var i = 0; i < newMembers.length; i++) {
        await supabase.from('group_roles').insert({
            group_id: currentManageGroupId,
            user_email: newMembers[i],
            role: 'member'
        });
        await supabase.from('group_member_stats').insert({
            group_id: currentManageGroupId,
            user_email: newMembers[i],
            exp: 0,
            level: 0,
            last_msg_date: new Date().toISOString().slice(0, 10)
        });
    }
    toast('已添加 ' + newMembers.length + ' 位成员');
    document.getElementById('groupAddMemberModal').style.display = 'none';
    loadGroupMemberList(currentManageGroupId);
    loadContactList();
}

async function setAdmin(groupId, email) {
    var supabase = getSupabase();
    await supabase.from('group_roles').update({ role: 'admin' }).eq('group_id', groupId).eq('user_email', email);
    toast('已设为管理员');
    loadGroupMemberList(groupId);
}

async function removeAdmin(groupId, email) {
    var supabase = getSupabase();
    await supabase.from('group_roles').update({ role: 'member' }).eq('group_id', groupId).eq('user_email', email);
    toast('已取消管理员');
    loadGroupMemberList(groupId);
}

async function transferOwner(groupId, email) {
    if (!confirm('确定将群主转让给 ' + email + ' 吗？')) return;
    var supabase = getSupabase();
    await supabase.from('groups').update({ created_by: email }).eq('id', groupId);
    await supabase.from('group_roles').update({ role: 'member' }).eq('group_id', groupId).eq('user_email', currentUser.email);
    await supabase.from('group_roles').update({ role: 'owner' }).eq('group_id', groupId).eq('user_email', email);
    toast('群主已转让');
    loadGroupMemberList(groupId);
    loadContactList();
}

async function exitGroup(groupId) {
    if (!confirm('确定退出该群聊吗？')) return;
    var supabase = getSupabase();
    var { data: group } = await supabase.from('groups').select('members, created_by').eq('id', groupId).single();
    if (!group) return;
    if (group.created_by === currentUser.email) {
        toast('群主不能退出，请先转让群主');
        return;
    }
    var newMembers = group.members.filter(function(e) { return e !== currentUser.email; });
    await supabase.from('groups').update({ members: newMembers }).eq('id', groupId);
    toast('已退出群聊');
    document.getElementById('groupManageModal').style.display = 'none';
    loadContactList();
}

async function dissolveGroup(groupId) {
    if (!confirm('⚠️ 确定要解散该群聊吗？此操作不可恢复！')) return;
    var supabase = getSupabase();
    await supabase.from('groups').update({ is_active: false }).eq('id', groupId);
    toast('群聊已解散');
    document.getElementById('groupManageModal').style.display = 'none';
    loadContactList();
}

async function editGroupName() {
    var supabase = getSupabase();
    var { data: group } = await supabase.from('groups').select('name').eq('id', currentManageGroupId).single();
    if (!group) return;
    document.getElementById('groupEditNameInput').value = group.name || '';
    document.getElementById('groupEditNameModal').style.display = 'flex';
}

async function confirmEditGroupName() {
    var newName = document.getElementById('groupEditNameInput').value.trim();
    if (!newName) { toast('请输入群名'); return; }
    var supabase = getSupabase();
    await supabase.from('groups').update({ name: newName }).eq('id', currentManageGroupId);
    toast('群名已修改');
    document.getElementById('groupEditNameModal').style.display = 'none';
    loadContactList();
}

async function setGroupAnnounce() {
    var supabase = getSupabase();
    var { data: group } = await supabase.from('groups').select('announcement').eq('id', currentManageGroupId).single();
    if (!group) return;
    document.getElementById('groupAnnounceInput').value = group.announcement || '';
    document.getElementById('groupAnnounceModal').style.display = 'flex';
}

async function confirmGroupAnnounce() {
    var content = document.getElementById('groupAnnounceInput').value.trim();
    var supabase = getSupabase();
    await supabase.from('groups').update({ announcement: content || null }).eq('id', currentManageGroupId);
    toast('公告已发布');
    document.getElementById('groupAnnounceModal').style.display = 'none';
    loadGroupChat('group_' + currentManageGroupId);
}

function bindChatInput() {
    var input = document.getElementById('chatInput');
    var sendBtn = document.getElementById('chatSendBtn');
    var emojiBtn = document.getElementById('chatEmojiBtn');

    if (sendBtn) {
        sendBtn.onclick = function() {
            var content = input ? input.value.trim() : '';
            if (!content) return;
            if (content.includes('@DSAI') || content.includes('@dsai')) {
                sendAIMessage(content);
            } else {
                sendMessage(content);
            }
        };
    }

    if (input) {
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (sendBtn) sendBtn.click();
            }
            if (currentChatTarget && currentChatType === 'user') {
                var supabase = getSupabase();
                var channelId = 'typing_' + [currentUser.email, currentChatTarget].sort().join('_');
                supabase.channel(channelId).send({ type: 'broadcast', event: 'typing', payload: { user: currentUser.email, isTyping: true } }).catch(function() {});
            }
        });
    }

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

function bindGroupManageButtons() {
    document.getElementById('groupManageClose').onclick = function() {
        document.getElementById('groupManageModal').style.display = 'none';
    };
    document.getElementById('groupAddMemberBtn').onclick = addGroupMember;
    document.getElementById('groupAddMemberCancel').onclick = function() {
        document.getElementById('groupAddMemberModal').style.display = 'none';
    };
    document.getElementById('groupAddMemberConfirm').onclick = confirmAddGroupMember;
    document.getElementById('groupEditNameBtn').onclick = editGroupName;
    document.getElementById('groupEditNameCancel').onclick = function() {
        document.getElementById('groupEditNameModal').style.display = 'none';
    };
    document.getElementById('groupEditNameConfirm').onclick = confirmEditGroupName;
    document.getElementById('groupSetAnnounceBtn').onclick = setGroupAnnounce;
    document.getElementById('groupAnnounceCancel').onclick = function() {
        document.getElementById('groupAnnounceModal').style.display = 'none';
    };
    document.getElementById('groupAnnounceConfirm').onclick = confirmGroupAnnounce;
    document.getElementById('groupDissolveBtn').onclick = function() {
        if (currentManageGroupId) dissolveGroup(currentManageGroupId);
    };
}

// ---------- 动态相关函数 ----------
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
        var owner = c.user_email === OWNER_EMAIL ? ' <span class="owner-tag small" style="background:var(--gold);color:#222;padding:1px 8px;border-radius:var(--radius-full);font-size:0.6rem;font-weight:700;">站主</span>' : '';
        return '<div class="comment-item" style="padding:6px 0;font-size:0.9rem;border-bottom:1px solid var(--border-color);"><b>' + c.nickname + owner + '</b>：' + c.content + '</div>';
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
        return '<span style="background:rgba(255,255,255,0.15);padding:4px 12px;border-radius:var(--radius-full);font-size:0.8rem;">' + icon + ' ' + item.name + '</span>';
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
        var borderStyle = equipped ? 'border-color:var(--gold);box-shadow:0 0 16px rgba(212,175,55,0.3);' : 'border-color:var(--border-color);';
        var previewStyle = '';
        if (type === 'frame' && item.css_style) { previewStyle = item.css_style; }
        return '<div style="border:2px solid ' + (equipped ? 'var(--gold)' : 'var(--border-color)') + ';border-radius:var(--radius-sm);padding:12px;text-align:center;cursor:' + (isClickable ? 'pointer' : 'default') + ';transition:var(--transition);background:rgba(255,255,255,0.10);' + borderStyle + '" ' + onClick + '>' +
            '<div style="display:flex;justify-content:center;align-items:center;margin:0 auto 8px;width:72px;height:72px;border-radius:50%;background:rgba(255,255,255,0.10);overflow:hidden;">' +
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

// ---------- 个人中心 ----------
function renderUserCenter() {
    if (!currentUser) return;
    var supabase = getSupabase();
    supabase.from('profiles').select('*').eq('id', currentUser.id).maybeSingle().then(function(result) {
        if (result.data) {
            currentUser.profile = result.data;
            currentUser.nickname = result.data.nickname || currentUser.email.split('@')[0];
            currentUser.avatar = result.data.avatar || '';
            currentUser.sign = result.data.sign || '';
            currentUserRole = result.data.role || 'student';
        }
        var stats = currentUser.stats || { level: 1, exp: 0, total_exp: 0, points: 0, login_streak: 0 };
        var levelInfo = getLevelInfo(stats.exp || 0);

        var ownerTag = (currentUserRole === 'owner') ? ' <span class="owner-tag" style="background:var(--gold);color:#222;padding:2px 12px;border-radius:var(--radius-full);font-size:0.7rem;font-weight:700;">站主</span>' : '';
        var teacherTag = (currentUserRole === 'teacher') ? ' <span class="teacher-tag" style="background:var(--gold);color:#fff;padding:2px 12px;border-radius:var(--radius-full);font-size:0.7rem;font-weight:700;">🎓 教师</span>' : '';
        var roleTagEl = document.getElementById('viewRoleTag');
        if (roleTagEl) {
            if (currentUserRole === 'teacher' || currentUserRole === 'owner') {
                roleTagEl.style.display = 'inline-block';
                roleTagEl.textContent = currentUserRole === 'owner' ? '⭐ 站主' : '🎓 教师';
            } else { roleTagEl.style.display = 'none'; }
        }

        var viewAvatar = document.getElementById('viewAvatar');
        if (viewAvatar) viewAvatar.src = currentUser.avatar || getDefaultAvatarSVG('👤');

        renderUserAvatarFrame();

        var viewNick = document.getElementById('viewNick');
        if (viewNick) viewNick.innerHTML = currentUser.nickname + ownerTag + teacherTag;
        var viewSign = document.getElementById('viewSign');
        if (viewSign) viewSign.innerText = currentUser.sign || '这个人很懒，什么也没有留下~';

        var levelBadge = document.getElementById('viewLevelBadge');
        if (levelBadge) {
            levelBadge.textContent = 'Lv.' + levelInfo.level;
            levelBadge.className = 'level-badge ' + getLevelBadgeClass(levelInfo.level);
        }
        var levelTitle = document.getElementById('viewLevelTitle');
        if (levelTitle) levelTitle.textContent = levelInfo.title;

        var viewExp = document.getElementById('viewExp');
        if (viewExp) viewExp.textContent = stats.exp || 0;
        var viewNextExp = document.getElementById('viewNextExp');
        if (viewNextExp) viewNextExp.textContent = levelInfo.nextExp || 0;
        var viewPoints = document.getElementById('viewPoints');
        if (viewPoints) viewPoints.textContent = stats.points || 0;
        var viewStreak = document.getElementById('viewStreak');
        if (viewStreak) viewStreak.textContent = stats.login_streak || 0;

        var viewEmail = document.getElementById('viewEmail');
        if (viewEmail) viewEmail.innerText = currentUser.email;
        var viewStar = document.getElementById('viewStar');
        if (viewStar) viewStar.innerText = currentUser.profile?.star || '未填写';
        var viewBirth = document.getElementById('viewBirth');
        if (viewBirth) viewBirth.innerText = currentUser.profile?.birth || '未填写';
        var viewHeight = document.getElementById('viewHeight');
        if (viewHeight) viewHeight.innerText = currentUser.profile?.height || '秘密';
        var viewWeight = document.getElementById('viewWeight');
        if (viewWeight) viewWeight.innerText = currentUser.profile?.weight || '秘密';
        var areaPath = currentUser.profile?.areaPath || [];
        var viewArea = document.getElementById('viewArea');
        if (viewArea) viewArea.innerText = areaPath.length ? areaPath.join('-') : '未选择';

        var editNick = document.getElementById('editNick');
        if (editNick) editNick.value = currentUser.nickname;
        var editEmail = document.getElementById('editEmail');
        if (editEmail) editEmail.value = currentUser.email;
        var editSign = document.getElementById('editSign');
        if (editSign) editSign.value = currentUser.sign || '';
        var editStar = document.getElementById('editStar');
        if (editStar) editStar.value = currentUser.profile?.star || '';
        var editBirth = document.getElementById('editBirth');
        if (editBirth) editBirth.value = currentUser.profile?.birth || '';
        var editHeight = document.getElementById('editHeight');
        if (editHeight) editHeight.value = currentUser.profile?.height || '';
        var editWeight = document.getElementById('editWeight');
        if (editWeight) editWeight.value = currentUser.profile?.weight || '';

        selectedAreaPath = areaPath;
        renderAreaSelector();

        computeAchievements(currentUser.email).then(function(ach) {
            var wrap = document.getElementById('achievementList');
            if (!wrap) return;
            if (ach.length === 0) { wrap.innerHTML = '<div style="color:var(--text-secondary);font-size:0.9rem;">暂无成就</div>'; return; }
            wrap.innerHTML = ach.map(function(a) {
                return '<div class="achievement-badge unlocked" style="display:inline-block;font-size:2rem;text-align:center;padding:10px;background:rgba(255,255,255,0.10);border-radius:var(--radius-sm);min-width:70px;margin:4px;border:2px solid var(--gold);box-shadow:0 0 20px rgba(212,175,55,0.08);"><div>' + a.label + '</div><div style="font-size:0.6rem;color:var(--text-secondary);">' + a.desc + '</div></div>';
            }).join('');
        });

        getFollowers(currentUser.email).then(function(fans) { var el = document.getElementById('fansCount'); if (el) el.innerText = fans.length; });
        getFollowings(currentUser.email).then(function(followings) { var el = document.getElementById('followingCount'); if (el) el.innerText = followings.length; });

        var sidebarUsername = document.getElementById('sidebarUsername');
        if (sidebarUsername) sidebarUsername.textContent = currentUser.nickname;
        renderSidebarLevel();
        loadEquippedItems();
        loadMyDynamics();
    });
}

function renderUserAvatarFrame() {
    var wrapper = document.getElementById('userAvatarWrapper');
    var frame = document.getElementById('userAvatarFrame');
    var pendant = document.getElementById('userAvatarPendant');
    if (!wrapper || !frame) return;

    var supabase = getSupabase();
    supabase.from('user_avatar_items').select('*, avatar_items(*)').eq('user_email', currentUser.email).eq('is_equipped', true).then(function(res) {
        var items = res.data || [];
        var frameStyle = '';
        var pendantEmoji = '';
        items.forEach(function(item) {
            if (item.avatar_items && item.avatar_items.type === 'frame') {
                frameStyle = item.avatar_items.css_style || '';
            }
            if (item.avatar_items && item.avatar_items.type === 'pendant') {
                pendantEmoji = item.avatar_items.icon_url || '🎀';
            }
        });
        if (frameStyle) {
            frame.style.cssText = 'border-radius:50%;padding:4px;display:inline-block;' + frameStyle;
        } else {
            frame.style.cssText = 'border-radius:50%;padding:0;display:inline-block;';
        }
        if (pendantEmoji && pendant) {
            pendant.textContent = pendantEmoji;
            pendant.style.display = 'flex';
        } else if (pendant) {
            pendant.style.display = 'none';
        }
    });
}

function renderAllAvatarFrames() {
    document.querySelectorAll('.avatar-wrapper').forEach(function(wrapper) {
        var email = wrapper.dataset.email || '';
        if (!email) return;
        renderAvatarFrameForUser(wrapper, email);
    });
}

function renderAvatarFrameForUser(wrapper, email) {
    if (!wrapper) return;
    var supabase = getSupabase();
    supabase.from('user_avatar_items').select('*, avatar_items(*)').eq('user_email', email).eq('is_equipped', true).then(function(res) {
        var items = res.data || [];
        var frame = wrapper.querySelector('.avatar-frame');
        var pendant = wrapper.querySelector('.avatar-pendant');
        if (!frame) return;
        var frameStyle = '';
        var pendantEmoji = '';
        items.forEach(function(item) {
            if (item.avatar_items && item.avatar_items.type === 'frame') {
                frameStyle = item.avatar_items.css_style || '';
            }
            if (item.avatar_items && item.avatar_items.type === 'pendant') {
                pendantEmoji = item.avatar_items.icon_url || '🎀';
            }
        });
        if (frameStyle) {
            frame.style.cssText = 'border-radius:50%;padding:4px;display:inline-block;' + frameStyle;
        } else {
            frame.style.cssText = 'border-radius:50%;padding:0;display:inline-block;';
        }
        if (pendantEmoji && pendant) {
            pendant.textContent = pendantEmoji;
            pendant.style.display = 'flex';
        } else if (pendant) {
            pendant.style.display = 'none';
        }
    });
}

async function loadMyDynamics() {
    var supabase = getSupabase();
    var { data, error } = await supabase.from('dynamics').select('*').eq('user_email', currentUser.email).eq('class_id', currentClassId).order('created_at', { ascending: false });
    if (error) { console.error(error); return; }
    var wrap = document.getElementById('myDynamicList');
    if (!wrap) return;
    if (!data || data.length === 0) { wrap.innerHTML = '<div style="color:var(--text-secondary);padding:10px;">你还没有发布动态</div>'; return; }
    wrap.innerHTML = data.map(function(item) {
        return '<div class="dynamic-item" style="padding:10px;background:rgba(255,255,255,0.08);border-radius:var(--radius-sm);margin-bottom:8px;">' +
            (item.text ? '<div class="dynamic-text" style="margin:8px 0;white-space:pre-wrap;">' + item.text + '</div>' : '') +
            '<div style="color:var(--text-secondary);font-size:0.85rem;">' + new Date(item.created_at).toLocaleString() + '</div>' +
            '</div>';
    }).join('');
}

async function computeAchievements(email) {
    var supabase = getSupabase();
    var { data: dyns } = await supabase.from('dynamics').select('id', { count: 'exact' }).eq('user_email', email).eq('class_id', currentClassId);
    var dynCount = dyns ? dyns.length : 0;
    var { data: likes } = await supabase.from('likes').select('id', { count: 'exact' }).eq('user_email', email).eq('class_id', currentClassId);
    var likeCount = likes ? likes.length : 0;
    var { data: collects } = await supabase.from('collects').select('id', { count: 'exact' }).eq('user_email', email).eq('class_id', currentClassId);
    var collectCount = collects ? collects.length : 0;
    var ach = [];
    if (dynCount >= 5) ach.push({ label: '📝 初露锋芒', desc: '发布5条动态' });
    if (dynCount >= 20) ach.push({ label: '🔥 动态达人', desc: '发布20条动态' });
    if (likeCount >= 10) ach.push({ label: '👍 小有名气', desc: '获得10个点赞' });
    if (likeCount >= 50) ach.push({ label: '⭐ 班级明星', desc: '获得50个点赞' });
    if (collectCount >= 5) ach.push({ label: '🔖 收藏家', desc: '收藏5条动态' });
    var stats = currentUser.stats || {};
    if (stats.login_streak >= 7) ach.push({ label: '📆 一周之约', desc: '连续登录7天' });
    if (stats.login_streak >= 30) ach.push({ label: '🌙 满月打卡', desc: '连续登录30天' });
    if (stats.level >= 5) ach.push({ label: '🌟 班级达人', desc: '等级达到Lv.5' });
    if (stats.level >= 10) ach.push({ label: '👑 超凡之上', desc: '等级达到Lv.10' });
    return ach;
}

function getFollowers(email) { var supabase = getSupabase(); return supabase.from('follows').select('follower').eq('followee', email).then(function(r) { return r.data || []; }); }
function getFollowings(email) { var supabase = getSupabase(); return supabase.from('follows').select('followee').eq('follower', email).then(function(r) { return r.data || []; }); }

function renderAreaSelector() {
    var box = document.getElementById('areaBox');
    if (!box) return;
    var treeList = AREA_TREE;
    var path = selectedAreaPath.slice();
    var cols = [];
    for (var depth = 0; depth <= path.length; depth++) {
        var html = '<div class="area-col" style="flex:1;border:1px solid var(--border-color);border-radius:var(--radius-sm);max-height:160px;overflow-y:auto;background:rgba(255,255,255,0.08);">';
        treeList.forEach(function(item) { var act = (path[depth] === item.name) ? 'active' : ''; html += '<div class="' + act + '" data-name="' + item.name + '" data-depth="' + depth + '" style="padding:6px 10px;cursor:pointer;transition:var(--transition);' + (act === 'active' ? 'background:var(--primary);color:#fff;' : '') + '">' + item.name + '</div>'; });
        html += '</div>';
        cols.push(html);
        var sel = treeList.find(function(t) { return t.name === path[depth]; });
        if (sel && sel.children) treeList = sel.children;
        else break;
    }
    box.innerHTML = cols.join('');
    box.querySelectorAll('.area-col div').forEach(function(el) {
        el.onclick = function() { var d = Number(this.dataset.depth); selectedAreaPath = selectedAreaPath.slice(0, d); selectedAreaPath.push(this.dataset.name); var input = document.getElementById('editAreaPath'); if (input) input.value = JSON.stringify(selectedAreaPath); renderAreaSelector(); };
    });
}

function bindUserCenter() {
    var openBtn = document.getElementById('openEditProfile');
    if (openBtn) {
        openBtn.onclick = function() {
            document.getElementById('userViewMode').classList.add('hidden');
            document.getElementById('userEditMode').classList.remove('hidden');
            var preview = document.getElementById('editAvatarPreview');
            if (preview) preview.src = currentUser.avatar || getDefaultAvatarSVG('👤');
        };
    }
    var closeBtn = document.getElementById('closeEditProfile');
    if (closeBtn) {
        closeBtn.onclick = function() {
            document.getElementById('userEditMode').classList.add('hidden');
            document.getElementById('userViewMode').classList.remove('hidden');
        };
    }

    var avatarPreview = document.getElementById('editAvatarPreview');
    var avatarFileInput = document.getElementById('editAvatarFile');
    if (avatarPreview && avatarFileInput) {
        avatarPreview.onclick = function() { avatarFileInput.click(); };
        avatarFileInput.onchange = function(e) {
            var file = e.target.files[0];
            if (!file || !file.type.startsWith('image/')) { toast('请选择图片'); this.value = ''; return; }
            var mask = document.getElementById('cropMask');
            var img = document.getElementById('cropImage');
            if (!mask || !img) return;
            var reader = new FileReader();
            reader.onload = function(ev) {
                img.src = ev.target.result;
                mask.style.display = 'flex';
                if (window._cropperInstance) window._cropperInstance.destroy();
                window._cropperInstance = new Cropper(img, { aspectRatio: 1, viewMode: 1, autoCropArea: 1, movable: true, zoomable: true });
            };
            reader.readAsDataURL(file);
            this.value = '';
        };
    }
    var cropConfirm = document.getElementById('cropConfirm');
    if (cropConfirm) {
        cropConfirm.onclick = function() {
            var cropper = window._cropperInstance;
            if (!cropper) return;
            var canvas = cropper.getCroppedCanvas({ width: 200, height: 200 });
            var dataUrl = canvas.toDataURL('image/jpeg', 0.9);
            var preview = document.getElementById('editAvatarPreview');
            if (preview) preview.src = dataUrl;
            window._tempAvatarDataUrl = dataUrl;
            var mask = document.getElementById('cropMask');
            if (mask) mask.style.display = 'none';
            cropper.destroy();
            window._cropperInstance = null;
            toast('头像已裁剪');
        };
    }
    var cropCancel = document.getElementById('cropCancel');
    if (cropCancel) {
        cropCancel.onclick = function() {
            var mask = document.getElementById('cropMask');
            if (mask) mask.style.display = 'none';
            if (window._cropperInstance) { window._cropperInstance.destroy(); window._cropperInstance = null; }
        };
    }

    var shopBtn = document.getElementById('openAvatarShopBtn');
    if (shopBtn) { shopBtn.onclick = function() { openAvatarShop(); }; }

    var saveBtn = document.getElementById('saveUserInfo');
    if (saveBtn) {
        saveBtn.onclick = async function() {
            var btn = this;
            btn.disabled = true;
            var nick = document.getElementById('editNick').value.trim();
            var sign = document.getElementById('editSign').value.trim();
            var star = document.getElementById('editStar').value;
            var birth = document.getElementById('editBirth').value;
            var height = document.getElementById('editHeight').value.trim();
            var weight = document.getElementById('editWeight').value.trim();
            var areaPath = JSON.parse(document.getElementById('editAreaPath').value || '[]');
            var newEmail = document.getElementById('editEmail').value.trim();
            var newPwd = document.getElementById('editPwd').value.trim();
            if (nick.length > 15) { toast('昵称超过15位'); btn.disabled = false; return; }
            if (sign.length > 30) { toast('标签超过30字'); btn.disabled = false; return; }
            var supabase = getSupabase();
            var updates = { nickname: nick, sign: sign, star: star, birth: birth, height: height || '秘密', weight: weight || '秘密', areaPath: areaPath };

            function doUpdate(avatarUrl) {
                if (avatarUrl) updates.avatar = avatarUrl;
                supabase.from('profiles').update(updates).eq('id', currentUser.id).then(function(res) {
                    if (res.error) { toast('保存失败：' + res.error.message); btn.disabled = false; return; }
                    if (updates.email) currentUser.email = updates.email;
                    currentUser.nickname = nick;
                    currentUser.sign = sign;
                    if (avatarUrl) currentUser.avatar = avatarUrl;
                    currentUser.profile = Object.assign(currentUser.profile || {}, updates);
                    if (newPwd) { supabase.auth.updateUser({ password: newPwd }).then(function() { toast('密码已更新'); }).catch(function(err) { toast('密码更新失败：' + err.message); }); }
                    toast('资料保存成功！');
                    document.getElementById('userEditMode').classList.add('hidden');
                    document.getElementById('userViewMode').classList.remove('hidden');
                    renderUserCenter();
                    var sidebarUsername = document.getElementById('sidebarUsername');
                    if (sidebarUsername) sidebarUsername.textContent = nick;
                    btn.disabled = false;
                });
            }

            if (window._tempAvatarDataUrl) {
                var blob = dataURLToBlob(window._tempAvatarDataUrl);
                var path = 'avatars/' + currentUser.id + '_' + Date.now() + '.jpg';
                var { data: uploadData, error: uploadError } = await supabase.storage.from('files').upload(path, blob, { contentType: 'image/jpeg' });
                if (uploadError) { toast('头像上传失败：' + uploadError.message); btn.disabled = false; return; }
                var { data: urlData } = supabase.storage.from('files').getPublicUrl(path);
                var publicUrl = urlData.publicUrl;
                window._tempAvatarDataUrl = null;
                doUpdate(publicUrl);
            } else {
                doUpdate(null);
            }
        };
    }
}

function loadMyLikes() {}
function loadMyCollects() {}

// ---------- 管理后台 ----------
async function loadAdmin(tab) {
    if (!isOwner && currentUserRole !== 'owner') { toast('权限不足'); return; }
    document.querySelectorAll('.admin-tab').forEach(function(t) { t.classList.remove('active'); });
    var tabEl = document.querySelector('.admin-tab[data-tab="' + tab + '"]');
    if (tabEl) tabEl.classList.add('active');
    var wrap = document.getElementById('adminContent');
    if (!wrap) return;
    var supabase = getSupabase();

    if (tab === 'dashboard') {
        Promise.all([
            supabase.from('profiles').select('id', { count: 'exact' }),
            supabase.from('dynamics').select('id', { count: 'exact' }).eq('class_id', currentClassId),
            supabase.from('messages').select('id', { count: 'exact' }).eq('class_id', currentClassId).gte('created_at', new Date(Date.now() - 86400000 * 7).toISOString()),
            supabase.from('class_members').select('user_email').eq('class_id', currentClassId),
            supabase.from('user_stats').select('level')
        ]).then(function(res) {
            var userCount = res[0].count || 0;
            var dynCount = res[1].count || 0;
            var msgCount = res[2].count || 0;
            var classMembers = res[3].data || [];
            var memberCount = classMembers.length || 0;
            var stats = res[4].data || [];
            var avgLevel = 0;
            if (stats.length > 0) {
                var sum = stats.reduce(function(a, b) { return a + (b.level || 1); }, 0);
                avgLevel = Math.round(sum / stats.length * 10) / 10;
            }
            var html = '<div class="admin-stats">' +
                '<div class="admin-stat-card"><div class="num">' + memberCount + '</div><div class="label">班级成员</div></div>' +
                '<div class="admin-stat-card"><div class="num">' + dynCount + '</div><div class="label">总动态</div></div>' +
                '<div class="admin-stat-card"><div class="num">' + msgCount + '</div><div class="label">近7天消息</div></div>' +
                '<div class="admin-stat-card"><div class="num">' + avgLevel + '</div><div class="label">平均等级</div></div>' +
                '</div>' +
                '<div style="margin-top:12px;"><canvas id="adminChart" height="200"></canvas></div>';
            wrap.innerHTML = html;
            setTimeout(function() {
                var canvas = document.getElementById('adminChart');
                if (canvas && window.Chart) {
                    new Chart(canvas, {
                        type: 'bar',
                        data: {
                            labels: ['Lv.1-2', 'Lv.3-4', 'Lv.5-6', 'Lv.7-8', 'Lv.9-10'],
                            datasets: [{
                                label: '用户分布',
                                data: [
                                    stats.filter(function(s) { return (s.level || 1) <= 2; }).length,
                                    stats.filter(function(s) { return (s.level || 1) >= 3 && (s.level || 1) <= 4; }).length,
                                    stats.filter(function(s) { return (s.level || 1) >= 5 && (s.level || 1) <= 6; }).length,
                                    stats.filter(function(s) { return (s.level || 1) >= 7 && (s.level || 1) <= 8; }).length,
                                    stats.filter(function(s) { return (s.level || 1) >= 9; }).length
                                ],
                                backgroundColor: ['#b0a098', '#8B6B4A', '#b8860b', '#cd853f', '#d4af37']
                            }]
                        },
                        options: { responsive: true, maintainAspectRatio: true }
                    });
                }
            }, 100);
        });
        return;
    }

    if (tab === 'users') {
        var { data: members, error: memError } = await supabase
            .from('class_members')
            .select('user_email, role')
            .eq('class_id', currentClassId);
        if (memError) { console.error(memError); return; }
        if (!members || members.length === 0) {
            wrap.innerHTML = '<div style="color:var(--text-secondary);padding:20px;">暂无成员</div>';
            return;
        }
        var emails = members.map(function(m) { return m.user_email; });
        var { data: profiles, error: profError } = await supabase
            .from('profiles')
            .select('email, nickname, role')
            .in('email', emails);
        if (profError) { console.error(profError); return; }
        var userMap = {};
        profiles.forEach(function(p) { userMap[p.email] = p; });
        var html = '<table class="admin-table"><tr><th>昵称</th><th>邮箱</th><th>角色</th><th>操作</th></tr>';
        members.forEach(function(m) {
            var u = userMap[m.email];
            if (!u) return;
            var roleDisplay = m.role || 'member';
            if (roleDisplay === 'owner') roleDisplay = '⭐ 站主';
            else if (roleDisplay === 'teacher') roleDisplay = '🎓 教师';
            else roleDisplay = '👤 学生';
            html += '<tr><td>' + u.nickname + '</td><td>' + u.email + '</td><td>' + roleDisplay + '</td><td>' +
                (isOwner ? '<button class="btn-sm set-teacher" data-email="' + u.email + '" style="padding:4px 12px;background:var(--gold);color:#fff;border-radius:var(--radius-full);font-size:0.8rem;">设为教师</button>' : '') +
                (isOwner && u.role === 'teacher' ? ' <button class="btn-sm remove-teacher" data-email="' + u.email + '" style="padding:4px 12px;background:var(--warning);color:#fff;border-radius:var(--radius-full);font-size:0.8rem;">取消教师</button>' : '') +
                '</td></tr>';
        });
        html += '</table>';
        wrap.innerHTML = html;
        if (isOwner) {
            document.querySelectorAll('.set-teacher').forEach(function(b) { b.onclick = function() { var email = this.dataset.email; supabase.from('profiles').update({ role: 'teacher' }).eq('email', email).then(function() { toast('已设为教师'); giveTeacherFrame(email); loadAdmin('users'); }); }; });
            document.querySelectorAll('.remove-teacher').forEach(function(b) { b.onclick = function() { var email = this.dataset.email; supabase.from('profiles').update({ role: 'student' }).eq('email', email).then(function() { toast('已取消教师'); loadAdmin('users'); }); }; });
        }
        return;
    }

    if (tab === 'dynamics') {
        supabase.from('dynamics').select('*').eq('class_id', currentClassId).order('created_at', { ascending: false }).then(function(res) {
            var html = '<table class="admin-table"><tr><th>内容</th><th>作者</th><th>操作</th></tr>';
            if (res.data) {
                res.data.forEach(function(d) {
                    html += '<tr><td>' + (d.text || '').slice(0, 30) + '...</td><td>' + d.nickname + '</td><td><button class="btn-sm del-dyn-admin" data-id="' + d.id + '" style="padding:4px 12px;background:var(--danger);color:#fff;border-radius:var(--radius-full);font-size:0.8rem;">删除</button></td></tr>';
                });
            }
            html += '</table>';
            wrap.innerHTML = html;
            document.querySelectorAll('.del-dyn-admin').forEach(function(b) { b.onclick = function() { var id = this.dataset.id; supabase.from('dynamics').delete().eq('id', id).eq('class_id', currentClassId).then(function() { toast('已删除'); loadAdmin('dynamics'); }); }; });
        });
        return;
    }

    if (tab === 'comments') {
        supabase.from('comments').select('*').eq('class_id', currentClassId).order('created_at', { ascending: false }).then(function(res) {
            var html = '<table class="admin-table"><tr><th>评论</th><th>用户</th><th>操作</th></tr>';
            if (res.data) {
                res.data.forEach(function(c) {
                    html += '<tr><td>' + c.content + '</td><td>' + c.nickname + '</td><td><button class="btn-sm del-comment-admin" data-id="' + c.id + '" style="padding:4px 12px;background:var(--danger);color:#fff;border-radius:var(--radius-full);font-size:0.8rem;">删除</button></td></tr>';
                });
            }
            html += '</table>';
            wrap.innerHTML = html;
            document.querySelectorAll('.del-comment-admin').forEach(function(b) { b.onclick = function() { var id = this.dataset.id; supabase.from('comments').delete().eq('id', id).eq('class_id', currentClassId).then(function() { toast('已删除'); loadAdmin('comments'); }); }; });
        });
        return;
    }

    if (tab === 'bans') {
        supabase.from('banned_users').select('*').then(function(res) {
            var html = '<table class="admin-table"><tr><th>用户</th><th>原因</th><th>解封时间</th><th>操作</th></tr>';
            if (res.data) {
                res.data.forEach(function(b) {
                    html += '<tr><td>' + b.user_email + '</td><td>' + (b.reason || '') + '</td><td>' + (b.banned_until ? new Date(b.banned_until).toLocaleString() : '永久') + '</td><td><button class="btn-sm unban-admin" data-email="' + b.user_email + '" style="padding:4px 12px;background:var(--success);color:#fff;border-radius:var(--radius-full);font-size:0.8rem;">解禁</button></td></tr>';
                });
            }
            html += '</table>';
            wrap.innerHTML = html;
            document.querySelectorAll('.unban-admin').forEach(function(b) { b.onclick = function() { var email = this.dataset.email; supabase.from('banned_users').delete().eq('user_email', email).then(function() { toast('已解禁'); loadAdmin('bans'); }); }; });
        });
        return;
    }

    if (tab === 'levels') {
        supabase.from('user_stats').select('user_email, level, exp, points').order('level', { ascending: false }).limit(20).then(function(res) {
            var html = '<h4 style="color:var(--text-primary);">等级排行 Top 20</h4><table class="admin-table"><tr><th>排名</th><th>用户</th><th>等级</th><th>经验</th><th>积分</th></tr>';
            if (res.data) {
                res.data.forEach(function(s, idx) {
                    html += '<tr><td>' + (idx + 1) + '</td><td>' + s.user_email + '</td><td><span class="level-badge ' + getLevelBadgeClass(s.level || 1) + '" style="width:24px;height:24px;font-size:0.6rem;">Lv.' + (s.level || 1) + '</span></td><td>' + (s.exp || 0) + '</td><td>' + (s.points || 0) + '</td></tr>';
                });
            }
            html += '</table>';
            wrap.innerHTML = html;
        });
        return;
    }

    if (tab === 'teachers') {
        supabase.from('class_members').select('*, profiles(*)').eq('class_id', currentClassId).then(function(res) {
            var teachers = (res.data || []).filter(function(cm) { return cm.profiles && (cm.profiles.role === 'teacher' || cm.profiles.role === 'owner'); });
            var html = '<h4 style="color:var(--text-primary);">教师列表</h4><table class="admin-table"><tr><th>昵称</th><th>邮箱</th><th>操作</th></tr>';
            if (teachers.length > 0) {
                teachers.forEach(function(cm) {
                    var u = cm.profiles;
                    html += '<tr><td>' + u.nickname + (u.role === 'owner' ? ' ⭐' : ' 🎓') + '</td><td>' + u.email + '</td><td>' + (isOwner && u.role !== 'owner' ? '<button class="btn-sm remove-teacher" data-email="' + u.email + '" style="padding:4px 12px;background:var(--warning);color:#fff;border-radius:var(--radius-full);font-size:0.8rem;">取消教师</button>' : '') + '</td></tr>';
                });
            } else {
                html += '<tr><td colspan="3" style="text-align:center;color:var(--text-secondary);">暂无教师</td></tr>';
            }
            html += '</table>';
            wrap.innerHTML = html;
            if (isOwner) {
                document.querySelectorAll('.remove-teacher').forEach(function(b) { b.onclick = function() { var email = this.dataset.email; supabase.from('profiles').update({ role: 'student' }).eq('email', email).then(function() { toast('已取消教师'); loadAdmin('teachers'); }); }; });
            }
        });
        return;
    }
}

// ---------- 通知、投票、文档、日历、相册 ----------
async function loadNotice() {
    var supabase = getSupabase();
    var { data, error } = await supabase.from('assignments').select('*').eq('class_id', currentClassId).order('created_at', { ascending: false });
    if (error) { console.error(error); return; }
    var wrap = document.getElementById('noticeList');
    if (!wrap) return;
    if (!data || data.length === 0) { wrap.innerHTML = '<div style="color:var(--text-secondary);padding:20px;">暂无通知</div>'; return; }
    var html = '';
    data.forEach(function(n) {
        var deadline = n.deadline ? new Date(n.deadline).toLocaleString() : '无截止';
        html += '<div class="dynamic-item" style="background:rgba(255,255,255,0.10);border-radius:var(--radius-sm);padding:14px;margin-bottom:12px;"><div class="user-head" style="display:flex;gap:12px;align-items:center;margin-bottom:8px;"><div><div class="nickname" style="font-weight:600;">📢 ' + n.title + '</div><div class="sign" style="font-size:0.85rem;color:var(--text-secondary);">发布者：' + n.created_by + ' | 截止：' + deadline + '</div></div></div><div class="dynamic-text" style="margin:8px 0;white-space:pre-wrap;">' + (n.description || '') + '</div></div>';
    });
    wrap.innerHTML = html;
}

async function loadPolls() {
    var supabase = getSupabase();
    var { data, error } = await supabase.from('polls').select('*').eq('class_id', currentClassId).order('created_at', { ascending: false });
    if (error) { console.error(error); return; }
    var wrap = document.getElementById('pollList');
    if (!wrap) return;
    if (!data || data.length === 0) { wrap.innerHTML = '<div style="color:var(--text-secondary);padding:12px;">暂无投票</div>'; return; }
    var html = '';
    for (var i = 0; i < data.length; i++) {
        var p = data[i];
        var options = p.options || [];
        var { data: votes } = await supabase.from('poll_votes').select('*').eq('poll_id', p.id);
        var total = votes ? votes.length : 0;
        var myVote = votes ? votes.find(function(v) { return v.user_email === currentUser.email; }) : null;
        html += '<div class="dynamic-item" style="background:rgba(255,255,255,0.10);border-radius:var(--radius-sm);padding:14px;margin-bottom:12px;"><div class="user-head" style="display:flex;gap:12px;align-items:center;margin-bottom:8px;"><div><div class="nickname" style="font-weight:600;">📊 ' + p.question + (p.anonymous ? ' (匿名)' : '') + '</div><div class="sign" style="font-size:0.85rem;color:var(--text-secondary);">发起人：' + p.created_by + ' | 参与：' + total + '人</div></div></div>';
        options.forEach(function(opt, idx) {
            var count = votes ? votes.filter(function(v) { return v.option_index === idx; }).length : 0;
            var percent = total > 0 ? Math.round((count / total) * 100) : 0;
            var selected = (myVote && myVote.option_index === idx) ? ' style="font-weight:bold;color:var(--gold);"' : '';
            html += '<div class="vote-option" style="display:flex;align-items:center;gap:12px;padding:8px 12px;margin:4px 0;background:rgba(255,255,255,0.05);border-radius:var(--radius-sm);"' + selected + '>' +
                '<span style="min-width:50px;">' + opt + '</span>' +
                '<div style="flex:1;background:var(--border-color);border-radius:3px;height:6px;"><div class="vote-bar" style="height:6px;background:var(--gold);border-radius:3px;width:' + percent + '%;transition:width 0.6s ease;"></div></div>' +
                '<span>' + count + '票 (' + percent + '%)</span>' +
                (!myVote ? ' <button class="btn-sm" onclick="votePoll(\'' + p.id + '\',' + idx + ')" style="padding:4px 12px;background:var(--primary);color:#fff;border-radius:var(--radius-full);font-size:0.8rem;">投票</button>' : '') +
                '</div>';
        });
        html += '</div>';
    }
    wrap.innerHTML = html;
}

async function votePoll(pollId, optionIndex) {
    var supabase = getSupabase();
    var { error } = await supabase.from('poll_votes').insert({ poll_id: pollId, user_email: currentUser.email, option_index: optionIndex });
    if (error) { toast('投票失败：' + error.message); return; }
    toast('投票成功！');
    loadPolls();
}

async function loadDoc() {
    var supabase = getSupabase();
    var { data, error } = await supabase.from('documents').select('*').order('updated_at', { ascending: false }).limit(1);
    if (error) { console.error(error); return; }
    var titleInput = document.getElementById('docTitleInput');
    var contentInput = document.getElementById('docContentInput');
    if (!titleInput || !contentInput) return;
    if (data && data.length > 0) {
        titleInput.value = data[0].title || '班级文档';
        contentInput.value = data[0].content || '';
        renderDocPreview(data[0].content || '');
        window._docId = data[0].id;
    } else {
        titleInput.value = '班级文档';
        contentInput.value = '# 班级文档\n欢迎使用在线文档';
        renderDocPreview('# 班级文档\n欢迎使用在线文档');
        window._docId = null;
    }
}

function renderDocPreview(md) {
    var preview = document.getElementById('docPreview');
    if (!preview) return;
    try { preview.innerHTML = marked.parse(md); } catch (e) { preview.innerText = md; }
}

async function loadCalendar() {
    var supabase = getSupabase();
    var { data, error } = await supabase.from('calendar_events').select('*').eq('class_id', currentClassId).order('event_date', { ascending: true });
    if (error) { console.error(error); return; }
    var wrap = document.getElementById('calendarList');
    if (!wrap) return;
    if (!data || data.length === 0) { wrap.innerHTML = '<div style="color:var(--text-secondary);padding:12px;">暂无事件</div>'; return; }
    var html = '';
    data.forEach(function(e) {
        html += '<div class="dynamic-item" style="background:rgba(255,255,255,0.10);border-radius:var(--radius-sm);padding:14px;margin-bottom:12px;"><div class="user-head" style="display:flex;gap:12px;align-items:center;margin-bottom:8px;"><div><div class="nickname" style="font-weight:600;">📅 ' + e.title + ' <span style="font-size:0.8rem;background:rgba(255,255,255,0.08);padding:2px 10px;border-radius:var(--radius-full);">' + e.event_type + '</span></div><div class="sign" style="font-size:0.85rem;color:var(--text-secondary);">' + e.event_date + ' | 发布者：' + (e.created_by || '系统') + '</div></div></div><div class="dynamic-text" style="margin:8px 0;white-space:pre-wrap;">' + (e.description || '') + '</div></div>';
    });
    wrap.innerHTML = html;
}

async function loadAlbum() {
    var supabase = getSupabase();
    var { data, error } = await supabase.from('dynamics').select('media, created_at').eq('class_id', currentClassId).order('created_at', { ascending: false });
    if (error) { console.error(error); return; }
    var wrap = document.getElementById('albumGrid');
    if (!wrap) return;
    var images = [];
    data.forEach(function(d) {
        if (d.media) {
            try {
                var arr = JSON.parse(d.media);
                arr.forEach(function(url) {
                    if (!url.includes('video')) images.push({ url: url, time: d.created_at });
                });
            } catch (e) {}
        }
    });
    if (images.length === 0) { wrap.innerHTML = '<div style="color:var(--text-secondary);text-align:center;padding:20px;">暂无图片</div>'; return; }
    wrap.innerHTML = images.slice(0, 30).map(function(img) {
        return '<div style="border-radius:var(--radius-sm);overflow:hidden;cursor:pointer;aspect-ratio:1;background:rgba(255,255,255,0.05);" onclick="openImageViewer(\'' + img.url + '\')"><img src="' + img.url + '" loading="lazy" style="width:100%;height:100%;object-fit:cover;"></div>';
    }).join('');
}

function openImageViewer(src) {
    var modal = document.getElementById('imageViewer');
    var img = document.getElementById('imageViewerSrc');
    if (!modal || !img) return;
    img.src = src;
    modal.style.display = 'flex';
    img.onclick = function() { modal.style.display = 'none'; };
    document.getElementById('imageViewerClose').onclick = function() { modal.style.display = 'none'; };
    modal.onclick = function(e) { if (e.target === modal) modal.style.display = 'none'; };
}

// ---------- 搜索 ----------
function bindSearch() {
    var searchBtn = document.getElementById('searchBtn');
    if (!searchBtn) return;
    searchBtn.onclick = function() {
        var keyword = document.getElementById('searchInput').value.trim().toLowerCase();
        var resultWrap = document.getElementById('searchResult');
        if (!keyword || !resultWrap) { if (resultWrap) resultWrap.innerHTML = ''; return; }
        var supabase = getSupabase();
        var html = '<h4 style="color:var(--text-primary);margin:12px 0 8px;">👤 用户</h4>';
        supabase.from('profiles').select('*').ilike('nickname', '%' + keyword + '%').then(function(userRes) {
            var users = userRes.data || [];
            if (users.length === 0) html += '<p style="color:var(--text-secondary);">无</p>';
            else {
                html += users.map(function(u) {
                    var avatar = u.avatar || getDefaultAvatarSVG('👤');
                    var roleTag = '';
                    if (u.role === 'teacher') roleTag = ' 🎓';
                    else if (u.role === 'owner') roleTag = ' ⭐';
                    return '<div class="dynamic-item" style="padding:10px;font-size:0.9rem;background:rgba(255,255,255,0.10);border-radius:var(--radius-sm);margin-bottom:8px;"><div class="user-head"><img class="avatar" src="' + avatar + '"><div><div class="nickname">' + u.nickname + roleTag + '</div><div class="sign">' + (u.sign || '') + '</div></div></div></div>';
                }).join('');
            }
            html += '<h4 style="color:var(--text-primary);margin:12px 0 8px;">📝 动态（含标签）</h4>';
            supabase.from('dynamics').select('*').eq('class_id', currentClassId).ilike('text', '%' + keyword + '%').or('tags.cs.{' + keyword + '}').order('created_at', { ascending: false }).limit(20).then(function(dynRes) {
                var dyns = dynRes.data || [];
                if (dyns.length === 0) html += '<p style="color:var(--text-secondary);">无</p>';
                else {
                    html += dyns.map(function(d) {
                        return '<div class="dynamic-item" style="padding:10px;font-size:0.9rem;background:rgba(255,255,255,0.10);border-radius:var(--radius-sm);margin-bottom:8px;"><b>' + d.nickname + '</b>：' + (d.text || '').slice(0, 50) + '<div style="color:var(--text-secondary);font-size:0.75rem;">' + new Date(d.created_at).toLocaleString() + '</div></div>';
                    }).join('');
                }
                html += '<h4 style="color:var(--text-primary);margin:12px 0 8px;">💬 聊天记录</h4>';
                supabase.from('messages').select('*').eq('class_id', currentClassId).or('from_user.eq.' + currentUser.email + ',to_user.eq.' + currentUser.email).ilike('content', '%' + keyword + '%').order('created_at', { ascending: false }).limit(20).then(function(msgRes) {
                    var msgs = msgRes.data || [];
                    if (msgs.length === 0) html += '<p style="color:var(--text-secondary);">无</p>';
                    else {
                        html += msgs.map(function(m) {
                            var isMe = m.from_user === currentUser.email;
                            var name = isMe ? '我' : (m.from_user.split('@')[0]);
                            return '<div class="dynamic-item" style="padding:10px;font-size:0.9rem;background:rgba(255,255,255,0.10);border-radius:var(--radius-sm);margin-bottom:8px;"><b>' + name + '</b>：' + m.content + '<div style="color:var(--text-secondary);font-size:0.75rem;">' + new Date(m.created_at).toLocaleString() + '</div></div>';
                        }).join('');
                    }
                    html += '<h4 style="color:var(--text-primary);margin:12px 0 8px;">💬 评论</h4>';
                    supabase.from('comments').select('*').eq('class_id', currentClassId).ilike('content', '%' + keyword + '%').order('created_at', { ascending: false }).limit(20).then(function(commentRes) {
                        var comments = commentRes.data || [];
                        if (comments.length === 0) html += '<p style="color:var(--text-secondary);">无</p>';
                        else {
                            html += comments.map(function(c) {
                                return '<div class="dynamic-item" style="padding:10px;font-size:0.9rem;background:rgba(255,255,255,0.10);border-radius:var(--radius-sm);margin-bottom:8px;"><b>' + c.nickname + '</b>：' + c.content + '<div style="color:var(--text-secondary);font-size:0.75rem;">' + new Date(c.created_at).toLocaleString() + '</div></div>';
                            }).join('');
                        }
                        resultWrap.innerHTML = html;
                    });
                });
            });
        });
    };
}

function bindTeacherMessage() {
    var btn = document.getElementById('sendTeacherMessageBtn');
    if (btn) {
        btn.onclick = function() {
            var content = document.getElementById('teacherMessageInput').value.trim();
            sendTeacherMessage(content);
        };
    }
}

// ---------- 初始化 ----------
window.onload = async function() {
    initGlobalEmojiPanel();

    var el;
    el = document.getElementById('toReg');
    if (el) el.onclick = function() { document.getElementById('loginBox').classList.add('hidden'); document.getElementById('regBox').classList.remove('hidden'); };
    el = document.getElementById('toLogin');
    if (el) el.onclick = function() { document.getElementById('regBox').classList.add('hidden'); document.getElementById('loginBox').classList.remove('hidden'); };
    el = document.getElementById('toFindPwd');
    if (el) el.onclick = function() { document.getElementById('loginBox').classList.add('hidden'); document.getElementById('findPwdBox').classList.remove('hidden'); };
    el = document.getElementById('backLogin');
    if (el) el.onclick = function() { document.getElementById('findPwdBox').classList.add('hidden'); document.getElementById('loginBox').classList.remove('hidden'); };

    el = document.getElementById('loginBtn');
    if (el) {
        el.onclick = function() {
            var email = document.getElementById('loginEmail').value.trim();
            var pwd = document.getElementById('loginPwd').value.trim();
            if (!email || !pwd) { toast('请填写邮箱和密码'); return; }
            signIn(email, pwd);
        };
    }

    el = document.getElementById('regBtn');
    if (el) {
        el.onclick = function() {
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
    }

    el = document.getElementById('findBtn');
    if (el) el.onclick = function() { toast('请使用Supabase的忘记密码功能'); };

    bindSettings();

    el = document.getElementById('pageRefreshBtn');
    if (el) {
        el.onclick = function() {
            toast('刷新');
            renderUserCenter();
            loadDynamics(true);
            loadNotice();
            loadPolls();
            loadDoc();
            loadCalendar();
            loadAlbum();
            loadContactList();
            updateMsgBadge();
            renderSidebarLevel();
            loadTeacherMessages();
            loadCapsules();
            loadTimeline();
            loadDestinations();
            renderClassList();
            loadChangelog();
        };
    }

    el = document.getElementById('hamburgerBtn');
    if (el) {
        el.onclick = function() {
            var sidebar = document.getElementById('sidebar');
            if (sidebar && sidebar.classList.contains('open')) closeSidebar();
            else openSidebar();
        };
    }

    el = document.getElementById('sidebarOverlay');
    if (el) el.onclick = closeSidebar;

    bindBottomNav();

    document.querySelectorAll('.admin-tab').forEach(function(tab) {
        tab.onclick = function() { loadAdmin(this.dataset.tab); };
    });

    var docInput = document.getElementById('docContentInput');
    if (docInput) {
        docInput.addEventListener('input', function() { renderDocPreview(this.value); });
    }

    document.querySelectorAll('.func-tab').forEach(function(tab) {
        tab.onclick = function() {
            document.querySelectorAll('.func-tab').forEach(function(t) { t.classList.remove('active'); });
            this.classList.add('active');
            document.querySelectorAll('.func-content').forEach(function(c) { c.classList.remove('active'); });
            var target = document.getElementById('func-' + this.dataset.func);
            if (target) target.classList.add('active');
            if (this.dataset.func === 'album') loadAlbum();
        };
    });

    var success = await autoLogin();
    if (!success) {
        var remembered = JSON.parse(localStorage.getItem('remember_pwd') || '{}');
        if (remembered.email) {
            var loginEmail = document.getElementById('loginEmail');
            var loginPwd = document.getElementById('loginPwd');
            var rememberCheck = document.getElementById('rememberPwdCheck');
            if (loginEmail) loginEmail.value = remembered.email;
            if (loginPwd) loginPwd.value = remembered.password || '';
            if (rememberCheck) rememberCheck.checked = true;
        }
        applySettings();
        var authWrap = document.getElementById('authWrap');
        if (authWrap) authWrap.style.display = 'flex';
    }

    setTimeout(function() { requestNotificationPermission(); }, 5000);

    console.log('✅ 班级时光机 v3.1.0 已加载完毕！');
};