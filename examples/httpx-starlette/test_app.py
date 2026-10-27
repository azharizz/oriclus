import unittest

from app import response_text


class ApplicationTest(unittest.TestCase):
    def test_home(self):
        self.assertEqual(response_text(), "oriclus-ready")
