/** Browser regression test. Always uses a temporary database and an isolated server. */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

(async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "sillage-test-"));
  const python = `import database, sys
 database.DB_PATH = sys.argv[1]
 import server, http.server
 httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), server.FinanceRequestHandler)
 print('READY:' + str(httpd.server_port), flush=True)
 httpd.serve_forever()`.replace(/\n /g, "\n");
  const server = spawn(
    process.env.PYTHON || "python3",
    ["-u", "-c", python, path.join(directory, "test.db")],
    { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"] },
  );
  let browser;
  let serverLogs = "";
  server.stderr.on("data", (data) => (serverLogs += data));
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Test server startup timed out. " + serverLogs)),
        10000,
      );
      server.once("error", reject);
      server.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Test server exited: ${code}. ${serverLogs}`));
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
      headless: true,
      executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined,
      args: JSON.parse(process.env.BROWSER_ARGS || '["--no-sandbox"]'),
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => App.state.accounts.length === 4);
    async function fill(values) {
      for (const [id, value] of Object.entries(values))
        await page.locator("#" + id).fill(String(value));
    }
    async function open(id) {
      await page.evaluate((id) => App.openModal(id), id);
    }
    async function submit(form, url) {
      const response = page.waitForResponse(
        (r) => r.url().endsWith(url) && r.request().method() === "POST",
      );
      await page.locator("#" + form + " [type=submit]").click();
      const res = await response;
      assert(res.ok(), await res.text());
      await page.waitForFunction(
        () => !document.querySelector("form[data-saving=true]"),
      );
    }
    await page.evaluate(() => App.startOperation("income"));
    await fill({ quickAmount: 250000, quickDescription: "Salaire octobre" });
    await submit("quickAddForm", "/api/transactions");
    assert.equal(
      await page.evaluate(() => App.state.metrics.total_cash_in_hand),
      250000,
    );
    await page.evaluate(() => App.startOperation("expense"));
    await fill({
      quickAmount: 15000,
      quickFee: 100,
      quickDescription: "Courses du marché",
    });
    await submit("quickAddForm", "/api/transactions");
    await page.evaluate(() => App.startOperation("transfer"));
    await fill({
      quickAmount: 20000,
      quickFee: 0,
      quickDescription: "Retrait espèces",
    });
    const accounts = await page.evaluate(() => App.state.accounts);
    await page.locator("#quickToAccount").selectOption(accounts[1].id);
    await submit("quickAddForm", "/api/transactions");
    await open("loanGivenModal");
    await fill({
      lgBorrower: "Kofi d'Avé <ami>",
      lgTitle: "Prêt d'équipement",
      lgAmount: 25000,
    });
    await submit("loanGivenForm", "/api/loans/given");
    await page.evaluate(() => App.switchTab("loans-given"));
    await page.getByRole("button", { name: "Encaisser un acompte" }).click();
    assert.match(
      await page.locator("#recvTitle").textContent(),
      /Kofi d'Avé <ami>/,
    );
    await fill({ recvAmount: 5000 });
    await submit("receiveLoanForm", "/api/loans/given/receive");
    await page.waitForSelector("#receiptModal.active");
    await page.keyboard.press("Escape");
    await open("loanBorrowedModal");
    assert.equal(
      await page.locator("#lbAccount option").first().getAttribute("value"),
      "",
    );
    await fill({
      lbLender: "Banque d'Afrique",
      lbTitle: "Avance",
      lbAmount: 50000,
    });
    await page.locator("#lbAccount").selectOption(accounts[0].id);
    await submit("loanBorrowedForm", "/api/loans/borrowed");
    await page.evaluate(() => App.switchTab("loans-borrowed"));
    await page.getByRole("button", { name: /Payer un acompte/ }).click();
    await fill({ repayAmount: 10000 });
    await submit("repayLoanForm", "/api/loans/borrowed/repay");
    await page.waitForSelector("#receiptModal.active");
    await page.keyboard.press("Escape");
    await open("thirdPartyModal");
    await fill({
      tpfPerson: "Ami d'Aného",
      tpfReason: "Achat de matériel",
      tpfAmount: 30000,
    });
    await submit("thirdPartyForm", "/api/third-party");
    await page.evaluate(() => App.switchTab("thirdparty"));
    await page.getByRole("button", { name: "Restituer le reliquat" }).click();
    await fill({ refAmount: 10000 });
    await submit("refundForm", "/api/third-party/refund");
    await open("assetModal");
    await fill({
      assetName: "Ordinateur",
      assetPurchaseVal: 180000,
      assetCurrentVal: 160000,
    });
    await submit("assetForm", "/api/assets");
    await page.evaluate(() => App.switchTab("transactions"));
    await page.locator("#transactionSearch").fill("marché");
    assert.equal(await page.locator("#allTransactions .tx-row").count(), 1);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Exporter CSV" }).click();
    console.log("CSV", (await download).suggestedFilename());
    await page.locator("#transactionSearch").fill("");
    await page.evaluate(() => App.switchTab("dashboard"));
    assert.equal(
      await page.evaluate(() => App.state.metrics.real_available_cash),
      214900,
    ); // all own funds, debt/funds excluded
    await page.evaluate(() => App.switchTab("settings"));
    await fill({ settingUserName: "Alex Mensah", settingNewPin: "123456" });
    await page.locator("#settingPinToggle").check();
    await submit("settingsForm", "/api/settings");
    await page.reload();
    await page.waitForSelector("#pinScreen.active");
    await page.keyboard.type("123456");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => !App.state.isLocked);
    assert(!(await page.locator("#pinScreen").isVisible()));
    console.log("PIN 6 digits OK");
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 850 });
      await page.evaluate(() => App.switchTab("dashboard"));
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        "overflow " + width,
      );
    }
    await open("accountModal");
    await fill({ accName: "Compte test", accBalance: 0 });
    await submit("accountForm", "/api/accounts");
    assert.equal(await page.evaluate(() => App.state.accounts.length), 5);
    await page.context().setOffline(true);
    await page.evaluate(() => App.loadInitialData());
    assert.equal(await page.locator("#loadError").isVisible(), true);
    await page.context().setOffline(false);
    await page.evaluate(() => App.loadInitialData());
    assert.equal(await page.locator("#loadError").isVisible(), false);
    assert.deepEqual(errors, []);
    console.log(
      "OK: income, expense, transfer, loans, repayments, receipts, third-party funds, assets, search, CSV, PIN and responsive layout.",
    );
  } finally {
    await browser?.close();
    if (server.exitCode === null) {
      const exited = new Promise((resolve) => server.once("exit", resolve));
      server.kill("SIGTERM");
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
