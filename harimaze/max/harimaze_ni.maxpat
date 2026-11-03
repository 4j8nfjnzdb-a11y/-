{
  "patcher": {
    "fileversion": 1,
    "appversion": {
      "major": 8,
      "minor": 6,
      "revision": 0,
      "architecture": "x64",
      "modernui": 1
    },
    "classnamespace": "box",
    "rect": [
      40.0,
      60.0,
      1190.0,
      792.0
    ],
    "bglocked": 0,
    "openinpresentation": 0,
    "default_fontsize": 12.0,
    "default_fontface": 0,
    "default_fontname": "Arial",
    "gridonopen": 1,
    "gridsize": [
      15.0,
      15.0
    ],
    "gridsnaponopen": 1,
    "objectsnaponopen": 1,
    "statusbarvisible": 2,
    "toolbarvisible": 1,
    "lefttoolbarpinned": 0,
    "toptoolbarpinned": 0,
    "righttoolbarpinned": 0,
    "bottomtoolbarpinned": 0,
    "toolbars_unpinned_last_save": 0,
    "tallnewobj": 0,
    "boxanimatetime": 200,
    "enablehscroll": 1,
    "enablevscroll": 1,
    "devicewidth": 0.0,
    "description": "",
    "digest": "",
    "tags": "",
    "style": "",
    "subpatcher_template": "",
    "assistshowspatchername": 0,
    "boxes": [
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            20,
            12,
            900,
            40.8
          ],
          "text": "NI 似 — similarity mosaic",
          "fontsize": 24.0,
          "fontface": 1,
          "id": "obj-1"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            22,
            50,
            760,
            60.375
          ],
          "text": "音源を短い断片に切り、それぞれの大きさと明るさ（ゼロ交差）を測る。再生は断片から断片へ歩き、\nsimilarity 1 ならいちばん似た断片へ、0 ならどこへでも。sweep は一歩ごとに目標を明るく（+）暗く（−）ずらすので、\n歩みがゆっくりとした「音の並べ替え」になる。weight 0 = 大きさだけ、1 = 明るさだけで比べる。",
          "fontsize": 12.5,
          "linecount": 3,
          "id": "obj-2"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            22,
            108,
            760,
            21.95
          ],
          "text": "文脈: Jan Jelinek の断片の再配置 / Space Afrika・Klein のカットアップ / コンカテネイティブ合成",
          "fontsize": 11.0,
          "textcolor": [
            0.25,
            0.27,
            0.3,
            1.0
          ],
          "id": "obj-3"
        }
      },
      {
        "box": {
          "maxclass": "panel",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            12,
            142,
            770,
            190
          ],
          "bgcolor": [
            0.86,
            0.9,
            0.93,
            1.0
          ],
          "rounded": 8,
          "border": 0,
          "background": 1,
          "id": "obj-4"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            24,
            150,
            520,
            23.4
          ],
          "text": "1  音源 SOURCE",
          "fontsize": 12.0,
          "fontface": 1,
          "id": "obj-5"
        }
      },
      {
        "box": {
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "patching_rect": [
            24,
            174,
            65,
            22.0
          ],
          "outlettype": [
            ""
          ],
          "text": "replace",
          "id": "obj-6"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            86,
            176,
            420,
            21.95
          ],
          "text": "← 音声ファイルを選ぶ（起動時は空。何も読み込みません）",
          "fontsize": 11.0,
          "id": "obj-7"
        }
      },
      {
        "box": {
          "maxclass": "dropfile",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            24,
            204,
            170,
            58
          ],
          "outlettype": [
            "",
            ""
          ],
          "id": "obj-8"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            32,
            266,
            170,
            36.45
          ],
          "text": "ここに音声ファイルを\nドロップ (wav / aif)",
          "fontsize": 10.5,
          "linecount": 2,
          "id": "obj-9"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend replace",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            24,
            300,
            119,
            22.0
          ],
          "hidden": 1,
          "id": "obj-10"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "buffer~ hz_ni_src 30000 2",
          "numinlets": 1,
          "numoutlets": 2,
          "outlettype": [
            "float",
            "bang"
          ],
          "patching_rect": [
            210,
            266,
            230,
            22.0
          ],
          "id": "obj-11"
        }
      },
      {
        "box": {
          "maxclass": "waveform~",
          "numinlets": 5,
          "numoutlets": 6,
          "patching_rect": [
            210,
            204,
            330,
            58
          ],
          "outlettype": [
            "float",
            "float",
            "float",
            "float",
            "list",
            ""
          ],
          "id": "obj-12"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "loadmess set hz_ni_src",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            210,
            300,
            168,
            22.0
          ],
          "hidden": 1,
          "id": "obj-13"
        }
      },
      {
        "box": {
          "maxclass": "panel",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            12,
            336,
            770,
            198
          ],
          "bgcolor": [
            0.88,
            0.91,
            0.87,
            1.0
          ],
          "rounded": 8,
          "border": 0,
          "background": 1,
          "id": "obj-14"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            24,
            344,
            700,
            23.4
          ],
          "text": "2  パラメータ PARAMETERS — 数字をドラッグ / ダブルクリックで入力",
          "fontsize": 12.0,
          "fontface": 1,
          "id": "obj-15"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            24,
            372,
            122,
            37.9
          ],
          "text": "seglen\n断片 ms  10〜1000",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-16"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r ni_seglen",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            94,
            412,
            91,
            22.0
          ],
          "hidden": 1,
          "id": "obj-17"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            24,
            408,
            74,
            22
          ],
          "outlettype": [
            "",
            "bang"
          ],
          "minimum": 10.0,
          "maximum": 1000.0,
          "numdecimalplaces": 0,
          "format": 6,
          "id": "obj-18"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend seglen",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            24,
            438,
            112,
            22.0
          ],
          "hidden": 1,
          "id": "obj-19"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            150,
            372,
            122,
            37.9
          ],
          "text": "similarity\n似ている度  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-20"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r ni_similarity",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            220,
            412,
            119,
            22.0
          ],
          "hidden": 1,
          "id": "obj-21"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            150,
            408,
            74,
            22
          ],
          "outlettype": [
            "",
            "bang"
          ],
          "minimum": 0.0,
          "maximum": 1.0,
          "numdecimalplaces": 3,
          "format": 6,
          "id": "obj-22"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend similarity",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            150,
            438,
            140,
            22.0
          ],
          "hidden": 1,
          "id": "obj-23"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            276,
            372,
            122,
            37.9
          ],
          "text": "weight\n大きさ↔明るさ  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-24"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r ni_weight",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            346,
            412,
            91,
            22.0
          ],
          "hidden": 1,
          "id": "obj-25"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            276,
            408,
            74,
            22
          ],
          "outlettype": [
            "",
            "bang"
          ],
          "minimum": 0.0,
          "maximum": 1.0,
          "numdecimalplaces": 3,
          "format": 6,
          "id": "obj-26"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend weight",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            276,
            438,
            112,
            22.0
          ],
          "hidden": 1,
          "id": "obj-27"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            402,
            372,
            122,
            37.9
          ],
          "text": "sweep\n並べ替え  -1〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-28"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r ni_sweep",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            472,
            412,
            84,
            22.0
          ],
          "hidden": 1,
          "id": "obj-29"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            402,
            408,
            74,
            22
          ],
          "outlettype": [
            "",
            "bang"
          ],
          "minimum": -1.0,
          "maximum": 1.0,
          "numdecimalplaces": 3,
          "format": 6,
          "id": "obj-30"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend sweep",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            402,
            438,
            105,
            22.0
          ],
          "hidden": 1,
          "id": "obj-31"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            528,
            372,
            122,
            37.9
          ],
          "text": "speed\n速度  -2〜2",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-32"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r ni_speed",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            598,
            412,
            84,
            22.0
          ],
          "hidden": 1,
          "id": "obj-33"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            528,
            408,
            74,
            22
          ],
          "outlettype": [
            "",
            "bang"
          ],
          "minimum": -2.0,
          "maximum": 2.0,
          "numdecimalplaces": 3,
          "format": 6,
          "id": "obj-34"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend speed",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            528,
            438,
            105,
            22.0
          ],
          "hidden": 1,
          "id": "obj-35"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            654,
            372,
            122,
            37.9
          ],
          "text": "rev\n逆再生  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-36"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r ni_rev",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            724,
            412,
            70,
            22.0
          ],
          "hidden": 1,
          "id": "obj-37"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            654,
            408,
            74,
            22
          ],
          "outlettype": [
            "",
            "bang"
          ],
          "minimum": 0.0,
          "maximum": 1.0,
          "numdecimalplaces": 3,
          "format": 6,
          "id": "obj-38"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend rev",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            654,
            438,
            91,
            22.0
          ],
          "hidden": 1,
          "id": "obj-39"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            24,
            456,
            122,
            37.9
          ],
          "text": "xfade\n継ぎ目 ms  1〜100",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-40"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r ni_xfade",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            94,
            496,
            84,
            22.0
          ],
          "hidden": 1,
          "id": "obj-41"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            24,
            492,
            74,
            22
          ],
          "outlettype": [
            "",
            "bang"
          ],
          "minimum": 1.0,
          "maximum": 100.0,
          "numdecimalplaces": 0,
          "format": 6,
          "id": "obj-42"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend xfade",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            24,
            522,
            105,
            22.0
          ],
          "hidden": 1,
          "id": "obj-43"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            150,
            456,
            122,
            37.9
          ],
          "text": "level\n音量  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-44"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r ni_level",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            220,
            496,
            84,
            22.0
          ],
          "hidden": 1,
          "id": "obj-45"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            150,
            492,
            74,
            22
          ],
          "outlettype": [
            "",
            "bang"
          ],
          "minimum": 0.0,
          "maximum": 1.0,
          "numdecimalplaces": 3,
          "format": 6,
          "id": "obj-46"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend level",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            150,
            522,
            105,
            22.0
          ],
          "hidden": 1,
          "id": "obj-47"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "gen~",
          "numinlets": 1,
          "numoutlets": 4,
          "outlettype": [
            "signal",
            "signal",
            "signal",
            "signal"
          ],
          "patching_rect": [
            24,
            618,
            740,
            22.0
          ],
          "patcher": {
            "fileversion": 1,
            "appversion": {
              "major": 8,
              "minor": 6,
              "revision": 0,
              "architecture": "x64",
              "modernui": 1
            },
            "classnamespace": "dsp.gen",
            "rect": [
              80.0,
              80.0,
              840.0,
              760.0
            ],
            "bglocked": 0,
            "openinpresentation": 0,
            "default_fontsize": 12.0,
            "default_fontface": 0,
            "default_fontname": "Arial",
            "gridonopen": 1,
            "gridsize": [
              15.0,
              15.0
            ],
            "gridsnaponopen": 1,
            "objectsnaponopen": 1,
            "statusbarvisible": 2,
            "toolbarvisible": 1,
            "lefttoolbarpinned": 0,
            "toptoolbarpinned": 0,
            "righttoolbarpinned": 0,
            "bottomtoolbarpinned": 0,
            "toolbars_unpinned_last_save": 0,
            "tallnewobj": 0,
            "boxanimatetime": 200,
            "enablehscroll": 1,
            "enablevscroll": 1,
            "devicewidth": 0.0,
            "description": "",
            "digest": "",
            "tags": "",
            "style": "",
            "subpatcher_template": "",
            "assistshowspatchername": 0,
            "boxes": [
              {
                "box": {
                  "maxclass": "codebox",
                  "code": "// harimaze / NI - similarity mosaic\r\n// The source is cut into short segments and each is measured for loudness\r\n// and brightness (zero crossings). Playback walks from segment to segment:\r\n// similarity 1 always takes the nearest neighbour, 0 takes any. Sweep\r\n// pushes the target brighter (+) or darker (-) at every step, so the walk\r\n// turns into a slow sort through the sound. Weight 0 = loudness only,\r\n// 1 = brightness only.\r\n// in1  : trigger (rising edge jumps to a random segment now)\r\n// out1 : left    out2 : right\r\n// out3 : read position 0..1    out4 : target feature 0..1\r\n\r\nBuffer src(\"hz_ni_src\");\r\nData ft(512, 3);\r\n\r\nParam seglen(120);\r\nParam similarity(0.8);\r\nParam weight(0.5);\r\nParam sweep(0);\r\nParam speed(1);\r\nParam rev(0.1);\r\nParam xfade(10);\r\nParam level(0.8);\r\n\r\nHistory an(0);\r\nHistory adone(0);\r\nHistory blprev(0);\r\nHistory slprev(0);\r\nHistory zprev(0);\r\nHistory cur(0);\r\nHistory rel(0);\r\nHistory cdir(1);\r\nHistory gpos(0);\r\nHistory gdir(1);\r\nHistory gfade(0);\r\nHistory tgt(0.5);\r\nHistory lastap(0);\r\nHistory trigprev(0);\r\n\r\nblen = max(dim(src), 2);\r\nch2 = 0;\r\nif (channels(src) > 1) {\r\n\tch2 = 1;\r\n}\r\nsl = clamp(floor(mstosamps(seglen)), 64, blen);\r\nns = clamp(floor(blen / sl), 1, 512);\r\na0 = an;\r\nad = adone;\r\nzp = zprev;\r\nj = 0;\r\nk = 0;\r\nseg = 0;\r\nx = 0;\r\nlmn = 0;\r\nlmx = 0;\r\nzmn = 0;\r\nzmx = 0;\r\nlv = 0;\r\nzv = 0;\r\n\r\n// re-analyse when the buffer or the segment length changes\r\nif (blen != blprev || sl != slprev) {\r\n\ta0 = 0;\r\n\tad = 0;\r\n\tfor (j = 0; j < 512; j += 1) {\r\n\t\tpoke(ft, 0, j, 0);\r\n\t\tpoke(ft, 0, j, 1);\r\n\t\tpoke(ft, 0, j, 2);\r\n\t}\r\n}\r\n// analysis: 256 samples per tick, sum of squares and zero crossings\r\nif (ad < 0.5) {\r\n\tfor (k = 0; k < 256; k += 1) {\r\n\t\tif (a0 < ns * sl) {\r\n\t\t\tseg = floor(a0 / sl);\r\n\t\t\tx = peek(src, a0, 0);\r\n\t\t\tpoke(ft, peek(ft, seg, 0) + x * x, seg, 0);\r\n\t\t\tif ((x >= 0) != (zp >= 0)) {\r\n\t\t\t\tpoke(ft, peek(ft, seg, 1) + 1, seg, 1);\r\n\t\t\t}\r\n\t\t\tzp = x;\r\n\t\t\ta0 = a0 + 1;\r\n\t\t}\r\n\t}\r\n\tif (a0 >= ns * sl) {\r\n\t\t// normalise both features to 0..1 across the segments\r\n\t\tlmn = 1000000;\r\n\t\tlmx = 0;\r\n\t\tzmn = 1000000;\r\n\t\tzmx = 0;\r\n\t\tfor (j = 0; j < 512; j += 1) {\r\n\t\t\tif (j < ns) {\r\n\t\t\t\tlv = sqrt(peek(ft, j, 0) / sl);\r\n\t\t\t\tzv = peek(ft, j, 1) / sl;\r\n\t\t\t\tpoke(ft, lv, j, 0);\r\n\t\t\t\tpoke(ft, zv, j, 1);\r\n\t\t\t\tlmn = min(lmn, lv);\r\n\t\t\t\tlmx = max(lmx, lv);\r\n\t\t\t\tzmn = min(zmn, zv);\r\n\t\t\t\tzmx = max(zmx, zv);\r\n\t\t\t}\r\n\t\t}\r\n\t\tfor (j = 0; j < 512; j += 1) {\r\n\t\t\tif (j < ns) {\r\n\t\t\t\tpoke(ft, (peek(ft, j, 0) - lmn) / max(lmx - lmn, 0.000001), j, 0);\r\n\t\t\t\tpoke(ft, (peek(ft, j, 1) - zmn) / max(zmx - zmn, 0.000001), j, 1);\r\n\t\t\t}\r\n\t\t}\r\n\t\tad = 1;\r\n\t}\r\n}\r\n\r\nc = cur;\r\nrl = rel + abs(speed);\r\ndr = cdir;\r\ng = gpos;\r\ngd = gdir;\r\ngf = gfade;\r\nt = tgt;\r\ntrig = (in1 > 0.5) * (trigprev <= 0.5);\r\nbest = 0;\r\nbd = 0;\r\ncand = 0;\r\nfc = 0;\r\nfcur = 0;\r\ndd = 0;\r\nxf = max(min(mstosamps(xfade), sl * 0.5), 1);\r\ng = wrap(g + gd * abs(speed), 0, blen);\r\ngf = max(gf - 1 / xf, 0);\r\n\r\n// end of segment: choose the next one\r\nif (rl >= sl || trig > 0 || c >= ns) {\r\n\tfcur = weight * peek(ft, c, 1) + (1 - weight) * peek(ft, c, 0);\r\n\tt = wrap(fcur + sweep * 0.06, 0, 1);\r\n\tbest = floor((noise() * 0.5 + 0.5) * ns);\r\n\tif (ad > 0.5 && (noise() * 0.5 + 0.5) < similarity && trig < 0.5) {\r\n\t\tbd = 1000000;\r\n\t\tfor (k = 0; k < 16; k += 1) {\r\n\t\t\tcand = floor((noise() * 0.5 + 0.5) * ns);\r\n\t\t\tfc = weight * peek(ft, cand, 1) + (1 - weight) * peek(ft, cand, 0);\r\n\t\t\tdd = abs(fc - t);\r\n\t\t\tif (cand != c && dd < bd) {\r\n\t\t\t\tbd = dd;\r\n\t\t\t\tbest = cand;\r\n\t\t\t}\r\n\t\t}\r\n\t}\r\n\tif (ad < 0.5 && trig < 0.5) {\r\n\t\tbest = wrap(c + 1, 0, ns);\r\n\t}\r\n\tg = lastap;\r\n\tgd = dr;\r\n\tgf = 1;\r\n\tc = best;\r\n\trl = 0;\r\n\tdr = 1;\r\n\tif ((noise() * 0.5 + 0.5) < rev) {\r\n\t\tdr = -1;\r\n\t}\r\n\tif (speed < 0) {\r\n\t\tdr = 0 - dr;\r\n\t}\r\n}\r\n\r\nap = c * sl + rl;\r\nif (dr < 0) {\r\n\tap = c * sl + sl - 1 - rl;\r\n}\r\nap = wrap(ap, 0, blen);\r\ni0 = floor(ap);\r\nfr = ap - i0;\r\ni1 = wrap(i0 + 1, 0, blen);\r\nj0 = floor(g);\r\ngr = g - j0;\r\nj1 = wrap(j0 + 1, 0, blen);\r\nka = sqrt(1 - gf);\r\nkb = sqrt(gf);\r\noL = mix(peek(src, i0, 0), peek(src, i1, 0), fr) * ka + mix(peek(src, j0, 0), peek(src, j1, 0), gr) * kb;\r\noR = mix(peek(src, i0, ch2), peek(src, i1, ch2), fr) * ka + mix(peek(src, j0, ch2), peek(src, j1, ch2), gr) * kb;\r\n\r\nout1 = oL * level;\r\nout2 = oR * level;\r\nout3 = ap / blen;\r\nout4 = t;\r\n\r\nan = a0;\r\nadone = ad;\r\nblprev = blen;\r\nslprev = sl;\r\nzprev = zp;\r\ncur = c;\r\nrel = rl;\r\ncdir = dr;\r\ngpos = g;\r\ngdir = gd;\r\ngfade = gf;\r\ntgt = t;\r\nlastap = ap;\r\ntrigprev = in1;\r\n",
                  "fontface": 0,
                  "fontname": "<Monospaced>",
                  "fontsize": 12.0,
                  "numinlets": 1,
                  "numoutlets": 4,
                  "outlettype": [
                    "",
                    "",
                    "",
                    ""
                  ],
                  "patching_rect": [
                    30.0,
                    60.0,
                    760.0,
                    1100.0
                  ],
                  "id": "obj-1"
                }
              },
              {
                "box": {
                  "maxclass": "newobj",
                  "text": "in 1",
                  "numinlets": 0,
                  "numoutlets": 1,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    30.0,
                    20.0,
                    40.0,
                    22.0
                  ],
                  "id": "obj-2"
                }
              },
              {
                "box": {
                  "maxclass": "newobj",
                  "text": "out 1",
                  "numinlets": 1,
                  "numoutlets": 0,
                  "patching_rect": [
                    30.0,
                    1180.0,
                    45.0,
                    22.0
                  ],
                  "id": "obj-3"
                }
              },
              {
                "box": {
                  "maxclass": "newobj",
                  "text": "out 2",
                  "numinlets": 1,
                  "numoutlets": 0,
                  "patching_rect": [
                    150.0,
                    1180.0,
                    45.0,
                    22.0
                  ],
                  "id": "obj-4"
                }
              },
              {
                "box": {
                  "maxclass": "newobj",
                  "text": "out 3",
                  "numinlets": 1,
                  "numoutlets": 0,
                  "patching_rect": [
                    270.0,
                    1180.0,
                    45.0,
                    22.0
                  ],
                  "id": "obj-5"
                }
              },
              {
                "box": {
                  "maxclass": "newobj",
                  "text": "out 4",
                  "numinlets": 1,
                  "numoutlets": 0,
                  "patching_rect": [
                    390.0,
                    1180.0,
                    45.0,
                    22.0
                  ],
                  "id": "obj-6"
                }
              }
            ],
            "lines": [
              {
                "patchline": {
                  "source": [
                    "obj-2",
                    0
                  ],
                  "destination": [
                    "obj-1",
                    0
                  ]
                }
              },
              {
                "patchline": {
                  "source": [
                    "obj-1",
                    0
                  ],
                  "destination": [
                    "obj-3",
                    0
                  ]
                }
              },
              {
                "patchline": {
                  "source": [
                    "obj-1",
                    1
                  ],
                  "destination": [
                    "obj-4",
                    0
                  ]
                }
              },
              {
                "patchline": {
                  "source": [
                    "obj-1",
                    2
                  ],
                  "destination": [
                    "obj-5",
                    0
                  ]
                }
              },
              {
                "patchline": {
                  "source": [
                    "obj-1",
                    3
                  ],
                  "destination": [
                    "obj-6",
                    0
                  ]
                }
              }
            ]
          },
          "id": "obj-48"
        }
      },
      {
        "box": {
          "maxclass": "button",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            24,
            576,
            26,
            26
          ],
          "outlettype": [
            "bang"
          ],
          "id": "obj-49"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "click~",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            60,
            578,
            56,
            22.0
          ],
          "id": "obj-50"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            112,
            580,
            640,
            21.95
          ],
          "text": "● 今すぐ別の断片へ跳ぶ",
          "fontsize": 11.0,
          "id": "obj-51"
        }
      },
      {
        "box": {
          "maxclass": "panel",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            12,
            548,
            770,
            232
          ],
          "bgcolor": [
            0.94,
            0.89,
            0.87,
            1.0
          ],
          "rounded": 8,
          "border": 0,
          "background": 1,
          "id": "obj-52"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            24,
            554,
            700,
            23.4
          ],
          "text": "3  マシン MACHINE — gen~ をダブルクリックするとコードが見られます",
          "fontsize": 12.0,
          "fontface": 1,
          "id": "obj-53"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "*~ 0.",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            24,
            662,
            60,
            22.0
          ],
          "id": "obj-54"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "*~ 0.",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            270,
            662,
            60,
            22.0
          ],
          "id": "obj-55"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r ni_master",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            96,
            632,
            91,
            22.0
          ],
          "hidden": 1,
          "id": "obj-56"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            96,
            662,
            60,
            22
          ],
          "outlettype": [
            "",
            "bang"
          ],
          "minimum": 0.0,
          "maximum": 1.0,
          "numdecimalplaces": 2,
          "format": 6,
          "id": "obj-57"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            160,
            664,
            60,
            21.95
          ],
          "text": "master",
          "fontsize": 11.0,
          "id": "obj-58"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "pack f 40",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            96,
            690,
            77,
            22.0
          ],
          "hidden": 1,
          "id": "obj-59"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "line~",
          "numinlets": 2,
          "numoutlets": 2,
          "outlettype": [
            "signal",
            "bang"
          ],
          "patching_rect": [
            96,
            716,
            49,
            22.0
          ],
          "hidden": 1,
          "id": "obj-60"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "loadmess 0.7",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            96,
            608,
            98,
            22.0
          ],
          "hidden": 1,
          "id": "obj-61"
        }
      },
      {
        "box": {
          "maxclass": "ezdac~",
          "numinlets": 2,
          "numoutlets": 0,
          "patching_rect": [
            24,
            702,
            45,
            45
          ],
          "id": "obj-62"
        }
      },
      {
        "box": {
          "maxclass": "meter~",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            76,
            702,
            12,
            45
          ],
          "outlettype": [
            "float"
          ],
          "id": "obj-63"
        }
      },
      {
        "box": {
          "maxclass": "meter~",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            92,
            702,
            12,
            45
          ],
          "outlettype": [
            "float"
          ],
          "id": "obj-64"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            110,
            714,
            150,
            21.95
          ],
          "text": "← クリックで音を出す",
          "fontsize": 11.0,
          "id": "obj-65"
        }
      },
      {
        "box": {
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "patching_rect": [
            270,
            702,
            44,
            22.0
          ],
          "outlettype": [
            ""
          ],
          "text": "open",
          "id": "obj-66"
        }
      },
      {
        "box": {
          "maxclass": "toggle",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            318,
            702,
            22,
            22
          ],
          "outlettype": [
            "int"
          ],
          "id": "obj-67"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "sfrecord~ 2",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            270,
            732,
            90,
            22.0
          ],
          "id": "obj-68"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            346,
            704,
            170,
            36.45
          ],
          "text": "録音: open で保存先 → トグルで開始/停止",
          "fontsize": 10.5,
          "linecount": 2,
          "id": "obj-69"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "snapshot~ 33",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "float"
          ],
          "patching_rect": [
            516,
            662,
            90,
            22.0
          ],
          "id": "obj-70"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "snapshot~ 33",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "float"
          ],
          "patching_rect": [
            664,
            662,
            90,
            22.0
          ],
          "id": "obj-71"
        }
      },
      {
        "box": {
          "maxclass": "slider",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            516,
            702,
            140,
            18
          ],
          "outlettype": [
            ""
          ],
          "floatoutput": 1,
          "size": 1.0,
          "ignoreclick": 1,
          "id": "obj-72"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            516,
            724,
            145,
            36.45
          ],
          "text": "読み取り位置 (out3)",
          "fontsize": 10.5,
          "linecount": 2,
          "id": "obj-73"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            664,
            702,
            60,
            22
          ],
          "outlettype": [
            "",
            "bang"
          ],
          "numdecimalplaces": 2,
          "format": 6,
          "ignoreclick": 1,
          "id": "obj-74"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            664,
            724,
            118,
            36.45
          ],
          "text": "目標の特徴 (out4)\n0 暗い・小さい 〜 1",
          "fontsize": 10.5,
          "linecount": 2,
          "id": "obj-75"
        }
      },
      {
        "box": {
          "maxclass": "panel",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            792,
            142,
            390,
            296
          ],
          "bgcolor": [
            0.93,
            0.92,
            0.89,
            1.0
          ],
          "rounded": 8,
          "border": 0,
          "background": 1,
          "id": "obj-76"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            800,
            150,
            360,
            23.4
          ],
          "text": "プリセット PRESETS — ● を押す",
          "fontsize": 12.0,
          "fontface": 1,
          "id": "obj-77"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "loadbang",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            "bang"
          ],
          "patching_rect": [
            1100,
            150,
            70,
            22.0
          ],
          "hidden": 1,
          "id": "obj-78"
        }
      },
      {
        "box": {
          "maxclass": "button",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            800,
            180,
            26,
            26
          ],
          "outlettype": [
            "bang"
          ],
          "id": "obj-79"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            834,
            182,
            330,
            24.849999999999998
          ],
          "text": "似たもの similar",
          "fontsize": 13.0,
          "fontface": 1,
          "id": "obj-80"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            834,
            202,
            340,
            21.225
          ],
          "text": "似た断片だけをつないでいく",
          "fontsize": 10.5,
          "id": "obj-81"
        }
      },
      {
        "box": {
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "patching_rect": [
            1000,
            180,
            170,
            22.0
          ],
          "outlettype": [
            ""
          ],
          "hidden": 1,
          "text": "; ni_seglen 120; ni_similarity 0.9; ni_weight 0.5; ni_sweep 0; ni_speed 1; ni_rev 0.1; ni_xfade 10; ni_level 0.8",
          "id": "obj-82"
        }
      },
      {
        "box": {
          "maxclass": "button",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            800,
            244,
            26,
            26
          ],
          "outlettype": [
            "bang"
          ],
          "id": "obj-83"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            834,
            246,
            330,
            24.849999999999998
          ],
          "text": "明るい方へ brighter",
          "fontsize": 13.0,
          "fontface": 1,
          "id": "obj-84"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            834,
            266,
            340,
            21.225
          ],
          "text": "一歩ごとに明るい断片へ",
          "fontsize": 10.5,
          "id": "obj-85"
        }
      },
      {
        "box": {
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "patching_rect": [
            1000,
            244,
            170,
            22.0
          ],
          "outlettype": [
            ""
          ],
          "hidden": 1,
          "text": "; ni_seglen 80; ni_similarity 0.95; ni_weight 1; ni_sweep 0.4",
          "id": "obj-86"
        }
      },
      {
        "box": {
          "maxclass": "button",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            800,
            308,
            26,
            26
          ],
          "outlettype": [
            "bang"
          ],
          "id": "obj-87"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            834,
            310,
            330,
            24.849999999999998
          ],
          "text": "暗い方へ darker",
          "fontsize": 13.0,
          "fontface": 1,
          "id": "obj-88"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            834,
            330,
            340,
            21.225
          ],
          "text": "一歩ごとに暗い断片へ",
          "fontsize": 10.5,
          "id": "obj-89"
        }
      },
      {
        "box": {
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "patching_rect": [
            1000,
            308,
            170,
            22.0
          ],
          "outlettype": [
            ""
          ],
          "hidden": 1,
          "text": "; ni_seglen 150; ni_similarity 0.95; ni_weight 1; ni_sweep -0.4",
          "id": "obj-90"
        }
      },
      {
        "box": {
          "maxclass": "button",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            800,
            372,
            26,
            26
          ],
          "outlettype": [
            "bang"
          ],
          "id": "obj-91"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            834,
            374,
            330,
            24.849999999999998
          ],
          "text": "散らばり scatter",
          "fontsize": 13.0,
          "fontface": 1,
          "id": "obj-92"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            834,
            394,
            340,
            21.225
          ],
          "text": "短い断片をどこへでも",
          "fontsize": 10.5,
          "id": "obj-93"
        }
      },
      {
        "box": {
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "patching_rect": [
            1000,
            372,
            170,
            22.0
          ],
          "outlettype": [
            ""
          ],
          "hidden": 1,
          "text": "; ni_seglen 40; ni_similarity 0.2; ni_rev 0.3; ni_xfade 4",
          "id": "obj-94"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            800,
            456,
            380,
            117.64999999999999
          ],
          "text": "使い方\n1. 音声ファイルをドロップ（または replace）\n2. ezdac~（スピーカー）をクリックして DSP を ON\n3. プリセットの ● を押す（起動時は 1 番目が入ります）\n4. 数字をドラッグして変える\n起動時は音源が空です。まず音声ファイルを\nドロップするか replace で選んでください。",
          "fontsize": 11.0,
          "linecount": 7,
          "id": "obj-95"
        }
      }
    ],
    "lines": [
      {
        "patchline": {
          "source": [
            "obj-6",
            0
          ],
          "destination": [
            "obj-11",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-8",
            0
          ],
          "destination": [
            "obj-10",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-10",
            0
          ],
          "destination": [
            "obj-11",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-13",
            0
          ],
          "destination": [
            "obj-12",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-17",
            0
          ],
          "destination": [
            "obj-18",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-18",
            0
          ],
          "destination": [
            "obj-19",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-21",
            0
          ],
          "destination": [
            "obj-22",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-22",
            0
          ],
          "destination": [
            "obj-23",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-25",
            0
          ],
          "destination": [
            "obj-26",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-26",
            0
          ],
          "destination": [
            "obj-27",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-29",
            0
          ],
          "destination": [
            "obj-30",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-30",
            0
          ],
          "destination": [
            "obj-31",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-33",
            0
          ],
          "destination": [
            "obj-34",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-34",
            0
          ],
          "destination": [
            "obj-35",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-37",
            0
          ],
          "destination": [
            "obj-38",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-38",
            0
          ],
          "destination": [
            "obj-39",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-41",
            0
          ],
          "destination": [
            "obj-42",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-42",
            0
          ],
          "destination": [
            "obj-43",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-45",
            0
          ],
          "destination": [
            "obj-46",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-46",
            0
          ],
          "destination": [
            "obj-47",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-19",
            0
          ],
          "destination": [
            "obj-48",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-23",
            0
          ],
          "destination": [
            "obj-48",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-27",
            0
          ],
          "destination": [
            "obj-48",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-31",
            0
          ],
          "destination": [
            "obj-48",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-35",
            0
          ],
          "destination": [
            "obj-48",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-39",
            0
          ],
          "destination": [
            "obj-48",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-43",
            0
          ],
          "destination": [
            "obj-48",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-47",
            0
          ],
          "destination": [
            "obj-48",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-49",
            0
          ],
          "destination": [
            "obj-50",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-50",
            0
          ],
          "destination": [
            "obj-48",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-48",
            0
          ],
          "destination": [
            "obj-54",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-48",
            1
          ],
          "destination": [
            "obj-55",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-56",
            0
          ],
          "destination": [
            "obj-57",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-61",
            0
          ],
          "destination": [
            "obj-57",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-57",
            0
          ],
          "destination": [
            "obj-59",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-59",
            0
          ],
          "destination": [
            "obj-60",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-60",
            0
          ],
          "destination": [
            "obj-54",
            1
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-60",
            0
          ],
          "destination": [
            "obj-55",
            1
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-54",
            0
          ],
          "destination": [
            "obj-62",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-55",
            0
          ],
          "destination": [
            "obj-62",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-54",
            0
          ],
          "destination": [
            "obj-63",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-55",
            0
          ],
          "destination": [
            "obj-64",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-66",
            0
          ],
          "destination": [
            "obj-68",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-67",
            0
          ],
          "destination": [
            "obj-68",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-54",
            0
          ],
          "destination": [
            "obj-68",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-55",
            0
          ],
          "destination": [
            "obj-68",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-48",
            2
          ],
          "destination": [
            "obj-70",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-48",
            3
          ],
          "destination": [
            "obj-71",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-70",
            0
          ],
          "destination": [
            "obj-72",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-71",
            0
          ],
          "destination": [
            "obj-74",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-79",
            0
          ],
          "destination": [
            "obj-82",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-78",
            0
          ],
          "destination": [
            "obj-82",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-83",
            0
          ],
          "destination": [
            "obj-86",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-87",
            0
          ],
          "destination": [
            "obj-90",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-91",
            0
          ],
          "destination": [
            "obj-94",
            0
          ],
          "hidden": 1
        }
      }
    ],
    "dependency_cache": [],
    "autosave": 0
  }
}