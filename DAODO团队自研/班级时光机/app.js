// ================================================================
//  app.js - 班级时光机 v3.2 完整修复版
//  修复：粒子/光晕/滚动条/班级标题/表格/QQ气泡/点赞动画/多图上传/进度条
//  第一段：工具函数 → 动态发布
// ================================================================

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
var selectedFiles = []; // 多图存储

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
        goHome();
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
                goHome();
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
    updatePageTitle();
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

// ---------- 创建/加入/搜索班级 ----------
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

// ---------- 页面标题动态化（修复⑩） ----------
function updatePageTitle() {
    var titleEl = document.getElementById('pageTitle');
    if (!titleEl) return;
    if (!currentUser) {
        document.title = '班级时光机 · 登录';
        titleEl.textContent = '班级时光机';
        return;
    }
    // 如果在主主页或没有班级
    if (!currentClassId || userClasses.length === 0) {
        document.title = '班级时光机 · 主页';
        titleEl.textContent = '班级时光机';
        return;
    }
    var className = '';
    for (var i = 0; i < userClasses.length; i++) {
        if (userClasses[i].class_id === currentClassId && userClasses[i].classes) {
            className = userClasses[i].classes.name;
            break;
        }
    }
    if (className) {
        document.title = className + ' · 班级时光机';
        titleEl.textContent = className + ' · 博客';
    } else {
        document.title = '班级时光机 · 博客';
        titleEl.textContent = '班级时光机';
    }
}

// ---------- 视图切换核心 ----------
function enterMain() {
    document.getElementById('authWrap').style.display = 'none';
    var mainWrap = document.getElementById('mainWrap');
    mainWrap.style.display = 'flex';
    mainWrap.classList.add('active');

    document.getElementById('navUserBtn').addEventListener('click', function() {
        switchTab('profile');
    });
    document.getElementById('navSettingsBtn').addEventListener('click', function() {
        switchTab('settings');
    });
    document.getElementById('navBackBtn').addEventListener('click', function() {
        goHome();
    });

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

    // 绑定创建/加入班级
    document.getElementById('createClassBtn').addEventListener('click', function() {
        document.getElementById('createClassModal').style.display = 'flex';
    });
    document.getElementById('createClassCancel').addEventListener('click', function() {
        document.getElementById('createClassModal').style.display = 'none';
    });
    document.getElementById('createClassConfirm').addEventListener('click', async function() {
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
    });

    document.getElementById('joinClassBtn').addEventListener('click', function() {
        document.getElementById('joinClassModal').style.display = 'flex';
    });
    document.getElementById('joinClassCancel').addEventListener('click', function() {
        document.getElementById('joinClassModal').style.display = 'none';
    });
    document.getElementById('joinClassConfirm').addEventListener('click', async function() {
        var code = document.getElementById('joinClassInviteCode').value.trim();
        if (!code) { toast('请输入邀请码'); return; }
        await joinClassByInvite(code);
        document.getElementById('joinClassModal').style.display = 'none';
        document.getElementById('joinClassInviteCode').value = '';
    });

    // 搜索班级（带搜索框）
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

    bindPublish();
    bindSearch();
    bindChatInput();
    bindTeacherMessage();
    bindModalEvents();

    goHome();
}

function goHome() {
    if (!currentUser) return;
    document.getElementById('view-home').classList.add('active');
    document.getElementById('view-class').classList.remove('active');
    document.getElementById('view-profile').classList.remove('active');
    document.getElementById('view-settings').classList.remove('active');
    document.getElementById('homeTopLeft').classList.remove('hidden');
    document.getElementById('classTopLeft').classList.add('hidden');
    document.getElementById('navMainItems').classList.remove('hidden');
    document.getElementById('navClassItems').classList.add('hidden');
    document.querySelectorAll('#navMainItems .nav-item').forEach(function(item) {
        item.classList.remove('active');
        if (item.dataset.tab === 'home') item.classList.add('active');
    });
    renderClassList();
    document.getElementById('homeNavTitle').textContent = '班级时光机';
    document.title = '班级时光机 · 主页';
    updatePageTitle();
}

function enterClass(classId) {
    if (!currentUser) return;
    currentClassId = classId;
    for (var i = 0; i < userClasses.length; i++) {
        if (userClasses[i].class_id === classId) {
            currentClassRole = userClasses[i].role;
            break;
        }
    }
    document.getElementById('view-home').classList.remove('active');
    document.getElementById('view-profile').classList.remove('active');
    document.getElementById('view-settings').classList.remove('active');
    document.getElementById('view-class').classList.add('active');
    document.getElementById('homeTopLeft').classList.add('hidden');
    document.getElementById('classTopLeft').classList.remove('hidden');

    var className = '';
    for (var j = 0; j < userClasses.length; j++) {
        if (userClasses[j].class_id === classId && userClasses[j].classes) {
            className = userClasses[j].classes.name;
            break;
        }
    }
    document.getElementById('classNavTitle').textContent = className || '班级空间';
    document.title = className + ' · 班级时光机';
    updatePageTitle();

    document.getElementById('navMainItems').classList.add('hidden');
    document.getElementById('navClassItems').classList.remove('hidden');
    document.querySelectorAll('#navClassItems .nav-item').forEach(function(item) {
        item.classList.remove('active');
        if (item.dataset.tab === 'dynamic') item.classList.add('active');
    });

    loadClassContent('dynamic');
    updateMsgBadge();
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

    var adminItem = document.getElementById('drawerAdmin');
    if (adminItem) {
        adminItem.style.display = (isOwner || currentUserRole === 'owner') ? 'flex' : 'none';
    }
}

function switchTab(tab) {
    document.querySelectorAll('#navMainItems .nav-item').forEach(function(item) {
        item.classList.remove('active');
        if (item.dataset.tab === tab) item.classList.add('active');
    });
    if (tab === 'home') {
        goHome();
    } else if (tab === 'myclasses') {
        document.getElementById('myClassList').scrollIntoView({ behavior: 'smooth' });
    } else if (tab === 'searchclass') {
        document.getElementById('joinClassBtn').click();
    } else if (tab === 'profile') {
        showProfile();
    } else if (tab === 'settings') {
        showSettings();
    }
}

function switchClassTab(tab) {
    document.querySelectorAll('#navClassItems .nav-item').forEach(function(item) {
        item.classList.remove('active');
        if (item.dataset.tab === tab) item.classList.add('active');
    });
    loadClassContent(tab);
}

function toggleDrawer(show) {
    var overlay = document.getElementById('drawerOverlay');
    if (show) {
        overlay.classList.add('open');
    } else {
        overlay.classList.remove('open');
    }
}

// ---------- 动态发布完整功能（含多图 + 进度条） ----------
function bindPublish() {
    var textarea = document.getElementById('publishText');
    var counter = document.getElementById('publishCounter');
    var fileInput = document.getElementById('publishMedia');
    var previewContainer = document.getElementById('publishPreviewContainer');

    // 多图选择
    if (fileInput) {
        fileInput.setAttribute('multiple', 'multiple');
        fileInput.addEventListener('change', function(e) {
            var files = e.target.files;
            selectedFiles = [];
            for (var i = 0; i < files.length; i++) {
                selectedFiles.push(files[i]);
            }
            renderImagePreviews();
        });
    }

    // 渲染图片预览
    function renderImagePreviews() {
        var container = document.getElementById('publishPreviewContainer');
        if (!container) return;
        if (selectedFiles.length === 0) {
            container.innerHTML = '';
            container.style.display = 'none';
            return;
        }
        container.style.display = 'flex';
        container.innerHTML = '';
        selectedFiles.forEach(function(file, index) {
            var reader = new FileReader();
            reader.onload = function(e) {
                var div = document.createElement('div');
                div.className = 'image-preview-item';
                div.innerHTML = `
                    <img src="${e.target.result}" />
                    <button class="remove-btn" data-index="${index}">✕</button>
                `;
                container.appendChild(div);
                div.querySelector('.remove-btn').addEventListener('click', function() {
                    selectedFiles.splice(index, 1);
                    renderImagePreviews();
                });
            };
            reader.readAsDataURL(file);
        });
    }

    // 计数
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

    // 保存草稿
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

    // 发布
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
            var mediaList = [];

            // 处理多图/视频上传
            if (selectedFiles.length > 0) {
                var progressContainer = document.getElementById('uploadProgress');
                var bar = document.getElementById('uploadBar');
                if (progressContainer) progressContainer.style.display = 'block';
                if (bar) bar.style.width = '0%';

                for (var i = 0; i < selectedFiles.length; i++) {
                    var file = selectedFiles[i];
                    if (file.type.startsWith('image/')) {
                        var compressed = await compressImage(file, 800, 0.7);
                        if (compressed) {
                            mediaList.push(compressed);
                        } else {
                            var reader = new FileReader();
                            var dataUrl = await new Promise(function(resolve) { reader.onload = function(e) { resolve(e.target.result); }; reader.readAsDataURL(file); });
                            mediaList.push(dataUrl);
                        }
                    } else if (file.type.startsWith('video/')) {
                        var path = 'dynamic/' + Date.now() + '_' + file.name;
                        var uploadUrl = CONFIG.SUPABASE_URL + '/storage/v1/object/files/' + path;
                        var uploadProgress = await new Promise(function(resolve, reject) {
                            var xhr = new XMLHttpRequest();
                            xhr.open('POST', uploadUrl, true);
                            xhr.setRequestHeader('Authorization', 'Bearer ' + CONFIG.SUPABASE_ANON_KEY);
                            xhr.setRequestHeader('Content-Type', file.type);
                            xhr.upload.onprogress = function(e) {
                                if (e.lengthComputable && bar) {
                                    var percent = Math.round((e.loaded / e.total) * 100);
                                    bar.style.width = percent + '%';
                                }
                            };
                            xhr.onload = function() {
                                if (xhr.status === 200 || xhr.status === 201) {
                                    var publicUrl = CONFIG.SUPABASE_URL + '/storage/v1/object/public/files/' + path;
                                    resolve(publicUrl);
                                } else {
                                    reject(xhr.statusText);
                                }
                            };
                            xhr.onerror = function() { reject('网络错误'); };
                            xhr.send(file);
                        });
                        mediaList.push(uploadProgress);
                    } else {
                        var reader = new FileReader();
                        var dataUrl = await new Promise(function(resolve) { reader.onload = function(e) { resolve(e.target.result); }; reader.readAsDataURL(file); });
                        mediaList.push(dataUrl);
                    }

                    // 更新进度
                    if (bar) {
                        var totalProgress = Math.round(((i + 1) / selectedFiles.length) * 100);
                        bar.style.width = totalProgress + '%';
                    }
                }

                if (bar) bar.style.width = '100%';
                setTimeout(function() {
                    var progress = document.getElementById('uploadProgress');
                    if (progress) progress.style.display = 'none';
                }, 500);

                // 清空已选择的文件
                selectedFiles = [];
                var previewContainer = document.getElementById('publishPreviewContainer');
                if (previewContainer) { previewContainer.innerHTML = ''; previewContainer.style.display = 'none'; }
                if (fileInput) fileInput.value = '';
            }

            if (mediaList.length > 0 || text) {
                finishPublish();
            } else { toast('请填写内容或选择图片'); btn.disabled = false; }

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

// ---------- 动态列表 ----------
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
}

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
    // 点赞/收藏动画（修复⑪）
    document.querySelectorAll('.like-btn').forEach(function(el) {
        el.onclick = function(e) {
            e.stopPropagation();
            var id = this.dataset.id;
            var supabase = getSupabase();
            supabase.from('likes').select('id').eq('dyn_id', id).eq('user_email', currentUser.email).then(function(res) {
                if (res.data && res.data.length > 0) {
                    toast('已点过赞');
                    return;
                }
                supabase.from('likes').insert({ dyn_id: id, user_email: currentUser.email, class_id: currentClassId }).then(function() {
                    supabase.from('dynamics').select('like_count').eq('id', id).then(function(r) {
                        var count = (r.data && r.data[0] ? r.data[0].like_count : 0) + 1;
                        supabase.from('dynamics').update({ like_count: count }).eq('id', id).then(function() {
                            loadDynamics(true);
                            var btn = document.querySelector('.like-btn[data-id="' + id + '"] i');
                            if (btn) { btn.parentElement.classList.add('liked'); }
                            toast('👍 点赞成功');
                            addExp(currentUser.email, 10, '收到点赞');
                        });
                    });
                });
            });
        };
    });
    document.querySelectorAll('.collect-btn').forEach(function(el) {
        el.onclick = function(e) {
            e.stopPropagation();
            var id = this.dataset.id;
            var supabase = getSupabase();
            supabase.from('collects').select('id').eq('dyn_id', id).eq('user_email', currentUser.email).then(function(res) {
                if (res.data && res.data.length > 0) {
                    toast('已收藏过');
                    return;
                }
                supabase.from('collects').insert({ dyn_id: id, user_email: currentUser.email, class_id: currentClassId }).then(function() {
                    supabase.from('dynamics').select('collect_count').eq('id', id).then(function(r) {
                        var count = (r.data && r.data[0] ? r.data[0].collect_count : 0) + 1;
                        supabase.from('dynamics').update({ collect_count: count }).eq('id', id).then(function() {
                            loadDynamics(true);
                            var btn = document.querySelector('.collect-btn[data-id="' + id + '"] i');
                            if (btn) { btn.parentElement.classList.add('collected'); }
                            toast('🔖 收藏成功');
                            addExp(currentUser.email, 10, '收到收藏');
                        });
                    });
                });
            });
        };
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
// ================================================================
//  第二段：消息系统 + AI + 群聊 + 个人中心 + 设置 + 管理后台 + 其他功能 + 初始化
// ================================================================

// ---------- 个人中心 ----------
function showProfile() {
    document.getElementById('view-home').classList.remove('active');
    document.getElementById('view-class').classList.remove('active');
    document.getElementById('view-settings').classList.remove('active');
    document.getElementById('view-profile').classList.add('active');
    document.getElementById('homeTopLeft').classList.remove('hidden');
    document.getElementById('classTopLeft').classList.add('hidden');
    document.getElementById('navMainItems').classList.remove('hidden');
    document.getElementById('navClassItems').classList.add('hidden');
    document.querySelectorAll('#navMainItems .nav-item').forEach(function(item) {
        item.classList.remove('active');
        if (item.dataset.tab === 'profile') item.classList.add('active');
    });
    renderProfileContent();
}

function renderProfileContent() {
    var container = document.getElementById('profileContent');
    if (!currentUser) return;
    var stats = currentUser.stats || { level: 1, exp: 0, total_exp: 0, points: 0, login_streak: 0 };
    var levelInfo = getLevelInfo(stats.exp || 0);
    var roleTag = currentUserRole === 'owner' ? '⭐ 站主' : currentUserRole === 'teacher' ? '🎓 教师' : '👤 学生';

    container.innerHTML = `
        <div class="panel">
            <h3>👤 个人资料</h3>
            <div style="display:flex;align-items:center;gap:20px;margin:16px 0;flex-wrap:wrap;">
                <img class="avatar" src="${currentUser.avatar || getDefaultAvatarSVG('👤')}" style="width:80px;height:80px;border-radius:50%;border:1px solid var(--border-subtle);">
                <div>
                    <div style="font-size:1.3rem;font-weight:600;">${currentUser.nickname}</div>
                    <div style="color:var(--text-secondary);">${currentUser.sign || '这个人很懒，什么也没有留下~'}</div>
                    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;">
                        <span class="level-badge ${getLevelBadgeClass(levelInfo.level)}" style="display:inline-flex;align-items:center;justify-content:center;border-radius:50%;width:34px;height:34px;font-weight:700;font-size:0.7rem;">Lv.${levelInfo.level}</span>
                        <span style="font-size:0.9rem;color:var(--text-secondary);">${levelInfo.title}</span>
                        <span style="background:var(--brand-start);color:#fff;padding:2px 12px;border-radius:var(--radius-full);font-size:0.7rem;">${roleTag}</span>
                    </div>
                </div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:10px;background:var(--bg-card);padding:14px;border-radius:var(--radius-sm);margin-bottom:16px;">
                <div><span style="color:var(--text-secondary);font-size:0.8rem;">经验</span><br><span style="font-weight:700;font-size:1.1rem;">${stats.exp || 0}</span></div>
                <div><span style="color:var(--text-secondary);font-size:0.8rem;">下一级</span><br><span style="font-weight:700;font-size:1.1rem;">${levelInfo.nextExp || 0}</span></div>
                <div><span style="color:var(--text-secondary);font-size:0.8rem;">积分</span><br><span style="font-weight:700;font-size:1.1rem;color:#D4AF37;">${stats.points || 0}</span></div>
                <div><span style="color:var(--text-secondary);font-size:0.8rem;">连续签到</span><br><span style="font-weight:700;font-size:1.1rem;">${stats.login_streak || 0}</span> 天</div>
            </div>
            <div class="view-line">邮箱：${currentUser.email}</div>
            <div class="view-line">星座：${currentUser.profile?.star || '未填写'}</div>
            <div class="view-line">生日：${currentUser.profile?.birth || '未填写'}</div>
            <div class="view-line">身高：${currentUser.profile?.height || '秘密'}</div>
            <div class="view-line">体重：${currentUser.profile?.weight || '秘密'}</div>
            <div style="margin-top:20px;border-top:1px solid var(--border-subtle);padding-top:16px;">
                <h4 style="color:var(--text-primary);font-weight:700;">🏆 我的成就</h4>
                <div id="achievementList" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;"></div>
            </div>
            <div style="margin-top:20px;border-top:1px solid var(--border-subtle);padding-top:16px;">
                <h4 style="color:var(--text-primary);font-weight:700;">🎨 头像框/挂件</h4>
                <div id="userEquippedItems" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;"></div>
            </div>
        </div>
    `;
    // 加载成就
    computeAchievements(currentUser.email).then(function(ach) {
        var wrap = document.getElementById('achievementList');
        if (!wrap) return;
        if (ach.length === 0) { wrap.innerHTML = '<div style="color:var(--text-secondary);font-size:0.9rem;">暂无成就</div>'; return; }
        wrap.innerHTML = ach.map(function(a) {
            return '<div style="display:inline-block;font-size:1.5rem;text-align:center;padding:8px;background:var(--bg-card);border-radius:var(--radius-sm);min-width:60px;margin:4px;border:2px solid #D4AF37;"><div>' + a.label + '</div><div style="font-size:0.6rem;color:var(--text-secondary);">' + a.desc + '</div></div>';
        }).join('');
    });
    loadEquippedItems();
}

async function computeAchievements(email) {
    var supabase = getSupabase();
    var { data: dyns } = await supabase.from('dynamics').select('id', { count: 'exact' }).eq('user_email', email);
    var dynCount = dyns ? dyns.length : 0;
    var { data: likes } = await supabase.from('likes').select('id', { count: 'exact' }).eq('user_email', email);
    var likeCount = likes ? likes.length : 0;
    var { data: collects } = await supabase.from('collects').select('id', { count: 'exact' }).eq('user_email', email);
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

// ---------- 设置 ----------
function showSettings() {
    document.getElementById('view-home').classList.remove('active');
    document.getElementById('view-class').classList.remove('active');
    document.getElementById('view-profile').classList.remove('active');
    document.getElementById('view-settings').classList.add('active');
    document.getElementById('homeTopLeft').classList.remove('hidden');
    document.getElementById('classTopLeft').classList.add('hidden');
    document.getElementById('navMainItems').classList.remove('hidden');
    document.getElementById('navClassItems').classList.add('hidden');
    document.querySelectorAll('#navMainItems .nav-item').forEach(function(item) {
        item.classList.remove('active');
        if (item.dataset.tab === 'settings') item.classList.add('active');
    });
    renderSettingsView();
}

function renderSettingsView() {
    var container = document.getElementById('settingsContent');
    var settings = loadSettings();
    var isDark = !settings.theme || settings.theme === 'dark' || settings.theme === 'auto';

    container.innerHTML = `
        <div class="panel">
            <h3>⚙️ 设置</h3>
            <div style="margin-bottom:16px;">
                <label style="display:block;font-weight:500;color:var(--text-secondary);margin-bottom:6px;">🌓 外观模式</label>
                <div style="display:flex;gap:10px;">
                    <button class="theme-btn ${!isDark ? 'active' : ''}" data-theme="light" style="flex:1;padding:8px;border-radius:var(--radius-full);background:${!isDark ? 'var(--brand-start)' : 'var(--bg-card)'};color:${!isDark ? '#fff' : 'var(--text-secondary)'};border:1px solid var(--border-subtle);cursor:pointer;">☀️ 浅色</button>
                    <button class="theme-btn ${isDark ? 'active' : ''}" data-theme="dark" style="flex:1;padding:8px;border-radius:var(--radius-full);background:${isDark ? 'var(--brand-start)' : 'var(--bg-card)'};color:${isDark ? '#fff' : 'var(--text-secondary)'};border:1px solid var(--border-subtle);cursor:pointer;">🌙 深色</button>
                </div>
            </div>
            <div style="margin-bottom:16px;padding-top:16px;border-top:1px solid var(--border-subtle);">
                <h4 style="color:var(--text-primary);font-weight:600;margin-bottom:8px;">📋 更新日志</h4>
                <div id="changelogList"></div>
            </div>
            ${(isOwner || currentUserRole === 'owner') ? `
            <div style="padding-top:16px;border-top:1px solid var(--border-subtle);">
                <h4 style="color:var(--text-primary);font-weight:600;margin-bottom:8px;">🛡️ 管理后台</h4>
                <button class="btn-main" id="adminEntryBtn" style="width:auto;padding:8px 24px;">进入管理后台</button>
                <div id="adminContent" style="margin-top:12px;"></div>
            </div>
            ` : ''}
        </div>
    `;

    // 主题切换
    document.querySelectorAll('.theme-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var theme = this.dataset.theme;
            var settings = loadSettings();
            settings.theme = theme;
            saveSettings(settings);
            applySettings();
            renderSettingsView();
        });
    });

    // 更新日志
    loadChangelog();

    // 管理后台（仅站主）
    var adminBtn = document.getElementById('adminEntryBtn');
    if (adminBtn) {
        adminBtn.addEventListener('click', function() {
            var content = document.getElementById('adminContent');
            if (content.style.display === 'block') {
                content.style.display = 'none';
                this.textContent = '进入管理后台';
            } else {
                content.style.display = 'block';
                this.textContent = '收起管理后台';
                loadAdmin('dashboard');
            }
        });
    }
}

async function loadChangelog() {
    var supabase = getSupabase();
    var { data, error } = await supabase.from('version_logs').select('*').order('published_at', { ascending: false });
    if (error) { console.error(error); return; }
    var wrap = document.getElementById('changelogList');
    if (!wrap) return;
    if (!data || data.length === 0) {
        wrap.innerHTML = '<div style="color:var(--text-secondary);padding:10px;text-align:center;">暂无更新记录</div>';
        return;
    }
    var html = '';
    data.forEach(function(item) {
        var majorBadge = item.is_major ? ' <span style="background:#D4AF37;color:#222;padding:2px 10px;border-radius:var(--radius-full);font-size:0.6rem;font-weight:700;margin-left:8px;">🎉 重大更新</span>' : '';
        var contentHtml = item.content ? item.content.replace(/\n/g, '<br>') : '';
        html += `
            <div style="background:var(--bg-card);border-radius:var(--radius-sm);padding:12px 16px;margin-bottom:8px;border-left:4px solid var(--brand-start);">
                <div><span style="font-weight:700;color:var(--brand-start);">${item.version}</span><span style="font-size:0.8rem;color:var(--text-muted);margin-left:10px;">${new Date(item.published_at).toLocaleDateString('zh-CN')}</span>${majorBadge}</div>
                ${item.title ? '<div style="font-weight:600;margin:4px 0;">' + item.title + '</div>' : ''}
                <div style="font-size:0.9rem;color:var(--text-secondary);margin-top:4px;">${contentHtml}</div>
            </div>
        `;
    });
    wrap.innerHTML = html;
}

// ---------- 管理后台 ----------
async function loadAdmin(tab) {
    if (!isOwner && currentUserRole !== 'owner') { toast('权限不足'); return; }
    var wrap = document.getElementById('adminContent');
    if (!wrap) return;
    var supabase = getSupabase();

    // 概况
    if (tab === 'dashboard') {
        Promise.all([
            supabase.from('profiles').select('id', { count: 'exact' }),
            supabase.from('dynamics').select('id', { count: 'exact' }),
            supabase.from('messages').select('id', { count: 'exact' }),
            supabase.from('class_members').select('user_email'),
            supabase.from('user_stats').select('level')
        ]).then(function(res) {
            var userCount = res[0].count || 0;
            var dynCount = res[1].count || 0;
            var msgCount = res[2].count || 0;
            var members = res[3].data || [];
            var stats = res[4].data || [];
            var avgLevel = 0;
            if (stats.length > 0) {
                var sum = stats.reduce(function(a, b) { return a + (b.level || 1); }, 0);
                avgLevel = Math.round(sum / stats.length * 10) / 10;
            }
            var html = '<div class="admin-stats">' +
                '<div class="admin-stat-card"><div class="num">' + userCount + '</div><div class="label">总用户</div></div>' +
                '<div class="admin-stat-card"><div class="num">' + dynCount + '</div><div class="label">总动态</div></div>' +
                '<div class="admin-stat-card"><div class="num">' + msgCount + '</div><div class="label">总消息</div></div>' +
                '<div class="admin-stat-card"><div class="num">' + avgLevel + '</div><div class="label">平均等级</div></div>' +
                '</div>';
            wrap.innerHTML = html;
        });
        return;
    }

    // 用户列表
    if (tab === 'users') {
        var { data: profiles } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
        if (!profiles) return;
        var html = '<table class="admin-table"><tr><th>昵称</th><th>邮箱</th><th>角色</th></tr>';
        profiles.forEach(function(u) {
            var role = u.role || 'student';
            var roleDisplay = role === 'owner' ? '⭐ 站主' : role === 'teacher' ? '🎓 教师' : '👤 学生';
            html += '<tr><td>' + (u.nickname || '未命名') + '</td><td>' + u.email + '</td><td>' + roleDisplay + '</td></tr>';
        });
        html += '</table>';
        wrap.innerHTML = html;
        return;
    }

    // 动态管理
    if (tab === 'dynamics') {
        var { data: dyns } = await supabase.from('dynamics').select('*').order('created_at', { ascending: false }).limit(50);
        if (!dyns) return;
        var html = '<table class="admin-table"><tr><th>内容</th><th>作者</th><th>时间</th></tr>';
        dyns.forEach(function(d) {
            html += '<tr><td>' + (d.text || '').slice(0, 30) + '...</td><td>' + d.nickname + '</td><td>' + new Date(d.created_at).toLocaleString() + '</td></tr>';
        });
        html += '</table>';
        wrap.innerHTML = html;
        return;
    }

    // 默认
    wrap.innerHTML = '<div style="color:var(--text-secondary);padding:20px;text-align:center;">选择左侧选项卡</div>';
}

// ---------- 设置系统 ----------
function saveSettings(settings) { localStorage.setItem('blog_settings', JSON.stringify(settings)); }
function loadSettings() { try { return JSON.parse(localStorage.getItem('blog_settings')) || {}; } catch (e) { return {}; } }

function applySettings() {
    var settings = loadSettings();
    var root = document.documentElement;
    var theme = settings.theme || 'dark';
    if (!settings.theme) {
        var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        theme = prefersDark ? 'dark' : 'light';
        settings.theme = theme;
        saveSettings(settings);
    }
    if (theme === 'dark') {
        root.setAttribute('data-theme', 'dark');
    } else {
        root.setAttribute('data-theme', 'light');
    }
}

// ---------- 子页面内容加载（修复③④⑤） ----------
function loadClassContent(tab) {
    var container = document.getElementById('classSpaceContent');
    if (!container) return;
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
                    <div id="publishPreviewContainer" class="image-preview-list" style="display:none;"></div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;">
                        <input id="publishTags" placeholder="标签（用逗号分隔，如 #学习,#日常）" style="flex:1;padding:8px 12px;border:1px solid var(--border-subtle);border-radius:var(--radius-full);background:var(--bg-card);color:var(--text-primary);font-size:0.85rem;">
                    </div>
                    <div class="media-select" style="margin:8px 0;">
                        <input type="file" accept="image/*,video/*" id="publishMedia" style="font-size:0.85rem;" multiple>
                        <div class="upload-progress" id="uploadProgress" style="display:none;"><div class="bar" id="uploadBar"></div></div>
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
            break;
        case 'notice':
            container.innerHTML = `
                <div class="panel">
                    <h3>📢 通知 <button class="btn-sm" id="newNoticeBtn"><i class="fa fa-plus"></i> 发布通知</button></h3>
                    <div id="noticeList"></div>
                </div>
            `;
            loadNotice();
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
            break;
        case 'timeline':
            container.innerHTML = `
                <div class="panel">
                    <h3>📜 班级大事记 <button class="btn-sm" id="addTimelineBtn">➕ 添加事件</button></h3>
                    <div id="timelineList"></div>
                </div>
            `;
            loadTimeline();
            break;
        case 'destinations':
            container.innerHTML = `
                <div class="panel">
                    <h3>🗺️ 同学去向登记 <button class="btn-sm" id="addDestinationBtn">📝 登记我的去向</button></h3>
                    <div id="destinationList"></div>
                </div>
            `;
            loadDestinations();
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
            loadMyLikes();
            break;
        case 'myCollect':
            container.innerHTML = `<div class="panel"><h3>🔖 我收藏的动态</h3><div id="myCollectList"></div></div>`;
            loadMyCollects();
            break;
        case 'treehole':
            container.innerHTML = `
                <div class="panel" style="padding:0;overflow:hidden;">
                    <div class="msg-page">
                        <div class="msg-contact-list" style="width:100%;border-right:none;">
                            <div style="padding:12px;border-bottom:1px solid var(--border-subtle);display:flex;gap:8px;flex-wrap:wrap;">
                                <button class="btn-sm" id="treeholeBackBtn"><i class="fa fa-arrow-left"></i> 返回消息</button>
                            </div>
                            <div id="treeholeMessages" style="padding:16px;"></div>
                        </div>
                    </div>
                </div>
            `;
            loadTreeholeChat();
            document.getElementById('treeholeBackBtn').addEventListener('click', function() {
                switchClassTab('messages');
            });
            break;
        case 'admin':
            if (isOwner || currentUserRole === 'owner') {
                container.innerHTML = `<div class="panel"><h3>🛡️ 管理后台</h3><div id="adminContent"></div></div>`;
                loadAdmin('dashboard');
                // 绑定管理后台选项卡
                document.querySelectorAll('.admin-tab').forEach(function(tab) {
                    tab.addEventListener('click', function() {
                        loadAdmin(this.dataset.tab);
                    });
                });
            } else {
                toast('权限不足');
            }
            break;
        default:
            container.innerHTML = '<div class="panel"><p style="color:var(--text-secondary);">功能开发中...</p></div>';
    }
    // 重新绑定模态框事件（针对新生成的按钮）
    bindModalEvents();
}

// ---------- 我的点赞/收藏 ----------
async function loadMyLikes() {
    var supabase = getSupabase();
    var { data, error } = await supabase.from('likes').select('dyn_id').eq('user_email', currentUser.email).eq('class_id', currentClassId);
    if (error) { console.error(error); return; }
    var wrap = document.getElementById('myLikeList');
    if (!wrap) return;
    if (!data || data.length === 0) {
        wrap.innerHTML = '<div style="color:var(--text-secondary);padding:20px;">还没有点赞</div>';
        return;
    }
    var dynIds = data.map(function(l) { return l.dyn_id; });
    var { data: dyns } = await supabase.from('dynamics').select('*').in('id', dynIds).order('created_at', { ascending: false });
    if (!dyns) return;
    wrap.innerHTML = dyns.map(function(d) {
        return '<div class="dynamic-item"><div class="user-head"><div><div class="nickname">' + d.nickname + '</div></div></div><div class="dynamic-text">' + (d.text || '') + '</div><div style="color:var(--text-secondary);font-size:0.8rem;">' + new Date(d.created_at).toLocaleString() + '</div></div>';
    }).join('');
}

async function loadMyCollects() {
    var supabase = getSupabase();
    var { data, error } = await supabase.from('collects').select('dyn_id').eq('user_email', currentUser.email).eq('class_id', currentClassId);
    if (error) { console.error(error); return; }
    var wrap = document.getElementById('myCollectList');
    if (!wrap) return;
    if (!data || data.length === 0) {
        wrap.innerHTML = '<div style="color:var(--text-secondary);padding:20px;">还没有收藏</div>';
        return;
    }
    var dynIds = data.map(function(l) { return l.dyn_id; });
    var { data: dyns } = await supabase.from('dynamics').select('*').in('id', dynIds).order('created_at', { ascending: false });
    if (!dyns) return;
    wrap.innerHTML = dyns.map(function(d) {
        return '<div class="dynamic-item"><div class="user-head"><div><div class="nickname">' + d.nickname + '</div></div></div><div class="dynamic-text">' + (d.text || '') + '</div><div style="color:var(--text-secondary);font-size:0.8rem;">' + new Date(d.created_at).toLocaleString() + '</div></div>';
    }).join('');
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
            '<img class="avatar" src="' + avatar + '" style="width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0;">' +
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
                quoteHtml = '<div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:4px;">↩️ ' + (m.reply_to_name || '') + '：' + (m.reply_to_content || '') + '</div>';
            }
            var reactionHtml = '';
            if (m.reactions) {
                try {
                    var reacts = JSON.parse(m.reactions);
                    if (Object.keys(reacts).length > 0) {
                        reactionHtml = '<div style="display:flex;gap:4px;margin-top:4px;">';
                        for (var r in reacts) {
                            reactionHtml += '<span onclick="addReaction(\'' + m.id + '\',\'' + r + '\')" style="cursor:pointer;">' + r + '</span>';
                        }
                        reactionHtml += '</div>';
                    }
                } catch (e) {}
            }
            var actionHtml = '';
            if (isMe && !isRecalled) {
                var canRecall = (new Date() - new Date(m.created_at)) < 120000;
                if (canRecall) {
                    actionHtml += '<span onclick="recallMessage(\'' + m.id + '\')" style="cursor:pointer;margin-right:8px;">撤回</span>';
                }
            }
            if (!isMe && !isRecalled) {
                actionHtml += '<span onclick="quoteMessage(\'' + m.id + '\',\'' + name + '\',\'' + (m.content || '').replace(/'/g, "\\'") + '\')" style="cursor:pointer;margin-right:8px;">引用</span>';
                actionHtml += '<span onclick="showReactionPicker(event, \'' + m.id + '\')" style="cursor:pointer;">😊</span>';
            }
            var senderTag = (!isMe && isTeacher) ? ' 🎓' : '';
            html += '<div class="msg-item ' + (isMe ? 'me' : '') + '" data-msgid="' + m.id + '">' +
                (!isMe ? '<div class="sender-name">' + name + senderTag + '</div>' : '') +
                quoteHtml +
                '<span class="bubble">' + contentHtml + '</span>' +
                reactionHtml +
                '<div class="time">' + timeStr + readStatus + (actionHtml ? ' <span style="font-size:0.7rem;">' + actionHtml + '</span>' : '') + '</div>' +
                '</div>';
        });
    }
    container.innerHTML = html;
    setTimeout(function() { container.scrollTop = container.scrollHeight; }, 50);
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

// ---------- 树洞 ----------
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

// ---------- 发送消息 ----------
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
            thinkDiv.innerHTML = '<span class="bubble" style="background:rgba(255,255,255,0.1);color:var(--text-secondary);">🎨 生成图片中...</span>';
            container.appendChild(thinkDiv);
            container.scrollTop = container.scrollHeight;
            try {
                var imgUrl = await callImageAPI(prompt);
                var el = document.getElementById('ai-thinking');
                if (el) el.remove();
                var aiDiv = document.createElement('div');
                aiDiv.className = 'msg-item';
                aiDiv.innerHTML = '<span class="bubble" style="background:rgba(255,255,255,0.1);">🎨 ' + (imgUrl ? '<br><img src="' + imgUrl + '" style="max-width:200px;border-radius:var(--radius-sm);margin-top:6px;cursor:pointer;" onclick="openImageViewer(this.src)">' : '生成失败') + '</span><div class="time">' + new Date().toLocaleString() + '</div>';
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
    thinkDiv.innerHTML = '<span class="bubble" style="background:rgba(255,255,255,0.1);color:var(--text-secondary);">🤖 思考中...</span>';
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
        bubble.style.background = 'rgba(255,255,255,0.08)';
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
            html += '<label class="member-check-item" style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:var(--radius-sm);cursor:pointer;"><input type="checkbox" value="' + u.email + '" style="width:16px;height:16px;accent-color:var(--brand-start);"> <img src="' + avatar + '" style="width:24px;height:24px;border-radius:50%;"> ' + name + '</label>';
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
            setAdminBtn = '<span style="font-size:0.65rem;cursor:pointer;color:var(--brand-start);margin-left:4px;" onclick="setAdmin(\'' + groupId + '\',\'' + email + '\')">设为管理</span>';
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

async function addGroupMember() {
    if (!currentManageGroupId) return;
    var supabase = getSupabase();
    var { data: group } = await supabase.from('groups').select('members').eq('id', currentManageGroupId).single();
    if (!group) { toast('群不存在'); return; }
    var existingMembers = group.members || [];
    var { data: allUsers } = await supabase.from('profiles').select('email, nickname, avatar, role');
    if (allUsers) {
        allUsers = allUsers.filter(function(u) { return existingMembers.indexOf(u.email) === -1; });
    }
    var container = document.getElementById('groupAddMemberList');
    var html = '';
    if (!allUsers || allUsers.length === 0) {
        html = '<div style="color:var(--text-secondary);padding:10px;">没有可添加的成员</div>';
    } else {
        allUsers.forEach(function(u) {
            var name = u.nickname || u.email.split('@')[0];
            if (u.role === 'teacher') name += ' 🎓';
            html += '<label class="member-check-item" style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:var(--radius-sm);cursor:pointer;"><input type="checkbox" value="' + u.email + '" style="width:16px;height:16px;accent-color:var(--brand-start);"> ' + name + '</label>';
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
            html += '<div style="background:var(--bg-card);padding:8px 12px;border-radius:var(--radius-sm);margin-bottom:10px;font-size:0.85rem;color:var(--text-secondary);border-left:3px solid var(--brand-start);">📢 ' + groupInfo.announcement + '</div>';
        }
        for (var i = 0; i < data.length; i++) {
            var m = data[i];
            var isMe = m.from_user === currentUser.email;
            var displayName = isMe ? currentUser.nickname : (memberNames[m.from_user] || m.from_user.split('@')[0]);
            var isOwnerMsg = (m.from_user === ownerEmail);
            var badge = isOwnerMsg ? ' <span style="font-size:0.5rem;background:var(--brand-start);color:#fff;padding:1px 6px;border-radius:var(--radius-full);">群主</span>' : '';
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

// ---------- 时间胶囊 ----------
async function loadCapsules() {
    if (!currentClassId) {
        var wrap = document.getElementById('capsuleList');
        if (wrap) wrap.innerHTML = '<div style="color:var(--text-secondary);padding:20px;text-align:center;">请先选择一个班级</div>';
        return;
    }
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
    if (!currentClassId) {
        var wrap = document.getElementById('timelineList');
        if (wrap) wrap.innerHTML = '<div style="color:var(--text-secondary);padding:20px;text-align:center;">请先选择一个班级</div>';
        return;
    }
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

function bindTeacherMessage() {
    var btn = document.getElementById('sendTeacherMessageBtn');
    if (btn) {
        btn.onclick = function() {
            var content = document.getElementById('teacherMessageInput').value.trim();
            sendTeacherMessage(content);
        };
    }
}

// ---------- 通知、投票、文档、日历、相册 ----------
async function loadNotice() {
    if (!currentClassId) return;
    var supabase = getSupabase();
    var { data, error } = await supabase.from('assignments').select('*').eq('class_id', currentClassId).order('created_at', { ascending: false });
    if (error) { console.error(error); return; }
    var wrap = document.getElementById('noticeList');
    if (!wrap) return;
    if (!data || data.length === 0) { wrap.innerHTML = '<div style="color:var(--text-secondary);padding:20px;">暂无通知</div>'; return; }
    var html = '';
    data.forEach(function(n) {
        var deadline = n.deadline ? new Date(n.deadline).toLocaleString() : '无截止';
        html += '<div class="dynamic-item"><div class="user-head"><div><div class="nickname">📢 ' + n.title + '</div><div class="sign">发布者：' + n.created_by + ' | 截止：' + deadline + '</div></div></div><div class="dynamic-text">' + (n.description || '') + '</div></div>';
    });
    wrap.innerHTML = html;
}

async function loadPolls() {
    if (!currentClassId) return;
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
        html += '<div class="dynamic-item"><div class="user-head"><div><div class="nickname">📊 ' + p.question + (p.anonymous ? ' (匿名)' : '') + '</div><div class="sign">发起人：' + p.created_by + ' | 参与：' + total + '人</div></div></div>';
        options.forEach(function(opt, idx) {
            var count = votes ? votes.filter(function(v) { return v.option_index === idx; }).length : 0;
            var percent = total > 0 ? Math.round((count / total) * 100) : 0;
            var selected = (myVote && myVote.option_index === idx) ? ' style="font-weight:bold;color:var(--brand-start);"' : '';
            html += '<div class="vote-option"' + selected + '>' +
                '<span style="min-width:50px;">' + opt + '</span>' +
                '<div style="flex:1;background:var(--border-subtle);border-radius:3px;height:6px;"><div class="vote-bar" style="height:6px;background:var(--brand-start);border-radius:3px;width:' + percent + '%;transition:width 0.6s ease;"></div></div>' +
                '<span>' + count + '票 (' + percent + '%)</span>' +
                (!myVote ? ' <button class="btn-sm" onclick="votePoll(\'' + p.id + '\',' + idx + ')" style="padding:4px 12px;background:var(--brand-start);color:#fff;border-radius:var(--radius-full);font-size:0.8rem;">投票</button>' : '') +
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
    if (!currentClassId) return;
    var supabase = getSupabase();
    var { data, error } = await supabase.from('calendar_events').select('*').eq('class_id', currentClassId).order('event_date', { ascending: true });
    if (error) { console.error(error); return; }
    var wrap = document.getElementById('calendarList');
    if (!wrap) return;
    if (!data || data.length === 0) { wrap.innerHTML = '<div style="color:var(--text-secondary);padding:12px;">暂无事件</div>'; return; }
    var html = '';
    data.forEach(function(e) {
        html += '<div class="dynamic-item"><div class="user-head"><div><div class="nickname">📅 ' + e.title + ' <span style="font-size:0.8rem;background:var(--bg-card);padding:2px 10px;border-radius:var(--radius-full);">' + e.event_type + '</span></div><div class="sign">' + e.event_date + ' | 发布者：' + (e.created_by || '系统') + '</div></div></div><div class="dynamic-text">' + (e.description || '') + '</div></div>';
    });
    wrap.innerHTML = html;
}

async function loadAlbum() {
    if (!currentClassId) return;
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
        return '<div style="border-radius:var(--radius-sm);overflow:hidden;cursor:pointer;aspect-ratio:1;background:var(--bg-card);" onclick="openImageViewer(\'' + img.url + '\')"><img src="' + img.url + '" loading="lazy" style="width:100%;height:100%;object-fit:cover;"></div>';
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
                    return '<div class="dynamic-item"><div class="user-head"><img class="avatar" src="' + avatar + '"><div><div class="nickname">' + u.nickname + roleTag + '</div><div class="sign">' + (u.sign || '') + '</div></div></div></div>';
                }).join('');
            }
            html += '<h4 style="color:var(--text-primary);margin:12px 0 8px;">📝 动态</h4>';
            supabase.from('dynamics').select('*').eq('class_id', currentClassId).ilike('text', '%' + keyword + '%').order('created_at', { ascending: false }).limit(20).then(function(dynRes) {
                var dyns = dynRes.data || [];
                if (dyns.length === 0) html += '<p style="color:var(--text-secondary);">无</p>';
                else {
                    html += dyns.map(function(d) {
                        return '<div class="dynamic-item"><b>' + d.nickname + '</b>：' + (d.text || '').slice(0, 50) + '<div style="color:var(--text-secondary);font-size:0.75rem;">' + new Date(d.created_at).toLocaleString() + '</div></div>';
                    }).join('');
                }
                resultWrap.innerHTML = html;
            });
        });
    };
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
    var majorBadge = versionData.is_major ? ' <span style="background:#D4AF37;color:#222;padding:2px 10px;border-radius:var(--radius-full);font-size:0.6rem;font-weight:700;">🎉 重大更新</span>' : '';
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

// ---------- 模态框事件绑定 ----------
function bindModalEvents() {
    var el;

    el = document.getElementById('createGroupBtn2');
    if (el) el.onclick = openCreateGroupModal;
    el = document.getElementById('createGroupCancel');
    if (el) el.onclick = function() { document.getElementById('createGroupModal').style.display = 'none'; };
    el = document.getElementById('createGroupConfirm');
    if (el) el.onclick = createGroupConfirm;

    el = document.getElementById('newNoticeBtn');
    if (el) el.onclick = function() { document.getElementById('newNoticeModal').style.display = 'flex'; };
    el = document.getElementById('noticeModalCancel');
    if (el) el.onclick = function() { document.getElementById('newNoticeModal').style.display = 'none'; };
    el = document.getElementById('noticeModalConfirm');
    if (el) {
        el.onclick = async function() {
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

    el = document.getElementById('newPollBtn');
    if (el) el.onclick = function() { document.getElementById('newPollModal').style.display = 'flex'; };
    el = document.getElementById('pollModalCancel');
    if (el) el.onclick = function() { document.getElementById('newPollModal').style.display = 'none'; };
    el = document.getElementById('pollModalConfirm');
    if (el) {
        el.onclick = async function() {
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

    el = document.getElementById('saveDocBtn');
    if (el) {
        el.onclick = async function() {
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

    el = document.getElementById('addEventBtn');
    if (el) el.onclick = function() { document.getElementById('addEventModal').style.display = 'flex'; };
    el = document.getElementById('eventModalCancel');
    if (el) el.onclick = function() { document.getElementById('addEventModal').style.display = 'none'; };
    el = document.getElementById('eventModalConfirm');
    if (el) {
        el.onclick = async function() {
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

    el = document.getElementById('treeholeEntryBtn');
    if (el) {
        el.onclick = function() {
            var item = document.querySelector('#contactItems .msg-contact-item[data-target="_treehole"]');
            if (item) item.click();
            else toast('刷新后重试');
        };
    }
    el = document.getElementById('checkinBtn');
    if (el) el.onclick = function() { showCheckinModal(); };
    el = document.getElementById('avatarShopClose');
    if (el) el.onclick = function() { document.getElementById('avatarShopModal').style.display = 'none'; };
    el = document.getElementById('avatarShopModal');
    if (el) el.onclick = function(e) { if (e.target === this) this.style.display = 'none'; };

    bindGroupManageButtons();

    el = document.getElementById('pubEmojiBtn');
    if (el) {
        el.onclick = function(e) {
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

function bindGroupManageButtons() {
    var el;
    el = document.getElementById('groupManageClose');
    if (el) el.onclick = function() { document.getElementById('groupManageModal').style.display = 'none'; };
    el = document.getElementById('groupAddMemberBtn');
    if (el) el.onclick = addGroupMember;
    el = document.getElementById('groupAddMemberCancel');
    if (el) el.onclick = function() { document.getElementById('groupAddMemberModal').style.display = 'none'; };
    el = document.getElementById('groupAddMemberConfirm');
    if (el) el.onclick = confirmAddGroupMember;
    el = document.getElementById('groupEditNameBtn');
    if (el) el.onclick = editGroupName;
    el = document.getElementById('groupEditNameCancel');
    if (el) el.onclick = function() { document.getElementById('groupEditNameModal').style.display = 'none'; };
    el = document.getElementById('groupEditNameConfirm');
    if (el) el.onclick = confirmEditGroupName;
    el = document.getElementById('groupSetAnnounceBtn');
    if (el) el.onclick = setGroupAnnounce;
    el = document.getElementById('groupAnnounceCancel');
    if (el) el.onclick = function() { document.getElementById('groupAnnounceModal').style.display = 'none'; };
    el = document.getElementById('groupAnnounceConfirm');
    if (el) el.onclick = confirmGroupAnnounce;
    el = document.getElementById('groupDissolveBtn');
    if (el) el.onclick = function() { if (currentManageGroupId) dissolveGroup(currentManageGroupId); };
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
            '<div style="margin:12px 0;padding:12px;background:var(--bg-card);border-radius:var(--radius-sm);">' +
            '<span style="color:#D4AF37;font-weight:700;">+' + bonus + ' 经验</span>  ' +
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
    renderProfileContent();
}

// ---------- 消息订阅 ----------
function subscribeToMessages() {
    if (messageSubscription || !currentUser) return;
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
        if (badge) {
            if (count > 0) { badge.textContent = count > 99 ? '99+' : count; badge.classList.remove('hidden'); }
            else { badge.classList.add('hidden'); }
        }
        if (bottomBadge) {
            if (count > 0) { bottomBadge.textContent = count > 99 ? '99+' : count; bottomBadge.classList.remove('hidden'); }
            else { bottomBadge.classList.add('hidden'); }
        }
    });
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

function requestNotificationPermission() {
    if ('Notification' in window) {
        Notification.requestPermission();
    }
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

// ---------- 页面初始化 ----------
window.onload = function() {
    initGlobalEmojiPanel();

    // 认证切换
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
            var btn = this;
            btn.disabled = true;
            var email = document.getElementById('loginEmail').value.trim();
            var pwd = document.getElementById('loginPwd').value.trim();
            if (!email || !pwd) { toast('请填写邮箱和密码'); btn.disabled = false; return; }
            signIn(email, pwd).finally(function() { btn.disabled = false; });
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

    // 粒子生成（在 auth-wrap 内部，由 CSS 控制）
    // 注意：粒子已在 HTML 中放置，JS 只需要生成粒子元素
    (function() {
        var container = document.getElementById('particles');
        if (!container) return;
        var count = 50;
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

    // 鼠标光晕
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

    // 自动登录
    autoLogin().then(function(success) {
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
    });

    setTimeout(function() { requestNotificationPermission(); }, 5000);
    console.log('📺 班级时光机 v3.2 已启动！');
};
