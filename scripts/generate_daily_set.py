import json
import os
import random
import re
import unicodedata
from datetime import date
from typing import List

from openai import OpenAI

# --- CONFIG YOU SHOULD EDIT ---
LETTERS = [
    "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "L", "M", "N", "Ñ", "O",
    "P", "Q", "R", "S", "T", "U", "V", "X", "Y", "Z",
]

TOPICS = [
    "Astronomía", "Biología", "Música", "Deporte", "Ciencia", "Cine",
    "Historia", "Geografía", "Arte", "Folklore", "Cultura",
]

# Choose when "No. 1" starts (set this to your launch day)
START_DATE = date(2026, 1, 1)

DEFAULT_SET_PATH = os.getenv("SET_PATH", "src/data/sets/set_01.json")
MODEL = os.getenv("OPENAI_MODEL", "gpt-5")
MAX_PASSES = 3  # generate -> AI validate/fix -> re-validate


def game_number_for_today(today_local: date) -> int:
    delta = (today_local - START_DATE).days
    return max(1, delta + 1)


def strip_accents(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s)
        if unicodedata.category(c) != "Mn"
    )


def normalize_for_letter_check(s: str) -> str:
    # Keep Ñ distinct, but normalize accents otherwise for robust checks.
    s = s.strip()
    s = s.replace("ñ", "Ñ")
    s = s.replace("Ñ", "__ENYE__")
    s = strip_accents(s)
    s = s.replace("__ENYE__", "Ñ")
    return s


def normalize_for_contains_check(s: str) -> str:
    # Looser normalization for "answer in question" check.
    s = s.lower()
    s = s.replace("ñ", "n")
    s = strip_accents(s)
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def enforce_letter_constraint(letter: str, question: str, answer: str) -> None:
    q = question.strip()
    a = answer.strip()
    if not q or not a:
        raise ValueError("Empty question/answer")

    m_emp = re.match(r"^\s*Empieza\s+por\s+([A-ZÑ])\s*:\s*", q, flags=re.IGNORECASE)
    m_con = re.match(r"^\s*Contiene\s+la\s+([A-ZÑ])\s*:\s*", q, flags=re.IGNORECASE)

    if not (m_emp or m_con):
        raise ValueError(f"Question must start with 'Empieza por X:' or 'Contiene la X:'. Got: {q}")

    q_letter = (m_emp.group(1) if m_emp else m_con.group(1)).upper()
    if q_letter != letter:
        raise ValueError(f"Question letter mismatch. Expected {letter}, got {q_letter}. Question: {q}")

    a_norm = normalize_for_letter_check(a)
    if m_emp:
        first = a_norm[:1].upper()
        if first != letter:
            raise ValueError(f"Answer must start with {letter}. Got: {answer}")
    else:
        if letter not in a_norm.upper():
            raise ValueError(f"Answer must contain {letter}. Got: {answer}")


def enforce_answer_not_in_question(question: str, answer: str) -> None:
    q_norm = normalize_for_contains_check(question)
    a_norm = normalize_for_contains_check(answer)
    if a_norm and a_norm in q_norm:
        raise ValueError("Answer must not be contained in the question.")


def validate_set(obj: dict) -> None:
    if obj.get("id") != "set_01":
        raise ValueError("Expected id 'set_01'")

    title = obj.get("title")
    if not isinstance(title, str) or not title.strip():
        raise ValueError("Missing/invalid title")

    qs = obj.get("questions")
    if not isinstance(qs, list) or len(qs) != len(LETTERS):
        raise ValueError(f"Expected questions length {len(LETTERS)}")

    letters = [q.get("letter") for q in qs]
    if letters != LETTERS:
        raise ValueError(f"Letters mismatch. Got {letters}")

    seen_answers = set()
    for q in qs:
        if not isinstance(q, dict):
            raise ValueError("Each question entry must be an object")
        letter = q.get("letter")
        question = q.get("question")
        answer = q.get("answer")
        if not isinstance(question, str) or not isinstance(answer, str) or not isinstance(letter, str):
            raise ValueError("Each entry must have string letter/question/answer")

        ans_key = normalize_for_letter_check(answer).strip().lower()
        if ans_key in seen_answers:
            raise ValueError(f"Duplicate answer detected: {answer}")
        seen_answers.add(ans_key)

        enforce_letter_constraint(letter, question, answer)
        enforce_answer_not_in_question(question, answer)


def build_generation_prompt(today_local: date, game_no: int, topics: List[str]) -> str:
    letters_str = ", ".join(LETTERS)
    topics_str = ", ".join(topics)
    return f"""
Genera un set diario de Pasalacabra en español (es-ES).

REQUISITOS:
- Devuelve SOLO JSON válido (sin Markdown, sin comentarios).
- Debe haber exactamente {len(LETTERS)} preguntas, una por letra.
- Letras exactas y en este orden: [{letters_str}]
- Formato EXACTO por entrada:
  {{ "letter": "A", "question": "Empieza por A: ...", "answer": "..." }}
- Usa solo estos prefijos:
  - "Empieza por X:"  (y la respuesta DEBE empezar por X)
  - "Contiene la X:"  (y la respuesta DEBE contener X)
- La respuesta NO debe aparecer dentro de la pregunta.
- Cada pregunta debe tener UNA única respuesta inequívoca (sin ambigüedades).
- Respuestas cortas (ideal 1–3 palabras), con tildes correctas si aplican.
- Respuestas de palabras en español.
- No repitas respuestas entre letras.

TEMAS (usa SOLO estos 3):
- {topics_str}

DIFICULTAD:
- Mezcla fácil y media.
- Debe haber maximo 3 preguntas difíciles (nivel universitario).

METADATOS:
- id: "set_01"
- title: "Pasalacabra {today_local.isoformat()} · No. {game_no}"
- questions: array con las {len(LETTERS)} entradas.

Devuelve un objeto JSON con:
{{
  "id": "set_01",
  "title": "...",
  "questions": [ ... ]
}}
""".strip()


def build_ai_validator_prompt(today_local: date, game_no: int, topics: List[str], obj: dict) -> str:
    topics_str = ", ".join(topics)
    return f"""
Eres un editor/validador de preguntas tipo Pasalacabra (es-ES).

Tu tarea con este JSON:
1) Detecta errores semánticos o ambigüedades (solo una respuesta posible).
2) Verifica que la respuesta NO esté contenida en la pregunta.
3) Verifica que la letra y el prefijo ("Empieza por"/"Contiene la") sean correctos.
4) Verifica que todas las preguntas sean SOLO de estos temas: {topics_str}.
5) Verifica mezcla de dificultad con MAXIMO 3 preguntas difíciles (nivel universitario).
6) Respuestas cortas (ideal 1–3 palabras), con tildes correctas.
7) Respuestas de palabras en español.

Si TODO está bien: responde exactamente con "OK" (sin comillas, sin texto extra).
Si hay CUALQUIER problema: devuelve SOLO el JSON corregido completo (sin Markdown, sin explicación),
manteniendo:
- id = "set_01"
- title = "Pasalacabra {today_local.isoformat()} · No. {game_no}"
- mismas letras y orden exacto: {LETTERS}
- mismas reglas de letras/prefijos
- temas SOLO dentro de: {topics_str}

JSON a revisar:
{json.dumps(obj, ensure_ascii=False)}
""".strip()


def call_openai_json(client: OpenAI, prompt: str) -> dict:
    resp = client.responses.create(
        model=MODEL,
        input=prompt,
    )
    text = (resp.output_text or "").strip()
    if not text:
        raise RuntimeError("Empty response from OpenAI")
    return json.loads(text)


def call_openai_text(client: OpenAI, prompt: str) -> str:
    resp = client.responses.create(model=MODEL, input=prompt)
    return (resp.output_text or "").strip()


def generate_once(client: OpenAI, today_local: date, game_no: int, topics: List[str]) -> dict:
    prompt = build_generation_prompt(today_local, game_no, topics)
    return call_openai_json(client, prompt)


def ai_validate_or_fix(
    client: OpenAI, today_local: date, game_no: int, topics: List[str], obj: dict
) -> dict:
    prompt = build_ai_validator_prompt(today_local, game_no, topics, obj)
    out = call_openai_text(client, prompt)
    if out.strip() == "OK":
        return obj
    return json.loads(out)


def write_set(path: str, obj: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main() -> None:
    today_local = date.today()
    game_no = game_number_for_today(today_local)
    topics = random.sample(TOPICS, 3)

    api_key = os.getenv("OPENAI_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("Missing OPENAI_KEY or OPENAI_API_KEY in environment.")

    client = OpenAI(api_key=api_key)

    last_err = None
    obj = None

    for attempt in range(1, MAX_PASSES + 1):
        try:
            if obj is None:
                obj = generate_once(client, today_local, game_no, topics)

            validate_set(obj)

            obj2 = ai_validate_or_fix(client, today_local, game_no, topics, obj)
            validate_set(obj2)

            obj = obj2
            break

        except Exception as e:
            last_err = e
            print(f"[attempt {attempt}/{MAX_PASSES}] error: {e}")
            if obj is None:
                continue

    if obj is None or (last_err is not None and attempt == MAX_PASSES):
        raise RuntimeError(f"Failed to generate a valid set after {MAX_PASSES} passes: {last_err}")

    write_set(DEFAULT_SET_PATH, obj)
    print(f"Wrote {DEFAULT_SET_PATH} with title: {obj.get('title')}")
    print(f"Topics used: {', '.join(topics)}")


if __name__ == "__main__":
    main()
