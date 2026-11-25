/* bunki: one note walks a nonlinear map's bifurcation diagram.
 *
 * Each voice iterates a 1-D map (the logistic map) once per period of its own fundamental and
 * turns the map's step into the modulator's index of a two-operator FM pair. A period-p orbit of
 * the map is then a waveform of period p * T0: period doubling is heard as subharmonics.
 *
 * The engine is integers only (no float, no 64-bit division), so that the desktop build, fm1-emu
 * and the FM-1 compute the same bits: chaos turns a one-ulp difference into a different sound
 * within a few dozen periods. It uses no random numbers; the only source of complexity is the
 * nonlinearity of the maps.
 *
 * Controls are set between calls to bk_render() (on the FM-1: at block boundaries). */
#ifndef BUNKI_H
#define BUNKI_H
#include <stdint.h>

#define BK_FS     44100u
#define BK_NV     8u                     /* voices */
#define BK_FBK    64u                    /* the period-delayed feedback's phase points */
#define BK_HIST   64u                    /* map values kept per voice (period detection, screen) */
#define BK_ONE    ((int64_t)1 << 62)     /* the map's state x is Q62: 1.0 = 2^62 */
#define BK_U_MAX  (22 << 16)             /* the R knob's position u is Q16, 0 .. 22 */

/* where the sound's complexity comes from */
enum {
    BK_PATH_MAP = 0,   /* the map drives the modulation index */
    BK_PATH_FBT,       /* feedback from one period earlier: each phase point iterates sin(a + b x) */
    BK_PATH_BOTH,      /* both, coupled to each other by C (cooperate > 0, compete < 0) */
    BK_PATH_FB1,       /* DX7-style one-sample feedback: the control, the cliche this engine avoids */
    BK_NPATHS
};
/* how the map's step d = x_k - x_(k-1) becomes the index */
enum { BK_LIFT_LINEAR = 0, BK_LIFT_SQRT };

enum {
    BK_P_U = 0,        /* R knob position, Q16, 0 .. BK_U_MAX (warped: one unit per doubling) */
    BK_P_D,            /* how fast R moves by itself, Q16, 0 .. 65536 (0: R is the hand's) */
    BK_P_EPS,          /* global coupling between the voices, Q16, 0 .. 65536 */
    BK_P_C,            /* the two paths' coupling, Q16, -65536 .. 65536 */
    BK_P_PATH,         /* BK_PATH_... */
    BK_P_LIFT,         /* BK_LIFT_... */
    BK_P_RATIO,        /* modulator : carrier, 1 .. 3 (integers only: the base period stays T0) */
    BK_P_GAIN,         /* map step -> index, radians Q8 (default 4.0) */
    BK_P_SEED,         /* initial conditions; takes effect at the next note on */
    BK_P_BETA,         /* tests: the feedback amount in radians Q8, -1 = from R (default) */
    BK_P_SOLO,         /* tests: a bit mask of the voices heard (all keep running) */
    BK_NPARAMS
};

typedef struct {
    uint32_t inc, ph;                    /* carrier phase step and phase (a cycle = 2^32) */
    int32_t amp, gate, att, rel;         /* level now and target, Q15; envelope steps per frame */
    uint32_t age;
    uint8_t note, active, wrap, rd;      /* active: sounding and coupled; rd: the table read now */
    int32_t imax;                        /* the index's ceiling for this pitch, cycles Q15 */
    int64_t x, xp;                       /* the map, Q62: x_k and x_(k-1) */
    int64_t F;                           /* f_R(x) as last published to the mean field, Q62 */
    int32_t I0, I1;                      /* the index at this period's start and end, cycles Q15 */
    int32_t beta;                        /* feedback, cycles Q15 */
    int16_t W[2][BK_FBK];                /* period-delayed feedback: W[rd] = the last period, read now */
    int32_t y1, y2;                      /* one-sample feedback's memory, Q15 */
    int32_t s, sp;                       /* the feedback loop's observable (fundamental, in phase), Q15 */
    int32_t hist[BK_HIST];               /* x, Q30, a ring by period */
    uint32_t nper;                       /* periods since the note began */
    int32_t lyap_map, lyap_fb;           /* local Lyapunov exponents, natural log, Q16, smoothed */
    int64_t lsum_map, lsum_fb;           /* their sums since bk_lyap_reset(), for tests */
    uint32_t lcount;
} bk_voice_t;

typedef struct {
    bk_voice_t v[BK_NV];
    int32_t par[BK_NPARAMS];
    uint32_t seed, ages;
    int64_t R_hand, R;                   /* Q60: the knob's R and the R that plays */
    int64_t rho, rhov;                   /* the self-moving offset (Q32, R units) and its speed (Q32 / s) */
    int32_t lyap;                        /* the voices' mean Lyapunov exponent, Q16 (drives D) */
    int32_t dcx, dcy;                    /* the output's DC blocker */
    int32_t mixg;                        /* the mix's level, Q15: 1 / sqrt(voices sounding) */
    uint64_t frames;
} bk_engine_t;

void    bk_init(bk_engine_t *e, uint32_t seed);
void    bk_set(bk_engine_t *e, uint32_t param, int32_t value);
void    bk_note(bk_engine_t *e, uint32_t note, uint32_t vel);      /* vel 0: note off */
void    bk_all_off(bk_engine_t *e);
void    bk_render(bk_engine_t *e, int32_t *out, uint32_t n);      /* adds n stereo frames, L R, Q15 */

/* the knob's warp: u (Q16) <-> R (Q60) */
int64_t bk_R_of_u(int32_t u);
int32_t bk_u_of_R(int64_t R);

/* telemetry (main loop) */
int     bk_voice_period(const bk_engine_t *e, uint32_t v, int32_t tol_q30);   /* -1 unknown, 0 none <= 32 */
int32_t bk_voice_x(const bk_engine_t *e, uint32_t v, uint32_t age);          /* x, Q30, age 0 = newest */
uint32_t bk_voices_active(const bk_engine_t *e);
void    bk_lyap_reset(bk_engine_t *e);

/* the map itself, and one column of the bifurcation diagram (counts per bin of x), for the screen */
int64_t bk_logistic(int64_t R, int64_t x);
void    bk_diagram_column(int64_t R, uint16_t *bins, uint32_t nbins, uint32_t transient, uint32_t count);

/* tests: start voice v on a given phase step and state */
void    bk_voice_force(bk_engine_t *e, uint32_t v, uint32_t inc, int64_t x0, uint32_t vel);

#endif
