/** Dossiers, dedicated wallets and private documents. No persistent browser storage. */
const Workspace = {
  people: [],
  esc(value) {
    return App.escapeHtml(String(value ?? ""));
  },
  personalAccounts() {
    return App.state.accounts.filter((a) => a.purpose === "personal");
  },
  prepareModal(id, modal) {
    let fixed = null;
    if (id === "repayLoanModal")
      fixed = App.state.borrowedLoans.find(
        (l) => l.id === document.getElementById("repayLoanId").value,
      )?.account_id;
    if (id === "refundModal")
      fixed = App.state.thirdParty.find(
        (f) => f.id === document.getElementById("refFundId").value,
      )?.account_id;
    if (id === "spendFundModal")
      fixed = App.state.thirdParty.find(
        (f) => f.id === Family.fundId,
      )?.account_id;
    modal.querySelectorAll(".account-select").forEach((select) => {
      const automatic = ["lbAccount", "tpfAccount"].includes(select.id);
      select.disabled = automatic || !!fixed;
      select.required = !automatic;
      const accounts = fixed
        ? App.state.accounts.filter((a) => a.id === fixed)
        : this.personalAccounts();
      select.innerHTML = automatic
        ? '<option value="">Compte dédié créé automatiquement · non modifiable</option>'
        : accounts
            .map(
              (a) =>
                `<option value="${a.id}">${this.esc(a.name)} · ${this.esc(App.formatMoney(a.balance, a.currency))}</option>`,
            )
            .join("");
    });
    if (id === "thirdPartyModal") {
      const select = document.getElementById("tpfPersonId");
      const previous = select.value;
      select.innerHTML =
        '<option value="">Nouvelle personne</option>' +
        this.people
          .map(
            (p) =>
              `<option value="${p.id}">${this.esc(p.name)}${p.phone ? " · " + this.esc(p.phone) : " · #" + p.id.slice(0, 8)}</option>`,
          )
          .join("");
      select.value = this.people.some((p) => p.id === previous) ? previous : "";
      this.choosePerson();
    }
  },
  choosePerson() {
    const person = this.people.find(
      (p) => p.id === document.getElementById("tpfPersonId").value,
    );
    ["tpfPerson", "tpfPhone"].forEach((id, i) => {
      const field = document.getElementById(id);
      field.disabled = !!person;
      if (person) field.value = i ? person.phone : person.name;
      else field.value = "";
    });
  },
  renderLoans(kind) {
    const list = document.getElementById(
      kind === "borrowed" ? "borrowedLoansList" : "givenLoansList",
    );
    const opened = new Set(
      [...list.querySelectorAll("details.loan-dossier[open]")].map(
        (el) => el.dataset.loan,
      ),
    );
    const loans =
      kind === "borrowed" ? App.state.borrowedLoans : App.state.givenLoans;
    list.innerHTML =
      loans
        .map((loan) => {
          const paid =
              Number(loan.initial_amount) - Number(loan.current_balance),
            settled = loan.status === "settled";
          const wallet = App.state.accounts.find(
            (a) => a.id === loan.account_id,
          );
          const overdue =
            !settled &&
            loan.due_date &&
            loan.due_date < new Date().toLocaleDateString("en-CA");
          return `<details class="loan-card loan-dossier" data-loan="${loan.id}" data-search="${this.esc([loan.contact_name, loan.title, loan.due_date, loan.notes].join(" ").toLocaleLowerCase("fr"))}" ${opened.has(loan.id) ? "open" : ""}><summary><div><span class="eyebrow">${kind === "borrowed" ? "EMPRUNT AUPRÈS DE" : "PRÊT ACCORDÉ À"}</span><h3>${this.esc(loan.contact_name)}</h3><p>${this.esc(loan.title)}</p></div><div class="dossier-remaining"><strong>${App.formatMoney(loan.current_balance)}</strong><span>${settled ? "Soldé" : "Reste dû"} · ${(loan.repayments || []).length} acompte(s)</span>${overdue ? '<span class="overdue-tag">Échéance dépassée</span>' : ""}<span class="disclosure-label">Détails & acomptes <span aria-hidden="true">⌄</span></span></div></summary><div class="dossier-body"><div class="dossier-stats"><div><span>Montant initial</span><strong>${App.formatMoney(loan.initial_amount)}</strong></div><div><span>Cumul remboursé</span><strong>${App.formatMoney(paid)}</strong></div><div><span>Échéance</span><strong>${loan.due_date ? App.formatDate(loan.due_date) : "Non fixée"}</strong></div></div><p class="field-hint">${this.esc(loan.notes || "Aucune observation complémentaire.")}</p>${kind === "borrowed" ? `<div class="dedicated-wallet"><div><span>Compte emprunt verrouillé</span><strong>${App.formatMoney(wallet?.balance || 0)}</strong><small>Solde de caisse distinct du reste dû.</small></div><div class="action-wrap"><button class="btn btn-secondary btn-sm" onclick="Workspace.openCash('${loan.id}','fund')">Alimenter pour rembourser</button><button class="btn btn-secondary btn-sm" onclick="Workspace.openCash('${loan.id}','spend')">Tracer une utilisation</button></div></div>${loan.legacy_account_id ? '<p class="migration-notice">Dossier historique : pas de nouvel encaissement du capital. Alimentez le compte dédié si nécessaire pour les prochains acomptes.</p>' : ""}` : ""}<div class="action-wrap"><button class="btn btn-secondary btn-sm" onclick="Workspace.downloadReport('loan','${loan.id}',this)">Rapport détaillé PDF</button>${!settled ? `<button class="btn btn-primary btn-sm" onclick="App.${kind === "borrowed" ? "openRepayLoanModal" : "openReceiveLoanModal"}('${loan.id}')">${kind === "borrowed" ? "Payer un acompte" : "Encaisser un acompte"}</button>` : ""}</div><details class="installment-details"><summary>Historique des acomptes (${(loan.repayments || []).length})</summary><div class="installment-list">${(loan.repayments || []).map((r) => `<article class="installment-row"><div><strong>Acompte n° ${r.installment_number} · ${App.formatMoney(r.amount)}</strong><span>${App.formatDate(r.date)} · ${this.esc(r.account_name)}</span><p>${this.esc(r.notes || "Sans observation")}</p><small>Reste après versement : ${App.formatMoney(r.remaining_balance_after)}</small></div><button class="btn btn-secondary btn-sm" onclick="App.openReceiptModal('${r.id}')">Reçu PDF</button></article>`).join("") || '<p class="field-hint">Aucun acompte enregistré.</p>'}</div></details></div></details>`;
        })
        .join("") ||
      App.emptyState(
        "bank",
        "Aucun dossier",
        "Créez un prêt ou un emprunt pour suivre ses versements.",
      );
    this.filterLoans(kind);
  },
  filterLoans(kind) {
    const query = document
      .getElementById(kind + "Search")
      .value.trim()
      .toLocaleLowerCase("fr");
    document
      .querySelectorAll(
        `#${kind === "borrowed" ? "borrowedLoansList" : "givenLoansList"} .loan-dossier`,
      )
      .forEach((el) => (el.hidden = !el.dataset.search.includes(query)));
  },
  foldLoans(kind, open) {
    document
      .querySelectorAll(
        `#${kind === "borrowed" ? "borrowedLoansList" : "givenLoansList"} .loan-dossier`,
      )
      .forEach((el) => {
        if (!el.hidden) el.open = open;
      });
  },
  renderPeople() {
    const query = document
      .getElementById("peopleSearch")
      .value.toLocaleLowerCase("fr");
    const list = document.getElementById("thirdPartyList");
    const opened = new Set(
      [...list.querySelectorAll("details[open]")].map(
        (el) => el.dataset.person,
      ),
    );
    list.innerHTML =
      this.people
        .filter((p) =>
          (p.name + " " + p.phone).toLocaleLowerCase("fr").includes(query),
        )
        .map(
          (p) =>
            `<details class="loan-card person-dossier" data-person="${p.id}" ${opened.has(p.id) ? "open" : ""}><summary><div><span class="eyebrow">COMPTE DE TIERS · VERROUILLÉ</span><h3>${this.esc(p.name)}</h3><p>${this.esc(p.phone || "Téléphone non renseigné")} · ${p.deposits} dépôt(s)</p></div><div class="dossier-remaining"><strong>${App.formatMoney(p.balance)}</strong><span>Restant sous garde</span><span class="disclosure-label">Consulter les dépôts ⌄</span></div></summary><div class="dossier-body"><div class="dossier-stats"><div><span>Total confié</span><strong>${App.formatMoney(p.total_received)}</strong></div><div><span>Achats et frais</span><strong>${App.formatMoney(p.total_spent)}</strong></div><div><span>Restitué</span><strong>${App.formatMoney(p.total_returned)}</strong></div></div><div class="action-wrap"><button class="btn btn-primary btn-sm" onclick="Workspace.showPerson('${p.id}')">Consulter les mouvements</button><button class="btn btn-secondary btn-sm" onclick="Workspace.downloadReport('person','${p.id}',this)">Relevé de la personne PDF</button><button class="text-link" onclick="Workspace.deposit('${p.id}')">Nouveau dépôt</button></div>${App.state.thirdParty
              .filter((f) => f.person_id === p.id)
              .map(
                (f) =>
                  `<article class="fund-deposit"><div><h4>${this.esc(f.reason)}</h4><p>${App.formatDate(f.date_received)} · Confié : ${App.formatMoney(f.initial_amount)}</p><small>Achats/frais : ${App.formatMoney(f.spent_amount)} · Restitué : ${App.formatMoney(f.returned_amount)}</small><strong>Reliquat : ${App.formatMoney(f.remaining_amount)}</strong></div>${Number(f.remaining_amount) > 0 ? `<div class="action-wrap"><button class="btn btn-secondary btn-sm" onclick="Family.spendFund('${f.id}')">Enregistrer un achat</button><button class="btn btn-secondary btn-sm" onclick="App.openRefundModal('${f.id}')">Restituer le reliquat</button></div>` : '<span class="pill-tag">Soldé</span>'}</article>`,
              )
              .join("")}</div></details>`,
        )
        .join("") ||
      App.emptyState(
        "users",
        "Aucune personne à afficher",
        "Chaque personne dispose d’un compte de tiers distinct de vos comptes personnels.",
      );
  },
  deposit(id) {
    App.openModal("thirdPartyModal");
    document.getElementById("tpfPersonId").value = id;
    this.choosePerson();
  },
  async showPerson(id) {
    try {
      const data = await API.request("/people/" + id);
      document.getElementById("personLedgerContent").innerHTML =
        `<h2>${this.esc(data.subject)}</h2><div class="action-wrap"><button class="btn btn-primary" onclick="Workspace.downloadReport('person','${id}',this)">Télécharger le relevé PDF</button></div>${data.summary.map(([key, value]) => `<p>${this.esc(key)} : <strong>${App.formatMoney(value)}</strong></p>`).join("")}${data.sections.map((section) => `<h3>${this.esc(section.title)}</h3><div class="statement-table-wrap"><table class="statement-table"><thead><tr>${section.columns.map((c) => `<th>${this.esc(c)}</th>`).join("")}</tr></thead><tbody>${section.rows.map((row) => `<tr>${row.map((v, i) => `<td>${section.money_columns.includes(i) ? App.formatMoney(v) : this.esc(v).replaceAll("\n", "<br>")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`).join("")}`;
      App.openModal("personLedgerModal");
    } catch (err) {
      App.notify(err.message, true);
    }
  },
  async downloadReport(kind, id, button) {
    if (button?.disabled) return;
    if (button) button.disabled = true;
    try {
      const result = await API.post("/documents", { kind, resource_id: id });
      await this.downloadPDF(result.id, result.reference);
      App.notify("Document figé et téléchargé.");
    } catch (err) {
      App.notify(err.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  },
  async downloadPDF(id, reference) {
    const epoch = Family.epoch;
    const response = await fetch("/api/documents/" + id + "/pdf", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error("Document indisponible. Vérifiez votre session.");
    const blob = await response.blob();
    if (epoch !== Family.epoch) return;
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = reference + ".pdf";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  async loadDocuments() {
    try {
      const rows = await API.request("/documents");
      document.getElementById("documentHistory").innerHTML =
        rows
          .map(
            (d) =>
              `<article class="document-history-row"><div><strong>${this.esc(d.title)} · ${this.esc(d.subject)}</strong><small>${this.esc(d.reference)} · ${App.formatDate(d.created_at)}</small></div><button class="btn btn-secondary btn-sm" onclick="Workspace.downloadPDF('${d.id}','${d.reference}').catch(e=>App.notify(e.message,true))">PDF</button></article>`,
          )
          .join("") ||
        '<p class="field-hint">Aucun rapport ou relevé émis.</p>';
    } catch (err) {
      App.notify(err.message, true);
    }
  },
  async loadSignature() {
    const epoch = Family.epoch;
    try {
      const response = await fetch("/api/profile/signature", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (epoch !== Family.epoch) return;
      if (this.signatureURL) URL.revokeObjectURL(this.signatureURL);
      const img = document.getElementById("signaturePreview");
      img.hidden = true;
      img.removeAttribute("src");
      document.getElementById("signatureState").textContent = response.ok
        ? "Signature importée · copie privée pour vos documents."
        : "Aucune signature configurée.";
      if (response.ok) {
        const blob = await response.blob();
        if (epoch !== Family.epoch) return;
        this.signatureURL = URL.createObjectURL(blob);
        img.src = this.signatureURL;
        img.hidden = false;
      }
    } catch (err) {
      if (epoch === Family.epoch)
        App.notify("Aperçu de signature indisponible.", true);
    }
  },
  async removeSignature() {
    if (
      !confirm(
        "Retirer votre signature des futurs documents ? Les documents déjà émis restent inchangés.",
      )
    )
      return;
    try {
      await API.request("/profile/signature", { method: "DELETE" });
      await this.loadSignature();
    } catch (err) {
      App.notify(err.message, true);
    }
  },
  openCash(id, mode) {
    this.cashLoan = id;
    this.cashMode = mode;
    const loan = App.state.borrowedLoans.find((l) => l.id === id),
      wallet = App.state.accounts.find((a) => a.id === loan.account_id);
    document.getElementById("loanCashForm").reset();
    document.getElementById("loanCashTitle").textContent =
      mode === "fund"
        ? "Alimenter le compte emprunt"
        : "Tracer une utilisation des fonds empruntés";
    document.getElementById("loanCashInfo").textContent =
      loan.contact_name +
      " · " +
      loan.title +
      " · Solde du compte : " +
      App.formatMoney(wallet?.balance);
    document.getElementById("loanCashSourceGroup").hidden = mode !== "fund";
    document.getElementById("loanCashSource").required = mode === "fund";
    document.getElementById("loanCashFeeGroup").hidden = mode !== "spend";
    document.getElementById("loanCashSource").innerHTML =
      this.personalAccounts()
        .map((a) => `<option value="${a.id}">${this.esc(a.name)}</option>`)
        .join("");
    App.openModal("loanCashModal");
  },
  askDelete() {
    if (!Family.detail?.deletable) return;
    document.getElementById("deleteAccountForm").reset();
    document.getElementById("deleteAccountName").textContent =
      Family.detail.account.name;
    App.openModal("deleteAccountModal");
  },
  reset() {
    this.people = [];
    this.cashLoan = null;
    this.cashMode = null;
    if (this.signatureURL) URL.revokeObjectURL(this.signatureURL);
    this.signatureURL = null;
    const image = document.getElementById("signaturePreview");
    image.hidden = true;
    image.removeAttribute("src");
    document.getElementById("tpfPersonId").innerHTML =
      '<option value="">Nouvelle personne</option>';
    document.getElementById("loanCashSource").replaceChildren();
    document.getElementById("signatureState").textContent =
      "Aucune signature configurée.";
    [
      "documentHistory",
      "personLedgerContent",
      "deleteAccountName",
      "loanCashInfo",
    ].forEach((id) => document.getElementById(id).replaceChildren());
    ["borrowedSearch", "givenSearch", "peopleSearch"].forEach(
      (id) => (document.getElementById(id).value = ""),
    );
  },
};

const originalShowAuth = Family.showAuth.bind(Family);
Family.showAuth = (...args) => {
  Workspace.reset();
  return originalShowAuth(...args);
};
const originalOnTab = Family.onTab.bind(Family);
Family.onTab = (tab) => {
  originalOnTab(tab);
  if (tab === "settings" && Family.user) {
    Workspace.loadSignature();
    Workspace.loadDocuments();
  }
};
const originalOpenAccount = Family.openAccount.bind(Family);
Family.openAccount = async (...args) => {
  await originalOpenAccount(...args);
  if (!Family.detail || Family.detail.account.id !== args[0]) return;
  const personal = Family.detail.account.purpose === "personal";
  document.querySelector(".account-detail-hero .eyebrow").textContent = personal
    ? "COMPTE PERSONNEL"
    : Family.detail.account.purpose === "third_party"
      ? "COMPTE DE TIERS · VERROUILLÉ"
      : "COMPTE EMPRUNT · VERROUILLÉ";
  document.querySelector(".account-edit-link").hidden = !personal;
  document.querySelector(".archive-account").hidden = !personal;
  document.getElementById("accountNewOperation").hidden =
    !personal || !Family.detail.account.is_active;
  document.getElementById("deleteAccountButton").disabled =
    !Family.detail.deletable;
};
const originalReceipt = Family.displayReceipt.bind(Family);
Family.displayReceipt = (receipt) => {
  originalReceipt(receipt);
  const signatures = document.querySelector(".document-signatures");
  if (receipt.signature_png) {
    const target = signatures.querySelector(
      receipt.loan_type === "borrowed" ? "div:first-child" : "div:last-child",
    );
    const img = document.createElement("img");
    img.className = "profile-signature";
    img.alt = "Copie de la signature du titulaire";
    img.src = "data:image/png;base64," + receipt.signature_png;
    target.insertBefore(img, target.querySelector("i"));
  }
  const stamp = signatures.querySelector(":scope > img");
  const label =
    receipt.loan_type === "given" ? "QUITTANCE DE PRÊT" : "REÇU D’EMPRUNT";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180"><g transform="rotate(-7 90 90)" fill="none" stroke="#174f42"><circle cx="90" cy="90" r="80" stroke-width="2"/><circle cx="90" cy="90" r="73" stroke-width=".7"/><path d="M40 70h100"/><g fill="#174f42" stroke="none" text-anchor="middle" font-family="sans-serif"><text x="90" y="59" font-size="22" font-weight="bold">SILLAGE</text><text x="90" y="94" font-size="10" font-weight="bold">${label}</text><text x="90" y="119" font-size="11">${Workspace.esc(receipt.date)}</text><text x="90" y="143" font-size="7">COPIE APPLICATIVE · NON OFFICIEL</text></g></g></svg>`;
  stamp.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  stamp.alt = "Cachet Sillage · " + label;
  stamp.classList.add("receipt-stamp");
  if (receipt.signature_reissued) {
    const note = document.createElement("p");
    note.className = "field-hint";
    note.textContent =
      "Ancien reçu : signature de profil actuelle appliquée à cette réédition.";
    document.querySelector(".document-footer").prepend(note);
  }
};

document.addEventListener("DOMContentLoaded", () => {
  function bind(id, handler) {
    document.getElementById(id).addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector("[type=submit]");
      if (button.disabled) return;
      button.disabled = true;
      try {
        await handler();
      } catch (err) {
        App.notify(err.message, true);
      } finally {
        button.disabled = false;
      }
    });
  }
  bind("signatureForm", async () => {
    const file = document.getElementById("signatureFile").files[0];
    if (!file || file.size > 524288)
      throw new Error("Choisissez une image PNG/JPEG de 512 Ko maximum.");
    await API.request("/profile/signature", {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
    document.getElementById("signatureForm").reset();
    await Workspace.loadSignature();
    App.notify("Signature importée pour les prochains documents.");
  });
  bind("deleteAccountForm", async () => {
    await API.post("/accounts/" + Family.accountId + "/delete", {
      confirmation: document.getElementById("deleteConfirmation").value,
    });
    App.closeModal(document.getElementById("deleteAccountModal"));
    Family.accountId = null;
    Family.detail = null;
    App.switchTab("accounts");
    await App.loadInitialData();
    App.notify("Compte supprimé.");
  });
  bind("loanCashForm", async () => {
    await API.post("/loans/cash", {
      loan_id: Workspace.cashLoan,
      mode: Workspace.cashMode,
      amount: document.getElementById("loanCashAmount").value,
      fee: document.getElementById("loanCashFee").value || 0,
      source_account_id: document.getElementById("loanCashSource").value,
      description: document.getElementById("loanCashReason").value,
    });
    App.closeModal(document.getElementById("loanCashModal"));
    await App.loadInitialData();
    App.notify("Mouvement tracé dans le dossier emprunt.");
  });
});
