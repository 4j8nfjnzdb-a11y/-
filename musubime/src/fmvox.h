/* musubime: an FM voice whose kinds (kick, snare, hat, synth) are points in one continuous space, not presets.
 * Three operators:
 *   N  a noise operator: a sine with strong self-feedback (2.8 rad). Past about 1.5 rad a fed-back sine stops being
 *      periodic and its spectrum fills in: FM's own noise, no random numbers
 *   M  the modulator, at RATIO above the carrier, with its own feedback FB and N mixed into its phase (NOISE)
 *   C  the carrier, phase-modulated by M with an index that decays (INDEX, IDEC); its pitch falls from SWEEP octaves
 *      above PITCH with time constant SWT (a kick is mostly this)
 * Out: C, crossfaded by METAL toward N ring-modulated by M (a hat is mostly this), times an envelope (1 ms rise,
 * -60 dB in DECAY), and BITS. XMOD: another voice's output into C's phase (one track modulating the next).
 * Every kind is the same twelve numbers; a lock or a mutation can move any of them, so a voice may drift from one kind
 * toward another. */
#pragma once
#include "fm.h"

enum { VK_KICK, VK_SNARE, VK_HAT, VK_SYNTH, NVK };
static const char *const VK_NAME[NVK] = {"KICK", "SNARE", "HAT", "SYNTH"};
static const char *const VK_SHORT[NVK] = {"KCK", "SNR", "HAT", "SYN"};

/* the voice's numbers; their order is the lock destinations' */
enum { VP_PITCH, VP_SWEEP, VP_SWT, VP_RATIO, VP_INDEX, VP_IDEC, VP_FB, VP_NOISE, VP_METAL, VP_DEC, VP_XMOD, VP_BITS, NVP };
static const char *const VP_NAME[NVP] = {"PITCH", "SWEEP", "SWT", "RATIO", "INDEX", "IDEC", "FB", "NOISE", "METAL",
                                         "DECAY", "XMOD", "BITS"};
static const char *const VP_UNIT[NVP] = {"HZ", "OCT", "S", "", "RAD", "S", "RAD", "", "", "S", "RAD", "BIT"};
static const float VP_LO[NVP] = {20.0f, 0.0f, 0.002f, 0.125f, 0.0f, 0.005f, -1.0f, 0.0f, 0.0f, 0.01f, 0.0f, 1.0f};
static const float VP_HI[NVP] = {4000.0f, 6.0f, 0.5f, 16.0f, 20.0f, 4.0f, 3.2f, 1.0f, 1.0f, 6.0f, 8.0f, 24.0f};
static const uint8_t VP_DECIMALS[NVP] = {0, 2, 3, 3, 2, 3, 2, 2, 2, 2, 2, 1};
/* each number's step for one detent: a fraction of its range, PITCH and the times in ratios (VP_LOGSTEP) */
static const uint8_t VP_LOGSTEP[NVP] = {1, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0};

/* the kinds: where each starts */
static const float VK_POINT[NVK][NVP] = {
    /* PITCH   SWEEP SWT     RATIO  INDEX IDEC    FB     NOISE  METAL  DEC     XMOD  BITS */
    {48.0f, 3.2f, 0.022f, 1.0f, 2.2f, 0.035f, 0.0f, 0.0f, 0.0f, 0.42f, 0.0f, 24.0f},     /* KICK */
    {190.0f, 0.9f, 0.012f, 1.47f, 3.0f, 0.05f, 1.1f, 0.7f, 0.22f, 0.17f, 0.0f, 24.0f},   /* SNARE */
    {1180.0f, 0.0f, 0.01f, 3.17f, 6.0f, 0.03f, 2.4f, 1.0f, 0.75f, 0.055f, 0.0f, 24.0f},  /* HAT */
    {110.0f, 0.0f, 0.01f, 2.0f, 1.8f, 0.7f, 0.25f, 0.0f, 0.0f, 1.3f, 0.0f, 24.0f},     /* SYNTH */
};
static const float VK_LEVEL[NVK] = {0.85f, 0.5f, 0.22f, 0.38f};

typedef struct {
    op_t c, m, n;
    float sweep_env, idx_env, amp;
    uint32_t att_left;
    float y;                             /* the last output (XMOD into the next voice) */
} vox_t;

typedef struct {
    float k_sweep, k_idx, k_amp, f0, sweep_oct, ratio, index, fb, noise, metal, xmod, bits_step;
    uint32_t inc_n;
} vox_k_t;

static inline void vox_reset(vox_t *v)
{
    v->c.ph = v->m.ph = 0;
    v->n.ph = 0x2468ACE0u;
    v->c.y = v->m.y = 0.0f;
    v->n.y = 0.1f;
    v->sweep_env = v->idx_env = v->amp = 0.0f;
    v->att_left = 0;
    v->y = 0.0f;
}

static inline void vox_trig(vox_t *v)
{
    v->sweep_env = 1.0f;
    v->idx_env = 1.0f;
    v->att_left = 44u;                   /* 1 ms to full */
}

/* the per-block coefficients from the voice's numbers p[NVP] */
static inline void vox_coefs(vox_k_t *k, const float *p)
{
    k->k_sweep = m_exp2(-1.44269504f / (m_max(p[VP_SWT], 0.001f) * M_SR));
    k->k_idx = m_exp2(-1.44269504f / (m_max(p[VP_IDEC], 0.001f) * M_SR));
    k->k_amp = p[VP_DEC] >= 5.95f ? 1.0f : m_exp2(-9.96578428f / (m_max(p[VP_DEC], 0.005f) * M_SR));   /* max: held */
    k->f0 = p[VP_PITCH];
    k->sweep_oct = p[VP_SWEEP];
    k->ratio = p[VP_RATIO];
    k->index = p[VP_INDEX] * 0.159154943f;
    k->fb = p[VP_FB] * 0.159154943f;
    k->noise = p[VP_NOISE] * 0.5f;
    k->metal = p[VP_METAL];
    k->xmod = p[VP_XMOD] * 0.159154943f;
    k->bits_step = p[VP_BITS] < 23.5f ? m_exp2(1.0f - p[VP_BITS]) : 0.0f;
    k->inc_n = m_inc(m_min(p[VP_PITCH] * 7.13f, 15000.0f));
}

/* one sample; ext: another voice's output for XMOD */
static inline float vox_run(vox_t *v, const vox_k_t *k, float ext)
{
    float fc = k->f0, n, m, c, y;
    if (k->sweep_oct > 0.0f && v->sweep_env > 1.0e-4f)
        fc *= m_exp2(k->sweep_oct * v->sweep_env);
    v->sweep_env *= k->k_sweep;
    v->idx_env *= k->k_idx;
    if (v->att_left) {
        v->att_left--;
        v->amp += (1.0f - v->amp) * 0.12f;
    } else {
        v->amp *= k->k_amp;
    }
    n = op_run(&v->n, k->inc_n, 0.4456338f * v->n.y);          /* 2.8 rad of self-feedback */
    m = op_run(&v->m, m_inc(fc * k->ratio), k->fb * v->m.y + k->noise * n);
    c = op_run(&v->c, m_inc(fc), k->index * v->idx_env * m + k->xmod * ext);
    y = (1.0f - k->metal) * c + k->metal * n * (0.5f + 0.5f * m);
    y *= v->amp;
    if (k->bits_step > 0.0f)
        y = m_floor(y / k->bits_step + 0.5f) * k->bits_step;
    v->y = y;
    return y;
}
