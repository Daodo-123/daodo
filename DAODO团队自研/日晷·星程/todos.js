// js/todos.js

import { supabase } from './auth.js';
import { getToday, escapeHtml, launchConfetti } from './config.js';

let currentUser = null;
let todos = [];
let todoListElement, doneCount, totalCount, focusCount, progressCircle, progressText;

// 初始化待办模块
export function initTodos(elements, user) {
    currentUser = user;
    todoListElement = elements.todoList;
    doneCount = elements.doneCount;
    totalCount = elements.totalCount;
    focusCount = elements.focusCount;
    progressCircle = elements.progressCircle;
    progressText = elements.progressText;
}

// 加载待办
export async function loadTodos() {
    if (!currentUser) return;
    const { data, error } = await supabase
        .from('sundial_todos')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });
    if (error) {
        console.error('加载待办失败:', error);
        return;
    }
    todos = data || [];
    renderTodos();
}

// 渲染待办列表
function renderTodos() {
    const sorted = [...todos].sort((a, b) => {
        if (a.done && !b.done) return 1;
        if (!a.done && b.done) return -1;
        if (a.deadline && b.deadline) return new Date(a.deadline) - new Date(b.deadline);
        if (a.deadline) return -1;
        if (b.deadline) return 1;
        return 0;
    });
    if (sorted.length === 0) {
        todoListElement.innerHTML = '<li class="empty-tip"><i class="fas fa-star"></i> 今天还没有计划<br /><span style="font-size:0.8rem;">添加你的第一颗星星吧</span></li>';
    } else {
        let html = '';
        const now = new Date();
        sorted.forEach(todo => {
            const doneClass = todo.done ? 'done' : '';
            const textClass = todo.done ? 'done-text' : '';
            let priorityClass = 'priority-low';
            if (todo.priority === 'high') priorityClass = 'priority-high';
            else if (todo.priority === 'medium') priorityClass = 'priority-medium';
            const priorityLabel = { high: '紧急', medium: '重要', low: '日常' }[todo.priority] || '日常';
            let overdue = false;
            if (todo.deadline && !todo.done) {
                const d = new Date(todo.deadline);
                if (d < now) overdue = true;
            }
            const overdueClass = overdue ? 'overdue' : '';
            const deadlineStr = todo.deadline ? new Date(todo.deadline).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
            const repeatLabel = todo.repeat_type === 'daily' ? '🔄每日' : todo.repeat_type === 'weekly' ? '🔄每周' : '';
            html += `
                <li class="todo-item ${priorityClass} ${overdueClass}" data-id="${todo.id}">
                    <div class="checkbox ${doneClass}" data-action="toggle" data-id="${todo.id}">
                        ${todo.done ? '<i class="fas fa-check"></i>' : ''}
                    </div>
                    <span class="todo-text ${textClass}">${escapeHtml(todo.text)}</span>
                    <span class="priority-badge">${priorityLabel}</span>
                    ${deadlineStr ? `<span class="todo-deadline">⏰ ${deadlineStr}</span>` : ''}
                    ${repeatLabel ? `<span class="todo-deadline" style="color:var(--accent-blue);">${repeatLabel}</span>` : ''}
                    <div class="actions">
                        <button class="focus-btn" data-action="focus" data-id="${todo.id}" title="专注"><i class="fas fa-play-circle"></i></button>
                        <button class="delete-btn" data-action="delete" data-id="${todo.id}" title="删除"><i class="fas fa-trash"></i></button>
                    </div>
                </li>
            `;
        });
        todoListElement.innerHTML = html;
    }
    updateProgress();
}

// 更新进度环和统计
function updateProgress() {
    const total = todos.length;
    const done = todos.filter(t => t.done).length;
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);
    const circumference = 2 * Math.PI * 22;
    const offset = circumference - (percent / 100) * circumference;
    progressCircle.setAttribute('stroke-dasharray', `${circumference - offset} ${circumference}`);
    progressText.textContent = `${percent}%`;
    if (percent === 100 && total > 0) launchConfetti();
    doneCount.textContent = done;
    totalCount.textContent = total;
    let totalFocus = 0;
    todos.forEach(t => { if (t.timer_minutes) totalFocus += t.timer_minutes; });
    focusCount.textContent = totalFocus;
    // 更新历史（由 stats 模块处理，此处留空）
}

// 添加待办
export async function addTodo(text, priority, repeat_type, deadline) {
    if (!currentUser) return;
    const newTodo = {
        user_id: currentUser.id,
        text,
        priority,
        repeat_type: repeat_type || 'none',
        deadline: deadline || null,
        done: false,
        timer_minutes: 0,
        reminded: false
    };
    const { data, error } = await supabase
        .from('sundial_todos')
        .insert(newTodo)
        .select()
        .single();
    if (error) {
        console.error('添加待办失败:', error);
        throw error;
    }
    todos.push(data);
    renderTodos();
    return data;
}

// 切换完成状态
export async function toggleTodo(id) {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    const newDone = !todo.done;
    const { error } = await supabase
        .from('sundial_todos')
        .update({ done: newDone })
        .eq('id', id)
        .eq('user_id', currentUser.id);
    if (error) {
        console.error('切换状态失败:', error);
        return;
    }
    todo.done = newDone;
    renderTodos();
}

// 删除待办
export async function deleteTodo(id) {
    if (!confirm('确定删除此任务吗？')) return;
    const { error } = await supabase
        .from('sundial_todos')
        .delete()
        .eq('id', id)
        .eq('user_id', currentUser.id);
    if (error) {
        console.error('删除失败:', error);
        return;
    }
    todos = todos.filter(t => t.id !== id);
    renderTodos();
}

// 清除已完成
export async function clearDone() {
    const doneIds = todos.filter(t => t.done).map(t => t.id);
    if (doneIds.length === 0) return;
    if (!confirm(`确定清除所有已完成任务（${doneIds.length}项）吗？`)) return;
    const { error } = await supabase
        .from('sundial_todos')
        .delete()
        .in('id', doneIds)
        .eq('user_id', currentUser.id);
    if (error) {
        console.error('清除失败:', error);
        return;
    }
    todos = todos.filter(t => !t.done);
    renderTodos();
}

// 获取待办列表（供 timer 模块使用）
export function getTodos() {
    return todos;
}

// 更新任务的专注时长（由 timer 调用）
export async function updateTodoTimer(id, minutes) {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    todo.timer_minutes = (todo.timer_minutes || 0) + minutes;
    const { error } = await supabase
        .from('sundial_todos')
        .update({ timer_minutes: todo.timer_minutes })
        .eq('id', id)
        .eq('user_id', currentUser.id);
    if (error) console.error('更新专注时长失败:', error);
    else renderTodos();
}