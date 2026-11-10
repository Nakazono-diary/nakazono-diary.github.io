#!/usr/bin/env python3
"""公開版(だれでも使える版)を作る。

  python3 tools/make_public.py

dist/public/ に公開版のフォルダ、dist/diary-public-<版>.zip にその zip を作る。
- edition.js と projects.js を tools/public/ の公開用に入れかえる(同期のクライアント ID は空、ほかのアプリとのつながりはなし)
- コメントのうち、個人の事情が書いてあるものを消す
- CLAUDE.md・tools・この README は入れず、tools/public/ の README.md と setup-google.html を入れる
- できたものに、決めた言葉(FORBIDDEN)が1つでも残っていたら止める
"""
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUB = ROOT / 'tools' / 'public'
DIST = ROOT / 'dist'
OUT = DIST / 'public'

# 公開版に残してはいけない言葉(個人の名前・機械・会社・もうひとつのアプリ)
FORBIDDEN = ['本人', 'いっくん', '大和', '建工', 'ミニPC', 'Surface', '中園', 'nakazono', 'Nakazono', 'kenmei', '件名ブリッジ',
             'タスク管理', 'taskapp', '1015317495163', 'Whisper']

FILES = ['index.html', 'style.css', 'manifest.webmanifest', 'sw.js',
         'app.js', 'store.js', 'photo.js', 'dom.js', 'body.js', 'koyomi.js', 'koyomiView.js', 'kinenbi.js',
         'places.js', 'sync.js']
SWAP = {'edition.js': PUB / 'edition.js', 'projects.js': PUB / 'projects.js'}
EXTRA = {'README.md': PUB / 'README.md', 'setup-google.html': PUB / 'setup-google.html'}


def bad(text):
    return any(w in text for w in FORBIDDEN)


def strip_js(src):
    """JS のコメントのうち、決めた言葉を含むものだけを消す(文字列・テンプレートの中は触らない)。"""
    out, i, n = [], 0, len(src)
    stack = []          # テンプレートの ${ } の入れ子
    while i < n:
        c = src[i]
        if c in '\'"':
            j = i + 1
            while j < n and src[j] != c:
                j += 2 if src[j] == '\\' else 1
            out.append(src[i:j + 1]); i = j + 1; continue
        if c == '`' or (c == '}' and stack and stack[-1] == 0):
            if c == '}':
                stack.pop()
            j = i + 1
            while j < n and src[j] != '`':
                if src[j] == '\\':
                    j += 2; continue
                if src.startswith('${', j):
                    break
                j += 1
            if j < n and src.startswith('${', j):
                out.append(src[i:j + 2]); stack.append(0); i = j + 2; continue
            out.append(src[i:j + 1]); i = j + 1; continue
        if c == '{' and stack:
            stack[-1] += 1
        elif c == '}' and stack:
            stack[-1] -= 1
        if src.startswith('//', i):
            j = src.find('\n', i)
            j = n if j < 0 else j
            com = src[i:j]
            if bad(com):
                while out and out[-1] in (' ', '\t'):
                    out.pop()
            else:
                out.append(com)
            i = j; continue
        if src.startswith('/*', i):
            j = src.find('*/', i + 2)
            j = n if j < 0 else j + 2
            if not bad(src[i:j]):
                out.append(src[i:j])
            i = j; continue
        out.append(c); i += 1
    # コメントだけだった行が空になったら、その行ごと消す
    lines = ''.join(out).split('\n')
    orig = src.split('\n')
    keep = [l for l in lines if l.strip() or True]
    text = '\n'.join(keep)
    text = re.sub(r'\n[ \t]+\n', '\n\n', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text


def strip_css(src):
    return re.sub(r'/\*.*?\*/', lambda m: '' if bad(m.group(0)) else m.group(0), src, flags=re.S)


def strip_html(src):
    return re.sub(r'<!--.*?-->', lambda m: '' if bad(m.group(0)) else m.group(0), src, flags=re.S)


def main():
    app = (ROOT / 'app.js').read_text(encoding='utf-8')
    ver = re.search(r"const VERSION = '([^']+)'", app).group(1)
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    for name in FILES:
        src = (ROOT / name).read_text(encoding='utf-8')
        if name.endswith('.js'):
            src = strip_js(src)
        elif name.endswith('.css'):
            src = strip_css(src)
        elif name.endswith('.html'):
            src = strip_html(src)
        if name == 'sw.js':
            src = re.sub(r"const CACHE = 'diary-", "const CACHE = 'diary-pub-", src)
        (OUT / name).write_text(src, encoding='utf-8', newline='\n')
    for name, p in {**SWAP, **EXTRA}.items():
        shutil.copyfile(p, OUT / name)
    # アイコンは公開用の紺(tools/public/icons)。個人版の icons はオレンジ(v0.19.4 本人「ホーム画面で2つ並ぶと区別がつかない」)
    shutil.copytree(PUB / 'icons', OUT / 'icons')

    # 確かめ: 決めた言葉が残っていない・JS の書き方が壊れていない・sw のファイル一覧がそろっている
    problems = []
    for p in sorted(OUT.rglob('*')):
        if p.is_file() and p.suffix in ('.js', '.css', '.html', '.md', '.webmanifest'):
            for k, line in enumerate(p.read_text(encoding='utf-8').split('\n'), 1):
                if bad(line):
                    problems.append(f'{p.relative_to(OUT)}:{k}: {line.strip()[:100]}')
    for p in OUT.glob('*.js'):
        r = subprocess.run(['node', '--check', str(p)], capture_output=True, text=True)
        if r.returncode:
            problems.append(f'{p.name}: JS が壊れています {r.stderr.strip()[:200]}')
    sw = (OUT / 'sw.js').read_text(encoding='utf-8')
    for name in FILES + list(SWAP):
        if name != 'sw.js' and f"'./{name}'" not in sw:
            problems.append(f'sw.js の FILES に ./{name} がありません')
    if problems:
        print('公開版を作れません:')
        print('\n'.join(problems))
        sys.exit(1)

    z = DIST / f'diary-public-{ver}.zip'
    with zipfile.ZipFile(z, 'w', zipfile.ZIP_DEFLATED) as zf:
        for p in sorted(OUT.rglob('*')):
            if p.is_file():
                zf.write(p, Path('diary') / p.relative_to(OUT))
    print(f'できました: {OUT}  /  {z}  ({z.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    main()
