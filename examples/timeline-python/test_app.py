import unittest

from app import render


class RenderTest(unittest.TestCase):
    def test_render(self):
        self.assertEqual(render(42), "42")
