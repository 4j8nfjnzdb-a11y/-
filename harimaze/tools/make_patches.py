#!/usr/bin/env python3
"""Builds the five harimaze Max patches (max/*.maxpat) around the GenExpr
cores in max/genexpr/. Each patch: a source section (buffer~, drop zone,
waveform~), a parameter grid (flonum boxes fed by named receivers so presets
update them), presets (buttons that fire hidden ; messages), the gen~ machine
with its codebox, and an output section (volume, ezdac~, meters, recorder,
position and state monitors).

Every patch cord is checked against the inlet and outlet counts of the
objects it joins. Run: python3 tools/make_patches.py
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MAXDIR = os.path.join(ROOT, 'max')

APPVERSION = {"major": 8, "minor": 6, "revision": 0, "architecture": "x64", "modernui": 1}

PATCHER_DEFAULTS = {
    "bglocked": 0, "openinpresentation": 0, "default_fontsize": 12.0, "default_fontface": 0,
    "default_fontname": "Arial", "gridonopen": 1, "gridsize": [15.0, 15.0], "gridsnaponopen": 1,
    "objectsnaponopen": 1, "statusbarvisible": 2, "toolbarvisible": 1, "lefttoolbarpinned": 0,
    "toptoolbarpinned": 0, "righttoolbarpinned": 0, "bottomtoolbarpinned": 0,
    "toolbars_unpinned_last_save": 0, "tallnewobj": 0, "boxanimatetime": 200, "enablehscroll": 1,
    "enablevscroll": 1, "devicewidth": 0.0, "description": "", "digest": "", "tags": "", "style": "",
    "subpatcher_template": "", "assistshowspatchername": 0,
}

# inlets, outlets, outlet types for the objects used here
UI = {
    'flonum': (1, 2, ["", "bang"]), 'number': (1, 2, ["", "bang"]), 'toggle': (1, 1, ["int"]),
    'button': (1, 1, ["bang"]), 'message': (2, 1, [""]), 'comment': (1, 0, []), 'slider': (1, 1, [""]),
    'ezdac~': (2, 0, []), 'meter~': (1, 1, ["float"]), 'dropfile': (1, 2, ["", ""]), 'panel': (1, 0, []),
    'waveform~': (5, 6, ["float", "float", "float", "float", "list", ""]),
}


def newobj_io(text):
    t = text.split()
    k = t[0]
    if k in ('loadbang',):
        return 1, 1, ["bang"]
    if k in ('loadmess', 'prepend'):
        return 1, 1, [""]
    if k in ('r', 'receive'):
        return 0, 1, [""]
    if k == 'buffer~':
        return 1, 2, ["float", "bang"]
    if k == 'adc~':
        n = max(len(t) - 1, 2)
        return 1, n, ["signal"] * n
    if k == '*~':
        return 2, 1, ["signal"]
    if k == 'line~':
        return 2, 2, ["signal", "bang"]
    if k == 'pack':
        return max(len(t) - 1, 2), 1, [""]
    if k == 'snapshot~':
        return 2, 1, ["float"]
    if k == 'click~':
        return 1, 1, ["signal"]
    if k == 'sfrecord~':
        n = int(t[1]) if len(t) > 1 else 1
        return n, 1, ["signal"]
    if k == 'random':
        return 2, 1, ["int"]
    raise ValueError('unknown object ' + text)


class Patch:
    def __init__(self):
        self.boxes, self.lines, self.io, self.n = [], [], {}, 0

    def _add(self, box, nin, nout):
        self.n += 1
        box['id'] = f'obj-{self.n}'
        self.boxes.append({'box': box})
        self.io[box['id']] = (nin, nout)
        return box['id']

    def obj(self, text, x, y, w=None, hidden=False, **kw):
        nin, nout, ot = newobj_io(text)
        w = w or max(40, 7 * len(text) + 14)
        box = {"maxclass": "newobj", "text": text, "numinlets": nin, "numoutlets": nout,
               "outlettype": ot, "patching_rect": [x, y, w, 22.0]}
        if hidden:
            box['hidden'] = 1
        box.update(kw)
        return self._add(box, nin, nout)

    def ui(self, cls, x, y, w, h, hidden=False, **kw):
        nin, nout, ot = UI[cls]
        box = {"maxclass": cls, "numinlets": nin, "numoutlets": nout, "patching_rect": [x, y, w, h]}
        if ot:
            box['outlettype'] = ot
        if hidden:
            box['hidden'] = 1
        box.update(kw)
        return self._add(box, nin, nout)

    def msg(self, text, x, y, w=None, h=22.0, hidden=False):
        return self.ui('message', x, y, w or max(40, 7 * len(text) + 16), h, hidden=hidden, text=text)

    def comment(self, text, x, y, w, size=12.0, bold=False, lines=None, color=None):
        kw = {"text": text, "fontsize": size}
        if bold:
            kw['fontface'] = 1
        n = lines or (text.count('\n') + 1)
        if n > 1:
            kw['linecount'] = n
        if color:
            kw['textcolor'] = color
        return self.ui('comment', x, y, w, 6 + n * size * 1.45, **kw)

    def panel(self, x, y, w, h, color):
        return self.ui('panel', x, y, w, h, bgcolor=color, rounded=8, border=0, background=1)

    def connect(self, a, ao, b, bi, hidden=False):
        na, nb = self.io[a], self.io[b]
        assert ao < na[1], f'{a} has no outlet {ao}'
        assert bi < nb[0], f'{b} has no inlet {bi}'
        line = {"source": [a, ao], "destination": [b, bi]}
        if hidden:
            line['hidden'] = 1
        self.lines.append({"patchline": line})

    def gen(self, code, nin, nout, x, y, w):
        """gen~ with a codebox wired to [in N] and [out N] objects."""
        inner, ilines, k = [], [], 0

        def ib(box):
            nonlocal k
            k += 1
            box['id'] = f'obj-{k}'
            inner.append({'box': box})
            return box['id']

        cb = ib({"maxclass": "codebox", "code": code.replace('\n', '\r\n'), "fontface": 0,
                 "fontname": "<Monospaced>", "fontsize": 12.0, "numinlets": nin, "numoutlets": nout,
                 "outlettype": [""] * nout, "patching_rect": [30.0, 60.0, 760.0, 1100.0]})
        for i in range(nin):
            iid = ib({"maxclass": "newobj", "text": f"in {i + 1}", "numinlets": 0, "numoutlets": 1,
                      "outlettype": [""], "patching_rect": [30.0 + 120 * i, 20.0, 40.0, 22.0]})
            ilines.append({"patchline": {"source": [iid, 0], "destination": [cb, i]}})
        for i in range(nout):
            oid = ib({"maxclass": "newobj", "text": f"out {i + 1}", "numinlets": 1, "numoutlets": 0,
                      "patching_rect": [30.0 + 120 * i, 1180.0, 45.0, 22.0]})
            ilines.append({"patchline": {"source": [cb, i], "destination": [oid, 0]}})
        sub = {"fileversion": 1, "appversion": APPVERSION, "classnamespace": "dsp.gen",
               "rect": [80.0, 80.0, 840.0, 760.0], **PATCHER_DEFAULTS, "boxes": inner, "lines": ilines}
        box = {"maxclass": "newobj", "text": "gen~", "numinlets": nin, "numoutlets": nout,
               "outlettype": ["signal"] * nout, "patching_rect": [x, y, w, 22.0], "patcher": sub}
        return self._add(box, nin, nout)

    def to_json(self, rect):
        return {"patcher": {"fileversion": 1, "appversion": APPVERSION, "classnamespace": "box",
                            "rect": rect, **PATCHER_DEFAULTS, "boxes": self.boxes, "lines": self.lines,
                            "dependency_cache": [], "autosave": 0}}


PAPER = [0.93, 0.92, 0.89, 1.0]
SKY = [0.86, 0.90, 0.93, 1.0]
SAGE = [0.88, 0.91, 0.87, 1.0]
ROSE = [0.94, 0.89, 0.87, 1.0]
INK = [0.25, 0.27, 0.3, 1.0]


def fmt(v):
    return str(int(v)) if float(v).is_integer() else str(v)


def source_block(p, x, y, buf, files, label, size_ms=30000, ch=2):
    """Buttons for bundled Max media, a drop zone and a waveform for one buffer~."""
    p.comment(label, x, y, 520, bold=True)
    bx = x
    msgs = []
    for f in files:
        m = p.msg(f'replace {f}', bx, y + 24)
        msgs.append(m)
        bx += 7 * len(f) + 76
    dlg = p.msg('replace', bx, y + 24)
    p.comment('← ファイルを選ぶ', bx + 58, y + 26, 120, size=11.0)
    drop = p.ui('dropfile', x, y + 54, 170, 58)
    p.comment('ここに音声ファイルを\nドロップ (wav / aif)', x + 8, y + 116, 170, size=10.5)
    pre = p.obj('prepend replace', x, y + 150, hidden=True)
    bufid = p.obj(f'buffer~ {buf} {size_ms} {ch}', x + 186, y + 116, w=230)
    wave = p.ui('waveform~', x + 186, y + 54, 330, 58)
    lm = p.obj(f'loadmess replace {files[0]}', x + 330, y + 150, hidden=True)
    ls = p.obj(f'loadmess set {buf}', x + 186, y + 150, hidden=True)
    for m in msgs + [dlg]:
        p.connect(m, 0, bufid, 0)
    p.connect(drop, 0, pre, 0, hidden=True)
    p.connect(pre, 0, bufid, 0, hidden=True)
    p.connect(lm, 0, bufid, 0, hidden=True)
    p.connect(ls, 0, wave, 0, hidden=True)
    return 150


def build(spec):
    p = Patch()
    W = 1190
    code = open(os.path.join(MAXDIR, 'genexpr', spec['key'] + '.genexpr'), encoding='utf-8').read()
    nin = max(int(n) for n in re.findall(r'\bin(\d+)\b', re.sub(r'//[^\n]*', '', code)))
    nout = max(int(n) for n in re.findall(r'\bout(\d+)\b', re.sub(r'//[^\n]*', '', code)))
    pre = spec['key']

    # header
    p.comment(spec['title'], 20, 12, 900, size=24.0, bold=True)
    p.comment(spec['concept'], 22, 50, 760, size=12.5, lines=spec['concept'].count('\n') + 1)
    p.comment(spec['context'], 22, 50 + 18 * (spec['concept'].count('\n') + 1) + 4, 760, size=11.0,
              color=INK, lines=spec['context'].count('\n') + 1)

    # sources
    top = 150
    p.panel(12, top - 8, 770, 30 + 160 * len(spec['sources']), SKY)
    y = top
    for s in spec['sources']:
        source_block(p, 24, y, s['buffer'], s['files'], s['label'], s.get('ms', 30000), s.get('ch', 2))
        y += 160

    # parameters
    ptop = y + 34
    cols = 6
    rows = (len(spec['params']) + cols - 1) // cols
    p.panel(12, ptop - 8, 770, 30 + rows * 84, SAGE)
    p.comment('2  パラメータ PARAMETERS — 数字をドラッグ / ダブルクリックで入力', 24, ptop, 700, bold=True)
    prepends = []
    for k, prm in enumerate(spec['params']):
        cx = 24 + (k % cols) * 126
        cy = ptop + 28 + (k // cols) * 84
        p.comment(f"{prm['name']}\n{prm['ja']}  {prm['range']}", cx, cy, 122, size=11.0, lines=2)
        r = p.obj(f"r {pre}_{prm['name']}", cx + 70, cy + 40, hidden=True)
        if prm.get('kind') == 'toggle':
            ctl = p.ui('toggle', cx, cy + 36, 24, 24)
        elif prm.get('kind') == 'bang':
            ctl = p.ui('button', cx, cy + 36, 24, 24)
        else:
            ctl = p.ui('flonum', cx, cy + 36, 74, 22, minimum=prm['min'], maximum=prm['max'],
                       numdecimalplaces=prm.get('dp', 3), format=6)
        p.connect(r, 0, ctl, 0, hidden=True)
        if prm.get('kind') == 'bang':
            rnd = p.obj('random 1000000', cx, cy + 64, hidden=True)
            p.connect(ctl, 0, rnd, 0, hidden=True)
            ctl = rnd
        pp = p.obj(f"prepend {prm['name']}", cx, cy + 66, hidden=True)
        p.connect(ctl, 0, pp, 0, hidden=True)
        prepends.append(pp)
    py_end = ptop + 22 + rows * 84

    # machine
    gen_y = py_end + 44
    extra_h = 34 * len(spec.get('extra_buffers', []))
    for k, extra in enumerate(spec.get('extra_buffers', [])):
        p.obj(extra, 24, gen_y + 34 + 34 * k, w=250)
        p.comment(spec.get('extra_note', ''), 284, gen_y + 34 + 34 * k, 470, size=10.5)
    gen = p.gen(code, nin, nout, 24, gen_y + 40 + extra_h, 740)
    for pp in prepends:
        p.connect(pp, 0, gen, 0, hidden=True)
    if spec.get('live_input'):
        adc = p.obj('adc~ 1 2', 24, gen_y)
        p.connect(adc, 0, gen, 0)
        p.connect(adc, 1, gen, 1)
        p.comment('マイク / ライン入力 → source を 0 に。ハウリングに注意（ヘッドホン推奨）', 110, gen_y + 2, 600, size=11.0)
    else:
        b = p.ui('button', 24, gen_y - 2, 26, 26)
        clk = p.obj('click~', 60, gen_y)
        p.connect(b, 0, clk, 0)
        p.connect(clk, 0, gen, 0)
        p.comment(spec['trigger_note'], 112, gen_y + 2, 640, size=11.0)

    # outputs
    oy = gen_y + 84 + extra_h
    p.panel(12, py_end + 14, 770, oy + 118 - py_end - 14, ROSE)
    p.comment('3  マシン MACHINE — gen~ をダブルクリックするとコードが見られます', 24, py_end + 20, 700, bold=True)
    xs = [24, 270, 516, 664]
    mulL = p.obj('*~ 0.', xs[0], oy, w=60)
    mulR = p.obj('*~ 0.', xs[1], oy, w=60)
    p.connect(gen, 0, mulL, 0)
    p.connect(gen, 1, mulR, 0)
    vol_r = p.obj(f'r {pre}_master', 96, oy - 30, hidden=True)
    vol = p.ui('flonum', 96, oy, 60, 22, minimum=0.0, maximum=1.0, numdecimalplaces=2, format=6)
    p.comment('master', 160, oy + 2, 60, size=11.0)
    pk = p.obj('pack f 40', 96, oy + 28, hidden=True)
    ln = p.obj('line~', 96, oy + 54, hidden=True)
    lmv = p.obj('loadmess 0.7', 96, oy - 54, hidden=True)
    p.connect(vol_r, 0, vol, 0, hidden=True)
    p.connect(lmv, 0, vol, 0, hidden=True)
    p.connect(vol, 0, pk, 0, hidden=True)
    p.connect(pk, 0, ln, 0, hidden=True)
    p.connect(ln, 0, mulL, 1, hidden=True)
    p.connect(ln, 0, mulR, 1, hidden=True)
    dac = p.ui('ezdac~', 24, oy + 40, 45, 45)
    p.connect(mulL, 0, dac, 0)
    p.connect(mulR, 0, dac, 1)
    mL = p.ui('meter~', 76, oy + 40, 12, 45)
    mR = p.ui('meter~', 92, oy + 40, 12, 45)
    p.connect(mulL, 0, mL, 0)
    p.connect(mulR, 0, mR, 0)
    p.comment('← クリックで音を出す', 110, oy + 52, 150, size=11.0)
    opn = p.msg('open', 270, oy + 40)
    tg = p.ui('toggle', 318, oy + 40, 22, 22)
    rec = p.obj('sfrecord~ 2', 270, oy + 70, w=90)
    p.connect(opn, 0, rec, 0)
    p.connect(tg, 0, rec, 0)
    p.connect(mulL, 0, rec, 0)
    p.connect(mulR, 0, rec, 1)
    p.comment('録音: open で保存先 → トグルで開始/停止', 346, oy + 42, 170, size=10.5, lines=2)
    s3 = p.obj('snapshot~ 33', xs[2], oy, w=90)
    s4 = p.obj('snapshot~ 33', xs[3], oy, w=90)
    p.connect(gen, 2, s3, 0)
    p.connect(gen, 3, s4, 0)
    sl = p.ui('slider', xs[2], oy + 40, 140, 18, floatoutput=1, size=1.0, ignoreclick=1)
    p.connect(s3, 0, sl, 0)
    p.comment(spec['out3'], xs[2], oy + 62, 145, size=10.5, lines=2)
    nm = p.ui('flonum', xs[3], oy + 40, 60, 22, numdecimalplaces=2, format=6, ignoreclick=1)
    p.connect(s4, 0, nm, 0)
    p.comment(spec['out4'], xs[3], oy + 62, 118, size=10.5, lines=spec['out4'].count('\n') + 1)

    # presets (right column)
    rx = 800
    p.panel(rx - 8, top - 8, 390, 40 + 64 * len(spec['presets']), PAPER)
    p.comment('プリセット PRESETS — ● を押す', rx, top, 360, bold=True)
    lb = p.obj('loadbang', rx + 300, top, hidden=True)
    for k, pr in enumerate(spec['presets']):
        py = top + 30 + k * 64
        b = p.ui('button', rx, py, 26, 26)
        p.comment(pr['name'], rx + 34, py + 2, 330, size=13.0, bold=True)
        p.comment(pr['note'], rx + 34, py + 22, 340, size=10.5, lines=pr['note'].count('\n') + 1)
        text = '; ' + '; '.join(f'{pre}_{n} {fmt(v)}' for n, v in pr['values'])
        if pr.get('extra'):
            text += '; ' + pr['extra']
        mb = p.msg(text, rx + 200, py, w=170, hidden=True)
        p.connect(b, 0, mb, 0, hidden=True)
        if k == 0:
            p.connect(lb, 0, mb, 0, hidden=True)

    # how to use
    hy = top + 50 + 64 * len(spec['presets'])
    p.comment(spec['howto'], rx, hy, 380, size=11.0, lines=spec['howto'].count('\n') + 1)

    height = max(oy + 130, hy + 120)
    return p.to_json([40.0, 60.0, float(W), float(height)])


def P(name, ja, lo, hi, kind=None, dp=3, rng=None):
    d = {'name': name, 'ja': ja, 'min': float(lo), 'max': float(hi), 'range': rng or f'{fmt(lo)}〜{fmt(hi)}', 'dp': dp}
    if kind:
        d['kind'] = kind
    return d


HOWTO_COMMON = ('使い方\n'
                '1. 右下の ezdac~（スピーカー）をクリックして DSP を ON\n'
                '2. プリセットの ● を押す（起動時は 1 番目が入ります）\n'
                '3. 数字をドラッグして変える。音源はドロップで差し替え\n'
                '同梱音源（jongly.aif など）は Max 付属のサンプルです。\n'
                '見つからない場合は自分のファイルをドロップしてください。')

SPECS = [
    {
        'key': 'tenki', 'file': 'harimaze_tenki.maxpat',
        'title': 'TENKI 天気 — loop weather',
        'concept': ('ひとつのループ窓が、天気のように移り変わる。テープが止まり（tape stop）、巻き戻り（rewind）、\n'
                    '過去へ跳び（leap）、マイクロループに凍る（freeze）。窓そのものもゆっくり漂う（drift）。\n'
                    '継ぎ目は「ゴースト・ヘッド」がクロスフェードするのでクリックしない。'),
        'context': ('文脈: Philip Jeck のターンテーブル速度操作 / Ulla の揺れるループ / 竹村延和の「SCRUB」的な即興'),
        'sources': [{'buffer': 'hz_tenki_src', 'files': ['jongly.aif', 'anton.aif', 'drumLoop.aif'],
                     'label': '1  音源 SOURCE'}],
        'params': [
            P('speed', '速度', -2, 2), P('start', '開始位置', 0, 1), P('size', 'ループ長', 0, 1),
            P('drift', '漂い', 0, 1), P('weather', '天気の頻度', 0, 1), P('tapestop', 'テープ停止', 0, 1),
            P('rewind', '巻き戻し', 0, 1), P('leap', '跳躍', 0, 1), P('freeze', '凍結', 0, 1),
            P('glide', '慣性 ms', 1, 3000, dp=0), P('xfade', '継ぎ目 ms', 1, 200, dp=0), P('level', '音量', 0, 1),
        ],
        'trigger_note': '● 今すぐ天気を変える（in1 の立ち上がりでイベント。外部の click~ や他マシンでも駆動できる）',
        'out3': '再生位置 (out3)\n← 戻る / 進む →',
        'out4': '天気 (out4)\n0 晴 1 停止 2 巻戻\n3 凍結 4 跳躍',
        'presets': [
            {'name': '晴れ calm', 'note': 'ループだけ。漂いは少し。まずはここから',
             'values': [('speed', 1), ('start', 0.1), ('size', 0.25), ('drift', 0.15), ('weather', 0), ('tapestop', 0.5),
                        ('rewind', 0.4), ('leap', 0.4), ('freeze', 0.3), ('glide', 250), ('xfade', 20), ('level', 0.8)]},
            {'name': '小雨 drizzle', 'note': 'ときどき巻き戻り、ときどき跳ぶ',
             'values': [('size', 0.12), ('drift', 0.3), ('weather', 0.3), ('tapestop', 0.3), ('rewind', 0.5),
                        ('leap', 0.3), ('freeze', 0.2), ('glide', 250)]},
            {'name': '夕立 shower', 'note': '短いループで頻繁に天気が変わる',
             'values': [('size', 0.06), ('weather', 0.7), ('tapestop', 0.6), ('rewind', 0.6), ('leap', 0.5),
                        ('freeze', 0.5), ('glide', 120)]},
            {'name': '霜 frost', 'note': '半速で、マイクロループに凍りつく',
             'values': [('speed', 0.5), ('size', 0.03), ('drift', 0.5), ('weather', 0.5), ('tapestop', 0.2),
                        ('rewind', 0.2), ('leap', 0.1), ('freeze', 1), ('glide', 800), ('xfade', 40)]},
            {'name': '嵐 storm', 'note': '全部のイベントが最大頻度で',
             'values': [('speed', 1.2), ('size', 0.02), ('weather', 1), ('tapestop', 1), ('rewind', 1), ('leap', 1),
                        ('freeze', 1), ('glide', 60), ('xfade', 8)]},
        ],
        'howto': HOWTO_COMMON,
    },
    {
        'key': 'kizu', 'file': 'harimaze_kizu.maxpat',
        'title': 'KIZU 傷盤 — wounded disc',
        'concept': ('傷ついた CD を鳴らすプレーヤー。引っかかって同じ断片を繰り返し（stick、少しずつずれる creep）、\n'
                    '飛び（skip）、無音に落ち（drop）、数 ms のフレームがジーッと鳴る（zip）。\n'
                    '故障中はエラー補間が崩れたように音が粗くなる（crush）。'),
        'context': ('文脈: Oval（マーカーで塗った CD）/ 刀根康尚『Solo for Wounded CD』（穴を開けたテープ）/ Pontiac Streator の Oval 的グリッチ'),
        'sources': [{'buffer': 'hz_kizu_src', 'files': ['cherokee.aif', 'jongly.aif', 'anton.aif'],
                     'label': '1  音源 SOURCE（CD 役）'}],
        'params': [
            P('speed', '速度', -2, 2), P('damage', '損傷', 0, 1), P('stick', '引っかかり', 0, 1),
            P('skip', '飛び', 0, 1), P('drop', '欠落', 0, 1), P('zip', 'ジッ音', 0, 1),
            P('sticklen', '断片 ms', 10, 1000, dp=0), P('creep', 'ずれ', 0, 1), P('crush', '劣化', 0, 1),
            P('click', 'クリック', 0, 1), P('level', '音量', 0, 1),
        ],
        'trigger_note': '● 今すぐ故障させる（in1 の立ち上がりでエラーを 1 回起こす）',
        'out3': '読み取り位置 (out3)',
        'out4': '状態 (out4)\n0 再生 1 引っかかり\n2 欠落 3 ジッ 4 飛び',
        'presets': [
            {'name': '新品 mint', 'note': '傷なし。素の音源',
             'values': [('speed', 1), ('damage', 0), ('stick', 0.6), ('skip', 0.4), ('drop', 0.25), ('zip', 0.2),
                        ('sticklen', 120), ('creep', 0.3), ('crush', 0.4), ('click', 0.5), ('level', 0.8)]},
            {'name': '指紋 fingerprint', 'note': 'たまに引っかかる程度',
             'values': [('damage', 0.2), ('stick', 0.8), ('skip', 0.2), ('drop', 0.1), ('zip', 0), ('sticklen', 200),
                        ('creep', 0.2), ('crush', 0.2), ('click', 0.3)]},
            {'name': 'マーカー marker', 'note': '塗られた盤。短い断片がずれながら反復',
             'values': [('damage', 0.6), ('stick', 1), ('skip', 0.3), ('drop', 0.2), ('zip', 0.4), ('sticklen', 60),
                        ('creep', 0.5), ('crush', 0.5), ('click', 0.7)]},
            {'name': 'テープの穴 pinholes', 'note': '誤り訂正が破綻する。ほぼ制御不能',
             'values': [('damage', 0.9), ('stick', 0.5), ('skip', 0.8), ('drop', 0.5), ('zip', 0.7), ('sticklen', 25),
                        ('creep', 0.8), ('crush', 0.8), ('click', 1)]},
        ],
        'howto': HOWTO_COMMON,
    },
    {
        'key': 'mebuki', 'file': 'harimaze_mebuki.maxpat',
        'title': 'MEBUKI 芽吹 — texture bloom',
        'concept': ('ふたつの音源 A / B から粒（grain）を取り出す。morph は「次の粒をどちらから取るか」の確率なので、\n'
                    'A のテクスチャーの中に B が少しずつ芽を出し、やがて入れ替わる。bloom で morph が勝手に揺れる。\n'
                    'scan は時間の流れ（負で逆行、0 で静止）。toy で音高を五音音階に丸める。'),
        'context': ('文脈: Jake Muir のグラニュラー処理 / KMRU の環境音 + 粒 / 竹村延和のおもちゃのような旋律'),
        'sources': [
            {'buffer': 'hz_mebuki_a', 'files': ['jongly.aif', 'anton.aif', 'drumLoop.aif'], 'label': '1A  音源 A（地）', 'ch': 1},
            {'buffer': 'hz_mebuki_b', 'files': ['sho0630.aif', 'vibes-a1.aif', 'cherokee.aif'], 'label': '1B  音源 B（芽）', 'ch': 1},
        ],
        'params': [
            P('morph', '移ろい A→B', 0, 1), P('bloom', '自走', 0, 1), P('position', '位置', 0, 1),
            P('scan', '時間の流れ', -1, 1), P('spray', '散り', 0, 1), P('density', '密度 /秒', 0.2, 200, dp=1),
            P('grainsize', '粒長 ms', 5, 2000, dp=0), P('pitch', '音高 半音', -24, 24, dp=1), P('pspray', '音高の散り', 0, 24, dp=1),
            P('toy', '五音に丸める', 0, 1, kind='toggle', rng='on/off'), P('rev', '逆再生率', 0, 1),
            P('width', '広がり', 0, 1), P('level', '音量', 0, 1),
        ],
        'trigger_note': '● 粒をひとつ出す（in1 の立ち上がりで grain を生成。リズムで駆動すると粒が拍に乗る）',
        'out3': '読み取り位置 (out3)',
        'out4': 'いまの morph (out4)\n0 = A, 1 = B',
        'presets': [
            {'name': '霧 mist', 'note': 'A だけの長い粒。ゆっくり前へ',
             'values': [('morph', 0), ('bloom', 0.2), ('position', 0.2), ('scan', 0.02), ('spray', 0.1), ('density', 30),
                        ('grainsize', 400), ('pitch', 0), ('pspray', 0), ('toy', 0), ('rev', 0.15), ('width', 0.6), ('level', 0.8)]},
            {'name': '芽 sprout', 'note': 'B がときどき顔を出す',
             'values': [('morph', 0.25), ('bloom', 0.6), ('scan', 0.05), ('density', 18), ('grainsize', 220)]},
            {'name': '開花 bloom', 'note': 'B が地になり、A が残り香になる',
             'values': [('morph', 0.8), ('bloom', 0.4), ('density', 40), ('grainsize', 150), ('pspray', 3)]},
            {'name': 'おもちゃ toy', 'note': '五音音階に丸めた短い粒',
             'values': [('morph', 0.5), ('toy', 1), ('pspray', 12), ('density', 8), ('grainsize', 90), ('rev', 0.3)]},
            {'name': '逆流 backwards', 'note': '時間が戻っていく',
             'values': [('scan', -0.4), ('spray', 0.03), ('density', 50), ('grainsize', 300), ('toy', 0), ('pspray', 0)]},
        ],
        'howto': HOWTO_COMMON,
    },
    {
        'key': 'tsuioku', 'file': 'harimaze_tsuioku.maxpat',
        'title': 'TSUIOKU 追憶 — memory tape',
        'concept': ('入力を 32 秒の円環テープに書き続け、3 つのヘッドが過去の瞬間を「思い出す」。\n'
                    'ループし、逆に回り、速度を変え、やがて手放す。思い出した音は風化して（erode）テープに戻されるので、\n'
                    '記憶の記憶が積もってすり減っていく。freeze で書き込みを止め、記憶だけを鳴らす。'),
        'context': ('文脈: Philip Jeck / William Basinski 的な劣化ループ / Ulla『Hometown Girl』の擦り切れたループ / claire rousay の日記的録音'),
        'sources': [{'buffer': 'hz_tsuioku_file', 'files': ['anton.aif', 'jongly.aif', 'cherokee.aif'],
                     'label': '1  入力ファイル（source = 1 のとき）'}],
        'extra_buffers': ['buffer~ hz_tsuioku_tape 32000 2'],
        'extra_note': '← 記憶のテープ（32 秒・ステレオ）。長さを変えたいときはこの数字（ms）を書き換える',
        'live_input': True,
        'params': [
            P('source', '入力 1=file 0=mic', 0, 1, kind='toggle', rng='on/off'), P('ingain', '入力量', 0, 1),
            P('recall', '想起の頻度', 0, 1), P('span', '遡る深さ', 0, 1), P('loop', 'ループ長 ms', 50, 4000, dp=0),
            P('rev', '逆行', 0, 1), P('varispeed', '速度の揺れ', 0, 1), P('wow', 'うねり', 0, 1),
            P('feedback', '再録', 0, 0.99), P('erode', '風化', 0, 1), P('freeze', '凍結', 0, 1, kind='toggle', rng='on/off'),
            P('dry', '原音', 0, 1), P('level', '音量', 0, 1),
        ],
        'out3': '書き込み位置 (out3)',
        'out4': 'ヘッド1 の位置 (out4)\n戻ったり進んだり',
        'presets': [
            {'name': '日記 diary', 'note': '少し前のことを、ときどき思い出す',
             'values': [('source', 1), ('ingain', 0.8), ('recall', 0.3), ('span', 0.5), ('loop', 1500), ('rev', 0.2),
                        ('varispeed', 0.1), ('wow', 0.15), ('feedback', 0.3), ('erode', 0.3), ('freeze', 0), ('dry', 0.5), ('level', 0.8)]},
            {'name': '反芻 rumination', 'note': '同じ場面に何度も戻る',
             'values': [('recall', 0.7), ('span', 0.2), ('loop', 600), ('rev', 0.4), ('varispeed', 0.3), ('feedback', 0.6),
                        ('erode', 0.5), ('dry', 0.2)]},
            {'name': '風化 disintegration', 'note': '再録を深く。擦り切れていく',
             'values': [('recall', 0.2), ('span', 0.1), ('loop', 3000), ('rev', 0), ('varispeed', 0), ('wow', 0.3),
                        ('feedback', 0.9), ('erode', 0.8), ('dry', 0)]},
            {'name': '逆夢 backwards', 'note': '記憶がいつも逆に流れる',
             'values': [('rev', 1), ('recall', 0.6), ('span', 0.8), ('loop', 1200), ('varispeed', 0.5), ('feedback', 0.4),
                        ('dry', 0.1)]},
        ],
        'howto': HOWTO_COMMON + '\nマイクを使うときは source を 0 に（ハウリング注意）。',
    },
    {
        'key': 'kiri', 'file': 'harimaze_kiri.maxpat',
        'title': 'KIRI 切貼 — cut-up sequencer',
        'concept': ('音源を等分に切り、16 ステップのパターンで貼り直す。各ステップは切片・向き・音程・連打・休符を持ち、\n'
                    '1 周ごとに一部が変異（mutate）するので、コラージュが自分で書き換わり続ける。\n'
                    'order 0 で元の並び、1 で完全にシャッフル。reroll でパターンを丸ごと書き直す。'),
        'context': ('文脈: 竹村延和 / Jan Jelinek のループ探し / Space Afrika・Klein のカットアップ / 3XL 周辺のサンプリング'),
        'sources': [{'buffer': 'hz_kiri_src', 'files': ['drumLoop.aif', 'jongly.aif', 'anton.aif'],
                     'label': '1  音源 SOURCE'}],
        'params': [
            P('bpm', 'テンポ', 20, 400, dp=1), P('slices', '切片の数', 1, 64, dp=0), P('steps', 'ステップ数', 1, 16, dp=0),
            P('order', '並びの乱れ', 0, 1), P('mutate', '変異', 0, 1), P('rest', '休符', 0, 1),
            P('rev', '逆再生', 0, 1), P('pitch', '音程 (五音)', 0, 1), P('ratchet', '連打', 0, 1),
            P('gatelen', '音の長さ', 0.05, 1), P('swing', 'スウィング', 0, 0.9), P('reroll', '書き直す', 0, 1, kind='bang', rng='●'),
            P('level', '音量', 0, 1),
        ],
        'trigger_note': '● 1 ステップ進める（in1 の立ち上がりで進む。bpm を 20 にして外部クロックで駆動もできる）',
        'out3': 'ステップ (out3)',
        'out4': '鳴っている切片 (out4)\n0〜1',
        'presets': [
            {'name': '原形 original', 'note': '元の並びのまま刻む',
             'values': [('bpm', 96), ('slices', 16), ('steps', 16), ('order', 0), ('mutate', 0), ('rest', 0), ('rev', 0),
                        ('pitch', 0), ('ratchet', 0), ('gatelen', 1), ('swing', 0), ('level', 0.8)],
             'extra': 'kiri_reroll bang'},
            {'name': '切り絵 cutout', 'note': '少しずつ並びが崩れていく',
             'values': [('order', 0.6), ('mutate', 0.15), ('rest', 0.15), ('rev', 0.2), ('pitch', 0.2), ('ratchet', 0.15),
                        ('gatelen', 0.85)], 'extra': 'kiri_reroll bang'},
            {'name': 'おもちゃ箱 toybox', 'note': '五音の音程と連打。竹村延和的な遊び',
             'values': [('bpm', 112), ('order', 0.8), ('pitch', 0.8), ('rest', 0.25), ('ratchet', 0.3), ('rev', 0.3),
                        ('gatelen', 0.5)], 'extra': 'kiri_reroll bang'},
            {'name': '解体 dismantle', 'note': '毎周大きく変異し、スウィングする',
             'values': [('order', 1), ('mutate', 0.6), ('rest', 0.35), ('rev', 0.5), ('pitch', 0.5), ('ratchet', 0.5),
                        ('swing', 0.3), ('gatelen', 0.7)], 'extra': 'kiri_reroll bang'},
        ],
        'howto': HOWTO_COMMON,
    },
]


def main():
    out = []
    for spec in SPECS:
        data = build(spec)
        path = os.path.join(MAXDIR, spec['file'])
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        boxes = data['patcher']['boxes']
        out.append((spec['file'], len(boxes), len(data['patcher']['lines'])))
    for f, b, l in out:
        print(f'{f}: {b} boxes, {l} cords')
    # shared definition for the browser lab
    lab = []
    for spec in SPECS:
        lab.append({k: spec[k] for k in ('key', 'file', 'title', 'concept', 'context', 'out3', 'out4')} | {
            'params': spec['params'], 'presets': spec['presets'],
            'sources': [{'buffer': s['buffer'], 'label': s['label']} for s in spec['sources']],
            'live_input': bool(spec.get('live_input')), 'trigger_note': spec.get('trigger_note', '')})
    with open(os.path.join(MAXDIR, 'machines.json'), 'w', encoding='utf-8') as f:
        json.dump(lab, f, ensure_ascii=False, indent=1)
    print('machines.json written')


if __name__ == '__main__':
    main()
