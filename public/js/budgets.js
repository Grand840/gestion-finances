/** Private budget drafts. Money moves only through the explicit validation form. */
const Budgets = {
  rows: [],
  offset: 0,
  count: 0,
  current: null,
  editing: null,
  serial: 0,
  detailSerial: 0,
  status: {
    draft: "Prévisionnel",
    validated: "Validé et débité",
    cancelled: "Annulé",
  },
  esc: (v) => App.escapeHtml(String(v ?? "")),
  today: () => new Date().toLocaleDateString("en-CA"),
  reset() {
    this.serial++;
    this.detailSerial++;
    this.rows = [];
    this.current = null;
    this.editing = null;
    this.offset = 0;
    this.count = 0;
    for (const id of [
      "budgetList",
      "budgetDetail",
      "budgetLines",
      "budgetAccount",
      "budgetValidationInfo",
      "budgetConfirmReference",
      "budgetPage",
    ])
      document.getElementById(id).replaceChildren();
    document.getElementById("budgetEditor").hidden = true;
    document.getElementById("budgetDetail").hidden = true;
    document.getElementById("budgetBrowse").hidden = false;
    document.getElementById("budgetValidationModal").classList.remove("active");
    document.getElementById("budgetListCount").textContent = "";
    document.getElementById("budgetSearch").value = "";
    document.getElementById("budgetFilter").value = "all";
    document.getElementById("budgetPagination").hidden = true;
    document.getElementById("budgetTotal").textContent = "";
  },
  async load(reset = false) {
    if (!Family.user) return;
    if (reset) this.offset = 0;
    const epoch = Family.epoch,
      serial = ++this.serial;
    try {
      const query = new URLSearchParams({
        status: document.getElementById("budgetFilter").value,
        q: document.getElementById("budgetSearch").value,
        offset: this.offset,
        limit: 20,
      });
      const data = await API.request("/budgets?" + query);
      if (epoch !== Family.epoch || serial !== this.serial) return;
      this.rows = data.items;
      this.count = data.total;
      document.getElementById("budgetListCount").textContent =
        data.total + " budget(s) · Préparer n’engage aucun compte";
      document.getElementById("budgetList").innerHTML =
        data.items
          .map(
            (b) =>
              `<article class="budget-card"><div><span class="budget-status ${b.status}">${this.status[b.status]}</span><h3>${this.esc(b.title)}</h3><p>${this.esc(b.project || "Sans projet associé")} · ${this.esc(b.reference)}</p><small>Préparé le ${App.formatDate(b.budget_date)}${b.due_date ? " · Échéance : " + App.formatDate(b.due_date) : ""}</small>${b.status === "draft" && b.due_date && b.due_date < this.today() ? '<span class="overdue-tag">Échéance dépassée · aucun débit automatique</span>' : ""}</div><div class="budget-card-end"><strong>${App.formatMoney(b.total, b.currency)}</strong><button type="button" class="btn btn-secondary btn-sm" onclick="Budgets.open('${b.id}')">Consulter le budget</button></div></article>`,
          )
          .join("") ||
        '<div class="budget-empty"><h3>Préparer aujourd’hui, décider ensuite.</h3><p>Créez votre premier budget avec ses dépenses, ses motifs et ses échéances. Aucun compte ne sera débité à cette étape.</p></div>';
      document.getElementById("budgetPagination").hidden = data.total <= 20;
      document.getElementById("budgetPrevious").disabled = this.offset === 0;
      document.getElementById("budgetNext").disabled =
        this.offset + 20 >= data.total;
      document.getElementById("budgetPage").textContent =
        `${Math.floor(this.offset / 20) + 1} / ${Math.max(1, Math.ceil(data.total / 20))}`;
    } catch (e) {
      if (epoch === Family.epoch) App.notify(e.message, true);
    }
  },
  page(delta) {
    this.offset = Math.max(0, this.offset + delta * 20);
    this.load();
  },
  async browse() {
    if (
      !document.getElementById("budgetEditor").hidden &&
      !confirm("Quitter l’éditeur sans enregistrer les modifications ?")
    )
      return;
    this.editing = null;
    this.detailSerial++;
    document.getElementById("budgetEditor").hidden = true;
    document.getElementById("budgetDetail").hidden = true;
    document.getElementById("budgetBrowse").hidden = false;
    await this.load();
  },
  async open(id) {
    const epoch = Family.epoch,
      serial = ++this.detailSerial;
    try {
      const b = await API.request("/budgets/" + id);
      if (epoch !== Family.epoch || serial !== this.detailSerial) return;
      this.current = b;
      document.getElementById("budgetBrowse").hidden = true;
      document.getElementById("budgetEditor").hidden = true;
      const detail = document.getElementById("budgetDetail");
      detail.hidden = false;
      detail.innerHTML = `<button class="text-link" onclick="Budgets.browse()">← Tous les budgets</button><div class="panel budget-detail-panel"><div class="budget-detail-heading"><div><span class="budget-status ${b.status}">${this.status[b.status]}</span><h2>${this.esc(b.title)}</h2><p>${this.esc(b.reference)} · Révision ${b.revision}</p></div><strong>${App.formatMoney(b.total, b.currency)}</strong></div><p class="budget-safety">${b.status === "validated" ? `Débit enregistré le ${App.formatDate(b.payment_date)} sur ${this.esc(b.account_name)}. Ce budget est désormais figé.` : b.status === "cancelled" ? "Budget annulé et conservé pour l’historique. Aucun compte débité." : "Document prévisionnel : aucun compte débité, aucune somme réservée. La validation enregistrera une dépense réelle du montant total."}</p><dl class="budget-facts">${[
        ["Motif / objectif", b.purpose],
        ["Projet", b.project || "Non précisé"],
        ["Bénéficiaire", b.beneficiary || "Non précisé"],
        ["Préparation", App.formatDate(b.budget_date)],
        [
          "Période",
          `${b.start_date ? App.formatDate(b.start_date) : "Non fixée"} → ${b.end_date ? App.formatDate(b.end_date) : "Non fixée"}`,
        ],
        [
          "Échéance générale",
          b.due_date ? App.formatDate(b.due_date) : "Non fixée",
        ],
      ]
        .map(([k, v]) => `<div><dt>${k}</dt><dd>${this.esc(v)}</dd></div>`)
        .join(
          "",
        )}</dl><div class="budget-detail-lines">${b.items.map((i) => `<article><div><strong>${this.esc(i.label)}</strong><p>${this.esc(i.category)}${i.reason ? " · " + this.esc(i.reason) : ""}</p><small>${this.esc(i.quantity.replace(".", ","))} × ${App.formatMoney(i.unit_price, b.currency)}${i.beneficiary ? " · " + this.esc(i.beneficiary) : ""}${i.due_date ? " · Échéance : " + App.formatDate(i.due_date) : ""}</small></div><strong>${App.formatMoney(i.amount, b.currency)}</strong></article>`).join("")}</div><div class="budget-summary"><span>Dépenses : ${App.formatMoney(b.subtotal, b.currency)}</span><span>Frais : ${App.formatMoney(b.fees, b.currency)}</span><strong>Total : ${App.formatMoney(b.total, b.currency)}</strong></div>${b.notes ? `<p class="budget-notes">${this.esc(b.notes)}</p>` : ""}<div class="action-wrap">${b.status === "draft" ? '<button class="btn btn-secondary" onclick="Budgets.edit()">Modifier le budget</button><button class="btn btn-primary" onclick="Budgets.askValidation()">Valider et débiter un compte</button>' : ""}<button class="btn btn-secondary" onclick="Budgets.pdf(this)">Émettre le PDF signé</button><button class="btn btn-secondary" onclick="Budgets.duplicate(this)">Dupliquer</button>${b.status === "draft" ? '<button class="text-link danger-link" onclick="Budgets.cancel(this)">Annuler le budget</button>' : ""}</div></div><div class="panel budget-detail-panel"><h3>Documents émis</h3><p class="field-hint">Versions figées avec signature de profil, cachet et scellé d’intégrité. Un PDF prévisionnel n’atteste pas un débit.</p>${b.documents.map((d) => `<article class="document-history-row"><div><strong>${this.esc(d.title)}</strong><small>${this.esc(d.reference)} · Révision ${this.esc(d.revision)} · ${App.formatDate(d.created_at)}</small></div><button class="btn btn-secondary btn-sm" onclick="Workspace.downloadPDF('${d.id}','${d.reference}').catch(e=>App.notify(e.message,true))">PDF</button><a class="btn btn-secondary btn-sm" href="/api/documents/${d.id}/proof" download>Preuve</a></article>`).join("") || '<p class="field-hint">Aucun document émis pour ce budget.</p>'}</div>`;
      window.scrollTo({ top: 0, behavior: "instant" });
    } catch (e) {
      if (epoch === Family.epoch) App.notify(e.message, true);
    }
  },
  edit(fresh = false) {
    this.detailSerial++;
    const b = fresh ? null : this.current;
    if (b && b.status !== "draft") return;
    this.editing = b;
    document.getElementById("budgetForm").reset();
    const mapping = {
      Title: "title",
      Purpose: "purpose",
      Project: "project",
      Beneficiary: "beneficiary",
      Date: "budget_date",
      Start: "start_date",
      End: "end_date",
      Due: "due_date",
      Notes: "notes",
      Fees: "fees",
    };
    for (const [suffix, key] of Object.entries(mapping))
      document.getElementById("budget" + suffix).value =
        b?.[key] ??
        (suffix === "Date" ? this.today() : suffix === "Fees" ? "0" : "");
    document.getElementById("budgetEditorTitle").textContent = b
      ? "Modifier le budget prévisionnel"
      : "Nouveau budget prévisionnel";
    document.getElementById("budgetLines").replaceChildren();
    for (const item of b?.items || [{}]) this.addLine(item);
    document.getElementById("budgetBrowse").hidden = true;
    document.getElementById("budgetDetail").hidden = true;
    document.getElementById("budgetEditor").hidden = false;
    this.calculate();
    document.getElementById("budgetTitle").focus();
  },
  addLine(item = {}) {
    const parent = document.getElementById("budgetLines");
    if (parent.children.length >= 50)
      return App.notify("50 lignes maximum par budget.", true);
    const row = document.createElement("fieldset");
    row.className = "budget-line";
    const text = (key, label, max, required = false) =>
      `<label>${label}<input data-field="${key}" class="form-input" maxlength="${max}" value="${this.esc(item[key] || "")}" ${required ? "required" : ""}></label>`;
    row.innerHTML = `<legend>Ligne budgétaire</legend><div class="budget-form-grid">${text("label", "Libellé", 160, true)}${text("category", "Catégorie", 80, true)}${text("reason", "Motif de la dépense", 400)}${text("beneficiary", "Bénéficiaire / fournisseur", 160)}<label>Quantité<input class="form-input" data-field="quantity" type="number" step="0.01" min="0.01" max="1000000" value="${this.esc(item.quantity ?? 1)}" required></label><label>Prix unitaire<input class="form-input" data-field="unit_price" type="number" step="0.01" min="0" max="999999999999.99" value="${this.esc(item.unit_price ?? "")}" required></label><label>Échéance de la ligne<input class="form-input" data-field="due_date" type="date" value="${this.esc(item.due_date || "")}"></label><div class="budget-line-total"><span>Montant de la ligne</span><strong data-line-total></strong></div></div><button type="button" class="text-link danger-link" data-remove-line>Retirer cette ligne</button>`;
    if (!item.category)
      row.querySelector('[data-field="category"]').value = "Divers";
    row.querySelector("[data-remove-line]").onclick = () => {
      if (parent.children.length === 1)
        return App.notify("Conservez au moins une ligne.", true);
      row.remove();
      this.calculate();
    };
    row.addEventListener("input", () => this.calculate());
    parent.append(row);
    this.calculate();
  },
  cents(v) {
    const m = /^(\d{1,16})(?:\.(\d{1,2}))?$/.exec(String(v));
    if (m) return BigInt(m[1]) * 100n + BigInt((m[2] || "").padEnd(2, "0"));
    // Number inputs may contain exponent notation (e.g. 1e2). Normalize it
    // without using floating point for the quantity × price calculation.
    const numeric = Number(v);
    return Number.isFinite(numeric) && numeric >= 0 && numeric < 1e12
      ? this.cents(numeric.toFixed(2))
      : 0n;
  },
  calculate() {
    let sum = 0n;
    for (const row of document.querySelectorAll("#budgetLines .budget-line")) {
      const q = this.cents(row.querySelector('[data-field="quantity"]').value),
        p = this.cents(row.querySelector('[data-field="unit_price"]').value),
        amount = (q * p + 50n) / 100n;
      sum += amount;
      row.querySelector("[data-line-total]").textContent = App.formatMoney(
        Number(amount) / 100,
      );
    }
    document.getElementById("budgetTotal").textContent = App.formatMoney(
      Number(sum + this.cents(document.getElementById("budgetFees").value)) /
        100,
    );
  },
  async save() {
    const b = this.editing;
    const data = {
      title: document.getElementById("budgetTitle").value,
      purpose: document.getElementById("budgetPurpose").value,
      project: document.getElementById("budgetProject").value,
      beneficiary: document.getElementById("budgetBeneficiary").value,
      budget_date: document.getElementById("budgetDate").value,
      start_date: document.getElementById("budgetStart").value,
      end_date: document.getElementById("budgetEnd").value,
      due_date: document.getElementById("budgetDue").value,
      fees: document.getElementById("budgetFees").value || "0",
      notes: document.getElementById("budgetNotes").value,
      items: [...document.querySelectorAll("#budgetLines .budget-line")].map(
        (row) =>
          Object.fromEntries(
            [...row.querySelectorAll("[data-field]")].map((el) => [
              el.dataset.field,
              el.value,
            ]),
          ),
      ),
    };
    if (b) data.revision = b.revision;
    const result = await API.post(
      b ? `/budgets/${b.id}/update` : "/budgets",
      data,
    );
    await this.open(result.id);
    App.notify("Budget enregistré. Aucun compte n’a été débité.");
  },
  async askValidation() {
    const b = this.current,
      epoch = Family.epoch;
    if (!b || b.status !== "draft") return;
    try {
      const accounts = await API.getAccounts();
      if (epoch !== Family.epoch || this.current?.id !== b.id) return;
      const eligible = accounts.filter(
        (a) =>
          a.purpose === "personal" && a.is_active && a.currency === b.currency,
      );
      document.getElementById("budgetValidationForm").reset();
      document.getElementById("budgetAccount").innerHTML =
        '<option value="">Choisir le compte à débiter</option>' +
        eligible
          .map(
            (a) =>
              `<option value="${a.id}">${this.esc(a.name)} · ${App.formatMoney(a.balance, a.currency)}${Number(a.balance) < Number(b.total) ? " · solde insuffisant" : ""}</option>`,
          )
          .join("");
      document.getElementById("budgetPaymentDate").value = this.today();
      document.getElementById("budgetPaymentDate").max = this.today();
      document.getElementById("budgetValidationInfo").textContent =
        `${b.title} · ${b.reference} · Révision ${b.revision}. Débit réel de ${App.formatMoney(b.total, b.currency)}, frais inclus. Un seul débit de l’ensemble du budget, même si les lignes ont des échéances futures. Aucun prélèvement automatique ultérieur.`;
      document.getElementById("budgetConfirmReference").textContent =
        b.reference;
      App.openModal("budgetValidationModal");
    } catch (e) {
      if (epoch === Family.epoch) App.notify(e.message, true);
    }
  },
  async validate() {
    const b = this.current;
    if (!document.getElementById("budgetDebitConsent").checked)
      throw new Error("Confirmez le débit réel du budget.");
    const result = await API.post(`/budgets/${b.id}/validate`, {
      revision: b.revision,
      confirmation: document.getElementById("budgetConfirmation").value,
      account_id: document.getElementById("budgetAccount").value,
      payment_date: document.getElementById("budgetPaymentDate").value,
    });
    App.closeModal(document.getElementById("budgetValidationModal"));
    await App.loadInitialData();
    await this.open(result.id);
    App.notify(
      "Budget validé : débit enregistré une seule fois et document signé émis.",
    );
  },
  async duplicate(button) {
    button.disabled = true;
    try {
      const r = await API.post(`/budgets/${this.current.id}/duplicate`, {});
      await this.open(r.id);
      App.notify("Copie prévisionnelle créée, sans débit.");
    } catch (e) {
      App.notify(e.message, true);
    } finally {
      button.disabled = false;
    }
  },
  async cancel(button) {
    const b = this.current;
    if (
      !confirm(
        "Annuler ce budget sans débiter de compte ? Il restera consultable.",
      )
    )
      return;
    button.disabled = true;
    try {
      await API.post(`/budgets/${b.id}/cancel`, {
        revision: b.revision,
        confirmation: b.reference,
      });
      await this.open(b.id);
    } catch (e) {
      App.notify(e.message, true);
    } finally {
      button.disabled = false;
    }
  },
  async pdf(button) {
    const id = this.current.id;
    button.disabled = true;
    try {
      const d = await API.post("/documents", {
        kind: "budget",
        resource_id: id,
      });
      await Workspace.downloadPDF(d.id, d.reference);
      await this.open(id);
    } catch (e) {
      App.notify(e.message, true);
    } finally {
      button.disabled = false;
    }
  },
};
const budgetPreviousTab = Family.onTab.bind(Family);
Family.onTab = (tab) => {
  budgetPreviousTab(tab);
  if (tab === "budgets" && Family.user) Budgets.browse();
};
const budgetPreviousAuth = Family.showAuth.bind(Family);
Family.showAuth = (...args) => {
  Budgets.reset();
  return budgetPreviousAuth(...args);
};
document.addEventListener("DOMContentLoaded", () => {
  for (const [id, handler] of [
    ["budgetForm", () => Budgets.save()],
    ["budgetValidationForm", () => Budgets.validate()],
  ])
    document.getElementById(id).addEventListener("submit", async (e) => {
      e.preventDefault();
      const button = e.currentTarget.querySelector('[type="submit"]');
      if (button.disabled) return;
      button.disabled = true;
      try {
        await handler();
      } catch (error) {
        App.notify(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
  document
    .getElementById("budgetFees")
    .addEventListener("input", () => Budgets.calculate());
  document
    .getElementById("budgetSearchForm")
    .addEventListener("submit", (e) => {
      e.preventDefault();
      Budgets.load(true);
    });
  document
    .getElementById("budgetFilter")
    .addEventListener("change", () => Budgets.load(true));
});
