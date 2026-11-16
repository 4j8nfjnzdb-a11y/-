/* musubime: the browser preview's machine. Compiled with the shell and one project to WebAssembly (web/build.sh);
 * the AudioWorklet (web/worklet.js) fills the inputs, calls wb_frame about 60 times a second and wb_render for the
 * sound, and reads the screen and the lights back. No libc: the few things the compiler may call are here. */
#include "mz.h"

#define EXPORT(name) __attribute__((export_name(#name)))

static uint32_t now_ms;
static int32_t enc_acc[HW_NENC];
static uint32_t btns, keys;
static uint8_t vel[HW_NKEYS], prs[HW_NKEYS];
static uint16_t fb[240 * 240];
static int strip_y, strip_h;
static uint32_t fb_dirty;
static uint32_t led_b, led_k, led_d, led_db;
static float out_l[256], out_r[256], in_l[256], in_r[256];
static int in_on;

uint32_t hw_ms(void) { return now_ms; }
int32_t hw_enc(int i)
{
    int32_t d = enc_acc[i];
    enc_acc[i] = 0;
    return d;
}
uint32_t hw_buttons(void) { return btns; }
uint32_t hw_keys(void) { return keys; }
uint8_t hw_vel(int k) { return vel[k]; }
uint8_t hw_pressure(int k) { return prs[k]; }
void hw_leds(uint32_t b, uint32_t k, uint32_t db, uint32_t d)
{
    led_b = b;
    led_k = k;
    led_d = d;
    led_db = db;
}
void hw_strip_begin(int y, int h)
{
    int i;
    strip_y = y;
    strip_h = h;
    for (i = 0; i < 240 * h && y * 240 + i < 240 * 240; i++)
        fb[y * 240 + i] = C_BG;
}
void hw_pset(int x, int y, uint16_t c)
{
    if ((unsigned)x < 240u && (unsigned)y < (unsigned)strip_h && strip_y + y < 240)
        fb[(strip_y + y) * 240 + x] = c;
}
void hw_fill(int x, int y, int w, int h, uint16_t c)
{
    int i, j;
    if (x < 0) {
        w += x;
        x = 0;
    }
    if (y < 0) {
        h += y;
        y = 0;
    }
    if (x + w > 240)
        w = 240 - x;
    if (y + h > strip_h)
        h = strip_h - y;
    for (j = y; j < y + h; j++)
        for (i = x; i < x + w; i++)
            fb[(strip_y + j) * 240 + i] = c;
}
void hw_strip_end(void) { fb_dirty = 1; }

/* what clang may call on its own (struct copies, zeroing) */
void *memcpy(void *d, const void *s, unsigned long n)
{
    unsigned char *a = d;
    const unsigned char *b = s;
    while (n--)
        *a++ = *b++;
    return d;
}
void *memset(void *d, int c, unsigned long n)
{
    unsigned char *a = d;
    while (n--)
        *a++ = (unsigned char)c;
    return d;
}
void *memmove(void *d, const void *s, unsigned long n)
{
    unsigned char *a = d;
    const unsigned char *b = s;
    if (a < b)
        while (n--)
            *a++ = *b++;
    else
        while (n--)
            a[n] = b[n];
    return d;
}

EXPORT(wb_init) void wb_init(uint32_t seed) { mz_init(seed); }
EXPORT(wb_ms) void wb_ms(uint32_t ms) { now_ms = ms; }
EXPORT(wb_enc) void wb_enc(int i, int d)
{
    if (i >= 0 && i < HW_NENC)
        enc_acc[i] += d;
}
EXPORT(wb_buttons) void wb_buttons(uint32_t m) { btns = m; }
EXPORT(wb_key) void wb_key(int k, int down, int v)
{
    if (k < 0 || k >= HW_NKEYS)
        return;
    if (down) {
        keys |= 1u << k;
        vel[k] = (uint8_t)(v < 1 ? 1 : v > 127 ? 127 : v);
    } else {
        keys &= ~(1u << k);
        prs[k] = 0;
    }
}
EXPORT(wb_pressure) void wb_pressure(int k, int p)
{
    if (k >= 0 && k < HW_NPRESS)
        prs[k] = (uint8_t)(p < 0 ? 0 : p > 127 ? 127 : p);
}
EXPORT(wb_frame) void wb_frame(void) { mz_frame(); }
EXPORT(wb_in_on) void wb_in_on(int on) { in_on = on; }
EXPORT(wb_in_l) float *wb_in_l(void) { return in_l; }
EXPORT(wb_in_r) float *wb_in_r(void) { return in_r; }
EXPORT(wb_out_l) float *wb_out_l(void) { return out_l; }
EXPORT(wb_out_r) float *wb_out_r(void) { return out_r; }
EXPORT(wb_render) void wb_render(int n)
{
    if (n > 256)
        n = 256;
    mz_render(out_l, out_r, in_on ? in_l : 0, in_on ? in_r : 0, (uint32_t)n);
}
EXPORT(wb_fb) uint16_t *wb_fb(void) { return fb; }
EXPORT(wb_fb_dirty) uint32_t wb_fb_dirty(void)
{
    uint32_t d = fb_dirty;
    fb_dirty = 0;
    return d;
}
EXPORT(wb_led_b) uint32_t wb_led_b(void) { return led_b; }
EXPORT(wb_led_k) uint32_t wb_led_k(void) { return led_k; }
EXPORT(wb_led_d) uint32_t wb_led_d(void) { return led_d; }
EXPORT(wb_led_db) uint32_t wb_led_db(void) { return led_db; }
EXPORT(wb_bad) uint32_t wb_bad(void) { return mz_bad_count(); }
