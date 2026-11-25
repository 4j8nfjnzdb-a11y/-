/* SPDX-License-Identifier: GPL-3.0-only */
/* BUNKI for fm1-dock: a note is a network of sines, each one a logistic map stepped by one clock; R walks the
 * maps' bifurcation diagram, and the map's numbers are heard: period 2 a two-note figure, 4 a four-note one,
 * chaos a line that never comes back and a sine that splits into many, a window a sudden three-note figure.
 * (The engine: bunki/core.)
 *
 *   keys / MIDI   up to 8 voices; one key alone at the start is a pure sine
 *   KNOB1         R, coarse (one unit = one period doubling; fast turns go further)     SELECT  R, fine
 *   KNOB2         RATE: the step clock, 0.25 .. 64 steps a second (12 detents an octave)
 *   KNOB3         eps: how hard the sines pull on each other (one line, groups, each its own way)
 *   KNOB4         CENTS: how far a step can move a pitch
 *   ALGORITHM     N: sines a voice (1 .. 8)                                            PRESETS GLIDE
 *   PLAY  HOLD    keys let go sound on                ARP   CHOP: OFF, GATE (the map opens and shuts each
 *                                                           sine), ARP (one sine a step: the highest)
 *   SEQ   EVOLVE  R climbs by itself (OFF, SLOW, FAST), lingers in windows, collapses back to the knob
 *   GLO   TOPO    who pulls on whom: within a voice, all, a ring                   EDIT  FREEZE the clock
 *   REC   MUTATE  a nudge to every sine                FX    TIMBRE: the map at the period, as FM, as well
 *   SEL   the timbre's lift   ENV / LFO  seed - / +    SAVE  keep these settings
 *   MIDI          CC 16 + 48 R (14 bits); 17 RATE, 18 eps, 19 CENTS, 20 N, 21 GLIDE; 64 HOLD; fm1-dock's
 *                 KNOBS CC (74, 71, 73, 72) as KNOB1 .. 4
 *
 * Threads: note(), cc(), ui() and draw() run in the main loop, render() in the audio interrupt. The main loop
 * never touches the engine. A control's newest value waits in a slot (a value and a count, the count written
 * last); notes wait in a queue. At the start of its block render() takes the controls that changed, then the
 * queue, as the desktop host applies a script: the same events at the same blocks give the same bits
 * (fm1/sim checks it). For the screen, render() copies what draw() needs when asked. */
#include "hb_module.h"
#include "bunki.h"

static const hb_host_t *H;
static bk_engine_t E;

/* ---- main loop -> render: the controls' newest values, and a queue for the notes ---- */
static volatile int32_t pv[BK_NPARAMS];
static volatile uint32_t pcount[BK_NPARAMS];
static uint32_t ptaken[BK_NPARAMS];             /* render's */
#define QN 64u
enum { Q_NOTE = 1, Q_OFF, Q_MUTATE };
static struct { uint8_t type, a; int32_t v; } q[QN];
static volatile uint32_t q_w, q_r;

static void push(uint32_t type, uint32_t a, int32_t v)
{
    uint32_t w = q_w;
    if (w - q_r >= QN)
        return;                                 /* full: render has not run for a while; drop it */
    q[w % QN].type = (uint8_t)type;
    q[w % QN].a = (uint8_t)a;
    q[w % QN].v = v;
    q_w = w + 1u;                               /* the slot first, then the index */
}

/* ---- render -> draw: a snapshot on request ---- */
typedef struct {
    int64_t R, R_hand;
    int32_t lyap, I1;
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
    for (k = 0; k < BK_NPARAMS; k++) {          /* the controls first, then the queue */
        const uint32_t c = pcount[k];
        if (c != ptaken[k]) {
            ptaken[k] = c;
            bk_set(&E, k, pv[k]);
        }
    }
    while (r != q_w) {
        const uint32_t i = r % QN;
        if (q[i].type == Q_NOTE) bk_note(&E, q[i].a, (uint32_t)q[i].v);
        else if (q[i].type == Q_MUTATE) bk_mutate(&E);
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

/* ---- the controls, as the main loop keeps them (and the settings record) ---- */
static struct {
    uint32_t magic;
    int32_t u, evo, eps, lift, gain, seed;
    int32_t npart, rate, cents, glide, chop, hold, topo, timbre;
} st;
#define REC_MAGIC 0x424E4B32u                   /* "BNK2" */
static int32_t freeze;
static const int32_t EVO[3] = {0, 16384, 65536};               /* EVOLVE: off, slow (~3 min up), fast (~45 s) */
static const uint32_t SEMI[12] = {65536, 69433, 73562, 77936, 82570, 87480, 92682, 98193, 104032, 110218, 116772, 123715};

static int32_t rate_q8(int32_t r) { return (int32_t)(((64u << (r / 12)) * SEMI[r % 12]) >> 16); }   /* 0.25 Hz * 2^(r/12) */

static void set(uint32_t p, int32_t v)
{
    pv[p] = v;
    pcount[p] = pcount[p] + 1u;                 /* the value first, then the count */
}

static void leds(void)
{
    H->led(HB_BTN_PLAY, st.hold ? 1u : 0u);
    H->led(HB_BTN_ARP, st.chop ? 1u : 0u);
    H->led(HB_BTN_SEQ, st.evo ? 1u : 0u);
    H->led(HB_BTN_GLO, st.topo ? 1u : 0u);
    H->led(HB_BTN_EDIT, freeze ? 1u : 0u);
    H->led(HB_BTN_FX, st.timbre ? 1u : 0u);
}

static void apply_all(void)
{
    set(BK_P_SEED, st.seed);
    set(BK_P_U, st.u);
    set(BK_P_D, EVO[st.evo]);
    set(BK_P_EPS, st.eps);
    set(BK_P_LIFT, st.lift);
    set(BK_P_GAIN, st.gain);
    set(BK_P_NPART, st.npart);
    set(BK_P_RATE, rate_q8(st.rate));
    set(BK_P_CENTS, st.cents);
    set(BK_P_GLIDE, st.glide);
    set(BK_P_CHOP, st.chop);
    set(BK_P_HOLD, st.hold);
    set(BK_P_TOPO, st.topo);
    set(BK_P_TIMBRE, st.timbre);
    set(BK_P_FREEZE, freeze);
}

static int32_t clampi(int32_t v, int32_t lo, int32_t hi) { return v < lo ? lo : v > hi ? hi : v; }

static void note(uint32_t ch, uint32_t key, uint32_t vel)
{
    (void)ch;
    push(Q_NOTE, key, (int32_t)vel);
}

#ifdef BK_DEBUG
static uint32_t dbg_dump, dbg_force, dbg_events;
static int32_t dbg_clicks;
#define DBG(s, v) H->log_u32(s, (uint32_t)(v))
#else
#define DBG(s, v) ((void)0)
#endif

static void ui(uint32_t ev, int32_t arg);
static uint32_t cc_msb16;
static void cc(uint32_t ch, uint32_t num, uint32_t val)
{
    (void)ch;
    if (num == 16u || num == 48u) {             /* R, 14 bits: the MSB alone sets it with LSB 0 */
        uint32_t v14;
        if (num == 16u) cc_msb16 = val;
        v14 = cc_msb16 << 7 | (num == 48u ? val : 0u);
        st.u = (int32_t)(v14 * 22u * 4096u / 16383u * 16u);     /* < 2^32 before the division */
        set(BK_P_U, st.u);
        return;
    }
    if (num == 74u || num == 71u || num == 73u || num == 72u) {   /* fm1-dock's KNOBS CC: the knobs come as CCs */
        static uint32_t last[4] = {64u, 64u, 64u, 64u};
        const uint32_t k = num == 74u ? 0u : num == 71u ? 1u : num == 73u ? 2u : 3u;
        const int32_t clicks = (int32_t)val - (int32_t)last[k];
        last[k] = val;
        if (clicks)
            ui(HB_EV_ENC | (HB_ENC_KNOB1 + k), clicks);
        return;
    }
    switch (num) {
    case 17: st.rate = (int32_t)(val * 96u / 127u); set(BK_P_RATE, rate_q8(st.rate)); break;
    case 18: st.eps = (int32_t)(val * 516u); set(BK_P_EPS, st.eps); break;            /* 127 -> 65532 */
    case 19: st.cents = (int32_t)(val * 2400u / 127u); set(BK_P_CENTS, st.cents); break;
    case 20: st.npart = 1 + (int32_t)(val * 7u / 127u); set(BK_P_NPART, st.npart); break;
    case 21: st.glide = (int32_t)(val * 516u); set(BK_P_GLIDE, st.glide); break;
    case 64: st.hold = val >= 64u; set(BK_P_HOLD, st.hold); leds(); break;     /* the sustain pedal */
    case 120: case 123: push(Q_OFF, 0, 0); break;
    default: break;
    }
}

static void ui(uint32_t ev, int32_t arg)
{
    const uint32_t id = HB_EV_ID(ev);
#ifdef BK_DEBUG
    if (HB_EV_KIND(ev) == HB_EV_ENC && id == HB_ENC_KNOB1) { dbg_events++; dbg_clicks += arg; }
    if (HB_EV_KIND(ev) == HB_EV_BTN_DOWN && id == HB_BTN_EDIT) { dbg_dump = 1; return; }
    if (HB_EV_KIND(ev) == HB_EV_BTN_DOWN && id == HB_BTN_GLO) { dbg_force ^= 1u; set(BK_P_FORCE, (int32_t)dbg_force); DBG("dbg force", dbg_force); return; }
#endif
    if (HB_EV_KIND(ev) == HB_EV_ENC) {
        int32_t a = arg < 0 ? -arg : arg;
        switch (id) {
        case HB_ENC_KNOB1:                      /* 1/16 unit a click, more when turned fast */
            st.u = clampi(st.u + arg * 4096 * (a > 3 ? 4 : a > 1 ? 2 : 1), 0, BK_U_MAX); set(BK_P_U, st.u); break;
        case HB_ENC_SELECT:                     /* 1/512 unit a click */
            st.u = clampi(st.u + arg * 128, 0, BK_U_MAX); set(BK_P_U, st.u); break;
        case HB_ENC_KNOB2: st.rate = clampi(st.rate + arg, 0, 96); set(BK_P_RATE, rate_q8(st.rate)); break;
        case HB_ENC_KNOB3: st.eps = clampi(st.eps + arg * 656, 0, 65536); set(BK_P_EPS, st.eps); break;
        case HB_ENC_KNOB4: st.cents = clampi(st.cents + arg * 25, 0, 2400); set(BK_P_CENTS, st.cents); break;
        case HB_ENC_ALGORITHM: st.npart = clampi(st.npart + arg, 1, (int32_t)BK_NPART); set(BK_P_NPART, st.npart); break;
        case HB_ENC_PRESETS: st.glide = clampi(st.glide + arg * 4096, 0, 65536); set(BK_P_GLIDE, st.glide); break;
        default: break;
        }
    } else if (HB_EV_KIND(ev) == HB_EV_BTN_DOWN) {
        switch (id) {
        case HB_BTN_PLAY: st.hold = !st.hold; set(BK_P_HOLD, st.hold); break;
        case HB_BTN_ARP: st.chop = (st.chop + 1) % BK_NCHOPS; set(BK_P_CHOP, st.chop); break;
        case HB_BTN_SEQ: st.evo = (st.evo + 1) % 3; set(BK_P_D, EVO[st.evo]); break;
        case HB_BTN_GLO: st.topo = (st.topo + 1) % BK_NTOPOS; set(BK_P_TOPO, st.topo); break;
        case HB_BTN_EDIT: freeze = !freeze; set(BK_P_FREEZE, freeze); break;
        case HB_BTN_REC: push(Q_MUTATE, 0, 0); break;
        case HB_BTN_FX: st.timbre = !st.timbre; set(BK_P_TIMBRE, st.timbre); break;
        case HB_BTN_SEL: st.lift = !st.lift; set(BK_P_LIFT, st.lift); break;
        case HB_BTN_ENV: st.seed--; set(BK_P_SEED, st.seed); break;
        case HB_BTN_LFO: st.seed++; set(BK_P_SEED, st.seed); break;
        case HB_BTN_SAVE: st.magic = REC_MAGIC; H->save(&st, sizeof st); break;
        default: break;
        }
        leds();
    }
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
            for (a = 0; a < st.npart; a++) {   /* (the sines' maps now: the network's spread) */
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
    const int32_t span = (st.cents > 0 ? st.cents : 100) * 24;   /* +-1.5 CENTS, Q4, fills the height */
    int32_t k, j, r;
    for (r = 0; r < 2 * PH; r++) pcol[r] = 0;
    pcol[PH / 2] = SWAP(HB_RGB(60, 60, 60));                   /* the key's pitch */
    for (k = 0; k < (int32_t)BK_NV; k++) {
        if (!S.v[k].active) continue;
        for (j = 0; j < st.npart; j++) {
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
            for (j = 0; j < st.npart; j++) xs[n++] = S.v[k].px[j];
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

static void draw(uint32_t full)
{
    static const char *const CHOP[BK_NCHOPS] = {"", " GATE", " ARP"}, *const TOPO[BK_NTOPOS] = {"", " ALL", " RING"},
                             *const EV[3] = {"", " EVO", " EVO+"};
    char s[48], *p;
    uint32_t now = H->ms(), k;
    int32_t c, hand, i, per = -1, cl, sp;
    if (full) {
        H->fill(0, 0, 240, 240, 0);
        drawn_col = drawn_hand = -1;
        line_a[0] = line_b[0] = line_t[0] = 1;  /* (no string equals it: drawn again) */
        line_a[1] = line_b[1] = line_t[1] = 0;
        for (c = 0; c < (int32_t)cols_done; c += 8)
            blit_cols(c, 8, -1, -1, 0);
        leds();
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
#ifdef BK_DEBUG
    if (dbg_dump) {                             /* the knob so far, u, R, the index, the map's last 20 outputs */
        dbg_dump = 0;
        DBG("dbg dump KNOB1 events", dbg_events);
        DBG("dbg dump KNOB1 clicks", dbg_clicks);
        DBG("dbg dump u q16", st.u);
        DBG("dbg dump R q16", S.R >> 44);
        DBG("dbg dump I1 (cycles q15)", S.I1);
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
    /* the top line: what is on */
    p = put_s(s, st.hold ? "HOLD" : "BUNKI");
    p = put_s(p, CHOP[st.chop]);
    p = put_s(p, EV[st.evo]);
    p = put_s(p, TOPO[st.topo]);
    if (freeze) p = put_s(p, " FRZ");
    if (st.timbre) p = put_s(p, " FM");
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
        p = put_fix(p, (int32_t)(((uint32_t)per << 24) / (uint32_t)rate_q8(st.rate)), 2, 0);
        *p++ = 's';
    }
    p = put_s(p, " C");
    put_u(p, (uint32_t)cl, 1);
    text_if(line_a, s, 202, HB_RGB(230, 230, 230));
    p = put_s(s, "N");
    p = put_u(p, (uint32_t)st.npart, 1);
    *p++ = ' ';
    p = put_fix(p, rate_q8(st.rate) << 8, 1, 0);
    p = put_s(p, "Hz ");
    p = put_u(p, (uint32_t)st.cents, 1);
    p = put_s(p, "c E");
    p = put_u(p, (uint32_t)sp, 2);
    p = put_s(p, " L");
    put_fix(p, S.lyap, 2, 1);
    text_if(line_b, s, 222, S.lyap > 0 ? HB_RGB(255, 120, 100) : HB_RGB(120, 220, 160));
}

static int init(const hb_host_t *h)
{
    H = h;
    bk_init(&E, 1);
    if (H->load(&st, sizeof st) || st.magic != REC_MAGIC) {
        st.magic = REC_MAGIC;
        st.u = 1 << 15;                         /* u 0.5: a pure sine */
        st.evo = 0;
        st.eps = 0;
        st.lift = BK_LIFT_LINEAR;
        st.gain = 4 << 8;
        st.seed = 1;
        st.npart = 4;
        st.rate = 48;                           /* 4 steps a second */
        st.cents = 700;
        st.glide = 49152;
        st.chop = BK_CHOP_OFF;
        st.hold = 0;
        st.topo = BK_TOPO_LOCAL;
        st.timbre = 0;
    }
    freeze = 0;
    apply_all();
    H->log("bunki: ready");
    return 0;
}

static void release(void)
{
    push(Q_OFF, 0, 0);
}

HB_DESC = {HB_ABI, "BUNKI", init, release, note, cc, render, ui, draw, 0, 0, HB_F_SCREEN, 0};
