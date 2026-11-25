/* SPDX-License-Identifier: GPL-3.0-only */
/* BUNKI for fm1-dock: one note walks the logistic map's bifurcation diagram (the engine: bunki/core).
 *
 *   keys / MIDI     up to 8 voices; one key alone starts as a pure sine
 *   KNOB1           R, coarse (one unit of the knob = one period doubling; faster turns go further)
 *   SELECT          R, fine
 *   KNOB2           D: R walks by itself (0: R is the knob's)
 *   KNOB3           eps: the voices pull on each other
 *   KNOB4           C: the two paths cooperate (+) or compete (-) (path BOTH)
 *   ALGORITHM       the path: MAP, FB-T (period-delayed feedback), BOTH, FB-1 (DX7-style, for comparison)
 *   PRESETS         the index's gain
 *   SEL             lift: LIN / SQRT        FX    modulator ratio 1, 2, 3
 *   ENV / LFO       seed - / +              SAVE  keep these settings
 *   MIDI CC 16+48   R, 14-bit (u 0..22)     CC 17 D, CC 18 eps, CC 19 C (0..127)
 *
 * Threads: note(), cc(), ui() and draw() run in the main loop, render() in the audio interrupt. The main
 * loop never touches the engine. A control's newest value waits in a slot (a value and a count, the count
 * written last); notes wait in a queue. At the start of its block render() takes the controls that
 * changed, then the notes, as the desktop host applies a script (the same events at the same blocks give
 * the same bits; fm1/sim checks it). For the screen, render() copies what draw() needs when asked. */
#include "hb_module.h"
#include "bunki.h"

static const hb_host_t *H;
static bk_engine_t E;

/* ---- main loop -> render: the controls' newest values, and a queue for the notes ---- */
static volatile int32_t pv[BK_NPARAMS];
static volatile uint32_t pcount[BK_NPARAMS];
static uint32_t ptaken[BK_NPARAMS];             /* render's */
#define QN 64u
enum { Q_NOTE = 1, Q_OFF };
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
    int32_t lyap;
    struct { uint8_t active, note; uint32_t nper; int32_t x[BK_HIST]; } v[BK_NV];
} snap_t;
static snap_t S;
static volatile uint32_t snap_req, snap_ready;

static void render(int32_t *out, uint32_t n)
{
    uint32_t r = q_r, k, a;
    for (k = 0; k < BK_NPARAMS; k++) {          /* the controls first, then the notes */
        const uint32_t c = pcount[k];
        if (c != ptaken[k]) {
            ptaken[k] = c;
            bk_set(&E, k, pv[k]);
        }
    }
    while (r != q_w) {
        const uint32_t i = r % QN;
        if (q[i].type == Q_NOTE) bk_note(&E, q[i].a, (uint32_t)q[i].v);
        else if (q[i].type == Q_OFF) {
            bk_all_off(&E);
            for (k = 0; k < BK_NV; k++) E.v[k].active = 0, E.v[k].amp = 0;
        }
        r++;
    }
    q_r = r;
    bk_render(&E, out, n);
    if (snap_req) {
        S.R = E.R;
        S.R_hand = E.R_hand;
        S.lyap = E.lyap;
        for (k = 0; k < BK_NV; k++) {
            const bk_voice_t *v = &E.v[k];
            S.v[k].active = v->active;
            S.v[k].note = v->note;
            S.v[k].nper = v->nper;
            for (a = 0; a < BK_HIST; a++)
                S.v[k].x[a] = v->hist[(v->nper - 1u - a) & (BK_HIST - 1u)];
        }
        snap_req = 0;
        snap_ready = 1;
    }
}

/* ---- the controls, as the main loop keeps them ---- */
static struct {
    uint32_t magic;
    int32_t u, D, eps, C, path, lift, ratio, gain, seed;
} st;
#define REC_MAGIC 0x424E4B31u                   /* "BNK1" */

static void set(uint32_t p, int32_t v)
{
    pv[p] = v;
    pcount[p] = pcount[p] + 1u;                 /* the value first, then the count */
}

static void apply_all(void)
{
    set(BK_P_SEED, st.seed);
    set(BK_P_U, st.u);
    set(BK_P_D, st.D);
    set(BK_P_EPS, st.eps);
    set(BK_P_C, st.C);
    set(BK_P_PATH, st.path);
    set(BK_P_LIFT, st.lift);
    set(BK_P_RATIO, st.ratio);
    set(BK_P_GAIN, st.gain);
}

static int32_t clampi(int32_t v, int32_t lo, int32_t hi) { return v < lo ? lo : v > hi ? hi : v; }

static void note(uint32_t ch, uint32_t key, uint32_t vel)
{
    (void)ch;
    push(Q_NOTE, key, (int32_t)vel);
}

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
    switch (num) {
    case 17: st.D = (int32_t)(val * 516u); set(BK_P_D, st.D); break;            /* 127 -> 65532 */
    case 18: st.eps = (int32_t)(val * 516u); set(BK_P_EPS, st.eps); break;
    case 19: st.C = (int32_t)val * 1032 - 65536; set(BK_P_C, st.C); break;      /* 0 -> -1, 127 -> +1 */
    case 120: case 123: push(Q_OFF, 0, 0); break;
    default: break;
    }
}

static void ui(uint32_t ev, int32_t arg)
{
    const uint32_t id = HB_EV_ID(ev);
    if (HB_EV_KIND(ev) == HB_EV_ENC) {
        int32_t a = arg < 0 ? -arg : arg;
        switch (id) {
        case HB_ENC_KNOB1:                      /* 1/16 unit a click, more when turned fast */
            st.u = clampi(st.u + arg * 4096 * (a > 3 ? 4 : a > 1 ? 2 : 1), 0, BK_U_MAX); set(BK_P_U, st.u); break;
        case HB_ENC_SELECT:                     /* 1/512 unit a click */
            st.u = clampi(st.u + arg * 128, 0, BK_U_MAX); set(BK_P_U, st.u); break;
        case HB_ENC_KNOB2: st.D = clampi(st.D + arg * 1024, 0, 65536); set(BK_P_D, st.D); break;
        case HB_ENC_KNOB3: st.eps = clampi(st.eps + arg * 656, 0, 65536); set(BK_P_EPS, st.eps); break;
        case HB_ENC_KNOB4: st.C = clampi(st.C + arg * 1311, -65536, 65536); set(BK_P_C, st.C); break;
        case HB_ENC_ALGORITHM: st.path = (st.path + arg % BK_NPATHS + BK_NPATHS) % BK_NPATHS; set(BK_P_PATH, st.path); break;
        case HB_ENC_PRESETS: st.gain = clampi(st.gain + arg * 32, 64, 2048); set(BK_P_GAIN, st.gain); break;
        default: break;
        }
    } else if (HB_EV_KIND(ev) == HB_EV_BTN_DOWN) {
        switch (id) {
        case HB_BTN_SEL: st.lift = !st.lift; set(BK_P_LIFT, st.lift); break;
        case HB_BTN_FX: st.ratio = st.ratio % 3 + 1; set(BK_P_RATIO, st.ratio); break;
        case HB_BTN_ENV: st.seed--; set(BK_P_SEED, st.seed); break;
        case HB_BTN_LFO: st.seed++; set(BK_P_SEED, st.seed); break;
        case HB_BTN_SAVE: st.magic = REC_MAGIC; H->save(&st, sizeof st); break;
        default: break;
        }
    }
}

/* ---- the screen ---- */
#define DY   18                                 /* the diagram: rows DY .. DY + DH - 1 */
#define DH   174
#define TY   (DY + DH + 1)                      /* R's walk: a band under it */
#define TH   5
#define SWAP(c) ((uint16_t)(((c) >> 8) | ((c) << 8)))   /* blit takes the high byte first */

static uint8_t terrain[240 * DH];               /* the diagram's density, by column */
static uint32_t cols_done;                      /* columns computed so far (the diagram builds up) */
static uint16_t colbuf[8 * DH], band[240 * TH];   /* up to 8 columns at once */
static int32_t drawn_col = -1, drawn_hand = -1, trail[48], ntrail;
static uint32_t last_ms, last_trail_ms;
static char line_a[40], line_b[40], line_t[40];

static int32_t col_of(int64_t R) { return bk_u_of_R(R) * 239 / BK_U_MAX; }   /* 32-bit: u * 239 < 2^31 */

static uint16_t terrain_px(int32_t c, int32_t row)              /* row 0 = top */
{
    uint32_t v = terrain[c * DH + (DH - 1 - row)];
    return v ? HB_RGB(v * 3u / 5u, v * 3u / 5u, v) : 0;
}

static void blit_cols(int32_t c0, int32_t w, int32_t cursor, int32_t hand, int dots)
{
    static const uint16_t VC[BK_NV] = {
        HB_RGB(255, 210, 90), HB_RGB(90, 220, 255), HB_RGB(255, 120, 170), HB_RGB(150, 255, 120),
        HB_RGB(255, 160, 60), HB_RGB(180, 140, 255), HB_RGB(255, 255, 255), HB_RGB(120, 200, 160)};
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
            uint32_t n = S.v[k].nper < BK_HIST ? S.v[k].nper : BK_HIST;
            if (!S.v[k].active) continue;
            for (a = 0; a < (int32_t)n; a++) {
                int32_t r = DH - 1 - (int32_t)(((int64_t)S.v[k].x[a] * (DH - 1)) >> 30), xx = cursor - 1 + k % 3 - c0;
                if (r >= 0 && r < DH && xx >= 0 && xx < w) colbuf[r * w + xx] = VC[k];
            }
        }
    for (x = 0; x < w * DH; x++) colbuf[x] = SWAP(colbuf[x]);
    H->blit(c0, DY, w, DH, colbuf);
}

static int period_of(uint32_t k)                /* bk_voice_period on the snapshot */
{
    uint32_t p, i;
    if (!S.v[k].active || S.v[k].nper < BK_HIST) return -1;
    for (p = 1; p <= 32u; p++) {
        for (i = 0; i + p < BK_HIST; i++) {
            int32_t d = S.v[k].x[i] - S.v[k].x[i + p];
            if (d > 1024 || d < -1024) break;
        }
        if (i + p >= BK_HIST) return (int)p;
    }
    return 0;
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
    static const char *const PATH[BK_NPATHS] = {"MAP", "FB-T", "BOTH", "FB-1"};
    char s[48], *p;
    uint32_t now = H->ms(), k;
    int32_t c, hand, i;
    if (full) {
        H->fill(0, 0, 240, 240, 0);
        drawn_col = drawn_hand = -1;
        line_a[0] = line_b[0] = line_t[0] = 1;  /* (no string equals it: drawn again) */
        line_a[1] = line_b[1] = line_t[1] = 0;
        for (c = 0; c < (int32_t)cols_done; c += 8)
            blit_cols(c, 8, -1, -1, 0);
        for (i = 1; i <= 6; i++)                /* the doubling points: ticks over the diagram */
            H->fill((i << 16) * 239 / BK_U_MAX, DY - 3, 1, 3, HB_RGB(120, 120, 120));
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
            uint16_t col = SWAP(HB_RGB(v, v / 2, v / 4));
            band[(i * TH / 48) * 240 + t] = col;
        }
        H->blit(0, TY, 240, TH, band);
    }
    /* the text: top the path and the sound's settings; bottom R, the periods, lambda; then D eps C */
    p = put_s(s, "BUNKI  ");
    p = put_s(p, PATH[st.path]);
    p = put_s(p, st.lift ? "  SQRT  1:" : "  LIN  1:");
    p = put_u(p, (uint32_t)st.ratio, 1);
    p = put_s(p, "  #");
    put_u(p, (uint32_t)st.seed & 0xFFFFu, 1);
    text_if(line_t, s, 0, HB_RGB(180, 140, 255));
    p = put_s(s, "R ");
    p = put_fix(p, (int32_t)(S.R >> 44), 4, 0);
    p = put_s(p, "  P");
    for (k = 0, i = 0; k < BK_NV && i < 4; k++) {
        int per = period_of(k);
        if (!S.v[k].active) continue;
        *p++ = ' ';
        if (per < 0) p = put_s(p, ".");
        else if (per == 0) p = put_s(p, "~");
        else p = put_u(p, (uint32_t)per, 1);
        i++;
    }
    *p = 0;
    text_if(line_a, s, 200, HB_RGB(230, 230, 230));
    p = put_s(s, "L ");
    p = put_fix(p, S.lyap, 2, 1);
    p = put_s(p, " D");
    p = put_fix(p, st.D, 2, 0);
    p = put_s(p, " E");
    p = put_fix(p, st.eps, 2, 0);
    p = put_s(p, " C");
    put_fix(p, st.C, 1, 1);
    text_if(line_b, s, 220, S.lyap > 0 ? HB_RGB(255, 120, 100) : HB_RGB(120, 220, 160));
}

static int init(const hb_host_t *h)
{
    H = h;
    bk_init(&E, 1);
    if (H->load(&st, sizeof st) || st.magic != REC_MAGIC) {
        st.magic = REC_MAGIC;
        st.u = 1 << 15;                         /* u 0.5: a pure sine */
        st.D = st.eps = st.C = 0;
        st.path = BK_PATH_MAP;
        st.lift = BK_LIFT_LINEAR;
        st.ratio = 1;
        st.gain = 4 << 8;
        st.seed = 1;
    }
    apply_all();
    H->log("bunki: ready");
    return 0;
}

static void release(void)
{
    push(Q_OFF, 0, 0);
}

HB_DESC = {HB_ABI, "BUNKI", init, release, note, cc, render, ui, draw, 0, 0, HB_F_SCREEN, 0};
