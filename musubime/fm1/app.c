/* musubime on the FM-1: fm1-base's side of the contract (app.h), and hw.h for the shell and the project.
 * Part of fm1-base's unity build (device/unity.c, host/plat_host.c): plat.h, the canvas (gfx.c: cv_*), the LCD and
 * lib/touch.h are in scope. The shell, the body, the screen helpers and the project are separate units compiled at
 * -O2 (fm1.toml o2), which see only hw.h. */
#include "mz.h"

/* ------------------------------------------------------------------ hw.h --- */
uint32_t hw_ms(void) { return plat_ms(); }
int32_t hw_enc(int i) { return plat_enc(i); }      /* HE_* is plat.h's EN_* order */
uint32_t hw_buttons(void) { return plat_buttons(); }   /* HB_* is plat.h's B_* order */
uint32_t hw_keys(void)
{
    touch_poll();                                   /* the keys' velocity and pressure (lib/touch.h), once a frame */
    return touch_keys();
}
uint8_t hw_vel(int k) { return touch_vel((uint32_t)k); }
uint8_t hw_pressure(int k) { return touch_pressure((uint32_t)k); }
uint32_t hw_cpu_pct(void) { return plat_cpu_pct(); }
uint32_t hw_xruns(void) { return plat_xruns(); }
void hw_leds(uint32_t buttons, uint32_t keys, uint32_t dim_buttons, uint32_t dim_keys)
{
    static uint32_t lb = 0xFFFFFFFFu, lk, ld, ldb;
    if (buttons == lb && keys == lk && dim_keys == ld && dim_buttons == ldb)
        return;
    lb = buttons;
    lk = keys;
    ld = dim_keys;
    ldb = dim_buttons;
    plat_lights(buttons, keys, dim_buttons & ~buttons, dim_keys & ~keys, 1);   /* the ones without a use stay dark */
}

static int strip_y;
void hw_strip_begin(int y, int h)
{
    strip_y = y;
    cv_begin(240u, (uint32_t)h, C_BG);
}
void hw_pset(int x, int y, uint16_t c) { cv_pset(x, y, c); }
void hw_fill(int x, int y, int w, int h, uint16_t c) { cv_rect(x, y, w, h, c); }
void hw_strip_end(void) { cv_blit(0u, (uint32_t)strip_y); }

/* ---------------------------------------------------------- the contract --- */
static float buf_l[APP_BLOCK], buf_r[APP_BLOCK];

void app_init(void)
{
    const uint8_t *uid = plat_chip_uid();
    uint32_t seed = 0x6D757362u, i;                 /* "musb", mixed with this FM-1's own number */
    if (uid)
        for (i = 0; i < 16u; i++)
            seed = (seed ^ uid[i]) * 16777619u;
    mz_init(seed);
}

/* the audio interrupt: n stereo frames, 24-bit; MASTER as a gain (4096 = full) */
void app_render(int32_t *lr, uint32_t n, uint32_t master_q12)
{
    uint32_t i;
    float g = (float)master_q12 * (8300000.0f / 4096.0f);
    if (n > APP_BLOCK)
        n = APP_BLOCK;
    mz_render(buf_l, buf_r, 0, 0, n);               /* (the computer's audio: see docs/INSTALL.md, not on fm1-base yet) */
    for (i = 0; i < n; i++) {
        lr[2u * i] = (int32_t)(buf_l[i] * g);
        lr[2u * i + 1u] = (int32_t)(buf_r[i] * g);
    }
}

void app_panic(void) { mz_panic(); }

void app_ui_init(void)
{
    touch_on(1);
    lcd_fill(0, 0, 240, 240, C_BG);
}

void app_frame(void) { mz_frame(); }
void app_input_only(void) { touch_poll(); }
void app_say(const char *a, const char *b) { mz_say(a, b); }
