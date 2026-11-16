/* musubime: the native test renderer. Builds the shell and one project with a scripted hand, renders to a WAV,
 * prints a line a second (peak, RMS, spectral centroid, spectral flatness, a "change" measure between seconds),
 * and writes the screen at given times as PPM.
 *   cc -O2 -I../src ../src/{shell,body,scr}.c ../src/eN_x.c render.c -lm -o render
 *   ./render SCRIPT OUT.wav SECONDS [SHOT_PREFIX]
 * SCRIPT lines: "T CMD ARGS" with T in seconds:
 *   T enc N D            encoder N (0..6) turned D detents (spread over the next frames, 2 a frame)
 *   T spin N D MS        D detents spread evenly over MS
 *   T key K down V | up  key K (0..26), velocity V
 *   T prs K P            key K's pressure (0..127)
 *   T btn NAME down|up   FX SEL ENV LFO EDIT GLO HOME SAVE ARP SEQ PLAY REC OCT- OCT+
 *   T shot NAME          the screen to SHOT_PREFIX-NAME.ppm
 *   T input sine F A | noise A | off    the computer's audio (for projects that take it)
 *   # comment */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "mz.h"

/* ------------------------------------------------------------- the machine --- */
static uint32_t now_ms;
static int32_t enc_owed[HW_NENC];
static struct { int32_t left; uint32_t from, to; } spin[HW_NENC];
static uint32_t btns, keys;
static uint8_t vel[HW_NKEYS], prs[HW_NKEYS];
static uint16_t fb[240 * 240];
static int strip_y, strip_h;

uint32_t hw_ms(void) { return now_ms; }
int32_t hw_enc(int i)
{
    int32_t d = enc_owed[i] > 2 ? 2 : enc_owed[i] < -2 ? -2 : enc_owed[i];
    enc_owed[i] -= d;
    return d;
}
uint32_t hw_buttons(void) { return btns; }
uint32_t hw_keys(void) { return keys; }
uint8_t hw_vel(int k) { return vel[k]; }
uint8_t hw_pressure(int k) { return prs[k]; }
void hw_leds(uint32_t b, uint32_t k, uint32_t d) { (void)b, (void)k, (void)d; }
void hw_strip_begin(int y, int h)
{
    int i;
    strip_y = y;
    strip_h = h;
    for (i = 0; i < 240 * h && (y * 240 + i) < 240 * 240; i++)
        fb[y * 240 + i] = C_BG;
}
void hw_pset(int x, int y, uint16_t c)
{
    if (x >= 0 && x < 240 && y >= 0 && y < strip_h && strip_y + y < 240)
        fb[(strip_y + y) * 240 + x] = c;
}
void hw_fill(int x, int y, int w, int h, uint16_t c)
{
    int i, j;
    for (j = y; j < y + h; j++)
        for (i = x; i < x + w; i++)
            hw_pset(i, j, c);
}
void hw_strip_end(void) {}

static void shot(const char *path)
{
    FILE *f = fopen(path, "wb");
    int i;
    if (!f)
        return;
    fprintf(f, "P6 240 240 255\n");
    for (i = 0; i < 240 * 240; i++) {
        uint16_t c = fb[i];
        unsigned char p[3] = {(unsigned char)((c >> 11) << 3), (unsigned char)(((c >> 5) & 63) << 2),
                              (unsigned char)((c & 31) << 3)};
        fwrite(p, 1, 3, f);
    }
    fclose(f);
}

/* --------------------------------------------------------------- the script --- */
typedef struct { double t; char cmd[16], a[32], b[32], c[32]; } line_t;
static line_t lines[4096];
static int nlines, at;

static int btn_index(const char *s)
{
    static const char *const N[] = {"FX", "SEL", "ENV", "LFO", "EDIT", "GLO", "HOME", "SAVE", "ARP", "SEQ", "PLAY",
                                    "REC", "OCT-", "OCT+"};
    int i;
    for (i = 0; i < 14; i++)
        if (!strcmp(s, N[i]))
            return i;
    return -1;
}

static int in_mode;
static double in_f, in_a, in_ph;
static unsigned in_seed = 99;

static void run_line(const line_t *L, const char *prefix)
{
    if (!strcmp(L->cmd, "enc"))
        enc_owed[atoi(L->a)] += atoi(L->b);
    else if (!strcmp(L->cmd, "spin")) {
        int i = atoi(L->a);
        spin[i].left = atoi(L->b);
        spin[i].from = now_ms;
        spin[i].to = now_ms + (uint32_t)atoi(L->c);
    } else if (!strcmp(L->cmd, "key")) {
        int k = atoi(L->a);
        if (!strcmp(L->b, "down")) {
            keys |= 1u << k;
            vel[k] = (uint8_t)(L->c[0] ? atoi(L->c) : 90);
        } else {
            keys &= ~(1u << k);
            prs[k] = 0;
        }
    } else if (!strcmp(L->cmd, "prs"))
        prs[atoi(L->a)] = (uint8_t)atoi(L->b);
    else if (!strcmp(L->cmd, "btn")) {
        int b = btn_index(L->a);
        if (b >= 0) {
            if (!strcmp(L->b, "down"))
                btns |= 1u << b;
            else
                btns &= ~(1u << b);
        }
    } else if (!strcmp(L->cmd, "shot") && prefix) {
        char p[512];
        snprintf(p, sizeof p, "%s-%s.ppm", prefix, L->a);
        shot(p);
    } else if (!strcmp(L->cmd, "input")) {
        if (!strcmp(L->a, "sine")) {
            in_mode = 1;
            in_f = atof(L->b);
            in_a = atof(L->c);
        } else if (!strcmp(L->a, "noise")) {
            in_mode = 2;
            in_a = atof(L->b);
        } else
            in_mode = 0;
    }
}

/* the spinning encoders: their detents spread over their span */
static void spin_step(uint32_t dt)
{
    int i;
    for (i = 0; i < HW_NENC; i++) {
        if (!spin[i].left)
            continue;
        {
            uint32_t span = spin[i].to > spin[i].from ? spin[i].to - spin[i].from : 1u;
            double per_ms = (double)spin[i].left / (double)span;
            static double frac[HW_NENC];
            double want = per_ms * dt + frac[i];
            int32_t d = (int32_t)want;
            frac[i] = want - d;
            enc_owed[i] += d;
            if (now_ms >= spin[i].to) {
                spin[i].left = 0;
                frac[i] = 0;
            }
        }
    }
}

/* ----------------------------------------------------------------- analysis --- */
#define NFFT 4096
static void fft(double *re, double *im, int n)
{
    int i, j, k, m;
    for (i = 1, j = 0; i < n; i++) {
        int bit = n >> 1;
        for (; j & bit; bit >>= 1)
            j ^= bit;
        j ^= bit;
        if (i < j) {
            double t = re[i];
            re[i] = re[j];
            re[j] = t;
            t = im[i];
            im[i] = im[j];
            im[j] = t;
        }
    }
    for (m = 2; m <= n; m <<= 1) {
        double a = -2 * M_PI / m;
        for (k = 0; k < n; k += m)
            for (j = 0; j < m / 2; j++) {
                double wr = cos(a * j), wi = sin(a * j);
                double xr = re[k + j + m / 2] * wr - im[k + j + m / 2] * wi;
                double xi = re[k + j + m / 2] * wi + im[k + j + m / 2] * wr;
                re[k + j + m / 2] = re[k + j] - xr;
                im[k + j + m / 2] = im[k + j] - xi;
                re[k + j] += xr;
                im[k + j] += xi;
            }
    }
}

static double prev_mag[NFFT / 2];

static void analyse(const float *x, int n, int sec)
{
    static double re[NFFT], im[NFFT], mag[NFFT / 2];
    double peak = 0, ss = 0, num = 0, den = 0, lsum = 0, flux = 0, fn = 0, pd = 0;
    int i, frames = 0, off;
    for (i = 0; i < n; i++) {
        double a = fabs(x[i]);
        if (a > peak)
            peak = a;
        ss += x[i] * x[i];
    }
    for (i = 0; i < NFFT / 2; i++)
        mag[i] = 0;
    for (off = 0; off + NFFT <= n; off += NFFT / 2, frames++) {
        for (i = 0; i < NFFT; i++) {
            double w = 0.5 - 0.5 * cos(2 * M_PI * i / NFFT);
            re[i] = x[off + i] * w;
            im[i] = 0;
        }
        fft(re, im, NFFT);
        for (i = 1; i < NFFT / 2; i++)
            mag[i] += sqrt(re[i] * re[i] + im[i] * im[i]);
    }
    for (i = 1; i < NFFT / 2; i++) {
        double f = i * 44100.0 / NFFT, p = mag[i] * mag[i] + 1e-20;
        num += f * mag[i];
        den += mag[i];
        lsum += log(p);
        fn += p;
        pd += (mag[i] - prev_mag[i]) * (mag[i] - prev_mag[i]);
        flux += prev_mag[i] * prev_mag[i];
        prev_mag[i] = mag[i];
    }
    {
        double gm = exp(lsum / (NFFT / 2 - 1)), am = fn / (NFFT / 2 - 1);
        double change = flux > 0 ? sqrt(pd / (flux + 1e-20)) : 0;
        printf("%4d  peak %6.1f dB  rms %6.1f dB  centroid %6.0f Hz  flatness %5.3f  change %5.2f\n", sec,
               20 * log10(peak + 1e-9), 10 * log10(ss / n + 1e-12), den > 0 ? num / den : 0, gm / (am + 1e-30),
               change);
    }
}

/* -------------------------------------------------------------------- main --- */
static void wav_header(FILE *f, uint32_t frames)
{
    uint32_t data = frames * 4, v;
    uint16_t s;
    fwrite("RIFF", 1, 4, f);
    v = 36 + data;
    fwrite(&v, 4, 1, f);
    fwrite("WAVEfmt ", 1, 8, f);
    v = 16;
    fwrite(&v, 4, 1, f);
    s = 1;
    fwrite(&s, 2, 1, f);
    s = 2;
    fwrite(&s, 2, 1, f);
    v = 44100;
    fwrite(&v, 4, 1, f);
    v = 44100 * 4;
    fwrite(&v, 4, 1, f);
    s = 4;
    fwrite(&s, 2, 1, f);
    s = 16;
    fwrite(&s, 2, 1, f);
    fwrite("data", 1, 4, f);
    fwrite(&data, 4, 1, f);
}

int main(int argc, char **argv)
{
    FILE *sf, *wf;
    char buf[256];
    double seconds;
    uint32_t total, done = 0, since_frame = 0;
    static float L[256], R[256], IL[256], IR[256], sec_buf[44100];
    int sec_n = 0, sec = 0;
    if (argc < 4) {
        fprintf(stderr, "render SCRIPT OUT.wav SECONDS [SHOT_PREFIX]\n");
        return 2;
    }
    sf = fopen(argv[1], "r");
    if (!sf) {
        perror(argv[1]);
        return 1;
    }
    while (fgets(buf, sizeof buf, sf) && nlines < 4096) {
        line_t *L0 = &lines[nlines];
        if (buf[0] == '#' || buf[0] == '\n')
            continue;
        memset(L0, 0, sizeof *L0);
        if (sscanf(buf, "%lf %15s %31s %31s %31s", &L0->t, L0->cmd, L0->a, L0->b, L0->c) >= 2)
            nlines++;
    }
    fclose(sf);
    seconds = atof(argv[3]);
    total = (uint32_t)(seconds * 44100);
    wf = fopen(argv[2], "wb");
    wav_header(wf, total);
    mz_init(0xC0FFEEu);
    while (done < total) {
        uint32_t n = 128, i;
        if (since_frame >= 735) {                    /* about 60 frames a second */
            since_frame -= 735;
            while (at < nlines && lines[at].t * 1000.0 <= now_ms)
                run_line(&lines[at++], argc > 4 ? argv[4] : 0);
            spin_step(17);
            mz_frame();
        }
        for (i = 0; i < n; i++) {
            if (in_mode == 1) {
                IL[i] = IR[i] = (float)(in_a * sin(in_ph));
                in_ph += 2 * M_PI * in_f / 44100.0;
            } else if (in_mode == 2) {
                in_seed = in_seed * 1664525u + 1013904223u;
                IL[i] = IR[i] = (float)(in_a * ((in_seed >> 8) / 8388608.0 - 1.0));
            } else
                IL[i] = IR[i] = 0;
        }
        mz_render(L, R, in_mode ? IL : 0, in_mode ? IR : 0, n);
        for (i = 0; i < n; i++) {
            int16_t s[2];
            s[0] = (int16_t)lrintf(fmaxf(-1.f, fminf(1.f, L[i])) * 32767);
            s[1] = (int16_t)lrintf(fmaxf(-1.f, fminf(1.f, R[i])) * 32767);
            fwrite(s, 2, 2, wf);
            sec_buf[sec_n++] = 0.5f * (L[i] + R[i]);
            if (sec_n == 44100) {
                analyse(sec_buf, sec_n, sec++);
                sec_n = 0;
            }
        }
        done += n;
        since_frame += n;
        now_ms = (uint32_t)((uint64_t)done * 1000 / 44100);
    }
    fclose(wf);
    printf("bad blocks: %u\n", mz_bad_count());
    return 0;
}
