/* SPDX-License-Identifier: GPL-3.0-only */
/* BUNKI's fm1-dock module on the computer: a fake host (hb_host_t) runs the module as fm1-dock would
 * (init, note, ui, render every 256 frames, draw in between), with a scripted performance.
 *   - the sound's hash, and the same performance as a script for build/bunki (bunki/host): the two
 *     hashes must be equal, so the module's queue gives the engine's bits
 *   - the screen at a few moments (PPM), and the text lines as they are drawn
 *   - rand() must never be called: it aborts */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../bunki/bunki_module.c"

static uint16_t fb[240 * 240];
static uint32_t now_ms;
static uint8_t store[256];
static int stored = -1;
static FILE *script;

static uint32_t h_ms(void) { return now_ms; }
static uint32_t h_ticks(void) { return now_ms * 24000u; }
static void h_log(const char *s) { printf("log: %s\n", s); }
static void h_log_u32(const char *s, uint32_t v) { printf("log: %s %08x\n", s, v); }
static void h_fill(int32_t x, int32_t y, int32_t w, int32_t h, uint16_t c)
{
    int32_t i, j;
    for (j = y; j < y + h; j++) for (i = x; i < x + w; i++)
        if (i >= 0 && i < 240 && j >= 0 && j < 240) fb[j * 240 + i] = c;
}
static void h_text(int32_t x, int32_t y, int32_t w, uint32_t big, const char *s, uint16_t fg, uint32_t center)
{
    int32_t n = (int32_t)strlen(s), cw = big ? 16 : 8, i, x0;
    (void)center;
    h_fill(x, y, w, big ? 32 : 16, 0);           /* cleared, then each character as a block (no font here) */
    x0 = x + (w - n * cw) / 2;
    for (i = 0; i < n; i++)
        if (s[i] != ' ') h_fill(x0 + i * cw + 1, y + 3, cw - 2, (big ? 32 : 16) - 6, fg);
    printf("text y=%3d: %s\n", y, s);
}
static void h_cv_begin(int32_t w, int32_t h, uint16_t bg) { (void)w; (void)h; (void)bg; }
static void h_cv_rect(int32_t x, int32_t y, int32_t w, int32_t h, uint16_t c) { (void)x; (void)y; (void)w; (void)h; (void)c; }
static void h_cv_line(int32_t a, int32_t b, int32_t c, int32_t d, uint16_t e) { (void)a; (void)b; (void)c; (void)d; (void)e; }
static void h_cv_pixel(int32_t x, int32_t y, uint16_t c) { (void)x; (void)y; (void)c; }
static void h_cv_text(int32_t x, int32_t y, uint32_t b, const char *s, uint16_t c) { (void)x; (void)y; (void)b; (void)s; (void)c; }
static void h_cv_blit(int32_t x, int32_t y) { (void)x; (void)y; }
static void h_led(uint32_t id, uint32_t on) { (void)id; (void)on; }
static uint32_t h_rand(void) { fprintf(stderr, "rand() called: the module must not use random numbers\n"); abort(); }
static int h_load(void *p, uint32_t n) { if (stored != (int)n) return -1; memcpy(p, store, n); return 0; }
static void h_save(const void *p, uint32_t n) { memcpy(store, p, n); stored = (int)n; printf("saved %u bytes\n", n); }
static void h_midi_send(uint32_t a, uint32_t b, uint32_t c) { (void)a; (void)b; (void)c; }
static uint32_t h_master(void) { return 4096; }
static void h_blit(int32_t x, int32_t y, int32_t w, int32_t h, const uint16_t *px)
{
    int32_t i, j;
    for (j = 0; j < h; j++) for (i = 0; i < w; i++)
        if (x + i >= 0 && x + i < 240 && y + j >= 0 && y + j < 240)
            fb[(y + j) * 240 + x + i] = (uint16_t)(px[j * w + i] >> 8 | px[j * w + i] << 8);
}
static int32_t h_text_w(uint32_t big, const char *s) { return (int32_t)strlen(s) * (big ? 16 : 8); }

static hb_host_t HOST = {HB_ABI, sizeof(hb_host_t), h_ms, h_ticks, h_log, h_log_u32, h_fill, h_text, h_cv_begin, h_cv_rect,
    h_cv_line, h_cv_pixel, h_cv_text, h_cv_blit, h_led, h_rand, h_load, h_save, h_midi_send, h_master, h_blit, h_text_w};

static void shot(const char *path)
{
    FILE *f = fopen(path, "wb");
    int i;
    fprintf(f, "P6\n240 240\n255\n");
    for (i = 0; i < 240 * 240; i++) {
        unsigned char c[3] = {(unsigned char)((fb[i] >> 8) & 0xF8), (unsigned char)((fb[i] >> 3) & 0xFC), (unsigned char)((fb[i] << 3) & 0xF8)};
        fwrite(c, 1, 3, f);
    }
    fclose(f);
}

/* what reaches the engine at this block, as script lines: the knobs' turns (in the order render takes them), then
 * the queue (keys, buttons) in its order */
static int32_t written[BK_NKNOBS];
static long ms_of(uint32_t b) { return (long)(((uint64_t)b * 256000u + 44099u) / 44100u); }
static void log_block(uint32_t b)
{
    static const char *KN[BK_NKNOBS] = {"r", "time", "net", "space", "fine", "n", "seed"};
    static const char *BN[BK_NBTNS] = {"hold", "arp", "evolve", "topo", "freeze", "loop", "timbre", "micro", "mutate", "oct"};
    const long ms = ms_of(b);
    uint32_t k, r;
    for (k = 0; k < BK_NKNOBS; k++)
        if (turned[k] != written[k]) {
            fprintf(script, "%ld turn %s %d\n", ms, KN[k], turned[k] - written[k]);
            written[k] = turned[k];
        }
    for (r = q_r; r != q_w; r++) {
        const uint32_t i = r % QN;
        if (q[i].type == Q_KEY && q[i].v) fprintf(script, "%ld on %d %d\n", ms, q[i].a, q[i].v);
        else if (q[i].type == Q_KEY) fprintf(script, "%ld off %d\n", ms, q[i].a);
        else if (q[i].type == Q_BTN) fprintf(script, "%ld btn %s%s\n", ms, BN[q[i].a], q[i].v ? "" : " long");
    }
}

static void press(uint32_t btn) { hb_module.ui(HB_EV_BTN_DOWN | btn, 0); hb_module.ui(HB_EV_BTN_UP | btn, 0); }

static void turn_enc(uint32_t enc, int32_t clicks, int32_t per_event)
{
    while (clicks) {
        int32_t a = clicks > 0 ? (clicks < per_event ? clicks : per_event) : (-clicks < per_event ? clicks : -per_event);
        hb_module.ui(HB_EV_ENC | enc, a);
        clicks -= a;
    }
}

int main(int argc, char **argv)
{
    const char *dir = argc > 1 ? argv[1] : ".";
    static int32_t buf[512];
    uint64_t h = 1469598103934665603ull;
    uint32_t b, i, N = 6000;
    char p[512];
    FILE *raw;
    snprintf(p, sizeof p, "%s/sim_script.txt", dir);
    script = fopen(p, "w");
    snprintf(p, sizeof p, "%s/sim.raw", dir);
    raw = fopen(p, "wb");
    if (hb_module.abi != HB_ABI || hb_module.init(&HOST)) return 1;
    fprintf(script, "0 perf\n");
    for (b = 0; b < N; b++) {
        if (b == 20) hb_module.note(0, 60, 100);                                  /* a pure sine */
        if (b >= 200 && b < 600 && b % 25 == 0) turn_enc(HB_ENC_KNOB1, 1, 1);      /* R up slowly: 2, 4 */
        if (b >= 700 && b < 1100 && b % 10 == 0) { turn_enc(HB_ENC_KNOB2, 1, 1); turn_enc(HB_ENC_ALGORITHM, 1, 1); }  /* the wave */
        if (b == 1200) press(HB_BTN_ARP);                                         /* ARP */
        if (b == 1300) press(HB_BTN_ARP);                                         /* another way */
        if (b == 1400) press(HB_BTN_REC);                                         /* record ... */
        if (b == 1450) hb_module.note(0, 67, 90);
        if (b >= 1500 && b < 1600 && b % 20 == 0) turn_enc(HB_ENC_KNOB1, 2, 1);
        if (b == 1650) press(HB_BTN_SEL);                                         /* MICRO 1/4 */
        if (b == 1700) hb_module.note(0, 67, 0);
        if (b == 1800) press(HB_BTN_REC);                                         /* ... loop it */
        if (b == 2200) turn_enc(HB_ENC_KNOB3, 20, 4);                             /* added into the loop */
        if (b == 2500) { press(HB_BTN_LFO); press(HB_BTN_LFO); }                  /* OCT 2 */
        if (b == 2800) press(HB_BTN_GLO);                                         /* all pull together */
        if (b == 3100) press(HB_BTN_EDIT);                                        /* FREEZE */
        if (b == 3300) press(HB_BTN_EDIT);
        if (b == 3500) press(HB_BTN_SEQ);                                         /* EVOLVE */
        if (b == 3900) press(HB_BTN_SEQ);                                         /* turned round */
        if (b == 4200) { hb_module.ui(HB_EV_BTN_DOWN | HB_BTN_ARP, 0); }          /* a long press: ARP off */
        if (b == 4400) { hb_module.ui(HB_EV_BTN_UP | HB_BTN_ARP, 0); }
        if (b == 4600) press(HB_BTN_FX);                                          /* the FM layer too */
        if (b == 5000) press(HB_BTN_REC);                                         /* the loop stopped */
        if (b == 5200) press(HB_BTN_PLAY);                                        /* HOLD */
        if (b == 5300) hb_module.note(0, 60, 0);
        if (b == 5700) press(HB_BTN_PLAY);                                        /* HOLD off: it ends */
        log_block(b);
        memset(buf, 0, sizeof buf);
        hb_module.render(buf, 256);
        for (i = 0; i < 512; i++) {
            int32_t s = buf[i] > 32767 ? 32767 : buf[i] < -32767 ? -32767 : buf[i];
            h = (h ^ (uint16_t)s) * 1099511628211ull;
            if (raw) { int16_t v = (int16_t)s; fwrite(&v, 2, 1, raw); }
        }
        now_ms = (uint32_t)(((uint64_t)(b + 1) * 256000u) / 44100u);
        hb_module.draw(b == 0);
        if (b == 1100 || b == 2400 || b == 3000 || b == 4000) {
            snprintf(p, sizeof p, "%s/sim_%04u.ppm", dir, b);
            hb_module.draw(0);
            shot(p);
        }
    }
    fprintf(script, "%ld end\n", ms_of(N));
    fclose(script);
    if (raw) fclose(raw);
    hb_module.release();
    printf("frames %u  hash %016llx\n", N * 256u, (unsigned long long)h);
    return 0;
}
