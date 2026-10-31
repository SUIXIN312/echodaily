#!/usr/bin/env python3
"""Build the next EchoDaily weekly pack from CNN 10.

The script is intentionally dependency-free so it can run in GitHub Actions.
It fetches the five newest CNN 10 pages, uses the original VTT cues for exact
subtitle timing, and asks DeepSeek for the Chinese translation and study aids.

Local dry run (no API key):
    python tools/weekly_update.py --mock --limit 1 --output ./tmp-pack
"""
from __future__ import annotations

import argparse
import html as html_lib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX_URL = "https://www.listeningexpress.com/cnn10/"
DEEPSEEK_URL = os.environ.get("DEEPSEEK_API_URL", "https://api.deepseek.com/chat/completions")
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")
THEMES = ["ember", "steel", "forest", "ocean", "violet"]
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"


def fetch(url: str, timeout: int = 45) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def clean_text(value: str) -> str:
    value = re.sub(r"<[^>]+>", " ", value)
    value = value.replace(">>", " ")
    value = re.sub(r"\[[^\]]*\]", " ", value)
    value = html_lib.unescape(value)
    return re.sub(r"\s+", " ", value).strip()


def parse_vtt(text: str) -> list[dict]:
    lines = text.replace("\r", "").split("\n")
    cues: list[dict] = []
    i = 0

    def seconds(value: str) -> float:
        parts = value.strip().split(":")
        nums = [float(x.replace(",", ".")) for x in parts]
        if len(nums) == 3:
            return nums[0] * 3600 + nums[1] * 60 + nums[2]
        return nums[0] * 60 + nums[1]

    while i < len(lines):
        line = lines[i].strip()
        if "-->" not in line:
            i += 1
            continue
        left, right = line.split("-->")
        try:
            start, end = seconds(left), seconds(right)
        except (ValueError, IndexError):
            i += 1
            continue
        i += 1
        body = []
        while i < len(lines) and lines[i].strip():
            body.append(lines[i])
            i += 1
        content = clean_text(" ".join(body))
        if content and start < end:
            cues.append({"start": start, "end": end, "text": content})
        i += 1
    return cues


def index_episodes(limit: int) -> list[dict]:
    page = fetch(INDEX_URL).decode("utf-8", "replace")
    pattern = re.compile(
        r'<a href="(?:https?://www\.listeningexpress\.com)?/cnn10/(\d{4}-\d{2}-\d{2}) ([^"]+)\.html"[^>]*>',
        re.IGNORECASE,
    )
    seen = set()
    episodes = []
    for match in pattern.finditer(page):
        episode_date, title = match.group(1), html_lib.unescape(match.group(2)).strip()
        if episode_date in seen:
            continue
        seen.add(episode_date)
        episodes.append({"date": episode_date, "title": title})
    episodes.sort(key=lambda item: item["date"], reverse=True)
    return episodes[:limit]


def media_urls(filename: str) -> tuple[str, str, str]:
    page_path = "/cnn10/" + filename
    media_path = "/cnn10/cnn10 " + filename
    page = "https://www.listeningexpress.com" + urllib.parse.quote(page_path + ".html", safe="/,")
    base = "https://www.listeningexpress.com" + urllib.parse.quote(media_path, safe="/,")
    return page, base + ".vtt", base


def transcript_words(cues: list[dict], clip_start: float, clip_end: float) -> list[dict]:
    words = []
    for cue in cues:
        parts = cue["text"].split()
        if not parts:
            continue
        total = sum(len(word) + 1 for word in parts)
        passed = 0
        for word in parts:
            raw_start = cue["start"] + (passed / total) * (cue["end"] - cue["start"])
            passed += len(word) + 1
            raw_end = cue["start"] + (passed / total) * (cue["end"] - cue["start"])
            if raw_end <= clip_start + 0.04 or raw_start >= clip_end - 0.04:
                continue
            words.append({
                "w": word,
                "start": max(raw_start, clip_start),
                "end": min(raw_end, clip_end),
            })
    return words


def chunk_words(words: list[dict]) -> list[dict]:
    chunks: list[dict] = []
    current: list[dict] = []

    def flush() -> None:
        if not current:
            return
        text = " ".join(item["w"] for item in current)
        text = re.sub(r"\s+([,.!?;:])", r"\1", text).strip()
        chunks.append({
            "start": round(current[0]["start"], 3),
            "end": round(current[-1]["end"], 3),
            "en": text,
            "words": len(current),
        })
        current.clear()

    for item in words:
        current.append(item)
        chars = sum(len(x["w"]) + 1 for x in current)
        last = item["w"]
        ordinal = bool(re.match(r"^\d+(st|nd|rd|th)\.$", last, re.I) or re.match(r"^[A-Z]\.$", last))
        sentence_end = bool(re.search(r'[.!?]["\u2019\u201d]?$', last)) and not ordinal
        clause_end = bool(re.search(r'[,;:]["\u2019\u201d]?$', last)) or ordinal
        if len(current) >= 10 or chars > 62 or sentence_end or (clause_end and len(current) >= 5):
            flush()
    flush()
    return chunks


def group_segments(chunks: list[dict], count: int = 6) -> list[list[dict]]:
    if not chunks:
        return []
    total = max(1.0, chunks[-1]["end"] - chunks[0]["start"])
    target = total / count
    groups: list[list[dict]] = []
    current: list[dict] = []
    for chunk in chunks:
        current.append(chunk)
        if len(groups) < count - 1 and current and chunk["end"] - current[0]["start"] >= target and len(current) >= 2:
            groups.append(current)
            current = []
    if current:
        groups.append(current)
    return groups


def deepseek(messages: list[dict], json_mode: bool = True, retries: int = 3) -> str:
    api_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("DEEPSEEK_API_KEY is missing")
    payload = {
        "model": DEEPSEEK_MODEL,
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": 2200,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    data = json.dumps(payload).encode("utf-8")
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            request = urllib.request.Request(
                DEEPSEEK_URL,
                data=data,
                headers={
                    "Authorization": "Bearer " + api_key,
                    "Content-Type": "application/json",
                    "User-Agent": USER_AGENT,
                },
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=120) as response:
                body = json.loads(response.read().decode("utf-8"))
            return body["choices"][0]["message"]["content"]
        except Exception as error:  # noqa: BLE001
            last_error = error
            time.sleep(2 + attempt * 3)
    raise RuntimeError(f"DeepSeek request failed: {last_error}")


def json_object(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < 0:
        raise ValueError("No JSON object in model response")
    return json.loads(text[start:end + 1])


def translate_chunks(chunks: list[dict], mock: bool) -> list[str]:
    if mock:
        return ["【中文】" + item["en"] for item in chunks]
    translations: list[str] = []
    batch_size = 14
    for offset in range(0, len(chunks), batch_size):
        batch = chunks[offset:offset + batch_size]
        prompt = (
            "Translate the following English news subtitle lines into concise, natural Simplified Chinese. "
            "Keep names, numbers, and tone. Return JSON only: {\"translations\":[...]} with exactly "
            + str(len(batch))
            + " strings in the same order.\n\n"
            + json.dumps([item["en"] for item in batch], ensure_ascii=False)
        )
        try:
            data = json_object(deepseek([
                {"role": "system", "content": "You are a precise bilingual subtitle translator for English learners."},
                {"role": "user", "content": prompt},
            ]))
            values = data.get("translations", [])
            if not isinstance(values, list) or len(values) != len(batch):
                raise ValueError("translation count mismatch")
            translations.extend(str(value).strip() for value in values)
        except Exception:
            for item in batch:
                data = json_object(deepseek([
                    {"role": "system", "content": "Translate one English news subtitle into concise Simplified Chinese. Return {\"translation\":\"...\"}."},
                    {"role": "user", "content": item["en"]},
                ]))
                translations.append(str(data.get("translation", "")).strip())
        time.sleep(0.4)
    return translations


def study_pack(title: str, script: str, mock: bool) -> dict:
    if mock:
        return {
            "zhTitle": "【中文标题】" + title,
            "zhDeck": "【中文导语】",
            "summary": " ".join(re.findall(r"[^.!?]+[.!?]", script)[:2]).strip(),
            "zhSummary": "【中文摘要】",
            "takeaways": ["Key point one.", "Key point two.", "Key point three."],
            "zhTakeaways": ["要点一", "要点二", "要点三"],
            "topics": ["World", "News"],
            "vocab": [
                {"word": "example", "phonetic": "/ɪɡˈzæmpəl/", "pos": "n.", "zh": "例子", "example": "This is an example.", "exampleZh": "这是一个例子。"}
                for _ in range(6)
            ],
            "questions": [
                {"q": "What is the main idea?", "options": ["A", "B", "C", "D"], "answer": 1, "explain": "Listen to the first part."}
                for _ in range(3)
            ],
        }
    prompt = f"""You are building a study pack for an English listening app based on a CNN 10 news clip.

Return JSON only with exactly this shape:
{{
  "zhTitle": "Chinese title",
  "zhDeck": "one-sentence Chinese deck",
  "summary": "2-sentence English summary",
  "zhSummary": "2-sentence Chinese summary",
  "takeaways": ["3 short English takeaways"],
  "zhTakeaways": ["3 short Chinese takeaways"],
  "topics": ["2 short English topic labels"],
  "vocab": [
    {{"word":"...", "phonetic":"/.../", "pos":"n.", "zh":"...", "example":"English example", "exampleZh":"中文例句"}}
  ],
  "questions": [
    {{"q":"...", "options":["...","...","...","..."], "answer":0, "explain":"..."}}
  ]
}}
Provide exactly 6 vocab items and exactly 3 multiple-choice questions with 4 options each. answer is a 0-based index. Use only facts in the clip. Title: {title}

Clip transcript:
{script[:7000]}"""
    data = json_object(deepseek([
        {"role": "system", "content": "You are a meticulous English-learning content editor. Return valid JSON only."},
        {"role": "user", "content": prompt},
    ]))
    for key, fallback in (("takeaways", []), ("zhTakeaways", []), ("topics", []), ("vocab", []), ("questions", [])):
        if not isinstance(data.get(key), list):
            data[key] = fallback
    return data


def safe_vocab(items: list, fallback_word: str) -> list[dict]:
    result = []
    for item in items[:6]:
        if not isinstance(item, dict):
            continue
        word = str(item.get("word", "")).strip()
        if not word:
            continue
        result.append({
            "word": word,
            "phonetic": str(item.get("phonetic", "")).strip(),
            "pos": str(item.get("pos", "")).strip(),
            "zh": str(item.get("zh", "")).strip(),
            "example": str(item.get("example", "")).strip(),
            "exampleZh": str(item.get("exampleZh", "")).strip(),
        })
    while len(result) < 6:
        result.append({
            "word": fallback_word,
            "phonetic": "",
            "pos": "",
            "zh": "",
            "example": "",
            "exampleZh": "",
        })
    return result[:6]


def safe_questions(items: list) -> list[dict]:
    result = []
    for item in items[:3]:
        if not isinstance(item, dict):
            continue
        options = item.get("options")
        if not isinstance(options, list) or len(options) < 4:
            continue
        try:
            answer = int(item.get("answer", 0))
        except (TypeError, ValueError):
            answer = 0
        if answer < 0 or answer > 3:
            answer = 0
        result.append({
            "q": str(item.get("q", "")).strip(),
            "options": [str(x) for x in options[:4]],
            "answer": answer,
            "explain": str(item.get("explain", "")).strip(),
        })
    while len(result) < 3:
        result.append({
            "q": "What is the main idea of this clip?",
            "options": ["Option A", "Option B", "Option C", "Option D"],
            "answer": 1,
            "explain": "Listen to the opening sentences for the main idea.",
        })
    return result[:3]


def date_label(date_str: str) -> str:
    parsed = datetime.strptime(date_str, "%Y-%m-%d")
    return f"{parsed.month}月{parsed.day}日"


def build_episode(meta: dict, issue: int, mock: bool) -> tuple[dict, list[dict]]:
    episode_date = meta["date"]
    title = meta["title"]
    filename = f"{episode_date} {title}"
    page_url, vtt_url, media_base = media_urls(filename)
    cues = parse_vtt(fetch(vtt_url).decode("utf-8", "replace"))
    if not cues:
        raise RuntimeError(f"No VTT cues for {episode_date}")
    candidates = [cue for cue in cues if cue["start"] >= 24.0]
    clip_start = candidates[0]["start"] if candidates else cues[0]["start"]
    clip_start = max(25.0, clip_start)
    clip_end = min(clip_start + 175.0, cues[-1]["end"])
    if clip_end - clip_start < 60:
        clip_start = max(0.0, cues[-1]["end"] - 150.0)
        clip_end = cues[-1]["end"]
    words = transcript_words(cues, clip_start, clip_end)
    chunks = chunk_words(words)
    if len(chunks) < 6:
        raise RuntimeError(f"Too few subtitle chunks for {episode_date}")
    translations = translate_chunks(chunks, mock)
    groups = group_segments(chunks, 6)
    segment_rows = []
    flat_cues = []
    chunk_index = 0
    for group_index, group in enumerate(groups):
        section = f"{group_index + 1:02d} · 新闻片段"
        for item in group:
            item["zh"] = translations[chunk_index] if chunk_index < len(translations) else ""
            item["segIndex"] = group_index
            item["section"] = section
            flat_cues.append(item)
            chunk_index += 1
        segment_rows.append({
            "start": round(group[0]["start"], 3),
            "end": round(group[-1]["end"], 3),
            "section": section,
            "en": " ".join(item["en"] for item in group),
            "zh": "".join(item["zh"] for item in group),
        })
    script = " ".join(item["en"] for item in chunks)
    pack = study_pack(title, script, mock)
    episode = {
        "id": episode_date,
        "issue": f"{issue:02d}",
        "date": episode_date,
        "availableFrom": (datetime.strptime(episode_date, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d"),
        "dateLabel": date_label(episode_date),
        "title": title,
        "zhTitle": pack.get("zhTitle") or title,
        "deck": pack.get("summary", "")[:240] or script[:180],
        "zhDeck": pack.get("zhDeck", ""),
        "source": "CNN 10",
        "sourceUrl": "https://edition.cnn.com/audio/podcasts/cnn-10",
        "transcriptUrl": page_url,
        "theme": THEMES[(issue - 1) % len(THEMES)],
        "type": "news",
        "format": "video",
        "accent": "American",
        "level": "B1–B2",
        "duration": round(clip_end - clip_start, 1),
        "fullDuration": 600,
        "clipStart": round(clip_start, 3),
        "clipEnd": round(clip_end, 3),
        "media": {"video": media_base + ".mp4", "audio": media_base + ".mp3"},
        "topics": pack.get("topics") or ["World", "News"],
        "summary": pack.get("summary", ""),
        "zhSummary": pack.get("zhSummary", ""),
        "takeaways": pack.get("takeaways", [])[:3],
        "zhTakeaways": pack.get("zhTakeaways", [])[:3],
        "segments": segment_rows,
        "vocab": safe_vocab(pack.get("vocab", []), "news"),
        "questions": safe_questions(pack.get("questions", [])),
    }
    return episode, flat_cues


def write_outputs(episodes: list[dict], subtitle_map: dict, output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    (output / "assets").mkdir(parents=True, exist_ok=True)
    data = "/* Generated by tools/weekly_update.py on " + datetime.now().strftime("%Y-%m-%d") + ". */\n" \
        "window.EPISODES = " + json.dumps(episodes, ensure_ascii=False, indent=2) + ";\n"
    (output / "data.js").write_text(data, encoding="utf-8")
    subs = "/* Generated from the original CNN 10 VTT cues. Do not hand-edit. */\n" \
        "window.SUBTITLE_CUES = " + json.dumps(subtitle_map, ensure_ascii=False, indent=1) + ";\n"
    (output / "assets" / "subtitles.js").write_text(subs, encoding="utf-8")
    print(f"Wrote {output / 'data.js'}")
    print(f"Wrote {output / 'assets' / 'subtitles.js'}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--output", type=Path, default=ROOT)
    parser.add_argument("--mock", action="store_true", help="Use placeholder Chinese for a dry run")
    args = parser.parse_args()

    metas = index_episodes(args.limit)
    if not metas:
        print("No episodes found; nothing to do.")
        return
    episodes = []
    subtitle_map = {}
    for index, meta in enumerate(metas, 1):
        try:
            episode, cues = build_episode(meta, index, args.mock)
            episodes.append(episode)
            subtitle_map[episode["id"]] = cues
            print(f"OK {episode['id']} {episode['title']}: {len(cues)} cues")
        except Exception as error:  # noqa: BLE001
            print(f"SKIP {meta['date']} {meta['title']}: {error}", file=sys.stderr)
    if len(episodes) < min(3, args.limit):
        raise SystemExit("Too few episodes could be built; refusing to overwrite the site.")
    write_outputs(episodes, subtitle_map, args.output)


if __name__ == "__main__":
    main()
