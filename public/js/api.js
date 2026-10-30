/**
 * Client API REST (Togo - FCFA)
 * Gestion des comptes T-Money, Moov Money, Prêts/Emprunts et Reçus d'acomptes
 */

const API = {
  baseUrl: '',

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}/api${endpoint}`;
    const defaultHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...defaultHeaders,
          ...(options.headers || {})
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.message || `Erreur serveur (${response.status})`);
      }

      return await response.json();
    } catch (err) {
      console.error(`Erreur API ${endpoint}:`, err);
      throw err;
    }
  },

  async getMetrics() {
    return this.request('/metrics');
  },

  async getAccounts() {
    return this.request('/accounts');
  },

  async createAccount(data) {
    return this.request('/accounts', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async deleteAccount(id) {
    return this.request(`/accounts/${id}`, {
      method: 'DELETE'
    });
  },

  async getTransactions(limit = 50) {
    return this.request(`/transactions?limit=${limit}`);
  },

  async createTransaction(data) {
    return this.request('/transactions', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // MES EMPRUNTS
  async getBorrowedLoans() {
    return this.request('/loans/borrowed');
  },

  async createBorrowedLoan(data) {
    return this.request('/loans/borrowed', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async repayBorrowedLoan(data) {
    return this.request('/loans/borrowed/repay', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // MES PRÊTS ACCORDÉS
  async getGivenLoans() {
    return this.request('/loans/given');
  },

  async createGivenLoan(data) {
    return this.request('/loans/given', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async receiveLoanRepayment(data) {
    return this.request('/loans/given/receive', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // REÇUS D'ACOMPTES
  async getReceipt(id) {
    return this.request(`/receipt/${id}`);
  },

  // ARGENT DE TIERS
  async getThirdPartyFunds() {
    return this.request('/third-party');
  },

  async createThirdPartyFund(data) {
    return this.request('/third-party', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async refundThirdPartyFund(data) {
    return this.request('/third-party/refund', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // ACTIFS
  async getAssets() {
    return this.request('/assets');
  },

  async createAsset(data) {
    return this.request('/assets', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async deleteAsset(id) {
    return this.request(`/assets/${id}`, {
      method: 'DELETE'
    });
  },

  // PARAMÈTRES
  async getSettings() {
    return this.request('/settings');
  },

  async updateSettings(data) {
    return this.request('/settings', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async verifyPin(pin) {
    return this.request('/verify-pin', {
      method: 'POST',
      body: JSON.stringify({ pin })
    });
  },

  async exportData() {
    return this.request('/export');
  }
};
