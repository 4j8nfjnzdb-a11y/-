/* KUZUSHI (崩し): the numbers of the sound itself, broken. UNDERFLOW's stages made light enough for the FM-1, with
 * one thing it did not have: what comes out of the broken chain goes back into the FM carrier's phase (LOOP).
 * Then the destruction is no longer a filter on a sound but part of a dynamical system: quantisers, wrap-around and
 * underflow inside a feedback loop give periodic orbits of long and changing periods (mode locking), not just noise.
 *
 * Source: a modulator (ratio, self-feedback B) into a carrier at F0, index INDEX; the computer's audio if any (IN).
 * Stages (seven reorderable, then the two clock stages):
 *   OVF  gain up to +60 dB, then CLIP / WRAP (integer overflow) / MIRROR (fold)
 *   SR   + sample-and-hold at SR Hz (ZOH or linear, a one-pole anti-alias or none); 0 = freeze (the last 2048
 *        samples looped); - = the past read backwards, held at |SR|
 *   BITS + quantise to BITS (fractional) on a LIN / MU-LAW / LOG curve, with hysteresis; - = only the error that
 *        |BITS| would throw away (raised by 2^(|BITS|-1) so it is heard; the screen says so)
 *   FLOAT the float itself: mantissa to MANT bits (rounded), exponent to EXP bits: below 2^-(2^EXP - 2) a value
 *        underflows to 0 (EXP 3: everything under -36 dBFS is gone)
 *   FLIP int16 XOR a mask (each detent flips one bit: Gray code), and a bit flipped at random with probability PROB
 *   ENDIAN int16 bytes swapped / signed read as unsigned / both
 *   ABSORB (x + 2^k) - 2^k in float: the step is 2^(k-23) above zero and half that below (float's binades): an
 *        asymmetric quantiser, which a fixed-point one never is
 *   JIT  the reading instant wobbles (a sine, white, or a random walk), left and right apart
 *   BLOCK blocks of BLK samples dropped (+ BPROB) or repeated (- BPROB)
 * The body: turning back and forth widens the quantiser's hysteresis (hesitation makes it sticky); a fast hand makes
 * the clock unsteady (jitter grows with speed); moving again after stillness rewires: the stage order rotates, and
 * after a stillness of 5 s or more the sound is cut for a moment first (WIRE, black key 11, turns this off). */
#include "par.h"

const char PJ_NAME[] = "KUZUSHI";

enum { S_OVF, S_SR, S_BITS, S_FLOAT, S_FLIP, S_ENDIAN, S_ABSORB, S_JIT, S_BLOCK, NSTAGE };
static const char *const STAGE_NAME[NSTAGE] = {"OVF", "SR", "BIT", "FLT", "FLP", "END", "ABS", "JIT", "BLK"};
#define NORDER 7

/* ---- parameters ---- */
static const char *const PAGE_NAMES[] = {"1 SOURCE", "2 RATE", "3 FLOAT", "4 BITS", "5 TIME"};
static const char *const CURVE_NAMES[] = {"LIN", "MU-LAW", "LOG"};
static const char *const OVF_NAMES[] = {"CLIP", "WRAP", "MIRROR"};
static const char *const ENDIAN_NAMES[] = {"NONE", "BSWAP", "U/S", "BOTH"};
enum { G_PAGE, G_LOOP, G_INDEX,
       A_F0, A_RATIO, A_FB, A_IN,
       B_SR, B_BITS, B_CURVE, B_HYST,
       C_MANT, C_EXP, C_GAIN, C_OVF,
       D_MASK, D_PROB, D_ENDIAN, D_ABS,
       E_JIT, E_JPER, E_BLK, E_BPROB, NPAR };
static const par_def_t DEF[NPAR] = {
    {"PAGE", P_ENUM, 0, 0, 4, 1, 1, "", PAGE_NAMES, 0, 4},
    {"LOOP", P_LIN, 2, -4.0f, 4.0f, 0.02f, 0, "RAD", 0, -1.5f, 1.5f},
    {"INDEX", P_LOG, 2, 0.0f, 60.0f, 24.0f, 0.5f, "RAD", 0, 0.0f, 12.0f},
    {"F0", P_LOG, 1, -4000.0f, 16000.0f, 24.0f, 20.0f, "HZ", 0, 20.0f, 4000.0f},
    {"RATIO", P_LIN, 3, -16.0f, 16.0f, 0.005f, 0, "", 0, 0.0f, 8.0f},
    {"FB B", P_LIN, 2, -4.0f, 4.0f, 0.02f, 0, "RAD", 0, -1.2f, 1.2f},
    {"IN", P_LIN, 2, -1.0f, 1.0f, 0.02f, 0, "", 0, 0.0f, 1.0f},
    {"SR", P_LOG, 0, -192000.0f, 192000.0f, 24.0f, 40.0f, "HZ", 0, 1.0f, 192000.0f},
    {"BITS", P_LIN, 2, -24.0f, 32.0f, 0.05f, 0, "", 0, 1.0f, 32.0f},
    {"CURVE", P_ENUM, 0, 0, 2, 1, 1, "", CURVE_NAMES, 0, 2},
    {"HYST", P_LIN, 2, 0.0f, 8.0f, 0.02f, 0, "LSB", 0, 0.0f, 2.0f},
    {"MANT", P_INT, 0, 0, 23, 1, 1, "BIT", 0, 4, 23},
    {"EXP", P_INT, 0, 1, 8, 1, 1, "BIT", 0, 4, 8},
    {"GAIN", P_LIN, 1, -24.0f, 60.0f, 0.25f, 0, "DB", 0, -24.0f, 12.0f},
    {"OVF", P_ENUM, 0, 0, 2, 1, 1, "", OVF_NAMES, 0, 2},
    {"MASK", P_GRAY, 0, 0, 65535, 1, 1, "", 0, 0, 0},
    {"PROB", P_LOG, 5, 0.0f, 1.0f, 6.0f, 0.00002f, "", 0, 0.0f, 0.01f},
    {"ENDIAN", P_ENUM, 0, 0, 3, 1, 1, "", ENDIAN_NAMES, 0, 0},
    {"ABSORB", P_INT, 0, 0, 24, 1, 1, "K", 0, 0, 18},
    {"JIT", P_LOG, 2, 0.0f, 64.0f, 12.0f, 0.25f, "SMP", 0, 0.0f, 8.0f},
    {"JPER", P_LOG, 2, -40.0f, 40.0f, 12.0f, 0.05f, "HZ", 0, 0.0f, 40.0f},
    {"BLK", P_LOG, 0, 16.0f, 4096.0f, 4.0f, 16.0f, "SMP", 0, 16.0f, 4096.0f},
    {"BPROB", P_LIN, 2, -1.0f, 1.0f, 0.01f, 0, "", 0, -0.3f, 0.3f},
};
static par_t P[NPAR];
static const uint8_t PAGE_PARS[5][4] = {{A_F0, A_RATIO, A_FB, A_IN}, {B_SR, B_BITS, B_CURVE, B_HYST},
                                        {C_MANT, C_EXP, C_GAIN, C_OVF}, {D_MASK, D_PROB, D_ENDIAN, D_ABS},
                                        {E_JIT, E_JPER, E_BLK, E_BPROB}};

/* the white keys with pressure push an axis toward breaking; the top white keys kick by velocity only */
enum { AX_GAIN, AX_SR, AX_BITS, AX_MANT, AX_EXP, AX_LOOP, AX_INDEX, AX_PROB, AX_JIT, AX_BLOCK, AX_ABS, AX_FB, NAX };
static const char *const AX_NAME[NAX] = {"GAIN", "SR", "BITS", "MANT", "EXP", "LOOP", "INDEX", "PROB", "JIT",
                                         "BLOCK", "ABSORB", "FB"};
static const uint8_t WHITE[16] = {0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24, 26};
static const uint8_t BLACK[11] = {1, 3, 5, 8, 10, 13, 15, 17, 20, 22, 25};

/* ---- shared between the UI and the render ---- */
static struct {
    float push[NAX];                     /* 0..1 */
    uint8_t on[NSTAGE];
    uint8_t order[NORDER];
    uint8_t recon;                       /* 0 ZOH, 1 linear, 2 ZOH + anti-alias, 3 linear + anti-alias */
    uint8_t wire;                        /* the body rewires */
    float hyst_body, clock_body;
    volatile uint32_t home_req, cut_req;
    volatile uint32_t cut_len;
    uint32_t plot_rev;
} sh;

static struct {
    float kick[NAX];
    int last_axis;
    uint32_t axis_until;
    uint32_t enc_hot[HW_NENC];
    uint32_t wire_count;
    char last_wire[16];
} ui;

/* ---- the render's state ---- */
#define RING 32768u
#define BLKMAX 4096u
#define JD 128u
static float ring[RING] MZ_POOL;
static float blkL[BLKMAX] MZ_POOL, blkR[BLKMAX] MZ_POOL;
static struct {
    uint32_t phc, phm, seed;
    float m1, yprev, index_s, gain_s, loop_s;
    uint32_t home_seen, cut_seen;
    uint32_t cut_left;
    float cut_g;
    /* SR */
    uint32_t w;
    float acc, held, held_prev, aa;
    float rd;                            /* reverse: how far behind the write the read is */
    int frozen;
    uint32_t fz_start, fz_pos;
    /* BITS */
    float qlast;
    /* JIT */
    float jd[JD];
    uint32_t jw;
    float jph, jwalkL, jwalkR, jL, jR;
    /* BLOCK */
    uint32_t bpos, blen;
    int bact, bprev_act;
    float bxL, bxR;
    /* view */
    float scope_min[240], scope_max[240], scope_c, scope_s;
    float cap_min[240], cap_max[240];
    int cap_col, cap_n, armed;
    float prev_x;
} st;

static void defaults(void)
{
    int i;
    for (i = 0; i < NPAR; i++)
        par_set(&DEF[i], &P[i], 0.0f);
    par_set(&DEF[A_F0], &P[A_F0], 220.0f);
    par_set(&DEF[A_RATIO], &P[A_RATIO], 1.0f);
    par_set(&DEF[B_SR], &P[B_SR], 44100.0f);
    par_set(&DEF[B_BITS], &P[B_BITS], 32.0f);
    par_set(&DEF[C_MANT], &P[C_MANT], 23.0f);
    par_set(&DEF[C_EXP], &P[C_EXP], 8.0f);
    par_set(&DEF[E_BLK], &P[E_BLK], 512.0f);
    par_set(&DEF[E_JPER], &P[E_JPER], 3.0f);
    for (i = 0; i < NSTAGE; i++)
        sh.on[i] = 1;
    for (i = 0; i < NORDER; i++)
        sh.order[i] = (uint8_t)i;
    sh.recon = 0;
    sh.wire = 1;
    for (i = 0; i < NAX; i++)
        sh.push[i] = ui.kick[i] = 0.0f;
}

void pj_init(uint32_t seed)
{
    defaults();
    st.seed = seed | 1u;
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
    uint32_t i;
    st.m1 = st.yprev = 0.0f;
    st.acc = st.held = st.held_prev = st.aa = 0.0f;
    st.rd = 0.0f;
    st.frozen = 0;
    st.qlast = 0.0f;
    for (i = 0; i < JD; i++)
        st.jd[i] = 0.0f;
    st.jwalkL = st.jwalkR = 0.0f;
    st.bpos = 0;
    st.bact = st.bprev_act = 0;
    st.index_s = st.gain_s = st.loop_s = 0.0f;
    st.cut_left = 0;
    st.cut_g = 1.0f;
    for (i = 0; i < RING; i++)
        ring[i] = 0.0f;
}

/* ---- the effective values: the encoders' plus the keys' pushes (and kicks) ---- */
static float eff(int p)
{
    float v = P[p].v, k;
    switch (p) {
    case C_GAIN:
        return v + 36.0f * sh.push[AX_GAIN];
    case B_SR:
        k = sh.push[AX_SR];
        return k > 0.0f ? v * m_exp2(-9.0f * k) : v;
    case B_BITS:
        return v - 14.0f * sh.push[AX_BITS];
    case C_MANT:
        return m_max(0.0f, v - 22.0f * sh.push[AX_MANT]);
    case C_EXP:
        return m_max(1.0f, v - 6.0f * sh.push[AX_EXP]);
    case G_LOOP:
        return v + 3.0f * sh.push[AX_LOOP] * (v < 0.0f ? -1.0f : 1.0f);
    case G_INDEX:
        return v + 30.0f * sh.push[AX_INDEX];
    case D_PROB:
        k = sh.push[AX_PROB];
        return m_min(1.0f, v + 0.02f * k * k);
    case E_JIT:
        return m_min(64.0f, v + 32.0f * sh.push[AX_JIT]);
    case E_BPROB:
        return m_clamp(v + 0.9f * sh.push[AX_BLOCK] * (v < 0.0f ? -1.0f : 1.0f), -1.0f, 1.0f);
    case D_ABS:
        return m_min(24.0f, v + 20.0f * sh.push[AX_ABS]);
    case A_FB:
        return v + 2.5f * sh.push[AX_FB] * (v < 0.0f ? -1.0f : 1.0f);
    default:
        return v;
    }
}

/* ---- the stages (one sample) ---- */
static inline float st_ovf(float x, float g, int mode)
{
    x *= g;
    if (mode == 0)
        return m_clamp(x, -1.0f, 1.0f);
    if (mode == 1)
        return m_frac((x + 1.0f) * 0.5f) * 2.0f - 1.0f;
    {
        float u = m_frac((x + 1.0f) * 0.25f) * 4.0f;
        return u < 2.0f ? u - 1.0f : 3.0f - u;
    }
}

static inline float curve_fwd(float x, int c)
{
    float a = m_abs(x), s = m_sign(x);
    if (c == 1)
        return s * m_log2(1.0f + 255.0f * a) * 0.125f;
    if (c == 2)
        return a < 1.0e-5f ? 0.0f : s * m_max(0.0f, 1.0f + m_log2(a) * (1.0f / 16.0f));
    return x;
}
static inline float curve_inv(float y, int c)
{
    float a = m_abs(y), s = m_sign(y);
    if (c == 1)
        return s * (m_exp2(8.0f * a) - 1.0f) * (1.0f / 255.0f);
    if (c == 2)
        return a <= 0.0f ? 0.0f : s * m_exp2(16.0f * (a - 1.0f));
    return y;
}

static inline float st_bits(float x, float bits, int curve, float hyst)
{
    float y, step, q, m;
    if (bits >= 31.5f)
        return x;
    y = curve_fwd(m_clamp(x, -4.0f, 4.0f), curve);
    m = m_abs(bits);
    step = m_exp2(1.0f - m);
    q = m_floor(y / step + 0.5f) * step;
    if (hyst > 0.0f && m_abs(y - st.qlast) < step * (0.5f + hyst))
        q = st.qlast;
    st.qlast = q;
    if (bits < 0.0f)                                 /* only what would be thrown away, raised to be heard */
        return (y - q) / step;
    return curve_inv(q, curve);
}

static inline float st_float(float x, int mant, int expb)
{
    mbits_t b;
    uint32_t e, man, sign;
    int32_t k, kmin;
    b.f = x;
    sign = b.u & 0x80000000u;
    e = (b.u >> 23) & 255u;
    man = b.u & 0x7FFFFFu;
    if (e == 0u)
        return 0.0f;                                 /* denormals: flushed */
    if (mant < 23) {
        uint32_t drop = (uint32_t)(23 - mant);
        man += 1u << (drop - 1u);
        if (man >= (1u << 23)) {
            man = 0;
            e++;
        }
        man &= ~((1u << drop) - 1u);
    }
    k = (int32_t)e - 127;
    kmin = -((1 << expb) - 2);
    if (k < kmin)
        return 0.0f;                                 /* underflow */
    if (k > 1) {                                     /* overflow: the largest value */
        k = 1;
        man = 0x7FFFFFu & ~((mant < 23) ? ((1u << (23 - mant)) - 1u) : 0u);
    }
    b.u = sign | ((uint32_t)(k + 127) << 23) | man;
    return b.f;
}

static inline int16_t to16(float x)
{
    int32_t s = (int32_t)(m_clamp(x, -1.0f, 1.0f) * 32767.0f);
    return (int16_t)s;
}

static inline float st_flip(float x, uint32_t mask, float prob)
{
    uint16_t u = (uint16_t)to16(x);
    u ^= (uint16_t)mask;
    if (prob > 0.0f && m_rnd(&st.seed) < prob)
        u ^= (uint16_t)(1u << (m_rng(&st.seed) & 15u));
    return (float)(int16_t)u * (1.0f / 32768.0f);
}

static inline float st_endian(float x, int mode)
{
    uint16_t u = (uint16_t)to16(x);
    if (mode & 1)
        u = (uint16_t)((u >> 8) | (u << 8));
    if (mode & 2)
        return (float)u * (1.0f / 32768.0f) - 1.0f;  /* signed bits read as unsigned, centred */
    return (float)(int16_t)u * (1.0f / 32768.0f);
}

static inline float st_absorb(float x, int k)
{
    volatile float t;
    float K;
    if (k <= 0)
        return x;
    K = m_exp2((float)k);
    t = x + K;                                       /* (x + K) - K: no compiler may fold it (no fast-math) */
    return t - K;
}

static inline float st_sr(float x, float rate, float clock_wobble)
{
    float r = m_abs(rate), out;
    ring[st.w & (RING - 1u)] = x;
    st.w++;
    if (r < 0.5f) {                                  /* 0: freeze the last 2048 samples, looped */
        if (!st.frozen) {
            st.frozen = 1;
            st.fz_start = st.w - 2048u;
            st.fz_pos = 0;
        }
        out = ring[(st.fz_start + st.fz_pos) & (RING - 1u)];
        if (++st.fz_pos >= 2048u)
            st.fz_pos = 0;
        return out;
    }
    st.frozen = 0;
    if (rate < 0.0f) {                               /* the past backwards: the read walks back from the write */
        st.rd += 2.0f;
        if (st.rd > 16384.0f)
            st.rd = 1.0f;
        x = ring[(st.w - 1u - (uint32_t)st.rd) & (RING - 1u)];
    } else {
        st.rd = 0.0f;
    }
    if (sh.recon & 2u) {                             /* anti-alias: one pole at |rate| / 2 */
        float a = m_clamp(r * 0.5f * M_TAU * M_INV_SR, 0.0f, 1.0f);
        st.aa += (x - st.aa) * a;
        x = st.aa;
    }
    st.acc += r * M_INV_SR * (1.0f + clock_wobble * m_rndb(&st.seed));
    if (st.acc >= 1.0f) {
        st.acc -= m_floor(st.acc);
        st.held_prev = st.held;
        st.held = x;
    }
    if (sh.recon & 1u)
        return st.held_prev + (st.held - st.held_prev) * m_clamp(st.acc, 0.0f, 1.0f);
    return st.held;
}

static inline float stage(int s, float x, const float *v)
{
    switch (s) {
    case S_OVF:
        return st_ovf(x, v[C_GAIN], (int)v[C_OVF]);
    case S_SR:
        return st_sr(x, v[B_SR], sh.clock_body);
    case S_BITS:
        return st_bits(x, v[B_BITS], (int)v[B_CURVE], v[B_HYST] + sh.hyst_body);
    case S_FLOAT:
        return st_float(x, (int)v[C_MANT], (int)v[C_EXP]);
    case S_FLIP:
        return st_flip(x, (uint32_t)v[D_MASK], v[D_PROB]);
    case S_ENDIAN:
        return (int)v[D_ENDIAN] ? st_endian(x, (int)v[D_ENDIAN]) : x;
    case S_ABSORB:
        return st_absorb(x, (int)v[D_ABS]);
    }
    return x;
}

void pj_render(float *l, float *r, const float *inl, const float *inr, uint32_t n)
{
    float v[NPAR];
    uint32_t i, incc, incm;
    int k;
    float jit, jper, bprob, inmix, fb, loop_t, index_t, gain_t;
    uint32_t blk;
    if (sh.home_req != st.home_seen) {
        st.home_seen = sh.home_req;
        pj_reset_audio();
    }
    if (sh.cut_req != st.cut_seen) {
        st.cut_seen = sh.cut_req;
        st.cut_left = sh.cut_len;
    }
    for (k = 0; k < NPAR; k++)
        v[k] = eff(k);
    v[C_GAIN] = m_db2lin(v[C_GAIN]);
    incc = m_inc(v[A_F0]);
    incm = m_inc(v[A_F0] * v[A_RATIO]);
    fb = v[A_FB] * (1.0f / M_TAU);
    loop_t = v[G_LOOP] * (1.0f / M_TAU);
    index_t = v[G_INDEX] * (1.0f / M_TAU);
    gain_t = v[C_GAIN];
    inmix = v[A_IN];
    jit = m_min(64.0f, v[E_JIT] + sh.clock_body * 40.0f);
    jper = v[E_JPER];
    blk = (uint32_t)v[E_BLK];
    if (blk < 16u)
        blk = 16u;
    if (blk > BLKMAX)
        blk = BLKMAX;
    bprob = v[E_BPROB];
    for (i = 0; i < n; i++) {
        float x, m, yl, yr;
        st.index_s += (index_t - st.index_s) * 0.005f;
        st.loop_s += (loop_t - st.loop_s) * 0.005f;
        st.gain_s += (gain_t - st.gain_s) * 0.005f;
        v[C_GAIN] = st.gain_s;
        /* the source */
        m = m_sin_pm(st.phm, fb * st.m1);
        st.m1 = m;
        x = m_sin_pm(st.phc, st.index_s * m + st.loop_s * st.yprev);
        st.phc += incc;
        st.phm += incm;
        if (inl && inr && inmix != 0.0f) {
            float a = 0.5f * (inl[i] + inr[i]);
            x = inmix > 0.0f ? x * (1.0f - inmix) + a * inmix : x * (1.0f + inmix) + x * a * (-inmix) * 2.0f;
        }
        /* the reorderable stages */
        for (k = 0; k < NORDER; k++) {
            int s = sh.order[k];
            if (s < NORDER && sh.on[s])
                x = stage(s, x, v);
        }
        if (!m_finite(x))
            x = 0.0f;
        /* JIT: the reading instant, left and right apart */
        st.jd[st.jw & (JD - 1u)] = x;
        if (sh.on[S_JIT] && jit > 0.0f) {
            float dl, dr, fl, fr;
            uint32_t il, ir;
            if (jper > 0.0f) {
                st.jph += jper * M_INV_SR;
                if (st.jph >= 1.0f)
                    st.jph -= 1.0f;
                st.jL = m_sin_t(st.jph);
                st.jR = m_sin_t(st.jph + 0.25f);
            } else if (jper == 0.0f) {
                st.jL = m_rndb(&st.seed);
                st.jR = m_rndb(&st.seed);
            } else {
                float sp = -jper * 0.02f;
                st.jwalkL = m_clamp(st.jwalkL + m_rndb(&st.seed) * sp, -1.0f, 1.0f);
                st.jwalkR = m_clamp(st.jwalkR + m_rndb(&st.seed) * sp, -1.0f, 1.0f);
                st.jL = st.jwalkL;
                st.jR = st.jwalkR;
            }
            dl = jit * (0.5f + 0.5f * st.jL);
            dr = jit * (0.5f + 0.5f * st.jR);
            il = (uint32_t)dl;
            ir = (uint32_t)dr;
            fl = dl - (float)il;
            fr = dr - (float)ir;
            yl = st.jd[(st.jw - il) & (JD - 1u)] * (1.0f - fl) + st.jd[(st.jw - il - 1u) & (JD - 1u)] * fl;
            yr = st.jd[(st.jw - ir) & (JD - 1u)] * (1.0f - fr) + st.jd[(st.jw - ir - 1u) & (JD - 1u)] * fr;
        } else {
            yl = yr = x;
        }
        st.jw++;
        /* BLOCK: dropped, repeated or passed, a block at a time */
        if (sh.on[S_BLOCK] && bprob != 0.0f) {
            float ol, orr, w;
            if (st.bpos == 0u) {
                st.blen = blk;
                st.bprev_act = st.bact;
                st.bact = 0;
                if (bprob > 0.0f && m_rnd(&st.seed) < bprob)
                    st.bact = 1;                     /* drop */
                else if (bprob < 0.0f && m_rnd(&st.seed) < -bprob)
                    st.bact = 2;                     /* repeat */
            }
            if (st.bact == 2) {
                ol = blkL[st.bpos];
                orr = blkR[st.bpos];
            } else {
                blkL[st.bpos] = yl;
                blkR[st.bpos] = yr;
                ol = st.bact == 1 ? 0.0f : yl;
                orr = st.bact == 1 ? 0.0f : yr;
            }
            w = st.bpos < 16u ? (float)st.bpos * (1.0f / 16.0f) : 1.0f;   /* 16 samples from the last block's way */
            if (w < 1.0f && st.bact != st.bprev_act) {
                ol = st.bxL + (ol - st.bxL) * w;
                orr = st.bxR + (orr - st.bxR) * w;
            } else {
                st.bxL = ol;
                st.bxR = orr;
            }
            yl = ol;
            yr = orr;
            if (++st.bpos >= st.blen)
                st.bpos = 0;
        }
        /* the cut (moving after a long stillness) */
        if (st.cut_left) {
            st.cut_left--;
            st.cut_g += (0.0f - st.cut_g) * 0.05f;
        } else if (st.cut_g < 1.0f) {
            st.cut_g = m_min(1.0f, st.cut_g + 0.01f);
        }
        yl *= st.cut_g;
        yr *= st.cut_g;
        st.yprev = m_clamp(0.5f * (yl + yr), -2.0f, 2.0f);   /* LOOP: back into the carrier's phase */
        l[i] = yl * 0.5f;                            /* -6 dBFS for a full-scale chain: the limiter is for more */
        r[i] = yr * 0.5f;
        /* the scope: 240 columns of 4 samples, from a rising zero crossing */
        if (!st.armed) {
            if (st.prev_x <= 0.0f && yl > 0.0f) {
                st.armed = 1;
                st.cap_col = 0;
                st.cap_n = 0;
                st.cap_min[0] = st.cap_max[0] = yl;
            }
        } else {
            if (st.cap_n == 0) {
                st.cap_min[st.cap_col] = st.cap_max[st.cap_col] = yl;
            } else {
                if (yl < st.cap_min[st.cap_col])
                    st.cap_min[st.cap_col] = yl;
                if (yl > st.cap_max[st.cap_col])
                    st.cap_max[st.cap_col] = yl;
            }
            if (++st.cap_n >= 4) {
                st.cap_n = 0;
                if (++st.cap_col >= 240) {
                    int c;
                    float lo = 1e9f, hi = -1e9f;
                    for (c = 0; c < 240; c++) {
                        st.scope_min[c] = st.cap_min[c];
                        st.scope_max[c] = st.cap_max[c];
                        lo = m_min(lo, st.cap_min[c]);
                        hi = m_max(hi, st.cap_max[c]);
                    }
                    st.scope_c = 0.5f * (hi + lo);   /* shown centred and fitted: the shape, whatever its level */
                    st.scope_s = m_max(hi - lo, 0.02f);
                    st.armed = 0;
                    sh.plot_rev++;
                }
            }
        }
        st.prev_x = yl;
    }
    if (!st.armed && st.prev_x == st.prev_x) {       /* no crossing for a while: show it anyway */
        static uint32_t idle;
        if (++idle > 40u) {
            idle = 0;
            st.armed = 1;
            st.cap_col = 0;
            st.cap_n = 0;
        }
    }
}

/* ---- the hand ---- */
void pj_control(const mz_in_t *in, const mz_body_t *b)
{
    int page = (int)P[G_PAGE].v, i;
    static const int ENC_PAR_G[3] = {G_PAGE, G_LOOP, G_INDEX};
    for (i = 0; i < HW_NENC; i++) {
        int p = i < 3 ? ENC_PAR_G[i] : PAGE_PARS[page][i - 3];
        if (in->enc[i]) {
            par_turn(&DEF[p], &P[p], in->enc[i], i == 0 ? 1.0f : par_accel(b->speed[i]), in->ms);
            ui.enc_hot[i] = in->ms + 400u;
            if (p == B_SR || p == B_BITS || p == C_EXP || p == C_MANT)
                sh.plot_rev++;
        }
    }
    /* white keys: pressure pushes an axis; a press kicks it by its velocity (decaying in 150 ms) */
    {
        float kdec = m_tc(0.15f, 1000.0f / (float)(in->dt ? in->dt : 1u));
        for (i = 0; i < NAX; i++)
            ui.kick[i] *= kdec;
        for (i = 0; i < 16; i++) {
            int key = WHITE[i], ax = i < 12 ? i : (i - 12) == 3 ? AX_LOOP : i - 12;
            if (in->down >> key & 1u) {
                float kv = (float)in->vel[key] * (1.0f / 127.0f);
                if (kv > ui.kick[ax])
                    ui.kick[ax] = kv;
                ui.last_axis = ax;
                ui.axis_until = in->ms + 900u;
            }
        }
        for (i = 0; i < NAX; i++) {
            float p = (float)in->prs[WHITE[i]] * (1.0f / 127.0f);
            if (p > 0.0f) {
                ui.last_axis = i;
                ui.axis_until = in->ms + 600u;
            }
            sh.push[i] = m_min(1.0f, m_max(p, ui.kick[i] * 0.8f));
        }
    }
    /* black keys: the stages on / off; 10 the reconstruction; 11 the body's wiring */
    for (i = 0; i < 11; i++) {
        if (!(in->down >> BLACK[i] & 1u))
            continue;
        if (i < NSTAGE) {
            sh.on[i] = (uint8_t)!sh.on[i];
            mz_say(STAGE_NAME[i], sh.on[i] ? "ON" : "BYPASS");
        } else if (i == 9) {
            static const char *const RN[4] = {"ZOH", "LINEAR", "ZOH + AA", "LINEAR + AA"};
            sh.recon = (uint8_t)((sh.recon + 1u) & 3u);
            mz_say("RECON", RN[sh.recon]);
        } else {
            sh.wire = (uint8_t)!sh.wire;
            mz_say("WIRE", sh.wire ? "BODY REWIRES" : "FIXED");
        }
        sh.plot_rev++;
    }
    /* OCT- / OCT+ also page */
    if (in->bdown & (1u << HB_OCTDN))
        par_turn(&DEF[G_PAGE], &P[G_PAGE], -1, 1.0f, in->ms);
    if (in->bdown & (1u << HB_OCTUP))
        par_turn(&DEF[G_PAGE], &P[G_PAGE], 1, 1.0f, in->ms);
    /* the body */
    sh.hyst_body = m_min(4.0f, b->revs * 0.8f);
    sh.clock_body = m_min(0.6f, b->agit * 0.004f);
    if (sh.wire && b->onset_any >= 2.0f) {
        int s, k;
        uint8_t first = sh.order[0];
        for (k = 0; k < NORDER - 1; k++)
            sh.order[k] = sh.order[k + 1];
        sh.order[NORDER - 1] = first;
        ui.wire_count++;
        if (b->onset_any >= 5.0f) {
            float sec = m_min(0.5f, b->onset_any * 0.03f);
            sh.cut_len = (uint32_t)(sec * M_SR);
            sh.cut_req++;
        }
        ui.last_wire[0] = 0;
        for (s = 0; s < 3; s++) {
            mz_cat(ui.last_wire, STAGE_NAME[sh.order[s]]);
            if (s < 2)
                mz_cat(ui.last_wire, ">");
        }
        mz_say(b->onset_any >= 5.0f ? "CUT+WIRE" : "WIRE", ui.last_wire);
        sh.plot_rev++;
    }
}

void pj_row(int i, mz_row_t *row)
{
    static const int ENC_PAR_G[3] = {G_PAGE, G_LOOP, G_INDEX};
    int page = (int)P[G_PAGE].v;
    int p = i < 3 ? ENC_PAR_G[i] : PAGE_PARS[page][i - 3];
    uint32_t now = hw_ms();
    float shown = eff(p);
    par_row(&DEF[p], &P[p], row, now, shown);
    if (p == B_BITS && shown < 0.0f) {               /* negative bits: say what is heard */
        row->value[0] = 0;
        mz_cat(row->value, "ERR ");
        mz_fix(row->value, -shown, 1);
    }
    if (p == B_SR && m_abs(shown) < 0.5f) {
        row->value[0] = 0;
        mz_cat(row->value, "FREEZE 2048");
    }
    if (p == C_EXP) {
        row->value[0] = 0;
        mz_int(row->value, (int32_t)shown);
        mz_cat(row->value, " >");
        mz_int(row->value, (int32_t)(-6.02f * (float)((1 << (int32_t)shown) - 2)));
        mz_cat(row->value, "DB");
    }
    if (shown != P[p].v)
        row->hot = 1;
}

void pj_status(char *s)
{
    if (hw_ms() < ui.axis_until) {
        mz_cat(s, "PUSH ");
        mz_cat(s, AX_NAME[ui.last_axis]);
    } else {
        mz_cat(s, PAGE_NAMES[(int)P[G_PAGE].v] + 2);
        if (sh.hyst_body > 0.05f) {
            mz_cat(s, " H");
            mz_fix(s, sh.hyst_body, 1);
        }
    }
}

uint32_t pj_plot_rev(void) { return sh.plot_rev; }

void pj_plot(int h)
{
    int k, c, x = 2, top = 11, hh = h - top - 1, mid = top + hh / 2;
    /* the chain: the order, bypassed stages dim */
    for (k = 0; k < NSTAGE; k++) {
        int s = k < NORDER ? sh.order[k] : k;
        x = scr_text(x, 1, 1, STAGE_NAME[s], sh.on[s] ? C_VAL : C_DIMC);
        if (k < NSTAGE - 1)
            x = scr_text(x, 1, 1, ">", C_DIMC);
    }
    scr_hline(0, mid, 240, C_RULE);
    for (c = 0; c < 240; c++) {
        float k = 1.8f / st.scope_s;
        int y0 = mid - (int)(m_clamp((st.scope_max[c] - st.scope_c) * k, -1.0f, 1.0f) * (float)(hh / 2));
        int y1 = mid - (int)(m_clamp((st.scope_min[c] - st.scope_c) * k, -1.0f, 1.0f) * (float)(hh / 2));
        if (y1 < y0)
            y1 = y0;
        hw_fill(c, y0, 1, y1 - y0 + 1, C_GRN);
    }
}

uint32_t pj_lit_keys(void)
{
    uint32_t m = 0;
    int i;
    for (i = 0; i < NSTAGE; i++)
        if (sh.on[i])
            m |= 1u << BLACK[i];
    if (sh.recon)
        m |= 1u << BLACK[9];
    if (sh.wire)
        m |= 1u << BLACK[10];
    for (i = 0; i < NAX; i++)
        if (sh.push[i] > 0.02f)
            m |= 1u << WHITE[i];
    return m;
}

uint32_t pj_dim_keys(void)
{
    uint32_t m = 0;
    int i;
    for (i = 0; i < 16; i++)
        m |= 1u << WHITE[i];
    for (i = 0; i < 11; i++)
        m |= 1u << BLACK[i];
    return m;
}
