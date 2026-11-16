/* musubime: a parameter an encoder turns. Kinds:
 *   P_LIN   v += detents x step
 *   P_LOG   signed, steps even in octaves away from 0: u = sign(v) log2(1 + |v|/c), u += detents / step (steps
 *           per octave), through 0 into the negatives (a rate, a frequency)
 *   P_INT   an integer, clamped
 *   P_ENUM  an integer with names, wrapping
 *   P_GRAY  an integer whose bits change one at a time (Gray code of the turned count): a mask
 * Values may be pushed beyond lo / hi by nothing but the definition: the range IS the instrument's. */
#pragma once
#include "mz.h"

enum { P_LIN, P_LOG, P_INT, P_ENUM, P_GRAY };

typedef struct {
    const char *name;                    /* 6 characters for the screen */
    uint8_t kind, dec;                   /* dec: decimals shown */
    float lo, hi, step, c;
    const char *unit;
    const char *const *names;            /* P_ENUM */
    float usual_lo, usual_hi;            /* outside: shown red */
} par_def_t;

typedef struct {
    float v, u;
    uint32_t hot_until;
} par_t;

static inline float par_u2v(const par_def_t *d, float u)
{
    float a = m_abs(u);
    return m_sign(u) * d->c * (m_exp2(a) - 1.0f);
}
static inline float par_v2u(const par_def_t *d, float v)
{
    return m_sign(v) * m_log2(1.0f + m_abs(v) / d->c);
}

static inline void par_set(const par_def_t *d, par_t *p, float v)
{
    p->v = m_clamp(v, d->lo, d->hi);
    if (d->kind == P_LOG)
        p->u = par_v2u(d, p->v);
    else if (d->kind == P_GRAY)
        p->u = p->v;                     /* u: the count; v: its Gray code (set from a count) */
}

/* turned d detents; accel >= 1 multiplies them (fast turning travels further). Returns 1 if it changed */
static inline int par_turn(const par_def_t *d, par_t *p, int32_t det, float accel, uint32_t now)
{
    float old = p->v, n = (float)det * accel;
    if (!det)
        return 0;
    switch (d->kind) {
    case P_LIN:
        p->v = m_clamp(p->v + n * d->step, d->lo, d->hi);
        break;
    case P_LOG: {
        float ulo = par_v2u(d, d->lo), uhi = par_v2u(d, d->hi);
        p->u = m_clamp(p->u + n / d->step, ulo, uhi);
        p->v = m_clamp(par_u2v(d, p->u), d->lo, d->hi);
        if (m_abs(p->v) < d->c * 0.01f)
            p->v = 0.0f;
        break;
    }
    case P_INT:
        p->v = m_clamp(p->v + (float)det, d->lo, d->hi);
        break;
    case P_ENUM: {
        int32_t k = (int32_t)p->v + det, span = (int32_t)(d->hi - d->lo) + 1;
        k = (int32_t)d->lo + (((k - (int32_t)d->lo) % span) + span) % span;
        p->v = (float)k;
        break;
    }
    case P_GRAY: {
        int32_t k = (int32_t)p->u + (int32_t)n;
        k = m_clampi(k, (int32_t)d->lo, (int32_t)d->hi);
        p->u = (float)k;
        p->v = (float)(uint32_t)((uint32_t)k ^ ((uint32_t)k >> 1));
        break;
    }
    }
    p->hot_until = now + 400u;
    return p->v != old;
}

static inline void par_text(const par_def_t *d, const par_t *p, char *out)
{
    out[0] = 0;
    if (d->kind == P_ENUM && d->names) {
        mz_cat(out, d->names[(int32_t)p->v - (int32_t)d->lo]);
        return;
    }
    if (d->kind == P_GRAY) {
        mz_hex4(out, (uint32_t)p->v);
        return;
    }
    mz_fix(out, p->v, d->dec);
    if (d->unit && d->unit[0]) {
        mz_cat(out, " ");
        mz_cat(out, d->unit);
    }
}

/* a row of the screen from a parameter */
static inline void par_row(const par_def_t *d, const par_t *p, mz_row_t *r, uint32_t now, float shown)
{
    par_t q = *p;
    int i;
    q.v = shown;
    for (i = 0; i < 6 && d->name[i]; i++)
        r->label[i] = d->name[i];
    r->label[i] = 0;
    par_text(d, &q, r->value);
    r->hot = now < p->hot_until;
    r->alert = shown < d->usual_lo || shown > d->usual_hi;
}

/* fast turning travels further: 1 at rest, x2 at 30 detents a second, at most x4 */
static inline float par_accel(float speed) { return 1.0f + m_min(3.0f, speed * speed * (1.0f / 900.0f)); }
