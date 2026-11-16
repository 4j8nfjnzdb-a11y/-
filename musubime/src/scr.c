/* musubime: text and lines on the current strip (hw_strip_begin .. hw_strip_end), and the text helpers.
 * One pixel font everywhere (font5x7.h), so the browser preview draws exactly what the FM-1 shows. */
#include "mz.h"
#include "font5x7.h"

int scr_text_w(int scale, const char *s)
{
    int n = 0;
    while (*s++)
        n++;
    return n ? n * 6 * scale - scale : 0;
}

int scr_text(int x, int y, int scale, const char *s, uint16_t c)
{
    for (; *s; s++) {
        int ch = (unsigned char)*s, r, col;
        if (ch >= 'a' && ch <= 'z' && ch != 'x')
            ch -= 32;
        if (ch < 32 || ch > 126)
            ch = '?';
        for (r = 0; r < 7; r++) {
            uint8_t bits = FONT5X7[ch - 32][r];
            if (!bits)
                continue;
            for (col = 0; col < 5; col++)
                if (bits & (0x10u >> col)) {
                    if (scale == 1)
                        hw_pset(x + col, y + r, c);
                    else
                        hw_fill(x + col * scale, y + r * scale, scale, scale, c);
                }
        }
        x += 6 * scale;
    }
    return x;
}

void scr_hline(int x, int y, int w, uint16_t c) { hw_fill(x, y, w, 1, c); }
void scr_vline(int x, int y, int h, uint16_t c) { hw_fill(x, y, 1, h, c); }
void scr_rect(int x, int y, int w, int h, uint16_t c)
{
    scr_hline(x, y, w, c);
    scr_hline(x, y + h - 1, w, c);
    scr_vline(x, y, h, c);
    scr_vline(x + w - 1, y, h, c);
}

void scr_line(int x0, int y0, int x1, int y1, uint16_t c)
{
    int dx = x1 > x0 ? x1 - x0 : x0 - x1, sx = x0 < x1 ? 1 : -1;
    int dy = y1 > y0 ? y0 - y1 : y1 - y0, sy = y0 < y1 ? 1 : -1, e = dx + dy, n = 0;
    for (;;) {
        int e2;
        hw_pset(x0, y0, c);
        if ((x0 == x1 && y0 == y1) || ++n > 600)
            break;
        e2 = 2 * e;
        if (e2 >= dy) {
            e += dy;
            x0 += sx;
        }
        if (e2 <= dx) {
            e += dx;
            y0 += sy;
        }
    }
}

char *mz_cat(char *d, const char *s)
{
    while (*d)
        d++;
    while (*s)
        *d++ = *s++;
    *d = 0;
    return d;
}

char *mz_int(char *d, int32_t v)
{
    char t[12];
    int n = 0;
    uint32_t u = (uint32_t)(v < 0 ? -v : v);
    while (*d)
        d++;
    do
        t[n++] = (char)('0' + u % 10u);
    while ((u /= 10u) && n < 11);
    if (v < 0)
        *d++ = '-';
    while (n)
        *d++ = t[--n];
    *d = 0;
    return d;
}

char *mz_fix(char *d, float v, int dec)
{
    static const float P[] = {1.0f, 10.0f, 100.0f, 1000.0f, 10000.0f};
    int32_t ip, fp;
    float a, sc;
    char *e;
    int k;
    while (*d)
        d++;
    if (!m_finite(v)) {
        *d++ = 'N';
        *d++ = 'A';
        *d++ = 'N';
        *d = 0;
        return d;
    }
    if (dec < 0)
        dec = 0;
    if (dec > 4)
        dec = 4;
    sc = P[dec];
    a = m_abs(v);
    if (a > 999999.0f)
        a = 999999.0f;
    {
        float r = m_floor(a * sc + 0.5f);
        ip = (int32_t)(r / sc);
        fp = (int32_t)(r - (float)ip * sc);
        if (fp < 0)
            fp = 0;
    }
    if (v < 0.0f && (ip || fp))
        *d++ = '-';
    *d = 0;
    e = mz_int(d, ip);
    if (dec) {
        char t[6];
        *e++ = '.';
        for (k = dec - 1; k >= 0; k--) {
            t[k] = (char)('0' + fp % 10);
            fp /= 10;
        }
        for (k = 0; k < dec; k++)
            *e++ = t[k];
        *e = 0;
    }
    return e;
}

char *mz_hex4(char *d, uint32_t v)
{
    static const char H[] = "0123456789ABCDEF";
    int k;
    while (*d)
        d++;
    for (k = 3; k >= 0; k--)
        *d++ = H[(v >> (4 * k)) & 15u];
    *d = 0;
    return d;
}
