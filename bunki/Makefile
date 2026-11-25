# bunki on the computer. make        the tool and the tests
#                        make test   the tests (writes tests/last_report.txt)
#                        make cross  the same script through gcc -O0, gcc -O2 and clang -O2: the same bits
#                        make demo   a few WAVs and screens in build/demo
CC      ?= cc
WARN     = -std=c99 -Wall -Wextra -Wshadow -Wconversion -Wno-sign-conversion
CFLAGS  ?= -O2
CORE     = core/bunki.c
INC      = -Icore -Ihost
B        = build

all: $(B)/bunki $(B)/bunki_test

$(B):
	mkdir -p $(B)

$(B)/bunki: $(CORE) host/bunki_cli.c host/bk_screen.c core/bunki.h core/bk_tables.h | $(B)
	$(CC) $(CFLAGS) $(WARN) $(INC) -o $@ $(CORE) host/bunki_cli.c host/bk_screen.c

$(B)/bunki_test: $(CORE) tests/bunki_test.c core/bunki.h core/bk_tables.h | $(B)
	$(CC) $(CFLAGS) $(WARN) -Wno-conversion -Wno-float-conversion $(INC) -o $@ $(CORE) tests/bunki_test.c -lm

core/bk_tables.h: tools/gen_tables.py
	python3 tools/gen_tables.py > $@

test: $(B)/bunki_test cross
	$(B)/bunki_test | tee tests/last_report.txt

# the same script, three compilers / optimisation levels: every hash must be equal
cross: | $(B)
	gcc   -O0 $(INC) -o $(B)/bunki_gcc0   $(CORE) host/bunki_cli.c host/bk_screen.c
	gcc   -O2 $(INC) -o $(B)/bunki_gcc2   $(CORE) host/bunki_cli.c host/bk_screen.c
	clang -O2 $(INC) -o $(B)/bunki_clang2 $(CORE) host/bunki_cli.c host/bk_screen.c
	@for b in gcc0 gcc2 clang2; do $(B)/bunki_$$b run tests/scripts/perform.txt $(B)/cross_$$b.wav | sed "s/^/$$b: /"; done \
	  | tee $(B)/cross.txt
	@test `awk '{print $$NF}' $(B)/cross.txt | sort -u | wc -l` -eq 1 && echo "cross: identical" || (echo "cross: DIFFERENT"; exit 1)

demo: $(B)/bunki
	mkdir -p $(B)/demo
	$(B)/bunki sweep 60 60 $(B)/demo/sweep_map.wav map
	$(B)/bunki sweep 60 60 $(B)/demo/sweep_fbt.wav fbt
	$(B)/bunki sweep 60 60 $(B)/demo/sweep_fb1.wav fb1
	$(B)/bunki run tests/scripts/perform.txt $(B)/demo/perform.wav --csv $(B)/demo/perform.csv --screens $(B)/demo
	$(B)/bunki run tests/scripts/stages.txt $(B)/demo/stages.wav --screens $(B)/demo
	$(B)/bunki blind 7 $(B)/demo/blind.wav $(B)/demo/blind_key.txt

clean:
	rm -rf $(B)

.PHONY: all test cross demo clean
