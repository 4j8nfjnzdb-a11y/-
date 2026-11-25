/* bunki: the engine. See bunki.h for what it is; DESIGN.md for why it is so.
 *
 * Fixed point throughout:
 *   x, F (the map)          Q62 in int64, 1.0 = 2^62
 *   R                       Q60 in int64 (0 .. 4)
 *   phases                  uint32, a cycle = 2^32
 *   index, beta             cycles Q15 (one radian = 5215)
 *   levels, sines           Q15
 *   Lyapunov exponents      natural log, Q16
 * Signed right shifts are arithmetic (as gcc, clang and JieLi's clang do). */
#include "bunki.h"
#include "bk_tables.h"

#define RAD_Q15   5215                   /* one radian in cycles, Q15: 32768 / (2 pi) */
#define ICAP      24576                  /* the index's ceiling: 0.75 cycles (4.7 rad) */
#define BCAP      20860                  /* the feedback's ceiling: 4 rad */
#define LN2_Q16   45426
#define LOG2_2PI  173768                 /* log2(2 pi), Q16 */
#define L2_FLOOR  (-40 * 65536)          /* log2 of a derivative that is 0 (a superstable point) */
#define MU0       3277                   /* C = 1: the feedback loop's step moves x by 0.05 per unit, Q16 */
#define NU0       2608                   /* C = 1: the map's step moves beta by 0.5 rad per unit, cycles Q15 */
#define XEDGE     ((int64_t)1 << 22)     /* x stays 2^-40 off 0 and 1: 0 is a fixed point for every R, and
                                          * a voice pushed onto it (by C, or 1 -> 0) would be a sine for good */
#define DC_A      32744                  /* the output's DC blocker: a pole at ~5 Hz, Q15 */

/* the knob: u = 0 .. 22 (Q16); one unit per period doubling, then the chaotic band over 16 units.
 * The knots are the logistic map's doubling points r1 .. r6 (r_n: period 2^(n-1) -> 2^n). */
static const int32_t KU[8] = {0, 1, 2, 3, 4, 5, 6, 22};
static const uint32_t KSHIFT[7] = {0, 0, 0, 0, 0, 0, 4};          /* log2 of each segment's length in units */
static const int64_t KR[8] = {
    2997595911977802137,                 /* 2.6 */
    3458764513820540928,                 /* 3.0          r1 */
    3976990904375467144,                 /* 3.449489743  r2 */
    4086057989797223195,                 /* 3.544090360  r3 */
    4109481788257825377,                 /* 3.564407266  r4 */
    4114499479560526335,                 /* 3.568759420  r5 */
    4115574221754206619,                 /* 3.569691610  r6 */
    4611686018427387904,                 /* 4.0 */
};
#define R399 ((int64_t)4600156803381319434)   /* 3.99: the map that draws the initial states */

/* the period-delayed feedback's amount against u: its own cascade put at the same knob positions,
 * radians Q8. Measured on C4 by `build/bunki_test calibrate`: period 2 from 1.00 rad, 4 from 1.74,
 * 8 from 1.90, aperiodic from 1.93 (its later doublings are crowded: 16 and 32 lie within 0.03 rad) */
static const int32_t BU[6] = {0, 1, 2, 3, 6, 22};
static const int32_t BB[6] = {128, 256, 445, 486, 494, 768};

/* MIDI 120 .. 131 (C9 .. B9) phase steps; lower octaves shift right (Dinghy's) */
static const uint32_t INC_C9[12] = {
    815363807u, 863847862u, 915214929u, 969636441u, 1027294024u, 1088380105u,
    1153098554u, 1221665363u, 1294309365u, 1371273005u, 1452813141u, 1539201906u};

/* 8 / N, Q16: the mean field's 1/N without a division */
static const int32_t R8[BK_NV + 1] = {0, 524288, 262144, 174763, 131072, 104858, 87381, 74898, 65536};

/* ---- integers that give the same bits everywhere ---------------------------------------- */

static uint64_t mulshr(uint64_t a, uint64_t b, uint32_t s)       /* (a * b) >> s, 1 <= s <= 63 */
{
    uint64_t al = (uint32_t)a, ah = a >> 32, bl = (uint32_t)b, bh = b >> 32;
    uint64_t ll = al * bl, lh = al * bh, hl = ah * bl, hh = ah * bh;
    uint64_t mid = (ll >> 32) + (uint32_t)lh + (uint32_t)hl;
    uint64_t lo = (mid << 32) | (uint32_t)ll;
    uint64_t hi = hh + (lh >> 32) + (hl >> 32) + (mid >> 32);
    return (hi << (64u - s)) | (lo >> s);
}

static int64_t smulshr(int64_t a, int64_t b, uint32_t s)         /* the same, signed, rounded toward 0 */
{
    uint64_t ua = a < 0 ? 0u - (uint64_t)a : (uint64_t)a, ub = b < 0 ? 0u - (uint64_t)b : (uint64_t)b;
    uint64_t r = mulshr(ua, ub, s);
    return (a < 0) != (b < 0) ? -(int64_t)r : (int64_t)r;
}

static uint32_t msb64(uint64_t v)                                 /* the highest set bit, v > 0 */
{
    uint32_t n = 0;
    if (v >> 32) { n += 32; v >>= 32; }
    if (v >> 16) { n += 16; v >>= 16; }
    if (v >> 8)  { n += 8;  v >>= 8; }
    if (v >> 4)  { n += 4;  v >>= 4; }
    if (v >> 2)  { n += 2;  v >>= 2; }
    if (v >> 1)  { n += 1; }
    return n;
}

static int32_t log2_q16(uint64_t v)                               /* log2(v), Q16; v > 0 */
{
    uint32_t m = msb64(v), f, i, fr;
    uint64_t t = m >= 24 ? v >> (m - 24) : v << (24 - m);         /* 1.f with 24 fraction bits */
    f = (uint32_t)t & 0xFFFFFFu;
    i = f >> 16;
    fr = f & 0xFFFFu;
    return (int32_t)(m << 16) + (int32_t)(BK_LOG2_1P[i] + (((BK_LOG2_1P[i + 1] - BK_LOG2_1P[i]) * fr) >> 16));
}

static uint64_t isqrt64(uint64_t n)
{
    uint64_t r = 0, b = (uint64_t)1 << 62;
    while (b > n)
        b >>= 2;
    while (b) {
        if (n >= r + b) { n -= r + b; r = (r >> 1) + b; }
        else r >>= 1;
        b >>= 2;
    }
    return r;
}

static inline int32_t sn(uint32_t ph)                             /* sin(2 pi ph / 2^32), Q15 */
{
    uint32_t i = ph >> 22;
    int32_t a = BK_SIN[i], f = (int32_t)((ph >> 6) & 0xFFFFu);
    return a + (((BK_SIN[i + 1] - a) * f) >> 16);
}

static void zero(void *p, uint32_t n)
{
    uint8_t *b = (uint8_t *)p;
    while (n--)
        *b++ = 0;
}

/* ---- the map ---------------------------------------------------------------------------- */

int64_t bk_logistic(int64_t R, int64_t x)                         /* R x (1 - x) */
{
    uint64_t t = mulshr((uint64_t)x, (uint64_t)(BK_ONE - x), 62);   /* <= 2^60 */
    uint64_t y = mulshr((uint64_t)R, t, 60);
    return y > (uint64_t)BK_ONE ? BK_ONE : (int64_t)y;
}

static int32_t ln_q16(int32_t l2)                                 /* log2 -> natural log, Q16 */
{
    return (int32_t)(((int64_t)l2 * LN2_Q16) >> 16);
}

/* log2 |f'(x)| = log2 R + log2 |1 - 2x|, Q16 */
static int32_t log2_slope(int64_t R, int64_t x)
{
    int64_t a = BK_ONE - 2 * x;
    if (a < 0) a = -a;
    if (!a) return L2_FLOOR;
    return log2_q16((uint64_t)R) - (60 << 16) + log2_q16((uint64_t)a) - (62 << 16);
}

int64_t bk_R_of_u(int32_t u)
{
    uint32_t k;
    int32_t frac;
    if (u <= 0) return KR[0];
    if (u >= BK_U_MAX) return KR[7];
    for (k = 0; k < 6u && u >= (KU[k + 1] << 16); k++)
        ;
    frac = (u - (KU[k] << 16)) >> KSHIFT[k];                       /* Q16, 0 .. 1 */
    return KR[k] + smulshr(KR[k + 1] - KR[k], frac, 16);
}

int32_t bk_u_of_R(int64_t R)                                      /* the inverse, by bisection */
{
    int32_t lo = 0, hi = BK_U_MAX;
    if (R <= KR[0]) return 0;
    if (R >= KR[7]) return BK_U_MAX;
    while (hi - lo > 1) {
        int32_t mid = lo + ((hi - lo) >> 1);
        if (bk_R_of_u(mid) <= R) lo = mid;
        else hi = mid;
    }
    return lo;
}

static int32_t beta_of(const bk_engine_t *e, int32_t u)          /* cycles Q15 */
{
    int32_t b, k;
    if (e->par[BK_P_BETA] >= 0)
        return (e->par[BK_P_BETA] * RAD_Q15) >> 8;
    switch (e->par[BK_P_PATH]) {
    case BK_PATH_FBT:
    case BK_PATH_BOTH:
        for (k = 0; k < 4 && u >= (BU[k + 1] << 16); k++)
            ;
        b = BB[k] + (BB[k + 1] - BB[k]) * (u - (BU[k] << 16)) / ((BU[k + 1] - BU[k]) << 16);   /* 32-bit */
        break;
    case BK_PATH_FB1:
        b = u * 1024 / BK_U_MAX;                                  /* 0 .. 4 rad, Q8 (32-bit) */
        break;
    default:
        return 0;
    }
    return (b * RAD_Q15) >> 8;
}

/* ---- voices ----------------------------------------------------------------------------- */

static int64_t seed_state(uint32_t seed, uint32_t note)          /* 0 .. 1, from the map at 3.99 */
{
    int64_t x = BK_ONE / 8 + ((int64_t)seed << 29);               /* 0.125 .. 0.625 */
    uint32_t i;
    for (i = 0; i < note + 7u; i++)
        x = bk_logistic(R399, x);
    if (x < ((int64_t)1 << 52)) x += (int64_t)1 << 52;
    if (x > BK_ONE - ((int64_t)1 << 52)) x -= (int64_t)1 << 52;
    return x;
}

static int64_t fixed_point(int64_t R)                             /* 1 - 1/R (0 below R = 1), roughly */
{
    uint32_t r14 = (uint32_t)(R >> 46), inv;                      /* R, Q14 */
    if (r14 <= 16384u) return 0;
    inv = (1u << 31) / r14;                                       /* 1/R, Q17 */
    return BK_ONE - ((int64_t)inv << 45);
}

static void start(bk_engine_t *e, bk_voice_t *v, uint32_t inc, int64_t x0, uint32_t vel, uint32_t note)
{
    int32_t amp = v->amp;
    zero(v, sizeof *v);
    v->amp = amp;                                                 /* a stolen voice glides down to its new level */
    v->inc = inc;
    v->gate = (int32_t)(vel * 70u);                               /* 127 -> 8890 */
    v->att = v->gate / 220 + 1;                                   /* 5 ms */
    v->rel = v->gate / 6615 + 1;                                  /* 150 ms */
    v->age = ++e->ages;
    v->note = (uint8_t)note;
    v->active = 1;
    if (x0 < 0) x0 = 0;
    if (x0 > BK_ONE) x0 = BK_ONE;
    v->x = v->xp = v->F = x0;
}

void bk_voice_force(bk_engine_t *e, uint32_t vi, uint32_t inc, int64_t x0, uint32_t vel)
{
    if (vi < BK_NV)
        start(e, &e->v[vi], inc, x0, vel, 255u);
}

void bk_note(bk_engine_t *e, uint32_t note, uint32_t vel)
{
    uint32_t i, pick = 0, best = 0xFFFFFFFFu;
    int64_t xs;
    if (note > 127u)
        return;
    if (!vel) {
        for (i = 0; i < BK_NV; i++)
            if (e->v[i].note == note && e->v[i].gate)
                e->v[i].gate = 0;
        return;
    }
    for (i = 0; i < BK_NV; i++) {                                 /* the same note, else a free voice, else the oldest */
        const bk_voice_t *v = &e->v[i];
        uint32_t score = v->note == note && v->gate ? 0u
                       : !v->active ? 1u
                       : !v->gate ? 0x40000000u + (uint32_t)v->amp          /* released: the quietest */
                       : 0x80000000u + (v->age & 0x3FFFFFFFu);              /* held: the oldest */
        if (score < best) { best = score; pick = i; }
    }
    /* the same key always starts from the same state: a small step off the map's fixed point, drawn
     * from the seed by the map itself. Above R = 3 the orbit leaves the unstable fixed point: the
     * subharmonic grows in after the attack. */
    xs = seed_state(e->seed, note);
    start(e, &e->v[pick], INC_C9[note % 12u] >> (10u - note / 12u),
          fixed_point(e->R) + ((xs - BK_ONE / 2) >> 5), vel, note);
}

void bk_all_off(bk_engine_t *e)
{
    uint32_t i;
    for (i = 0; i < BK_NV; i++)
        e->v[i].gate = 0;
}

/* the index from the map's step d */
static int32_t index_of(int64_t d, int32_t g, int32_t lift, int32_t imax)
{
    uint64_t a = d < 0 ? 0u - (uint64_t)d : (uint64_t)d, m, I;
    m = lift == BK_LIFT_SQRT ? isqrt64(a) : a >> 31;              /* Q31 */
    I = (m * (uint64_t)g) >> 31;                                  /* cycles Q15 */
    if (I > (uint64_t)imax) I = (uint64_t)imax;
    return d < 0 ? -(int32_t)I : (int32_t)I;
}

/* the period-delayed feedback: this period's waveform at 64 phase points, each point one step of
 * w' = sin(theta + I sin(n theta) + beta w), evaluated exactly at the point (not written from the
 * samples, whose number per point varies: that would be a noise of the implementation's own) */
static void fbt_table(bk_voice_t *v, uint32_t ratio)
{
    const int16_t *wo;
    int16_t *wn;
    int32_t dI = v->I1 - v->I0, j;
    int64_t sacc = 0, lacc = 0;
    v->rd ^= 1u;
    wo = v->W[v->rd];
    wn = v->W[v->rd ^ 1u];
    for (j = 0; j < (int32_t)BK_FBK; j++) {
        uint32_t th = (uint32_t)j << 26, off;
        int32_t I = v->I0 + ((dI * j) >> 6), y;
        off = ((uint32_t)(I * sn(th * ratio)) << 2) + ((uint32_t)(v->beta * wo[j]) << 2);
        y = sn(th + off);
        wn[j] = (int16_t)y;
        sacc += (int64_t)y * BK_SIN[j << 4];
        if (!(j & 7)) {                                           /* the slope at 8 of the points */
            int32_t c = sn(th + off + 0x40000000u);
            uint32_t p;
            if (c < 0) c = -c;
            p = (uint32_t)c * (uint32_t)v->beta;
            lacc += p ? log2_q16(p) - (30 << 16) + LOG2_2PI : L2_FLOOR;
        }
    }
    v->sp = v->s;
    v->s = (int32_t)(sacc >> 20);                                 /* (2 / 64) sum, Q15 */
    {
        int32_t l = ln_q16((int32_t)(lacc >> 3));
        v->lyap_fb += (l - v->lyap_fb) >> 5;
        v->lsum_fb += l;
    }
}

/* the start of a period: the map's step, the index, the feedback's table */
static void period(bk_engine_t *e, bk_voice_t *v, int32_t gain, int32_t beta0, int32_t mu, int32_t nu)
{
    const int32_t eps = e->par[BK_P_EPS], path = e->par[BK_P_PATH];
    int64_t F = v->F, acc = 0, x, d;
    uint32_t j, N = 0;
    int32_t l2, b;

    /* the global coupling (Kaneko): x' = F + eps (mean of the F's - F), every F the latest published,
     * this voice's included. One voice: x' = F exactly */
    for (j = 0; j < BK_NV; j++)
        if (e->v[j].active) {
            acc += (e->v[j].F - F) >> 3;
            N++;
        }
    x = F + smulshr(smulshr(acc, R8[N ? N : 1], 16), eps, 16);
    if (path == BK_PATH_BOTH && mu)                               /* the feedback loop pushes the map */
        x += (int64_t)((v->s - v->sp) * mu) * ((int64_t)1 << 31);
    if (x < XEDGE) x = XEDGE;
    if (x > BK_ONE - XEDGE) x = BK_ONE - XEDGE;

    /* the map's own stretching along the orbit: log |f'(x_(k-1))|. Not (1 - eps) f': that is the
     * exponent across the synchronised state (whether the voices stay in step), and with it strong
     * coupling read as order and drove D's walk against the wall at R = 4 */
    l2 = log2_slope(e->R, v->x);
    l2 = ln_q16(l2 < L2_FLOOR ? L2_FLOOR : l2);
    v->lyap_map += (l2 - v->lyap_map) >> 5;
    v->lsum_map += l2;
    v->lcount++;

    v->xp = v->x;
    v->x = x;
    d = x - v->xp;

    v->I0 = v->I1;
    v->I1 = path == BK_PATH_MAP || path == BK_PATH_BOTH ? index_of(d, gain, e->par[BK_P_LIFT], v->imax) : 0;
    b = beta0;
    if (path == BK_PATH_BOTH && nu) {                             /* the map pushes the feedback */
        int64_t d31 = d >> 31;
        b += (int32_t)((d31 * nu) >> 31);
    }
    v->beta = b < 0 ? 0 : b > BCAP ? BCAP : b;
    if (path == BK_PATH_FBT || path == BK_PATH_BOTH)
        fbt_table(v, (uint32_t)e->par[BK_P_RATIO]);

    v->hist[v->nper & (BK_HIST - 1u)] = (int32_t)(x >> 32);
    v->nper++;
}

#ifndef BK_WALK_W
/* Tried in tests/bunki_test (7.) and build/walk.c: with a spring of 1.0 and a push of 0.25 R stood still
 * (pinned where push and spring balance) or shook a little; with these it walks, from the cascade into
 * chaos and back, but it gathers around the edge of chaos (u ~ 4-6) wherever the hand is */
#define BK_WALK_W 98304                  /* Q16: the fastest pace, 1.5 rad/s (at D = 1) */
#define BK_WALK_A 65536                  /* Q16: how hard lambda pushes, 1.0 (R per unit of lambda) */
#define BK_WALK_K 6554                   /* Q16: the spring to the hand, 0.1 */
#define BK_WALK_Z 13107                  /* Q16: damping, 0.2 */
#endif

/* R moving by itself (D > 0): pushed toward chaos where the voices are periodic (lambda < 0),
 * pushed back where they are chaotic, pulled to the hand's R by a spring, with inertia. Where it
 * stands on the diagram decides how it moves. */
static void walk(bk_engine_t *e, uint32_t n)
{
    const int64_t W_MAX = BK_WALK_W, A = BK_WALK_A, K = BK_WALK_K, Z = BK_WALK_Z;
    int64_t D = e->par[BK_P_D], dt = (int64_t)((n * 65536u) / BK_FS), R;
    if (D <= 0) {
        e->rho -= e->rho >> 6;                                    /* back to the hand, ~0.4 s */
        e->rhov = 0;
    } else {
        int64_t w = (((D * D) >> 16) * W_MAX) >> 16, w2 = (w * w) >> 16;
        int64_t L = e->lyap < -(2 << 16) ? -(2 << 16) : e->lyap > (1 << 16) ? (1 << 16) : e->lyap;
        int64_t pull = -A * L - ((K * e->rho) >> 16);             /* Q32 */
        int64_t acc = ((w2 * pull) >> 16) - ((((2 * Z * w) >> 16) * e->rhov) >> 16);
        e->rhov += (acc * dt) >> 16;
        e->rho += (e->rhov * dt) >> 16;
    }
    R = e->R_hand + e->rho * ((int64_t)1 << 28);
    if (R < KR[0] || R > KR[7]) {                                 /* the walls: stop there, bounce back softly */
        R = R < KR[0] ? KR[0] : KR[7];
        e->rho = (R - e->R_hand) >> 28;
        e->rhov = -(e->rhov >> 1);
    }
    e->R = R;
}

void bk_render(bk_engine_t *e, int32_t *out, uint32_t n)
{
    const int32_t path = e->par[BK_P_PATH], C = e->par[BK_P_C];
    const uint32_t ratio = (uint32_t)e->par[BK_P_RATIO], solo = (uint32_t)e->par[BK_P_SOLO];
    const int fbt = path == BK_PATH_FBT || path == BK_PATH_BOTH, fb1 = path == BK_PATH_FB1;
    int32_t gain, beta0, mu, nu;
    uint32_t i, k, na = 0;
    int32_t lsum = 0;

    /* once a block: the voices' mean Lyapunov exponent, R, the feedback amount, the ceilings */
    for (k = 0; k < BK_NV; k++) {
        const bk_voice_t *v = &e->v[k];
        int32_t l;
        if (!v->active || v->nper < 8u)
            continue;
        l = path == BK_PATH_FBT ? v->lyap_fb
          : path == BK_PATH_BOTH ? (v->lyap_fb > v->lyap_map ? v->lyap_fb : v->lyap_map) : v->lyap_map;
        lsum += l;
        na++;
    }
    e->lyap = na ? lsum / (int32_t)na : 0;                       /* 32-bit */
    walk(e, n);
    beta0 = beta_of(e, bk_u_of_R(e->R));
    gain = (e->par[BK_P_GAIN] * RAD_Q15) >> 8;
    mu = (int32_t)(((int64_t)(C < 0 ? -C : C) * MU0) >> 16);      /* mu nu > 0: cooperate, < 0: compete */
    nu = (int32_t)(((int64_t)C * NU0) >> 16);
    for (k = 0; k < BK_NV; k++) {
        bk_voice_t *v = &e->v[k];
        uint32_t nf = (uint32_t)(((uint64_t)v->inc * BK_FS) >> 32) * ratio;   /* the modulator, Hz */
        int32_t q = (int32_t)(18000u * RAD_Q15 / (nf ? nf : 1u)) - RAD_Q15;   /* (dev + 1) f_m <= 18 kHz */
        v->imax = q < 0 ? 0 : q > ICAP ? ICAP : q;
    }

    for (i = 0; i < n; i++) {
        uint32_t wrapped = 0;
        int32_t mix = 0;
        /* 1. phases; a voice whose period ends publishes f_R(x) first, so that the voices whose
         * periods end in the same frame take one synchronous step together */
        for (k = 0; k < BK_NV; k++) {
            bk_voice_t *v = &e->v[k];
            if (!v->active)
                continue;
            v->ph += v->inc;
            if (v->ph < v->inc) {
                v->wrap = 1;
                v->F = bk_logistic(e->R, v->x);
                wrapped = 1;
            }
        }
        /* 2. their steps */
        if (wrapped)
            for (k = 0; k < BK_NV; k++)
                if (e->v[k].wrap) {
                    e->v[k].wrap = 0;
                    period(e, &e->v[k], gain, beta0, mu, nu);
                }
        /* 3. the sound */
        for (k = 0; k < BK_NV; k++) {
            bk_voice_t *v = &e->v[k];
            uint32_t ph = v->ph, off;
            int32_t I, y, s;
            if (!v->active)
                continue;
            I = v->I0 + (((v->I1 - v->I0) * (int32_t)(ph >> 17)) >> 15);
            off = (uint32_t)(I * sn(ph * ratio)) << 2;
            if (fbt) {
                const int16_t *w = v->W[v->rd];
                uint32_t j = ph >> 26;
                int32_t w0 = w[j], fr = (int32_t)((ph >> 11) & 0x7FFFu);
                off += (uint32_t)(v->beta * (w0 + (((w[(j + 1u) & (BK_FBK - 1u)] - w0) * fr) >> 15))) << 2;
            } else if (fb1) {
                off += (uint32_t)(v->beta * ((v->y1 + v->y2) >> 1)) << 2;
            }
            y = sn(ph + off);
            if (fb1) {
                v->y2 = v->y1;
                v->y1 = y;
            }
            if (v->amp < v->gate) {
                v->amp += v->att;
                if (v->amp > v->gate) v->amp = v->gate;
            } else if (v->amp > v->gate) {
                v->amp -= v->rel;
                if (v->amp < v->gate) v->amp = v->gate;
            }
            s = (y * v->amp) >> 15;
            if (solo & (1u << k))
                mix += s;
            if (!v->amp && !v->gate)
                v->active = 0;                                    /* silent: leaves the mean field */
        }
        /* the DC blocker: an asymmetric index puts DC in the sound (a linear filter: it adds no
         * frequency, and a periodic sound stays as periodic) */
        e->dcy = (mix - e->dcx) * 256 + (int32_t)(((int64_t)e->dcy * DC_A) >> 15);   /* 8 more bits inside */
        e->dcx = mix;
        out[2u * i] += (e->dcy + 128) >> 8;
        out[2u * i + 1u] += (e->dcy + 128) >> 8;
    }
    e->frames += n;
}

/* ---- controls and telemetry ------------------------------------------------------------- */

void bk_set(bk_engine_t *e, uint32_t p, int32_t val)
{
    switch (p) {
    case BK_P_U: val = val < 0 ? 0 : val > BK_U_MAX ? BK_U_MAX : val; e->R_hand = bk_R_of_u(val); break;
    case BK_P_D: case BK_P_EPS: val = val < 0 ? 0 : val > 65536 ? 65536 : val; break;
    case BK_P_C: val = val < -65536 ? -65536 : val > 65536 ? 65536 : val; break;
    case BK_P_PATH: if (val < 0 || val >= BK_NPATHS) return; break;
    case BK_P_LIFT: val = val ? BK_LIFT_SQRT : BK_LIFT_LINEAR; break;
    case BK_P_RATIO: val = val < 1 ? 1 : val > 3 ? 3 : val; break;
    case BK_P_GAIN: val = val < 0 ? 0 : val > 2048 ? 2048 : val; break;
    case BK_P_SEED: e->seed = (uint32_t)val; break;
    case BK_P_BETA: val = val < 0 ? -1 : val > 1024 ? 1024 : val; break;
    case BK_P_SOLO: break;
    default: return;
    }
    e->par[p] = val;
}

void bk_init(bk_engine_t *e, uint32_t seed)
{
    zero(e, sizeof *e);
    e->seed = seed;
    e->par[BK_P_SEED] = (int32_t)seed;
    e->par[BK_P_PATH] = BK_PATH_MAP;
    e->par[BK_P_RATIO] = 1;
    e->par[BK_P_GAIN] = 4 << 8;
    e->par[BK_P_BETA] = -1;
    e->par[BK_P_SOLO] = 0xFF;
    e->R_hand = e->R = KR[0];
}

int32_t bk_voice_x(const bk_engine_t *e, uint32_t vi, uint32_t age)
{
    const bk_voice_t *v = &e->v[vi];
    return v->hist[(v->nper - 1u - age) & (BK_HIST - 1u)];
}

int bk_voice_period(const bk_engine_t *e, uint32_t vi, int32_t tol)
{
    uint32_t p, i;
    if (vi >= BK_NV || !e->v[vi].active || e->v[vi].nper < BK_HIST)
        return -1;
    for (p = 1; p <= 32u; p++) {
        for (i = 0; i + p < BK_HIST; i++) {
            int32_t a = bk_voice_x(e, vi, i), b = bk_voice_x(e, vi, i + p);
            if (a - b > tol || b - a > tol)
                break;
        }
        if (i + p >= BK_HIST)
            return (int)p;
    }
    return 0;
}

uint32_t bk_voices_active(const bk_engine_t *e)
{
    uint32_t k, m = 0;
    for (k = 0; k < BK_NV; k++)
        if (e->v[k].active)
            m |= 1u << k;
    return m;
}

void bk_lyap_reset(bk_engine_t *e)
{
    uint32_t k;
    for (k = 0; k < BK_NV; k++) {
        e->v[k].lsum_map = e->v[k].lsum_fb = 0;
        e->v[k].lcount = 0;
    }
}

void bk_diagram_column(int64_t R, uint16_t *bins, uint32_t nbins, uint32_t transient, uint32_t count)
{
    int64_t x = BK_ONE / 2 + (BK_ONE >> 12);
    uint32_t i, b;
    for (i = 0; i < transient; i++)
        x = bk_logistic(R, x);
    for (i = 0; i < count; i++) {
        x = bk_logistic(R, x);
        b = (uint32_t)(((uint64_t)(x >> 40) * nbins) >> 22);
        if (b >= nbins) b = nbins - 1u;
        if (bins[b] < 0xFFFFu) bins[b]++;
    }
}
