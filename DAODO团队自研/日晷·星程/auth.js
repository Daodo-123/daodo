// js/auth.js

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// DOM 元素（将在 main.js 中传入）
let authOverlay, authEmail, authPassword, authSubmitBtn, authSwitch, authTitle, authError, resetPwdLink;
let mainApp;
let currentUser = null;

// 初始化认证 DOM 引用
export function initAuthElements(elements) {
    authOverlay = elements.authOverlay;
    authEmail = elements.authEmail;
    authPassword = elements.authPassword;
    authSubmitBtn = elements.authSubmitBtn;
    authSwitch = elements.authSwitch;
    authTitle = elements.authTitle;
    authError = elements.authError;
    resetPwdLink = elements.resetPwdLink;
    mainApp = elements.mainApp;
}

// 获取当前用户
export function getCurrentUser() {
    return currentUser;
}

// 设置当前用户（供外部更新）
export function setCurrentUser(user) {
    currentUser = user;
}

// 检查登录状态
export async function checkSession() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        currentUser = session.user;
        return true;
    }
    return false;
}

// 登录
export async function login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    currentUser = data.user;
    return data.user;
}

// 注册
export async function signUp(email, password) {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    currentUser = data.user;
    return data.user;
}

// 退出
export async function logout() {
    await supabase.auth.signOut();
    currentUser = null;
}

// 重置密码
export async function resetPassword(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
}

// 确保用户有 profiles 记录
export async function ensureProfile(userId, email) {
    const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .single();
    if (error && error.code === 'PGRST116') {
        // 不存在则创建
        const nickname = email.split('@')[0];
        await supabase.from('profiles').insert({
            id: userId,
            email: email,
            nickname: nickname,
            role: 'user'
        });
        // 生成分享码
        const code = '#' + Math.random().toString(36).substr(2,6).toUpperCase();
        await supabase.from('profiles').update({ share_code: code }).eq('id', userId);
    }
}

// 更新个人资料（昵称、密码）
export async function updateProfile(userId, nickname, newPassword) {
    if (nickname) {
        const { error } = await supabase.from('profiles').update({ nickname }).eq('id', userId);
        if (error) throw error;
    }
    if (newPassword) {
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw error;
    }
}

// 获取用户资料（昵称、分享码等）
export async function getUserProfile(userId) {
    const { data, error } = await supabase
        .from('profiles')
        .select('nickname, share_code, role')
        .eq('id', userId)
        .single();
    if (error) throw error;
    return data;
}