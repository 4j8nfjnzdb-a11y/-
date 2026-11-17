/* HENKA (変化): a Digitakt-like machine whose locks hold the inside of the sounds, not their notes, and whose time
 * itself changes.
 * Four tracks, each an FM voice from the bank (EDIT held: the voice page). Each track has its own length and its own
 * RATE against the tempo (1/4 .. 4: a track at 3/4 against one at 1 is time against time, not just polymeter), and
 * its steps: a trig fires the voice, a lock holds one of its numbers for that step, a condition decides (probability,
 * A:B, PRE, NEI, 1ST, FILL and their negations), a nudge makes it late (a fraction of a step).
 * Two kinds of change keep it moving. MUT (K4) changes the sound and the pattern, settling at each track's DENSITY (K3):
 * below it a trig appears, above it one goes, at it a lock moves on with momentum, a trig slides, a condition shifts.
 * TIME (ALGO) changes the time: nudges grow and drift (a groove that is found, not set: Tipographica's lean), a
 * track's length or its rate moves to a neighbour, and the tempo breathes by 1/f. Neither undoes itself. GLO holds
 * both; SAVE keeps a moment (held: back to it).
 * GEN (FX): a generator that marks steps with acts, each on its own step, not all at once: a ratchet, a pitch from a
 * harmonic field, a chord (two more voices from the field), an echo send, a stutter (the last moments of the mix
 * looped), a crush (sample-and-hold and fewer bits), a sweep (the index rising or falling through the note). Which
 * acts, where and how many follow a regime (PULSE, SONG, BREAK, DRIFT, VOID); a regime lasts a heavy-tailed number of
 * loops (mostly short, sometimes very long: no average length to settle into) and the next is chosen by the
 * period-doubling sequence of the logistic map at Feigenbaum's point (aperiodic, self-similar). At each change one
 * harmonic of the field moves, the echo changes, and the synth track starts to drift toward another place of the
 * bank (between the named sounds, never landing). Acts above a regime's share are taken away again, so a burst
 * (FX held) leaves marks that thin out: contrast, not an average.
 * The knobs act at once: SELECT the TEMPO (through 0: backwards), ALGO TIME, PRESET the track's RATE, K1 its TONE
 * (brightness), K2 its DECAY, K3 its DENSITY, K4 MUT. Holding a step key turns them to the step: PRESET its lock's
 * destination, K1 the lock, K2 the condition, K3 the nudge, K4 the track's length.
 * The hand: black keys 1-4 play the four tracks and choose one (velocity; pressure brightens), black 6-9 repeat a
 * track while held (pressure: faster), white keys are the steps of the chosen track (tap: trig on / off; hold and
 * press: a lock). ARP ENV / SEQ LFO: tracks 1 2 / 3 4 in and out. SEL: thin the track (held: clear it, acts too).
 * FX: GEN on / off (held: a burst). Black 5: FILL. OCT- / OCT+: half / double time. Black 10: the track's LFO;
 * 11: XMOD (the track above into this voice).
 * Sustained kinds (organ, pad, ...) fade over four of their track's steps here, so a struck one does not drone.
 * The body: turning back and forth reverses every track's momentum; moving after stillness makes the next loop a FILL. */
#include "par.h"
#include "fmvox.h"

const char PJ_NAME[] = "HENKA";

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
enum { A_RAT = 1, A_NOTE = 2, A_CHORD = 4, A_ECHO = 8, A_STUT = 16, A_CRUSH = 32, A_SWEEP = 64, A_CUT = 128, NACT = 8 };
static const uint16_t ACT_COL[NACT] = {C_VAL, C_HOT, C_GRN, C_CYN, C_RED, C_LAB, C_VAL2, C_DIMC};
/* the regimes: the acts' weights (RAT NOTE CHORD ECHO STUT CRUSH SWEEP CUT), the tracks' weights, the echo (in steps)
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
    {"PULSE", {0.40f, 0.10f, 0.00f, 0.10f, 0.05f, 0.20f, 0.05f, 0.25f}, {1.0f, 1.0f, 1.0f, 0.5f}, 0.75f, 0.35f,
     0.4f, {0.06f, 0.0f, 0.12f, 0.0f}, 1.0f, 0x5, 1.0f, 24},
    {"SONG", {0.05f, 0.40f, 0.30f, 0.15f, 0.00f, 0.00f, 0.05f, 0.10f}, {0.2f, 0.3f, 0.3f, 1.0f}, 1.5f, 0.5f,
     0.7f, {0.0f, -0.04f, -0.05f, 0.35f}, 1.2f, 0x1, 0.94f, 24},
    {"BREAK", {0.25f, 0.05f, 0.00f, 0.05f, 0.30f, 0.20f, 0.00f, 0.25f}, {1.0f, 1.0f, 0.8f, 0.6f}, 0.333f, 0.3f,
     1.6f, {0.12f, 0.15f, 0.05f, 0.05f}, 1.6f, 0xF, 1.06f, 16},
    {"DRIFT", {0.00f, 0.30f, 0.15f, 0.30f, 0.00f, 0.00f, 0.25f, 0.05f}, {0.3f, 0.4f, 0.4f, 1.0f}, 2.0f, 0.65f,
     0.35f, {-0.04f, 0.0f, -0.08f, 0.2f}, 0.8f, 0x0, 0.82f, 24},
    {"VOID", {0.00f, 0.20f, 0.10f, 0.50f, 0.00f, 0.00f, 0.10f, 0.10f}, {0.5f, 0.5f, 0.5f, 0.5f}, 3.0f, 0.7f,
     0.25f, {-0.12f, -0.1f, -0.15f, 0.0f}, 0.4f, 0x1, 0.9f, 3},
};
/* a travelling effect: it sits on a note for LIFE plays, then waits for the next note its HOP rule lets it take; it
 * may turn into another effect when it moves, and when two meet one of them does */
typedef struct {
    uint8_t on, wait, type, k, s, life, skip, from, note, rat, left_now;
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
    uint8_t pact[NT], pnote[NT], prat[NT];
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

static void defaults(void)
{
    trk_reset(&sh.t[0], VB_KICK, VP_DEC, 16, 0.19f);
    sh.t[0].trig[0] = 1;                 /* one kick on the first step: the simplest place */
    trk_reset(&sh.t[1], VB_SNARE, VP_NOISE, 12, 0.12f);
    trk_reset(&sh.t[2], VB_HAT, VP_DEC, 7, 0.2f);
    trk_reset(&sh.t[3], VB_SYNTH, VP_INDEX, 5, 0.25f);
    sh.tempo = 112.0f;
    sh.mut = 0.2f;
    sh.time = 0.3f;
    sh.tempo_w = 1.0f;
    sh.tempo_r = 1.0f;
    sh.frozen = 0;
    /* GEN: off until FX; the field starts as harmonics 4..10 without 8 (a seventh and a ninth among them) */
    sh.gen = 0;
    sh.burst = 0;
    sh.regime = 1;                       /* SONG first: the synth track is heard at once */
    sh.dwell = 4;
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
    sh.life = 2;
    sh.hop = H_NEXT;
    sh.regime_lock = 0;
    sh.meter_mode = 1;
    sh.couple = 0.35f;
    sh.shift = 0.4f;
    sh.meter[0] = 16;
    sh.meter[1] = 12;
    sh.meter_n = 2;
    sh.hopc = 0;
    sh.regime_rev++;
}

/* the tracks follow their slots (EDIT's voice page, ALGO): a new kind puts the track's numbers at that kind's place;
 * an empty slot falls back to slot 1, so one source can play all four tracks */
static uint32_t slot_seen = 0xFFFFFFFFu;
static void follow_slots(void)
{
    static const uint8_t OWN[NT] = {VB_KICK, VB_SNARE, VB_HAT, VB_SYNTH};
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
    mz_slot_set(0, 1 + VB_KICK);         /* henka starts with four sources; empty a slot and it plays slot 1's */
    mz_slot_set(1, 1 + VB_SNARE);
    mz_slot_set(2, 1 + VB_HAT);
    mz_slot_set(3, 1 + VB_SYNTH);
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

static void mutate(int k)
{
    trk_t *T = &sh.t[k];
    float range = VP_HI[T->dest] - VP_LO[T->dest], r = m_rnd(&sh.seed);
    float dens = m_clamp(T->density + (sh.gen ? RG[sh.regime].dens[k] : 0.0f), 0.0f, 1.0f);
    int n = trig_count(T), target = (int)(dens * (float)T->len + 0.5f), s = -1;
    if (n < target) {                    /* below its density: a trig (and maybe a lock) where there was none */
        s = pick(T, 0);
        if (s >= 0) {
            T->trig[s] = 1;
            if (m_rnd(&sh.seed) < 0.5f) {
                T->has[s] = 1;
                T->val[s] = vp_clamp(T->dest, T->p[T->dest] + T->momentum * range * (0.05f + 0.2f * m_rnd(&sh.seed)));
            }
            T->cond[s] = (uint8_t)(m_rnd(&sh.seed) < 0.55f ? 0 : 1 + (int)(m_rnd(&sh.seed) * (float)(NCOND - 1)));
        }
    } else if (n > target) {             /* above it: one goes */
        s = pick(T, 1);
        if (s >= 0)
            T->trig[s] = T->has[s] = 0;
    } else if (r < 0.45f && n) {         /* at it: a lock moves on, with momentum; a wall turns it */
        s = pick(T, 1);
        if (s >= 0) {
            if (!T->has[s]) {
                T->has[s] = 1;
                T->val[s] = T->p[T->dest];
            }
            T->val[s] += T->momentum * range * (0.03f + 0.07f * m_rnd(&sh.seed));
            if (T->val[s] >= VP_HI[T->dest] || T->val[s] <= VP_LO[T->dest]) {
                T->momentum = -T->momentum;
                T->val[s] = vp_clamp(T->dest, T->val[s]);
            }
        }
    } else if (r < 0.65f && n) {         /* a trig slides to a free neighbour, its lock and condition with it */
        s = pick(T, 1);
        if (s >= 0) {
            int d = (m_rnd(&sh.seed) < 0.5f ? 1 : T->len - 1), t = (s + d) % T->len;
            if (!T->trig[t]) {
                T->trig[t] = 1;
                T->has[t] = T->has[s];
                T->val[t] = T->val[s];
                T->cond[t] = T->cond[s];
                T->trig[s] = T->has[s] = 0;
                s = t;
            }
        }
    } else if (r < 0.9f && n) {          /* a condition shifts to a neighbour */
        s = pick(T, 1);
        if (s >= 0)
            T->cond[s] = (uint8_t)((T->cond[s] + (m_rnd(&sh.seed) < 0.5f ? 1 : NCOND - 1)) % NCOND);
    } else {                             /* the destination moves to another number (its locks keep their place) */
        static const uint8_t DESTS[] = {VP_PITCH, VP_SWEEP, VP_RATIO, VP_INDEX, VP_IDEC, VP_FB, VP_NOISE, VP_METAL,
                                        VP_DEC, VP_XMOD};
        int d = DESTS[(int)(m_rnd(&sh.seed) * 10.0f) % 10], i;
        for (i = 0; i < NS; i++)
            T->val[i] = vp_clamp(d, T->p[d] + (T->val[i] - T->p[T->dest]) / range * (VP_HI[d] - VP_LO[d]));
        T->dest = (uint8_t)d;
    }
    T->flash_step = (int8_t)(s < 0 ? 0 : s);
    T->flash_until = hw_ms() + 600u;
    sh.plot_rev++;
}

/* TIME: the time changes, one thing at a time, never undone: a nudge grows or shrinks (with momentum: a lean that keeps
 * leaning until a wall), the track's length or its rate moves to a neighbour */
static void time_mutate(int k)
{
    trk_t *T = &sh.t[k];
    float r = m_rnd(&sh.seed);
    int s;
    if (r < 0.16f && T->len > 1) {       /* the whole pattern turns by a step: the same shape in another place */
        int dir = T->tmom > 0 ? 1 : -1, i, from;
        trk_t c = *T;
        for (i = 0; i < T->len; i++) {
            from = ((i - dir) % T->len + T->len) % T->len;
            T->trig[i] = c.trig[from];
            T->has[i] = c.has[from];
            T->cond[i] = c.cond[from];
            T->nudge[i] = c.nudge[from];
            T->val[i] = c.val[from];
        }
        for (i = 0; i < NTOK; i++)       /* the effects on it turn with it */
            if (sh.tok[i].on && !sh.tok[i].wait && sh.tok[i].k == k)
                sh.tok[i].s = (uint8_t)(((int)sh.tok[i].s + dir + T->len) % T->len);
    } else if (r < 0.6f && (s = pick(T, 1)) >= 0) {
        int nv = T->nudge[s] + T->tmom * (1 + (int)(m_rnd(&sh.seed) * 2.0f));
        if (nv > 10 || nv < 0) {
            T->tmom = (int8_t)-T->tmom;
            nv = nv > 10 ? 10 : 0;
        }
        T->nudge[s] = (uint8_t)nv;
        T->flash_step = (int8_t)s;
        T->flash_until = hw_ms() + 600u;
    } else if (r < 0.82f) {
        T->len = (uint8_t)m_clampi(T->len + (m_rnd(&sh.seed) < 0.5f ? 1 : -1), 2, NS);
    } else {
        T->rate_i = (uint8_t)m_clampi(T->rate_i + (m_rnd(&sh.seed) < 0.5f ? 1 : -1), 0, NRATE - 1);
    }
    sh.plot_rev++;
}

/* ---- GEN ---- */
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
    if (sh.meter_mode == 1) {            /* AUTO: one bar of the meter moves, or one comes, or one goes */
        float r = m_rnd(&sh.seed);
        int i = (int)(m_rnd(&sh.seed) * (float)sh.meter_n) % sh.meter_n;
        if (r < 0.55f)
            sh.meter[i] = (uint8_t)m_clampi((int)sh.meter[i] + (m_rnd(&sh.seed) < 0.5f ? -1 : 1) *
                                                                   (1 + (int)(m_rnd(&sh.seed) * 3.0f)), 3, 16);
        else if (r < 0.78f && sh.meter_n < 4)
            sh.meter[sh.meter_n++] = (uint8_t)(3 + (int)(m_rnd(&sh.seed) * 13.0f));
        else if (sh.meter_n > 1)
            sh.meter_n--;
    }
    {                                    /* one pull between two tracks turns: +1 0 -1 */
        int a = (int)(m_rnd(&sh.seed) * (float)NT) % NT, b = (a + 1 + (int)(m_rnd(&sh.seed) * 3.0f)) % NT;
        sh.cm[a][b] = (int8_t)(sh.cm[a][b] > 0 ? -1 : sh.cm[a][b] < 0 ? 0 : 1);
    }
    /* how many bars it lasts: Pareto (alpha 1.2): mostly one to three, now and then dozens; no length to average to */
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

/* how many plays it stays: mostly one, sometimes up to LIFE */
static uint8_t life_pick(void)
{
    float u = m_rnd(&sh.seed);
    return (uint8_t)(1 + (int)((float)sh.life * u * u));
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
static uint8_t on_onset(int k, int p, uint8_t *note, uint8_t *rat)
{
    uint8_t acts = 0;
    int i;
    *note = 0;
    *rat = 2;
    if (!sh.gen)
        return 0;
    for (i = 0; i < NTOK; i++)
        sh.tok[i].left_now = 0;
    for (i = 0; i < NTOK; i++) {         /* the effects sitting here */
        tok_t *t = &sh.tok[i];
        if (!t->on || t->wait || t->k != k || t->s != p)
            continue;
        acts |= (uint8_t)(1u << t->type);
        if (t->type == 1 || t->type == 2)
            *note = t->note;
        if (t->type == 0)
            *rat = t->rat;
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
        acts |= (uint8_t)(1u << t->type);
        if (t->type == 1 || t->type == 2)
            *note = t->note;
        if (t->type == 0)
            *rat = t->rat;
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
        T->p[d] = vp_clamp(d, T->p[d] + (VB_POINT[sh.morph][d] - T->p[d]) * 0.05f);
    }
}

/* ---- the voices ---- */
/* track k's numbers now: the base, this step's lock, the LFO, the slot's settings, the hand, GEN's note and sweep */
static void coefs_one(int k, uint32_t n)
{
    trk_t *T = &sh.t[k];
    const mz_slot_t *v = mz_voice(k);
    float p[NVP], per = (float)T->len * 3.0f / m_max(0.25f, m_abs(st.spsec));
    int d;
    for (d = 0; d < NVP; d++)
        p[d] = T->p[d];
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
    p[VP_INDEX] = vp_clamp(VP_INDEX, p[VP_INDEX] + sh.live_bright[k] + T->tone);
    if (p[VP_DEC] < VP_HELD)
        p[VP_DEC] = vp_clamp(VP_DEC, p[VP_DEC] * T->dec_x);
    vox_gate(p, 4.0f * T->dec_x / m_max(0.25f, m_abs(st.spsec) * RATES[T->rate_i]));   /* four of its steps */
    if (st.cut[k])                       /* a cut: this note short */
        p[VP_DEC] = vp_clamp(VP_DEC, p[VP_DEC] * 0.12f);
    vox_coefs(&st.kk[k], p);
    if (st.swp[k])                       /* a sweep: the index rises (or falls) about 45 times over the step */
        st.kk[k].k_idx = m_exp2((st.swp[k] > 0 ? 5.5f : -5.5f) / m_max(64.0f, st.sps[k]));
    st.lvl[k] = VB_LEVEL[T->kind] * (v ? m_db2lin(v->level_db) : 1.0f);
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
    st.s_left = (uint32_t)(sps * (m_rnd(&st.rseed) < 0.6f ? 1.0f : 2.0f));
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
        st.h_lvl[j] = st.lvl[k] * gain * 0.5f;
    }
    st.h_trk = k;
}

/* the strike of track k's step, with its marks (now, or late: a nudge) */
static void fire(int k, float gain)
{
    static const uint8_t CRUSH[4] = {3, 5, 9, 17};
    uint8_t a = st.pact[k];
    int j;
    st.cut[k] = (uint8_t)((a & A_CUT) != 0);
    st.note_r[k] = (a & A_NOTE) ? note_ratio(st.pnote[k]) : 1.0f;
    if (sh.gen && sh.couple != 0.0f)     /* its sound pulls (or pushes) the others' step clocks: phases interact */
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
        if (!sh.frozen && m_rnd(&sh.seed) < m_min(1.0f, (sh.mut + 0.5f * sh.energy) * per_step))
            mutate(k);
        if (!sh.frozen && m_rnd(&sh.seed) < m_min(1.0f, sh.time * 0.6f * per_step))
            time_mutate(k);
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
    if ((T->trig[p] || T->has[p]) && cond_eval(k, T->cond[p])) {
        if (T->has[p]) {
            st.lock[k] = T->val[p];
            st.locked[k] = 1;
        }
        if (T->trig[p] && T->on) {
            st.pact[k] = on_onset(k, p, &st.pnote[k], &st.prat[k]);   /* the travelling effects on this note */
            if (T->nudge[p]) {           /* late by a fraction of its own step */
                st.pend[k] = 1u + (uint32_t)((float)T->nudge[p] * (1.0f / 16.0f) * samples_per_step);
                st.pend_gain[k] = 1.0f;
            } else {
                fire(k, 1.0f);
            }
        }
    }
    sh.plot_rev++;
}

static inline int16_t sat16(float x)
{
    x *= 16384.0f;                       /* +-2 fits */
    return (int16_t)(x > 32767.0f ? 32767.0f : x < -32767.0f ? -32767.0f : x);
}

void pj_render(float *out_l, float *out_r, const float *inl, const float *inr, uint32_t n)
{
    static const float HPAN[2] = {-0.45f, 0.45f};
    uint32_t i;
    int k, j;
    float dstep, efb;
    (void)inl, (void)inr;
    if (sh.home_req != st.home_seen) {
        st.home_seen = sh.home_req;
        pj_reset_audio();
    }
    if (++st.breath_n >= 86u) {          /* the tempo's breath: 1/f, about four new values a second */
        st.breath_n = 0;
        sh.tempo_w += ((1.0f + sh.time * 0.07f * pink_next(&st.breath, &sh.seed)) - sh.tempo_w) * 0.3f;
    }
    sh.tempo_r += ((sh.gen ? RG[sh.regime].tempo : 1.0f) - sh.tempo_r) * 0.004f;   /* over a few seconds */
    st.spsec = sh.tempo * sh.tempo_w * sh.tempo_r * (4.0f / 60.0f);
    dstep = m_abs(st.spsec) * M_INV_SR;
    coefs(n);
    {                                    /* the echo: the regime's length in steps of the tempo */
        const regime_t *R = &RG[sh.regime];
        float d = R->echo_steps * M_SR / m_max(0.5f, m_abs(st.spsec));
        st.echo_d = (uint32_t)m_clamp(d, 64.0f, (float)(ECHO_N - 2u));
        efb = R->echo_fb;
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
            if (sh.gen && !sh.frozen && sh.dwell && --sh.dwell == 0)
                new_regime();
        }
        st.base_ph += dstep;             /* the meter: bars of changing length; the following tracks start again */
        if (st.base_ph >= 1.0f) {
            st.base_ph -= 1.0f;
            if (sh.gen && sh.meter_mode) {
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
            float rate = RATES[sh.t[k].rate_i];
            st.ph[k] += dstep * rate;
            if (st.ph[k] >= 1.0f) {
                st.ph[k] -= 1.0f;
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
                    st.crush_y[k] = m_floor(y * 12.0f + 0.5f) * (1.0f / 12.0f);
                if (++st.crush_c[k] >= st.crush[k])
                    st.crush_c[k] = 0;
                y = st.crush_y[k];
            }
            ein += y * st.send[k];
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
        /* the echo: darker each time round; the right side reads a third later */
        e1 = (float)echo_buf[(st.ew - st.echo_d) & (ECHO_N - 1u)] * (1.0f / 16384.0f);
        e2 = (float)echo_buf[(st.ew - st.echo_d - st.echo_d / 3u) & (ECHO_N - 1u)] * (1.0f / 16384.0f);
        st.e_lp += (e1 - st.e_lp) * 0.35f;
        st.e_lp2 += (e2 - st.e_lp2) * 0.35f;
        echo_buf[st.ew & (ECHO_N - 1u)] = sat16(ein + st.e_lp * efb);
        st.ew++;
        l = l * 0.5f + st.e_lp * 0.45f;
        r = r * 0.5f + st.e_lp2 * 0.45f;
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
        out_l[i] = l;
        out_r[i] = r;
    }
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
    /* white keys: the steps of the selected track */
    for (i = 0; i < 16; i++) {
        uint32_t bit = 1u << WHITE[i];
        if (in->down & bit) {
            ui.held_step = i;
            ui.held_t = in->ms;
            ui.held_pressed = 0;
        }
        if ((in->keys & bit) && ui.held_step == i && WHITE[i] < HW_NPRESS && in->prs[WHITE[i]] > 20 && i < T->len) {
            float p = (float)in->prs[WHITE[i]] * (1.0f / 127.0f);
            T->has[i] = 1;
            T->val[i] = T->p[T->dest] + (VP_HI[T->dest] - T->p[T->dest]) * p;
            ui.held_pressed = 1;
            sh.plot_rev++;
        }
        if ((in->up & bit) && ui.held_step == i) {
            if (!ui.held_pressed && in->ms - ui.held_t < 350u && i < T->len) {
                T->trig[i] = (uint8_t)!T->trig[i];
                if (!T->trig[i])
                    T->has[i] = 0;
                mz_say(T->trig[i] ? "TRIG" : "NO TRIG", VB_NAME[T->kind]);
            }
            ui.held_step = -1;
            sh.plot_rev++;
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
    if ((in->btn & (1u << HB_FX)) && !ui.fx_burst && !ui.fx_knob && in->ms - ui.fx_t >= 700u) {
        ui.fx_burst = 1;
        sh.gen = 1;
        sh.burst = 1;
        mz_say("BURST", RG[sh.regime].name);
    }
    if (in->bup & (1u << HB_FX)) {
        if (ui.fx_burst || ui.fx_knob) {
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
            sh.life = (uint8_t)m_clampi((int)sh.life + in->enc[HE_K1], 1, 8);
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
    if (in->down >> BLACK[9] & 1u) {
        T->lfo_depth = T->lfo_depth >= 0.39f ? 0.0f : T->lfo_depth < 0.04f ? 0.05f : T->lfo_depth < 0.14f ? 0.15f : 0.4f;
        mz_say("LFO", T->lfo_depth == 0.0f ? "OFF" : T->lfo_depth < 0.1f ? "5%" : T->lfo_depth < 0.2f ? "15%" : "40%");
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
    if (in->bdown & (1u << HB_GLO)) {
        sh.frozen = (uint8_t)!sh.frozen;
        mz_say(sh.frozen ? "HOLD" : "CHANGING", sh.frozen ? "NO CHANGES" : "");
    }
    if (in->bdown & (1u << HB_OCTDN)) {  /* half time */
        sh.tempo = m_abs(sh.tempo) < 2.0f ? 0.0f : sh.tempo * 0.5f;
        mz_say("HALF TIME", "");
    }
    if (in->bdown & (1u << HB_OCTUP)) {  /* double time */
        sh.tempo = sh.tempo == 0.0f ? 30.0f : m_clamp(sh.tempo * 2.0f, -300.0f, 300.0f);
        mz_say("DOUBLE TIME", "");
    }
    if (!ui.fx_page) {
        /* encoders: at once on the track; with a step key held, on the step. Fast turning goes further */
        if (in->enc[HE_SELECT]) {            /* TEMPO, through 0 into backwards */
            sh.tempo = m_clamp(sh.tempo + (float)in->enc[HE_SELECT] * par_accel(b->speed[HE_SELECT]), -300.0f, 300.0f);
            if (m_abs(sh.tempo) < 0.5f)
                sh.tempo = 0.0f;
            ui.hot[0] = in->ms + 400u;
        }
        T = &sh.t[ui.trk];
        if (in->enc[HE_ALGO]) {              /* TIME: how much the time itself changes */
            sh.time = m_clamp(sh.time + (float)in->enc[HE_ALGO] * par_accel(b->speed[HE_ALGO]) * 0.02f, 0.0f, 1.0f);
            ui.hot[1] = in->ms + 400u;
        }
        {
            int hs = ui.held_step >= 0 && ui.held_step < T->len ? ui.held_step : -1;
            if (in->enc[HE_PRESET]) {
                if (hs >= 0) {               /* the lock's destination */
                    int d = ((T->dest + in->enc[HE_PRESET]) % NVP + NVP) % NVP;
                    for (i = 0; i < NS; i++)
                        T->val[i] = vp_clamp(d, T->p[d] + (T->val[i] - T->p[T->dest]) / (VP_HI[T->dest] - VP_LO[T->dest])
                                                           * (VP_HI[d] - VP_LO[d]));
                    T->dest = (uint8_t)d;
                    ui.held_pressed = 1;
                } else {                     /* RATE: the track against the tempo */
                    T->rate_i = (uint8_t)m_clampi(T->rate_i + in->enc[HE_PRESET], 0, NRATE - 1);
                }
                ui.hot[2] = in->ms + 400u;
                sh.plot_rev++;
            }
            if (in->enc[HE_K1]) {
                float det = (float)in->enc[HE_K1] * par_accel(b->speed[HE_K1]);
                if (hs >= 0) {               /* the lock */
                    int d = T->dest;
                    T->has[hs] = 1;
                    if (VP_LOGSTEP[d])
                        T->val[hs] = vp_clamp(d, T->val[hs] * m_exp2(det * (1.0f / 24.0f)));
                    else
                        T->val[hs] = vp_clamp(d, T->val[hs] + det * (VP_HI[d] - VP_LO[d]) * 0.005f);
                    ui.held_pressed = 1;
                } else {                     /* TONE */
                    T->tone = m_clamp(T->tone + det * 0.1f, -12.0f, 12.0f);
                }
                ui.hot[3] = in->ms + 400u;
                sh.plot_rev++;
            }
            if (in->enc[HE_K2]) {
                if (hs >= 0) {               /* the condition */
                    T->cond[hs] = (uint8_t)(((T->cond[hs] + in->enc[HE_K2]) % NCOND + NCOND) % NCOND);
                    ui.held_pressed = 1;
                } else {                     /* DECAY */
                    T->dec_x = m_clamp(T->dec_x * m_exp2((float)in->enc[HE_K2] * par_accel(b->speed[HE_K2]) * (1.0f / 8.0f)),
                                       0.05f, 16.0f);
                }
                ui.hot[4] = in->ms + 400u;
                sh.plot_rev++;
            }
            if (in->enc[HE_K3]) {
                if (hs >= 0) {               /* the nudge */
                    T->nudge[hs] = (uint8_t)m_clampi(T->nudge[hs] + in->enc[HE_K3], 0, 10);
                    T->trig[hs] = 1;
                    ui.held_pressed = 1;
                } else {                     /* DENSITY */
                    T->density = m_clamp(T->density + (float)in->enc[HE_K3] * par_accel(b->speed[HE_K3]) * 0.02f, 0.0f,
                                         1.0f);
                }
                ui.hot[5] = in->ms + 400u;
                sh.plot_rev++;
            }
            if (in->enc[HE_K4]) {
                if (hs >= 0) {               /* the track's length */
                    T->len = (uint8_t)m_clampi(T->len + in->enc[HE_K4], 1, NS);
                    ui.held_pressed = 1;
                } else {                     /* MUT */
                    sh.mut = m_clamp(sh.mut + (float)in->enc[HE_K4] * par_accel(b->speed[HE_K4]) * 0.01f, 0.0f, 1.0f);
                }
                ui.hot[6] = in->ms + 400u;
                sh.plot_rev++;
            }
        }
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
        if (sh.meter_mode == 1)
            for (k = 0; k < sh.meter_n; k++) {
                mz_cat(r->value, k ? "+" : " ");
                mz_int(r->value, sh.meter[k]);
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
        mz_cat(r->value, "1-");
        mz_int(r->value, sh.life);
        mz_cat(r->value, sh.life == 1 ? " PLAY" : " PLAYS");
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

void pj_row(int i, mz_row_t *r)
{
    trk_t *T = &sh.t[ui.trk];
    uint32_t now = hw_ms();
    int hs = ui.held_step >= 0 && ui.held_step < T->len ? ui.held_step : -1, d = T->dest;
    if (ui.fx_page) {
        gen_row(i, r);
        return;
    }
    r->hot = now < ui.hot[i] || (hs >= 0 && i >= 2);
    switch (i) {
    case 0:
        mz_cat(r->label, "TEMPO");
        mz_fix(r->value, sh.tempo, m_abs(sh.tempo) < 99.5f ? 1 : 0);
        mz_cat(r->value, " BPM");
        if (m_abs(sh.tempo * sh.tempo_w * sh.tempo_r - sh.tempo) >= 1.0f) {   /* where it is now (TIME, GEN) */
            mz_cat(r->value, " ~");
            mz_fix(r->value, sh.tempo * sh.tempo_w * sh.tempo_r, 0);
        }
        r->alert = sh.tempo <= 0.0f;
        break;
    case 1:
        mz_cat(r->label, "TIME");
        mz_fix(r->value, sh.time, 2);
        if (sh.gen && sh.meter_mode) {   /* the meter now */
            const uint8_t *bars = sh.meter_mode == 1 ? sh.meter : METERS[sh.meter_mode];
            int nb = sh.meter_mode == 1 ? sh.meter_n : 4, q;
            mz_cat(r->value, " M");
            for (q = 0; q < nb && bars[q]; q++) {
                if (q)
                    mz_cat(r->value, "+");
                mz_int(r->value, bars[q]);
            }
        } else {
            mz_cat(r->value, " T");
            mz_fix(r->value, sh.tempo * sh.tempo_w * sh.tempo_r, 1);
        }
        break;
    case 2:
        if (hs >= 0) {
            mz_cat(r->label, "DEST");
            mz_cat(r->value, VP_NAME[d]);
        } else {                         /* the track the knobs act on is named here */
            mz_cat(r->label, "RATE");
            mz_cat(r->value, "X");
            mz_cat(r->value, RATE_NAME[T->rate_i]);
            mz_cat(r->value, " ");
            mz_int(r->value, ui.trk + 1);
            mz_cat(r->value, T->on ? VB_NAME[T->kind] : "OUT");
        }
        break;
    case 3:
        if (hs >= 0) {
            mz_cat(r->label, "LOCK");
            mz_fix(r->value, T->has[hs] ? T->val[hs] : T->p[d], VP_DECIMALS[d]);
            mz_cat(r->value, " ");
            mz_cat(r->value, VP_UNIT[d]);
        } else {
            mz_cat(r->label, "TONE");
            if (T->tone >= 0.0f)
                mz_cat(r->value, "+");
            mz_fix(r->value, T->tone, 1);
        }
        break;
    case 4:
        if (hs >= 0) {
            mz_cat(r->label, "COND");
            mz_cat(r->value, COND[T->cond[hs]].name);
        } else {
            mz_cat(r->label, "DECAY");
            mz_cat(r->value, "X");
            mz_fix(r->value, T->dec_x, 2);
        }
        break;
    case 5:
        if (hs >= 0) {
            mz_cat(r->label, "NUDGE");
            mz_int(r->value, T->nudge[hs]);
            mz_cat(r->value, "/16 LATE");
        } else {
            mz_cat(r->label, "DENS");
            mz_int(r->value, (int32_t)(T->density * 100.0f + 0.5f));
            mz_cat(r->value, "% ");
            mz_int(r->value, trig_count(T));
            mz_cat(r->value, "/");
            mz_int(r->value, T->len);
        }
        break;
    case 6:
        if (hs >= 0) {
            mz_cat(r->label, "LEN");
            mz_int(r->value, T->len);
            mz_cat(r->value, " STEPS");
        } else {
            mz_cat(r->label, "MUT");
            mz_fix(r->value, sh.mut, 2);
            if (sh.frozen) {
                mz_cat(r->value, " HOLD");
                r->alert = 1;
            } else {
                mz_cat(r->value, " +");
                mz_fix(r->value, 0.5f * sh.energy, 2);
            }
        }
        break;
    }
}

void pj_status(char *s)
{
    if (sh.gen) {
        mz_cat(s, sh.burst ? "BURST " : "GEN ");
        mz_cat(s, RG[sh.regime].name);
    } else {
        mz_cat(s, "FX: GEN");
    }
    if (sh.frozen)
        mz_cat(s, " HOLD");
    else if (sh.fill_held || sh.fill_next)
        mz_cat(s, " FILL");
}

uint32_t pj_plot_rev(void) { return sh.plot_rev; }

void pj_plot(int h)
{
    int k, s;
    uint32_t now = hw_ms();
    (void)h;
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
    trk_t *T = &sh.t[ui.trk];
    uint32_t m = 1u << BLACK[ui.trk];   /* the selected track's play key */
    int s;
    for (s = 0; s < T->len && s < 16; s++)
        if (T->trig[s])
            m |= 1u << WHITE[s];
    if (sh.pos[ui.trk] >= 0 && sh.pos[ui.trk] < 16)
        m |= 1u << WHITE[sh.pos[ui.trk]];
    return m;
}

uint32_t pj_dim_keys(void)
{
    trk_t *T = &sh.t[ui.trk];
    uint32_t m = 0;
    int s;
    for (s = 0; s < T->len; s++)
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
