#include <stdio.h>
#include <string.h>
#include "bk_screen.h"

#define DIA_Y 8                         /* the diagram's rows: DIA_Y .. DIA_Y + 199 */
#define DIA_H 200
#define RGB(r, g, b) ((uint16_t)((((r) & 0xF8) << 8) | (((g) & 0xFC) << 3) | ((b) >> 3)))

static const uint16_t VOICE_C[BK_NV] = {
    RGB(255, 210, 90), RGB(90, 220, 255), RGB(255, 120, 170), RGB(150, 255, 120),
    RGB(255, 160, 60), RGB(180, 140, 255), RGB(255, 255, 255), RGB(120, 200, 160)};

static void px(bk_screen_t *s, int x, int y, uint16_t c)
{
    if (x >= 0 && x < SCR_W && y >= 0 && y < SCR_H)
        s->fb[y * SCR_W + x] = c;
}

static void rect(bk_screen_t *s, int x, int y, int w, int h, uint16_t c)
{
    int i, j;
    for (j = y; j < y + h; j++)
        for (i = x; i < x + w; i++)
            px(s, i, j, c);
}

static int col_of_u(int32_t u) { return (int)(((int64_t)u * (SCR_W - 1)) / BK_U_MAX); }
static int row_of_x(int32_t xq30) { return DIA_Y + DIA_H - 1 - (int)(((int64_t)xq30 * (DIA_H - 1)) >> 30); }

void scr_init(bk_screen_t *s)
{
    uint16_t bins[DIA_H];
    int c, b;
    memset(s, 0, sizeof *s);
    for (c = 0; c < SCR_W; c++) {                 /* on the FM-1: a few columns per main-loop pass */
        int32_t u = (int32_t)(((int64_t)c * BK_U_MAX) / (SCR_W - 1));
        memset(bins, 0, sizeof bins);
        bk_diagram_column(bk_R_of_u(u), bins, DIA_H, 600, 400);
        for (b = 0; b < DIA_H; b++) {
            int v = bins[b] ? 60 + bins[b] * 12 : 0;
            s->terrain[c * DIA_H + b] = (uint8_t)(v > 255 ? 255 : v);
        }
    }
}

void scr_note_block(bk_screen_t *s, const bk_engine_t *e)
{
    s->trail[s->ntrail++ & 255u] = bk_u_of_R(e->R);
}

void scr_draw(bk_screen_t *s, const bk_engine_t *e)
{
    int c, b, k, i;
    int32_t uh = bk_u_of_R(e->R_hand), ue = bk_u_of_R(e->R);
    memset(s->fb, 0, sizeof s->fb);
    for (c = 0; c < SCR_W; c++)                   /* the terrain */
        for (b = 0; b < DIA_H; b++) {
            int v = s->terrain[c * DIA_H + b];
            if (v)
                px(s, c, DIA_Y + DIA_H - 1 - b, RGB(v * 3 / 5, v * 3 / 5, v));
        }
    for (k = 1; k <= 6; k++)                      /* the doubling points: ticks at the top */
        rect(s, col_of_u(k << 16), 0, 1, 5, RGB(120, 120, 120));
    for (i = 0; i < 256 && (uint32_t)i < s->ntrail; i++) {   /* R's walk, newest brightest */
        int age = i, v = 255 - age;
        int32_t u = s->trail[(s->ntrail - 1u - (uint32_t)i) & 255u];
        px(s, col_of_u(u), DIA_Y + DIA_H + 2 + (age >> 6), RGB(v, v / 2, v / 4));
    }
    for (b = DIA_Y; b < DIA_Y + DIA_H; b += 3)    /* the knob (dashed) and the R that plays */
        px(s, col_of_u(uh), b, RGB(110, 110, 110));
    for (b = DIA_Y; b < DIA_Y + DIA_H; b++)
        px(s, col_of_u(ue), b, RGB(255, 80, 60));
    for (k = 0; k < (int)BK_NV; k++) {            /* where the voices are */
        const bk_voice_t *v = &e->v[k];
        int n;
        if (!v->active || !v->nper)
            continue;
        n = v->nper < BK_HIST ? (int)v->nper : (int)BK_HIST;
        for (i = 0; i < n; i++)
            rect(s, col_of_u(ue) - 1 + (k % 3), row_of_x(bk_voice_x(e, (uint32_t)k, (uint32_t)i)) - 1, 2, 2, VOICE_C[k]);
    }
    for (k = 0; k < (int)BK_NV; k++) {            /* the bottom: period as squares, one row per voice */
        int p, y = DIA_Y + DIA_H + 8 + (k % 4) * 6, x0 = k < 4 ? 0 : 120;
        if (!e->v[k].active)
            continue;
        p = bk_voice_period(e, (uint32_t)k, 1 << 10);
        rect(s, x0, y, 4, 4, VOICE_C[k]);
        if (p == 0)
            rect(s, x0 + 6, y, 100, 4, RGB(200, 40, 40));
        else if (p > 0)
            for (i = 0; i < p && i < 32; i++)
                rect(s, x0 + 6 + i * 3, y, 2, 4, RGB(230, 230, 230));
    }
    {                                             /* the Lyapunov exponent: a bar from the middle */
        int L = (int)((int64_t)e->lyap * 60 / 65536);
        if (L > 110) L = 110;
        if (L < -110) L = -110;
        rect(s, 119, 236, 2, 4, RGB(180, 180, 180));
        if (L > 0) rect(s, 121, 236, L, 4, RGB(230, 60, 60));
        else rect(s, 119 + L, 236, -L, 4, RGB(60, 200, 120));
    }
}

int scr_write_ppm(const bk_screen_t *s, const char *path, int scale)
{
    FILE *f = fopen(path, "wb");
    int x, y, i, j;
    if (!f)
        return -1;
    fprintf(f, "P6\n%d %d\n255\n", SCR_W * scale, SCR_H * scale);
    for (y = 0; y < SCR_H; y++)
        for (j = 0; j < scale; j++)
            for (x = 0; x < SCR_W; x++) {
                uint16_t c = s->fb[y * SCR_W + x];
                unsigned char rgb[3] = {(unsigned char)((c >> 8) & 0xF8), (unsigned char)((c >> 3) & 0xFC),
                                        (unsigned char)((c << 3) & 0xF8)};
                for (i = 0; i < scale; i++)
                    fwrite(rgb, 1, 3, f);
            }
    fclose(f);
    return 0;
}
