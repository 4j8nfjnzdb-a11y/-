/* SPDX-License-Identifier: GPL-3.0-only */
/* BUNKI for fm1-dock: a note is a network of sines, each one a logistic map stepped by one clock; R walks the
 * maps' bifurcation diagram, and the map's numbers are heard: period 2 a two-note figure, 4 a four-note one, chaos a
 * line that never comes back and a sine that splits into many, a window a sudden three-note figure.
 * (The engine, the panel's meaning and the looper: bunki/core. This file hands it the keys, knobs and buttons.)
 *
 * Every knob goes on without an end: it moves its value the way it is turned and turns back at the value's end,
 * and at each turn something more is chosen anew. Every button goes on: each press the next state (chosen by the
 * map from the presses so far), a long press (0.6 s) ends it.
 *   KNOB1 / SELECT  R, coarse / fine (at R's top and bottom the network is nudged)
 *   KNOB2           steps a second, a semitone a detent (at the ends: the glide anew)
 *   KNOB3           eps, how hard the sines pull on each other (at the ends: a nudge)
 *   KNOB4           cents a step can move a pitch (at the ends: the octaves dealt anew)
 *   ALGORITHM       sines a voice, 1 .. 8 and back            PRESETS  the seed
 *   PLAY   HOLD     EDIT  FREEZE      ARP  ARP (each press another way: order, plucks a step, tail)
 *   SEQ    EVOLVE   (each press turns it: climb <-> collapse)   GLO  who pulls on whom (all, rings, each alone)
 *   SEL    MICRO    (the grid finer each press: 1/2 .. 1/16 tone, free)   LFO  OCT (wider each press)
 *   ENV    MUTATE   FX    TIMBRE (the FM layer, another ratio each press)   SAVE  keep the knobs and states
 *   REC    LOOP     record what is played, turned and pressed; press again: it loops, and what is done then goes
 *                   into it too (a turn adds again each pass); press again (or hold): stop
 *   MIDI   CC 16 .. 22: the knobs, relative (64 = still); fm1-dock's KNOBS CC (74, 71, 73, 72) the same; CC 64 HOLD
 *
 * Threads: ui(), note(), cc() and draw() run in the main loop, render() in the audio interrupt. The main loop never
 * touches the engine: knob turns are counted (a count each, written by the main loop only), keys and buttons are
 * queued, and render() hands them to bk_input at the start of its block, knobs first: the same events at the same
 * blocks give the same bits (fm1/sim checks it against the desktop host). */
#include "hb_module.h"
#include "bunki.h"

static const hb_host_t *H;
static bk_engine_t E;

/* ---- main loop -> render ---- */
static volatile int32_t turned[BK_NKNOBS];      /* detents turned so far, each knob (the main loop's) */
static int32_t taken[BK_NKNOBS];                /* render's */
#define QN 64u
enum { Q_KEY = 1, Q_BTN, Q_OFF };
static struct { uint8_t type, a; int16_t v; } q[QN];
static volatile uint32_t q_w, q_r;

static void push(uint32_t type, uint32_t a, int32_t v)
{
    uint32_t w = q_w;
    if (w - q_r >= QN)
        return;                                 /* full: render has not run for a while; drop it */
    q[w % QN].type = (uint8_t)type;
    q[w % QN].a = (uint8_t)a;
    q[w % QN].v = (int16_t)v;
    q_w = w + 1u;                               /* the slot first, then the index */
}

/* ---- render -> draw: a snapshot on request ---- */
typedef struct {
    int64_t R, R_hand;
    int32_t lyap, I1, evdir;
    int32_t par[BK_NPARAMS], knob[BK_NKNOBS];
    uint32_t loop_state, loop_len, loop_pos, loop_n;
    struct {
        uint8_t active, note, gates;
        uint32_t n;                             /* periods (timbre) or steps (gesture) so far */
        int32_t x[BK_HIST];                     /* that layer's map, newest first, Q30 */
        int32_t px[BK_NPART], c[BK_NPART];      /* each sine's map (Q30) and pitch now (cents Q4) */
    } v[BK_NV];
} snap_t;
static snap_t S;
static volatile uint32_t snap_req, snap_ready;

static void render(int32_t *out, uint32_t n)
{
    uint32_t r = q_r, k, a;
    for (k = 0; k < BK_NKNOBS; k++) {           /* the knobs first, then the queue */
        const int32_t d = turned[k] - taken[k];
        if (d) {
            taken[k] += d;
            bk_input(&E, BK_IN_KNOB, k, d);
        }
    }
    while (r != q_w) {
        const uint32_t i = r % QN;
        if (q[i].type == Q_KEY) bk_input(&E, BK_IN_KEY, q[i].a, q[i].v);
        else if (q[i].type == Q_BTN) bk_input(&E, BK_IN_BTN, q[i].a, q[i].v);
        else if (q[i].type == Q_OFF) {
            bk_all_off(&E);
            for (k = 0; k < BK_NV; k++) E.v[k].active = 0, E.v[k].amp = 0;
        }
        r++;
    }
    q_r = r;
    bk_render(&E, out, n);
    if (snap_req) {
        const int gest = E.par[BK_P_NPART] > 0;
        S.R = E.R;
        S.R_hand = E.R_hand;
        S.lyap = E.lyap;
        S.I1 = E.v[0].I1;
        S.evdir = E.evdir;
        for (k = 0; k < BK_NPARAMS; k++) S.par[k] = E.par[k];
        for (k = 0; k < BK_NKNOBS; k++) S.knob[k] = E.knob[k];
        S.loop_state = E.loop_state;
        S.loop_len = E.loop_len;
        S.loop_pos = E.loop_pos;
        S.loop_n = E.loop_n;
        for (k = 0; k < BK_NV; k++) {
            const bk_voice_t *v = &E.v[k];
            const uint32_t nn = gest ? v->nstep : v->nper;
            uint32_t g = 0;
            S.v[k].active = v->active;
            S.v[k].note = v->note;
            S.v[k].n = nn;
            for (a = 0; a < BK_HIST; a++)
                S.v[k].x[a] = gest ? v->phist[(nn - 1u - a) & (BK_HIST - 1u)] : v->hist[(nn - 1u - a) & (BK_HIST - 1u)];
            for (a = 0; a < BK_NPART; a++) {
                S.v[k].px[a] = (int32_t)(v->part[a].x >> 32);
                S.v[k].c[a] = bk_part_cents(&E, k, a);
                if (v->part[a].gate && v->part[a].amp > 0) g |= 1u << a;
            }
            S.v[k].gates = (uint8_t)g;
        }
        snap_req = 0;
        snap_ready = 1;
    }
}

/* ---- the panel ---- */
static const uint8_t BTN_OF[14] = {             /* FM-1 button -> the engine's (255: not one) */
    255, 255, BK_BTN_TIMBRE, BK_BTN_MICRO, BK_BTN_MUTATE, BK_BTN_OCT, BK_BTN_FREEZE, BK_BTN_TOPO, 255, 255,
    BK_BTN_ARP, BK_BTN_EVOLVE, BK_BTN_HOLD, BK_BTN_LOOP};
static uint32_t held_since[14], held, long_sent;

static struct {                                 /* the settings record: the knobs, and the states the buttons left */
    uint32_t magic;
    int32_t knob[BK_NKNOBS];
    int32_t par[10];
} rec;
#define REC_MAGIC 0x424E4B33u                   /* "BNK3" */
static const uint8_t REC_PAR[10] = {BK_P_HOLD, BK_P_CHOP, BK_P_ARPV, BK_P_TOPO, BK_P_STRIDE, BK_P_MICRO, BK_P_OCT,
                                    BK_P_OCTV, BK_P_TIMBRE, BK_P_RATIO};

#ifdef BK_DEBUG
#define DBG(s, v) H->log_u32(s, (uint32_t)(v))
static uint32_t dbg_dump;
#else
#define DBG(s, v) ((void)0)
#endif

#ifndef BK_DEBUG
static void save_settings(void)
{
    uint32_t k;
    rec.magic = REC_MAGIC;
    for (k = 0; k < BK_NKNOBS; k++) rec.knob[k] = S.knob[k];
    for (k = 0; k < 10u; k++) rec.par[k] = S.par[REC_PAR[k]];
    H->save(&rec, sizeof rec);
}
#endif

static void note(uint32_t ch, uint32_t key, uint32_t vel)
{
    (void)ch;
    push(Q_KEY, key, (int32_t)vel);
}

static void turn(uint32_t k, int32_t d) { turned[k] = turned[k] + d; }

static void cc(uint32_t ch, uint32_t num, uint32_t val)
{
    static uint32_t last[7] = {64u, 64u, 64u, 64u, 64u, 64u, 64u}, lastk[4] = {64u, 64u, 64u, 64u};
    (void)ch;
    if (num >= 16u && num <= 22u) {             /* the knobs, relative: a step of the value a detent */
        turn(num - 16u, (int32_t)val - (int32_t)last[num - 16u]);
        last[num - 16u] = val;
    } else if (num == 74u || num == 71u || num == 73u || num == 72u) {   /* fm1-dock's KNOBS CC: KNOB1 .. 4 */
        const uint32_t k = num == 74u ? 0u : num == 71u ? 1u : num == 73u ? 2u : 3u;
        turn(k, (int32_t)val - (int32_t)lastk[k]);
        lastk[k] = val;
    } else if (num == 64u) {                    /* the sustain pedal: HOLD as it says */
        if ((val >= 64u) != (S.par[BK_P_HOLD] != 0)) push(Q_BTN, BK_BTN_HOLD, 1);
    } else if (num == 120u || num == 123u)
        push(Q_OFF, 0, 0);
}

static void ui(uint32_t ev, int32_t arg)
{
    const uint32_t id = HB_EV_ID(ev);
    if (HB_EV_KIND(ev) == HB_EV_ENC) {
        const int32_t a = arg < 0 ? -arg : arg;
        switch (id) {
        case HB_ENC_KNOB1: turn(BK_KNOB_R, arg * (a > 3 ? 4 : a > 1 ? 2 : 1)); break;   /* faster turns go further */
        case HB_ENC_SELECT: turn(BK_KNOB_FINE, arg); break;
        case HB_ENC_KNOB2: turn(BK_KNOB_TIME, arg); break;
        case HB_ENC_KNOB3: turn(BK_KNOB_NET, arg); break;
        case HB_ENC_KNOB4: turn(BK_KNOB_SPACE, arg); break;
        case HB_ENC_ALGORITHM: turn(BK_KNOB_N, arg); break;
        case HB_ENC_PRESETS: turn(BK_KNOB_SEED, arg); break;
        default: break;
        }
    } else if (HB_EV_KIND(ev) == HB_EV_BTN_DOWN && id < 14u) {
        if (id == HB_BTN_SAVE) {
#ifdef BK_DEBUG
            dbg_dump = 1;
#else
            save_settings();
#endif
            return;
        }
        if (BTN_OF[id] == 255u) return;
        push(Q_BTN, BTN_OF[id], 1);             /* a press: the next state, at once */
        held |= 1u << id;
        long_sent &= ~(1u << id);
        held_since[id] = H->ms();
    } else if (HB_EV_KIND(ev) == HB_EV_BTN_UP && id < 14u)
        held &= ~(1u << id);
}

/* ---- the screen: the sines' pitches as a trace (top), the diagram (middle), the numbers (bottom) ---- */
#define PY   18                                 /* the pitch trace: rows PY .. PY + PH - 1 */
#define PH   80
#define DY   (PY + PH + 3)                      /* the diagram */
#define DH   88
#define TY   (DY + DH + 1)                      /* R's walk: a band under it */
#define TH   4
#define SWAP(c) ((uint16_t)(((c) >> 8) | ((c) << 8)))   /* blit takes the high byte first */

static const uint16_t VC[BK_NV] = {
    HB_RGB(255, 210, 90), HB_RGB(90, 220, 255), HB_RGB(255, 120, 170), HB_RGB(150, 255, 120),
    HB_RGB(255, 160, 60), HB_RGB(180, 140, 255), HB_RGB(255, 255, 255), HB_RGB(120, 200, 160)};
static uint8_t terrain[240 * DH];               /* the diagram's density, by column */
static uint32_t cols_done;                      /* columns computed so far (the diagram builds up) */
static uint16_t colbuf[8 * DH], band[240 * TH], pcol[2 * PH];
static int32_t drawn_col = -1, drawn_hand = -1, trail[48], ntrail, trace_x;
static uint32_t last_ms, last_trail_ms;
static char line_a[40], line_b[40], line_t[48];

static int32_t col_of(int64_t R) { return bk_u_of_R(R) * 239 / BK_U_MAX; }   /* 32-bit: u * 239 < 2^31 */

static uint16_t terrain_px(int32_t c, int32_t row)              /* row 0 = top */
{
    uint32_t v = terrain[c * DH + (DH - 1 - row)];
    return v ? HB_RGB(v * 3u / 5u, v * 3u / 5u, v) : 0;
}

static void blit_cols(int32_t c0, int32_t w, int32_t cursor, int32_t hand, int dots)
{
    int32_t x, row, k, a;
    if (c0 < 0) { w += c0; c0 = 0; }
    if (c0 + w > 240) w = 240 - c0;
    if (w <= 0) return;
    for (row = 0; row < DH; row++)
        for (x = 0; x < w; x++) {
            int32_t c = c0 + x;
            uint16_t p = (uint32_t)c < cols_done ? terrain_px(c, row) : 0;
            if (c == hand && !(row % 3)) p = HB_RGB(110, 110, 110);
            if (c == cursor) p = HB_RGB(255, 80, 60);
            colbuf[row * w + x] = p;
        }
    if (dots)
        for (k = 0; k < (int32_t)BK_NV; k++) {
            uint32_t n = S.v[k].n < BK_HIST ? S.v[k].n : BK_HIST;
            int32_t xx = cursor - 1 + k % 3 - c0;
            if (!S.v[k].active || xx < 0 || xx >= w) continue;
            for (a = 0; a < (int32_t)n; a++) {
                int32_t r = DH - 1 - (int32_t)(((int64_t)S.v[k].x[a] * (DH - 1)) >> 30);
                if (r >= 0 && r < DH) colbuf[r * w + xx] = VC[k];
            }
            for (a = 0; a < S.par[BK_P_NPART]; a++) {   /* (the sines' maps now: the network's spread) */
                int32_t r = DH - 1 - (int32_t)(((int64_t)S.v[k].px[a] * (DH - 1)) >> 30);
                if (r >= 0 && r < DH) colbuf[r * w + xx] = HB_RGB(255, 255, 255);
            }
        }
    for (x = 0; x < w * DH; x++) colbuf[x] = SWAP(colbuf[x]);
    H->blit(c0, DY, w, DH, colbuf);
}

/* the pitch trace: one column a frame, a sweep across the screen (8 s), each sounding sine a dot */
static void trace_column(void)
{
    const int32_t span = (S.par[BK_P_CENTS] > 0 ? S.par[BK_P_CENTS] : 100) * 24 * (1 + S.par[BK_P_OCT]);   /* +-1.5 CENTS (and the octaves), Q4 */
    int32_t k, j, r;
    for (r = 0; r < 2 * PH; r++) pcol[r] = 0;
    pcol[PH / 2] = SWAP(HB_RGB(60, 60, 60));                   /* the key's pitch */
    for (k = 0; k < (int32_t)BK_NV; k++) {
        if (!S.v[k].active) continue;
        for (j = 0; j < S.par[BK_P_NPART]; j++) {
            if (!(S.v[k].gates >> j & 1u)) continue;
            r = PH / 2 - S.v[k].c[j] * (PH / 2) / span;
            if (r >= 0 && r < PH) pcol[r] = SWAP(VC[k]);
        }
    }
    H->blit(trace_x, PY, 1, PH, pcol);
    H->blit((trace_x + 1) % 240, PY, 1, PH, pcol + PH);        /* (the cursor: the next column cleared) */
    trace_x = (trace_x + 1) % 240;
}

static int period_of(uint32_t k)                /* the snapshot's pattern: 3 repeats and 8 steps more */
{
    uint32_t p, i, w;
    if (!S.v[k].active || S.v[k].n < 16u) return -1;
    for (p = 1; p <= 16u; p++) {
        w = 3u * p + 8u;
        if (w > BK_HIST - p) w = BK_HIST - p;
        if (S.v[k].n < w + p) return -1;
        for (i = 0; i < w; i++) {
            int32_t d = S.v[k].x[i] - S.v[k].x[i + p];
            if (d > 1024 || d < -1024) break;
        }
        if (i == w) return (int)p;
    }
    return 0;
}

/* the network now: clusters (maps within 0.01), and the spread: the entropy of the maps over 8 bins against
 * its most, 0 .. 99 */
static void network(int32_t *clusters, int32_t *spread)
{
    static const int32_t L2[65] = {0, 0, 100, 158, 200, 232, 258, 281, 300, 317, 332, 346, 358, 370, 381, 391, 400,
        409, 417, 425, 432, 439, 446, 452, 458, 464, 470, 475, 481, 486, 491, 495, 500, 504, 509, 513, 517, 521,
        525, 529, 532, 536, 539, 543, 546, 549, 552, 555, 558, 561, 564, 567, 570, 573, 575, 578, 581, 583, 586,
        588, 591, 593, 595, 598, 600};       /* 100 log2(i) */
    int32_t xs[BK_NV * BK_NPART], n = 0, i, j, c = 1, bins[8] = {0}, e = 0, m;
    uint32_t k;
    for (k = 0; k < BK_NV; k++)
        if (S.v[k].active)
            for (j = 0; j < S.par[BK_P_NPART]; j++) xs[n++] = S.v[k].px[j];
    for (i = 1; i < n; i++)
        for (j = i; j > 0 && xs[j] < xs[j - 1]; j--) { int32_t t = xs[j]; xs[j] = xs[j - 1]; xs[j - 1] = t; }
    for (i = 1; i < n; i++) if (xs[i] - xs[i - 1] > 10737418) c++;     /* 0.01, Q30 */
    for (i = 0; i < n; i++) bins[(uint32_t)xs[i] >> 27 & 7u]++;
    for (i = 0; i < 8; i++)                     /* n H = sum b (log2 n - log2 b), in hundredths of a bit */
        if (bins[i]) e += bins[i] * (L2[n] - L2[bins[i]]);
    m = n < 8 ? n : 8;
    *clusters = n ? c : 0;
    *spread = m > 1 ? e * 99 / (n * L2[m]) : 0;
}

static char *put_s(char *b, const char *s) { while (*s) *b++ = *s++; *b = 0; return b; }
static char *put_u(char *b, uint32_t v, int digits)            /* digits 0: as many as needed */
{
    char t[12];
    int n = 0;
    do { t[n++] = (char)('0' + v % 10u); v /= 10u; } while (v || n < digits);
    while (n) *b++ = t[--n];
    *b = 0;
    return b;
}
static char *put_fix(char *b, int32_t q16, int frac, int sign)   /* a Q16 value with frac decimals */
{
    uint32_t scale = frac == 4 ? 10000u : frac == 3 ? 1000u : frac == 2 ? 100u : 10u, a;
    if (q16 < 0) { *b++ = '-'; q16 = -q16; } else if (sign) *b++ = '+';
    a = (uint32_t)((((uint64_t)(uint32_t)q16 * scale) + 32768u) >> 16);
    b = put_u(b, a / scale, 1);
    *b++ = '.';
    return put_u(b, a % scale, frac);
}

static int same(const char *a, const char *b) { while (*a && *a == *b) a++, b++; return *a == *b; }
static void text_if(char *drawn, const char *s, int32_t y, uint16_t c)
{
    char *d = drawn;
    if (same(drawn, s)) return;
    while ((*d++ = *s++)) ;
    H->text(0, y, 240, 0, drawn, c, 1);
}

static void leds(void)
{
    H->led(HB_BTN_PLAY, S.par[BK_P_HOLD] ? 1u : 0u);
    H->led(HB_BTN_ARP, S.par[BK_P_CHOP] ? 1u : 0u);
    H->led(HB_BTN_SEQ, S.par[BK_P_D] ? 1u : 0u);
    H->led(HB_BTN_GLO, S.par[BK_P_TOPO] ? 1u : 0u);
    H->led(HB_BTN_EDIT, S.par[BK_P_FREEZE] ? 1u : 0u);
    H->led(HB_BTN_FX, S.par[BK_P_TIMBRE] ? 1u : 0u);
    H->led(HB_BTN_SEL, S.par[BK_P_MICRO] ? 1u : 0u);
    H->led(HB_BTN_LFO, S.par[BK_P_OCT] ? 1u : 0u);
    H->led(HB_BTN_REC, S.loop_state == BK_LOOP_REC ? 1u : S.loop_state == BK_LOOP_PLAY ? 2u : 0u);
}

static void draw(uint32_t full)
{
    static const char *const NN[12] = {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"};
    static const char *const GRID[5] = {"", " 1/4", " 1/8", " 1/16", " FREE"};
    static uint32_t led_state = 0xFFFFFFFFu;
    char s[48], *p;
    uint32_t now = H->ms(), k, ls;
    int32_t c, hand, i, per = -1, cl, sp, low = 999;
    for (k = 0; k < 14u; k++)                   /* a long press: the end of that state */
        if ((held >> k & 1u) && !(long_sent >> k & 1u) && now - held_since[k] >= 600u && BTN_OF[k] != 255u) {
            long_sent |= 1u << k;
            if (BTN_OF[k] != BK_BTN_MUTATE) push(Q_BTN, BTN_OF[k], 0);
        }
    if (full) {
        H->fill(0, 0, 240, 240, 0);
        drawn_col = drawn_hand = -1;
        line_a[0] = line_b[0] = line_t[0] = 1;  /* (no string equals it: drawn again) */
        line_a[1] = line_b[1] = line_t[1] = 0;
        led_state = 0xFFFFFFFFu;
        for (c = 0; c < (int32_t)cols_done; c += 8)
            blit_cols(c, 8, -1, -1, 0);
    }
    if (cols_done < 240u) {                     /* the diagram builds up, two columns a pass */
        uint16_t bins[DH];
        uint32_t j, b;
        for (j = 0; j < 2u && cols_done < 240u; j++) {
            c = (int32_t)cols_done;
            for (b = 0; b < DH; b++) bins[b] = 0;
            bk_diagram_column(bk_R_of_u(c * BK_U_MAX / 239), bins, DH, 500, 300);   /* 32-bit: c * u_max < 2^31 */
            for (b = 0; b < DH; b++) {
                uint32_t v = bins[b] ? 60u + bins[b] * 12u : 0u;
                terrain[c * DH + b] = (uint8_t)(v > 255u ? 255u : v);
            }
            cols_done++;
            blit_cols(c, 1, -1, -1, 0);
        }
    }
    if (now - last_ms < 33u)                    /* the rest ~30 times a second */
        return;
    last_ms = now;
    if (!snap_ready) { snap_req = 1; return; }
    snap_ready = 0;
    ls = (uint32_t)S.par[BK_P_HOLD] | (uint32_t)S.par[BK_P_CHOP] << 1 | (S.par[BK_P_D] ? 8u : 0u) | (uint32_t)S.par[BK_P_TOPO] << 4
       | (uint32_t)S.par[BK_P_FREEZE] << 6 | (uint32_t)S.par[BK_P_TIMBRE] << 7 | (uint32_t)S.par[BK_P_MICRO] << 8
       | (uint32_t)S.par[BK_P_OCT] << 11 | S.loop_state << 13;
    if (ls != led_state) { led_state = ls; leds(); }
#ifdef BK_DEBUG
    if (dbg_dump) {                             /* the knobs, R, the map's last 20 outputs */
        dbg_dump = 0;
        DBG("dbg dump KNOB1 detents", S.knob[BK_KNOB_R]);
        DBG("dbg dump u q16", S.par[BK_P_U]);
        DBG("dbg dump R q16", S.R >> 44);
        for (i = 19; i >= 0; i--) DBG("dbg x q30", S.v[0].x[i]);
    }
#endif
    trace_column();
    c = col_of(S.R);
    hand = col_of(S.R_hand);
    if (drawn_col >= 0 && (drawn_col != c || drawn_hand != hand)) {
        blit_cols(drawn_col - 1, 3, -1, -1, 0);                 /* where they were: the terrain again */
        if (drawn_hand >= 0) blit_cols(drawn_hand, 1, -1, -1, 0);
    }
    if (hand != c) blit_cols(hand, 1, c, hand, 0);
    blit_cols(c - 1, 3, c, hand, 1);
    drawn_col = c;
    drawn_hand = hand;
    if (now - last_trail_ms >= 100u) {          /* R's walk, the last 4.8 s */
        last_trail_ms = now;
        trail[ntrail++ % 48] = c;
        for (i = 0; i < 240 * TH; i++) band[i] = 0;
        for (i = 0; i < 48 && i < ntrail; i++) {
            int32_t t = trail[(ntrail - 1 - i) % 48], v = 255 - i * 5;
            band[(i * TH / 48) * 240 + t] = SWAP(HB_RGB(v, v / 2, v / 4));
        }
        H->blit(0, TY, 240, TH, band);
    }
    /* the top line: the lowest key, and what is on */
    for (k = 0; k < BK_NV; k++) if (S.v[k].active && S.v[k].note < 128u && S.v[k].note < low) low = S.v[k].note;
    if (low < 128) { p = put_s(s, NN[low % 12]); p = put_u(p, (uint32_t)(low / 12 - 1), 1); }
    else p = put_s(s, "BUNKI");
    if (S.par[BK_P_HOLD]) p = put_s(p, " HOLD");
    if (S.par[BK_P_CHOP] == BK_CHOP_ARP) p = put_s(p, " ARP");
    if (S.par[BK_P_D]) p = put_s(p, S.evdir > 0 ? " EVO+" : " EVO-");
    if (S.par[BK_P_TOPO] == BK_TOPO_GLOBAL) p = put_s(p, " ALL");
    if (S.par[BK_P_TOPO] == BK_TOPO_RING) { p = put_s(p, " RING"); p = put_u(p, (uint32_t)S.par[BK_P_STRIDE], 1); }
    if (S.par[BK_P_FREEZE]) p = put_s(p, " FRZ");
    p = put_s(p, GRID[S.par[BK_P_MICRO] & 7 ? (S.par[BK_P_MICRO] > 4 ? 4 : S.par[BK_P_MICRO]) : 0]);
    if (S.par[BK_P_OCT]) { p = put_s(p, " O"); p = put_u(p, (uint32_t)S.par[BK_P_OCT], 1); }
    if (S.par[BK_P_TIMBRE]) p = put_s(p, " FM");
    if (S.loop_state == BK_LOOP_REC) p = put_s(p, " REC");
    if (S.loop_state == BK_LOOP_PLAY) {         /* the loop's length in seconds */
        p = put_s(p, " L");
        p = put_fix(p, (int32_t)(((uint64_t)S.loop_len * 97391u) >> 8), 1, 0);   /* blocks * 256 / 44100 s, Q16 */
    }
    *p = 0;
    text_if(line_t, s, 0, HB_RGB(180, 140, 255));
    /* the numbers: R, the pattern (steps, seconds), clusters; then N, rate, cents, spread, lambda */
    for (k = 0; k < BK_NV && per < 0; k++) if (S.v[k].active) per = period_of(k);
    network(&cl, &sp);
    p = put_s(s, "R ");
    p = put_fix(p, (int32_t)(S.R >> 44), 4, 0);
    p = put_s(p, " P ");
    if (per < 0) p = put_s(p, "..");
    else if (per == 0) p = put_s(p, "~");
    else {
        p = put_u(p, (uint32_t)per, 1);
        *p++ = ' ';                             /* the pattern in seconds: per / rate */
        p = put_fix(p, (int32_t)(((uint32_t)per << 24) / (uint32_t)S.par[BK_P_RATE]), 2, 0);
        *p++ = 's';
    }
    p = put_s(p, " C");
    put_u(p, (uint32_t)cl, 1);
    text_if(line_a, s, 202, HB_RGB(230, 230, 230));
    p = put_s(s, "N");
    p = put_u(p, (uint32_t)S.par[BK_P_NPART], 1);
    *p++ = ' ';
    p = put_fix(p, S.par[BK_P_RATE] << 8, 1, 0);
    p = put_s(p, "Hz ");
    p = put_u(p, (uint32_t)S.par[BK_P_CENTS], 1);
    p = put_s(p, "c E");
    p = put_u(p, (uint32_t)sp, 2);
    p = put_s(p, " L");
    put_fix(p, S.lyap, 2, 1);
    text_if(line_b, s, 222, S.lyap > 0 ? HB_RGB(255, 120, 100) : HB_RGB(120, 220, 160));
}

static int init(const hb_host_t *h)
{
    uint32_t k;
    H = h;
    bk_init(&E, 1);
    bk_perf_init(&E);
    if (!H->load(&rec, sizeof rec) && rec.magic == REC_MAGIC) {   /* (the engine is the main loop's until render runs) */
        for (k = 0; k < BK_NKNOBS; k++)
            if (rec.knob[k]) bk_input(&E, BK_IN_KNOB, k, rec.knob[k]);
        for (k = 0; k < 10u; k++) bk_set(&E, REC_PAR[k], rec.par[k]);
    }
    for (k = 0; k < BK_NPARAMS; k++) S.par[k] = E.par[k];
    H->log("bunki: ready");
    return 0;
}

static void release(void)
{
    push(Q_OFF, 0, 0);
}

HB_DESC = {HB_ABI, "BUNKI", init, release, note, cc, render, ui, draw, 0, 0, HB_F_SCREEN, 0};
