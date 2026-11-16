/* musubime: what the app needs from the machine it runs on. Three implementations:
 *   fm1/hw_fm1.c   the FM-1, on fm1-base's plat.h (the screen through its canvas, the keys through lib/touch.h)
 *   web/hw_web.c   the browser preview (WebAssembly in an AudioWorklet: the page fills the inputs)
 *   tools/render.c the native test renderer (a script fills the inputs)
 * The same app code (shell.c and one project) runs on all three. */
#pragma once
#include <stdint.h>

#define HW_NENC 7
#define HW_NKEYS 27
#define HW_NPRESS 20                    /* keys 0..19 (F3..C5) have pressure; 20..26 velocity only */
/* the buttons, in plat.h's order */
enum { HB_FX, HB_SEL, HB_ENV, HB_LFO, HB_EDIT, HB_GLO, HB_HOME, HB_SAVE, HB_ARP, HB_SEQ, HB_PLAY, HB_REC,
       HB_OCTDN, HB_OCTUP, HW_NBTN };
/* the encoders, in plat.h's order */
enum { HE_SELECT, HE_ALGO, HE_PRESET, HE_K1, HE_K2, HE_K3, HE_K4 };

uint32_t hw_ms(void);
int32_t hw_enc(int i);                  /* detents since the last call, + clockwise */
uint32_t hw_buttons(void);              /* held: bit HB_* */
uint32_t hw_keys(void);                 /* held: bit k = key k (0 = F3) */
uint8_t hw_vel(int k);                  /* the key's last press, 1..127 */
uint8_t hw_pressure(int k);             /* a held key pressed harder than it rests, 0..127 (keys 0..19) */
void hw_leds(uint32_t buttons, uint32_t keys, uint32_t dim_buttons, uint32_t dim_keys);   /* lit; dim = has a use */

/* the screen: 240 x 240, RGB565, drawn in strips 240 wide (at most 144 rows), each sent when ended */
void hw_strip_begin(int y, int h);
void hw_pset(int x, int y, uint16_t c);         /* y within the strip */
void hw_fill(int x, int y, int w, int h, uint16_t c);
void hw_strip_end(void);

#define RGB565(r, g, b) ((uint16_t)((((r) >> 3) << 11) | (((g) >> 2) << 5) | ((b) >> 3)))
