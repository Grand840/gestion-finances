/** End-to-end family flows on temporary PostgreSQL, never the user's database. */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs/promises");
(async () => {
  const root = path.join(__dirname, "..");
  const server = spawn(
    process.env.PYTHON || "python3",
    ["-u", "tests/browser_server.py"],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  let logs = "",
    browser;
  server.stderr.on("data", (data) => (logs += data));
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Startup timeout " + logs)),
        20000,
      );
      server.on("error", reject);
      server.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error("Server exited " + code + logs));
      });
      server.stdout.on("data", (data) => {
        const match = String(data).match(/READY:(\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
    });
    browser = await chromium.launch({
      executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined,
      args: JSON.parse(process.env.BROWSER_ARGS || '["--no-sandbox"]'),
    });
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        reducedMotion: "reduce",
      }),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const base = `http://127.0.0.1:${port}`;
    await page.goto(base);
    await page.waitForFunction(
      () => !document.getElementById("authSubmit").disabled,
    );
    await page.evaluate(() => {
      window.testNotices = [];
      const notify = App.notify.bind(App);
      App.notify = (message, ...args) => {
        window.testNotices.push(message);
        return notify(message, ...args);
      };
    });
    const screenshots = process.env.SCREENSHOTS === "true";
    if (screenshots) {
      await fs.mkdir(path.join(root, "test-results"), { recursive: true });
      await page.screenshot({
        path: path.join(root, "test-results/register.png"),
        fullPage: true,
      });
    }
    async function fill(values) {
      for (const [id, value] of Object.entries(values))
        await page.locator("#" + id).fill(String(value));
    }
    async function submit(form, url) {
      const invalid = await page.locator("#" + form).evaluate((el) =>
        [...el.elements]
          .filter((input) => input.validity && !input.validity.valid)
          .map((input) => ({
            id: input.id,
            message: input.validationMessage,
          })),
      );
      assert.deepEqual(invalid, [], "invalid form " + form);
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith(url) &&
          ["POST", "PATCH"].includes(r.request().method()),
      );
      await page.locator("#" + form + " [type=submit]").click();
      let res;
      try {
        res = await response;
      } catch (error) {
        error.message +=
          " " +
          JSON.stringify(
            await page.locator("#" + form).evaluate((el) => ({
              saving: el.dataset.saving,
              active: document.activeElement?.id,
              modal: el.closest(".modal-overlay")?.className,
              invalid: [...el.elements]
                .filter((input) => input.validity && !input.validity.valid)
                .map((input) => input.id),
              notices: window.testNotices,
            })),
          );
        throw error;
      }
      assert(res.ok(), await res.text());
      await page.waitForFunction(
        (id) => !document.querySelector("#" + id + " [type=submit]").disabled,
        form,
      );
    }
    async function expandPeople() {
      const card = page.locator("#thirdPartyList > details").first();
      if (!(await card.evaluate((el) => el.open)))
        await card.locator(":scope > summary").click();
    }
    async function open(id) {
      await page.evaluate((id) => App.openModal(id), id);
    }
    await fill({
      authName: "Alex Mensah",
      authEmail: "alex@example.test",
      authPassword: "Une longue phrase familiale!",
      authCode: "browser-test-only-setup-code",
    });
    await submit("authForm", "/api/auth/register");
    await page.waitForFunction(() => App.state.accounts.length === 4);
    assert.equal(await page.locator("#authScreen").isVisible(), false);
    const accounts = await page.evaluate(() => App.state.accounts),
      aid = accounts[0].id;
    await page.getByRole("button", { name: "Ajouter une entrée" }).click();
    await fill({
      quickAmount: 250000,
      quickDescription: "Salaire de novembre",
    });
    await submit("quickAddForm", "/api/transactions");
    await page.getByRole("button", { name: "Noter une dépense" }).click();
    await fill({
      quickAmount: 15000,
      quickFee: 100,
      quickDescription: "Courses du marché",
    });
    await submit("quickAddForm", "/api/transactions");
    await page.getByRole("button", { name: "Faire un virement" }).click();
    await fill({ quickAmount: 20000, quickFee: 0 });
    await page.locator("#quickToAccount").selectOption(accounts[1].id);
    await submit("quickAddForm", "/api/transactions");
    await page.locator("#dashAccountsList [data-account-id]").first().click();
    await page.waitForSelector("#view-account-detail.active");
    assert.equal(
      await page.locator("#accountTransactions .account-operation").count(),
      3,
    );
    await page.getByText("Voir les détails", { exact: true }).first().click();
    await page.locator("#accountSearch").fill("marché");
    assert.equal(
      await page.locator("#accountTransactions .account-operation").count(),
      1,
    );
    await page.locator("#accountSearch").fill("");
    if (screenshots)
      await page.screenshot({
        path: path.join(root, "test-results/account-detail.png"),
        fullPage: true,
      });
    await open("loanGivenModal");
    await fill({
      lgBorrower: "Kofi d'Avé <ami>",
      lgTitle: "Prêt d'équipement",
      lgAmount: 25000,
    });
    await submit("loanGivenForm", "/api/loans/given");
    await page.evaluate(() => App.switchTab("loans-given"));
    await page.locator("#givenLoansList > details > summary").click();
    await page.getByRole("button", { name: "Encaisser un acompte" }).click();
    await fill({ recvAmount: 5000 });
    await submit("receiveLoanForm", "/api/loans/given/receive");
    await page.waitForSelector("#receiptModal.active");
    assert.match(
      await page.locator(".document-amounts").textContent(),
      /20\s*000/,
    );
    assert.match(
      await page.locator(".receipt-stamp").getAttribute("src"),
      /^data:image\/svg/,
    );
    const receiptId = (
      await page.locator(".document-actions a[download]").getAttribute("href")
    ).split("/")[3];
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Télécharger le PDF" }).click();
    const file = await download;
    assert.match(file.suggestedFilename(), /^SL-.*\.pdf$/);
    const filePath = await file.path();
    assert(
      (await fs.readFile(filePath)).subarray(0, 5).equals(Buffer.from("%PDF-")),
    );
    if (screenshots) {
      await page.screenshot({
        path: path.join(root, "test-results/receipt.png"),
        fullPage: true,
      });
      await page.pdf({
        path: path.join(root, "test-results/browser-print.pdf"),
        format: "A4",
        printBackground: true,
      });
    }
    await page.keyboard.press("Escape");
    await open("loanBorrowedModal");
    await fill({ lbLender: "Banque", lbTitle: "Avance", lbAmount: 50000 });
    assert.equal(await page.locator("#lbAccount").isDisabled(), true);
    await submit("loanBorrowedForm", "/api/loans/borrowed");
    await page.evaluate(() => App.switchTab("loans-borrowed"));
    await page.locator("#borrowedLoansList > details > summary").click();
    await page.getByRole("button", { name: /Payer un acompte/ }).click();
    await fill({ repayAmount: 10000 });
    await submit("repayLoanForm", "/api/loans/borrowed/repay");
    await page.waitForSelector("#receiptModal.active");
    await page.keyboard.press("Escape");
    await open("thirdPartyModal");
    await fill({ tpfPerson: "Proche", tpfReason: "Achats", tpfAmount: 30000 });
    await submit("thirdPartyForm", "/api/third-party");
    await page.evaluate(() => App.switchTab("thirdparty"));
    await page.locator("#thirdPartyList > details > summary").click();
    await page.getByRole("button", { name: "Restituer le reliquat" }).click();
    await fill({ refAmount: 10000 });
    await submit("refundForm", "/api/third-party/refund");
    assert.equal(
      await page.evaluate(() => Number(App.state.metrics.real_available_cash)),
      214900,
    );
    await page.evaluate(() => App.switchTab("admin"));
    await page.getByRole("button", { name: "Créer une invitation" }).click();
    await page.waitForFunction(
      () => document.getElementById("invitationCode").textContent.length > 10,
    );
    const invitation = await page.locator("#invitationCode").textContent();
    await page.evaluate(() => App.switchTab("settings"));
    await fill({
      currentPassword: "Une longue phrase familiale!",
      newPassword: "Ma nouvelle phrase personnelle!",
    });
    await submit("passwordForm", "/api/auth/password");
    await page.evaluate(() => App.switchTab("dashboard"));
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    assert.equal(
      await page.evaluate(async () => {
        const response = await fetch("/api%2Fexport");
        await response.json();
        return response.status;
      }),
      200,
    );
    if (screenshots)
      await page.screenshot({
        path: path.join(root, "test-results/dashboard.png"),
        fullPage: true,
      });
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        "dashboard overflow " + width,
      );
    }
    await page.evaluate((id) => Family.openAccount(id), aid);
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        "account overflow " + width,
      );
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    // A successful private response already in flight must not reappear after logout.
    await page.evaluate((id) => {
      window.originalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const response = await window.originalFetch(...args);
        if (args[0] === "/api/receipt/" + id) {
          window.receiptStarted = true;
          await new Promise((resolve) => (window.releaseReceipt = resolve));
        }
        return response;
      };
      window.pendingReceipt = App.openReceiptModal(id);
    }, receiptId);
    await page.waitForFunction(() => window.receiptStarted);
    await page.locator(".logout-button").click();
    await page.waitForFunction(() => !Family.user);
    await page.evaluate(() => window.releaseReceipt());
    await page.evaluate(() => window.pendingReceipt);
    await page.evaluate(() => (window.fetch = window.originalFetch));
    assert.equal(
      await page
        .locator("#receiptModal")
        .evaluate((el) => el.classList.contains("active")),
      false,
    );

    assert.equal(await page.locator("#receiptModalContent").textContent(), "");
    await page.locator("#registerTab").click();
    await fill({
      authName: "Autre membre",
      authEmail: "member@example.test",
      authPassword: "Une phrase pour le membre!",
      authCode: invitation,
    });
    await submit("authForm", "/api/auth/register");
    await page.waitForFunction(
      () =>
        App.state.accounts.length === 4 &&
        Family.user.email === "member@example.test",
    );
    assert.equal(await page.evaluate(() => App.state.transactions.length), 0);
    assert.equal(await page.locator(".admin-only").isVisible(), false);
    assert.equal(
      await page.evaluate(
        async (aid) => (await fetch("/api/accounts/" + aid)).status,
        aid,
      ),
      404,
    );
    await page.locator(".logout-button").click();
    await page.waitForFunction(() => !Family.user);
    await fill({
      authEmail: "alex@example.test",
      authPassword: "Ma nouvelle phrase personnelle!",
    });
    await submit("authForm", "/api/auth/login");
    await page.waitForFunction(
      () => Family.user?.email === "alex@example.test",
    );
    await page.context().setOffline(true);
    await page.evaluate(() => App.loadInitialData());
    assert.equal(await page.locator("#loadError").isVisible(), true);
    await page.context().setOffline(false);
    await page.evaluate(() => App.loadInitialData());
    assert.equal(await page.locator("#loadError").isVisible(), false);
    await page.evaluate((id) => Family.openAccount(id), aid);
    await page
      .getByRole("button", { name: "Modifier le nom / numéro" })
      .click();
    await fill({
      editAccountName: "Ma banque personnelle",
      editAccountNumber: "Mon numéro",
    });
    await submit("editAccountForm", "/api/accounts/" + aid);
    assert.equal(
      await page.locator("#detailAccountName").textContent(),
      "Ma banque personnelle",
    );
    await page.evaluate(() => App.switchTab("thirdparty"));
    await expandPeople();
    await page.getByRole("button", { name: "Enregistrer un achat" }).click();
    await fill({
      spendFundAmount: 2000,
      spendFundFee: 100,
      spendFundDescription: "Achat pour le proche",
    });
    await submit("spendFundForm", "/api/third-party/spend");
    assert.equal(
      await page.evaluate(() => Number(App.state.metrics.real_available_cash)),
      214900,
    );
    await open("assetModal");
    await fill({
      assetName: "Ordinateur",
      assetPurchaseVal: 180000,
      assetCurrentVal: 150000,
    });
    await submit("assetForm", "/api/assets");
    assert.equal(await page.evaluate(() => App.state.assets.length), 1);
    // New document identity and dossier workflows.
    await page.evaluate(() => App.switchTab("settings"));
    const signature = execFileSync(
      process.env.PYTHON || "python3",
      ["tests/signature-fixture.py"],
      { cwd: root },
    );
    await page.locator("#signatureFile").setInputFiles({
      name: "signature-test.png",
      mimeType: "image/png",
      buffer: signature,
    });
    await page.locator("#signatureForm input[type=checkbox]").check();
    const upload = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/profile/signature") &&
        r.request().method() === "PUT",
    );
    await page.locator("#signatureForm [type=submit]").click();
    assert.equal((await upload).status(), 200);
    await page.waitForFunction(
      () => !document.getElementById("signaturePreview").hidden,
    );
    await page.evaluate(() => App.switchTab("loans-borrowed"));
    await page
      .getByRole("button", { name: "Tout replier", exact: true })
      .click();
    assert.equal(
      await page.locator("#borrowedLoansList > details").getAttribute("open"),
      null,
    );
    await page
      .getByRole("button", { name: "Tout déplier", exact: true })
      .click();
    await page.getByRole("button", { name: "Tracer une utilisation" }).click();
    await fill({
      loanCashAmount: 100,
      loanCashFee: 10,
      loanCashReason: "Fournitures pour le projet",
    });
    await submit("loanCashForm", "/api/loans/cash");
    await page
      .getByRole("button", { name: "Alimenter pour rembourser" })
      .click();
    await fill({
      loanCashAmount: 100,
      loanCashReason: "Provision pour la prochaine échéance",
    });
    await submit("loanCashForm", "/api/loans/cash");
    await page
      .getByRole("button", { name: "Payer un acompte", exact: true })
      .click();
    await fill({
      repayAmount: 50,
      repayNotes: "Acompte après import de signature",
    });
    await submit("repayLoanForm", "/api/loans/borrowed/repay");
    await page.waitForSelector("#receiptModal.active .profile-signature");
    assert.match(
      await page.locator(".profile-signature").getAttribute("src"),
      /^data:image\/png/,
    );
    const signedDownload = page.waitForEvent("download");
    await page.getByRole("link", { name: "Télécharger le PDF" }).click();
    const signedFile = await signedDownload;
    if (screenshots)
      await fs.copyFile(
        await signedFile.path(),
        path.join(root, "test-results/signed-receipt.pdf"),
      );
    await page.keyboard.press("Escape");
    const reportDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Rapport détaillé PDF" }).click();
    const reportFile = await reportDownload;
    assert.match(reportFile.suggestedFilename(), /^SD-.*\.pdf$/);
    const reportPath = await reportFile.path();
    assert(
      (await fs.readFile(reportPath))
        .subarray(0, 5)
        .equals(Buffer.from("%PDF-")),
    );
    if (screenshots) {
      await fs.copyFile(
        reportPath,
        path.join(root, "test-results/loan-report.pdf"),
      );
      await page.screenshot({
        path: path.join(root, "test-results/dossiers.png"),
        fullPage: true,
      });
    }
    await page.evaluate(() => App.switchTab("thirdparty"));
    const personId = await page.evaluate(() => Workspace.people[0].id);
    await page.evaluate((id) => Workspace.deposit(id), personId);
    assert.equal(await page.locator("#tpfAccount").isDisabled(), true);
    assert.equal(await page.locator("#tpfPerson").isDisabled(), true);
    await fill({
      tpfReason: "Deuxième dépôt de la même personne",
      tpfAmount: 500,
    });
    await submit("thirdPartyForm", "/api/third-party");
    assert.equal(await page.evaluate(() => Workspace.people.length), 1);
    await expandPeople();
    await page
      .getByRole("button", { name: "Consulter les mouvements" })
      .click();
    await page.waitForSelector("#personLedgerModal.active");
    assert.match(
      await page.locator("#personLedgerContent").textContent(),
      /Achat pour le proche/,
    );
    const statementDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Télécharger le relevé PDF", exact: true })
      .click();
    const statement = await statementDownload;
    if (screenshots)
      await fs.copyFile(
        await statement.path(),
        path.join(root, "test-results/person-statement.pdf"),
      );
    await page.keyboard.press("Escape");
    const unused = await page.evaluate(
      () =>
        App.state.accounts.find(
          (a) => a.purpose === "personal" && Number(a.balance) === 0,
        ).id,
    );
    await page.evaluate((id) => Family.openAccount(id), unused);
    const unusedName = await page.locator("#detailAccountName").textContent();
    await page
      .getByRole("button", { name: "Supprimer définitivement ce compte" })
      .click();
    await fill({ deleteConfirmation: unusedName });
    await submit("deleteAccountForm", "/api/accounts/" + unused + "/delete");
    assert.equal(
      await page.evaluate(
        (id) => App.state.accounts.some((a) => a.id === id),
        unused,
      ),
      false,
    );
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const tab of [
        "loans-borrowed",
        "loans-given",
        "thirdparty",
        "settings",
      ]) {
        await page.evaluate((tab) => App.switchTab(tab), tab);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
          "dossier overflow " + width + " " + tab,
        );
      }
    }
    await page.evaluate(() => App.switchTab("admin"));
    await page.getByRole("button", { name: "Récupérer l’accès" }).click();
    await page.waitForFunction(
      () => document.getElementById("invitationCode").textContent.length > 10,
    );
    const recovery = await page.locator("#invitationCode").textContent();
    await page.locator(".logout-button").click();
    await page.waitForFunction(() => !Family.user);
    await page
      .getByRole("button", { name: "Réinitialiser avec un code" })
      .click();
    await fill({
      authEmail: "member@example.test",
      authPassword: "Une nouvelle phrase récupérée!",
      authCode: recovery,
    });
    await submit("authForm", "/api/auth/recover");
    assert.equal(
      await page.locator("#authPassword").getAttribute("autocomplete"),
      "current-password",
    );
    await fill({
      authEmail: "member@example.test",
      authPassword: "Une nouvelle phrase récupérée!",
    });
    await submit("authForm", "/api/auth/login");
    await page.waitForFunction(
      () => Family.user?.email === "member@example.test",
    );
    assert.equal(await page.evaluate(() => App.state.transactions.length), 0);
    assert.deepEqual(errors, []);
    console.log(
      "OK — inscription, connexion, déconnexion, isolation, opérations, détail de compte, prêts, remboursements, PDF, invitations, changement de mot de passe, suppression, signature privée, dossiers repliables, relevés de tiers, rapports PDF et 5 formats d’écran.",
    );
  } finally {
    await browser?.close();
    if (server.exitCode === null) {
      const stopped = new Promise((resolve) => server.once("exit", resolve));
      server.kill("SIGTERM");
      await stopped;
    }
  }
})().catch((error) => {
  console.error(error);
  if (process.env.GITHUB_ACTIONS) {
    console.log(
      "::error title=Parcours navigateur::" +
        String(error.stack || error)
          .replaceAll("%", "%25")
          .replaceAll("\r", "%0D")
          .replaceAll("\n", "%0A"),
    );
  }
  process.exitCode = 1;
});
