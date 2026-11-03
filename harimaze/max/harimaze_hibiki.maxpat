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
      876.0
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
          "text": "HIBIKI 響 — resonator bank",
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
          "text": "音源が 8 本の共鳴器を鳴らす。雨でも声でもノイズでも、通すと和音になって響き、漂い、ときどき移り変わる。\nchord は和音の種類（0 オクターブ 1 五度 2 maj9 3 min11 4 五音 5 倍音列）、decay は響きの長さ（秒）。\nfreeze で入力を止め、響きだけを鳴らし続ける。",
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
          "text": "文脈: SUGAI KEN・KMRU の環境音 / 竹村延和の「Tone Poems」/ テクスチャーから別のものを立ち上げる",
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
          "text": "1  入力ファイル（source = 1 のとき）",
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
          "text": "buffer~ hz_hibiki_file 30000 2",
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
          "text": "loadmess set hz_hibiki_file",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            210,
            300,
            203,
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
            282
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
          "text": "source\n入力 1=file 0=mic  on/off",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-16"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r hibiki_source",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            94,
            412,
            119,
            22.0
          ],
          "hidden": 1,
          "id": "obj-17"
        }
      },
      {
        "box": {
          "maxclass": "toggle",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            24,
            408,
            24,
            24
          ],
          "outlettype": [
            "int"
          ],
          "id": "obj-18"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend source",
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
          "text": "root\n根音 MIDI  24〜84",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-20"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r hibiki_root",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            220,
            412,
            105,
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
          "minimum": 24.0,
          "maximum": 84.0,
          "numdecimalplaces": 0,
          "format": 6,
          "id": "obj-22"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend root",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            150,
            438,
            98,
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
          "text": "chord\n和音の種類  0〜5",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-24"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r hibiki_chord",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            346,
            412,
            112,
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
          "maximum": 5.0,
          "numdecimalplaces": 0,
          "format": 6,
          "id": "obj-26"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend chord",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            276,
            438,
            105,
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
          "text": "spread\n開き  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-28"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r hibiki_spread",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            472,
            412,
            119,
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
          "minimum": 0.0,
          "maximum": 1.0,
          "numdecimalplaces": 3,
          "format": 6,
          "id": "obj-30"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend spread",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            402,
            438,
            112,
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
          "text": "decay\n響き 秒  0.05〜60",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-32"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r hibiki_decay",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            598,
            412,
            112,
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
          "minimum": 0.05,
          "maximum": 60.0,
          "numdecimalplaces": 2,
          "format": 6,
          "id": "obj-34"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend decay",
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
          "text": "detune\nうなり  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-36"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r hibiki_detune",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            724,
            412,
            119,
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
          "text": "prepend detune",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            654,
            438,
            112,
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
          "text": "drift\n漂い  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-40"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r hibiki_drift",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            94,
            496,
            112,
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
          "minimum": 0.0,
          "maximum": 1.0,
          "numdecimalplaces": 3,
          "format": 6,
          "id": "obj-42"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend drift",
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
          "text": "changes\n移り変わり  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-44"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r hibiki_changes",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            220,
            496,
            126,
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
          "text": "prepend changes",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            150,
            522,
            119,
            22.0
          ],
          "hidden": 1,
          "id": "obj-47"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            276,
            456,
            122,
            37.9
          ],
          "text": "glide\n移る速さ ms  1〜5000",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-48"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r hibiki_glide",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            346,
            496,
            112,
            22.0
          ],
          "hidden": 1,
          "id": "obj-49"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            276,
            492,
            74,
            22
          ],
          "outlettype": [
            "",
            "bang"
          ],
          "minimum": 1.0,
          "maximum": 5000.0,
          "numdecimalplaces": 0,
          "format": 6,
          "id": "obj-50"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend glide",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            276,
            522,
            105,
            22.0
          ],
          "hidden": 1,
          "id": "obj-51"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            402,
            456,
            122,
            37.9
          ],
          "text": "bright\n明るさ  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-52"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r hibiki_bright",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            472,
            496,
            119,
            22.0
          ],
          "hidden": 1,
          "id": "obj-53"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            402,
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
          "id": "obj-54"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend bright",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            402,
            522,
            112,
            22.0
          ],
          "hidden": 1,
          "id": "obj-55"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            528,
            456,
            122,
            37.9
          ],
          "text": "wet\n響きの量  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-56"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r hibiki_wet",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            598,
            496,
            98,
            22.0
          ],
          "hidden": 1,
          "id": "obj-57"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            528,
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
          "id": "obj-58"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend wet",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            528,
            522,
            91,
            22.0
          ],
          "hidden": 1,
          "id": "obj-59"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            654,
            456,
            122,
            37.9
          ],
          "text": "freeze\n凍結  on/off",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-60"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r hibiki_freeze",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            724,
            496,
            119,
            22.0
          ],
          "hidden": 1,
          "id": "obj-61"
        }
      },
      {
        "box": {
          "maxclass": "toggle",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            654,
            492,
            24,
            24
          ],
          "outlettype": [
            "int"
          ],
          "id": "obj-62"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend freeze",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            654,
            522,
            112,
            22.0
          ],
          "hidden": 1,
          "id": "obj-63"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            24,
            540,
            122,
            37.9
          ],
          "text": "level\n音量  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-64"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r hibiki_level",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            94,
            580,
            112,
            22.0
          ],
          "hidden": 1,
          "id": "obj-65"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            24,
            576,
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
          "id": "obj-66"
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
            24,
            606,
            105,
            22.0
          ],
          "hidden": 1,
          "id": "obj-67"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "gen~",
          "numinlets": 2,
          "numoutlets": 4,
          "outlettype": [
            "signal",
            "signal",
            "signal",
            "signal"
          ],
          "patching_rect": [
            24,
            702,
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
                  "code": "// harimaze / HIBIKI - resonator bank\r\n// The source excites eight tuned resonators. Whatever goes in (rain,\r\n// voices, noise, a whole song) comes out as a chord that rings, drifts\r\n// and changes. Freeze cuts the input and lets the resonators ring on.\r\n// in1, in2 : live input (used when source = 0)\r\n// out1 : left    out2 : right\r\n// out3 : input level 0..1    out4 : chord root offset in semitones\r\n\r\nBuffer feed(\"hz_hibiki_file\");\r\nData tab(48, 1);\r\nData rs(8, 4);\r\n\r\nParam source(1);\r\nParam root(50);\r\nParam chord(2);\r\nParam spread(0.4);\r\nParam decay(4);\r\nParam detune(0.15);\r\nParam drift(0.2);\r\nParam changes(0.2);\r\nParam glide(400);\r\nParam bright(0.4);\r\nParam wet(0.8);\r\nParam freeze(0);\r\nParam level(0.7);\r\n\r\nHistory inited(0);\r\nHistory fpos(0);\r\nHistory xin1(0);\r\nHistory xin2(0);\r\nHistory xprev(0);\r\nHistory ienv(0);\r\nHistory oenv(0);\r\nHistory agc(1);\r\nHistory ro(0);\r\nHistory ctimer(48000);\r\n\r\nfl = max(dim(feed), 2);\r\nfch = 0;\r\nif (channels(feed) > 1) {\r\n\tfch = 1;\r\n}\r\n\r\n// chord table: octaves, fifths, maj9, min11, pentatonic, harmonic series\r\nif (inited < 0.5) {\r\n\tpoke(tab, 0, 0, 0);\r\n\tpoke(tab, 0, 1, 0);\r\n\tpoke(tab, 12, 2, 0);\r\n\tpoke(tab, 12, 3, 0);\r\n\tpoke(tab, 24, 4, 0);\r\n\tpoke(tab, 24, 5, 0);\r\n\tpoke(tab, 36, 6, 0);\r\n\tpoke(tab, -12, 7, 0);\r\n\tpoke(tab, 0, 8, 0);\r\n\tpoke(tab, 7, 9, 0);\r\n\tpoke(tab, 12, 10, 0);\r\n\tpoke(tab, 19, 11, 0);\r\n\tpoke(tab, 24, 12, 0);\r\n\tpoke(tab, 31, 13, 0);\r\n\tpoke(tab, 36, 14, 0);\r\n\tpoke(tab, 43, 15, 0);\r\n\tpoke(tab, 0, 16, 0);\r\n\tpoke(tab, 4, 17, 0);\r\n\tpoke(tab, 7, 18, 0);\r\n\tpoke(tab, 11, 19, 0);\r\n\tpoke(tab, 14, 20, 0);\r\n\tpoke(tab, 16, 21, 0);\r\n\tpoke(tab, 19, 22, 0);\r\n\tpoke(tab, 23, 23, 0);\r\n\tpoke(tab, 0, 24, 0);\r\n\tpoke(tab, 3, 25, 0);\r\n\tpoke(tab, 7, 26, 0);\r\n\tpoke(tab, 10, 27, 0);\r\n\tpoke(tab, 14, 28, 0);\r\n\tpoke(tab, 17, 29, 0);\r\n\tpoke(tab, 19, 30, 0);\r\n\tpoke(tab, 22, 31, 0);\r\n\tpoke(tab, 0, 32, 0);\r\n\tpoke(tab, 2, 33, 0);\r\n\tpoke(tab, 4, 34, 0);\r\n\tpoke(tab, 7, 35, 0);\r\n\tpoke(tab, 9, 36, 0);\r\n\tpoke(tab, 12, 37, 0);\r\n\tpoke(tab, 14, 38, 0);\r\n\tpoke(tab, 16, 39, 0);\r\n\tpoke(tab, 0, 40, 0);\r\n\tpoke(tab, 12, 41, 0);\r\n\tpoke(tab, 19.02, 42, 0);\r\n\tpoke(tab, 24, 43, 0);\r\n\tpoke(tab, 27.86, 44, 0);\r\n\tpoke(tab, 31.02, 45, 0);\r\n\tpoke(tab, 33.69, 46, 0);\r\n\tpoke(tab, 36, 47, 0);\r\n}\r\n\r\n// input: file loop or live, pre-emphasised by bright\r\nfp = fpos;\r\nfi = floor(fp);\r\nx = (peek(feed, fi, 0) + peek(feed, fi, fch)) * 0.5;\r\nfp = wrap(fp + 1, 0, fl);\r\nif (source < 0.5) {\r\n\tx = (in1 + in2) * 0.5;\r\n}\r\ndry = x;\r\nx = x + clamp(bright, 0, 1) * 2 * (x - xprev);\r\nxp = dry;\r\nif (freeze > 0.5) {\r\n\tx = 0;\r\n}\r\nie = ienv;\r\nie = ie + (abs(dry) - ie) * 0.0005;\r\n\r\n// chord changes: the root moves within a small set of intervals\r\nrr = ro;\r\nct = ctimer - 1;\r\nk = 0;\r\nif (ct <= 0) {\r\n\tct = mstosamps(mix(20000, 1200, clamp(changes, 0, 1)) * (0.6 + 0.8 * (noise() * 0.5 + 0.5)));\r\n\tif (changes > 0.001) {\r\n\t\tk = floor((noise() * 0.5 + 0.5) * 7);\r\n\t\trr = 0;\r\n\t\tif (k == 1) {\r\n\t\t\trr = 5;\r\n\t\t}\r\n\t\tif (k == 2) {\r\n\t\t\trr = 7;\r\n\t\t}\r\n\t\tif (k == 3) {\r\n\t\t\trr = -2;\r\n\t\t}\r\n\t\tif (k == 4) {\r\n\t\t\trr = 3;\r\n\t\t}\r\n\t\tif (k == 5) {\r\n\t\t\trr = -5;\r\n\t\t}\r\n\t\tif (k == 6) {\r\n\t\t\trr = 2;\r\n\t\t}\r\n\t}\r\n}\r\n\r\ncs = clamp(floor(chord), 0, 5);\r\ntsec = clamp(decay, 0.05, 60);\r\nif (freeze > 0.5) {\r\n\ttsec = 300;\r\n}\r\nrad = exp(-6.9078 / (tsec * samplerate));\r\ngco = 1 - exp(-1 / max(mstosamps(glide), 1));\r\nsumL = 0;\r\nsumR = 0;\r\ni = 0;\r\ny1 = 0;\r\ny2 = 0;\r\nfq = 0;\r\ndr = 0;\r\noct = 0;\r\nm = 0;\r\nft = 0;\r\nw = 0;\r\ny = 0;\r\nfor (i = 0; i < 8; i += 1) {\r\n\ty1 = peek(rs, i, 0);\r\n\ty2 = peek(rs, i, 1);\r\n\tfq = peek(rs, i, 2);\r\n\tdr = peek(rs, i, 3);\r\n\tdr = clamp(dr * 0.99999 + noise() * drift * 0.0004, -0.5, 0.5);\r\n\toct = floor(i * clamp(spread, 0, 1) * 0.5);\r\n\tm = root + rr + peek(tab, cs * 8 + i, 0) + oct * 12 + detune * 0.3 * (2 * (i - 2 * floor(i / 2)) - 1) + dr;\r\n\tft = min(440 * pow(2, (m - 69) / 12), samplerate * 0.45);\r\n\tif (fq <= 0) {\r\n\t\tfq = ft;\r\n\t}\r\n\tfq = fq + (ft - fq) * gco;\r\n\tw = twopi * fq / samplerate;\r\n\ty = 2 * rad * cos(w) * y1 - rad * rad * y2 + (1 - rad) * (x - xin2);\r\n\tif (i - 2 * floor(i / 2) < 0.5) {\r\n\t\tsumL += y;\r\n\t\tsumR += y * 0.35;\r\n\t} else {\r\n\t\tsumR += y;\r\n\t\tsumL += y * 0.35;\r\n\t}\r\n\tpoke(rs, y, i, 0);\r\n\tpoke(rs, y1, i, 1);\r\n\tpoke(rs, fq, i, 2);\r\n\tpoke(rs, dr, i, 3);\r\n}\r\n\r\n// automatic gain: long decays and frozen chords stay audible\r\noe = oenv;\r\npk = max(abs(sumL), abs(sumR));\r\nif (pk > oe) {\r\n\toe = oe + (pk - oe) * 0.01;\r\n} else {\r\n\toe = oe + (pk - oe) * 0.00005;\r\n}\r\nga = agc;\r\nga = ga + (clamp(0.3 / (oe + 0.0005), 0.2, 40) - ga) * 0.0005;\r\nrl = tanh(sumL * ga);\r\nrR = tanh(sumR * ga);\r\nwt = clamp(wet, 0, 1);\r\nout1 = (dry * (1 - wt) + rl * wt) * level;\r\nout2 = (dry * (1 - wt) + rR * wt) * level;\r\nout3 = clamp(ie * 4, 0, 1);\r\nout4 = rr;\r\n\r\ninited = 1;\r\nfpos = fp;\r\nxin2 = xin1;\r\nxin1 = x;\r\nxprev = xp;\r\nienv = ie;\r\noenv = oe;\r\nagc = ga;\r\nro = rr;\r\nctimer = ct;\r\n",
                  "fontface": 0,
                  "fontname": "<Monospaced>",
                  "fontsize": 12.0,
                  "numinlets": 2,
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
                  "text": "in 2",
                  "numinlets": 0,
                  "numoutlets": 1,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    150.0,
                    20.0,
                    40.0,
                    22.0
                  ],
                  "id": "obj-3"
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
                  "id": "obj-4"
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
                  "id": "obj-5"
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
                  "id": "obj-6"
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
                  "id": "obj-7"
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
                    "obj-3",
                    0
                  ],
                  "destination": [
                    "obj-1",
                    1
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
                    "obj-4",
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
                    "obj-5",
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
                    "obj-6",
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
                    "obj-7",
                    0
                  ]
                }
              }
            ]
          },
          "id": "obj-68"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "adc~ 1 2",
          "numinlets": 1,
          "numoutlets": 2,
          "outlettype": [
            "signal",
            "signal"
          ],
          "patching_rect": [
            24,
            662,
            70,
            22.0
          ],
          "id": "obj-69"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            110,
            664,
            600,
            21.95
          ],
          "text": "マイク / ライン入力 → source を 0 に。ハウリングに注意（ヘッドホン推奨）",
          "fontsize": 11.0,
          "id": "obj-70"
        }
      },
      {
        "box": {
          "maxclass": "panel",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            12,
            632,
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
          "id": "obj-71"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            24,
            638,
            700,
            23.4
          ],
          "text": "3  マシン MACHINE — gen~ をダブルクリックするとコードが見られます",
          "fontsize": 12.0,
          "fontface": 1,
          "id": "obj-72"
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
            746,
            60,
            22.0
          ],
          "id": "obj-73"
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
            746,
            60,
            22.0
          ],
          "id": "obj-74"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r hibiki_master",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            96,
            716,
            119,
            22.0
          ],
          "hidden": 1,
          "id": "obj-75"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            96,
            746,
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
          "id": "obj-76"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            160,
            748,
            60,
            21.95
          ],
          "text": "master",
          "fontsize": 11.0,
          "id": "obj-77"
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
            774,
            77,
            22.0
          ],
          "hidden": 1,
          "id": "obj-78"
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
            800,
            49,
            22.0
          ],
          "hidden": 1,
          "id": "obj-79"
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
            692,
            98,
            22.0
          ],
          "hidden": 1,
          "id": "obj-80"
        }
      },
      {
        "box": {
          "maxclass": "ezdac~",
          "numinlets": 2,
          "numoutlets": 0,
          "patching_rect": [
            24,
            786,
            45,
            45
          ],
          "id": "obj-81"
        }
      },
      {
        "box": {
          "maxclass": "meter~",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            76,
            786,
            12,
            45
          ],
          "outlettype": [
            "float"
          ],
          "id": "obj-82"
        }
      },
      {
        "box": {
          "maxclass": "meter~",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            92,
            786,
            12,
            45
          ],
          "outlettype": [
            "float"
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
            110,
            798,
            150,
            21.95
          ],
          "text": "← クリックで音を出す",
          "fontsize": 11.0,
          "id": "obj-84"
        }
      },
      {
        "box": {
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "patching_rect": [
            270,
            786,
            44,
            22.0
          ],
          "outlettype": [
            ""
          ],
          "text": "open",
          "id": "obj-85"
        }
      },
      {
        "box": {
          "maxclass": "toggle",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            318,
            786,
            22,
            22
          ],
          "outlettype": [
            "int"
          ],
          "id": "obj-86"
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
            816,
            90,
            22.0
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
            346,
            788,
            170,
            36.45
          ],
          "text": "録音: open で保存先 → トグルで開始/停止",
          "fontsize": 10.5,
          "linecount": 2,
          "id": "obj-88"
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
            746,
            90,
            22.0
          ],
          "id": "obj-89"
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
            746,
            90,
            22.0
          ],
          "id": "obj-90"
        }
      },
      {
        "box": {
          "maxclass": "slider",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            516,
            786,
            140,
            18
          ],
          "outlettype": [
            ""
          ],
          "floatoutput": 1,
          "size": 1.0,
          "ignoreclick": 1,
          "id": "obj-91"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            516,
            808,
            145,
            36.45
          ],
          "text": "入力の大きさ (out3)",
          "fontsize": 10.5,
          "linecount": 2,
          "id": "obj-92"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            664,
            786,
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
          "id": "obj-93"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            664,
            808,
            118,
            36.45
          ],
          "text": "根音のずれ (out4)\n半音",
          "fontsize": 10.5,
          "linecount": 2,
          "id": "obj-94"
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
          "id": "obj-95"
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
          "id": "obj-96"
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
          "id": "obj-97"
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
          "id": "obj-98"
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
          "text": "雨の和音 rain chord",
          "fontsize": 13.0,
          "fontface": 1,
          "id": "obj-99"
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
          "text": "maj9 がゆっくり移る",
          "fontsize": 10.5,
          "id": "obj-100"
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
          "text": "; hibiki_source 1; hibiki_root 50; hibiki_chord 2; hibiki_spread 0.4; hibiki_decay 4; hibiki_detune 0.15; hibiki_drift 0.2; hibiki_changes 0.2; hibiki_glide 400; hibiki_bright 0.4; hibiki_wet 0.8; hibiki_freeze 0; hibiki_level 0.7",
          "id": "obj-101"
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
          "id": "obj-102"
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
          "text": "倍音 harmonics",
          "fontsize": 13.0,
          "fontface": 1,
          "id": "obj-103"
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
          "text": "倍音列で長く鳴らす",
          "fontsize": 10.5,
          "id": "obj-104"
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
          "text": "; hibiki_root 38; hibiki_chord 5; hibiki_spread 0.6; hibiki_decay 10; hibiki_changes 0; hibiki_wet 0.9",
          "id": "obj-105"
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
          "id": "obj-106"
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
          "text": "鐘 bells",
          "fontsize": 13.0,
          "fontface": 1,
          "id": "obj-107"
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
          "text": "五度、短く明るく",
          "fontsize": 10.5,
          "id": "obj-108"
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
          "text": "; hibiki_root 62; hibiki_chord 1; hibiki_decay 1.5; hibiki_bright 0.8; hibiki_changes 0.4; hibiki_wet 0.7",
          "id": "obj-109"
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
          "id": "obj-110"
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
          "text": "長い影 long shadow",
          "fontsize": 13.0,
          "fontface": 1,
          "id": "obj-111"
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
          "text": "min11 で 40 秒響かせる",
          "fontsize": 10.5,
          "id": "obj-112"
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
          "text": "; hibiki_root 45; hibiki_chord 3; hibiki_decay 40; hibiki_changes 0.1; hibiki_glide 2000; hibiki_wet 1",
          "id": "obj-113"
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
            133.6
          ],
          "text": "使い方\n1. 音声ファイルをドロップ（または replace）\n2. ezdac~（スピーカー）をクリックして DSP を ON\n3. プリセットの ● を押す（起動時は 1 番目が入ります）\n4. 数字をドラッグして変える\n起動時は音源が空です。まず音声ファイルを\nドロップするか replace で選んでください。\nマイクを使うときは source を 0 に（ハウリング注意）。",
          "fontsize": 11.0,
          "linecount": 8,
          "id": "obj-114"
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
            "obj-49",
            0
          ],
          "destination": [
            "obj-50",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-50",
            0
          ],
          "destination": [
            "obj-51",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-53",
            0
          ],
          "destination": [
            "obj-54",
            0
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
            "obj-55",
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
            "obj-58",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-58",
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
            "obj-61",
            0
          ],
          "destination": [
            "obj-62",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-62",
            0
          ],
          "destination": [
            "obj-63",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-65",
            0
          ],
          "destination": [
            "obj-66",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-66",
            0
          ],
          "destination": [
            "obj-67",
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
            "obj-68",
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
            "obj-68",
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
            "obj-68",
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
            "obj-68",
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
            "obj-68",
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
            "obj-68",
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
            "obj-68",
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
            "obj-68",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-51",
            0
          ],
          "destination": [
            "obj-68",
            0
          ],
          "hidden": 1
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
            "obj-68",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-63",
            0
          ],
          "destination": [
            "obj-68",
            0
          ],
          "hidden": 1
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
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-69",
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
            "obj-69",
            1
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
            "obj-68",
            0
          ],
          "destination": [
            "obj-73",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-68",
            1
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
            "obj-75",
            0
          ],
          "destination": [
            "obj-76",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-80",
            0
          ],
          "destination": [
            "obj-76",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-76",
            0
          ],
          "destination": [
            "obj-78",
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
            "obj-79",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-79",
            0
          ],
          "destination": [
            "obj-73",
            1
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-79",
            0
          ],
          "destination": [
            "obj-74",
            1
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-73",
            0
          ],
          "destination": [
            "obj-81",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-74",
            0
          ],
          "destination": [
            "obj-81",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-73",
            0
          ],
          "destination": [
            "obj-82",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-74",
            0
          ],
          "destination": [
            "obj-83",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-85",
            0
          ],
          "destination": [
            "obj-87",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-86",
            0
          ],
          "destination": [
            "obj-87",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-73",
            0
          ],
          "destination": [
            "obj-87",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-74",
            0
          ],
          "destination": [
            "obj-87",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-68",
            2
          ],
          "destination": [
            "obj-89",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-68",
            3
          ],
          "destination": [
            "obj-90",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-89",
            0
          ],
          "destination": [
            "obj-91",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-90",
            0
          ],
          "destination": [
            "obj-93",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-98",
            0
          ],
          "destination": [
            "obj-101",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-97",
            0
          ],
          "destination": [
            "obj-101",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-102",
            0
          ],
          "destination": [
            "obj-105",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-106",
            0
          ],
          "destination": [
            "obj-109",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-110",
            0
          ],
          "destination": [
            "obj-113",
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