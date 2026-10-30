/**
 * Application Finances & Patrimoine (Togo - FCFA)
 * Diagrammes dynamiques intégrés, gestion des comptes togolais et impression de reçus d'acomptes
 */

const App = {
  state: {
    metrics: {},
    accounts: [],
    transactions: [],
    borrowedLoans: [],
    givenLoans: [],
    thirdParty: [],
    assets: [],
    settings: {},
    currentTab: 'dashboard',
    txFilter: 'all',
    pinInput: '',
    isLocked: false
  },

  async init() {
    this.bindEvents();
    await this.loadInitialData();

    if (this.state.metrics.pin_enabled) {
      this.lockApp();
    } else {
      this.unlockApp();
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW registration error:', err));
    }
  },

  async loadInitialData() {
    try {
      const [metrics, accounts, transactions, borrowed, given, thirdParty, assets, settings] = await Promise.all([
        API.getMetrics(),
        API.getAccounts(),
        API.getTransactions(40),
        API.getBorrowedLoans(),
        API.getGivenLoans(),
        API.getThirdPartyFunds(),
        API.getAssets(),
        API.getSettings()
      ]);

      this.state.metrics = metrics;
      this.state.accounts = accounts;
      this.state.transactions = transactions;
      this.state.borrowedLoans = borrowed;
      this.state.givenLoans = given;
      this.state.thirdParty = thirdParty;
      this.state.assets = assets;
      this.state.settings = settings;

      this.render();
    } catch (err) {
      console.error('Erreur chargement:', err);
    }
  },

  formatMoney(amount, currency = null) {
    const cur = currency || this.state.metrics.currency || 'FCFA';
    const num = Math.round(Number(amount) || 0);
    return `${num.toLocaleString('fr-FR')} ${cur}`;
  },

  formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  },

  formatInstallment(num, isSettled = false) {
    if (isSettled) return `Solde Final (${num}e Versement)`;
    if (num === 1) return "1er Acompte";
    return `${num}ème Acompte`;
  },

  bindEvents() {
    // Navigation basse
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.dataset.tab;
        if (tab) this.switchTab(tab);
      });
    });

    // Bouton central +
    document.getElementById('navAddBtn').addEventListener('click', () => {
      this.openModal('quickAddModal');
    });

    // Filtres des transactions
    document.querySelectorAll('.filter-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.state.txFilter = e.currentTarget.dataset.filter;
        this.renderTransactions();
      });
    });

    // Type d'opération rapide (Dépense / Entrée / Virement)
    document.querySelectorAll('.quick-type-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.quick-type-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.updateQuickAddForm(e.currentTarget.dataset.type);
      });
    });

    // Formulaires
    document.getElementById('quickAddForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleSaveTransaction();
    });

    document.getElementById('loanGivenForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleSaveLoanGiven();
    });

    document.getElementById('loanBorrowedForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleSaveLoanBorrowed();
    });

    document.getElementById('repayLoanForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleSaveLoanRepayment();
    });

    document.getElementById('receiveLoanForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleSaveLoanCollection();
    });

    document.getElementById('accountForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleSaveAccount();
    });

    document.getElementById('thirdPartyForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleSaveThirdParty();
    });

    document.getElementById('refundForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleSaveRefund();
    });

    document.getElementById('assetForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleSaveAsset();
    });

    document.getElementById('settingsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleSaveSettings();
    });

    // Fermeture des modals
    document.querySelectorAll('.close-modal-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modal = e.currentTarget.closest('.modal-overlay');
        if (modal) modal.classList.remove('active');
      });
    });
  },

  switchTab(tab) {
    this.state.currentTab = tab;
    document.querySelectorAll('.nav-item').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.querySelectorAll('.view-section').forEach(sec => {
      sec.classList.toggle('active', sec.id === `view-${tab}`);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  render() {
    this.renderDashboard();
    this.renderCharts();
    this.renderBorrowedLoans();
    this.renderGivenLoans();
    this.renderAccounts();
    this.renderThirdParty();
    this.renderAssets();
    this.renderSettings();
  },

  renderDashboard() {
    const m = this.state.metrics;

    // 1. Hero Card : Capital Propre Disponible (Fonds 100% personnels)
    document.getElementById('dashRealAvailable').textContent = this.formatMoney(m.real_available_cash);
    document.getElementById('dashTotalInHand').textContent = this.formatMoney(m.total_cash_in_hand);
    document.getElementById('dashThirdParty').textContent = this.formatMoney(m.third_party_held);
    document.getElementById('dashBorrowedDue').textContent = this.formatMoney(m.total_borrowed_due);

    // 2. Prêts et Fortune
    document.getElementById('dashGivenTotal').textContent = this.formatMoney(m.total_loans_given_due);
    document.getElementById('dashNetWorth').textContent = this.formatMoney(m.net_worth);

    // 3. Portefeuilles Togo sur l'accueil
    const accList = document.getElementById('dashAccountsList');
    accList.innerHTML = this.state.accounts.map(acc => {
      const typeIcons = { momo: '📱', cash: '💵', bank: '🏦' };
      return `
        <div class="account-tile">
          <div class="account-tile-header">
            <span class="pill-tag" style="background-color: var(--bg-subtle); color: var(--text-medium);">${acc.type.toUpperCase()}</span>
            <span>${typeIcons[acc.type] || '💳'}</span>
          </div>
          <div class="account-tile-name">${acc.name}</div>
          <div class="account-tile-balance" style="color: ${acc.color || 'var(--text-dark)'};">${this.formatMoney(acc.balance, acc.currency)}</div>
        </div>
      `;
    }).join('');

    // 4. Liste des transactions
    this.renderTransactions();
  },

  // ==================== DIAGRAMMES & GRAPHIQUES DYNAMIQUES ====================
  renderCharts() {
    const m = this.state.metrics;
    const accounts = m.accounts_distribution || [];
    const totalCash = accounts.reduce((acc, a) => acc + (a.balance > 0 ? a.balance : 0), 0);

    // 1. Donut Chart Répartition Liquidités Togo
    const donutBox = document.getElementById('donutChartSvg');
    const legendBox = document.getElementById('donutLegend');

    if (totalCash === 0) {
      donutBox.innerHTML = `
        <svg viewBox="0 0 100 100" class="donut-svg">
          <circle cx="50" cy="50" r="40" fill="transparent" stroke="var(--bg-subtle)" stroke-width="16" />
        </svg>
      `;
      legendBox.innerHTML = '<div style="font-size: 0.78rem; color: var(--text-muted);">Comptes actuellement vides. Enregistrez une rentrée pour voir la répartition.</div>';
    } else {
      let accumulatedPercent = 0;
      const circumference = 2 * Math.PI * 40; // ~251.32

      const circles = accounts.filter(a => a.balance > 0).map(a => {
        const pct = (a.balance / totalCash);
        const strokeDasharray = `${pct * circumference} ${circumference}`;
        const strokeDashoffset = -accumulatedPercent * circumference;
        accumulatedPercent += pct;

        return `
          <circle cx="50" cy="50" r="40" fill="transparent" 
                  stroke="${a.color || '#9e7436'}" stroke-width="16" 
                  stroke-dasharray="${strokeDasharray}" 
                  stroke-dashoffset="${strokeDashoffset}" />
        `;
      }).join('');

      donutBox.innerHTML = `
        <svg viewBox="0 0 100 100" class="donut-svg">
          ${circles}
        </svg>
      `;

      legendBox.innerHTML = accounts.filter(a => a.balance > 0).map(a => {
        const pct = Math.round((a.balance / totalCash) * 100);
        return `
          <div class="legend-item">
            <div>
              <span class="legend-dot" style="background-color: ${a.color || '#9e7436'};"></span>
              <strong>${a.name}</strong>
            </div>
            <span>${pct}% (${this.formatMoney(a.balance)})</span>
          </div>
        `;
      }).join('');
    }

    // 2. Bar Chart des Dépenses par Catégorie
    const catBox = document.getElementById('categoriesBarChart');
    const categories = m.categories_distribution || [];
    const maxCat = categories.length > 0 ? Math.max(...categories.map(c => c.total)) : 0;

    if (categories.length === 0 || maxCat === 0) {
      catBox.innerHTML = '<div style="font-size: 0.78rem; color: var(--text-muted); padding: 14px 0;">Aucune dépense enregistrée pour le moment.</div>';
    } else {
      catBox.innerHTML = categories.map(c => {
        const pct = Math.round((c.total / maxCat) * 100);
        return `
          <div class="cat-bar-item">
            <div class="cat-bar-header">
              <span>${c.category}</span>
              <span>${this.formatMoney(c.total)}</span>
            </div>
            <div class="cat-bar-bg">
              <div class="cat-bar-fill" style="width: ${pct}%;"></div>
            </div>
          </div>
        `;
      }).join('');
    }
  },

  // ==================== ACTIVITÉ ====================
  renderTransactions() {
    const container = document.getElementById('dashRecentTransactions');
    const filter = this.state.txFilter;

    let filtered = this.state.transactions;
    if (filter === 'expense') filtered = filtered.filter(t => t.type === 'expense');
    else if (filter === 'income') filtered = filtered.filter(t => t.type === 'income');
    else if (filter === 'transfer') filtered = filtered.filter(t => t.type === 'transfer');
    else if (filter === 'loans') filtered = filtered.filter(t => t.related_loan_id);
    else if (filter === 'thirdparty') filtered = filtered.filter(t => t.third_party_fund_id);

    if (filtered.length === 0) {
      container.innerHTML = '<div style="color: var(--text-muted); padding: 18px; text-align: center; font-size: 0.85rem;">Aucune transaction correspondante.</div>';
      return;
    }

    container.innerHTML = filtered.slice(0, 20).map(t => {
      const isExp = t.type === 'expense';
      const isTrans = t.type === 'transfer';
      
      let icon = isTrans ? '⇄' : (isExp ? '↓' : '↑');
      let iconBg = isTrans ? 'var(--navy-blue-bg)' : (isExp ? 'var(--bordeaux-red-bg)' : 'var(--forest-green-bg)');
      let iconColor = isTrans ? 'var(--navy-blue)' : (isExp ? 'var(--bordeaux-red)' : 'var(--forest-green)');
      let sign = isTrans ? '' : (isExp ? '-' : '+');

      let subText = `${t.category} • ${t.account_name}`;
      if (isTrans) subText = `${t.account_name} ➔ ${t.to_account_name || 'Autre'}`;
      if (t.fee > 0) subText += ` (frais: ${this.formatMoney(t.fee)})`;

      return `
        <div class="tx-row">
          <div class="tx-left">
            <div class="tx-icon-box" style="background-color: ${iconBg}; color: ${iconColor};">
              ${icon}
            </div>
            <div>
              <div class="tx-title">${t.description || t.category}</div>
              <div class="tx-sub">${subText} • ${this.formatDate(t.date)}</div>
            </div>
          </div>
          <div class="tx-amount" style="color: ${iconColor};">
            ${sign}${this.formatMoney(t.amount)}
          </div>
        </div>
      `;
    }).join('');
  },

  // ==================== RENDU EMPRUNTS AVEC REÇUS D'ACOMPTES ====================
  renderBorrowedLoans() {
    const list = document.getElementById('borrowedLoansList');
    if (this.state.borrowedLoans.length === 0) {
      list.innerHTML = `
        <div style="text-align: center; padding: 36px 16px; color: var(--text-muted);">
          <div style="font-size: 2.2rem; margin-bottom: 10px;">🏦</div>
          <div style="font-weight: 700; color: var(--text-dark);">Aucun emprunt en cours</div>
          <p style="font-size: 0.8rem; margin-top: 4px; max-width: 420px; margin-inline: auto;">
            Crédits bancaires, avances ou emprunts auprès de tiers : ils restent isolés dans ce compte dédié et ne gonflent pas votre capital personnel.
          </p>
        </div>
      `;
      return;
    }

    list.innerHTML = this.state.borrowedLoans.map(loan => {
      const remaining = Number(loan.current_balance);
      const isSettled = loan.status === 'settled' || remaining <= 0;
      const repaid = loan.initial_amount - remaining;
      const pct = Math.min(100, Math.round((repaid / loan.initial_amount) * 100));
      const repayments = loan.repayments || [];

      return `
        <div class="loan-card">
          <div class="loan-card-top">
            <div>
              <div class="loan-card-title">
                ${loan.title}
                <span class="pill-tag" style="background-color: ${isSettled ? 'var(--forest-green-bg)' : 'var(--bordeaux-red-bg)'}; color: ${isSettled ? 'var(--forest-green)' : 'var(--bordeaux-red)'};">
                  ${isSettled ? 'Soldé' : 'À rembourser'}
                </span>
              </div>
              <div class="loan-card-sub">Prêteur : <strong>${loan.lender_name}</strong> ${loan.due_date ? '• Échéance : ' + this.formatDate(loan.due_date) : ''}</div>
            </div>
            <div>
              <div class="loan-card-amount" style="color: ${isSettled ? 'var(--text-muted)' : 'var(--bordeaux-red)'};">
                ${this.formatMoney(remaining)}
              </div>
              <div style="font-size: 0.7rem; color: var(--text-muted); text-align: right;">Reste à payer</div>
            </div>
          </div>

          <div class="progress-container">
            <div class="progress-fill" style="width: ${pct}%; background-color: var(--bordeaux-red);"></div>
          </div>

          <div class="progress-labels">
            <span>Montant Emprunté : ${this.formatMoney(loan.initial_amount)}</span>
            <span>Déjà Remboursé : ${this.formatMoney(repaid)} (${pct}%)</span>
          </div>

          <!-- Historique des versements d'acomptes avec bouton reçu pour chacun -->
          ${repayments.length > 0 ? `
            <div class="repayments-history-box">
              <div style="font-size: 0.74rem; font-weight: 750; color: var(--text-dark); margin-bottom: 6px;">Historique des acomptes versés :</div>
              ${repayments.map(r => `
                <div class="repayment-pill-row">
                  <div>
                    <strong>${this.formatInstallment(r.installment_number, r.remaining_balance_after <= 0)}</strong>
                    <span style="color: var(--text-muted);"> • ${this.formatMoney(r.amount)} (${r.account_name}) • ${this.formatDate(r.date)}</span>
                  </div>
                  <button class="btn btn-secondary btn-sm" onclick="App.openReceiptModal('${r.id}')" style="padding: 3px 8px; font-size: 0.72rem;">
                    🖨️ Reçu PDF
                  </button>
                </div>
              `).join('')}
            </div>
          ` : ''}

          ${!isSettled ? `
            <div style="margin-top: 14px; display: flex; justify-content: flex-end;">
              <button class="btn btn-secondary btn-sm" onclick="App.openRepayLoanModal('${loan.id}', '${loan.title}', '${loan.lender_name}', ${remaining})">
                💸 Payer un acompte
              </button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  },

  // ==================== RENDU PRÊTS ACCORDÉS AVEC REÇUS D'ACOMPTES ====================
  renderGivenLoans() {
    const list = document.getElementById('givenLoansList');
    if (this.state.givenLoans.length === 0) {
      list.innerHTML = `
        <div style="text-align: center; padding: 36px 16px; color: var(--text-muted);">
          <div style="font-size: 2.2rem; margin-bottom: 10px;">🤝</div>
          <div style="font-weight: 700; color: var(--text-dark);">Aucun prêt accordé en cours</div>
          <p style="font-size: 0.8rem; margin-top: 4px; max-width: 420px; margin-inline: auto;">
            Prêts à des collègues ou proches : l'argent est débité de votre compte pour entrer dans ce compte de créances. Vous pouvez imprimer une quittance à chaque tranche reçue.
          </p>
        </div>
      `;
      return;
    }

    list.innerHTML = this.state.givenLoans.map(loan => {
      const remaining = Number(loan.current_balance);
      const isSettled = loan.status === 'settled' || remaining <= 0;
      const collected = loan.initial_amount - remaining;
      const pct = Math.min(100, Math.round((collected / loan.initial_amount) * 100));
      const repayments = loan.repayments || [];

      return `
        <div class="loan-card">
          <div class="loan-card-top">
            <div>
              <div class="loan-card-title">
                ${loan.title}
                <span class="pill-tag" style="background-color: ${isSettled ? 'var(--forest-green-bg)' : 'var(--gold-light)'}; color: ${isSettled ? 'var(--forest-green)' : 'var(--gold-primary)'};">
                  ${isSettled ? 'Récupéré' : 'En cours'}
                </span>
              </div>
              <div class="loan-card-sub">Emprunteur : <strong>${loan.borrower_name}</strong> ${loan.due_date ? '• Échéance : ' + this.formatDate(loan.due_date) : ''}</div>
            </div>
            <div>
              <div class="loan-card-amount" style="color: ${isSettled ? 'var(--text-muted)' : 'var(--forest-green)'};">
                ${this.formatMoney(remaining)}
              </div>
              <div style="font-size: 0.7rem; color: var(--text-muted); text-align: right;">Reste à récupérer</div>
            </div>
          </div>

          <div class="progress-container">
            <div class="progress-fill" style="width: ${pct}%; background-color: var(--forest-green);"></div>
          </div>

          <div class="progress-labels">
            <span>Somme Prêtée : ${this.formatMoney(loan.initial_amount)}</span>
            <span>Déjà Encaissé : ${this.formatMoney(collected)} (${pct}%)</span>
          </div>

          <!-- Historique des tranches encaissées -->
          ${repayments.length > 0 ? `
            <div class="repayments-history-box">
              <div style="font-size: 0.74rem; font-weight: 750; color: var(--text-dark); margin-bottom: 6px;">Acomptes encaissés :</div>
              ${repayments.map(r => `
                <div class="repayment-pill-row">
                  <div>
                    <strong>${this.formatInstallment(r.installment_number, r.remaining_balance_after <= 0)}</strong>
                    <span style="color: var(--text-muted);"> • ${this.formatMoney(r.amount)} sur ${r.account_name} • ${this.formatDate(r.date)}</span>
                  </div>
                  <button class="btn btn-secondary btn-sm" onclick="App.openReceiptModal('${r.id}')" style="padding: 3px 8px; font-size: 0.72rem;">
                    🖨️ Quittance PDF
                  </button>
                </div>
              `).join('')}
            </div>
          ` : ''}

          ${!isSettled ? `
            <div style="margin-top: 14px; display: flex; justify-content: flex-end;">
              <button class="btn btn-gold btn-sm" onclick="App.openReceiveLoanModal('${loan.id}', '${loan.title}', '${loan.borrower_name}', ${remaining})">
                💰 Encaisser un acompte
              </button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  },

  // ==================== REÇU FINANCIER & IMPRESSION PDF ====================
  async openReceiptModal(repaymentId) {
    try {
      const res = await API.getReceipt(repaymentId);
      if (!res.success || !res.receipt) throw new Error("Reçu introuvable");
      this.displayReceipt(res.receipt);
    } catch (err) {
      alert("Erreur reçu: " + err.message);
    }
  },

  displayReceipt(r) {
    const isBorrowed = r.loan_type === 'borrowed';
    const typeTitle = isBorrowed ? "REÇU OFFICIEL DE REMBOURSEMENT D'EMPRUNT" : "QUITTANCE OFFICIELLE DE RÈGLEMENT DE PRÊT";
    const partyLabel = isBorrowed ? "Bénéficiaire (Créancier)" : "Débiteur (Emprunteur)";
    const payerLabel = isBorrowed ? "Payé par" : "Encaissé par";
    const userName = this.state.metrics.user_name || "Moi";
    const isSettled = r.remaining_balance_after <= 0;

    const receiptHtml = `
      <div id="printableReceiptArea" class="receipt-wrapper">
        <div class="receipt-header">
          <div class="receipt-republic">RÉPUBLIQUE TOGOLAISE • REGISTRE FINANCIER PERSONNEL</div>
          <div class="receipt-type-badge">${typeTitle}</div>
          <div class="receipt-no">N° REÇU : ${r.receipt_no || 'REC-' + r.id.substring(0, 8).toUpperCase()}</div>
          <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 4px;">Émis à Lomé le ${this.formatDate(r.date || r.created_at)}</div>
        </div>

        <table class="receipt-table">
          <tr>
            <th>Objet / Motif de l'engagement</th>
            <td>${r.loan_title}</td>
          </tr>
          <tr>
            <th>${partyLabel}</th>
            <td>${r.contact_name}</td>
          </tr>
          <tr>
            <th>${payerLabel}</th>
            <td>${userName}</td>
          </tr>
          <tr>
            <th>Montant Total Initial Engagé</th>
            <td>${this.formatMoney(r.initial_amount)}</td>
          </tr>
          <tr>
            <th>Nature du Présent Versement</th>
            <td><strong style="color: var(--gold-primary);">${this.formatInstallment(r.installment_number, isSettled)}</strong></td>
          </tr>
          <tr class="receipt-highlight-row">
            <th>MONTANT VERSÉ CE JOUR</th>
            <td>${this.formatMoney(r.amount)}</td>
          </tr>
          <tr>
            <th>Reste Dû Après Ce Versement</th>
            <td>
              <span style="color: ${isSettled ? 'var(--forest-green)' : 'var(--bordeaux-red)'}; font-weight: 850;">
                ${isSettled ? 'SOLDÉ (0 FCFA)' : this.formatMoney(r.remaining_balance_after)}
              </span>
            </td>
          </tr>
          <tr>
            <th>Moyen de Règlement Utilisé</th>
            <td>${r.account_name} (${r.account_type.toUpperCase()})</td>
          </tr>
          ${r.notes ? `
            <tr>
              <th>Remarques / Référence</th>
              <td>${r.notes}</td>
            </tr>
          ` : ''}
        </table>

        <div class="receipt-signatures">
          <div class="signature-box">
            <div class="signature-title">Signature de la Partie Versante</div>
            <div class="signature-line">Mention « Lu et approuvé »</div>
          </div>
          <div class="signature-box">
            <div class="signature-title">Signature de la Partie Bénéficiaire</div>
            <div class="signature-line">Pour acquit et décharge</div>
          </div>
        </div>
      </div>

      <div class="no-print" style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 16px;">
        <button class="btn btn-secondary" onclick="document.getElementById('receiptModal').classList.remove('active')">Fermer</button>
        <button class="btn btn-gold" onclick="window.print()">🖨️ Imprimer en PDF</button>
      </div>
    `;

    document.getElementById('receiptModalContent').innerHTML = receiptHtml;
    document.getElementById('receiptModal').classList.add('active');
  },

  // ==================== RENDU COMPTES TOGO ====================
  renderAccounts() {
    const list = document.getElementById('accountsFullList');
    list.innerHTML = this.state.accounts.map(acc => `
      <div class="account-tile" style="margin-bottom: 12px;">
        <div class="account-tile-header">
          <span class="pill-tag" style="background-color: var(--bg-subtle); color: var(--text-medium);">${acc.type.toUpperCase()}</span>
          <span style="font-size: 1.25rem;">${acc.type === 'momo' ? '📱' : (acc.type === 'cash' ? '💵' : '🏦')}</span>
        </div>
        <div class="account-tile-name">${acc.name} ${acc.account_number ? '• ' + acc.account_number : ''}</div>
        <div class="account-tile-balance" style="color: ${acc.color || 'var(--text-dark)'};">${this.formatMoney(acc.balance, acc.currency)}</div>
      </div>
    `).join('');
  },

  // ==================== RENDU TIERS ====================
  renderThirdParty() {
    const list = document.getElementById('thirdPartyList');
    if (this.state.thirdParty.length === 0) {
      list.innerHTML = `
        <div style="text-align: center; padding: 36px 16px; color: var(--text-muted);">
          <div style="font-size: 2.2rem; margin-bottom: 10px;">📦</div>
          <div style="font-weight: 700; color: var(--text-dark);">Aucun argent de tiers sous garde</div>
          <p style="font-size: 0.8rem; margin-top: 4px; max-width: 400px; margin-inline: auto;">
            Quand un proche ou client vous confie de l'argent pour des courses ou un chantier, enregistrez-le ici. Il reste strictement déduit de votre disponible réel.
          </p>
        </div>
      `;
      return;
    }

    list.innerHTML = this.state.thirdParty.map(item => {
      const remaining = Number(item.remaining_amount);
      const isSettled = item.status === 'settled' || remaining <= 0;
      const pct = Math.min(100, Math.round(((item.spent_amount + item.returned_amount) / item.initial_amount) * 100));

      return `
        <div class="loan-card">
          <div class="loan-card-top">
            <div>
              <div class="loan-card-title">
                ${item.person_name}
                <span class="pill-tag" style="background-color: ${isSettled ? 'var(--forest-green-bg)' : 'var(--terracotta-bg)'}; color: ${isSettled ? 'var(--forest-green)' : 'var(--terracotta)'};">
                  ${isSettled ? 'Soldé' : 'Séquestre'}
                </span>
              </div>
              <div class="loan-card-sub">${item.reason} • Reçu le ${this.formatDate(item.date_received)}</div>
            </div>
            <div>
              <div class="loan-card-amount" style="color: ${isSettled ? 'var(--text-muted)' : 'var(--terracotta)'};">
                ${this.formatMoney(remaining)}
              </div>
              <div style="font-size: 0.7rem; color: var(--text-muted); text-align: right;">Restant sous garde</div>
            </div>
          </div>

          <div class="progress-container">
            <div class="progress-fill" style="width: ${pct}%; background-color: var(--terracotta);"></div>
          </div>

          <div class="progress-labels">
            <span>Dépôt Reçu : ${this.formatMoney(item.initial_amount)} (sur ${item.account_name})</span>
            <span>Dépensé : ${this.formatMoney(item.spent_amount)}</span>
          </div>

          ${!isSettled ? `
            <div style="margin-top: 14px; display: flex; justify-content: flex-end;">
              <button class="btn btn-secondary btn-sm" onclick="App.openRefundModal('${item.id}', '${item.person_name}', ${remaining})">
                Restituer le reliquat
              </button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  },

  // ==================== RENDU ACTIFS ====================
  renderAssets() {
    const list = document.getElementById('assetsList');
    if (this.state.assets.length === 0) {
      list.innerHTML = `
        <div style="text-align: center; padding: 36px 16px; color: var(--text-muted);">
          <div style="font-size: 2.2rem; margin-bottom: 10px;">💎</div>
          <div style="font-weight: 700; color: var(--text-dark);">Aucun actif répertorié</div>
          <p style="font-size: 0.8rem; margin-top: 4px;">Véhicule, moto, terrain, matériel informatique, tontines ou stock de marchandises au Togo.</p>
        </div>
      `;
      return;
    }

    const catLabels = {
      material: 'Biens & Matériel',
      real_estate: 'Immobilier & Terrain',
      investment: 'Placement & Tontine',
      inventory: 'Stock marchand'
    };

    list.innerHTML = this.state.assets.map(a => `
      <div class="tx-row">
        <div class="tx-left">
          <div class="tx-icon-box" style="background-color: var(--gold-light); color: var(--gold-primary);">
            💎
          </div>
          <div>
            <div class="tx-title">${a.name}</div>
            <div class="tx-sub">${catLabels[a.category] || a.category} ${a.notes ? '• ' + a.notes : ''}</div>
          </div>
        </div>
        <div>
          <div class="tx-amount" style="color: var(--gold-primary);">${this.formatMoney(a.current_value)}</div>
          <button class="btn btn-ghost btn-sm" onclick="App.deleteAsset('${a.id}')" style="color: var(--bordeaux-red); margin-top: 4px;">Supprimer</button>
        </div>
      </div>
    `).join('');
  },

  renderSettings() {
    const m = this.state.metrics;
    document.getElementById('settingCurrency').value = m.currency || 'FCFA';
    document.getElementById('settingUserName').value = m.user_name || 'Moi';
    document.getElementById('settingPinToggle').checked = m.pin_enabled;
  },

  // ==================== MODALS & TRAITEMENTS ====================
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    const accountSelects = modal.querySelectorAll('.account-select');
    accountSelects.forEach(select => {
      select.innerHTML = this.state.accounts.map(acc => `
        <option value="${acc.id}">${acc.name} (${this.formatMoney(acc.balance, acc.currency)})</option>
      `).join('');
    });

    const dateInputs = modal.querySelectorAll('input[type="date"]');
    const today = new Date().toISOString().split('T')[0];
    dateInputs.forEach(d => { if (!d.value) d.value = today; });

    modal.classList.add('active');
  },

  updateQuickAddForm(type) {
    document.getElementById('quickTransType').value = type;
    const toAccGroup = document.getElementById('quickToAccountGroup');
    const feeGroup = document.getElementById('quickFeeGroup');
    const catGroup = document.getElementById('quickCategoryGroup');

    if (type === 'transfer') {
      toAccGroup.style.display = 'block';
      feeGroup.style.display = 'block';
      catGroup.style.display = 'none';
    } else {
      toAccGroup.style.display = 'none';
      feeGroup.style.display = type === 'expense' ? 'block' : 'none';
      catGroup.style.display = 'block';
    }
  },

  async handleSaveTransaction() {
    const type = document.getElementById('quickTransType').value;
    const accountId = document.getElementById('quickAccount').value;
    const amount = document.getElementById('quickAmount').value;
    const category = document.getElementById('quickCategory').value || 'Général';
    const description = document.getElementById('quickDescription').value;
    const toAccountId = document.getElementById('quickToAccount').value;
    const fee = document.getElementById('quickFee').value || 0;
    const date = document.getElementById('quickDate').value;

    try {
      await API.createTransaction({
        type,
        account_id: accountId,
        amount,
        category,
        description,
        to_account_id: type === 'transfer' ? toAccountId : null,
        fee,
        date
      });

      document.getElementById('quickAddModal').classList.remove('active');
      document.getElementById('quickAddForm').reset();
      await this.loadInitialData();
    } catch (err) {
      alert("Erreur: " + err.message);
    }
  },

  // 1. Prêt accordé
  async handleSaveLoanGiven() {
    const borrowerName = document.getElementById('lgBorrower').value;
    const title = document.getElementById('lgTitle').value;
    const amount = document.getElementById('lgAmount').value;
    const fromAccountId = document.getElementById('lgAccount').value;
    const dueDate = document.getElementById('lgDueDate').value;
    const notes = document.getElementById('lgNotes').value;

    try {
      await API.createGivenLoan({
        borrower_name: borrowerName,
        title,
        amount,
        from_account_id: fromAccountId,
        due_date: dueDate,
        notes
      });

      document.getElementById('loanGivenModal').classList.remove('active');
      document.getElementById('loanGivenForm').reset();
      await this.loadInitialData();
    } catch (err) {
      alert("Erreur: " + err.message);
    }
  },

  // 2. Emprunt pris
  async handleSaveLoanBorrowed() {
    const lenderName = document.getElementById('lbLender').value;
    const title = document.getElementById('lbTitle').value;
    const amount = document.getElementById('lbAmount').value;
    const accountId = document.getElementById('lbAccount').value;
    const dueDate = document.getElementById('lbDueDate').value;
    const notes = document.getElementById('lbNotes').value;

    try {
      await API.createBorrowedLoan({
        lender_name: lenderName,
        title,
        amount,
        account_id: accountId || null,
        due_date: dueDate,
        notes
      });

      document.getElementById('loanBorrowedModal').classList.remove('active');
      document.getElementById('loanBorrowedForm').reset();
      await this.loadInitialData();
    } catch (err) {
      alert("Erreur: " + err.message);
    }
  },

  // 3. Remboursement emprunt (ouvre directement le reçu pour impression)
  openRepayLoanModal(loanId, title, lenderName, remaining) {
    document.getElementById('repayLoanId').value = loanId;
    document.getElementById('repayTitle').textContent = `${title} (${lenderName})`;
    document.getElementById('repayRemainingText').textContent = this.formatMoney(remaining);
    document.getElementById('repayAmount').value = remaining;
    document.getElementById('repayAmount').max = remaining;

    const select = document.getElementById('repayAccount');
    select.innerHTML = this.state.accounts.map(acc => `
      <option value="${acc.id}">${acc.name} (${this.formatMoney(acc.balance, acc.currency)})</option>
    `).join('');

    document.getElementById('repayLoanModal').classList.add('active');
  },

  async handleSaveLoanRepayment() {
    const loanId = document.getElementById('repayLoanId').value;
    const accountId = document.getElementById('repayAccount').value;
    const amount = document.getElementById('repayAmount').value;
    const notes = document.getElementById('repayNotes').value;

    try {
      const res = await API.repayBorrowedLoan({ loan_id: loanId, account_id: accountId, amount, notes });
      document.getElementById('repayLoanModal').classList.remove('active');
      await this.loadInitialData();

      // Afficher le reçu officiel immédiatement
      if (res.receipt && res.receipt.repayment_id) {
        await this.openReceiptModal(res.receipt.repayment_id);
      }
    } catch (err) {
      alert("Erreur: " + err.message);
    }
  },

  // 4. Encaissement acompte prêt (ouvre directement la quittance pour impression)
  openReceiveLoanModal(loanId, title, borrowerName, remaining) {
    document.getElementById('recvLoanId').value = loanId;
    document.getElementById('recvTitle').textContent = `${title} (de ${borrowerName})`;
    document.getElementById('recvRemainingText').textContent = this.formatMoney(remaining);
    document.getElementById('recvAmount').value = remaining;
    document.getElementById('recvAmount').max = remaining;

    const select = document.getElementById('recvAccount');
    select.innerHTML = this.state.accounts.map(acc => `
      <option value="${acc.id}">${acc.name} (${this.formatMoney(acc.balance, acc.currency)})</option>
    `).join('');

    document.getElementById('receiveLoanModal').classList.add('active');
  },

  async handleSaveLoanCollection() {
    const loanId = document.getElementById('recvLoanId').value;
    const accountId = document.getElementById('recvAccount').value;
    const amount = document.getElementById('recvAmount').value;
    const notes = document.getElementById('recvNotes').value;

    try {
      const res = await API.receiveLoanRepayment({ loan_id: loanId, to_account_id: accountId, amount, notes });
      document.getElementById('receiveLoanModal').classList.remove('active');
      await this.loadInitialData();

      // Afficher la quittance officielle immédiatement
      if (res.receipt && res.receipt.collection_id) {
        await this.openReceiptModal(res.receipt.collection_id);
      }
    } catch (err) {
      alert("Erreur: " + err.message);
    }
  },

  // 5. Argent de Tiers
  async handleSaveThirdParty() {
    const personName = document.getElementById('tpfPerson').value;
    const phone = document.getElementById('tpfPhone').value;
    const reason = document.getElementById('tpfReason').value;
    const amount = document.getElementById('tpfAmount').value;
    const accountId = document.getElementById('tpfAccount').value;
    const dateReceived = document.getElementById('tpfDate').value;

    try {
      await API.createThirdPartyFund({
        person_name: personName,
        phone,
        reason,
        amount,
        account_id: accountId,
        date_received: dateReceived
      });

      document.getElementById('thirdPartyModal').classList.remove('active');
      document.getElementById('thirdPartyForm').reset();
      await this.loadInitialData();
    } catch (err) {
      alert("Erreur: " + err.message);
    }
  },

  openRefundModal(fundId, personName, remaining) {
    document.getElementById('refFundId').value = fundId;
    document.getElementById('refPersonName').textContent = personName;
    document.getElementById('refAmount').value = remaining;
    document.getElementById('refAmount').max = remaining;

    const select = document.getElementById('refAccount');
    select.innerHTML = this.state.accounts.map(acc => `
      <option value="${acc.id}">${acc.name} (${this.formatMoney(acc.balance, acc.currency)})</option>
    `).join('');

    document.getElementById('refundModal').classList.add('active');
  },

  async handleSaveRefund() {
    const fundId = document.getElementById('refFundId').value;
    const accountId = document.getElementById('refAccount').value;
    const amount = document.getElementById('refAmount').value;
    const notes = document.getElementById('refNotes').value;

    try {
      await API.refundThirdPartyFund({ fund_id: fundId, account_id: accountId, amount, notes });
      document.getElementById('refundModal').classList.remove('active');
      await this.loadInitialData();
    } catch (err) {
      alert("Erreur: " + err.message);
    }
  },

  // 6. Nouveau compte
  async handleSaveAccount() {
    const name = document.getElementById('accName').value;
    const type = document.getElementById('accType').value;
    const balance = document.getElementById('accBalance').value || 0;
    const number = document.getElementById('accNumber').value;

    let color = '#9e7436';
    if (name.toLowerCase().includes('t-money') || name.toLowerCase().includes('tmoney')) color = '#e60000';
    else if (name.toLowerCase().includes('moov')) color = '#005baa';
    else if (type === 'cash') color = '#276749';
    else if (type === 'bank') color = '#004b87';

    try {
      await API.createAccount({ name, type, balance, account_number: number, color });
      document.getElementById('accountModal').classList.remove('active');
      document.getElementById('accountForm').reset();
      await this.loadInitialData();
    } catch (err) {
      alert("Erreur: " + err.message);
    }
  },

  // 7. Actifs
  async handleSaveAsset() {
    const name = document.getElementById('assetName').value;
    const category = document.getElementById('assetCat').value;
    const purchaseVal = document.getElementById('assetPurchaseVal').value;
    const currentVal = document.getElementById('assetCurrentVal').value || purchaseVal;
    const date = document.getElementById('assetDate').value;
    const notes = document.getElementById('assetNotes').value;

    try {
      await API.createAsset({
        name,
        category,
        purchase_value: purchaseVal,
        current_value: currentVal,
        purchase_date: date,
        notes
      });

      document.getElementById('assetModal').classList.remove('active');
      document.getElementById('assetForm').reset();
      await this.loadInitialData();
    } catch (err) {
      alert("Erreur: " + err.message);
    }
  },

  async deleteAsset(id) {
    if (!confirm("Supprimer cet actif ?")) return;
    try {
      await API.deleteAsset(id);
      await this.loadInitialData();
    } catch (err) {
      alert("Erreur: " + err.message);
    }
  },

  // 8. Paramètres
  async handleSaveSettings() {
    const currency = document.getElementById('settingCurrency').value;
    const userName = document.getElementById('settingUserName').value;
    const pinEnabled = document.getElementById('settingPinToggle').checked ? '1' : '0';
    const newPin = document.getElementById('settingNewPin').value;

    const payload = {
      main_currency: currency,
      user_name: userName,
      pin_enabled: pinEnabled
    };

    if (newPin && newPin.length >= 4) {
      payload.pin_code = newPin;
    }

    try {
      await API.updateSettings(payload);
      alert("Paramètres enregistrés !");
      await this.loadInitialData();
    } catch (err) {
      alert("Erreur: " + err.message);
    }
  },

  // 9. Code PIN
  lockApp() {
    this.state.isLocked = true;
    this.state.pinInput = '';
    this.updatePinDots();
    document.getElementById('pinScreen').classList.add('active');
  },

  unlockApp() {
    this.state.isLocked = false;
    document.getElementById('pinScreen').classList.remove('active');
  },

  async handlePinKey(val) {
    if (val === 'C') {
      this.state.pinInput = '';
    } else if (val === 'DEL') {
      this.state.pinInput = this.state.pinInput.slice(0, -1);
    } else {
      if (this.state.pinInput.length < 6) {
        this.state.pinInput += val;
      }
    }

    this.updatePinDots();

    if (this.state.pinInput.length >= 4) {
      try {
        const res = await API.verifyPin(this.state.pinInput);
        if (res.valid) {
          this.unlockApp();
        }
      } catch (e) {
        if (this.state.pinInput.length >= 4) {
          const dots = document.getElementById('pinDots');
          dots.style.animation = 'shake 0.3s ease';
          setTimeout(() => {
            dots.style.animation = '';
            this.state.pinInput = '';
            this.updatePinDots();
          }, 350);
        }
      }
    }
  },

  updatePinDots() {
    const dots = document.querySelectorAll('.pin-dot');
    const len = this.state.pinInput.length;
    dots.forEach((dot, index) => {
      dot.classList.toggle('filled', index < len);
    });
  },

  async downloadBackup() {
    try {
      const data = await API.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `finances_togo_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Erreur export: " + err.message);
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
