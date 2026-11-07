#!/usr/bin/env python3
# 打包交付物：Source ZIP（源码，已精简）与 Pages ZIP（构建产物）。
# 用法：先 `npm run build` 生成 dist/，再 `python3 tools/make_zips.py`
import os, zipfile, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DELIVER = os.path.join(ROOT, 'deliver')
os.makedirs(DELIVER, exist_ok=True)

# 按相对路径排除（支持嵌套，例如 'tools/out'）。
# 不在列表里的内容：src/ 源码、public/ 静态资源（含图标/模型/音乐/贴图）、
# 依赖与构建配置（package.json / package-lock.json / vite.config.js）、
# 测试脚本 tools/test、必要开发工具 tools/*.mjs、文档 *.md、.gitignore。
EXCLUDE_DIRS = {
    '.git', 'node_modules', 'dist', 'dist-test', 'deliver', '.workbuddy',
    '.music-src', '__pycache__', 'tools/out', 'tools/blender', 'shots',
}
# 按文件名模式排除（诊断日志、历史部署 ZIP、临时脚本）。
EXCLUDE_FILE_SUFFIXES = ('.log', '.zip')
EXCLUDE_FILES = {'_p2.mjs', '_shot.mjs', 'tools/make_zips.py'}

def _rel(path):
    # 统一归一化为正斜杠，避免 Windows 反斜杠导致排除匹配失效
    return os.path.relpath(path, ROOT).replace(os.sep, '/')

def iter_files(base):
    for dirpath, dirnames, filenames in os.walk(base):
        # 原地剪枝：按「相对路径」匹配嵌套排除目录
        kept = []
        for d in dirnames:
            rd = _rel(os.path.join(dirpath, d))
            if rd in EXCLUDE_DIRS or rd.startswith('.') or '/.' in '/' + rd:
                continue
            kept.append(d)
        dirnames[:] = kept
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            rel = _rel(full)
            if rel in EXCLUDE_FILES:
                continue
            if rel.split('/')[0] in EXCLUDE_DIRS:
                continue
            if fn.endswith(EXCLUDE_FILE_SUFFIXES):
                continue
            yield rel, full

def make_zip(out_path, roots):
    n = 0
    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as z:
        for rel, full in iter_files(ROOT):
            if roots and not any(rel == r or rel.startswith(r + os.sep) for r in roots):
                continue
            z.write(full, rel)
            n += 1
    print(f'  {out_path}  ({n} files, {os.path.getsize(out_path)/1024/1024:.1f} MB)')

# ① 完整 Source ZIP（精简版：剔除依赖/构建产物/临时与诊断文件/历史 ZIP/重复截图/Blender 缓存）
src_zip = os.path.join(DELIVER, 'little-racing-v2-source-trimmed.zip')
print('Building Source ZIP (trimmed) …')
make_zip(src_zip, None)

# ② 完整 Pages ZIP（dist/ 内容，可直接部署）
pages_zip = os.path.join(DELIVER, 'little-racing-v2-pages.zip')
print('Building Pages ZIP …')
n = 0
with zipfile.ZipFile(pages_zip, 'w', zipfile.ZIP_DEFLATED) as z:
    dist = os.path.join(ROOT, 'dist')
    if not os.path.isdir(dist):
        print('  跳过 Pages ZIP：dist/ 不存在，请先运行 npm run build', file=sys.stderr)
    else:
        for dirpath, dirnames, filenames in os.walk(dist):
            for fn in filenames:
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, dist)
                z.write(full, rel)
                n += 1
        print(f'  {pages_zip}  ({n} files, {os.path.getsize(pages_zip)/1024/1024:.1f} MB)')

print('Done.')
