import unittest

from app import app


class ApplicationTests(unittest.TestCase):
    def test_home(self):
        with app.test_client() as client:
            self.assertEqual(client.get("/").data, b"hello")


if __name__ == "__main__":
    unittest.main()
