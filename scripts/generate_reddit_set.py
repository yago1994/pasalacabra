"""Generate a daily English question set for the pasalacabra-reddit (Devvit) app.

This is a standalone duplicate of generate_daily_set.py. It does NOT touch the
Spanish pipeline or its answer bank. Differences from the Spanish generator:

- English content, 26 letters A-Z (no Ñ).
- Emits the Reddit app's `QA` schema: each entry is
  { "letter", "mode": "starts"|"contains", "question", "answer", "alt"? }
  with PLAIN clue text (no "Empieza por"/"Starts with" prefix baked in — the
  client renders the prefix itself).
- Writes a DATED file at `daily/<date>.json`, where <date> is the *next* UTC day
  (generate-ahead) so it is ready well before the app fetches it at 06:00 UTC.
- Tracks its own answer history in scripts/used_answers_en.json.
"""

import json
import os
import random
import re
import unicodedata
from datetime import date, timedelta
from typing import List

from openai import OpenAI

# 26-letter English alphabet, in order. Must match the Reddit app's LETTERS
# (src/shared/letters.ts).
LETTERS = [
    "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
    "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
]

MODES = ("starts", "contains")

TOPICS = [
    "Astronomy", "Biology", "Music", "Sport", "Science", "Film",
    "History", "Geography", "Art", "Folklore", "Culture", "Food",
    "Animals", "Technology", "Literature",
]

MODEL = os.getenv("OPENAI_MODEL", "gpt-5")
MAX_PASSES = 3  # generate -> AI validate/fix -> re-validate
BANK_PATH = os.getenv("REDDIT_BANK_PATH", "scripts/used_answers_en.json")
BANK_MAX_ENTRIES = 60


def target_date() -> date:
    """The UTC day this set is FOR. We generate a day ahead so the file is
    ready before the app fetches it at 06:00 UTC on that day. Override with
    REDDIT_TARGET_DATE=YYYY-MM-DD for manual/backfill runs."""
    override = os.getenv("REDDIT_TARGET_DATE")
    if override:
        return date.fromisoformat(override)
    return date.today() + timedelta(days=1)


def out_path(for_date: date) -> str:
    override = os.getenv("REDDIT_SET_PATH")
    if override:
        return override
    return f"daily/{for_date.isoformat()}.json"


def strip_accents(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s)
        if unicodedata.category(c) != "Mn"
    )


def normalize_for_letter_check(s: str) -> str:
    return strip_accents(s.strip())


def normalize_for_contains_check(s: str) -> str:
    s = strip_accents(s.lower())
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def enforce_letter_constraint(letter: str, mode: str, question: str, answer: str) -> None:
    q = question.strip()
    a = answer.strip()
    if not q or not a:
        raise ValueError("Empty question/answer")
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}. Got: {mode!r}")

    # Clue text must NOT carry a "Starts with X:" / "Contains X:" prefix — the
    # client adds it. Reject if the model baked one in.
    if re.match(r"^\s*(starts?\s+with|contains?)\s+[A-Z]\s*:", q, flags=re.IGNORECASE):
        raise ValueError(f"Question must be plain clue text with no prefix. Got: {q}")

    a_norm = normalize_for_letter_check(a).upper()
    if mode == "starts":
        if a_norm[:1] != letter:
            raise ValueError(f"mode 'starts' but answer does not start with {letter}. Got: {answer}")
    else:
        if letter not in a_norm:
            raise ValueError(f"mode 'contains' but answer does not contain {letter}. Got: {answer}")


def enforce_answer_not_in_question(question: str, answer: str) -> None:
    q_norm = normalize_for_contains_check(question)
    a_norm = normalize_for_contains_check(answer)
    if a_norm and a_norm in q_norm:
        raise ValueError("Answer must not be contained in the question.")


def validate_set(obj: dict) -> None:
    if not isinstance(obj.get("id"), str) or not obj["id"].strip():
        raise ValueError("Missing/invalid id")

    qs = obj.get("questions")
    if not isinstance(qs, list) or len(qs) != len(LETTERS):
        raise ValueError(f"Expected questions length {len(LETTERS)}, got {len(qs) if isinstance(qs, list) else 'n/a'}")

    letters = [q.get("letter") for q in qs]
    if letters != LETTERS:
        raise ValueError(f"Letters mismatch or wrong order. Got {letters}")

    seen_answers = set()
    for q in qs:
        if not isinstance(q, dict):
            raise ValueError("Each question entry must be an object")
        letter = q.get("letter")
        mode = q.get("mode")
        question = q.get("question")
        answer = q.get("answer")
        if not all(isinstance(x, str) for x in (letter, mode, question, answer)):
            raise ValueError("Each entry must have string letter/mode/question/answer")

        alt = q.get("alt")
        if alt is not None and not (isinstance(alt, list) and all(isinstance(x, str) for x in alt)):
            raise ValueError("'alt' must be an array of strings when present")

        ans_key = normalize_for_letter_check(answer).lower()
        if ans_key in seen_answers:
            raise ValueError(f"Duplicate answer detected: {answer}")
        seen_answers.add(ans_key)

        enforce_letter_constraint(letter, mode, question, answer)
        enforce_answer_not_in_question(question, answer)


def build_generation_prompt(topics: List[str], excluded_answers: set = None) -> str:
    letters_str = ", ".join(LETTERS)
    topics_str = ", ".join(topics)

    excluded_section = ""
    if excluded_answers:
        excluded_list = ", ".join(sorted(excluded_answers))
        excluded_section = (
            "\nFORBIDDEN ANSWERS (already used in previous games, do NOT reuse):\n"
            f"[{excluded_list}]\n"
        )

    return f"""
Generate a daily English trivia set for the word game "Pasalacabra".

REQUIREMENTS:
- Return ONLY valid JSON (no Markdown, no comments).
- Exactly {len(LETTERS)} questions, one per letter.
- Letters exactly, in this order: [{letters_str}]
- EXACT shape per entry:
  {{ "letter": "A", "mode": "starts", "question": "...", "answer": "..." }}
- "mode" is either:
  - "starts"   -> the answer MUST start with that letter
  - "contains" -> the answer MUST contain that letter (use when a natural
                  "starts with" clue is hard for that letter, e.g. X)
- The "question" is PLAIN clue text ONLY. Do NOT prefix it with
  "Starts with X:" or "Contains X:" — the app adds that itself.
- The answer MUST NOT appear inside the question.
- Each question must have ONE unambiguous answer.
- Short answers (ideally 1-3 words).
- Do NOT repeat an answer across letters.
- Optional: include "alt": ["..."] with common acceptable alternate spellings
  or short forms (e.g. "hippo" for "hippopotamus").

TOPICS (use ONLY these 3): {topics_str}

DIFFICULTY:
- Mix easy and medium. At most 3 hard (university-level) questions.
{excluded_section}
Return a JSON object shaped exactly:
{{
  "id": "set-daily",
  "questions": [ ... ]
}}
""".strip()


def build_ai_validator_prompt(topics: List[str], obj: dict, excluded_answers: set = None) -> str:
    topics_str = ", ".join(topics)

    excluded_rule = ""
    if excluded_answers:
        excluded_list = ", ".join(sorted(excluded_answers))
        excluded_rule = f"7) NO answer may match any already-used answer: [{excluded_list}]\n"

    return f"""
You are an editor/validator for "Pasalacabra" English trivia questions.

Check this JSON:
1) No semantic errors or ambiguity (exactly one correct answer each).
2) The answer is NOT contained in the question text.
3) "mode" is correct: "starts" => answer starts with the letter; "contains" =>
   answer contains the letter. The question is PLAIN clue text with NO prefix.
4) All questions are ONLY from these topics: {topics_str}.
5) Difficulty mix with AT MOST 3 hard (university-level) questions.
6) Short answers (ideally 1-3 words), correct English spelling.
{excluded_rule}
If EVERYTHING is fine: reply exactly "OK" (no quotes, no extra text).
If there is ANY problem: return ONLY the corrected full JSON (no Markdown, no
explanation), keeping:
- the same "id"
- the same 26 letters in exact order: {LETTERS}
- the same schema/rules
- topics ONLY within: {topics_str}

JSON to review:
{json.dumps(obj, ensure_ascii=False)}
""".strip()


def call_openai_json(client: OpenAI, prompt: str) -> dict:
    resp = client.responses.create(model=MODEL, input=prompt)
    text = (resp.output_text or "").strip()
    if not text:
        raise RuntimeError("Empty response from OpenAI")
    return json.loads(text)


def call_openai_text(client: OpenAI, prompt: str) -> str:
    resp = client.responses.create(model=MODEL, input=prompt)
    return (resp.output_text or "").strip()


def generate_once(client: OpenAI, topics: List[str], excluded_answers: set = None) -> dict:
    return call_openai_json(client, build_generation_prompt(topics, excluded_answers))


def ai_validate_or_fix(client: OpenAI, topics: List[str], obj: dict, excluded_answers: set = None) -> dict:
    out = call_openai_text(client, build_ai_validator_prompt(topics, obj, excluded_answers))
    if out.strip() == "OK":
        return obj
    return json.loads(out)


def load_answer_bank(path: str, max_entries: int = BANK_MAX_ENTRIES) -> list:
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            bank = json.load(f)
        return bank[-max_entries:]
    except (json.JSONDecodeError, TypeError):
        print(f"WARNING: Could not parse {path}, starting with empty bank.")
        return []


def get_excluded_answers(bank: list) -> set:
    excluded = set()
    for entry in bank:
        for ans in entry.get("answers", []):
            excluded.add(normalize_for_letter_check(ans).lower())
    return excluded


def validate_no_reused_answers(obj: dict, excluded: set) -> None:
    for q in obj["questions"]:
        ans_key = normalize_for_letter_check(q["answer"]).lower()
        if ans_key in excluded:
            raise ValueError(f"Reused answer from a previous set: {q['answer']}")


def write_set(path: str, obj: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")


def update_answer_bank(bank_path: str, for_date: date, obj: dict, max_entries: int = BANK_MAX_ENTRIES) -> None:
    bank = load_answer_bank(bank_path, max_entries)
    answers = [q["answer"] for q in obj["questions"]]
    bank.append({"date": for_date.isoformat(), "answers": answers})
    bank = bank[-max_entries:]
    with open(bank_path, "w", encoding="utf-8") as f:
        json.dump(bank, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main() -> None:
    for_date = target_date()
    topics = random.sample(TOPICS, 3)

    api_key = os.getenv("OPENAI_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("Missing OPENAI_KEY or OPENAI_API_KEY in environment.")

    client = OpenAI(api_key=api_key)

    bank = load_answer_bank(BANK_PATH)
    excluded = get_excluded_answers(bank)
    if excluded:
        print(f"Loaded {len(excluded)} excluded answers from {len(bank)} previous set(s).")

    set_id = f"set-{for_date.isoformat()}"
    last_err = None
    obj = None

    for attempt in range(1, MAX_PASSES + 1):
        try:
            if obj is None:
                obj = generate_once(client, topics, excluded)
            obj["id"] = set_id

            validate_set(obj)
            validate_no_reused_answers(obj, excluded)

            obj2 = ai_validate_or_fix(client, topics, obj, excluded)
            obj2["id"] = set_id
            validate_set(obj2)
            validate_no_reused_answers(obj2, excluded)

            obj = obj2
            break
        except Exception as e:
            last_err = e
            print(f"[attempt {attempt}/{MAX_PASSES}] error: {e}")
            obj = None

    if obj is None:
        raise RuntimeError(f"Failed to generate a valid set after {MAX_PASSES} passes: {last_err}")

    path = out_path(for_date)
    write_set(path, obj)
    update_answer_bank(BANK_PATH, for_date, obj)
    print(f"Wrote {path} (id: {obj['id']}) for {for_date.isoformat()}")
    print(f"Updated answer bank at {BANK_PATH}")
    print(f"Topics used: {', '.join(topics)}")


if __name__ == "__main__":
    main()
