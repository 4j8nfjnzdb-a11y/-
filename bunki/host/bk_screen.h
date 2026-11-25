/* The screen as the FM-1 will show it, drawn into a 240 x 240 RGB565 buffer on the computer.
 *   the bifurcation diagram against the knob (warped: one unit per doubling), the terrain of one
 *   voice alone; on it, the last 64 map values of every voice where R stands now; the knob (dim)
 *   and the R that plays (bright); R's own walk as a trail; at the bottom, the period of each voice
 *   as that many squares (a red bar: none found up to 32) and the Lyapunov exponent as a bar. */
#ifndef BK_SCREEN_H
#define BK_SCREEN_H
#include <stdint.h>
#include "bunki.h"

#define SCR_W 240
#define SCR_H 240

typedef struct {
    uint16_t fb[SCR_W * SCR_H];
    uint8_t terrain[SCR_W * 200];       /* the diagram's density, 0..255 */
    int32_t trail[256];                 /* u of the R that played, one per block */
    uint32_t ntrail;
} bk_screen_t;

void scr_init(bk_screen_t *s);
void scr_note_block(bk_screen_t *s, const bk_engine_t *e);   /* after each block: the trail */
void scr_draw(bk_screen_t *s, const bk_engine_t *e);
int  scr_write_ppm(const bk_screen_t *s, const char *path, int scale);

#endif
