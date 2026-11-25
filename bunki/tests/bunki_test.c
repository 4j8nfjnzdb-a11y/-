/* bunki's tests: the numbers behind the criteria. Desktop only (double, an FFT).
 *   build/bunki_test            all of them, the report on stdout
 *   build/bunki_test calibrate  only the feedback's cascade against beta (for core/bunki.c's BB[])
 * Each [ok] / [FAIL] line is a check; the rest are measurements. Exit 1 when a check fails. */
#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "bunki.h"

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif
#define FS   44100.0
#define NA   (1 << 16)                  /* analysed frames: 1.49 s */
#define HW   5                          /* bins either side of a line (the window's main lobe is +-4) */
#define Q60  1152921504606846976.0
#define Q62  4611686018427387904.0

static double sig[NA], re_[NA], im_[NA], pw[NA / 2 + 1];
static int mark[NA / 2 + 1], gen;
static int checks, fails;
static bk_engine_t E;

static void check(int ok, const char *fmt, ...)
{
    va_list ap;
    checks++;
    if (!ok) fails++;
    printf("  [%s] ", ok ? "ok" : "FAIL");
    va_start(ap, fmt);
    vprintf(fmt, ap);
    va_end(ap);
    printf("\n");
}

/* ---- rendering ---- */

static int32_t q16(double v) { return (int32_t)lround(v * 65536.0); }
static int64_t q60(double R) { return (int64_t)llround(R * Q60); }
static double  u_of(double R) { return bk_u_of_R(q60(R)) / 65536.0; }

static void render(bk_engine_t *e, uint32_t frames, double *mono)
{
    static int32_t buf[512];
    uint32_t done = 0, i;
    while (done < frames) {
        memset(buf, 0, sizeof buf);
        bk_render(e, buf, 256);
        if (mono)
            for (i = 0; i < 256 && done + i < frames; i++)
                mono[done + i] = buf[2 * i] / 32768.0;
        done += 256;
    }
}

static double f0_of(const bk_engine_t *e, int v) { return e->v[v].inc * FS / 4294967296.0; }

static void setup(bk_engine_t *e, uint32_t seed, int path, double u)
{
    bk_init(e, seed);
    bk_set(e, BK_P_PATH, path);
    bk_set(e, BK_P_U, q16(u));
    render(e, 256, NULL);                        /* R takes the knob's value */
}

/* ---- the spectrum ---- */

static void fft(double *re, double *im, int n)
{
    int i, j, k, m;
    for (i = 1, j = 0; i < n; i++) {
        int bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { double t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (m = 2; m <= n; m <<= 1) {
        double a = -2 * M_PI / m;
        for (k = 0; k < n; k += m)
            for (j = 0; j < m / 2; j++) {
                double wr = cos(a * j), wi = sin(a * j);
                double xr = re[k + j + m / 2] * wr - im[k + j + m / 2] * wi;
                double xi = re[k + j + m / 2] * wi + im[k + j + m / 2] * wr;
                re[k + j + m / 2] = re[k + j] - xr; im[k + j + m / 2] = im[k + j] - xi;
                re[k + j] += xr; im[k + j] += xi;
            }
    }
}

static double total;
static void spectrum(const double *y)
{
    int i;
    for (i = 0; i < NA; i++) {                   /* Blackman-Harris, 4 terms: side lobes at -92 dB */
        double t = 2 * M_PI * i / NA;
        re_[i] = y[i] * (0.35875 - 0.48829 * cos(t) + 0.14128 * cos(2 * t) - 0.01168 * cos(3 * t));
        im_[i] = 0;
    }
    fft(re_, im_, NA);
    total = 0;
    for (i = 0; i <= NA / 2; i++) {
        pw[i] = re_[i] * re_[i] + im_[i] * im_[i];
        if (i) total += pw[i];
    }
}

/* the power on the lines m f (m odd only: the lines new at this period) */
static double on_grid(double f, int odd_only)
{
    double s = 0, df = FS / NA;
    int m, k;
    gen++;
    for (m = odd_only ? 1 : 0; m * f < FS * 0.49; m++) {       /* m = 0: DC is periodic with any period */
        int c;
        if (odd_only && !(m & 1)) continue;
        c = (int)lround(m * f / df);
        for (k = c - HW; k <= c + HW; k++)
            if (k >= 1 && k <= NA / 2 && mark[k] != gen) { mark[k] = gen; s += pw[k]; }
    }
    return s;
}
static double db(double r) { return 10 * log10(r + 1e-30); }
static double stage_db(double f0, int p) { return db(on_grid(f0 / p, p > 1) / total); }
static double impurity_db(double f0, int p) { return db((total - on_grid(f0 / p, 0)) / total); }
static double flatness_db(void)
{
    double lg = 0, ar = 0;
    int i;
    for (i = 1; i <= NA / 2; i++) { lg += log(pw[i] + 1e-30); ar += pw[i]; }
    return db(exp(lg / (NA / 2)) / (ar / (NA / 2)));
}
static double aperiodic_db(double f0)           /* what no period up to 16 explains */
{
    double best = 0;
    int p;
    for (p = 1; p <= 16; p++) { double d = impurity_db(f0, p); if (d < best) best = d; }
    return best;
}
static int audio_period(double f0)               /* the smallest p whose lines hold all but -50 dB */
{
    int p;
    for (p = 1; p <= 16; p++)
        if (impurity_db(f0, p) < -50) return p;
    return 0;
}

/* ---- the map alone ---- */

static int iper(int64_t R, uint32_t transient, double tol, double *orbit)
{
    int64_t x = (int64_t)(0.3 * Q62), h[64];
    uint32_t t;
    int p, i;
    for (t = 0; t < transient; t++) x = bk_logistic(R, x);
    for (i = 0; i < 64; i++) { x = bk_logistic(R, x); h[i] = x; if (orbit) orbit[i] = x / Q62; }
    for (p = 1; p <= 32; p++) {
        for (i = p; i < 64; i++)
            if (fabs((double)(h[i] - h[i - p])) > tol * Q62) break;
        if (i == 64) return p;
    }
    return 0;
}

static double lyap_ref(double R)
{
    double x = 0.3, s = 0;
    int i;
    for (i = 0; i < 2000; i++) x = R * x * (1 - x);
    for (i = 0; i < 1000000; i++) {
        double d = fabs(R * (1 - 2 * x));
        s += d > 1e-12 ? log(d) : -40 * log(2.0);
        x = R * x * (1 - x);
    }
    return s / 1e6;
}

static void t1_map(void)
{
    static const double known[5] = {0, 3.0, 3.449489743, 3.544090360, 3.564407266};
    static const double Rs[] = {3.2, 3.5, 3.83, 3.9, 4.0};
    double lo, hi, found[5] = {0};
    int n, i;
    printf("\n== 1. the map: its doubling points, windows, Lyapunov exponent (integer Q62 map)\n");
    for (n = 1; n <= 4; n++) {
        int k;
        lo = n == 1 ? 2.95 : found[n - 1] + 1e-7;
        hi = 3.5699;
        for (k = 0; k < 40; k++) {
            double mid = 0.5 * (lo + hi);
            int p = iper(q60(mid), 200000, 1e-9, NULL);
            if (p == 0 || p >= (1 << n)) hi = mid; else lo = mid;
        }
        found[n] = 0.5 * (lo + hi);
        check(fabs(found[n] - known[n]) < 5e-4, "period %2d -> %2d at R = %.6f (known %.6f, knob node u = %d at %.6f)",
              1 << (n - 1), 1 << n, found[n], known[n], n, bk_R_of_u(n << 16) / Q60);
    }
    {   /* windows in the chaotic band */
        int want[4] = {3, 5, 6, 7}, w;
        for (w = 0; w < 4; w++) {
            double best0 = 0, best1 = 0, s0 = 0;
            int in = 0;
            for (i = 0; i <= 8600; i++) {
                double R = 3.570 + i * 5e-5;
                int p = iper(q60(R), 30000, 1e-9, NULL);
                if (p == want[w] && !in) { in = 1; s0 = R; }
                if ((p != want[w] || i == 8600) && in) {
                    in = 0;
                    if (R - s0 > best1 - best0) { best0 = s0; best1 = R - 5e-5; }
                }
            }
            if (best1 > best0) printf("  window: period %d widest at R %.5f .. %.5f (width %.5f, knob u %.2f .. %.2f)\n",
                                       want[w], best0, best1, best1 - best0, u_of(best0), u_of(best1));
            else printf("  window: period %d none found at this step\n", want[w]);
            if (want[w] == 3)
                check(fabs(best0 - (1 + sqrt(8.0))) < 2e-4, "period-3 window opens at %.5f (1 + sqrt 8 = %.5f)", best0, 1 + sqrt(8.0));
        }
    }
    for (i = 0; i < 5; i++) {   /* the engine's own estimate on a sounding voice */
        double lc, lr, R;
        setup(&E, 1, BK_PATH_MAP, u_of(Rs[i]));
        R = E.R / Q60;
        bk_note(&E, 60, 100);
        render(&E, 44100, NULL);
        bk_lyap_reset(&E);
        render(&E, 10 * 44100, NULL);
        lc = (double)E.v[0].lsum_map / E.v[0].lcount / 65536.0;
        lr = lyap_ref(R);
        check(fabs(lc - lr) < 0.02, "Lyapunov at R %.5f: engine %+.4f, double reference %+.4f", R, lc, lr);
    }
}

/* ---- one note, the sound ---- */

typedef struct { const char *what; double u; int expect; } pos_t;

static void measure(int note, double u, int path, int lift, double *f0, int *mp, int *ap, double st[5], double *fl, double *aper)
{
    int k;
    setup(&E, 1, path, u);
    bk_set(&E, BK_P_LIFT, lift);
    bk_note(&E, (uint32_t)note, 100);
    render(&E, 44100, NULL);
    render(&E, NA, sig);
    spectrum(sig);
    *f0 = f0_of(&E, 0);
    *mp = bk_voice_period(&E, 0, 1 << 10);
    *ap = audio_period(*f0);
    for (k = 1; k <= 4; k++) st[k] = stage_db(*f0, 1 << k);
    *fl = flatness_db();
    *aper = aperiodic_db(*f0);
}

static void t2_sound(void)
{
    pos_t P[] = {{"period 1", 0.5, 1}, {"period 2", 1.5, 2}, {"period 4", 2.5, 4}, {"period 8", 3.5, 8},
                 {"period 16", 4.5, 16}, {"chaos R 3.80", 0, 0}, {"window R 3.835", 0, 3}, {"chaos R 3.90", 0, 0},
                 {"chaos R 4.0", 22, 0}};
    int notes[2] = {60, 79}, ni, i, lift;
    P[5].u = u_of(3.80); P[6].u = u_of(3.835); P[7].u = u_of(3.90);
    printf("\n== 2. one note: the period heard = the map's period (MAP path)\n");
    for (lift = 0; lift < 2; lift++)
        for (ni = 0; ni < (lift ? 1 : 2); ni++) {
            double fl5 = 0, fl6 = 0, fl7 = 0;   /* (now: the aperiodic part, in dB of all) */
            printf("  note %d, lift %s.   new lines at each stage (dB of all), flatness, impurity on the map's period\n",
                   notes[ni], lift ? "sqrt" : "linear");
            printf("  %-15s %5s %4s %5s %7s %7s %7s %7s %7s %8s %8s\n", "", "u", "map", "heard", "p2", "p4", "p8", "p16", "flat", "aperiod", "impure");
            for (i = 0; i < 9; i++) {
                double f0, st[5], fl, imp = 0, aper;
                int mp, ap;
                measure(notes[ni], P[i].u, BK_PATH_MAP, lift, &f0, &mp, &ap, st, &fl, &aper);
                if (mp > 0) imp = impurity_db(f0, mp);
                printf("  %-15s %5.2f %4d %5d %7.1f %7.1f %7.1f %7.1f %7.1f %8.1f %8.1f\n", P[i].what, P[i].u, mp, ap,
                       st[1], st[2], st[3], st[4], fl, aper, mp > 0 ? imp : 0.0);
                if (i == 5) fl5 = aper;
                if (i == 6) fl6 = aper;
                if (i == 7) fl7 = aper;
                if (i <= 3 || i == 6) {
                    check(mp == P[i].expect && ap == P[i].expect, "%s: map %d, heard %d", P[i].what, mp, ap);
                    check(imp < -60, "%s: all but %.1f dB on the lines of f0/%d", P[i].what, imp, mp);
                }
            }
            check(fl6 < (fl5 > fl7 ? fl5 : fl7) - 30, "the window clears: aperiodic part %.1f dB against %.1f / %.1f around it",
                  fl6, fl5, fl7);
        }
}

/* ---- the same seed and the same events: the same bits ---- */

static uint64_t perform(uint32_t seed)
{
    uint64_t h = 1469598103934665603ull;
    static int32_t buf[512];
    uint32_t b, i;
    bk_init(&E, seed);
    for (b = 0; b < 6000; b++) {
        if (b == 0) bk_set(&E, BK_P_U, 0);
        if (b == 10) bk_note(&E, 60, 100);
        if (b >= 50 && b < 1500) bk_set(&E, BK_P_U, (int32_t)((b - 50) * 1000));
        if (b == 1600) { bk_note(&E, 67, 90); bk_note(&E, 64, 80); bk_set(&E, BK_P_EPS, q16(0.2)); }
        if (b == 2500) bk_set(&E, BK_P_D, q16(0.7));
        if (b == 3500) { bk_set(&E, BK_P_PATH, BK_PATH_BOTH); bk_set(&E, BK_P_C, q16(0.8)); }
        if (b == 4500) { bk_set(&E, BK_P_C, q16(-0.8)); bk_note(&E, 64, 0); }
        if (b == 5200) bk_all_off(&E);
        memset(buf, 0, sizeof buf);
        bk_render(&E, buf, 256);
        for (i = 0; i < 512; i++) h = (h ^ (uint32_t)buf[i]) * 1099511628211ull;
    }
    return h;
}

static void t3_same(void)
{
    uint64_t a = perform(1), b = perform(1), c = perform(2);
    printf("\n== 3. reproducible: the same seed and events, the same bits\n");
    check(a == b, "seed 1 twice: %016llx %016llx", (unsigned long long)a, (unsigned long long)b);
    check(a != c, "seed 2 differs: %016llx", (unsigned long long)c);
    printf("  (make cross: the same script through gcc -O0, gcc -O2 and clang -O2)\n");
}

/* ---- finite precision: every digital orbit ends in a cycle; how long? ---- */

static int64_t q30_logistic(int64_t R, int64_t x)          /* the same map in 30 bits, for comparison */
{
    int64_t t = (x * ((1 << 30) - x)) >> 30, y = (int64_t)(((__int128)R * t) >> 60);
    return y < 0 ? 0 : y > (1 << 30) ? (1 << 30) : y;
}

static uint64_t brent(int64_t R, int64_t x0, int q30, uint64_t cap)
{
    uint64_t power = 1, lam = 1;
    int64_t tort = x0, hare = q30 ? q30_logistic(R, x0) : bk_logistic(R, x0);
    while (tort != hare) {
        if (power == lam) { tort = hare; power *= 2; lam = 0; if (power > cap) return 0; }
        hare = q30 ? q30_logistic(R, hare) : bk_logistic(R, hare);
        lam++;
    }
    return lam;
}

static void t4_cycles(void)
{
    static const double Rs[] = {3.6, 3.7, 3.8, 3.9, 3.95, 3.99, 4.0};
    const uint64_t cap = 1ull << 25;
    int i, s;
    printf("\n== 4. finite precision: the length of the cycle the chaotic orbit ends in (Brent)\n");
    printf("  %6s  %-22s  %-26s\n", "R", "Q30 (30 bits)", "Q62 (the engine)");
    for (i = 0; i < 7; i++) {
        uint64_t c30[2], c62[2];
        for (s = 0; s < 2; s++) {
            c30[s] = brent(q60(Rs[i]), (int64_t)((0.2 + 0.25 * s) * (1 << 30)), 1, cap);
            c62[s] = brent(q60(Rs[i]), (int64_t)((0.2 + 0.25 * s) * Q62), 0, cap);   /* not 0.5: at R = 4, 0.5 -> 1 -> 0 */
        }
        printf("  %6.2f  %8llu %8llu       %s %s\n", Rs[i], (unsigned long long)c30[0], (unsigned long long)c30[1],
               c62[0] ? "found" : "> 2^25", c62[1] ? "found" : "> 2^25");
        check(!c62[0] && !c62[1], "R %.2f: no cycle in the engine's map within 2^25 periods (%.0f h at 262 Hz)",
              Rs[i], (double)cap / 261.6 / 3600);
    }
}

/* ---- voices coupled ---- */

static double spread_now(const bk_engine_t *e, int *clusters)
{
    double xs[BK_NV], mx = 0, s = 0;
    int k, n = 0, i, j, c = 1;
    for (k = 0; k < (int)BK_NV; k++)
        if (e->v[k].active) xs[n++] = bk_voice_x(e, (uint32_t)k, 0) / 1073741824.0;
    for (i = 0; i < n; i++)
        for (j = i + 1; j < n; j++) { double d = fabs(xs[i] - xs[j]); s += d; if (d > mx) mx = d; }
    for (i = 1; i < n; i++)                    /* single linkage at 0.01: sort, count the gaps */
        for (j = i; j > 0 && xs[j] < xs[j - 1]; j--) { double t = xs[j]; xs[j] = xs[j - 1]; xs[j - 1] = t; }
    for (i = 1; i < n; i++) if (xs[i] - xs[i - 1] > 0.01) c++;
    if (clusters) *clusters = c;
    (void)s;
    return mx;
}

static void t5_coupling(void)
{
    static const double epss[] = {0.30, 0.45, 0.55, 0.70};
    static const int chords[4][7] = {{2, 60, 67}, {2, 60, 72}, {3, 60, 64, 67}, {6, 48, 55, 60, 64, 67, 72}};
    static const char *names[4] = {"fifth", "octave", "triad", "six notes"};
    static const double ce[] = {0, 0.1, 0.3, 0.5, 0.7};
    int i, k, c, r, j;
    printf("\n== 5. coupled voices (x' = F + eps (mean F - F), every F the latest)\n");
    printf("  a. four voices at the same pitch, R = 4: the theory's threshold is eps > 1 - e^-ln2 = 0.5\n");
    for (i = 0; i < 4; i++) {
        uint32_t inc = 25480119u, b, sync = 0, n = 0;   /* C4 */
        double lt = log(2.0) + log(1 - epss[i]);
        setup(&E, 1, BK_PATH_MAP, 22);
        bk_set(&E, BK_P_EPS, q16(epss[i]));
        for (k = 0; k < 4; k++) bk_voice_force(&E, (uint32_t)k, inc, (int64_t)((0.15 + 0.2 * k) * Q62), 80);
        render(&E, 2 * 44100, NULL);
        for (b = 0; b < 5 * 44100 / 256; b++) { render(&E, 256, NULL); n++; if (spread_now(&E, NULL) < 1e-6) sync++; }
        check((epss[i] > 0.5) == (sync > n * 9 / 10), "eps %.2f: transverse exponent %+.3f, in step %3.0f %% of the time",
              epss[i], lt, 100.0 * sync / n);
    }
    printf("  b. chords: each voice steps at its own pitch, so the steps are not simultaneous (not Kaneko's model)\n");
    printf("  %-10s %4s %4s  %10s %9s %10s %9s\n", "", "R", "eps", "max spread", "clusters", "switch/s", "in step");
    for (c = 0; c < 4; c++)
        for (r = 0; r < 2; r++)
            for (j = 0; j < 5; j++) {
                uint32_t b, n = 0, sw = 0, sync = 0;
                int cl, last = -1;
                double sp = 0, mcl = 0;
                setup(&E, 1, BK_PATH_MAP, r ? 22 : u_of(3.9));
                bk_set(&E, BK_P_EPS, q16(ce[j]));
                for (k = 1; k <= chords[c][0]; k++) bk_note(&E, (uint32_t)chords[c][k], 80);
                render(&E, 2 * 44100, NULL);
                for (b = 0; b < 10 * 44100 / 256; b++) {
                    double s;
                    render(&E, 256, NULL);
                    s = spread_now(&E, &cl);
                    sp += s; mcl += cl; n++;
                    if (s < 1e-3) sync++;
                    if (last >= 0 && cl != last) sw++;
                    last = cl;
                }
                printf("  %-10s %4.1f %4.1f  %10.4f %9.2f %10.1f %8.0f%%\n", j ? "" : names[c], r ? 4.0 : 3.9, ce[j],
                       sp / n, mcl / n, sw / 10.0, 100.0 * sync / n);
            }
    printf("  c. the steps' schedule as a source of its own: R = 3.2 (period 2), a fifth; voice C4 alone\n");
    for (j = 0; j < 4; j++) {
        static const double le[] = {0, 0.05, 0.2, 0.5};
        double res = 0, f0, imp;
        uint32_t a;
        setup(&E, 1, BK_PATH_MAP, u_of(3.2));
        bk_set(&E, BK_P_EPS, q16(le[j]));
        bk_set(&E, BK_P_SOLO, 1);
        bk_note(&E, 60, 80);
        bk_note(&E, 67, 80);
        render(&E, 2 * 44100, NULL);
        render(&E, NA, sig);
        for (a = 0; a + 2 < BK_HIST; a++) {
            double d = fabs((double)bk_voice_x(&E, 0, a) - bk_voice_x(&E, 0, a + 2)) / 1073741824.0;
            if (d > res) res = d;
        }
        spectrum(sig);
        f0 = f0_of(&E, 0);
        imp = impurity_db(f0, 2);
        printf("  eps %.2f: map period %2d, |x_k - x_(k-2)| up to %.2e, off the lines of f0/2: %6.1f dB\n",
               le[j], bk_voice_period(&E, 0, 1 << 10), res, imp);
        if (j == 0) check(imp < -60, "uncoupled: period 2 exactly (%.1f dB off its lines)", imp);
    }
}

/* ---- the paths compared ---- */

static void sweep_path(const char *name, int path, double C, int beta_q8, int print_rows)
{
    double first2 = -1, first4 = -1, first8 = -1, chaos = -1, u;
    char wins[256] = "";
    int was_chaos = 0;
    for (u = 0; u <= 22.0001; u += 0.25) {
        double f0, s2, s4, s8, i16, fl, aper;
        int ap;
        setup(&E, 1, path, u);
        bk_set(&E, BK_P_C, q16(C));
        if (beta_q8 >= 0) bk_set(&E, BK_P_BETA, beta_q8);
        bk_note(&E, 60, 100);
        render(&E, 22050, NULL);
        render(&E, NA, sig);
        spectrum(sig);
        f0 = f0_of(&E, 0);
        s2 = stage_db(f0, 2); s4 = stage_db(f0, 4); s8 = stage_db(f0, 8);
        i16 = impurity_db(f0, 16); fl = flatness_db(); aper = aperiodic_db(f0);
        ap = audio_period(f0);
        if (first2 < 0 && s2 > -40) first2 = u;
        if (first4 < 0 && s4 > -40) first4 = u;
        if (first8 < 0 && s8 > -40) first8 = u;
        if (chaos < 0 && aper > -40) chaos = u;
        if (aper > -40) was_chaos = 1;
        else if (was_chaos && ap && strlen(wins) < 200)       /* periodic again after chaos: a window */
            sprintf(wins + strlen(wins), " u%.2f:p%d", u, ap);
        if (print_rows)
            printf("    u %5.2f R %.4f  p2 %6.1f  p4 %6.1f  p8 %6.1f  off-lines(16) %6.1f  flat %6.1f  aperiodic %6.1f  heard %d\n",
                   u, E.R / Q60, s2, s4, s8, i16, fl, aper, ap);
    }
    printf("  %-14s p2 at u %5.2f  p4 at %5.2f  p8 at %5.2f  aperiodic from %5.2f  windows:%s\n", name,
           first2, first4, first8, chaos, wins[0] ? wins : " none");
}

static void t6_paths(void)
{
    printf("\n== 6. the paths: where each stage appears as the knob turns (C4; a stage counts from -40 dB)\n");
    sweep_path("MAP", BK_PATH_MAP, 0, -1, 0);
    sweep_path("FB-T", BK_PATH_FBT, 0, -1, 0);
    sweep_path("BOTH C=0", BK_PATH_BOTH, 0, -1, 0);
    sweep_path("BOTH C=+1", BK_PATH_BOTH, 1, -1, 0);
    sweep_path("BOTH C=-1", BK_PATH_BOTH, -1, -1, 0);
    sweep_path("FB-1 (DX7)", BK_PATH_FB1, 0, -1, 0);
    printf("  (knob nodes: u 1 = r1 3.0, u 2 = r2, u 3 = r3, u 6 = R_inf; the map's period-3 window at u ~15.7)\n");
}

static void calibrate(void)
{
    int b;
    printf("\n== the period-delayed feedback alone against beta (C4): its own cascade\n");
    for (b = 64; b <= 768; b += 8) {
        double f0;
        setup(&E, 1, BK_PATH_FBT, 0);
        bk_set(&E, BK_P_BETA, b);
        bk_note(&E, 60, 100);
        render(&E, 22050, NULL);
        render(&E, NA, sig);
        spectrum(sig);
        f0 = f0_of(&E, 0);
        printf("  beta %.3f rad  p2 %6.1f  p4 %6.1f  p8 %6.1f  p16 %6.1f  off-lines(16) %6.1f  flat %6.1f  heard %d  lyap %+.3f\n",
               b / 256.0, stage_db(f0, 2), stage_db(f0, 4), stage_db(f0, 8), stage_db(f0, 16), impurity_db(f0, 16),
               flatness_db(), audio_period(f0), E.v[0].lyap_fb / 65536.0);
    }
}

/* ---- R walking by itself ---- */

static void t7_walk(void)
{
    static const double uh[2] = {3.0, 14.0}, Ds[2] = {0.5, 1.0};
    int a, d, i;
    printf("\n== 7. D: R walks by itself (10 minutes each, C4, MAP)\n");
    for (a = 0; a < 2; a++)
        for (d = 0; d < 2; d++) {
            static double us[110000];
            uint32_t nb = 10 * 60 * 44100 / 256, b, hist[12] = {0}, neg = 0;
            double m = 0, v = 0, acmax = 0, aclag = 0;
            int last = 60 * 44100 / 256;
            setup(&E, 1, BK_PATH_MAP, uh[a]);
            bk_note(&E, 60, 100);
            bk_set(&E, BK_P_D, q16(Ds[d]));
            for (b = 0; b < nb; b++) {
                render(&E, 256, NULL);
                us[b] = bk_u_of_R(E.R) / 65536.0;
                hist[(int)(us[b] / 2) > 10 ? 10 : (int)(us[b] / 2)]++;
                if (E.lyap < 0) neg++;
            }
            for (b = nb - (uint32_t)last; b < nb; b++) m += us[b];
            m /= last;
            for (b = nb - (uint32_t)last; b < nb; b++) v += (us[b] - m) * (us[b] - m);
            v = sqrt(v / last);
            for (i = 86; i < last / 2; i += 2) {   /* autocorrelation, lags 0.5 s .. 30 s, of the last minute */
                double s = 0, s0 = 0;
                for (b = nb - (uint32_t)last; b + (uint32_t)i < nb; b++) {
                    s += (us[b] - m) * (us[b + i] - m);
                    s0 += (us[b] - m) * (us[b] - m);
                }
                if (s0 > 0 && s / s0 > acmax) { acmax = s / s0; aclag = i * 256.0 / FS; }
            }
            printf("  hand u %4.1f, D %.1f: where it was (u 0-2, 2-4, ... 20-22, %%):", uh[a], Ds[d]);
            for (i = 0; i < 11; i++) printf(" %2.0f", 100.0 * hist[i] / nb);
            printf("\n      lambda < 0 %3.0f %% of the time; last minute: mean u %.2f, spread %.3f, autocorrelation peak %.2f at %.1f s -> %s\n",
                   100.0 * neg / nb, m, v, acmax, aclag,
                   v < 0.01 ? "PINNED" : acmax > 0.95 ? "a fixed cycle" : "walking");
        }
    setup(&E, 1, BK_PATH_MAP, 3.0);
    bk_note(&E, 60, 100);
    bk_set(&E, BK_P_D, q16(1.0));
    render(&E, 10 * 44100, NULL);
    bk_set(&E, BK_P_D, 0);
    render(&E, 5 * 44100, NULL);
    check(llabs(E.R - E.R_hand) < (1LL << 40), "D back to 0: R returns to the hand's (off by %.2e)", (double)(E.R - E.R_hand) / Q60);
}

/* ---- time, for reference only (the FM-1's own cycles are measured in fm1-emu) ---- */

static void t8_time(void)
{
    static const int chord[8] = {48, 52, 55, 60, 64, 67, 71, 74};
    int path, k;
    printf("\n== 8. time on this computer (reference only)\n");
    for (path = 0; path < BK_NPATHS; path++) {
        clock_t t0;
        double s;
        setup(&E, 1, path, 12);
        for (k = 0; k < 8; k++) bk_note(&E, (uint32_t)chord[k], 60);
        render(&E, 44100, NULL);
        t0 = clock();
        render(&E, 30 * 44100, NULL);
        s = (double)(clock() - t0) / CLOCKS_PER_SEC;
        printf("  path %d, 8 voices: %.1f ns per voice-frame (%.0fx real time)\n", path, s * 1e9 / (30 * 44100.0 * 8), 30 / s);
    }
}

int main(int argc, char **argv)
{
    if (argc > 1 && !strcmp(argv[1], "calibrate")) { calibrate(); return 0; }
    printf("bunki tests\n");
    t1_map();
    t2_sound();
    t3_same();
    t4_cycles();
    t5_coupling();
    t6_paths();
    t7_walk();
    t8_time();
    printf("\n%d checks, %d failed\n", checks, fails);
    return fails ? 1 : 0;
}
