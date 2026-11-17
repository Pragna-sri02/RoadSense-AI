import re
from typing import List, Dict, Any


def clean_text_for_speech(text: str) -> str:
    """
    Format text for clear browser text-to-speech synthesis by stripping
    markdown formatting, markdown links, bullets, and excessive punctuation.
    """
    if not text:
        return ""

    # Remove markdown links [text](url) -> text
    cleaned = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    # Remove bold, italics, code markers (*, _, `)
    cleaned = re.sub(r"[*_`#~]", "", cleaned)
    # Remove bullet markers at line start
    cleaned = re.sub(r"^\s*[-*•]\s*", "", cleaned, flags=re.MULTILINE)
    # Collapse multiple whitespaces
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    return cleaned


def get_suggested_questions() -> List[Dict[str, str]]:
    """Return a curated set of questions the Road Intelligence Assistant can answer."""
    return [
        {
            "category": "Status",
            "question": "How many reports are awaiting verification?",
        },
        {
            "category": "Analysis",
            "question": "Which area has the most reports in the current database?",
        },
        {
            "category": "Hazards",
            "question": "What road hazards have been reported near this location?",
        },
        {
            "category": "Education",
            "question": "Explain the difference between verified and unverified reports.",
        },
        {
            "category": "Reporting",
            "question": "How can I submit a road report?",
        },
        {
            "category": "Safety",
            "question": "What do I need to know before using a route with reported hazards?",
        },
    ]
