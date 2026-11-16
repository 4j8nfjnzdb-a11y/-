/* musubime: FM operators and the few generators the projects share. Static inline: the render calls nothing. */
#pragma once
#include "m.h"

/* an operator: a 32-bit phase, phase-modulated by pm (turns) */
typedef struct {
    uint32_t ph;
    float y;
} op_t;
static inline float op_run(op_t *o, uint32_t inc, float pm_turns)
{
    float y = m_sin_pm(o->ph, pm_turns);
    o->ph += inc;
    o->y = y;
    return y;
}

/* an attack-decay envelope: attack in samples (linear), then exponential decay to -60 dB in dec seconds
 * (dec <= 0: held); retriggered from where it is (no click) */
typedef struct {
    float v, k;
    uint32_t att_left, att_n;
    float att_from;
} env_t;
static inline void env_trig(env_t *e, uint32_t att_samples)
{
    e->att_n = att_samples ? att_samples : 1u;
    e->att_left = e->att_n;
    e->att_from = e->v;
}
static inline float env_run(env_t *e, float dec_s)
{
    if (e->att_left) {
        e->att_left--;
        e->v = e->att_from + (1.0f - e->att_from) * (1.0f - (float)e->att_left / (float)e->att_n);
        return e->v;
    }
    if (dec_s > 0.0f) {
        /* -60 dB in dec_s: a factor of 10^(-3 / (dec_s fs)) a sample */
        e->v *= m_exp2(-9.96578428f / (dec_s * M_SR));
    }
    return e->v;
}

/* 1/f noise (Voss-McCartney, 8 rows): between white and a random walk, self-similar */
typedef struct {
    float row[8], sum;
    uint32_t n;
} pink_t;
static inline float pink_next(pink_t *p, uint32_t *seed)
{
    uint32_t n = ++p->n, k = 0;
    float r;
    while (k < 7u && !(n & (1u << k)))
        k++;
    r = m_rndb(seed);
    p->sum += r - p->row[k];
    p->row[k] = r;
    return p->sum * 0.125f;
}

/* the logistic map at the onset of chaos (Feigenbaum's point, r = 3.5699456...): aperiodic, structured, not noise */
#define FEIGENBAUM_R 3.5699456718f
static inline float logistic_next(float x) { return FEIGENBAUM_R * x * (1.0f - x); }

/* a one-pole smoother */
static inline float glide(float *s, float target, float k)
{
    *s += (target - *s) * k;
    return *s;
}
