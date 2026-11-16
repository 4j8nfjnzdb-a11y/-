/* musubime: single-precision maths with no libm and no double (the FM-1's FPU is float-only).
 * Every function is static inline so the audio path never calls out of its unit. */
#pragma once
#include <stdint.h>

#define M_SR 44100.0f
#define M_INV_SR (1.0f / 44100.0f)
#define M_TAU 6.28318530717959f
#define M_HZ2INC 97391.5480f              /* 2^32 / 44100: Hz to a 32-bit phase increment per sample */

typedef union { float f; uint32_t u; int32_t i; } mbits_t;

static inline float m_abs(float x) { mbits_t b; b.f = x; b.u &= 0x7FFFFFFFu; return b.f; }
static inline float m_min(float a, float b) { return a < b ? a : b; }
static inline float m_max(float a, float b) { return a > b ? a : b; }
static inline float m_clamp(float x, float lo, float hi) { return x < lo ? lo : x > hi ? hi : x; }
static inline int32_t m_clampi(int32_t x, int32_t lo, int32_t hi) { return x < lo ? lo : x > hi ? hi : x; }
static inline float m_sign(float x) { return x < 0.0f ? -1.0f : 1.0f; }
/* 1: a number (not NaN, not an infinity) */
static inline int m_finite(float x) { mbits_t b; b.f = x; return (b.u & 0x7F800000u) != 0x7F800000u; }

/* floor for |x| < 2^31 */
static inline float m_floor(float x)
{
    int32_t i = (int32_t)x;
    float f = (float)i;
    return f > x ? f - 1.0f : f;
}
static inline float m_round(float x) { return m_floor(x + 0.5f); }
static inline float m_frac(float x) { return x - m_floor(x); }

/* sin(2 pi x) for x in turns, |x| < 1e6: reduced to [-0.25, 0.25], then a Taylor series to x^9 (error < 4e-6) */
static inline float m_sin_t(float x)
{
    float x2;
    x -= m_floor(x + 0.5f);               /* [-0.5, 0.5) */
    if (x > 0.25f)
        x = 0.5f - x;
    else if (x < -0.25f)
        x = -0.5f - x;
    x2 = x * x;
    return x * (6.28318531f + x2 * (-41.3417022f + x2 * (81.6052518f + x2 * (-76.7058597f + x2 * 42.0586939f))));
}
/* sin of a 32-bit phase (a full cycle over 2^32) */
static inline float m_sin_u(uint32_t ph) { return m_sin_t((float)(int32_t)ph * (1.0f / 4294967296.0f)); }
/* sin of a 32-bit phase plus an offset in turns (the FM operator's form: phase modulation) */
static inline float m_sin_pm(uint32_t ph, float turns)
{
    turns = m_clamp(turns, -1.0e6f, 1.0e6f);
    return m_sin_t((float)(int32_t)ph * (1.0f / 4294967296.0f) + turns);
}

/* 2^x: the integer part into the exponent, 2^f on [-0.5, 0.5] by a Taylor series to f^7 */
static inline float m_exp2(float x)
{
    mbits_t b;
    float fl, f, p;
    if (x < -126.0f)
        return 0.0f;
    if (x > 126.0f)
        x = 126.0f;
    fl = m_floor(x + 0.5f);
    f = x - fl;
    p = 1.0f + f * (0.693147181f + f * (0.240226507f + f * (0.0555041087f + f * (0.00961812911f
        + f * (0.00133335581f + f * (0.000154035304f + f * 0.0000152527338f))))));
    b.f = p;
    b.i += (int32_t)fl << 23;
    return b.f;
}
/* log2(x) for x > 0 (0 or less gives -126) */
static inline float m_log2(float x)
{
    mbits_t b;
    int32_t e;
    float m, t, t2, ln;
    if (!(x > 1.0e-37f))
        return -126.0f;
    b.f = x;
    e = (int32_t)((b.u >> 23) & 255u) - 127;
    b.u = (b.u & 0x007FFFFFu) | 0x3F800000u;
    m = b.f;
    if (m > 1.41421356f) {
        m *= 0.5f;
        e++;
    }
    t = (m - 1.0f) / (m + 1.0f);
    t2 = t * t;
    ln = 2.0f * t * (1.0f + t2 * (0.333333333f + t2 * (0.2f + t2 * (0.142857143f + t2 * 0.111111111f))));
    return (float)e + ln * 1.44269504f;
}
static inline float m_db2lin(float db) { return m_exp2(db * 0.166096405f); }
static inline float m_lin2db(float g) { return m_log2(g) * 6.02059991f; }
/* tanh-like soft clip: exact at 0, slope 1 at 0, reaches +-1 at |x| = 3 */
static inline float m_tanh(float x)
{
    float x2;
    if (x > 3.0f)
        return 1.0f;
    if (x < -3.0f)
        return -1.0f;
    x2 = x * x;
    return x * (27.0f + x2) / (27.0f + 9.0f * x2);
}
/* a one-pole coefficient for a time constant in seconds at rate fs (exp(-1/(t fs)) by 1 - 1/(t fs) + ...) */
static inline float m_tc(float seconds, float fs)
{
    float k = 1.0f / (m_max(seconds, 1.0e-6f) * fs);
    if (k > 1.0f)
        return 0.0f;
    return m_exp2(-k * 1.44269504f);
}

/* xorshift32: a seed never 0 */
static inline uint32_t m_rng(uint32_t *s)
{
    uint32_t x = *s;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    if (!x)
        x = 0x9E3779B9u;
    return *s = x;
}
static inline float m_rnd(uint32_t *s) { return (float)(m_rng(s) >> 8) * (1.0f / 16777216.0f); }   /* [0, 1) */
static inline float m_rndb(uint32_t *s) { return m_rnd(s) * 2.0f - 1.0f; }                          /* [-1, 1) */

/* Hz (negative runs the phase backwards) to a phase increment */
static inline uint32_t m_inc(float hz)
{
    hz = m_clamp(hz, -22000.0f, 22000.0f);
    return (uint32_t)(int32_t)(hz * M_HZ2INC);
}
