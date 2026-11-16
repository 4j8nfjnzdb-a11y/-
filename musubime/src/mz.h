/* musubime: the types the shell and a project share, and the project's half of the contract.
 *
 * Threads: pj_control / pj_row / pj_plot run in the UI loop (about 60 a second); pj_render in the audio interrupt.
 * The UI writes a project's targets (single floats and ints: one writer each), the render reads them at a block's
 * start; a request (HOME, a step) is a counter the UI increments and the render follows. */
#pragma once
#include <stdint.h>
#include "hw.h"
#include "m.h"

/* big zero-initialised buffers: the FM-1's .pool RAM region (fm1-base), plain memory elsewhere */
#if defined(MZ_FM1) && !defined(PLAT_HOST)
#define MZ_POOL __attribute__((section(".pool")))
#else
#define MZ_POOL
#endif

/* one UI frame's input: what the hand did since the last frame (live, plus the gesture loop's replay) */
typedef struct {
    int32_t enc[HW_NENC];               /* detents this frame */
    uint32_t keys, down, up;            /* held, pressed this frame, released this frame */
    uint8_t vel[HW_NKEYS], prs[HW_NKEYS];
    uint32_t btn, bdown, bup;
    uint32_t ms, dt;                    /* now, and since the last frame (ms) */
} mz_in_t;

/* the body: how the hand moves, not where the values are (body.c) */
typedef struct {
    float speed[HW_NENC];               /* detents a second, over about the last 250 ms */
    float count[HW_NENC];               /* (its leaky count) */
    float rev[HW_NENC];                 /* direction reversals a second, smoothed */
    int8_t dir[HW_NENC];                /* the last direction turned */
    uint32_t still[HW_NENC];            /* ms since the encoder last moved */
    float onset[HW_NENC];               /* this frame only: moved after >= 600 ms still; how long it was still (s) */
    float agit;                         /* every encoder's speed together, detents a second */
    float revs;                         /* every encoder's reversals together, a second */
    uint32_t still_all;                 /* ms since any encoder or key moved */
    float onset_any;                    /* this frame: the largest onset (s of stillness before it), 0 none */
    float press;                        /* the hardest key pressed now, 0..1 */
    float press_rate;                   /* how fast that changes, per second (+ pressing in) */
    float energy;                       /* a slow sum of everything above, 0..1: how much the hand has been doing */
} mz_body_t;

/* a row of the screen: one encoder's parameter */
typedef struct {
    const char *tag;                    /* the encoder ("K1") */
    char label[8];                      /* the parameter, 6 characters */
    char value[16];                     /* its value, as text */
    uint8_t hot;                        /* being turned / pushed now */
    uint8_t alert;                      /* out of the usual range (shown red) */
} mz_row_t;

/* the screen's colours (measuring-instrument: values amber on black, labels grey, alarms red) */
#define C_BG RGB565(6, 6, 8)
#define C_RULE RGB565(44, 44, 50)
#define C_DIMC RGB565(80, 80, 88)
#define C_LAB RGB565(150, 150, 156)
#define C_VAL RGB565(255, 176, 48)
#define C_VAL2 RGB565(196, 120, 30)
#define C_HOT RGB565(255, 244, 220)
#define C_RED RGB565(240, 72, 56)
#define C_GRN RGB565(110, 220, 130)
#define C_CYN RGB565(90, 190, 230)

/* ---- the sound slots (EDIT held: the voice page). A project plays its sound i with slot i; an empty slot falls back
 * to slot 1, so one source alone serves everything; with slot 1 empty too, the project's own FM ---- */
#define MZ_SLOTS 4
typedef struct {
    uint8_t src;                        /* 0 empty ("-"), else 1 + a kind of the bank (fmvox.h VB_*) */
    float tune;                         /* octaves */
    float bright;                       /* added to the index (rad) */
    float dec_x;                        /* the decay multiplied */
    float level_db;
    float fb;                           /* added to the feedback (rad) */
} mz_slot_t;
const mz_slot_t *mz_voice(int i);       /* sound i's slot: slot i, else slot 1, else 0 (the project's own) */
const mz_slot_t *mz_slot(int i);        /* slot i as it is */
void mz_slot_set(int i, uint8_t src);   /* pj_init: a project's starting sources */
uint32_t mz_slot_rev(void);             /* changes whenever a slot does */

/* ---- the project (one per firmware; MZ_ALL: all six in one, each compiled with MZ_PJ set to its prefix, so its
 * half of the contract is e1_pj_init, e2_pj_init, ...; the shell chooses among them, HOME held) ---- */
#if defined(MZ_ALL) && defined(MZ_PJ)
#define MZ_PJCAT_(a, b) a##_##b
#define MZ_PJCAT(a, b) MZ_PJCAT_(a, b)
#define PJ_NAME MZ_PJCAT(MZ_PJ, PJ_NAME)
#define pj_init MZ_PJCAT(MZ_PJ, pj_init)
#define pj_home MZ_PJCAT(MZ_PJ, pj_home)
#define pj_reset_audio MZ_PJCAT(MZ_PJ, pj_reset_audio)
#define pj_control MZ_PJCAT(MZ_PJ, pj_control)
#define pj_render MZ_PJCAT(MZ_PJ, pj_render)
#define pj_row MZ_PJCAT(MZ_PJ, pj_row)
#define pj_status MZ_PJCAT(MZ_PJ, pj_status)
#define pj_plot_rev MZ_PJCAT(MZ_PJ, pj_plot_rev)
#define pj_plot MZ_PJCAT(MZ_PJ, pj_plot)
#define pj_lit_keys MZ_PJCAT(MZ_PJ, pj_lit_keys)
#define pj_dim_keys MZ_PJCAT(MZ_PJ, pj_dim_keys)
#define pj_lit_buttons MZ_PJCAT(MZ_PJ, pj_lit_buttons)
#define pj_dim_buttons MZ_PJCAT(MZ_PJ, pj_dim_buttons)
#endif
extern const char PJ_NAME[];         /* upper case, the screen's header */
void pj_init(uint32_t seed);            /* boot: the simple state */
void pj_home(void);                     /* UI: back to the simple state (HOME held) */
void pj_reset_audio(void);              /* render: a bad number came out; clear what feeds back */
void pj_control(const mz_in_t *in, const mz_body_t *b);   /* UI: the hand, each frame */
void pj_render(float *l, float *r, const float *inl, const float *inr, uint32_t n);   /* audio; in may be 0 */
void pj_row(int i, mz_row_t *row);      /* UI: row i (0..6, encoder i) */
void pj_status(char *s);                /* UI: up to 14 characters for the header's right */
uint32_t pj_plot_rev(void);             /* UI: changes when the plot should be drawn again */
void pj_plot(int h);                    /* UI: the plot, in the current strip (240 x h) */
uint32_t pj_lit_keys(void);             /* UI: keys that mean something now (lit) */
uint32_t pj_dim_keys(void);             /* UI: keys that mean something (dim) */
uint32_t pj_lit_buttons(void);          /* UI: buttons whose state is on (lit) */
uint32_t pj_dim_buttons(void);          /* UI: buttons that do something here (dim); the shell adds its own */

/* ---- the shell (shell.c) ---- */
void mz_init(uint32_t seed);
void mz_frame(void);                    /* UI loop */
void mz_render(float *l, float *r, const float *inl, const float *inr, uint32_t n);   /* audio */
void mz_panic(void);
void mz_say(const char *a, const char *b);   /* a short message in the header for a moment */
uint32_t mz_bad_count(void);
float mz_out_db(void);                  /* the output's recent peak, dBFS */
float mz_gr_db(void);                   /* the limiter's gain reduction, dB (<= 0) */

/* ---- body.c ---- */
void body_reset(mz_body_t *b);
void body_update(mz_body_t *b, const mz_in_t *in);

/* ---- scr.c: text and lines in the current strip ---- */
int scr_text(int x, int y, int scale, const char *s, uint16_t c);   /* returns x after it */
int scr_text_w(int scale, const char *s);
void scr_hline(int x, int y, int w, uint16_t c);
void scr_vline(int x, int y, int h, uint16_t c);
void scr_line(int x0, int y0, int x1, int y1, uint16_t c);
void scr_rect(int x, int y, int w, int h, uint16_t c);   /* outline */

/* ---- text helpers (no printf on the FM-1) ---- */
char *mz_cat(char *d, const char *s);   /* appends, returns the end */
char *mz_int(char *d, int32_t v);       /* appends a signed integer */
char *mz_fix(char *d, float v, int dec);   /* appends v with dec decimals (sign, no exponent; huge -> clipped) */
char *mz_hex4(char *d, uint32_t v);
