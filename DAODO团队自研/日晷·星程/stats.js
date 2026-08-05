// js/stats.js

import { supabase } from './auth.js';
import { getToday } from './config.js';

let currentUser = null;
let historyData = {};
let chartInstance = null;

// 初始化统计模块
export function initStats(user) {
    currentUser = user;
}

// 加载历史数据
export async function loadHistory() {
    if (!currentUser) return;
    try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const { data, error } = await supabase
            .from('sundial_history')
            .select('*')
            .eq('user_id', currentUser.id)
            .gte('date', sevenDaysAgo);
        if (error) {
            console.error('加载历史失败:', error);
            historyData = {};
            return;
        }
        historyData = {};
        (data || []).forEach(h => { historyData[h.date] = h; });
    } catch (err) {
        console.error('历史加载异常:', err);
        historyData = {};
    }
}

// 更新历史（由todos调用）
export async function updateHistory(done, focus) {
    if (!currentUser) return;
    const today = getToday();
    const { error } = await supabase
        .from('sundial_history')
        .upsert({
            user_id: currentUser.id,
            date: today,
            done_count: done,
            focus_minutes: focus
        }, { onConflict: 'user_id,date' });
    if (error) console.error('更新历史失败:', error);
}

// 渲染统计图表
export function renderStats() {
    const dates = Object.keys(historyData).sort();
    const last7 = dates.slice(-7);
    const labels = last7.map(d => d.slice(5));
    const doneData = last7.map(d => historyData[d]?.done_count || 0);
    const focusData = last7.map(d => historyData[d]?.focus_minutes || 0);
    const weekDone = doneData.reduce((a, b) => a + b, 0);
    const weekFocus = focusData.reduce((a, b) => a + b, 0);
    
    document.getElementById('weekDone').textContent = weekDone;
    document.getElementById('weekFocus').textContent = weekFocus;
    
    const ctx = document.getElementById('statsChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: '完成数',
                    data: doneData,
                    backgroundColor: 'rgba(108,140,255,0.6)',
                    borderColor: '#6c8cff',
                    borderWidth: 1
                },
                {
                    label: '专注分钟',
                    data: focusData,
                    backgroundColor: 'rgba(167,124,255,0.6)',
                    borderColor: '#a77cff',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: getComputedStyle(document.body).getPropertyValue('--text-secondary').trim()
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: getComputedStyle(document.body).getPropertyValue('--text-muted').trim()
                    }
                },
                x: {
                    ticks: {
                        color: getComputedStyle(document.body).getPropertyValue('--text-muted').trim()
                    }
                }
            }
        }
    });
}

// 加载小结
export async function loadSummary() {
    if (!currentUser) return;
    try {
        const today = getToday();
        const { data, error } = await supabase
            .from('sundial_history')
            .select('summary')
            .eq('user_id', currentUser.id)
            .eq('date', today)
            .maybeSingle();
        if (error && error.code !== 'PGRST116') {
            console.error('加载小结失败:', error);
            return;
        }
        const savedSummary = document.getElementById('savedSummary');
        const summaryInput = document.getElementById('summaryInput');
        if (data && data.summary) {
            savedSummary.textContent = data.summary;
            savedSummary.classList.add('show');
            summaryInput.value = data.summary;
        } else {
            savedSummary.classList.remove('show');
            summaryInput.value = '';
        }
    } catch (err) {
        console.error('小结加载异常:', err);
    }
}

// 保存小结
export async function saveSummary(text) {
    if (!currentUser) return;
    const today = getToday();
    const { error } = await supabase
        .from('sundial_history')
        .upsert({
            user_id: currentUser.id,
            date: today,
            summary: text,
            done_count: 0,
            focus_minutes: 0
        }, { onConflict: 'user_id,date' });
    if (error) {
        console.error('保存小结失败:', error);
        return;
    }
    await loadSummary();
    const btn = document.getElementById('saveSummaryBtn');
    btn.innerHTML = '<i class="fas fa-check"></i> 已保存';
    setTimeout(() => {
        btn.innerHTML = '<i class="fas fa-save"></i> 保存';
    }, 1500);
}