/* FELDMAN: nearly the same, never the same. Small, quiet, sustained (after Morton Feldman's late music, Crippled
 * Symmetry above all, and his talk of Anatolian rugs whose repeats are dyed in small batches: the colour drifts across
 * a field, "abrash"; see docs/DESIGN.md for what is his and what is ours).
 * Three layers, each a short pattern of soft FM tones. The patterns repeat, each at its own unit of time (the units
 * differ by ASYM: the layers slide against each other and meet again only rarely). At each repetition a pattern
 * changes very little:
 *   - abrash: every tone's colour and loudness drift by 1/f noise (Voss-McCartney), one step a repetition: slow
 *     batches of change, neither a random jitter nor a straight line;
 *   - crippling: now and then one tone gains or loses one unit, for good, and the pattern's length is no longer what
 *     it was (with probability ASYM, the layer chosen by the hand's last reversal).
 * Pitches are not chosen from a scale: each layer sits at an irrational ratio to REG (1, sqrt(phi), phi) and its two
 * tones lie a few tens of cents apart, so what is heard is beating and colour, not intervals.
 * It begins with one layer of two equal tones; the second layer joins after six repetitions, the third after thirteen;
 * every seventeen repetitions a layer gains a tone (up to five), and with ASYM a tone may fall silent or sound again.
 * The body is answered inversely: an agitated hand makes it quieter and sparser, not louder; stillness lets the
 * abrash settle toward symmetry (the crippling stays). Holding a white key lengthens that tone of the layer, for
 * good, as long as it is held (pressing harder, faster). */
#include "par.h"
#include "fm.h"

const char PJ_NAME[] = "FELDMAN";

#define NLY 3
#define MAXN 7
typedef struct {
    uint8_t n;                           /* tones in the pattern */
    uint8_t units[MAXN];
    float cents[MAXN];                   /* from the layer's pitch */
    float col[MAXN], amp[MAXN];          /* abrash: colour (index) and loudness offsets */
    uint8_t rest[MAXN];
    pink_t pk_col, pk_amp;
    uint32_t reps;
    uint8_t on, joined;
    int pos;                             /* the tone now (render) */
} layer_t;

static const char *const LAYER_NAMES[] = {"A", "B", "C"};
enum { G_LAYER, G_NOTES, G_UNIT, G_ASYM, G_ABRASH, G_BRIGHT, G_REG, NPAR };
static const par_def_t DEF[NPAR] = {
    {"LAYER", P_ENUM, 0, 0, 2, 1, 1, "", LAYER_NAMES, 0, 2},
    {"NOTES", P_INT, 0, 1, MAXN, 1, 1, "", 0, 1, MAXN},
    {"UNIT", P_LOG, 0, 80.0f, 2400.0f, 12.0f, 80.0f, "MS", 0, 150.0f, 1500.0f},
    {"ASYM", P_LIN, 3, 0.0f, 0.3f, 0.002f, 0, "", 0, 0.0f, 0.12f},
    {"ABRASH", P_LIN, 2, 0.0f, 1.0f, 0.01f, 0, "", 0, 0.0f, 0.6f},
    {"BRIGHT", P_LIN, 2, 0.0f, 3.0f, 0.02f, 0, "RAD", 0, 0.0f, 1.5f},
    {"REG", P_LOG, 0, 40.0f, 3000.0f, 24.0f, 40.0f, "HZ", 0, 60.0f, 1500.0f},
};
static par_t P[NPAR];
static const float LAYER_RATIO[NLY] = {1.0f, 1.2720196f, 1.6180340f};

static struct {
    layer_t ly[NLY];
    volatile uint32_t home_req;
    float quiet;                         /* the body's inverse answer: 0..1 */
    float settle;                        /* stillness: abrash scaled down */
    int crip_layer;
    uint32_t crips;
    uint32_t plot_rev;
    uint32_t seed;
    int hold_key;
    float hold_amt;
} sh;

static struct {
    uint32_t home_seen;
    op_t car[NLY], mod[NLY];
    uint32_t t[NLY], len_n[NLY];
    float env[NLY], target_env[NLY];
    float level_s;
    uint32_t hold_acc;
} st;

static void layer_init(layer_t *L, int k)
{
    int i;
    L->n = 2;
    for (i = 0; i < MAXN; i++) {
        L->units[i] = 2;
        L->cents[i] = (i & 1) ? 23.0f + 9.0f * (float)k : 0.0f;
        L->col[i] = L->amp[i] = 0.0f;
        L->rest[i] = 0;
    }
    for (i = 0; i < 8; i++)
        L->pk_col.row[i] = L->pk_amp.row[i] = 0.0f;
    L->pk_col.sum = L->pk_amp.sum = 0.0f;
    L->pk_col.n = L->pk_amp.n = 0;
    L->reps = 0;
    L->on = 1;
    L->joined = k == 0;
    L->pos = -1;
}

static void defaults(void)
{
    int k;
    for (k = 0; k < NPAR; k++)
        par_set(&DEF[k], &P[k], 0.0f);
    par_set(&DEF[G_NOTES], &P[G_NOTES], 2.0f);
    par_set(&DEF[G_UNIT], &P[G_UNIT], 420.0f);
    par_set(&DEF[G_ASYM], &P[G_ASYM], 0.04f);
    par_set(&DEF[G_ABRASH], &P[G_ABRASH], 0.3f);
    par_set(&DEF[G_BRIGHT], &P[G_BRIGHT], 0.6f);
    par_set(&DEF[G_REG], &P[G_REG], 220.0f);
    for (k = 0; k < NLY; k++)
        layer_init(&sh.ly[k], k);
    sh.crip_layer = 0;
    sh.crips = 0;
    sh.hold_key = -1;
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
    int k;
    for (k = 0; k < NLY; k++) {
        st.car[k].ph = st.mod[k].ph = 0;
        st.car[k].y = st.mod[k].y = 0.0f;
        st.t[k] = st.len_n[k] = 0;
        st.env[k] = 0.0f;
        sh.ly[k].pos = -1;
    }
    st.level_s = 1.0f;
}

static float unit_s(int k)
{
    /* each layer's unit apart from the others by ASYM, irrationally (so they rarely line up again) */
    static const float SKEW[NLY] = {0.0f, 1.0f, 2.618034f};
    return P[G_UNIT].v * 0.001f * (1.0f + P[G_ASYM].v * SKEW[k]);
}

/* a repetition ends: abrash, crippling, growth */
static void repeat_end(int k)
{
    layer_t *L = &sh.ly[k];
    int i;
    float ab = P[G_ABRASH].v * sh.settle;
    L->reps++;
    for (i = 0; i < L->n; i++) {
        float c = pink_next(&L->pk_col, &sh.seed), a = pink_next(&L->pk_amp, &sh.seed);
        L->col[i] = m_clamp(L->col[i] * 0.97f + c * ab * 0.25f, -1.0f, 1.0f);
        L->amp[i] = m_clamp(L->amp[i] * 0.97f + a * ab * 0.2f, -0.8f, 0.5f);
    }
    if (k == sh.crip_layer && m_rnd(&sh.seed) < P[G_ASYM].v * 3.0f) {
        int t = (int)(m_rnd(&sh.seed) * (float)L->n) % L->n;
        int d = m_rnd(&sh.seed) < 0.6f ? 1 : -1;
        L->units[t] = (uint8_t)m_clampi(L->units[t] + d, 1, 9);
        sh.crips++;
    }
    if (L->reps % 17u == 0u && L->n < 5) {   /* slowly a tone more, a few tens of cents from its neighbours */
        L->units[L->n] = (uint8_t)(1 + (int)(m_rnd(&sh.seed) * 3.0f));
        L->cents[L->n] = L->cents[L->n - 1] + (L->n & 1 ? 1.0f : -1.0f) * (11.0f + 31.0f * m_rnd(&sh.seed));
        L->n++;
        if (k == (int)P[G_LAYER].v)
            par_set(&DEF[G_NOTES], &P[G_NOTES], (float)L->n);
    }
    if (L->n > 2 && m_rnd(&sh.seed) < P[G_ASYM].v * 0.5f) {   /* a tone falls silent, or sounds again */
        int t = (int)(m_rnd(&sh.seed) * (float)L->n) % L->n;
        L->rest[t] = (uint8_t)!L->rest[t];
    }
    if (k == 0) {                        /* the others join as the first goes round */
        if (L->reps == 6u)
            sh.ly[1].joined = 1;
        if (L->reps == 13u)
            sh.ly[2].joined = 1;
    }
    sh.plot_rev++;
}

static void start_tone(int k)
{
    layer_t *L = &sh.ly[k];
    if (++L->pos >= L->n) {
        L->pos = 0;
        repeat_end(k);
    }
    st.len_n[k] = (uint32_t)((float)L->units[L->pos] * unit_s(k) * M_SR);
    st.t[k] = 0;
    sh.plot_rev++;
}

void pj_render(float *l, float *r, const float *inl, const float *inr, uint32_t n)
{
    uint32_t i;
    int k;
    float reg = P[G_REG].v, bright = P[G_BRIGHT].v;
    float level = 0.12f * (1.0f - 0.75f * sh.quiet);
    (void)inl, (void)inr;
    if (sh.home_req != st.home_seen) {
        st.home_seen = sh.home_req;
        pj_reset_audio();
    }
    for (i = 0; i < n; i++) {
        float yl = 0.0f, yr = 0.0f;
        st.level_s += (level - st.level_s) * 0.0002f;
        for (k = 0; k < NLY; k++) {
            layer_t *L = &sh.ly[k];
            float f, y, a, att, g;
            if (!L->joined)
                continue;
            if (L->pos < 0 || st.t[k] >= st.len_n[k])
                start_tone(k);
            /* a soft attack (60 ms), held, a long release over the tone's last third */
            att = (float)st.t[k] * (1.0f / (0.06f * M_SR));
            g = att < 1.0f ? att : 1.0f;
            if (st.t[k] > st.len_n[k] * 2u / 3u)
                g *= (float)(st.len_n[k] - st.t[k]) / (float)(st.len_n[k] / 3u + 1u);
            if (!L->on || L->rest[L->pos])
                g = 0.0f;
            st.env[k] += (g - st.env[k]) * 0.002f;
            f = reg * LAYER_RATIO[k] * m_exp2(L->cents[L->pos] * (1.0f / 1200.0f));
            a = m_db2lin(L->amp[L->pos] * 12.0f);
            y = op_run(&st.mod[k], m_inc(f * 2.0f), 0.0f);
            y = op_run(&st.car[k], m_inc(f), (bright * (1.0f + L->col[L->pos])) * 0.159f * y);
            y *= st.env[k] * a * st.level_s;
            yl += y * (k == 1 ? 0.55f : k == 2 ? 0.85f : 0.7f);
            yr += y * (k == 1 ? 0.85f : k == 2 ? 0.55f : 0.7f);
            st.t[k]++;
        }
        l[i] = yl;
        r[i] = yr;
    }
}

void pj_control(const mz_in_t *in, const mz_body_t *b)
{
    static const int ENC_PAR[HW_NENC] = {G_LAYER, G_NOTES, G_UNIT, G_ASYM, G_ABRASH, G_BRIGHT, G_REG};
    static const uint8_t WHITE[16] = {0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24, 26};
    static const uint8_t BLACK[11] = {1, 3, 5, 8, 10, 13, 15, 17, 20, 22, 25};
    int i, ly = (int)P[G_LAYER].v;
    for (i = 0; i < HW_NENC; i++) {
        if (!in->enc[i])
            continue;
        if (i == 1) {                    /* NOTES: the selected layer's pattern length */
            layer_t *L = &sh.ly[ly];
            L->n = (uint8_t)m_clampi(L->n + in->enc[i], 1, MAXN);
            par_set(&DEF[G_NOTES], &P[G_NOTES], (float)L->n);
            P[G_NOTES].hot_until = in->ms + 400u;
            continue;
        }
        par_turn(&DEF[ENC_PAR[i]], &P[ENC_PAR[i]], in->enc[i], i < 2 ? 1.0f : par_accel(b->speed[i]), in->ms);
        if (i == 0)
            par_set(&DEF[G_NOTES], &P[G_NOTES], (float)sh.ly[(int)P[G_LAYER].v].n);
    }
    ly = (int)P[G_LAYER].v;
    /* black keys: 1-3 the layer, 4-6 a layer on / off (and joined at once) */
    for (i = 0; i < 6; i++) {
        if (!(in->down >> BLACK[i] & 1u))
            continue;
        if (i < 3) {
            par_set(&DEF[G_LAYER], &P[G_LAYER], (float)i);
            par_set(&DEF[G_NOTES], &P[G_NOTES], (float)sh.ly[i].n);
            mz_say("LAYER", LAYER_NAMES[i]);
        } else {
            layer_t *L = &sh.ly[i - 3];
            L->on = (uint8_t)(!L->joined ? 1 : !L->on);
            L->joined = 1;
            mz_say(LAYER_NAMES[i - 3], L->on ? "ON" : "OFF");
        }
        sh.plot_rev++;
    }
    /* white keys: holding a tone of the selected layer lengthens it, for good */
    sh.hold_key = -1;
    for (i = 0; i < MAXN; i++)
        if (in->keys >> WHITE[i] & 1u) {
            float p = (float)in->prs[WHITE[i]] * (1.0f / 127.0f);
            sh.hold_key = i;
            st.hold_acc += (uint32_t)((float)in->dt * (1.0f + 3.0f * p));
            if (st.hold_acc >= 1500u && i < sh.ly[ly].n) {
                st.hold_acc = 0;
                sh.ly[ly].units[i] = (uint8_t)m_clampi(sh.ly[ly].units[i] + 1, 1, 9);
                mz_say("LONGER", LAYER_NAMES[ly]);
                sh.plot_rev++;
            }
        }
    if (sh.hold_key < 0)
        st.hold_acc = 0;
    /* the body, answered inversely */
    sh.quiet = m_min(1.0f, b->agit * (1.0f / 30.0f) + b->press * 0.3f);
    sh.settle = m_max(0.15f, 1.0f / (1.0f + (float)b->still_all * (1.0f / 60000.0f)));
    {
        static float rev_prev;
        if (b->revs > 1.2f && rev_prev <= 1.2f) {
            sh.crip_layer = (sh.crip_layer + 1) % NLY;
            mz_say("CRIPPLING", LAYER_NAMES[sh.crip_layer]);
        }
        rev_prev = b->revs;
    }
}

void pj_row(int i, mz_row_t *r)
{
    static const int ENC_PAR[HW_NENC] = {G_LAYER, G_NOTES, G_UNIT, G_ASYM, G_ABRASH, G_BRIGHT, G_REG};
    int p = ENC_PAR[i];
    par_row(&DEF[p], &P[p], r, hw_ms(), P[p].v);
    if (p == G_LAYER) {
        layer_t *L = &sh.ly[(int)P[p].v];
        mz_cat(r->value, L->joined ? (L->on ? " ON R" : " OFF R") : " WAIT R");
        mz_int(r->value, (int32_t)L->reps);
    }
    if (p == G_NOTES) {
        layer_t *L = &sh.ly[(int)P[G_LAYER].v];
        int k, u = 0;
        for (k = 0; k < L->n; k++)
            u += L->units[k];
        mz_cat(r->value, " = ");
        mz_int(r->value, u);
        mz_cat(r->value, "U");
    }
}

void pj_status(char *s)
{
    mz_cat(s, "CRIP ");
    mz_int(s, (int32_t)sh.crips);
    if (sh.quiet > 0.1f)
        mz_cat(s, " HUSH");
}

uint32_t pj_plot_rev(void) { return sh.plot_rev; }

/* the three patterns on one time axis (seconds across): their lengths differ, so they slide */
void pj_plot(int h)
{
    int k, i;
    float px_per_s = 236.0f / 12.0f;
    for (k = 0; k < NLY; k++) {
        layer_t *L = &sh.ly[k];
        int y = 4 + k * (h - 6) / NLY, hh = (h - 6) / NLY - 6;
        float x = 2.0f, u = unit_s(k);
        scr_text(0, y, 1, LAYER_NAMES[k], L->joined ? (L->on ? C_LAB : C_DIMC) : C_RULE);
        if (!L->joined)
            continue;
        x = 10.0f;
        {
        int first = 1;
        while (x < 238.0f) {
            for (i = 0; i < L->n && x < 238.0f; i++) {
                float w = (float)L->units[i] * u * px_per_s;
                int bh = 2 + (int)((float)hh * 0.6f * m_db2lin(L->amp[i] * 12.0f));
                uint16_t c = (first && i == L->pos) ? C_HOT
                           : L->col[i] > 0.0f ? C_VAL : C_VAL2;
                if (bh > hh)
                    bh = hh;
                hw_fill((int)x, y + hh - bh, (int)w > 2 ? (int)w - 1 : 1, bh, L->on ? c : C_RULE);
                x += w;
            }
            first = 0;
        }
        }
    }
}

uint32_t pj_lit_keys(void)
{
    static const uint8_t WHITE[16] = {0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24, 26};
    layer_t *L = &sh.ly[(int)P[G_LAYER].v];
    return L->pos >= 0 && L->pos < MAXN ? 1u << WHITE[L->pos] : 0u;
}

uint32_t pj_dim_keys(void)
{
    static const uint8_t WHITE[16] = {0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24, 26};
    layer_t *L = &sh.ly[(int)P[G_LAYER].v];
    uint32_t m = (1u << 1) | (1u << 3) | (1u << 5) | (1u << 8) | (1u << 10) | (1u << 13);
    int i;
    for (i = 0; i < L->n; i++)
        m |= 1u << WHITE[i];
    return m;
}
