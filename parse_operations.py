#!/usr/bin/env python3
"""Parse operation questions from the PDF into structured JSON.

Handles: fullwidth→halfwidth conversion, PDF layout artifact removal,
proper task/section separation, code cleanup, and rubric normalization.
"""

import subprocess
import re
import json
import unicodedata
from pathlib import Path
import fitz  # PyMuPDF

PDF_PATH = Path(__file__).parent / "人工智能训练师_3级_操作技能题 -202507版本参考答案PDF版 - 原始.pdf"
OUTPUT_PATH = Path(__file__).parent / "data" / "operations.json"

CATEGORIES = [
    ("业务数据处理", range(0, 5)),
    ("模块效果优化", range(5, 10)),
    ("数据清洗标注", range(10, 15)),
    ("模型开发测试", range(15, 20)),
    ("数据分析优化", range(20, 25)),
    ("交互流程设计", range(25, 30)),
    ("培训大纲编写", range(30, 35)),
    ("采集处理指导", range(35, 40)),
]

# Fullwidth → halfwidth mapping for code cleanup
_FW_TO_HW = {
    '＃': '#', '＇': "'", '＂': '"', '（': '(', '）': ')',
    '［': '[', '］': ']', '｛': '{', '｝': '}',
    '，': ',', '；': ';', '：': ':', '＝': '=', '＋': '+',
    '－': '-', '＊': '*', '／': '/', '＜': '<', '＞': '>',
    '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
    '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
}

# Sections that should NOT be included in tasks
_STOP_SECTIONS = [
    r'3[.．]\s*技能要求',
    r'4[.．]\s*质量指标',
    r'所有结果文件储存',
    r'所有结果文件存储',
]
_STOP_PATTERN = '|'.join(_STOP_SECTIONS)


def get_category(idx):
    for cat, rng in CATEGORIES:
        if idx in rng:
            return cat
    return "其他"


def fw_to_hw(text):
    """Convert fullwidth characters to halfwidth equivalents."""
    for fw, hw in _FW_TO_HW.items():
        text = text.replace(fw, hw)
    return text


def clean_header_footer(text):
    """Remove PDF page headers/footers."""
    text = re.sub(r'人工智能训练师（\s*四级）\s*操作技能复习题', '', text)
    text = re.sub(r'\d+\s*/\s*\d+\s*$', '', text, flags=re.MULTILINE)
    return text


def clean_text(text):
    """General text cleanup for scenario/task descriptions."""
    text = clean_header_footer(text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    lines = []
    for line in text.split('\n'):
        line = line.rstrip()
        lines.append(line)
    text = '\n'.join(lines)
    return text.strip()


def clean_code_text(text):
    """Clean code extracted from PDF: fix fullwidth chars, normalize spacing, fix OCR."""
    text = fw_to_hw(text)
    text = clean_header_footer(text)

    # Fix common OCR/PDF bracket errors
    text = text.replace(' J .', '].').replace(' J,', '],').replace(' J)', '])')
    text = re.sub(r'\bJ\s*\.\s*value_counts', '].value_counts', text)

    # Fix common OCR character substitutions
    _ocr_fixes = [
        (r'mode l\.', 'model.'), (r'mode l ', 'model '),
        (r'干 ile', 'file'), (r'fi le', 'file'),
        (r'axis\s*=\s*l\b', 'axis=1'),
        (r'(\w)l(\s*\))', r'\g<1>1\g<2>'),  # trailing l→1 before )
        (r'变晕', '变量'), (r'数据栠', '数据集'), (r'数据集．', '数据集.'),
        (r'续取', '读取'), (r'卧削除', '(删除)'), (r'咄l\s*除', '删除'),
        (r'Transac\s*扛\s*onHistory', 'TransactionHistory'),
        (r'数屈', '数量'),
    ]
    for pat, repl in _ocr_fixes:
        text = re.sub(pat, repl, text)

    lines = []
    for line in text.split('\n'):
        stripped = line.lstrip()
        indent = line[:len(line) - len(stripped)]
        stripped = re.sub(r'  +', ' ', stripped)
        lines.append(indent + stripped)
    return '\n'.join(lines)


def _is_output_line(line):
    """Detect PDF-extracted execution output (not code)."""
    stripped = line.strip()
    if not stripped:
        return False
    # Output patterns: no code syntax, just values/text
    if re.match(r'^[\d\s.,:eE+\-]+$', stripped):
        return True
    if re.match(r'^(Name|dtype|Length|Freq|Index):', stripped):
        return True
    # Chinese output without code markers
    if not any(c in stripped for c in '=()[]{}#') and not stripped.startswith(('import ', 'from ', 'def ', 'class ', 'if ', 'for ', 'while ', 'return ', 'print', 'with ')):
        if re.match(r'^[\u4e00-\u9fff\s\d.:,，。：%]+$', stripped):
            return True
    return False


def generate_code_segments(code_content, rubric_items):
    """Parse answer code into given/blank segments for interactive practice.

    Strategy:
    - Imports → given
    - Comment with score + following code → blank
    - Comment without score + following code → blank (infer points from rubric)
    - Print/output statements → given
    - Execution output text → strip
    """
    lines = code_content.split('\n')
    segments = []
    current_given = []
    rubric_points = [r["points"] for r in rubric_items] if rubric_items else []
    rubric_idx = 0
    blank_count = 0

    def flush_given():
        nonlocal current_given
        code = '\n'.join(current_given).strip()
        if code:
            segments.append({"type": "given", "code": code})
        current_given = []

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Skip empty lines — accumulate them
        if not stripped:
            current_given.append('')
            i += 1
            continue

        # Skip separator lines
        if stripped == '# ---':
            flush_given()
            i += 1
            continue

        # Skip output lines (execution results from PDF)
        if _is_output_line(line):
            i += 1
            continue

        # Import lines → always given
        if stripped.startswith(('import ', 'from ')) and 'import' in stripped:
            current_given.append(line)
            i += 1
            continue

        # Check if this is a scored comment (score in comment line)
        score_in_comment = None
        if stripped.startswith('#'):
            m = re.search(r'(\d+)\s*分', stripped)
            if m:
                score_in_comment = int(m.group(1))

        # Pattern A: scored comment line → following code lines are blank
        if score_in_comment is not None:
            flush_given()
            hint = re.sub(r'\d+\s*分', '', stripped.lstrip('#')).strip()
            i += 1
            answer_lines = []
            while i < len(lines):
                nline = lines[i]
                ns = nline.strip()
                if not ns:
                    i += 1
                    break
                if ns.startswith('#') or _is_output_line(nline):
                    break
                answer_lines.append(nline)
                i += 1
            if answer_lines:
                blank_count += 1
                segments.append({
                    "type": "blank",
                    "hint": hint or f"补全代码",
                    "answer": '\n'.join(answer_lines).strip(),
                    "points": score_in_comment,
                })
            continue

        # Check for inline score (score at end of code line)
        if not stripped.startswith('#'):
            inline_m = re.search(r'#(.+?)(\d+)\s*分\s*$', stripped)
            if inline_m:
                flush_given()
                hint = inline_m.group(1).strip()
                pts = int(inline_m.group(2))
                code_part = stripped[:inline_m.start()].strip()
                blank_count += 1
                segments.append({
                    "type": "blank",
                    "hint": hint or "补全代码",
                    "answer": code_part,
                    "points": pts,
                })
                i += 1
                continue

        # Pattern B: regular comment followed by code → blank
        if stripped.startswith('#') and not stripped.startswith('# ') or \
           (stripped.startswith('#') and i + 1 < len(lines) and lines[i+1].strip() and
            not lines[i+1].strip().startswith('#') and
            not lines[i+1].strip().startswith(('print', 'print(')) and
            not _is_output_line(lines[i+1])):
            hint_text = stripped.lstrip('#').strip()
            # Skip comments that are section headers or output labels
            if any(kw in hint_text for kw in ['输出结果', '输出', '打印', '显示结果', '---']):
                current_given.append(line)
                i += 1
                continue
            # This comment describes code to fill in
            flush_given()
            i += 1
            answer_lines = []
            while i < len(lines):
                nline = lines[i]
                ns = nline.strip()
                if not ns:
                    i += 1
                    break
                if ns.startswith('#') or _is_output_line(nline):
                    break
                # Stop if it's a print statement (output code = given)
                if ns.startswith(('print(', 'print (')):
                    break
                answer_lines.append(nline)
                i += 1
            if answer_lines:
                pts = rubric_points[rubric_idx] if rubric_idx < len(rubric_points) else 1
                rubric_idx += 1
                blank_count += 1
                segments.append({
                    "type": "blank",
                    "hint": hint_text or "补全代码",
                    "answer": '\n'.join(answer_lines).strip(),
                    "points": pts,
                })
            else:
                # Comment with no following code → just given
                current_given.append('#' + hint_text)
            continue

        # Default: given code
        current_given.append(line)
        i += 1

    flush_given()

    # If we generated zero blanks, fall back to rubric-based blanks
    if blank_count == 0 and rubric_items:
        return [], 0

    return segments, blank_count




def extract_scenario(trial_text):
    """Extract only the题目背景/场景 text before 工作任务."""
    text = clean_header_footer(trial_text)
    m_start = re.search(r'1[.．]\s*题目背景\s*\n', text)
    content_start = m_start.end() if m_start else 0

    m_stop = re.search(r'2[.．]\s*工作任务\s*\n', text[content_start:])
    if m_stop:
        content = text[content_start:content_start + m_stop.start()]
    else:
        content = text[content_start:]
        task_marker = re.search(r'[（(]\s*1\s*[）)]', content)
        if task_marker:
            content = content[:task_marker.start()]

    content = re.sub(r'试题名称：.*(?:\n|$)', '', content)
    content = re.sub(r'考核时间：\S+.*(?:\n|$)', '', content)
    return clean_text(content)


def extract_tasks(trial_text):
    """Extract task items (1)(2)(3) from the 工作任务 section only.

    Handles both full-width （1） and half-width (1) numbering.
    """
    # Get only the 工作任务 section
    m_start = re.search(r'2[.．]\s*工作任务\s*\n', trial_text)
    if not m_start:
        return []

    content_start = m_start.end()
    # Stop at 技能要求 / 质量指标 / 所有结果文件
    m_stop = re.search(_STOP_PATTERN, trial_text[content_start:])
    if m_stop:
        section = trial_text[content_start:content_start + m_stop.start()]
    else:
        section = trial_text[content_start:]

    tasks = []
    seen_nums = set()
    # Match both full-width （N） and half-width (N) task numbering
    matches = list(re.finditer(
        r'[（(]\s*(\d+)\s*[）)]\s*(.*?)(?=[（(]\s*\d+\s*[）)]|$)',
        section, re.DOTALL
    ))
    for m in matches:
        num = int(m.group(1))
        desc = re.sub(r'\s+', ' ', m.group(2)).strip()
        desc = re.sub(r'\d+\s*/\s*\d+', '', desc).strip()
        desc = clean_header_footer(desc).strip()
        if desc and len(desc) > 5:
            if num not in seen_nums:
                seen_nums.add(num)
                tasks.append({"num": num, "text": desc})
            else:
                for t in tasks:
                    if t["num"] == num:
                        t["text"] += " " + desc
                        break

    # If no numbered tasks found, create a single task from the scenario summary
    if not tasks:
        summary = re.sub(r'\s+', ' ', section).strip()
        # Take the key instruction sentence (usually the last sentence before stop)
        sentences = re.split(r'[。！]', summary)
        instruction = ""
        for s in reversed(sentences):
            s = s.strip()
            if any(kw in s for kw in ['请', '要求', '完成', '补全', '编写', '设计', '撰写', '指导']):
                instruction = s
                break
        if not instruction and sentences:
            instruction = sentences[-1].strip()
        if instruction:
            tasks.append({"num": 1, "text": instruction})

    return tasks


def extract_rubric_fitz(doc, score_page_num, next_trial_page_num):
    """Extract rubric using PyMuPDF blocks (much cleaner than pdftotext -layout).

    Handles two block layouts:
    A) M-item and description in same block: "M1\\n3\\ndescription text"
    B) M-item and description in separate blocks: "M1\\n3" then "description text"
    """
    items = []
    total = 0

    page_range = range(score_page_num, min(score_page_num + 3, next_trial_page_num))
    all_blocks = []  # (text, page_num)
    for pn in page_range:
        if pn >= len(doc):
            break
        page = doc[pn]
        text = page.get_text()
        if pn > score_page_num and ('试题单' in text and '试题名称：' in text):
            break
        blocks = page.get_text('blocks')
        for b in blocks:
            btext = b[4].strip()
            if btext:
                all_blocks.append(btext)
        if '合计得分' in text:
            break

    # Parse blocks sequentially
    i = 0
    while i < len(all_blocks):
        btext = all_blocks[i]

        # Pattern A: M-item with description in same block
        ma = re.match(r'(M\d+)\s*\n\s*(\d+)\s*\n(.+)', btext, re.DOTALL)
        if ma:
            mid, pts, desc = ma.group(1), int(ma.group(2)), ma.group(3)
            desc = _clean_rubric_block(desc)
            if desc:
                items.append({"id": mid, "points": pts, "desc": desc})
            i += 1
            continue

        # Pattern B: M-item only (description in next block)
        mb = re.match(r'(M\d+)\s*\n\s*(\d+)\s*$', btext)
        if mb:
            mid, pts = mb.group(1), int(mb.group(2))
            desc = ""
            # Look ahead for description block(s)
            j = i + 1
            while j < len(all_blocks):
                nb = all_blocks[j]
                # Stop if next block is another M-item or column header
                if re.match(r'M\d+\s*\n', nb):
                    break
                if re.match(r'根据数|结果或|规定或|细则编|号\n配分|测量分', nb):
                    j += 1
                    continue
                if '合计得分' in nb or '合计配' in nb:
                    break
                desc = _clean_rubric_block(nb)
                j += 1
                break
            if desc:
                items.append({"id": mid, "points": pts, "desc": desc})
            i = j
            continue

        # Check for total score
        tm = re.search(r'(\d+)\s*\n\s*合计得分', btext)
        if tm:
            total = int(tm.group(1))

        i += 1

    if not total:
        total = sum(r["points"] for r in items)
    return items, total


def _clean_rubric_block(desc):
    """Clean a rubric description block."""
    desc = re.sub(r'根据数\s*据?\s*$', '', desc, flags=re.MULTILINE)
    desc = re.sub(r'^\s*据\s*$', '', desc, flags=re.MULTILINE)
    desc = re.sub(r'\s+', ' ', desc).strip().rstrip('；;，,')
    return desc


def extract_answer_content(answer_pages_text):
    """Extract and clean code blocks and text answers."""
    content = clean_header_footer(answer_pages_text).strip()
    if not content:
        return [], ""

    code_blocks = []
    parts = re.split(r'(In\s*\[\s*\d*\s*\]:)', content)

    i = 0
    non_code_text = []
    while i < len(parts):
        if re.match(r'In\s*\[\s*\d*\s*\]:', parts[i]):
            body = parts[i + 1] if i + 1 < len(parts) else ""
            cleaned = clean_code_text(body.strip())
            if cleaned:
                code_blocks.append(cleaned)
            i += 2
        else:
            non_code_text.append(parts[i])
            i += 1

    answer_text = clean_text('\n'.join(non_code_text))
    return code_blocks, answer_text


def _extract_imports(code_content):
    """Pull import statements from code text."""
    imports = []
    for line in code_content.split('\n'):
        s = line.strip()
        if s.startswith('import ') or s.startswith('from '):
            imports.append(s.split('#')[0].strip())
    return sorted(set(imports))


def _detect_code_topics(code_content, tasks_text):
    """Detect specific technical topics from code + task text."""
    combined = code_content + '\n' + tasks_text
    topics = []
    if re.search(r'read_csv|read_excel|DataFrame', combined):
        topics.append('pandas_io')
    if re.search(r'groupby|value_counts|pivot_table|agg\(', combined):
        topics.append('pandas_agg')
    if re.search(r'fillna|dropna|isnull|isna|duplicated|drop_duplicates', combined):
        topics.append('data_clean')
    if re.search(r'matplotlib|pyplot|plt\.|\.plot|\.bar|\.hist|\.scatter|\.pie', combined):
        topics.append('viz')
    if re.search(r'train_test_split|fit\(|predict\(|score\(', combined):
        topics.append('ml')
    if re.search(r'accuracy|precision|recall|f1|classification_report|confusion_matrix|roc', combined, re.I):
        topics.append('eval')
    if re.search(r'StandardScaler|MinMaxScaler|normalize|标准化|归一化', combined):
        topics.append('scale')
    if re.search(r'pd\.cut|pd\.qcut|bins', combined):
        topics.append('binning')
    if re.search(r'merge\(|concat\(|join\(', combined):
        topics.append('merge')
    if re.search(r'apply\(|lambda|map\(', combined):
        topics.append('apply')
    if re.search(r'TfidfVectorizer|CountVectorizer|jieba|分词|文本', combined):
        topics.append('nlp')
    if re.search(r'KMeans|DBSCAN|聚类', combined):
        topics.append('cluster')
    if re.search(r'DecisionTree|RandomForest|LogisticRegression|SVM|XGB|LightGBM', combined):
        topics.append('model')
    if re.search(r'GridSearch|cross_val|交叉验证', combined):
        topics.append('tuning')
    return topics


# Per-topic concise practical tips (no filler words)
_TOPIC_TIPS = {
    'pandas_io':  "读文件时留意编码参数 encoding='utf-8' 或 'gbk'，路径写对",
    'pandas_agg': "groupby 后别忘 reset_index()，否则后续画图/合并容易报错",
    'data_clean': "清洗顺序：先 duplicated() 去重，再 isnull().sum() 查缺失，最后处理异常值",
    'viz':        "plt.show() 之前先 plt.rcParams['font.sans-serif']=['SimHei'] 防中文乱码",
    'ml':         "先 train_test_split 划分数据，test_size 一般 0.2~0.3",
    'eval':       "分类看 accuracy/F1，回归看 MSE/R²——搞混了直接丢分",
    'scale':      "树模型不需要标准化，线性/SVM/KNN 必须做",
    'binning':    "pd.cut() 的 bins 边界要覆盖数据的最小到最大值",
    'merge':      "merge 时确认 on 列的类型一致，否则合并出空行",
    'apply':      "apply(lambda x: ...) 性能差但考试够用，别过度优化",
    'nlp':        "中文分词先 jieba.lcut()，再用 TfidfVectorizer 提特征",
    'cluster':    "K-Means 的 k 值用肘部法选，DBSCAN 不用指定 k",
    'model':      "实例化模型后 .fit(X_train, y_train)，再 .predict(X_test)",
    'tuning':     "GridSearchCV 的 cv 参数默认 5 折，耗时较长的话改成 3",
}


def generate_solution_guide(question):
    """Generate a practical, exam-focused solution guide (no filler)."""
    q_type = question["type"]
    title = question["title"]
    tasks = question.get("tasks", [])
    rubric = question.get("rubric", [])
    answer_sections = question.get("answer_sections", [])
    total_score = question.get("total_score", 0)
    qid = question.get("id", 0)

    guide = {"overview": "", "steps": [], "key_points": [], "scoring_tips": []}

    if q_type == "code":
        # --- Code questions ---
        code_content = ""
        for sec in answer_sections:
            if sec["type"] == "code":
                code_content = sec["content"]
                break

        imports = _extract_imports(code_content)
        tasks_text = ' '.join(t["text"] for t in tasks)
        topics = _detect_code_topics(code_content, tasks_text)

        # Overview: short, specific
        lib_names = []
        for imp in imports:
            for lib in ['pandas', 'numpy', 'matplotlib', 'sklearn', 'jieba', 'seaborn']:
                if lib in imp and lib not in lib_names:
                    lib_names.append(lib)
        lib_str = '、'.join(lib_names) if lib_names else 'Python'
        guide["overview"] = f"{title}（{total_score}分）—— 用到 {lib_str}，共 {len(tasks)} 个子任务。先通读全部代码框架再动手。"

        # Steps: directly from tasks, with specific tips per task
        for t in tasks:
            txt = t["text"]
            # Trim the redundant preamble (通过补全并运行Python代码...)
            short_desc = re.sub(r'^通过补全并运行\s*Python\s*代码[^）)]*[）)]\s*', '', txt).strip()
            if not short_desc:
                short_desc = txt
            step = {"title": f"任务{t['num']}", "description": short_desc, "tips": []}

            # Add topic-specific tips ONLY if relevant to THIS task
            task_topics = _detect_code_topics(code_content, txt)
            seen = set()
            for tp in task_topics:
                tip = _TOPIC_TIPS.get(tp)
                if tip and tip not in seen:
                    seen.add(tip)
                    step["tips"].append(tip)
            # Cap at 2 tips per step to avoid noise
            step["tips"] = step["tips"][:2]
            guide["steps"].append(step)

        # Rubric-based steps if few tasks
        if len(tasks) <= 1 and len(rubric) > 2:
            for r in rubric:
                guide["steps"].append({
                    "title": r["id"],
                    "description": f"（{r['points']}分）{r['desc']}",
                    "tips": [],
                })

        # Key points: imports + high-value rubric items
        if imports:
            guide["key_points"].append("用到的库：" + "；".join(imports))
        for r in rubric:
            if r["points"] >= 3:
                guide["key_points"].append(f"[{r['points']}分] {r['desc']}")

        # Scoring tips: concise, practical
        guide["scoring_tips"] = [
            "先把 import 和固定代码跑通，确认环境没问题",
            "填完一个空就 Shift+Enter 运行一次，别攒到最后才跑",
            "截图要包含代码和输出，一个任务截一张",
        ]
        # Add topic-specific global tip
        for tp in topics[:2]:
            tip = _TOPIC_TIPS.get(tp)
            if tip and tip not in guide["scoring_tips"]:
                guide["scoring_tips"].append(tip)

    else:
        # --- Doc questions ---
        guide["overview"] = f"{title}（{total_score}分）—— 文档题，按评分标准逐条作答，写到答题卷对应位置。"

        for t in tasks:
            txt = t["text"]
            step = {"title": f"任务{t['num']}", "description": txt, "tips": []}
            guide["steps"].append(step)

        # If tasks are few, supplement with rubric
        if len(tasks) <= 1 and len(rubric) > 1:
            for r in rubric:
                guide["steps"].append({
                    "title": r["id"],
                    "description": f"（{r['points']}分）{r['desc']}",
                    "tips": [],
                })

        # Pull structure from answer text if no task steps
        if not guide["steps"]:
            for sec in answer_sections:
                if sec["type"] == "text":
                    headers = re.findall(
                        r'(?:^|\n)\s*(?:\d+[.、]\s*|[一二三四五六七八九十]+[、.]\s*)(.+?)(?:\n|$)',
                        sec["content"])
                    for i, hdr in enumerate(headers[:8], 1):
                        hdr = hdr.strip()
                        if len(hdr) > 3:
                            guide["steps"].append({
                                "title": f"要点{i}",
                                "description": hdr,
                                "tips": [],
                            })

        # Key points from high-value rubric
        for r in rubric:
            if r["points"] >= 3:
                guide["key_points"].append(f"[{r['points']}分] {r['desc']}")

        guide["scoring_tips"] = [
            "答案分条写，每条带序号，阅卷老师一眼能数出要点数",
            "写完检查一遍有没有漏掉某个评分项",
            "字数不用多，但每条要有实质内容，别只写空话",
        ]

    return guide


def parse_pdf():
    """Parse the entire PDF into structured questions."""
    r = subprocess.run(
        ['pdftotext', '-layout', str(PDF_PATH), '-'],
        capture_output=True, text=True
    )
    text = r.stdout
    pages = text.split(chr(12))

    # Also open with PyMuPDF for clean rubric extraction
    fitz_doc = fitz.open(str(PDF_PATH))

    trial_pages = []
    score_pages = []
    for i, p in enumerate(pages):
        if '试题单' in p and '试题名称：' in p:
            trial_pages.append(i)
        if '试题评分表' in p:
            score_pages.append(i)

    assert len(trial_pages) == 40, f"Expected 40 trial pages, got {len(trial_pages)}"
    assert len(score_pages) == 40, f"Expected 40 score pages, got {len(score_pages)}"

    questions = []
    for qi in range(40):
        tp = trial_pages[qi]
        sp = score_pages[qi]
        next_tp = trial_pages[qi + 1] if qi + 1 < 40 else len(pages)

        title_m = re.search(r'试题名称：(.+)', pages[tp])
        time_m = re.search(r'考核时间：(\S+)', pages[tp])
        title = title_m.group(1).strip() if title_m else f"题目 {qi + 1}"
        time_limit = time_m.group(1).strip() if time_m else "30min"

        # Trial content: all pages from trial to score
        trial_text = '\n'.join(pages[tp:sp])
        scenario = extract_scenario(trial_text)
        tasks = extract_tasks(trial_text)

        # Rubric (using PyMuPDF for clean extraction)
        rubric_items, total_score = extract_rubric_fitz(fitz_doc, sp, next_tp)

        # Still need rubric_end for answer page detection
        rubric_end = sp + 1
        for ri in range(sp, min(sp + 3, next_tp)):
            if '合计得分' in pages[ri]:
                rubric_end = ri + 1
                break

        # Answer content: ALL pages between trial and next trial,
        # EXCLUDING the trial header page itself and the rubric pages.
        # For code questions, answers are after the rubric.
        # For doc questions, answers are between trial and rubric.
        answer_page_indices = []
        for pi in range(tp + 1, next_tp):
            if sp <= pi < rubric_end:
                continue  # Skip rubric/score pages
            answer_page_indices.append(pi)

        answer_text_raw = '\n'.join(pages[pi] for pi in sorted(set(answer_page_indices)))
        code_blocks, answer_text = extract_answer_content(answer_text_raw)

        has_code = len(code_blocks) > 0
        q_type = "code" if has_code else "doc"

        answer_sections = []
        if code_blocks:
            answer_sections.append({
                "type": "code",
                "content": '\n\n# ---\n\n'.join(code_blocks)
            })
        if answer_text:
            answer_sections.append({
                "type": "text",
                "content": answer_text
            })

        category = get_category(qi)

        question = {
            "id": qi + 1,
            "title": title,
            "category": category,
            "time_limit": time_limit,
            "total_score": total_score,
            "type": q_type,
            "scenario": scenario,
            "tasks": tasks,
            "rubric": rubric_items,
            "answer_sections": answer_sections,
        }

        # Generate code fill-in-blank segments for code questions
        if q_type == "code" and answer_sections:
            code_content = ""
            for sec in answer_sections:
                if sec["type"] == "code":
                    code_content = sec["content"]
                    break
            if code_content:
                segs, bc = generate_code_segments(code_content, rubric_items)
                if segs and bc > 0:
                    question["code_segments"] = segs
                    question["blank_count"] = bc

        # Generate solution guide
        question["solution_guide"] = generate_solution_guide(question)

        questions.append(question)

    return questions


def main():
    questions = parse_pdf()
    OUTPUT_PATH.parent.mkdir(exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(questions, f, ensure_ascii=False, indent=2)

    cats = {}
    for q in questions:
        cats.setdefault(q["category"], []).append(q)

    print(f"✅ Parsed {len(questions)} operation questions -> {OUTPUT_PATH}")
    print()
    for cat, qs in cats.items():
        code_count = sum(1 for q in qs if q["type"] == "code")
        doc_count = len(qs) - code_count
        print(f"  {cat}: {len(qs)} questions (code: {code_count}, doc: {doc_count})")

    with_answers = sum(1 for q in questions if q["answer_sections"])
    print(f"\n  Questions with answer content: {with_answers}/{len(questions)}")
    with_rubric = sum(1 for q in questions if q["rubric"])
    print(f"  Questions with rubric: {with_rubric}/{len(questions)}")
    with_scenario = sum(1 for q in questions if q["scenario"])
    print(f"  Questions with scenario: {with_scenario}/{len(questions)}")
    with_guide = sum(1 for q in questions if q.get("solution_guide", {}).get("steps"))
    print(f"  Questions with solution guide: {with_guide}/{len(questions)}")
    with_segments = sum(1 for q in questions if q.get("code_segments"))
    code_total = sum(1 for q in questions if q["type"] == "code")
    total_blanks = sum(q.get("blank_count", 0) for q in questions)
    print(f"  Code questions with fill-in blanks: {with_segments}/{code_total} ({total_blanks} blanks total)")

    # Quality checks
    issues = 0
    for q in questions:
        for s in q.get("answer_sections", []):
            if '＃' in s["content"] or '＇' in s["content"]:
                issues += 1
                print(f"  ⚠️  Q{q['id']}: still has fullwidth chars in answer")
        task_nums = [t["num"] for t in q.get("tasks", [])]
        if len(task_nums) != len(set(task_nums)):
            issues += 1
            print(f"  ⚠️  Q{q['id']}: duplicate task numbers {task_nums}")
    print(f"\n  Remaining issues: {issues}")


if __name__ == "__main__":
    main()
