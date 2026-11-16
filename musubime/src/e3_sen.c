/* SEN (線): a line of single sounds, one after another, none above another: no beat, no accent, no grouping the
 * machine imposes (after Jo Kondo's "music of lines": see docs/DESIGN.md for what is from him and what is not).
 * The line is played round and round. After each pass exactly ONE thing changes: one sound, one of its eight
 * dimensions (register, ratio, index, feedback, duration, loudness, attack, the gap after it). The change is never
 * undone: each sound's dimensions sit on a torus, and each change moves one coordinate by an irrational step, so the
 * line as a whole never comes back to a state it was in (a value may pass near an old one; the line does not return).
 * Which sound changes follows the logistic map at Feigenbaum's point (the onset of chaos): aperiodic, but with a
 * self-similar preference for some places, so a listener may sense a rule without being able to predict it. Which
 * dimension: a walk over the eight, never the same twice in a row.
 * It begins as three identical thin sines and grows (a sound splits in two, slightly apart) toward LENGTH.
 * The body: the hand's energy enlarges the steps; turning back and forth reverses their direction; stillness makes
 * them smaller (to a fifth after a few minutes), so the line settles toward near-repetition without stopping;
 * moving after stillness makes a change at once, far along the line. A white key points at a sound: the next changes
 * go there, as large as it is pressed. */
#include "par.h"
#include "fm.h"

const char PJ_NAME[] = "SEN";

#define MAXL 32
enum { K_FREQ, K_RATIO, K_INDEX, K_FB, K_DUR, K_AMP, K_ATT, K_GAP, NK };
static const char *const KNAME[NK] = {"REG", "RATIO", "INDEX", "FB", "DUR", "AMP", "ATT", "GAP"};
/* each dimension's step on its torus is a different irrational fraction of STEP */
static const float KALPHA[NK] = {0.6180340f, 0.4142136f, 0.7320508f, 0.2360680f, 0.6457513f, 0.1622777f,
                                 0.6055513f, 0.1231056f};

typedef struct {
    float th[NK];                        /* turns: 0 = the simple place */
    int8_t dir[NK];
} ev_t;

static const char *const FOCUS_NAMES[] = {"AUTO", "REG", "RATIO", "INDEX", "FB", "DUR", "AMP", "ATT", "GAP"};
enum { G_LEN, G_FOCUS, G_STEP, G_THIN, G_TIME, G_GAPX, G_REG, NPAR };
static const par_def_t DEF[NPAR] = {
    {"LENGTH", P_INT, 0, 1, MAXL, 1, 1, "", 0, 1, MAXL},
    {"FOCUS", P_ENUM, 0, 0, 8, 1, 1, "", FOCUS_NAMES, 0, 8},
    {"STEP", P_LOG, 3, 0.0f, 0.5f, 6.0f, 0.004f, "TURN", 0, 0.0f, 0.2f},
    {"THIN", P_LIN, 2, 0.0f, 1.0f, 0.01f, 0, "", 0, 0.0f, 1.0f},
    {"TIME", P_LOG, 2, 0.1f, 8.0f, 12.0f, 0.25f, "X", 0, 0.25f, 4.0f},
    {"GAP X", P_LIN, 2, 0.0f, 6.0f, 0.02f, 0, "", 0, 0.0f, 4.0f},
    {"REG", P_LOG, 0, 30.0f, 6000.0f, 24.0f, 30.0f, "HZ", 0, 40.0f, 3000.0f},
};
static par_t P[NPAR];

static struct {
    ev_t ev[MAXL];
    int len;
    volatile uint32_t home_req;
    int point;                           /* a sound pointed at (-1 none) */
    float point_amt;
    uint8_t frozen;
    float sign;                          /* the body's direction */
    float energy;
    uint32_t still;
    volatile uint32_t jump_req;
    uint32_t changes, passes;
    int last_ev, last_k;
    int now_ev;
    uint32_t plot_rev;
    uint32_t seed;
} sh;

static struct {
    uint32_t home_seen, jump_seen;
    int e;                               /* the sound playing */
    uint32_t t, dur_n, att_n, gap_n;
    float env, dec_k, amp, fade;
    op_t car, mod;
    float lf, ratio, index, fb;
    float x;                             /* the logistic map's state */
    int k;                               /* the dimension walk */
    uint32_t grow_count;
} st;

/* a dimension's value from its torus coordinate */
static float val(const ev_t *e, int k)
{
    float c = 0.5f - 0.5f * m_sin_t(e->th[k] + 0.25f);   /* 0 at th = 0, 1 at th = 1/2 */
    float s = m_sin_t(e->th[k]);
    switch (k) {
    case K_FREQ: return 1.3f * s;                        /* octaves from REG */
    case K_RATIO: return 1.0f + 2.73f * c;
    case K_INDEX: return 5.5f * c;
    case K_FB: return 1.3f * s;
    case K_DUR: return 0.45f * m_exp2(1.6f * s);       /* seconds, before TIME */
    case K_AMP: return 0.5f * m_exp2(-2.2f * c);
    case K_ATT: return 0.03f + 0.6f * c;               /* of the duration */
    case K_GAP: return 0.14f * m_exp2(2.0f * s);        /* seconds, before GAP X */
    }
    return 0.0f;
}

static void line_reset(void)
{
    int i, k;
    sh.len = 3;
    for (i = 0; i < MAXL; i++)
        for (k = 0; k < NK; k++) {
            sh.ev[i].th[k] = 0.0f;
            sh.ev[i].dir[k] = 1;
        }
    sh.changes = sh.passes = 0;
    sh.last_ev = -1;
    sh.last_k = 0;
    sh.sign = 1.0f;
}

static void defaults(void)
{
    int i;
    for (i = 0; i < NPAR; i++)
        par_set(&DEF[i], &P[i], 0.0f);
    par_set(&DEF[G_LEN], &P[G_LEN], 13.0f);
    par_set(&DEF[G_STEP], &P[G_STEP], 0.11f);
    par_set(&DEF[G_THIN], &P[G_THIN], 0.35f);
    par_set(&DEF[G_TIME], &P[G_TIME], 0.7f);
    par_set(&DEF[G_GAPX], &P[G_GAPX], 1.0f);
    par_set(&DEF[G_REG], &P[G_REG], 330.0f);
    line_reset();
    sh.point = -1;
    sh.frozen = 0;
}

void pj_init(uint32_t seed)
{
    sh.seed = seed | 1u;
    defaults();
    pj_reset_audio();
}

void pj_home(void)
{
    defaults();
    sh.home_req++;
    sh.plot_rev++;
}

void pj_reset_audio(void)
{
    st.e = -1;
    st.t = st.dur_n = st.gap_n = 0;
    st.env = 0.0f;
    st.car.ph = st.mod.ph = 0;
    st.car.y = st.mod.y = 0.0f;
    st.x = 0.3141f;
    st.k = 0;
}

/* one change: one sound, one dimension, never undone */
static void change(int far)
{
    int j, k, focus = (int)P[G_FOCUS].v;
    float d;
    st.x = logistic_next(st.x);
    if (!(st.x > 0.0f && st.x < 1.0f))
        st.x = 0.3141f;
    j = (int)(st.x * (float)sh.len);
    if (far)
        j = (j + sh.len / 2) % sh.len;
    if (sh.point >= 0 && sh.point < sh.len)
        j = sh.point;
    if (focus)
        k = focus - 1;
    else {
        st.k = (st.k + 1 + (int)(st.x * 2.999f)) % NK;   /* never the same dimension twice running */
        k = st.k;
    }
    if (j >= sh.len)
        j = sh.len - 1;
    d = P[G_STEP].v * KALPHA[k] * (1.0f + 2.0f * sh.energy) * (sh.point >= 0 ? 0.5f + 3.0f * sh.point_amt : 1.0f);
    d *= m_max(0.2f, 1.0f / (1.0f + (float)sh.still * (1.0f / 40000.0f)));   /* stillness: smaller changes */
    sh.ev[j].th[k] += d * (float)sh.ev[j].dir[k] * sh.sign;
    sh.ev[j].th[k] -= m_floor(sh.ev[j].th[k]);         /* on the torus */
    sh.last_ev = j;
    sh.last_k = k;
    sh.changes++;
    sh.plot_rev++;
}

/* the line grows toward LENGTH: a sound splits, the copy a little apart in one dimension */
static void grow(void)
{
    int target = (int)P[G_LEN].v, j, i, k;
    if (sh.len > target) {
        sh.len = target;
        return;
    }
    if (sh.len >= target || ++st.grow_count < 3u)
        return;
    st.grow_count = 0;
    st.x = logistic_next(st.x);
    j = (int)(st.x * (float)sh.len);
    if (j >= sh.len)
        j = sh.len - 1;
    for (i = sh.len; i > j + 1; i--)
        sh.ev[i] = sh.ev[i - 1];
    sh.ev[j + 1] = sh.ev[j];
    k = (int)(m_rnd(&sh.seed) * (float)NK) % NK;
    sh.ev[j + 1].th[k] += 0.03f + 0.05f * m_rnd(&sh.seed);
    sh.len++;
    sh.plot_rev++;
}

static void start_event(void)
{
    const ev_t *e = &sh.ev[st.e];
    float dur = val(e, K_DUR) * P[G_TIME].v, gap = val(e, K_GAP) * P[G_TIME].v * P[G_GAPX].v;
    float att = val(e, K_ATT);
    st.dur_n = (uint32_t)(m_clamp(dur, 0.02f, 12.0f) * M_SR);
    st.gap_n = (uint32_t)(m_clamp(gap, 0.0f, 12.0f) * M_SR);
    st.att_n = (uint32_t)((float)st.dur_n * att) + 32u;
    st.dec_k = m_exp2(-4.3f / (float)(st.dur_n > st.att_n ? st.dur_n - st.att_n : 1u));   /* to -26 dB at its end */
    st.amp = val(e, K_AMP);
    st.lf = val(e, K_FREQ);
    st.ratio = val(e, K_RATIO);
    st.index = val(e, K_INDEX);
    st.fb = val(e, K_FB);
    st.t = 0;
    st.env = 0.0f;
    sh.now_ev = st.e;
    sh.plot_rev++;
}

static void next_event(void)
{
    st.e++;
    if (st.e >= sh.len || st.e < 0) {    /* a pass ends: exactly one change */
        st.e = 0;
        sh.passes++;
        if (!sh.frozen)
            change(0);
        grow();
    }
    start_event();
}

void pj_render(float *l, float *r, const float *inl, const float *inr, uint32_t n)
{
    uint32_t i;
    float thin = P[G_THIN].v, reg = P[G_REG].v;
    (void)inl, (void)inr;
    if (sh.home_req != st.home_seen) {
        st.home_seen = sh.home_req;
        pj_reset_audio();
    }
    if (sh.jump_req != st.jump_seen) {
        st.jump_seen = sh.jump_req;
        change(1);
    }
    for (i = 0; i < n; i++) {
        float y = 0.0f;
        if (st.e < 0)
            next_event();
        if (st.t < st.dur_n) {
            float f = reg * m_exp2(st.lf), m, g;
            if (st.t < st.att_n)
                st.env = (float)st.t / (float)st.att_n;
            else
                st.env *= st.dec_k;
            g = st.env;
            if (st.dur_n - st.t < 96u)       /* the last 2 ms to nothing: no click into the next */
                g *= (float)(st.dur_n - st.t) * (1.0f / 96.0f);
            m = op_run(&st.mod, m_inc(f * st.ratio), st.fb * 0.159f * st.mod.y);
            /* THIN: 0 a pure line, 1 the whole index */
            y = op_run(&st.car, m_inc(f), st.index * thin * 0.159f * m) * g * st.amp * (0.35f + 0.65f * thin);
        }
        st.t++;
        if (st.t >= st.dur_n + st.gap_n)
            next_event();
        l[i] = y;
        r[i] = y;
    }
}

void pj_control(const mz_in_t *in, const mz_body_t *b)
{
    static const int ENC_PAR[HW_NENC] = {G_LEN, G_FOCUS, G_STEP, G_THIN, G_TIME, G_GAPX, G_REG};
    static const uint8_t WHITE[16] = {0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24, 26};
    static const uint8_t BLACK[11] = {1, 3, 5, 8, 10, 13, 15, 17, 20, 22, 25};
    int i, pointed = -1;
    float amt = 0.0f;
    for (i = 0; i < HW_NENC; i++)
        if (in->enc[i]) {
            par_turn(&DEF[ENC_PAR[i]], &P[ENC_PAR[i]], in->enc[i], i < 2 ? 1.0f : par_accel(b->speed[i]), in->ms);
            sh.plot_rev++;
        }
    for (i = 0; i < 16; i++)
        if (in->keys >> WHITE[i] & 1u) {
            float p = WHITE[i] < HW_NPRESS ? (float)in->prs[WHITE[i]] * (1.0f / 127.0f) : 0.0f;
            float v = (float)in->vel[WHITE[i]] * (1.0f / 127.0f);
            pointed = i;
            amt = m_max(p, 0.3f * v);
        }
    sh.point = pointed;
    sh.point_amt = amt;
    for (i = 0; i < 11; i++) {
        if (!(in->down >> BLACK[i] & 1u))
            continue;
        if (i < 8) {
            par_set(&DEF[G_FOCUS], &P[G_FOCUS], (float)(i + 1));
            mz_say("FOCUS", KNAME[i]);
        } else if (i == 8) {
            par_set(&DEF[G_FOCUS], &P[G_FOCUS], 0.0f);
            mz_say("FOCUS", "AUTO");
        } else if (i == 9) {
            sh.frozen = (uint8_t)!sh.frozen;
            mz_say(sh.frozen ? "HOLD" : "MOVE", sh.frozen ? "NO CHANGES" : "ONE A PASS");
        } else {
            sh.sign = -sh.sign;
            mz_say("DIRECTION", sh.sign > 0.0f ? "+" : "-");
        }
        sh.plot_rev++;
    }
    sh.energy = b->energy;
    sh.still = b->still_all;
    {
        static float rev_prev;
        if (b->revs > 1.2f && rev_prev <= 1.2f) {
            sh.sign = -sh.sign;
            mz_say("DIRECTION", sh.sign > 0.0f ? "+" : "-");
        }
        rev_prev = b->revs;
    }
    if (b->onset_any >= 1.5f) {
        sh.jump_req++;
        mz_say("JUMP", "FAR ALONG");
    }
}

void pj_row(int i, mz_row_t *r)
{
    static const int ENC_PAR[HW_NENC] = {G_LEN, G_FOCUS, G_STEP, G_THIN, G_TIME, G_GAPX, G_REG};
    int p = ENC_PAR[i];
    par_row(&DEF[p], &P[p], r, hw_ms(), P[p].v);
    if (p == G_LEN) {
        r->value[0] = 0;
        mz_int(r->value, sh.len);
        mz_cat(r->value, " / ");
        mz_int(r->value, (int32_t)P[p].v);
    }
}

void pj_status(char *s)
{
    mz_cat(s, "N");
    mz_int(s, (int32_t)sh.changes);
    if (sh.last_ev >= 0) {
        mz_cat(s, " E");
        mz_int(s, sh.last_ev + 1);
        mz_cat(s, " ");
        mz_cat(s, KNAME[sh.last_k]);
    }
}

uint32_t pj_plot_rev(void) { return sh.plot_rev; }

/* the line: time across (one pass fills the width), register up, thickness = the index heard (THIN) */
void pj_plot(int h)
{
    float total = 0.0f, x = 0.0f, sc;
    int j, n = sh.len;
    for (j = 0; j < n; j++)
        total += val(&sh.ev[j], K_DUR) + val(&sh.ev[j], K_GAP) * P[G_GAPX].v;
    sc = 236.0f / m_max(total, 0.01f);
    scr_hline(0, h / 2, 240, C_RULE);
    for (j = 0; j < n; j++) {
        const ev_t *e = &sh.ev[j];
        float d = val(e, K_DUR) * sc, g = val(e, K_GAP) * P[G_GAPX].v * sc;
        int y = h / 2 - (int)(val(e, K_FREQ) * ((float)h * 0.36f));
        int th = 1 + (int)(val(e, K_INDEX) * P[G_THIN].v * 1.2f);
        uint16_t c = j == sh.now_ev ? C_HOT : j == sh.last_ev ? C_CYN : C_VAL;
        int w = (int)d < 1 ? 1 : (int)d;
        hw_fill(2 + (int)x, y - th / 2, w, th, c);
        if (j == sh.point)
            scr_vline(2 + (int)x, 0, h, C_RED);
        x += d + g;
    }
}

uint32_t pj_lit_keys(void)
{
    static const uint8_t WHITE[16] = {0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24, 26};
    uint32_t m = 0;
    if (sh.now_ev >= 0 && sh.now_ev < 16)
        m |= 1u << WHITE[sh.now_ev];
    return m;
}

uint32_t pj_dim_keys(void)
{
    static const uint8_t WHITE[16] = {0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24, 26};
    uint32_t m;
    int j;
    m = (1u << 1) | (1u << 3) | (1u << 5) | (1u << 8) | (1u << 10) | (1u << 13) | (1u << 15) | (1u << 17) |
        (1u << 20) | (1u << 22) | (1u << 25);
    for (j = 0; j < sh.len && j < 16; j++)
        m |= 1u << WHITE[j];
    return m;
}
