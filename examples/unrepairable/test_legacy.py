"""A legacy test directly imports the API removed in MarkupSafe 2.1."""

import unittest

from markupsafe import soft_unicode


class LegacyImportTest(unittest.TestCase):
    def test_legacy_import(self):
        self.assertEqual(soft_unicode(42), "42")
