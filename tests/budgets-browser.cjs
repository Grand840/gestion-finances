/** Budget lifecycle on disposable PostgreSQL, including real debit consent. */
const { chromium } = require("playwright");
const { spawn, execFileSync } = require("node:child_process");
const path = require("node:path"),
  fs = require("node:fs/promises"),
  assert = require("node:assert/strict");
(async () => {
  const root = path.join(__dirname, ".."),
    server = spawn(
      process.env.PYTHON || "python3",
      ["-u", "tests/browser_server.py"],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );
  let logs = "",
    browser;
  server.stderr.on("data", (d) => (logs += d));
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
      server.stdout.on("data", (d) => {
        const m = String(d).match(/READY:(\d+)/);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
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
    page.on("pageerror", (e) => errors.push(e.message));
    const screenshots = process.env.SCREENSHOTS === "true";
    if (screenshots)
      await fs.mkdir(path.join(root, "test-results"), { recursive: true });
    async function fill(data) {
      for (const [id, value] of Object.entries(data))
        await page.locator("#" + id).fill(String(value));
    }
    async function submit(id, suffix, status = 200) {
      const response = page.waitForResponse(
        (r) => r.url().endsWith(suffix) && r.request().method() === "POST",
      );
      await page.locator("#" + id + ' [type="submit"]').click();
      const r = await response;
      assert.equal(r.status(), status, await r.text());
      return r.json();
    }
    async function accountBalance() {
      return page.evaluate(
        () =>
          App.state.accounts.find((a) => a.id === window.budgetTestAccount)
            .balance,
      );
    }
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(
      () => !document.getElementById("authSubmit").disabled,
    );
    await fill({
      authName: "Préparateur budget",
      authEmail: "budget@example.test",
      authPassword: "Une phrase pour les budgets!",
      authCode: "browser-test-only-setup-code",
    });
    await submit("authForm", "/api/auth/register");
    await page.waitForFunction(
      () => Family.user && App.state.accounts.length === 4,
    );
    const aid = await page.evaluate(async () => {
      const id = App.state.accounts[0].id;
      window.budgetTestAccount = id;
      await API.post("/transactions", {
        type: "income",
        amount: 1000,
        account_id: id,
        category: "Test budget",
      });
      await App.loadInitialData();
      return id;
    });
    const image = execFileSync(
      process.env.PYTHON || "python3",
      ["tests/signature-fixture.py"],
      { cwd: root },
    );
    const upload = await page.request.put(
      `http://127.0.0.1:${port}/api/profile/signature`,
      {
        data: image,
        headers: {
          "X-CSRF-Token": await page.evaluate(() => API.csrf),
          "Content-Type": "image/png",
        },
      },
    );
    assert.equal(upload.status(), 200);
    await page.locator('.nav-item[data-tab="budgets"]').click();
    await page
      .getByRole("button", { name: "Préparer un budget", exact: true })
      .click();
    await fill({
      budgetTitle: "Rénovation maison <test>",
      budgetPurpose: "Prévoir les travaux sans toucher aux comptes.",
      budgetProject: "Maison familiale",
      budgetBeneficiary: "Famille",
      budgetDate: "2026-10-30",
      budgetStart: "2026-11-01",
      budgetEnd: "2026-12-31",
      budgetDue: "2026-12-20",
      budgetFees: 5,
      budgetNotes: "Sur devis uniquement.",
    });
    let lines = page.locator("#budgetLines .budget-line");
    await lines.nth(0).locator('[data-field="label"]').fill("Peinture");
    await lines.nth(0).locator('[data-field="quantity"]').fill("2.5");
    await lines.nth(0).locator('[data-field="unit_price"]').fill("10");
    await lines.nth(0).locator('[data-field="reason"]').fill("Murs du salon");
    await page
      .getByRole("button", { name: "Ajouter une ligne", exact: true })
      .click();
    await lines.nth(1).locator('[data-field="label"]').fill("Main d’œuvre");
    await lines.nth(1).locator('[data-field="unit_price"]').fill("20");
    assert.match(await page.locator("#budgetTotal").textContent(), /50/);
    const created = await submit("budgetForm", "/api/budgets"),
      bid = created.id;
    await page.waitForFunction(
      () =>
        Budgets.current?.id && document.getElementById("budgetEditor").hidden,
    );
    await page.locator("#budgetDetail h2").waitFor();
    assert.equal(await accountBalance(), 1000);
    assert.equal(await page.evaluate(() => App.state.transactions.length), 1);
    assert.equal(
      await page.locator("#budgetDetail h2").textContent(),
      "Rénovation maison <test>",
    );
    const draftDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Émettre le PDF signé", exact: true })
      .click();
    const draftFile = await draftDownload;
    assert.match(draftFile.suggestedFilename(), /^SD-.*\.pdf$/);
    assert(
      (await fs.readFile(await draftFile.path()))
        .subarray(0, 5)
        .equals(Buffer.from("%PDF-")),
    );
    await page.waitForFunction(() => Budgets.current?.documents.length === 1);
    const evidenceDownload = page.waitForEvent("download");
    await page.locator("#budgetDetail a[download]").click();
    const evidenceFile = await evidenceDownload,
      evidence = JSON.parse(
        await fs.readFile(await evidenceFile.path(), "utf8"),
      );
    assert.equal(evidence.snapshot.budget_status, "draft");
    assert(
      evidence.verification.signature_valid && evidence.snapshot.signature_png,
    );
    if (screenshots) {
      await fs.copyFile(
        await draftFile.path(),
        path.join(root, "test-results/budget-draft.pdf"),
      );
      await page.screenshot({
        path: path.join(root, "test-results/budget-draft.png"),
        fullPage: true,
      });
    }
    await page
      .getByRole("button", { name: "Modifier le budget", exact: true })
      .click();
    await lines.nth(0).locator('[data-field="quantity"]').fill("3");
    await submit("budgetForm", `/api/budgets/${bid}/update`);
    await page.waitForFunction(() => Budgets.current?.revision === 2);
    await page.getByRole("button", { name: "Dupliquer", exact: true }).click();
    await page.waitForFunction((id) => Budgets.current?.id !== id, bid);
    assert.equal(await accountBalance(), 1000);
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "Annuler le budget", exact: true })
      .click();
    await page.waitForFunction(() => Budgets.current?.status === "cancelled");
    assert.equal(
      await page
        .getByRole("button", {
          name: "Valider et débiter un compte",
          exact: true,
        })
        .count(),
      0,
    );
    await page.evaluate((id) => Budgets.open(id), bid);
    await page
      .getByRole("button", {
        name: "Valider et débiter un compte",
        exact: true,
      })
      .click();
    await page.locator("#budgetValidationModal.active").waitFor();
    assert.equal(await page.locator("#budgetAccount").inputValue(), "");
    // Another tab changes the budget after the confirmation dialogue was opened.
    await page.evaluate(async (id) => {
      const b = await API.request("/budgets/" + id);
      await API.post(`/budgets/${id}/update`, { ...b, fees: 10 });
    }, bid);
    await page.locator("#budgetAccount").selectOption(aid);
    const ref = await page.locator("#budgetConfirmReference").textContent();
    await fill({ budgetConfirmation: ref });
    await page.locator("#budgetDebitConsent").check();
    await submit("budgetValidationForm", `/api/budgets/${bid}/validate`, 409);
    assert.equal(await accountBalance(), 1000);
    await page.keyboard.press("Escape");
    await page.evaluate((id) => Budgets.open(id), bid);
    await page
      .getByRole("button", {
        name: "Valider et débiter un compte",
        exact: true,
      })
      .click();
    await page.locator("#budgetValidationModal.active").waitFor();
    await page.locator("#budgetAccount").selectOption(aid);
    await fill({ budgetConfirmation: ref });
    await page.locator("#budgetDebitConsent").check();
    const final = await submit(
      "budgetValidationForm",
      `/api/budgets/${bid}/validate`,
    );
    await page.waitForFunction(
      () =>
        Budgets.current?.status === "validated" &&
        App.state.accounts.find((a) => a.id === window.budgetTestAccount)
          .balance === 940,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Modifier le budget", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page.evaluate(
        () =>
          App.state.transactions.filter((t) => t.category === "Budget validé")
            .length,
      ),
      1,
    );
    const finalProof = await page.evaluate(
      async (id) => await API.request(`/documents/${id}/proof`),
      final.document.id,
    );
    assert.equal(finalProof.snapshot.budget_status, "validated");
    assert(finalProof.verification.signature_valid);
    if (screenshots) {
      const pdf = await page.request.get(
        `http://127.0.0.1:${port}/api/documents/${final.document.id}/pdf`,
      );
      await fs.writeFile(
        path.join(root, "test-results/budget-validated.pdf"),
        await pdf.body(),
      );
      await page.screenshot({
        path: path.join(root, "test-results/budget-validated.png"),
        fullPage: true,
      });
    }
    // All three workspaces must fit narrow phone and desktop viewports.
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      await page.evaluate((id) => Budgets.open(id), bid);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        "budget detail overflow " + width,
      );
      await page.evaluate(() => Budgets.browse());
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        "budget list overflow " + width,
      );
      await page.evaluate(() => Budgets.edit(true));
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        "budget editor overflow " + width,
      );
      if (screenshots && width === 390)
        await page.screenshot({
          path: path.join(root, "test-results/budget-mobile-editor.png"),
          fullPage: true,
        });
      page.once("dialog", (d) => d.accept());
      await page.evaluate(() => Budgets.browse());
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const invitation = await page.evaluate(
      async () => (await API.post("/admin/invitations", {})).code,
    );
    // A private budget response in flight must not repopulate the DOM after logout.
    await page.evaluate((id) => {
      window.budgetOriginalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const r = await window.budgetOriginalFetch(...args);
        if (args[0] === "/api/budgets/" + id) {
          window.budgetFetchStarted = true;
          await new Promise((resolve) => (window.releaseBudgetFetch = resolve));
        }
        return r;
      };
      window.pendingBudget = Budgets.open(id);
    }, bid);
    await page.waitForFunction(() => window.budgetFetchStarted);
    await page.locator(".logout-button").click();
    await page.waitForFunction(() => !Family.user);
    await page.evaluate(() => window.releaseBudgetFetch());
    await page.evaluate(() => window.pendingBudget);
    await page.evaluate(() => (window.fetch = window.budgetOriginalFetch));
    for (const id of [
      "budgetList",
      "budgetDetail",
      "budgetLines",
      "budgetAccount",
      "budgetValidationInfo",
      "budgetConfirmReference",
    ])
      assert.equal(
        await page.locator("#" + id).textContent(),
        "",
        id + " was not cleared",
      );
    assert.equal(await page.evaluate(() => Budgets.current), null);
    await page.locator("#registerTab").click();
    await fill({
      authName: "Autre membre",
      authEmail: "other-budget@example.test",
      authPassword: "Une phrase pour le membre!",
      authCode: invitation,
    });
    await submit("authForm", "/api/auth/register");
    await page.waitForFunction(
      () => Family.user?.email === "other-budget@example.test",
    );
    await page.locator('.nav-item[data-tab="budgets"]').click();
    await page.waitForFunction(() =>
      document
        .getElementById("budgetListCount")
        .textContent.startsWith("0 budget"),
    );
    assert.equal(
      await page.evaluate(
        async (id) => (await fetch("/api/budgets/" + id)).status,
        bid,
      ),
      404,
    );
    assert.deepEqual(errors, []);
    console.log(
      "OK — budgets sans débit, édition, duplication, annulation, PDF signé et preuve, validation explicite et conflit de révision, débit unique, 5 formats et isolation/logout.",
    );
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
