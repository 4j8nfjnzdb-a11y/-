/*
 * DANCHI on the M-VAVE FM-1 (fm1-base) — PORT SKETCH, NOT BUILT, NOT RUN.
 *
 * fm1-base was not available while this was written. Every fm1_* name below is a
 * placeholder for whatever fm1-base actually provides; only the danchi side is real.
 * What has been checked on the danchi side (see ../README.md):
 *   - the core compiles for a single-precision-FPU Cortex-M4F with no double and no libm
 *     (tools/check_float.sh); the FM-1's real CPU is not known here
 *   - dn_state is ~43 KB (working RAM budget ~96 KB), dn_big is ~329 KB (large-buffer budget ~336 KB),
 *     including a 1.49 s 16-bit buffer for a sampled object or the live input
 *   - whether the FM-1 has an audio input at all is not known here
 *   - the screen is drawn in horizontal bands, so no 115 KB framebuffer is needed
 *
 * Threading: dn_process() and every control call (dn_encoder/dn_key/dn_button) must run in the
 * same context. Controls arrive from the UI side through a small single-producer queue and are
 * applied at the start of each audio block. The display reads the state from the main loop;
 * a torn read only shows a stale value for one frame (all indices it uses are range-safe).
 */
#include <stdint.h>
#include "../core/danchi.h"

/* ---- placeholders: replace with fm1-base's real API ---- */
extern void fm1_display_write_rows(int y0, int nrows, const uint16_t *rgb565);   /* push 240 x nrows pixels */
extern uint32_t fm1_random32(void);
/* fm1-base is assumed to call: fm1_audio_block(), fm1_on_encoder(), fm1_on_encoder_push(),
   fm1_on_key(), fm1_on_button(), and to run fm1_main_loop_tick() from its main loop. */

/* ---- memory ---- */
static dn_state S;                                   /* working RAM */
static dn_big B __attribute__((section(".bigbuf"))); /* large-buffer region: the section name is a guess */
static uint16_t band[DN_SCREEN * 16];                /* 7.5 KB: one 16-row band of the screen */

/* ---- control queue (UI -> audio) ---- */
typedef struct { uint8_t type, a; int8_t d; uint8_t pad; int32_t n; } ev_t;
enum { EV_ENC, EV_KEY, EV_BTN, EV_COMMIT };
#define QN 64
static ev_t q[QN];
static volatile uint32_t qw, qr;
static void push(uint8_t type, uint8_t a, int8_t d) {
    uint32_t w = qw;
    if (w - qr >= QN) return;                        /* full: drop (a lost detent, not a crash) */
    q[w % QN].type = type; q[w % QN].a = a; q[w % QN].d = d;
    __atomic_store_n(&qw, w + 1, __ATOMIC_RELEASE);
}
static void drain(void) {
    uint32_t w = __atomic_load_n(&qw, __ATOMIC_ACQUIRE);
    while (qr != w) {
        ev_t e = q[qr % QN];
        if (e.type == EV_ENC) dn_encoder(&S, e.a, e.d);
        else if (e.type == EV_KEY) dn_key(&S, e.a, e.d);
        else if (e.type == EV_COMMIT) dn_sample_commit(&S, (int)e.n);
        else dn_button(&S, e.a, e.d);
        qr++;
    }
}

void fm1_app_init(void) {
    dn_init(&S, &B, 44100.0f, fm1_random32());
}

/* audio: 256 frames at 44.1 kHz; interleaved int16 here (adapt to fm1-base's format).
 * `in` is the device's audio input if it has one (NULL if not): mono, or the host mixes it down. */
void fm1_audio_block(const int16_t *in, int16_t *out, int frames) {
    static float L[DN_BLOCK], R[DN_BLOCK], I[DN_BLOCK];
    drain();
    if (in) {
        for (int i = 0; i < frames; i++) I[i] = (float)in[i] * (1.0f / 32768.0f);
        dn_process_in(&S, I, L, R, frames);
    } else dn_process(&S, L, R, frames);
    for (int i = 0; i < frames; i++) {
        float l = L[i] * 32767.0f, r = R[i] * 32767.0f;   /* the core's limiter keeps |x| < 1 */
        out[2 * i] = (int16_t)l;
        out[2 * i + 1] = (int16_t)r;
    }
}

/* 7 infinite encoders: 0 tempo, 1 ERASE, 2 push, 3 META, 4 room, 5 distance, 6 object (browse) */
void fm1_on_encoder(int idx, int detents) { if (idx >= 0 && idx < DN_KNOBS) push(EV_ENC, (uint8_t)idx, (int8_t)detents); }
/* pressing encoder 7 applies the object candidate; the others do nothing on press */
void fm1_on_encoder_push(int idx) { if (idx == DN_K_OBJECT) push(EV_BTN, DN_BTN_OBJECT, 0); }
/* keys: the 16 units of the building (0 = caretaker); more keys wrap around */
void fm1_on_key(int key, int down) { push(EV_KEY, (uint8_t)(key % DN_TRACKS), (int8_t)(down ? 1 : 0)); }
/* buttons: a guess at a layout; the hardware's button count is not known here */
void fm1_on_button(int idx, int shift_held, int unit_selected) {
    switch (idx) {
    case 0: push(EV_BTN, DN_BTN_REC, 0); break;                          /* motion overdub on/off   */
    case 1: push(EV_BTN, shift_held ? DN_BTN_CLEAR : DN_BTN_LOOP, 0); break;
    case 2: push(EV_BTN, DN_BTN_TRACK, (int8_t)unit_selected); break;    /* unit in / out          */
    case 3: push(EV_BTN, DN_BTN_KEEPER, (int8_t)(shift_held ? 0 : 1)); break;
    default: break;
    }
}

/* a sound for the object (e.g. read from storage by fm1-base): switch to the FM tone first so no
 * copy reads the buffer while it is written, write 16-bit mono at 44.1 kHz, then commit through
 * the queue so the commit happens in the audio context. At most DN_SAMPBUF - 512 samples (~1.47 s). */
void fm1_load_object(const int16_t *pcm, int n) {
    push(EV_BTN, DN_BTN_SOURCE, DN_SRC_FM);
    /* (wait one audio block here so the switch has happened; fm1-base's way of waiting is not known) */
    int16_t *dst = dn_sample_area(&S);
    if (n > DN_SAMPBUF - 512) n = DN_SAMPBUF - 512;
    for (int i = 0; i < n; i++) dst[i] = pcm[i];
    uint32_t w = qw;
    if (w - qr < QN) { q[w % QN].type = EV_COMMIT; q[w % QN].n = n; __atomic_store_n(&qw, w + 1, __ATOMIC_RELEASE); }
}
/* the input: "as it is" (every copy plays the input one beat before its place) or "capture" */
void fm1_input_live(void) { push(EV_BTN, DN_BTN_SOURCE, DN_SRC_LIVE); }
void fm1_input_capture(void) { push(EV_BTN, DN_BTN_CAPTURE, 0); }

/* main loop: one 16-row band per tick; 15 ticks per frame */
void fm1_main_loop_tick(void) {
    static int y = 0;
    dn_draw_rows(&S, band, y, 16);
    fm1_display_write_rows(y, 16, band);
    y = (y + 16) % DN_SCREEN;
}
