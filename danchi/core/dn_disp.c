/*
 * 240x240 RGB565 screen for the device, drawn band by band:
 *   dn_draw_rows(s, buf, y0, n) fills rows y0..y0+n-1 (240 px each) of the
 *   screen into buf. A host can draw 8 or 16 rows at a time (no framebuffer
 *   needed) or the whole screen at once.
 *
 *   header   phase, bars left, object, tempo
 *   meters   ERASE and PUSH: measured (bar) and wanted (tick)
 *   lanes    16 units x one bar: grid step (dim tick) -> where it sounded
 *            (block); orange = early, blue = late; '<' marks a push
 *   ops      8 operators: kind, unit, energy, last reward
 *   footer   motion recorder / hand stop / vacant room
 */
#include "danchi.h"
#include "dn_math.h"

#define W DN_SCREEN
#define C565(r, g, b) (uint16_t)((((r) & 0xF8) << 8) | (((g) & 0xFC) << 3) | ((b) >> 3))

static const uint8_t FONT[64][5] = {
    {0x00,0x00,0x00,0x00,0x00},{0x00,0x00,0x5F,0x00,0x00},{0x00,0x07,0x00,0x07,0x00},{0x14,0x7F,0x14,0x7F,0x14},
    {0x24,0x2A,0x7F,0x2A,0x12},{0x23,0x13,0x08,0x64,0x62},{0x36,0x49,0x55,0x22,0x50},{0x00,0x05,0x03,0x00,0x00},
    {0x00,0x1C,0x22,0x41,0x00},{0x00,0x41,0x22,0x1C,0x00},{0x08,0x2A,0x1C,0x2A,0x08},{0x08,0x08,0x3E,0x08,0x08},
    {0x00,0x50,0x30,0x00,0x00},{0x08,0x08,0x08,0x08,0x08},{0x00,0x60,0x60,0x00,0x00},{0x20,0x10,0x08,0x04,0x02},
    {0x3E,0x51,0x49,0x45,0x3E},{0x00,0x42,0x7F,0x40,0x00},{0x42,0x61,0x51,0x49,0x46},{0x21,0x41,0x45,0x4B,0x31},
    {0x18,0x14,0x12,0x7F,0x10},{0x27,0x45,0x45,0x45,0x39},{0x3C,0x4A,0x49,0x49,0x30},{0x01,0x71,0x09,0x05,0x03},
    {0x36,0x49,0x49,0x49,0x36},{0x06,0x49,0x49,0x29,0x1E},{0x00,0x36,0x36,0x00,0x00},{0x00,0x56,0x36,0x00,0x00},
    {0x00,0x08,0x14,0x22,0x41},{0x14,0x14,0x14,0x14,0x14},{0x41,0x22,0x14,0x08,0x00},{0x02,0x01,0x51,0x09,0x06},
    {0x32,0x49,0x79,0x41,0x3E},{0x7E,0x11,0x11,0x11,0x7E},{0x7F,0x49,0x49,0x49,0x36},{0x3E,0x41,0x41,0x41,0x22},
    {0x7F,0x41,0x41,0x22,0x1C},{0x7F,0x49,0x49,0x49,0x41},{0x7F,0x09,0x09,0x01,0x01},{0x3E,0x41,0x41,0x51,0x32},
    {0x7F,0x08,0x08,0x08,0x7F},{0x00,0x41,0x7F,0x41,0x00},{0x20,0x40,0x41,0x3F,0x01},{0x7F,0x08,0x14,0x22,0x41},
    {0x7F,0x40,0x40,0x40,0x40},{0x7F,0x02,0x04,0x02,0x7F},{0x7F,0x04,0x08,0x10,0x7F},{0x3E,0x41,0x41,0x41,0x3E},
    {0x7F,0x09,0x09,0x09,0x06},{0x3E,0x41,0x51,0x21,0x5E},{0x7F,0x09,0x19,0x29,0x46},{0x46,0x49,0x49,0x49,0x31},
    {0x01,0x01,0x7F,0x01,0x01},{0x3F,0x40,0x40,0x40,0x3F},{0x1F,0x20,0x40,0x20,0x1F},{0x7F,0x20,0x18,0x20,0x7F},
    {0x63,0x14,0x08,0x14,0x63},{0x03,0x04,0x78,0x04,0x03},{0x61,0x51,0x49,0x45,0x43},{0x00,0x00,0x7F,0x41,0x41},
    {0x02,0x04,0x08,0x10,0x20},{0x41,0x41,0x7F,0x00,0x00},{0x04,0x02,0x01,0x02,0x04},{0x40,0x40,0x40,0x40,0x40},
};

/* palette: concrete night, sodium lamp, danchi green */
#define BG      C565(14, 16, 18)
#define PANEL   C565(26, 29, 31)
#define GRID    C565(44, 48, 50)
#define GRID2   C565(70, 76, 78)
#define INK     C565(226, 222, 212)
#define DIM     C565(120, 124, 122)
#define EARLY   C565(255, 150, 60)
#define LATE    C565(90, 170, 255)
#define KEEP    C565(120, 210, 150)
#define WARN    C565(255, 96, 80)
#define TGT     C565(255, 236, 160)

typedef struct { uint16_t *buf; int y0, y1; } band_t;

static void rect(const band_t *b, int x, int y, int w, int h, uint16_t c) {
    if (w <= 0 || h <= 0) return;
    int ya = y < b->y0 ? b->y0 : y, yb = y + h > b->y1 ? b->y1 : y + h;
    int xa = x < 0 ? 0 : x, xb = x + w > W ? W : x + w;
    for (int yy = ya; yy < yb; yy++) {
        uint16_t *row = b->buf + (yy - b->y0) * W;
        for (int xx = xa; xx < xb; xx++) row[xx] = c;
    }
}
static int text(const band_t *b, int x, int y, const char *s, uint16_t c) {
    if (y + 7 <= b->y0 || y >= b->y1) { while (*s) { x += 6; s++; } return x; }
    for (; *s; s++, x += 6) {
        int ch = (unsigned char)*s;
        if (ch >= 'a' && ch <= 'z') ch -= 32;
        if (ch < 32 || ch > 95) ch = '?';
        const uint8_t *g = FONT[ch - 32];
        for (int cx = 0; cx < 5; cx++) {
            int px = x + cx;
            if (px < 0 || px >= W) continue;
            for (int cy = 0; cy < 7; cy++) {
                int py = y + cy;
                if (py < b->y0 || py >= b->y1) continue;
                if (g[cx] & (1u << cy)) b->buf[(py - b->y0) * W + px] = c;
            }
        }
    }
    return x;
}
/* small integer to text (no printf) */
static char *itoa_(int v, char *out, int width) {
    char tmp[12]; int n = 0, neg = v < 0;
    unsigned u = (unsigned)(neg ? -v : v);
    do { tmp[n++] = (char)('0' + u % 10u); u /= 10u; } while (u && n < 11);
    int k = 0;
    if (neg) out[k++] = '-';
    for (int p = n + neg; p < width; p++) out[k++] = '0';
    while (n) out[k++] = tmp[--n];
    out[k] = 0;
    return out;
}
static uint16_t mix(uint16_t a, uint16_t c, float t) {
    int ar = (a >> 11) & 31, ag = (a >> 5) & 63, ab = a & 31;
    int cr = (c >> 11) & 31, cg = (c >> 5) & 63, cb = c & 31;
    int r = ar + (int)((float)(cr - ar) * t), g = ag + (int)((float)(cg - ag) * t), bb = ab + (int)((float)(cb - ab) * t);
    return (uint16_t)((r << 11) | (g << 5) | bb);
}

static void meter(const band_t *b, int y, const char *label, float m, float t) {
    text(b, 2, y, label, DIM);
    int x0 = 44, w = 192;
    rect(b, x0, y + 1, w, 5, PANEL);
    rect(b, x0, y + 1, (int)(dn_clamp01(m) * (float)w), 5, INK);
    int tx = x0 + (int)(dn_clamp01(t) * (float)(w - 1));
    rect(b, tx - 1, y - 1, 3, 9, TGT);
}

void dn_draw_rows(const dn_state *s, uint16_t *buf, int y0, int nrows) {
    band_t b = { buf, y0, y0 + nrows };
    char num[16];
    rect(&b, 0, y0, W, nrows, BG);

    /* header */
    rect(&b, 0, 0, W, 12, PANEL);
    int x = text(&b, 2, 2, dn_phase_code[s->phase], s->phase == DN_PH_AKIBEYA ? LATE : INK);
    x = text(&b, x + 6, 2, itoa_(s->ph_left, num, 1), DIM);
    x = text(&b, x, 2, "/", DIM);
    text(&b, x, 2, itoa_(s->ph_len, num, 1), DIM);
    if (s->src == DN_SRC_FM) {
        text(&b, 142, 2, "#", DIM);
        text(&b, 148, 2, itoa_((int)s->obj.seed, num, 4), s->seed_cand != s->obj.seed ? TGT : INK);
    } else if (s->src == DN_SRC_BUF) {
        int x2 = text(&b, 136, 2, "SMP", INK);
        int cs = (int)((float)s->seg_len * s->isr * 10.0f + 0.5f);
        x2 = text(&b, x2 + 4, 2, itoa_(cs / 10, num, 1), DIM);
        x2 = text(&b, x2, 2, ".", DIM);
        text(&b, x2, 2, itoa_(cs % 10, num, 1), DIM);
    } else {
        text(&b, 136, 2, "LIVE", EARLY);
        rect(&b, 162, 4, (int)(dn_clamp01(s->in_peak) * 26.0f), 3, s->in_peak > 0.9f ? WARN : INK);
    }
    text(&b, 196, 2, itoa_((int)(dn_tempo_bpm(s) + 0.5f), num, 3), INK);
    text(&b, 216, 2, "BPM", DIM);

    /* meters */
    float te = s->t_e, tp = s->t_p;
    meter(&b, 15, "ERASE", s->m_e, te);
    meter(&b, 25, "PUSH", s->m_p, tp);

    /* lanes: 16 units x one bar */
    const int LY = 36, LH = 7, LX = 20, LW = 216;
    const float SX = (float)LW / 16.0f;
    if (LY + 16 * LH > y0 && LY < y0 + nrows) {
        for (int st = 0; st <= 16; st++) {
            int gx = LX + (int)((float)st * SX);
            rect(&b, gx, LY, 1, 16 * LH - 1, (st & 3) == 0 ? GRID2 : ((st & 1) == 0 ? GRID : PANEL));
        }
        float pos = 0.0f;
        int32_t into = (int32_t)(s->now - s->cur_start);
        if (into > 0 && s->cur_len) pos = dn_clamp((float)into / (float)s->cur_len, 0.0f, 0.999f);
        rect(&b, LX + (int)(pos * (float)LW), LY, 1, 16 * LH - 1, DIM);
        for (int k = 0; k < DN_TRACKS; k++) {
            const dn_track *T = &s->tr[k];
            int y = LY + k * LH;
            int snd = T->keeper ? s->keeper_on : (T->on && T->nhit && !T->dormant);
            uint16_t lab = T->keeper ? (snd ? KEEP : DIM) : (snd ? INK : GRID2);
            if (T->flash > 0.05f) rect(&b, 0, y, 17, LH - 1, mix(BG, T->keeper ? KEEP : EARLY, dn_clamp01(T->flash)));
            if (T->keeper) text(&b, 2, y, "KP", lab);
            else text(&b, 2, y, itoa_(k, num, 2), lab);
            if (!snd) continue;
            for (int h = 0; h < T->nhit; h++) {
                const dn_hit *H = &T->hit[h];
                if (H->bstep < 0) continue;                      /* not in this bar (own cycle) */
                int nx = LX + (int)(((float)H->bstep + 0.5f) * SX);
                float off = T->keeper ? 0.0f : H->off;
                int rx = LX + (int)(((float)H->bstep + 0.5f + off) * SX);
                if (rx < LX) rx += LW;
                if (rx >= LX + LW) rx -= LW;
                uint16_t col = T->keeper ? KEEP : (off < -0.02f ? EARLY : (off > 0.02f ? LATE : INK));
                rect(&b, nx, y + 2, 1, 2, DIM);
                if (!T->keeper && (off < -0.02f || off > 0.02f)) {
                    int a = nx < rx ? nx : rx, c = nx < rx ? rx : nx;
                    if (c - a < LW / 2) rect(&b, a, y + 3, c - a, 1, mix(BG, col, 0.6f));
                }
                int hgt = H->copies > 1 ? 6 : 4;
                rect(&b, rx - 1, y + (6 - hgt) / 2, 3, hgt, col);
                if (H->cause >= 0 && H->cause != k) rect(&b, rx - 3, y + 2, 1, 2, col);   /* pushed by another */
            }
        }
    }

    /* operators */
    const int OY = 152, OH = 10;
    if (OY + DN_OPS * OH > y0 && OY - 4 < y0 + nrows) {
        rect(&b, 0, OY - 3, W, 1, GRID);
        for (int i = 0; i < DN_OPS; i++) {
            const dn_op *o = &s->op[i];
            int y = OY + i * OH;
            int since = s->bar - o->act_bar;
            int born = s->bar - o->born_bar;
            if (since <= 1) rect(&b, 0, y - 1, W, OH - 1, PANEL);
            text(&b, 2, y, dn_op_code[o->kind], since <= 1 ? TGT : INK);
            text(&b, 38, y, "U", DIM);
            text(&b, 44, y, itoa_(o->track, num, 2), INK);
            int ew = (int)(dn_clamp(o->energy, 0.0f, 2.0f) * 45.0f);
            rect(&b, 62, y + 1, 90, 5, GRID);
            rect(&b, 62, y + 1, ew, 5, o->energy < 0.25f ? WARN : (born < 4 ? KEEP : INK));
            if (o->acts > 0) {
                const char *sg = o->reward > 0.1f ? "+" : (o->reward < -0.1f ? "-" : "=");
                text(&b, 158, y, sg, o->reward > 0.1f ? KEEP : (o->reward < -0.1f ? WARN : DIM));
            }
            if (o->pending) text(&b, 166, y, "?", TGT);
            text(&b, 178, y, "P", DIM);
            text(&b, 184, y, itoa_(o->period, num, 2), DIM);
            text(&b, 202, y, itoa_(o->age > 999 ? 999 : o->age, num, 3), DIM);
        }
    }

    /* footer */
    if (232 < y0 + nrows) {
        rect(&b, 0, 232, W, 8, PANEL);
        if (s->hand_stop) text(&b, 2, 233, "HAND STOP - TURN A UNIT ON", WARN);
        else {
            int fx = text(&b, 2, 233, s->mr_armed ? "REC" : "MOT", s->mr_armed ? WARN : DIM);
            fx = text(&b, fx + 4, 233, itoa_(s->mr_loop, num, 1), DIM);
            fx = text(&b, fx, 233, "B", DIM);
            for (int l = 0; l < DN_LANES; l++)
                rect(&b, fx + 6 + l * 5, 234, 4, 4, (s->lane_has >> l) & 1 ? ((s->gest_lanes >> l) & 1 ? WARN : INK) : GRID);
            /* features that are on: G resample, P own cycles, D press, F follow, R ratchet, H hold */
            static const char FL[DN_FEATURES] = { 'G', 'P', 'D', 'F', 'R', 'H' };
            for (int f = 0; f < DN_FEATURES; f++) {
                char t2[2] = { FL[f], 0 };
                text(&b, 104 + f * 7, 233, t2, (s->feat >> f) & 1u ? INK : GRID);
            }
            if (s->fx_layer) text(&b, 150, 233, "FX", s->fx_mask ? EARLY : DIM);
            if (s->vacant_room >= 0) text(&b, 166, 233, dn_room_code[s->vacant_room], LATE);
            if (!s->keeper_on) text(&b, 200, 233, "NO KP", DIM);
        }
    }
}
