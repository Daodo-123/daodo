// js/companions.js

import { supabase } from './auth.js';
import { escapeHtml } from './config.js';

let currentUser = null;
let companions = [];

// 初始化星伴模块
export function initCompanions(user) {
    currentUser = user;
}

// 加载星伴
export async function loadCompanions() {
    if (!currentUser) return;
    // 分两次查询，避免外键语法错误
    const { data: myCompanions, error: companionsError } = await supabase
        .from('sundial_companions')
        .select('*')
        .eq('user_id', currentUser.id);
    if (companionsError) {
        console.error('加载星伴关系失败:', companionsError);
        return;
    }
    if (!myCompanions || myCompanions.length === 0) {
        companions = [];
        renderCompanions();
        return;
    }
    const ids = myCompanions.map(c => c.companion_user_id);
    const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, nickname, share_code')
        .in('id', ids);
    if (profilesError) {
        console.error('加载星伴资料失败:', profilesError);
        companions = myCompanions.map(c => ({ ...c, profiles: null }));
        renderCompanions();
        return;
    }
    companions = myCompanions.map(c => {
        const profile = profiles.find(p => p.id === c.companion_user_id);
        return { ...c, profiles: profile };
    });
    renderCompanions();
}

// 渲染星伴列表
export function renderCompanions() {
    const container = document.getElementById('companionListModal');
    if (!container) return;
    if (companions.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:12px 0;">暂无星伴</div>';
        return;
    }
    let html = '';
    companions.forEach(c => {
        const profile = c.profiles;
        const status = c.last_sync && new Date(c.last_sync).toDateString() === new Date().toDateString() ? 'online' : 'offline';
        const statusLabel = status === 'online' ? '今日已打卡' : '今日未打卡';
        html += `
            <div class="companion-item-modal" data-id="${c.id}">
                <div class="info">
                    <div class="avatar">${(profile?.nickname || '?').charAt(0).toUpperCase()}</div>
                    <div>
                        <span style="color:var(--text-primary);">${escapeHtml(profile?.nickname || '未知')}</span>
                        <span class="status-dot ${status}"></span>
                        <span style="font-size:0.7rem;color:var(--text-muted);">${statusLabel}</span>
                    </div>
                </div>
                <div class="actions">
                    <button class="companion-sync" data-id="${c.id}" title="同步状态"><i class="fas fa-sync"></i></button>
                    <button class="companion-delete" data-id="${c.id}" title="移除"><i class="fas fa-times"></i></button>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

// 获取分享码
export async function getShareCode() {
    if (!currentUser) return '#XXXXXX';
    const { data, error } = await supabase
        .from('profiles')
        .select('share_code')
        .eq('id', currentUser.id)
        .single();
    if (error || !data?.share_code) {
        const code = '#' + Math.random().toString(36).substr(2, 6).toUpperCase();
        await supabase.from('profiles').update({ share_code: code }).eq('id', currentUser.id);
        return code;
    }
    return data.share_code;
}

// 添加星伴
export async function addCompanion(name, code) {
    if (!currentUser) return { success: false, msg: '请先登录' };
    if (!name || !code) return { success: false, msg: '请填写昵称和分享码' };
    if (!code.startsWith('#')) return { success: false, msg: '分享码格式应为 #XXXXXX' };
    
    const { data: profile, error } = await supabase
        .from('profiles')
        .select('id')
        .eq('share_code', code)
        .single();
    if (error || !profile) {
        return { success: false, msg: '未找到该分享码对应的用户' };
    }
    if (profile.id === currentUser.id) {
        return { success: false, msg: '不能添加自己为星伴' };
    }
    if (companions.some(c => c.companion_user_id === profile.id)) {
        return { success: false, msg: '该用户已是你的星伴' };
    }
    const { error: insertError } = await supabase
        .from('sundial_companions')
        .insert({
            user_id: currentUser.id,
            companion_user_id: profile.id,
            share_code: code
        });
    if (insertError) {
        console.error('添加星伴失败:', insertError);
        return { success: false, msg: '添加失败，请重试' };
    }
    await loadCompanions();
    return { success: true };
}

// 同步星伴
export async function syncCompanion(id) {
    const { error } = await supabase
        .from('sundial_companions')
        .update({ last_sync: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', currentUser.id);
    if (error) {
        console.error('同步失败:', error);
        return { success: false };
    }
    await loadCompanions();
    return { success: true };
}

// 删除星伴
export async function deleteCompanion(id) {
    if (!confirm('确定移除这位星伴吗？')) return { success: false };
    const { error } = await supabase
        .from('sundial_companions')
        .delete()
        .eq('id', id)
        .eq('user_id', currentUser.id);
    if (error) {
        console.error('移除失败:', error);
        return { success: false };
    }
    await loadCompanions();
    return { success: true };
}