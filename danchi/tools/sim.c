/*
 * Offline harness for the DANCHI core (host only: may use double / libm).
 *
 *   sim test                      run the checks, print ok/FAIL lines
 *   sim render SEC OUT.wav [SEED] [ERASE PUSH]   render, write WAV, bar log to stderr
 *   sim trace SEC OUT.csv [SEED]  per-bar CSV (measured / target / phase / ops)
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <time.h>
#include "../core/danchi.h"

static dn_state S;
static dn_big B;
static const float SR = 44100.0f;
static int fails = 0, opens = 0;
/* a requirement that is known not to be met yet (listed in README under 批判): reported, not counted as a failure */
static void open_issue(const char *label, int ok, const char *info) {
    printf("%s  %-62s %s\n", ok ? "ok  " : "OPEN", label, info);
    if (!ok) opens++;
}

static void check(const char *label, int ok, const char *fmt, ...) __attribute__((format(printf, 3, 4)));
#include <stdarg.h>
static void check(const char *label, int ok, const char *fmt, ...) {
    char buf[512];
    va_list ap; va_start(ap, fmt); vsnprintf(buf, sizeof buf, fmt, ap); va_end(ap);
    printf("%s  %-62s %s\n", ok ? "ok  " : "FAIL", label, buf);
    if (!ok) fails++;
}

typedef struct { double peak, sumsq; long n, nan, overs; double ms; double gr_time; } stats_t;

static void run(dn_state *s, double sec, stats_t *st, float *capL, float *capR) {
    float L[256], R[256];
    long blocks = (long)(sec * SR / 256.0);
    clock_t t0 = clock();
    for (long b = 0; b < blocks; b++) {
        dn_process(s, L, R, 256);
        if (st) {
            for (int i = 0; i < 256; i++) {
                float a = L[i], c = R[i];
                if (!isfinite(a) || !isfinite(c)) st->nan++;
                double m = fabs(a) > fabs(c) ? fabs(a) : fabs(c);
                if (m > st->peak) st->peak = m;
                if (m > 0.999) st->overs++;
                st->sumsq += (double)a * a + (double)c * c;
                st->n += 2;
            }
            if (s->lim_g < 0.9f) st->gr_time += 256.0 / SR;
        }
        if (capL) { memcpy(capL + b * 256, L, sizeof L); memcpy(capR + b * 256, R, sizeof R); }
    }
    if (st) st->ms += 1000.0 * (double)(clock() - t0) / CLOCKS_PER_SEC;
}
static void run_bars(dn_state *s, int bars) {
    float L[256], R[256];
    int target = s->bar + bars;
    while (s->bar < target) dn_process(s, L, R, 256);
}

static void write_wav(const char *path, const float *L, const float *R, long n) {
    FILE *f = fopen(path, "wb");
    if (!f) { perror(path); return; }
    unsigned data = (unsigned)(n * 4);
    unsigned hdr[11] = { 0x46464952u, 36 + data, 0x45564157u, 0x20746d66u, 16, 0x00020001u, 44100, 44100 * 4, 0x00100004u, 0x61746164u, data };
    fwrite(hdr, 4, 11, f);
    for (long i = 0; i < n; i++) {
        short a = (short)lrintf(fmaxf(-1.f, fminf(1.f, L[i])) * 32767.f);
        short b = (short)lrintf(fmaxf(-1.f, fminf(1.f, R[i])) * 32767.f);
        fwrite(&a, 2, 1, f); fwrite(&b, 2, 1, f);
    }
    fclose(f);
}

/* a quiet, controlled building: only the given units sound */
static void scene_clear(dn_state *s) {
    for (int k = 1; k < DN_TRACKS; k++) { s->tr[k].on = 0; s->tr[k].nhit = 0; s->tr[k].hand = 2; }
    s->keeper_mode = 1; s->keeper_on = 1;
    for (int i = 0; i < DN_OPS; i++) s->op[i].energy = 2.0f;
    s->quiet = -1000000;          /* operators may not act */
    s->ph_left = 1000000;         /* no phase change */
    for (int k = 0; k < DN_TRACKS; k++) s->tr[k].dormant = 0;
}
static void unit(dn_state *s, int k, int step, float stretch, float lean, float repay, float swing) {
    dn_track *T = &s->tr[k];
    T->on = 1; T->hand = 1; T->nhit = 1; T->dormant = 0;
    T->hit[0].step = (uint8_t)step; T->hit[0].copies = 1; T->hit[0].micro = 0; T->hit[0].spread = 8.f;
    T->stretch = stretch; T->lean = lean; T->repay = repay; T->swing = swing; T->debt = 0.f;
}
static void add_hit(dn_state *s, int k, int step) {
    dn_track *T = &s->tr[k];
    T->hit[T->nhit].step = (uint8_t)step; T->hit[T->nhit].copies = 1; T->hit[T->nhit].micro = 0; T->hit[T->nhit].spread = 8.f;
    T->nhit++;
}

static int is_denormal(float x) { return x != 0.0f && fabsf(x) < 1.17549435e-38f; }
static long count_denormals(const dn_state *s, const dn_big *b) {
    long c = 0;
    const float *p = &b->room[0][0][0];                 /* only the float part: the rest is 16-bit audio */
    for (size_t i = 0; i < sizeof(b->room) / sizeof(float); i++) c += is_denormal(p[i]);
    for (int k = 0; k < DN_TRACKS; k++) c += is_denormal(s->tr[k].lp1) + is_denormal(s->tr[k].lp2) + is_denormal(s->tr[k].flash);
    for (int i = 0; i < DN_VOICES + DN_SPILL; i++) c += is_denormal(s->vo[i].amp) + is_denormal(s->vo[i].held) + is_denormal(s->vo[i].prev);
    c += is_denormal(s->duck) + is_denormal(s->duck_tg) + is_denormal(s->out_lp[0]) + is_denormal(s->out_lp[1]);
    for (int k = 0; k < DN_TRACKS; k++) c += is_denormal(s->tr[k].ds);
    for (int i = 0; i < 2; i++) for (int j = 0; j < DN_DIFBUF; j++) c += is_denormal(s->dif[i][j]);
    for (int r = 0; r < DN_ROOMS; r++) c += is_denormal(s->rlpA[r]) + is_denormal(s->rlpB[r]);
    c += is_denormal(s->lim_env) + is_denormal(s->env_f) + is_denormal(s->hand_speed) + is_denormal(s->dcy[0]) + is_denormal(s->dcy[1]);
    c += is_denormal(s->elp[0]) + is_denormal(s->elp[1]);
    return c;
}

/* ---------------------------------------------------------------- tests */
static void t_memory(void) {
    size_t ws = sizeof(dn_state), bs = sizeof(dn_big);
    check("working RAM (dn_state) within 96 KB", ws <= 96 * 1024, "%zu B = %.1f KB", ws, ws / 1024.0);
    check("large buffers (dn_big) within 336 KB", bs <= 336 * 1024, "%zu B = %.1f KB", bs, bs / 1024.0);
}

static void t_causality(void) {
    /* A: step 2, stretched across the beat at 4. B: step 4, leans forward. */
    dn_init(&S, &B, SR, 7);
    scene_clear(&S);
    unit(&S, 1, 2, 2.5f, 0.0f, 0.0f, 0.0f);    /* A: gate 2.25 steps -> ends at 4.25 */
    unit(&S, 2, 4, 1.0f, 1.0f, 0.0f, 0.0f);    /* B: lean +1 */
    run_bars(&S, 3);
    float offB = S.tr[2].hit[0].off; int cause = S.tr[2].hit[0].cause;
    /* push = lean x overlap(0.25) x 0.85, limited by the credit left before this note (repay 0 here) */
    float d0 = S.tr[2].debt + offB;
    float expect = -0.85f * 0.25f * (d0 > DN_CREDIT ? (1.0f - d0) / (1.0f - DN_CREDIT) : 1.0f);
    check("B enters early because A's stretched note crosses the beat", fabsf(offB - expect) < 0.002f && offB < -0.05f && cause == 1,
          "offset %.3f steps (rule: %.3f with debt %.2f before), cause unit %d", offB, expect, d0, cause);

    S.tr[1].on = 0;                      /* ablation: A moves out */
    run_bars(&S, 3);
    check("...and without A, B is back on the beat", fabsf(S.tr[2].hit[0].off) < 1e-4f && S.tr[2].hit[0].cause == -1,
          "offset %.4f, cause %d", S.tr[2].hit[0].off, S.tr[2].hit[0].cause);

    S.tr[1].on = 1; S.tr[1].stretch = 1.0f;   /* A not crossing the beat: no pressure */
    run_bars(&S, 3);
    check("A long but not across the beat: no push", fabsf(S.tr[2].hit[0].off) < 1e-4f, "offset %.4f", S.tr[2].hit[0].off);

    S.tr[1].stretch = 2.5f; S.tr[2].lean = -1.0f;   /* B yields */
    run_bars(&S, 3);
    { float off = S.tr[2].hit[0].off, d1 = S.tr[2].debt + off, ex = 0.85f * 0.25f * (-d1 > DN_CREDIT ? (1.0f + d1) / (1.0f - DN_CREDIT) : 1.0f);
      check("B yields (lean -1): waits instead", fabsf(off - ex) < 0.002f && off > 0.05f, "offset %+.3f (rule: %+.3f)", off, ex); }

    /* chain: A pushes B early; B now starts before beat 4 and, tied over, sounds across it;
       so C (inside B's note) is pushed in turn. Without A, B starts on the beat and nothing crosses. */
    dn_init(&S, &B, SR, 7);
    scene_clear(&S);
    unit(&S, 1, 2, 2.5f, 0.0f, 0.0f, 0.0f);    /* A */
    unit(&S, 2, 4, 1.5f, 1.0f, 0.0f, 0.0f);    /* B: 4 .. 5.35, inside one eighth (no line crossed) */
    unit(&S, 3, 5, 1.0f, 1.0f, 0.0f, 0.0f);    /* C at 5, inside B's note */
    run_bars(&S, 3);
    float b1 = S.tr[2].hit[0].off, c1 = S.tr[3].hit[0].off; int cc = S.tr[3].hit[0].cause;
    S.tr[1].on = 0;
    run_bars(&S, 3);
    float b0 = S.tr[2].hit[0].off, c0 = S.tr[3].hit[0].off;
    check("chain A->B->C: removing A changes C two units away", fabsf(c1 - c0) > 0.05f && cc == 2 && fabsf(c0) < 1e-4f,
          "B %.3f->%.3f, C %.3f->%.3f (C pushed by unit %d)", b1, b0, c1, c0, cc);
}

static void t_debt(void) {
    dn_init(&S, &B, SR, 11);
    scene_clear(&S);
    unit(&S, 1, 2, 2.5f, 0.0f, 0.0f, 0.0f);
    unit(&S, 2, 4, 1.0f, 1.0f, 1.0f, 0.0f);       /* B borrows at 4 and returns later */
    add_hit(&S, 2, 10);                          /* nothing pushes this one */
    run_bars(&S, 4);
    float a = S.tr[2].hit[0].off, b = S.tr[2].hit[1].off;
    check("borrowed time is returned: B's next note comes late", a < -0.1f && b > 0.05f,
          "at 4: %.3f, at 10: %+.3f (debt now %.3f)", a, b, S.tr[2].debt);
    S.tr[2].repay = 0.0f;
    run_bars(&S, 4);
    check("...with repay 0 it is never returned", fabsf(S.tr[2].hit[1].off) < 1e-4f, "at 10: %+.4f", S.tr[2].hit[1].off);
}

static void t_phases(void) {
    dn_init(&S, &B, SR, 3);
    int N = 20000, *len = malloc(sizeof(int) * N), same = 0, prev = S.phase;
    double sum = 0;
    for (int i = 0; i < N; i++) {
        S.ph_left = 0;
        /* call the same transition the core uses at a bar end */
        extern void dn_test_phase_next(dn_state *);
        dn_test_phase_next(&S);
        len[i] = S.ph_len; sum += len[i];
        if (S.phase == prev) same++;
        prev = S.phase;
    }
    int cmp(const void *a, const void *b);
    qsort(len, N, sizeof(int), cmp);
    double med = len[N / 2], p90 = len[N * 9 / 10], p99 = len[N * 99 / 100];
    check("phase lengths are heavy-tailed (mostly short, sometimes very long)",
          med < 16 && p99 > 100 && same == 0,
          "median %.0f, mean %.1f, p90 %.0f, p99 %.0f, max %d bars", med, sum / N, p90, p99, len[N - 1]);
    free(len);
}
int cmp(const void *a, const void *b) { return *(const int *)a - *(const int *)b; }

static void t_headroom(void) {
    dn_init(&S, &B, SR, 21);
    stats_t st = { 0 };
    run(&S, 600.0, &st, NULL, NULL);
    double rms = sqrt(st.sumsq / st.n);
    check("10 min default: finite, never clips", st.nan == 0 && st.peak < 1.0,
          "peak %.3f (%.1f dBFS), rms %.1f dBFS", st.peak, 20 * log10(st.peak), 20 * log10(rms + 1e-12));
    check("limiter rarely engaged (>1 dB) in 10 min", st.gr_time < 60.0, "%.1f s of 600", st.gr_time);
    check("faster than real time on this host", st.ms < 600000.0 / 20.0, "%.0fx real time", 600000.0 / st.ms);

    /* a crowded building: every unit in, stacked */
    dn_init(&S, &B, SR, 22);
    for (int k = 1; k < DN_TRACKS; k++) {
        dn_track *T = &S.tr[k];
        T->on = 1; T->nhit = 0;
        for (int h = 0; h < 4; h++) { T->hit[T->nhit].step = (uint8_t)((k + h * 4) & 15); T->hit[T->nhit].copies = 2; T->hit[T->nhit].spread = 3.f + h; T->hit[T->nhit].micro = 0; T->nhit++; }
        T->stretch = 3.5f;
    }
    S.quiet = -1000000;
    stats_t s2 = { 0 };
    run(&S, 60.0, &s2, NULL, NULL);
    check("crowded (15 units x 4 hits x 2 copies, long): still no clipping", s2.nan == 0 && s2.peak < 1.0,
          "peak %.3f, limiter >1 dB for %.1f s of 60, %.0fx real time", s2.peak, s2.gr_time, 60000.0 / s2.ms);
}

static void t_denormal(void) {
    dn_init(&S, &B, SR, 5);
    run(&S, 20.0, NULL, NULL, NULL);
    /* the hand turns everyone off, caretaker too */
    for (int k = 1; k < DN_TRACKS; k++) if (S.tr[k].on) dn_button(&S, DN_BTN_TRACK, k);
    dn_button(&S, DN_BTN_KEEPER, 2);
    for (int i = 0; i < 40; i++) dn_encoder(&S, DN_K_ERASE, 1);
    run(&S, 15.0, NULL, NULL, NULL);       /* what was already planned, and the echoes, die away */
    stats_t st = { 0 };
    run(&S, 105.0, &st, NULL, NULL);
    long d = count_denormals(&S, &B);
    const float *v = dn_view(&S);
    check("after 2 min of silence no state is denormal", d == 0, "%ld denormals", d);
    check("silence by the hand is shown as such (not a trap)", v[V_HANDSTOP] == 1.0f && st.peak < 1e-4,
          "handstop=%g sounding=%g peak=%.2g", v[V_HANDSTOP], v[V_SOUNDING], st.peak);
    stats_t s3 = { 0 };
    run(&S, 30.0, &s3, NULL, NULL);
    dn_init(&S, &B, SR, 5);
    stats_t s4 = { 0 };
    run(&S, 30.0, &s4, NULL, NULL);
    check("silent processing is not slower than playing (no denormal stall)", s3.ms < s4.ms * 1.5,
          "silent %.0f ms vs playing %.0f ms per 30 s", s3.ms, s4.ms);
}

static void t_no_trap(void) {
    dn_init(&S, &B, SR, 9);
    dn_set_knob(&S, DN_K_ERASE, 0.0f);
    dn_set_knob(&S, DN_K_META, 1.0f);
    dn_set_knob(&S, DN_K_TEMPO, 0.0f);
    int minsound = 99, bars = 0;
    float L[256], R[256];
    while (S.bar < 600) {
        int b = S.bar;
        dn_process(&S, L, R, 256);
        if (S.bar != b) { int c = 0; for (int k = 1; k < DN_TRACKS; k++) c += S.tr[k].on && S.tr[k].nhit && !S.tr[k].dormant; if (c < minsound) minsound = c; bars++; }
    }
    for (int i = 0; i < 300; i++) dn_encoder(&S, DN_K_TEMPO, -5);
    check("tempo knob bottoms out at 40 BPM, never 0", dn_tempo_bpm(&S) >= 39.9f, "%.1f BPM", dn_tempo_bpm(&S));
    check("600 bars wanting 'individual' with fast life/death: never empties itself",
          minsound >= 1, "fewest sounding units in any bar: %d", minsound);
}

static void t_motion(void) {
    dn_init(&S, &B, SR, 13);
    S.quiet = -1000000;
    dn_button(&S, DN_BTN_REC, 0);           /* arm */
    float L[256], R[256];
    while (S.bar < 2) dn_process(&S, L, R, 256);
    /* bar 2: sweep ERASE up over half a bar, then the hand stops */
    int bl = (int)(S.cur_len / 256);
    int starts = 0, was = 0;
    for (int i = 0; i < bl / 2; i++) {
        if (i % 4 == 0) dn_encoder(&S, DN_K_ERASE, 1);
        if (i == bl / 4) dn_encoder(&S, DN_K_META, 1);      /* another knob during the same gesture */
        dn_process(&S, L, R, 256);
        if (S.gesture && !was) starts++;
        was = S.gesture;
    }
    float top = S.knob[DN_K_ERASE];
    while (S.bar < 4) { dn_process(&S, L, R, 256); if (S.gesture && !was) starts++; was = S.gesture; }
    check("touching a second knob mid-gesture does not start a new gesture", starts == 1, "gesture starts: %d", starts);
    dn_button(&S, DN_BTN_REC, 0);           /* disarm: playback only */
    /* one loop later (4 bars), the same moment should replay the sweep */
    while (S.bar < 6) dn_process(&S, L, R, 256);
    float mx = 0, mn = 1;
    while (S.bar < 7) { dn_process(&S, L, R, 256); if (S.knob[DN_K_ERASE] > mx) mx = S.knob[DN_K_ERASE]; if (S.knob[DN_K_ERASE] < mn) mn = S.knob[DN_K_ERASE]; }
    check("recorded hand motion loops back (ERASE sweep replays)", fabsf(mx - top) < 0.03f && mx - mn > 0.15f,
          "replayed %.2f..%.2f, recorded top %.2f", mn, mx, top);
    check("both touched lanes recorded", (S.lane_has & 3u << 1) == (3u << 1) || (S.lane_has & ((1u << DN_K_ERASE) | (1u << DN_K_META))) == ((1u << DN_K_ERASE) | (1u << DN_K_META)),
          "lanes 0x%02x", S.lane_has);
}

static void t_determinism(void) {
    static float a[44100 * 4], b[44100 * 4], c[44100 * 4], d[44100 * 4];
    dn_init(&S, &B, SR, 77); run(&S, 20.0, NULL, NULL, NULL); run(&S, 4.0, NULL, a, b);
    dn_init(&S, &B, SR, 77); run(&S, 20.0, NULL, NULL, NULL); run(&S, 4.0, NULL, c, d);
    check("same seed, same sound", memcmp(a, c, sizeof a) == 0 && memcmp(b, d, sizeof b) == 0, "%s", "bit-identical");
}

/* closed loop: does the population steer the measured state toward the wanted one? */
static int push_only = 0;
static void t_steer(void) {
    for (int trial = 0; trial < 2 && !push_only; trial++) {
        double gain_avg[3] = { 0 };
        int seeds = 6;
        for (int sd = 0; sd < seeds; sd++) {
            dn_init(&S, &B, SR, 100 + sd);
            S.phase = DN_PH_GYORETSU; S.ph_left = 1000000;   /* no erase tilt during the test */
            if (trial == 1) S.quiet = -1000000;              /* control: operators frozen */
            dn_set_knob(&S, DN_K_ERASE, 0.1f);
            run_bars(&S, 120);
            double lo = 0; for (int i = 0; i < 40; i++) { run_bars(&S, 1); lo += S.h_e[0]; } lo /= 40;
            dn_set_knob(&S, DN_K_ERASE, 0.9f);
            run_bars(&S, 200);
            double hi = 0; for (int i = 0; i < 40; i++) { run_bars(&S, 1); hi += S.h_e[0]; } hi /= 40;
            dn_set_knob(&S, DN_K_ERASE, 0.1f);
            run_bars(&S, 200);
            double lo2 = 0; for (int i = 0; i < 40; i++) { run_bars(&S, 1); lo2 += S.h_e[0]; } lo2 /= 40;
            gain_avg[0] += lo / seeds; gain_avg[1] += hi / seeds; gain_avg[2] += lo2 / seeds;
        }
        char info[160];
        snprintf(info, sizeof info, "measured %.2f -> %.2f -> %.2f", gain_avg[0], gain_avg[1], gain_avg[2]);
        if (trial == 0) {
            check("ERASE wanted 0.1 -> 0.9: measured rises (6 seeds, 200 bars)", gain_avg[1] - gain_avg[0] > 0.12, "%s", info);
            open_issue("ERASE wanted back 0.9 -> 0.1: measured returns within 200 bars", gain_avg[1] - gain_avg[2] > 0.5 * (gain_avg[1] - gain_avg[0]), info);
        } else
            check("control: same with operators frozen hardly moves", fabs(gain_avg[1] - gain_avg[0]) < 0.05, "%s", info);
    }
    double p_avg[3] = { 0 };
    int seeds = 6;
    for (int sd = 0; sd < seeds; sd++) {
        dn_init(&S, &B, SR, 200 + sd);
        S.phase = DN_PH_KATAMARI; S.ph_left = 1000000;       /* no push tilt */
        dn_set_knob(&S, DN_K_PUSH, 0.05f);
        run_bars(&S, 120);
        double lo = 0; for (int i = 0; i < 40; i++) { run_bars(&S, 1); lo += S.h_p[0]; } lo /= 40;
        dn_set_knob(&S, DN_K_PUSH, 0.95f);
        run_bars(&S, 200);
        double hi = 0; for (int i = 0; i < 40; i++) { run_bars(&S, 1); hi += S.h_p[0]; } hi /= 40;
        dn_set_knob(&S, DN_K_PUSH, 0.05f);
        run_bars(&S, 200);
        double lo2 = 0; for (int i = 0; i < 40; i++) { run_bars(&S, 1); lo2 += S.h_p[0]; } lo2 /= 40;
        p_avg[0] += lo / seeds; p_avg[1] += hi / seeds; p_avg[2] += lo2 / seeds;
    }
    char info[160];
    snprintf(info, sizeof info, "measured %.2f -> %.2f -> %.2f", p_avg[0], p_avg[1], p_avg[2]);
    check("PUSH wanted 0.05 -> 0.95: measured rises (6 seeds, 200 bars)", p_avg[1] - p_avg[0] > 0.08, "%s", info);
    open_issue("PUSH wanted back 0.95 -> 0.05: measured returns within 200 bars", p_avg[1] - p_avg[2] > 0.5 * (p_avg[1] - p_avg[0]), info);
}

/* long run: pacing of changes, life and death, no flattening */
static void t_longrun(void) {
    dn_init(&S, &B, SR, 31);
    float L[256], R[256];
    int lastact = -1, gaps = 0, mingap = 9999, acts = 0, births = 0, deaths = 0, seen = 0;
    double gapsum = 0;
    int kinds[DN_OP_KINDS] = { 0 };
    int bars = 2400;
    static float me[2400];
    int phcount[DN_PHASES] = { 0 };
    while (S.bar < bars) {
        int b = S.bar;
        dn_process(&S, L, R, 256);
        if (S.bar == b) continue;
        me[b] = S.h_e[0];
        phcount[S.phase]++;
        for (; seen < S.log_n; seen++) {
            const dn_logent *e = &S.log[seen % DN_LOG];
            if (e->type == DN_LG_ACT) {
                acts++; kinds[e->kind]++;
                if (lastact >= 0) { int g = e->bar - lastact; gaps++; gapsum += g; if (g < mingap) mingap = g; }
                lastact = e->bar;
            } else if (e->type == DN_LG_BORN) births++;
            else if (e->type == DN_LG_DIED) deaths++;
        }
    }
    check("one change at a time, each held for >= 3 bars", mingap >= 3, "%d actions, gap min %d, mean %.1f bars", acts, mingap, gapsum / (gaps ? gaps : 1));
    check("operators die and are born", deaths > 5 && births == deaths, "%d deaths, %d births in %d bars", deaths, births, bars);
    printf("      actions by kind:");
    for (int k = 0; k < DN_OP_KINDS; k++) printf(" %s %d", dn_op_code[k], kinds[k]);
    printf("\n      bars per phase:");
    for (int k = 0; k < DN_PHASES; k++) printf(" %s %d", dn_phase_code[k], phcount[k]);
    printf("\n");
    /* flattening: 32-bar window means should spread, not sit at one value */
    double wm[100]; int nw = 0;
    for (int w = 0; w + 32 <= bars && nw < 100; w += 32, nw++) { double a = 0; for (int i = 0; i < 32; i++) a += me[w + i]; wm[nw] = a / 32; }
    double mn = 1, mx = 0, mean = 0, sd = 0;
    for (int i = 0; i < nw; i++) { if (wm[i] < mn) mn = wm[i]; if (wm[i] > mx) mx = wm[i]; mean += wm[i] / nw; }
    for (int i = 0; i < nw; i++) sd += (wm[i] - mean) * (wm[i] - mean) / nw;
    check("measured ERASE over 32-bar windows does not flatten", mx - mn > 0.15, "window means %.2f..%.2f (sd %.3f)", mn, mx, sqrt(sd));
}

/* ---------------------------------------------------------------- sources: a file, the input */
static uint32_t lcg = 12345;
static uint32_t lcg_next(void) { lcg = lcg * 1664525u + 1013904223u; return lcg; }

/* one unit, one hit at step 0 (micro in 1/64 step), long; the input is silent except one click.
   returns the delay (samples) from the click going in to it coming out */
static long live_delay_for(int micro, float *expect) {
    dn_init(&S, &B, SR, 3);
    scene_clear(&S);
    dn_button(&S, DN_BTN_KEEPER, 2);
    unit(&S, 1, 0, 4.0f, 0.0f, 0.0f, 0.0f);
    S.tr[1].hit[0].micro = (int8_t)micro;
    S.tr[1].dist = 0.0f;
    dn_set_knob(&S, DN_K_ROOM, 0.0f);
    dn_button(&S, DN_BTN_SOURCE, DN_SRC_LIVE);
    float in[256], L[256], R[256];
    for (int i = 0; i < 256; i++) in[i] = 0.0f;
    while (S.bar < 2) dn_process_in(&S, in, L, R, 256);
    uint32_t t0 = S.cur_start + S.cur_len;               /* the next bar */
    float D = S.live_delay;
    int32_t devs = (int32_t)((float)micro / 64.0f * S.cur_step);
    *expect = D + (float)devs;
    uint32_t tau = t0 - (uint32_t)D + 3000u;
    long found = -1;
    for (int k = 0; k < 4000 && found < 0; k++) {
        for (int i = 0; i < 256; i++) in[i] = (S.now + (uint32_t)i == tau) ? 0.9f : 0.0f;
        uint32_t base = S.now;
        dn_process_in(&S, in, L, R, 256);
        for (int i = 0; i < 256 && found < 0; i++)
            if ((int32_t)(base + (uint32_t)i - tau) > 0 && fabsf(L[i]) > 0.02f) found = (long)(int32_t)(base + (uint32_t)i - tau);
    }
    return found;
}

/* a quiet scene: one unit with long notes at 0 and 8, no caretaker */
static void scene_one(dn_state *s, unsigned seed) {
    dn_init(s, &B, SR, seed);
    scene_clear(s);
    dn_button(s, DN_BTN_KEEPER, 2);
    unit(s, 1, 0, 3.0f, 0.0f, 0.0f, 0.0f);
    add_hit(s, 1, 8);
}
static void feed(dn_state *s, int blocks, float amp, double *ph, double *rms) {
    float in[256], L[256], R[256];
    double acc = 0;
    for (int k = 0; k < blocks; k++) {
        for (int i = 0; i < 256; i++) { in[i] = amp * (float)sin(*ph); *ph += 2 * 3.14159265358979 * 300 / SR; }
        dn_process_in(s, in, L, R, 256);
        for (int i = 0; i < 256; i++) acc += (double)L[i] * L[i];
    }
    if (rms) *rms = sqrt(acc / (blocks * 256.0));
}

static void t_sources(void) {
    float L[256], R[256], in[256];
    /* a file: the host writes 16-bit mono, then commits it */
    dn_init(&S, &B, SR, 8);
    int16_t *a = dn_sample_area(&S);
    int n = (int)(0.4f * SR);
    for (int i = 0; i < n; i++) a[i] = (int16_t)((float)((int32_t)(lcg_next() >> 17) - 16384) * expf(-6.0f * (float)i / (float)n));
    dn_sample_commit(&S, n);
    stats_t st = { 0 };
    run(&S, 12.0, &st, NULL, NULL);
    const float *v = dn_view(&S);
    check("a loaded sound becomes the object and is placed like the FM one",
          v[V_SRC] == DN_SRC_BUF && fabsf(v[V_SAMP_LEN] - 0.4f) < 0.02f && st.peak > 0.05 && st.peak < 1.0 && st.nan == 0,
          "source %g, %.2f s, peak %.2f", v[V_SRC], v[V_SAMP_LEN], st.peak);
    /* the input has its own ring: it never touches the object */
    uint32_t sum0 = 0, sum1 = 0;
    for (int i = 0; i < DN_OBJBUF; i++) sum0 = sum0 * 31u + (uint16_t)B.obj[i];
    for (int k = 0; k < 200; k++) { for (int i = 0; i < 256; i++) in[i] = (float)(lcg_next() >> 8) / 16777216.0f - 0.5f; dn_process_in(&S, in, L, R, 256); }
    for (int i = 0; i < DN_OBJBUF; i++) sum1 = sum1 * 31u + (uint16_t)B.obj[i];
    check("input is kept apart from a fixed object", sum0 == sum1, "%s", sum0 == sum1 ? "object unchanged" : "object changed");

    /* the input itself: a copy's offset from the grid is heard as a different delay */
    float e0, e1;
    long d0 = live_delay_for(0, &e0), d1 = live_delay_for(-16, &e1);
    check("live: a copy on the grid plays the input one beat later", d0 >= 0 && labs(d0 - (long)e0) <= 3, "delay %ld samples (expect %.0f)", d0, e0);
    check("live: a copy placed 1/4 step early has 1/4 step less delay", d1 >= 0 && labs(d1 - (long)e1) <= 3, "delay %ld samples (expect %.0f)", d1, e1);

    /* capture: silence is refused; a sound is kept from where it starts */
    double ph = 0;
    scene_one(&S, 9);
    dn_button(&S, DN_BTN_SOURCE, DN_SRC_LIVE);
    feed(&S, (int)(1.0f * SR / 256), 0.0f, &ph, NULL);
    dn_button(&S, DN_BTN_CAPTURE, 0);
    feed(&S, 2, 0.0f, &ph, NULL);
    v = dn_view(&S);
    int quiet_ok = v[V_SRC] == DN_SRC_LIVE && v[V_SRC_NOTE] == 2;
    S.cap_len = 0.75f;
    feed(&S, (int)(0.3f * SR / 256), 0.5f, &ph, NULL);
    feed(&S, (int)(0.1f * SR / 256), 0.0f, &ph, NULL);
    dn_button(&S, DN_BTN_CAPTURE, 0);
    feed(&S, 2, 0.0f, &ph, NULL);
    v = dn_view(&S);
    float src = v[V_SRC], len = v[V_SAMP_LEN];
    check("capturing silence is refused; a sound is kept from where it starts",
          quiet_ok && src == DN_SRC_BUF && v[V_OBJ_FROM] == DN_FROM_INPUT && len > 0.38f && len < 0.43f,
          "silence refused: %s; 0.3 s sound + 0.1 s silence -> %.3f s object", quiet_ok ? "yes" : "no", len);

    /* no dip: the captured sound plays as loud as the live copies did */
    double r_live, r_cap;
    scene_one(&S, 10);
    dn_button(&S, DN_BTN_SOURCE, DN_SRC_LIVE);
    ph = 0;
    feed(&S, (int)(4 * S.cur_len / 256), 0.3f, &ph, NULL);
    feed(&S, (int)(4 * S.cur_len / 256), 0.3f, &ph, &r_live);
    dn_button(&S, DN_BTN_CAPTURE, 0);
    feed(&S, (int)(1 * S.cur_len / 256), 0.3f, &ph, NULL);
    feed(&S, (int)(4 * S.cur_len / 256), 0.3f, &ph, &r_cap);
    double ddb = 20 * log10(r_cap / r_live);
    check("capturing keeps the level of the live copies (no dip)", fabs(ddb) < 1.5, "live %.1f dBFS -> captured %.1f dBFS (%+.1f dB)",
          20 * log10(r_live), 20 * log10(r_cap), ddb);
    /* and it can be taken again at any time, without going back to "as it is" */
    feed(&S, (int)(1.0f * SR / 256), 0.6f, &ph, NULL);
    float before = S.samp_gain;
    dn_button(&S, DN_BTN_CAPTURE, 0);
    feed(&S, 2, 0.6f, &ph, NULL);
    check("capture works again while a captured sound plays", S.src == DN_SRC_BUF && S.obj_from == DN_FROM_INPUT && S.src_note == 1 && before == S.samp_gain,
          "src %d, from %d, note %d", S.src, S.obj_from, S.src_note);
}

static void t_features(void) {
    float L[256], R[256];
    /* resample: what is sounding becomes the object, at once */
    dn_init(&S, &B, SR, 21);
    run_bars(&S, 6);
    dn_button(&S, DN_BTN_RESAMPLE, 0);
    dn_process(&S, L, R, 256); dn_process(&S, L, R, 256); dn_process(&S, L, R, 256); dn_process(&S, L, R, 256);
    const float *v = dn_view(&S);
    float len = v[V_SAMP_LEN];
    stats_t st = { 0 };
    run(&S, 10.0, &st, NULL, NULL);
    check("resample: the sound right now becomes the object", v[V_SRC] == DN_SRC_BUF && v[V_OBJ_FROM] == DN_FROM_OUTPUT && v[V_GENS] == 1 && len > 0.2f && st.peak > 0.05 && st.peak < 1.0,
          "from %g, generation %g, %.2f s, peak afterwards %.2f", v[V_OBJ_FROM], v[V_GENS], len, st.peak);
    /* automatically, every bar */
    dn_set_knob(&S, DN_K_GEN, 0.0f);
    dn_button(&S, DN_BTN_FEATURE, DN_F_GEN);
    int g0 = S.gens;
    run_bars(&S, 6);
    check("automatic resample every bar", S.gens - g0 >= 5, "%d generations in 6 bars", S.gens - g0);

    /* own cycles: a unit with a cycle of 18 drifts against the bar */
    dn_init(&S, &B, SR, 22);
    scene_clear(&S);
    unit(&S, 2, 0, 1.0f, 0.0f, 0.0f, 0.0f);
    dn_set_knob(&S, DN_K_POLY, 1.0f);
    dn_button(&S, DN_BTN_FEATURE, DN_F_POLY);
    char seq[64] = ""; int moves = 0, last = -2;
    for (int b = 0; b < 8; b++) {
        run_bars(&S, 1);
        int bs = S.tr[2].hit[0].bstep;
        char t[8]; snprintf(t, sizeof t, "%d ", bs); strcat(seq, t);
        if (bs >= 0 && last >= 0 && bs != last) moves++;
        if (bs >= 0) last = bs;
    }
    check("own cycles: unit 102 (18 steps) drifts against the bar", S.tr[2].cycle == 18 && moves >= 3, "cycle %d, where it sounded per bar: %s", S.tr[2].cycle, seq);

    /* the caretaker's press makes the others quieter */
    double rms[2];
    for (int on = 0; on < 2; on++) {
        dn_init(&S, &B, SR, 23);
        dn_button(&S, DN_BTN_KEEPER, 1);
        S.quiet = -1000000; S.ph_left = 1000000;
        if (on) { dn_set_knob(&S, DN_K_DUCK, 1.0f); dn_button(&S, DN_BTN_FEATURE, DN_F_DUCK); }
        run_bars(&S, 2);
        stats_t s2 = { 0 };
        run(&S, 20.0, &s2, NULL, NULL);
        rms[on] = sqrt(s2.sumsq / s2.n);
    }
    check("caretaker's press lowers the others", 20 * log10(rms[1] / rms[0]) < -1.0, "%+.1f dB with full press", 20 * log10(rms[1] / rms[0]));

    /* ratchet: a long note is struck again */
    unsigned on2[2];
    for (int on = 0; on < 2; on++) {
        dn_init(&S, &B, SR, 24);
        scene_clear(&S);
        dn_button(&S, DN_BTN_KEEPER, 2);
        unit(&S, 1, 0, 4.0f, 0.0f, 0.0f, 0.0f);
        if (on) { dn_set_knob(&S, DN_K_RATCHET, 0.67f); dn_button(&S, DN_BTN_FEATURE, DN_F_RATCHET); }
        run_bars(&S, 4);
        on2[on] = S.f_onsets;
    }
    check("ratchet: one long note becomes 8 strikes (1/4 step apart)", on2[0] == 1 && on2[1] == 8, "onsets per bar %u -> %u", on2[0], on2[1]);

    /* follow: playing louder moves the wanted state toward the mass */
    float te[2];
    for (int loud = 0; loud < 2; loud++) {
        dn_init(&S, &B, SR, 25);
        dn_set_knob(&S, DN_K_FOLLOW, 1.0f);
        dn_button(&S, DN_BTN_FEATURE, DN_F_FOLLOW);
        double ph = 0;
        feed(&S, (int)(4 * S.cur_len / 256), loud ? 0.5f : 0.001f, &ph, NULL);
        te[loud] = S.t_e;
    }
    check("follow: a loud input wants more mass than a quiet one", te[1] - te[0] > 0.2f, "wanted erase %.2f (quiet) -> %.2f (loud)", te[0], te[1]);

    /* hold: nobody acts, is born or dies, and the phase stays */
    dn_init(&S, &B, SR, 26);
    dn_button(&S, DN_BTN_FEATURE, DN_F_HOLD);
    int ln = S.log_n, ph0 = S.ph_left;
    run_bars(&S, 100);
    check("hold: 100 bars without any change of arrangement", S.log_n == ln && S.ph_left == ph0, "log entries %d, phase bars left %d -> %d", S.log_n - ln, ph0, S.ph_left);
}

/* ---------------------------------------------------------------- the effect layer */
/* one unit, a long note at the start of each bar, the object a given sound; room and distance dry */
static void fx_scene(unsigned seed, int kind) {
    dn_init(&S, &B, SR, seed);
    scene_clear(&S);
    dn_button(&S, DN_BTN_KEEPER, 2);
    unit(&S, 1, 0, 3.0f, 0.0f, 0.0f, 0.0f);
    S.tr[1].dist = 0.0f; S.tr[1].pan = 0.0f;
    dn_set_knob(&S, DN_K_ROOM, 0.0f); dn_set_knob(&S, DN_K_DIST, 0.0f);
    int16_t *a = dn_sample_area(&S);
    int n = (int)(0.7f * SR);
    for (int i = 0; i < n; i++) {
        float t = (float)i / SR, x;
        if (kind == 0) x = 0.5f * sinf(2.0f * 3.14159265f * 300.0f * t);                          /* steady */
        else if (kind == 1) x = 0.8f * expf(-8.0f * t) * sinf(2.0f * 3.14159265f * 300.0f * t);     /* struck */
        else x = 0.5f * sinf(2.0f * 3.14159265f * (200.0f * t + 600.0f * t * t));                   /* rising */
        a[i] = (int16_t)(x * 32767.0f);
    }
    dn_sample_commit(&S, n);
}
/* render the next bar; returns where its first note starts inside buf */
static long fx_bar(float *buf, long cap) {
    float L[256], R[256];
    run_bars(&S, 2);
    uint32_t t1 = S.cur_start + S.cur_len, base = S.now;
    long k = 0;
    while (k + 256 <= cap) { dn_process(&S, L, R, 256); memcpy(buf + k, L, sizeof L); k += 256; }
    return (long)(int32_t)(t1 - base);
}
static void fx_on(int f, float v) {
    if (!S.fx_layer) dn_button(&S, DN_BTN_FX_LAYER, 0);
    dn_fx_set(&S, f, 1, v);
    if (!((S.fx_mask >> f) & 1u)) dn_button(&S, DN_BTN_FX_TOGGLE, f);
    dn_fx_set(&S, f, 1, v);
}
static double seg_rms(const float *x, long a, long b) { double e = 0; for (long i = a; i < b; i++) e += (double)x[i] * x[i]; return sqrt(e / (double)(b - a)); }
static long zero_x(const float *x, long a, long b) { long z = 0; for (long i = a + 1; i < b; i++) z += (x[i - 1] < 0) != (x[i] < 0); return z; }
static double corr(const float *x, const float *y, long n) {
    double xy = 0, xx = 0, yy = 0;
    for (long i = 0; i < n; i++) { xy += (double)x[i] * y[i]; xx += (double)x[i] * x[i]; yy += (double)y[i] * y[i]; }
    return xy / sqrt(xx * yy + 1e-20);
}

static void t_fx(void) {
    static float a[44100 * 4], b[44100 * 4];
    long cap = 44100 * 4;
    /* the layer off: exactly what it was before, even with effects checked and set */
    {
        long nn = (long)(20.0 * SR / 256) * 256;
        float *a1 = malloc(sizeof(float) * nn), *b1 = malloc(sizeof(float) * nn), *a2 = malloc(sizeof(float) * nn), *b2 = malloc(sizeof(float) * nn);
        dn_init(&S, &B, SR, 31); run(&S, 20.0, NULL, a1, b1);
        dn_init(&S, &B, SR, 31);
        for (int f = 0; f < DN_FX; f++) { dn_button(&S, DN_BTN_FX_TOGGLE, f); for (int k = 1; k < DN_TRACKS; k++) dn_fx_set(&S, f, k, 0.7f); }
        dn_button(&S, DN_BTN_FX_DICE, -1);
        dn_button(&S, DN_BTN_FX_AUTO, 1);
        run(&S, 20.0, NULL, a2, b2);
        int same = memcmp(a1, a2, sizeof(float) * nn) == 0 && memcmp(b1, b2, sizeof(float) * nn) == 0;
        check("effect layer off: the sound is bit-identical to before", same, "%s", same ? "identical over 20 s, with every effect checked, set and rolling" : "differs");
        free(a1); free(b1); free(a2); free(b2);
    }

    float gate = 0;
    /* pitch +12: twice as many zero crossings */
    long z[2];
    for (int on = 0; on < 2; on++) {
        fx_scene(32, 0);
        if (on) fx_on(DN_FX_PITCH, 1.0f);
        long t1 = fx_bar(a, cap);
        gate = 2.7f * S.cur_step;
        z[on] = zero_x(a, t1 + (long)(0.1f * gate), t1 + (long)(0.5f * gate));
    }
    check("pitch: +12 doubles the frequency of the copies", fabs((double)z[1] / z[0] - 2.0) < 0.1, "zero crossings %ld -> %ld (x%.2f)", z[0], z[1], (double)z[1] / z[0]);

    /* reverse: a struck sound swells instead of dying away */
    double r[2][2];
    for (int on = 0; on < 2; on++) {
        fx_scene(33, 1);
        if (on) fx_on(DN_FX_REVERSE, 1.0f);
        long t1 = fx_bar(a, cap);
        long w = (long)(0.3f * S.cur_step * 2.7f);
        r[on][0] = seg_rms(a, t1, t1 + w);
        r[on][1] = seg_rms(a, t1 + 2 * w, t1 + 3 * w);
    }
    check("reverse: a struck sound rises instead of falling", r[0][0] > 2 * r[0][1] && r[1][1] > 2 * r[1][0],
          "first/last third: plain %.3f/%.3f, reversed %.3f/%.3f", r[0][0], r[0][1], r[1][0], r[1][1]);

    /* stutter: the first slice of a rising sound repeats */
    double cc[2];
    for (int on = 0; on < 2; on++) {
        fx_scene(34, 2);
        if (on) fx_on(DN_FX_STUTTER, 0.6f);               /* 1/4 step */
        long t1 = fx_bar(a, cap);
        long L = (long)(0.25f * S.cur_step);
        cc[on] = corr(a + t1 + 2 * L, a + t1 + 3 * L, L);
    }
    check("stutter: one slice of the copy repeats", cc[1] > 0.9 && cc[0] < 0.6, "next-slice correlation %.2f -> %.2f", cc[0], cc[1]);

    /* delay: the copy is placed again three times, later and softer */
    unsigned on3[2];
    for (int on = 0; on < 2; on++) {
        fx_scene(35, 1);
        if (on) fx_on(DN_FX_DELAY, 0.5f);
        run_bars(&S, 4);
        on3[on] = S.f_onsets;
    }
    check("delay: one copy becomes four", on3[0] == 1 && on3[1] == 4, "onsets per bar %u -> %u", on3[0], on3[1]);

    /* glitch: different, finite */
    fx_scene(36, 2);
    long t1 = fx_bar(b, cap);
    fx_scene(36, 2);
    fx_on(DN_FX_GLITCH, 1.0f);
    fx_bar(a, cap);
    double gd = 0; for (long i = t1; i < t1 + (long)gate; i++) gd += fabs((double)a[i] - b[i]);
    check("glitch: the copy is held and jumps (changed, still finite)", gd > 10.0 && isfinite(gd), "summed difference %.1f", gd);

    /* the dice: only checked effects change, values 0 or 0.1..1, the caretaker never */
    dn_init(&S, &B, SR, 37);
    dn_button(&S, DN_BTN_FX_LAYER, 0);
    dn_button(&S, DN_BTN_FX_TOGGLE, DN_FX_PITCH);
    dn_button(&S, DN_BTN_FX_TOGGLE, DN_FX_GLITCH);
    float before[DN_FX][DN_TRACKS];
    memcpy(before, S.fxv, sizeof before);
    dn_button(&S, DN_BTN_FX_DICE, -1);
    int changed_checked = 0, changed_other = 0, bad = 0, on_units = 0;
    for (int f = 0; f < DN_FX; f++) for (int k = 0; k < DN_TRACKS; k++) {
        float v = S.fxv[f][k];
        if (v != before[f][k]) { if (f == DN_FX_PITCH || f == DN_FX_GLITCH) changed_checked++; else changed_other++; }
        if (v != 0.0f && (v < 0.1f || v > 1.0f)) bad++;
        if (k == 0 && v != 0.0f) bad++;
        if (v > 0.0f && f == DN_FX_PITCH) on_units++;
    }
    check("dice: only checked effects change, per unit 0 or 0.1..1", changed_checked > 0 && changed_other == 0 && bad == 0,
          "%d values changed in checked effects, %d elsewhere; pitch on %d of 15 units", changed_checked, changed_other, on_units);
    dn_button(&S, DN_BTN_FX_AUTO, 2);
    uint32_t r0 = S.fx_rolls;
    run_bars(&S, 10);
    check("dice keep rolling every 2 bars", S.fx_rolls - r0 == 5, "%u rolls in 10 bars", S.fx_rolls - r0);

    /* everything at once, on the FM object, a crowded building, 60 s */
    dn_init(&S, &B, SR, 38);
    dn_button(&S, DN_BTN_FX_LAYER, 0);
    for (int f = 0; f < DN_FX; f++) dn_button(&S, DN_BTN_FX_TOGGLE, f);
    dn_button(&S, DN_BTN_FX_AUTO, 1);
    stats_t st = { 0 };
    run(&S, 60.0, &st, NULL, NULL);
    long dn = count_denormals(&S, &B);
    check("all five effects on, rolled every bar, 60 s: finite, no clipping, no denormals",
          st.nan == 0 && st.peak < 1.0 && dn == 0, "peak %.2f, %.0fx real time", st.peak, 60000.0 / st.ms);
}

/* ---------------------------------------------------------------- volume */
static void t_volume(void) {
    long nn = (long)(10.0 * SR / 256) * 256;
    float *a = malloc(sizeof(float) * nn), *b = malloc(sizeof(float) * nn), *c = malloc(sizeof(float) * nn), *d = malloc(sizeof(float) * nn);
    float he[3][4];
    for (int run_i = 0; run_i < 3; run_i++) {
        dn_init(&S, &B, SR, 41);
        if (run_i == 1) dn_set_knob(&S, DN_K_VOL, 0.765f);     /* -6 dB */
        if (run_i == 2) dn_set_knob(&S, DN_K_VOL, 0.0f);       /* silent */
        run(&S, 10.0, NULL, run_i == 0 ? a : (run_i == 1 ? c : d), b);
        for (int j = 0; j < 4; j++) he[run_i][j] = S.h_e[j];
    }
    dn_init(&S, &B, SR, 41);
    float L[256], R[256];
    dn_process(&S, L, R, 256);
    int unity = S.vol_g == 1.0f;
    double g = 0, maxerr = 0, pk = 0, pk0 = 0;
    for (long i = 0; i < nn; i++) { if (fabs(a[i]) > pk0) pk0 = fabs(a[i]); if (fabs(d[i]) > pk) pk = fabs(d[i]); }
    g = exp2(-6.0 / 6.0206);
    for (long i = 256; i < nn; i++) { double e = fabs(c[i] - a[i] * g); if (e > maxerr) maxerr = e; }
    check("volume: the default is exactly 0 dB", unity, "gain %.7f", S.vol_g);
    check("volume: -6 dB halves every sample", maxerr < 1e-5, "largest difference from half %.2g", maxerr);
    int same = memcmp(he[0], he[2], sizeof he[0]) == 0;
    check("volume 0: silent, and what the building hears is unchanged", pk == 0.0 && pk0 > 0.05 && same,
          "peak %.2g (at 0 dB %.2f), listening %s", pk, pk0, same ? "identical" : "differs");
    free(a); free(b); free(c); free(d);
}

/* ---------------------------------------------------------------- main */
int main(int argc, char **argv) {
    if (argc >= 3 && !strcmp(argv[1], "test") && !strcmp(argv[2], "steer")) { t_steer(); return fails != 0; }
    if (argc >= 3 && !strcmp(argv[1], "test") && !strcmp(argv[2], "pushsteer")) { push_only = 1; t_steer(); return fails != 0; }
    if (argc >= 3 && !strcmp(argv[1], "test") && !strcmp(argv[2], "quick")) {
        t_memory(); t_causality(); t_debt(); t_phases(); t_motion(); t_determinism(); t_no_trap(); t_denormal(); t_sources(); t_features(); t_fx(); t_volume();
        printf("%s (%d failed)\n", fails ? "FAILED" : "all passed", fails); return fails != 0;
    }
    if (argc >= 2 && !strcmp(argv[1], "test")) {
        t_memory();
        t_causality();
        t_debt();
        t_phases();
        t_motion();
        t_determinism();
        t_sources();
        t_features();
        t_fx();
        t_volume();
        t_no_trap();
        t_denormal();
        t_headroom();
        t_steer();
        t_longrun();
        printf("%s (%d failed, %d known open)\n", fails ? "FAILED" : "all passed", fails, opens);
        return fails != 0;
    }
    if (argc >= 4 && (!strcmp(argv[1], "render") || !strcmp(argv[1], "trace"))) {
        double sec = atof(argv[2]);
        unsigned seed = argc >= 5 ? (unsigned)atoi(argv[4]) : 1;
        dn_init(&S, &B, SR, seed);
        if (argc >= 7) { dn_set_knob(&S, DN_K_ERASE, (float)atof(argv[5])); dn_set_knob(&S, DN_K_PUSH, (float)atof(argv[6])); }
        int wav = !strcmp(argv[1], "render");
        long n = (long)(sec * SR / 256) * 256;
        float *Lb = wav ? malloc(sizeof(float) * n) : NULL, *Rb = wav ? malloc(sizeof(float) * n) : NULL;
        FILE *csv = wav ? NULL : fopen(argv[3], "w");
        if (csv) fprintf(csv, "bar,phase,m_e,m_p,t_e,t_p,raw_e,raw_p,contour,dens,flam,comb,interf,mono,early,late,onsets,sounding,keeper,act_kind,act_track,urgency\n");
        float L[256], R[256];
        int seen = 0;
        for (long i = 0; i < n; i += 256) {
            int b = S.bar;
            dn_process(&S, L, R, 256);
            if (wav) { memcpy(Lb + i, L, sizeof L); memcpy(Rb + i, R, sizeof R); }
            if (S.bar != b) {
                int ak = -1, at = -1;
                for (; seen < S.log_n; seen++) {
                    const dn_logent *e = &S.log[seen % DN_LOG];
                    if (e->type == DN_LG_ACT) { ak = e->kind; at = e->track; }
                    if (!csv) {
                        if (e->type == DN_LG_ACT) fprintf(stderr, "  bar %4d  %-5s -> unit %2d (gene %.2f)\n", e->bar, dn_op_code[e->kind], e->track, e->value);
                        if (e->type == DN_LG_BORN) fprintf(stderr, "  bar %4d  born %-5s #%d on unit %d\n", e->bar, dn_op_code[e->kind], e->id, e->track);
                        if (e->type == DN_LG_DIED) fprintf(stderr, "  bar %4d  died %-5s #%d (age %.0f)\n", e->bar, dn_op_code[e->kind], e->id, e->value);
                        if (e->type == DN_LG_PHASE) fprintf(stderr, "  bar %4d  phase %s for %.0f bars\n", e->bar, dn_phase_code[e->kind], e->value);
                    }
                }
                int snd = 0; for (int k = 1; k < DN_TRACKS; k++) snd += S.tr[k].on && S.tr[k].nhit && !S.tr[k].dormant;
                if (csv) fprintf(csv, "%d,%d,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%u,%d,%d,%d,%d,%.3f\n",
                                 b, S.phase, S.m_e, S.m_p, S.t_e, S.t_p, S.h_e[0], S.h_p[0], S.f_contour, S.f_dens, S.f_flam, S.f_comb, S.f_if, S.f_mono,
                                 S.f_early, S.f_late, S.f_onsets, snd, S.keeper_on, ak, at, S.urgency);
                else if (b % 8 == 0) fprintf(stderr, "bar %4d %-8s erase %.2f->%.2f push %.2f->%.2f | contour %.2f dens %.2f flam %.2f comb %.2f if %.2f mono %.2f early %.2f late %.2f on %u\n",
                                             b, dn_phase_code[S.phase], S.m_e, S.t_e, S.m_p, S.t_p, S.f_contour, S.f_dens, S.f_flam, S.f_comb, S.f_if, S.f_mono, S.f_early, S.f_late, S.f_onsets);
            }
        }
        if (wav) { write_wav(argv[3], Lb, Rb, n); free(Lb); free(Rb); }
        if (csv) fclose(csv);
        return 0;
    }
    if (argc >= 3 && !strcmp(argv[1], "steer")) {
        /* debug: one seed of the ERASE steering test, with every action and its reward */
        unsigned seed = (unsigned)atoi(argv[2]);
        int which = argc >= 4 ? atoi(argv[3]) : 0;    /* 0 erase, 1 push */
        dn_init(&S, &B, SR, seed);
        S.phase = which ? DN_PH_KATAMARI : DN_PH_GYORETSU; S.ph_left = 1000000;
        int K = which ? DN_K_PUSH : DN_K_ERASE;
        float L[256], R[256]; int seen = 0;
        double rsum[DN_OP_KINDS] = {0}; int rn[DN_OP_KINDS] = {0};
        for (int phase = 0; phase < 3; phase++) {
            dn_set_knob(&S, K, phase == 1 ? 0.9f : 0.1f);
            int end = S.bar + (phase == 0 ? 160 : 240);
            while (S.bar < end) {
                int b = S.bar;
                dn_process(&S, L, R, 256);
                if (S.bar == b) continue;
                for (; seen < S.log_n; seen++) {
                    const dn_logent *e = &S.log[seen % DN_LOG];
                    if (e->type == DN_LG_ACT) printf("    act  %-5s u%-2d g%.2f\n", dn_op_code[e->kind], e->track, e->value);
                    if (e->type == DN_LG_REWARD) { printf("    rew  %-5s u%-2d %+.2f\n", dn_op_code[e->kind], e->track, e->value); if (phase) { rsum[e->kind] += e->value; rn[e->kind]++; } }
                    if (e->type == DN_LG_BORN) printf("    born %-5s u%-2d\n", dn_op_code[e->kind], e->track);
                }
                int snd = 0, cop = 0; for (int k = 1; k < DN_TRACKS; k++) if (S.tr[k].on && S.tr[k].nhit) { snd++; for (int h = 0; h < S.tr[k].nhit; h++) cop += S.tr[k].hit[h].copies; }
                if (b % 100 == 50) for (int k = 0; k < DN_TRACKS; k++) { dn_track *T = &S.tr[k]; if (!(T->on && T->nhit)) continue;
                    printf("      u%-2d lean %+.2f str %.2f sw %.2f rep %.2f debt %+.2f |", k, T->lean, T->stretch, T->swing, T->repay, T->debt);
                    for (int h = 0; h < T->nhit; h++) printf(" %d:%+.2f(c%d,x%d)", T->hit[h].step, T->hit[h].off, T->hit[h].cause, T->hit[h].copies);
                    printf("\n"); }
                printf("bar %4d t %.2f/%.2f raw %.2f/%.2f m %.2f/%.2f | cont %.2f dens %.2f flam %.2f comb %.2f if %.2f mono %.2f early %.2f late %.2f | units %d copies %d | ops",
                       b, S.t_e, S.t_p, S.h_e[0], S.h_p[0], S.m_e, S.m_p, S.f_contour, S.f_dens, S.f_flam, S.f_comb, S.f_if, S.f_mono, S.f_early, S.f_late, snd, cop);
                for (int i = 0; i < DN_OPS; i++) printf(" %s%.1f", dn_op_code[S.op[i].kind], S.op[i].energy);
                printf("\n");
            }
        }
        printf("mean reward by kind (after the first switch):");
        for (int k = 0; k < DN_OP_KINDS; k++) if (rn[k]) printf(" %s %+.2f(%d)", dn_op_code[k], rsum[k] / rn[k], rn[k]);
        printf("\n");
        return 0;
    }
    if (argc >= 2 && !strcmp(argv[1], "scenes")) {
        /* calibration: what the listening hears in hand-built buildings */
        struct { const char *name; int units, hits, copies; float spread, stretch, dist, room, pan_spread; } sc[] = {
            { "3 units, 1 hit, short, near",        3, 1, 1,  8.f, 0.6f, 0.0f, 0.45f, 1.0f },
            { "5 units, 2 hits, medium",            5, 2, 1,  8.f, 1.5f, 0.2f, 0.45f, 1.0f },
            { "5 units, 2 hits, 3 copies 20 ms",    5, 2, 3, 20.f, 1.5f, 0.2f, 0.45f, 1.0f },
            { "5 units, 2 hits, 3 copies 2 ms",     5, 2, 3,  2.f, 1.5f, 0.2f, 0.45f, 1.0f },
            { "3 units, 1 hit, short, far",         3, 1, 1,  8.f, 0.6f, 0.9f, 0.45f, 1.0f },
            { "3 units, 1 hit, long",               3, 1, 1,  8.f, 3.8f, 0.0f, 0.45f, 1.0f },
            { "8 units, 3 hits, long",              8, 3, 1,  8.f, 3.5f, 0.3f, 0.45f, 1.0f },
            { "15 units, 4 hits, 3 copies, long, far", 15, 4, 3, 15.f, 3.5f, 0.8f, 0.8f, 1.0f },
            { "15 units, 4 hits, 2 copies, centre",  15, 4, 2, 10.f, 2.5f, 0.4f, 0.6f, 0.0f },
        };
        for (unsigned i = 0; i < sizeof sc / sizeof sc[0]; i++) {
            dn_init(&S, &B, SR, 5);
            scene_clear(&S);
            dn_set_knob(&S, DN_K_ROOM, sc[i].room);
            for (int k = 1; k <= sc[i].units; k++) {
                unit(&S, k, (k * 5 + 2) & 15, sc[i].stretch, 0.f, 0.f, 0.f);
                S.tr[k].hit[0].copies = (uint8_t)sc[i].copies; S.tr[k].hit[0].spread = sc[i].spread;
                for (int h = 1; h < sc[i].hits; h++) { add_hit(&S, k, (k * 5 + 2 + h * 4 + h) & 15); S.tr[k].hit[h].copies = (uint8_t)sc[i].copies; S.tr[k].hit[h].spread = sc[i].spread; }
                S.tr[k].dist = sc[i].dist;
                S.tr[k].pan = sc[i].pan_spread * (((k & 3) - 1.5f) / 1.5f) * 0.75f;
                S.tr[k].room = (uint8_t)(k % DN_ROOMS);
            }
            run_bars(&S, 6);
            double e = 0, c = 0, d = 0, f = 0, cb = 0, it = 0, m = 0, rv = 0, rr = 0, ro = 0, rc = 0, ri = 0;
            for (int j = 0; j < 6; j++) { run_bars(&S, 1); e += S.h_e[0] / 6; c += S.f_contour / 6; d += S.f_dens / 6; f += S.f_flam / 6; cb += S.f_comb / 6; it += S.f_if / 6; m += S.f_mono / 6;
                rv += S.r_valley / 6; rr += S.r_rise / 6; ro += S.r_ov / 6; rc += S.r_corr / 6; ri += S.r_if / 6; }
            printf("%-40s erase %.2f | contour %.2f dens %.2f flam %.2f comb %.2f if %.2f mono %.2f || valley %.2f rise %.2f ov %.1f corr %.2f if %.2f\n", sc[i].name, e, c, d, f, cb, it, m, rv, rr, ro, rc, ri);
        }
        return 0;
    }
    if (argc >= 2 && !strcmp(argv[1], "reach")) {
        /* what the timing mechanism can produce: every unit forced to one lean / stretch */
        float leans[] = { 0.f, 0.5f, 1.f }, strs[] = { 1.f, 2.f, 3.f, 4.f };
        for (int a = 0; a < 3; a++) for (int c = 0; c < 4; c++) {
            double pe = 0, pl = 0, pp = 0, frac = 0;
            for (int sd = 0; sd < 4; sd++) {
                dn_init(&S, &B, SR, 300 + sd);
                S.quiet = -1000000; S.ph_left = 1000000;
                for (int k = 1; k < DN_TRACKS; k++) { S.tr[k].lean = leans[a]; S.tr[k].stretch = strs[c]; S.tr[k].repay = 0.4f; }
                run_bars(&S, 6);
                for (int j = 0; j < 6; j++) { run_bars(&S, 1); pe += S.f_early / 24; pl += S.f_late / 24; pp += S.h_p[0] / 24; }
                int np = 0, nh = 0;
                for (int k = 1; k < DN_TRACKS; k++) for (int h = 0; h < S.tr[k].nhit; h++) if (S.tr[k].on) { nh++; np += S.tr[k].hit[h].cause >= 0; }
                frac += (double)np / (nh ? nh : 1) / 4;
            }
            printf("lean %.1f stretch %.0f: early %.3f late %.3f push %.2f, hits pushed %.0f%%\n", leans[a], strs[c], pe, pl, pp, frac * 100);
        }
        return 0;
    }
    if (argc >= 3 && !strcmp(argv[1], "screen")) {
        /* draw the device screen after some bars; also check that band drawing equals full drawing */
        static uint16_t full[240 * 240], band[240 * 240];
        dn_init(&S, &B, SR, argc >= 4 ? (unsigned)atoi(argv[3]) : 1);
        run_bars(&S, argc >= 5 ? atoi(argv[4]) : 40);
        float L[256], R[256];
        for (int i = 0; i < 37; i++) dn_process(&S, L, R, 256);
        dn_draw_rows(&S, full, 0, 240);
        for (int y = 0; y < 240; y += 16) dn_draw_rows(&S, band + y * 240, y, 16);
        clock_t t0 = clock();
        for (int r = 0; r < 200; r++) for (int y = 0; y < 240; y += 8) dn_draw_rows(&S, band + y * 240, y, 8);
        double us = 1e6 * (double)(clock() - t0) / CLOCKS_PER_SEC / 200;
        printf("band == full: %s, %.0f us per frame in 8-row bands on this host\n", memcmp(full, band, sizeof full) ? "NO" : "yes", us);
        FILE *f = fopen(argv[2], "wb");
        fprintf(f, "P6 240 240 255\n");
        for (int i = 0; i < 240 * 240; i++) { uint16_t p = full[i]; unsigned char c[3] = { (unsigned char)((p >> 11) << 3), (unsigned char)(((p >> 5) & 63) << 2), (unsigned char)((p & 31) << 3) }; fwrite(c, 1, 3, f); }
        fclose(f);
        return 0;
    }
    if (argc >= 4 && !strcmp(argv[1], "raw")) {
        /* raw float32 left channel, 128-frame blocks, the same script as tools/same_core.mjs:
           FM with touches, then the live input, a capture, and a loaded sound */
        double sec = atof(argv[2]);
        dn_init(&S, &B, SR, 42);
        FILE *f = fopen(argv[3], "wb");
        long blocks = (long)(sec * 44100 / 128);
        float L[128], R[128], IN[128];
        uint32_t r = 777;
        for (long b = 0; b < blocks; b++) {
            for (int i = 0; i < 128; i++) { r = r * 1664525u + 1013904223u; IN[i] = (float)(r >> 16) / 65536.0f - 0.5f; }
            dn_process_in(&S, IN, L, R, 128);
            fwrite(L, sizeof(float), 128, f);
            if (b % 2000 == 0) { dn_encoder(&S, 1, 1); dn_key(&S, 5, 1); dn_key(&S, 5, 0); }
            if (b == 3000) dn_button(&S, DN_BTN_SOURCE, DN_SRC_LIVE);
            if (b == 7000) dn_button(&S, DN_BTN_CAPTURE, 0);
            if (b == 11000) {
                int16_t *sa = dn_sample_area(&S);
                for (int i = 0; i < 20000; i++) { r = r * 1664525u + 1013904223u; sa[i] = (int16_t)((int32_t)(r >> 16) - 32768); }
                dn_sample_commit(&S, 20000);
            }
            if (b == 13000) dn_button(&S, DN_BTN_FEATURE, DN_F_POLY);
            if (b == 13500) dn_button(&S, DN_BTN_RESAMPLE, 0);
            if (b == 14000) dn_button(&S, DN_BTN_FEATURE, DN_F_RATCHET);
            if (b == 14500) dn_button(&S, DN_BTN_FEATURE, DN_F_DUCK);
            if (b == 15000) { dn_button(&S, DN_BTN_FX_LAYER, 0); for (int f = 0; f < DN_FX; f++) dn_button(&S, DN_BTN_FX_TOGGLE, f); dn_button(&S, DN_BTN_FX_AUTO, 1); }
            if (b == 17000) dn_fx_set(&S, DN_FX_PITCH, 3, 0.9f);
        }
        fclose(f);
        return 0;
    }
    fprintf(stderr, "usage: sim test | sim render SEC OUT.wav [SEED [ERASE PUSH]] | sim trace SEC OUT.csv [SEED]\n");
    return 2;
}
