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
#define XEDGE     ((int64_t)1 << 24)     /* x stays 2^-38 off 0 and 1: 0 is a fixed point for every R, and
                                          * a voice pushed onto it (by C, or 1 -> 0) would be a sine for good.
                                          * (Not 2^22: ONE - 2^22 ends in the word 0xFFC00000, which fm1-dock's
                                          * build refuses as a reference into the chip's ROM) */
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

/* 1 / sqrt(N), Q15: the mix of N voices stays under full scale even when their peaks meet
 * (N sqrt(N)^-1 x 8890 <= 25145 for N = 8); one voice is as loud as before */
static const int32_t MIXG[BK_NV + 1] = {32768, 32768, 23170, 18919, 16384, 14654, 13377, 12385, 11585};

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

static void part_start(bk_engine_t *e, bk_voice_t *v, int64_t x0);

static void start(bk_engine_t *e, bk_voice_t *v, uint32_t inc, int64_t x0, int64_t xg, uint32_t vel, uint32_t note)
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
    v->held = 1;
    if (x0 < 0) x0 = 0;
    if (x0 > BK_ONE) x0 = BK_ONE;
    v->x = v->xp = v->F = x0;
    part_start(e, v, xg < 0 ? 0 : xg > BK_ONE ? BK_ONE : xg);
}

void bk_voice_force(bk_engine_t *e, uint32_t vi, uint32_t inc, int64_t x0, uint32_t vel)
{
    if (vi < BK_NV)
        start(e, &e->v[vi], inc, x0, x0, vel, 255u);
}

void bk_note(bk_engine_t *e, uint32_t note, uint32_t vel)
{
    uint32_t i, pick = 0, best = 0xFFFFFFFFu;
    int64_t xs;
    if (note > 127u)
        return;
    if (!vel) {
        for (i = 0; i < BK_NV; i++)
            if (e->v[i].note == note && e->v[i].gate) {
                e->v[i].held = 0;
                if (!e->par[BK_P_HOLD])                           /* HOLD: it keeps sounding */
                    e->v[i].gate = 0;
            }
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
    /* (the gesture layer starts nearer: 1/1024 off, not 1/64, so that below R = 3 it is on the key's pitch at
     * once, not gliding into it; above, the pattern grows out of the fixed point in ~11 steps) */
    start(e, &e->v[pick], INC_C9[note % 12u] >> (10u - note / 12u),
          fixed_point(e->R) + ((xs - BK_ONE / 2) >> 5), fixed_point(e->R) + ((xs - BK_ONE / 2) >> 9), vel, note);
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
    if (e->par[BK_P_FORCE])
        v->I1 = v->imax;                                          /* (a test: the sound must change) */
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

/* EVOLVE (D > 0): R climbs the cascade by itself, from the knob's R up: period 1, 2, 4, 8, chaos. Where the
 * voices find a window in the chaos (their Lyapunov exponent below 0) it lingers, as a system that has found
 * something stable holds on to it for a while; at R = 4 it turns and collapses back down to the knob, and
 * climbs again. A walk with a direction, not a wander: the diagram is crossed in the order it was drawn. */
static void evolve(bk_engine_t *e, uint32_t n)
{
    const int32_t D = e->par[BK_P_D], uk = e->par[BK_P_U];
    const int32_t dt = (int32_t)((n * 65536u) / BK_FS);           /* Q16 seconds */
    int32_t u;
    if (D <= 0) {
        e->ev -= e->ev >> 6;                                      /* back to the knob, ~0.4 s */
        if (e->ev < 64 && e->ev > -64) e->ev = 0;
        e->evdir = 1;
    } else {
        int32_t v = D >> 1;                                       /* units per second, Q16 */
        if (uk + e->ev > (6 << 16) && e->lyap < 0)
            v = (v * 5) >> 5;                                     /* a window: linger (1/6.4 of the pace) */
        if (e->evdir == 0) e->evdir = 1;
        e->ev += e->evdir * (int32_t)(((int64_t)v * dt) >> 16);
        if (uk + e->ev >= BK_U_MAX) { e->ev = BK_U_MAX - uk; e->evdir = -1; }
        if (e->ev <= 0) { e->ev = 0; e->evdir = 1; }
    }
    u = uk + e->ev;
    e->R = bk_R_of_u(u > BK_U_MAX ? BK_U_MAX : u);
}

/* ---- the gesture layer --------------------------------------------------------------------- */

static uint32_t cents_inc(uint32_t key, int32_t c_q4)            /* key's phase step moved by c cents (Q4) */
{
    int32_t e2 = (c_q4 * 3495) >> 10;                             /* octaves, Q16 (1 / (1200 * 16) = 3.413 / 65536) */
    int32_t ip = e2 >> 16;
    uint32_t f = (uint32_t)e2 & 0xFFFFu, i = f >> 8, fr = f & 0xFFu;
    uint64_t m = BK_EXP2[i] + (((BK_EXP2[i + 1] - BK_EXP2[i]) * fr) >> 8), r = ((uint64_t)key * m) >> 16;
    if (ip >= 0) r <<= ip;
    else r >>= -ip;
    return r > 0x70000000u ? 0x70000000u : (uint32_t)r;           /* under ~19 kHz */
}

static int32_t cents_of(const bk_engine_t *e, int64_t x, int64_t xs)   /* the map's distance from the fixed point */
{
    int64_t c = ((x - xs) >> 32) * (int64_t)e->par[BK_P_CENTS] * 32;   /* Q30 * cents * 2 * 16 -> Q30 */
    int32_t q = (int32_t)(c >> 30);
    return q < -3600 * 16 ? -3600 * 16 : q > 2400 * 16 ? 2400 * 16 : q;
}

/* a sine's pitch: the map's distance from the fixed point, an octave dealt by a lower digit of the map (OCT),
 * then drawn to the grid (MICRO: semitones .. sixteenth tones, or none) */
static int32_t pitch_of(const bk_engine_t *e, const bk_part_t *p, int64_t xs)
{
    const int32_t oct = e->par[BK_P_OCT], micro = e->par[BK_P_MICRO];
    int32_t c = cents_of(e, p->x, xs);
    if (oct > 0) {
        const uint32_t d = (uint32_t)(p->x >> (40 - 3 * (e->par[BK_P_OCTV] & 7))) & 0xFFFFu;
        c += ((int32_t)((d * (uint32_t)(2 * oct + 1)) >> 16) - oct) * 19200;
    }
    if (micro < 4) {
        const int32_t g = 1600 >> micro;                          /* 100, 50, 25, 12.5 cents, Q4 */
        c = (c >= 0 ? (c + g / 2) / g : -((-c + g / 2) / g)) * g;
    }
    return c < -7200 * 16 ? -7200 * 16 : c > 4800 * 16 ? 4800 * 16 : c;
}

static void part_start(bk_engine_t *e, bk_voice_t *v, int64_t x0)
{
    const int64_t xs = fixed_point(e->R);
    uint32_t j;
    for (j = 0; j < BK_NPART; j++) {
        bk_part_t *p = &v->part[j];
        /* the partials start a hair apart (2^-20 a step): in the periodic region they fall together, in the
         * chaotic one the difference grows (x e^lambda a step) until one sine has split into many */
        p->x = x0 + (int64_t)j * ((int64_t)1 << 42);
        if (p->x > BK_ONE - XEDGE) p->x = BK_ONE - XEDGE;
        p->F = p->x;
        p->ca = p->cb = pitch_of(e, p, xs);
        p->inc = p->inc_a = p->inc_b = cents_inc(v->inc, p->cb);
        p->ph = j << 29;                                          /* (not all in phase: no click) */
        p->amp = p->damp = p->pl = 0;
        p->gate = 1;
    }
}

/* one step of the step clock: every partial of every sounding voice takes one step of its map, together
 * (Kaneko's coupled maps, synchronous: one clock, so no pattern comes from clocks' ratios), then its pitch */
static void gesture_step(bk_engine_t *e)
{
    const int32_t np = e->par[BK_P_NPART], eps = e->par[BK_P_EPS], topo = e->par[BK_P_TOPO], chop = e->par[BK_P_CHOP];
    const int64_t R = e->R, xs = fixed_point(R);
    bk_part_t *all[BK_NV * BK_NPART];
    uint8_t vof[BK_NV * BK_NPART];
    int32_t n = 0, a, b, l2sum = 0;
    uint32_t k, j;
    for (k = 0; k < BK_NV; k++)
        if (e->v[k].active)
            for (j = 0; j < (uint32_t)np; j++) {
                bk_part_t *p = &e->v[k].part[j];
                /* each partial's R a hair apart (2^-30 R a partial): in fixed point, maps that fall together in
                 * the periodic region become the same bits, and the same bits never part again, not even in
                 * chaos; apart by a hair, they stay one pitch where it is periodic and split where it is not */
                p->F = bk_logistic(R + (int64_t)(j + 1u) * (R >> 30), p->x);
                l2sum += log2_slope(R, p->x) >> 4;
                vof[n] = (uint8_t)k;
                all[n++] = p;
            }
    if (!n)
        return;
    /* each group's sum of (F - its first F) / 64, once: a member's difference from the mean is then
     * (sum - cnt (F - F_first) / 64) * 64 / cnt, n steps instead of n^2 (one alone: exactly 0) */
    {
        int64_t gsum[BK_NV + 1];
        int32_t gcnt[BK_NV + 1], gfirst[BK_NV + 1];
        for (b = 0; b <= (int32_t)BK_NV; b++) { gsum[b] = 0; gcnt[b] = 0; gfirst[b] = -1; }
        for (b = 0; b < n; b++) {
            const int32_t g = topo == BK_TOPO_GLOBAL ? (int32_t)BK_NV : vof[b];
            if (gfirst[g] < 0) gfirst[g] = b;
            gsum[g] += (all[b]->F - all[gfirst[g]]->F) >> 6;
            gcnt[g]++;
        }
        for (a = 0; a < n; a++) {
            bk_part_t *p = all[a];
            int64_t acc = 0, x;
            if (topo == BK_TOPO_RING) {                           /* the two `stride' away, round the ring: some
                                                                   * strides cut it into separate rings */
                const int32_t sd = e->par[BK_P_STRIDE] % n;
                const bk_part_t *l = all[(a + n - sd) % n], *r = all[(a + sd) % n];
                acc = ((l->F - p->F) >> 1) + ((r->F - p->F) >> 1);
            } else {                                              /* the mean of its group (its voice, or all) */
                const int32_t g = topo == BK_TOPO_GLOBAL ? (int32_t)BK_NV : vof[a];
                acc = smulshr(gsum[g] - gcnt[g] * ((p->F - all[gfirst[g]]->F) >> 6), BK_R64[gcnt[g]], 16);
            }
            x = p->F + smulshr(acc, eps, 16);
            if (x < XEDGE) x = XEDGE;
            if (x > BK_ONE - XEDGE) x = BK_ONE - XEDGE;
            p->x = x;
        }
    }
    {   /* the layer's Lyapunov exponent, smoothed over steps */
        int32_t l = ln_q16((l2sum / n) * 16);
        e->glyap += (l - e->glyap) >> 3;
    }
    for (k = 0; k < BK_NV; k++) {
        bk_voice_t *v = &e->v[k];
        if (!v->active)
            continue;
        for (j = 0; j < (uint32_t)np; j++) {
            bk_part_t *p = &v->part[j];
            p->ca = p->cb;
            p->cb = pitch_of(e, p, xs);
            p->inc_a = p->inc_b;
            p->inc_b = cents_inc(v->inc, p->cb);
            p->gate = chop == BK_CHOP_GATE ? p->x > xs : 1;
        }
        if (chop == BK_CHOP_ARP) {                                /* the order the plucks go in this step */
            const int32_t order = e->par[BK_P_ARPV] & 3;
            uint8_t o[BK_NPART];
            int32_t i, q;
            for (i = 0; i < np; i++) {                            /* by the maps, highest first */
                for (q = i; q > 0 && v->part[o[q - 1]].x < v->part[i].x; q--) o[q] = o[q - 1];
                o[q] = (uint8_t)i;
            }
            for (i = 0; i < np; i++)
                v->ord[i] = order == 0 ? o[i]                                 /* down */
                          : order == 1 ? o[np - 1 - i]                        /* up */
                          : order == 2 ? (uint8_t)((i + v->nstep) % (uint32_t)np)   /* round, a turn each step */
                          : (i & 1) ? o[np - 1 - i / 2] : o[i / 2];           /* in from both ends */
            v->arp_sub = -1;
        }
        v->phist[v->nstep & (BK_HIST - 1u)] = (int32_t)(v->part[0].x >> 32);
        v->nstep++;
    }
    e->nsteps++;
}

/* every 16 frames: the step clock, the glide's shape, the step's envelope, each partial's pitch and level */
static void gesture_control(bk_engine_t *e)
{
    const int32_t np = e->par[BK_P_NPART], glide = e->par[BK_P_GLIDE] >> 1, chop = e->par[BK_P_CHOP];
    const uint32_t sinc = e->par[BK_P_FREEZE] ? 0u : (uint32_t)(((uint64_t)(uint32_t)e->par[BK_P_RATE] * 97391u) >> 8);
    int32_t t, base, k, j;
    if (e->step_ph + 16u * sinc < e->step_ph)
        gesture_step(e);
    e->step_ph += 16u * sinc;
    t = (int32_t)(e->step_ph >> 17);                              /* where in the step, Q15 */
    if (glide < 64) e->gs = 32767;
    else {                                                        /* sin^2: an arc from the old pitch to the new */
        int32_t tt = t >= glide ? 32767 : (t << 15) / glide, sq = sn((uint32_t)tt << 15);
        e->gs = (sq * sq) >> 15;
    }
    if (chop == BK_CHOP_OFF) e->genv = 32767;
    else {                                                        /* a pluck: 8 % of the step up, then (1 - t)^2 */
        int32_t d = 32767 - t, at = t < 2621 ? (t * 25) >> 1 : 32767;
        e->genv = (((d * d) >> 15) * at) >> 15;
    }
    if (np <= 0)
        return;
    if (chop == BK_CHOP_ARP) {
        /* ARP: the step cut into N x r plucks, the sines in the step's order, r times round; each pluck rings
         * on for 1.5, 3 or 6 plucks, so they overlap; a pluck at full level, not 1 / N */
        static const int32_t DX2[3] = {3, 6, 12};
        const int32_t av = e->par[BK_P_ARPV], r = 1 + ((av >> 2) & 3) % 3, sub_n = np * r;
        const int32_t sub = (t * sub_n) >> 15;
        int32_t M = DX2[((av >> 4) & 3) % 3] * 352800 / (sub_n * e->par[BK_P_RATE]), dk;   /* control periods to 1/10 */
        if (M < 1) M = 1;
        dk = 32768 - 75366 / M;
        dk = dk < 8192 ? 8192 : dk > 32760 ? 32760 : dk;
        for (k = 0; k < (int32_t)BK_NV; k++) {
            bk_voice_t *v = &e->v[k];
            if (!v->active)
                continue;
            if (sub != v->arp_sub) {
                v->arp_sub = (int8_t)sub;
                v->part[v->ord[sub % np]].pl = 32767;
            }
            for (j = 0; j < np; j++) {
                bk_part_t *p = &v->part[j];
                int32_t target, diff;
                p->pl = (p->pl * dk) >> 15;
                target = (30000 * p->pl) >> 15;
                diff = target - p->amp;
                if (diff > 3000) diff = 3000;                     /* (a 1.5 ms rise, not a click) */
                p->inc = p->inc_a + (uint32_t)(int32_t)((((int64_t)p->inc_b - (int64_t)p->inc_a) * e->gs) >> 15);
                p->damp = diff / 16;
            }
        }
        return;
    }
    base = np > 1 ? 32767 * 3 / (2 * np) : 32767;                 /* 1.5 / N: they are rarely all in phase */
    for (k = 0; k < (int32_t)BK_NV; k++) {
        bk_voice_t *v = &e->v[k];
        if (!v->active)
            continue;
        for (j = 0; j < np; j++) {
            bk_part_t *p = &v->part[j];
            int32_t target = p->gate ? (base * e->genv) >> 15 : 0;
            p->inc = p->inc_a + (uint32_t)(int32_t)((((int64_t)p->inc_b - (int64_t)p->inc_a) * e->gs) >> 15);
            p->damp = (target - p->amp) / 16;                     /* (not >> 4: -1 for any small fall, a ripple) */
        }
    }
}

void bk_mutate(bk_engine_t *e)                                    /* MUTATE: a nudge to every partial (2^-16 or so) */
{
    uint32_t k, j;
    e->mut++;
    for (k = 0; k < BK_NV; k++)
        for (j = 0; j < BK_NPART; j++) {
            bk_part_t *p = &e->v[k].part[j];
            int64_t d = (int64_t)((e->mut * 7u + j * 3u + k) % 11u) - 5;
            p->x += d * ((int64_t)1 << 46);
            if (p->x < XEDGE) p->x = XEDGE;
            if (p->x > BK_ONE - XEDGE) p->x = BK_ONE - XEDGE;
        }
}

int bk_voice_pattern(const bk_engine_t *e, uint32_t vi, int32_t tol)   /* over 3 repeats and 8 steps more */
{
    const bk_voice_t *v;
    uint32_t p, i, w;
    if (vi >= BK_NV || !e->v[vi].active || e->v[vi].nstep < 16u)
        return -1;
    v = &e->v[vi];
    for (p = 1; p <= 16u; p++) {
        w = 3u * p + 8u;
        if (w > BK_HIST - p) w = BK_HIST - p;
        if (v->nstep < w + p)
            return -1;
        for (i = 0; i < w; i++) {
            int32_t a = v->phist[(v->nstep - 1u - i) & (BK_HIST - 1u)], b = v->phist[(v->nstep - 1u - i - p) & (BK_HIST - 1u)];
            if (a - b > tol || b - a > tol)
                break;
        }
        if (i == w)
            return (int)p;
    }
    return 0;
}

int32_t bk_part_cents(const bk_engine_t *e, uint32_t vi, uint32_t j)
{
    const bk_part_t *p = &e->v[vi].part[j];
    return p->ca + (int32_t)(((int64_t)(p->cb - p->ca) * e->gs) >> 15);
}

void bk_render(bk_engine_t *e, int32_t *out, uint32_t n)
{
    const int32_t path = e->par[BK_P_PATH], C = e->par[BK_P_C];
    const uint32_t ratio = (uint32_t)e->par[BK_P_RATIO], solo = (uint32_t)e->par[BK_P_SOLO];
    const int fbt = path == BK_PATH_FBT || path == BK_PATH_BOTH, fb1 = path == BK_PATH_FB1;
    const int timbre = e->par[BK_P_TIMBRE] != 0, np = e->par[BK_P_NPART];
    int32_t gain, beta0, mu, nu, mixt;
    uint32_t i, k, na = 0, sounding = 0;
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
    e->lyap = e->par[BK_P_NPART] > 0 ? e->glyap : na ? lsum / (int32_t)na : 0;   /* 32-bit */
    evolve(e, n);
    beta0 = beta_of(e, bk_u_of_R(e->R));
    gain = (e->par[BK_P_GAIN] * RAD_Q15) >> 8;
    mu = (int32_t)(((int64_t)(C < 0 ? -C : C) * MU0) >> 16);      /* mu nu > 0: cooperate, < 0: compete */
    nu = (int32_t)(((int64_t)C * NU0) >> 16);
    for (k = 0; k < BK_NV; k++) {
        bk_voice_t *v = &e->v[k];
        uint32_t nf = (uint32_t)(((uint64_t)v->inc * BK_FS) >> 32) * ratio;   /* the modulator, Hz */
        sounding += v->active;
        int32_t q = (int32_t)(18000u * RAD_Q15 / (nf ? nf : 1u)) - RAD_Q15;   /* (dev + 1) f_m <= 18 kHz */
        v->imax = q < 0 ? 0 : q > ICAP ? ICAP : q;
    }
    mixt = MIXG[sounding];                                        /* the mix's level glides there in ~60 ms */

    for (i = 0; i < n; i++) {
        uint32_t wrapped = 0;
        int32_t mix = 0;
        if (!e->sub)
            gesture_control(e);                                   /* the step clock, every 16 frames */
        e->sub = (e->sub + 1u) & 15u;
        /* 1. phases; a voice whose period ends publishes f_R(x) first, so that the voices whose
         * periods end in the same frame take one synchronous step together */
        for (k = 0; k < BK_NV; k++) {
            bk_voice_t *v = &e->v[k];
            if (!v->active || !timbre)
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
            int32_t I, y = 0, s, g = 0, q;
            if (!v->active)
                continue;
            for (q = 0; q < np; q++) {                            /* the gesture layer: its sines */
                bk_part_t *p = &v->part[q];
                g += (sn(p->ph) * p->amp) >> 15;
                p->ph += p->inc;
                p->amp += p->damp;
                if (p->amp < 0) p->amp = 0;
            }
            if (!timbre)
                goto level;
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
        level:
            if (v->amp < v->gate) {
                v->amp += v->att;
                if (v->amp > v->gate) v->amp = v->gate;
            } else if (v->amp > v->gate) {
                v->amp -= v->rel;
                if (v->amp < v->gate) v->amp = v->gate;
            }
            s = ((timbre && np ? (y + g) >> 1 : timbre ? y : g) * v->amp) >> 15;
            if (solo & (1u << k))
                mix += s;
            if (!v->amp && !v->gate)
                v->active = 0;                                    /* silent: leaves the mean field */
        }
        /* the mix's level: a slow gain, changed only when voices come or go */
        if (e->mixg < mixt) { e->mixg += 8; if (e->mixg > mixt) e->mixg = mixt; }
        else if (e->mixg > mixt) { e->mixg -= 8; if (e->mixg < mixt) e->mixg = mixt; }
        mix = (int32_t)(((int64_t)mix * e->mixg) >> 15);
        /* the DC blocker: an asymmetric index puts DC in the sound (a linear filter: it adds no
         * frequency, and a periodic sound stays as periodic) */
        e->dcy = (mix - e->dcx) * 256 + (int32_t)(((int64_t)e->dcy * DC_A) >> 15);   /* 8 more bits inside */
        e->dcx = mix;
        out[2u * i] += (e->dcy + 128) >> 8;
        out[2u * i + 1u] += (e->dcy + 128) >> 8;
    }
    e->frames += n;
    if (e->perf)
        bk_perf_block(e);
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
    case BK_P_FORCE: val = val ? 1 : 0; break;
    case BK_P_NPART: val = val < 0 ? 0 : val > (int32_t)BK_NPART ? (int32_t)BK_NPART : val; break;
    case BK_P_RATE: val = val < 64 ? 64 : val > 16384 ? 16384 : val; break;
    case BK_P_CENTS: val = val < 0 ? 0 : val > 2400 ? 2400 : val; break;
    case BK_P_GLIDE: val = val < 0 ? 0 : val > 65536 ? 65536 : val; break;
    case BK_P_CHOP: if (val < 0 || val >= BK_NCHOPS) return; break;
    case BK_P_TOPO: if (val < 0 || val >= BK_NTOPOS) return; break;
    case BK_P_TIMBRE: case BK_P_FREEZE: val = val ? 1 : 0; break;
    case BK_P_OCT: val = val < 0 ? 0 : val > 3 ? 3 : val; break;
    case BK_P_OCTV: val &= 7; break;
    case BK_P_MICRO: val = val < 0 ? 0 : val > 4 ? 4 : val; break;
    case BK_P_STRIDE: val = val < 1 ? 1 : val > 63 ? 63 : val; break;
    case BK_P_ARPV: val &= 63; break;
    case BK_P_HOLD: {
        uint32_t k;
        val = val ? 1 : 0;
        if (!val)                                                 /* let go: what is not held any more ends */
            for (k = 0; k < BK_NV; k++)
                if (!e->v[k].held) e->v[k].gate = 0;
        break;
    }
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
    e->mixg = 32768;
    e->par[BK_P_RATE] = 4 << 8;                                   /* the gesture layer: off (NPART 0) until asked */
    e->par[BK_P_CENTS] = 700;
    e->par[BK_P_GLIDE] = 49152;
    e->par[BK_P_TIMBRE] = 1;
    e->par[BK_P_MICRO] = 4;                                       /* free pitches (bk_perf_init: semitones) */
    e->par[BK_P_STRIDE] = 1;
    e->evdir = 1;
    e->gs = e->genv = 32767;
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

/* ---- the performance: keys, endless knobs, buttons that go on changing, and a looper ---------------------- */

/* point n (n != 0) of a fixed orbit of the map at 3.99, `which' choosing its start (n < 0 another one), evened out
 * by (2 / pi) asin(sqrt x): the variations a button or a knob's turn picks come from the map, not from dice */
int32_t bk_orbit(uint32_t which, int32_t n)
{
    int64_t x = BK_ONE / 8 + (int64_t)((which * 2u + (n < 0 ? 1u : 0u)) % 11u) * (BK_ONE / 23);
    uint32_t i, m = (uint32_t)(n < 0 ? -n : n), idx, fr;
    if (m > 20000u) m = 20000u;
    for (i = 0; i < m; i++)
        x = bk_logistic(R399, x);
    idx = (uint32_t)(x >> 54);
    fr = (uint32_t)(x >> 38) & 0xFFFFu;
    if (idx >= 256u) return 65535;
    return BK_ASINSQ[idx] + (int32_t)(((int64_t)(BK_ASINSQ[idx + 1] - BK_ASINSQ[idx]) * fr) >> 16);
}

/* a knob's position folded into 0 .. span: it goes on, back and forth; *turns: the ends passed so far */
static int32_t fold(int32_t pos, int32_t span, int32_t *turns)
{
    const int32_t per = 2 * span;
    int32_t m = pos % per;
    if (m < 0) m += per;
    *turns = pos >= 0 ? pos / span : -((-pos + span - 1) / span);
    return m <= span ? m : per - m;
}

static const uint32_t SEMI12[12] = {65536, 69433, 73562, 77936, 82570, 87480, 92682, 98193, 104032, 110218, 116772, 123715};

/* the knobs: each moves its value the way it is turned, without an end (at an end it turns back), and at each
 * turn something more changes, chosen by the map, so that no pass is the one before:
 *   R      the warped axis, one unit 16 detents (SELECT: 512); at R's top or bottom the network is nudged
 *   TIME   steps a second, a semitone a detent, 0.25 .. 64; at each end the glide is chosen anew
 *   NET    eps 0 .. 0.75, 0.01 a detent; at each end the network is nudged
 *   SPACE  cents 0 .. 2400, 25 a detent; at each end the octaves are dealt anew
 *   N      sines a voice 1 .. 8 (ALGORITHM)       SEED  the seed (PRESETS) */
static void knob_apply(bk_engine_t *e, uint32_t k)
{
    int32_t v, g = 0;
    switch (k) {
    case BK_KNOB_R:
    case BK_KNOB_FINE:
        v = fold((1 << 15) + e->knob[BK_KNOB_R] * 4096 + e->knob[BK_KNOB_FINE] * 128, BK_U_MAX, &g);
        if (g != e->kgen[BK_KNOB_R]) { e->kgen[BK_KNOB_R] = g; bk_mutate(e); }
        bk_set(e, BK_P_U, v);
        break;
    case BK_KNOB_TIME:
        v = fold(48 + e->knob[k], 96, &g);
        bk_set(e, BK_P_RATE, (int32_t)(((64u << (v / 12)) * SEMI12[v % 12]) >> 16));
        if (g != e->kgen[k]) { e->kgen[k] = g; bk_set(e, BK_P_GLIDE, g ? bk_orbit(1, g) : 49152); }
        break;
    case BK_KNOB_NET:
        v = fold(e->knob[k], 75, &g);
        bk_set(e, BK_P_EPS, v * 65536 / 100);
        if (g != e->kgen[k]) { e->kgen[k] = g; bk_mutate(e); }
        break;
    case BK_KNOB_SPACE:
        v = fold(28 + e->knob[k], 96, &g);
        bk_set(e, BK_P_CENTS, v * 25);
        if (g != e->kgen[k]) { e->kgen[k] = g; bk_set(e, BK_P_OCTV, (bk_orbit(2, g ? g : 1) >> 13) & 7); }
        break;
    case BK_KNOB_N:
        bk_set(e, BK_P_NPART, 1 + fold(3 + e->knob[k], 7, &g));
        break;
    case BK_KNOB_SEED:
        bk_set(e, BK_P_SEED, 1 + e->knob[k]);
        break;
    default:
        break;
    }
}

/* the buttons: a press (val 1) goes on to the next state, chosen by the map from the presses so far; a long press
 * (val 0) ends it */
static void button_apply(bk_engine_t *e, uint32_t b, int32_t val)
{
    uint32_t c;
    int32_t z;
    if (b >= BK_NBTNS) return;
    if (val) e->press[b]++;
    c = e->press[b];
    switch (b) {
    case BK_BTN_HOLD:
        if (val) bk_set(e, BK_P_HOLD, !e->par[BK_P_HOLD]);
        else bk_set(e, BK_P_HOLD, 0);
        break;
    case BK_BTN_FREEZE:
        if (val) bk_set(e, BK_P_FREEZE, !e->par[BK_P_FREEZE]);
        else bk_set(e, BK_P_FREEZE, 0);
        break;
    case BK_BTN_ARP:                            /* each press another way of plucking: order, plucks a step, tail */
        if (!val) { bk_set(e, BK_P_CHOP, BK_CHOP_OFF); break; }
        z = bk_orbit(3, (int32_t)c);
        bk_set(e, BK_P_CHOP, BK_CHOP_ARP);
        bk_set(e, BK_P_ARPV, c == 1u ? 0x10 : ((z >> 14) & 3) | (((z >> 9) % 3) << 2) | (((z >> 4) % 3) << 4));
        break;
    case BK_BTN_EVOLVE:                         /* on; then each press turns it round (climb <-> collapse) */
        if (!val) { bk_set(e, BK_P_D, 0); break; }
        if (!e->par[BK_P_D]) { bk_set(e, BK_P_D, 32768); e->evdir = 1; }
        else e->evdir = -e->evdir;
        break;
    case BK_BTN_TOPO:                           /* who pulls on whom: all; rings of strides the map picks; each alone */
        if (!val) { bk_set(e, BK_P_TOPO, BK_TOPO_LOCAL); break; }
        if (c % 4u == 1u) bk_set(e, BK_P_TOPO, BK_TOPO_GLOBAL);
        else if (c % 4u == 0u) bk_set(e, BK_P_TOPO, BK_TOPO_LOCAL);
        else {
            bk_set(e, BK_P_TOPO, BK_TOPO_RING);
            bk_set(e, BK_P_STRIDE, 1 + ((bk_orbit(4, (int32_t)c) * 7) >> 16));
        }
        break;
    case BK_BTN_MICRO:                          /* the grid finer each press: 1/2, 1/4, 1/8, 1/16 tone, none; then a nudge */
        if (!val) { bk_set(e, BK_P_MICRO, 0); break; }
        if (e->par[BK_P_MICRO] < 4) bk_set(e, BK_P_MICRO, e->par[BK_P_MICRO] + 1);
        else bk_mutate(e);
        break;
    case BK_BTN_OCT:                            /* the octaves wider each press, up to 3; then dealt anew */
        if (!val) { bk_set(e, BK_P_OCT, 0); break; }
        if (e->par[BK_P_OCT] < 3) bk_set(e, BK_P_OCT, e->par[BK_P_OCT] + 1);
        else bk_set(e, BK_P_OCTV, (bk_orbit(5, (int32_t)c) >> 13) & 7);
        break;
    case BK_BTN_MUTATE:
        if (val) bk_mutate(e);
        break;
    case BK_BTN_TIMBRE:                         /* the FM layer, each press another ratio and lift */
        if (!val) { bk_set(e, BK_P_TIMBRE, 0); break; }
        bk_set(e, BK_P_TIMBRE, 1);
        bk_set(e, BK_P_RATIO, 1 + (int32_t)((c - 1u) % 3u));
        bk_set(e, BK_P_LIFT, (int32_t)(((c - 1u) / 3u) & 1u));
        break;
    default:
        break;
    }
}

static void perf_apply(bk_engine_t *e, uint32_t kind, uint32_t id, int32_t val)
{
    if (kind == BK_IN_KEY) bk_note(e, id, (uint32_t)(val < 0 ? 0 : val));
    else if (kind == BK_IN_KNOB && id < BK_NKNOBS) {
        int32_t p = e->knob[id] + val;
        e->knob[id] = p < -400000 ? -400000 : p > 400000 ? 400000 : p;
        knob_apply(e, id);
    } else if (kind == BK_IN_BTN) button_apply(e, id, val);
}

/* the loop's events in time order; one that comes in now goes after those of this block, which have been played
 * (a block's own are played at the end of the block before, see bk_perf_block): it is heard from the next pass */
static void loop_record(bk_engine_t *e, uint32_t kind, uint32_t id, int32_t val)
{
    uint32_t i = e->loop_n;
    if (i >= BK_LOOP_N) return;
    while (i > 0 && e->loop[i - 1].t > e->loop_pos) {
        e->loop[i] = e->loop[i - 1];
        i--;
    }
    e->loop[i].t = e->loop_pos;
    e->loop[i].kind = (uint8_t)kind;
    e->loop[i].id = (uint8_t)id;
    e->loop[i].val = (int16_t)(val < -32768 ? -32768 : val > 32767 ? 32767 : val);
    e->loop_n++;
    if (e->loop_state == BK_LOOP_PLAY && i <= e->loop_rd) e->loop_rd++;
}

static void loop_play_now(bk_engine_t *e)     /* the events at the loop's position, played */
{
    while (e->loop_rd < e->loop_n && e->loop[e->loop_rd].t == e->loop_pos) {
        const bk_ev_t ev = e->loop[e->loop_rd++];
        perf_apply(e, ev.kind, ev.id, ev.val);
    }
}

void bk_input(bk_engine_t *e, uint32_t kind, uint32_t id, int32_t val)
{
    if (kind == BK_IN_BTN && id == BK_BTN_LOOP) {   /* REC: record; then loop it (and go on adding); then stop */
        if (!val || e->loop_state == BK_LOOP_PLAY) {
            e->loop_state = BK_LOOP_IDLE;
            e->loop_n = e->loop_pos = e->loop_rd = 0;
        } else if (e->loop_state == BK_LOOP_IDLE) {
            e->loop_state = BK_LOOP_REC;
            e->loop_n = e->loop_pos = e->loop_rd = 0;
        } else if (e->loop_pos && e->loop_n) {
            e->loop_state = BK_LOOP_PLAY;
            e->loop_len = e->loop_pos;
            e->loop_pos = e->loop_rd = 0;
            loop_play_now(e);
        } else
            e->loop_state = BK_LOOP_IDLE;
        return;
    }
    if (e->loop_state != BK_LOOP_IDLE)
        loop_record(e, kind, id, val);
    perf_apply(e, kind, id, val);
}

void bk_perf_block(bk_engine_t *e)              /* the end of a block: the loop on by one, and what is due, played */
{
    if (e->loop_state == BK_LOOP_REC) {
        if (++e->loop_pos >= 65536u) {          /* 6 minutes: closed by itself */
            e->loop_state = BK_LOOP_PLAY;
            e->loop_len = e->loop_pos;
            e->loop_pos = e->loop_rd = 0;
            loop_play_now(e);
        }
    } else if (e->loop_state == BK_LOOP_PLAY) {
        if (++e->loop_pos >= e->loop_len) {
            e->loop_pos = 0;
            e->loop_rd = 0;
        }
        loop_play_now(e);
    }
}

void bk_perf_init(bk_engine_t *e)
{
    uint32_t k;
    e->perf = 1;
    for (k = 0; k < BK_NKNOBS; k++) e->knob[k] = e->kgen[k] = 0;
    for (k = 0; k < BK_NBTNS; k++) e->press[k] = 0;
    e->loop_state = BK_LOOP_IDLE;
    e->loop_n = e->loop_len = e->loop_pos = e->loop_rd = 0;
    bk_set(e, BK_P_TIMBRE, 0);
    bk_set(e, BK_P_MICRO, 0);
    bk_set(e, BK_P_GLIDE, 49152);
    for (k = 0; k < BK_NKNOBS; k++)
        if (k != BK_KNOB_FINE) knob_apply(e, k);
}
