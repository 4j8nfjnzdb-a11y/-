/* HENKA (変化): a Digitakt-like machine whose locks hold the inside of the sounds, not their notes, and whose time
 * itself changes.
 * Four tracks, each an FM voice from the bank (EDIT held: the voice page). Each track has its own length and its own
 * RATE against the tempo (1/4 .. 4: a track at 3/4 against one at 1 is time against time, not just polymeter), and
 * its steps: a trig fires the voice, a lock holds one of its numbers for that step, a condition decides (probability,
 * A:B, PRE, NEI, 1ST, FILL and their negations), a nudge makes it late (a fraction of a step).
 * Two kinds of change keep it moving. MUT (K4) changes the sound and the pattern, settling at each track's DENSITY (K3):
 * below it a trig appears, above it one goes, at it a lock moves on with momentum, a trig slides, a condition shifts.
 * TIME (ALGO) changes the time: nudges grow and drift (a groove that is found, not set: Tipographica's lean), a
 * track's length or its rate moves to a neighbour, and the tempo breathes by 1/f. Neither undoes itself. GLO holds
 * both; SAVE keeps a moment (held: back to it).
 * The knobs act at once: SELECT the track, ALGO TIME, PRESET the track's RATE, K1 its TONE (brightness), K2 its DECAY,
 * K3 its DENSITY, K4 MUT. Holding a step key turns them to the step: PRESET its lock's destination, K1 the lock, K2 the
 * condition, K3 the nudge, K4 the track's length.
 * The hand: black keys 1-4 play the four tracks (velocity; pressure brightens), black 6-9 repeat a track while held
 * (pressure: faster), white keys are the steps of the selected track (tap: trig on / off; hold and press: a lock).
 * ARP ENV / SEQ LFO: tracks 1 2 / 3 4 in and out. SEL: thin the track (held: clear it). FX or black 5: FILL.
 * OCT- / OCT+: tempo. Black 10: the track's LFO; 11: XMOD (the track above into this voice).
 * Sustained kinds (organ, pad, ...) fade over four of their track's steps here, so a struck one does not drone.
 * The body: turning back and forth reverses every track's momentum; moving after stillness makes the next loop a FILL. */
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
static const float RATES[] = {0.25f, 0.3333333f, 0.5f, 0.6666667f, 0.75f, 1.0f, 1.3333333f, 1.5f, 2.0f, 3.0f, 4.0f};
static const char *const RATE_NAME[] = {"1/4", "1/3", "1/2", "2/3", "3/4", "1", "4/3", "3/2", "2", "3", "4"};
#define NRATE 11
#define RATE_ONE 5
typedef struct {
    uint8_t kind, on, dest, len;
    float p[NVP];                        /* the voice's numbers: the bases */
    uint8_t trig[NS], has[NS], cond[NS];
    float val[NS];
    float lfo_depth, density;
    uint8_t rate_i;                      /* the track's rate against the tempo (RATES) */
    uint8_t nudge[NS];                   /* how late a step plays, in sixteenths of a step (0..10) */
    float tone, dec_x;                   /* K1 / K2: brightness added, decay multiplied */
    int8_t tmom;                         /* the time's momentum (nudges grow one way until a wall) */
    uint32_t loops;
    uint8_t last_true;
    float momentum;
    int8_t flash_step;
    uint32_t flash_until;
} trk_t;

static struct {
    trk_t t[NT];
    float tempo, mut, time;
    float tempo_w;                       /* the tempo's breath (TIME), a multiplier near 1 */
    uint8_t fill_held, fill_next, frozen;
    volatile uint32_t home_req;
    uint32_t plot_rev, seed;
    int pos[NT];
    float energy;
    /* the hand playing */
    volatile uint32_t live_req[NT];
    float live_vel[NT], live_bright[NT], ratchet_hz[NT];
    /* SAVE: a moment kept */
    uint8_t has_snap;
    trk_t snap[NT];
    float snap_tempo;
} sh;

static struct {
    int trk;
    int held_step;
    uint32_t held_t, hot[HW_NENC], sel_t, save_t;
    uint8_t held_pressed, sel_done, save_done;
} ui;

static const uint8_t WHITE[16] = {0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24, 26};
static const uint8_t BLACK[11] = {1, 3, 5, 8, 10, 13, 15, 17, 20, 22, 25};
static const uint8_t TRK_BTN[NT] = {HB_ARP, HB_ENV, HB_SEQ, HB_LFO};
static const float PAN[NT] = {0.0f, -0.35f, 0.4f, -0.15f};

static struct {
    uint32_t home_seen, live_seen[NT];
    vox_t v[NT];
    vox_k_t kk[NT];
    float lock[NT];                      /* the destination's value this step (a lock, else the base) */
    uint8_t locked[NT];
    float phase;
    float lfo_ph[NT], rat_ph[NT], vel_gain[NT];
    float ph[NT];                        /* each track's step clock */
    uint32_t pend[NT];                   /* a nudged trig: samples until it plays */
    float pend_gain[NT];
    pink_t breath;
    uint32_t breath_n;
} st;

static float vp_clamp(int d, float x) { return m_clamp(x, VP_LO[d], VP_HI[d]); }

static void trk_kind(trk_t *T, int kind)
{
    int d;
    T->kind = (uint8_t)kind;
    for (d = 0; d < NVP; d++)
        T->p[d] = VB_POINT[kind][d];
}

static void trk_clear(trk_t *T)
{
    int s;
    for (s = 0; s < NS; s++) {
        T->trig[s] = T->has[s] = T->cond[s] = 0;
        T->nudge[s] = 0;
        T->val[s] = T->p[T->dest];
    }
}

static void trk_reset(trk_t *T, int kind, uint8_t dest, uint8_t len, float density)
{
    trk_kind(T, kind);
    T->on = 1;
    T->dest = dest;
    T->len = len;
    T->lfo_depth = 0.0f;
    T->density = density;
    T->rate_i = RATE_ONE;
    T->tone = 0.0f;
    T->dec_x = 1.0f;
    T->tmom = 1;
    trk_clear(T);
    T->loops = 0;
    T->last_true = 1;
    T->momentum = 1.0f;
    T->flash_step = -1;
}

static void defaults(void)
{
    trk_reset(&sh.t[0], VB_KICK, VP_DEC, 16, 0.19f);
    sh.t[0].trig[0] = 1;                 /* one kick on the first step: the simplest place */
    trk_reset(&sh.t[1], VB_SNARE, VP_NOISE, 12, 0.12f);
    trk_reset(&sh.t[2], VB_HAT, VP_DEC, 7, 0.2f);
    trk_reset(&sh.t[3], VB_SYNTH, VP_INDEX, 5, 0.15f);
    sh.tempo = 112.0f;
    sh.mut = 0.15f;
    sh.time = 0.2f;
    sh.tempo_w = 1.0f;
    sh.frozen = 0;
}

/* the tracks follow their slots (EDIT's voice page, ALGO): a new kind puts the track's numbers at that kind's place;
 * an empty slot falls back to slot 1, so one source can play all four tracks */
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
    int k;
    defaults();
    for (k = 0; k < NT; k++) {           /* the sources stay as chosen */
        const mz_slot_t *v = mz_voice(k);
        if (v)
            trk_kind(&sh.t[k], v->src - 1);
    }
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
        st.lfo_ph[k] = st.rat_ph[k] = 0.0f;
        st.vel_gain[k] = 1.0f;
        st.live_seen[k] = sh.live_req[k];
        st.ph[k] = 0.999f;
        st.pend[k] = 0;
    }
    st.phase = 0.999f;
}

/* ---- conditions, steps, change ---- */
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

static int trig_count(const trk_t *T)
{
    int s, n = 0;
    for (s = 0; s < T->len; s++)
        n += T->trig[s];
    return n;
}

/* a step of the track with (want 1) or without (want 0) a trig, from a random place; -1 none */
static int pick(const trk_t *T, int want)
{
    int s = (int)(m_rnd(&sh.seed) * (float)T->len) % T->len, tries;
    for (tries = 0; tries < T->len; tries++, s = (s + 1) % T->len)
        if (T->trig[s] == want)
            return s;
    return -1;
}

static void mutate(int k)
{
    trk_t *T = &sh.t[k];
    float range = VP_HI[T->dest] - VP_LO[T->dest], r = m_rnd(&sh.seed);
    int n = trig_count(T), target = (int)(T->density * (float)T->len + 0.5f), s = -1;
    if (n < target) {                    /* below its density: a trig (and maybe a lock) where there was none */
        s = pick(T, 0);
        if (s >= 0) {
            T->trig[s] = 1;
            if (m_rnd(&sh.seed) < 0.5f) {
                T->has[s] = 1;
                T->val[s] = vp_clamp(T->dest, T->p[T->dest] + T->momentum * range * (0.05f + 0.2f * m_rnd(&sh.seed)));
            }
            T->cond[s] = (uint8_t)(m_rnd(&sh.seed) < 0.55f ? 0 : 1 + (int)(m_rnd(&sh.seed) * (float)(NCOND - 1)));
        }
    } else if (n > target) {             /* above it: one goes */
        s = pick(T, 1);
        if (s >= 0)
            T->trig[s] = T->has[s] = 0;
    } else if (r < 0.45f && n) {         /* at it: a lock moves on, with momentum; a wall turns it */
        s = pick(T, 1);
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
    } else if (r < 0.65f && n) {         /* a trig slides to a free neighbour, its lock and condition with it */
        s = pick(T, 1);
        if (s >= 0) {
            int d = (m_rnd(&sh.seed) < 0.5f ? 1 : T->len - 1), t = (s + d) % T->len;
            if (!T->trig[t]) {
                T->trig[t] = 1;
                T->has[t] = T->has[s];
                T->val[t] = T->val[s];
                T->cond[t] = T->cond[s];
                T->trig[s] = T->has[s] = 0;
                s = t;
            }
        }
    } else if (r < 0.9f && n) {          /* a condition shifts to a neighbour */
        s = pick(T, 1);
        if (s >= 0)
            T->cond[s] = (uint8_t)((T->cond[s] + (m_rnd(&sh.seed) < 0.5f ? 1 : NCOND - 1)) % NCOND);
    } else {                             /* the destination moves to another number (its locks keep their place) */
        static const uint8_t DESTS[] = {VP_PITCH, VP_SWEEP, VP_RATIO, VP_INDEX, VP_IDEC, VP_FB, VP_NOISE, VP_METAL,
                                        VP_DEC, VP_XMOD};
        int d = DESTS[(int)(m_rnd(&sh.seed) * 10.0f) % 10], i;
        for (i = 0; i < NS; i++)
            T->val[i] = vp_clamp(d, T->p[d] + (T->val[i] - T->p[T->dest]) / range * (VP_HI[d] - VP_LO[d]));
        T->dest = (uint8_t)d;
    }
    T->flash_step = (int8_t)(s < 0 ? 0 : s);
    T->flash_until = hw_ms() + 600u;
    sh.plot_rev++;
}

/* TIME: the time changes, one thing at a time, never undone: a nudge grows or shrinks (with momentum: a lean that keeps
 * leaning until a wall), the track's length or its rate moves to a neighbour */
static void time_mutate(int k)
{
    trk_t *T = &sh.t[k];
    float r = m_rnd(&sh.seed);
    int s;
    if (r < 0.6f && (s = pick(T, 1)) >= 0) {
        int nv = T->nudge[s] + T->tmom * (1 + (int)(m_rnd(&sh.seed) * 2.0f));
        if (nv > 10 || nv < 0) {
            T->tmom = (int8_t)-T->tmom;
            nv = nv > 10 ? 10 : 0;
        }
        T->nudge[s] = (uint8_t)nv;
        T->flash_step = (int8_t)s;
        T->flash_until = hw_ms() + 600u;
    } else if (r < 0.82f) {
        T->len = (uint8_t)m_clampi(T->len + (m_rnd(&sh.seed) < 0.5f ? 1 : -1), 2, NS);
    } else {
        T->rate_i = (uint8_t)m_clampi(T->rate_i + (m_rnd(&sh.seed) < 0.5f ? 1 : -1), 0, NRATE - 1);
    }
    sh.plot_rev++;
}

/* one step of track k (its own clock: the tempo times its rate) */
static void step_one(int k, int dir, float samples_per_step)
{
    trk_t *T = &sh.t[k];
    int p = sh.pos[k] + dir;
    if (p >= T->len || p < 0) {
        float per_step = (float)T->len / 16.0f;   /* per step, so a short track is not changed more often */
        p = p < 0 ? T->len - 1 : 0;
        T->loops++;
        if (!sh.frozen && m_rnd(&sh.seed) < m_min(1.0f, (sh.mut + 0.5f * sh.energy) * per_step))
            mutate(k);
        if (!sh.frozen && m_rnd(&sh.seed) < m_min(1.0f, sh.time * 0.6f * per_step))
            time_mutate(k);
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
        if (T->trig[p] && T->on) {
            if (T->nudge[p]) {           /* late by a fraction of its own step */
                st.pend[k] = 1u + (uint32_t)((float)T->nudge[p] * (1.0f / 16.0f) * samples_per_step);
                st.pend_gain[k] = 1.0f;
            } else {
                st.vel_gain[k] = 1.0f;
                vox_trig(&st.v[k], &st.kk[k]);
            }
        }
    }
    sh.plot_rev++;
}

/* the voices' numbers now: the bases, this step's locks, the LFOs, the slot's settings, the hand's brightness */
static void coefs(float steps_per_s, uint32_t n, float *lvl)
{
    int k, d;
    for (k = 0; k < NT; k++) {
        trk_t *T = &sh.t[k];
        const mz_slot_t *v = mz_voice(k);
        float p[NVP], per = (float)T->len * 3.0f / m_max(0.25f, m_abs(steps_per_s));
        for (d = 0; d < NVP; d++)
            p[d] = T->p[d];
        if (st.locked[k])
            p[T->dest] = st.lock[k];
        st.lfo_ph[k] += (float)n * M_INV_SR / per;
        st.lfo_ph[k] -= m_floor(st.lfo_ph[k]);
        p[T->dest] = vp_clamp(T->dest, p[T->dest] + T->lfo_depth * (VP_HI[T->dest] - VP_LO[T->dest])
                                                    * m_sin_t(st.lfo_ph[k]));
        if (v) {
            p[VP_PITCH] = vp_clamp(VP_PITCH, p[VP_PITCH] * m_exp2(v->tune));
            p[VP_INDEX] = vp_clamp(VP_INDEX, p[VP_INDEX] + v->bright);
            p[VP_FB] = vp_clamp(VP_FB, p[VP_FB] + v->fb);
            if (p[VP_DEC] < VP_HELD)
                p[VP_DEC] = vp_clamp(VP_DEC, p[VP_DEC] * v->dec_x);
        }
        p[VP_INDEX] = vp_clamp(VP_INDEX, p[VP_INDEX] + sh.live_bright[k] + T->tone);
        if (p[VP_DEC] < VP_HELD)
            p[VP_DEC] = vp_clamp(VP_DEC, p[VP_DEC] * T->dec_x);
        vox_gate(p, 4.0f * T->dec_x / m_max(0.25f, m_abs(steps_per_s) * RATES[T->rate_i]));   /* four of its steps */
        vox_coefs(&st.kk[k], p);
        lvl[k] = VB_LEVEL[T->kind] * (v ? m_db2lin(v->level_db) : 1.0f);
    }
}

void pj_render(float *out_l, float *out_r, const float *inl, const float *inr, uint32_t n)
{
    uint32_t i;
    int k;
    float steps_per_s, dstep, lvl[NT];
    (void)inl, (void)inr;
    if (sh.home_req != st.home_seen) {
        st.home_seen = sh.home_req;
        pj_reset_audio();
    }
    if (++st.breath_n >= 86u) {          /* the tempo's breath: 1/f, about four new values a second */
        st.breath_n = 0;
        sh.tempo_w += ((1.0f + sh.time * 0.07f * pink_next(&st.breath, &sh.seed)) - sh.tempo_w) * 0.3f;
    }
    steps_per_s = sh.tempo * sh.tempo_w * (4.0f / 60.0f);
    dstep = m_abs(steps_per_s) * M_INV_SR;
    coefs(steps_per_s, n, lvl);
    for (k = 0; k < NT; k++)             /* the hand's strikes (black keys 1-4) */
        if (sh.live_req[k] != st.live_seen[k]) {
            st.live_seen[k] = sh.live_req[k];
            st.vel_gain[k] = 0.25f + sh.live_vel[k];
            vox_trig(&st.v[k], &st.kk[k]);
        }
    for (i = 0; i < n; i++) {
        float l = 0.0f, r = 0.0f, prev;
        int stepped = 0;
        for (k = 0; k < NT; k++) {       /* each track on its own clock */
            float rate = RATES[sh.t[k].rate_i];
            st.ph[k] += dstep * rate;
            if (st.ph[k] >= 1.0f) {
                st.ph[k] -= 1.0f;
                step_one(k, steps_per_s < 0.0f ? -1 : 1, M_SR / m_max(0.05f, m_abs(steps_per_s) * rate));
                stepped = 1;
            }
            if (st.pend[k] && --st.pend[k] == 0u) {   /* a nudged trig, now */
                st.vel_gain[k] = st.pend_gain[k];
                vox_trig(&st.v[k], &st.kk[k]);
            }
        }
        if (stepped)
            coefs(steps_per_s, 0, lvl);
        for (k = 0; k < NT; k++)         /* the hand's repeats (black keys 6-9) */
            if (sh.ratchet_hz[k] > 0.0f) {
                st.rat_ph[k] += sh.ratchet_hz[k] * M_INV_SR;
                if (st.rat_ph[k] >= 1.0f) {
                    st.rat_ph[k] -= 1.0f;
                    st.vel_gain[k] = 0.8f;
                    vox_trig(&st.v[k], &st.kk[k]);
                }
            } else {
                st.rat_ph[k] = 1.0f;     /* (the next press strikes at once) */
            }
        prev = st.v[NT - 1].y;
        for (k = 0; k < NT; k++) {
            float y = vox_run(&st.v[k], &st.kk[k], prev);
            prev = y;
            y *= lvl[k] * st.vel_gain[k];
            l += y * (1.0f - PAN[k]);
            r += y * (1.0f + PAN[k]);
        }
        out_l[i] = l * 0.5f;
        out_r[i] = r * 0.5f;
    }
}

/* ---- the hand ---- */
static void thin(trk_t *T)
{
    int s, n = trig_count(T), drop = (n + 1) / 2;
    while (drop-- > 0 && (s = pick(T, 1)) >= 0)
        T->trig[s] = T->has[s] = 0;
}

void pj_control(const mz_in_t *in, const mz_body_t *b)
{
    trk_t *T;
    int i;
    follow_slots();
    sh.energy = b->energy;
    T = &sh.t[ui.trk];
    /* white keys: the steps of the selected track */
    for (i = 0; i < 16; i++) {
        uint32_t bit = 1u << WHITE[i];
        if (in->down & bit) {
            ui.held_step = i;
            ui.held_t = in->ms;
            ui.held_pressed = 0;
        }
        if ((in->keys & bit) && ui.held_step == i && WHITE[i] < HW_NPRESS && in->prs[WHITE[i]] > 20 && i < T->len) {
            float p = (float)in->prs[WHITE[i]] * (1.0f / 127.0f);
            T->has[i] = 1;
            T->val[i] = T->p[T->dest] + (VP_HI[T->dest] - T->p[T->dest]) * p;
            ui.held_pressed = 1;
            sh.plot_rev++;
        }
        if ((in->up & bit) && ui.held_step == i) {
            if (!ui.held_pressed && in->ms - ui.held_t < 350u && i < T->len) {
                T->trig[i] = (uint8_t)!T->trig[i];
                if (!T->trig[i])
                    T->has[i] = 0;
                mz_say(T->trig[i] ? "TRIG" : "NO TRIG", VB_NAME[T->kind]);
            }
            ui.held_step = -1;
            sh.plot_rev++;
        }
    }
    /* black keys: 1-4 play, 5 fill, 6-9 repeat, 10 LFO, 11 XMOD */
    for (i = 0; i < NT; i++) {
        int key = BLACK[i], rk = BLACK[5 + i];
        if (in->down >> key & 1u) {
            sh.live_vel[i] = (float)in->vel[key] * (1.0f / 127.0f);
            sh.live_req[i]++;
        }
        sh.live_bright[i] = (in->keys >> key & 1u) ? (float)in->prs[key] * (6.0f / 127.0f) : 0.0f;
        if (in->keys >> rk & 1u) {
            float p = rk < HW_NPRESS ? (float)in->prs[rk] * (1.0f / 127.0f) : 0.0f;
            sh.ratchet_hz[i] = 4.0f + 24.0f * p;
        } else {
            sh.ratchet_hz[i] = 0.0f;
        }
    }
    sh.fill_held = (uint8_t)(((in->keys >> BLACK[4]) & 1u) | ((in->btn >> HB_FX) & 1u));
    if (in->down >> BLACK[9] & 1u) {
        T->lfo_depth = T->lfo_depth >= 0.39f ? 0.0f : T->lfo_depth < 0.04f ? 0.05f : T->lfo_depth < 0.14f ? 0.15f : 0.4f;
        mz_say("LFO", T->lfo_depth == 0.0f ? "OFF" : T->lfo_depth < 0.1f ? "5%" : T->lfo_depth < 0.2f ? "15%" : "40%");
    }
    if (in->down >> BLACK[10] & 1u) {
        T->p[VP_XMOD] = T->p[VP_XMOD] > 0.0f ? 0.0f : 2.5f;
        mz_say("XMOD", T->p[VP_XMOD] > 0.0f ? "FROM ABOVE" : "OFF");
    }
    /* buttons */
    for (i = 0; i < NT; i++)
        if (in->bdown & (1u << TRK_BTN[i])) {
            sh.t[i].on = (uint8_t)!sh.t[i].on;
            mz_say(VB_NAME[sh.t[i].kind], sh.t[i].on ? "IN" : "OUT");
            sh.plot_rev++;
        }
    if (in->bdown & (1u << HB_SEL)) {
        ui.sel_t = in->ms;
        ui.sel_done = 0;
    }
    if ((in->btn & (1u << HB_SEL)) && !ui.sel_done && in->ms - ui.sel_t >= 700u) {
        ui.sel_done = 1;
        trk_clear(T);
        mz_say("CLEAR", VB_NAME[T->kind]);
        sh.plot_rev++;
    }
    if ((in->bup & (1u << HB_SEL)) && !ui.sel_done) {
        thin(T);
        mz_say("THIN", VB_NAME[T->kind]);
        sh.plot_rev++;
    }
    if (in->bdown & (1u << HB_SAVE)) {
        ui.save_t = in->ms;
        ui.save_done = 0;
    }
    if ((in->btn & (1u << HB_SAVE)) && !ui.save_done && in->ms - ui.save_t >= 700u) {
        ui.save_done = 1;
        if (sh.has_snap) {
            for (i = 0; i < NT; i++)
                sh.t[i] = sh.snap[i];
            sh.tempo = sh.snap_tempo;
            mz_say("BACK", "TO THE KEPT ONE");
        } else {
            mz_say("NOTHING KEPT", "TAP SAVE FIRST");
        }
        sh.plot_rev++;
    }
    if ((in->bup & (1u << HB_SAVE)) && !ui.save_done) {
        for (i = 0; i < NT; i++)
            sh.snap[i] = sh.t[i];
        sh.snap_tempo = sh.tempo;
        sh.has_snap = 1;
        mz_say("KEPT", "HOLD SAVE = BACK");
    }
    if (in->bdown & (1u << HB_GLO)) {
        sh.frozen = (uint8_t)!sh.frozen;
        mz_say(sh.frozen ? "HOLD" : "CHANGING", sh.frozen ? "NO CHANGES" : "");
    }
    if (in->bdown & (1u << HB_OCTDN))
        sh.tempo = m_clamp(sh.tempo - 4.0f, -300.0f, 300.0f);
    if (in->bdown & (1u << HB_OCTUP))
        sh.tempo = m_clamp(sh.tempo + 4.0f, -300.0f, 300.0f);
    /* encoders: at once on the track; with a step key held, on the step */
    if (in->enc[HE_SELECT]) {
        ui.trk = ((ui.trk + in->enc[HE_SELECT]) % NT + NT) % NT;
        ui.hot[0] = in->ms + 400u;
        sh.plot_rev++;
    }
    T = &sh.t[ui.trk];
    if (in->enc[HE_ALGO]) {              /* TIME: how much the time itself changes */
        sh.time = m_clamp(sh.time + (float)in->enc[HE_ALGO] * 0.02f, 0.0f, 1.0f);
        ui.hot[1] = in->ms + 400u;
    }
    {
        int hs = ui.held_step >= 0 && ui.held_step < T->len ? ui.held_step : -1;
        if (in->enc[HE_PRESET]) {
            if (hs >= 0) {               /* the lock's destination */
                int d = ((T->dest + in->enc[HE_PRESET]) % NVP + NVP) % NVP;
                for (i = 0; i < NS; i++)
                    T->val[i] = vp_clamp(d, T->p[d] + (T->val[i] - T->p[T->dest]) / (VP_HI[T->dest] - VP_LO[T->dest])
                                                       * (VP_HI[d] - VP_LO[d]));
                T->dest = (uint8_t)d;
                ui.held_pressed = 1;
            } else {                     /* RATE: the track against the tempo */
                T->rate_i = (uint8_t)m_clampi(T->rate_i + in->enc[HE_PRESET], 0, NRATE - 1);
            }
            ui.hot[2] = in->ms + 400u;
            sh.plot_rev++;
        }
        if (in->enc[HE_K1]) {
            float det = (float)in->enc[HE_K1] * par_accel(b->speed[HE_K1]);
            if (hs >= 0) {               /* the lock */
                int d = T->dest;
                T->has[hs] = 1;
                if (VP_LOGSTEP[d])
                    T->val[hs] = vp_clamp(d, T->val[hs] * m_exp2(det * (1.0f / 24.0f)));
                else
                    T->val[hs] = vp_clamp(d, T->val[hs] + det * (VP_HI[d] - VP_LO[d]) * 0.005f);
                ui.held_pressed = 1;
            } else {                     /* TONE */
                T->tone = m_clamp(T->tone + det * 0.1f, -12.0f, 12.0f);
            }
            ui.hot[3] = in->ms + 400u;
            sh.plot_rev++;
        }
        if (in->enc[HE_K2]) {
            if (hs >= 0) {               /* the condition */
                T->cond[hs] = (uint8_t)(((T->cond[hs] + in->enc[HE_K2]) % NCOND + NCOND) % NCOND);
                ui.held_pressed = 1;
            } else {                     /* DECAY */
                T->dec_x = m_clamp(T->dec_x * m_exp2((float)in->enc[HE_K2] * (1.0f / 8.0f)), 0.05f, 16.0f);
            }
            ui.hot[4] = in->ms + 400u;
            sh.plot_rev++;
        }
        if (in->enc[HE_K3]) {
            if (hs >= 0) {               /* the nudge */
                T->nudge[hs] = (uint8_t)m_clampi(T->nudge[hs] + in->enc[HE_K3], 0, 10);
                T->trig[hs] = 1;
                ui.held_pressed = 1;
            } else {                     /* DENSITY */
                T->density = m_clamp(T->density + (float)in->enc[HE_K3] * 0.02f, 0.0f, 1.0f);
            }
            ui.hot[5] = in->ms + 400u;
            sh.plot_rev++;
        }
        if (in->enc[HE_K4]) {
            if (hs >= 0) {               /* the track's length */
                T->len = (uint8_t)m_clampi(T->len + in->enc[HE_K4], 1, NS);
                ui.held_pressed = 1;
            } else {                     /* MUT */
                sh.mut = m_clamp(sh.mut + (float)in->enc[HE_K4] * 0.01f, 0.0f, 1.0f);
            }
            ui.hot[6] = in->ms + 400u;
            sh.plot_rev++;
        }
    }
    /* the body */
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
    r->hot = now < ui.hot[i] || (hs >= 0 && i >= 2);
    switch (i) {
    case 0:
        mz_cat(r->label, "TRACK");
        mz_int(r->value, ui.trk + 1);
        mz_cat(r->value, " ");
        mz_cat(r->value, VB_NAME[T->kind]);
        if (hs >= 0) {
            mz_cat(r->value, " S");
            mz_int(r->value, hs + 1);
        }
        mz_cat(r->value, T->on ? "" : " OUT");
        r->alert = !T->on;
        break;
    case 1:
        mz_cat(r->label, "TIME");
        mz_fix(r->value, sh.time, 2);
        mz_cat(r->value, " T");
        mz_fix(r->value, sh.tempo * sh.tempo_w, 1);
        break;
    case 2:
        if (hs >= 0) {
            mz_cat(r->label, "DEST");
            mz_cat(r->value, VP_NAME[d]);
        } else {
            mz_cat(r->label, "RATE");
            mz_cat(r->value, "X");
            mz_cat(r->value, RATE_NAME[T->rate_i]);
        }
        break;
    case 3:
        if (hs >= 0) {
            mz_cat(r->label, "LOCK");
            mz_fix(r->value, T->has[hs] ? T->val[hs] : T->p[d], VP_DECIMALS[d]);
            mz_cat(r->value, " ");
            mz_cat(r->value, VP_UNIT[d]);
        } else {
            mz_cat(r->label, "TONE");
            if (T->tone >= 0.0f)
                mz_cat(r->value, "+");
            mz_fix(r->value, T->tone, 1);
        }
        break;
    case 4:
        if (hs >= 0) {
            mz_cat(r->label, "COND");
            mz_cat(r->value, COND[T->cond[hs]].name);
        } else {
            mz_cat(r->label, "DECAY");
            mz_cat(r->value, "X");
            mz_fix(r->value, T->dec_x, 2);
        }
        break;
    case 5:
        if (hs >= 0) {
            mz_cat(r->label, "NUDGE");
            mz_int(r->value, T->nudge[hs]);
            mz_cat(r->value, "/16 LATE");
        } else {
            mz_cat(r->label, "DENS");
            mz_int(r->value, (int32_t)(T->density * 100.0f + 0.5f));
            mz_cat(r->value, "% ");
            mz_int(r->value, trig_count(T));
            mz_cat(r->value, "/");
            mz_int(r->value, T->len);
        }
        break;
    case 6:
        if (hs >= 0) {
            mz_cat(r->label, "LEN");
            mz_int(r->value, T->len);
            mz_cat(r->value, " STEPS");
        } else {
            mz_cat(r->label, "MUT");
            mz_fix(r->value, sh.mut, 2);
            if (sh.frozen) {
                mz_cat(r->value, " HOLD");
                r->alert = 1;
            } else {
                mz_cat(r->value, " +");
                mz_fix(r->value, 0.5f * sh.energy, 2);
            }
        }
        break;
    }
}

void pj_status(char *s)
{
    mz_fix(s, sh.tempo, 0);
    mz_cat(s, " BPM");
    if (sh.frozen)
        mz_cat(s, " HOLD");
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
        char sh3[4] = {VB_NAME[T->kind][0], VB_NAME[T->kind][1], VB_NAME[T->kind][2], 0};
        scr_text(0, y + 4, 1, sh3, !T->on ? C_DIMC : k == ui.trk ? C_HOT : C_LAB);
        for (s = 0; s < T->len; s++) {
            int x = 20 + s * 12;
            uint16_t frame = s == sh.pos[k] ? C_HOT : C_RULE;
            int flash = T->flash_step == s && now < T->flash_until;
            scr_rect(x, y, 11, 14, frame);
            if (T->trig[s])                  /* late steps drawn late: the lean shows */
                hw_fill(x + 2 + T->nudge[s] * 5 / 10, y + 2, 7 - T->nudge[s] * 5 / 10, 5,
                        flash ? C_HOT : !T->on ? C_DIMC : COND[T->cond[s]].type == C_ALW ? C_VAL : C_CYN);
            if (T->has[s]) {
                int hh = 1 + (int)(5.0f * m_clamp((T->val[s] - lo) / span, 0.0f, 1.0f));
                hw_fill(x + 2, y + 13 - hh, 7, hh, flash ? C_HOT : C_GRN);
            }
        }
        if (T->rate_i != RATE_ONE)
            scr_text(240 - scr_text_w(1, RATE_NAME[T->rate_i]), y + 4, 1, RATE_NAME[T->rate_i], C_CYN);
        else if (T->p[VP_XMOD] > 0.0f)
            scr_text(234, y + 4, 1, "&", C_CYN);
    }
}

uint32_t pj_lit_keys(void)
{
    trk_t *T = &sh.t[ui.trk];
    uint32_t m = 1u << BLACK[ui.trk];   /* the selected track's play key */
    int s;
    for (s = 0; s < T->len && s < 16; s++)
        if (T->trig[s])
            m |= 1u << WHITE[s];
    if (sh.pos[ui.trk] >= 0 && sh.pos[ui.trk] < 16)
        m |= 1u << WHITE[sh.pos[ui.trk]];
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

uint32_t pj_lit_buttons(void)
{
    uint32_t m = 0;
    int k;
    for (k = 0; k < NT; k++)
        if (sh.t[k].on)
            m |= 1u << TRK_BTN[k];
    if (!sh.frozen)
        m |= 1u << HB_GLO;
    if (sh.has_snap)
        m |= 1u << HB_SAVE;
    if (sh.fill_held)
        m |= 1u << HB_FX;
    return m;
}

uint32_t pj_dim_buttons(void)
{
    return (1u << HB_FX) | (1u << HB_SEL) | (1u << HB_SAVE) | (1u << HB_GLO) | (1u << HB_ARP) | (1u << HB_ENV) |
           (1u << HB_SEQ) | (1u << HB_LFO) | (1u << HB_OCTDN) | (1u << HB_OCTUP);
}
