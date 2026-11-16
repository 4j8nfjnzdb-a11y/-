/* HENKA (変化): a Digitakt-like machine whose locks hold the inside of the sounds, not their notes.
 * Four tracks, each an FM voice (fmvox.h: KICK, SNARE, HAT, SYNTH are only where a voice starts; the same twelve
 * numbers make all of them). Each track has its own length (16 / 12 / 7 / 5 to start: polymeter, the tracks meet
 * again only after their least common multiple) and its own steps: a trig fires the voice; a lock holds one of its
 * numbers (the track's destination) for that step. Each step has a condition: a probability, A:B (the Ath of every B
 * loops), PRE (the track's last condition was true), NEI (the track above's was), 1ST, FILL, and their negations.
 * Each track has an LFO on its destination, its period tied to the track's length.
 * Tracks come in and go out (black keys 6-9), and combine as FM does: XMOD sends the track above into this voice's
 * carrier phase (track 1 takes track 4), and XMOD can be locked per step like anything else.
 * What keeps it changing: MUT. At the end of each track's loop, with probability MUT (raised by how much the hand has
 * been doing), one thing in that track changes for good: a lock moves on (with momentum: it keeps going one way until
 * a wall, then turns), a trig or a lock appears or goes, a condition shifts, now and then the destination moves to
 * another number. Nothing changes back on its own. It starts as one kick on the first step: the other tracks fill in.
 * The body: turning back and forth reverses every track's momentum; moving after stillness makes the next loop a FILL.
 * Keys: white = steps of the track (tap: trig on / off; hold and press: a lock, as hard as pressed; hold and K1 / K2:
 * its value and condition). Black 1-4: the track; 5: FILL (held); 6-9: tracks in / out; 10: the next kind (the
 * track's numbers go to that kind's place); 11: XMOD on / off for the track. */
#include "par.h"
#include "fmvox.h"

const char PJ_NAME[] = "HENKA";

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

#define NT 4
#define NS 16
typedef struct {
    uint8_t kind, on, dest, len;
    float p[NVP];                        /* the voice's numbers: the bases */
    uint8_t trig[NS], has[NS], cond[NS];
    float val[NS];
    float lfo_depth;
    uint32_t loops;
    uint8_t last_true;
    float momentum;
    int8_t flash_step;
    uint32_t flash_until;
} trk_t;

static struct {
    trk_t t[NT];
    float tempo, mut;
    uint8_t fill_held, fill_next;
    volatile uint32_t home_req;
    uint32_t plot_rev, seed;
    int pos[NT];
    float energy;
} sh;

static struct {
    int trk;
    int held_step;
    uint32_t held_t, hot[HW_NENC];
    uint8_t held_pressed;
} ui;

static const uint8_t WHITE[16] = {0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24, 26};
static const uint8_t BLACK[11] = {1, 3, 5, 8, 10, 13, 15, 17, 20, 22, 25};
static const float PAN[NT] = {0.0f, -0.35f, 0.4f, -0.15f};

static struct {
    uint32_t home_seen;
    vox_t v[NT];
    vox_k_t kk[NT];
    float lock[NT];                      /* the destination's value this step (a lock, else the base) */
    uint8_t locked[NT];
    float phase;
    float lfo_ph[NT];
} st;

static float vp_clamp(int d, float x) { return m_clamp(x, VP_LO[d], VP_HI[d]); }

static void trk_kind(trk_t *T, int kind)
{
    int d;
    T->kind = (uint8_t)kind;
    for (d = 0; d < NVP; d++)
        T->p[d] = VB_POINT[kind][d];
}

static void trk_reset(trk_t *T, int kind, uint8_t dest, uint8_t len)
{
    int s;
    trk_kind(T, kind);
    T->on = 1;
    T->dest = dest;
    T->len = len;
    T->lfo_depth = 0.0f;
    for (s = 0; s < NS; s++) {
        T->trig[s] = T->has[s] = T->cond[s] = 0;
        T->val[s] = T->p[dest];
    }
    T->loops = 0;
    T->last_true = 1;
    T->momentum = 1.0f;
    T->flash_step = -1;
}

static void defaults(void)
{
    trk_reset(&sh.t[0], VB_KICK, VP_DEC, 16);
    sh.t[0].trig[0] = 1;                 /* one kick on the first step: the simplest place */
    trk_reset(&sh.t[1], VB_SNARE, VP_NOISE, 12);
    trk_reset(&sh.t[2], VB_HAT, VP_DEC, 7);
    trk_reset(&sh.t[3], VB_SYNTH, VP_INDEX, 5);
    sh.tempo = 112.0f;
    sh.mut = 0.12f;
}

/* the tracks follow their slots (EDIT's voice page, ALGO, black key 10): a new kind puts the track's numbers at that
 * kind's place; an empty slot falls back to slot 1, so one source can play all four tracks */
static uint32_t slot_seen = 0xFFFFFFFFu;
static void follow_slots(void)
{
    static const uint8_t OWN[NT] = {VB_KICK, VB_SNARE, VB_HAT, VB_SYNTH};
    int k;
    if (mz_slot_rev() == slot_seen)
        return;
    slot_seen = mz_slot_rev();
    for (k = 0; k < NT; k++) {
        const mz_slot_t *v = mz_voice(k);
        int kind = v ? v->src - 1 : OWN[k];
        if (kind != sh.t[k].kind)
            trk_kind(&sh.t[k], kind);
    }
    sh.plot_rev++;
}

void pj_init(uint32_t seed)
{
    sh.seed = seed | 1u;
    mz_slot_set(0, 1 + VB_KICK);         /* henka starts with four sources; empty a slot and it plays slot 1's */
    mz_slot_set(1, 1 + VB_SNARE);
    mz_slot_set(2, 1 + VB_HAT);
    mz_slot_set(3, 1 + VB_SYNTH);
    slot_seen = mz_slot_rev();
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
    int k;
    for (k = 0; k < NT; k++) {
        vox_reset(&st.v[k]);
        sh.pos[k] = -1;
        st.locked[k] = 0;
        st.lfo_ph[k] = 0.0f;
    }
    st.phase = 0.999f;
}

/* ---- conditions, steps, mutation ---- */
static int cond_eval(int k, int c)
{
    const cond_t *q = &COND[c];
    trk_t *T = &sh.t[k];
    int r = 1;
    switch (q->type) {
    case C_ALW: r = 1; break;
    case C_P: r = m_rnd(&sh.seed) * 100.0f < (float)q->a; break;
    case C_AB: r = (int)(T->loops % q->b) == q->a - 1; break;
    case C_NAB: r = (int)(T->loops % q->b) != q->a - 1; break;
    case C_PRE: r = T->last_true; break;
    case C_NPRE: r = !T->last_true; break;
    case C_NEI: r = sh.t[(k + NT - 1) % NT].last_true; break;
    case C_NNEI: r = !sh.t[(k + NT - 1) % NT].last_true; break;
    case C_1ST: r = T->loops == 0; break;
    case C_N1ST: r = T->loops != 0; break;
    case C_FILL: r = sh.fill_held || sh.fill_next; break;
    case C_NFILL: r = !(sh.fill_held || sh.fill_next); break;
    }
    if (q->type != C_ALW)                /* PRE and NEI follow conditions, as on the Digitakt */
        T->last_true = (uint8_t)r;
    return r;
}

static int find(const trk_t *T, int s, int want_used)
{
    int tries;
    for (tries = 0; tries < NS; tries++, s = (s + 1) % T->len)
        if (((T->trig[s] | T->has[s]) != 0) == want_used)
            return s;
    return -1;
}

static void mutate(int k)
{
    trk_t *T = &sh.t[k];
    float range = VP_HI[T->dest] - VP_LO[T->dest], r = m_rnd(&sh.seed);
    int s = (int)(m_rnd(&sh.seed) * (float)T->len) % T->len, used = 0, i;
    for (i = 0; i < T->len; i++)
        used += (T->trig[i] | T->has[i]) != 0;
    if (r < 0.42f && used) {             /* a lock moves on, with momentum; a wall turns it */
        s = find(T, s, 1);
        if (s >= 0) {
            if (!T->has[s]) {
                T->has[s] = 1;
                T->val[s] = T->p[T->dest];
            }
            T->val[s] += T->momentum * range * (0.03f + 0.07f * m_rnd(&sh.seed));
            if (T->val[s] >= VP_HI[T->dest] || T->val[s] <= VP_LO[T->dest]) {
                T->momentum = -T->momentum;
                T->val[s] = vp_clamp(T->dest, T->val[s]);
            }
        }
    } else if (r < 0.72f || !used) {     /* a trig (and maybe a lock) where there was none */
        s = find(T, s, 0);
        if (s >= 0) {
            T->trig[s] = 1;
            if (m_rnd(&sh.seed) < 0.5f) {
                T->has[s] = 1;
                T->val[s] = vp_clamp(T->dest, T->p[T->dest] + T->momentum * range * (0.05f + 0.2f * m_rnd(&sh.seed)));
            }
            T->cond[s] = (uint8_t)(m_rnd(&sh.seed) < 0.55f ? 0 : 1 + (int)(m_rnd(&sh.seed) * (float)(NCOND - 1)));
        }
    } else if (r < 0.80f && used > 3) {  /* one goes */
        s = find(T, s, 1);
        if (s >= 0 && !(k == 0 && s == 0))
            T->trig[s] = T->has[s] = 0;
    } else if (r < 0.93f && used) {      /* a condition shifts to a neighbour */
        s = find(T, s, 1);
        if (s >= 0)
            T->cond[s] = (uint8_t)((T->cond[s] + (m_rnd(&sh.seed) < 0.5f ? 1 : NCOND - 1)) % NCOND);
    } else {                             /* the destination moves to another number (its locks keep their place) */
        static const uint8_t DESTS[] = {VP_PITCH, VP_SWEEP, VP_RATIO, VP_INDEX, VP_IDEC, VP_FB, VP_NOISE, VP_METAL,
                                        VP_DEC, VP_XMOD};
        int d = DESTS[(int)(m_rnd(&sh.seed) * 10.0f) % 10];
        for (i = 0; i < NS; i++)
            T->val[i] = vp_clamp(d, T->p[d] + (T->val[i] - T->p[T->dest]) / range * (VP_HI[d] - VP_LO[d]));
        T->dest = (uint8_t)d;
    }
    T->flash_step = (int8_t)(s < 0 ? 0 : s);
    T->flash_until = hw_ms() + 600u;
    sh.plot_rev++;
}

static void step(int dir)
{
    int k;
    for (k = 0; k < NT; k++) {
        trk_t *T = &sh.t[k];
        int p = sh.pos[k] + dir;
        if (p >= T->len || p < 0) {
            p = p < 0 ? T->len - 1 : 0;
            T->loops++;
            if (m_rnd(&sh.seed) < m_min(1.0f, sh.mut + 0.5f * sh.energy))
                mutate(k);
            if (k == 0)
                sh.fill_next = 0;
        }
        if (p >= T->len)
            p = 0;
        sh.pos[k] = p;
        st.locked[k] = 0;
        if ((T->trig[p] || T->has[p]) && cond_eval(k, T->cond[p])) {
            if (T->has[p]) {
                st.lock[k] = T->val[p];
                st.locked[k] = 1;
            }
            if (T->trig[p] && T->on)
                vox_trig(&st.v[k], &st.kk[k]);
        }
    }
    sh.plot_rev++;
}

void pj_render(float *out_l, float *out_r, const float *inl, const float *inr, uint32_t n)
{
    uint32_t i;
    int k, d;
    vox_k_t *kk = st.kk;
    float steps_per_s = sh.tempo * (4.0f / 60.0f), dstep = m_abs(steps_per_s) * M_INV_SR, lvl[NT];
    (void)inl, (void)inr;
    if (sh.home_req != st.home_seen) {
        st.home_seen = sh.home_req;
        pj_reset_audio();
    }
    for (i = 0; i < n; i++) {
        float l = 0.0f, r = 0.0f, prev;
        st.phase += dstep;
        if (st.phase >= 1.0f || i == 0) {
            if (st.phase >= 1.0f) {
                st.phase -= 1.0f;
                step(steps_per_s < 0.0f ? -1 : 1);
            }
            /* the voices' numbers now: the bases, this step's locks, the LFOs */
            for (k = 0; k < NT; k++) {
                trk_t *T = &sh.t[k];
                float p[NVP], per = (float)T->len * 3.0f / m_max(0.25f, m_abs(steps_per_s));
                for (d = 0; d < NVP; d++)
                    p[d] = T->p[d];
                if (st.locked[k])
                    p[T->dest] = st.lock[k];
                st.lfo_ph[k] += (float)n * M_INV_SR / per;
                st.lfo_ph[k] -= m_floor(st.lfo_ph[k]);
                p[T->dest] = vp_clamp(T->dest, p[T->dest] + T->lfo_depth * (VP_HI[T->dest] - VP_LO[T->dest])
                                                            * m_sin_t(st.lfo_ph[k]));
                {                        /* the track's slot moves its numbers (tune, brightness, decay, fb) */
                    const mz_slot_t *v = mz_voice(k);
                    if (v) {
                        p[VP_PITCH] = vp_clamp(VP_PITCH, p[VP_PITCH] * m_exp2(v->tune));
                        p[VP_INDEX] = vp_clamp(VP_INDEX, p[VP_INDEX] + v->bright);
                        p[VP_FB] = vp_clamp(VP_FB, p[VP_FB] + v->fb);
                        if (p[VP_DEC] < VP_HELD)
                            p[VP_DEC] = vp_clamp(VP_DEC, p[VP_DEC] * v->dec_x);
                    }
                    vox_coefs(&kk[k], p);
                    lvl[k] = T->on ? VB_LEVEL[T->kind] * (v ? m_db2lin(v->level_db) : 1.0f) : 0.0f;
                }
            }
        }
        prev = st.v[NT - 1].y;
        for (k = 0; k < NT; k++) {
            float y = lvl[k] > 0.0f ? vox_run(&st.v[k], &kk[k], prev) : (st.v[k].y = 0.0f);
            prev = y;
            y *= lvl[k];
            l += y * (1.0f - PAN[k]);
            r += y * (1.0f + PAN[k]);
        }
        out_l[i] = l * 0.5f;
        out_r[i] = r * 0.5f;
    }
}

/* ---- the hand ---- */
void pj_control(const mz_in_t *in, const mz_body_t *b)
{
    trk_t *T = &sh.t[ui.trk];
    int i;
    follow_slots();
    sh.energy = b->energy;
    for (i = 0; i < 16; i++) {
        uint32_t bit = 1u << WHITE[i];
        if (in->down & bit) {
            ui.held_step = i;
            ui.held_t = in->ms;
            ui.held_pressed = 0;
        }
        if ((in->keys & bit) && ui.held_step == i && in->prs[WHITE[i]] > 20 && i < T->len) {
            float p = (float)in->prs[WHITE[i]] * (1.0f / 127.0f);
            T->has[i] = 1;
            T->val[i] = T->p[T->dest] + (VP_HI[T->dest] - T->p[T->dest]) * p;
            ui.held_pressed = 1;
            sh.plot_rev++;
        }
        if ((in->up & bit) && ui.held_step == i) {
            if (!ui.held_pressed && in->ms - ui.held_t < 350u && i < T->len) {
                T->trig[i] = (uint8_t)!T->trig[i];
                mz_say(T->trig[i] ? "TRIG" : "NO TRIG", VB_NAME[T->kind]);
            }
            ui.held_step = -1;
            sh.plot_rev++;
        }
    }
    for (i = 0; i < 11; i++) {
        if (!(in->down >> BLACK[i] & 1u))
            continue;
        if (i < 4) {
            ui.trk = i;
            mz_say("TRACK", VB_NAME[sh.t[i].kind]);
        } else if (i >= 5 && i <= 8) {   /* in and out */
            trk_t *U = &sh.t[i - 5];
            U->on = (uint8_t)!U->on;
            mz_say(VB_NAME[U->kind], U->on ? "IN" : "OUT");
        } else if (i == 9) {
            mz_slot_set(ui.trk, (uint8_t)(1 + (T->kind + 1) % NVB));   /* the track's slot: the next kind */
            mz_say("KIND", VB_NAME[(T->kind + 1) % NVB]);
        } else if (i == 10) {
            T->p[VP_XMOD] = T->p[VP_XMOD] > 0.0f ? 0.0f : 2.5f;
            mz_say("XMOD", T->p[VP_XMOD] > 0.0f ? "FROM ABOVE" : "OFF");
        }
        sh.plot_rev++;
    }
    sh.fill_held = (uint8_t)(((in->keys >> BLACK[4]) & 1u) | ((in->btn >> HB_FX) & 1u));
    T = &sh.t[ui.trk];
    if (in->enc[HE_SELECT]) {
        ui.trk = (ui.trk + (in->enc[HE_SELECT] > 0 ? 1 : NT - 1)) % NT;
        ui.hot[0] = in->ms + 400u;
        sh.plot_rev++;
    }
    if (in->enc[HE_ALGO]) {
        mz_slot_set(ui.trk, (uint8_t)(1 + (T->kind + (in->enc[HE_ALGO] > 0 ? 1 : NVB - 1)) % NVB));
        ui.hot[1] = in->ms + 400u;
        sh.plot_rev++;
    }
    if (in->enc[HE_PRESET]) {
        int d = (T->dest + (in->enc[HE_PRESET] > 0 ? 1 : NVP - 1)) % NVP;
        for (i = 0; i < NS; i++)         /* the locks keep their place in the new range */
            T->val[i] = vp_clamp(d, T->p[d] + (T->val[i] - T->p[T->dest]) / (VP_HI[T->dest] - VP_LO[T->dest])
                                               * (VP_HI[d] - VP_LO[d]));
        T->dest = (uint8_t)d;
        ui.hot[2] = in->ms + 400u;
        sh.plot_rev++;
    }
    if (in->enc[HE_K1]) {
        float det = (float)in->enc[HE_K1] * par_accel(b->speed[HE_K1]);
        int d = T->dest;
        float *v = (ui.held_step >= 0 && ui.held_step < T->len) ? &T->val[ui.held_step] : &T->p[d];
        if (v != &T->p[d]) {
            T->has[ui.held_step] = 1;
            ui.held_pressed = 1;
        }
        if (VP_LOGSTEP[d])
            *v = vp_clamp(d, *v * m_exp2(det * (1.0f / 24.0f)));
        else
            *v = vp_clamp(d, *v + det * (VP_HI[d] - VP_LO[d]) * 0.005f);
        ui.hot[3] = in->ms + 400u;
        sh.plot_rev++;
    }
    if (in->enc[HE_K2]) {
        if (ui.held_step >= 0 && ui.held_step < T->len) {
            T->cond[ui.held_step] = (uint8_t)((T->cond[ui.held_step] + (in->enc[HE_K2] > 0 ? 1 : NCOND - 1)) % NCOND);
            ui.held_pressed = 1;
        } else {
            T->len = (uint8_t)m_clampi(T->len + in->enc[HE_K2], 1, NS);
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
        T->lfo_depth = T->lfo_depth >= 0.39f ? 0.0f : T->lfo_depth < 0.04f ? 0.05f : T->lfo_depth < 0.14f ? 0.15f : 0.4f;
        mz_say("LFO", T->lfo_depth == 0.0f ? "OFF" : T->lfo_depth < 0.1f ? "5%" : T->lfo_depth < 0.2f ? "15%" : "40%");
    }
    {
        static float rev_prev;
        if (b->revs > 1.2f && rev_prev <= 1.2f) {
            int k;
            for (k = 0; k < NT; k++)
                sh.t[k].momentum = -sh.t[k].momentum;
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
    trk_t *T = &sh.t[ui.trk];
    uint32_t now = hw_ms();
    int hs = ui.held_step >= 0 && ui.held_step < T->len ? ui.held_step : -1, d = T->dest;
    r->hot = now < ui.hot[i];
    switch (i) {
    case 0:
        mz_cat(r->label, "TRACK");
        mz_int(r->value, ui.trk + 1);
        mz_cat(r->value, " ");
        {
            char sh3[4] = {VB_NAME[T->kind][0], VB_NAME[T->kind][1], VB_NAME[T->kind][2], 0};
            mz_cat(r->value, sh3);
        }
        mz_cat(r->value, T->on ? " IN L" : " OUT L");
        mz_int(r->value, (int32_t)T->loops);
        r->alert = !T->on;
        break;
    case 1:
        mz_cat(r->label, "KIND");
        mz_cat(r->value, VB_NAME[T->kind]);
        if (T->p[VP_XMOD] > 0.0f)
            mz_cat(r->value, " +XMOD");
        break;
    case 2:
        mz_cat(r->label, "DEST");
        mz_cat(r->value, VP_NAME[d]);
        break;
    case 3:
        mz_cat(r->label, hs >= 0 ? "LOCK" : "BASE");
        mz_fix(r->value, hs >= 0 ? T->val[hs] : T->p[d], VP_DECIMALS[d]);
        mz_cat(r->value, " ");
        mz_cat(r->value, VP_UNIT[d]);
        if (hs >= 0)
            r->hot = 1;
        break;
    case 4:
        mz_cat(r->label, hs >= 0 ? "COND" : "LEN");
        if (hs >= 0) {
            mz_cat(r->value, COND[T->cond[hs]].name);
            r->hot = 1;
        } else {
            mz_int(r->value, T->len);
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
        mz_fix(r->value, 0.5f * sh.energy, 2);
        break;
    }
}

void pj_status(char *s)
{
    int k, n = 0, j;
    for (k = 0; k < NT; k++)
        for (j = 0; j < sh.t[k].len; j++)
            n += sh.t[k].trig[j] + sh.t[k].has[j];
    mz_cat(s, "EVENTS ");
    mz_int(s, n);
    if (sh.fill_held || sh.fill_next)
        mz_cat(s, " FILL");
}

uint32_t pj_plot_rev(void) { return sh.plot_rev; }

void pj_plot(int h)
{
    int k, s;
    uint32_t now = hw_ms();
    (void)h;
    for (k = 0; k < NT; k++) {
        trk_t *T = &sh.t[k];
        int y = 1 + k * 15;
        float lo = VP_LO[T->dest], span = VP_HI[T->dest] - lo;
        {
            char sh3[4] = {VB_NAME[T->kind][0], VB_NAME[T->kind][1], VB_NAME[T->kind][2], 0};
            scr_text(0, y + 4, 1, sh3, !T->on ? C_DIMC : k == ui.trk ? C_HOT : C_LAB);
        }
        for (s = 0; s < T->len; s++) {
            int x = 22 + s * 13;
            uint16_t frame = s == sh.pos[k] ? C_HOT : C_RULE;
            int flash = T->flash_step == s && now < T->flash_until;
            scr_rect(x, y, 12, 14, frame);
            if (T->trig[s])
                hw_fill(x + 2, y + 2, 8, 5, flash ? C_HOT : !T->on ? C_DIMC : COND[T->cond[s]].type == C_ALW ? C_VAL : C_CYN);
            if (T->has[s]) {
                int hh = 1 + (int)(5.0f * m_clamp((T->val[s] - lo) / span, 0.0f, 1.0f));
                hw_fill(x + 2, y + 13 - hh, 8, hh, flash ? C_HOT : C_GRN);
            }
        }
        if (T->p[VP_XMOD] > 0.0f)
            scr_text(234, y + 4, 1, "&", C_CYN);
    }
}

uint32_t pj_lit_keys(void)
{
    trk_t *T = &sh.t[ui.trk];
    uint32_t m = 1u << BLACK[ui.trk];
    int s;
    for (s = 0; s < T->len && s < 16; s++)
        if (T->trig[s])
            m |= 1u << WHITE[s];
    if (sh.pos[ui.trk] >= 0 && sh.pos[ui.trk] < 16)
        m |= 1u << WHITE[sh.pos[ui.trk]];
    for (s = 0; s < NT; s++)
        if (sh.t[s].on)
            m |= 1u << BLACK[5 + s];
    return m;
}

uint32_t pj_dim_keys(void)
{
    trk_t *T = &sh.t[ui.trk];
    uint32_t m = 0;
    int s;
    for (s = 0; s < T->len; s++)
        m |= 1u << WHITE[s];
    for (s = 0; s < 11; s++)
        m |= 1u << BLACK[s];
    return m;
}
