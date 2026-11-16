/* HENKA (変化): a Digitakt-like machine whose locks hold the inside of the sound, not its notes.
 * One FM voice at one register. Four lanes of up to 16 steps, each lane its own length (polymeter: 16 / 12 / 7 / 5
 * to start, so the lanes meet again only after their least common multiple). A step holds a parameter lock for the
 * lane's destination (an operator ratio, an index, the feedback, the decay, the register in cents, the bit depth);
 * lane 1's steps also retrigger the envelope. Each lock has a condition: a probability, A:B (the Ath of every B loops),
 * PRE (the lane's last condition was true), NEI (the lane above's was), 1ST, FILL, and their negations. Each lane has
 * an LFO on its destination, its period tied to the lane's own length.
 * What keeps it changing: MUT. At the end of each lane loop, with probability MUT (raised by how much the hand has
 * been doing), one thing in that lane changes for good: a lock moves on (with momentum: it keeps going one way until a
 * wall, then turns), a lock appears or goes, a condition shifts. Nothing changes back on its own. Turning back and forth
 * reverses every lane's momentum; moving after stillness makes the next loop a FILL.
 * Keys: white = steps of the lane (tap: lock on / off; hold and press: the lock's value; hold and K1 / K2: its value
 * and condition). Black 1-4: the lane; 5: FILL (held); 6-11: the lane's destination. */
#include "par.h"
#include "fm.h"

const char PJ_NAME[] = "HENKA";

enum { D_R2, D_R3, D_I2, D_I3, D_FB, D_DEC, D_CENT, D_BITS, ND };
static const char *const DEST_NAME[ND] = {"R2", "R3", "I2", "I3", "FB", "DEC", "CENT", "BITS"};
static const char *const DEST_UNIT[ND] = {"", "", "RAD", "RAD", "RAD", "S", "CT", "BIT"};
static const float DEST_LO[ND] = {0.125f, 0.125f, 0.0f, 0.0f, -2.5f, 0.01f, -2400.0f, 1.0f};
static const float DEST_HI[ND] = {12.0f, 12.0f, 14.0f, 14.0f, 2.5f, 8.0f, 2400.0f, 24.0f};
static const float DEST_STEP[ND] = {0.01f, 0.01f, 0.05f, 0.05f, 0.02f, 0.01f, 5.0f, 0.1f};
static const float DEST_DEF[ND] = {1.0f, 3.5f, 0.0f, 0.0f, 0.0f, 1.2f, 0.0f, 24.0f};

/* conditions */
enum { C_ALW, C_P, C_AB, C_NAB, C_PRE, C_NPRE, C_NEI, C_NNEI, C_1ST, C_N1ST, C_FILL, C_NFILL };
typedef struct { uint8_t type, a, b; const char *name; } cond_t;
static const cond_t COND[] = {
    {C_ALW, 0, 0, "ALWAYS"}, {C_P, 10, 0, "10%"}, {C_P, 25, 0, "25%"}, {C_P, 50, 0, "50%"}, {C_P, 75, 0, "75%"},
    {C_P, 90, 0, "90%"}, {C_AB, 1, 2, "1:2"}, {C_AB, 2, 2, "2:2"}, {C_AB, 1, 3, "1:3"}, {C_AB, 2, 3, "2:3"},
    {C_AB, 3, 3, "3:3"}, {C_AB, 1, 4, "1:4"}, {C_AB, 4, 4, "4:4"}, {C_AB, 1, 5, "1:5"}, {C_AB, 3, 7, "3:7"},
    {C_NAB, 1, 2, "!1:2"}, {C_NAB, 1, 3, "!1:3"}, {C_NAB, 2, 5, "!2:5"}, {C_PRE, 0, 0, "PRE"}, {C_NPRE, 0, 0, "!PRE"},
    {C_NEI, 0, 0, "NEI"}, {C_NNEI, 0, 0, "!NEI"}, {C_1ST, 0, 0, "1ST"}, {C_N1ST, 0, 0, "!1ST"},
    {C_FILL, 0, 0, "FILL"}, {C_NFILL, 0, 0, "!FILL"},
};
#define NCOND ((int)(sizeof COND / sizeof COND[0]))

#define NL 4
#define NS 16
typedef struct {
    uint8_t dest, len;
    float base, lfo_depth;
    uint8_t has[NS];                     /* a lock (lane 1: a trig with a lock) */
    float val[NS];
    uint8_t cond[NS];
    uint32_t loops;                      /* loops completed */
    uint8_t last_true;                   /* the last condition evaluated */
    float momentum;
    int8_t flash_step;
    uint32_t flash_until;
} lane_t;

static struct {
    lane_t ln[NL];
    float tempo;                         /* BPM; negative: the steps go backwards; 0: time stops */
    float mut;
    uint8_t algo;
    uint8_t fill_held, fill_next;
    volatile uint32_t home_req;
    uint32_t plot_rev;
    uint32_t seed;
    int pos[NL];                         /* each lane's step now (written by the render) */
} sh;

static struct {
    int lane;
    int held_step;                       /* a step key held (-1 none) */
    uint32_t held_t;
    uint8_t held_pressed;
    uint32_t hot[HW_NENC];
} ui;

static const uint8_t WHITE[16] = {0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24, 26};
static const uint8_t BLACK[11] = {1, 3, 5, 8, 10, 13, 15, 17, 20, 22, 25};
static const char *const ALGO_NAME[4] = {"3>2>1", "2+3>1", "3>2|3>1", "1>3>2>1"};

static struct {
    op_t o1, o2, o3;
    env_t env;
    float y_prev;
    float cur[ND], smooth[ND];
    float phase;                         /* the step clock, 0..1 within a step */
    uint32_t home_seen;
    float lfo_ph[NL];
    float held_bits;
    uint32_t bits_cnt;
} st;

static void lane_reset(lane_t *L, uint8_t dest, uint8_t len)
{
    int s;
    L->dest = dest;
    L->len = len;
    L->base = DEST_DEF[dest];
    L->lfo_depth = 0.0f;
    for (s = 0; s < NS; s++) {
        L->has[s] = 0;
        L->val[s] = L->base;
        L->cond[s] = 0;
    }
    L->loops = 0;
    L->last_true = 1;
    L->momentum = 1.0f;
    L->flash_step = -1;
}

static void defaults(void)
{
    lane_reset(&sh.ln[0], D_DEC, 16);
    sh.ln[0].has[0] = 1;                 /* one trig, on the first step: the simplest place */
    sh.ln[0].val[0] = DEST_DEF[D_DEC];
    lane_reset(&sh.ln[1], D_I2, 12);
    lane_reset(&sh.ln[2], D_R2, 7);
    lane_reset(&sh.ln[3], D_FB, 5);
    sh.ln[1].lfo_depth = 0.15f;
    sh.tempo = 96.0f;
    sh.mut = 0.25f;
    sh.algo = 0;
}

void pj_init(uint32_t seed)
{
    sh.seed = seed | 1u;
    defaults();
    ui.held_step = -1;
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
    int d, l;
    st.o1.ph = st.o2.ph = st.o3.ph = 0;
    st.o1.y = st.o2.y = st.o3.y = 0.0f;
    st.env.v = 0.0f;
    st.env.att_left = 0;
    st.y_prev = 0.0f;
    st.phase = 0.999f;
    for (d = 0; d < ND; d++)
        st.cur[d] = st.smooth[d] = DEST_DEF[d];
    for (l = 0; l < NL; l++) {
        sh.pos[l] = -1;
        st.lfo_ph[l] = 0.0f;
    }
}

/* ---- the step: conditions, locks, mutation ---- */
static int cond_eval(int l, int c)
{
    const cond_t *k = &COND[c];
    lane_t *L = &sh.ln[l];
    int r = 1;
    switch (k->type) {
    case C_ALW: r = 1; break;
    case C_P: r = m_rnd(&sh.seed) * 100.0f < (float)k->a; break;
    case C_AB: r = (int)(L->loops % k->b) == k->a - 1; break;
    case C_NAB: r = (int)(L->loops % k->b) != k->a - 1; break;
    case C_PRE: r = L->last_true; break;
    case C_NPRE: r = !L->last_true; break;
    case C_NEI: r = sh.ln[(l + NL - 1) % NL].last_true; break;
    case C_NNEI: r = !sh.ln[(l + NL - 1) % NL].last_true; break;
    case C_1ST: r = L->loops == 0; break;
    case C_N1ST: r = L->loops != 0; break;
    case C_FILL: r = sh.fill_held || sh.fill_next; break;
    case C_NFILL: r = !(sh.fill_held || sh.fill_next); break;
    }
    if (k->type != C_ALW)                /* PRE / NEI follow conditions, as on the Digitakt */
        L->last_true = (uint8_t)r;
    return r;
}

static void mutate(int l)
{
    lane_t *L = &sh.ln[l];
    float range = DEST_HI[L->dest] - DEST_LO[L->dest], r = m_rnd(&sh.seed);
    int s = (int)(m_rnd(&sh.seed) * (float)L->len), tries, k;
    int nlocks = 0;
    for (k = 0; k < L->len; k++)
        nlocks += L->has[k];
    if (r < 0.5f && nlocks) {            /* a lock moves on, with momentum; a wall turns it */
        for (tries = 0; tries < NS && !L->has[s]; tries++)
            s = (s + 1) % L->len;
        L->val[s] += L->momentum * range * (0.04f + 0.08f * m_rnd(&sh.seed));
        if (L->val[s] > DEST_HI[L->dest] || L->val[s] < DEST_LO[L->dest]) {
            L->momentum = -L->momentum;
            L->val[s] = m_clamp(L->val[s], DEST_LO[L->dest], DEST_HI[L->dest]);
        }
    } else if (r < 0.75f || !nlocks) {   /* a lock appears where there was none */
        for (tries = 0; tries < NS && L->has[s]; tries++)
            s = (s + 1) % L->len;
        if (!L->has[s]) {
            L->has[s] = 1;
            L->val[s] = m_clamp(L->base + L->momentum * range * (0.1f + 0.25f * m_rnd(&sh.seed)),
                                DEST_LO[L->dest], DEST_HI[L->dest]);
            L->cond[s] = (uint8_t)(m_rnd(&sh.seed) < 0.5f ? 0 : 1 + (int)(m_rnd(&sh.seed) * (float)(NCOND - 1)));
        }
    } else if (r < 0.85f && nlocks > 3) {   /* a lock goes */
        for (tries = 0; tries < NS && !L->has[s]; tries++)
            s = (s + 1) % L->len;
        if (!(l == 0 && s == 0))
            L->has[s] = 0;
    } else if (nlocks) {                 /* a condition shifts to a neighbour */
        for (tries = 0; tries < NS && !L->has[s]; tries++)
            s = (s + 1) % L->len;
        L->cond[s] = (uint8_t)((L->cond[s] + (m_rnd(&sh.seed) < 0.5f ? 1 : NCOND - 1)) % NCOND);
    }
    L->flash_step = (int8_t)s;
    L->flash_until = hw_ms() + 600u;
    sh.plot_rev++;
}

static void step(int dir, float energy)
{
    int l;
    for (l = 0; l < NL; l++) {
        lane_t *L = &sh.ln[l];
        int p = sh.pos[l] + dir;
        if (p >= L->len || p < 0) {      /* a loop ends */
            p = p < 0 ? L->len - 1 : 0;
            L->loops++;
            if (m_rnd(&sh.seed) < m_min(1.0f, sh.mut + 0.5f * energy))
                mutate(l);
            if (l == 0)
                sh.fill_next = 0;
        }
        if (p >= L->len)
            p = 0;
        sh.pos[l] = p;
        st.cur[L->dest] = L->base;       /* trigless: the base unless a lock fires */
        if (L->has[p] && cond_eval(l, L->cond[p])) {
            st.cur[L->dest] = L->val[p];
            if (l == 0)
                env_trig(&st.env, 130u);
        }
    }
    sh.plot_rev++;
}

static float body_energy;

void pj_render(float *out_l, float *out_r, const float *inl, const float *inr, uint32_t n)
{
    uint32_t i;
    int d, l;
    float steps_per_s = sh.tempo * (4.0f / 60.0f), dstep;
    (void)inl, (void)inr;
    if (sh.home_req != st.home_seen) {
        st.home_seen = sh.home_req;
        pj_reset_audio();
    }
    dstep = m_abs(steps_per_s) * M_INV_SR;
    for (i = 0; i < n; i++) {
        float f0, inc_scale, v[ND], m3, m2, y, e;
        st.phase += dstep;
        if (st.phase >= 1.0f) {
            st.phase -= 1.0f;
            step(steps_per_s < 0.0f ? -1 : 1, body_energy);
        }
        /* the destinations: locks or bases, plus each lane's LFO, glided 2 ms */
        if ((i & 15u) == 0u) {
            for (d = 0; d < ND; d++)
                v[d] = st.cur[d];
            for (l = 0; l < NL; l++) {
                lane_t *L = &sh.ln[l];
                float per = (float)L->len * 3.0f / m_max(0.25f, m_abs(steps_per_s));
                st.lfo_ph[l] += 16.0f * M_INV_SR / per;
                if (st.lfo_ph[l] >= 1.0f)
                    st.lfo_ph[l] -= 1.0f;
                v[L->dest] += L->lfo_depth * (DEST_HI[L->dest] - DEST_LO[L->dest]) * m_sin_t(st.lfo_ph[l]);
            }
            for (d = 0; d < ND; d++)
                glide(&st.smooth[d], m_clamp(v[d], DEST_LO[d], DEST_HI[d]), 0.3f);
        }
        f0 = 110.0f * m_exp2(st.smooth[D_CENT] * (1.0f / 1200.0f));
        inc_scale = f0;
        /* the voice */
        switch (sh.algo) {
        case 0:
            m3 = op_run(&st.o3, m_inc(inc_scale * st.smooth[D_R3]), st.smooth[D_FB] * 0.159f * st.o3.y);
            m2 = op_run(&st.o2, m_inc(inc_scale * st.smooth[D_R2]), st.smooth[D_I3] * 0.159f * m3);
            y = op_run(&st.o1, m_inc(inc_scale), st.smooth[D_I2] * 0.159f * m2);
            break;
        case 1:
            m3 = op_run(&st.o3, m_inc(inc_scale * st.smooth[D_R3]), st.smooth[D_FB] * 0.159f * st.o3.y);
            m2 = op_run(&st.o2, m_inc(inc_scale * st.smooth[D_R2]), 0.0f);
            y = op_run(&st.o1, m_inc(inc_scale), 0.159f * (st.smooth[D_I2] * m2 + st.smooth[D_I3] * m3));
            break;
        case 2:
            m3 = op_run(&st.o3, m_inc(inc_scale * st.smooth[D_R3]), st.smooth[D_FB] * 0.159f * st.o3.y);
            m2 = op_run(&st.o2, m_inc(inc_scale * st.smooth[D_R2]), st.smooth[D_I3] * 0.159f * m3);
            y = 0.6f * op_run(&st.o1, m_inc(inc_scale), st.smooth[D_I2] * 0.159f * m3) + 0.4f * m2;
            break;
        default:                         /* a loop through all three: the carrier back into op 3 */
            m3 = op_run(&st.o3, m_inc(inc_scale * st.smooth[D_R3]), st.smooth[D_FB] * 0.159f * st.y_prev);
            m2 = op_run(&st.o2, m_inc(inc_scale * st.smooth[D_R2]), st.smooth[D_I3] * 0.159f * m3);
            y = op_run(&st.o1, m_inc(inc_scale), st.smooth[D_I2] * 0.159f * m2);
            break;
        }
        st.y_prev = y;
        /* the bit depth (a lockable destination too) */
        if (st.smooth[D_BITS] < 23.5f) {
            float stp = m_exp2(1.0f - st.smooth[D_BITS]);
            y = m_floor(y / stp + 0.5f) * stp;
        }
        e = env_run(&st.env, st.smooth[D_DEC] >= 7.9f ? 0.0f : st.smooth[D_DEC]);
        y *= e * 0.45f;
        out_l[i] = y;
        out_r[i] = y;
    }
}

/* ---- the hand ---- */
void pj_control(const mz_in_t *in, const mz_body_t *b)
{
    lane_t *L = &sh.ln[ui.lane];
    int i;
    body_energy = b->energy;
    /* step keys */
    for (i = 0; i < 16; i++) {
        uint32_t bit = 1u << WHITE[i];
        if (in->down & bit) {
            ui.held_step = i;
            ui.held_t = in->ms;
            ui.held_pressed = 0;
        }
        if ((in->keys & bit) && ui.held_step == i && in->prs[WHITE[i]] > 20 && i < L->len) {
            float p = (float)in->prs[WHITE[i]] * (1.0f / 127.0f);
            L->has[i] = 1;
            L->val[i] = L->base + (DEST_HI[L->dest] - L->base) * p;
            ui.held_pressed = 1;
            sh.plot_rev++;
        }
        if ((in->up & bit) && ui.held_step == i) {
            if (!ui.held_pressed && in->ms - ui.held_t < 350u && i < L->len) {
                L->has[i] = (uint8_t)!L->has[i];
                if (L->has[i])
                    L->val[i] = L->base;
                mz_say(L->has[i] ? "LOCK" : "UNLOCK", DEST_NAME[L->dest]);
            }
            ui.held_step = -1;
            sh.plot_rev++;
        }
    }
    /* black keys */
    for (i = 0; i < 11; i++) {
        uint32_t bit = 1u << BLACK[i];
        if (!(in->down & bit))
            continue;
        if (i < 4) {
            ui.lane = i;
            mz_say("LANE", DEST_NAME[sh.ln[i].dest]);
        } else if (i >= 5) {
            static const uint8_t QD[6] = {D_R2, D_R3, D_I2, D_I3, D_FB, D_DEC};
            sh.ln[ui.lane].dest = QD[i - 5];
            sh.ln[ui.lane].base = DEST_DEF[QD[i - 5]];
            mz_say("DEST", DEST_NAME[QD[i - 5]]);
        }
        sh.plot_rev++;
    }
    sh.fill_held = (uint8_t)((in->keys >> BLACK[4]) & 1u) | (uint8_t)((in->btn >> HB_FX) & 1u);
    L = &sh.ln[ui.lane];
    /* encoders */
    if (in->enc[HE_SELECT]) {
        ui.lane = (ui.lane + (in->enc[HE_SELECT] > 0 ? 1 : NL - 1)) % NL;
        ui.hot[0] = in->ms + 400u;
        sh.plot_rev++;
    }
    if (in->enc[HE_ALGO]) {
        sh.algo = (uint8_t)((sh.algo + (in->enc[HE_ALGO] > 0 ? 1 : 3)) & 3u);
        ui.hot[1] = in->ms + 400u;
    }
    if (in->enc[HE_PRESET]) {
        L->dest = (uint8_t)((L->dest + (in->enc[HE_PRESET] > 0 ? 1 : ND - 1)) % ND);
        L->base = DEST_DEF[L->dest];
        for (i = 0; i < NS; i++)
            L->val[i] = m_clamp(L->val[i], DEST_LO[L->dest], DEST_HI[L->dest]);
        ui.hot[2] = in->ms + 400u;
        sh.plot_rev++;
    }
    if (in->enc[HE_K1]) {
        float d = (float)in->enc[HE_K1] * par_accel(b->speed[HE_K1]) * DEST_STEP[L->dest];
        if (ui.held_step >= 0 && ui.held_step < L->len) {
            L->has[ui.held_step] = 1;
            L->val[ui.held_step] = m_clamp(L->val[ui.held_step] + d, DEST_LO[L->dest], DEST_HI[L->dest]);
            ui.held_pressed = 1;
        } else {
            L->base = m_clamp(L->base + d, DEST_LO[L->dest], DEST_HI[L->dest]);
        }
        ui.hot[3] = in->ms + 400u;
        sh.plot_rev++;
    }
    if (in->enc[HE_K2]) {
        if (ui.held_step >= 0 && ui.held_step < L->len) {
            int c = L->cond[ui.held_step] + (in->enc[HE_K2] > 0 ? 1 : NCOND - 1);
            L->cond[ui.held_step] = (uint8_t)(c % NCOND);
            L->has[ui.held_step] = 1;
            ui.held_pressed = 1;
        } else {
            L->len = (uint8_t)m_clampi(L->len + in->enc[HE_K2], 1, NS);
        }
        ui.hot[4] = in->ms + 400u;
        sh.plot_rev++;
    }
    if (in->enc[HE_K3]) {
        sh.tempo = m_clamp(sh.tempo + (float)in->enc[HE_K3] * par_accel(b->speed[HE_K3]), -300.0f, 300.0f);
        ui.hot[5] = in->ms + 400u;
    }
    if (in->enc[HE_K4]) {
        sh.mut = m_clamp(sh.mut + (float)in->enc[HE_K4] * 0.01f, 0.0f, 1.0f);
        ui.hot[6] = in->ms + 400u;
    }
    if (in->bdown & (1u << HB_LFO)) {
        static const float LD[4] = {0.0f, 0.05f, 0.15f, 0.4f};
        int k = 0;
        while (k < 3 && LD[k] < L->lfo_depth + 0.001f)
            k++;
        L->lfo_depth = L->lfo_depth >= 0.39f ? 0.0f : LD[k];
        mz_say("LFO", L->lfo_depth == 0.0f ? "OFF" : L->lfo_depth < 0.1f ? "5%" : L->lfo_depth < 0.2f ? "15%" : "40%");
    }
    /* the body: back and forth turns every lane's momentum; moving after stillness: a FILL loop */
    {
        static float rev_prev;
        if (b->revs > 1.2f && rev_prev <= 1.2f) {
            int l;
            for (l = 0; l < NL; l++)
                sh.ln[l].momentum = -sh.ln[l].momentum;
            mz_say("MOMENTUM", "TURNED");
        }
        rev_prev = b->revs;
        if (b->onset_any >= 1.5f) {
            sh.fill_next = 1;
            mz_say("FILL", "NEXT LOOP");
        }
    }
}

void pj_row(int i, mz_row_t *r)
{
    lane_t *L = &sh.ln[ui.lane];
    uint32_t now = hw_ms();
    int hs = ui.held_step >= 0 && ui.held_step < L->len ? ui.held_step : -1;
    r->value[0] = 0;
    r->hot = now < ui.hot[i];
    switch (i) {
    case 0:
        mz_cat(r->label, "LANE");
        mz_int(r->value, ui.lane + 1);
        mz_cat(r->value, " ");
        mz_cat(r->value, DEST_NAME[L->dest]);
        mz_cat(r->value, " L");
        mz_int(r->value, L->loops);
        break;
    case 1:
        mz_cat(r->label, "ALGO");
        mz_cat(r->value, ALGO_NAME[sh.algo]);
        break;
    case 2:
        mz_cat(r->label, "DEST");
        mz_cat(r->value, DEST_NAME[L->dest]);
        break;
    case 3:
        mz_cat(r->label, hs >= 0 ? "LOCK" : "BASE");
        mz_fix(r->value, hs >= 0 ? L->val[hs] : L->base, L->dest == D_CENT ? 0 : 2);
        mz_cat(r->value, " ");
        mz_cat(r->value, DEST_UNIT[L->dest]);
        if (hs >= 0)
            r->hot = 1;
        break;
    case 4:
        mz_cat(r->label, hs >= 0 ? "COND" : "LEN");
        if (hs >= 0) {
            mz_cat(r->value, COND[L->cond[hs]].name);
            r->hot = 1;
        } else {
            mz_int(r->value, L->len);
            mz_cat(r->value, " STEPS");
        }
        break;
    case 5:
        mz_cat(r->label, "TEMPO");
        mz_fix(r->value, sh.tempo, 0);
        mz_cat(r->value, " BPM");
        r->alert = sh.tempo <= 0.0f;
        break;
    case 6:
        mz_cat(r->label, "MUT");
        mz_fix(r->value, sh.mut, 2);
        mz_cat(r->value, " +");
        mz_fix(r->value, 0.5f * body_energy, 2);
        break;
    }
}

void pj_status(char *s)
{
    int l, locks = 0, k;
    for (l = 0; l < NL; l++)
        for (k = 0; k < sh.ln[l].len; k++)
            locks += sh.ln[l].has[k];
    mz_cat(s, "LOCKS ");
    mz_int(s, locks);
    if (sh.fill_held || sh.fill_next)
        mz_cat(s, " FILL");
}

uint32_t pj_plot_rev(void) { return sh.plot_rev; }

void pj_plot(int h)
{
    int l, s;
    uint32_t now = hw_ms();
    (void)h;
    for (l = 0; l < NL; l++) {
        lane_t *L = &sh.ln[l];
        int y = 1 + l * 15;
        float lo = DEST_LO[L->dest], span = DEST_HI[L->dest] - lo;
        scr_text(0, y + 4, 1, DEST_NAME[L->dest], l == ui.lane ? C_HOT : C_LAB);
        for (s = 0; s < NS; s++) {
            int x = 26 + s * 13, inlane = s < L->len;
            uint16_t frame = !inlane ? C_BG : s == sh.pos[l] ? C_HOT : C_RULE;
            if (!inlane)
                continue;
            scr_rect(x, y, 12, 14, frame);
            if (L->has[s]) {
                int hh = 1 + (int)(11.0f * m_clamp((L->val[s] - lo) / span, 0.0f, 1.0f));
                uint16_t c = (L->flash_step == s && now < L->flash_until) ? C_HOT : COND[L->cond[s]].type == C_ALW ? C_VAL : C_CYN;
                hw_fill(x + 2, y + 13 - hh, 8, hh, c);
            }
        }
    }
}

uint32_t pj_lit_keys(void)
{
    lane_t *L = &sh.ln[ui.lane];
    uint32_t m = 1u << BLACK[ui.lane];
    int s;
    for (s = 0; s < L->len && s < 16; s++)
        if (L->has[s])
            m |= 1u << WHITE[s];
    if (sh.pos[ui.lane] >= 0 && sh.pos[ui.lane] < 16)
        m |= 1u << WHITE[sh.pos[ui.lane]];
    return m;
}

uint32_t pj_dim_keys(void)
{
    lane_t *L = &sh.ln[ui.lane];
    uint32_t m = 0;
    int s;
    for (s = 0; s < L->len; s++)
        m |= 1u << WHITE[s];
    for (s = 0; s < 11; s++)
        m |= 1u << BLACK[s];
    return m;
}
