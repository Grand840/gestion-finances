/** Same-origin API. Sessions live only in HttpOnly cookies, never localStorage. */
const API = {
  csrf: "",
  async request(endpoint, options = {}) {
    const write = options.method && options.method !== "GET";
    const response = await fetch("/api" + endpoint, {
      ...options,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(write && this.csrf ? { "X-CSRF-Token": this.csrf } : {}),
        ...(write
          ? {
              "Idempotency-Key": crypto.randomUUID
                ? crypto.randomUUID()
                : Date.now() + "-" + Math.random(),
            }
          : {}),
        ...options.headers,
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && !endpoint.startsWith("/auth/"))
        window.dispatchEvent(new Event("session-expired"));
      throw new Error(data.error || "Service indisponible. Réessayez.");
    }
    return data;
  },
  post(endpoint, data = {}) {
    return this.request(endpoint, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  getMetrics() {
    return this.request("/metrics");
  },
  getAccounts() {
    return this.request("/accounts");
  },
  createAccount(d) {
    return this.post("/accounts", d);
  },
  deleteAccount(id) {
    return this.request("/accounts/" + id, { method: "DELETE" });
  },
  getTransactions(limit = 200, offset = 0, account = null) {
    return this.request(
      "/transactions?limit=" +
        limit +
        "&offset=" +
        offset +
        (account ? "&account_id=" + encodeURIComponent(account) : ""),
    );
  },
  createTransaction(d) {
    return this.post("/transactions", d);
  },
  getBorrowedLoans() {
    return this.request("/loans/borrowed");
  },
  createBorrowedLoan(d) {
    return this.post("/loans/borrowed", d);
  },
  repayBorrowedLoan(d) {
    return this.post("/loans/borrowed/repay", d);
  },
  getGivenLoans() {
    return this.request("/loans/given");
  },
  createGivenLoan(d) {
    return this.post("/loans/given", d);
  },
  receiveLoanRepayment(d) {
    return this.post("/loans/given/receive", d);
  },
  getReceipt(id) {
    return this.request("/receipt/" + id);
  },
  getThirdPartyFunds() {
    return this.request("/third-party");
  },
  createThirdPartyFund(d) {
    return this.post("/third-party", d);
  },
  refundThirdPartyFund(d) {
    return this.post("/third-party/refund", d);
  },
  getAssets() {
    return this.request("/assets");
  },
  createAsset(d) {
    return this.post("/assets", d);
  },
  deleteAsset(id) {
    return this.request("/assets/" + id, { method: "DELETE" });
  },
  getSettings() {
    return this.request("/settings");
  },
  updateSettings(d) {
    return this.post("/settings", d);
  },
  exportData() {
    return this.request("/export");
  },
};
