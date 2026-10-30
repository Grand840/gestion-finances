/**
 * Sillage — gestion personnelle des finances (FCFA)
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
    currentTab: "dashboard",
    txFilter: "all",
    pinInput: "",
    isLocked: false,
  },

  async init() {
    this.bindEvents();
    this.switchTab(location.hash.slice(1) || "dashboard");
    await this.loadInitialData();

    if (this.state.metrics.pin_enabled) {
      this.lockApp();
    } else {
      this.unlockApp();
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((err) => console.log("SW registration error:", err));
    }
  },

  async loadInitialData() {
    try {
      const [
        metrics,
        accounts,
        transactions,
        borrowed,
        given,
        thirdParty,
        assets,
        settings,
      ] = await Promise.all([
        API.getMetrics(),
        API.getAccounts(),
        API.getTransactions(200),
        API.getBorrowedLoans(),
        API.getGivenLoans(),
        API.getThirdPartyFunds(),
        API.getAssets(),
        API.getSettings(),
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
      document.getElementById("loadError").hidden = true;
    } catch (err) {
      document.getElementById("loadError").hidden = false;
      this.notify("Chargement impossible. Réessayez dans un instant.", true);
      console.error("Erreur chargement:", err);
    }
  },

  formatMoney(amount, currency = null) {
    const cur = currency || this.state.metrics.currency || "FCFA";
    const num = Math.round(Number(amount) || 0);
    return `${num.toLocaleString("fr-FR")} ${cur}`;
  },

  formatDate(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return d.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  },

  formatInstallment(num, isSettled = false) {
    if (isSettled) return `Solde Final (${num}e Versement)`;
    if (num === 1) return "1er Acompte";
    return `${num}ème Acompte`;
  },

  bindEvents() {
    window.addEventListener("hashchange", () =>
      this.switchTab(location.hash.slice(1), false),
    );
    document
      .getElementById("transactionSearch")
      .addEventListener("input", () => this.renderTransactions());
    document.addEventListener("keydown", (e) => {
      if (
        this.state.isLocked &&
        (/^\d$/.test(e.key) || ["Backspace", "Enter"].includes(e.key))
      ) {
        e.preventDefault();
        this.handlePinKey(
          e.key === "Backspace" ? "DEL" : e.key === "Enter" ? "OK" : e.key,
        );
        return;
      }
      if (e.key === "Escape") {
        const modal = document.querySelector(".modal-overlay.active");
        if (modal) this.closeModal(modal);
        this.toggleMenu(false);
      }
      const modal = this.state.isLocked
        ? document.getElementById("pinScreen")
        : document.querySelector(".modal-overlay.active");
      if (e.key === "Tab" && modal) {
        const focusable = [
          ...modal.querySelectorAll(
            'button, input, select, textarea, [tabindex="0"]',
          ),
        ].filter((el) => !el.disabled && el.getClientRects().length);
        const first = focusable[0],
          last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    });
    document.querySelectorAll(".modal-overlay").forEach((modal) => {
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      const title = modal.querySelector(".modal-title");
      if (title) {
        title.id = title.id || `${modal.id}Title`;
        modal.setAttribute("aria-labelledby", title.id);
      } else modal.setAttribute("aria-label", "Reçu de paiement");
      modal.addEventListener("click", (e) => {
        if (e.target === modal) this.closeModal(modal);
      });
    });
    document.querySelectorAll(".form-group").forEach((group) => {
      const label = group.querySelector("label"),
        input = group.querySelector("input, select, textarea");
      if (label && input?.id) label.htmlFor = input.id;
    });
    document
      .querySelectorAll(".close-modal-btn")
      .forEach((button) =>
        button.setAttribute("aria-label", "Fermer la fenêtre"),
      );
    const saveHandlers = [
      "handleSaveTransaction",
      "handleSaveLoanGiven",
      "handleSaveLoanBorrowed",
      "handleSaveLoanRepayment",
      "handleSaveLoanCollection",
      "handleSaveAccount",
      "handleSaveThirdParty",
      "handleSaveRefund",
      "handleSaveAsset",
      "handleSaveSettings",
    ];
    saveHandlers.forEach((name) => {
      const handler = this[name].bind(this);
      this[name] = async () => {
        const form =
          document.activeElement?.closest("form") ||
          document.querySelector(".modal-overlay.active form") ||
          document.getElementById("settingsForm");
        if (form?.dataset.saving === "true") return;
        const button = form?.querySelector('[type="submit"]');
        if (form) form.dataset.saving = "true";
        if (button) button.disabled = true;
        try {
          return await handler();
        } finally {
          if (form) delete form.dataset.saving;
          if (button) button.disabled = false;
        }
      };
    });
    // Navigation basse
    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const tab = e.currentTarget.dataset.tab;
        if (tab) this.switchTab(tab);
      });
    });

    // Bouton central +
    document.getElementById("navAddBtn").addEventListener("click", () => {
      this.openModal("quickAddModal");
    });

    // Filtres des transactions
    document.querySelectorAll(".filter-tab").forEach((tab) => {
      tab.addEventListener("click", (e) => {
        document
          .querySelectorAll(".filter-tab")
          .forEach((t) =>
            t.classList.toggle(
              "active",
              t.dataset.filter === e.currentTarget.dataset.filter,
            ),
          );
        this.state.txFilter = e.currentTarget.dataset.filter;
        this.renderTransactions();
      });
    });

    // Type d'opération rapide (Dépense / Entrée / Virement)
    document.querySelectorAll(".quick-type-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        document
          .querySelectorAll(".quick-type-btn")
          .forEach((b) => b.classList.remove("active"));
        e.currentTarget.classList.add("active");
        this.updateQuickAddForm(e.currentTarget.dataset.type);
      });
    });

    // Formulaires
    document
      .getElementById("quickAddForm")
      .addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.handleSaveTransaction();
      });

    document
      .getElementById("loanGivenForm")
      .addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.handleSaveLoanGiven();
      });

    document
      .getElementById("loanBorrowedForm")
      .addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.handleSaveLoanBorrowed();
      });

    document
      .getElementById("repayLoanForm")
      .addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.handleSaveLoanRepayment();
      });

    document
      .getElementById("receiveLoanForm")
      .addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.handleSaveLoanCollection();
      });

    document
      .getElementById("accountForm")
      .addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.handleSaveAccount();
      });

    document
      .getElementById("thirdPartyForm")
      .addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.handleSaveThirdParty();
      });

    document
      .getElementById("refundForm")
      .addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.handleSaveRefund();
      });

    document
      .getElementById("assetForm")
      .addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.handleSaveAsset();
      });

    document
      .getElementById("settingsForm")
      .addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.handleSaveSettings();
      });

    // Fermeture des modals
    document.querySelectorAll(".close-modal-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const modal = e.currentTarget.closest(".modal-overlay");
        if (modal) this.closeModal(modal);
      });
    });
  },

  pages: {
    dashboard: [
      "Vue d’ensemble",
      "L’essentiel de vos finances, au même endroit.",
    ],
    transactions: [
      "Transactions",
      "Retrouvez, filtrez et exportez votre activité financière.",
    ],
    accounts: [
      "Mes comptes",
      "Vos banques, votre Mobile Money et vos espèces, réunis.",
    ],
    "loans-given": [
      "Prêts accordés",
      "Gardez le fil de ce que l’on vous doit.",
    ],
    "loans-borrowed": [
      "Emprunts",
      "Anticipez vos remboursements, en toute sérénité.",
    ],
    thirdparty: [
      "Fonds de tiers",
      "L’argent confié, séparé de votre argent personnel.",
    ],
    assets: ["Patrimoine", "Une vue d’ensemble de ce que vous construisez."],
    settings: ["Paramètres", "Un espace qui s’adapte à vous."],
  },

  switchTab(tab, updateHash = true) {
    if (!this.pages[tab]) tab = "dashboard";
    this.state.currentTab = tab;
    document.querySelectorAll(".nav-item[data-tab]").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === tab);
      if (b.dataset.tab === tab) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    document
      .querySelectorAll(".view-section")
      .forEach((sec) =>
        sec.classList.toggle("active", sec.id === `view-${tab}`),
      );
    document.getElementById("pageTitle").textContent = this.pages[tab][0];
    document.getElementById("pageDescription").textContent = this.pages[tab][1];
    document.getElementById("headerPageName").textContent = this.pages[tab][0];
    document.getElementById("pageEyebrow").textContent =
      tab === "dashboard"
        ? "UNE VISION CLAIRE, DES DÉCISIONS SEREINES"
        : "VOTRE ESPACE FINANCIER";
    document.title = `${this.pages[tab][0]} — Sillage`;
    if (updateHash && location.hash !== `#${tab}`)
      history.pushState(null, "", `#${tab}`);
    this.toggleMenu(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  },

  toggleMenu(
    open = !document.getElementById("sidebar").classList.contains("open"),
  ) {
    document.getElementById("sidebar").classList.toggle("open", open);
    document.getElementById("sidebarBackdrop").classList.toggle("active", open);
    document
      .getElementById("menuToggle")
      .setAttribute("aria-expanded", String(open));
  },

  escapeHtml(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  },

  icon(name) {
    return `<svg class="icon" aria-hidden="true"><use href="/icons/sprite.svg#${name}"></use></svg>`;
  },

  notify(message, error = false) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.toggle("error", error);
    toast.classList.add("visible");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.classList.remove("visible"), 4500);
  },

  startOperation(type) {
    this.openModal("quickAddModal");
    this.updateQuickAddForm(type);
    document.getElementById("quickAmount").focus();
  },

  closeModal(modal) {
    modal.classList.remove("active");
    this.modalTrigger?.focus();
  },

  emptyState(icon, title, text, action = "") {
    return `<div class="empty-state"><span class="empty-symbol">${this.icon(icon)}</span><strong>${title}</strong><p>${text}</p>${action}</div>`;
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
    this.renderProfile();
  },

  renderDashboard() {
    const m = this.state.metrics;

    // 1. Hero Card : Capital Propre Disponible (Fonds 100% personnels)
    document.getElementById("dashRealAvailable").innerHTML =
      `${Math.round(Number(m.real_available_cash) || 0).toLocaleString("fr-FR")}<span class=currency>${this.escapeHtml(m.currency || "FCFA")}</span>`;
    document.getElementById("dashTotalInHand").textContent = this.formatMoney(
      m.total_cash_in_hand,
    );
    document.getElementById("dashThirdParty").textContent = this.formatMoney(
      m.third_party_held,
    );
    document.getElementById("dashBorrowedDue").textContent = this.formatMoney(
      m.total_borrowed_due,
    );

    // 2. Prêts et Fortune
    document.getElementById("dashGivenTotal").textContent = this.formatMoney(
      m.total_loans_given_due,
    );
    document.getElementById("dashNetWorth").textContent = this.formatMoney(
      m.net_worth,
    );

    // 3. Portefeuilles Togo sur l'accueil
    const accList = document.getElementById("dashAccountsList");
    const types = {
      momo: ["phone", "Mobile Money"],
      cash: ["cash", "Espèces"],
      bank: ["bank", "Banque"],
    };
    accList.innerHTML =
      this.state.accounts
        .slice(0, 4)
        .map((acc) => {
          const [icon, label] = types[acc.type] || ["wallet", "Compte"];
          return `<div class="account-tile"><div class="account-tile-header"><span class="pill-tag" style="background:var(--bg-subtle);color:var(--text-muted)">${label}</span>${this.icon(icon)}</div><div class="account-tile-name">${this.escapeHtml(acc.name)}</div><div class="account-tile-balance">${this.formatMoney(acc.balance, acc.currency)}</div></div>`;
        })
        .join("") ||
      this.emptyState(
        "wallet",
        "Votre premier compte",
        "Ajoutez un compte pour commencer.",
      );

    // 4. Liste des transactions
    this.renderTransactions();
  },

  // ==================== DIAGRAMMES & GRAPHIQUES DYNAMIQUES ====================
  renderCharts() {
    const m = this.state.metrics;
    const accounts = m.accounts_distribution || [];
    const totalCash = accounts.reduce(
      (acc, a) => acc + (a.balance > 0 ? a.balance : 0),
      0,
    );

    document.getElementById("donutTotal").textContent =
      Math.round(totalCash).toLocaleString("fr-FR");
    document.querySelector(".donut-center small").textContent =
      m.currency || "FCFA";
    // 1. Donut Chart Répartition Liquidités Togo
    const donutBox = document.getElementById("donutChartSvg");
    const legendBox = document.getElementById("donutLegend");

    if (totalCash === 0) {
      donutBox.innerHTML = `
        <svg viewBox="0 0 100 100" class="donut-svg">
          <circle cx="50" cy="50" r="40" fill="transparent" stroke="var(--bg-subtle)" stroke-width="10" />
        </svg>
      `;
      legendBox.innerHTML =
        '<div class="empty-legend">La répartition apparaîtra avec vos premières liquidités.</div>';
    } else {
      let accumulatedPercent = 0;
      const circumference = 2 * Math.PI * 40; // ~251.32

      const circles = accounts
        .filter((a) => a.balance > 0)
        .map((a, index) => {
          const pct = a.balance / totalCash;
          const strokeDasharray = `${pct * circumference} ${circumference}`;
          const strokeDashoffset = -accumulatedPercent * circumference;
          accumulatedPercent += pct;

          return `
          <circle cx="50" cy="50" r="40" fill="transparent"
                  stroke="${["#648870", "#9fb49b", "#c7d2b5", "#d7b98c", "#8ba5ad"][index % 5]}" stroke-width="10"
                  stroke-dasharray="${strokeDasharray}"
                  stroke-dashoffset="${strokeDashoffset}" />
        `;
        })
        .join("");

      donutBox.innerHTML = `
        <svg viewBox="0 0 100 100" class="donut-svg">
          ${circles}
        </svg>
      `;

      legendBox.innerHTML = accounts
        .filter((a) => a.balance > 0)
        .map((a, index) => {
          const pct = Math.round((a.balance / totalCash) * 100);
          return `
          <div class="legend-item">
            <div>
              <span class="legend-dot" style="background-color: ${["#648870", "#9fb49b", "#c7d2b5", "#d7b98c", "#8ba5ad"][index % 5]};"></span>
              <strong>${this.escapeHtml(a.name)}</strong>
            </div>
            <span>${this.formatMoney(a.balance)} <small>${pct}%</small></span>
          </div>
        `;
        })
        .join("");
    }

    // 2. Bar Chart des Dépenses par Catégorie
    const catBox = document.getElementById("categoriesBarChart");
    const categories = m.categories_distribution || [];
    const maxCat =
      categories.length > 0 ? Math.max(...categories.map((c) => c.total)) : 0;

    if (categories.length === 0 || maxCat === 0) {
      catBox.innerHTML = this.emptyState(
        "pie",
        "Tout commence ici",
        "Vos dépenses par catégorie apparaîtront au fil de vos opérations.",
      );
    } else {
      catBox.innerHTML = categories
        .slice(0, 5)
        .map((c) => {
          const pct = Math.round((c.total / maxCat) * 100);
          return `
          <div class="cat-bar-item">
            <div class="cat-bar-header">
              <span>${this.escapeHtml(c.category)}</span>
              <span>${this.formatMoney(c.total)}</span>
            </div>
            <div class="cat-bar-bg">
              <div class="cat-bar-fill" style="width: ${pct}%;"></div>
            </div>
          </div>
        `;
        })
        .join("");
    }
  },

  // ==================== ACTIVITÉ ====================
  filteredTransactions() {
    const filter = this.state.txFilter;
    const query = document
      .getElementById("transactionSearch")
      .value.trim()
      .toLocaleLowerCase("fr");
    return this.state.transactions.filter((t) => {
      const matchesType =
        filter === "all" ||
        t.type === filter ||
        (filter === "loans" && t.related_loan_id) ||
        (filter === "thirdparty" && t.third_party_fund_id);
      const matchesSearch =
        !query ||
        [t.description, t.category, t.account_name, t.to_account_name].some(
          (v) =>
            String(v || "")
              .toLocaleLowerCase("fr")
              .includes(query),
        );
      return matchesType && matchesSearch;
    });
  },

  renderTransactions() {
    const filtered = this.filteredTransactions();
    const renderRow = (t) => {
      const isExp = t.type === "expense",
        isTrans = t.type === "transfer";
      const color = isTrans
        ? "var(--navy-blue)"
        : isExp
          ? "var(--bordeaux-red)"
          : "var(--forest-green)";
      const bg = isTrans
        ? "var(--navy-blue-bg)"
        : isExp
          ? "var(--bordeaux-red-bg)"
          : "var(--forest-green-bg)";
      const subtitle = isTrans
        ? `${t.account_name} → ${t.to_account_name || "Autre compte"}`
        : `${t.category || "Général"} · ${t.account_name || ""}`;
      return `<div class="tx-row"><div class="tx-left"><div class="tx-icon-box" style="background:${bg};color:${color}">${this.icon(isTrans ? "arrows" : isExp ? "up-right" : "down-left")}</div><div><div class="tx-title">${this.escapeHtml(t.description || t.category || "Opération")}</div><div class="tx-sub">${this.escapeHtml(subtitle)} · ${this.formatDate(t.date)}${Number(t.fee) > 0 ? " · Frais : " + this.formatMoney(t.fee) : ""}</div></div></div><div class="tx-amount" style="color:${color}">${isTrans ? "" : isExp ? "− " : "+ "}${this.formatMoney(t.amount)}</div></div>`;
    };
    const empty = this.emptyState(
      "arrows",
      this.state.transactions.length
        ? "Aucun résultat"
        : "Un nouveau départ, en toute clarté.",
      this.state.transactions.length
        ? "Essayez un autre filtre ou une autre recherche."
        : "Votre première opération donnera vie à cet espace.",
      '<button class="text-link" onclick="App.startOperation(\'expense\')">Ajouter une opération ' +
        this.icon("arrow-right") +
        "</button>",
    );
    document.getElementById("dashRecentTransactions").innerHTML =
      filtered.length ? filtered.slice(0, 5).map(renderRow).join("") : empty;
    document.getElementById("allTransactions").innerHTML = filtered.length
      ? filtered.map(renderRow).join("")
      : empty;
    document.getElementById("transactionCount").textContent =
      `${filtered.length} opération${filtered.length > 1 ? "s" : ""} affichée${filtered.length > 1 ? "s" : ""} sur les ${this.state.transactions.length} dernières chargées`;
  },

  exportTransactions() {
    const quote = (value) =>
      '"' +
      String(value ?? "")
        .replace(/^[=+@\-\t\r]/, "'$&")
        .replace(/"/g, '""') +
      '"';
    const rows = [
      [
        "Date",
        "Type",
        "Description",
        "Catégorie",
        "Compte",
        "Montant",
        "Frais",
      ],
      ...this.filteredTransactions().map((t) => [
        t.date,
        t.type,
        t.description,
        t.category,
        t.account_name,
        t.amount,
        t.fee,
      ]),
    ];
    const blob = new Blob(
      ["\uFEFF" + rows.map((row) => row.map(quote).join(";")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `sillage-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    this.notify("Export des transactions téléchargé.");
  },

  renderProfile() {
    const name = this.state.metrics.user_name || "Moi";
    const displayName = name === "Moi" ? "Mon espace" : name;
    document
      .querySelectorAll(".user-display-name")
      .forEach((el) => (el.textContent = displayName));
    const initials =
      name === "Moi"
        ? "ME"
        : name
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0])
            .join("")
            .toUpperCase();
    document
      .querySelectorAll(".user-initials")
      .forEach((el) => (el.textContent = initials));
    document.getElementById("welcomeText").textContent =
      name === "Moi"
        ? "Bienvenue dans votre espace"
        : `Bonjour ${name.split(" ")[0]}, voici vos finances.`;
    document.getElementById("todayLabel").textContent =
      new Date().toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
  },

  // ==================== RENDU EMPRUNTS AVEC REÇUS D'ACOMPTES ====================
  renderBorrowedLoans() {
    const list = document.getElementById("borrowedLoansList");
    if (this.state.borrowedLoans.length === 0) {
      list.innerHTML = `
        <div style="text-align: center; padding: 36px 16px; color: var(--text-muted);">
          <div style="font-size: 2.2rem; margin-bottom: 10px;"><svg class=icon aria-hidden=true><use href=/icons/sprite.svg#bank></use></svg></div>
          <div style="font-weight: 700; color: var(--text-dark);">Aucun emprunt en cours</div>
          <p style="font-size: 0.8rem; margin-top: 4px; max-width: 420px; margin-inline: auto;">
            Crédits bancaires, avances ou emprunts auprès de tiers : ils restent isolés dans ce compte dédié et ne gonflent pas votre capital personnel.
          </p>
        </div>
      `;
      return;
    }

    list.innerHTML = this.state.borrowedLoans
      .map((loan) => {
        const remaining = Number(loan.current_balance);
        const isSettled = loan.status === "settled" || remaining <= 0;
        const repaid = loan.initial_amount - remaining;
        const pct = Math.min(
          100,
          Math.round((repaid / loan.initial_amount) * 100),
        );
        const repayments = loan.repayments || [];

        return `
        <div class="loan-card">
          <div class="loan-card-top">
            <div>
              <div class="loan-card-title">
                ${this.escapeHtml(loan.title)}
                <span class="pill-tag" style="background-color: ${isSettled ? "var(--forest-green-bg)" : "var(--bordeaux-red-bg)"}; color: ${isSettled ? "var(--forest-green)" : "var(--bordeaux-red)"};">
                  ${isSettled ? "Soldé" : "À rembourser"}
                </span>
              </div>
              <div class="loan-card-sub">Prêteur : <strong>${this.escapeHtml(loan.lender_name)}</strong> ${loan.due_date ? "• Échéance : " + this.formatDate(loan.due_date) : ""}</div>
            </div>
            <div>
              <div class="loan-card-amount" style="color: ${isSettled ? "var(--text-muted)" : "var(--bordeaux-red)"};">
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
          ${
            repayments.length > 0
              ? `
            <div class="repayments-history-box">
              <div style="font-size: 0.74rem; font-weight: 750; color: var(--text-dark); margin-bottom: 6px;">Historique des acomptes versés :</div>
              ${repayments
                .map(
                  (r) => `
                <div class="repayment-pill-row">
                  <div>
                    <strong>${this.formatInstallment(r.installment_number, r.remaining_balance_after <= 0)}</strong>
                    <span style="color: var(--text-muted);"> • ${this.formatMoney(r.amount)} (${this.escapeHtml(r.account_name)}) • ${this.formatDate(r.date)}</span>
                  </div>
                  <button class="btn btn-secondary btn-sm" onclick="App.openReceiptModal('${r.id}')" style="padding: 3px 8px; font-size: 0.72rem;">
                    <svg class=icon aria-hidden=true><use href=/icons/sprite.svg#print></use></svg> Reçu PDF
                  </button>
                </div>
              `,
                )
                .join("")}
            </div>
          `
              : ""
          }

          ${
            !isSettled
              ? `
            <div style="margin-top: 14px; display: flex; justify-content: flex-end;">
              <button class="btn btn-secondary btn-sm" onclick="App.openRepayLoanModal('${loan.id}')">
                <svg class=icon aria-hidden=true><use href=/icons/sprite.svg#up-right></use></svg> Payer un acompte
              </button>
            </div>
          `
              : ""
          }
        </div>
      `;
      })
      .join("");
  },

  // ==================== RENDU PRÊTS ACCORDÉS AVEC REÇUS D'ACOMPTES ====================
  renderGivenLoans() {
    const list = document.getElementById("givenLoansList");
    if (this.state.givenLoans.length === 0) {
      list.innerHTML = `
        <div style="text-align: center; padding: 36px 16px; color: var(--text-muted);">
          <div style="font-size: 2.2rem; margin-bottom: 10px;"><svg class=icon aria-hidden=true><use href=/icons/sprite.svg#users></use></svg></div>
          <div style="font-weight: 700; color: var(--text-dark);">Aucun prêt accordé en cours</div>
          <p style="font-size: 0.8rem; margin-top: 4px; max-width: 420px; margin-inline: auto;">
            Prêts à des collègues ou proches : l'argent est débité de votre compte pour entrer dans ce compte de créances. Vous pouvez imprimer une quittance à chaque tranche reçue.
          </p>
        </div>
      `;
      return;
    }

    list.innerHTML = this.state.givenLoans
      .map((loan) => {
        const remaining = Number(loan.current_balance);
        const isSettled = loan.status === "settled" || remaining <= 0;
        const collected = loan.initial_amount - remaining;
        const pct = Math.min(
          100,
          Math.round((collected / loan.initial_amount) * 100),
        );
        const repayments = loan.repayments || [];

        return `
        <div class="loan-card">
          <div class="loan-card-top">
            <div>
              <div class="loan-card-title">
                ${this.escapeHtml(loan.title)}
                <span class="pill-tag" style="background-color: ${isSettled ? "var(--forest-green-bg)" : "var(--gold-light)"}; color: ${isSettled ? "var(--forest-green)" : "var(--gold-primary)"};">
                  ${isSettled ? "Récupéré" : "En cours"}
                </span>
              </div>
              <div class="loan-card-sub">Emprunteur : <strong>${this.escapeHtml(loan.borrower_name)}</strong> ${loan.due_date ? "• Échéance : " + this.formatDate(loan.due_date) : ""}</div>
            </div>
            <div>
              <div class="loan-card-amount" style="color: ${isSettled ? "var(--text-muted)" : "var(--forest-green)"};">
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
          ${
            repayments.length > 0
              ? `
            <div class="repayments-history-box">
              <div style="font-size: 0.74rem; font-weight: 750; color: var(--text-dark); margin-bottom: 6px;">Acomptes encaissés :</div>
              ${repayments
                .map(
                  (r) => `
                <div class="repayment-pill-row">
                  <div>
                    <strong>${this.formatInstallment(r.installment_number, r.remaining_balance_after <= 0)}</strong>
                    <span style="color: var(--text-muted);"> • ${this.formatMoney(r.amount)} sur ${this.escapeHtml(r.account_name)} • ${this.formatDate(r.date)}</span>
                  </div>
                  <button class="btn btn-secondary btn-sm" onclick="App.openReceiptModal('${r.id}')" style="padding: 3px 8px; font-size: 0.72rem;">
                    <svg class=icon aria-hidden=true><use href=/icons/sprite.svg#print></use></svg> Quittance PDF
                  </button>
                </div>
              `,
                )
                .join("")}
            </div>
          `
              : ""
          }

          ${
            !isSettled
              ? `
            <div style="margin-top: 14px; display: flex; justify-content: flex-end;">
              <button class="btn btn-gold btn-sm" onclick="App.openReceiveLoanModal('${loan.id}')">
                <svg class=icon aria-hidden=true><use href=/icons/sprite.svg#wallet></use></svg> Encaisser un acompte
              </button>
            </div>
          `
              : ""
          }
        </div>
      `;
      })
      .join("");
  },

  // ==================== REÇU FINANCIER & IMPRESSION PDF ====================
  async openReceiptModal(repaymentId) {
    try {
      const res = await API.getReceipt(repaymentId);
      if (!res.success || !res.receipt) throw new Error("Reçu introuvable");
      this.displayReceipt(res.receipt);
    } catch (err) {
      this.notify("Reçu indisponible : " + err.message, true);
    }
  },

  displayReceipt(r) {
    const isBorrowed = r.loan_type === "borrowed";
    const typeTitle = isBorrowed
      ? "REÇU DE REMBOURSEMENT D'EMPRUNT"
      : "QUITTANCE DE RÈGLEMENT DE PRÊT";
    const partyLabel = isBorrowed
      ? "Bénéficiaire (Créancier)"
      : "Débiteur (Emprunteur)";
    const payerLabel = isBorrowed ? "Payé par" : "Encaissé par";
    const userName = this.state.metrics.user_name || "Moi";
    const isSettled = r.remaining_balance_after <= 0;

    const receiptHtml = `
      <div id="printableReceiptArea" class="receipt-wrapper">
        <div class="receipt-header">
          <div class="receipt-republic">SILLAGE • REGISTRE FINANCIER PERSONNEL</div>
          <div class="receipt-type-badge">${typeTitle}</div>
          <div class="receipt-no">N° REÇU : ${r.receipt_no || "REC-" + r.id.substring(0, 8).toUpperCase()}</div>
          <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 4px;">Émis à Lomé le ${this.formatDate(r.date || r.created_at)}</div>
        </div>

        <table class="receipt-table">
          <tr>
            <th>Objet / Motif de l'engagement</th>
            <td>${this.escapeHtml(r.loan_title)}</td>
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
              <span style="color: ${isSettled ? "var(--forest-green)" : "var(--bordeaux-red)"}; font-weight: 850;">
                ${isSettled ? "SOLDÉ (0 FCFA)" : this.formatMoney(r.remaining_balance_after)}
              </span>
            </td>
          </tr>
          <tr>
            <th>Moyen de Règlement Utilisé</th>
            <td>${this.escapeHtml(r.account_name)} (${r.account_type.toUpperCase()})</td>
          </tr>
          ${
            r.notes
              ? `
            <tr>
              <th>Remarques / Référence</th>
              <td>${this.escapeHtml(r.notes)}</td>
            </tr>
          `
              : ""
          }
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
        <button class="btn btn-secondary" onclick="App.closeModal(document.getElementById('receiptModal'))">Fermer</button>
        <button class="btn btn-gold" onclick="window.print()"><svg class=icon aria-hidden=true><use href=/icons/sprite.svg#print></use></svg> Imprimer en PDF</button>
      </div>
    `;

    document.getElementById("receiptModalContent").innerHTML = receiptHtml;
    this.openModal("receiptModal");
  },

  // ==================== RENDU COMPTES TOGO ====================
  renderAccounts() {
    const list = document.getElementById("accountsFullList");
    list.innerHTML = this.state.accounts
      .map(
        (acc) => `
      <div class="account-tile" style="margin-bottom: 12px;">
        <div class="account-tile-header">
          <span class="pill-tag" style="background-color: var(--bg-subtle); color: var(--text-medium);">${{ momo: "Mobile Money", cash: "Espèces", bank: "Banque" }[acc.type] || "Compte"}</span>
          <span style="font-size: 1.25rem;">${acc.type === "momo" ? "<svg class=icon aria-hidden=true><use href=/icons/sprite.svg#phone></use></svg>" : acc.type === "cash" ? "<svg class=icon aria-hidden=true><use href=/icons/sprite.svg#cash></use></svg>" : "<svg class=icon aria-hidden=true><use href=/icons/sprite.svg#bank></use></svg>"}</span>
        </div>
        <div class="account-tile-name">${this.escapeHtml(acc.name)} ${acc.account_number ? "• " + this.escapeHtml(acc.account_number) : ""}</div>
        <div class="account-tile-balance" style="color: ${acc.color || "var(--text-dark)"};">${this.formatMoney(acc.balance, acc.currency)}</div>
      </div>
    `,
      )
      .join("");
  },

  // ==================== RENDU TIERS ====================
  renderThirdParty() {
    const list = document.getElementById("thirdPartyList");
    if (this.state.thirdParty.length === 0) {
      list.innerHTML = `
        <div style="text-align: center; padding: 36px 16px; color: var(--text-muted);">
          <div style="font-size: 2.2rem; margin-bottom: 10px;"><svg class=icon aria-hidden=true><use href=/icons/sprite.svg#box></use></svg></div>
          <div style="font-weight: 700; color: var(--text-dark);">Aucun argent de tiers sous garde</div>
          <p style="font-size: 0.8rem; margin-top: 4px; max-width: 400px; margin-inline: auto;">
            Quand un proche ou client vous confie de l'argent pour des courses ou un chantier, enregistrez-le ici. Il reste strictement déduit de votre disponible réel.
          </p>
        </div>
      `;
      return;
    }

    list.innerHTML = this.state.thirdParty
      .map((item) => {
        const remaining = Number(item.remaining_amount);
        const isSettled = item.status === "settled" || remaining <= 0;
        const pct = Math.min(
          100,
          Math.round(
            ((item.spent_amount + item.returned_amount) / item.initial_amount) *
              100,
          ),
        );

        return `
        <div class="loan-card">
          <div class="loan-card-top">
            <div>
              <div class="loan-card-title">
                ${this.escapeHtml(item.person_name)}
                <span class="pill-tag" style="background-color: ${isSettled ? "var(--forest-green-bg)" : "var(--terracotta-bg)"}; color: ${isSettled ? "var(--forest-green)" : "var(--terracotta)"};">
                  ${isSettled ? "Soldé" : "Séquestre"}
                </span>
              </div>
              <div class="loan-card-sub">${this.escapeHtml(item.reason)} • Reçu le ${this.formatDate(item.date_received)}</div>
            </div>
            <div>
              <div class="loan-card-amount" style="color: ${isSettled ? "var(--text-muted)" : "var(--terracotta)"};">
                ${this.formatMoney(remaining)}
              </div>
              <div style="font-size: 0.7rem; color: var(--text-muted); text-align: right;">Restant sous garde</div>
            </div>
          </div>

          <div class="progress-container">
            <div class="progress-fill" style="width: ${pct}%; background-color: var(--terracotta);"></div>
          </div>

          <div class="progress-labels">
            <span>Dépôt Reçu : ${this.formatMoney(item.initial_amount)} (sur ${this.escapeHtml(item.account_name)})</span>
            <span>Dépensé : ${this.formatMoney(item.spent_amount)}</span>
          </div>

          ${
            !isSettled
              ? `
            <div style="margin-top: 14px; display: flex; justify-content: flex-end;">
              <button class="btn btn-secondary btn-sm" onclick="App.openRefundModal('${item.id}')">
                Restituer le reliquat
              </button>
            </div>
          `
              : ""
          }
        </div>
      `;
      })
      .join("");
  },

  // ==================== RENDU ACTIFS ====================
  renderAssets() {
    const list = document.getElementById("assetsList");
    if (this.state.assets.length === 0) {
      list.innerHTML = `
        <div style="text-align: center; padding: 36px 16px; color: var(--text-muted);">
          <div style="font-size: 2.2rem; margin-bottom: 10px;"><svg class=icon aria-hidden=true><use href=/icons/sprite.svg#diamond></use></svg></div>
          <div style="font-weight: 700; color: var(--text-dark);">Aucun actif répertorié</div>
          <p style="font-size: 0.8rem; margin-top: 4px;">Véhicule, moto, terrain, matériel informatique, tontines ou stock de marchandises au Togo.</p>
        </div>
      `;
      return;
    }

    const catLabels = {
      material: "Biens & Matériel",
      real_estate: "Immobilier & Terrain",
      investment: "Placement & Tontine",
      inventory: "Stock marchand",
    };

    list.innerHTML = this.state.assets
      .map(
        (a) => `
      <div class="tx-row">
        <div class="tx-left">
          <div class="tx-icon-box" style="background-color: var(--gold-light); color: var(--gold-primary);">
            <svg class=icon aria-hidden=true><use href=/icons/sprite.svg#diamond></use></svg>
          </div>
          <div>
            <div class="tx-title">${this.escapeHtml(a.name)}</div>
            <div class="tx-sub">${catLabels[a.category] || a.category} ${a.notes ? "• " + this.escapeHtml(a.notes) : ""}</div>
          </div>
        </div>
        <div>
          <div class="tx-amount" style="color: var(--gold-primary);">${this.formatMoney(a.current_value)}</div>
          <button class="btn btn-ghost btn-sm" onclick="App.deleteAsset('${a.id}')" style="color: var(--bordeaux-red); margin-top: 4px;">Supprimer</button>
        </div>
      </div>
    `,
      )
      .join("");
  },

  renderSettings() {
    const m = this.state.metrics;
    document.getElementById("settingCurrency").value = m.currency || "FCFA";
    document.getElementById("settingUserName").value = m.user_name || "Moi";
    document.getElementById("settingPinToggle").checked = m.pin_enabled;
  },

  // ==================== MODALS & TRAITEMENTS ====================
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    const accountSelects = modal.querySelectorAll(".account-select");
    accountSelects.forEach((select) => {
      select.innerHTML =
        (select.id === "lbAccount"
          ? '<option value="">Aucun versement sur un compte</option>'
          : "") +
        this.state.accounts
          .map(
            (acc) => `
        <option value="${acc.id}">${this.escapeHtml(acc.name)} (${this.formatMoney(acc.balance, acc.currency)})</option>
      `,
          )
          .join("");
    });

    const dateInputs = modal.querySelectorAll('input[type="date"]');
    const today = new Date().toISOString().split("T")[0];
    dateInputs.forEach((d) => {
      if (d.required && !d.value) d.value = today;
    });

    this.modalTrigger = document.activeElement;
    if (modalId === "quickAddModal")
      this.updateQuickAddForm(document.getElementById("quickTransType").value);
    modal.classList.add("active");
    requestAnimationFrame(() =>
      modal.querySelector("input:not([type=hidden]), select, button")?.focus(),
    );
  },

  updateQuickAddForm(type) {
    document
      .querySelectorAll(".quick-type-btn")
      .forEach((button) =>
        button.classList.toggle("active", button.dataset.type === type),
      );
    document.getElementById("quickTransType").value = type;
    const category = document.getElementById("quickCategory");
    if (type !== "transfer" && category.dataset.type !== type) {
      const options =
        type === "income"
          ? ["Salaire & Honoraires", "Commerce & Ventes", "Autres revenus"]
          : [
              "Alimentation & Courses",
              "Transport & Carburant",
              "Factures (CEET, TdE, Connexion)",
              "Loyer & Maison",
              "Santé & Pharmacie",
              "Loisirs & Sorties",
              "Autre",
            ];
      category.innerHTML = options
        .map((label) => `<option>${this.escapeHtml(label)}</option>`)
        .join("");
      category.dataset.type = type;
    }
    const toAccGroup = document.getElementById("quickToAccountGroup");
    const feeGroup = document.getElementById("quickFeeGroup");
    const catGroup = document.getElementById("quickCategoryGroup");

    if (type === "transfer") {
      toAccGroup.style.display = "block";
      feeGroup.style.display = "block";
      catGroup.style.display = "none";
    } else {
      toAccGroup.style.display = "none";
      feeGroup.style.display = type === "expense" ? "block" : "none";
      catGroup.style.display = "block";
    }
  },

  async handleSaveTransaction() {
    const type = document.getElementById("quickTransType").value;
    const accountId = document.getElementById("quickAccount").value;
    const amount = document.getElementById("quickAmount").value;
    const category =
      type === "transfer"
        ? "Virement"
        : document.getElementById("quickCategory").value || "Général";
    const description = document.getElementById("quickDescription").value;
    const toAccountId = document.getElementById("quickToAccount").value;
    const fee = document.getElementById("quickFee").value || 0;
    const date = document.getElementById("quickDate").value;

    try {
      await API.createTransaction({
        type,
        account_id: accountId,
        amount,
        category,
        description,
        to_account_id: type === "transfer" ? toAccountId : null,
        fee,
        date,
      });

      this.closeModal(document.getElementById("quickAddModal"));
      this.notify("Opération enregistrée.");
      document.getElementById("quickAddForm").reset();
      await this.loadInitialData();
    } catch (err) {
      this.notify(err.message, true);
    }
  },

  // 1. Prêt accordé
  async handleSaveLoanGiven() {
    const borrowerName = document.getElementById("lgBorrower").value;
    const title = document.getElementById("lgTitle").value;
    const amount = document.getElementById("lgAmount").value;
    const fromAccountId = document.getElementById("lgAccount").value;
    const dueDate = document.getElementById("lgDueDate").value;
    const notes = document.getElementById("lgNotes").value;

    try {
      await API.createGivenLoan({
        borrower_name: borrowerName,
        title,
        amount,
        from_account_id: fromAccountId,
        due_date: dueDate,
        notes,
      });

      this.closeModal(document.getElementById("loanGivenModal"));
      this.notify("Opération enregistrée.");
      document.getElementById("loanGivenForm").reset();
      await this.loadInitialData();
    } catch (err) {
      this.notify(err.message, true);
    }
  },

  // 2. Emprunt pris
  async handleSaveLoanBorrowed() {
    const lenderName = document.getElementById("lbLender").value;
    const title = document.getElementById("lbTitle").value;
    const amount = document.getElementById("lbAmount").value;
    const accountId = document.getElementById("lbAccount").value;
    const dueDate = document.getElementById("lbDueDate").value;
    const notes = document.getElementById("lbNotes").value;

    try {
      await API.createBorrowedLoan({
        lender_name: lenderName,
        title,
        amount,
        account_id: accountId || null,
        due_date: dueDate,
        notes,
      });

      this.closeModal(document.getElementById("loanBorrowedModal"));
      this.notify("Opération enregistrée.");
      document.getElementById("loanBorrowedForm").reset();
      await this.loadInitialData();
    } catch (err) {
      this.notify(err.message, true);
    }
  },

  // 3. Remboursement emprunt (ouvre directement le reçu pour impression)
  openRepayLoanModal(loanId) {
    const loan = this.state.borrowedLoans.find((item) => item.id === loanId);
    if (!loan) return;
    const { title, lender_name: lenderName, current_balance: remaining } = loan;
    document.getElementById("repayLoanId").value = loanId;
    document.getElementById("repayTitle").textContent =
      `${title} (${lenderName})`;
    document.getElementById("repayRemainingText").textContent =
      this.formatMoney(remaining);
    document.getElementById("repayAmount").value = remaining;
    document.getElementById("repayAmount").max = remaining;

    const select = document.getElementById("repayAccount");
    select.innerHTML =
      (select.id === "lbAccount"
        ? '<option value="">Aucun versement sur un compte</option>'
        : "") +
      this.state.accounts
        .map(
          (acc) => `
      <option value="${acc.id}">${this.escapeHtml(acc.name)} (${this.formatMoney(acc.balance, acc.currency)})</option>
    `,
        )
        .join("");

    this.openModal("repayLoanModal");
  },

  async handleSaveLoanRepayment() {
    const loanId = document.getElementById("repayLoanId").value;
    const accountId = document.getElementById("repayAccount").value;
    const amount = document.getElementById("repayAmount").value;
    const notes = document.getElementById("repayNotes").value;

    try {
      const res = await API.repayBorrowedLoan({
        loan_id: loanId,
        account_id: accountId,
        amount,
        notes,
      });
      this.closeModal(document.getElementById("repayLoanModal"));
      this.notify("Opération enregistrée.");
      await this.loadInitialData();

      // Afficher le reçu officiel immédiatement
      if (res.receipt && res.receipt.repayment_id) {
        await this.openReceiptModal(res.receipt.repayment_id);
      }
    } catch (err) {
      this.notify(err.message, true);
    }
  },

  // 4. Encaissement acompte prêt (ouvre directement la quittance pour impression)
  openReceiveLoanModal(loanId) {
    const loan = this.state.givenLoans.find((item) => item.id === loanId);
    if (!loan) return;
    const {
      title,
      borrower_name: borrowerName,
      current_balance: remaining,
    } = loan;
    document.getElementById("recvLoanId").value = loanId;
    document.getElementById("recvTitle").textContent =
      `${title} (de ${borrowerName})`;
    document.getElementById("recvRemainingText").textContent =
      this.formatMoney(remaining);
    document.getElementById("recvAmount").value = remaining;
    document.getElementById("recvAmount").max = remaining;

    const select = document.getElementById("recvAccount");
    select.innerHTML =
      (select.id === "lbAccount"
        ? '<option value="">Aucun versement sur un compte</option>'
        : "") +
      this.state.accounts
        .map(
          (acc) => `
      <option value="${acc.id}">${this.escapeHtml(acc.name)} (${this.formatMoney(acc.balance, acc.currency)})</option>
    `,
        )
        .join("");

    this.openModal("receiveLoanModal");
  },

  async handleSaveLoanCollection() {
    const loanId = document.getElementById("recvLoanId").value;
    const accountId = document.getElementById("recvAccount").value;
    const amount = document.getElementById("recvAmount").value;
    const notes = document.getElementById("recvNotes").value;

    try {
      const res = await API.receiveLoanRepayment({
        loan_id: loanId,
        to_account_id: accountId,
        amount,
        notes,
      });
      this.closeModal(document.getElementById("receiveLoanModal"));
      this.notify("Opération enregistrée.");
      await this.loadInitialData();

      // Afficher la quittance officielle immédiatement
      if (res.receipt && res.receipt.collection_id) {
        await this.openReceiptModal(res.receipt.collection_id);
      }
    } catch (err) {
      this.notify(err.message, true);
    }
  },

  // 5. Argent de Tiers
  async handleSaveThirdParty() {
    const personName = document.getElementById("tpfPerson").value;
    const phone = document.getElementById("tpfPhone").value;
    const reason = document.getElementById("tpfReason").value;
    const amount = document.getElementById("tpfAmount").value;
    const accountId = document.getElementById("tpfAccount").value;
    const dateReceived = document.getElementById("tpfDate").value;

    try {
      await API.createThirdPartyFund({
        person_name: personName,
        phone,
        reason,
        amount,
        account_id: accountId,
        date_received: dateReceived,
      });

      this.closeModal(document.getElementById("thirdPartyModal"));
      this.notify("Opération enregistrée.");
      document.getElementById("thirdPartyForm").reset();
      await this.loadInitialData();
    } catch (err) {
      this.notify(err.message, true);
    }
  },

  openRefundModal(fundId) {
    const fund = this.state.thirdParty.find((item) => item.id === fundId);
    if (!fund) return;
    const { person_name: personName, remaining_amount: remaining } = fund;
    document.getElementById("refFundId").value = fundId;
    document.getElementById("refPersonName").textContent = personName;
    document.getElementById("refAmount").value = remaining;
    document.getElementById("refAmount").max = remaining;

    const select = document.getElementById("refAccount");
    select.innerHTML =
      (select.id === "lbAccount"
        ? '<option value="">Aucun versement sur un compte</option>'
        : "") +
      this.state.accounts
        .map(
          (acc) => `
      <option value="${acc.id}">${this.escapeHtml(acc.name)} (${this.formatMoney(acc.balance, acc.currency)})</option>
    `,
        )
        .join("");

    this.openModal("refundModal");
  },

  async handleSaveRefund() {
    const fundId = document.getElementById("refFundId").value;
    const accountId = document.getElementById("refAccount").value;
    const amount = document.getElementById("refAmount").value;
    const notes = document.getElementById("refNotes").value;

    try {
      await API.refundThirdPartyFund({
        fund_id: fundId,
        account_id: accountId,
        amount,
        notes,
      });
      this.closeModal(document.getElementById("refundModal"));
      this.notify("Opération enregistrée.");
      await this.loadInitialData();
    } catch (err) {
      this.notify(err.message, true);
    }
  },

  // 6. Nouveau compte
  async handleSaveAccount() {
    const name = document.getElementById("accName").value;
    const type = document.getElementById("accType").value;
    const balance = document.getElementById("accBalance").value || 0;
    const number = document.getElementById("accNumber").value;

    let color = "#9e7436";
    if (
      name.toLowerCase().includes("t-money") ||
      name.toLowerCase().includes("tmoney")
    )
      color = "#e60000";
    else if (name.toLowerCase().includes("moov")) color = "#005baa";
    else if (type === "cash") color = "#276749";
    else if (type === "bank") color = "#004b87";

    try {
      await API.createAccount({
        name,
        type,
        balance,
        account_number: number,
        color,
      });
      this.closeModal(document.getElementById("accountModal"));
      this.notify("Opération enregistrée.");
      document.getElementById("accountForm").reset();
      await this.loadInitialData();
    } catch (err) {
      this.notify(err.message, true);
    }
  },

  // 7. Actifs
  async handleSaveAsset() {
    const name = document.getElementById("assetName").value;
    const category = document.getElementById("assetCat").value;
    const purchaseVal = document.getElementById("assetPurchaseVal").value;
    const currentVal =
      document.getElementById("assetCurrentVal").value || purchaseVal;
    const date = document.getElementById("assetDate").value;
    const notes = document.getElementById("assetNotes").value;

    try {
      await API.createAsset({
        name,
        category,
        purchase_value: purchaseVal,
        current_value: currentVal,
        purchase_date: date,
        notes,
      });

      this.closeModal(document.getElementById("assetModal"));
      this.notify("Opération enregistrée.");
      document.getElementById("assetForm").reset();
      await this.loadInitialData();
    } catch (err) {
      this.notify(err.message, true);
    }
  },

  async deleteAsset(id) {
    if (!confirm("Supprimer cet actif ?")) return;
    try {
      await API.deleteAsset(id);
      await this.loadInitialData();
    } catch (err) {
      this.notify(err.message, true);
    }
  },

  // 8. Paramètres
  async handleSaveSettings() {
    const currency = document.getElementById("settingCurrency").value;
    const userName = document.getElementById("settingUserName").value;
    const pinEnabled = document.getElementById("settingPinToggle").checked
      ? "1"
      : "0";
    const newPin = document.getElementById("settingNewPin").value;

    const payload = {
      main_currency: currency,
      user_name: userName,
      pin_enabled: pinEnabled,
    };

    if (newPin && !/^\d{4,6}$/.test(newPin)) {
      this.notify("Le code PIN doit contenir 4 à 6 chiffres.", true);
      return;
    }
    if (newPin) {
      payload.pin_code = newPin;
    }

    try {
      await API.updateSettings(payload);
      this.notify("Préférences enregistrées.");
      await this.loadInitialData();
    } catch (err) {
      this.notify(err.message, true);
    }
  },

  // 9. Code PIN
  lockApp() {
    this.state.isLocked = true;
    this.state.pinInput = "";
    this.updatePinDots();
    document
      .querySelectorAll(
        ".sidebar, .app-header, .main-content, .app-footer, .bottom-nav",
      )
      .forEach((el) => (el.inert = true));
    document.getElementById("pinScreen").classList.add("active");
    document.querySelector("#pinScreen .pin-key").focus();
  },

  unlockApp() {
    this.state.isLocked = false;
    document.getElementById("pinScreen").classList.remove("active");
    document
      .querySelectorAll(
        ".sidebar, .app-header, .main-content, .app-footer, .bottom-nav",
      )
      .forEach((el) => (el.inert = false));
  },

  async handlePinKey(val) {
    if (val === "C") {
      this.state.pinInput = "";
    } else if (val === "DEL") {
      this.state.pinInput = this.state.pinInput.slice(0, -1);
    } else if (/^\d$/.test(val)) {
      if (this.state.pinInput.length < 6) {
        this.state.pinInput += val;
      }
    }

    this.updatePinDots();

    if (val === "OK" && this.state.pinInput.length >= 4) {
      try {
        const res = await API.verifyPin(this.state.pinInput);
        if (res.valid) {
          this.unlockApp();
        } else {
          this.notify("Code incorrect. Réessayez.", true);
          this.state.pinInput = "";
          this.updatePinDots();
        }
      } catch (e) {
        if (this.state.pinInput.length >= 4) {
          this.notify(e.message || "Vérification impossible. Réessayez.", true);
          const dots = document.getElementById("pinDots");
          dots.style.animation = "shake 0.3s ease";
          setTimeout(() => {
            dots.style.animation = "";
            this.state.pinInput = "";
            this.updatePinDots();
          }, 350);
        }
      }
    }
  },

  updatePinDots() {
    const dots = document.querySelectorAll(".pin-dot");
    const len = this.state.pinInput.length;
    dots.forEach((dot, index) => {
      dot.classList.toggle("filled", index < len);
    });
  },

  async downloadBackup() {
    try {
      const data = await API.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sillage_sauvegarde_${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      this.notify("Export impossible : " + err.message, true);
    }
  },
};

document.addEventListener("DOMContentLoaded", () => {
  App.init();
});
