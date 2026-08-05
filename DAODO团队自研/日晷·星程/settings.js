// js/settings.js

import { supabase } from './auth.js';
import { applyTheme, getToday } from './config.js';
import { loadTodos, clearDone } from './todos.js';
import { loadCompanions, getShareCode } from './companions.js';
import { loadHistory, loadSummary, renderStats } from './stats.js';
import { loadTimerSettings } from './timer.js';

let currentUser = null;

// 初始化设置模块
export function initSettings(user) {
    currentUser = user;
}

// 加载所有设置
export async function loadAllSettings() {
    if (!currentUser) return;
    try {
        const { data, error } = await supabase
            .from('sundial_settings')
            .select('*')
            .eq('user_id', currentUser.id)
            .maybeSingle();
        if (error && error.code !== 'PGRST116') {
            console.error('加载设置失败:', error);
            return;
        }
        let settings = data;
        if (!data) {
            // 创建默认设置
            settings = {
                theme: 'dark',
                sound_effect: 'bell',
                focus_duration: 25,
                break_duration: 5,
                loop_enabled: false,
                loop_count: 3
            };
            await supabase.from('sundial_settings').insert({
                user_id: currentUser.id,
                ...settings
            });
        }
        // 应用主题
        applyTheme(settings.theme || 'dark');
        // 更新UI
        document.getElementById('focusDuration').value = settings.focus_duration || 25;
        document.getElementById('breakDuration').value = settings.break_duration || 5;
        document.getElementById('loopEnable').checked = settings.loop_enabled || false;
        document.getElementById('loopCount').value = settings.loop_count || 3;
        document.getElementById('soundSelect').value = settings.sound_effect || 'bell';
        return settings;
    } catch (err) {
        console.error('设置加载异常:', err);
    }
}

// 保存设置
export async function saveSettings(updates) {
    if (!currentUser) return;
    const { error } = await supabase
        .from('sundial_settings')
        .update(updates)
        .eq('user_id', currentUser.id);
    if (error) console.error('保存设置失败:', error);
}

// ---- 主题 ----
export function initThemeSettings() {
    const themeButtons = document.querySelectorAll('.theme-options button');
    const customPanel = document.getElementById('customThemePanel');
    const applyCustomBtn = document.getElementById('applyCustomTheme');
    
    themeButtons.forEach(btn => {
        btn.addEventListener('click', async function() {
            const theme = this.dataset.theme;
            if (theme === 'custom') {
                customPanel.style.display = 'block';
                applyTheme('custom');
                await saveSettings({ theme: 'custom' });
            } else {
                customPanel.style.display = 'none';
                applyTheme(theme);
                await saveSettings({ theme: theme });
            }
            // 更新激活状态
            themeButtons.forEach(b => b.classList.remove('active-theme'));
            this.classList.add('active-theme');
        });
    });
    
    if (applyCustomBtn) {
        applyCustomBtn.addEventListener('click', async function() {
            const primary = document.getElementById('customPrimary').value;
            const bg = document.getElementById('customBg').value;
            const text = document.getElementById('customText').value;
            const customTheme = { primary, background: bg, text };
            await saveSettings({ 
                theme: 'custom',
                custom_theme: customTheme 
            });
            applyTheme('custom');
            document.querySelectorAll('.theme-options button').forEach(b => {
                b.classList.remove('active-theme');
                if (b.dataset.theme === 'custom') b.classList.add('active-theme');
            });
        });
    }
}

// ---- 个人资料 ----
export async function updateProfile(nickname, newPassword) {
    if (!currentUser) return { success: false, msg: '请先登录' };
    
    // 更新昵称
    if (nickname) {
        const { error: profileError } = await supabase
            .from('profiles')
            .update({ nickname })
            .eq('id', currentUser.id);
        if (profileError) {
            return { success: false, msg: '更新昵称失败: ' + profileError.message };
        }
    }
    
    // 更新密码
    if (newPassword && newPassword.length >= 6) {
        const { error: pwdError } = await supabase.auth.updateUser({ 
            password: newPassword 
        });
        if (pwdError) {
            return { success: false, msg: '更新密码失败: ' + pwdError.message };
        }
    } else if (newPassword && newPassword.length < 6) {
        return { success: false, msg: '密码至少6个字符' };
    }
    
    // 更新界面
    const userDisplayName = document.getElementById('userDisplayName');
    const userAvatar = document.getElementById('userAvatar');
    const profileAvatar = document.getElementById('profileAvatar');
    if (nickname) {
        userDisplayName.textContent = nickname;
        userAvatar.textContent = nickname.charAt(0).toUpperCase();
        if (profileAvatar) profileAvatar.textContent = nickname.charAt(0).toUpperCase();
    }
    
    return { success: true };
}

// ---- 导入导出 ----
export function exportData(todos, history, companions, settings) {
    const exportObj = {
        todos,
        history,
        companions,
        settings,
        exportedAt: new Date().toISOString(),
        version: '2.0'
    };
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sundial_backup_${getToday()}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

export function importData(file, onComplete) {
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            if (!confirm('导入将覆盖当前所有数据，是否继续？')) return;
            
            if (!currentUser) {
                alert('请先登录');
                return;
            }
            
            // 导入待办
            if (imported.todos && imported.todos.length > 0) {
                for (const todo of imported.todos) {
                    delete todo.id;
                    todo.user_id = currentUser.id;
                    await supabase.from('sundial_todos').insert(todo);
                }
            }
            
            // 导入历史
            if (imported.history) {
                for (const date in imported.history) {
                    const h = imported.history[date];
                    h.user_id = currentUser.id;
                    h.date = date;
                    await supabase.from('sundial_history').upsert(h, { onConflict: 'user_id,date' });
                }
            }
            
            // 导入星伴
            if (imported.companions) {
                for (const c of imported.companions) {
                    const { data: profile } = await supabase
                        .from('profiles')
                        .select('id')
                        .eq('share_code', c.share_code)
                        .single();
                    if (profile && profile.id !== currentUser.id) {
                        await supabase.from('sundial_companions').insert({
                            user_id: currentUser.id,
                            companion_user_id: profile.id,
                            share_code: c.share_code
                        });
                    }
                }
            }
            
            // 导入设置
            if (imported.settings) {
                const { theme, sound_effect, focus_duration, break_duration, loop_enabled, loop_count } = imported.settings;
                await supabase.from('sundial_settings').upsert({
                    user_id: currentUser.id,
                    theme: theme || 'dark',
                    sound_effect: sound_effect || 'bell',
                    focus_duration: focus_duration || 25,
                    break_duration: break_duration || 5,
                    loop_enabled: loop_enabled || false,
                    loop_count: loop_count || 3
                }, { onConflict: 'user_id' });
            }
            
            alert('导入成功！正在刷新数据...');
            if (onComplete) onComplete();
        } catch(err) {
            alert('导入失败，文件格式错误: ' + err.message);
        }
    };
    reader.readAsText(file);
}