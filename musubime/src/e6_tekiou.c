/* TEKIOU (適応): a system that listens to itself and rewires itself (after Agostino Di Scipio's audible ecosystems,
 * Francesco Corvi's Adapt, whose modules combine into a network of influences, and W. Ross Ashby's ultrastability;
 * see docs/DESIGN.md).
 * Four FM operators, each able to modulate any other and itself (a 4 x 4 matrix of edges), some of them tapped to
 * the output. It begins with no edges and one tap: a sine.
 * It listens to what it makes: brightness (zero crossings, log), loudness, and how much these vary over the last
 * seconds. Two things follow from that:
 *   1. homeostasis, continuous: a global index gain moves to bring the brightness to its target (HOMEO > 0) or away
 *      from it (HOMEO < 0: runaway);
 *   2. ultrastability, by steps: when brightness stays outside its band, or the variation stays too low (boredom),
 *      for longer than PATIENCE, the structure changes: an edge appears, goes, or changes sign, an operator's ratio
 *      moves to another irrational, a tap moves. Too plain: it adds; overloaded: it prunes.
 * The target itself rises slowly with age (it matures toward complexity) unless the hand holds it back.
 * The hand changes the configuration, not the sound's values: the target (TARGET), the band's width (BAND), how long
 * it tolerates being outside (PATIENCE), the sign and strength of its self-regulation (HOMEO), how slowly it listens
 * (LISTEN); turning REWIRE makes a structural step now. The body: an agitated hand narrows the band (it gets nervous),
 * stillness widens it and lengthens its patience; turning back and forth flips HOMEO's sign; moving after stillness
 * startles it into a step. White keys 1-4 tap or untap an operator; pressing keys 5-8 bends that operator's frequency
 * (the hand as a modulator). With audio coming in (the computer, where the platform gives it), the input is heard
 * with the output and also modulates operator 1. */
#include "par.h"
#include "fmvox.h"

const char PJ_NAME[] = "TEKIOU";

#define NO 4
static const float RATIOS[] = {1.0f, 1.4142136f, 1.6180340f, 2.2360680f, 2.7182818f, 3.1415927f, 0.7071068f,
                               0.5f, 3.6055513f, 1.3247180f, 4.1231056f, 0.6180340f};
#define NRATIOS ((int)(sizeof RATIOS / sizeof RATIOS[0]))

enum { G_TARGET, G_REWIRE, G_PATIENCE, G_BAND, G_HOMEO, G_LISTEN, G_REG, NPAR };
static const par_def_t DEF[NPAR] = {
    {"TARGET", P_LIN, 2, 0.0f, 1.0f, 0.01f, 0, "", 0, 0.0f, 1.0f},
    {"REWIRE", P_INT, 0, 0, 99999, 1, 1, "", 0, 0, 99999},
    {"PATNCE", P_LOG, 1, 0.1f, 30.0f, 8.0f, 0.1f, "S", 0, 0.5f, 15.0f},
    {"BAND", P_LIN, 2, 0.02f, 0.6f, 0.01f, 0, "", 0, 0.05f, 0.4f},
    {"HOMEO", P_LIN, 2, -1.0f, 1.0f, 0.02f, 0, "", 0, 0.0f, 1.0f},
    {"LISTEN", P_LOG, 2, 0.05f, 8.0f, 8.0f, 0.05f, "S", 0, 0.1f, 4.0f},
    {"REG", P_LOG, 0, 30.0f, 3000.0f, 24.0f, 30.0f, "HZ", 0, 40.0f, 2000.0f},
};
static par_t P[NPAR];

static struct {
    float w[NO][NO];                     /* edge: operator i modulated by j (radians) */
    uint8_t tap[NO];
    uint8_t ri[NO];                      /* each operator's ratio, an index into RATIOS */
    float gain;                          /* homeostasis: the index gain */
    float bright, loud, var, bright_in;  /* what it hears (0..1) */
    float bright_slow;                   /* the brightness over the last seconds: var is how far it strays */
    float age;                           /* minutes */
    float band_eff, pat_eff, homeo_eff;
    float bend[NO];                      /* the hand's bends (cents) */
    uint32_t steps;
    char last[16];
    volatile uint32_t home_req, step_req;
    uint32_t plot_rev;
    uint32_t seed;
    float hist_b[120], hist_v[120];
    int hist_n;
} sh;

static struct {
    uint32_t home_seen, step_seen;
    op_t op[NO];
    float out_prev;
    /* the listening */
    uint32_t blk_n, zc;
    float blk_ss, prev_s, rms_slow, var_acc, rms_fast;
    float out_bad;                       /* seconds out of band */
    float bored;                         /* seconds too steady */
    float in_ss, in_prev;
    uint32_t in_zc;
    /* the slots: a voice the system plays by itself (when its brightness crosses the target, at each structural step,
     * and at least every 2 s), FM-modulated by the network; each structural step moves to the next filled slot */
    vox_t vox;
    vox_k_t vk;
    float vlevel, err_prev;
    uint8_t vslot, vtrig;
    uint32_t vsince;
} st;

static void defaults(void)
{
    int i, j;
    for (i = 0; i < NPAR; i++)
        par_set(&DEF[i], &P[i], 0.0f);
    par_set(&DEF[G_TARGET], &P[G_TARGET], 0.25f);
    par_set(&DEF[G_PATIENCE], &P[G_PATIENCE], 3.0f);
    par_set(&DEF[G_BAND], &P[G_BAND], 0.12f);
    par_set(&DEF[G_HOMEO], &P[G_HOMEO], 0.6f);
    par_set(&DEF[G_LISTEN], &P[G_LISTEN], 0.6f);
    par_set(&DEF[G_REG], &P[G_REG], 150.0f);
    for (i = 0; i < NO; i++) {
        for (j = 0; j < NO; j++)
            sh.w[i][j] = 0.0f;
        sh.tap[i] = i == 0;
        sh.ri[i] = (uint8_t)(i == 0 ? 0 : i == 1 ? 1 : i == 2 ? 2 : 3);
        sh.bend[i] = 0.0f;
    }
    sh.gain = 1.0f;
    sh.age = 0.0f;
    sh.band_eff = P[G_BAND].v;           /* (before the first UI frame sets them from the hand) */
    sh.pat_eff = P[G_PATIENCE].v;
    sh.homeo_eff = P[G_HOMEO].v;
    sh.bright = sh.bright_slow = 0.32f;
    sh.var = 0.01f;
    sh.steps = 0;
    sh.last[0] = 0;
    sh.hist_n = 0;
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
    int i;
    for (i = 0; i < NO; i++) {
        st.op[i].ph = (uint32_t)i * 0x40000000u;
        st.op[i].y = 0.0f;
    }
    st.out_prev = 0.0f;
    st.blk_n = st.zc = 0;
    st.blk_ss = st.prev_s = st.rms_slow = st.var_acc = st.rms_fast = 0.0f;
    st.out_bad = st.bored = 0.0f;
    sh.gain = 1.0f;
    vox_reset(&st.vox);
    st.vslot = 0;
    st.vtrig = 1;
    st.vsince = 0;
    st.err_prev = 0.0f;
}

static int count_edges(void)
{
    int i, j, n = 0;
    for (i = 0; i < NO; i++)
        for (j = 0; j < NO; j++)
            n += sh.w[i][j] != 0.0f;
    return n;
}

/* an operator is heard if it is tapped or modulates one that is (one step back is enough here) */
static int heard(int i)
{
    int k;
    if (sh.tap[i])
        return 1;
    for (k = 0; k < NO; k++)
        if (sh.tap[k] && sh.w[k][i] != 0.0f)
            return 1;
    return 0;
}

/* one structural step: grow when plain (want > 0), prune when overloaded (want < 0), else anything */
static void restructure(int want)
{
    float r = m_rnd(&sh.seed);
    int i = (int)(m_rnd(&sh.seed) * NO) % NO, j = (int)(m_rnd(&sh.seed) * NO) % NO, tries;
    char *t = sh.last;
    int edges = count_edges();
    t[0] = 0;
    if (!want)                           /* the hand's REWIRE: grow while sparse, else either way */
        want = (edges < 3 || m_rnd(&sh.seed) < 0.5f) ? 1 : -1;
    if (want > 0 && (r < 0.6f || edges == 0)) {
        for (tries = 0; tries < 16 && (sh.w[i][j] != 0.0f || !heard(i)); tries++) {   /* into what is heard */
            i = (int)(m_rnd(&sh.seed) * NO) % NO;
            j = (int)(m_rnd(&sh.seed) * NO) % NO;
        }
        sh.w[i][j] = (0.4f + 1.6f * m_rnd(&sh.seed)) * (m_rnd(&sh.seed) < 0.75f ? 1.0f : -1.0f);
        mz_cat(t, "+W");
    } else if (want < 0 && edges > 0 && r < 0.6f) {
        for (tries = 0; tries < 32 && sh.w[i][j] == 0.0f; tries++) {
            i = (int)(m_rnd(&sh.seed) * NO) % NO;
            j = (int)(m_rnd(&sh.seed) * NO) % NO;
        }
        sh.w[i][j] = 0.0f;
        mz_cat(t, "-W");
    } else if (r < 0.75f && edges > 0) {
        for (tries = 0; tries < 32 && sh.w[i][j] == 0.0f; tries++) {
            i = (int)(m_rnd(&sh.seed) * NO) % NO;
            j = (int)(m_rnd(&sh.seed) * NO) % NO;
        }
        sh.w[i][j] = -sh.w[i][j];
        mz_cat(t, "~W");
    } else if (r < 0.9f) {
        sh.ri[i] = (uint8_t)((int)(m_rnd(&sh.seed) * NRATIOS) % NRATIOS);
        mz_cat(t, "R");
        mz_int(t, i + 1);
        mz_cat(t, "=");
        mz_fix(t, RATIOS[sh.ri[i]], 3);
        goto done;
    } else {
        sh.tap[i] = (uint8_t)!sh.tap[i];
        if (!sh.tap[0] && !sh.tap[1] && !sh.tap[2] && !sh.tap[3])
            sh.tap[i] = 1;
        mz_cat(t, "TAP");
        mz_int(t, i + 1);
        goto done;
    }
    mz_int(t, i + 1);
    mz_int(t, j + 1);
done:
    {                                    /* the voice: the next filled slot, struck */
        int k, sl = st.vslot;
        for (k = 0; k < MZ_SLOTS; k++) {
            sl = (sl + 1) % MZ_SLOTS;
            if (mz_slot(sl)->src)
                break;
        }
        if (mz_slot(sl)->src)
            st.vslot = (uint8_t)sl;
        st.vtrig = 1;
    }
    sh.steps++;
    sh.plot_rev++;
}

void pj_render(float *l, float *r, const float *inl, const float *inr, uint32_t n)
{
    uint32_t i;
    int a, b;
    float f0 = P[G_REG].v, inc_f[NO], listen_k, blk_dt = 256.0f * M_INV_SR, ntap = 0.0f;
    if (sh.home_req != st.home_seen) {
        st.home_seen = sh.home_req;
        pj_reset_audio();
    }
    if (sh.step_req != st.step_seen) {
        st.step_seen = sh.step_req;
        restructure(0);
    }
    for (a = 0; a < NO; a++) {
        inc_f[a] = f0 * RATIOS[sh.ri[a]] * m_exp2(sh.bend[a] * (1.0f / 1200.0f));
        ntap += (float)sh.tap[a];
    }
    ntap = 0.5f / m_max(1.0f, ntap);
    listen_k = 1.0f - m_tc(P[G_LISTEN].v, 1.0f / blk_dt);
    for (i = 0; i < n; i++) {
        float y[NO], out = 0.0f, ext = 0.0f, g = sh.gain * 0.159f;
        if (inl && inr)
            ext = 0.5f * (inl[i] + inr[i]);
        for (a = 0; a < NO; a++)
            y[a] = st.op[a].y;
        for (a = 0; a < NO; a++) {
            float pm = 0.0f;
            for (b = 0; b < NO; b++)
                pm += sh.w[a][b] * y[b];
            if (a == 0)
                pm += 2.0f * ext;        /* the outside, as a modulator of operator 1 */
            op_run(&st.op[a], m_inc(inc_f[a]), pm * g);
            if (sh.tap[a])
                out += st.op[a].y;
        }
        out *= ntap;
        out += 0.5f * ext;
        {                                /* a slot's voice, played by the system, the network into its carrier */
            const mz_slot_t *v = mz_voice(st.vslot);
            if (v) {
                if (st.vtrig || ++st.vsince > (uint32_t)(2.0f * M_SR)) {
                    float p[NVP];
                    vox_slot_place(p, v, P[G_REG].v * (1.0f / 150.0f), 1.0f, (sh.gain - 1.0f) * 2.0f, 0.0f, 1.0f);
                    p[VP_XMOD] = 1.5f;
                    vox_coefs(&st.vk, p);
                    st.vlevel = vox_slot_level(v) * 0.9f;
                    vox_trig(&st.vox, &st.vk);
                    st.vtrig = 0;
                    st.vsince = 0;
                }
                out = 0.35f * out + vox_run(&st.vox, &st.vk, out) * st.vlevel;
            }
        }
        /* the listening: zero crossings and power, a block at a time */
        if ((out > 0.0f) != (st.prev_s > 0.0f))
            st.zc++;
        st.prev_s = out;
        st.blk_ss += out * out;
        if (inl && inr) {
            if ((ext > 0.0f) != (st.in_prev > 0.0f))
                st.in_zc++;
            st.in_prev = ext;
        }
        if (++st.blk_n >= 256u) {
            float rms = m_exp2(0.5f * m_log2(st.blk_ss / 256.0f + 1.0e-12f));
            float zhz = (float)st.zc * 0.5f / blk_dt;
            float bright = m_clamp(m_log2(zhz / 80.0f + 1.0f) / 7.0f, 0.0f, 1.0f);
            float dev;
            sh.bright += (bright - sh.bright) * listen_k;
            sh.loud += (m_clamp(1.0f + m_lin2db(rms) / 60.0f, 0.0f, 1.0f) - sh.loud) * listen_k;
            sh.bright_slow += (sh.bright - sh.bright_slow) * (1.0f - m_tc(4.0f, 1.0f / blk_dt));
            dev = m_abs(sh.bright - sh.bright_slow);
            sh.var += (dev - sh.var) * (1.0f - m_tc(3.0f, 1.0f / blk_dt));
            if (inl && inr)
                sh.bright_in = m_clamp(m_log2((float)st.in_zc * 0.5f / blk_dt / 80.0f + 1.0f) / 7.0f, 0.0f, 1.0f);
            /* 1. homeostasis */
            {
                float target = m_clamp(P[G_TARGET].v + m_min(0.6f, sh.age * 0.1f), 0.0f, 1.0f);
                float err = sh.bright - target;
                if ((err > 0.0f) != (st.err_prev > 0.0f))
                    st.vtrig = 1;                /* crossing its own target: a stroke */
                st.err_prev = err;
                sh.gain = m_clamp(sh.gain - sh.homeo_eff * err * 0.6f * blk_dt * 4.0f, 0.05f, 4.0f);
                /* 2. ultrastability */
                if (m_abs(err) > sh.band_eff)
                    st.out_bad += blk_dt;
                else
                    st.out_bad = m_max(0.0f, st.out_bad - 0.5f * blk_dt);
                if (sh.var < 0.006f)
                    st.bored += blk_dt;
                else
                    st.bored = m_max(0.0f, st.bored - blk_dt);
                if (st.out_bad > sh.pat_eff) {
                    restructure(err < 0.0f ? 1 : -1);
                    st.out_bad = 0.0f;
                } else if (st.bored > sh.pat_eff * 1.5f) {
                    restructure(1);
                    st.bored = 0.0f;
                }
            }
            st.blk_n = 0;
            st.zc = st.in_zc = 0;
            st.blk_ss = 0.0f;
        }
        st.out_prev = out;
        l[i] = out;
        r[i] = out;
    }
}

void pj_control(const mz_in_t *in, const mz_body_t *b)
{
    static const int ENC_PAR[HW_NENC] = {G_TARGET, G_REWIRE, G_PATIENCE, G_BAND, G_HOMEO, G_LISTEN, G_REG};
    static const uint8_t WHITE[16] = {0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24, 26};
    int i;
    float dt = (float)in->dt * 0.001f;
    for (i = 0; i < HW_NENC; i++) {
        if (!in->enc[i])
            continue;
        if (i == 1) {                    /* REWIRE: a structural step for each detent turned */
            int k, d = in->enc[i] < 0 ? -in->enc[i] : in->enc[i];
            for (k = 0; k < d && k < 4; k++)
                sh.step_req++;
            par_turn(&DEF[G_REWIRE], &P[G_REWIRE], d, 1.0f, in->ms);
            continue;
        }
        par_turn(&DEF[ENC_PAR[i]], &P[ENC_PAR[i]], in->enc[i], par_accel(b->speed[i]), in->ms);
    }
    for (i = 0; i < NO; i++) {
        if (in->down >> WHITE[i] & 1u) {
            sh.tap[i] = (uint8_t)!sh.tap[i];
            if (!sh.tap[0] && !sh.tap[1] && !sh.tap[2] && !sh.tap[3])
                sh.tap[i] = 1;
            mz_say(sh.tap[i] ? "TAP" : "UNTAP", i == 0 ? "OP1" : i == 1 ? "OP2" : i == 2 ? "OP3" : "OP4");
            sh.plot_rev++;
        }
        sh.bend[i] = (in->keys >> WHITE[i + 4] & 1u) ? (float)in->prs[WHITE[i + 4]] * (300.0f / 127.0f) : 0.0f;
    }
    /* the body enters the configuration */
    sh.band_eff = m_max(0.02f, P[G_BAND].v * (1.0f - 0.7f * m_min(1.0f, b->agit / 25.0f))
                                  * (1.0f + m_min(0.5f, (float)b->still_all * (1.0f / 60000.0f))));
    sh.pat_eff = P[G_PATIENCE].v * (1.0f + m_min(1.0f, (float)b->still_all * (1.0f / 60000.0f)))
               / (1.0f + b->agit * 0.05f);
    {
        static float rev_prev;
        static float flip = 1.0f;
        if (b->revs > 1.2f && rev_prev <= 1.2f) {
            flip = -flip;
            mz_say("HOMEO", flip > 0.0f ? "AS SET" : "FLIPPED");
        }
        rev_prev = b->revs;
        sh.homeo_eff = P[G_HOMEO].v * flip;
    }
    if (b->onset_any >= 1.5f) {
        sh.step_req++;
        mz_say("STARTLED", "A STEP");
    }
    sh.age += dt * (1.0f / 60.0f);
    /* the history: brightness and variation, a point every 250 ms */
    {
        static uint32_t acc;
        acc += in->dt;
        if (acc >= 250u) {
            acc -= 250u;
            for (i = 119; i > 0; i--) {
                sh.hist_b[i] = sh.hist_b[i - 1];
                sh.hist_v[i] = sh.hist_v[i - 1];
            }
            sh.hist_b[0] = sh.bright;
            sh.hist_v[0] = sh.var;
            if (sh.hist_n < 120)
                sh.hist_n++;
            sh.plot_rev++;
        }
    }
}

void pj_row(int i, mz_row_t *r)
{
    static const int ENC_PAR[HW_NENC] = {G_TARGET, G_REWIRE, G_PATIENCE, G_BAND, G_HOMEO, G_LISTEN, G_REG};
    int p = ENC_PAR[i];
    par_row(&DEF[p], &P[p], r, hw_ms(), P[p].v);
    r->value[0] = 0;
    switch (p) {
    case G_TARGET:
        mz_fix(r->value, P[p].v, 2);
        mz_cat(r->value, "+");
        mz_fix(r->value, m_min(0.6f, sh.age * 0.1f), 2);
        break;
    case G_REWIRE:
        mz_cat(r->value, "N");
        mz_int(r->value, (int32_t)sh.steps);
        mz_cat(r->value, " ");
        mz_cat(r->value, sh.last);
        break;
    case G_PATIENCE:
        mz_fix(r->value, sh.pat_eff, 1);
        mz_cat(r->value, " S");
        break;
    case G_BAND:
        mz_fix(r->value, sh.band_eff, 2);
        break;
    case G_HOMEO:
        mz_fix(r->value, sh.homeo_eff, 2);
        mz_cat(r->value, " G");
        mz_fix(r->value, sh.gain, 2);
        r->alert = sh.homeo_eff < 0.0f;
        break;
    default:
        par_text(&DEF[p], &P[p], r->value);
        break;
    }
}

void pj_status(char *s)
{
    mz_cat(s, "B");
    mz_fix(s, sh.bright, 2);
    mz_cat(s, " W");
    mz_int(s, count_edges());
    mz_cat(s, " AGE");
    mz_fix(s, sh.age, 1);
}

uint32_t pj_plot_rev(void) { return sh.plot_rev; }

/* the matrix (left: edge i <- j, amber +, cyan -, the taps below), and what it hears (right: brightness with its
 * band, variation) */
void pj_plot(int h)
{
    int i, j, c;
    float target = m_clamp(P[G_TARGET].v + m_min(0.6f, sh.age * 0.1f), 0.0f, 1.0f);
    for (i = 0; i < NO; i++) {
        for (j = 0; j < NO; j++) {
            float w = sh.w[i][j];
            int x = 2 + j * 12, y = 2 + i * 12;
            scr_rect(x, y, 11, 11, C_RULE);
            if (w != 0.0f) {
                int s = 2 + (int)(m_min(1.0f, m_abs(w) / 2.0f) * 7.0f);
                hw_fill(x + (11 - s) / 2, y + (11 - s) / 2, s, s, w > 0.0f ? C_VAL : C_CYN);
            }
        }
        hw_fill(2 + i * 12 + 3, 52, 5, 5, sh.tap[i] ? C_GRN : C_RULE);
    }
    {
        int x0 = 56, w = 182, yb = h - 2, hh = h - 4;
        int ylo = yb - (int)(m_clamp(target - sh.band_eff, 0.0f, 1.0f) * (float)hh);
        int yhi = yb - (int)(m_clamp(target + sh.band_eff, 0.0f, 1.0f) * (float)hh);
        hw_fill(x0, yhi, w, ylo - yhi + 1, RGB565(28, 28, 34));
        scr_hline(x0, yb - (int)(target * (float)hh), w, C_RULE);
        for (c = 0; c < sh.hist_n && c < 120; c++) {
            int x = x0 + w - 1 - c * w / 120;
            int yb1 = yb - (int)(m_clamp(sh.hist_b[c], 0.0f, 1.0f) * (float)hh);
            int yv = yb - (int)(m_clamp(sh.hist_v[c] * 20.0f, 0.0f, 1.0f) * (float)hh);
            hw_fill(x, yb1, 2, 2, C_VAL);
            hw_fill(x, yv, 1, 1, C_CYN);
        }
    }
}

uint32_t pj_lit_keys(void)
{
    static const uint8_t WHITE[4] = {0, 2, 4, 6};
    uint32_t m = 0;
    int i;
    for (i = 0; i < NO; i++)
        if (sh.tap[i])
            m |= 1u << WHITE[i];
    return m;
}

uint32_t pj_dim_keys(void) { return (1u << 0) | (1u << 2) | (1u << 4) | (1u << 6) | (1u << 7) | (1u << 9) | (1u << 11) | (1u << 12); }
