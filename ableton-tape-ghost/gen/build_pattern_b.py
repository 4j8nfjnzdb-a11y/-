import json, sys
from gen_patch import PatchBuilder

BUF_SEC = 600.0
BUF_MS = int(BUF_SEC * 1000)
WCLOCK_HZ = 1.0 / BUF_SEC

p = PatchBuilder(width=1600, height=3000)

# ---------------------------------------------------------------
# Audio I/O + buffers + continuous circular recording
# ---------------------------------------------------------------
p.add("in_L", text="inlet~", cls="newobj", col=5, extra={"numinlets":0,"numoutlets":1})
p.add("in_R", text="inlet~", cls="newobj", col=5, extra={"numinlets":0,"numoutlets":1})

p.add("cm_io", cls="comment", comment_text="=== AUDIO IN -> always-on circular recorder (10 min buffer) ===", col=0, w=520)

p.add("buf_L", text=f"buffer~ tg_b_buf_L 1 {BUF_MS}", col=1, w=200)
p.add("buf_R", text=f"buffer~ tg_b_buf_R 1 {BUF_MS}", col=1, w=200)
p.add("rec_L", text="record~ tg_b_buf_L @loop 1", col=1, w=200)
p.add("rec_R", text="record~ tg_b_buf_R @loop 1", col=1, w=200)

p.add("loadbang1", text="loadbang", col=1, w=90)
p.add("t_init", text="t b b", col=1, w=60)
p.add("msg_zero_w", text="0.", cls="message", col=1, w=50)
p.add("msg_record", text="record", cls="message", col=1, w=70)

# write-clock: exact 0..1 ramp over BUF_SEC seconds, phase-synced to record~ start
p.add("wclock", text=f"phasor~ {WCLOCK_HZ}", col=1, w=140)

p.connect("in_L", 0, "rec_L", 0)
p.connect("in_R", 0, "rec_R", 0)
p.connect("loadbang1", 0, "t_init", 0)
p.connect("t_init", 1, "msg_zero_w", 0)   # right outlet fires first
p.connect("msg_zero_w", 0, "wclock", 1)   # jam phase to 0
p.connect("t_init", 0, "msg_record", 0)
p.connect("msg_record", 0, "rec_L", 0)
p.connect("msg_record", 0, "rec_R", 0)

# ---------------------------------------------------------------
# UI controls
# ---------------------------------------------------------------
p.add("cm_ui", cls="comment", comment_text="=== CONTROLS ===", col=0, w=300)

def live_ui(name, cls, w, h, varname, longname, shortname, pmin=None, pmax=None, initial=None):
    extra = {"varname": varname, "parameter_longname": longname, "parameter_shortname": shortname,
             "numinlets": 1, "numoutlets": 1}
    if pmin is not None:
        extra["parameter_type"] = 0
        extra["parameter_mmin"] = float(pmin)
        extra["parameter_mmax"] = float(pmax)
    if initial is not None:
        extra["parameter_initial_enable"] = 1
        extra["parameter_initial"] = float(initial)
    p.add(name, text=cls, cls=cls, col=0, w=w, h=h, extra=extra)

live_ui("ui_mix", "live.slider", 140, 40, "TG_B_Mix", "Mix (原音->過去)", "Mix", 0.0, 1.0, 0.0)
live_ui("ui_rewind", "live.toggle", 50, 30, "TG_B_Rewind", "Rewind", "Rewind")
live_ui("ui_rwspeed", "live.dial", 90, 90, "TG_B_RewindSpeed", "Rewind Speed", "RwSpd", 0.1, 6.0, 1.0)
live_ui("ui_pitch", "live.dial", 90, 90, "TG_B_Pitch", "Pitch (半音, 微分音可)", "Pitch", -24.0, 24.0, 0.0)
live_ui("ui_loop", "live.button", 50, 30, "TG_B_LoopMark", "Loop Mark (2x click)", "LoopMk")
live_ui("ui_freeze", "live.button", 50, 30, "TG_B_Freeze", "Freeze (stutter at current point)", "Freeze")
live_ui("ui_miracle", "live.toggle", 50, 30, "TG_B_Miracle", "Miracle (cut-up)", "Miracle")
live_ui("ui_mwindow", "live.dial", 90, 90, "TG_B_MiracleWindow", "Miracle History Window (sec)", "MWin", 2.0, 300.0, 45.0)
live_ui("ui_mdensity", "live.dial", 90, 90, "TG_B_MiracleDensity", "Miracle Density", "MDens", 0.0, 1.0, 0.5)

# ---------------------------------------------------------------
# Offset (jump / rewind) engine -> offset_line (signal, in phase units)
# ---------------------------------------------------------------
p.add("cm_offset", cls="comment", comment_text="=== JUMP / REWIND OFFSET (phase units, signal) ===", col=2, w=420)

p.add("offset_line", text="line~", col=2, w=90)

# default: idle Mix crossfades in a short 2s slap-delay until Rewind/Loop/Miracle is used
p.add("msg_default_offset", text=f"{2.0/BUF_SEC} 0", cls="message", col=2, w=110)
p.connect("loadbang1", 0, "msg_default_offset", 0)
p.connect("msg_default_offset", 0, "offset_line", 0)

p.add("rw_metro", text="metro 30", col=2, w=90)
p.connect("ui_rewind", 0, "rw_metro", 0)

p.add("rw_snap", text="snapshot~", col=2, w=90)
p.connect("offset_line", 0, "rw_snap", 0)
p.connect("rw_metro", 0, "rw_snap", 0)

p.add("rw_step", text=f"* {0.03/BUF_SEC}", col=2, w=110)
p.connect("ui_rwspeed", 0, "rw_step", 0)

p.add("rw_sub", text=f"- {0.03/BUF_SEC}", col=2, w=90)
p.connect("rw_snap", 0, "rw_sub", 0)
p.connect("rw_step", 0, "rw_sub", 1)

p.add("rw_pack", text="pack 0. 30", col=2, w=90)
p.connect("rw_sub", 0, "rw_pack", 0)
p.connect("rw_pack", 0, "offset_line", 0)

p.add("scrub_sub", text="-~", col=2, w=90)
p.connect("wclock", 0, "scrub_sub", 0)
p.connect("offset_line", 0, "scrub_sub", 1)
p.add("scrub_wrap", text="wrap~", col=2, w=90)
p.connect("scrub_sub", 0, "scrub_wrap", 0)

# ---------------------------------------------------------------
# Loop engine (also reused by Miracle) -- shared destination objects
# ---------------------------------------------------------------
p.add("cm_loop", cls="comment", comment_text="=== LOOP ENGINE (manual 2-click + Freeze + Miracle share this) ===", col=3, w=460)

p.add("loop_counter", text="counter 0 2", col=3, w=90)
p.connect("ui_loop", 0, "loop_counter", 0)
p.add("loop_sel", text="sel 0 1 2", col=3, w=90)
p.connect("loop_counter", 0, "loop_sel", 0)

# --- state 1: capture loop start, persist it ---
p.add("loop_snap_start", text="snapshot~", col=3, w=90)
p.connect("scrub_wrap", 0, "loop_snap_start", 0)
p.connect("loop_sel", 1, "loop_snap_start", 0)
p.add("val_loopstart_w", text="value tg_b_loopstart", col=3, w=140)
p.connect("loop_snap_start", 0, "val_loopstart_w", 0)

# --- shared engagement targets (fed by manual-click2 / loop-shift / miracle) ---
p.add("loop_len_expr", text="expr ((($f2-$f1)-floor($f2-$f1))<0.001)?0.05:(($f2-$f1)-floor($f2-$f1))", col=3, w=420)
p.add("loop_freq_expr", text=f"expr 1./($f1*{BUF_SEC})", col=3, w=200)
p.connect("loop_len_expr", 0, "loop_freq_expr", 0)

p.add("loop_phasor", text="phasor~ 0.", col=3, w=140)
p.connect("loop_freq_expr", 0, "loop_phasor", 0)
p.add("msg_zero_loop", text="0.", cls="message", col=3, w=50)
p.connect("msg_zero_loop", 0, "loop_phasor", 1)

p.add("loopactive_line", text="line~", col=3, w=90)
p.add("msg_active1", text="1. 15", cls="message", col=3, w=60)
p.connect("msg_active1", 0, "loopactive_line", 0)
p.add("msg_active0", text="0. 15", cls="message", col=3, w=60)
p.connect("loop_sel", 0, "msg_active0", 0)
p.connect("msg_active0", 0, "loopactive_line", 0)

# loopPhase signal = wrap(loopStart + loop_phasor*loopLen); loopStart/loopLen held as cold signal consts
p.add("loopphase_mul", text="*~", col=3, w=90)
p.connect("loop_phasor", 0, "loopphase_mul", 0)
p.add("loopphase_add", text="+~", col=3, w=90)
p.connect("loopphase_mul", 0, "loopphase_add", 0)
p.add("loopphase_wrap", text="wrap~", col=3, w=90)
p.connect("loopphase_add", 0, "loopphase_wrap", 0)
p.connect("loop_len_expr", 0, "loopphase_mul", 1)   # cold: current loop length (phase units)

# --- state 2: capture loop end, compute length in correct order, engage ---
# loop_sel outlet2 (bang) -> snapshot end -> [t b f]: outlet1(f, fires first)=loopEnd -> expr inlet1 + persist
#                                              outlet0(b, fires second) -> read loopStart -> expr inlet0(hot)
p.add("loop_snap_end", text="snapshot~", col=3, w=90)
p.connect("scrub_wrap", 0, "loop_snap_end", 0)
p.connect("loop_sel", 2, "loop_snap_end", 0)

p.add("loop_end_t", text="t b f", col=3, w=70)
p.connect("loop_snap_end", 0, "loop_end_t", 0)

p.add("val_loopend_w", text="value tg_b_loopend", col=3, w=140)
p.connect("loop_end_t", 1, "val_loopend_w", 0)          # outlet1 fires first: persist loopEnd
p.connect("loop_end_t", 1, "loop_len_expr", 1)          # ...and set cold inlet1 (end) first

p.add("val_loopstart_r1", text="value tg_b_loopstart", col=3, w=140)
p.connect("loop_end_t", 0, "val_loopstart_r1", 0)       # outlet0 fires second: read start
p.connect("val_loopstart_r1", 0, "loop_len_expr", 0)    # -> hot inlet0, expr fires now
p.connect("val_loopstart_r1", 0, "loopphase_add", 1)    # cold: loop start (phase units)

p.add("loop_engage_reset_t", text="t b b", col=3, w=70)
p.connect("loop_len_expr", 0, "loop_engage_reset_t", 0)
p.connect("loop_engage_reset_t", 0, "msg_zero_loop", 0)   # reset loop phasor phase
p.connect("loop_engage_reset_t", 1, "msg_active1", 0)     # fade loop in

# ---------------------------------------------------------------
# Freeze button: instantly captures start==end at the CURRENT scrub position and
# engages a tiny stutter-loop there, by driving the same start/end capture points
# the manual 2-click Loop Mark uses (start must land before end, so start fires
# from the trigger's later-firing outlet).
# ---------------------------------------------------------------
p.add("freeze_t", text="t b b", col=4, w=70)
p.connect("ui_freeze", 0, "freeze_t", 0)
p.connect("freeze_t", 1, "loop_snap_start", 0)   # fires first: capture start = now
p.connect("freeze_t", 0, "loop_snap_end", 0)     # fires second: capture end = now, engage

# ---------------------------------------------------------------
# Miracle engine (drives the loop engine with random segments)
# ---------------------------------------------------------------
p.add("cm_miracle", cls="comment", comment_text="=== MIRACLE (random cut-up generator) ===", col=6, w=440)

p.add("mir_onoff_t", text="t 0 1", col=6, w=70)
p.connect("ui_miracle", 0, "mir_onoff_t", 0)
p.add("mir_metro", text="metro 300", col=6, w=90)
p.connect("mir_onoff_t", 0, "mir_metro", 0)
p.connect("mir_onoff_t", 1, "mir_metro", 0)
p.add("msg_mir_active1", text="1. 15", cls="message", col=6, w=60)
p.connect("mir_onoff_t", 1, "msg_mir_active1", 0)
p.connect("msg_mir_active1", 0, "loopactive_line", 0)
p.add("msg_mir_active0", text="0. 15", cls="message", col=6, w=60)
p.connect("mir_onoff_t", 0, "msg_mir_active0", 0)
p.connect("msg_mir_active0", 0, "loopactive_line", 0)

# single fan-out trigger guarantees a fixed evaluation order for everything driven per tick.
# outlets (right to left firing order): rate-update, length-pick, start-pick, then finally the
# "now" snapshot + compute cascade (must be last, since it consumes the freshly picked values).
p.add("mir_tick_t", text="t b b b b", col=6, w=90)
p.connect("mir_metro", 0, "mir_tick_t", 0)

p.add("mir_rate_rand", text="random 500", col=6, w=90)
p.connect("mir_tick_t", 3, "mir_rate_rand", 0)
p.add("mir_rate_add", text="+ 80", col=6, w=90)
p.connect("mir_rate_rand", 0, "mir_rate_add", 0)
p.connect("mir_rate_add", 0, "mir_metro", 1)

p.add("mir_win_int", text="int", col=6, w=60)
p.connect("ui_mwindow", 0, "mir_win_int", 0)
p.add("mir_start_rand", text="random 1", col=6, w=90)
p.connect("mir_tick_t", 2, "mir_start_rand", 0)
p.connect("mir_win_int", 0, "mir_start_rand", 1)

p.add("mir_len_rand", text="random 1000", col=6, w=90)
p.connect("mir_tick_t", 1, "mir_len_rand", 0)
p.add("mir_len_expr", text="expr 0.5+((1.-$f2)*2.5*($f1*0.001))", col=6, w=280)
p.connect("mir_len_rand", 0, "mir_len_expr", 0)
p.connect("ui_mdensity", 0, "mir_len_expr", 1)

p.add("mir_speedmul_rand", text="random 150", col=6, w=90)
p.connect("mir_tick_t", 1, "mir_speedmul_rand", 0)
p.add("mir_speedmul_expr", text="expr 0.5+($f1*0.01)", col=6, w=200)
p.connect("mir_speedmul_rand", 0, "mir_speedmul_expr", 0)

p.add("mir_now_snap", text="snapshot~", col=6, w=90)
p.connect("wclock", 0, "mir_now_snap", 0)
p.connect("mir_tick_t", 0, "mir_now_snap", 0)   # fires LAST: start/len/speed already picked above

p.add("mir_start_expr", text=f"expr $f1-($f2/{BUF_SEC})-floor($f1-($f2/{BUF_SEC}))", col=6, w=340)
p.connect("mir_now_snap", 0, "mir_start_expr", 0)
p.connect("mir_start_rand", 0, "mir_start_expr", 1)

p.add("mir_start_t", text="t f f", col=6, w=70)
p.connect("mir_start_expr", 0, "mir_start_t", 0)
p.add("val_loopstart_wM", text="value tg_b_loopstart", col=6, w=140)
p.connect("mir_start_t", 1, "val_loopstart_wM", 0)
p.connect("mir_start_t", 1, "loopphase_add", 1)

p.add("mir_end_expr", text=f"expr $f1+($f2/{BUF_SEC})-floor($f1+($f2/{BUF_SEC}))", col=6, w=340)
p.connect("mir_start_t", 0, "mir_end_expr", 0)
p.connect("mir_len_expr", 0, "mir_end_expr", 1)

p.add("mir_end_t", text="t b f", col=6, w=70)
p.connect("mir_end_expr", 0, "mir_end_t", 0)
p.add("val_loopend_wM", text="value tg_b_loopend", col=6, w=140)
p.connect("mir_end_t", 1, "val_loopend_wM", 0)
p.connect("mir_end_t", 1, "loop_len_expr", 1)

p.add("mir_start_for_len_t", text="t b f", col=6, w=70)
p.connect("mir_end_t", 0, "mir_start_for_len_t", 0)
# need the ORIGINAL start value again for length calc's hot inlet; grab it back from storage
p.add("val_loopstart_rM", text="value tg_b_loopstart", col=6, w=140)
p.connect("mir_start_for_len_t", 0, "val_loopstart_rM", 0)
p.connect("val_loopstart_rM", 0, "loop_len_expr", 0)

p.add("mir_engage_reset_t", text="t b b", col=6, w=70)
p.connect("val_loopstart_rM", 0, "mir_engage_reset_t", 0)
p.connect("mir_engage_reset_t", 0, "msg_zero_loop", 0)
p.connect("mir_engage_reset_t", 1, "msg_active1", 0)

# extra glitch character: randomize this segment's playback-rate multiplier, applied to the
# loop frequency (control-rate) before it reaches loop_phasor's frequency inlet
p.add("mir_freq_scaled", text="*", col=6, w=90)
p.connect("loop_freq_expr", 0, "mir_freq_scaled", 0)
p.connect("mir_speedmul_expr", 0, "mir_freq_scaled", 1)
p.connect("mir_freq_scaled", 0, "loop_phasor", 0)

# ---------------------------------------------------------------
# Final phase crossfade: scrub vs loop/miracle
# ---------------------------------------------------------------
p.add("cm_final", cls="comment", comment_text="=== READ (wave~) + PITCH + MIX -> OUT ===", col=7, w=420)

p.add("la_inv", text="*~ -1.", col=7, w=90)
p.connect("loopactive_line", 0, "la_inv", 0)
p.add("la_inv2", text="+~ 1.", col=7, w=90)
p.connect("la_inv", 0, "la_inv2", 0)

p.add("dry_scrub_mul", text="*~", col=7, w=90)
p.connect("scrub_wrap", 0, "dry_scrub_mul", 0)
p.connect("la_inv2", 0, "dry_scrub_mul", 1)

p.add("wet_loop_mul", text="*~", col=7, w=90)
p.connect("loopphase_wrap", 0, "wet_loop_mul", 0)
p.connect("loopactive_line", 0, "wet_loop_mul", 1)

p.add("final_phase_add", text="+~", col=7, w=90)
p.connect("dry_scrub_mul", 0, "final_phase_add", 0)
p.connect("wet_loop_mul", 0, "final_phase_add", 1)
p.add("final_phase_wrap", text="wrap~", col=7, w=90)
p.connect("final_phase_add", 0, "final_phase_wrap", 0)

p.add("wave_L", text="wave~ tg_b_buf_L", col=7, w=140)
p.add("wave_R", text="wave~ tg_b_buf_R", col=7, w=140)
p.connect("final_phase_wrap", 0, "wave_L", 0)
p.connect("final_phase_wrap", 0, "wave_R", 0)

p.add("pshift_L", text="pitchshift~", col=7, w=140)
p.add("pshift_R", text="pitchshift~", col=7, w=140)
p.connect("wave_L", 0, "pshift_L", 0)
p.connect("wave_R", 0, "pshift_R", 0)
p.connect("ui_pitch", 0, "pshift_L", 1)
p.connect("ui_pitch", 0, "pshift_R", 1)

p.add("mix_dry_inv", text="*~ -1.", col=7, w=90)
p.connect("ui_mix", 0, "mix_dry_inv", 0)
p.add("mix_dry_inv2", text="+~ 1.", col=7, w=90)
p.connect("mix_dry_inv", 0, "mix_dry_inv2", 0)

p.add("dry_mul_L", text="*~", col=7, w=90)
p.connect("in_L", 0, "dry_mul_L", 0)
p.connect("mix_dry_inv2", 0, "dry_mul_L", 1)
p.add("dry_mul_R", text="*~", col=7, w=90)
p.connect("in_R", 0, "dry_mul_R", 0)
p.connect("mix_dry_inv2", 0, "dry_mul_R", 1)

p.add("wet_mul_L", text="*~", col=7, w=90)
p.connect("pshift_L", 0, "wet_mul_L", 0)
p.connect("ui_mix", 0, "wet_mul_L", 1)
p.add("wet_mul_R", text="*~", col=7, w=90)
p.connect("pshift_R", 0, "wet_mul_R", 0)
p.connect("ui_mix", 0, "wet_mul_R", 1)

p.add("out_mix_L", text="+~", col=7, w=90)
p.connect("dry_mul_L", 0, "out_mix_L", 0)
p.connect("wet_mul_L", 0, "out_mix_L", 1)
p.add("out_mix_R", text="+~", col=7, w=90)
p.connect("dry_mul_R", 0, "out_mix_R", 0)
p.connect("wet_mul_R", 0, "out_mix_R", 1)

p.add("out_L", text="outlet~", cls="newobj", col=7, extra={"numinlets":1,"numoutlets":0})
p.add("out_R", text="outlet~", cls="newobj", col=7, extra={"numinlets":1,"numoutlets":0})
p.connect("out_mix_L", 0, "out_L", 0)
p.connect("out_mix_R", 0, "out_R", 0)

data = p.build()
with open("pattern_b.amxd", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=1)

print("boxes:", len(data["patcher"]["boxes"]))
print("lines:", len(data["patcher"]["lines"]))
