#!/usr/bin/env python3
"""Parse the docx theory questions into structured JSON with auto-categorization.

Handles three question types from the docx:
  - 判断题 (True/False) → type="judge", IDs 301-600
  - 单选题 (Single choice) → type="single", IDs 601-900
  - 多选题 (Multiple choice) → type="multi", IDs 1-300
"""

import json
import re
from pathlib import Path

from docx import Document


CATEGORY_RULES = [
    # (category_name, question_number_ranges, keyword_patterns)
    ("职业道德", range(1, 16), ["职业道德", "道德", "敬业", "奉献", "职业守则", "守则"]),
    ("计算机基础", range(16, 31), ["Windows", "输入法", "浏览器", "Office", "Word", "Excel", "PPT", "快捷键"]),
    ("法律法规", range(31, 50), ["劳动合同", "知识产权", "专利", "著作权", "网络安全法", "法律", "法规", "侵权", "遵纪守法"]),
    ("AI基础理论", range(50, 110), ["人工智能", "机器学习", "深度学习", "神经网络", "知识图谱", "知识表示", "业务数据"]),
    ("数据采集与处理", range(110, 170), ["数据采集", "数据清洗", "数据预处理", "数据处理", "缺失值", "异常值", "数据质量"]),
    ("数据标注", range(170, 220), ["标注", "数据标注", "语料", "语义"]),
    ("模型训练与评估", range(220, 270), ["模型", "训练", "评估", "特征", "过拟合", "欠拟合", "算法", "回归", "分类"]),
    ("培训与指导", range(270, 301), ["培训", "指导", "教学", "数据采集", "数据标注"]),
]

# ID offsets for each question type (preserves multi IDs 1-300 for backward compat)
ID_OFFSET = {"multi": 0, "judge": 300, "single": 600}


def classify_question(q_num: int, q_text: str) -> str:
    """Classify a question by number range first, then keyword fallback."""
    for cat_name, num_range, keywords in CATEGORY_RULES:
        if q_num in num_range:
            return cat_name
    for cat_name, _, keywords in CATEGORY_RULES:
        for kw in keywords:
            if kw in q_text:
                return cat_name
    return "其他"


def split_sections(doc: Document) -> tuple[list[str], list[str], list[str]]:
    """Split docx paragraphs into three sections by section headers."""
    judge_lines, single_lines, multi_lines = [], [], []
    current = None
    for para in doc.paragraphs:
        t = para.text.strip()
        if not t:
            continue
        if re.match(r"^一、判断题", t):
            current = "judge"
            continue
        elif re.match(r"^二、单选题", t):
            current = "single"
            continue
        elif re.match(r"^三、多选题", t):
            current = "multi"
            continue
        if current == "judge":
            judge_lines.append(t)
        elif current == "single":
            single_lines.append(t)
        elif current == "multi":
            multi_lines.append(t)
    return judge_lines, single_lines, multi_lines


def parse_judge_questions(lines: list[str]) -> list[dict]:
    """Parse 判断题: （ √ ）1. text  or  （ × ）1. text"""
    questions = []
    for line in lines:
        m = re.match(r"^（\s*([√×])\s*）\s*(\d+)\.\s*(.+)", line)
        if not m:
            continue
        answer_symbol = m.group(1)  # √ or ×
        q_num = int(m.group(2))
        text = m.group(3).strip()
        questions.append({
            "id": q_num + ID_OFFSET["judge"],
            "type": "judge",
            "text": text,
            "options": [
                {"label": "√", "text": "正确"},
                {"label": "×", "text": "错误"},
            ],
            "answer": [answer_symbol],
            "category": classify_question(q_num, text),
        })
    return questions


def parse_choice_questions(lines: list[str], q_type: str) -> list[dict]:
    """Parse 单选题 or 多选题 from lines. Same format, different type tag."""
    questions = []
    current_q = None

    for line in lines:
        # Question start: "1. ..." or "300. ..."
        m = re.match(r"^(\d+)\.\s+(.+)", line)
        if m:
            if current_q:
                questions.append(current_q)
            q_num = int(m.group(1))
            current_q = {
                "id": q_num + ID_OFFSET[q_type],
                "type": q_type,
                "text": m.group(2),
                "options": [],
                "answer": [],
                "category": classify_question(q_num, m.group(2)),
            }
            continue

        # Option: （A）... or （65）...
        opt_match = re.match(r"^（([A-E\d]+)）\s*(.+)", line)
        if opt_match and current_q:
            label = opt_match.group(1)
            label_map = {"65": "A", "66": "B", "67": "C", "68": "D", "69": "E"}
            label = label_map.get(label, label)
            current_q["options"].append({"label": label, "text": opt_match.group(2)})
            continue

        # Answer line
        if line.startswith("参考答案：") and current_q:
            raw_ans = line.replace("参考答案：", "").strip()
            current_q["answer"] = [a.strip() for a in raw_ans.split("，") if a.strip()]
            continue

    if current_q:
        questions.append(current_q)
    return questions


def parse_docx(filepath: str) -> list[dict]:
    doc = Document(filepath)
    judge_lines, single_lines, multi_lines = split_sections(doc)

    judge_qs = parse_judge_questions(judge_lines)
    single_qs = parse_choice_questions(single_lines, "single")
    multi_qs = parse_choice_questions(multi_lines, "multi")

    all_qs = multi_qs + judge_qs + single_qs  # multi first to preserve original order

    # Deduplicate by (type, id)
    seen = set()
    unique = []
    for q in all_qs:
        key = (q["type"], q["id"])
        if key not in seen:
            seen.add(key)
            unique.append(q)

    return unique


def main():
    base = Path(__file__).parent
    docx_path = base / "人工智能训练师三级理论（带答案）.docx"
    out_path = base / "data" / "questions.json"
    out_path.parent.mkdir(exist_ok=True)

    questions = parse_docx(str(docx_path))

    # Stats by type
    type_counts = {}
    cat_counts = {}
    for q in questions:
        type_counts[q["type"]] = type_counts.get(q["type"], 0) + 1
        cat_counts[q["category"]] = cat_counts.get(q["category"], 0) + 1

    print(f"Parsed {len(questions)} questions:")
    print("\nBy type:")
    for t, c in sorted(type_counts.items()):
        print(f"  {t}: {c}")
    print("\nBy category:")
    for cat, count in sorted(cat_counts.items(), key=lambda x: -x[1]):
        print(f"  {cat}: {count}")

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(questions, f, ensure_ascii=False, indent=2)

    print(f"\nSaved to {out_path}")


if __name__ == "__main__":
    main()
