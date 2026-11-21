/*
 * 団地 DANCHI — core implementation. See danchi.h.
 *
 * Signal path
 *   voices (copies of one FM object) -> per-track bus
 *     -> distance (2-pole lowpass, level) -> pan -> dry
 *     -> room send (6 rooms: two combs + slap, each with its own habit)
 *     -> echo send (ping-pong, diffused, tempo-synced)
 *   -> density compensation -> limiter -> out
 *
 * Time
 *   Each bar is planned ~2 steps before it starts. Copies are processed in
 *   time order; a copy whose corridor neighbour is still sounding a note that
 *   was stretched across a beat line is pushed: it enters early (lean > 0) or
 *   waits (lean < 0). What it took is a debt, returned later by delaying
 *   (repay). Nothing here is random jitter: every offset has a cause.
 *
 * Change of change
 *   After each bar the system listens (contours, density, flams, interference,
 *   stereo merge, early/late against the keeper's grid), compares with the
 *   wanted state, and a population of 8 operators competes: operators whose
 *   changes moved the sound toward the wanted state gain energy, the others
 *   fade, die and are replaced by a varied child of the strongest.
 */
#include "danchi.h"
#include "dn_math.h"

#define INV2PI 0.15915494f


const char *const dn_op_code[DN_OP_KINDS] = { "SWING", "STRCH", "ANTIC", "YIELD", "REPAY",
                                               "ROOM", "FAR", "STACK", "THIN", "PAN" };
const char *const dn_room_code[DN_ROOMS] = { "WASHI", "YOSHI", "DAIDO", "FURO", "OSHII", "KAIDA" };
const char *const dn_phase_code[DN_PHASES] = { "KOTAI", "GYORETSU", "KATAMARI", "AKIBEYA" };

/* rooms of a 2DK unit: comb A (ms), comb B (ms), feedback A, B, damping, slap (ms), slap gain, wet */
typedef struct { float dA, dB, gA, gB, damp, slap, slapg, wet; } dn_roomdef;
static const dn_roomdef ROOMDEF[DN_ROOMS] = {
    {  7.1f,  9.3f, 0.50f, 0.46f, 0.45f, 11.0f, 0.25f, 0.70f },  /* 和室 tatami: soft      */
    {  5.3f,  6.9f, 0.62f, 0.58f, 0.25f, 14.0f, 0.30f, 0.80f },  /* 洋室                    */
    {  3.1f,  4.4f, 0.72f, 0.70f, 0.08f,  9.0f, 0.35f, 0.80f },  /* 台所 tiles: bright      */
    {  2.3f,  3.7f, 0.88f, 0.86f, 0.04f,  6.0f, 0.40f, 0.75f },  /* 浴室 bath: rings        */
    {  1.2f,  1.9f, 0.32f, 0.30f, 0.65f,  3.0f, 0.10f, 0.50f },  /* 押入れ closet: dead     */
    { 17.0f, 21.7f, 0.70f, 0.68f, 0.22f, 23.0f, 0.45f, 0.80f },  /* 階段室 stairwell        */
};

/* phase tilt of the wanted state (erase, push) */
static const float TILT[DN_PHASES][2] = { { -0.30f, -0.10f }, { 0.00f, 0.30f }, { 0.35f, 0.00f }, { -0.40f, -0.25f } };
static const float PTRANS[DN_PHASES][DN_PHASES] = {
    { 0.00f, 0.45f, 0.35f, 0.20f },
    { 0.30f, 0.00f, 0.50f, 0.20f },
    { 0.30f, 0.20f, 0.00f, 0.50f },
    { 0.60f, 0.30f, 0.10f, 0.00f } };
static const float KEEP_P[DN_PHASES] = { 0.95f, 0.90f, 0.50f, 0.60f };
static const uint8_t PERIODS[6] = { 2, 3, 4, 6, 8, 12 };
/* each unit's own cycle when units have their own cycles: 16 + this x the knob (12..20 steps) */
static const int8_t POLYOFF[DN_TRACKS] = { 0, -1, 2, -3, 1, -2, 3, -4, 4, -1, 2, -3, 1, -2, 3, -4 };
static const float RATCHET_STEP[4] = { 0.5f, 0.33333334f, 0.25f, 0.16666667f };
static const int GEN_BARS[5] = { 1, 2, 4, 8, 16 };
/* effect values -> settings */
static const float FX_DELAY_STEPS[6] = { 0.5f, 0.75f, 1.0f, 1.5f, 2.0f, 3.0f };
static const float FX_SEMI[8] = { -12.0f, -7.0f, -5.0f, -3.0f, 3.0f, 5.0f, 7.0f, 12.0f };
static const float FX_STUT[4] = { 1.0f, 0.5f, 0.25f, 0.125f };
static int fx_idx(float v, int n) { int i = (int)(v * (float)n); return i >= n ? n - 1 : (i < 0 ? 0 : i); }
static const float RATIOS[12] = { 0.5f, 1.0f, 1.0f, 1.4142136f, 1.5f, 2.0f, 2.4142137f,
                                  2.7182818f, 3.0f, 3.5f, 4.0f, 5.1961524f };

/* ------------------------------------------------------------------ rng */
static uint32_t rnd_u(uint32_t *r) {
    uint32_t x = *r;
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    *r = x ? x : 0x6d2b79f5u;
    return *r;
}
static float rnd(dn_state *s) { return (float)(rnd_u(&s->rng) >> 8) * (1.0f / 16777216.0f); }
static int rndi(dn_state *s, int n) { return (int)(rnd_u(&s->rng) % (uint32_t)n); }
static float gauss(dn_state *s) { return (rnd(s) + rnd(s) + rnd(s) + rnd(s) - 2.0f) * 1.7320508f; }

static void zero_bytes(void *p, size_t n) { uint8_t *b = (uint8_t *)p; while (n--) *b++ = 0; }

/* an effect's value on a unit, if the layer is on and the effect is checked (never on the caretaker) */
static float fxval(const dn_state *s, int f, int k) {
    if (!s->fx_layer || !((s->fx_mask >> f) & 1u) || s->tr[k].keeper) return 0.0f;
    return s->fxv[f][k];
}
/* the dice: for each checked effect (or the one given), every unit gets it or not, and a value */
static void fx_roll(dn_state *s, int only) {
    for (int f = 0; f < DN_FX; f++) {
        if (only >= 0 ? f != only : !((s->fx_mask >> f) & 1u)) continue;
        for (int k = 0; k < DN_TRACKS; k++) {
            float u = (float)(rnd_u(&s->fx_rng) >> 8) * (1.0f / 16777216.0f);
            float w = (float)(rnd_u(&s->fx_rng) >> 8) * (1.0f / 16777216.0f);
            s->fxv[f][k] = (s->tr[k].keeper || u < 0.45f) ? 0.0f : 0.1f + 0.9f * w;
        }
    }
    s->fx_rolls++;
}
void dn_fx_set(dn_state *s, int f, int k, float v) {
    if (f < 0 || f >= DN_FX || k < 0 || k >= DN_TRACKS) return;
    s->fxv[f][k] = dn_clamp01(v);
}

/* ------------------------------------------------------------------ object */
static void obj_make(dn_obj *o, uint32_t seed) {
    uint32_t r = seed * 2654435761u + 0x9E3779B9u;
    if (!r) r = 1;
    for (int i = 0; i < 4; i++) rnd_u(&r);
#define OU() ((float)(rnd_u(&r) >> 8) * (1.0f / 16777216.0f))
    o->seed = seed;
    o->f0 = dn_exp2(6.52f + OU() * 2.2f);           /* ~92 .. 420 Hz, not on any scale */
    o->ratio = RATIOS[rnd_u(&r) % 12u];
    o->i0 = 1.2f + OU() * 4.5f;
    o->is = o->i0 * (0.06f + 0.30f * OU());
    float u = OU();
    o->ti = 0.015f + u * u * 0.35f;
    o->att = 0.0008f + OU() * 0.005f;
    u = OU();
    o->dec = 0.05f + u * u * 0.5f;
    o->sus = 0.16f + 0.30f * OU();
    o->rel = 0.05f + 0.22f * OU();
    o->fb = OU() < 0.45f ? 0.0f : OU() * 0.45f;
    /* lower objects sound quieter; a mild tilt keeps them comparable */
    o->gain = 0.26f * (1.0f + 0.35f * (1.0f - (dn_log2(o->f0) - 6.52f) / 2.2f));
#undef OU
}

float dn_tempo_bpm(const dn_state *s) { return 40.0f + 140.0f * s->keff[DN_K_TEMPO]; }
/* volume knob -> dB: 0.85 is exactly 0 dB; below it down to -60 dB, above it up to +3 dB */
float dn_vol_db(float v) {
    if (v < 0.005f) return -99.0f;
    return v <= 0.85f ? 60.0f * (v - 0.85f) / 0.85f : 3.0f * (v - 0.85f) / 0.15f;
}
static float vol_gain(float v) {
    float db = dn_vol_db(v);
    return db <= -99.0f ? 0.0f : dn_exp2(db * (1.0f / 6.0206f));
}
static float step_samples(const dn_state *s) { return s->sr * 15.0f / dn_tempo_bpm(s); }

/* ------------------------------------------------------------------ log */
static void logp(dn_state *s, int type, int kind, int track, float value, uint32_t id) {
    dn_logent *e = &s->log[s->log_n % DN_LOG];
    e->type = (int16_t)type; e->kind = (int16_t)kind; e->track = (int16_t)track;
    e->id = (int16_t)(id & 0x7fff); e->value = value; e->bar = s->bar;
    s->log_n++;
}

/* ------------------------------------------------------------------ tracks */
static int sounding(const dn_state *s, int k) {
    const dn_track *T = &s->tr[k];
    if (T->keeper) return s->keeper_on;
    return T->on && !T->dormant && T->nhit > 0;
}
static int count_sounding(const dn_state *s, int with_keeper) {
    int c = 0;
    for (int k = 0; k < DN_TRACKS; k++)
        if (sounding(s, k) && (with_keeper || !s->tr[k].keeper)) c++;
    return c;
}
static int total_copies(const dn_state *s) {
    int c = 0;
    for (int k = 0; k < DN_TRACKS; k++) {
        const dn_track *T = &s->tr[k];
        if (!T->on) continue;
        for (int h = 0; h < T->nhit; h++) c += T->hit[h].copies;
    }
    return c;
}
static int hit_find(const dn_track *T, int step) {
    for (int h = 0; h < T->nhit; h++) if (T->hit[h].step == step) return h;
    return -1;
}
static int hit_add(dn_track *T, int step, int micro) {
    if (T->nhit >= DN_HITS) return -1;
    dn_hit *H = &T->hit[T->nhit];
    H->step = (uint8_t)(step & 15); H->copies = 1; H->micro = (int8_t)micro;
    H->cause = -1; H->spread = 8.0f; H->off = 0.0f;
    return T->nhit++;
}
static void hit_remove(dn_track *T, int h) {
    for (int i = h; i + 1 < T->nhit; i++) T->hit[i] = T->hit[i + 1];
    if (T->nhit > 0) T->nhit--;
}

static void track_defaults(dn_state *s, int k) {
    dn_track *T = &s->tr[k];
    float lp1 = T->lp1, lp2 = T->lp2, ds = T->ds, ps = T->ps;
    zero_bytes(T, sizeof *T);
    T->lp1 = lp1; T->lp2 = lp2; T->ds = ds; T->ps = ps;
    int col = k & 3, floor_ = k >> 2;
    T->pan = ((float)col - 1.5f) / 1.5f * 0.75f;      /* where the window is on the facade */
    T->dist = 0.10f + 0.12f * (float)floor_;            /* upper floors a little farther    */
    T->room = (uint8_t)rndi(s, DN_ROOMS);
    T->swing = rnd(s) * 0.35f;
    T->stretch = 0.8f + rnd(s) * 1.4f;
    T->lean = -0.3f + rnd(s) * 0.9f;
    T->repay = 0.2f + rnd(s) * 0.5f;
    T->last_op_bar = -999;
}

static void init_tracks(dn_state *s) {
    for (int k = 0; k < DN_TRACKS; k++) track_defaults(s, k);
    dn_track *K = &s->tr[0];                 /* the caretaker: keeps the beat */
    K->keeper = 1; K->on = 1; K->room = 4; K->pan = 0.0f; K->dist = 0.05f;
    K->swing = 0.0f; K->stretch = 0.55f; K->lean = 0.0f; K->repay = 0.0f;
    for (int b = 0; b < 4; b++) hit_add(K, b * 4, 0);
    int nact = 4 + rndi(s, 3);
    for (int k = 1; k < DN_TRACKS; k++) {
        dn_track *T = &s->tr[k];
        if (k > nact) continue;
        T->on = 1;
        int nh = 1 + rndi(s, 3);
        for (int i = 0; i < nh; i++) {
            int st = rndi(s, 16), guard = 0;
            while (hit_find(T, st) >= 0 && guard++ < 16) st = (st + 5) & 15;
            hit_add(T, st, 0);
        }
    }
}

/* ------------------------------------------------------------------ operators */
static int pick_track(dn_state *s, int kind) {
    int cand[DN_TRACKS], n = 0;
    if (kind == DN_OP_STACK && rnd(s) < 0.5f) {
        for (int k = 1; k < DN_TRACKS; k++) if (!s->tr[k].on && s->tr[k].hand != 2) cand[n++] = k;
        if (n) return cand[rndi(s, n)];
    }
    for (int k = 1; k < DN_TRACKS; k++) if (s->tr[k].on && s->tr[k].nhit) cand[n++] = k;
    if (!n) return 1 + rndi(s, DN_TRACKS - 1);
    return cand[rndi(s, n)];
}
static void op_fresh(dn_state *s, dn_op *o, int kind) {
    zero_bytes(o, sizeof *o);
    o->kind = (uint8_t)kind;
    o->track = (uint8_t)pick_track(s, kind);
    o->period = PERIODS[rndi(s, 6)];
    o->phase_off = (uint8_t)rndi(s, o->period);
    o->gene = rnd(s);
    o->energy = 0.6f + 0.2f * rnd(s);
    o->born_bar = s->bar;
    o->act_bar = -999;
    o->id = ++s->op_ids;
}
static void init_ops(dn_state *s) {
    static const uint8_t start[DN_OPS] = { DN_OP_SWING, DN_OP_STRETCH, DN_OP_ANTIC, DN_OP_REPAY,
                                           DN_OP_ROOM, DN_OP_DIST, DN_OP_STACK, DN_OP_THIN };
    for (int i = 0; i < DN_OPS; i++) op_fresh(s, &s->op[i], start[i]);
    s->quiet = 0;
}
static int kind_count(const dn_state *s, int kind, const dn_op *skip) {
    int c = 0;
    for (int i = 0; i < DN_OPS; i++) if (&s->op[i] != skip && s->op[i].kind == kind) c++;
    return c;
}
/* a kind the population lacks (or has least of) */
static int rare_kind(dn_state *s, const dn_op *skip) {
    int best = rndi(s, DN_OP_KINDS), bc = 99, start = rndi(s, DN_OP_KINDS);
    for (int i = 0; i < DN_OP_KINDS; i++) {
        int k = (start + i) % DN_OP_KINDS, c = kind_count(s, k, skip);
        if (c < bc) { bc = c; best = k; }
    }
    return best;
}
static void op_child(dn_state *s, dn_op *c, dn_op *p) {
    dn_op q = *p;
    q.id = ++s->op_ids;
    q.energy = 0.6f; q.age = 0; q.pending = 0; q.wait = 0; q.reward = 0.0f; q.merit = 0.0f; q.acts = 0;
    q.born_bar = s->bar; q.act_bar = -999; q.counter = 0;
    q.gene = dn_clamp01(p->gene + 0.16f * gauss(s));
    float pk = 0.10f + 0.3f * dn_clamp01(1.0f - p->energy);
    if (rnd(s) < pk) q.kind = (uint8_t)rndi(s, DN_OP_KINDS);
    if (kind_count(s, q.kind, c) >= 3) q.kind = (uint8_t)rare_kind(s, c);   /* keep the population varied */
    if (rnd(s) < 0.4f) q.track = (uint8_t)pick_track(s, q.kind);
    if (rnd(s) < 0.3f) q.period = PERIODS[rndi(s, 6)];
    q.phase_off = (uint8_t)rndi(s, q.period);
    if (q.kind != DN_OP_STACK && !(s->tr[q.track].on && s->tr[q.track].nhit)) q.track = (uint8_t)pick_track(s, q.kind);
    p->energy -= 0.1f;
    *c = q;
}

/* move a parameter toward a gene target; returns 1 if it changed audibly */
static int move_to(float *v, float tgt, float minstep) {
    float d = tgt - *v;
    if (dn_abs(d) < 0.02f) return 0;
    float st = d * 0.6f;
    if (dn_abs(st) < minstep) st = d > 0.0f ? dn_min(minstep, d) : dn_max(-minstep, d);
    *v += st;
    return 1;
}

static int apply_op(dn_state *s, dn_op *o) {
    dn_track *T = &s->tr[o->track];
    if (T->keeper) return 0;
    int active = T->on && T->nhit && !T->dormant;
    if (!active && o->kind != DN_OP_STACK) return 0;
    if (T->dormant) return 0;
    float g = o->gene;
    switch (o->kind) {
    case DN_OP_SWING:   return move_to(&T->swing, g, 0.12f);
    case DN_OP_STRETCH: return move_to(&T->stretch, 0.5f + 3.3f * g, 0.5f);
    case DN_OP_ANTIC:   return move_to(&T->lean, g, 0.25f);
    case DN_OP_YIELD:   return move_to(&T->lean, -g, 0.25f);
    case DN_OP_REPAY:   return move_to(&T->repay, g, 0.2f);
    case DN_OP_DIST:    return move_to(&T->dist, g, 0.12f);
    case DN_OP_PAN:     return move_to(&T->pan, g * 2.0f - 1.0f, 0.2f);
    case DN_OP_ROOM: {
        int r = (int)(g * (float)DN_ROOMS);
        if (r >= DN_ROOMS) r = DN_ROOMS - 1;
        if (r == T->room) return 0;
        T->room = (uint8_t)r;
        return 1;
    }
    case DN_OP_STACK: {
        if (total_copies(s) >= 96) return 0;
        float spread = 1.0f + 39.0f * g;        /* <5 ms: comb, 5..40 ms: flam */
        if (!T->on || !T->nhit) {
            if (T->hand == 2 || s->hand_stop) return 0;
            /* someone moves in next to a neighbour */
            int nb = -1;
            for (int d = 1; d < DN_TRACKS && nb < 0; d++) {
                int a = (o->track + d) % DN_TRACKS, b = (o->track + DN_TRACKS - d) % DN_TRACKS;
                if (a && sounding(s, a)) nb = a; else if (b && sounding(s, b)) nb = b;
            }
            int st = nb >= 0 ? s->tr[nb].hit[rndi(s, s->tr[nb].nhit)].step + (rnd(s) < 0.5f ? 1 : -1) : rndi(s, 16);
            T->nhit = 0;
            hit_add(T, st & 15, 0);
            T->hit[0].spread = spread;
            T->on = 1;
            return 1;
        }
        int h = (o->counter++ & 0x7fff) % T->nhit;
        dn_hit *H = &T->hit[h];
        if (H->copies < DN_COPIES) { H->copies++; H->spread = spread; return 1; }
        /* close an interval: a new copy one step beside an existing one */
        for (int tries = 0; tries < 4; tries++) {
            int st = (H->step + (tries & 1 ? -1 : 1) * (1 + tries / 2)) & 15;
            if (hit_find(T, st) < 0) { int nh = hit_add(T, st, 0); if (nh >= 0) { T->hit[nh].spread = spread; return 1; } }
        }
        return 0;
    }
    case DN_OP_THIN: {
        int best = -1;
        if (g < 0.5f) {            /* copies first */
            for (int h = 0; h < T->nhit; h++) if (T->hit[h].copies > 1 && (best < 0 || T->hit[h].copies > T->hit[best].copies)) best = h;
            if (best >= 0) { T->hit[best].copies--; return 1; }
        }
        if (T->nhit > 1) { hit_remove(T, (int)((o->counter++ & 0x7fff) % T->nhit)); return 1; }
        for (int h = 0; h < T->nhit; h++) if (T->hit[h].copies > 1) { T->hit[h].copies--; return 1; }
        if (T->hand == 0 && count_sounding(s, 0) > 2) { T->on = 0; return 1; }   /* moves out */
        return 0;
    }
    }
    return 0;
}

/* the next sounding unit along the corridor (the caretaker is not visited) */
static int next_door(const dn_state *s, int k) {
    for (int d = 1; d < DN_TRACKS; d++) {
        int j = (k + d) % DN_TRACKS;
        if (j && sounding(s, j)) return j;
    }
    return k;
}
/* an operator acts on its unit; if there is nothing left to change there,
 * it walks to the next door and acts there instead */
static int op_act(dn_state *s, dn_op *o) {
    int n = count_sounding(s, 0) + 1;
    for (int i = 0; i < n; i++) {
        if (apply_op(s, o)) {
            if ((o->kind == DN_OP_STACK || o->kind == DN_OP_THIN) && rnd(s) < 0.35f) o->counter |= 0x8000u;  /* walk next time */
            return 1;
        }
        int nx = next_door(s, o->track);
        if (nx == o->track) return 0;
        o->track = (uint8_t)nx;
    }
    return 0;
}

/* ------------------------------------------------------------------ phases */
static void phase_enter(dn_state *s, int ph) {
    s->phase = ph;
    float u = dn_max(rnd(s), 1e-4f);
    float len = 8.0f * dn_exp2(-dn_log2(u) / 1.2f);   /* Pareto, alpha 1.2: mostly short, sometimes very long */
    s->ph_len = s->ph_left = (int)dn_clamp(len, 8.0f, 400.0f);
    if (s->keeper_mode == 0) s->keeper_on = rnd(s) < KEEP_P[ph];
    for (int k = 0; k < DN_TRACKS; k++) s->tr[k].dormant = 0;
    s->vacant_room = -1;
    if (ph == DN_PH_AKIBEYA) {
        int start = rndi(s, DN_ROOMS);
        for (int i = 0; i < DN_ROOMS; i++) {
            int r = (start + i) % DN_ROOMS, inroom = 0;
            for (int k = 1; k < DN_TRACKS; k++) if (sounding(s, k) && s->tr[k].room == r) inroom++;
            if (inroom && count_sounding(s, 0) - inroom >= 2) {
                s->vacant_room = r;
                for (int k = 1; k < DN_TRACKS; k++) if (s->tr[k].room == r && s->tr[k].hand != 1) s->tr[k].dormant = 1;
                break;
            }
        }
    }
    logp(s, DN_LG_PHASE, ph, s->vacant_room, (float)s->ph_len, 0);
}
static void phase_next(dn_state *s) {
    float u = rnd(s), acc = 0.0f;
    int nx = (s->phase + 1) % DN_PHASES;
    for (int j = 0; j < DN_PHASES; j++) {
        acc += PTRANS[s->phase][j];
        if (u < acc) { nx = j; break; }
    }
    phase_enter(s, nx);
}

/* ------------------------------------------------------------------ planning a bar */
static float swing_off(float sw, int step) { return (step & 1) ? 0.44f * sw : 0.0f; }

static void ev_push(dn_state *s, uint32_t t, uint32_t gate, float dev, int32_t devs, int track, int cause, int keeper, float gain) {
    for (int i = 0; i < DN_EVQ; i++) {
        dn_event *e = &s->ev[i];
        if (e->used) continue;
        e->t = t; e->gate = gate; e->dev = dev; e->devs = devs; e->gain = gain; e->track = (uint8_t)track;
        e->cause = (int8_t)cause; e->keeper = (uint8_t)keeper; e->used = 1;
        return;
    }
}

static void schedule_bar(dn_state *s, uint32_t start, float stepl) {
    struct { float tn; uint8_t k, h, c, g; } cs[DN_BAREV], tmp;
    float poff[DN_TRACKS][DN_HITS];
    int nc = 0;
    for (int k = 0; k < DN_TRACKS; k++) for (int h = 0; h < DN_HITS; h++) poff[k][h] = 0.0f;
    float ms2step = s->sr * 0.001f / stepl;
    int poly = (int)((s->feat >> DN_F_POLY) & 1u);
    int32_t bar0 = s->sched_bar * 16;              /* the absolute step where this bar starts */
    for (int k = 0; k < DN_TRACKS; k++) {
        dn_track *T = &s->tr[k];
        for (int h = 0; h < DN_HITS; h++) T->hit[h].bstep = -1;
        int cyc = 16;
        if (poly && !T->keeper) cyc = 16 + dn_roundi(s->keff[DN_K_POLY] * (float)POLYOFF[k]);
        T->cycle = (uint8_t)cyc;
        if (!sounding(s, k)) continue;
        for (int g = 0; g < 16; g++) {
            /* with its own cycle, a unit's pattern runs on its own count and drifts against the bar */
            int p = cyc == 16 ? g : (int)((uint32_t)(bar0 + g) % (uint32_t)cyc);
            int h = hit_find(T, p);
            if (h < 0) continue;
            dn_hit *H = &T->hit[h];
            H->bstep = (int8_t)g;
            float base = (float)g;
            if (!T->keeper) base += swing_off(T->swing, g) + (float)H->micro * (1.0f / 64.0f);
            for (int c = 0; c < H->copies && nc < DN_BAREV; c++) {
                cs[nc].tn = base + (float)c * H->spread * ms2step;
                cs[nc].k = (uint8_t)k; cs[nc].h = (uint8_t)h; cs[nc].c = (uint8_t)c; cs[nc].g = (uint8_t)g;
                nc++;
            }
        }
    }
    for (int i = 1; i < nc; i++) {           /* time order */
        tmp = cs[i];
        int j = i - 1;
        while (j >= 0 && cs[j].tn > tmp.tn) { cs[j + 1] = cs[j]; j--; }
        cs[j + 1] = tmp;
    }
    int ring[DN_TRACKS], pos[DN_TRACKS], nr = 0;   /* the corridor: sounding units in order */
    for (int k = 0; k < DN_TRACKS; k++) {
        pos[k] = -1;
        if (sounding(s, k)) { pos[k] = nr; ring[nr++] = k; }
        s->tr[k].pushed = 0.0f;
    }
    int emitted = 0;
    for (int i = 0; i < nc; i++) {
        int k = cs[i].k, h = cs[i].h;
        dn_track *T = &s->tr[k];
        dn_hit *H = &T->hit[h];
        float t, gate, push = 0.0f;
        int cause = -1;
        if (T->keeper) {
            t = cs[i].tn;
            gate = 0.9f * T->stretch;
        } else if (cs[i].c == 0) {
            t = cs[i].tn;
            /* 1. return part of what was borrowed earlier (or hurry if owed) */
            float rep = T->repay * T->debt * 0.6f;
            t += rep; T->debt -= rep;
            /* 2. is another unit's stretched note still sounding across a beat?
             *    next door pushes hardest, two doors less, the rest of the corridor a little */
            float P = 0.0f;
            for (int j = 0; j < DN_TRACKS; j++) {
                if (j == k || pos[j] < 0) continue;
                const dn_track *N = &s->tr[j];
                if (!(N->n_cross && N->n_start < t && N->n_end > t)) continue;
                int dd = pos[j] - pos[k];
                if (dd < 0) dd = -dd;
                if (nr - dd < dd) dd = nr - dd;
                float w = dd <= 1 ? 1.0f : (dd == 2 ? 0.6f : 0.35f);
                float ov = (N->n_end - t) * w;
                if (ov > P) { P = ov; cause = j; }
            }
            (void)ring;
            /* its own length: a note that will reach over the next eighth line leans into it
             * (the rag's tied syncopation), half as strongly as a neighbour's push */
            {
                float g0 = 0.9f * T->stretch;
                float line = (float)(dn_floori(t * 0.5f) + 1) * 2.0f;
                float over = t + g0 - line;
                if (over > 0.0f && over * 0.5f > P) { P = over * 0.5f; cause = k; }
            }
            if (P > 0.0f) {
                push = T->lean * dn_min(P, 1.0f) * 0.85f;   /* >0 enters early, <0 waits */
                /* only what is left on credit can be borrowed: a unit deep in debt must give time back first */
                float dd = push > 0.0f ? T->debt : -T->debt;
                if (dd > DN_CREDIT) push *= dn_clamp01((1.0f - dd) / (1.0f - DN_CREDIT));
                t -= push;
                T->debt += push * DN_ACCRUE;
                T->pushed += push;
            }
            T->debt = dn_clamp(T->debt, -1.0f, 1.0f);
            float dev = dn_clamp(t - (float)cs[i].g, -1.2f, 0.9f);
            t = (float)cs[i].g + dev;
            poff[k][h] = t - cs[i].tn;
            /* an early entry keeps its end: the note is tied over (ragtime) */
            gate = 0.9f * T->stretch + dn_max(push, 0.0f);
            H->off = dev;
            H->cause = (int8_t)(dn_abs(push) > 0.01f ? cause : -1);
            T->n_start = t; T->n_end = t + gate;
            /* crossing an eighth line (every 2 steps): what the left hand of a rag keeps */
            T->n_cross = (uint8_t)(dn_floori(t * 0.5f) != dn_floori((t + gate) * 0.5f));
        } else {
            t = cs[i].tn + poff[k][h];
            gate = 0.9f * T->stretch;
        }
        float dv = T->keeper ? 0.0f : t - (float)cs[i].g;
        int32_t devs = (int32_t)(dv * stepl);
        float r = RATCHET_STEP[dn_roundi(s->keff[DN_K_RATCHET] * 3.0f)];
        if (((s->feat >> DN_F_RATCHET) & 1u) && !T->keeper && gate > 1.5f * r && emitted < 200) {
            /* a long note is struck again and again instead of held */
            int ns = (int)(gate / r);
            if (ns > 8) ns = 8;
            for (int j = 0; j < ns && emitted < 200; j++, emitted++) {
                float tj = t + (float)j * r;
                ev_push(s, start + (uint32_t)(int32_t)(tj * stepl), (uint32_t)dn_max(0.8f * r * stepl, 64.0f), dv, devs, k, cause, 0, 1.0f);
            }
        } else {
            ev_push(s, start + (uint32_t)(int32_t)(t * stepl), (uint32_t)dn_max(gate * stepl, 64.0f), dv, devs, k, cause, T->keeper, 1.0f);
            emitted++;
        }
        /* effect layer, delay: the same copy again, later and softer (placed, not a delay line) */
        float fd = fxval(s, DN_FX_DELAY, k);
        if (fd > 0.0f) {
            float d = FX_DELAY_STEPS[fx_idx(fd, 6)];
            float gn = 1.0f;
            for (int j = 1; j <= 3 && emitted < 200; j++, emitted++) {
                gn *= 0.55f;
                float tj = t + (float)j * d;
                ev_push(s, start + (uint32_t)(int32_t)(tj * stepl), (uint32_t)dn_max(gate * stepl, 64.0f), dv,
                        devs + (int32_t)((float)j * d * stepl), k, -1, 0, gn);
            }
        }
    }
    for (int k = 0; k < DN_TRACKS; k++) { s->tr[k].n_start -= 16.0f; s->tr[k].n_end -= 16.0f; s->tr[k].debt *= DN_SETTLE; }
    s->sched_bar++;
}

/* ------------------------------------------------------------------ voices */
static void fx_setup(dn_state *s, dn_voice *v, int k, uint32_t gate);
static void voice_init(dn_state *s, dn_voice *v, int track, uint32_t gate, int keeper, uint32_t t_on, int32_t devs, float egain) {
    const dn_obj *o = &s->obj;
    v->active = 1; v->track = (uint8_t)track; v->stage = 1; v->keeper = (uint8_t)keeper;
    v->src = (uint8_t)s->src;
    if (s->src == DN_SRC_BUF) {
        v->pos = 0u; v->left = (int32_t)s->seg_len;
    } else if (s->src == DN_SRC_LIVE) {
        /* the input as it was one beat before this copy's place on the grid
         * (in_w is where the sample at `now` sits in the input ring) */
        int32_t rel = (int32_t)(t_on - s->now) - devs - (int32_t)s->live_delay;
        if (rel < -(DN_INBUF - 2 * DN_BLOCK)) rel = -(DN_INBUF - 2 * DN_BLOCK);
        int32_t idx = (int32_t)s->in_w + rel;
        while (idx < 0) idx += DN_INBUF;
        while (idx >= DN_INBUF) idx -= DN_INBUF;
        v->pos = (uint32_t)idx; v->left = 0x7fffffff;
    }
    v->phc = 0.0f; v->phm = 0.0f; v->prev = 0.0f;
    v->incc = o->f0 * s->isr;
    v->incm = o->f0 * o->ratio * s->isr;
    v->amp = 0.0f;
    v->att_inc = 1.0f / (o->att * s->sr);
    v->amp_t = o->sus; v->amp_c = dn_tc(o->dec, s->sr);
    v->rel_c = dn_tc(o->rel, s->sr);
    v->idx = o->i0 * INV2PI; v->idx_t = o->is * INV2PI; v->idx_c = dn_tc(o->ti, s->sr);
    v->fb = o->fb * INV2PI; v->gain = o->gain;
    v->gate = (int32_t)(gate > 0x7ffffff0u ? 0x7ffffff0u : (gate ? gate : 1u));
    v->delay = 0;
    if (s->src != DN_SRC_FM) {
        v->att_inc = 1.0f / (0.0015f * s->sr);
        v->rel_c = dn_tc(s->src == DN_SRC_LIVE ? 0.05f : 0.07f, s->sr);
        v->gain = s->src == DN_SRC_BUF ? s->samp_gain : 0.8f;
    }
    v->gain *= egain;
    v->born = ++s->voice_born;
    v->fx = 0; v->rev = 0;
    if (s->fx_layer && !keeper) fx_setup(s, v, track, gate);
    s->tr[track].flash = 1.0f;
}

/* effect layer: what this copy does, from its unit's values */
static void fx_setup(dn_state *s, dn_voice *v, int k, uint32_t gate) {
    float g = fxval(s, DN_FX_GLITCH, k), p = fxval(s, DN_FX_PITCH, k);
    float st = fxval(s, DN_FX_STUTTER, k), r = fxval(s, DN_FX_REVERSE, k);
    if (g <= 0.0f && p <= 0.0f && st <= 0.0f && r <= 0.0f) return;
    v->fx = 1;
    v->vr = v->born * 2654435761u + 0x9E3779B9u;
    if (!v->vr) v->vr = 1u;
    v->rate = p > 0.0f ? dn_exp2(FX_SEMI[fx_idx(p, 8)] * (1.0f / 12.0f)) : 1.0f;
    if (v->src == DN_SRC_FM) { v->incc *= v->rate; v->incm *= v->rate; }
    v->hold = g > 0.0f ? 1 + (int32_t)(g * 12.0f) : 1;
    v->hcnt = 0; v->held = 0.0f;
    v->pj = g; v->glen = (int32_t)(0.03f * s->sr); v->gcnt = v->glen;
    v->slice = st > 0.0f ? (int32_t)(FX_STUT[fx_idx(st, 4)] * s->cur_step) : 0;
    if (v->slice > 0 && v->slice < 64) v->slice = 64;
    v->slc = v->slice; v->sfade = 0;
    v->i0 = v->idx; v->is = v->idx_t;
    float gl = (float)gate;
    if (gl > s->sr) gl = s->sr;
    int32_t W = (int32_t)(gl * (0.3f + 0.7f * r));
    if (W < 64) W = 64;
    if (r > 0.0f) { v->rev = 1; v->swell = 0.0f; v->swinc = 1.0f / (float)W; v->gate = W; }
    if (v->src == DN_SRC_BUF) {
        v->fend = (int32_t)s->seg_len;
        v->fstart = v->rev ? dn_min((float)W * v->rate, (float)s->seg_len - 2.0f) : 0.0f;
    } else if (v->src == DN_SRC_LIVE) {
        float a = (float)v->pos;
        if (v->rev) {                       /* backwards, from a little later, never past what has come in */
            float span = dn_min((float)W * v->rate, s->live_delay - 512.0f);
            if (span < 0.0f) span = 0.0f;
            a += span;
            if (a >= (float)DN_INBUF) a -= (float)DN_INBUF;
        }
        v->fstart = a;
    }
    v->fpos = v->fstart;
}

static dn_voice *voice_alloc(dn_state *s) {
    dn_voice *best = 0;
    for (int i = 0; i < DN_VOICES; i++) if (!s->vo[i].active) return &s->vo[i];
    /* steal: quietest releasing voice, else the oldest */
    for (int i = 0; i < DN_VOICES; i++) {
        dn_voice *v = &s->vo[i];
        if (v->stage == 3 && (!best || v->amp < best->amp)) best = v;
    }
    if (!best) {
        best = &s->vo[0];
        for (int i = 1; i < DN_VOICES; i++) if ((int32_t)(s->vo[i].born - best->born) < 0) best = &s->vo[i];
    }
    /* move the victim to a spill slot where it fades within ~1.5 ms */
    dn_voice *sp = &s->vo[DN_VOICES];
    for (int i = 0; i < DN_SPILL; i++) if (!s->vo[DN_VOICES + i].active) { sp = &s->vo[DN_VOICES + i]; break; }
    *sp = *best;
    sp->stage = 3; sp->gate = 0; sp->amp_t = 0.0f; sp->amp_c = dn_tc(0.0015f, s->sr);
    best->active = 0;
    return best;
}

/* a copy of a recorded sound (BUF) or of the input (LIVE): no pitch change, only where and how long */
static void voice_render_pcm(dn_state *s, dn_voice *v, float *out, int n, float *esum, int i) {
    const int16_t *buf = v->src == DN_SRC_LIVE ? s->big->inr : s->big->obj;
    const uint32_t N = v->src == DN_SRC_LIVE ? (uint32_t)DN_INBUF : 0xffffffffu;
    float amp = v->amp, att = v->att_inc, rc = v->rel_c, g = v->gain * (1.0f / 32768.0f);
    uint32_t pos = v->pos;
    int32_t left = v->left, gate = v->gate;
    int stage = v->stage;
    float es = 0.0f, *os = s->osum;
    for (; i < n; i++) {
        if (left <= 0) { amp = 0.0f; stage = 3; break; }
        if (stage == 1) { amp += att; if (amp >= 1.0f) { amp = 1.0f; stage = 2; } }
        else if (stage == 3) amp -= amp * rc;
        if (gate > 0 && --gate == 0) stage = 3;
        float x = amp * g * (float)buf[pos];
        if (++pos >= N) pos = 0;
        left--;
        out[i] += x; os[i] += x; es += x * x;
    }
    v->amp = dn_flush(amp); v->pos = pos; v->left = left; v->gate = gate; v->stage = (uint8_t)stage;
    if (stage == 3 && v->amp < 1e-5f) { v->active = 0; v->amp = 0.0f; }
    *esum += es;
}

static uint32_t vrand(uint32_t *r) { uint32_t x = *r; x ^= x << 13; x ^= x >> 17; x ^= x << 5; *r = x ? x : 1u; return *r; }

/* a copy with effects: glitch (sample-and-hold + jumps), pitch, stutter, reverse (FM: a swell) */
static void voice_render_fx(dn_state *s, dn_voice *v, float *out, int n, float *esum, int i) {
    const int pcm = v->src != DN_SRC_FM, ring = v->src == DN_SRC_LIVE;
    const int16_t *buf = ring ? s->big->inr : s->big->obj;
    const float N = ring ? (float)DN_INBUF : (float)v->fend;
    const float inc = v->rev ? -v->rate : v->rate, gpcm = v->gain * (1.0f / 32768.0f);
    const float *tab = s->sintab;
    float amp = v->amp, amp_t = v->amp_t, amp_c = v->amp_c, idx = v->idx, prev = v->prev;
    float phc = v->phc, phm = v->phm, fpos = v->fpos, held = v->held, swell = v->swell;
    int32_t gate = v->gate, slc = v->slc, hcnt = v->hcnt, gcnt = v->gcnt, sfade = v->sfade;
    int stage = v->stage;
    uint32_t vr = v->vr;
    float es = 0.0f, *os = s->osum;
    for (; i < n; i++) {
        /* envelope (a reversed copy swells instead, and stops at the end of its window) */
        if (stage == 1) { amp += v->att_inc; if (amp >= 1.0f) { amp = 1.0f; stage = 2; } }
        else if (stage == 2) { if (!pcm && !v->rev) amp += (amp_t - amp) * amp_c; }   /* FM decays to its sustain */
        else amp -= amp * (v->rev ? 0.02f : (pcm ? v->rel_c : amp_c));                  /* release */
        if (gate > 0 && --gate == 0) { stage = 3; amp_t = 0.0f; amp_c = v->rel_c; }
        float e = amp;
        if (v->rev) { swell += v->swinc; if (swell > 1.0f) swell = 1.0f; e *= swell * swell; }
        /* stutter: back to the start of the slice */
        if (v->slice && --slc <= 0) {
            slc = v->slice; fpos = v->fstart; sfade = 48;
            if (!pcm) { phc = 0.0f; phm = 0.0f; idx = v->i0; }
        }
        /* glitch: now and then jump somewhere else */
        if (v->pj > 0.0f && --gcnt <= 0) {
            gcnt = v->glen;
            float u = (float)(vrand(&vr) >> 8) * (1.0f / 16777216.0f);
            if (u < v->pj) {
                float u2 = (float)(vrand(&vr) >> 8) * (1.0f / 16777216.0f);
                if (pcm) {
                    if (ring) { fpos -= u2 * 0.25f * s->sr; if (fpos < 0.0f) fpos += N; }
                    else fpos = u2 * (N - 2.0f);
                } else { phc = u2; phm = 1.0f - u2; }
                sfade = 48;
            }
        }
        float x;
        if (pcm) {
            if (!ring && (fpos < 0.0f || fpos >= N - 1.0f)) { x = 0.0f; amp = 0.0f; stage = 3; }
            else {
                int a = (int)fpos;
                float fr = fpos - (float)a;
                int b = a + 1;
                if (ring && b >= DN_INBUF) b = 0;
                x = ((float)buf[a] + fr * (float)(buf[b] - buf[a])) * gpcm;
                fpos += inc;
                if (ring) { if (fpos >= N) fpos -= N; else if (fpos < 0.0f) fpos += N; }
            }
        } else {
            float ix = v->rev ? v->is + (v->i0 - v->is) * swell : idx;
            if (!v->rev) idx += (v->idx_t - idx) * v->idx_c;
            float pm = phm + v->fb * prev;
            pm -= (float)dn_floori(pm);
            float fi = pm * (float)DN_TAB;
            int ii = (int)fi;
            float m = tab[ii] + (fi - (float)ii) * (tab[ii + 1] - tab[ii]);
            prev = m;
            float pc = phc + ix * m;
            pc -= (float)dn_floori(pc);
            fi = pc * (float)DN_TAB;
            ii = (int)fi;
            x = (tab[ii] + (fi - (float)ii) * (tab[ii + 1] - tab[ii])) * v->gain;
            phm += v->incm; if (phm >= 1.0f) phm -= 1.0f;
            phc += v->incc; if (phc >= 1.0f) phc -= 1.0f;
        }
        if (sfade > 0) { e *= (float)(48 - sfade) * (1.0f / 48.0f); sfade--; }
        float y = x * e;
        if (v->hold > 1) { if (--hcnt <= 0) { hcnt = v->hold; held = y; } y = held; }
        out[i] += y; os[i] += y; es += y * y;
    }
    v->amp = dn_flush(amp); v->amp_t = amp_t; v->amp_c = amp_c; v->idx = idx; v->prev = prev;
    v->phc = phc; v->phm = phm; v->fpos = fpos; v->held = dn_flush(held); v->swell = swell;
    v->gate = gate; v->slc = slc; v->hcnt = hcnt; v->gcnt = gcnt; v->sfade = sfade; v->stage = (uint8_t)stage; v->vr = vr;
    if (stage == 3 && v->amp < 1e-5f) { v->active = 0; v->amp = 0.0f; }
    *esum += es;
}

static void voice_render(dn_state *s, dn_voice *v, float *out, int n, float *esum) {
    int i = 0;
    if (v->delay > 0) {
        if (v->delay >= n) { v->delay -= n; return; }
        i = v->delay; v->delay = 0;
    }
    if (v->fx) { voice_render_fx(s, v, out, n, esum, i); return; }
    if (v->src != DN_SRC_FM) { voice_render_pcm(s, v, out, n, esum, i); return; }
    const float *tab = s->sintab;
    float phc = v->phc, phm = v->phm, amp = v->amp, idx = v->idx, prev = v->prev;
    float amp_t = v->amp_t, amp_c = v->amp_c, idx_t = v->idx_t, idx_c = v->idx_c;
    float incc = v->incc, incm = v->incm, fb = v->fb, gain = v->gain, att = v->att_inc;
    int32_t gate = v->gate;
    int stage = v->stage;
    float es = 0.0f;
    float *os = s->osum;
    for (; i < n; i++) {
        if (stage == 1) { amp += att; if (amp >= 1.0f) { amp = 1.0f; stage = 2; } }
        else amp += (amp_t - amp) * amp_c;
        idx += (idx_t - idx) * idx_c;
        if (gate > 0 && --gate == 0) { stage = 3; amp_t = 0.0f; amp_c = v->rel_c; }
        float pm = phm + fb * prev;
        pm -= (float)dn_floori(pm);
        float fi = pm * (float)DN_TAB;
        int ii = (int)fi;
        float m = tab[ii] + (fi - (float)ii) * (tab[ii + 1] - tab[ii]);
        prev = m;
        float pc = phc + idx * m;
        pc -= (float)dn_floori(pc);
        fi = pc * (float)DN_TAB;
        ii = (int)fi;
        float c = tab[ii] + (fi - (float)ii) * (tab[ii + 1] - tab[ii]);
        phm += incm; if (phm >= 1.0f) phm -= 1.0f;
        phc += incc; if (phc >= 1.0f) phc -= 1.0f;
        float x = amp * c * gain;
        out[i] += x; os[i] += x; es += x * x;
    }
    v->phc = phc; v->phm = phm; v->amp = dn_flush(amp); v->idx = idx; v->prev = prev;
    v->amp_t = amp_t; v->amp_c = amp_c; v->gate = gate; v->stage = (uint8_t)stage;
    if (stage == 3 && v->amp < 1e-5f) { v->active = 0; v->amp = 0.0f; }
    *esum += es;
}

/* ------------------------------------------------------------------ listening */
static void onset_note(dn_state *s, uint32_t t, float dev, int keeper) {
    s->a_on++;
    if (s->have_onset) {
        float ms = (float)(int32_t)(t - s->last_onset) * 1000.0f * s->isr;
        if (ms < 5.0f) s->a_comb++;
        else if (ms < 40.0f) s->a_flam++;
    }
    s->have_onset = 1;
    s->last_onset = t;
    if (!keeper) {
        if (dev < 0.0f) s->a_early += -dev; else s->a_late += dev;
        s->a_dev_n++;
    }
    if (s->npend < 8) {
        s->pend[s->npend].before = s->env_f;
        s->pend[s->npend].peak = s->env_f;
        s->pend[s->npend].frames = (int32_t)(0.02f * s->sr / 64.0f) + 1;
        s->npend++;
    }
}

static void env_frame(dn_state *s, float fm, float rel64) {
    s->env_f = dn_flush(dn_max(fm, s->env_f * rel64));
    int b = 0;
    if (s->env_f > 1e-6f) b = (int)(2.0f * dn_log2(s->env_f) + 30.0f);
    if (b < 0) b = 0;
    if (b > 31) b = 31;
    s->a_hist[b]++;
    s->a_hist_n++;
    for (int i = 0; i < s->npend;) {
        if (s->env_f > s->pend[i].peak) s->pend[i].peak = s->env_f;
        if (--s->pend[i].frames <= 0) {
            float pk = s->pend[i].peak;
            float rise = pk > 1e-6f ? (pk - s->pend[i].before) / pk : 0.0f;
            s->a_rise += dn_clamp01(rise);
            s->a_rise_n++;
            s->pend[i] = s->pend[--s->npend];
        } else i++;
    }
}

static float hist_pct(const dn_state *s, float q) {
    uint32_t want = (uint32_t)(q * (float)s->a_hist_n), acc = 0;
    for (int b = 0; b < 32; b++) { acc += s->a_hist[b]; if (acc > want) return (float)b; }
    return 31.0f;
}

static void bar_listen(dn_state *s) {
    float on = (float)s->a_on;
    float valley = 1.0f, rise = 1.0f;
    if (s->a_hist_n > 8) {
        float b10 = hist_pct(s, 0.10f), b90 = hist_pct(s, 0.90f);
        valley = b90 <= 1.0f ? 1.0f : 1.0f - dn_exp2((b10 - b90) * 0.5f);
    }
    if (s->a_rise_n) rise = s->a_rise / (float)s->a_rise_n;
    float ov = s->a_ov_n ? s->a_ov / (float)s->a_ov_n : 0.0f;
    float corr = (s->a_LL > 1e-9f && s->a_RR > 1e-9f) ? s->a_LR / dn_sqrt(s->a_LL * s->a_RR) : 1.0f;
    float ifr = s->a_ifw > 1e-9f ? s->a_if / s->a_ifw : 0.0f;
    s->r_valley = valley; s->r_rise = rise; s->r_ov = ov; s->r_corr = corr; s->r_if = ifr;

    /* contour: deep valleys between copies and sharp rises at each onset */
    s->f_contour = s->a_on ? dn_clamp01((0.5f * valley + 0.5f * rise - 0.45f) / 0.5f) : 1.0f;
    /* how many copies sound at once, on a log scale (1 -> 0.2, 3 -> 0.4, 8 -> 0.7, 24 -> 1) */
    s->f_dens = dn_clamp01(dn_log2(1.0f + ov) / 4.64f);
    s->f_flam = on > 1.0f ? dn_clamp01((float)s->a_flam / on * 1.6f) : 0.0f;
    s->f_comb = on > 1.0f ? dn_clamp01((float)s->a_comb / on) : 0.0f;
    s->f_if = dn_clamp01(ifr / 1.5f);
    s->f_mono = dn_clamp01((corr - 0.75f) / 0.25f);
    s->f_early = s->a_dev_n ? s->a_early / (float)s->a_dev_n : 0.0f;
    s->f_late = s->a_dev_n ? s->a_late / (float)s->a_dev_n : 0.0f;
    s->f_onsets = s->a_on;
    s->f_flams = s->a_flam + s->a_comb;

    float erase = 0.40f * (1.0f - s->f_contour) + 0.25f * s->f_dens
                + 0.15f * dn_clamp01(s->f_flam + 0.5f * s->f_comb) + 0.12f * s->f_if + 0.08f * s->f_mono;
    float push = dn_clamp01((s->f_early + 0.15f * s->f_late) / 0.25f);
    for (int i = DN_HIST - 1; i > 0; i--) { s->h_e[i] = s->h_e[i - 1]; s->h_p[i] = s->h_p[i - 1]; }
    s->h_e[0] = erase; s->h_p[0] = push;
    if (s->h_n < DN_HIST) s->h_n++;
    if (s->h_n == 1) { s->m_e = erase; s->m_p = push; }
    else { s->m_e += 0.4f * (erase - s->m_e); s->m_p += 0.4f * (push - s->m_p); }

    /* reset */
    s->a_on = s->a_flam = s->a_comb = s->a_dev_n = 0;
    s->a_early = s->a_late = s->a_rise = s->a_ov = s->a_if = s->a_ifw = 0.0f;
    s->a_LL = s->a_RR = s->a_LR = 0.0f;
    s->a_rise_n = s->a_ov_n = s->a_hist_n = 0;
    for (int b = 0; b < 32; b++) s->a_hist[b] = 0;
}

static float recent(const float *h, int n) {
    if (n <= 0) return 0.0f;
    return n == 1 ? h[0] : 0.5f * (h[0] + h[1]);
}

/* the wanted state: the knobs, tilted by the phase, and (if on) by how loud the input is */
static void targets(const dn_state *s, float *te, float *tp) {
    float e = s->keff[DN_K_ERASE] + 0.8f * TILT[s->phase][0];
    float p = s->keff[DN_K_PUSH] + 0.8f * TILT[s->phase][1];
    if ((s->feat >> DN_F_FOLLOW) & 1u) {
        float a = s->keff[DN_K_FOLLOW], d = s->in_lvl - 0.35f;
        e += a * 0.7f * d;
        p += a * 0.4f * d;
    }
    *te = dn_clamp01(e); *tp = dn_clamp01(p);
}

/* how far the measured state is from the wanted one; per-axis (L1) so that
 * an improvement on one axis is not diluted by a large gap on the other */
static float gap(float te, float tp, float e, float p) { return dn_abs(te - e) + dn_abs(tp - p); }

static void ops_bar(dn_state *s) {
    int b = s->bar;
    float cost = 0.0025f * dn_pow(40.0f, s->keff[DN_K_META]);
    targets(s, &s->t_e, &s->t_p);
    float re = recent(s->h_e, s->h_n), rp = recent(s->h_p, s->h_n);
    s->urgency = gap(s->t_e, s->t_p, re, rp);
    if ((s->feat >> DN_F_HOLD) & 1u) return;     /* the arrangement is held: nobody lives, dies or acts */

    for (int i = 0; i < DN_OPS; i++) {
        dn_op *o = &s->op[i];
        o->age++;
        o->energy -= cost;
        o->merit *= 0.93f;           /* old merit fades: what helped then may not help now */
        if (o->pending && b >= o->act_bar + 3) {
            float da = gap(o->te, o->tp, re, rp);
            float r = dn_clamp((o->d_before - da) / 0.05f, -1.0f, 1.0f);
            o->reward = r;
            o->merit = o->acts <= 1 ? r : o->merit + 0.5f * (r - o->merit);
            o->energy += 0.8f * r;
            o->pending = 0;
            logp(s, DN_LG_REWARD, o->kind, o->track, r, o->id);
        }
        if (o->energy > 2.0f) o->energy = 2.0f;
    }
    /* death and birth: only an operator that has proven itself has children;
     * if none has, the newcomer tries a kind the population lacks */
    for (int i = 0; i < DN_OPS; i++) {
        dn_op *o = &s->op[i];
        if (o->energy > 0.0f) continue;
        logp(s, DN_LG_DIED, o->kind, o->track, (float)o->age, o->id);
        int best = -1;
        for (int j = 0; j < DN_OPS; j++) {
            const dn_op *q = &s->op[j];
            if (j == i || q->energy <= 0.0f || q->acts < 1 || q->merit <= 0.05f) continue;
            if (best < 0 || q->energy * q->merit > s->op[best].energy * s->op[best].merit) best = j;
        }
        if (best >= 0) op_child(s, o, &s->op[best]);
        else op_fresh(s, o, rare_kind(s, o));
        logp(s, DN_LG_BORN, o->kind, o->track, o->gene, o->id);
    }
    /* who is due */
    float u = dn_min(s->urgency, 1.0f);
    for (int i = 0; i < DN_OPS; i++) {
        dn_op *o = &s->op[i];
        int ep = (int)((float)o->period * (1.0f - 0.5f * u) + 0.5f);
        if (ep < 1) ep = 1;
        if (((b + o->phase_off) % ep) == 0) o->wait = 1;
    }
    s->quiet++;
    /* one change at a time; it stays for at least 3 bars (4 when close to the wanted state),
     * so that it is heard over a few repetitions before anything else moves */
    int qmin = s->urgency > 0.5f ? 3 : 4;
    if (s->quiet < qmin) return;
    for (int tries = 0; tries < DN_OPS; tries++) {
        int pick = -1;
        for (int i = 0; i < DN_OPS; i++) {
            dn_op *o = &s->op[i];
            if (o->wait && !o->pending && (pick < 0 || o->energy > s->op[pick].energy)) pick = i;
        }
        if (pick < 0) return;
        dn_op *o = &s->op[pick];
        o->wait = 0;
        if (o->counter & 0x8000u) { o->counter &= 0x7fffu; o->track = (uint8_t)next_door(s, o->track); }
        if (op_act(s, o)) {
            s->quiet = 0;
            o->pending = 1; o->act_bar = b; o->acts++;
            o->te = s->t_e; o->tp = s->t_p;
            o->d_before = gap(s->t_e, s->t_p, re, rp);
            s->tr[o->track].last_op_bar = b;
            logp(s, DN_LG_ACT, o->kind, o->track, o->gene, o->id);
            return;
        }
        o->energy -= 0.05f;   /* nothing left to change: a wasted turn */
    }
}

static void request(dn_state *s, int kind);

/* ------------------------------------------------------------------ bar end */
static void bar_end(dn_state *s) {
    bar_listen(s);
    {   /* how loud the input was over the bar, 0 (-50 dBFS or nothing) .. 1 (-10 dBFS) */
        float lvl = 0.0f;
        if (s->in_sq_n > 0.0f && s->in_sq > 1e-12f) {
            float db = 3.0103f * dn_log2(s->in_sq / s->in_sq_n);
            lvl = dn_clamp01((db + 50.0f) / 40.0f);
        }
        s->in_lvl += 0.5f * (lvl - s->in_lvl);
        s->in_sq = 0.0f; s->in_sq_n = 0.0f;
    }
    ops_bar(s);
    int hold = (int)((s->feat >> DN_F_HOLD) & 1u);
    if (!hold && --s->ph_left <= 0) phase_next(s);
    if (s->fx_layer && s->fx_auto > 0 && s->bar + 1 - s->fx_last_roll >= s->fx_auto) {
        fx_roll(s, -1);
        s->fx_last_roll = s->bar + 1;
    }
    if ((s->feat >> DN_F_GEN) & 1u) {
        int every = GEN_BARS[dn_roundi(s->keff[DN_K_GEN] * 4.0f)];
        if (s->bar + 1 - s->last_gen_bar >= every) { request(s, 2); s->last_gen_bar = s->bar + 1; }
    }
    /* nobody left, and not by the hand: someone moves in */
    if (count_sounding(s, 0) == 0 && !s->hand_stop) {
        int handout = 0;
        for (int k = 1; k < DN_TRACKS; k++) if (s->tr[k].hand == 2) handout++;
        if (handout < DN_TRACKS - 1) {
            for (int k = 1; k < DN_TRACKS; k++) {
                dn_track *T = &s->tr[k];
                if (T->hand == 2) continue;
                if (!T->nhit) hit_add(T, rndi(s, 16), 0);
                T->on = 1; T->dormant = 0;
                break;
            }
        }
    }
    s->trail[s->trail_n % DN_TRAIL][0] = s->m_e;
    s->trail[s->trail_n % DN_TRAIL][1] = s->m_p;
    s->trail_n++;
}

/* ------------------------------------------------------------------ control */
static void control_update(dn_state *s, int n) {
    float fn = (float)n;
    if (s->hand_idle < 0x7fffff00u) s->hand_idle += (uint32_t)n;
    s->hand_speed = dn_flush(s->hand_speed * dn_exp(-fn / (0.15f * s->sr)));
    if (s->hand_speed < 1e-3f) s->hand_speed = 0.0f;
    int g = s->hand_idle < (uint32_t)(0.35f * s->sr);
    if (!g) s->gest_lanes = 0;
    s->gesture = g;

    float pos = 0.0f;
    int32_t into = (int32_t)(s->now - s->cur_start);
    if (into > 0 && s->cur_len) pos = dn_clamp((float)into / (float)s->cur_len, 0.0f, 0.9999f);
    int LS = s->mr_loop * DN_MR_SPB;
    int slot = (int)((uint32_t)s->bar % (uint32_t)s->mr_loop) * DN_MR_SPB + (int)(pos * (float)DN_MR_SPB);
    for (int l = 0; l < DN_LANES; l++) {
        if (l == DN_K_OBJECT) continue;
        uint16_t bit = (uint16_t)(1u << l);
        if (g && (s->gest_lanes & bit)) {
            if (s->mr_armed) {
                uint16_t val = (uint16_t)(s->knob[l] * 65535.0f);
                if (!(s->lane_has & bit)) {
                    for (int i = 0; i < DN_MR_SPB * DN_MR_BARS; i++) s->lane[l][i] = val;
                    s->lane_has |= bit;
                }
                int k = s->last_slot[l];
                if (k < 0 || k >= LS) k = (slot + LS - 1) % LS;
                for (int guard = 0; k != slot && guard < LS; guard++) { k = (k + 1) % LS; s->lane[l][k] = val; }
                s->lane[l][slot] = val;
                s->last_slot[l] = slot;
            }
        } else if (s->lane_has & bit) {
            s->knob[l] = (float)s->lane[l][slot] * (1.0f / 65535.0f);
        }
    }
    float c = dn_tc(0.04f, s->sr / fn);
    for (int k = 0; k < DN_KNOBS; k++) s->keff[k] += (s->knob[k] - s->keff[k]) * c;
}

void dn_set_knob(dn_state *s, int k, float v) {
    if (k < 0 || k >= DN_KNOBS || k == DN_K_OBJECT) return;
    s->knob[k] = dn_clamp01(v);
    s->keff[k] = s->knob[k];
}

void dn_encoder(dn_state *s, int k, int det) {
    if (k == DN_K_OBJECT) {
        if (s->src == DN_SRC_LIVE || (s->src == DN_SRC_BUF && (s->obj_from == DN_FROM_INPUT || s->obj_from == DN_FROM_OUTPUT))) {
            /* taking from the input or the output: how long a piece to take */
            s->cap_len = dn_clamp(s->cap_len + (float)det * 0.025f, 0.1f, 0.75f);
            return;
        }
        int c = (int)s->seed_cand + det;
        while (c < 1) c += 9999;
        while (c > 9999) c -= 9999;
        s->seed_cand = (uint32_t)c;
        obj_make(&s->cand, s->seed_cand);
        return;
    }
    if (k < 0 || k >= DN_KNOBS || det == 0) return;
    float acc = 1.0f + dn_min(3.0f, s->hand_speed * 0.12f);   /* fast turns go farther */
    float st = k == DN_K_TEMPO ? 1.0f / 140.0f : (k == DN_K_VOL ? 1.0f / 64.0f : 1.0f / 32.0f);
    s->knob[k] = dn_clamp01(s->knob[k] + (float)det * st * acc);
    s->hand_speed += (float)(det < 0 ? -det : det);
    s->hand_idle = 0;
    if (k < DN_LANES && k != DN_K_OBJECT) {
        uint16_t bit = (uint16_t)(1u << k);
        if (!(s->gest_lanes & bit)) { s->gest_lanes |= bit; s->last_slot[k] = -1; }
    }
}

/* ------------------------------------------------------------------ the object from a file or the input */
/* obj[0 .. len) becomes the object: soften its edges; either keep its level (captured input: as
 * loud as the live copies were, so nothing dips) or bring every object to about the same peak */
static void obj_set(dn_state *s, uint32_t len, int from, int normalize) {
    int16_t *b = s->big->obj;
    if (len > DN_OBJBUF) len = DN_OBJBUF;
    if (len < 64u) return;
    uint32_t fi = (uint32_t)(0.002f * s->sr), fo = (uint32_t)(0.012f * s->sr);
    for (uint32_t i = 0; i < fi && i < len; i++) b[i] = (int16_t)((float)b[i] * (float)i / (float)fi);
    for (uint32_t i = 0; i < fo && i < len; i++) { uint32_t j = len - 1u - i; b[j] = (int16_t)((float)b[j] * (float)i / (float)fo); }
    int32_t peak = 1;
    for (uint32_t i = 0; i < len; i++) { int32_t a = b[i]; if (a < 0) a = -a; if (a > peak) peak = a; }
    s->samp_gain = normalize ? 0.42f * 32768.0f / (float)peak : 0.8f;
    s->seg_len = len; s->seg_valid = 1; s->obj_from = from;
    s->src = DN_SRC_BUF;
}
/* copies still playing the old object fade within a few ms before it is overwritten */
static int fade_obj_voices(dn_state *s) {
    int busy = 0;
    for (int i = 0; i < DN_VOICES + DN_SPILL; i++) {
        dn_voice *v = &s->vo[i];
        if (!v->active || v->src != DN_SRC_BUF) continue;
        if (v->stage != 3) { v->stage = 3; v->gate = 0; v->rel_c = dn_tc(0.004f, s->sr); }
        if (v->amp > 1e-3f) busy = 1;
    }
    return busy;
}
int16_t *dn_sample_area(dn_state *s) { fade_obj_voices(s); return s->big->obj; }
void dn_sample_commit(dn_state *s, int n) {
    if (n <= 0) return;
    obj_set(s, (uint32_t)n, DN_FROM_FILE, 1);
    s->src_note = 3;
}
/* first index of x[0..len) above pct % of the peak, a little early: where the sound starts */
static uint32_t onset_in(const int16_t *x, uint32_t len, int32_t peak, uint32_t back, int32_t pct) {
    for (uint32_t i = 0; i < len; i++) {
        int32_t a = x[i]; if (a < 0) a = -a;
        if (a * 100 > peak * pct) return i > back ? i - back : 0u;
    }
    return 0u;
}
/* the input that just came in becomes the object, at the level it had */
static void do_capture(dn_state *s) {
    int16_t *o = s->big->obj;
    const int16_t *r = s->big->inr;
    uint32_t len = (uint32_t)(s->cap_len * s->sr);
    if (len > DN_OBJBUF) len = DN_OBJBUF;
    if (len > s->in_have) len = s->in_have;
    int32_t at = (int32_t)s->in_w - (int32_t)len;
    while (at < 0) at += DN_INBUF;
    int32_t peak = 0;
    for (uint32_t i = 0, j = (uint32_t)at; i < len; i++) {
        int16_t x = r[j]; if (++j >= DN_INBUF) j = 0;
        o[i] = x;
        int32_t a = x < 0 ? -x : x; if (a > peak) peak = a;
    }
    if (len < 64u || peak < 330) { s->src_note = 2; return; }      /* below about -40 dBFS: nothing to hold */
    uint32_t st = onset_in(o, len, peak, (uint32_t)(0.002f * s->sr), 15);
    for (uint32_t i = st; i < len; i++) o[i - st] = o[i];
    obj_set(s, len - st, DN_FROM_INPUT, 0);
    s->src_note = 1;
}
/* what the building sounds like right now becomes the object (the output ring is at half rate:
 * each generation loses a little of the top) */
static void do_resample(dn_state *s) {
    int16_t *o = s->big->obj;
    const int16_t *r = s->big->outr;
    uint32_t half = (uint32_t)(s->cap_len * s->sr * 0.5f);
    if (half > DN_OUTBUF - 2u) half = DN_OUTBUF - 2u;
    if (half > DN_OBJBUF / 2u - 1u) half = DN_OBJBUF / 2u - 1u;
    if (half > s->out_have) half = s->out_have;
    int32_t at = (int32_t)s->out_w - (int32_t)half;
    while (at < 0) at += DN_OUTBUF;
    int32_t peak = 0;
    for (uint32_t i = 0, j = (uint32_t)at; i < half; i++) {      /* gather into the upper half first */
        int16_t x = r[j]; if (++j >= DN_OUTBUF) j = 0;
        o[DN_OBJBUF / 2u + i] = x;
        int32_t a = x < 0 ? -x : x; if (a > peak) peak = a;
    }
    if (half < 64u || peak < 100) { s->src_note = 2; return; }
    uint32_t st = onset_in(o + DN_OBJBUF / 2u, half, peak, (uint32_t)(0.001f * s->sr), 5);
    uint32_t n = half - st;
    const int16_t *x = o + DN_OBJBUF / 2u + st;
    for (uint32_t i = 0; i < n; i++) {                                   /* back to full rate */
        int32_t a = x[i], c = i + 1u < n ? x[i + 1u] : x[i];
        o[2u * i] = (int16_t)a;
        o[2u * i + 1u] = (int16_t)((a + c) / 2);
    }
    obj_set(s, 2u * n, DN_FROM_OUTPUT, 1);
    s->gens++;
    s->src_note = 4;
}
/* capture and resample wait (at most ~3 blocks) for copies of the old object to fade */
static void request(dn_state *s, int kind) {
    s->pend_kind = kind;
    s->pend_wait = 3;
    fade_obj_voices(s);
}
static void pending_commit(dn_state *s) {
    if (!s->pend_kind) return;
    if (fade_obj_voices(s) && s->pend_wait-- > 0) return;
    if (s->pend_kind == 1) do_capture(s); else do_resample(s);
    s->pend_kind = 0;
}

/* ------------------------------------------------------------------ keyboard / buttons */
void dn_key(dn_state *s, int unit, int down) {
    if (unit < 0 || unit >= DN_TRACKS) return;
    if (unit == 0) { if (down) dn_button(s, DN_BTN_KEEPER, (s->keeper_mode + 1) % 3); return; }
    dn_track *T = &s->tr[unit];
    if (down) {
        float sp = (float)(int32_t)(s->now - s->cur_start) / s->cur_step;
        if (sp < 0.0f) sp = 0.0f;
        int k = dn_roundi(sp);
        int micro = dn_roundi((sp - (float)k) * 64.0f);
        if (micro < -32) micro = -32;
        if (micro > 31) micro = 31;
        k &= 15;
        int h = hit_find(T, k);
        if (h >= 0) {
            if (T->hit[h].copies < DN_COPIES) { T->hit[h].copies++; T->hit[h].spread = 3.0f + (float)(micro < 0 ? -micro : micro); }
        } else {
            if (!T->on) T->nhit = 0;
            hit_add(T, k, micro);
        }
        T->on = 1; T->hand = 1; T->dormant = 0;
        s->hand_stop = 0;
        dn_voice *v = voice_alloc(s);
        voice_init(s, v, unit, 0x7ffffff0u, 0, s->now, 0, 1.0f);
        s->key_voice[unit] = (int8_t)(v - s->vo);
        s->key_born[unit] = v->born;
        s->key_t0[unit] = s->now;
        onset_note(s, s->now, 0.0f, 0);
    } else {
        int vi = s->key_voice[unit];
        if (vi >= 0 && vi < DN_VOICES) {
            dn_voice *v = &s->vo[vi];
            if (v->active && v->born == s->key_born[unit]) v->gate = 1;
        }
        s->key_voice[unit] = -1;
        float held = (float)(int32_t)(s->now - s->key_t0[unit]) / s->cur_step;
        if (held > 1.5f) T->stretch = dn_clamp(held / 0.9f, 0.4f, 4.0f);   /* held long: stretched by hand */
    }
}

void dn_button(dn_state *s, int btn, int arg) {
    switch (btn) {
    case DN_BTN_TRACK:
        if (arg <= 0 || arg >= DN_TRACKS) { if (arg == 0) dn_button(s, DN_BTN_KEEPER, (s->keeper_mode + 1) % 3); break; }
        {
            dn_track *T = &s->tr[arg];
            if (T->on && T->nhit) {
                T->on = 0; T->hand = 2;
                if (count_sounding(s, 0) == 0) s->hand_stop = 1;   /* deliberate silence */
            } else {
                if (!T->nhit) hit_add(T, rndi(s, 16), 0);
                T->on = 1; T->hand = 1; T->dormant = 0;
                s->hand_stop = 0;
            }
        }
        break;
    case DN_BTN_TRACK_AUTO:
        if (arg > 0 && arg < DN_TRACKS) s->tr[arg].hand = 0;
        break;
    case DN_BTN_KEEPER:
        s->keeper_mode = arg < 0 ? 0 : (arg > 2 ? 2 : arg);
        if (s->keeper_mode == 1) s->keeper_on = 1;
        if (s->keeper_mode == 2) s->keeper_on = 0;
        break;
    case DN_BTN_REC: s->mr_armed = !s->mr_armed; break;
    case DN_BTN_CLEAR: s->lane_has = 0; break;
    case DN_BTN_LOOP: s->mr_loop = s->mr_loop >= DN_MR_BARS ? 1 : s->mr_loop * 2; break;
    case DN_BTN_OBJECT:                 /* encoder 7 pressed: choose the object again */
        if (s->src == DN_SRC_LIVE || (s->src == DN_SRC_BUF && s->obj_from == DN_FROM_INPUT)) request(s, 1);
        else if (s->src == DN_SRC_BUF && s->obj_from == DN_FROM_OUTPUT) request(s, 2);
        else { s->obj = s->cand; s->src = DN_SRC_FM; }
        break;
    case DN_BTN_SOURCE:
        if (arg == DN_SRC_LIVE) { s->src = DN_SRC_LIVE; s->src_note = 0; }
        else if (arg == DN_SRC_BUF) { if (s->seg_valid) s->src = DN_SRC_BUF; }
        else s->src = DN_SRC_FM;
        break;
    case DN_BTN_CAPTURE:
        request(s, 1);
        break;
    case DN_BTN_RESAMPLE:
        request(s, 2);
        break;
    case DN_BTN_FX_LAYER:
        s->fx_layer = !s->fx_layer;
        s->fx_last_roll = s->bar;
        break;
    case DN_BTN_FX_TOGGLE:
        if (arg >= 0 && arg < DN_FX) {
            s->fx_mask ^= 1u << arg;
            if ((s->fx_mask >> arg) & 1u) {          /* checked with nothing set yet: roll it once */
                int any = 0;
                for (int k = 0; k < DN_TRACKS; k++) if (s->fxv[arg][k] > 0.0f) any = 1;
                if (!any) fx_roll(s, arg);
            }
        }
        break;
    case DN_BTN_FX_DICE:
        fx_roll(s, arg >= 0 && arg < DN_FX ? arg : -1);
        break;
    case DN_BTN_FX_AUTO:
        s->fx_auto = arg < 0 ? 0 : (arg > 64 ? 64 : arg);
        s->fx_last_roll = s->bar;
        break;
    case DN_BTN_FEATURE:
        if (arg >= 0 && arg < DN_FEATURES) {
            s->feat ^= 1u << arg;
            if (arg == DN_F_GEN) s->last_gen_bar = s->bar;
        }
        break;
    case DN_BTN_UNIT_CLEAR:
        if (arg > 0 && arg < DN_TRACKS) { s->tr[arg].nhit = 0; s->tr[arg].on = 0; s->tr[arg].hand = 0; }
        break;
    case DN_BTN_REBUILD:
        s->hand_stop = 0;
        init_tracks(s);
        init_ops(s);
        phase_enter(s, DN_PH_KOTAI);
        break;
    }
}

/* ------------------------------------------------------------------ init */
void dn_init(dn_state *s, dn_big *b, float sr, uint32_t seed) {
    zero_bytes(s, sizeof *s);
    zero_bytes(b, sizeof *b);
    s->big = b;
    s->sr = sr;
    s->isr = 1.0f / sr;
    s->rng = seed * 747796405u + 2891336453u;
    if (!s->rng) s->rng = 1;
    s->fx_rng = seed * 2246822519u + 3266489917u;
    if (!s->fx_rng) s->fx_rng = 1;
    for (int i = 0; i < DN_TAB + 2; i++) {
        float x = 6.2831853f * (float)i / (float)DN_TAB;
        if (x > 3.14159265f) x -= 6.2831853f;
        s->sintab[i] = dn_sin_poly(x);
    }
    s->knob[DN_K_TEMPO] = (88.0f - 40.0f) / 140.0f;
    s->knob[DN_K_ERASE] = 0.35f;
    s->knob[DN_K_PUSH] = 0.45f;
    s->knob[DN_K_META] = 0.35f;
    s->knob[DN_K_ROOM] = 0.45f;
    s->knob[DN_K_DIST] = 0.35f;
    for (int k = 0; k < DN_KNOBS; k++) s->keff[k] = s->knob[k];
    s->seed_cand = 1u + seed % 9999u;
    obj_make(&s->obj, s->seed_cand);
    s->cand = s->obj;
    s->mr_loop = 4;
    for (int l = 0; l < DN_LANES; l++) s->last_slot[l] = -1;
    for (int k = 0; k < DN_TRACKS; k++) s->key_voice[k] = -1;
    s->hand_idle = 0x7fffff00u;
    init_tracks(s);
    init_ops(s);
    phase_enter(s, DN_PH_KOTAI);
    s->lim_g = 1.0f;
    s->density_g = 1.0f;
    s->src = DN_SRC_FM;
    s->samp_gain = 1.0f;
    s->cap_len = 0.6f;
    s->knob[DN_K_GEN] = 0.5f; s->knob[DN_K_POLY] = 0.5f; s->knob[DN_K_DUCK] = 0.5f;
    s->knob[DN_K_FOLLOW] = 0.5f; s->knob[DN_K_RATCHET] = 0.34f;
    s->knob[DN_K_VOL] = 0.85f;                 /* 0 dB */
    s->vol_g = 1.0f;
    for (int k = DN_K_GEN; k < DN_KNOBS; k++) s->keff[k] = s->knob[k];
    s->cur_step = step_samples(s);
    s->cur_start = 2048u;
    s->cur_len = (uint32_t)(16.0f * s->cur_step);
    s->edel = 3.0f * s->cur_step;
    if (s->edel > (float)(DN_ECHOBUF - 8)) s->edel = (float)(DN_ECHOBUF - 8);
    schedule_bar(s, s->cur_start, s->cur_step);
}

/* ------------------------------------------------------------------ process */
static void process_block(dn_state *s, const float *in, float *L, float *R, int n) {
    dn_big *B = s->big;
    control_update(s, n);

    pending_commit(s);

    /* the input: its level, and always into its ring (so it can be taken at any moment) */
    {
        float pk = s->in_peak * dn_exp(-(float)n / (0.3f * s->sr));
        int16_t *r = B->inr;
        uint32_t w = s->in_w;
        for (int i = 0; i < n; i++) {
            float x = in ? dn_clamp(in[i], -1.0f, 1.0f) : 0.0f;
            float a = dn_abs(x); if (a > pk) pk = a;
            s->in_sq += x * x;
            r[w] = (int16_t)(x * 32767.0f);
            if (++w >= DN_INBUF) w = 0;
        }
        if (in) { s->in_sq_n += (float)n; s->in_have = s->in_have + (uint32_t)n > DN_INBUF ? DN_INBUF : s->in_have + (uint32_t)n; }
        else s->in_have = 0;
        s->in_peak = pk < 1e-5f ? 0.0f : pk;
        /* one beat, if it fits in the ring together with a late copy; else an eighth, else a step */
        float st = s->cur_step, lim = (float)(DN_INBUF - 2 * DN_BLOCK) - 0.9f * st, d = 4.0f * st;
        if (d > lim) d = 2.0f * st;
        if (d > lim) d = st;
        if (d > lim) d = lim;
        s->live_delay = (float)(int32_t)d;
    }

    /* plan the next bar ~2 steps before it starts */
    uint32_t bend = s->cur_start + s->cur_len;
    if (!s->nxt_ready && (int32_t)(s->now + (uint32_t)n - (bend - (uint32_t)(2.0f * s->cur_step))) >= 0) {
        s->nxt_step = step_samples(s);
        s->nxt_start = bend;
        s->nxt_len = (uint32_t)(16.0f * s->nxt_step);
        schedule_bar(s, s->nxt_start, s->nxt_step);
        s->nxt_ready = 1;
    }
    if ((int32_t)(s->now - bend) >= 0) {
        if (!s->nxt_ready) {
            s->nxt_step = step_samples(s);
            s->nxt_start = bend; s->nxt_len = (uint32_t)(16.0f * s->nxt_step);
            schedule_bar(s, s->nxt_start, s->nxt_step);
        }
        bar_end(s);
        s->bar++;
        s->cur_start = s->nxt_start; s->cur_len = s->nxt_len; s->cur_step = s->nxt_step;
        s->nxt_ready = 0;
    }

    /* events due in this block */
    struct { uint32_t t; float dev; uint8_t keeper; } on[32];
    int non = 0, kon = -1;
    uint32_t end = s->now + (uint32_t)n;
    for (int i = 0; i < DN_EVQ; i++) {
        dn_event *e = &s->ev[i];
        if (!e->used || (int32_t)(e->t - end) >= 0) continue;
        int32_t off = (int32_t)(e->t - s->now);
        if (off < 0) off = 0;
        dn_voice *v = voice_alloc(s);
        voice_init(s, v, e->track, e->gate, e->keeper, s->now + (uint32_t)off, e->devs, e->gain);
        v->delay = off;
        e->used = 0;
        if (e->keeper && (kon < 0 || off < kon)) kon = off;
        if (non < 32) {
            on[non].t = s->now + (uint32_t)off; on[non].dev = e->dev; on[non].keeper = e->keeper;
            non++;
        }
    }
    for (int i = 1; i < non; i++) {
        uint32_t t = on[i].t; float d = on[i].dev; uint8_t kp = on[i].keeper;
        int j = i - 1;
        while (j >= 0 && (int32_t)(on[j].t - t) > 0) { on[j + 1] = on[j]; j--; }
        on[j + 1].t = t; on[j + 1].dev = d; on[j + 1].keeper = kp;
    }
    for (int i = 0; i < non; i++) onset_note(s, on[i].t, on[i].dev, on[i].keeper);

    for (int i = 0; i < n; i++) {
        s->osum[i] = 0.0f; s->dryL[i] = 0.0f; s->dryR[i] = 0.0f; s->echL[i] = 0.0f; s->echR[i] = 0.0f;
    }
    for (int r = 0; r < DN_ROOMS; r++) for (int i = 0; i < n; i++) s->rin[r][i] = 0.0f;

    /* the caretaker's press: each of its beats pushes the other units down, then lets go */
    {
        float depth = ((s->feat >> DN_F_DUCK) & 1u) ? s->keff[DN_K_DUCK] : 0.0f;
        float rel = dn_exp(-1.0f / (2.0f * s->cur_step)), att = dn_tc(0.002f, s->sr);
        float d = s->duck, tg = s->duck_tg;
        for (int i = 0; i < n; i++) {
            if (i == kon) tg = 1.0f;
            tg = dn_flush(tg * rel);
            d += (tg - d) * att;
            s->duck_env[i] = 1.0f - 0.85f * depth * d;
        }
        s->duck = dn_flush(d); s->duck_tg = tg;
    }

    /* voices -> tracks -> distance, pan, sends */
    float esum = 0.0f;
    int nact = 0, loud = 0;
    float kd = s->keff[DN_K_DIST];
    for (int k = 0; k < DN_TRACKS; k++) {
        dn_track *T = &s->tr[k];
        int has = 0;
        for (int i = 0; i < DN_VOICES + DN_SPILL; i++) {
            dn_voice *v = &s->vo[i];
            if (!v->active || v->track != k) continue;
            if (!has) { for (int j = 0; j < n; j++) s->tbuf[j] = 0.0f; has = 1; }
            voice_render(s, v, s->tbuf, n, &esum);
            nact++;
            if (v->amp > 0.03f) loud++;
        }
        float deff = dn_clamp01(T->dist + (kd - 0.35f));
        T->ds += (deff - T->ds) * 0.08f;
        T->ps += (T->pan - T->ps) * 0.08f;
        T->flash = dn_flush(T->flash * 0.86f);
        if (!has) {
            if (dn_abs(T->lp2) < 1e-6f) { T->lp1 = T->lp2 = 0.0f; continue; }
            for (int j = 0; j < n; j++) s->tbuf[j] = 0.0f;
        }
        float ds = T->ds;
        float fc = 16000.0f * dn_exp2(-5.0f * ds);
        float a = dn_tc(1.0f / (6.2831853f * fc), s->sr);
        float g = 1.0f - 0.6f * ds;
        float gL = dn_sqrt(0.5f * (1.0f - T->ps)) * g, gR = dn_sqrt(0.5f * (1.0f + T->ps)) * g;
        float se = 0.05f + 0.75f * ds * ds, sr_ = 0.55f;
        float lp1 = T->lp1, lp2 = T->lp2;
        float *ri = s->rin[T->room];
        const float *dk = s->duck_env;
        int ducked = !T->keeper;
        for (int j = 0; j < n; j++) {
            lp1 += a * (s->tbuf[j] - lp1);
            lp2 += a * (lp1 - lp2);
            float y = ducked ? lp2 * dk[j] : lp2;
            float yl = y * gL, yr = y * gR;
            s->dryL[j] += yl; s->dryR[j] += yr;
            ri[j] += y * g * sr_;
            s->echL[j] += yl * se; s->echR[j] += yr * se;
        }
        T->lp1 = dn_flush(lp1); T->lp2 = dn_flush(lp2);
    }
    s->nvoices = nact;
    /* listening: interference between copies, overlap */
    {
        float emix = 0.0f;
        for (int i = 0; i < n; i++) emix += s->osum[i] * s->osum[i];
        if (esum > 1e-9f) {
            float v = loud >= 2 ? dn_abs(dn_log2(emix / esum)) : 0.0f;
            s->a_if += v * esum;
            s->a_ifw += esum;
        }
        s->a_ov += (float)loud;
        s->a_ov_n++;
    }

    /* rooms */
    {
        float kq = s->keff[DN_K_ROOM];
        float fbs = 0.35f + 0.65f * kq, wets = 0.1f + 0.9f * kq;
        for (int r = 0; r < DN_ROOMS; r++) {
            const dn_roomdef *D = &ROOMDEF[r];
            int dA = (int)(D->dA * 0.001f * s->sr), dB = (int)(D->dB * 0.001f * s->sr), dS = (int)(D->slap * 0.001f * s->sr);
            if (dA > DN_ROOMBUF - 1) dA = DN_ROOMBUF - 1;
            if (dB > DN_ROOMBUF - 1) dB = DN_ROOMBUF - 1;
            if (dS > DN_ROOMBUF - 1) dS = DN_ROOMBUF - 1;
            float gA = D->gA * fbs, gB = D->gB * fbs, dm = 1.0f - D->damp, wet = D->wet * wets, sg = D->slapg;
            float *bA = B->room[r][0], *bB = B->room[r][1], *bS = B->room[r][2];
            float la = s->rlpA[r], lb = s->rlpB[r];
            int w = s->rw;
            float *ri = s->rin[r];
            for (int i = 0; i < n; i++) {
                int ia = w - dA; if (ia < 0) ia += DN_ROOMBUF;
                int ib = w - dB; if (ib < 0) ib += DN_ROOMBUF;
                int is = w - dS; if (is < 0) is += DN_ROOMBUF;
                float x = ri[i];
                float ya = bA[ia], yb = bB[ib], ys = bS[is];
                la += (ya - la) * dm;
                lb += (yb - lb) * dm;
                bA[w] = dn_flush(x + gA * la);
                bB[w] = dn_flush(x + gB * lb);
                bS[w] = x;
                s->dryL[i] += (ya + ys * sg) * wet;
                s->dryR[i] += (yb + ys * sg) * wet;
                if (++w >= DN_ROOMBUF) w = 0;
            }
            s->rlpA[r] = dn_flush(la); s->rlpB[r] = dn_flush(lb);
        }
        s->rw = (s->rw + n) % DN_ROOMBUF;
    }

    /* echo: ping-pong, diffused, about a dotted eighth */
    {
        float ed = 3.0f * s->cur_step;
        while (ed > (float)(DN_ECHOBUF - 8)) ed *= 0.5f;
        float fbk = 0.30f + 0.28f * s->keff[DN_K_DIST];
        int16_t *e0 = B->echo[0], *e1 = B->echo[1];
        const float ES = 8192.0f, EI = 1.0f / 8192.0f;
        int w = s->ew, dw = s->difw;
        float edel = s->edel, el0 = s->elp[0], el1 = s->elp[1];
        for (int i = 0; i < n; i++) {
            edel += (ed - edel) * 0.0004f;
            float rp = (float)w - edel;
            if (rp < 0.0f) rp += (float)DN_ECHOBUF;
            int i0 = (int)rp;
            float fr = rp - (float)i0;
            int i1 = i0 + 1; if (i1 >= DN_ECHOBUF) i1 = 0;
            float a0 = (float)e0[i0], b0 = (float)e1[i0];
            float yl = (a0 + fr * ((float)e0[i1] - a0)) * EI;
            float yr = (b0 + fr * ((float)e1[i1] - b0)) * EI;
            el0 += (yl - el0) * 0.35f;
            el1 += (yr - el1) * 0.35f;
            /* diffusion allpasses in the loop: far things blur */
            int ra = dw - 347; if (ra < 0) ra += DN_DIFBUF;
            int rb = dw - 461; if (rb < 0) rb += DN_DIFBUF;
            float da = s->dif[0][ra], db = s->dif[1][rb];
            float va = el1 - 0.5f * da, vb = el0 - 0.5f * db;
            s->dif[0][dw] = dn_flush(va); s->dif[1][dw] = dn_flush(vb);
            float ua = da + 0.5f * va, ub = db + 0.5f * vb;
            e0[w] = (int16_t)dn_clamp((s->echL[i] + fbk * ua) * ES, -32767.0f, 32767.0f);
            e1[w] = (int16_t)dn_clamp((s->echR[i] + fbk * ub) * ES, -32767.0f, 32767.0f);
            s->echL[i] = yl * 0.8f;
            s->echR[i] = yr * 0.8f;
            if (++w >= DN_ECHOBUF) w = 0;
            if (++dw >= DN_DIFBUF) dw = 0;
        }
        s->ew = w; s->difw = dw; s->edel = edel;
        s->elp[0] = dn_flush(el0); s->elp[1] = dn_flush(el1);
    }

    /* master: density compensation, analysis, limiter */
    {
        float dgt = 1.0f / dn_sqrt(1.0f + 0.25f * (float)loud);
        s->density_g += (dgt - s->density_g) * 0.02f;
        float dg = s->density_g;
        float rel = 1.0f - dn_tc(0.12f, s->sr);
        float rel64 = dn_exp(-64.0f / (0.03f * s->sr));
        float pk = 0.0f;
        float da = dn_tc(1.0f / (6.2831853f * 8800.0f), s->sr), o1 = s->out_lp[0], o2 = s->out_lp[1];
        uint32_t ow = s->out_w;
        /* the volume, applied last and glided across the block */
        float vg0 = s->vol_g, vg1 = vol_gain(s->keff[DN_K_VOL]), vgs = (vg1 - vg0) / (float)n;
        for (int i = 0; i < n; i++) {
            float dl = s->dryL[i], dr = s->dryR[i];
            s->a_LL += dl * dl; s->a_RR += dr * dr; s->a_LR += dl * dr;
            float l = (dl + s->echL[i]) * dg, r = (dr + s->echR[i]) * dg;
            /* dc block */
            float yl = l - s->dcx[0] + 0.995f * s->dcy[0]; s->dcx[0] = l; s->dcy[0] = dn_flush(yl);
            float yr = r - s->dcx[1] + 0.995f * s->dcy[1]; s->dcx[1] = r; s->dcy[1] = dn_flush(yr);
            float m = dn_abs(0.5f * (yl + yr));
            if (m > s->env_max) s->env_max = m;
            if (++s->env_cnt >= 64) { env_frame(s, s->env_max, rel64); s->env_cnt = 0; s->env_max = 0.0f; }
            float a = dn_max(dn_abs(yl), dn_abs(yr));
            s->lim_env = a > s->lim_env ? a : dn_flush(s->lim_env * rel);
            float gt = s->lim_env > 0.7f ? 0.7f / s->lim_env : 1.0f;
            s->lim_g += (gt - s->lim_g) * (gt < s->lim_g ? 0.3f : 0.0005f);
            float ol = dn_soft(yl * s->lim_g), or_ = dn_soft(yr * s->lim_g);
            float vg = vg0 + vgs * (float)(i + 1);
            L[i] = ol * vg; R[i] = or_ * vg;
            float ab = dn_max(dn_abs(L[i]), dn_abs(R[i]));
            if (ab > pk) pk = ab;
            /* what it sounds like, kept at half rate for resampling */
            o1 += da * (0.5f * (ol + or_) - o1);
            o2 += da * (o1 - o2);
            if (((s->now + (uint32_t)i) & 1u) == 0u) {
                B->outr[ow] = (int16_t)(dn_clamp(o2, -1.0f, 1.0f) * 32767.0f);
                if (++ow >= DN_OUTBUF) ow = 0;
                if (s->out_have < DN_OUTBUF) s->out_have++;
            }
        }
        s->out_lp[0] = dn_flush(o1); s->out_lp[1] = dn_flush(o2); s->out_w = ow;
        s->vol_g = vg1;
        s->peak = pk;
        s->peak_hold = pk > s->peak_hold ? pk : s->peak_hold * 0.995f;
    }
    s->in_w = (s->in_w + (uint32_t)n) % DN_INBUF;
    s->now += (uint32_t)n;
}

void dn_process_in(dn_state *s, const float *in, float *L, float *R, int n) {
    while (n > 0) {
        int m = n > DN_BLOCK ? DN_BLOCK : n;
        process_block(s, in, L, R, m);
        L += m; R += m; n -= m;
        if (in) in += m;
    }
}
void dn_process(dn_state *s, float *L, float *R, int n) { dn_process_in(s, 0, L, R, n); }

/* ------------------------------------------------------------------ view */
const float *dn_view(dn_state *s) {
    float *v = s->view;
    float pos = 0.0f;
    int32_t into = (int32_t)(s->now - s->cur_start);
    if (into > 0 && s->cur_len) pos = dn_clamp((float)into / (float)s->cur_len, 0.0f, 0.9999f);
    v[V_BAR] = (float)s->bar; v[V_POS] = pos; v[V_TEMPO] = dn_tempo_bpm(s);
    v[V_PHASE] = (float)s->phase; v[V_PH_LEFT] = (float)s->ph_left; v[V_PH_LEN] = (float)s->ph_len;
    v[V_KEEPER] = (float)s->keeper_on; v[V_VACANT] = (float)s->vacant_room;
    v[V_M_ERASE] = s->m_e; v[V_M_PUSH] = s->m_p;
    { float te, tp; targets(s, &te, &tp); v[V_T_ERASE] = te; v[V_T_PUSH] = tp; }
    v[V_PH_TILT_E] = TILT[s->phase][0]; v[V_PH_TILT_P] = TILT[s->phase][1];
    v[V_C_CONTOUR] = s->f_contour; v[V_C_DENS] = s->f_dens; v[V_C_FLAM] = s->f_flam; v[V_C_INTERF] = s->f_if;
    v[V_C_MONO] = s->f_mono; v[V_C_EARLY] = s->f_early; v[V_C_LATE] = s->f_late; v[V_C_ONSETS] = (float)s->f_onsets;
    v[V_C_COMB] = s->f_comb; v[V_FLAMS] = (float)s->f_flams;
    for (int k = 0; k < DN_K_OBJECT; k++) v[V_K0 + k] = s->knob[k];
    v[V_K0 + DN_K_OBJECT] = (float)s->seed_cand / 9999.0f;
    for (int k = DN_K_GEN; k <= DN_K_RATCHET; k++) v[V_K7 + k - DN_K_GEN] = s->knob[k];
    v[V_VOL] = s->knob[DN_K_VOL]; v[V_VOL_DB] = dn_vol_db(s->knob[DN_K_VOL]);
    v[V_FEAT] = (float)s->feat; v[V_GENS] = (float)s->gens; v[V_CAP_LEN] = s->cap_len;
    v[V_OBJ_FROM] = (float)(s->src == DN_SRC_BUF ? s->obj_from : 0); v[V_IN_LVL] = s->in_lvl; v[V_DUCK] = s->duck;
    v[V_GEN_LEFT] = (float)(GEN_BARS[dn_roundi(s->keff[DN_K_GEN] * 4.0f)] - (s->bar - s->last_gen_bar));
    v[V_FX_LAYER] = (float)s->fx_layer; v[V_FX_MASK] = (float)s->fx_mask; v[V_FX_AUTO] = (float)s->fx_auto;
    v[V_FX_ROLLS] = (float)s->fx_rolls;
    v[V_SEED] = (float)s->obj.seed; v[V_SEED_CAND] = (float)s->seed_cand;
    v[V_MR_ARMED] = (float)s->mr_armed; v[V_MR_LOOP] = (float)s->mr_loop; v[V_MR_LANES] = (float)s->lane_has;
    v[V_MR_POS] = ((float)((uint32_t)s->bar % (uint32_t)s->mr_loop) + pos) / (float)s->mr_loop;
    v[V_MR_GEST] = (float)s->gest_lanes;
    v[V_PEAK] = s->peak_hold; v[V_GR] = s->lim_g; v[V_VOICES] = (float)s->nvoices;
    int ne = 0;
    for (int i = 0; i < DN_EVQ; i++) ne += s->ev[i].used;
    v[V_EVENTS] = (float)ne; v[V_QUIET] = (float)s->quiet; v[V_URGENCY] = s->urgency;
    v[V_OBJ_F0] = s->obj.f0; v[V_OBJ_RATIO] = s->obj.ratio; v[V_OBJ_I0] = s->obj.i0; v[V_OBJ_DEC] = s->obj.dec;
    v[V_CAND_F0] = s->cand.f0; v[V_CAND_RATIO] = s->cand.ratio;
    v[V_KEEPER_MODE] = (float)s->keeper_mode;
    int snd = count_sounding(s, 0), hout = 0;
    for (int k = 1; k < DN_TRACKS; k++) if (s->tr[k].hand == 2) hout++;
    v[V_SOUNDING] = (float)snd;
    v[V_HANDSTOP] = (float)s->hand_stop;
    (void)hout;
    v[V_STEPLEN_MS] = s->cur_step * 1000.0f * s->isr;
    v[V_SRC] = (float)s->src; v[V_SAMP_LEN] = (float)s->seg_len * s->isr; v[V_IN_PEAK] = s->in_peak;
    v[V_LIVE_DELAY] = s->live_delay * 1000.0f * s->isr; v[V_SRC_NOTE] = (float)s->src_note;
    for (int k = 0; k < DN_TRACKS; k++) {
        const dn_track *T = &s->tr[k];
        float *t = v + V_TRACK0 + k * V_TS;
        t[T_ON] = (float)sounding(s, k); t[T_HAND] = (float)T->hand; t[T_KEEP] = (float)T->keeper;
        t[T_ROOM] = (float)T->room; t[T_PAN] = T->pan; t[T_DIST] = T->dist; t[T_SWING] = T->swing;
        t[T_STRETCH] = T->stretch; t[T_LEAN] = T->lean; t[T_REPAY] = T->repay; t[T_DEBT] = T->debt;
        t[T_NHIT] = (float)T->nhit; t[T_FLASH] = T->flash; t[T_DORMANT] = (float)T->dormant;
        t[T_PUSHED] = T->pushed; t[T_LASTOP] = (float)(s->bar - T->last_op_bar); t[T_CYCLE] = (float)(T->cycle ? T->cycle : 16);
        for (int f = 0; f < DN_FX; f++) t[T_FX0 + f] = s->fxv[f][k];
        for (int h = 0; h < DN_HITS; h++) {
            float *hh = t + T_HIT0 + h * T_HS;
            if (h < T->nhit) {
                hh[0] = (float)T->hit[h].step; hh[1] = (float)T->hit[h].copies;
                hh[2] = T->hit[h].off; hh[3] = (float)T->hit[h].cause; hh[4] = (float)T->hit[h].bstep;
            } else { hh[0] = -1.0f; hh[1] = 0.0f; hh[2] = 0.0f; hh[3] = -1.0f; hh[4] = -1.0f; }
        }
    }
    for (int i = 0; i < DN_OPS; i++) {
        const dn_op *o = &s->op[i];
        float *q = v + V_OPS0 + i * V_OS;
        q[O_KIND] = (float)o->kind; q[O_TRACK] = (float)o->track; q[O_ENERGY] = o->energy;
        q[O_PERIOD] = (float)o->period; q[O_GENE] = o->gene; q[O_AGE] = (float)o->age;
        q[O_REWARD] = o->reward; q[O_SINCE] = o->act_bar < 0 ? 999.0f : (float)(s->bar - o->act_bar);
        q[O_BORN] = (float)(s->bar - o->born_bar); q[O_ID] = (float)o->id;
        q[O_PENDING] = (float)o->pending; q[O_WAIT] = (float)o->wait;
    }
    for (int i = 0; i < DN_LOG; i++) {
        float *l = v + V_LOG0 + i * V_LS;
        int idx = s->log_n - 1 - i;
        if (idx < 0) { l[L_TYPE] = 0.0f; continue; }
        const dn_logent *e = &s->log[idx % DN_LOG];
        l[L_TYPE] = (float)e->type; l[L_KIND] = (float)e->kind; l[L_TRACK] = (float)e->track;
        l[L_VALUE] = e->value; l[L_BAR] = (float)e->bar; l[L_ID] = (float)e->id;
    }
    for (int i = 0; i < DN_TRAIL; i++) {
        int idx = s->trail_n - DN_TRAIL + i;
        float *p = v + V_TRAIL0 + i * 2;
        if (idx < 0) { p[0] = -1.0f; p[1] = -1.0f; }
        else { p[0] = s->trail[idx % DN_TRAIL][0]; p[1] = s->trail[idx % DN_TRAIL][1]; }
    }
    return v;
}

/* test hook: the same phase transition the core makes at a bar end */
void dn_test_phase_next(dn_state *s) { phase_next(s); }
int dn_gen_bars(const dn_state *s) { return GEN_BARS[dn_roundi(s->keff[DN_K_GEN] * 4.0f)]; }
