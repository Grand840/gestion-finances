"""Financial read-model regressions, isolated from the user's SQLite database."""
import os
import tempfile
import unittest
from unittest.mock import patch

import database


class MetricsTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path_patch = patch.object(database, 'DB_PATH', os.path.join(self.directory.name, 'test.db'))
        self.path_patch.start()
        database.init_db()
        with database.get_connection() as conn:
            self.account_id = conn.execute('SELECT id FROM accounts LIMIT 1').fetchone()[0]

    def tearDown(self):
        self.path_patch.stop()
        self.directory.cleanup()

    def test_empty_start(self):
        metrics = database.get_dashboard_metrics()
        self.assertEqual(metrics['real_available_cash'], 0)
        self.assertEqual(metrics['net_worth'], 0)
        self.assertEqual(metrics['categories_distribution'], [])

    def test_borrowed_money_is_not_personal_capital(self):
        database.record_transaction(self.account_id, 'income', 100000, 'Salaire')
        database.create_borrowed_loan('Banque', 'Avance', 50000, self.account_id)
        metrics = database.get_dashboard_metrics()
        self.assertEqual(metrics['total_cash_in_hand'], 150000)
        self.assertEqual(metrics['real_available_cash'], 100000)
        self.assertEqual(metrics['net_worth'], 100000)

    def test_third_party_funds_are_excluded(self):
        database.add_third_party_fund('Client', '', 'Achat', 30000, self.account_id, '2026-10-30')
        metrics = database.get_dashboard_metrics()
        self.assertEqual(metrics['total_cash_in_hand'], 30000)
        self.assertEqual(metrics['real_available_cash'], 0)

    def test_negative_available_is_not_hidden(self):
        database.create_borrowed_loan('Banque', 'Achat direct', 50000, None)
        self.assertEqual(database.get_dashboard_metrics()['real_available_cash'], -50000)

    def test_expense_chart_excludes_funding_flows_and_includes_fees(self):
        database.record_transaction(self.account_id, 'income', 100000, 'Salaire')
        database.record_transaction(self.account_id, 'expense', 15000, 'Courses', fee=100)
        database.create_given_loan('Ami', 'Dépannage', 20000, self.account_id)
        fund_id = database.add_third_party_fund('Client', '', 'Achat', 30000, self.account_id, '2026-10-30')
        database.refund_third_party_fund(fund_id, self.account_id, 5000)
        self.assertEqual(database.get_dashboard_metrics()['categories_distribution'], [{'category': 'Courses', 'total': 15100}])


if __name__ == '__main__':
    unittest.main()
