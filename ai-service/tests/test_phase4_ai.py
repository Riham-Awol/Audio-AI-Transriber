import unittest

from app.providers.ollama_provider import OllamaProvider


class TestPhase4Summarization(unittest.TestCase):
    def setUp(self):
        self.provider = OllamaProvider(ollama_url="http://invalid-local-host-for-fallback:11434")

    def test_fallback_heuristic_summary_extraction(self):
        sample_transcript = (
            "Sarah Connor: Welcome everyone. Let's discuss the Q4 product roadmap.\n"
            "John Doe: We agreed to ship the WhisperX forced alignment by next week.\n"
            "Sarah Connor: That's a great action item. John will handle the deployment by Friday.\n"
            "Alex: We decided to use Qwen 2.5 for meeting summarization.\n"
        )

        summary = self.provider.summarize_meeting(
            sample_transcript,
            title="Q4 Planning",
            detail_level="standard",
            speakers=["Sarah Connor", "John Doe", "Alex"],
        )

        self.assertIsNotNone(summary)
        self.assertTrue(len(summary.executive_summary) > 20)
        self.assertTrue(len(summary.main_topics) > 0)
        self.assertTrue(len(summary.decisions) > 0)
        self.assertTrue(len(summary.action_items) > 0)
        self.assertIn("Q4 Planning", summary.minutes_markdown)

    def test_empty_transcript_handling(self):
        summary = self.provider.summarize_meeting("", title="Empty")
        self.assertIn("No spoken conversation", summary.executive_summary)


if __name__ == "__main__":
    unittest.main()

