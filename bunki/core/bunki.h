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
#define BK_NPART  8u                     /* sine partials a voice can have (the gesture layer) */
#define BK_LOOP_N 512u                   /* the looper's events */

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
/* the gesture layer: how a step sounds, and how the partials are coupled */
enum { BK_CHOP_OFF = 0, BK_CHOP_GATE, BK_CHOP_ARP, BK_NCHOPS };   /* GATE: a partial sounds where its map is above the
                                                                  * fixed point; ARP: only the highest of each voice */
enum { BK_TOPO_LOCAL = 0, BK_TOPO_GLOBAL, BK_TOPO_RING, BK_NTOPOS }; /* LOCAL: within each voice; GLOBAL: all the
                                                                  * partials of all voices; RING: each with its two
                                                                  * neighbours (a coupled map lattice) */

enum {
    BK_P_U = 0,        /* R knob position, Q16, 0 .. BK_U_MAX (warped: one unit per doubling) */
    BK_P_D,            /* EVOLVE: R climbs the cascade by itself, Q16 speed (1: 0.5 unit/s), 0: R is the hand's */
    BK_P_EPS,          /* global coupling between the voices, Q16, 0 .. 65536 */
    BK_P_C,            /* the two paths' coupling, Q16, -65536 .. 65536 */
    BK_P_PATH,         /* BK_PATH_... */
    BK_P_LIFT,         /* BK_LIFT_... */
    BK_P_RATIO,        /* modulator : carrier, 1 .. 3 (integers only: the base period stays T0) */
    BK_P_GAIN,         /* map step -> index, radians Q8 (default 4.0) */
    BK_P_SEED,         /* initial conditions; takes effect at the next note on */
    BK_P_BETA,         /* tests: the feedback amount in radians Q8, -1 = from R (default) */
    BK_P_SOLO,         /* tests: a bit mask of the voices heard (all keep running) */
    BK_P_FORCE,        /* tests: 1 = the map taken out, the index held at its ceiling */
    BK_P_NPART,        /* the gesture layer's sine partials per voice, 0 (off) .. BK_NPART */
    BK_P_RATE,         /* its step clock, Hz Q8 (0.25 .. 64 Hz) */
    BK_P_CENTS,        /* how far the map moves a partial's pitch, cents (0 .. 2400) */
    BK_P_GLIDE,        /* the part of a step a partial glides to its new pitch, Q16 (0: jumps) */
    BK_P_CHOP,         /* BK_CHOP_... */
    BK_P_HOLD,         /* 1: a released key keeps sounding */
    BK_P_TOPO,         /* BK_TOPO_... */
    BK_P_TIMBRE,       /* 1: the timbre layer (the map at the period, as FM) sounds */
    BK_P_FREEZE,       /* 1: the step clock stands still */
    BK_P_OCT,          /* octaves the sines may leave the key by, 0 .. 3 (their maps choose up or down) */
    BK_P_OCTV,         /* which digits of a sine's map deal its octave (each a different dealing) */
    BK_P_MICRO,        /* the pitch grid: 0 semitones, 1 quarter, 2 eighth, 3 sixteenth tones, 4 none (free) */
    BK_P_STRIDE,       /* RING: a sine is pulled by the ones this far on either side (some strides cut rings) */
    BK_P_ARPV,         /* ARP's way: order (bits 0-1), plucks a sine each step - 1 (2-3), tail (4-5) */
    BK_NPARAMS
};

/* one sine of the gesture layer: its own map, stepped by the step clock, and the pitch the map gives it */
typedef struct {
    uint32_t ph, inc;                    /* phase, and its step now */
    uint32_t inc_a, inc_b;               /* the step at this step's start and the one it glides to */
    int64_t x, F;                        /* the map, Q62 */
    int32_t ca, cb;                      /* the pitch at the start and the target, cents Q4, from the key */
    int32_t amp, damp;                   /* level, Q15, and its change per frame */
    int32_t pl;                          /* ARP: the pluck's level now, Q15 */
    uint8_t gate;                        /* sounding in this step (CHOP) */
} bk_part_t;

/* the performance (the FM-1's panel as the engine takes it): keys, endless knobs, buttons, and a looper */
enum { BK_IN_KEY = 1, BK_IN_KNOB, BK_IN_BTN };
enum { BK_KNOB_R = 0, BK_KNOB_TIME, BK_KNOB_NET, BK_KNOB_SPACE, BK_KNOB_FINE, BK_KNOB_N, BK_KNOB_SEED, BK_NKNOBS };
enum { BK_BTN_HOLD = 0, BK_BTN_ARP, BK_BTN_EVOLVE, BK_BTN_TOPO, BK_BTN_FREEZE, BK_BTN_LOOP, BK_BTN_TIMBRE,
       BK_BTN_MICRO, BK_BTN_MUTATE, BK_BTN_OCT, BK_NBTNS };
enum { BK_LOOP_IDLE = 0, BK_LOOP_REC, BK_LOOP_PLAY };
typedef struct { uint32_t t; uint8_t kind, id; int16_t val; } bk_ev_t;

typedef struct {
    uint32_t inc, ph;                    /* carrier phase step and phase (a cycle = 2^32) */
    int32_t amp, gate, att, rel;         /* level now and target, Q15; envelope steps per frame */
    uint32_t age;
    uint8_t note, active, wrap, rd;      /* active: sounding and coupled; rd: the table read now */
    uint8_t held;                        /* the key is down (HOLD keeps the rest sounding) */
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
    bk_part_t part[BK_NPART];            /* the gesture layer */
    int32_t phist[BK_HIST];              /* partial 0's map, Q30, a ring by step */
    uint32_t nstep;                      /* steps since the note began */
    uint8_t ord[BK_NPART];               /* ARP: the sines in the order their maps stand, highest first */
    int8_t arp_sub;                      /* ARP: the pluck of this step played last */
} bk_voice_t;

typedef struct {
    bk_voice_t v[BK_NV];
    int32_t par[BK_NPARAMS];
    uint32_t seed, ages;
    int64_t R_hand, R;                   /* Q60: the knob's R and the R that plays */
    int32_t ev, evdir;                   /* EVOLVE: how far above the knob R stands (u, Q16), and which way */
    int32_t lyap;                        /* the voices' mean Lyapunov exponent, Q16 (EVOLVE lingers where < 0) */
    int32_t glyap;                       /* the gesture layer's, Q16, smoothed by step */
    uint32_t step_ph, sub, nsteps, mut;  /* the step clock's phase; frames into the 16-frame control period */
    int32_t gs, genv;                    /* this control period's glide (0 .. 1) and step envelope, Q15 */
    /* the performance */
    int32_t knob[BK_NKNOBS];             /* each knob's position, detents, without end */
    uint32_t press[BK_NBTNS];            /* each button's presses so far (its variations come from them) */
    int32_t kgen[BK_NKNOBS];             /* each knob's turns at its ends so far (a knob goes on, back and forth) */
    uint32_t perf;                       /* 1: keys, knobs and buttons go through bk_input */
    uint32_t loop_state, loop_n, loop_len, loop_pos, loop_rd;
    bk_ev_t loop[BK_LOOP_N];
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

/* the performance: bk_perf_init puts the engine in it (the FM-1's defaults); bk_input takes a key (id note, val
 * velocity), a knob turned (id BK_KNOB_..., val detents) or a button pressed (id BK_BTN_...). Called between
 * blocks; while the looper records or plays, what comes in is also put in the loop, and the loop's events come
 * back at the same block of every pass (a knob's turn adds again each pass: the knobs have no end) */
void    bk_perf_init(bk_engine_t *e);
void    bk_input(bk_engine_t *e, uint32_t kind, uint32_t id, int32_t val);
int32_t bk_orbit(uint32_t which, int32_t n);                          /* point n of a fixed orbit at 3.99, evened, Q16 */
void    bk_perf_block(bk_engine_t *e);                                /* (bk_render's: the loop's events now) */

/* the gesture layer */
void    bk_mutate(bk_engine_t *e);                                    /* nudge every partial's map a little */
int     bk_voice_pattern(const bk_engine_t *e, uint32_t v, int32_t tol_q30);   /* the step pattern's period */
int32_t bk_part_cents(const bk_engine_t *e, uint32_t v, uint32_t j);  /* a partial's pitch now, cents Q4 */

#endif
