/* RENDO (連動): RUTEN rebuilt as a modular system. Everything is linked to everything through cables that the system
 * keeps re-patching, so a change in one place sets off changes elsewhere, which set off others.
 * Sources (11): LFO A, LFO B (a golden ratio slower), TURING (a 16-step looping shift register whose bits flip with
 * CHAOS: a loop that slowly mutates), CHAOS (the logistic map, a bar at a time), DRIFT (a random walk), FOLLOW (how
 * loud it is), ENV 1-4 (each track's strikes, decaying), PRESS (the hardest key pressure: the hand is a source too).
 * Destinations (43): for each track its DENSITY (below 0 notes fall out, above 0 ghost notes come in), DECAY, TONE,
 * PITCH, SEND (to the echo), PUSH (early or late against the beat: the ragtime lean), SPEED (its clock); STEP n (a rising
 * edge clocks track n one step: one track driving another) and RESET n; and TEMPO, CHORD, FBACK, RATE A, RATE B, the
 * TURING's flips, DRUMS. Seven cables at a time. Operators (RUTEN's population, with three more kinds: PATCH moves a
 * cable's ends, DEPTH turns a cable, EUCLID spreads a track's notes evenly and turns them) re-patch while it plays.
 * Touch: white keys 1-8 are momentary effects on the whole sound, deeper as they are pressed, combined when held
 * together: LOOP (the last beat, shorter as pressed), STUT (a stutter, faster as pressed), PITCH (a pitch-shifted delay,
 * up or down with the pressure), HARM (a momentary harmony: two shifted copies at intervals of the field), REV (the
 * last moments backwards), CRUSH, FREEZE (a grain held), TAPE (a tape stop). White keys 9-15 are the cables: a tap
 * re-patches that one, held it is turned up; white 16 turns every cable up while held. With GESTURE on (black 10), a
 * fast spin of any knob stutters and a wiggle loops.
 * Knobs: SELECT TEMPO, ALGO MOD (how far all the cables move things: 0 is still, high is everything breathing), PRESET
 * DENS, K1 CHAOS (one turn from order to wildness: what it is after, how fast the operators live and die, how often the
 * TURING flips, how chaotic the CHAOS source is), K2 DRUMS (the drums' sound from round to metal), K3 CHORD, K4 FBACK.
 * GLO held: the patch page (the knobs turn the seven cables' depths; the screen shows the sources moving). FX: GEN, as
 * HENKA's (held: its page and the operators). Black keys 1-4 strike and choose a track, 5 FILL, 6-9 rolls, 11 XMOD.
 * ARP ENV SEQ LFO tracks in and out, SEL thin (held: clear), SAVE keep (held: back), OCT half / double time. */
#include "par.h"
#include "fmvox.h"

const char PJ_NAME[] = "RENDO";

enum { C_ALW, C_P, C_AB, C_NAB, C_PRE, C_NPRE, C_NEI, C_NNEI, C_1ST, C_N1ST, C_FILL, C_NFILL };
typedef struct { uint8_t type, a, b; const char *name; } cond_t;
static const cond_t COND[] = {
    {C_ALW, 0, 0, "ALWAYS"}, {C_P, 10, 0, "10%"}, {C_P, 25, 0, "25%"}, {C_P, 50, 0, "50%"}, {C_P, 75, 0, "75%"},
    {C_P, 90, 0, "90%"}, {C_AB, 1, 2, "1:2"}, {C_AB, 2, 2, "2:2"}, {C_AB, 1, 3, "1:3"}, {C_AB, 2, 3, "2:3"},
    {C_AB, 3, 3, "3:3"}, {C_AB, 1, 4, "1:4"}, {C_AB, 4, 4, "4:4"}, {C_AB, 1, 5, "1:5"}, {C_AB, 3, 7, "3:7"},
    {C_NAB, 1, 2, "!1:2"}, {C_NAB, 1, 3, "!1:3"}, {C_NAB, 2, 5, "!2:5"}, {C_PRE, 0, 0, "PRE"}, {C_NPRE, 0, 0, "!PRE"},
    {C_NEI, 0, 0, "NEI"}, {C_NNEI, 0, 0, "!NEI"}, {C_1ST, 0, 0, "1ST"}, {C_N1ST, 0, 0, "!1ST"},
    {C_FILL, 0, 0, "FILL"}, {C_NFILL, 0, 0, "!FILL"},
};
#define NCOND ((int)(sizeof COND / sizeof COND[0]))

#define NT 4
#define NS 16
static const float RATES[] = {0.25f, 0.3333333f, 0.5f, 0.6666667f, 0.75f, 1.0f, 1.3333333f, 1.5f, 2.0f, 3.0f, 4.0f};
static const char *const RATE_NAME[] = {"1/4", "1/3", "1/2", "2/3", "3/4", "1", "4/3", "3/2", "2", "3", "4"};
#define NRATE 11
#define RATE_ONE 5

/* GEN's acts: what a travelling effect does to the note it sits on */
enum { A_RAT = 1, A_NOTE = 2, A_CHORD = 4, A_ECHO = 8, A_STUT = 16, A_CRUSH = 32, A_SWEEP = 64, A_CUT = 128,
       A_SWAP = 256, NACT = 9 };
static const uint16_t ACT_COL[NACT] = {C_VAL, C_HOT, C_GRN, C_CYN, C_RED, C_LAB, C_VAL2, C_DIMC, RGB565(150, 210, 90)};
/* SWAP: the note sounds with another place of the bank, of its own family */
static const uint8_t SWAP_DRUM[] = {0, 1, 2, 4, 5, 6, 7, 8, 27, 23, 26, 20, 21};   /* KICK SNARE HAT OHAT TOM RIM
                                                                                      COWBEL CYMBAL ZAP CHAOS DIGI
                                                                                      METAL GLASS */
#define NSWAP_DRUM 13
/* the regimes: the acts' weights (RAT NOTE CHORD ECHO STUT CRUSH SWEEP CUT SWAP), the tracks' weights, the echo (in steps)
 * and its feedback, how fast the density moves, each track's density shift, how many effects travel (times TOKENS),
 * and which tracks start again at each bar of the meter */
typedef struct {
    const char *name;
    float w[NACT], trk[4], echo_steps, echo_fb;
    float churn;
    float dens[4];
    float ntok;
    uint8_t follow;
    float tempo;                         /* the regime leans the tempo (times the one set) */
    uint8_t max_bars;                    /* how long it may last at most */
} regime_t;
static const regime_t RG[] = {
    {"PULSE", {0.40f, 0.10f, 0.00f, 0.10f, 0.05f, 0.20f, 0.05f, 0.25f, 0.30f}, {1.0f, 1.0f, 1.0f, 0.5f}, 0.75f, 0.35f,
     0.4f, {0.06f, 0.0f, 0.12f, 0.0f}, 1.0f, 0x5, 1.0f, 24},
    {"SONG", {0.05f, 0.40f, 0.30f, 0.15f, 0.00f, 0.00f, 0.05f, 0.10f, 0.15f}, {0.2f, 0.3f, 0.3f, 1.0f}, 1.5f, 0.5f,
     0.7f, {0.0f, -0.04f, -0.05f, 0.35f}, 1.2f, 0x1, 0.94f, 24},
    {"BREAK", {0.25f, 0.05f, 0.00f, 0.05f, 0.30f, 0.20f, 0.00f, 0.25f, 0.35f}, {1.0f, 1.0f, 0.8f, 0.6f}, 0.333f, 0.3f,
     1.6f, {0.12f, 0.15f, 0.05f, 0.05f}, 1.6f, 0xF, 1.06f, 16},
    {"DRIFT", {0.00f, 0.30f, 0.15f, 0.30f, 0.00f, 0.00f, 0.25f, 0.05f, 0.20f}, {0.3f, 0.4f, 0.4f, 1.0f}, 2.0f, 0.65f,
     0.35f, {-0.04f, 0.0f, -0.08f, 0.2f}, 0.8f, 0x0, 0.82f, 24},
    {"VOID", {0.00f, 0.20f, 0.10f, 0.50f, 0.00f, 0.00f, 0.10f, 0.10f, 0.15f}, {0.5f, 0.5f, 0.5f, 0.5f}, 3.0f, 0.7f,
     0.25f, {-0.12f, -0.1f, -0.15f, 0.0f}, 0.4f, 0x1, 0.9f, 3},
};
/* ---- the operators: ways of changing, as a population ---- */
enum { O_ADD, O_SLIDE, O_LOCK, O_RATE, O_LEN, O_NUDGE, O_ROT, O_COND, O_FLOOR, O_SCAT, O_CHORD, O_BEND, O_TOKEN,
       O_MORPH, O_COUPLE, O_METER, O_PATCH, O_DEPTH, O_EUCLID, NOPK };
static const char *const OP_NAME[NOPK] = {"ADD", "SLIDE", "LOCK", "RATE", "LEN", "NUDGE", "ROT", "COND", "FLOOR",
                                          "SCAT", "CHORD", "BEND", "TOKEN", "MORPH", "COUPL", "METER", "PATCH",
                                          "DEPTH", "EUCLD"};
/* each kind's lean: + toward repetition (the floor), - toward difference */
static const float OP_ORDER[NOPK] = {0.15f, -0.5f, -0.15f, -0.8f, -0.7f, -0.35f, -0.6f, -0.45f, 1.0f, -1.0f, -0.05f,
                                     0.05f, -0.3f, -0.1f, -0.5f, -0.9f, -0.55f, -0.2f, 0.35f};

/* ---- the modular part ---- */
enum { S_LFOA, S_LFOB, S_TURING, S_CHAOS, S_DRIFT, S_FOLLOW, S_ENV1, S_ENV2, S_ENV3, S_ENV4, S_PRESS, NSRC };
static const char *const SRC_NAME[NSRC] = {"LFO A", "LFO B", "TURING", "CHAOS", "DRIFT", "FOLLOW", "ENV 1", "ENV 2",
                                           "ENV 3", "ENV 4", "PRESS"};
static const char *const SRC_SHORT[NSRC] = {"LA", "LB", "TM", "CH", "DR", "FO", "E1", "E2", "E3", "E4", "PR"};
enum { D_DENS, D_DECAY, D_TONE, D_PITCH, D_SEND, D_PUSH, D_SPEED, NDT };
static const char *const DT_NAME[NDT] = {"DENS", "DECAY", "TONE", "PITCH", "SEND", "PUSH", "SPEED"};
#define D_STEP0 (NT * NDT)               /* a rising edge clocks track n a step */
#define D_RESET0 (D_STEP0 + NT)          /* ... or sends it back to its first step */
enum { G_TEMPO = D_RESET0 + NT, G_CHORDX, G_FBACK, G_RATEA, G_RATEB, G_TURING, G_DRUMS, NDEST };
static const char *const G_NAME[NDEST - G_TEMPO] = {"TEMPO", "CHORD", "FBACK", "RATE A", "RATE B", "TURING", "DRUMS"};
typedef struct {
    uint8_t src, dst, hi;
    float depth;
} cable_t;
#define NCAB 7
/* the drums' other places (DRUMS turns toward them): kick toward ZAP, clap toward RIM, hats toward METAL */
static const uint8_t DRUM_TO[3] = {27, 6, 20};

/* ---- touch: momentary effects on the whole sound ---- */
enum { T_LOOP, T_STUT, T_PITCH, T_HARM, T_REV, T_CRUSH, T_FREEZE, T_TAPE, NTOUCH };
static const char *const TOUCH_NAME[NTOUCH] = {"LOOP", "STUT", "PITCH", "HARM", "REV", "CRUSH", "FREEZE", "TAPE"};
#define TB_N 32768u                      /* 0.74 s of the sound, stereo, 16 bits: what LOOP STUT REV FREEZE read */
#define PS_N 16384u                      /* the shifters' memory, mono: PITCH HARM TAPE */
static int16_t tb_l[TB_N] MZ_POOL, tb_r[TB_N] MZ_POOL;
static int16_t ps_buf[PS_N] MZ_POOL;
typedef struct {
    uint8_t on, kind, k, period, phase;
    float energy;
    uint16_t age, acts;
} oper_t;
#define NOP 8
/* the floor: where each track's steps are, house-wise (bit s = step s of 16) */
static const uint16_t FLOOR_MASK[4] = {0x1111u, 0x1010u, 0x4444u, 0x0488u};   /* kick 1-2-3-4, clap 2 and 4, open
                                                                                * hats between, stabs off the beat */
/* the chords: deep-house voicings in just intonation (ratios to the root), the places they start from and drift off */
static const float ANCHOR[4][4] = {{1.0f, 1.2f, 1.8f, 2.25f},        /* minor 9th, no fifth: 1 6/5 9/5 9/4 */
                                   {1.0f, 1.25f, 1.875f, 2.25f},     /* major 7th 9th: 1 5/4 15/8 9/4 */
                                   {1.0f, 1.3333333f, 1.7777778f, 2.25f},   /* eleventh, sus: 1 4/3 16/9 9/4 */
                                   {1.0f, 1.25f, 1.75f, 2.25f}};     /* harmonic seventh: 1 5/4 7/4 9/4 */
static const char *const ANCHOR_NAME[4] = {"M9", "MAJ9", "11", "H7"};
/* the regimes lean on ORDER: PULSE toward the floor, BREAK and DRIFT away */
static const float RG_ORDER[5] = {0.25f, 0.1f, -0.25f, -0.3f, 0.05f};

/* a travelling effect: it sits on a note for LIFE plays, then waits for the next note its HOP rule lets it take; it
 * may turn into another effect when it moves, and when two meet one of them does */
typedef struct {
    uint8_t on, wait, type, k, s, life, skip, from, note, rat, left_now, alt;
} tok_t;
#define NTOK 12
static const char *const HOP_NAME[] = {"NEXT", "ANY", "SKIP 1", "SKIP 2", "COUNT", "SAME"};
enum { H_NEXT, H_ANY, H_SKIP1, H_SKIP2, H_COUNT, H_SAME, NHOP };
/* the meter: OFF, AUTO (it changes with the regimes), or a fixed one; bars in sixteenths */
static const uint8_t METERS[][4] = {{0}, {0}, {16, 0}, {7, 9, 0}, {5, 6, 5, 0}, {11, 13, 0}, {6, 7, 0},
                                    {9, 7, 5, 0}, {3, 5, 7, 0}, {13, 0}};
static const char *const METER_NAME[] = {"OFF", "AUTO", "16", "7+9", "5+6+5", "11+13", "6+7", "9+7+5", "3+5+7",
                                         "13"};
#define NMETER 10
static const char *const REG_LOCK_NAME[] = {"AUTO", "PULSE", "SONG", "BREAK", "DRIFT", "VOID"};
#define NREG 5
#define NFIELD 7
#define NNOTE (NFIELD * 3)              /* three octaves of the field */
/* the places the synth track drifts toward (pitched ones) */
static const uint8_t MORPH[] = {VB_SYNTH, 10, 11, 12, 13, 14, 17, 18, 21, 25, 26, 20};   /* EPIANO BELL MARIMB BASS
                                                                                          BRASS PLUCK REED GLASS VOX
                                                                                          DIGI METAL */
#define NMORPH 12
#define ECHO_N 16384u                    /* 0.37 s, mono, 16 bits */
#define STUT_N 8192u                     /* 0.19 s of the mix, stereo, 16 bits */
static int16_t echo_buf[ECHO_N] MZ_POOL;
static int16_t stut_l[STUT_N] MZ_POOL, stut_r[STUT_N] MZ_POOL;
typedef struct {
    uint8_t kind, on, dest, len;
    float p[NVP];                        /* the voice's numbers: the bases */
    uint8_t trig[NS], has[NS], cond[NS];
    float val[NS];
    float lfo_depth, density;
    uint8_t rate_i;                      /* the track's rate against the tempo (RATES) */
    uint8_t nudge[NS];                   /* how late a step plays, in sixteenths of a step (0..10) */
    float tone, dec_x;                   /* K1 / K2: brightness added, decay multiplied */
    int8_t tmom;                         /* the time's momentum (nudges grow one way until a wall) */
    uint32_t loops;
    uint8_t last_true;
    float momentum;
    int8_t flash_step;
    uint32_t flash_until;
} trk_t;

static struct {
    trk_t t[NT];
    float tempo, mut, time;
    float tempo_w;                       /* the tempo's breath (TIME), a multiplier near 1 */
    float tempo_r;                       /* the regime's lean on it (GEN), glided */
    uint8_t fill_held, fill_next, frozen;
    volatile uint32_t home_req;
    uint32_t plot_rev, seed;
    int pos[NT];
    float energy;
    /* the hand playing */
    volatile uint32_t live_req[NT];
    float live_vel[NT], live_bright[NT], ratchet_hz[NT];
    /* GEN */
    uint8_t gen, burst, regime, morph;
    uint16_t dwell;                      /* loops of track 1 left in the regime */
    float lx;                            /* the logistic map at Feigenbaum's point */
    uint8_t field[NFIELD];               /* harmonic numbers: the notes' ratios */
    uint8_t walk[NT];                    /* each track's place in the notes (a contour, not a choice) */
    uint32_t regime_rev;
    tok_t tok[NTOK];                     /* the travelling effects */
    uint8_t ntok, life, hop, regime_lock, meter_mode;   /* FX held: GEN's page */
    float couple, shift;
    uint8_t meter[4], meter_n;           /* the bars now (sixteenths) */
    int8_t cm[NT][NT];                   /* who pulls (+1) or pushes (-1) whose steps when it sounds */
    uint8_t hopc;
    /* RENDO: the cables and the macros */
    cable_t cab[NCAB];
    float mod_amt, chaos, drums;
    float src_v[NSRC];                   /* the sources now (the render's; the screen reads them) */
    float dm[NDEST];                     /* each destination's modulation now */
    uint32_t cab_rev;
    uint8_t gesture;
    float cab_boost[NCAB], boost_all;    /* the hand holding a cable (white 9-15) or all of them (white 16) */
    float touch[NTOUCH];                 /* each touch effect's depth now (0: off) */
    float press;
    /* RUTEN: the operators, what it is after and what it hears, the chord, the no-input layer */
    oper_t op[NOP];
    float order, meta, chordx, dens_g, tone_g, ni_amt;
    float rep, rep_t, dens_m;
    uint32_t bar_n, op_rev;
    float root, cv[4];
    uint8_t anchor, bend_n;
    float bend;
    /* SAVE: a moment kept */
    uint8_t has_snap;
    trk_t snap[NT];
    float snap_tempo;
} sh;

static struct {
    int trk;
    int held_step;
    uint32_t held_t, hot[HW_NENC], sel_t, save_t;
    uint8_t held_pressed, sel_done, save_done;
    uint32_t fx_t;
    uint8_t fx_burst, fx_knob, fx_page, fx_was;
    uint32_t zero_t;
    /* RENDO */
    uint32_t glo_t, cab_t[NCAB], seed;
    uint8_t glo_knob, patch_page, patch_was;
    float pad[NTOUCH];
} ui;

static const uint8_t WHITE[16] = {0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24, 26};
static const uint8_t BLACK[11] = {1, 3, 5, 8, 10, 13, 15, 17, 20, 22, 25};
static const uint8_t TRK_BTN[NT] = {HB_ARP, HB_ENV, HB_SEQ, HB_LFO};
static const float PAN[NT] = {0.0f, -0.35f, 0.4f, -0.15f};

static struct {
    uint32_t home_seen, live_seen[NT];
    vox_t v[NT];
    vox_k_t kk[NT];
    float lock[NT];                      /* the destination's value this step (a lock, else the base) */
    uint8_t locked[NT];
    float phase;
    float lfo_ph[NT], rat_ph[NT], vel_gain[NT];
    float ph[NT];                        /* each track's step clock */
    uint32_t pend[NT];                   /* a nudged trig: samples until it plays */
    float pend_gain[NT];
    pink_t breath;
    uint32_t breath_n;
    /* the step's acts, carried to the strike (which a nudge can make late) */
    uint16_t pact[NT];
    uint8_t pnote[NT], prat[NT], palt[NT], swap[NT];
    float sps[NT];                       /* samples per step of each track now */
    float note_r[NT];                    /* the pitch ratio of the note playing (1: the track's own) */
    uint8_t rat_left[NT], crush[NT], crush_c[NT];
    uint32_t rat_int[NT], rat_cnt[NT];
    float rat_gain[NT], send[NT], crush_y[NT];
    int8_t swp[NT];
    uint8_t note_now[NT];
    /* the chord's two voices */
    vox_t hv[2];
    vox_k_t hk[2];
    float h_lvl[2];
    int h_trk;
    /* the echo and the stutter */
    uint32_t ew, sw, s_start, s_len, s_pos, s_left, echo_d;
    float e_lp, e_lp2;
    uint32_t rseed;
    float lvl[NT], spsec, bar_ph;
    float base_ph;                       /* the meter's clock: sixteenths of the tempo */
    uint32_t meter_pos, mi;
    uint8_t cut[NT];
    /* RUTEN */
    uint16_t mask_cur[NT], mask_prev[NT];   /* each track's onsets this bar and the last (sixteenths) */
    float bend_now;
    vox_t cv3[3];                        /* the chord's other three voices */
    vox_k_t ck3[3];
    float c_lvl;
    uint32_t ni_ph, ni_inc, ni_d, ni_t;
    float ni_y, ni_g, ni_lvl, ni_rough, ni_aim, ni_f;
    uint8_t ni_open;
    float ni_amt_now;
    /* RENDO's sources */
    float lfo_a, lfo_b, chaos_x, chaos_v, drift, follow, env[NT];
    uint16_t tm_reg;
    float speed[NT], send_m[NT];
    /* touch */
    uint32_t tw, pw;                     /* write heads */
    uint8_t tb_hold;                     /* a slice is being read: the writing pauses */
    uint32_t sl_start, sl_len, sl_pos, sl_count;
    float sl_rpos;
    float ps_d[4], tape_r, tcr_y[2];    /* the four shifters' delays (PITCH, HARM a, HARM b, TAPE); TAPE's speed */
    uint32_t tcr_c;
    float t_was[NTOUCH], fade;
    int8_t slice_mode, slice_last;       /* which slice is read (LOOP STUT REV FREEZE; -1 none) */
    float pg, hg;                        /* PITCH's and HARM's gains (with a tail after letting go) */
} st;

static float vp_clamp(int d, float x) { return m_clamp(x, VP_LO[d], VP_HI[d]); }

static void trk_kind(trk_t *T, int kind)
{
    int d;
    T->kind = (uint8_t)kind;
    for (d = 0; d < NVP; d++)
        T->p[d] = VB_POINT[kind][d];
}

static void trk_clear(trk_t *T)
{
    int s;
    for (s = 0; s < NS; s++) {
        T->trig[s] = T->has[s] = T->cond[s] = 0;
        T->nudge[s] = 0;
        T->val[s] = T->p[T->dest];
    }
}

static void trk_reset(trk_t *T, int kind, uint8_t dest, uint8_t len, float density)
{
    trk_kind(T, kind);
    T->on = 1;
    T->dest = dest;
    T->len = len;
    T->lfo_depth = 0.0f;
    T->density = density;
    T->rate_i = RATE_ONE;
    T->tone = 0.0f;
    T->dec_x = 1.0f;
    T->tmom = 1;
    trk_clear(T);
    T->loops = 0;
    T->last_true = 1;
    T->momentum = 1.0f;
    T->flash_step = -1;
}

/* n notes spread as evenly as a track's length allows, turned by rot (a Euclidean rhythm) */
static void euclid(trk_t *T, int n, int rot)
{
    int s, len = T->len;
    for (s = 0; s < len; s++) {
        T->trig[s] = T->has[s] = T->cond[s] = 0;
        T->nudge[s] = 0;
    }
    if (n > len)
        n = len;
    for (s = 0; s < n; s++)
        T->trig[((s * len) / n + rot) % len] = 1;
}

static void defaults(void)
{
    int s0;
    /* it starts on the floor: four kicks, open hats between, one stab; the clap comes later, if it comes */
    trk_reset(&sh.t[0], VB_KICK, VP_DEC, 16, 0.25f);
    trk_reset(&sh.t[1], VB_SNARE, VP_NOISE, 16, 0.12f);
    trk_reset(&sh.t[2], 4 /* OHAT */, VP_DEC, 16, 0.25f);
    trk_reset(&sh.t[3], 10 /* EPIANO */, VP_INDEX, 16, 0.19f);
    for (s0 = 0; s0 < 16; s0 += 4)      /* a kick on the four; a clap on two and four; hats 7 in 16; stabs 3 in 16 */
        sh.t[0].trig[s0] = 1;
    sh.t[1].trig[4] = sh.t[1].trig[12] = 1;
    euclid(&sh.t[2], 7, 1);
    euclid(&sh.t[3], 3, 3);
    sh.t[2].dec_x = 0.6f;
    sh.t[3].dec_x = 0.45f;
    sh.tempo = 122.0f;
    sh.mut = 0.0f;                       /* (HENKA's own changes are the operators' here) */
    sh.time = 0.15f;
    sh.tempo_w = 1.0f;
    sh.tempo_r = 1.0f;
    sh.frozen = 0;
    /* GEN: off until FX; the field starts as harmonics 4..10 without 8 (a seventh and a ninth among them) */
    sh.gen = 0;
    sh.burst = 0;
    sh.regime = 0;                       /* PULSE first: the floor */
    sh.dwell = 6;
    sh.lx = 0.3f + 0.4f * m_rnd(&sh.seed);
    sh.morph = VB_SYNTH;
    {
        static const uint8_t F0[NFIELD] = {8, 9, 11, 12, 13, 7, 15};   /* folded: 1 9/8 11/8 3/2 13/8 7/4 15/8 */
        int i;
        for (i = 0; i < NFIELD; i++)
            sh.field[i] = F0[i];
        for (i = 0; i < NT; i++)
            sh.walk[i] = (uint8_t)(NFIELD + (i == 3 ? 0 : 2));
    }
    {
        static const int8_t CM0[NT][NT] = {{0, 0, 1, 1}, {0, 0, -1, 0}, {0, 1, 0, 1}, {1, -1, 0, 0}};
        int i, j;
        for (i = 0; i < NTOK; i++)
            sh.tok[i].on = 0;
        for (i = 0; i < NT; i++)
            for (j = 0; j < NT; j++)
                sh.cm[i][j] = CM0[i][j];
    }
    sh.ntok = 3;
    sh.life = 6;
    sh.hop = H_NEXT;
    sh.regime_lock = 0;
    sh.meter_mode = 1;
    sh.couple = 0.2f;
    sh.shift = 0.3f;
    sh.meter[0] = 16;
    sh.meter_n = 1;                      /* four-four until a METER operator says otherwise */
    sh.hopc = 0;
    {                                    /* the first operators: two on the floor, the rest ways of moving off it */
        static const uint8_t K0[NOP][3] = {{O_EUCLID, 2, 4}, {O_PATCH, 0, 6}, {O_DEPTH, 0, 3}, {O_FLOOR, 0, 4},
                                           {O_CHORD, 3, 4}, {O_SLIDE, 1, 3}, {O_MORPH, 2, 5}, {O_ADD, 3, 2}};
        int i, j;
        for (i = 0; i < NOP; i++) {
            sh.op[i].on = 1;
            sh.op[i].kind = K0[i][0];
            sh.op[i].k = K0[i][1];
            sh.op[i].period = K0[i][2];
            sh.op[i].phase = (uint8_t)i;
            sh.op[i].energy = 0.5f;
            sh.op[i].age = sh.op[i].acts = 0;
        }
        sh.root = 1.0f;
        sh.anchor = 0;
        for (j = 0; j < 4; j++)
            sh.cv[j] = ANCHOR[0][j];
    }
    sh.order = 0.6f;
    sh.meta = 0.5f;
    sh.chordx = 0.3f;
    sh.dens_g = 1.0f;
    sh.tone_g = 0.0f;
    sh.ni_amt = 0.05f;
    sh.mod_amt = 0.8f;
    sh.chaos = 0.35f;
    sh.drums = 0.0f;
    sh.gesture = 1;
    {                                    /* the first patch: each cable a link that sets something else moving */
        static const uint8_t C0[NCAB][2] = {
            {S_LFOA, 2 * NDT + D_DENS},      /* the hats breathe in and out */
            {S_TURING, 0 * NDT + D_PITCH},   /* the kick's pitch follows a looping register */
            {S_ENV1, 3 * NDT + D_TONE},      /* each kick darkens the chords (a pump) */
            {S_CHAOS, 1 * NDT + D_PUSH},     /* the clap leans early or late, chaotically */
            {S_ENV2, D_STEP0 + 3},           /* each clap clocks the chords a step: one track driving another */
            {S_FOLLOW, G_RATEA},             /* louder, LFO A runs faster */
            {S_LFOB, 2 * NDT + D_SPEED}};    /* the hats' clock wavers */
        static const float DEP0[NCAB] = {0.8f, 0.5f, -0.7f, 0.7f, 1.0f, 0.6f, 0.4f};
        int c;
        for (c = 0; c < NCAB; c++) {
            sh.cab[c].src = C0[c][0];
            sh.cab[c].dst = C0[c][1];
            sh.cab[c].depth = DEP0[c];
            sh.cab[c].hi = 0;
            sh.cab_boost[c] = 0.0f;
        }
        sh.boost_all = 0.0f;
        for (c = 0; c < NTOUCH; c++)
            sh.touch[c] = 0.0f;
        for (c = 0; c < NDEST; c++)
            sh.dm[c] = 0.0f;
        sh.cab_rev++;
    }
    sh.rep = 1.0f;
    sh.rep_t = 0.6f;
    sh.bend = 0.0f;
    sh.bend_n = 0;
    sh.op_rev++;
    sh.regime_rev++;
}

/* the tracks follow their slots (EDIT's voice page, ALGO): a new kind puts the track's numbers at that kind's place;
 * an empty slot falls back to slot 1, so one source can play all four tracks */
static uint32_t slot_seen = 0xFFFFFFFFu;
static void follow_slots(void)
{
    static const uint8_t OWN[NT] = {VB_KICK, VB_SNARE, 4 /* OHAT */, 10 /* EPIANO */};
    int k;
    if (mz_slot_rev() == slot_seen)
        return;
    slot_seen = mz_slot_rev();
    for (k = 0; k < NT; k++) {
        const mz_slot_t *v = mz_voice(k);
        int kind = v ? v->src - 1 : OWN[k];
        if (kind != sh.t[k].kind)
            trk_kind(&sh.t[k], kind);
    }
    sh.plot_rev++;
}

void pj_init(uint32_t seed)
{
    sh.seed = seed | 1u;
    mz_slot_set(0, 1 + VB_KICK);         /* ruten starts with four sources; empty a slot and it plays slot 1's */
    mz_slot_set(1, 1 + VB_SNARE);
    mz_slot_set(2, 1 + 4);               /* OHAT */
    mz_slot_set(3, 1 + 10);              /* EPIANO: the chords */
    slot_seen = mz_slot_rev();
    defaults();
    ui.held_step = -1;
    pj_reset_audio();
}

void pj_home(void)
{
    int k;
    defaults();
    for (k = 0; k < NT; k++) {           /* the sources stay as chosen */
        const mz_slot_t *v = mz_voice(k);
        if (v)
            trk_kind(&sh.t[k], v->src - 1);
    }
    sh.home_req++;
    sh.plot_rev++;
}

void pj_reset_audio(void)
{
    int k;
    for (k = 0; k < NT; k++) {
        vox_reset(&st.v[k]);
        sh.pos[k] = -1;
        st.locked[k] = 0;
        st.lfo_ph[k] = st.rat_ph[k] = 0.0f;
        st.vel_gain[k] = 1.0f;
        st.live_seen[k] = sh.live_req[k];
        st.ph[k] = 0.999f;
        st.pend[k] = 0;
    }
    st.phase = 0.999f;
    for (k = 0; k < NT; k++) {
        st.pact[k] = st.rat_left[k] = st.crush[k] = st.crush_c[k] = 0;
        st.pnote[k] = 0;
        st.note_r[k] = 1.0f;
        st.send[k] = st.crush_y[k] = 0.0f;
        st.swp[k] = 0;
        st.sps[k] = 5000.0f;
    }
    vox_reset(&st.hv[0]);
    vox_reset(&st.hv[1]);
    st.h_trk = 3;
    {
        uint32_t i;
        for (i = 0; i < ECHO_N; i++)
            echo_buf[i] = 0;
        for (i = 0; i < STUT_N; i++)
            stut_l[i] = stut_r[i] = 0;
    }
    st.ew = st.sw = st.s_left = 0;
    st.base_ph = 0.999f;
    st.meter_pos = 0;
    st.mi = 0;
    for (k = 0; k < NT; k++)
        st.mask_cur[k] = st.mask_prev[k] = 0;
    st.bend_now = 0.0f;
    for (k = 0; k < 3; k++)
        vox_reset(&st.cv3[k]);
    st.ni_ph = 0;
    st.ni_y = st.ni_lvl = st.ni_rough = 0.0f;
    st.ni_g = 0.3f;
    st.ni_aim = 0.08f;
    st.ni_f = 220.0f;
    st.ni_open = 0;
    st.ni_t = 44100u;
    st.ni_d = 9000u;
    st.lfo_a = st.lfo_b = 0.0f;
    st.chaos_x = 0.37f;
    st.chaos_v = st.drift = st.follow = 0.0f;
    st.tm_reg = (uint16_t)(sh.seed & 0xFFFFu) | 1u;
    for (k = 0; k < NT; k++) {
        st.env[k] = 0.0f;
        st.speed[k] = 1.0f;
        st.send_m[k] = 0.0f;
    }
    {
        uint32_t i;
        for (i = 0; i < TB_N; i++)
            tb_l[i] = tb_r[i] = 0;
        for (i = 0; i < PS_N; i++)
            ps_buf[i] = 0;
    }
    st.tw = st.pw = 0;
    st.tb_hold = 0;
    st.sl_len = st.sl_pos = st.sl_count = 0;
    st.sl_rpos = 0.0f;
    st.ps_d[0] = st.ps_d[1] = st.ps_d[2] = st.ps_d[3] = 1500.0f;
    st.tape_r = 1.0f;
    st.tcr_y[0] = st.tcr_y[1] = 0.0f;
    st.tcr_c = 0;
    for (k = 0; k < NTOUCH; k++)
        st.t_was[k] = 0.0f;
    st.fade = 0.0f;
    st.slice_mode = st.slice_last = -1;
    st.pg = st.hg = 0.0f;
    for (k = 0; k < NT; k++)
        st.cut[k] = 0;
    st.e_lp = st.e_lp2 = 0.0f;
    st.rseed = sh.seed ^ 0x5EEDu;
}

/* ---- conditions, steps, change ---- */
static int cond_eval(int k, int c)
{
    const cond_t *q = &COND[c];
    trk_t *T = &sh.t[k];
    int r = 1;
    switch (q->type) {
    case C_ALW: r = 1; break;
    case C_P: r = m_rnd(&sh.seed) * 100.0f < (float)q->a; break;
    case C_AB: r = (int)(T->loops % q->b) == q->a - 1; break;
    case C_NAB: r = (int)(T->loops % q->b) != q->a - 1; break;
    case C_PRE: r = T->last_true; break;
    case C_NPRE: r = !T->last_true; break;
    case C_NEI: r = sh.t[(k + NT - 1) % NT].last_true; break;
    case C_NNEI: r = !sh.t[(k + NT - 1) % NT].last_true; break;
    case C_1ST: r = T->loops == 0; break;
    case C_N1ST: r = T->loops != 0; break;
    case C_FILL: r = sh.fill_held || sh.fill_next; break;
    case C_NFILL: r = !(sh.fill_held || sh.fill_next); break;
    }
    if (q->type != C_ALW)                /* PRE and NEI follow conditions, as on the Digitakt */
        T->last_true = (uint8_t)r;
    return r;
}

static int trig_count(const trk_t *T)
{
    int s, n = 0;
    for (s = 0; s < T->len; s++)
        n += T->trig[s];
    return n;
}

/* a step of the track with (want 1) or without (want 0) a trig, from a random place; -1 none */
static int pick(const trk_t *T, int want)
{
    int s = (int)(m_rnd(&sh.seed) * (float)T->len) % T->len, tries;
    for (tries = 0; tries < T->len; tries++, s = (s + 1) % T->len)
        if (T->trig[s] == want)
            return s;
    return -1;
}

static float fold(int h)
{
    float r = (float)h;
    while (r >= 2.0f)
        r *= 0.5f;
    return r;
}

/* the field in rising order within its octave, so a step through the notes is a step up or down */
static void field_sort(void)
{
    int i, j;
    for (i = 1; i < NFIELD; i++)
        for (j = i; j > 0 && fold(sh.field[j]) < fold(sh.field[j - 1]); j--) {
            uint8_t t = sh.field[j];
            sh.field[j] = sh.field[j - 1];
            sh.field[j - 1] = t;
        }
}

/* note n as a ratio to the track's own pitch: harmonic field[n % 7] folded into an octave, in octave n / 7 - 1 */
static float note_ratio(int n)
{
    int o;
    if (n < 0)
        n = 0;
    if (n >= NNOTE)
        n = NNOTE - 1;
    o = n / NFIELD - 1;
    return fold(sh.field[n % NFIELD]) * (o < 0 ? 0.5f : o > 0 ? 2.0f : 1.0f);
}

/* one harmonic of the field moves by one or two (never onto another one's place in the octave) */
static void field_move(void)
{
    int i = (int)(m_rnd(&sh.seed) * (float)NFIELD) % NFIELD, tries;
    for (tries = 0; tries < 8; tries++) {
        int h = (int)sh.field[i] + (m_rnd(&sh.seed) < 0.5f ? -1 : 1) * (m_rnd(&sh.seed) < 0.3f ? 2 : 1), j, dup = 0;
        if (h < 5 || h > 31)
            continue;
        for (j = 0; j < NFIELD; j++)
            if (j != i && m_abs(fold(sh.field[j]) - fold(h)) < 0.02f)
                dup = 1;
        if (!dup) {
            sh.field[i] = (uint8_t)h;
            break;
        }
    }
    field_sort();
}

/* the period-doubling sequence: the logistic map at Feigenbaum's point, read as left or right of its top */
static int pd_bit(void)
{
    sh.lx = 3.5699456f * sh.lx * (1.0f - sh.lx);
    if (!(sh.lx > 0.001f && sh.lx < 0.999f))
        sh.lx = 0.3712f;
    return sh.lx > 0.5f;
}

static void new_regime(void)
{
    int jump = 1 + 2 * pd_bit() + pd_bit();   /* 1..4: never the same one twice */
    float u = m_max(0.002f, m_rnd(&sh.seed));
    sh.regime = sh.regime_lock ? (uint8_t)(sh.regime_lock - 1) : (uint8_t)((sh.regime + jump) % NREG);
    sh.dwell = (uint16_t)m_clampi(1 + (int)(1.5f * m_exp2(-m_log2(u) * (1.0f / 1.2f))), 1, RG[sh.regime].max_bars);
    field_move();
    sh.morph = MORPH[(int)(m_rnd(&sh.seed) * (float)NMORPH) % NMORPH];
    sh.regime_rev++;
    sh.plot_rev++;
}

/* the next note of track k: its contour moves by a small step, mostly, now and then a leap */
static uint8_t next_note(int k)
{
    static const int8_t STEP[8] = {1, -1, 2, -2, 1, -1, 3, -4};
    int w = (int)sh.walk[k] + STEP[(int)(m_rnd(&sh.seed) * 8.0f) & 7];
    if (w < 0)
        w = -w;
    if (w >= NNOTE)
        w = 2 * (NNOTE - 1) - w;
    sh.walk[k] = (uint8_t)m_clampi(w, 0, NNOTE - 1);
    return sh.walk[k];
}

/* ---- the travelling effects ---- */
static uint8_t tok_pick(int k, int not_type)
{
    const regime_t *R = &RG[sh.regime];
    float w[NACT], tot = 0.0f, x;
    int i;
    for (i = 0; i < NACT; i++) {
        w[i] = i == not_type ? 0.0f : R->w[i];
        if (k < 3 && (i == 1 || i == 2))   /* drums take pitches less, chords hardly */
            w[i] *= i == 2 ? 0.15f : 0.5f;
        tot += w[i];
    }
    if (tot <= 0.0f)
        return (uint8_t)(not_type == 0 ? 3 : 0);
    x = m_rnd(&sh.seed) * tot;
    for (i = 0; i < NACT - 1 && x >= w[i]; i++)
        x -= w[i];
    return (uint8_t)i;
}

static int tok_target(void)
{
    if (sh.burst)
        return NTOK;
    return m_clampi((int)((float)sh.ntok * RG[sh.regime].ntok + 0.5f), 0, NTOK);
}

static int tok_active(void)
{
    int i, n = 0;
    for (i = 0; i < NTOK; i++)
        n += sh.tok[i].on;
    return n;
}

/* how many notes a leaving effect lets pass (its HOP rule) */
static uint8_t hop_skip(void)
{
    switch (sh.hop) {
    case H_SKIP1: return 1;
    case H_SKIP2: return 2;
    case H_COUNT: sh.hopc = (uint8_t)((sh.hopc + 1u) % 5u); return sh.hopc;   /* 1 2 3 4 0 1 ...: a cycle of distances */
    default: return 0;
    }
}

/* how many plays it stays: one in five only once (a passing touch), else between half of LIFE and LIFE: long enough
 * to be heard as part of the pattern before it moves on */
static uint8_t life_pick(void)
{
    if (sh.life <= 1 || m_rnd(&sh.seed) < 0.2f)
        return 1;
    return (uint8_t)m_clampi((sh.life + 1) / 2 + (int)(m_rnd(&sh.seed) * (float)(sh.life / 2 + 1)), 1, sh.life);
}

static void tok_take(tok_t *t, int k, int p)
{
    static const uint8_t RATS[6] = {2, 3, 3, 4, 5, 7};
    t->wait = 0;
    t->k = (uint8_t)k;
    t->s = (uint8_t)p;
    t->life = life_pick();
    if (t->type == 1 || t->type == 2)
        t->note = next_note(k);
    if (t->type == 0)
        t->rat = RATS[(int)(m_rnd(&sh.seed) * 6.0f) % 6];
    if (t->type == 8) {                  /* SWAP: another sound of the family, never its own */
        int tries;
        for (tries = 0; tries < 6; tries++) {
            t->alt = k < 3 ? SWAP_DRUM[(int)(m_rnd(&sh.seed) * (float)NSWAP_DRUM) % NSWAP_DRUM]
                           : MORPH[(int)(m_rnd(&sh.seed) * (float)NMORPH) % NMORPH];
            if (t->alt != sh.t[k].kind)
                break;
        }
    }
    sh.t[k].flash_step = (int8_t)p;      /* where an effect lands flashes */
    sh.t[k].flash_until = hw_ms() + 250u;
}

static void tok_leave(tok_t *t, int k)
{
    if (tok_active() > tok_target()) {  /* more than the regime wants: this one goes */
        t->on = 0;
        return;
    }
    t->wait = 1;
    t->from = (uint8_t)k;
    t->skip = hop_skip();
    t->left_now = 1;
    if (m_rnd(&sh.seed) < sh.shift)     /* moving, it may become another effect */
        t->type = tok_pick(k, t->type);
}

/* a note of track k at step p sounds: the effects on it act, use a life, and leave; waiting ones may take it; a new
 * one may start waiting. Returns the acts on this note (and its pitch and ratchet) */
static uint16_t on_onset(int k, int p, uint8_t *note, uint8_t *rat, uint8_t *alt)
{
    uint16_t acts = 0;
    int i;
    *note = 0;
    *rat = 2;
    *alt = 0;
    if (!sh.gen)
        return 0;
    for (i = 0; i < NTOK; i++)
        sh.tok[i].left_now = 0;
    for (i = 0; i < NTOK; i++) {         /* the effects sitting here */
        tok_t *t = &sh.tok[i];
        if (!t->on || t->wait || t->k != k || t->s != p)
            continue;
        acts |= (uint16_t)(1u << t->type);
        if (t->type == 1 || t->type == 2)
            *note = t->note;
        if (t->type == 0)
            *rat = t->rat;
        if (t->type == 8)
            *alt = t->alt;
        if (t->life)
            t->life--;
        if (!t->life)
            tok_leave(t, k);
    }
    for (i = 0; i < NTOK; i++) {         /* the waiting ones: is this note theirs? */
        tok_t *t = &sh.tok[i];
        if (!t->on || !t->wait || t->left_now)
            continue;
        if ((sh.hop == H_NEXT || sh.hop == H_COUNT || sh.hop == H_SKIP1 || sh.hop == H_SKIP2) && k == t->from)
            continue;                    /* another track's note */
        if (sh.hop == H_SAME && k != t->from)
            continue;
        if (t->skip) {
            t->skip--;
            continue;
        }
        if (acts >> t->type & 1u)        /* two meet: this one becomes something else */
            t->type = tok_pick(k, t->type);
        tok_take(t, k, p);
        acts |= (uint16_t)(1u << t->type);
        if (t->type == 1 || t->type == 2)
            *note = t->note;
        if (t->type == 0)
            *rat = t->rat;
        if (t->type == 8)
            *alt = t->alt;
        if (--t->life == 0)              /* it acted now: one play used */
            tok_leave(t, k);
    }
    if (tok_active() < tok_target()) {   /* a new one waits for the next note */
        for (i = 0; i < NTOK; i++)
            if (!sh.tok[i].on) {
                tok_t *t = &sh.tok[i];
                t->on = 1;
                t->wait = 1;
                t->from = (uint8_t)k;
                t->skip = 0;
                t->left_now = 1;
                t->type = tok_pick((k + 1) % NT, -1);
                break;
            }
    }
    return acts;
}

/* the track's loop came round: effects on steps that no longer sound (no trig, beyond the length) move on */
static void tok_tidy(int k)
{
    trk_t *T = &sh.t[k];
    int i;
    for (i = 0; i < NTOK; i++) {
        tok_t *t = &sh.tok[i];
        if (t->on && !t->wait && t->k == k && (t->s >= T->len || !T->trig[t->s] || !T->on))
            tok_leave(t, k);
    }
}

/* GEN at a step of track k: the regime's density, quickly (sections differ, they do not average) */
static void gen_step(int k)
{
    trk_t *T = &sh.t[k];
    const regime_t *R = &RG[sh.regime];
    float rate = (0.05f + 0.45f * sh.mut + 0.3f * sh.energy) * R->trk[k] * R->churn * (sh.burst ? 6.0f : 1.0f);
    int n, s, want;
    if (m_rnd(&sh.seed) >= m_min(1.0f, rate))
        return;
    n = trig_count(T);
    want = (int)(m_clamp(T->density + R->dens[k], 0.0f, 1.0f) * (float)T->len + 0.5f);
    if (n < want && m_rnd(&sh.seed) < 0.6f && (s = pick(T, 0)) >= 0) {
        T->trig[s] = 1;
        T->cond[s] = 0;
    } else if (n > want + 1 && m_rnd(&sh.seed) < 0.4f && (s = pick(T, 1)) >= 0) {
        T->trig[s] = T->has[s] = 0;
    } else {
        return;
    }
    T->flash_step = (int8_t)s;
    T->flash_until = hw_ms() + 400u;
}

/* the synth track (4) drifts toward the regime's place in the bank: its timbre, not its pitch or its length */
static void morph_step(void)
{
    static const uint8_t DIMS[] = {VP_RATIO, VP_INDEX, VP_IDEC, VP_FB, VP_NOISE, VP_METAL, VP_NRATIO, VP_NFB, VP_ATT};
    trk_t *T = &sh.t[3];
    int i;
    for (i = 0; i < (int)sizeof DIMS; i++) {
        int d = DIMS[i];
        T->p[d] = vp_clamp(d, T->p[d] + (VB_POINT[sh.morph][d] - T->p[d]) * 0.12f);
    }
}

/* ---- the operators ---- */
static int pop16(uint16_t x)
{
    int n = 0;
    while (x) {
        n += (int)(x & 1u);
        x >>= 1;
    }
    return n;
}

static float fold_range(float r, float lo, float hi)
{
    while (r < lo)
        r *= 2.0f;
    while (r >= hi)
        r *= 0.5f;
    return r;
}

static void flash(trk_t *T, int s)
{
    T->flash_step = (int8_t)s;
    T->flash_until = hw_ms() + 300u;
}

/* a destination for a cable: mostly one of a track's, sometimes a link (STEP / RESET), sometimes a global one */
static uint8_t pick_dst(uint32_t *seed)
{
    float r = m_rnd(seed);
    int k = (int)(m_rnd(seed) * (float)NT) % NT;
    if (r < 0.7f)
        return (uint8_t)(k * NDT + (int)(m_rnd(seed) * (float)NDT) % NDT);
    if (r < 0.85f)
        return (uint8_t)((m_rnd(seed) < 0.7f ? D_STEP0 : D_RESET0) + k);
    return (uint8_t)(G_TEMPO + (int)(m_rnd(seed) * (float)(NDEST - G_TEMPO)) % (NDEST - G_TEMPO));
}

static void dst_cat(char *v, int d)
{
    if (d < D_STEP0) {
        mz_cat(v, DT_NAME[d % NDT]);
        mz_int(v, d / NDT + 1);
    } else if (d < D_RESET0) {
        mz_cat(v, "STEP");
        mz_int(v, d - D_STEP0 + 1);
    } else if (d < G_TEMPO) {
        mz_cat(v, "RESET");
        mz_int(v, d - D_RESET0 + 1);
    } else {
        mz_cat(v, G_NAME[d - G_TEMPO]);
    }
}

/* toward the floor: the rate to 1, the length to 16 (the meter to four-four), then one step: off the floor goes,
 * on it comes, a nudge or a condition straightens. Nothing to do on the floor already */
static void op_floor(int k)
{
    trk_t *T = &sh.t[k];
    uint16_t m = FLOOR_MASK[k];
    int i, s, o = (int)(m_rnd(&sh.seed) * 16.0f) & 15;
    if (T->rate_i != RATE_ONE) {
        T->rate_i = (uint8_t)(T->rate_i + (T->rate_i < RATE_ONE ? 1 : -1));
        return;
    }
    if (T->len != 16) {
        T->len = (uint8_t)(T->len + (T->len < 16 ? 1 : -1));
        return;
    }
    if (k == 0 && (sh.meter_n != 1 || sh.meter[0] != 16)) {
        sh.meter_n = 1;
        sh.meter[0] = 16;
        return;
    }
    for (i = 0; i < 16; i++)
        if (s = (i + o) & 15, T->trig[s] && !(m >> s & 1u)) {
            T->trig[s] = T->has[s] = 0;
            flash(T, s);
            return;
        }
    for (i = 0; i < 16; i++)
        if (s = (i + o) & 15, !T->trig[s] && (m >> s & 1u)) {
            T->trig[s] = 1;
            T->cond[s] = 0;
            T->nudge[s] = 0;
            flash(T, s);
            return;
        }
    for (i = 0; i < 16; i++)
        if (s = (i + o) & 15, T->trig[s] && (T->nudge[s] || T->cond[s])) {
            T->nudge[s] = 0;
            T->cond[s] = 0;
            return;
        }
}

/* away from the floor: a step of it moves off by one, the rate leaves 1, a step off it appears, or a nudge grows */
static void op_scat(int k)
{
    trk_t *T = &sh.t[k];
    uint16_t m = FLOOR_MASK[k];
    float r = m_rnd(&sh.seed);
    int i, s, o = (int)(m_rnd(&sh.seed) * 16.0f) & 15;
    if (r < 0.4f) {
        for (i = 0; i < T->len; i++)
            if (s = (i + o) % T->len, T->trig[s] && (m >> s & 1u)) {
                int t = (s + (m_rnd(&sh.seed) < 0.5f ? 1 : T->len - 1)) % T->len;
                if (!T->trig[t]) {
                    T->trig[t] = 1;
                    T->cond[t] = T->cond[s];
                    T->trig[s] = T->has[s] = 0;
                    flash(T, t);
                }
                return;
            }
    } else if (r < 0.6f) {
        T->rate_i = (uint8_t)m_clampi((int)T->rate_i + (T->rate_i >= RATE_ONE ? 1 : -1) * (m_rnd(&sh.seed) < 0.5f ? 1 : -1),
                                      1, NRATE - 2);
        if (T->rate_i == RATE_ONE)
            T->rate_i = RATE_ONE + 1;
    } else if (r < 0.8f) {
        for (i = 0; i < T->len; i++)
            if (s = (i + o) % T->len, !T->trig[s] && !(m >> s & 1u)) {
                T->trig[s] = 1;
                flash(T, s);
                return;
            }
    } else if ((s = pick(T, 1)) >= 0) {
        T->nudge[s] = (uint8_t)m_clampi(T->nudge[s] + 2 + (int)(m_rnd(&sh.seed) * 3.0f), 0, 10);
    }
}

static void rot_track(int k, int dir)
{
    trk_t *T = &sh.t[k];
    trk_t c = *T;
    int i, from;
    if (T->len < 2)
        return;
    for (i = 0; i < T->len; i++) {
        from = ((i - dir) % T->len + T->len) % T->len;
        T->trig[i] = c.trig[from];
        T->has[i] = c.has[from];
        T->cond[i] = c.cond[from];
        T->nudge[i] = c.nudge[from];
        T->val[i] = c.val[from];
    }
    for (i = 0; i < NTOK; i++)
        if (sh.tok[i].on && !sh.tok[i].wait && sh.tok[i].k == k)
            sh.tok[i].s = (uint8_t)(((int)sh.tok[i].s + dir + T->len) % T->len);
}

/* the chord: back to a deep-house voicing, the root by a consonant step, or (as CHORD allows) a voice or the root
 * off to the side by a small odd ratio */
static void chord_move(void)
{
    static const float ROOT_MOVE[8] = {1.3333333f, 0.75f, 1.5f, 0.6666667f, 1.2f, 0.8333333f, 1.125f, 0.8888889f};
    static const float ODD[10] = {1.05f, 0.952381f, 1.0714286f, 0.9333333f, 1.0285714f, 0.9722222f, 1.1428571f, 0.875f,
                                  1.1f, 0.9090909f};   /* 21/20 20/21 15/14 14/15 36/35 35/36 8/7 7/8 11/10 10/11 */
    static const float ODD_ROOT[4] = {1.1666667f, 0.8571429f, 1.375f, 0.7272727f};   /* 7/6 6/7 11/8 8/11 */
    float r = m_rnd(&sh.seed), x = m_clamp(sh.chordx + sh.dm[G_CHORDX], 0.0f, 1.0f);
    int j;
    if (r < 0.5f * (1.0f - x)) {
        sh.anchor = (uint8_t)(((sh.anchor & 3u) + 1u + (uint32_t)(m_rnd(&sh.seed) * 3.0f)) % 4u);
        for (j = 0; j < 4; j++)
            sh.cv[j] = ANCHOR[sh.anchor][j];
    } else if (r < 0.5f) {
        sh.root = fold_range(sh.root * ROOT_MOVE[(int)(m_rnd(&sh.seed) * 8.0f) & 7], 0.75f, 1.5f);
    } else if (r < 0.5f + 0.5f * x) {
        j = 1 + (int)(m_rnd(&sh.seed) * 3.0f) % 3;
        sh.cv[j] = m_clamp(sh.cv[j] * ODD[(int)(m_rnd(&sh.seed) * 10.0f) % 10], 1.02f, 3.2f);
        sh.anchor |= 0x80u;              /* (off the voicing: the screen shows ~) */
    } else {
        sh.root = fold_range(sh.root * ODD_ROOT[(int)(m_rnd(&sh.seed) * 4.0f) & 3], 0.75f, 1.5f);
    }
}

/* one operator acts once */
static void op_act(oper_t *o)
{
    int k = o->k, s;
    trk_t *T = &sh.t[k];
    switch (o->kind) {
    case O_ADD: {
        int n = trig_count(T),
            want = (int)(m_clamp(T->density * sh.dens_g + RG[sh.regime].dens[k], 0.0f, 1.0f) * (float)T->len + 0.5f);
        if (n < want && (s = pick(T, 0)) >= 0) {
            T->trig[s] = 1;
            flash(T, s);
        } else if (n > want && (s = pick(T, 1)) >= 0) {
            T->trig[s] = T->has[s] = 0;
        }
        break;
    }
    case O_SLIDE:
        if ((s = pick(T, 1)) >= 0) {
            int t = (s + (m_rnd(&sh.seed) < 0.5f ? 1 : T->len - 1)) % T->len;
            if (!T->trig[t]) {
                T->trig[t] = 1;
                T->has[t] = T->has[s];
                T->val[t] = T->val[s];
                T->cond[t] = T->cond[s];
                T->trig[s] = T->has[s] = 0;
                flash(T, t);
            }
        }
        break;
    case O_LOCK:
        if ((s = pick(T, 1)) >= 0) {
            float range = VP_HI[T->dest] - VP_LO[T->dest];
            if (!T->has[s]) {
                T->has[s] = 1;
                T->val[s] = T->p[T->dest];
            }
            T->val[s] += T->momentum * range * (0.04f + 0.08f * m_rnd(&sh.seed));
            if (T->val[s] >= VP_HI[T->dest] || T->val[s] <= VP_LO[T->dest]) {
                T->momentum = -T->momentum;
                T->val[s] = vp_clamp(T->dest, T->val[s]);
            }
        }
        break;
    case O_RATE:
        T->rate_i = (uint8_t)m_clampi((int)T->rate_i + (m_rnd(&sh.seed) < 0.5f ? 1 : -1), 1, NRATE - 2);
        break;
    case O_LEN:
        T->len = (uint8_t)m_clampi((int)T->len + (m_rnd(&sh.seed) < 0.5f ? 1 : -1), 3, NS);
        break;
    case O_NUDGE:
        if ((s = pick(T, 1)) >= 0) {
            int nv = T->nudge[s] + T->tmom * (1 + (int)(m_rnd(&sh.seed) * 2.0f));
            if (nv > 10 || nv < 0) {
                T->tmom = (int8_t)-T->tmom;
                nv = nv > 10 ? 10 : 0;
            }
            T->nudge[s] = (uint8_t)nv;
        }
        break;
    case O_ROT:
        rot_track(k, T->tmom > 0 ? 1 : -1);
        break;
    case O_COND:
        if ((s = pick(T, 1)) >= 0)
            T->cond[s] = (uint8_t)((T->cond[s] + (m_rnd(&sh.seed) < 0.5f ? 1 : NCOND - 1)) % NCOND);
        break;
    case O_FLOOR:
        op_floor(k);
        break;
    case O_SCAT:
        op_scat(k);
        break;
    case O_CHORD:
        chord_move();
        break;
    case O_BEND:                         /* the next chords bend down as they sound */
        sh.bend = 0.05f + 0.2f * m_rnd(&sh.seed);
        sh.bend_n = (uint8_t)(1 + (int)(m_rnd(&sh.seed) * 3.0f));
        break;
    case O_TOKEN:
        if (sh.gen) {                    /* a new travelling effect waits */
            int i;
            for (i = 0; i < NTOK; i++)
                if (!sh.tok[i].on) {
                    sh.tok[i].on = 1;
                    sh.tok[i].wait = 1;
                    sh.tok[i].from = (uint8_t)k;
                    sh.tok[i].skip = 0;
                    sh.tok[i].left_now = 0;
                    sh.tok[i].type = tok_pick(k, -1);
                    break;
                }
        } else if ((s = pick(T, 1)) >= 0) {   /* (GEN off: a lock instead) */
            T->has[s] = 1;
            T->val[s] = vp_clamp(T->dest, T->p[T->dest] + (VP_HI[T->dest] - VP_LO[T->dest]) * 0.3f * m_rndb(&sh.seed));
        }
        break;
    case O_MORPH: {                      /* the track's timbre a third of the way toward another of its family */
        static const uint8_t DIMS[] = {VP_RATIO, VP_INDEX, VP_IDEC, VP_FB, VP_NOISE, VP_METAL, VP_NRATIO, VP_NFB};
        int to = k < 3 ? SWAP_DRUM[(int)(m_rnd(&sh.seed) * (float)NSWAP_DRUM) % NSWAP_DRUM]
                       : MORPH[(int)(m_rnd(&sh.seed) * (float)NMORPH) % NMORPH], i;
        for (i = 0; i < (int)sizeof DIMS; i++)
            T->p[DIMS[i]] = vp_clamp(DIMS[i], T->p[DIMS[i]] + (VB_POINT[to][DIMS[i]] - T->p[DIMS[i]]) * 0.33f);
        break;
    }
    case O_COUPLE: {
        int j = (k + 1 + (int)(m_rnd(&sh.seed) * 3.0f)) % NT;
        sh.cm[k][j] = (int8_t)(sh.cm[k][j] > 0 ? -1 : sh.cm[k][j] < 0 ? 0 : 1);
        break;
    }
    case O_PATCH: {                      /* one cable's end moves: where it comes from, or where it goes */
        int c = (int)(m_rnd(&sh.seed) * (float)NCAB) % NCAB;
        if (m_rnd(&sh.seed) < 0.5f)
            sh.cab[c].src = (uint8_t)((int)(m_rnd(&sh.seed) * (float)NSRC) % NSRC);
        else
            sh.cab[c].dst = pick_dst(&sh.seed);
        sh.cab[c].hi = 0;
        sh.cab_rev++;
        break;
    }
    case O_DEPTH: {                      /* one cable turned up or down, now and then the other way round */
        int c = (int)(m_rnd(&sh.seed) * (float)NCAB) % NCAB;
        sh.cab[c].depth = m_clamp(sh.cab[c].depth + (m_rnd(&sh.seed) < 0.5f ? -1.0f : 1.0f) *
                                                        (0.15f + 0.25f * m_rnd(&sh.seed)), -1.0f, 1.0f);
        if (m_rnd(&sh.seed) < 0.15f)
            sh.cab[c].depth = -sh.cab[c].depth;
        sh.cab_rev++;
        break;
    }
    case O_EUCLID: {                     /* the track's notes spread evenly, turned: a designed rhythm, not a broken one */
        int n = trig_count(T);
        if (n < 1)
            n = 1 + (int)(m_rnd(&sh.seed) * 4.0f);
        if (m_rnd(&sh.seed) < 0.35f)
            n += m_rnd(&sh.seed) < 0.5f ? -1 : 1;
        euclid(T, m_clampi(n, 1, T->len), (int)(m_rnd(&sh.seed) * (float)T->len));
        flash(T, 0);
        break;
    }
    case O_METER: {                      /* a bar of the meter moves, or one comes, or one goes */
        float r = m_rnd(&sh.seed);
        int i = (int)(m_rnd(&sh.seed) * (float)sh.meter_n) % sh.meter_n;
        sh.meter_mode = 1;
        if (r < 0.5f)
            sh.meter[i] = (uint8_t)m_clampi((int)sh.meter[i] + (m_rnd(&sh.seed) < 0.5f ? -1 : 1) *
                                                                   (1 + (int)(m_rnd(&sh.seed) * 3.0f)), 3, 16);
        else if (r < 0.75f && sh.meter_n < 4)
            sh.meter[sh.meter_n++] = (uint8_t)(3 + (int)(m_rnd(&sh.seed) * 13.0f));
        else if (sh.meter_n > 1)
            sh.meter_n--;
        break;
    }
    }
    sh.plot_rev++;
}

/* the end of a bar (sixteen sixteenths of the tempo): it hears how much this bar repeated the last and how dense it
 * was, the operators due act, all of them gain or lose by how their way of changing fits what it is after now, and
 * (META) the ones out of energy die, the strongest has a child in their place */
static void bar_end(void)
{
    int i, j, best = 0, heard = 0, all = 0;
    float rep = 0.0f, need;
    for (i = 0; i < NT; i++) {           /* each track: how much of what it played it played again (Jaccard) */
        uint16_t a = st.mask_cur[i], b = st.mask_prev[i];
        int uni = pop16((uint16_t)(a | b));
        if (uni) {
            rep += (float)pop16((uint16_t)(a & b)) / (float)uni;
            heard++;
        }
        all += pop16(a);
        st.mask_prev[i] = a;
        st.mask_cur[i] = 0;
    }
    rep = heard ? rep / (float)heard : 1.0f;
    sh.rep += (rep - sh.rep) * 0.4f;
    sh.dens_m = (float)all * (1.0f / 64.0f);
    sh.order = 0.9f - 0.8f * sh.chaos;   /* CHAOS: one turn from order to wildness */
    sh.meta = 0.15f + 0.85f * sh.chaos;
    {                                    /* the CHAOS source: the logistic map, more chaotic as CHAOS goes up */
        float r = 3.5f + 0.49f * m_clamp(sh.chaos + 0.5f * sh.dm[G_TURING], 0.0f, 1.0f);
        st.chaos_x = r * st.chaos_x * (1.0f - st.chaos_x);
        if (!(st.chaos_x > 0.001f && st.chaos_x < 0.999f))
            st.chaos_x = 0.37f;
    }
    sh.rep_t = m_clamp(sh.order + RG_ORDER[sh.regime], 0.02f, 0.98f);
    need = sh.rep_t - sh.rep;            /* + it wants more repetition, - more difference */
    sh.bar_n++;
    sh.plot_rev++;
    if (sh.frozen)
        return;
    for (i = 0; i < NOP; i++) {
        oper_t *o = &sh.op[i];
        if (!o->on)
            continue;
        if ((sh.bar_n + o->phase) % o->period == 0u) {
            op_act(o);
            o->acts++;
        }
        o->age++;
        o->energy += need * OP_ORDER[o->kind] * 0.6f + (m_rnd(&sh.seed) - 0.5f) * 0.08f - 0.03f * (0.3f + sh.meta);
        for (j = 0; j < NOP; j++)        /* two doing the same to the same track crowd each other */
            if (j != i && sh.op[j].on && sh.op[j].kind == o->kind && sh.op[j].k == o->k)
                o->energy -= 0.05f;
        o->energy = m_clamp(o->energy, -2.0f, 2.0f);
    }
    if (sh.meta <= 0.0f)
        return;
    for (i = 1; i < NOP; i++)
        if (sh.op[i].energy > sh.op[best].energy)
            best = i;
    for (i = 0; i < NOP; i++) {
        oper_t *o = &sh.op[i];
        float death = -1.0f - (1.0f - sh.meta);
        if (i == best || !(o->energy < death || m_rnd(&sh.seed) < sh.meta * 0.01f))
            continue;
        *o = sh.op[best];                /* the strongest's child, a little different */
        if (m_rnd(&sh.seed) < 0.4f) {    /* another kind: any, but likelier the ones that lean where it needs to go */
            float w[NOPK], tot = 0.0f, x;
            int q;
            for (q = 0; q < NOPK; q++) {
                w[q] = 0.15f + 3.0f * m_max(0.0f, need * OP_ORDER[q]);
                tot += w[q];
            }
            x = m_rnd(&sh.seed) * tot;
            for (q = 0; q < NOPK - 1 && x >= w[q]; q++)
                x -= w[q];
            o->kind = (uint8_t)q;
        }
        if (m_rnd(&sh.seed) < 0.35f)
            o->k = (uint8_t)((int)(m_rnd(&sh.seed) * (float)NT) % NT);
        if (m_rnd(&sh.seed) < 0.5f)
            o->period = (uint8_t)m_clampi((int)o->period + (m_rnd(&sh.seed) < 0.5f ? -1 : 1), 1, 8);
        o->phase = (uint8_t)((int)(m_rnd(&sh.seed) * 8.0f) & 7);
        o->energy = 0.2f;
        o->age = o->acts = 0;
        sh.op[best].energy -= 0.25f;     /* a child costs */
        sh.op_rev++;
    }
}

/* ---- the modular engine: a block at a time ---- */
/* the sources move, the cables sum into the destinations, and rising edges on STEP / RESET cables clock or restart
 * the tracks they go to */
static void modular_block(uint32_t n)
{
    float bps = m_abs(st.spsec) * (1.0f / 16.0f), amt, kdec;
    int c, d, k;
    st.lfo_a += (float)n * M_INV_SR * bps * m_exp2(2.0f * sh.dm[G_RATEA]) * 0.25f;   /* a cycle every 4 bars */
    st.lfo_a -= m_floor(st.lfo_a);
    st.lfo_b += (float)n * M_INV_SR * bps * m_exp2(2.0f * sh.dm[G_RATEB]) * (1.0f / 6.472136f);   /* golden */
    st.lfo_b -= m_floor(st.lfo_b);
    sh.src_v[S_LFOA] = m_sin_t(st.lfo_a);
    sh.src_v[S_LFOB] = st.lfo_b < 0.5f ? 4.0f * st.lfo_b - 1.0f : 3.0f - 4.0f * st.lfo_b;
    sh.src_v[S_TURING] = (float)(st.tm_reg & 0xFFu) * (2.0f / 255.0f) - 1.0f;
    st.chaos_v += (2.0f * st.chaos_x - 1.0f - st.chaos_v) * 0.05f;
    sh.src_v[S_CHAOS] = st.chaos_v;
    st.drift = m_clamp(st.drift * 0.9995f + 0.015f * m_rndb(&st.rseed), -1.0f, 1.0f);
    sh.src_v[S_DRIFT] = st.drift;
    sh.src_v[S_FOLLOW] = m_clamp(st.follow * 6.0f, 0.0f, 1.0f) * 2.0f - 1.0f;
    kdec = m_exp2(-(float)n / (0.15f * M_SR) * 1.442695f);
    for (k = 0; k < NT; k++) {
        st.env[k] *= kdec;
        if (st.env[k] < 1.0e-6f)
            st.env[k] = 0.0f;
        sh.src_v[S_ENV1 + k] = st.env[k];
    }
    sh.src_v[S_PRESS] = sh.press;
    for (d = 0; d < NDEST; d++)
        sh.dm[d] = 0.0f;
    amt = sh.mod_amt * (1.0f + sh.boost_all);
    for (c = 0; c < NCAB; c++) {
        cable_t *cb = &sh.cab[c];
        float v = sh.src_v[cb->src], g = cb->depth * (1.0f + sh.cab_boost[c]);
        if (cb->dst >= D_STEP0 && cb->dst < G_TEMPO) {   /* a link: a rising edge acts */
            float x = v * (g < 0.0f ? -1.0f : 1.0f);
            uint8_t hi = (uint8_t)(x > 0.75f - 0.4f * m_min(1.0f, m_abs(g) * amt));
            if (hi && !cb->hi && amt > 0.0f) {
                int t = (cb->dst - D_STEP0) % NT;
                if (cb->dst >= D_RESET0)
                    sh.pos[t] = st.spsec < 0.0f ? sh.t[t].len : -1;
                st.ph[t] = 1.0f;         /* (it steps now) */
            }
            cb->hi = hi;
        } else {
            sh.dm[cb->dst] += v * g * amt;
        }
    }
    for (k = 0; k < NT; k++) {           /* DENS (the knob) on every track, at once */
        sh.dm[k * NDT + D_DENS] += 0.6f * m_log2(sh.dens_g);
        st.speed[k] = m_exp2(m_clamp(sh.dm[k * NDT + D_SPEED], -1.0f, 1.0f));
        st.send_m[k] = 0.8f * sh.dm[k * NDT + D_SEND];
    }
    for (d = 0; d < NDEST; d++)
        sh.dm[d] = m_clamp(sh.dm[d], -1.5f, 1.5f);
}

/* the TURING: a sixteenth at a time the register turns, the bit going round flipped as CHAOS says */
static void turing_tick(void)
{
    uint16_t bit = (uint16_t)((st.tm_reg >> 15) & 1u);
    float flip = m_clamp(0.01f + 0.45f * sh.chaos * sh.chaos + 0.5f * sh.dm[G_TURING], 0.0f, 0.5f);
    if (m_rnd(&st.rseed) < flip)
        bit ^= 1u;
    st.tm_reg = (uint16_t)((st.tm_reg << 1) | bit);
}

/* ---- the voices ---- */
/* track k's numbers now: the base, this step's lock, the LFO, the slot's settings, the hand, GEN's note and sweep */
static void coefs_one(int k, uint32_t n)
{
    trk_t *T = &sh.t[k];
    const mz_slot_t *v = mz_voice(k);
    float p[NVP], per = (float)T->len * 3.0f / m_max(0.25f, m_abs(st.spsec));
    int d, kind = st.swap[k] ? st.swap[k] - 1 : T->kind;
    for (d = 0; d < NVP; d++)            /* (SWAP: this note is another place of the bank) */
        p[d] = st.swap[k] ? VB_POINT[kind][d] : T->p[d];
    if (st.locked[k])
        p[T->dest] = st.lock[k];
    st.lfo_ph[k] += (float)n * M_INV_SR / per;
    st.lfo_ph[k] -= m_floor(st.lfo_ph[k]);
    p[T->dest] = vp_clamp(T->dest, p[T->dest] + T->lfo_depth * (VP_HI[T->dest] - VP_LO[T->dest])
                                                * m_sin_t(st.lfo_ph[k]));
    if (v) {
        p[VP_PITCH] = vp_clamp(VP_PITCH, p[VP_PITCH] * m_exp2(v->tune));
        p[VP_INDEX] = vp_clamp(VP_INDEX, p[VP_INDEX] + v->bright);
        p[VP_FB] = vp_clamp(VP_FB, p[VP_FB] + v->fb);
        if (p[VP_DEC] < VP_HELD)
            p[VP_DEC] = vp_clamp(VP_DEC, p[VP_DEC] * v->dec_x);
    }
    if (st.note_r[k] != 1.0f)
        p[VP_PITCH] = vp_clamp(VP_PITCH, p[VP_PITCH] * st.note_r[k]);
    p[VP_INDEX] = vp_clamp(VP_INDEX, p[VP_INDEX] + sh.live_bright[k] + T->tone + sh.tone_g);
    if (k == 3 && st.bend_now > 0.0f) {  /* a bend: it starts on the chord and falls by BEND octaves */
        p[VP_PITCH] = vp_clamp(VP_PITCH, p[VP_PITCH] * m_exp2(-st.bend_now));
        p[VP_SWEEP] = st.bend_now;
        p[VP_SWT] = 0.3f;
    }
    {                                    /* the cables: decay, tone, pitch; DRUMS: the drums toward their other places */
        const float *dm = &sh.dm[k * NDT];
        if (p[VP_DEC] < VP_HELD)
            p[VP_DEC] = vp_clamp(VP_DEC, p[VP_DEC] * m_exp2(2.0f * dm[D_DECAY]));
        p[VP_INDEX] = vp_clamp(VP_INDEX, p[VP_INDEX] + 6.0f * dm[D_TONE]);
        p[VP_PITCH] = vp_clamp(VP_PITCH, p[VP_PITCH] * m_exp2(0.5f * dm[D_PITCH]));
        if (k < 3) {
            float x = m_clamp(sh.drums + sh.dm[G_DRUMS], 0.0f, 1.0f);
            if (x > 0.0f) {
                static const uint8_t DIMS[] = {VP_SWEEP, VP_SWT, VP_RATIO, VP_INDEX, VP_IDEC, VP_FB, VP_NOISE,
                                               VP_METAL, VP_NRATIO, VP_NFB};
                const float *to = VB_POINT[DRUM_TO[k]];
                int q;
                for (q = 0; q < (int)sizeof DIMS; q++)
                    p[DIMS[q]] = vp_clamp(DIMS[q], p[DIMS[q]] + (to[DIMS[q]] - p[DIMS[q]]) * x);
                p[VP_PITCH] = vp_clamp(VP_PITCH, p[VP_PITCH] * m_exp2(0.5f * x * m_log2(to[VP_PITCH] / p[VP_PITCH])));
            }
        }
    }
    if (p[VP_DEC] < VP_HELD)
        p[VP_DEC] = vp_clamp(VP_DEC, p[VP_DEC] * T->dec_x);
    vox_gate(p, 4.0f * T->dec_x / m_max(0.25f, m_abs(st.spsec) * RATES[T->rate_i]));   /* four of its steps */
    if (st.cut[k])                       /* a cut: this note short */
        p[VP_DEC] = vp_clamp(VP_DEC, p[VP_DEC] * 0.12f);
    vox_coefs(&st.kk[k], p);
    if (st.swp[k])                       /* a sweep: the index rises (or falls) about 45 times over the step */
        st.kk[k].k_idx = m_exp2((st.swp[k] > 0 ? 5.5f : -5.5f) / m_max(64.0f, st.sps[k]));
    st.lvl[k] = VB_LEVEL[kind] * (v ? m_db2lin(v->level_db) : 1.0f);
}

static void coefs(uint32_t n)
{
    int k;
    for (k = 0; k < NT; k++)
        coefs_one(k, n);
}

/* the stutter: the last moments of the mix, looped for a step or two */
static void stut_start(float sps)
{
    static const float DIV[5] = {2.0f, 3.0f, 4.0f, 6.0f, 8.0f};
    uint32_t len = (uint32_t)(sps / DIV[(int)(m_rnd(&st.rseed) * 5.0f) % 5]);
    if (len < 128u)
        len = 128u;
    if (len > STUT_N / 2u)
        len = STUT_N / 2u;
    st.s_len = len;
    st.s_start = (st.sw + STUT_N - len) % STUT_N;
    st.s_pos = 0;
    st.s_left = (uint32_t)m_min(1.2f * M_SR, sps * (m_rnd(&st.rseed) < 0.6f ? 1.0f : 2.0f));   /* (never long) */
}

/* the chord: two more voices, the track's sound at two more notes of the field above this one */
static void chord(int k, float gain)
{
    int j, n0 = st.pnote[k];
    float base = st.kk[k].f0 / st.note_r[k];
    for (j = 0; j < 2; j++) {
        int nn = n0 + (j ? 4 : 2) + (m_rnd(&st.rseed) < 0.3f ? 1 : 0);
        if (nn >= NNOTE)
            nn -= NFIELD;
        st.hk[j] = st.kk[k];
        st.hk[j].f0 = m_min(8000.0f, base * note_ratio(nn));
        st.hk[j].xmod = 0.0f;
        vox_trig(&st.hv[j], &st.hk[j]);
        st.h_lvl[j] = st.lvl[k] * gain * 0.65f;
    }
    st.h_trk = k;
}

/* the strike of track k's step, with its marks (now, or late: a nudge) */
static void fire(int k, float gain)
{
    static const uint8_t CRUSH[4] = {3, 5, 9, 17};
    uint16_t a = st.pact[k];
    int j;
    st.mask_cur[k] |= (uint16_t)(1u << ((int)st.bar_ph & 15));   /* what this bar sounded, for the listening */
    st.env[k] = m_max(st.env[k], gain); /* (ENV k: a source) */
    st.cut[k] = (uint8_t)((a & A_CUT) != 0);
    st.swap[k] = (uint8_t)((a & A_SWAP) ? st.palt[k] + 1u : 0u);
    st.note_r[k] = (a & A_NOTE) ? note_ratio(st.pnote[k]) : 1.0f;
    if (k == 3) {                        /* the chord track: its root and lowest voice, and maybe a bend */
        st.note_r[k] *= sh.root * sh.cv[0];
        if (sh.bend_n) {
            st.bend_now = sh.bend;
            sh.bend_n--;
        } else {
            st.bend_now = 0.0f;
        }
    }
    if (sh.couple != 0.0f)               /* its sound pulls (or pushes) the others' step clocks: phases interact */
        for (j = 0; j < NT; j++)
            if (j != k && sh.cm[k][j]) {
                float ph = st.ph[j], c = sh.couple * (float)sh.cm[k][j];
                st.ph[j] = m_clamp(ph - c * 0.12f * m_sin_t(ph), 0.0f, 0.9999f);
            }
    st.swp[k] = (int8_t)((a & A_SWEEP) ? (m_rnd(&st.rseed) < 0.5f ? 1 : -1) : 0);
    coefs_one(k, 0);
    st.vel_gain[k] = gain;
    vox_trig(&st.v[k], &st.kk[k]);
    if (st.swp[k])
        st.v[k].idx_env = st.swp[k] > 0 ? 0.06f : 3.0f;
    st.send[k] = (a & A_ECHO) ? 0.9f : (sh.gen && k == 3) ? 0.15f : 0.0f;
    st.crush[k] = (uint8_t)((a & A_CRUSH) ? CRUSH[(int)(m_rnd(&st.rseed) * 4.0f) & 3] : 0);
    st.crush_c[k] = 0;
    if (a & A_RAT) {
        uint8_t m = st.prat[k] < 2 ? 2 : st.prat[k];
        st.rat_left[k] = (uint8_t)(m - 1u);
        st.rat_int[k] = (uint32_t)m_max(200.0f, st.sps[k] / (float)m);
        st.rat_cnt[k] = st.rat_int[k];
        st.rat_gain[k] = gain;
    } else {
        st.rat_left[k] = 0;
    }
    if (k == 3) {                        /* its three other voices */
        for (j = 0; j < 3; j++) {
            st.ck3[j] = st.kk[3];
            st.ck3[j].f0 = m_min(8000.0f, st.kk[3].f0 * sh.cv[j + 1] / sh.cv[0]);
            st.ck3[j].xmod = 0.0f;
            vox_trig(&st.cv3[j], &st.ck3[j]);
        }
        st.c_lvl = st.lvl[3] * gain * 0.45f;
    }
    if (a & A_CHORD)
        chord(k, gain);
    if (a & A_STUT)
        stut_start(st.sps[k]);
}

/* one step of track k (its own clock: the tempo times its rate) */
static void step_one(int k, int dir, float samples_per_step)
{
    trk_t *T = &sh.t[k];
    int p = sh.pos[k] + dir;
    if (p >= T->len || p < 0) {
        float per_step = (float)T->len / 16.0f;   /* per step, so a short track is not changed more often */
        p = p < 0 ? T->len - 1 : 0;
        T->loops++;
        (void)per_step;                  /* (the operators change it here, not HENKA's MUT and TIME) */
        if (k == 0)
            sh.fill_next = 0;
        if (sh.gen)
            tok_tidy(k);
    }
    if (p >= T->len)
        p = 0;
    sh.pos[k] = p;
    st.locked[k] = 0;
    st.sps[k] = samples_per_step;
    if (sh.gen && !sh.frozen) {
        gen_step(k);
        if (k == 3)
            morph_step();
    }
    {
        float dmd = sh.dm[k * NDT + D_DENS];
        /* every note waits a little (a fifth of a step) so PUSH can bring it early as well as late */
        float delay = 0.2f + 0.18f * m_clamp(sh.dm[k * NDT + D_PUSH], -1.0f, 1.0f);
        if ((T->trig[p] || T->has[p]) && cond_eval(k, T->cond[p])) {
            if (T->has[p]) {
                st.lock[k] = T->val[p];
                st.locked[k] = 1;
            }
            if (T->trig[p] && T->on && !(dmd < 0.0f && m_rnd(&st.rseed) < m_min(0.8f, -dmd))) {   /* DENS < 0 thins
                                                                                                * (never all) */
                st.pact[k] = on_onset(k, p, &st.pnote[k], &st.prat[k], &st.palt[k]);   /* the effects on this note */
                delay += (float)T->nudge[p] * (1.0f / 16.0f);
                st.pend[k] = 1u + (uint32_t)(m_clamp(delay, 0.0f, 0.9f) * samples_per_step);
                st.pend_gain[k] = 1.0f;
            }
        } else if (!T->trig[p] && T->on && dmd > 0.0f && m_rnd(&st.rseed) < dmd * 0.35f) {   /* a ghost note */
            st.pact[k] = 0;
            st.pend[k] = 1u + (uint32_t)(m_clamp(delay, 0.0f, 0.9f) * samples_per_step);
            st.pend_gain[k] = 0.3f + 0.3f * m_rnd(&st.rseed);
        }
    }
    sh.plot_rev++;
}

static inline int16_t sat16(float x)
{
    x *= 16384.0f;                       /* +-2 fits */
    return (int16_t)(x > 32767.0f ? 32767.0f : x < -32767.0f ? -32767.0f : x);
}

/* ---- touch: momentary effects on the whole sound ---- */
static inline float tb_at(const int16_t *b, uint32_t i) { return (float)b[i & (TB_N - 1u)] * (1.0f / 16384.0f); }

static float ps_read(float d)            /* the shifters' memory d samples back, interpolated */
{
    float pos = (float)st.pw - d + (float)PS_N, fr;
    uint32_t i0 = (uint32_t)pos;
    float a, b;
    fr = pos - (float)i0;
    a = (float)ps_buf[i0 & (PS_N - 1u)];
    b = (float)ps_buf[(i0 + 1u) & (PS_N - 1u)];
    return (a + (b - a) * fr) * (1.0f / 16384.0f);
}

/* a pitch shifter: two readers half a window apart move through the memory at the ratio, crossfaded by triangles that
 * sum to one, so the wrap is never heard as a click */
static float shift_tap(int i, float ratio)
{
    const float W = 2400.0f;
    float d1, d2, w1;
    st.ps_d[i] -= ratio - 1.0f;
    while (st.ps_d[i] < 2.0f)
        st.ps_d[i] += W;
    while (st.ps_d[i] >= W + 2.0f)
        st.ps_d[i] -= W;
    d1 = st.ps_d[i];
    d2 = d1 + 0.5f * W;
    if (d2 >= W + 2.0f)
        d2 -= W;
    w1 = 1.0f - m_abs(2.0f * (d1 - 2.0f) / W - 1.0f);
    return ps_read(d1) * w1 + ps_read(d2) * (1.0f - w1);
}

/* a slice of the recorded sound, by its mode: LOOP and STUT loop the last moments (STUT catches new ones every four
 * times round), REV reads backwards, FREEZE holds a grain with two crossfaded readers */
static void slice_read(int mode, float beat, float *ol, float *orr)
{
    float dep = sh.touch[mode];
    switch (mode) {
    case T_LOOP: {
        uint32_t len = (uint32_t)m_clamp(beat / (float)(1u << (int)(dep * 3.99f)), 256.0f, (float)(TB_N / 2u));
        if (st.sl_pos >= len)
            st.sl_pos %= len;
        *ol = tb_at(tb_l, st.sl_start + st.sl_pos);
        *orr = tb_at(tb_r, st.sl_start + st.sl_pos);
        if (++st.sl_pos >= len)
            st.sl_pos = 0;
        break;
    }
    case T_STUT: {
        uint32_t len = (uint32_t)m_clamp(beat / (4.0f * m_exp2(dep * 3.0f)), 64.0f, (float)(TB_N / 4u)), e;
        if (st.sl_pos >= len)
            st.sl_pos = 0;
        e = st.sl_pos < len - st.sl_pos ? st.sl_pos : len - st.sl_pos;   /* (soft edges) */
        {
            float g = e < 32u ? (float)e * (1.0f / 32.0f) : 1.0f;
            *ol = tb_at(tb_l, st.sl_start + st.sl_pos) * g;
            *orr = tb_at(tb_r, st.sl_start + st.sl_pos) * g;
        }
        if (++st.sl_pos >= len) {
            st.sl_pos = 0;
            if (++st.sl_count % 4u == 0u)   /* it catches what is playing now */
                st.sl_start = (st.tw + TB_N - len) & (TB_N - 1u);
        }
        break;
    }
    case T_REV: {
        float pos = (float)(st.sl_start + TB_N) - 1.0f - st.sl_rpos, fr;
        uint32_t i0 = (uint32_t)pos;
        fr = pos - (float)i0;
        *ol = tb_at(tb_l, i0) * (1.0f - fr) + tb_at(tb_l, i0 + 1u) * fr;
        *orr = tb_at(tb_r, i0) * (1.0f - fr) + tb_at(tb_r, i0 + 1u) * fr;
        st.sl_rpos += 0.5f + 1.5f * dep;
        if (st.sl_rpos > (float)(TB_N - 8u))
            st.sl_rpos = 0.0f;
        break;
    }
    default: {                           /* FREEZE */
        uint32_t g = 8192u >> (int)(dep * 2.99f), p1 = st.sl_pos % g, p2 = (p1 + g / 2u) % g;
        float w = 1.0f - m_abs(2.0f * (float)p1 / (float)g - 1.0f);
        *ol = tb_at(tb_l, st.sl_start + p1) * w + tb_at(tb_l, st.sl_start + p2) * (1.0f - w);
        *orr = tb_at(tb_r, st.sl_start + p1) * w + tb_at(tb_r, st.sl_start + p2) * (1.0f - w);
        st.sl_pos = (p1 + 1u) % g;
        break;
    }
    }
}

static void touch_sample(float *pl, float *pr, float beat)
{
    float l = *pl, r = *pr, mono, wet;
    int mode = sh.touch[T_FREEZE] > 0.0f ? T_FREEZE : sh.touch[T_REV] > 0.0f ? T_REV
             : sh.touch[T_LOOP] > 0.0f ? T_LOOP : sh.touch[T_STUT] > 0.0f ? T_STUT : -1;
    if (!st.tb_hold) {                   /* the recording goes on, except while a held slice is read */
        tb_l[st.tw] = sat16(l);
        tb_r[st.tw] = sat16(r);
        st.tw = (st.tw + 1u) & (TB_N - 1u);
    }
    if (mode != st.slice_mode) {         /* a slice begins where the sound is now */
        uint32_t back = mode == T_FREEZE ? 8192u : mode == T_REV ? 0u
                      : (uint32_t)m_clamp(mode == T_LOOP ? beat : beat * 0.25f, 64.0f, (float)(TB_N / 2u));
        st.sl_start = (st.tw + TB_N - back) & (TB_N - 1u);
        st.sl_pos = st.sl_count = 0;
        st.sl_rpos = 0.0f;
        st.slice_mode = (int8_t)mode;
        if (mode >= 0)
            st.slice_last = (int8_t)mode;
    }
    st.tb_hold = (uint8_t)(mode == T_LOOP || mode == T_REV || mode == T_FREEZE);
    st.fade += ((mode >= 0 ? 1.0f : 0.0f) - st.fade) * 0.01f;
    if (st.fade > 1.0e-3f && st.slice_last >= 0) {
        float sl, sr;
        slice_read(mode >= 0 ? mode : st.slice_last, beat, &sl, &sr);
        l += (sl - l) * st.fade;
        r += (sr - r) * st.fade;
    } else {
        st.fade = 0.0f;
    }
    /* the shifters' memory: the sound after the slices, with PITCH's own repeats fed back in */
    mono = 0.5f * (l + r);
    st.pg += ((sh.touch[T_PITCH] > 0.0f ? 1.0f : 0.0f) - st.pg) * (sh.touch[T_PITCH] > 0.0f ? 0.004f : 0.0002f);
    wet = 0.0f;
    if (st.pg > 1.0e-3f) {               /* PITCH: a pitch-shifted delay, -6 to +12 semitones with the pressure */
        float dp = sh.touch[T_PITCH] > 0.0f ? sh.touch[T_PITCH] : 0.5f;
        wet = shift_tap(0, m_exp2(dp * 2.0f - 1.0f)) * st.pg;
    } else {
        st.pg = 0.0f;
    }
    ps_buf[st.pw] = sat16(mono + wet * 0.5f);
    st.pw = (st.pw + 1u) & (PS_N - 1u);
    l += wet * 0.8f;
    r += wet * 0.6f;
    st.hg += ((sh.touch[T_HARM] > 0.0f ? 1.0f : 0.0f) - st.hg) * 0.003f;
    if (st.hg > 1.0e-3f) {               /* HARM: two shifted copies, at intervals of the harmonic field */
        static const float IV[3][2] = {{1.25f, 1.5f}, {1.5f, 1.75f}, {1.75f, 2.25f}};
        int q = (int)(m_clamp(sh.touch[T_HARM], 0.0f, 0.999f) * 3.0f);
        float a = shift_tap(1, IV[q][0]), b2 = shift_tap(2, IV[q][1]);
        l += (a * 0.5f + b2 * 0.25f) * st.hg;
        r += (a * 0.25f + b2 * 0.5f) * st.hg;
    } else {
        st.hg = 0.0f;
    }
    if (sh.touch[T_TAPE] > 0.0f)         /* TAPE: it runs down (harder: faster), and back up when let go */
        st.tape_r += (0.03f - st.tape_r) * (0.00002f + 0.0002f * sh.touch[T_TAPE]);
    else
        st.tape_r += (1.0f - st.tape_r) * 0.002f;
    if (st.tape_r < 0.999f) {
        float x = shift_tap(3, st.tape_r), mx = m_clamp((1.0f - st.tape_r) * 1.5f, 0.0f, 1.0f);
        l += (x - l) * mx;
        r += (x - r) * mx;
    } else {
        st.tape_r = 1.0f;
    }
    if (sh.touch[T_CRUSH] > 0.0f) {      /* CRUSH: held longer and fewer levels as it is pressed */
        float dc = sh.touch[T_CRUSH], lev = m_exp2(10.0f - 8.0f * dc);
        if (++st.tcr_c >= 1u + (uint32_t)(dc * 23.0f)) {
            st.tcr_c = 0;
            st.tcr_y[0] = m_floor(l * lev + 0.5f) / lev;
            st.tcr_y[1] = m_floor(r * lev + 0.5f) / lev;
        }
        l = st.tcr_y[0];
        r = st.tcr_y[1];
    }
    *pl = l;
    *pr = r;
}

void pj_render(float *out_l, float *out_r, const float *inl, const float *inr, uint32_t n)
{
    static const float HPAN[2] = {-0.45f, 0.45f};
    uint32_t i;
    int k, j;
    float dstep, efb, beat, fsum = 0.0f;
    (void)inl, (void)inr;
    if (sh.home_req != st.home_seen) {
        st.home_seen = sh.home_req;
        pj_reset_audio();
    }
    if (++st.breath_n >= 86u) {          /* the tempo's breath: 1/f, about four new values a second */
        st.breath_n = 0;
        sh.tempo_w += ((1.0f + sh.time * 0.07f * pink_next(&st.breath, &sh.seed)) - sh.tempo_w) * 0.3f;
    }
    sh.tempo_r += (RG[sh.regime].tempo - sh.tempo_r) * 0.004f;   /* over a few seconds */
    modular_block(n);                    /* the sources move, the cables sum, the links fire */
    st.spsec = sh.tempo * sh.tempo_w * sh.tempo_r * m_exp2(0.25f * sh.dm[G_TEMPO]) * (4.0f / 60.0f);
    beat = 4.0f * M_SR / m_max(0.5f, m_abs(st.spsec));   /* (a beat in samples, for the touch effects) */
    dstep = m_abs(st.spsec) * M_INV_SR;
    coefs(n);
    {                                    /* the echo: the regime's length in steps of the tempo */
        const regime_t *R = &RG[sh.regime];
        float d = R->echo_steps * M_SR / m_max(0.5f, m_abs(st.spsec));
        st.echo_d = (uint32_t)m_clamp(d, 64.0f, (float)(ECHO_N - 2u));
        efb = R->echo_fb;
    }
    {                                    /* FBACK: the no-input layer's gate, pitch and feedback, a block at a time */
        float amt = m_clamp(sh.ni_amt + 0.5f * sh.dm[G_FBACK], 0.0f, 1.0f);
        st.ni_amt_now = amt;
        if (st.ni_t <= n) {              /* open for seconds, closed for seconds: how much, by FBACK */
            float u = m_rnd(&st.rseed);
            st.ni_open = (uint8_t)(amt > 0.0f && !st.ni_open && u < 0.35f + 0.6f * amt);
            st.ni_t = (uint32_t)(M_SR * (st.ni_open ? 0.3f + 3.5f * amt * m_rnd(&st.rseed)
                                                    : 0.8f + 8.0f * (1.0f - amt) * m_rnd(&st.rseed)));
            if (st.ni_open) {            /* a new place: somewhere between a hum and a whistle, or an octave away */
                st.ni_f = m_rnd(&st.rseed) < 0.3f ? m_clamp(st.ni_f * (m_rnd(&st.rseed) < 0.5f ? 0.5f : 2.0f), 30.0f, 5000.0f)
                                                  : 40.0f * m_exp2(7.0f * m_rnd(&st.rseed));
                st.ni_aim = 0.02f + 0.25f * m_rnd(&st.rseed);   /* how rough it wants to be this time */
                st.ni_d = 200u + (uint32_t)(m_rnd(&st.rseed) * (float)(ECHO_N - 400u));
            }
        } else {
            st.ni_t -= n;
        }
        st.ni_f = m_clamp(st.ni_f * m_exp2(0.004f * m_rndb(&st.rseed)), 30.0f, 5000.0f);
        st.ni_inc = m_inc(st.ni_f);
        /* the homeostat: the feedback goes up when it is smoother than it wants, down when rougher: it hunts at the
         * edge between a tone and a noise */
        st.ni_g = m_clamp(st.ni_g + (st.ni_aim - st.ni_rough) * 0.6f, 0.0f, 1.6f);
    }
    for (k = 0; k < NT; k++) {
        if (st.v[k].idx_env > 4.0f)      /* a rising sweep stops at a bright place */
            st.v[k].idx_env = 4.0f;
        if (sh.live_req[k] != st.live_seen[k]) {   /* the hand's strikes (black keys 1-4) */
            st.live_seen[k] = sh.live_req[k];
            st.vel_gain[k] = 0.25f + sh.live_vel[k];
            vox_trig(&st.v[k], &st.kk[k]);
        }
    }
    for (i = 0; i < n; i++) {
        float l = 0.0f, r = 0.0f, prev, ein = 0.0f, e1, e2;
        int stepped = 0;
        st.bar_ph += dstep;              /* bars of the tempo: GEN's regimes last a number of them */
        if (st.bar_ph >= 16.0f) {
            st.bar_ph -= 16.0f;
            bar_end();                   /* it listens, the operators act, live and die */
            if (!sh.frozen && sh.dwell && --sh.dwell == 0)
                new_regime();
        }
        st.base_ph += dstep;             /* the meter: bars of changing length; the following tracks start again */
        if (st.base_ph >= 1.0f) {
            st.base_ph -= 1.0f;
            turing_tick();
            if (sh.meter_mode) {
                const uint8_t *bars = sh.meter_mode == 1 ? sh.meter : METERS[sh.meter_mode];
                int nb = sh.meter_mode == 1 ? sh.meter_n : 0;
                if (!nb)
                    while (nb < 4 && bars[nb])
                        nb++;
                if (st.mi >= (uint32_t)nb)
                    st.mi = 0;
                if (++st.meter_pos >= bars[st.mi]) {
                    uint8_t f = (uint8_t)(RG[sh.regime].follow | 1u);   /* the kick always */
                    st.meter_pos = 0;
                    st.mi = (st.mi + 1u) % (uint32_t)nb;
                    for (k = 0; k < NT; k++)
                        if (f >> k & 1u) {
                            sh.pos[k] = st.spsec < 0.0f ? sh.t[k].len : -1;
                            st.ph[k] = 1.0f;
                        }
                }
            }
        }
        for (k = 0; k < NT; k++) {       /* each track on its own clock */
            float rate = RATES[sh.t[k].rate_i] * st.speed[k];   /* (SPEED: the cables waver its clock) */
            st.ph[k] += dstep * rate;
            if (st.ph[k] >= 1.0f) {
                st.ph[k] -= 1.0f;
                if (st.ph[k] >= 1.0f)        /* (a STEP link already stepped it) */
                    st.ph[k] = 0.0f;
                step_one(k, st.spsec < 0.0f ? -1 : 1, M_SR / m_max(0.05f, m_abs(st.spsec) * rate));
                stepped = 1;
            }
            if (st.pend[k] && --st.pend[k] == 0u)   /* a nudged trig, now */
                fire(k, st.pend_gain[k]);
            if (st.rat_left[k] && --st.rat_cnt[k] == 0u) {   /* a ratchet's next strike (a note climbs the field) */
                st.rat_cnt[k] = st.rat_int[k];
                st.rat_left[k]--;
                st.rat_gain[k] *= 0.8f;
                if (st.pact[k] & A_NOTE) {
                    st.pnote[k] = (uint8_t)((st.pnote[k] + 1u) % NNOTE);
                    st.note_r[k] = note_ratio(st.pnote[k]);
                    coefs_one(k, 0);
                }
                st.vel_gain[k] = st.rat_gain[k];
                vox_trig(&st.v[k], &st.kk[k]);
            }
        }
        if (stepped)
            coefs(0);
        for (k = 0; k < NT; k++)         /* the hand's repeats (black keys 6-9) */
            if (sh.ratchet_hz[k] > 0.0f) {
                st.rat_ph[k] += sh.ratchet_hz[k] * M_INV_SR;
                if (st.rat_ph[k] >= 1.0f) {
                    st.rat_ph[k] -= 1.0f;
                    st.vel_gain[k] = 0.8f;
                    vox_trig(&st.v[k], &st.kk[k]);
                }
            } else {
                st.rat_ph[k] = 1.0f;     /* (the next press strikes at once) */
            }
        prev = st.v[NT - 1].y;
        for (k = 0; k < NT; k++) {
            float y = vox_run(&st.v[k], &st.kk[k], prev);
            prev = y;
            y *= st.lvl[k] * st.vel_gain[k];
            if (st.crush[k]) {           /* a crush: held for a few samples, and fewer levels */
                if (st.crush_c[k] == 0u)
                    st.crush_y[k] = m_floor(y * 6.0f + 0.5f) * (1.0f / 6.0f);
                if (++st.crush_c[k] >= st.crush[k])
                    st.crush_c[k] = 0;
                y = st.crush_y[k];
            }
            ein += y * m_clamp(st.send[k] + st.send_m[k], 0.0f, 1.0f);
            l += y * (1.0f - PAN[k]);
            r += y * (1.0f + PAN[k]);
        }
        for (j = 0; j < 2; j++) {        /* the chord's voices */
            float y = vox_run(&st.hv[j], &st.hk[j], 0.0f);
            if (y != 0.0f) {
                y *= st.h_lvl[j];
                ein += y * st.send[st.h_trk];
                l += y * (1.0f - HPAN[j]);
                r += y * (1.0f + HPAN[j]);
            }
        }
        for (j = 0; j < 3; j++) {        /* the chord track's other three voices, spread */
            static const float CPAN[3] = {-0.5f, 0.2f, 0.55f};
            float y = vox_run(&st.cv3[j], &st.ck3[j], 0.0f);
            if (y != 0.0f) {
                y *= st.c_lvl;
                ein += y * st.send[3];
                l += y * (1.0f - CPAN[j]);
                r += y * (1.0f + CPAN[j]);
            }
        }
        st.ni_lvl += ((st.ni_open ? 1.0f : 0.0f) - st.ni_lvl) * 0.0015f;
        if (st.ni_lvl > 1.0e-4f) {       /* FBACK: a sine modulated by itself and by the echo's memory of the mix */
            float tap = (float)echo_buf[(st.ew - st.ni_d) & (ECHO_N - 1u)] * (1.0f / 16384.0f), y, yo;
            y = m_sin_pm(st.ni_ph, st.ni_g * (0.8f * st.ni_y + tap));
            st.ni_ph += st.ni_inc;
            st.ni_rough += (m_abs(y - st.ni_y) - st.ni_rough) * 0.001f;
            st.ni_y = y;
            yo = y * st.ni_lvl * st.ni_amt_now * 0.16f;
            l += yo * 1.3f;
            r += yo * 1.0f;
            ein += yo * 0.6f;            /* back into the echo, which it reads: the loop closes */
        } else {
            st.ni_lvl = 0.0f;
        }
        /* the echo: darker each time round; the right side reads a third later */
        e1 = (float)echo_buf[(st.ew - st.echo_d) & (ECHO_N - 1u)] * (1.0f / 16384.0f);
        e2 = (float)echo_buf[(st.ew - st.echo_d - st.echo_d / 3u) & (ECHO_N - 1u)] * (1.0f / 16384.0f);
        st.e_lp += (e1 - st.e_lp) * 0.35f;
        st.e_lp2 += (e2 - st.e_lp2) * 0.35f;
        echo_buf[st.ew & (ECHO_N - 1u)] = sat16(ein + st.e_lp * efb);
        st.ew++;
        l = l * 0.4f + st.e_lp * 0.5f;     /* (four-voice chords: a little more room than HENKA) */
        r = r * 0.4f + st.e_lp2 * 0.5f;
        /* the stutter: the mix's last moments looped instead of the mix */
        if (st.s_left) {
            uint32_t q = (st.s_start + st.s_pos) % STUT_N;
            l = (float)stut_l[q] * (1.0f / 16384.0f);
            r = (float)stut_r[q] * (1.0f / 16384.0f);
            if (++st.s_pos >= st.s_len)
                st.s_pos = 0;
            st.s_left--;
        } else {
            stut_l[st.sw] = sat16(l);
            stut_r[st.sw] = sat16(r);
            if (++st.sw >= STUT_N)
                st.sw = 0;
        }
        touch_sample(&l, &r, beat);    /* the hand's momentary effects */
        out_l[i] = l;
        out_r[i] = r;
        fsum += l * l;
    }
    fsum /= (float)(n ? n : 1u);
    st.follow += ((fsum > 1.0e-12f ? m_exp2(0.5f * m_log2(fsum)) : 0.0f) - st.follow) * 0.2f;   /* (FOLLOW) */
    if (st.follow < 1.0e-9f)
        st.follow = 0.0f;
    if (m_abs(st.e_lp) < 1.0e-20f)       /* (no denormal numbers in the quiet) */
        st.e_lp = 0.0f;
    if (m_abs(st.e_lp2) < 1.0e-20f)
        st.e_lp2 = 0.0f;
}

/* ---- the hand ---- */
static void thin(trk_t *T)
{
    int s, n = trig_count(T), drop = (n + 1) / 2;
    while (drop-- > 0 && (s = pick(T, 1)) >= 0)
        T->trig[s] = T->has[s] = 0;
}

void pj_control(const mz_in_t *in, const mz_body_t *b)
{
    trk_t *T;
    int i;
    follow_slots();
    sh.energy = b->energy;
    T = &sh.t[ui.trk];
    /* white keys 1-8: touch (momentary effects, deeper as pressed); 9-15: the cables (tap: re-patch, held: turned
     * up); 16: every cable turned up while held */
    {
        float pmax = 0.0f;
        if (!ui.seed)
            ui.seed = sh.seed ^ 0xC0FFEEu;
        for (i = 0; i < NTOUCH; i++) {
            int key = WHITE[i];
            float pr = key < HW_NPRESS ? (float)in->prs[key] * (1.0f / 127.0f) : 0.0f;
            if (in->keys >> key & 1u) {
                float v = (float)in->vel[key] * (1.0f / 127.0f);
                ui.pad[i] = m_clamp(0.15f + 0.35f * v + 0.6f * pr, 0.05f, 1.0f);
                if (in->down >> key & 1u)
                    mz_say(TOUCH_NAME[i], "");
                pmax = m_max(pmax, pr);
            } else {
                ui.pad[i] = 0.0f;
            }
        }
        for (i = 0; i < NCAB; i++) {
            int key = WHITE[8 + i];
            if (in->down >> key & 1u)
                ui.cab_t[i] = in->ms;
            sh.cab_boost[i] = ((in->keys >> key & 1u) && in->ms - ui.cab_t[i] >= 250u) ? 1.0f : 0.0f;
            if ((in->up >> key & 1u) && in->ms - ui.cab_t[i] < 250u) {   /* a tap: a new connection */
                char t[20];
                sh.cab[i].src = (uint8_t)((int)(m_rnd(&ui.seed) * (float)NSRC) % NSRC);
                sh.cab[i].dst = pick_dst(&ui.seed);
                sh.cab[i].hi = 0;
                if (m_abs(sh.cab[i].depth) < 0.3f)
                    sh.cab[i].depth = m_rnd(&ui.seed) < 0.5f ? -0.6f : 0.6f;
                sh.cab_rev++;
                t[0] = 0;
                mz_cat(t, SRC_SHORT[sh.cab[i].src]);
                mz_cat(t, ">");
                dst_cat(t, sh.cab[i].dst);
                mz_say("CABLE", t);
            }
        }
        sh.boost_all = (in->keys >> WHITE[15] & 1u) ? 1.0f : 0.0f;
        for (i = 0; i < NT; i++)         /* (black keys pressed count too) */
            if (BLACK[i] < HW_NPRESS && (in->keys >> BLACK[i] & 1u))
                pmax = m_max(pmax, (float)in->prs[BLACK[i]] * (1.0f / 127.0f));
        sh.press = pmax;
        /* GESTURE: a fast spin stutters, a wiggle loops (on top of the pads) */
        for (i = 0; i < NTOUCH; i++)
            sh.touch[i] = ui.pad[i];
        if (sh.gesture) {
            if (b->agit > 70.0f)
                sh.touch[T_STUT] = m_max(sh.touch[T_STUT], m_clamp((b->agit - 70.0f) * (1.0f / 150.0f), 0.05f, 1.0f));
            if (b->revs > 3.0f)
                sh.touch[T_LOOP] = m_max(sh.touch[T_LOOP], 0.3f);
        }
    }
    /* black keys: 1-4 play, 5 fill, 6-9 repeat, 10 LFO, 11 XMOD */
    for (i = 0; i < NT; i++) {
        int key = BLACK[i], rk = BLACK[5 + i];
        if (in->down >> key & 1u) {      /* a strike, and this track is the one the knobs and white keys act on */
            sh.live_vel[i] = (float)in->vel[key] * (1.0f / 127.0f);
            sh.live_req[i]++;
            if (ui.trk != i) {
                ui.trk = i;
                ui.held_step = -1;
                sh.plot_rev++;
            }
        }
        sh.live_bright[i] = (in->keys >> key & 1u) ? (float)in->prs[key] * (6.0f / 127.0f) : 0.0f;
        if (in->keys >> rk & 1u) {
            float p = rk < HW_NPRESS ? (float)in->prs[rk] * (1.0f / 127.0f) : 0.0f;
            sh.ratchet_hz[i] = 4.0f + 24.0f * p;
        } else {
            sh.ratchet_hz[i] = 0.0f;
        }
    }
    sh.fill_held = (uint8_t)((in->keys >> BLACK[4]) & 1u);
    /* FX: a tap turns GEN on / off; held, the knobs are GEN's page; held still for 0.7 s, a burst (effects on nearly
     * every note while held, thinning out after) */
    if (in->bdown & (1u << HB_FX)) {
        ui.fx_t = in->ms;
        ui.fx_burst = ui.fx_knob = 0;
    }
    {
        int i2, turned = 0;
        for (i2 = 0; i2 < HW_NENC; i2++)
            turned |= in->enc[i2] != 0;
        if ((in->btn & (1u << HB_FX)) && turned) {
            ui.fx_knob = 1;
            if (sh.burst)                /* turning: the page, not a burst */
                sh.burst = 0;
        }
    }
    ui.fx_page = (uint8_t)((in->btn & (1u << HB_FX)) && (in->ms - ui.fx_t >= 180u || ui.fx_knob));
    if (ui.fx_page != ui.fx_was) {
        ui.fx_was = ui.fx_page;
        sh.plot_rev++;
    }
    if (in->bup & (1u << HB_FX)) {       /* (here a hold is for looking at the operators: only a tap turns GEN) */
        if (ui.fx_knob || in->ms - ui.fx_t >= 300u) {
            sh.burst = 0;
        } else {
            sh.gen = (uint8_t)!sh.gen;
            mz_say(sh.gen ? "GEN" : "GEN OFF", sh.gen ? RG[sh.regime].name : "");
        }
        ui.fx_page = 0;
        sh.plot_rev++;
    }
    if (ui.fx_page) {                    /* GEN's page: the processes, not values */
        if (in->enc[HE_SELECT]) {        /* METER: OFF, AUTO, or a fixed one */
            sh.meter_mode = (uint8_t)(((int)sh.meter_mode + in->enc[HE_SELECT]) % NMETER + NMETER) % NMETER;
            ui.hot[0] = in->ms + 400u;
        }
        if (in->enc[HE_ALGO]) {          /* COUPLE: + the notes pull the others' steps toward them, - push away */
            sh.couple = m_clamp(sh.couple + (float)in->enc[HE_ALGO] * par_accel(b->speed[HE_ALGO]) * 0.05f, -1.0f, 1.0f);
            if (m_abs(sh.couple) < 0.024f)
                sh.couple = 0.0f;
            ui.hot[1] = in->ms + 400u;
        }
        if (in->enc[HE_PRESET]) {        /* TOKENS: how many effects travel */
            sh.ntok = (uint8_t)m_clampi((int)sh.ntok + in->enc[HE_PRESET], 0, NTOK);
            ui.hot[2] = in->ms + 400u;
        }
        if (in->enc[HE_K1]) {            /* LIFE: how many plays one stays at most */
            sh.life = (uint8_t)m_clampi((int)sh.life + in->enc[HE_K1], 1, 16);
            ui.hot[3] = in->ms + 400u;
        }
        if (in->enc[HE_K2]) {            /* HOP: which note a leaving effect takes */
            sh.hop = (uint8_t)(((int)sh.hop + in->enc[HE_K2]) % NHOP + NHOP) % NHOP;
            ui.hot[4] = in->ms + 400u;
        }
        if (in->enc[HE_K3]) {            /* REGIME: AUTO, or held at one */
            sh.regime_lock = (uint8_t)(((int)sh.regime_lock + in->enc[HE_K3]) % (NREG + 1) + NREG + 1) % (NREG + 1);
            if (sh.regime_lock)
                sh.regime = (uint8_t)(sh.regime_lock - 1);
            sh.regime_rev++;
            ui.hot[5] = in->ms + 400u;
        }
        if (in->enc[HE_K4]) {            /* SHIFT: how often a moving effect becomes another */
            sh.shift = m_clamp(sh.shift + (float)in->enc[HE_K4] * 0.05f, 0.0f, 1.0f);
            ui.hot[6] = in->ms + 400u;
        }
    }
    if (in->down >> BLACK[9] & 1u) {     /* GESTURE: fast spins and wiggles of the knobs as touch */
        sh.gesture = (uint8_t)!sh.gesture;
        mz_say("GESTURE", sh.gesture ? "ON" : "OFF");
    }
    if (in->down >> BLACK[10] & 1u) {
        T->p[VP_XMOD] = T->p[VP_XMOD] > 0.0f ? 0.0f : 2.5f;
        mz_say("XMOD", T->p[VP_XMOD] > 0.0f ? "FROM ABOVE" : "OFF");
    }
    /* buttons */
    for (i = 0; i < NT; i++)
        if (in->bdown & (1u << TRK_BTN[i])) {
            sh.t[i].on = (uint8_t)!sh.t[i].on;
            mz_say(VB_NAME[sh.t[i].kind], sh.t[i].on ? "IN" : "OUT");
            sh.plot_rev++;
        }
    if (in->bdown & (1u << HB_SEL)) {
        ui.sel_t = in->ms;
        ui.sel_done = 0;
    }
    if ((in->btn & (1u << HB_SEL)) && !ui.sel_done && in->ms - ui.sel_t >= 700u) {
        ui.sel_done = 1;
        trk_clear(T);
        mz_say("CLEAR", VB_NAME[T->kind]);
        sh.plot_rev++;
    }
    if ((in->bup & (1u << HB_SEL)) && !ui.sel_done) {
        thin(T);
        mz_say("THIN", VB_NAME[T->kind]);
        sh.plot_rev++;
    }
    if (in->bdown & (1u << HB_SAVE)) {
        ui.save_t = in->ms;
        ui.save_done = 0;
    }
    if ((in->btn & (1u << HB_SAVE)) && !ui.save_done && in->ms - ui.save_t >= 700u) {
        ui.save_done = 1;
        if (sh.has_snap) {
            for (i = 0; i < NT; i++)
                sh.t[i] = sh.snap[i];
            sh.tempo = sh.snap_tempo;
            mz_say("BACK", "TO THE KEPT ONE");
        } else {
            mz_say("NOTHING KEPT", "TAP SAVE FIRST");
        }
        sh.plot_rev++;
    }
    if ((in->bup & (1u << HB_SAVE)) && !ui.save_done) {
        for (i = 0; i < NT; i++)
            sh.snap[i] = sh.t[i];
        sh.snap_tempo = sh.tempo;
        sh.has_snap = 1;
        mz_say("KEPT", "HOLD SAVE = BACK");
    }
    /* GLO: a tap holds every change (or lets it go on); held, the knobs are the seven cables (the patch page) */
    if (in->bdown & (1u << HB_GLO)) {
        ui.glo_t = in->ms;
        ui.glo_knob = 0;
    }
    ui.patch_page = (uint8_t)((in->btn & (1u << HB_GLO)) && (in->ms - ui.glo_t >= 200u || ui.glo_knob));
    if (ui.patch_page != ui.patch_was) {
        ui.patch_was = ui.patch_page;
        sh.plot_rev++;
    }
    if (in->bup & (1u << HB_GLO)) {
        if (!ui.glo_knob && in->ms - ui.glo_t < 300u) {
            sh.frozen = (uint8_t)!sh.frozen;
            mz_say(sh.frozen ? "HOLD" : "CHANGING", sh.frozen ? "NO CHANGES" : "");
        }
        ui.patch_page = 0;
        sh.plot_rev++;
    }
    if (ui.patch_page)                   /* each knob turns one cable up or down (through 0: the other way) */
        for (i = 0; i < NCAB; i++)
            if (in->enc[i]) {
                sh.cab[i].depth = m_clamp(sh.cab[i].depth + (float)in->enc[i] * par_accel(b->speed[i]) * 0.04f,
                                          -1.0f, 1.0f);
                ui.glo_knob = 1;
                ui.hot[i] = in->ms + 400u;
                sh.cab_rev++;
            }
    if (in->bdown & (1u << HB_OCTDN)) {  /* half time, down to 20 (stopping is SELECT's, never a button's) */
        if (m_abs(sh.tempo) >= 40.0f) {
            sh.tempo *= 0.5f;
            mz_say("HALF TIME", "");
        } else if (m_abs(sh.tempo) > 20.0f) {
            sh.tempo = sh.tempo < 0.0f ? -20.0f : 20.0f;
            mz_say("HALF TIME", "20 BPM: SLOWEST");
        } else {
            mz_say("SLOWEST", "SELECT GOES TO 0");
        }
    }
    if (in->bdown & (1u << HB_OCTUP)) {  /* double time */
        sh.tempo = sh.tempo == 0.0f ? 30.0f : m_clamp(sh.tempo * 2.0f, -300.0f, 300.0f);
        mz_say("DOUBLE TIME", "");
    }
    if (!ui.fx_page && !ui.patch_page) {   /* the macros: each one moves many things */
        if (in->enc[HE_SELECT]) {            /* TEMPO; at 0 it stops (time stands still) and waits: after a pause the
                                              * same way goes on into backwards */
            float was = sh.tempo, t = sh.tempo + (float)in->enc[HE_SELECT] * par_accel(b->speed[HE_SELECT]);
            if (was != 0.0f && (t == 0.0f || (t < 0.0f) != (was < 0.0f) || m_abs(t) < 0.5f)) {
                t = 0.0f;
                ui.zero_t = in->ms;
                mz_say("STOPPED", "TEMPO 0: TIME STANDS");
            } else if (was == 0.0f && in->ms - ui.zero_t < 700u) {
                t = 0.0f;
                ui.zero_t = in->ms;
            }
            sh.tempo = m_clamp(t, -300.0f, 300.0f);
            ui.hot[0] = in->ms + 400u;
        }
        if (in->enc[HE_ALGO]) {              /* MOD: how far every cable moves things */
            sh.mod_amt = m_clamp(sh.mod_amt + (float)in->enc[HE_ALGO] * par_accel(b->speed[HE_ALGO]) * 0.02f, 0.0f, 1.5f);
            ui.hot[1] = in->ms + 400u;
        }
        if (in->enc[HE_PRESET]) {            /* DENS: thinner (notes fall out) or fuller (ghost notes come in) */
            sh.dens_g = m_clamp(sh.dens_g * m_exp2((float)in->enc[HE_PRESET] * par_accel(b->speed[HE_PRESET]) * 0.04f),
                                0.2f, 4.0f);
            ui.hot[2] = in->ms + 400u;
        }
        if (in->enc[HE_K1]) {                /* CHAOS: from order to wildness, in one turn */
            sh.chaos = m_clamp(sh.chaos + (float)in->enc[HE_K1] * par_accel(b->speed[HE_K1]) * 0.02f, 0.0f, 1.0f);
            ui.hot[3] = in->ms + 400u;
        }
        if (in->enc[HE_K2]) {                /* DRUMS: from round to metal */
            sh.drums = m_clamp(sh.drums + (float)in->enc[HE_K2] * par_accel(b->speed[HE_K2]) * 0.02f, 0.0f, 1.0f);
            ui.hot[4] = in->ms + 400u;
        }
        if (in->enc[HE_K3]) {                /* CHORD: how far the chords may go from the deep-house voicings */
            sh.chordx = m_clamp(sh.chordx + (float)in->enc[HE_K3] * par_accel(b->speed[HE_K3]) * 0.02f, 0.0f, 1.0f);
            ui.hot[5] = in->ms + 400u;
        }
        if (in->enc[HE_K4]) {                /* FBACK: the no-input layer */
            sh.ni_amt = m_clamp(sh.ni_amt + (float)in->enc[HE_K4] * par_accel(b->speed[HE_K4]) * 0.02f, 0.0f, 1.0f);
            ui.hot[6] = in->ms + 400u;
        }
        sh.plot_rev++;
    }
    /* the body */
    {
        static float rev_prev;
        if (b->revs > 1.2f && rev_prev <= 1.2f) {
            int k;
            for (k = 0; k < NT; k++)
                sh.t[k].momentum = -sh.t[k].momentum;
        }
        rev_prev = b->revs;
        if (b->onset_any >= 1.5f) {
            sh.fill_next = 1;
        }
    }
}

/* the meter as text, cut to fit what is left of a row's value (16 bytes with its end) */
static void meter_cat(char *v, const uint8_t *bars, int nb)
{
    char t[24];
    int q, used = 0, room;
    t[0] = 0;
    for (q = 0; q < nb && bars[q]; q++) {
        if (q)
            mz_cat(t, "+");
        mz_int(t, bars[q]);
    }
    while (v[used])
        used++;
    room = 15 - used;
    if (room <= 0)
        return;
    for (q = 0; t[q] && q < room; q++)
        v[used + q] = t[q];
    v[used + q] = 0;
}

static void gen_row(int i, mz_row_t *r)
{
    static const char *const LAB[HW_NENC] = {"METER", "COUPLE", "TOKENS", "LIFE", "HOP", "REGIME", "SHIFT"};
    int k;
    for (k = 0; LAB[i][k]; k++)
        r->label[k] = LAB[i][k];
    r->label[k] = 0;
    r->hot = hw_ms() < ui.hot[i];
    switch (i) {
    case 0:
        mz_cat(r->value, METER_NAME[sh.meter_mode]);
        if (sh.meter_mode == 1) {
            mz_cat(r->value, " ");
            meter_cat(r->value, sh.meter, sh.meter_n);
        }
        break;
    case 1:
        if (sh.couple >= 0.0f)
            mz_cat(r->value, "+");
        mz_fix(r->value, sh.couple, 2);
        mz_cat(r->value, sh.couple > 0.0f ? " PULL" : sh.couple < 0.0f ? " PUSH" : " FREE");
        break;
    case 2:
        mz_int(r->value, sh.ntok);
        mz_cat(r->value, " ON ");
        mz_int(r->value, tok_active());
        break;
    case 3:
        mz_cat(r->value, sh.life == 1 ? "ONCE" : "UP TO ");
        if (sh.life > 1) {
            mz_int(r->value, sh.life);
            mz_cat(r->value, " PLAYS");
        }
        break;
    case 4:
        mz_cat(r->value, HOP_NAME[sh.hop]);
        break;
    case 5:
        mz_cat(r->value, REG_LOCK_NAME[sh.regime_lock]);
        if (!sh.regime_lock) {
            mz_cat(r->value, " ");
            mz_cat(r->value, RG[sh.regime].name);
        }
        break;
    case 6:
        mz_fix(r->value, sh.shift, 2);
        break;
    }
}

static void patch_row(int i, mz_row_t *r)
{
    const cable_t *c = &sh.cab[i];
    int k;
    for (k = 0; SRC_NAME[c->src][k] && k < 6; k++)
        r->label[k] = SRC_NAME[c->src][k];
    r->label[k] = 0;
    r->hot = hw_ms() < ui.hot[i] || sh.cab_boost[i] > 0.0f;
    dst_cat(r->value, c->dst);
    mz_cat(r->value, c->depth >= 0.0f ? " +" : " ");
    mz_fix(r->value, c->depth, 1);
}

void pj_row(int i, mz_row_t *r)
{
    uint32_t now = hw_ms();
    if (ui.fx_page) {
        gen_row(i, r);
        return;
    }
    if (ui.patch_page) {
        patch_row(i, r);
        return;
    }
    r->hot = now < ui.hot[i];
    switch (i) {
    case 0:
        mz_cat(r->label, "TEMPO");
        mz_fix(r->value, sh.tempo, m_abs(sh.tempo) < 99.5f ? 1 : 0);
        mz_cat(r->value, " BPM");
        if (m_abs(st.spsec * 15.0f - sh.tempo) >= 1.0f) {   /* where it is now (the cables, the regime) */
            mz_cat(r->value, " ~");
            mz_fix(r->value, st.spsec * 15.0f, 0);
        }
        r->alert = sh.tempo <= 0.0f;
        break;
    case 1:
        mz_cat(r->label, "MOD");
        mz_fix(r->value, sh.mod_amt, 2);
        mz_cat(r->value, sh.mod_amt < 0.05f ? " STILL" : sh.mod_amt > 1.1f ? " WILD" : "");
        break;
    case 2:
        mz_cat(r->label, "DENS");
        mz_cat(r->value, "X");
        mz_fix(r->value, sh.dens_g, 2);
        mz_cat(r->value, " M");
        meter_cat(r->value, sh.meter_mode == 1 ? sh.meter : METERS[sh.meter_mode], sh.meter_mode == 1 ? sh.meter_n : 4);
        break;
    case 3:                              /* and how much it repeats now */
        mz_cat(r->label, "CHAOS");
        mz_fix(r->value, sh.chaos, 2);
        mz_cat(r->value, " R");
        mz_fix(r->value, sh.rep, 2);
        break;
    case 4:
        mz_cat(r->label, "DRUMS");
        mz_fix(r->value, sh.drums, 2);
        mz_cat(r->value, sh.drums < 0.2f ? " ROUND" : sh.drums > 0.8f ? " METAL" : "");
        break;
    case 5:
        mz_cat(r->label, "CHORD");
        mz_fix(r->value, sh.chordx, 2);
        mz_cat(r->value, sh.anchor & 0x80u ? " ~" : " ");
        mz_cat(r->value, ANCHOR_NAME[sh.anchor & 3u]);
        break;
    case 6:
        mz_cat(r->label, "FBACK");
        mz_fix(r->value, sh.ni_amt, 2);
        if (sh.frozen) {
            mz_cat(r->value, " HOLD");
            r->alert = 1;
        } else if (st.ni_open && st.ni_amt_now > 0.0f) {
            mz_cat(r->value, " OPEN");
        }
        break;
    }
}

void pj_status(char *s)
{
    int i;
    if (sh.tempo == 0.0f) {
        mz_cat(s, "STOPPED");
        return;
    }
    for (i = 0; i < NTOUCH; i++)         /* a touch effect held: its name */
        if (sh.touch[i] > 0.0f) {
            mz_cat(s, TOUCH_NAME[i]);
            mz_cat(s, " ");
        }
    if (s[0])
        return;
    if (sh.gen)
        mz_cat(s, sh.burst ? "BURST " : "GEN ");
    mz_cat(s, RG[sh.regime].name);
    if (sh.frozen)
        mz_cat(s, " HOLD");
    else if (sh.fill_held || sh.fill_next)
        mz_cat(s, " FILL");
}

uint32_t pj_plot_rev(void) { return sh.plot_rev; }

static void ops_plot(void)
{
    int i;
    for (i = 0; i < NOP; i++) {          /* each operator: its kind, track, period, energy (left of the middle: dying) */
        const oper_t *o = &sh.op[i];
        int y = 1 + i * 7, w = (int)(o->energy * 30.0f);
        char t[12];
        t[0] = 0;
        mz_cat(t, OP_NAME[o->kind]);
        scr_text(2, y, 1, t, C_VAL);
        t[0] = 0;
        mz_int(t, o->k + 1);
        mz_cat(t, "/");
        mz_int(t, o->period);
        scr_text(40, y, 1, t, C_LAB);
        scr_hline(70, y + 3, 120, C_RULE);
        if (w > 0)
            hw_fill(130, y + 1, w > 60 ? 60 : w, 5, C_GRN);
        else if (w < 0)
            hw_fill(130 + (w < -60 ? -60 : w), y + 1, w < -60 ? 60 : -w, 5, C_RED);
        scr_vline(130, y, 7, C_DIMC);
        t[0] = 0;
        mz_int(t, o->acts > 999u ? 999 : o->acts);
        scr_text(204, y, 1, t, C_DIMC);
    }
}

/* the patch page's picture: each source moving (a bar up or down from the middle), the patched ones bright */
static void src_plot(void)
{
    int i, c;
    for (i = 0; i < NSRC; i++) {
        int x = 2 + i * 21, h = (int)(m_clamp(sh.src_v[i], -1.0f, 1.0f) * 22.0f), used = 0;
        for (c = 0; c < NCAB; c++)
            used |= sh.cab[c].src == i;
        scr_hline(x, 25, 16, C_RULE);
        if (h > 0)
            hw_fill(x + 3, 25 - h, 10, h, used ? C_GRN : C_DIMC);
        else if (h < 0)
            hw_fill(x + 3, 26, 10, -h, used ? C_VAL : C_DIMC);
        scr_text(x + 2, 52, 1, SRC_SHORT[i], used ? C_HOT : C_DIMC);
    }
}

void pj_plot(int h)
{
    int k, s;
    uint32_t now = hw_ms();
    (void)h;
    if (ui.fx_page) {
        ops_plot();
        return;
    }
    if (ui.patch_page) {
        src_plot();
        return;
    }
    for (k = 0; k < NT; k++) {
        trk_t *T = &sh.t[k];
        int y = 1 + k * 15;
        float lo = VP_LO[T->dest], span = VP_HI[T->dest] - lo;
        char sh3[4] = {VB_NAME[T->kind][0], VB_NAME[T->kind][1], VB_NAME[T->kind][2], 0};
        scr_text(0, y + 4, 1, sh3, !T->on ? C_DIMC : k == ui.trk ? C_HOT : C_LAB);
        for (s = 0; s < T->len; s++) {
            int x = 20 + s * 12;
            uint16_t frame = s == sh.pos[k] ? C_HOT : C_RULE;
            int flash = T->flash_step == s && now < T->flash_until;
            scr_rect(x, y, 11, 14, frame);
            if (T->trig[s])                  /* late steps drawn late: the lean shows */
                hw_fill(x + 2 + T->nudge[s] * 5 / 10, y + 2, 7 - T->nudge[s] * 5 / 10, 5,
                        flash ? C_HOT : !T->on ? C_DIMC : COND[T->cond[s]].type == C_ALW ? C_VAL : C_CYN);
            if (T->has[s]) {
                int hh = 1 + (int)(5.0f * m_clamp((T->val[s] - lo) / span, 0.0f, 1.0f));
                hw_fill(x + 2, y + 13 - hh, 7, hh, flash ? C_HOT : C_GRN);
            }
            {                            /* the travelling effects sitting here: a tick each, in its colour */
                int i, tx = x + 2;
                for (i = 0; i < NTOK; i++) {
                    const tok_t *t = &sh.tok[i];
                    if (t->on && !t->wait && t->k == k && t->s == s && tx <= x + 8) {
                        hw_fill(tx, y + 8, 2, 4, ACT_COL[t->type]);
                        tx += 3;
                    }
                }
            }
        }
        if (T->rate_i != RATE_ONE)
            scr_text(240 - scr_text_w(1, RATE_NAME[T->rate_i]), y + 4, 1, RATE_NAME[T->rate_i], C_CYN);
        else if (T->p[VP_XMOD] > 0.0f)
            scr_text(234, y + 4, 1, "&", C_CYN);
    }
}

uint32_t pj_lit_keys(void)
{
    uint32_t m = 1u << BLACK[ui.trk];   /* the selected track's key */
    int i;
    for (i = 0; i < NTOUCH; i++)         /* a touch effect on */
        if (sh.touch[i] > 0.0f)
            m |= 1u << WHITE[i];
    for (i = 0; i < NCAB; i++)           /* a cable held up, or a link that just fired */
        if (sh.cab_boost[i] > 0.0f || (sh.cab[i].dst >= D_STEP0 && sh.cab[i].dst < G_TEMPO && sh.cab[i].hi))
            m |= 1u << WHITE[8 + i];
    if (sh.boost_all > 0.0f)
        m |= 1u << WHITE[15];
    if (sh.gesture)
        m |= 1u << BLACK[9];
    return m;
}

uint32_t pj_dim_keys(void)
{
    uint32_t m = 0;
    int s;
    for (s = 0; s < 16; s++)
        m |= 1u << WHITE[s];
    for (s = 0; s < 11; s++)
        m |= 1u << BLACK[s];
    return m;
}

uint32_t pj_lit_buttons(void)
{
    uint32_t m = 0;
    int k;
    for (k = 0; k < NT; k++)
        if (sh.t[k].on)
            m |= 1u << TRK_BTN[k];
    if (!sh.frozen)
        m |= 1u << HB_GLO;
    if (sh.has_snap)
        m |= 1u << HB_SAVE;
    if (sh.gen)
        m |= 1u << HB_FX;
    return m;
}

uint32_t pj_dim_buttons(void)
{
    return (1u << HB_FX) | (1u << HB_SEL) | (1u << HB_SAVE) | (1u << HB_GLO) | (1u << HB_ARP) | (1u << HB_ENV) |
           (1u << HB_SEQ) | (1u << HB_LFO) | (1u << HB_OCTDN) | (1u << HB_OCTUP);
}
