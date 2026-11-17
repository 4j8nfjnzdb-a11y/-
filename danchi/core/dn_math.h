/* Single-precision helpers without libm. Every literal carries an f suffix. */
#ifndef DN_MATH_H
#define DN_MATH_H
#include <stdint.h>

typedef union { float f; uint32_t u; } dn_fu;

static inline float dn_abs(float x) { return __builtin_fabsf(x); }
static inline float dn_sqrt(float x) { return x > 0.0f ? __builtin_sqrtf(x) : 0.0f; }
static inline float dn_min(float a, float b) { return a < b ? a : b; }
static inline float dn_max(float a, float b) { return a > b ? a : b; }
static inline float dn_clamp(float x, float a, float b) { return x < a ? a : (x > b ? b : x); }
static inline float dn_clamp01(float x) { return dn_clamp(x, 0.0f, 1.0f); }
static inline int dn_floori(float x) { int i = (int)x; return (x < (float)i) ? i - 1 : i; }
static inline int dn_roundi(float x) { return dn_floori(x + 0.5f); }

/* 2^x, |rel err| < 2e-4 */
static inline float dn_exp2(float x) {
    if (x < -125.0f) return 0.0f;
    if (x > 125.0f) x = 125.0f;
    int i = dn_floori(x);
    float f = x - (float)i;
    float p = 1.0f + f * (0.6931472f + f * (0.2402265f + f * (0.0555041f + f * (0.0096181f + f * 0.0013333f))));
    dn_fu v; v.u = (uint32_t)(i + 127) << 23;
    return p * v.f;
}
static inline float dn_log2(float x) {
    if (!(x > 1e-37f)) return -125.0f;
    dn_fu v; v.f = x;
    int e = (int)((v.u >> 23) & 255u) - 127;
    v.u = (v.u & 0x007FFFFFu) | 0x3F800000u;
    float m = v.f, t = (m - 1.0f) / (m + 1.0f), t2 = t * t;
    return (float)e + t * (2.8853901f + t2 * (0.9617967f + t2 * (0.5770780f + t2 * 0.4121985f)));
}
static inline float dn_exp(float x) { return dn_exp2(x * 1.4426950f); }
static inline float dn_pow(float a, float b) { return dn_exp2(b * dn_log2(a)); }
/* one-pole coefficient for a time constant tau (s) at rate (Hz) */
static inline float dn_tc(float tau, float rate) {
    if (tau <= 0.0f) return 1.0f;
    return 1.0f - dn_exp(-1.0f / (tau * rate));
}
/* sin for x in [-pi, pi] (used only to build the table) */
static inline float dn_sin_poly(float x) {
    const float PI = 3.14159265f, HP = 1.57079633f;
    if (x > HP) x = PI - x;
    else if (x < -HP) x = -PI - x;
    float x2 = x * x;
    return x * (1.0f + x2 * (-1.6666667e-1f + x2 * (8.3333333e-3f + x2 * (-1.9841270e-4f + x2 * (2.7557319e-6f + x2 * -2.5052108e-8f)))));
}
/* gentle saturator, |y| < 1 */
static inline float dn_soft(float x) {
    if (x > 3.0f) return 1.0f;
    if (x < -3.0f) return -1.0f;
    float x2 = x * x;
    return x * (27.0f + x2) / (27.0f + 9.0f * x2);
}
/* flush tiny values to zero (decaying states must never become denormal) */
static inline float dn_flush(float x) { return (x < 1e-12f && x > -1e-12f) ? 0.0f : x; }

#endif
