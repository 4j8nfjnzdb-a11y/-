import json

boxes = {}
lines = []
col_y = {}

def add(id_, text, ninlets, noutlets, outlettypes, x, ycol, w=140, h=22, extra=None, maxclass="newobj"):
    y = col_y.get(ycol, 40)
    col_y[ycol] = y + 46
    b = {
        "id": id_,
        "maxclass": maxclass,
        "numinlets": ninlets,
        "numoutlets": noutlets,
        "outlettype": outlettypes,
        "patching_rect": [x, y, w, h],
    }
    if maxclass == "newobj":
        b["text"] = text
    if extra:
        b.update(extra)
    assert id_ not in boxes, f"dup id {id_}"
    boxes[id_] = b
    return id_

def msg(id_, text, x, ycol, w=100):
    return add(id_, text, 2, 1, [""], x, ycol, w=w, maxclass="message")

def comment(id_, text, x, ycol, w=220):
    return add(id_, text, 1, 0, [], x, ycol, w=w, maxclass="comment", extra={"text": text})

def conn(src, sout, dst, din):
    lines.append({"patchline": {"source": [src, sout], "destination": [dst, din]}})

# ---------------------------------------------------------------
# 1. Input + continuous circular recording
# ---------------------------------------------------------------
add("adc", "adc~ 1 2", 0, 2, ["signal", "signal"], 40, "A")
comment("c_adc", "Fireface 802 の入力ch選択。3/4を使う場合は adc~ 3 4 に書き換え", 200, "A", 320)

add("bufL", "buffer~ bufL 300000 1", 1, 1, ["signal"], 40, "A")
add("bufR", "buffer~ bufR 300000 1", 1, 1, ["signal"], 40, "A")
comment("c_buf", "5分バッファ(300000ms)。20分にするなら1200000へ書き換えて再読込", 200, "A", 320)

add("recL", "record~ bufL 1", 1, 0, [], 40, "A")
add("recR", "record~ bufR 1", 1, 0, [], 40, "A")

conn("adc", 0, "recL", 0)
conn("adc", 1, "recR", 0)

add("loadbang", "loadbang", 0, 1, ["bang"], 40, "A")
add("t_init", "t b b b b", 1, 4, ["bang", "bang", "bang", "bang"], 40, "A")
conn("loadbang", 0, "t_init", 0)

msg("m_loop1", "loop 1", 200, "A")
msg("m_recstart", "1", 340, "A")
msg("m_clkstart", "start", 460, "A")
msg("m_metropoll1", "1", 580, "A")

# t_init outlets: 3=loop1(fires1st) 2=recstart 1=clkstart 0=metropoll(fires last)
conn("t_init", 3, "m_loop1", 0)
conn("t_init", 2, "m_recstart", 0)
conn("t_init", 1, "m_clkstart", 0)
conn("t_init", 0, "m_metropoll1", 0)

conn("m_loop1", 0, "recL", 0)
conn("m_loop1", 0, "recR", 0)
conn("m_recstart", 0, "recL", 0)
conn("m_recstart", 0, "recR", 0)

# ---------------------------------------------------------------
# 2. Position tracking (elapsed clock -> recordedMsClamped, writePositionMs)
# ---------------------------------------------------------------
add("clk", "clocker 20", 1, 1, [""], 40, "B")
conn("m_clkstart", 0, "clk", 0)

add("min_clip", "min 300000", 2, 1, [""], 40, "B")
add("mod_write", "% 300000", 2, 1, [""], 200, "B")
conn("clk", 0, "min_clip", 0)
conn("clk", 0, "mod_write", 0)

add("store_writepos", "float", 2, 1, [""], 200, "B")
conn("mod_write", 0, "store_writepos", 1)  # cold: continuous live update
comment("c_wp", "writePositionMs: 循環バッファ内での現在の書き込み位置", 340, "B", 300)

# ---------------------------------------------------------------
# 3. Read-position tracking via snapshot~ on grooveL's 2nd outlet
# ---------------------------------------------------------------
add("metro_poll", "metro 50", 2, 1, ["bang"], 40, "C")
conn("m_metropoll1", 0, "metro_poll", 0)

add("snap", "snapshot~", 1, 1, [""], 40, "C")
conn("metro_poll", 0, "snap", 0)

add("store_readpos", "float", 2, 1, [""], 40, "C")
conn("snap", 0, "store_readpos", 1)  # cold: continuous live update
comment("c_rp", "store_readpos: 現在の再生(過去)位置。ループ始点/終点のマーキングに使用", 200, "C", 320)

# ---------------------------------------------------------------
# 4. Playback engine (groove~ x2 for L/R) + dry/wet mix + output
# ---------------------------------------------------------------
add("grooveL", "groove~ bufL", 2, 3, ["signal", "signal", "bang"], 40, "D")
add("grooveR", "groove~ bufR", 2, 3, ["signal", "signal", "bang"], 40, "D")
conn("grooveL", 1, "snap", 0)  # position signal -> snapshot~

add("mixSlider", "", 0, 1, [""], 40, "E", maxclass="slider")
add("mix_div", "/ 127.", 2, 1, [""], 40, "E")
conn("mixSlider", 0, "mix_div", 0)

add("mix_t", "t f f", 1, 2, ["float", "float"], 40, "E")
conn("mix_div", 0, "mix_t", 0)

add("dry_calc", "!- 1.", 1, 1, [""], 200, "E")
conn("mix_t", 1, "dry_calc", 0)  # rightmost fires first -> dry calc

add("dry_pack", "pack 0. 20", 2, 1, [""], 200, "E")
conn("dry_calc", 0, "dry_pack", 0)
add("dry_line", "line~", 1, 1, ["signal"], 200, "E")
conn("dry_pack", 0, "dry_line", 0)

add("wet_pack", "pack 0. 20", 2, 1, [""], 340, "E")
conn("mix_t", 0, "wet_pack", 0)  # leftmost fires 2nd -> wet value
add("wet_line", "line~", 1, 1, ["signal"], 340, "E")
conn("wet_pack", 0, "wet_line", 0)

add("dryL_mult", "*~", 2, 1, ["signal"], 40, "F")
add("dryR_mult", "*~", 2, 1, ["signal"], 40, "F")
add("wetL_mult", "*~", 2, 1, ["signal"], 200, "F")
add("wetR_mult", "*~", 2, 1, ["signal"], 200, "F")

conn("adc", 0, "dryL_mult", 0)
conn("adc", 1, "dryR_mult", 0)
conn("dry_line", 0, "dryL_mult", 1)
conn("dry_line", 0, "dryR_mult", 1)

conn("grooveL", 0, "wetL_mult", 0)
conn("grooveR", 0, "wetR_mult", 0)
conn("wet_line", 0, "wetL_mult", 1)
conn("wet_line", 0, "wetR_mult", 1)

add("sumL", "+~", 2, 1, ["signal"], 40, "G")
add("sumR", "+~", 2, 1, ["signal"], 200, "G")
conn("dryL_mult", 0, "sumL", 0)
conn("wetL_mult", 0, "sumL", 1)
conn("dryR_mult", 0, "sumR", 0)
conn("wetR_mult", 0, "sumR", 1)

add("dac", "dac~ 1 2", 2, 0, [], 40, "G")
conn("sumL", 0, "dac", 0)
conn("sumR", 0, "dac", 1)

comment("c_mix", "ミックスフェーダー: 上げるほど原音が消えて過去(groove~)が鳴る", 460, "E", 300)

# ---------------------------------------------------------------
# 5. Pitch (microtonal, tape-style speed) + shared rate combiner
# ---------------------------------------------------------------
add("pitchSlider", "slider", 0, 1, [""], 40, "H", maxclass="slider")
add("pitch_expr", "expr pow(2., ($f1-63.5)/63.5)", 1, 1, [""], 40, "H", w=220)
conn("pitchSlider", 0, "pitch_expr", 0)

add("store_ratemag", "float 1.", 2, 1, [""], 40, "H")
conn("pitch_expr", 0, "store_ratemag", 0)  # hot: continuous live update AND bangable

add("direction_float", "float 1", 2, 1, [""], 200, "H")

add("rate_mult", "*", 2, 1, [""], 40, "I")
conn("store_ratemag", 0, "rate_mult", 0)
conn("direction_float", 0, "rate_mult", 1)

conn("rate_mult", 0, "grooveL", 0)
conn("rate_mult", 0, "grooveR", 0)

comment("c_pitch", "ピッチフェーダー: 中央=変化なし、左右で連続的に±1オクターブ(微分音域を含む)", 340, "H", 320)

# ---------------------------------------------------------------
# 6. Shared "enter trail" chain (live / normal playback, ~3s behind)
# ---------------------------------------------------------------
add("enterTrail", "t b b b", 1, 3, ["bang", "bang", "bang"], 40, "J")

msg("m_dirplus1", "1", 200, "J")
conn("enterTrail", 2, "m_dirplus1", 0)  # rightmost fires 1st: set direction=+1
conn("m_dirplus1", 0, "direction_float", 0)

conn("enterTrail", 1, "store_ratemag", 0)  # bang to retrigger rate_mult with new dir

add("trail_sub", "- 3000", 2, 1, [""], 340, "J")
conn("enterTrail", 0, "store_writepos", 0)  # leftmost fires last: bang writepos
conn("store_writepos", 0, "trail_sub", 0)

add("trail_max", "max 0.", 2, 1, [""], 340, "J")
conn("trail_sub", 0, "trail_max", 0)
conn("trail_max", 0, "grooveL", 1)
conn("trail_max", 0, "grooveR", 1)

comment("c_trail", "enterTrail: 通常再生に戻る(約3秒トレイル)。Rewind/Miracle/Loopのどれを解除しても実行", 460, "J", 320)

# ---------------------------------------------------------------
# 7. Rewind toggle
# ---------------------------------------------------------------
add("rewindToggle", "toggle", 1, 1, ["int"], 40, "K", maxclass="toggle")
add("rewind_sel", "sel 0 1", 1, 3, ["bang", "bang", "int"], 40, "K")
conn("rewindToggle", 0, "rewind_sel", 0)

conn("rewind_sel", 0, "enterTrail", 0)  # matched 0 -> off -> trail

add("rewindOn_t", "t b b", 1, 2, ["bang", "bang"], 200, "K")
conn("rewind_sel", 1, "rewindOn_t", 0)  # matched 1 -> rewind on

msg("m_dirminus1", "-1", 340, "K")
conn("rewindOn_t", 1, "m_dirminus1", 0)  # rightmost fires 1st
conn("m_dirminus1", 0, "direction_float", 0)
conn("rewindOn_t", 0, "store_ratemag", 0)  # leftmost fires last: retrigger

comment("c_rewind", "巻き戻しトグル: ONで逆再生(ピッチフェーダーの速さで)。OFFでトレイルに復帰", 460, "K", 320)

# ---------------------------------------------------------------
# 8. Live button (manual return to trail)
# ---------------------------------------------------------------
add("liveButton", "button", 1, 1, ["bang"], 40, "L", maxclass="button")
conn("liveButton", 0, "enterTrail", 0)

# ---------------------------------------------------------------
# 9. Jump
# ---------------------------------------------------------------
add("jumpButton", "button", 1, 1, ["bang"], 40, "M", maxclass="button")
add("jumpSecondsBox", "flonum", 1, 1, [""], 200, "M", maxclass="flonum",
    extra={"parameter_enable": 0})
add("jumpT", "t b b", 1, 2, ["bang", "bang"], 40, "N")
conn("jumpButton", 0, "jumpT", 0)

add("pos_sub", "-", 2, 1, [""], 200, "N")
add("wrap_add", "+ 300000", 2, 1, [""], 200, "N")
add("wrap_mod", "% 300000", 2, 1, [""], 200, "N")

conn("jumpT", 1, "jumpSecondsBox", 0)  # rightmost fires 1st: bang seconds box
add("jump_ms", "* 1000.", 2, 1, [""], 340, "N")
conn("jumpSecondsBox", 0, "jump_ms", 0)
conn("jump_ms", 0, "pos_sub", 1)  # cold: ageMs

conn("jumpT", 0, "store_writepos", 0)  # leftmost fires last: bang writepos
conn("store_writepos", 0, "pos_sub", 0)  # hot: triggers subtraction

conn("pos_sub", 0, "wrap_add", 0)
conn("wrap_add", 0, "wrap_mod", 0)
conn("wrap_mod", 0, "grooveL", 1)
conn("wrap_mod", 0, "grooveR", 1)

comment("c_jump", "ジャンプ: 「何秒前」のNo.を入れてボタンを押す", 460, "M", 260)

# ---------------------------------------------------------------
# 10. Loop (2-press arm/confirm, 3rd press off) + shift
#
# Design note: loopStart_f / loopEnd_f are WRITE-ONLY registers (always
# set via their cold/right inlet, never emit on their own). Their outlet
# is used for exactly one purpose each: feeding the shift add-chain's hot
# inlet when a shift button explicitly reads the "old" value. loop_pack's
# inlets are always fed directly from the original data source (read
# position on arm/confirm, or the wrap-chain result on shift) rather than
# by re-reading loopStart_f/loopEnd_f, which avoids any feedback loop.
# ---------------------------------------------------------------
add("loopButton", "button", 1, 1, ["bang"], 40, "O", maxclass="button")
add("loopState", "float 0", 2, 1, [""], 200, "O")
conn("loopButton", 0, "loopState", 0)  # bang -> outputs current state

add("loopState_inc", "+ 1", 2, 1, [""], 340, "O")
add("loopState_wrap", "% 3", 2, 1, [""], 340, "O")
conn("loopState", 0, "loopState_inc", 0)
conn("loopState_inc", 0, "loopState_wrap", 0)
conn("loopState_wrap", 0, "loopState", 1)  # cold: store for next press

add("sel_loop", "sel 0 1 2", 1, 4, ["bang", "bang", "bang", "int"], 40, "P")
conn("loopState", 0, "sel_loop", 0)

add("loopStart_f", "float", 2, 1, [""], 200, "P")
add("loopEnd_f", "float", 2, 1, [""], 340, "P")
add("loop_pack", "pack 0. 0.", 2, 1, [""], 480, "P")

# state 0 = ARM: capture read position -> loopStart_f (store) + loop_pack cold
conn("sel_loop", 0, "store_readpos", 0)
conn("store_readpos", 0, "loopStart_f", 1)   # cold: store only, no emit
conn("store_readpos", 0, "loop_pack", 1)     # cold: pack's start slot

# state 1 = CONFIRM: capture read position -> loopEnd_f (store) + loop_pack hot (fires)
add("confirm_t", "t b b", 1, 2, ["bang", "bang"], 200, "Q")
conn("sel_loop", 1, "confirm_t", 0)
conn("confirm_t", 1, "store_readpos", 0)     # rightmost fires 1st
conn("store_readpos", 0, "loopEnd_f", 1)     # cold: store only
conn("store_readpos", 0, "loop_pack", 0)     # hot: fires pack -> [start end]

msg("m_setloop", "setloop $1 $2", 480, "R", w=140)
conn("loop_pack", 0, "m_setloop", 0)
conn("m_setloop", 0, "grooveL", 1)
conn("m_setloop", 0, "grooveR", 1)

msg("m_loopon", "loop 1", 200, "R")
conn("confirm_t", 0, "m_loopon", 0)  # leftmost fires last: enable loop after points set
conn("m_loopon", 0, "grooveL", 1)
conn("m_loopon", 0, "grooveR", 1)

add("confirmDir_t", "t b b", 1, 2, ["bang", "bang"], 40, "Q")
conn("sel_loop", 1, "confirmDir_t", 0)
msg("m_dirplus1b", "1", 40, "R")
conn("confirmDir_t", 1, "m_dirplus1b", 0)
conn("m_dirplus1b", 0, "direction_float", 0)
conn("confirmDir_t", 0, "store_ratemag", 0)

# state 2 = OFF: disable loop, back to trail
msg("m_loopoff", "loop 0", 40, "S")
conn("sel_loop", 2, "m_loopoff", 0)
conn("m_loopoff", 0, "grooveL", 1)
conn("m_loopoff", 0, "grooveR", 1)
conn("sel_loop", 2, "enterTrail", 0)

comment("c_loop", "ループ: 1回目で始点セット, 2回目で終点確定してループ再生, 3回目で解除", 620, "P", 320)

# ---------------------------------------------------------------
# 11. Loop shift back / forward
#
# delta (ms, signed) is sent to a single trigger that first primes both
# add-chains' cold inlets with the delta, THEN reads loopStart_f (old
# value) through its chain into loop_pack's cold slot, THEN reads
# loopEnd_f (old value) through its chain into loop_pack's hot slot
# (firing it) -- start is always resolved before end fires the pack.
# ---------------------------------------------------------------
add("loopShiftSecondsBox", "flonum", 1, 1, [""], 40, "T", maxclass="flonum")
add("loopShiftBackBtn", "button", 1, 1, ["bang"], 200, "T", maxclass="button")
add("loopShiftFwdBtn", "button", 1, 1, ["bang"], 340, "T", maxclass="button")

add("shiftBack_t", "t b b", 1, 2, ["bang", "bang"], 200, "U")
conn("loopShiftBackBtn", 0, "shiftBack_t", 0)
conn("shiftBack_t", 1, "loopShiftSecondsBox", 0)
add("shiftBack_ms", "* -1000.", 2, 1, [""], 200, "V")
conn("loopShiftSecondsBox", 0, "shiftBack_ms", 0)

add("shiftFwd_t", "t b b", 1, 2, ["bang", "bang"], 340, "U")
conn("loopShiftFwdBtn", 0, "shiftFwd_t", 0)
conn("shiftFwd_t", 1, "loopShiftSecondsBox", 0)
add("shiftFwd_ms", "* 1000.", 2, 1, [""], 340, "V")
conn("loopShiftSecondsBox", 0, "shiftFwd_ms", 0)

add("shiftApply_t", "t b b f f", 1, 4, ["bang", "bang", "float", "float"], 40, "W")
conn("shiftBack_ms", 0, "shiftApply_t", 0)
conn("shiftFwd_ms", 0, "shiftApply_t", 0)

add("shiftStart_add", "+", 2, 1, [""], 200, "X")
add("shiftStart_wrapA", "+ 300000", 2, 1, [""], 200, "X")
add("shiftStart_wrapM", "% 300000", 2, 1, [""], 200, "X")
add("shiftEnd_add", "+", 2, 1, [""], 340, "X")
add("shiftEnd_wrapA", "+ 300000", 2, 1, [""], 340, "X")
add("shiftEnd_wrapM", "% 300000", 2, 1, [""], 340, "X")

# outlet3 (fires 1st, f): prime shiftStart_add's cold inlet with delta
conn("shiftApply_t", 3, "shiftStart_add", 1)
# outlet2 (fires 2nd, f): prime shiftEnd_add's cold inlet with delta
conn("shiftApply_t", 2, "shiftEnd_add", 1)
# outlet1 (fires 3rd, b): read OLD start, compute, store, relay to pack's cold slot
conn("shiftApply_t", 1, "loopStart_f", 0)   # hot: emits old start (its only outlet use)
conn("loopStart_f", 0, "shiftStart_add", 0)  # hot: combine with primed delta
conn("shiftStart_add", 0, "shiftStart_wrapA", 0)
conn("shiftStart_wrapA", 0, "shiftStart_wrapM", 0)
conn("shiftStart_wrapM", 0, "loopStart_f", 1)  # cold: store new start (no re-emit)
conn("shiftStart_wrapM", 0, "loop_pack", 1)    # cold: pack's start slot, direct

# outlet0 (fires 4th/last, b): read OLD end, compute, store, relay to pack's hot slot (fires)
conn("shiftApply_t", 0, "loopEnd_f", 0)     # hot: emits old end (its only outlet use)
conn("loopEnd_f", 0, "shiftEnd_add", 0)
conn("shiftEnd_add", 0, "shiftEnd_wrapA", 0)
conn("shiftEnd_wrapA", 0, "shiftEnd_wrapM", 0)
conn("shiftEnd_wrapM", 0, "loopEnd_f", 1)      # cold: store new end (no re-emit)
conn("shiftEnd_wrapM", 0, "loop_pack", 0)      # hot: pack's end slot, fires pack

msg("m_setloop2", "setloop $1 $2", 480, "Y", w=140)
conn("loop_pack", 0, "m_setloop2", 0)
conn("m_setloop2", 0, "grooveL", 1)
conn("m_setloop2", 0, "grooveR", 1)

comment("c_shift", "ループを秒数分だけ過去/未来へ移動(長さは維持)。ピッチはそのまま", 620, "T", 320)
comment("c_shift2", "先にループを確定(2回押し)してから使ってください", 40, "Y", 260)

# ---------------------------------------------------------------
# 12. Miracle mode (randomized cut-up, direction+speed vary)
# ---------------------------------------------------------------
add("miracleToggle", "toggle", 1, 1, ["int"], 40, "AA", maxclass="toggle")
add("miracle_sel", "sel 0 1", 1, 3, ["bang", "bang", "int"], 40, "AA")
conn("miracleToggle", 0, "miracle_sel", 0)

add("miracleChunkMsBox", "number", 1, 1, [""], 200, "AA", maxclass="number")

add("metro_miracle", "metro 1200", 2, 1, ["bang"], 40, "BB")
conn("miracleChunkMsBox", 0, "metro_miracle", 1)  # cold: adjustable chunk length

add("miracleOn_t", "t b b", 1, 2, ["bang", "bang"], 200, "AA")
conn("miracle_sel", 1, "miracleOn_t", 0)
msg("m_loop0_m", "loop 0", 340, "AA")
conn("miracleOn_t", 1, "m_loop0_m", 0)
conn("m_loop0_m", 0, "grooveL", 1)
conn("m_loop0_m", 0, "grooveR", 1)
msg("m_metromiracle1", "1", 460, "AA")
conn("miracleOn_t", 0, "m_metromiracle1", 0)
conn("m_metromiracle1", 0, "metro_miracle", 0)

add("miracleOff_t", "t b b", 1, 2, ["bang", "bang"], 200, "BB")
conn("miracle_sel", 0, "miracleOff_t", 0)
msg("m_metromiracle0", "0", 340, "BB")
conn("miracleOff_t", 1, "m_metromiracle0", 0)
conn("m_metromiracle0", 0, "metro_miracle", 0)
conn("miracleOff_t", 0, "enterTrail", 0)

# each miracle tick: direction, speed, then age/position
add("mTick_t", "t b b b b", 1, 4, ["bang", "bang", "bang", "bang"], 40, "CC")
conn("metro_miracle", 0, "mTick_t", 0)

add("random_dir", "random 2", 2, 1, [""], 200, "CC")
conn("mTick_t", 3, "random_dir", 0)  # fires 1st
add("dir_scale", "* 2", 2, 1, [""], 200, "DD")
add("dir_offset", "- 1", 2, 1, [""], 200, "EE")
conn("random_dir", 0, "dir_scale", 0)
conn("dir_scale", 0, "dir_offset", 0)
add("mDir_f", "float", 2, 1, [""], 200, "FF")
conn("dir_offset", 0, "mDir_f", 0)

add("random_speed", "random 180", 2, 1, [""], 340, "CC")
conn("mTick_t", 2, "random_speed", 0)  # fires 2nd
add("speed_expr", "expr 0.6+($f1/180.)*1.8", 1, 1, [""], 340, "DD", w=200)
conn("random_speed", 0, "speed_expr", 0)

add("mRate_mult", "*", 2, 1, [""], 340, "FF")
conn("mDir_f", 0, "mRate_mult", 1)     # cold: direction (already set)
conn("speed_expr", 0, "mRate_mult", 0)  # hot: speed triggers combine
conn("mRate_mult", 0, "grooveL", 0)
conn("mRate_mult", 0, "grooveR", 0)

add("random_age", "random 1", 2, 1, [""], 40, "DD")
conn("min_clip", 0, "random_age", 1)  # continuous: sets range (cold)
conn("mTick_t", 1, "random_age", 0)   # fires 3rd: bang -> ageMs

conn("random_age", 0, "pos_sub", 1)   # reuse shared subtractor's cold inlet (ageMs)
conn("mTick_t", 0, "store_writepos", 0)  # fires last: bang -> writePositionMs -> hot inlet of pos_sub
conn("store_writepos", 0, "pos_sub", 0)
# pos_sub -> wrap_add -> wrap_mod already wired to grooveL/R inlet 1 (from Jump section) - shared reuse

comment("c_miracle", "Miracle: 0.5〜3秒目安のランダム断片を順逆・速度ランダムで再生。長さはchunk(ms)で調整", 460, "AA", 340)

# ---------------------------------------------------------------
# Validate structural integrity
# ---------------------------------------------------------------
ids = set(boxes.keys())
errors = []
for ln in lines:
    s, so = ln["patchline"]["source"]
    d, di = ln["patchline"]["destination"]
    if s not in ids:
        errors.append(f"missing source id {s}")
    if d not in ids:
        errors.append(f"missing dest id {d}")
    if s in ids and so >= boxes[s]["numoutlets"]:
        errors.append(f"{s} outlet {so} out of range (has {boxes[s]['numoutlets']})")
    if d in ids and di >= boxes[d]["numinlets"]:
        errors.append(f"{d} inlet {di} out of range (has {boxes[d]['numinlets']})")

if errors:
    print("STRUCTURAL ERRORS:")
    for e in errors:
        print(" -", e)
else:
    print(f"OK: {len(boxes)} boxes, {len(lines)} lines, no structural errors")

patcher = {
    "patcher": {
        "fileversion": 1,
        "appversion": {"major": 8, "minor": 6, "revision": 0, "architecture": "x64", "modernui": 1},
        "classnamespace": "box",
        "rect": [40.0, 40.0, 1400.0, 900.0],
        "bglocked": 0,
        "openinpresentation": 0,
        "default_fontsize": 11.0,
        "default_fontface": 0,
        "default_fontname": "Arial",
        "gridonopen": 1,
        "gridsize": [15.0, 15.0],
        "gridsnaponopen": 1,
        "objectsnaponopen": 1,
        "statusbarvisible": 2,
        "toolbarvisible": 1,
        "boxanimatetime": 200,
        "enablehscroll": 1,
        "enablevscroll": 1,
        "devicewidth": 0.0,
        "boxes": [{"box": b} for b in boxes.values()],
        "lines": lines,
    }
}

with open("/tmp/claude-0/-home-user--/05d6924e-cc2e-5f18-b602-8abee8e220e4/scratchpad/maxgen/RewindSampler.maxpat", "w") as f:
    json.dump(patcher, f, indent=1, ensure_ascii=False)

print("wrote RewindSampler.maxpat")
