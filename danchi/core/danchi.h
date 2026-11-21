/*
 * 団地 DANCHI — core
 *
 * One FM tone (the "object") is fixed. Every track plays a copy of it.
 * What differs is only where a copy is placed: when (beat, before/after),
 * left/right, how far, in which room, and how close other copies are.
 *
 * Constraints (for a later port to a small device):
 *   - single-precision float only (no double, no libm)
 *   - working RAM: struct dn_state  (budget ~96 KB)
 *   - large buffers: struct dn_big  (budget ~336 KB)
 *   - processes up to DN_BLOCK frames per call, any sample rate ~44.1-48 kHz
 *   - display: 240x240 RGB565, drawn in horizontal bands by dn_draw_rows()
 *
 * The host owns both structs (static allocation is fine) and calls everything
 * from one thread (or queues control events into the audio thread).
 */
#ifndef DANCHI_H
#define DANCHI_H
#include <stdint.h>
#include <stddef.h>

#define DN_BLOCK    256
#define DN_TRACKS   16
#define DN_HITS     8
#define DN_COPIES   4
#define DN_VOICES   32
#define DN_ROOMS    6
#define DN_OPS      8
#define DN_STEPS    16
#define DN_EVQ      256
#define DN_BAREV    128     /* max copies scheduled in one bar */
#define DN_KNOBS    13
#define DN_LANES    13      /* motion lanes, one per knob (the object knob's lane is never used) */
#define DN_MR_SPB   64      /* motion slots per bar */
#define DN_MR_BARS  8
#define DN_ROOMBUF  1112      /* longest room delay (23 ms) at 48 kHz */
#define DN_ECHOBUF  16384     /* echo stored as 16-bit, ~0.37 s */
#define DN_INBUF    49152     /* the input, always recorded while it comes in, ~1.11 s (16-bit ring) */
#define DN_OUTBUF   16384     /* the building's own output at half rate, ~0.74 s (16-bit ring) */
#define DN_OBJBUF   33280     /* a sound that is the object (file / captured / resampled), ~0.75 s */
#define DN_DIFBUF   512
#define DN_HIST     16
#define DN_LOG      8
#define DN_TRAIL    64
#define DN_TAB      1024
#define DN_SCREEN   240

/* borrowing time (see schedule_bar): an early entry becomes debt; the debt is returned by later
 * notes coming late (repay), and at each bar line only DN_SETTLE of it is still owed, so it can
 * never pin at its limit. DN_CREDIT < 1 would also stop borrowing beyond that debt (tried, it
 * suppressed anticipation almost completely; kept as an option). */
#ifndef DN_ACCRUE
#define DN_ACCRUE 1.0f
#endif
#ifndef DN_CREDIT
#define DN_CREDIT 1.0f
#endif
#ifndef DN_SETTLE
#define DN_SETTLE 0.6f
#endif

/* knobs (infinite encoders) */
enum { DN_K_TEMPO, DN_K_ERASE, DN_K_PUSH, DN_K_META, DN_K_ROOM, DN_K_DIST, DN_K_OBJECT,
       /* second page: each belongs to a feature that is switched on and off */
       DN_K_GEN,       /* resample every 1/2/4/8/16 bars                     */
       DN_K_POLY,      /* how far each unit's cycle differs from 16 steps    */
       DN_K_DUCK,      /* how hard the caretaker's beat presses the others   */
       DN_K_FOLLOW,    /* how much the input's loudness moves the wanted state */
       DN_K_RATCHET,   /* how finely long notes are struck again             */
       DN_K_VOL        /* overall volume: -60 dB .. 0 dB at 0.85 .. +3 dB; 0 = silent.
                          applied last: what the building hears and resamples is unaffected */
};
/* effects: a separate layer over every copy (each coloured bar), with a value per unit.
 * value 0 = not on that unit. With the layer off, nothing here is used. */
#define DN_FX 5
enum { DN_FX_GLITCH, DN_FX_DELAY, DN_FX_PITCH, DN_FX_STUTTER, DN_FX_REVERSE };
/* features (on / off) */
enum { DN_F_GEN, DN_F_POLY, DN_F_DUCK, DN_F_FOLLOW, DN_F_RATCHET, DN_F_HOLD, DN_FEATURES };
/* operator kinds */
enum { DN_OP_SWING, DN_OP_STRETCH, DN_OP_ANTIC, DN_OP_YIELD, DN_OP_REPAY,
       DN_OP_ROOM, DN_OP_DIST, DN_OP_STACK, DN_OP_THIN, DN_OP_PAN, DN_OP_KINDS };
/* phases */
enum { DN_PH_KOTAI, DN_PH_GYORETSU, DN_PH_KATAMARI, DN_PH_AKIBEYA, DN_PHASES };
/* buttons */
enum { DN_BTN_TRACK,      /* arg: track 1..15 -> toggle in/out (held by hand)          */
       DN_BTN_KEEPER,     /* arg: 0 auto, 1 always in, 2 always out                     */
       DN_BTN_REC,        /* toggle: motion overdub armed                               */
       DN_BTN_CLEAR,      /* clear recorded motion                                      */
       DN_BTN_LOOP,       /* cycle motion loop length 1/2/4/8 bars                      */
       DN_BTN_OBJECT,     /* apply the object candidate (encoder 7 push)                */
       DN_BTN_UNIT_CLEAR, /* arg: track -> empty that unit and hand it back to auto     */
       DN_BTN_REBUILD,    /* new placements and operators (object unchanged)            */
       DN_BTN_TRACK_AUTO, /* arg: track -> release the hand's hold (auto again)        */
       DN_BTN_SOURCE,     /* arg: DN_SRC_FM or DN_SRC_LIVE (BUF comes from a load or a capture) */
       DN_BTN_CAPTURE,    /* the last moments of the input become the object (same level)  */
       DN_BTN_RESAMPLE,   /* what the building sounds like right now becomes the object     */
       DN_BTN_FEATURE,    /* arg: DN_F_* -> switch that feature on / off                  */
       DN_BTN_FX_LAYER,   /* the whole effect layer on / off                                 */
       DN_BTN_FX_TOGGLE,  /* arg: DN_FX_* -> check / uncheck that effect                     */
       DN_BTN_FX_DICE,    /* arg: DN_FX_*, or -1 for every checked effect: new values per unit */
       DN_BTN_FX_AUTO     /* arg: roll the dice every N bars (0 = only by hand)              */
};
/* where a fixed sound came from */
enum { DN_FROM_NONE, DN_FROM_FILE, DN_FROM_INPUT, DN_FROM_OUTPUT };
/* where the object comes from */
enum { DN_SRC_FM,       /* the FM tone                                                     */
       DN_SRC_BUF,      /* a fixed sound: part of a file, or input that was captured         */
       DN_SRC_LIVE      /* the input itself: every copy plays the input as it was one beat
                           before its place on the grid, so a copy's offset from the grid is
                           heard as a different delay of the live sound                      */
};
/* log entry types */
enum { DN_LG_NONE, DN_LG_ACT, DN_LG_BORN, DN_LG_DIED, DN_LG_PHASE, DN_LG_REWARD };

/* ---- view: a flat float array the UI/display reads (indices are stable) ---- */
#define V_BAR        0
#define V_POS        1
#define V_TEMPO      2
#define V_PHASE      3
#define V_PH_LEFT    4
#define V_PH_LEN     5
#define V_KEEPER     6
#define V_VACANT     7
#define V_M_ERASE    8
#define V_M_PUSH     9
#define V_T_ERASE    10
#define V_T_PUSH     11
#define V_C_CONTOUR  12
#define V_C_DENS     13
#define V_C_FLAM     14
#define V_C_INTERF   15
#define V_C_MONO     16
#define V_C_EARLY    17
#define V_C_LATE     18
#define V_C_ONSETS   19
#define V_K0         20   /* 7 knob values, normalized 0..1 (tempo too) */
#define V_SEED       27
#define V_SEED_CAND  28
#define V_MR_ARMED   29
#define V_MR_LOOP    30
#define V_MR_LANES   31
#define V_MR_POS     32
#define V_MR_GEST    33
#define V_PEAK       34
#define V_GR         35
#define V_VOICES     36
#define V_EVENTS     37
#define V_QUIET      38
#define V_URGENCY    39
#define V_OBJ_F0     40
#define V_OBJ_RATIO  41
#define V_OBJ_I0     42
#define V_OBJ_DEC    43
#define V_KEEPER_MODE 44
#define V_HANDSTOP   45   /* 1 if the hand turned every unit off */
#define V_PH_TILT_E  46
#define V_PH_TILT_P  47
#define V_CAND_F0    48
#define V_CAND_RATIO 49
#define V_SOUNDING   50
#define V_STEPLEN_MS 51
#define V_C_COMB     52
#define V_FLAMS      53
#define V_SRC        54
#define V_SAMP_LEN   55   /* seconds */
#define V_IN_PEAK    56
#define V_LIVE_DELAY 57   /* ms */
#define V_SRC_NOTE   58   /* 0, 1 captured, 2 too quiet to capture, 3 loaded, 4 resampled */
#define V_K7         59   /* knobs 7..11 (second page), normalized 0..1 */
#define V_FEAT       64   /* bit mask of features that are on */
#define V_GENS       65   /* how many times the object was resampled */
#define V_CAP_LEN    66   /* seconds taken by capture / resample */
#define V_OBJ_FROM   67
#define V_IN_LVL     68   /* input loudness 0..1 (what "follow" uses) */
#define V_DUCK       69   /* the caretaker's press right now 0..1 */
#define V_GEN_LEFT   70   /* bars until the next automatic resample */
#define V_FX_LAYER   71
#define V_FX_MASK    72   /* bit per checked effect */
#define V_FX_AUTO    73   /* roll every N bars (0 = by hand) */
#define V_FX_ROLLS   74   /* how many times the dice were rolled */
#define V_VOL        75   /* the volume knob 0..1 */
#define V_VOL_DB     76   /* the volume in dB (-99 = silent) */

#define V_TRACK0     80
#define V_TS         65   /* per-track stride */
#define T_ON         0
#define T_HAND       1    /* 0 auto, 1 held in by hand, 2 held out by hand */
#define T_KEEP       2
#define T_ROOM       3
#define T_PAN        4
#define T_DIST       5
#define T_SWING      6
#define T_STRETCH    7
#define T_LEAN       8
#define T_REPAY      9
#define T_DEBT       10
#define T_NHIT       11
#define T_FLASH      12
#define T_DORMANT    13
#define T_PUSHED     14   /* how much it was pushed in the last bar (steps, signed) */
#define T_LASTOP     15   /* bars since an operator last touched this track */
#define T_CYCLE      16   /* its cycle in steps (16 unless units have their own cycles) */
#define T_HIT0       20   /* per hit 5 floats: step, copies, offset(steps from grid), cause track (-1),
                             step in the bar where it last sounded (-1 if not this bar) */
#define T_HS         5
#define T_FX0        60   /* 5 effect values for this unit (0 = off) */

#define V_OPS0       (V_TRACK0 + DN_TRACKS * V_TS)
#define V_OS         12
#define O_KIND       0
#define O_TRACK      1
#define O_ENERGY     2
#define O_PERIOD     3
#define O_GENE       4
#define O_AGE        5
#define O_REWARD     6
#define O_SINCE      7    /* bars since it last acted (999 = never) */
#define O_BORN       8    /* bars since birth */
#define O_ID         9
#define O_PENDING    10
#define O_WAIT       11

#define V_LOG0       (V_OPS0 + DN_OPS * V_OS)
#define V_LS         6
#define L_TYPE       0
#define L_KIND       1
#define L_TRACK      2
#define L_VALUE      3
#define L_BAR        4
#define L_ID         5

#define V_TRAIL0     (V_LOG0 + DN_LOG * V_LS)
#define V_N          (V_TRAIL0 + DN_TRAIL * 2)

/* ------------------------------------------------------------------ */
typedef struct {
    float f0, ratio, i0, is, ti, att, dec, sus, rel, fb, gain;
    uint32_t seed;
} dn_obj;

typedef struct {
    uint8_t step, copies;
    int8_t  micro;        /* 1/64 step, from where the hand placed it */
    int8_t  cause;        /* track whose stretched note pushed it (-1 none) */
    float   spread;       /* ms between stacked copies */
    float   off;          /* last realized offset from the grid step (steps) */
    int8_t  bstep;        /* where in the bar it last sounded (-1: not in the last planned bar) */
} dn_hit;

typedef struct {
    uint8_t on, hand, keeper, room, nhit, dormant;
    float pan, dist, swing, stretch, lean, repay, debt;
    dn_hit hit[DN_HITS];
    float n_start, n_end;  /* last primary note (steps, relative to the bar being scheduled) */
    uint8_t n_cross;       /* that note crosses a beat line */
    float cur_off, pushed;
    int32_t last_op_bar;
    uint8_t cycle;         /* steps in its own cycle (16 = the bar) */
    /* dsp */
    float lp1, lp2, ds, ps, flash;
} dn_track;

typedef struct {
    uint8_t active, track, stage, keeper, src, pad[3];
    uint32_t pos;          /* read index: in the object (BUF) or the input ring (LIVE) */
    int32_t left;          /* samples left in the sound (BUF) */
    /* effect layer (fx = 0: the plain paths above are used, unchanged) */
    uint8_t fx, rev;
    float rate, fpos, fstart, held, pj, swell, swinc, i0, is;
    int32_t slice, slc, hold, hcnt, glen, gcnt, sfade, fend;
    uint32_t vr;
    float phc, phm, incc, incm, amp, idx, prev;
    float amp_t, amp_c, att_inc, idx_t, idx_c, rel_c, fb, gain;
    int32_t delay, gate;
    uint32_t born;
} dn_voice;
#define DN_SPILL 4   /* extra slots where stolen voices fade out quickly */

typedef struct {
    uint32_t t, gate;
    int32_t devs;         /* realized - grid, in samples */
    float dev;            /* realized - grid (steps) */
    float gain;           /* 1, or less for an echo of the delay effect */
    uint8_t track, used, keeper;
    int8_t cause;
} dn_event;

typedef struct {
    uint8_t kind, track, period, phase_off, pending, wait;
    uint16_t counter;
    float gene, energy, reward, merit;
    int32_t age, act_bar, born_bar, acts;
    float d_before, te, tp;
    uint32_t id;
} dn_op;

typedef struct {
    int16_t type, kind, track, id;
    float value; int32_t bar;
} dn_logent;

typedef struct dn_big {
    float room[DN_ROOMS][3][DN_ROOMBUF];
    int16_t echo[2][DN_ECHOBUF];
    int16_t inr[DN_INBUF];     /* the input, a ring */
    int16_t outr[DN_OUTBUF];   /* the output at half rate, a ring */
    int16_t obj[DN_OBJBUF];    /* the fixed sound that is the object */
} dn_big;

typedef struct dn_state {
    float sr, isr;
    uint32_t rng;
    uint32_t now;
    dn_obj obj;
    uint32_t seed_cand;
    dn_obj cand;

    float knob[DN_KNOBS];      /* the value the hand / motion playback sets (0..1) */
    float keff[DN_KNOBS];      /* smoothed value the sound uses */
    float sintab[DN_TAB + 2];

    dn_track tr[DN_TRACKS];
    dn_voice vo[DN_VOICES + DN_SPILL];
    dn_event ev[DN_EVQ];
    int keeper_mode;           /* 0 auto (phase decides), 1 in, 2 out */
    int hand_stop;             /* the hand turned the last unit off: stay quiet until it turns one on */
    /* source of the object */
    int src, src_note, seg_valid, obj_from, gens;
    uint32_t seg_len, in_have, in_w, out_w, out_have;
    float samp_gain, in_peak, live_delay, cap_len;
    float out_lp[2];          /* decimation filter for the output ring */
    /* features */
    uint32_t feat;
    int32_t last_gen_bar, sched_bar;
    float duck, duck_tg, duck_env[DN_BLOCK];
    float vol_g;               /* the volume gain at the end of the last block */
    int pend_kind, pend_wait;
    /* effect layer */
    int fx_layer, fx_auto;
    uint32_t fx_mask, fx_rolls, fx_rng;   /* the dice have their own stream: the layer off changes nothing */
    int32_t fx_last_roll;
    float fxv[DN_FX][DN_TRACKS];
    float in_sq, in_sq_n, in_lvl;
    int keeper_on;

    /* clock */
    uint32_t cur_start, cur_len, nxt_start, nxt_len;
    float cur_step, nxt_step;
    int nxt_ready;
    int32_t bar;

    /* listening accumulators (one bar) */
    uint32_t a_on, a_flam, a_comb, a_dev_n, last_onset, have_onset;
    float a_early, a_late;
    float a_rise, a_ov, a_if, a_ifw, a_LL, a_RR, a_LR;
    uint32_t a_rise_n, a_ov_n, a_hist_n;
    uint16_t a_hist[32];
    float env_f;
    int env_cnt; float env_max;
    struct { float before, peak; int32_t frames; } pend[8];
    int npend;
    float f_contour, f_dens, f_flam, f_if, f_mono, f_early, f_late, f_comb;
    float r_valley, r_rise, r_ov, r_corr, r_if;   /* raw listening values */
    uint32_t f_onsets, f_flams;

    /* measured state */
    float h_e[DN_HIST], h_p[DN_HIST];
    int h_n;
    float m_e, m_p, t_e, t_p, urgency;
    float trail[DN_TRAIL][2];
    int trail_n;

    /* operators */
    dn_op op[DN_OPS];
    int quiet;
    uint32_t op_ids;
    dn_logent log[DN_LOG];
    int log_n;

    /* phases */
    int phase, ph_left, ph_len, vacant_room;

    /* motion recorder */
    uint16_t lane[DN_LANES][DN_MR_SPB * DN_MR_BARS];
    uint16_t lane_has, gest_lanes;
    int mr_armed, mr_loop, gesture;
    int32_t last_slot[DN_LANES];
    uint32_t hand_idle;
    float hand_speed;

    /* keyboard */
    int8_t key_voice[DN_TRACKS];
    uint32_t key_t0[DN_TRACKS], key_born[DN_TRACKS];

    /* dsp */
    float tbuf[DN_BLOCK], osum[DN_BLOCK];
    float dryL[DN_BLOCK], dryR[DN_BLOCK], echL[DN_BLOCK], echR[DN_BLOCK];
    float rin[DN_ROOMS][DN_BLOCK];
    float dif[2][DN_DIFBUF];
    int difw;
    int rw;
    float rlpA[DN_ROOMS], rlpB[DN_ROOMS];
    int ew;
    float edel, elp[2];
    float dcx[2], dcy[2];
    float lim_env, lim_g, peak, peak_hold, density_g;
    int nvoices;
    uint32_t voice_born;
    dn_big *big;

    float view[V_N];
} dn_state;

/* ---- API ---- */
void dn_init(dn_state *s, dn_big *b, float sr, uint32_t seed);
void dn_process(dn_state *s, float *L, float *R, int n);   /* n <= DN_BLOCK */
void dn_process_in(dn_state *s, const float *in, float *L, float *R, int n);  /* with mono input (may be NULL) */
int16_t *dn_sample_area(dn_state *s);                       /* the host writes mono 16-bit here ...   */
void dn_sample_commit(dn_state *s, int n);                  /* ... then commits n samples as the object */
void dn_encoder(dn_state *s, int knob, int detents);
void dn_key(dn_state *s, int unit, int down);               /* unit 0..15 (0 = caretaker) */
void dn_button(dn_state *s, int btn, int arg);
void dn_set_knob(dn_state *s, int knob, float v01);          /* for tests / presets */
void dn_fx_set(dn_state *s, int fx, int unit, float v01);    /* one effect value of one unit (0 = off there) */
const float *dn_view(dn_state *s);
void dn_draw_rows(const dn_state *s, uint16_t *rgb565, int y0, int nrows);  /* rows y0..y0+nrows-1, 240 px wide */

/* helpers shared with the display */
float dn_tempo_bpm(const dn_state *s);
int dn_gen_bars(const dn_state *s);
float dn_vol_db(float v01);                                  /* -99 means silent */
extern const char *const dn_op_code[DN_OP_KINDS];
extern const char *const dn_room_code[DN_ROOMS];
extern const char *const dn_phase_code[DN_PHASES];

#endif
