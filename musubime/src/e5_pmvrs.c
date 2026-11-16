/* PMVRS: five kinds of time, switched, never mixed (after the P / M / V / R / S of Masahiko Satoh's "complete
 * improvisation" as quoted in a post: pulse, long-short, sense of speed, breath, silence; the definitions still to be
 * checked against his book: see docs/DESIGN.md, with the objection that a taxonomy of time may bring back the
 * Western model it means to leave).
 *   P  a pulse without accents: every event the same weight, no bar, no downbeat
 *   M  long and short: the order of longs and shorts follows the Fibonacci word (L -> LS, S -> L): never periodic,
 *      never random
 *   V  a sense of speed: the time between events shrinks or grows exponentially (ACCEL octaves a second), turning
 *      back at its limits
 *   R  breath: one continuous sound whose loudness and colour follow a breath; the breath is the hand's pressure on
 *      any key when there is one, else an irregular breath of its own (inhale shorter than exhale, 1/f in its length)
 *   S  silence: nothing sounds; every mode's state goes on growing meanwhile, and the screen counts the silence
 * Switching is a cut: the sound ends in 1.5 ms (only so it does not click) and the next mode starts at once, with its
 * own memory: each mode keeps its own timbre, which grows from a sine toward complexity while that mode is on (GROW).
 * What switches: the five keys F3 G3 A3 B3 C4, SELECT, or the body: moving again after stillness switches to the mode
 * that has been away longest (attention to what was forgotten). The switch is the "change of consciousness"; there is
 * no theory of which mode should follow which. */
#include "par.h"
#include "fmvox.h"

const char PJ_NAME[] = "PMVRS";

enum { MP, MM, MV, MR, MS, NMODE };
static const char *const MODE_NAMES[] = {"P PULSE", "M LONG/SHORT", "V SPEED", "R BREATH", "S SILENCE"};
static const char MODE_CH[NMODE] = {'P', 'M', 'V', 'R', 'S'};
enum { G_MODE, G_PULSE, G_RATIO, G_ACCEL, G_BREATH, G_GROW, G_REG, NPAR };
static const par_def_t DEF[NPAR] = {
    {"MODE", P_ENUM, 0, 0, 4, 1, 1, "", MODE_NAMES, 0, 4},
    {"P T", P_LOG, 0, 40.0f, 3000.0f, 12.0f, 40.0f, "MS", 0, 80.0f, 2000.0f},
    {"M L/S", P_LIN, 2, 1.1f, 12.0f, 0.05f, 0, "X", 0, 1.1f, 8.0f},
    {"V ACC", P_LIN, 2, -4.0f, 4.0f, 0.02f, 0, "OCT/S", 0, -2.0f, 2.0f},
    {"R BRTH", P_LOG, 1, 0.8f, 30.0f, 12.0f, 0.5f, "S", 0, 1.5f, 15.0f},
    {"GROW", P_LOG, 3, 0.0f, 0.5f, 6.0f, 0.002f, "/S", 0, 0.0f, 0.2f},
    {"REG", P_LOG, 0, 30.0f, 4000.0f, 24.0f, 30.0f, "HZ", 0, 40.0f, 2500.0f},
};
static par_t P[NPAR];

typedef struct {
    float cx;                            /* complexity, 0 (a sine) .. 1 */
    float ratio_walk, fb_walk;           /* the timbre's own drift */
    uint32_t away;                       /* ms since this mode was last on */
    uint32_t n;                          /* events so far (M: the Fibonacci word's index) */
    float ioi;                           /* V: seconds between events now */
    int8_t vdir;
} mode_t_;

static struct {
    mode_t_ md[NMODE];
    volatile int mode;
    volatile uint32_t home_req;
    float breath_hand;                   /* 0..1 the hand's pressure, -1 none */
    uint32_t silence_ms;
    uint8_t hist[240];                   /* the plot: which mode, a column every 83 ms */
    uint8_t hist_cx[240];
    int hist_n;
    uint32_t plot_rev;
    uint32_t seed;
} sh;

static struct {
    uint32_t home_seen;
    int mode;                            /* the mode the render plays */
    uint32_t cut;                        /* samples of the 1.5 ms cut left */
    op_t car, mod;
    float env, env_target;
    uint32_t ev_t, ev_len;               /* the event now and its length */
    float br_ph, br_len;                 /* R's own breath */
    pink_t br_pink;
    float cx_k;
    vox_t vox;                           /* P M V R: slots 1-4 (empty: slot 1, else the mode's own FM) */
    vox_k_t vk;
    float vlevel, br_prev;
} st;

/* the mode's slot voice, placed by the mode's own state (its complexity and its drift) */
static const mz_slot_t *mode_voice(int m) { return m < MS ? mz_voice(m) : 0; }
static void voice_place(const mz_slot_t *v, const mode_t_ *M, float len_s)
{
    float p[NVP];
    vox_slot_place(p, v, P[G_REG].v * (1.0f / 196.0f) * m_exp2(0.35f * M->fb_walk), 1.0f + 0.3f * M->cx * M->ratio_walk,
                   M->cx * 5.0f, M->cx * M->cx, m_clamp(len_s / 0.6f, 0.2f, 4.0f));
    vox_gate(p, len_s * 1.1f);           /* a sustained kind lasts its event */
    vox_coefs(&st.vk, p);
    st.vlevel = vox_slot_level(v) * 1.5f;
}

static void defaults(void)
{
    int k;
    for (k = 0; k < NPAR; k++)
        par_set(&DEF[k], &P[k], 0.0f);
    par_set(&DEF[G_MODE], &P[G_MODE], 0.0f);
    par_set(&DEF[G_PULSE], &P[G_PULSE], 360.0f);
    par_set(&DEF[G_RATIO], &P[G_RATIO], 2.618f);
    par_set(&DEF[G_ACCEL], &P[G_ACCEL], 0.6f);
    par_set(&DEF[G_BREATH], &P[G_BREATH], 4.5f);
    par_set(&DEF[G_GROW], &P[G_GROW], 0.02f);
    par_set(&DEF[G_REG], &P[G_REG], 196.0f);
    for (k = 0; k < NMODE; k++) {
        sh.md[k].cx = 0.0f;
        sh.md[k].ratio_walk = 0.0f;
        sh.md[k].fb_walk = 0.0f;
        sh.md[k].away = 0;
        sh.md[k].n = 0;
        sh.md[k].ioi = 0.6f;
        sh.md[k].vdir = 1;
    }
    sh.mode = MP;
    sh.hist_n = 0;
    sh.silence_ms = 0;
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
    st.mode = sh.mode;
    st.cut = 0;
    st.car.ph = st.mod.ph = 0;
    st.car.y = st.mod.y = 0.0f;
    st.env = st.env_target = 0.0f;
    st.ev_t = st.ev_len = 0;
    st.br_ph = 0.0f;
    st.br_len = 4.5f;
    vox_reset(&st.vox);
    st.br_prev = 0.0f;
}

/* the Fibonacci word, letter n: 1 long, 0 short */
static int fib_long(uint32_t n)
{
    const float phi = 1.6180340f;
    float a = m_floor((float)(n + 2u) / phi), b = m_floor((float)(n + 1u) / phi);
    return (int)(a - b) == 1;
}

/* the next event's length in samples, by the mode's time */
static uint32_t next_len(int m)
{
    mode_t_ *M = &sh.md[m];
    float T = P[G_PULSE].v * 0.001f, s;
    M->n++;
    switch (m) {
    case MP:
        s = T;
        break;
    case MM:
        s = fib_long(M->n) ? T * P[G_RATIO].v : T;
        break;
    case MV:
        s = M->ioi;
        M->ioi *= m_exp2(-P[G_ACCEL].v * s * (float)M->vdir);
        if (M->ioi < 0.025f) {
            M->ioi = 0.025f;
            M->vdir = (int8_t)-M->vdir;
        }
        if (M->ioi > 2.5f) {
            M->ioi = 2.5f;
            M->vdir = (int8_t)-M->vdir;
        }
        break;
    default:
        s = 0.5f;
        break;
    }
    return (uint32_t)(m_clamp(s, 0.012f, 20.0f) * M_SR);
}

void pj_render(float *l, float *r, const float *inl, const float *inr, uint32_t n)
{
    uint32_t i;
    float reg = P[G_REG].v;
    (void)inl, (void)inr;
    if (sh.home_req != st.home_seen) {
        st.home_seen = sh.home_req;
        pj_reset_audio();
    }
    if (sh.mode != st.mode && !st.cut)
        st.cut = 66u;                    /* 1.5 ms to nothing, then the other mode, at once */
    for (i = 0; i < n; i++) {
        mode_t_ *M = &sh.md[st.mode];
        float y = 0.0f, g, cx, f, idx, ratio, fb;
        if (st.cut) {
            st.env *= 0.9f;
            if (--st.cut == 0u) {
                st.mode = sh.mode;
                st.env = 0.0f;
                st.ev_t = 0;
                st.ev_len = 0;
                M = &sh.md[st.mode];
                vox_reset(&st.vox);          /* nothing of the last mode carries over */
            }
        }
        cx = M->cx;
        f = reg * m_exp2(0.35f * M->fb_walk);
        ratio = 1.0f + cx * (1.4142136f + 1.3f * M->ratio_walk);
        idx = cx * 7.0f;
        fb = cx * cx * 1.6f;
        if (st.mode == MR) {             /* breath: continuous */
            float b;
            if (sh.breath_hand >= 0.0f) {
                b = sh.breath_hand;
            } else {
                float in_frac = 0.4f;
                st.br_ph += M_INV_SR / st.br_len;
                if (st.br_ph >= 1.0f) {
                    st.br_ph -= 1.0f;
                    st.br_len = P[G_BREATH].v * m_exp2(0.6f * pink_next(&st.br_pink, &sh.seed));
                }
                b = st.br_ph < in_frac ? st.br_ph / in_frac : 1.0f - (st.br_ph - in_frac) / (1.0f - in_frac);
                b = b * b * (3.0f - 2.0f * b);
            }
            st.env += (b - st.env) * 0.0015f;
            if (st.env < 1.0e-12f)
                st.env = 0.0f;
            g = st.env;
            idx *= 0.3f + 0.7f * st.env;
            if (mode_voice(MR) && st.env > 0.5f && st.br_prev <= 0.5f) {   /* the breath plays the slot's voice */
                voice_place(mode_voice(MR), M, P[G_BREATH].v * 0.5f);
                vox_trig(&st.vox, &st.vk);
            }
            st.br_prev = st.env;
        } else if (st.mode == MS) {      /* silence */
            g = 0.0f;
            st.env = 0.0f;
        } else {                         /* P, M, V: events */
            if (st.ev_t >= st.ev_len) {
                st.ev_len = next_len(st.mode);
                st.ev_t = 0;
                if (mode_voice(st.mode)) {
                    voice_place(mode_voice(st.mode), M, (float)st.ev_len * M_INV_SR);
                    vox_trig(&st.vox, &st.vk);
                }
            }
            {
                uint32_t att = 90u, rel = st.mode == MM ? st.ev_len / 3u : st.ev_len / 2u;
                float d;
                if (rel > 20000u)
                    rel = 20000u;
                if (st.ev_t < att)
                    d = (float)st.ev_t / (float)att;
                else if (st.ev_t < att + rel)
                    d = 1.0f - (float)(st.ev_t - att) / (float)rel;
                else
                    d = 0.0f;
                if (st.mode == MM && st.ev_t >= att && st.ev_t < st.ev_len - 200u && fib_long(M->n))
                    d = m_max(d, 0.55f);     /* a long one is held */
                st.env += (d - st.env) * 0.2f;
                if (st.env < 1.0e-12f)       /* (no denormal numbers between the events: slow on the FM-1) */
                    st.env = 0.0f;
            }
            st.ev_t++;
            g = st.env;
        }
        if (st.cut)
            g = st.env;
        if (mode_voice(st.mode)) {       /* a slot's voice: its own envelope; the cut and a held breath on top */
            const mz_slot_t *v = mode_voice(st.mode);
            float w = st.cut ? st.env : (st.mode == MR && VB_HELD[v->src - 1]) ? st.env : 1.0f;
            y = vox_run(&st.vox, &st.vk, 0.0f) * st.vlevel * w;
        } else {
            float m = op_run(&st.mod, m_inc(f * ratio), fb * 0.159f * st.mod.y);
            y = op_run(&st.car, m_inc(f), idx * 0.159f * m) * g * 0.42f;
        }
        l[i] = y;
        r[i] = y;
    }
}

static void switch_to(int m, const char *why)
{
    if (m == sh.mode)
        return;
    sh.mode = m;
    par_set(&DEF[G_MODE], &P[G_MODE], (float)m);
    mz_say(MODE_NAMES[m], why);
    sh.plot_rev++;
}

void pj_control(const mz_in_t *in, const mz_body_t *b)
{
    static const int ENC_PAR[HW_NENC] = {G_MODE, G_PULSE, G_RATIO, G_ACCEL, G_BREATH, G_GROW, G_REG};
    static const uint8_t MODE_KEY[NMODE] = {0, 2, 4, 6, 7};   /* F3 G3 A3 B3 C4 */
    int i, m;
    float dt = (float)in->dt * 0.001f, press = -1.0f;
    for (i = 0; i < HW_NENC; i++) {
        if (!in->enc[i])
            continue;
        if (i == 0) {
            switch_to((sh.mode + (in->enc[0] > 0 ? 1 : NMODE - 1)) % NMODE, "SELECT");
            P[G_MODE].hot_until = in->ms + 400u;
            continue;
        }
        par_turn(&DEF[ENC_PAR[i]], &P[ENC_PAR[i]], in->enc[i], par_accel(b->speed[i]), in->ms);
    }
    for (m = 0; m < NMODE; m++)
        if (in->down >> MODE_KEY[m] & 1u)
            switch_to(m, "KEY");
    /* R: the breath is the hand's pressure, on any key but the mode keys */
    for (i = 0; i < HW_NPRESS; i++)
        if ((in->keys >> i & 1u) && i != 0 && i != 2 && i != 4 && i != 6 && i != 7) {
            float p = (float)in->prs[i] * (1.0f / 127.0f);
            if (p > press)
                press = p;
        }
    sh.breath_hand = press;
    /* the body: turning again after stillness switches to the mode away longest (a mode key is its own switch) */
    {
        float on = 0.0f;
        for (i = 0; i < HW_NENC; i++)
            on = m_max(on, b->onset[i]);
        if (on < 1.5f)
            goto no_onset;
    }
    {
        int best = sh.mode;
        uint32_t away = 0;
        for (m = 0; m < NMODE; m++)
            if (m != sh.mode && sh.md[m].away >= away) {
                away = sh.md[m].away;
                best = m;
            }
        switch_to(best, "LONGEST AWAY");
    }
no_onset:
    /* growth while on (and in silence, everything grows a little: it goes on thinking) */
    for (m = 0; m < NMODE; m++) {
        mode_t_ *M = &sh.md[m];
        if (m == sh.mode) {
            M->away = 0;
            M->cx = m_min(1.0f, M->cx + P[G_GROW].v * dt * (1.0f + b->energy));
            M->ratio_walk = m_clamp(M->ratio_walk + m_rndb(&sh.seed) * 0.02f * M->cx, -1.0f, 1.0f);
            M->fb_walk = m_clamp(M->fb_walk + m_rndb(&sh.seed) * 0.01f * M->cx, -1.0f, 1.0f);
        } else {
            M->away += in->dt;
            if (sh.mode == MS)
                M->cx = m_min(1.0f, M->cx + 0.25f * P[G_GROW].v * dt);
        }
    }
    sh.silence_ms = sh.mode == MS ? sh.silence_ms + in->dt : 0u;
    /* the history strip: a column every 83 ms */
    {
        static uint32_t acc;
        acc += in->dt;
        if (acc >= 83u) {
            acc -= 83u;
            if (sh.hist_n < 240)
                sh.hist_n++;
            for (i = 239; i > 0; i--) {
                sh.hist[i] = sh.hist[i - 1];
                sh.hist_cx[i] = sh.hist_cx[i - 1];
            }
            sh.hist[0] = (uint8_t)sh.mode;
            sh.hist_cx[0] = (uint8_t)(sh.md[sh.mode].cx * 255.0f);
            sh.plot_rev++;
        }
    }
}

void pj_row(int i, mz_row_t *r)
{
    static const int ENC_PAR[HW_NENC] = {G_MODE, G_PULSE, G_RATIO, G_ACCEL, G_BREATH, G_GROW, G_REG};
    int p = ENC_PAR[i];
    par_row(&DEF[p], &P[p], r, hw_ms(), P[p].v);
    if (p == G_MODE && sh.mode == MS) {
        r->value[0] = 0;
        mz_cat(r->value, "S ");
        mz_fix(r->value, (float)sh.silence_ms * 0.001f, 1);
        mz_cat(r->value, " S");
    }
    if (p == G_ACCEL && sh.mode == MV) {
        mz_cat(r->value, sh.md[MV].vdir > 0 ? " &" : " @");
    }
    if ((p == G_PULSE && sh.mode == MP) || (p == G_RATIO && sh.mode == MM) || (p == G_ACCEL && sh.mode == MV) ||
        (p == G_BREATH && sh.mode == MR))
        r->hot = 1;
}

void pj_status(char *s)
{
    mz_cat(s, "CX ");
    mz_int(s, (int32_t)(sh.md[sh.mode].cx * 100.0f));
    mz_cat(s, "%");
    if (sh.breath_hand >= 0.0f)
        mz_cat(s, " BREATH=HAND");
}

uint32_t pj_plot_rev(void) { return sh.plot_rev; }

/* which mode, when: five rows, newest at the left; brightness = that mode's complexity */
void pj_plot(int h)
{
    int m, c;
    int rh = (h - 2) / NMODE;
    for (m = 0; m < NMODE; m++) {
        char t[2] = {MODE_CH[m], 0};
        scr_text(1, 1 + m * rh + (rh - 7) / 2, 1, t, m == sh.mode ? C_HOT : C_LAB);
        scr_hline(10, 1 + m * rh + rh - 1, 230, C_RULE);
    }
    for (c = 0; c < sh.hist_n && c < 228; c++) {
        int md = sh.hist[c], cx = sh.hist_cx[c];
        uint16_t col = cx > 170 ? C_VAL : cx > 85 ? C_VAL2 : C_GRN;
        hw_fill(11 + c, 2 + md * rh, 1, rh - 3, md == MS ? C_DIMC : col);
    }
}

uint32_t pj_lit_keys(void)
{
    static const uint8_t MODE_KEY[NMODE] = {0, 2, 4, 6, 7};
    return 1u << MODE_KEY[sh.mode];
}

uint32_t pj_dim_keys(void) { return (1u << 0) | (1u << 2) | (1u << 4) | (1u << 6) | (1u << 7); }

uint32_t pj_lit_buttons(void) { return 0; }
uint32_t pj_dim_buttons(void) { return 0; }
