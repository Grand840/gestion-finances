/** Family access and account workspace. No financial data or auth tokens in browser storage. */
const Family = {
  user: null,
  epoch: 0,
  mode: "login",
  status: {},
  accountId: null,
  offset: 0,
  accountRows: [],
  async init() {
    document
      .getElementById("authForm")
      .addEventListener("submit", (e) => this.authenticate(e));
    document
      .getElementById("passwordForm")
      .addEventListener("submit", (e) => this.changePassword(e));
    document
      .getElementById("editAccountForm")
      .addEventListener("submit", (e) => this.saveAccount(e));
    document
      .getElementById("spendFundForm")
      .addEventListener("submit", (e) => this.saveFundSpend(e));
    document
      .getElementById("accountSearch")
      .addEventListener("input", () => this.renderAccountRows());
    document.addEventListener("click", (e) => {
      const card = e.target.closest("[data-account-id]");
      if (card) this.openAccount(card.dataset.accountId);
    });
    document.addEventListener("keydown", (e) => {
      if (
        ["Enter", " "].includes(e.key) &&
        e.target.matches("[data-account-id]")
      ) {
        e.preventDefault();
        this.openAccount(e.target.dataset.accountId);
      }
    });
    window.addEventListener("session-expired", () =>
      this.showAuth("Votre session a expiré. Reconnectez-vous."),
    );
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) this.checkSession();
    });
    if ("BroadcastChannel" in window) {
      this.channel = new BroadcastChannel("sillage-access");
      this.channel.onmessage = () => this.checkSession();
    }
    await this.checkSession(true);
    setInterval(() => {
      if (this.user && !document.hidden) this.checkSession();
    }, 60000);
  },
  async checkSession(initial = false) {
    const epoch = this.epoch;
    try {
      const status = await API.request("/auth/status");
      if (epoch !== this.epoch) return;
      this.status = status;
      if (status.authenticated) {
        API.csrf = status.csrf_token;
        if (!this.user || this.user.id !== status.user.id) {
          if (this.user) this.showAuth();
          await this.enter(status);
        } else {
          this.user = status.user;
          this.updateIdentity();
        }
      } else if (this.user || initial) {
        this.showAuth();
        this.authMode(status.bootstrap_required ? "register" : "login");
      }
      document.getElementById("authSubmit").disabled = false;
    } catch (err) {
      if (initial) {
        this.showAuth(
          "Le serveur est injoignable. Vérifiez son état puis actualisez cette page.",
        );
      }
    }
  },
  showAuth(message = "") {
    this.epoch++;
    this.user = null;
    API.csrf = "";
    this.accountId = null;
    this.accountRows = [];
    this.detail = null;
    this.fundId = null;
    this.offset = 0;
    App.state = {
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
    };
    for (const id of [
      "dashAccountsList",
      "accountsFullList",
      "dashRecentTransactions",
      "allTransactions",
      "borrowedLoansList",
      "givenLoansList",
      "thirdPartyList",
      "assetsList",
      "receiptModalContent",
      "membersList",
      "auditList",
      "accountTransactions",
      "archivedAccountsList",
      "donutChartSvg",
      "donutLegend",
      "categoriesBarChart",
    ])
      document.getElementById(id).replaceChildren();
    for (const id of [
      "dashRealAvailable",
      "dashNetWorth",
      "dashGivenTotal",
      "dashTotalInHand",
      "dashThirdParty",
      "dashBorrowedDue",
      "donutTotal",
      "detailAccountName",
      "detailAccountMeta",
      "detailAccountBalance",
      "detailIncome",
      "detailExpense",
      "detailCount",
      "profileEmail",
      "invitationCode",
      "headerPageName",
      "welcomeText",
      "repayTitle",
      "repayRemainingText",
      "recvTitle",
      "recvRemainingText",
      "refPersonName",
      "spendFundInfo",
    ])
      document.getElementById(id).textContent = "";
    document.querySelectorAll("form").forEach((form) => form.reset());
    document
      .querySelectorAll(".modal-overlay.active")
      .forEach((el) => el.classList.remove("active"));
    document
      .querySelectorAll(".user-display-name")
      .forEach((el) => (el.textContent = "Mon espace"));
    document
      .querySelectorAll(".user-initials")
      .forEach((el) => (el.textContent = ""));
    document.getElementById("invitationResult").hidden = true;
    document
      .querySelectorAll(".admin-only")
      .forEach((el) => (el.hidden = true));
    App.toggleMenu(false);
    document.body.classList.remove("modal-open");
    document
      .querySelectorAll(
        ".sidebar, .app-header, .main-content, .app-footer, .bottom-nav",
      )
      .forEach((el) => (el.inert = false));
    document.body.classList.add("auth-pending");
    document.getElementById("authScreen").hidden = false;
    this.notice(
      message ||
        (this.status.bootstrap_required
          ? "Première visite : créez l’administrateur avec le code SETUP_TOKEN de votre serveur."
          : ""),
    );
    document.title = "Sillage — Votre espace personnel";
  },
  authMode(mode) {
    this.mode = mode;
    const register = mode === "register",
      recovery = mode === "recover";
    document
      .querySelectorAll(".register-only")
      .forEach((el) => (el.hidden = !register));
    document.getElementById("authName").required = register;
    const code = document.getElementById("authCode");
    code.required = register || recovery;
    code.closest(".form-group").hidden = !register && !recovery;
    code.closest(".form-group").querySelector("small").textContent = recovery
      ? "Code personnel, valable 30 minutes et utilisable une seule fois."
      : this.status.bootstrap_required
        ? "Code à récupérer dans le fichier .env de votre serveur."
        : "Chaque invitation est personnelle et utilisable une seule fois.";
    document.getElementById("authPassword").minLength =
      register || recovery ? 12 : 1;
    document.getElementById("authPassword").autocomplete =
      register || recovery ? "new-password" : "current-password";
    document.querySelector('label[for="authPassword"]').textContent = recovery
      ? "Nouveau mot de passe"
      : "Mot de passe";
    document
      .getElementById("loginTab")
      .classList.toggle("active", mode === "login");
    document.getElementById("registerTab").classList.toggle("active", register);
    document.getElementById("authTitle").textContent = recovery
      ? "Retrouvez votre espace."
      : register
        ? this.status.bootstrap_required
          ? "Bienvenue dans votre Sillage."
          : "Votre espace commence ici."
        : "Heureux de vous retrouver.";
    document.getElementById("authSubtitle").textContent = recovery
      ? "Utilisez le code de récupération transmis en privé."
      : register
        ? "Des finances bien à vous, dans un espace de confiance."
        : "Connectez-vous à votre espace personnel.";
    document.getElementById("authCodeLabel").textContent = recovery
      ? "Code de récupération (30 minutes)"
      : this.status.bootstrap_required
        ? "Code de configuration (SETUP_TOKEN)"
        : "Code d’invitation";
    document.getElementById("authSubmit").innerHTML =
      (recovery
        ? "Réinitialiser le mot de passe"
        : register
          ? "Créer mon espace"
          : "Se connecter") + ' <span aria-hidden="true">→</span>';
    this.notice(
      recovery
        ? "Contactez l’administrateur pour obtenir un code personnel valable 30 minutes."
        : register
          ? this.status.bootstrap_required
            ? "Première configuration : ce compte sera l’administrateur familial."
            : "Demandez une invitation à l’administrateur familial."
          : "",
    );
  },
  notice(message, error = false) {
    const el = document.getElementById("authNotice");
    el.textContent = message;
    el.hidden = !message;
    el.classList.toggle("error", error);
  },
  togglePassword() {
    const el = document.getElementById("authPassword");
    el.type = el.type === "password" ? "text" : "password";
    document.querySelector(".password-field button").textContent =
      el.type === "password" ? "Afficher" : "Masquer";
  },
  async authenticate(e) {
    e.preventDefault();
    const button = document.getElementById("authSubmit");
    if (button.disabled) return;
    button.disabled = true;
    const data = {
      email: document.getElementById("authEmail").value,
      password: document.getElementById("authPassword").value,
    };
    if (this.mode === "register")
      data.name = document.getElementById("authName").value;
    if (this.mode !== "login")
      data.code = document.getElementById("authCode").value;
    try {
      const status = await API.post("/auth/" + this.mode, data);
      if (this.mode === "recover") {
        document.getElementById("authForm").reset();
        this.authMode("login");
        this.notice("Mot de passe réinitialisé. Vous pouvez vous connecter.");
        this.channel?.postMessage("changed");
      } else {
        await this.enter(status);
        document.getElementById("authForm").reset();
        this.channel?.postMessage("changed");
      }
    } catch (err) {
      this.notice(err.message, true);
    } finally {
      button.disabled = false;
    }
  },
  async enter(status) {
    this.epoch++;
    this.user = status.user;
    API.csrf = status.csrf_token;
    this.updateIdentity();
    document.body.classList.remove("auth-pending");
    document.getElementById("authScreen").hidden = true;
    const tab = location.hash.slice(1);
    App.switchTab(tab === "account-detail" ? "accounts" : tab || "dashboard");
    await App.loadInitialData();
  },
  updateIdentity() {
    if (!this.user) return;
    document.getElementById("profileEmail").textContent =
      this.user.email +
      " · " +
      (this.user.role === "admin" ? "Administrateur" : "Membre de la famille");
    document
      .querySelectorAll(".admin-only")
      .forEach((el) => (el.hidden = this.user.role !== "admin"));
    document
      .querySelectorAll(".sidebar-profile small")
      .forEach(
        (el) =>
          (el.textContent =
            this.user.role === "admin" ? "Administrateur" : "Espace personnel"),
      );
  },
  async logout() {
    try {
      await API.post("/auth/logout");
      this.showAuth("Vous êtes déconnecté. À bientôt.");
      this.status.bootstrap_required = false;
      this.authMode("login");
      this.channel?.postMessage("changed");
    } catch (err) {
      App.notify("Déconnexion non confirmée : " + err.message, true);
    }
  },
  async changePassword(e) {
    e.preventDefault();
    const form = e.currentTarget,
      button = form.querySelector("button");
    if (button.disabled) return;
    button.disabled = true;
    try {
      const status = await API.post("/auth/password", {
        current_password: document.getElementById("currentPassword").value,
        new_password: document.getElementById("newPassword").value,
      });
      API.csrf = status.csrf_token;
      this.user = status.user;
      form.reset();
      App.notify("Mot de passe modifié. Les autres sessions sont fermées.");
      this.channel?.postMessage("changed");
      this.loadAudit();
    } catch (err) {
      App.notify(err.message, true);
    } finally {
      button.disabled = false;
    }
  },
  onTab(tab) {
    if (!this.user) return;
    if (tab === "admin") this.loadMembers();
    if (
      tab === "accounts" &&
      !document.getElementById("archivedAccountsList").hidden
    )
      this.loadArchived();
    if (tab === "settings") this.loadAudit();
    if (tab !== "admin") {
      document.getElementById("invitationResult").hidden = true;
      document.getElementById("invitationCode").textContent = "";
    }
  },
  async loadMembers() {
    const epoch = this.epoch;
    try {
      const users = await API.request("/admin/users");
      if (!this.user || epoch !== this.epoch) return;
      document.getElementById("membersList").innerHTML = users
        .map(
          (u) =>
            `<div class="member-row"><span class="avatar">${App.escapeHtml(u.name.slice(0, 2).toUpperCase())}</span><div class="member-info"><strong>${App.escapeHtml(u.name)} ${u.id === this.user.id ? "<small>(vous)</small>" : ""}</strong><span>${App.escapeHtml(u.email)}</span><small>${u.role === "admin" ? "Administrateur" : "Membre"} · Inscrit le ${App.formatDate(u.created_at)}</small></div><span class="member-status ${u.active ? "active" : "inactive"}">${u.active ? "Actif" : "Désactivé"}</span>${u.role !== "admin" ? `<button class="btn btn-secondary btn-sm" onclick="Family.setMember('${u.id}',${!u.active})">${u.active ? "Désactiver" : "Réactiver"}</button>${u.active ? `<button class="text-link member-recovery" onclick="Family.recoverMember('${u.id}')">Récupérer l’accès</button>` : ""}` : ""}</div>`,
        )
        .join("");
    } catch (err) {
      App.notify(err.message, true);
    }
  },
  async recoverMember(id) {
    const epoch = this.epoch;
    try {
      const result = await API.post("/admin/users/" + id + "/recovery");
      if (epoch !== this.epoch || !this.user) return;
      document.getElementById("invitationCode").textContent = result.code;
      document.querySelector("#invitationResult strong").textContent =
        "Récupération d’accès · 30 minutes · Un seul usage";
      document.getElementById("invitationResult").hidden = false;
    } catch (err) {
      App.notify(err.message, true);
    }
  },
  async revokeInvitations() {
    if (!confirm("Révoquer toutes les invitations non utilisées ?")) return;
    try {
      await API.post("/admin/invitations/revoke");
      document.getElementById("invitationResult").hidden = true;
      document.getElementById("invitationCode").textContent = "";
      App.notify("Invitations en attente révoquées.");
    } catch (err) {
      App.notify(err.message, true);
    }
  },
  async setMember(id, active) {
    if (
      !confirm(
        active
          ? "Réactiver cet accès ?"
          : "Désactiver cet accès et fermer toutes ses sessions ? Les données seront conservées.",
      )
    )
      return;
    try {
      await API.post("/admin/users/" + id + "/status", { active });
      await this.loadMembers();
      App.notify("Accès mis à jour.");
    } catch (err) {
      App.notify(err.message, true);
    }
  },
  async createInvitation() {
    const epoch = this.epoch;
    const button = document.getElementById("inviteButton");
    button.disabled = true;
    try {
      const invite = await API.post("/admin/invitations");
      if (!this.user || epoch !== this.epoch) return;
      document.querySelector("#invitationResult strong").textContent =
        "Invitation créée · Valable 7 jours · Un seul usage";
      document.getElementById("invitationCode").textContent = invite.code;
      document.getElementById("invitationResult").hidden = false;
    } catch (err) {
      App.notify(err.message, true);
    } finally {
      button.disabled = false;
    }
  },
  async copyInvitation() {
    try {
      await navigator.clipboard.writeText(
        document.getElementById("invitationCode").textContent,
      );
      App.notify("Code copié. Transmettez-le en privé.");
    } catch {
      App.notify("Sélectionnez et copiez le code manuellement.");
    }
  },
  async loadAudit() {
    const epoch = this.epoch;
    const labels = {
      "auth.register": "Création de votre espace",
      "auth.login": "Connexion",
      "auth.logout": "Déconnexion",
      "auth.password_changed": "Mot de passe modifié",
      "auth.password_recovered": "Mot de passe réinitialisé",
      "admin.recovery_created": "Code de récupération créé",
      "admin.invitations_revoked": "Invitations révoquées",
      accounts: "Création de compte",
      transactions: "Opération enregistrée",
      settings: "Préférences modifiées",
      "loans/given": "Prêt accordé",
      "loans/borrowed": "Emprunt reçu",
      "loans/given/receive": "Remboursement encaissé",
      "loans/borrowed/repay": "Emprunt remboursé",
      "third-party": "Fonds confiés reçus",
      "third-party/refund": "Fonds restitués",
      assets: "Actif ajouté",
      "assets.deleted": "Actif supprimé",
      "accounts.archived": "Compte archivé",
      "accounts.restored": "Compte réactivé",
      "accounts.updated": "Compte modifié",
      "accounts.deleted": "Compte supprimé définitivement",
      "documents.created": "Rapport ou relevé émis",
      "signature.updated": "Signature importée",
      "signature.removed": "Signature de profil retirée",
      "loans/cash": "Mouvement du compte emprunt",
      "third-party/spend": "Achat pour un tiers",
      "admin.invitation_created": "Invitation créée",
      "admin.member_disabled": "Accès familial désactivé",
      "admin.member_activated": "Accès familial réactivé",
    };
    try {
      const items = await API.request("/audit");
      if (!this.user || epoch !== this.epoch) return;
      document.getElementById("auditList").innerHTML =
        items
          .map(
            (item) =>
              `<div><span>${App.escapeHtml(labels[item.action] || item.action)}</span><time>${App.escapeHtml(new Date(item.created_at).toLocaleString("fr-FR"))}</time></div>`,
          )
          .join("") || "<p>Aucun événement.</p>";
    } catch (err) {
      App.notify(err.message, true);
    }
  },
  async openAccount(id, navigate = true) {
    if (!id) return;
    if (this.accountId !== id) {
      this.offset = 0;
      document.getElementById("accountSearch").value = "";
    }
    this.accountId = id;
    const epoch = this.epoch;
    try {
      const [detail, items] = await Promise.all([
        API.request("/accounts/" + id),
        API.getTransactions(50, this.offset, id),
      ]);
      if (epoch !== this.epoch || this.accountId !== id) return;
      this.detail = detail;
      document.querySelector(".archive-account").textContent = detail.account
        .is_active
        ? "Archiver ce compte (solde nul uniquement)"
        : "Réactiver ce compte";
      this.accountRows = items;
      const a = detail.account;
      document.getElementById("detailAccountName").textContent = a.name;
      document.getElementById("detailAccountMeta").textContent =
        { cash: "Espèces", momo: "Mobile Money", bank: "Compte bancaire" }[
          a.type
        ] + (a.account_number ? " · " + a.account_number : "");
      document.getElementById("detailAccountBalance").textContent =
        App.formatMoney(a.balance, a.currency);
      document.getElementById("detailIncome").textContent = App.formatMoney(
        detail.summary.income,
        a.currency,
      );
      document.getElementById("detailExpense").textContent = App.formatMoney(
        detail.summary.expense,
        a.currency,
      );
      document.getElementById("detailCount").textContent = detail.summary.count;
      document.getElementById("accountPrev").disabled = this.offset === 0;
      document.getElementById("accountNext").disabled =
        this.offset + items.length >= Number(detail.summary.count);
      document.getElementById("accountPageLabel").textContent = items.length
        ? `${this.offset + 1}–${this.offset + items.length} sur ${detail.summary.count}`
        : "Aucune opération";
      this.renderAccountRows();
      if (navigate) App.switchTab("account-detail");
    } catch (err) {
      App.notify(err.message, true);
    }
  },
  renderAccountRows() {
    const query = document
      .getElementById("accountSearch")
      .value.toLocaleLowerCase("fr");
    const items = this.accountRows.filter((t) =>
      [t.description, t.category, t.date].some((v) =>
        String(v || "")
          .toLocaleLowerCase("fr")
          .includes(query),
      ),
    );
    document.getElementById("accountTransactions").innerHTML =
      items
        .map((t) => {
          const incoming =
              t.to_account_id === this.accountId || t.type === "income",
            transfer = t.type === "transfer";
          const sign = incoming ? "+" : "−";
          return `<article class="account-operation"><span class="tx-icon-box" style="background:var(--${incoming ? "forest-green" : "bordeaux-red"}-bg);color:var(--${incoming ? "forest-green" : "bordeaux-red"})">${App.icon(transfer ? "arrows" : incoming ? "down-left" : "up-right")}</span><div class="operation-text"><span class="operation-category">${App.escapeHtml(t.category)} · ${App.formatDate(t.date)}</span><h3>${App.escapeHtml(t.description || t.category)}</h3><p>${transfer ? App.escapeHtml(t.account_name) + " → " + App.escapeHtml(t.to_account_name) : incoming ? "Entrée sur ce compte" : "Sortie de ce compte"}</p><details><summary>Voir les détails</summary><dl><dt>Motif / catégorie</dt><dd>${App.escapeHtml(t.category)}</dd><dt>Description</dt><dd>${App.escapeHtml(t.description || "Non renseignée")}</dd><dt>Frais débités</dt><dd>${App.formatMoney(t.fee)}</dd><dt>Enregistré le</dt><dd>${App.escapeHtml(new Date(t.created_at).toLocaleString("fr-FR"))}</dd><dt>Référence</dt><dd class="operation-reference">${App.escapeHtml(t.id)}</dd></dl></details></div><strong class="operation-amount ${incoming ? "positive" : "negative"}">${sign} ${App.formatMoney(t.amount)}${!incoming && Number(t.fee) > 0 ? "<small>+ " + App.formatMoney(t.fee) + " de frais</small>" : ""}</strong></article>`;
        })
        .join("") ||
      App.emptyState(
        "file",
        "Aucune opération à afficher",
        query
          ? "Essayez une autre recherche dans cette page."
          : "Ce compte est prêt pour votre première opération.",
      );
  },
  accountPage(direction) {
    this.offset = Math.max(0, this.offset + direction * 50);
    this.openAccount(this.accountId, false);
  },
  accountOperation() {
    App.openModal("quickAddModal");
    document.getElementById("quickAccount").value = this.accountId;
  },
  async loadArchived() {
    const epoch = this.epoch;
    try {
      const list = await API.request("/accounts?include_archived=true");
      if (epoch !== this.epoch) return;
      const archived = list.filter((a) => !a.is_active),
        container = document.getElementById("archivedAccountsList");
      container.hidden = false;
      container.innerHTML =
        archived
          .map(
            (a) =>
              `<div class="account-tile" role="button" tabindex="0" data-account-id="${a.id}"><span class="pill-tag">Archivé</span><div class="account-tile-name">${App.escapeHtml(a.name)}</div><div class="account-tile-balance">${App.formatMoney(a.balance, a.currency)}</div></div>`,
          )
          .join("") || '<p class="field-hint">Aucun compte archivé.</p>';
    } catch (err) {
      App.notify(err.message, true);
    }
  },
  async archiveAccount() {
    if (this.detail && !this.detail.account.is_active) {
      try {
        await API.post("/accounts/" + this.accountId + "/restore");
        await App.loadInitialData();
        App.notify("Compte réactivé.");
      } catch (err) {
        App.notify(err.message, true);
      }
      return;
    }
    if (
      !confirm(
        "Archiver ce compte ? Son historique sera conservé, mais le compte ne sera plus proposé pour de nouvelles opérations.",
      )
    )
      return;
    try {
      await API.deleteAccount(this.accountId);
      App.switchTab("accounts");
      this.accountId = null;
      await App.loadInitialData();
      App.notify("Compte archivé.");
    } catch (err) {
      App.notify(err.message, true);
    }
  },
  editAccount() {
    if (!this.detail) return;
    App.openModal("editAccountModal");
    document.getElementById("editAccountName").value = this.detail.account.name;
    document.getElementById("editAccountNumber").value =
      this.detail.account.account_number;
  },
  async saveAccount(e) {
    e.preventDefault();
    const button = e.currentTarget.querySelector("button");
    if (button.disabled) return;
    button.disabled = true;
    try {
      await API.request("/accounts/" + this.accountId, {
        method: "PATCH",
        body: JSON.stringify({
          name: document.getElementById("editAccountName").value,
          account_number: document.getElementById("editAccountNumber").value,
        }),
      });
      App.closeModal(document.getElementById("editAccountModal"));
      await App.loadInitialData();
      App.notify("Compte mis à jour.");
    } catch (err) {
      App.notify(err.message, true);
    } finally {
      button.disabled = false;
    }
  },
  spendFund(id) {
    const fund = App.state.thirdParty.find((f) => f.id === id);
    if (!fund) return;
    this.fundId = id;
    document.getElementById("spendFundForm").reset();
    App.openModal("spendFundModal");
    document.getElementById("spendFundInfo").textContent =
      fund.person_name +
      " · Reste confié : " +
      App.formatMoney(fund.remaining_amount);
    document.getElementById("spendFundAmount").max = fund.remaining_amount;
    document.getElementById("spendFundAccount").value = fund.account_id;
  },
  async saveFundSpend(e) {
    e.preventDefault();
    const button = e.currentTarget.querySelector("button");
    if (button.disabled) return;
    button.disabled = true;
    try {
      await API.post("/third-party/spend", {
        fund_id: this.fundId,
        account_id: document.getElementById("spendFundAccount").value,
        amount: document.getElementById("spendFundAmount").value,
        fee: document.getElementById("spendFundFee").value,
        description: document.getElementById("spendFundDescription").value,
      });
      App.closeModal(document.getElementById("spendFundModal"));
      await App.loadInitialData();
      App.notify("Achat pour le tiers enregistré.");
    } catch (err) {
      App.notify(err.message, true);
    } finally {
      button.disabled = false;
    }
  },
  displayReceipt(r) {
    const esc = App.escapeHtml.bind(App),
      currency = r.currency,
      cash = (v) => esc(App.formatMoney(v, currency));
    const settled = Number(r.remaining_balance_after) === 0;
    const payer = r.loan_type === "borrowed" ? r.issuer_name : r.contact_name;
    const receiver =
      r.loan_type === "borrowed" ? r.contact_name : r.issuer_name;
    document.getElementById("receiptModalContent").innerHTML =
      `<div id="printableReceiptArea" class="receipt-document"><header class="document-header"><div class="document-brand"><img src="/icons/mark.svg" alt="Logo Sillage"><div>Sillage<small>VOS FINANCES, EN CLAIR</small></div></div><div class="document-reference"><span>DOCUMENT PERSONNEL</span><strong>${esc(r.receipt_no)}</strong></div></header><div class="document-title"><span>${r.loan_type === "borrowed" ? "REMBOURSEMENT D’EMPRUNT" : "REMBOURSEMENT DE PRÊT"}</span><h2>${r.loan_type === "borrowed" ? "Reçu de versement." : "Quittance de remboursement."}</h2><p>Émis le ${App.formatDate(r.date)} · Versement n° ${esc(r.installment_number)}</p></div><div class="document-amounts"><div><span>Montant versé</span><strong>${cash(r.amount)}</strong></div><div><span>Reste à rembourser</span><strong>${cash(r.remaining_balance_after)}</strong></div></div><div class="document-parties"><div><span>VERSÉ PAR</span><strong>${esc(payer)}</strong></div><div><span>REÇU PAR</span><strong>${esc(receiver)}</strong></div></div><dl class="document-details"><div><dt>Objet de l’engagement</dt><dd>${esc(r.loan_title)}</dd></div><div><dt>Montant initial</dt><dd>${cash(r.initial_amount)}</dd></div><div><dt>Solde avant ce versement</dt><dd>${cash(r.remaining_balance_before)}</dd></div><div><dt>Cumul remboursé</dt><dd>${cash(r.total_paid)}</dd></div><div><dt>Compte de règlement</dt><dd>${esc(r.account_name)}</dd></div><div><dt>État de l’engagement</dt><dd class="document-status">${settled ? "Soldé intégralement" : "Remboursement partiel"}</dd></div></dl>${r.notes ? `<div class="document-notes"><span>MOTIF / OBSERVATIONS</span><p>${esc(r.notes)}</p></div>` : ""}<div class="document-signatures"><div><span>Signature de la partie versante</span><i></i><small>Lu et approuvé</small></div><img src="/icons/stamp.svg" alt="Cachet applicatif Sillage : versement enregistré"><div><span>Signature du bénéficiaire</span><i></i><small>Pour acquit</small></div></div><footer class="document-footer"><p>Ce cachet atteste uniquement l’enregistrement dans Sillage. Il ne vaut ni certification bancaire ni signature des parties.</p><span>Empreinte SHA-256 des données du reçu</span><code>${esc(r.document_hash)}</code></footer></div><div class="document-actions no-print"><button class="btn btn-secondary" onclick="App.closeModal(document.getElementById('receiptModal'))">Fermer</button><button class="btn btn-secondary" onclick="window.print()">Imprimer</button><a class="btn btn-primary" href="/api/receipt/${encodeURIComponent(r.id)}/pdf" download>Télécharger le PDF ${App.icon("download")}</a></div>`;
    App.openModal("receiptModal");
  },
};
