/* bunki on the computer: an event script in, a WAV, the telemetry and the screens out.
 *
 *   bunki run SCRIPT OUT.wav [--csv FILE] [--screens DIR]
 *   bunki sweep NOTE SECONDS OUT.wav [map|fbt|both|fb1|gesture] [SEED]   one note, the knob from 0 to 22
 *   bunki blind SEED OUT.wav KEY.txt                              a listening test, the order from SEED
 *
 * A script line is "<ms> <command> [args]" ('#' starts a comment). The time is turned into a block
 * of 256 frames (as the FM-1 renders them), and every command takes effect at the start of its block,
 * in the order of the file: the same script gives the same bits.
 *   seed N | on NOTE [VEL] | off NOTE | alloff
 *   u UNITS (0..22) | D 0..1 (EVOLVE) | eps 0..1 | C -1..1 | gain RAD | beta RAD (-1: from R)
 *   path map|fbt|both|fb1 | lift lin|sqrt | ratio 1..3
 *   the gesture layer: npart 0..8 | rate HZ | cents 0..2400 | glide 0..1 | chop off|gate|arp | hold 0|1
 *                      topo local|global|ring | timbre 0|1 | freeze 0|1 | mutate
 *   ramp u|D|eps|C FROM TO MS          a straight line, set at every block
 *   screen NAME                        the screen after this block, as NAME.ppm (with --screens)
 *   end                                the last block */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "bunki.h"
#include "bk_screen.h"

#define BLOCK 256u
#define MAXEV 20000

typedef struct {
    uint32_t block;
    char cmd[16], a[32];
    double v[3];
    int nv;
} ev_t;

typedef struct {
    int active;
    uint32_t param, b0, b1;
    int32_t from, to;
} ramp_t;

static ev_t evs[MAXEV];
static int nev;

static uint32_t block_of_ms(long ms) { return (uint32_t)(((long long)ms * BK_FS) / (1000LL * BLOCK)); }

static int param_of(const char *name)
{
    if (!strcmp(name, "u")) return BK_P_U;
    if (!strcmp(name, "D")) return BK_P_D;
    if (!strcmp(name, "eps")) return BK_P_EPS;
    if (!strcmp(name, "C")) return BK_P_C;
    if (!strcmp(name, "gain")) return BK_P_GAIN;
    if (!strcmp(name, "beta")) return BK_P_BETA;
    if (!strcmp(name, "npart")) return BK_P_NPART;
    if (!strcmp(name, "rate")) return BK_P_RATE;
    if (!strcmp(name, "cents")) return BK_P_CENTS;
    if (!strcmp(name, "glide")) return BK_P_GLIDE;
    if (!strcmp(name, "hold")) return BK_P_HOLD;
    if (!strcmp(name, "timbre")) return BK_P_TIMBRE;
    if (!strcmp(name, "freeze")) return BK_P_FREEZE;
    return -1;
}

static int32_t scaled(int param, double v)        /* a value as the engine takes it */
{
    switch (param) {
    case BK_P_GAIN: return (int32_t)(v * 256.0 + 0.5);
    case BK_P_BETA: return v < 0 ? -1 : (int32_t)(v * 256.0 + 0.5);
    case BK_P_RATE: return (int32_t)(v * 256.0 + 0.5);
    case BK_P_NPART: case BK_P_CENTS: case BK_P_HOLD: case BK_P_TIMBRE: case BK_P_FREEZE: return (int32_t)(v + 0.5);
    default: return (int32_t)(v * 65536.0 + (v < 0 ? -0.5 : 0.5));
    }
}

static int path_of(const char *s)
{
    if (!strcmp(s, "fbt")) return BK_PATH_FBT;
    if (!strcmp(s, "both")) return BK_PATH_BOTH;
    if (!strcmp(s, "fb1")) return BK_PATH_FB1;
    return BK_PATH_MAP;
}

static int load(const char *path)
{
    FILE *f = fopen(path, "r");
    char line[256];
    if (!f) { perror(path); return -1; }
    while (fgets(line, sizeof line, f)) {
        char *h = strchr(line, '#');
        long ms;
        ev_t *e = &evs[nev];
        int n;
        if (h) *h = 0;
        memset(e, 0, sizeof *e);
        n = sscanf(line, "%ld %15s %31s %lf %lf %lf", &ms, e->cmd, e->a, &e->v[0], &e->v[1], &e->v[2]);
        if (n < 2) continue;
        e->nv = n - 3;
        if (n >= 3 && strcmp(e->cmd, "ramp") && strcmp(e->cmd, "path") && strcmp(e->cmd, "lift")
            && strcmp(e->cmd, "screen") && strcmp(e->cmd, "chop") && strcmp(e->cmd, "topo")) {
            if (n >= 4) e->v[1] = e->v[0];         /* "on 60 100": 60 in a, 100 in v[0] */
            e->v[0] = atof(e->a);
        }
        e->block = block_of_ms(ms);
        if (nev && e->block < evs[nev - 1].block) {
            fprintf(stderr, "%s: times must not go back (%ld ms)\n", path, ms);
            fclose(f);
            return -1;
        }
        if (++nev >= MAXEV) break;
    }
    fclose(f);
    return 0;
}

/* WAV, 16-bit stereo */
static FILE *wav_open(const char *path)
{
    FILE *f = fopen(path, "wb");
    static const unsigned char h[44] = {'R','I','F','F',0,0,0,0,'W','A','V','E','f','m','t',' ',16,0,0,0,1,0,2,0,
        0x44,0xAC,0,0, 0x10,0xB1,2,0, 4,0,16,0,'d','a','t','a',0,0,0,0};
    if (f) fwrite(h, 1, 44, f);
    return f;
}

static void put32(FILE *f, long at, uint32_t v)
{
    unsigned char b[4] = {(unsigned char)v, (unsigned char)(v >> 8), (unsigned char)(v >> 16), (unsigned char)(v >> 24)};
    fseek(f, at, SEEK_SET);
    fwrite(b, 1, 4, f);
}

static void wav_close(FILE *f, uint32_t frames)
{
    put32(f, 4, 36u + frames * 4u);
    put32(f, 40, frames * 4u);
    fclose(f);
}

typedef struct {
    bk_engine_t e;
    bk_screen_t scr;
    ramp_t ramps[8];
    FILE *wav, *csv;
    const char *screens;
    uint64_t hash;
    uint32_t frames;
} run_t;

static void apply(run_t *r, const ev_t *ev, uint32_t b)
{
    bk_engine_t *e = &r->e;
    int p;
    if (!strcmp(ev->cmd, "seed")) bk_set(e, BK_P_SEED, (int32_t)ev->v[0]);
    else if (!strcmp(ev->cmd, "on")) bk_note(e, (uint32_t)ev->v[0], ev->nv >= 1 ? (uint32_t)ev->v[1] : 100u);
    else if (!strcmp(ev->cmd, "off")) bk_note(e, (uint32_t)ev->v[0], 0);
    else if (!strcmp(ev->cmd, "alloff")) bk_all_off(e);
    else if (!strcmp(ev->cmd, "path")) bk_set(e, BK_P_PATH, path_of(ev->a));
    else if (!strcmp(ev->cmd, "lift")) bk_set(e, BK_P_LIFT, !strcmp(ev->a, "sqrt"));
    else if (!strcmp(ev->cmd, "ratio")) bk_set(e, BK_P_RATIO, (int32_t)ev->v[0]);
    else if (!strcmp(ev->cmd, "chop")) bk_set(e, BK_P_CHOP, !strcmp(ev->a, "gate") ? BK_CHOP_GATE : !strcmp(ev->a, "arp") ? BK_CHOP_ARP : BK_CHOP_OFF);
    else if (!strcmp(ev->cmd, "topo")) bk_set(e, BK_P_TOPO, !strcmp(ev->a, "global") ? BK_TOPO_GLOBAL : !strcmp(ev->a, "ring") ? BK_TOPO_RING : BK_TOPO_LOCAL);
    else if (!strcmp(ev->cmd, "mutate")) bk_mutate(e);
    else if (!strcmp(ev->cmd, "ramp")) {
        int i;
        p = param_of(ev->a);
        if (p < 0) return;
        for (i = 0; i < 8 && r->ramps[i].active && r->ramps[i].param != (uint32_t)p; i++)
            ;
        if (i == 8) return;
        r->ramps[i].active = 1;
        r->ramps[i].param = (uint32_t)p;
        r->ramps[i].from = scaled(p, ev->v[0]);
        r->ramps[i].to = scaled(p, ev->v[1]);
        r->ramps[i].b0 = b;
        r->ramps[i].b1 = b + block_of_ms((long)ev->v[2]);
    } else if ((p = param_of(ev->cmd)) >= 0) {
        int i;
        for (i = 0; i < 8; i++)                    /* a value set by hand ends a ramp of it */
            if (r->ramps[i].active && r->ramps[i].param == (uint32_t)p)
                r->ramps[i].active = 0;
        bk_set(e, (uint32_t)p, scaled(p, ev->v[0]));
    }
}

static void block(run_t *r, uint32_t b)
{
    static int32_t buf[2 * BLOCK];
    static int16_t pcm[2 * BLOCK];
    uint32_t i;
    int k;
    for (k = 0; k < 8; k++) {
        ramp_t *rp = &r->ramps[k];
        if (!rp->active) continue;
        if (b >= rp->b1) { bk_set(&r->e, rp->param, rp->to); rp->active = 0; }
        else bk_set(&r->e, rp->param, rp->from + (int32_t)(((int64_t)(rp->to - rp->from) * (b - rp->b0)) / (rp->b1 - rp->b0)));
    }
    memset(buf, 0, sizeof buf);
    bk_render(&r->e, buf, BLOCK);
    for (i = 0; i < 2 * BLOCK; i++) {
        int32_t s = buf[i] > 32767 ? 32767 : buf[i] < -32767 ? -32767 : buf[i];
        pcm[i] = (int16_t)s;
        r->hash = (r->hash ^ (uint16_t)s) * 1099511628211ull;   /* FNV-1a over the samples */
    }
    if (r->wav) fwrite(pcm, 2, 2 * BLOCK, r->wav);
    r->frames += BLOCK;
    scr_note_block(&r->scr, &r->e);
    if (r->csv && !(b & 3u)) {
        fprintf(r->csv, "%.4f,%.4f,%.6f,%.6f,%.4f", b * (double)BLOCK / BK_FS,
                bk_u_of_R(r->e.R_hand) / 65536.0, (double)r->e.R_hand / (double)(1ULL << 60), (double)r->e.R / (double)(1ULL << 60),
                r->e.lyap / 65536.0);
        for (k = 0; k < (int)BK_NV; k++)
            if (r->e.v[k].active)
                fprintf(r->csv, ",%d,%d,%.6f", r->e.v[k].note, bk_voice_period(&r->e, (uint32_t)k, 1 << 10),
                        bk_voice_x(&r->e, (uint32_t)k, 0) / 1073741824.0);
        fputc('\n', r->csv);
    }
}

static int run_events(run_t *r, uint32_t seed)
{
    uint32_t b, last = nev ? evs[nev - 1].block + (uint32_t)(2 * BK_FS / BLOCK) : 0;
    int i = 0, k;
    for (k = 0; k < nev; k++)
        if (!strcmp(evs[k].cmd, "end")) last = evs[k].block;
    bk_init(&r->e, seed);
    scr_init(&r->scr);
    for (b = 0; b < last; b++) {
        int shot = -1;
        for (; i < nev && evs[i].block == b; i++) {
            if (!strcmp(evs[i].cmd, "screen")) shot = i;
            else apply(r, &evs[i], b);
        }
        block(r, b);
        if (shot >= 0 && r->screens) {
            char p[512];
            snprintf(p, sizeof p, "%s/%s.ppm", r->screens, evs[shot].a);
            scr_draw(&r->scr, &r->e);
            scr_write_ppm(&r->scr, p, 2);
        }
    }
    return 0;
}

static int finish(run_t *r)
{
    if (r->wav) wav_close(r->wav, r->frames);
    if (r->csv) fclose(r->csv);
    printf("frames %u  hash %016llx\n", r->frames, (unsigned long long)r->hash);
    return 0;
}

static run_t R;

static void add(uint32_t block, const char *cmd, const char *a, double v0, double v1, double v2, int nv)
{
    ev_t *e = &evs[nev++];
    memset(e, 0, sizeof *e);
    e->block = block;
    snprintf(e->cmd, sizeof e->cmd, "%s", cmd);
    snprintf(e->a, sizeof e->a, "%s", a);
    e->v[0] = v0; e->v[1] = v1; e->v[2] = v2; e->nv = nv;
}

int main(int argc, char **argv)
{
    memset(&R, 0, sizeof R);
    R.hash = 1469598103934665603ull;
    if (argc >= 4 && !strcmp(argv[1], "run")) {
        int i;
        if (load(argv[2])) return 1;
        for (i = 4; i + 1 < argc; i += 2) {
            if (!strcmp(argv[i], "--csv")) {
                R.csv = fopen(argv[i + 1], "w");
                if (R.csv) fprintf(R.csv, "t,u_hand,R_hand,R,lyap,[note,period,x]...\n");
            } else if (!strcmp(argv[i], "--screens")) R.screens = argv[i + 1];
        }
        R.wav = wav_open(argv[3]);
        run_events(&R, 1);
        return finish(&R);
    }
    if (argc >= 5 && !strcmp(argv[1], "sweep")) {
        int note = atoi(argv[2]);
        double secs = atof(argv[3]);
        uint32_t seed = argc >= 7 ? (uint32_t)strtoul(argv[6], 0, 0) : 1u;
        if (argc >= 6 && !strcmp(argv[5], "gesture")) {      /* the gesture layer alone: 4 partials, 4 Hz */
            add(0, "npart", "", 4, 0, 0, 0);
            add(0, "timbre", "", 0, 0, 0, 0);
        } else
            add(0, "path", argc >= 6 ? argv[5] : "map", 0, 0, 0, 0);
        add(0, "u", "0", 0, 0, 0, 0);
        add(block_of_ms(200), "on", "", note, 100, 0, 1);
        add(block_of_ms(1200), "ramp", "u", 0, 22, secs * 1000.0, 3);
        add(block_of_ms(1200 + (long)(secs * 1000)), "off", "", note, 0, 0, 0);
        add(block_of_ms(1200 + (long)(secs * 1000) + 1500), "end", "", 0, 0, 0, 0);
        R.wav = wav_open(argv[4]);
        run_events(&R, seed);
        return finish(&R);
    }
    if (argc >= 5 && !strcmp(argv[1], "blind")) {
        /* the stages and a window, in an order drawn by the map at 3.99 from the seed: the one who
         * listens counts subharmonics without the screen and without knowing what comes next */
        static const struct { const char *what; double u; } SEG[] = {
            {"period 1 (pure)", 0.5}, {"period 2", 1.5}, {"period 4", 2.5}, {"period 8", 3.5},
            {"period 16", 4.5}, {"chaos (R 3.80)", 0}, {"window: period 3 (R 3.835)", 0}, {"chaos (R 3.90)", 0}};
        const int n = (int)(sizeof SEG / sizeof SEG[0]);
        double key[16], u;
        int order[16], i, j;
        uint32_t seed = (uint32_t)strtoul(argv[2], 0, 0);
        int64_t x = BK_ONE / 8 + ((int64_t)seed << 29);
        FILE *kf = fopen(argv[4], "w");
        for (i = 0; i < n; i++) {
            x = bk_logistic((int64_t)4600156803381319434, x);   /* 3.99, Q60 */
            key[i] = (double)x;
            order[i] = i;
        }
        for (i = 0; i < n; i++)                    /* sort the segments by the map's values */
            for (j = i + 1; j < n; j++)
                if (key[order[j]] < key[order[i]]) { int t = order[i]; order[i] = order[j]; order[j] = t; }
        for (i = 0; i < n; i++) {
            const int s = order[i];
            uint32_t t0 = (uint32_t)i * 5000u;
            u = SEG[s].u;
            if (s == 5) u = bk_u_of_R((int64_t)(3.80 * (double)(1ULL << 60))) / 65536.0;
            if (s == 6) u = bk_u_of_R((int64_t)(3.835 * (double)(1ULL << 60))) / 65536.0;
            if (s == 7) u = bk_u_of_R((int64_t)(3.90 * (double)(1ULL << 60))) / 65536.0;
            add(block_of_ms(t0), "u", "", u, 0, 0, 0);
            add(block_of_ms(t0 + 10), "on", "", 60, 100, 0, 1);
            add(block_of_ms(t0 + 4000), "off", "", 60, 0, 0, 0);
            if (kf) fprintf(kf, "%d  %2d-%2d s  %s  (u %.3f)\n", i + 1, i * 5, i * 5 + 4, SEG[s].what, u);
        }
        add(block_of_ms((uint32_t)n * 5000u), "end", "", 0, 0, 0, 0);
        if (kf) fclose(kf);
        R.wav = wav_open(argv[3]);
        run_events(&R, seed);
        return finish(&R);
    }
    fprintf(stderr, "bunki run SCRIPT OUT.wav [--csv FILE] [--screens DIR]\n"
                    "bunki sweep NOTE SECONDS OUT.wav [map|fbt|both|fb1|gesture] [SEED]\n"
                    "bunki blind SEED OUT.wav KEY.txt\n");
    return 2;
}
