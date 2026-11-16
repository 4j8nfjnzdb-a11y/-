/* musubime: an FM voice, and a bank of 28 places in its space (drums, keys, bells, basses, pads, noises).
 * Three operators:
 *   N  a second operator at NRATIO x the pitch with its own feedback NFB: at 0 a clean partial (a tine, a bell's
 *      second partial, a detuned copy); past about 1.5 rad a fed-back sine stops being periodic and its spectrum
 *      fills in: FM's own noise, no random numbers. NOISE sends it into M's phase; METAL crossfades the output
 *      toward it (ring-modulated by M)
 *   M  the modulator, at RATIO, with its own feedback FB
 *   C  the carrier, phase-modulated by M with an index that decays (INDEX, IDEC); its pitch falls from SWEEP octaves
 *      above PITCH with time constant SWT
 * Out: times an envelope (ATT rise, -60 dB in DECAY; DECAY at its top: held), then BITS. XMOD: another sound into C's
 * phase. Every voice in the bank is the same fifteen numbers; a lock, a mutation or a slot's settings can move any of
 * them, so a sound may drift from one place toward another. */
#pragma once
#include "mz.h"
#include "fm.h"

/* the voice's numbers (henka's lock destinations, in this order) */
enum { VP_PITCH, VP_SWEEP, VP_SWT, VP_RATIO, VP_INDEX, VP_IDEC, VP_FB, VP_NOISE, VP_METAL, VP_DEC, VP_XMOD, VP_BITS,
       VP_ATT, VP_NRATIO, VP_NFB, NVP };
static const char *const VP_NAME[NVP] = {"PITCH", "SWEEP", "SWT", "RATIO", "INDEX", "IDEC", "FB", "NOISE", "METAL",
                                         "DECAY", "XMOD", "BITS", "ATTACK", "NRATIO", "NFB"};
static const char *const VP_UNIT[NVP] = {"HZ", "OCT", "S", "", "RAD", "S", "RAD", "", "", "S", "RAD", "BIT", "S", "",
                                         "RAD"};
static const float VP_LO[NVP] = {20.0f, 0.0f, 0.002f, 0.125f, 0.0f, 0.005f, -1.0f, 0.0f, 0.0f, 0.01f, 0.0f, 1.0f,
                                 0.0005f, 0.25f, 0.0f};
static const float VP_HI[NVP] = {8000.0f, 6.0f, 0.5f, 16.0f, 20.0f, 4.0f, 3.2f, 1.0f, 1.0f, 6.0f, 8.0f, 24.0f,
                                 3.0f, 16.0f, 3.2f};
static const uint8_t VP_DECIMALS[NVP] = {0, 2, 3, 3, 2, 3, 2, 2, 2, 2, 2, 1, 3, 2, 2};
/* PITCH and the times step as ratios, the rest as fractions of their range */
static const uint8_t VP_LOGSTEP[NVP] = {1, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0};
#define VP_HELD 5.95f                    /* DECAY at or above: held */

/* the bank. The first four are henka's tracks' starting places */
enum { VB_KICK, VB_SNARE, VB_HAT, VB_SYNTH, NVB = 28 };
#define VB_SINE_INDEX 9
static const char *const VB_NAME[NVB] = {
    "KICK", "SNARE", "HAT", "SYNTH", "OHAT", "TOM", "RIM", "COWBEL", "CYMBAL", "SINE", "EPIANO", "BELL", "MARIMB",
    "BASS", "BRASS", "ORGAN", "PAD", "PLUCK", "REED", "STRING", "METAL", "GLASS", "WIND", "CHAOS", "DRONE", "VOX",
    "DIGI", "ZAP"};
static const float VB_POINT[NVB][NVP] = {
    /* PITCH   SWEEP SWT    RATIO   INDEX IDEC   FB     NOISE METAL DEC     XMOD BITS   ATT     NRATIO NFB */
    {48.0f, 3.2f, 0.022f, 1.0f, 2.2f, 0.035f, 0.0f, 0.0f, 0.0f, 0.42f, 0.0f, 24.0f, 0.001f, 7.13f, 2.8f},    /* KICK */
    {190.0f, 0.9f, 0.012f, 1.47f, 3.0f, 0.05f, 1.1f, 0.7f, 0.22f, 0.17f, 0.0f, 24.0f, 0.001f, 7.13f, 2.8f},  /* SNARE */
    {1180.0f, 0.0f, 0.01f, 3.17f, 6.0f, 0.03f, 2.4f, 1.0f, 0.75f, 0.055f, 0.0f, 24.0f, 0.001f, 7.13f, 2.8f}, /* HAT */
    {110.0f, 0.0f, 0.01f, 2.0f, 1.8f, 0.7f, 0.25f, 0.0f, 0.0f, 1.3f, 0.0f, 24.0f, 0.005f, 7.13f, 2.8f},      /* SYNTH */
    {1180.0f, 0.0f, 0.01f, 3.17f, 6.0f, 0.3f, 2.4f, 1.0f, 0.8f, 0.45f, 0.0f, 24.0f, 0.001f, 7.13f, 2.8f},    /* OHAT */
    {110.0f, 1.0f, 0.05f, 1.0f, 1.4f, 0.06f, 0.2f, 0.1f, 0.05f, 0.5f, 0.0f, 24.0f, 0.001f, 5.1f, 2.8f},      /* TOM */
    {820.0f, 0.3f, 0.004f, 2.37f, 4.0f, 0.008f, 0.4f, 0.2f, 0.3f, 0.03f, 0.0f, 24.0f, 0.0005f, 4.3f, 1.0f},  /* RIM */
    {560.0f, 0.0f, 0.01f, 1.48f, 0.8f, 0.2f, 0.0f, 0.0f, 0.45f, 0.3f, 0.0f, 24.0f, 0.001f, 1.48f, 0.0f},     /* COWBEL */
    {1500.0f, 0.0f, 0.01f, 3.41f, 8.0f, 0.6f, 2.6f, 1.0f, 0.85f, 1.8f, 0.0f, 24.0f, 0.002f, 5.33f, 2.9f},    /* CYMBAL */
    {220.0f, 0.0f, 0.01f, 1.0f, 0.0f, 1.0f, 0.0f, 0.0f, 0.0f, 6.0f, 0.0f, 24.0f, 0.01f, 7.13f, 2.8f},        /* SINE */
    {220.0f, 0.0f, 0.01f, 1.0f, 1.6f, 0.3f, 0.0f, 0.0f, 0.22f, 1.6f, 0.0f, 24.0f, 0.002f, 14.0f, 0.0f},      /* EPIANO */
    {440.0f, 0.0f, 0.01f, 3.5f, 4.0f, 1.5f, 0.0f, 0.0f, 0.3f, 2.6f, 0.0f, 24.0f, 0.001f, 2.76f, 0.0f},       /* BELL */
    {330.0f, 0.0f, 0.01f, 4.0f, 3.0f, 0.05f, 0.0f, 0.0f, 0.0f, 0.45f, 0.0f, 24.0f, 0.001f, 10.0f, 0.0f},     /* MARIMB */
    {55.0f, 0.2f, 0.01f, 1.0f, 3.0f, 0.12f, 0.6f, 0.0f, 0.0f, 0.55f, 0.0f, 24.0f, 0.003f, 2.0f, 0.0f},       /* BASS */
    {165.0f, 0.0f, 0.01f, 1.0f, 3.5f, 1.2f, 1.0f, 0.0f, 0.0f, 6.0f, 0.0f, 24.0f, 0.07f, 2.0f, 0.0f},         /* BRASS */
    {220.0f, 0.0f, 0.01f, 2.0f, 1.0f, 4.0f, 0.2f, 0.0f, 0.3f, 6.0f, 0.0f, 24.0f, 0.01f, 3.0f, 0.0f},         /* ORGAN */
    {220.0f, 0.0f, 0.01f, 2.003f, 1.2f, 3.0f, 0.4f, 0.0f, 0.15f, 6.0f, 0.0f, 24.0f, 0.9f, 1.004f, 0.0f},     /* PAD */
    {220.0f, 0.0f, 0.01f, 1.0f, 5.0f, 0.02f, 0.3f, 0.0f, 0.0f, 0.8f, 0.0f, 24.0f, 0.001f, 2.0f, 0.0f},       /* PLUCK */
    {220.0f, 0.0f, 0.01f, 2.0f, 2.0f, 2.0f, 0.5f, 0.0f, 0.0f, 6.0f, 0.0f, 24.0f, 0.04f, 3.0f, 0.0f},         /* REED */
    {220.0f, 0.0f, 0.01f, 1.0f, 0.5f, 3.0f, 1.2f, 0.0f, 0.1f, 6.0f, 0.0f, 24.0f, 0.35f, 1.006f, 0.9f},       /* STRING */
    {300.0f, 0.0f, 0.01f, 1.41f, 6.0f, 1.0f, 0.3f, 0.0f, 0.5f, 3.0f, 0.0f, 24.0f, 0.001f, 3.17f, 0.0f},      /* METAL */
    {660.0f, 0.0f, 0.01f, 5.19f, 1.5f, 2.0f, 0.0f, 0.0f, 0.2f, 4.0f, 0.0f, 24.0f, 0.002f, 7.4f, 0.0f},       /* GLASS */
    {400.0f, 0.0f, 0.01f, 1.0f, 0.5f, 2.0f, 0.2f, 1.0f, 0.9f, 6.0f, 0.0f, 24.0f, 1.2f, 2.5f, 2.8f},          /* WIND */
    {140.0f, 0.0f, 0.01f, 1.0f, 8.0f, 4.0f, 3.0f, 0.3f, 0.2f, 6.0f, 0.0f, 24.0f, 0.01f, 7.13f, 2.8f},        /* CHAOS */
    {40.0f, 0.0f, 0.01f, 0.5f, 0.8f, 4.0f, 0.3f, 0.0f, 0.0f, 6.0f, 0.0f, 24.0f, 0.5f, 3.0f, 0.0f},           /* DRONE */
    {220.0f, 0.0f, 0.01f, 5.0f, 1.0f, 3.0f, 0.1f, 0.0f, 0.2f, 6.0f, 0.0f, 24.0f, 0.05f, 3.9f, 0.0f},         /* VOX */
    {330.0f, 0.0f, 0.01f, 7.0f, 3.0f, 0.4f, 0.4f, 0.0f, 0.0f, 1.2f, 0.0f, 6.0f, 0.001f, 7.13f, 2.8f},        /* DIGI */
    {1500.0f, 5.0f, 0.03f, 1.0f, 2.0f, 0.1f, 0.5f, 0.0f, 0.0f, 0.3f, 0.0f, 24.0f, 0.001f, 7.13f, 2.8f},      /* ZAP */
};
static const float VB_LEVEL[NVB] = {0.85f, 0.5f, 0.22f, 0.38f, 0.2f, 0.6f, 0.35f, 0.3f, 0.18f, 0.4f, 0.4f, 0.3f,
                                    0.45f, 0.6f, 0.32f, 0.3f, 0.3f, 0.45f, 0.32f, 0.3f, 0.28f, 0.3f, 0.25f, 0.22f,
                                    0.5f, 0.3f, 0.3f, 0.4f};
static const int8_t VB_HELD[NVB] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0};

typedef struct {
    op_t c, m, n;
    float sweep_env, idx_env, amp;
    uint32_t att_left;
    float y;                             /* the last output (XMOD into the next voice) */
} vox_t;

typedef struct {
    float k_sweep, k_idx, k_amp, f0, sweep_oct, ratio, index, fb, noise, metal, xmod, bits_step, nratio, nfb;
    uint32_t att_n;
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

static inline void vox_trig(vox_t *v, const vox_k_t *k)
{
    v->sweep_env = 1.0f;
    v->idx_env = 1.0f;
    v->att_left = k->att_n;
}

/* the per-block coefficients from the voice's numbers p[NVP] */
static inline void vox_coefs(vox_k_t *k, const float *p)
{
    k->k_sweep = m_exp2(-1.44269504f / (m_max(p[VP_SWT], 0.001f) * M_SR));
    k->k_idx = p[VP_IDEC] >= 3.99f ? 1.0f : m_exp2(-1.44269504f / (m_max(p[VP_IDEC], 0.001f) * M_SR));
    k->k_amp = p[VP_DEC] >= VP_HELD ? 1.0f : m_exp2(-9.96578428f / (m_max(p[VP_DEC], 0.005f) * M_SR));
    k->f0 = p[VP_PITCH];
    k->sweep_oct = p[VP_SWEEP];
    k->ratio = p[VP_RATIO];
    k->index = p[VP_INDEX] * 0.159154943f;
    k->fb = p[VP_FB] * 0.159154943f;
    k->noise = p[VP_NOISE] * 0.5f;
    k->metal = p[VP_METAL];
    k->xmod = p[VP_XMOD] * 0.159154943f;
    k->bits_step = p[VP_BITS] < 23.5f ? m_exp2(1.0f - p[VP_BITS]) : 0.0f;
    k->att_n = (uint32_t)(m_clamp(p[VP_ATT], 0.0005f, 3.0f) * M_SR);
    k->nratio = p[VP_NRATIO];
    k->nfb = p[VP_NFB] * 0.159154943f;
}

/* one sample; ext: another sound for XMOD */
static inline float vox_run(vox_t *v, const vox_k_t *k, float ext)
{
    float fc = k->f0, n, m, c, y;
    if (k->sweep_oct > 0.0f && v->sweep_env > 1.0e-4f)
        fc *= m_exp2(k->sweep_oct * v->sweep_env);
    v->sweep_env *= k->k_sweep;
    v->idx_env *= k->k_idx;
    if (v->att_left) {
        v->amp += (1.0f - v->amp) / (float)v->att_left;
        v->att_left--;
    } else {
        v->amp *= k->k_amp;
    }
    n = op_run(&v->n, m_inc(m_min(fc * k->nratio, 15000.0f)), k->nfb * v->n.y);
    m = op_run(&v->m, m_inc(fc * k->ratio), k->fb * v->m.y + k->noise * n);
    c = op_run(&v->c, m_inc(fc), k->index * v->idx_env * m + k->xmod * ext);
    y = (1.0f - k->metal) * c + k->metal * n * (0.5f + 0.5f * m);
    y *= v->amp;
    if (k->bits_step > 0.0f)
        y = m_floor(y / k->bits_step + 0.5f) * k->bits_step;
    v->y = y;
    return y;
}

/* ---- the slots (shell.c: EDIT held). src 0: the project's own sound; 1..NVB: the bank's kind src - 1 ---- */
/* a slot's voice numbers: its kind, moved by the slot's settings and then by the project's own (pitch and ratio
 * multiplied, index and feedback added, decay multiplied; each kind keeps its own register) */
static inline void vox_slot_place(float *p, const mz_slot_t *s, float pitch_x, float ratio_x, float index_add,
                                  float fb_add, float dec_x)
{
    int d, kind = s->src > 0 && s->src <= NVB ? s->src - 1 : VB_SINE_INDEX;
    for (d = 0; d < NVP; d++)
        p[d] = VB_POINT[kind][d];
    p[VP_PITCH] = m_clamp(p[VP_PITCH] * pitch_x * m_exp2(s->tune), 20.0f, 8000.0f);
    p[VP_RATIO] = m_clamp(p[VP_RATIO] * ratio_x, 0.125f, 16.0f);
    p[VP_INDEX] = m_clamp(p[VP_INDEX] + index_add + s->bright, 0.0f, 20.0f);
    p[VP_FB] = m_clamp(p[VP_FB] + fb_add + s->fb, -1.0f, 3.2f);
    if (p[VP_DEC] < VP_HELD)
        p[VP_DEC] = m_clamp(p[VP_DEC] * dec_x * s->dec_x, 0.01f, 5.9f);
}
static inline float vox_slot_level(const mz_slot_t *s)
{
    int kind = s->src > 0 && s->src <= NVB ? s->src - 1 : VB_SINE_INDEX;
    return VB_LEVEL[kind] * m_db2lin(s->level_db);
}

/* a sustained kind (DECAY held) given an end: it fades over seconds instead (a sequencer's or a line's sound) */
static inline void vox_gate(float *p, float seconds)
{
    if (p[VP_DEC] >= VP_HELD)
        p[VP_DEC] = m_clamp(seconds, 0.05f, 5.9f);
}
