document.addEventListener('DOMContentLoaded', checkLogin);

function checkLogin() {
    const token = sessionStorage.getItem('admin_token');
    if (token) {
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('admin-content').style.display = 'flex';
        fetchStats(token);
    } else {
        setupLoginForm();
    }
}

function setupLoginForm() {
    const loginBtn = document.getElementById('login-btn');
    const userIn = document.getElementById('admin-username');
    const passIn = document.getElementById('admin-password');
    const errText = document.getElementById('login-error');

    loginBtn.addEventListener('click', async () => {
        const u = userIn.value.trim();
        const p = passIn.value;
        if (!u || !p) {
            errText.textContent = 'Please enter username and password';
            return;
        }

        // Encode credentials for Basic Auth
        const token = btoa(u + ':' + p);
        
        loginBtn.textContent = 'Loading...';
        loginBtn.disabled = true;

        const success = await fetchStats(token);
        
        loginBtn.textContent = 'Login';
        loginBtn.disabled = false;

        if (success) {
            sessionStorage.setItem('admin_token', token);
            document.getElementById('login-overlay').style.display = 'none';
            document.getElementById('admin-content').style.display = 'flex';
        } else {
            errText.textContent = 'Invalid username or password';
        }
    });

    passIn.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') loginBtn.click();
    });
}

async function fetchStats(token) {
    if (!token) return false;

    try {
        const response = await fetch('/api/stats', {
            headers: {
                'Authorization': 'Basic ' + token
            }
        });
        
        const data = await response.json();

        if (response.status === 401) {
            sessionStorage.removeItem('admin_token');
            return false;
        }

        if (data.error) {
            alert('Error loading stats: ' + data.error);
            return false;
        }

        renderStats(data.stats || []);
        renderCharts(data.stats || []);
        return true;
    } catch (err) {
        console.error(err);
        document.getElementById('stats-table-body').innerHTML = '<tr><td colspan="4" style="text-align: center; color: #ef4444;">Failed to load data.</td></tr>';
        return false;
    }
}

function renderStats(stats) {
    const tableBody = document.getElementById('stats-table-body');
    const totalUsersEl = document.getElementById('total-users');
    const totalRequestsEl = document.getElementById('total-requests');
    const totalTokensEl = document.getElementById('total-tokens');

    if (stats.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No usage data found.</td></tr>';
        totalUsersEl.textContent = '0';
        totalRequestsEl.textContent = '0';
        totalTokensEl.textContent = '0';
        return;
    }

    let html = '';
    let totalReqs = 0;
    let totalTks = 0;

    stats.forEach(row => {
        totalReqs += row.requests_count || 0;
        totalTks += row.tokens_used || 0;

        const date = new Date(row.last_active).toLocaleString('th-TH');

        html += `
            <tr>
                <td style="font-family: var(--font-mono); font-weight: 500;">${escapeHtml(row.username)}</td>
                <td style="color: var(--text-muted); font-size: 0.9rem;">${escapeHtml(row.ip_address || '-')}</td>
                <td>${(row.requests_count || 0).toLocaleString()}</td>
                <td style="color: #4ade80; font-weight: 600;">${(row.tokens_used || 0).toLocaleString()}</td>
                <td style="color: var(--text-muted); font-size: 0.85rem;">${date}</td>
            </tr>
        `;
    });

    tableBody.innerHTML = html;
    totalUsersEl.textContent = stats.length.toLocaleString();
    totalRequestsEl.textContent = totalReqs.toLocaleString();
    totalTokensEl.textContent = totalTks.toLocaleString();
}

/* ============================================================
   Charts (Chart.js)
   ============================================================ */

// Hold chart instances to destroy before re-render (prevents memory leak)
const charts = {};

const CHART_PALETTE = [
    '#a8c7fa', '#4ade80', '#fbbf24', '#f87171', '#a78bfa',
    '#22d3ee', '#fb923c', '#e879f9'
];

const CHART_DEFAULTS = {
    color: '#8e918f',
    borderColor: 'rgba(255,255,255,0.06)',
    font: { family: "'Inter', system-ui, sans-serif" }
};

function showChartEmpty(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const wrap = canvas.parentElement;
    canvas.style.display = 'none';
    if (!wrap.querySelector('.chart-empty')) {
        const msg = document.createElement('div');
        msg.className = 'chart-empty';
        msg.textContent = 'No data';
        wrap.appendChild(msg);
    }
}

function clearChartEmpty(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    canvas.style.display = '';
    const empty = canvas.parentElement.querySelector('.chart-empty');
    if (empty) empty.remove();
}

function destroyChart(key) {
    if (charts[key]) {
        charts[key].destroy();
        delete charts[key];
    }
}

function renderCharts(stats) {
    // Always destroy previous instances first
    Object.keys(charts).forEach(destroyChart);

    const hasData = stats && stats.length > 0;

    // 1) Top 10 Users by Tokens — horizontal bar
    if (hasData) {
        const top = [...stats]
            .sort((a, b) => (b.tokens_used || 0) - (a.tokens_used || 0))
            .slice(0, 10);
        const labels = top.map(r => truncate(r.username || 'unknown', 14));
        const tokens = top.map(r => r.tokens_used || 0);

        if (tokens.every(v => v === 0)) {
            showChartEmpty('top-users-chart');
        } else {
            clearChartEmpty('top-users-chart');
            const ctx = document.getElementById('top-users-chart').getContext('2d');
            const grad = ctx.createLinearGradient(0, 0, 400, 0);
            grad.addColorStop(0, 'rgba(168, 199, 250, 0.4)');
            grad.addColorStop(1, 'rgba(168, 199, 250, 0.95)');

            charts.topUsers = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Tokens',
                        data: tokens,
                        backgroundColor: grad,
                        borderColor: '#a8c7fa',
                        borderWidth: 1,
                        borderRadius: 4,
                        borderSkipped: false
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: chartTooltip()
                    },
                    scales: {
                        x: {
                            grid: { color: CHART_DEFAULTS.borderColor, drawBorder: false },
                            ticks: { color: CHART_DEFAULTS.color, callback: v => Number(v).toLocaleString() }
                        },
                        y: {
                            grid: { display: false, drawBorder: false },
                            ticks: { color: CHART_DEFAULTS.color, font: { family: "ui-monospace, monospace", size: 11 } }
                        }
                    }
                }
            });
        }
    } else {
        showChartEmpty('top-users-chart');
    }

    // 2) Token Distribution — doughnut (top 8 + Other)
    if (hasData) {
        const sorted = [...stats].sort((a, b) => (b.tokens_used || 0) - (a.tokens_used || 0));
        const totalTokens = sorted.reduce((s, r) => s + (r.tokens_used || 0), 0);

        if (totalTokens === 0) {
            showChartEmpty('token-dist-chart');
        } else {
            let labels, data;
            if (sorted.length <= 8) {
                labels = sorted.map(r => truncate(r.username || 'unknown', 12));
                data = sorted.map(r => r.tokens_used || 0);
            } else {
                const top8 = sorted.slice(0, 8);
                const rest = sorted.slice(8);
                labels = [...top8.map(r => truncate(r.username || 'unknown', 12)), 'Other'];
                data = [...top8.map(r => r.tokens_used || 0), rest.reduce((s, r) => s + (r.tokens_used || 0), 0)];
            }

            clearChartEmpty('token-dist-chart');
            const ctx = document.getElementById('token-dist-chart').getContext('2d');
            charts.tokenDist = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels,
                    datasets: [{
                        data,
                        backgroundColor: labels.map((_, i) =>
                            i === labels.length - 1 && labels[labels.length - 1] === 'Other'
                                ? '#3a3d40'
                                : CHART_PALETTE[i % CHART_PALETTE.length]
                        ),
                        borderColor: '#131314',
                        borderWidth: 2,
                        hoverOffset: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '62%',
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                color: CHART_DEFAULTS.color,
                                boxWidth: 10,
                                boxHeight: 10,
                                padding: 12,
                                font: { size: 11 }
                            }
                        },
                        tooltip: chartTooltip((ctx) => {
                            const total = ctx.dataset.data.reduce((s, v) => s + v, 0);
                            const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
                            return `${ctx.label}: ${ctx.parsed.toLocaleString()} tokens (${pct}%)`;
                        })
                    }
                }
            });
        }
    } else {
        showChartEmpty('token-dist-chart');
    }

    // 3) Requests vs Tokens — scatter
    if (hasData) {
        const points = stats.map(r => ({
            x: r.requests_count || 0,
            y: r.tokens_used || 0,
            label: r.username || 'unknown'
        }));

        if (points.every(p => p.x === 0 && p.y === 0)) {
            showChartEmpty('scatter-chart');
        } else {
            clearChartEmpty('scatter-chart');
            const ctx = document.getElementById('scatter-chart').getContext('2d');
            charts.scatter = new Chart(ctx, {
                type: 'scatter',
                data: {
                    datasets: [{
                        label: 'Users',
                        data: points,
                        backgroundColor: 'rgba(168, 199, 250, 0.6)',
                        borderColor: '#a8c7fa',
                        borderWidth: 1.5,
                        pointRadius: (ctx) => {
                            const v = ctx.raw?.y || 0;
                            const r = Math.sqrt(Math.max(v, 1)) / 4;
                            return Math.max(5, Math.min(r, 16));
                        },
                        pointHoverRadius: 10
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: chartTooltip((ctx) =>
                            `${ctx.raw.label}\nRequests: ${ctx.raw.x.toLocaleString()}\nTokens: ${ctx.raw.y.toLocaleString()}`
                        )
                    },
                    scales: {
                        x: {
                            title: { display: true, text: 'Requests', color: CHART_DEFAULTS.color, font: { size: 11 } },
                            grid: { color: CHART_DEFAULTS.borderColor, drawBorder: false },
                            ticks: { color: CHART_DEFAULTS.color, callback: v => Number(v).toLocaleString() },
                            beginAtZero: true
                        },
                        y: {
                            title: { display: true, text: 'Tokens', color: CHART_DEFAULTS.color, font: { size: 11 } },
                            grid: { color: CHART_DEFAULTS.borderColor, drawBorder: false },
                            ticks: { color: CHART_DEFAULTS.color, callback: v => Number(v).toLocaleString() },
                            beginAtZero: true
                        }
                    }
                }
            });
        }
    } else {
        showChartEmpty('scatter-chart');
    }

    // 4) Daily Activity — line (last 14 days, derived from last_active)
    const days = 14;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dayBuckets = [];
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        dayBuckets.push({
            date: d,
            key: dateKey(d),
            label: `${d.getDate()}/${d.getMonth() + 1}`,
            users: 0,
            tokens: 0,
            userSet: new Set()
        });
    }

    if (hasData) {
        stats.forEach(row => {
            if (!row.last_active) return;
            const ts = new Date(row.last_active);
            if (isNaN(ts)) return;
            const k = dateKey(ts);
            const bucket = dayBuckets.find(b => b.key === k);
            if (bucket) {
                if (!bucket.userSet.has(row.username)) {
                    bucket.userSet.add(row.username);
                    bucket.users += 1;
                }
                bucket.tokens += row.tokens_used || 0;
            }
        });

        const hasAnyActivity = dayBuckets.some(b => b.users > 0 || b.tokens > 0);
        if (!hasAnyActivity) {
            showChartEmpty('daily-activity-chart');
        } else {
            clearChartEmpty('daily-activity-chart');
            const ctx = document.getElementById('daily-activity-chart').getContext('2d');
            charts.dailyActivity = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: dayBuckets.map(b => b.label),
                    datasets: [{
                        label: 'Active Users',
                        data: dayBuckets.map(b => b.users),
                        borderColor: '#a8c7fa',
                        backgroundColor: 'rgba(168, 199, 250, 0.1)',
                        borderWidth: 2,
                        tension: 0.35,
                        fill: true,
                        pointRadius: 3,
                        pointHoverRadius: 6,
                        pointBackgroundColor: '#a8c7fa',
                        pointBorderColor: '#131314',
                        pointBorderWidth: 1.5
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { display: false },
                        tooltip: chartTooltip((ctx) => {
                            const b = dayBuckets[ctx.dataIndex];
                            return `${b.label}\nActive users: ${b.users}\nTokens: ${b.tokens.toLocaleString()}`;
                        })
                    },
                    scales: {
                        x: {
                            grid: { color: CHART_DEFAULTS.borderColor, drawBorder: false },
                            ticks: { color: CHART_DEFAULTS.color, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 }
                        },
                        y: {
                            grid: { color: CHART_DEFAULTS.borderColor, drawBorder: false },
                            ticks: { color: CHART_DEFAULTS.color, precision: 0 },
                            beginAtZero: true
                        }
                    }
                }
            });
        }
    } else {
        showChartEmpty('daily-activity-chart');
    }
}

function chartTooltip(labelFn) {
    return {
        backgroundColor: '#1e1f20',
        titleColor: '#e3e3e3',
        bodyColor: '#e3e3e3',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        padding: 12,
        cornerRadius: 6,
        displayColors: false,
        callbacks: labelFn ? { label: labelFn } : undefined
    };
}

function dateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function truncate(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function escapeHtml(unsafe) {
    return (unsafe || '').toString()
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}
