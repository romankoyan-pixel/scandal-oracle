// Frontend Application Logic - CYCLE-BASED with Supply Tracking
const API_URL = ''; // Use relative URLs for same-origin requests
const CYCLE_DURATION = 120000; // 2 minutes
const INITIAL_SUPPLY = 1000000000; // 1 Billion tokens

// ============================================
// DYNAMIC RATE - DISCRETE STEPS
// 0.10%, 0.15%, 0.20%, 0.25%, 0.30%
// ============================================
function calculateDynamicRate(avgScore) {
    // MINT zone: 0-32
    if (avgScore < 33) {
        let rate;
        if (avgScore <= 6) rate = 0.0030;       // 0.30%
        else if (avgScore <= 13) rate = 0.0025; // 0.25%
        else if (avgScore <= 19) rate = 0.0020; // 0.20%
        else if (avgScore <= 26) rate = 0.0015; // 0.15%
        else rate = 0.0010;                      // 0.10%
        return { action: 'MINT', rate: rate };
    }

    // BURN zone: 67-100
    if (avgScore > 66) {
        let rate;
        if (avgScore >= 94) rate = 0.0030;      // 0.30%
        else if (avgScore >= 87) rate = 0.0025; // 0.25%
        else if (avgScore >= 81) rate = 0.0020; // 0.20%
        else if (avgScore >= 74) rate = 0.0015; // 0.15%
        else rate = 0.0010;                      // 0.10%
        return { action: 'BURN', rate: rate };
    }

    // NEUTRAL: 33-66
    return { action: 'NEUTRAL', rate: 0 };
}

class ScandalOracle {
    constructor() {
        this.currentCycle = null;
        this.completedCycles = [];
        this.expandedArticles = new Set();
        this.cycleStartTime = Date.now();

        // Supply tracking
        this.totalSupply = INITIAL_SUPPLY;
        this.supplyHistory = [{
            cycle: 0,
            supply: INITIAL_SUPPLY,
            action: 'GENESIS',
            timestamp: Date.now()
        }];

        // Load history from localStorage
        this.loadHistory();

        this.supplyChart = null;
        this.fullSupplyChart = null;
        this.lastRenderKey = '';
        this.chartDisplayLimit = 100; // Default: show last 100 cycles
        this.modalChartDisplayLimit = 'all'; // Default: show all in modal

        this.init();
    }

    init() {
        this.syncCycleId(); // Sync cycle ID with server
        this.fetchNews();
        setInterval(() => this.fetchNews(), 5000);
        setInterval(() => this.updateTimer(), 1000);
        this.initChart();
        this.setupModal();
        this.setupChartRangeButtons();
    }

    // Sync cycle ID from localStorage to server (one-time fix)
    async syncCycleId() {
        if (this.supplyHistory.length > 1) {
            const maxCycleId = Math.max(...this.supplyHistory.map(h => h.cycle));
            if (maxCycleId > 10) { // Only sync if we have significant history
                try {
                    const response = await fetch(`${API_URL}/api/sync-cycle-id`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ lastCycleId: maxCycleId })
                    });
                    const result = await response.json();
                    if (result.success) {
                        console.log(`🔄 Synced cycle ID to ${result.newCycleId}`);
                    }
                } catch (e) {
                    console.log('Could not sync cycle ID');
                }
            }
        }
    }

    loadHistory() {
        const saved = localStorage.getItem('scandalSupplyHistory');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                this.supplyHistory = data.history || this.supplyHistory;
                this.totalSupply = data.supply || INITIAL_SUPPLY;
            } catch (e) {
                console.error('Error loading history:', e);
            }
        }
    }

    saveHistory() {
        localStorage.setItem('scandalSupplyHistory', JSON.stringify({
            history: this.supplyHistory,
            supply: this.totalSupply
        }));
    }

    async fetchNews() {
        try {
            const response = await fetch(`${API_URL}/api/news`);
            const data = await response.json();

            if (data.currentCycle) {
                const prevCycleId = this.currentCycle?.id;
                this.currentCycle = data.currentCycle;
                this.completedCycles = data.completedCycles || [];
                this.cycleStartTime = data.currentCycle.startTime;

                // Check if new cycle completed
                if (data.completedCycles.length > 0) {
                    const latestCompleted = data.completedCycles[0];
                    const lastRecorded = this.supplyHistory[this.supplyHistory.length - 1];

                    if (latestCompleted.id !== lastRecorded?.cycle) {
                        this.recordCycleResult(latestCompleted);
                    }
                }

                this.updateUI();
            }
        } catch (error) {
            console.error('Error fetching news:', error);
        }
    }

    recordCycleResult(cycle) {
        // Use dynamic rate from server or calculate locally
        const rate = cycle.rate || calculateDynamicRate(cycle.averageScore).rate;
        let change = 0;

        if (cycle.action === 'MINT') {
            change = Math.floor(this.totalSupply * rate);
            this.totalSupply += change;
        } else if (cycle.action === 'BURN') {
            change = Math.floor(this.totalSupply * rate);
            this.totalSupply -= change;
        }

        this.supplyHistory.push({
            cycle: cycle.id,
            supply: this.totalSupply,
            action: cycle.action,
            change: change,
            rate: rate,
            score: cycle.averageScore,
            timestamp: cycle.endTime
        });

        this.saveHistory();
        this.updateChart();
    }

    calculateProjectedImpact() {
        if (!this.currentCycle) return { change: 0, newSupply: this.totalSupply, rate: 0 };

        const avgScore = this.currentCycle.averageScore;
        const rateInfo = calculateDynamicRate(avgScore);
        let change = 0;

        if (rateInfo.action === 'MINT') {
            change = Math.floor(this.totalSupply * rateInfo.rate);
        } else if (rateInfo.action === 'BURN') {
            change = -Math.floor(this.totalSupply * rateInfo.rate);
        }

        return {
            change: change,
            newSupply: this.totalSupply + change,
            action: rateInfo.action,
            rate: rateInfo.rate,
            ratePercentage: (rateInfo.rate * 100).toFixed(2) + '%'
        };
    }

    formatNumber(num) {
        if (num >= 1e9) return (num / 1e9).toFixed(3) + 'B';
        if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
        if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
        return num.toLocaleString();
    }

    formatChange(num) {
        const prefix = num >= 0 ? '+' : '';
        return prefix + this.formatNumber(Math.abs(num));
    }

    updateTimer() {
        const elapsed = Date.now() - this.cycleStartTime;
        const remaining = Math.max(0, CYCLE_DURATION - elapsed);

        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);

        document.getElementById('cycleTimer').textContent =
            `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    updateUI() {
        if (!this.currentCycle) return;

        const score = Math.round(this.currentCycle.averageScore);
        document.getElementById('scandalScore').textContent = score;
        document.getElementById('meterFill').style.width = `${score}%`;
        document.getElementById('articleCount').textContent = this.currentCycle.articles.length;
        document.getElementById('avgScore').textContent = score;

        const action = this.currentCycle.projectedAction;
        const actionStatus = document.getElementById('actionStatus');
        actionStatus.className = `action-status ${action.toLowerCase()}`;
        actionStatus.querySelector('.action-value').textContent = action;

        // Update impact stats
        const impact = this.calculateProjectedImpact();
        document.getElementById('tokenImpact').textContent = this.formatChange(impact.change);
        document.getElementById('tokenImpact').className =
            `action-stat-value ${impact.change > 0 ? 'positive' : impact.change < 0 ? 'negative' : ''}`;
        document.getElementById('newSupply').textContent = this.formatNumber(impact.newSupply);

        // Update total supply in header
        document.getElementById('totalSupply').textContent = this.formatNumber(this.totalSupply);

        this.renderCycles();
    }

    initChart() {
        const ctx = document.getElementById('supplyChart').getContext('2d');

        this.supplyChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: this.supplyHistory.map(h => `#${h.cycle}`),
                datasets: [{
                    label: 'Total Supply',
                    data: this.supplyHistory.map(h => h.supply),
                    borderColor: '#00f0ff',
                    backgroundColor: 'rgba(0, 240, 255, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4,
                    pointBackgroundColor: (ctx) => {
                        const idx = ctx.dataIndex;
                        const action = this.supplyHistory[idx]?.action;
                        if (action === 'MINT') return '#10b981';
                        if (action === 'BURN') return '#ef4444';
                        return '#00f0ff';
                    }
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: (ctx) => {
                                const h = this.supplyHistory[ctx[0].dataIndex];
                                return `Cycle #${h.cycle}`;
                            },
                            label: (ctx) => {
                                const h = this.supplyHistory[ctx.dataIndex];
                                const lines = [
                                    `Total Supply: ${this.formatNumber(h.supply)}`
                                ];

                                if (h.action === 'MINT' && h.change) {
                                    lines.push(`🟢 Minted: +${this.formatNumber(h.change)}`);
                                } else if (h.action === 'BURN' && h.change) {
                                    lines.push(`🔴 Burned: -${this.formatNumber(h.change)}`);
                                } else if (h.action === 'NEUTRAL') {
                                    lines.push(`⚪ Neutral: 0`);
                                } else if (h.action === 'GENESIS') {
                                    lines.push(`⚡ Genesis`);
                                }

                                if (h.rate) {
                                    lines.push(`Rate: ${(h.rate * 100).toFixed(2)}%`);
                                }

                                return lines;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#9ca3af' }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: {
                            color: '#9ca3af',
                            callback: (v) => this.formatNumber(v)
                        }
                    }
                },
                plugins: {
                    zoom: {
                        pan: {
                            enabled: true,
                            mode: 'x'
                        },
                        zoom: {
                            wheel: { enabled: true },
                            pinch: { enabled: true },
                            mode: 'x'
                        }
                    }
                }
            }
        });
    }

    updateChart() {
        if (!this.supplyChart) return;

        // Get data limited by chartDisplayLimit
        let displayData = this.supplyHistory;
        if (this.chartDisplayLimit !== 'all' && displayData.length > this.chartDisplayLimit) {
            displayData = displayData.slice(-this.chartDisplayLimit);
        }

        this.supplyChart.data.labels = displayData.map(h => `#${h.cycle}`);
        this.supplyChart.data.datasets[0].data = displayData.map(h => h.supply);
        this.supplyChart.update();
    }

    setupModal() {
        const modal = document.getElementById('historyModal');
        const expandBtn = document.getElementById('expandChart');
        const closeBtn = document.getElementById('closeModal');

        expandBtn.addEventListener('click', () => {
            modal.classList.add('show');
            document.body.style.overflow = 'hidden';
            this.initFullChart();
            this.renderModalStats();
        });

        closeBtn.addEventListener('click', () => {
            modal.classList.remove('show');
            document.body.style.overflow = '';
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('show');
                document.body.style.overflow = '';
            }
        });
    }

    setupChartRangeButtons() {
        // Main chart range buttons
        const mainRangeBtns = document.querySelectorAll('.chart-range-btns:not(.modal-range-btns) .range-btn');
        mainRangeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                mainRangeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const range = btn.dataset.range;
                this.chartDisplayLimit = range === 'all' ? 'all' : parseInt(range);
                this.updateChart();
            });
        });

        // Modal chart range buttons
        const modalRangeBtns = document.querySelectorAll('.modal-range-btns .range-btn');
        modalRangeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                modalRangeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const range = btn.dataset.range;
                this.modalChartDisplayLimit = range === 'all' ? 'all' : parseInt(range);
                this.updateFullChart();
            });
        });
    }

    initFullChart() {
        const ctx = document.getElementById('fullSupplyChart').getContext('2d');

        if (this.fullSupplyChart) this.fullSupplyChart.destroy();

        this.fullSupplyChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: this.supplyHistory.map(h => `Cycle #${h.cycle}`),
                datasets: [{
                    label: 'Total Supply',
                    data: this.supplyHistory.map(h => h.supply),
                    borderColor: '#00f0ff',
                    backgroundColor: 'rgba(0, 240, 255, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 6,
                    pointBackgroundColor: (ctx) => {
                        const idx = ctx.dataIndex;
                        const action = this.supplyHistory[idx]?.action;
                        if (action === 'MINT') return '#10b981';
                        if (action === 'BURN') return '#ef4444';
                        return '#00f0ff';
                    }
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: (ctx) => {
                                const h = this.supplyHistory[ctx[0].dataIndex];
                                return `Cycle #${h.cycle}`;
                            },
                            label: (ctx) => {
                                const h = this.supplyHistory[ctx.dataIndex];
                                const lines = [
                                    `Total Supply: ${this.formatNumber(h.supply)}`
                                ];

                                if (h.action === 'MINT' && h.change) {
                                    lines.push(`🟢 Minted: +${this.formatNumber(h.change)}`);
                                } else if (h.action === 'BURN' && h.change) {
                                    lines.push(`🔴 Burned: -${this.formatNumber(h.change)}`);
                                } else if (h.action === 'NEUTRAL') {
                                    lines.push(`⚪ Neutral: 0`);
                                } else if (h.action === 'GENESIS') {
                                    lines.push(`⚡ Genesis`);
                                }

                                if (h.rate) {
                                    lines.push(`Rate: ${(h.rate * 100).toFixed(2)}%`);
                                }

                                return lines;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        ticks: { color: '#9ca3af' }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        ticks: {
                            color: '#9ca3af',
                            callback: (v) => this.formatNumber(v)
                        }
                    }
                },
                plugins: {
                    zoom: {
                        pan: {
                            enabled: true,
                            mode: 'xy'
                        },
                        zoom: {
                            wheel: { enabled: true },
                            pinch: { enabled: true },
                            mode: 'xy'
                        }
                    }
                }
            }
        });
    }

    updateFullChart() {
        if (!this.fullSupplyChart) return;

        let displayData = this.supplyHistory;
        if (this.modalChartDisplayLimit !== 'all' && displayData.length > this.modalChartDisplayLimit) {
            displayData = displayData.slice(-this.modalChartDisplayLimit);
        }

        this.fullSupplyChart.data.labels = displayData.map(h => `Cycle #${h.cycle}`);
        this.fullSupplyChart.data.datasets[0].data = displayData.map(h => h.supply);
        this.fullSupplyChart.update();
    }

    renderModalStats() {
        const stats = document.getElementById('modalStats');
        const mints = this.supplyHistory.filter(h => h.action === 'MINT').length;
        const burns = this.supplyHistory.filter(h => h.action === 'BURN').length;
        const neutrals = this.supplyHistory.filter(h => h.action === 'NEUTRAL').length;
        const totalChange = this.totalSupply - INITIAL_SUPPLY;

        stats.innerHTML = `
            <div class="modal-stat mint">
                <span class="modal-stat-value">${mints}</span>
                <span class="modal-stat-label">MINTS</span>
            </div>
            <div class="modal-stat neutral">
                <span class="modal-stat-value">${neutrals}</span>
                <span class="modal-stat-label">NEUTRAL</span>
            </div>
            <div class="modal-stat burn">
                <span class="modal-stat-value">${burns}</span>
                <span class="modal-stat-label">BURNS</span>
            </div>
            <div class="modal-stat total">
                <span class="modal-stat-value ${totalChange >= 0 ? 'positive' : 'negative'}">
                    ${this.formatChange(totalChange)}
                </span>
                <span class="modal-stat-label">NET CHANGE</span>
            </div>
        `;
    }

    formatTime(timestamp) {
        return new Date(timestamp).toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit'
        });
    }

    toggleDescription(cycleId, articleIndex) {
        const key = `${cycleId}-${articleIndex}`;
        if (this.expandedArticles.has(key)) {
            this.expandedArticles.delete(key);
        } else {
            this.expandedArticles.add(key);
        }
        this.renderCycles();
    }

    renderCycles() {
        const newsFeed = document.getElementById('newsFeed');

        // Build new content first
        const newContent = document.createElement('div');

        if (this.currentCycle) {
            const cycleBlock = this.createCycleBlock(this.currentCycle, true);
            newContent.appendChild(cycleBlock);
        }

        this.completedCycles.forEach(cycle => {
            const cycleBlock = this.createCycleBlock(cycle, false);
            newContent.appendChild(cycleBlock);
        });

        // Only update if content changed (compare cycle IDs, article counts, and expanded state)
        const expandedKey = [...this.expandedArticles].sort().join('|');
        const currentKey = this.currentCycle
            ? `${this.currentCycle.id}-${this.currentCycle.articles.length}-${expandedKey}-${this.completedCycles.map(c => c.id).join(',')}`
            : expandedKey;

        if (this.lastRenderKey !== currentKey) {
            this.lastRenderKey = currentKey;
            newsFeed.innerHTML = '';
            while (newContent.firstChild) {
                newsFeed.appendChild(newContent.firstChild);
            }
        }

        this.updateHistory();
    }

    createCycleBlock(cycle, isActive) {
        const block = document.createElement('div');
        const action = isActive ? cycle.projectedAction : cycle.action;
        const actionClass = action.toLowerCase();

        // Add result class for completed blocks
        const resultClass = !isActive ? `${actionClass}-result` : '';
        block.className = `cycle-block ${isActive ? 'active' : 'completed'} ${resultClass}`.trim();

        block.innerHTML = `
            <div class="cycle-header ${actionClass}">
                <div class="cycle-info">
                    <span class="cycle-number">Cycle #${cycle.id}</span>
                    <span class="cycle-time">${this.formatTime(cycle.startTime)}</span>
                    ${isActive ? '<span class="cycle-status active">● LIVE</span>' : '<span class="cycle-status closed">✓ CLOSED</span>'}
                </div>
                <div class="cycle-result">
                    <span class="cycle-score">${Math.round(cycle.averageScore)}</span>
                    <span class="cycle-action ${actionClass}">${action}</span>
                </div>
            </div>
            <div class="cycle-articles">
                ${cycle.articles.length === 0 ? `<div class="no-articles">${isActive ? 'Waiting for articles...' : 'No news during this cycle'}</div>` : ''}
                ${[...cycle.articles].reverse().map((article, index) => this.createArticleCard(article, cycle.id, index)).join('')}
            </div>
        `;

        return block;
    }

    createArticleCard(article, cycleId, index) {
        const category = article.score < 33 ? 'good' : article.score > 66 ? 'scandal' : 'neutral';
        const key = `${cycleId}-${index}`;
        const isExpanded = this.expandedArticles.has(key);
        const shortDesc = article.description ? article.description.substring(0, 100) : '';
        const hasLongDesc = article.description && article.description.length > 100;

        return `
            <div class="news-item ${category}">
                <div class="news-header">
                    <div class="news-meta">
                        <span class="news-source">${article.source}</span>
                        <span class="news-category">${article.category || ''}</span>
                    </div>
                    <span class="news-score">${article.score}</span>
                </div>
                <h3 class="news-title">${article.title}</h3>
                ${article.description ? `
                    <p class="news-description ${isExpanded ? 'expanded' : ''}">
                        ${isExpanded ? article.description : shortDesc + (hasLongDesc ? '...' : '')}
                    </p>
                ` : ''}
                <div class="news-actions">
                    ${hasLongDesc ? `
                        <button class="read-more-btn" onclick="oracle.toggleDescription(${cycleId}, ${index})">
                            ${isExpanded ? '▲ Less' : '▼ More'}
                        </button>
                    ` : ''}
                    <a href="${article.link}" target="_blank" class="source-link">🔗 Source</a>
                </div>
            </div>
        `;
    }

    updateHistory() {
        const historyLog = document.getElementById('historyLog');
        historyLog.innerHTML = '';

        if (this.completedCycles.length === 0) {
            historyLog.innerHTML = '<div class="log-entry">No completed cycles yet...</div>';
            return;
        }

        this.completedCycles.slice(0, 10).forEach(cycle => {
            const histEntry = this.supplyHistory.find(h => h.cycle === cycle.id);
            const changeText = histEntry?.change ? ` | ${this.formatChange(histEntry.change)}` : '';

            const entry = document.createElement('div');
            entry.className = `log-entry ${cycle.action.toLowerCase()}`;
            entry.innerHTML = `
                <span class="log-time">Cycle #${cycle.id} (${this.formatTime(cycle.endTime)})</span>
                <span class="log-action">${cycle.action} • Score: ${Math.round(cycle.averageScore)}${changeText}</span>
            `;
            historyLog.appendChild(entry);
        });
    }
}

// Initialize
let oracle;
window.addEventListener('DOMContentLoaded', () => {
    oracle = new ScandalOracle();

    // Setup wallet modal
    const walletModal = document.getElementById('walletModal');
    const connectBtn = document.getElementById('connectWallet');
    const closeWalletBtn = document.getElementById('closeWalletModal');

    if (connectBtn) {
        connectBtn.addEventListener('click', () => {
            walletModal.classList.add('show');
        });
    }

    if (closeWalletBtn) {
        closeWalletBtn.addEventListener('click', () => {
            walletModal.classList.remove('show');
        });
    }

    if (walletModal) {
        walletModal.addEventListener('click', (e) => {
            if (e.target === walletModal) walletModal.classList.remove('show');
        });
    }

    // Wallet options
    document.querySelectorAll('.wallet-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const wallet = btn.dataset.wallet;
            console.log(`Connecting to ${wallet}...`);

            // Simulate wallet connection
            setTimeout(() => {
                const connectBtn = document.getElementById('connectWallet');
                connectBtn.innerHTML = '<span class="wallet-icon">✓</span><span class="wallet-text">0x7a3...e9f2</span>';
                connectBtn.classList.add('connected');
                walletModal.classList.remove('show');
            }, 500);
        });
    });

    // Mobile menu toggle
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const mobileNav = document.getElementById('mobileNav');

    if (mobileMenuBtn && mobileNav) {
        mobileMenuBtn.addEventListener('click', () => {
            mobileNav.classList.toggle('show');
        });
    }

    // Smooth scroll for nav links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            // Close mobile nav
            if (mobileNav) mobileNav.classList.remove('show');
        });
    });
});
